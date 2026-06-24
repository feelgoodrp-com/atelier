using System.Globalization;
using System.Security.Cryptography;
using Feelgood.Atelier.Sidecar.Engine;
using Feelgood.Atelier.Sidecar.Engine.Pose;

namespace Feelgood.Atelier.Sidecar.Api;

public static class PreviewEndpoints
{
    private const string GlbContentType = "model/gltf-binary";
    private const string DefaultPedModel = "mp_m_freemode_01";
    private static readonly string[] AllowedPedModels = { "mp_m_freemode_01", "mp_f_freemode_01" };

    /// <summary>
    /// Heel lift in metres (glTF-up = Y) the WHOLE 3D-preview scene rises when a
    /// rendered feet item has high heels. The high-heels flag is a BOOL with no
    /// height, so the contract pins one constant (~ grzy UI 1.0 /10). The client
    /// sends this exact numeric value as heelLift; the sidecar uses it 1:1 as
    /// yLift. Honest approximation, NOT a real expression/creaturemetadata
    /// effect — just "the ped stands higher", the analogue of grzy's floor trick
    /// (we render no floor). If a real height field ever lands it replaces this
    /// constant in one place per side.
    /// </summary>
    private const double HeelLiftMetres = 0.08;

    public static void MapPreviewEndpoints(this IEndpointRouteBuilder app)
    {
        // POST /preview/glb -> GLB bytes (model/gltf-binary) with
        // X-FG-Vertex-Count / X-FG-Poly-Count headers covering the whole scene.
        // textureIndex selects which entry of ytdPaths to apply and is CLAMPED
        // into [0, ytdPaths.length-1]; an empty ytdPaths means "untextured".
        app.MapPost("/preview/glb", (
            PreviewGlbRequest request,
            HttpContext ctx,
            AppState state,
            PedBodyService pedBody,
            PoseEngine poseEngine,
            ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("Atelier.Preview.Glb");

            var yddRead = TryReadAssetFile(request?.YddPath, ".ydd", log, out var yddBytes);
            if (yddRead != null) return yddRead;

            // Resolve + read the selected texture dict (if any).
            byte[]? ytdBytes = null;
            var ytdPaths = request?.YtdPaths;
            if (ytdPaths is { Count: > 0 })
            {
                var textureIndex = Math.Clamp(request?.TextureIndex ?? 0, 0, ytdPaths.Count - 1);
                var ytdRead = TryReadAssetFile(ytdPaths[textureIndex], ".ytd", log, out var selectedYtdBytes);
                if (ytdRead != null) return ytdRead;
                ytdBytes = selectedYtdBytes;
            }

            var pedModel = (request?.PedModel ?? DefaultPedModel).Trim().ToLowerInvariant();
            if (!AllowedPedModels.Contains(pedModel))
                return Results.BadRequest(new ErrorResponse(
                    "Feld 'pedModel' muss 'mp_m_freemode_01' oder 'mp_f_freemode_01' sein."));

            var includePedBody = request?.IncludePedBody ?? false;
            if (includePedBody && !state.GtaPathReady)
                return PedBodyUnavailable();

            var poseCheck = ValidatePose(request?.Pose, state, out var pose);
            if (poseCheck != null) return poseCheck;

            var animCheck = ValidateAnimation(request?.Animation, state, out var anim);
            if (animCheck != null) return animCheck;

            var appearanceCheck = ValidateAppearance(request?.Appearance, out var appearance);
            if (appearanceCheck != null) return appearanceCheck;
            // Appearance only changes the bytes when the ped body is rendered —
            // keep the key segment at "default" otherwise so garment-only
            // requests keep sharing one cache entry.
            var appearanceKey = includePedBody ? PedAppearanceKey.Canonical(appearance) : "default";

            // 3D-preview hair/heel: hairScale (0..1) shrinks THIS ydd, heelLift
            // (metres) lifts the WHOLE scene. Unlike appearance these ALWAYS
            // change the garment mesh, so the suffix is keyed regardless of
            // includePedBody. Absent => "" => byte-identical key + GLB.
            var hairScale = NormalizeHairScale(request?.HairScale);
            var heelLift = NormalizeHeelLift(request?.HeelLift);
            var extra = PreviewExtraKey(hairScale, heelLift);

            // Content-hash cache key (file BYTES, not paths) so the client can
            // cache by the same key and renames/copies still hit server-side.
            var cacheKey = new PreviewGlbCache.Key(
                Sha256Hex(yddBytes),
                ytdBytes != null ? Sha256Hex(ytdBytes) : "none",
                includePedBody,
                includePedBody || pose != null || anim != null ? pedModel : string.Empty,
                anim != null ? "anim:" + anim : pose ?? "none",
                appearanceKey,
                extra);
            if (PreviewGlbCache.TryGet(cacheKey, out var cached, out var cachedFallbacks))
                return GlbResponse(ctx, cached, cachedFallbacks);

            var poseLoad = TryLoadPose(poseEngine, state, pedModel, pose, log, out var poseData);
            if (poseLoad != null) return poseLoad;

            var animLoad = TryLoadAnimation(poseEngine, state, pedModel, anim, log, out var animData);
            if (animLoad != null) return animLoad;

            IReadOnlyList<PedBodyService.PedComponent>? pedComponents = null;
            string? appearanceFallbacks = null;
            var cacheable = true;
            if (includePedBody)
            {
                try
                {
                    var loaded = pedBody.LoadComponents(state.GtaPath!, pedModel, appearance);
                    pedComponents = loaded.Components;
                    if (loaded.FallbackSlots.Count > 0)
                        appearanceFallbacks = string.Join(",", loaded.FallbackSlots);
                    // Transient load timeouts (content pump under load) must
                    // not freeze a degraded GLB under this key — serve the
                    // result but let the next request rebuild it.
                    cacheable = !loaded.HadTransientLoadFailure;
                }
                catch (Exception ex)
                {
                    // Configured path without usable game data (or CodeWalker
                    // failing on it) - same contract answer as "no gtaPath".
                    log.LogError(ex, "Ped body load failed for {PedModel}", pedModel);
                    return PedBodyUnavailable();
                }
            }

            GlbBuilder.Result result;
            try
            {
                result = GlbBuilder.Build(yddBytes, ytdBytes, pedComponents, log, poseData, hairScale, (float)heelLift, animation: animData);
            }
            catch (Exception ex)
            {
                // CodeWalker throws on garbage/non-RSC7 input - report as client error.
                log.LogError(ex, "Preview build failed for {Path}", request?.YddPath);
                return Results.BadRequest(new ErrorResponse(
                    $"Vorschau konnte nicht erstellt werden: {ex.Message}"));
            }

            if (cacheable)
                PreviewGlbCache.Put(cacheKey, result, appearanceFallbacks);
            else
                log.LogWarning("Preview GLB not cached (transient component load failure) for appearance={Appearance}", appearanceKey);
            log.LogInformation("Preview GLB built: {Bytes} bytes, {Vertices} vertices, {Polys} polys, ped={Ped}, pose={Pose}, appearance={Appearance}",
                result.Glb.Length, result.VertexCount, result.PolyCount, includePedBody ? pedModel : "none", pose ?? "none", appearanceKey);
            return GlbResponse(ctx, result, appearanceFallbacks, transientDegraded: !cacheable);
        });

        // GET /preview/poses -> the static pose list (id + German label) so
        // the frontend stays in sync with the sidecar catalog.
        app.MapGet("/preview/poses", () => Results.Ok(new PosesResponse(
            PoseCatalog.Poses.Select(p => new PoseInfo(p.Id, p.Label)).ToList())));

        // GET /preview/animations -> the looping animation list (id + label).
        app.MapGet("/preview/animations", () => Results.Ok(new AnimationsResponse(
            AnimationCatalog.All.Select(a => new AnimInfo(a.Id, a.Label)).ToList())));

        MapOutfitEndpoint(app);
    }

    /// <summary>
    /// Normalizes + validates the requested pose id. Returns a 422 IResult on
    /// failure (unknown pose / no game data), null on success; pose is the
    /// normalized id or null for bind pose.
    /// </summary>
    private static IResult? ValidatePose(string? rawPose, AppState state, out string? pose)
    {
        pose = string.IsNullOrWhiteSpace(rawPose) ? null : rawPose.Trim().ToLowerInvariant();
        if (pose == null) return null;

        if (PoseCatalog.Find(pose) == null) return PoseUnavailable(pose);
        // Poses are baked from game animation data - same requirement as the ped body.
        if (!state.GtaPathReady) return PedBodyUnavailable();
        return null;
    }

    /// <summary>Resolves the pose skinning matrices; 422 IResult on failure, null on success.</summary>
    private static IResult? TryLoadPose(
        PoseEngine poseEngine,
        AppState state,
        string pedModel,
        string? pose,
        ILogger log,
        out PoseData? poseData)
    {
        poseData = null;
        if (pose == null) return null;

        try
        {
            poseData = poseEngine.GetPose(state.GtaPath!, pedModel, pose);
            return null;
        }
        catch (PoseUnavailableException ex)
        {
            log.LogWarning("Pose unavailable: {Pose} ({Message})", ex.PoseId, ex.Message);
            return PoseUnavailable(ex.PoseId);
        }
        catch (Exception ex)
        {
            // Broken/missing game data (skeleton, ycd index) - same contract
            // answer as the ped body.
            log.LogError(ex, "Pose load failed for {Pose} on {PedModel}", pose, pedModel);
            return PedBodyUnavailable();
        }
    }

    /// <summary>
    /// Normalizes + validates the requested animation id. 422 IResult on failure
    /// (unknown anim / no game data), null on success; anim is the normalized id
    /// or null for "no animation".
    /// </summary>
    private static IResult? ValidateAnimation(string? rawAnim, AppState state, out string? anim)
    {
        anim = string.IsNullOrWhiteSpace(rawAnim) ? null : rawAnim.Trim().ToLowerInvariant();
        if (anim == null) return null;
        if (AnimationCatalog.Find(anim) == null) return PoseUnavailable(anim);
        if (!state.GtaPathReady) return PedBodyUnavailable();
        return null;
    }

    /// <summary>Samples the animation; 422 IResult on failure, null on success.</summary>
    private static IResult? TryLoadAnimation(
        PoseEngine poseEngine,
        AppState state,
        string pedModel,
        string? anim,
        ILogger log,
        out AnimationData? animationData)
    {
        animationData = null;
        if (anim == null) return null;
        try
        {
            animationData = poseEngine.GetAnimation(state.GtaPath!, pedModel, anim);
            return null;
        }
        catch (PoseUnavailableException ex)
        {
            log.LogWarning("Animation unavailable: {Anim} ({Message})", ex.PoseId, ex.Message);
            return PoseUnavailable(ex.PoseId);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Animation load failed for {Anim} on {PedModel}", anim, pedModel);
            return PedBodyUnavailable();
        }
    }

    /// <summary>Maps an outfit-item slot to the ped component it replaces (props cover nothing).</summary>
    private static int? CoversComponentIndex(string? slot) =>
        slot != null && Engine.Build.GtaSlots.ComponentIds.TryGetValue(slot, out var id) ? id : null;

    /// <summary>
    /// Normalizes the optional 3D-preview hairScale: null/NaN/out-of-bounds is
    /// treated leniently (no 400 — like the face block). null/&lt;=0 disables the
    /// feature (returns null => Identity mesh path), otherwise it is clamped to
    /// [0,1]. A value of exactly 0 is "feature on, but full hair" — but since
    /// scale 0 means no shrink AND the GLB is byte-identical, we collapse it to
    /// null so the cache key + bytes match a request that omits the field.
    /// </summary>
    private static double? NormalizeHairScale(double? raw)
    {
        if (raw == null || double.IsNaN(raw.Value)) return null;
        var v = Math.Clamp(raw.Value, 0d, 1d);
        return v <= 0d ? null : v;
    }

    /// <summary>
    /// Normalizes the optional 3D-preview heelLift (metres). null/NaN/&lt;=0 means
    /// "off" (0 => no scene lift => byte-identical). The client sends the fixed
    /// <see cref="HeelLiftMetres"/> when a rendered feet item has high heels; we
    /// clamp non-finite junk but otherwise pass the metres through 1:1.
    /// </summary>
    private static double NormalizeHeelLift(double? raw)
    {
        if (raw == null || double.IsNaN(raw.Value) || raw.Value <= 0d) return 0d;
        return raw.Value;
    }

    /// <summary>
    /// Builds the cache-key suffix for the 3D-preview hair/heel flags. Mirrors
    /// the client (preview-3d-store): "|hs:&lt;F2&gt;" only when hairScale is on,
    /// "|hl1" only when heelLift is on, in that fixed order. Empty when neither
    /// is active, so the key stays byte-identical to before the contract.
    /// hairScale uses the SAME quantizer as the face mixes (PedAppearanceKey
    /// .FmtScale == F2), so slider value -> key is stable + reproducible.
    /// heelLift is bool-derived, so only its presence is keyed ("hl1").
    /// </summary>
    private static string PreviewExtraKey(double? hairScale, double heelLift)
    {
        var extra = string.Empty;
        if (hairScale is double hs)
            extra += "|hs:" + PedAppearanceKey.FmtScale((float)hs);
        if (heelLift > 0d)
            extra += "|hl1";
        return extra;
    }

    /// <summary>
    /// Validates + normalizes the optional appearance: slot/anchor keys are
    /// trimmed + lowercased, unknown slots/anchors and negative indices are a
    /// 400 (German message, uniform error shape). Returns null on success;
    /// normalized is null when the request carries no (effective) appearance.
    /// Props are validated only — rendering them comes with stage 2a.
    /// </summary>
    private static IResult? ValidateAppearance(PedAppearanceDto? raw, out PedAppearanceDto? normalized)
    {
        normalized = null;
        if (raw == null) return null;

        Dictionary<string, PedAppearanceComponentDto>? components = null;
        if (raw.Components is { Count: > 0 })
        {
            components = new Dictionary<string, PedAppearanceComponentDto>(raw.Components.Count);
            foreach (var (rawSlot, component) in raw.Components)
            {
                var slot = rawSlot?.Trim().ToLowerInvariant() ?? string.Empty;
                if (!Engine.Build.GtaSlots.ComponentIds.ContainsKey(slot))
                    return Results.BadRequest(new ErrorResponse(
                        $"Unbekannter Komponenten-Slot '{rawSlot}' in 'appearance.components' (erlaubt: {string.Join(", ", Engine.Build.GtaSlots.ComponentIds.Keys)})."));
                if (component == null || component.Drawable < 0 || component.Texture < 0 || (component.Alt ?? 0) < 0)
                    return Results.BadRequest(new ErrorResponse(
                        $"Feld 'appearance.components.{slot}': 'drawable', 'texture' und 'alt' müssen Zahlen >= 0 sein."));
                if (!components.TryAdd(slot, component))
                    return Results.BadRequest(new ErrorResponse(
                        $"Slot '{slot}' ist in 'appearance.components' mehrfach angegeben."));
            }
        }

        List<PedAppearancePropDto>? props = null;
        if (raw.Props is { Count: > 0 })
        {
            props = new List<PedAppearancePropDto>(raw.Props.Count);
            var seenAnchors = new HashSet<string>(StringComparer.Ordinal);
            foreach (var prop in raw.Props)
            {
                var anchor = prop?.Anchor?.Trim().ToLowerInvariant() ?? string.Empty;
                if (prop == null || !Engine.Build.GtaSlots.PropAnchorIds.ContainsKey(anchor))
                    return Results.BadRequest(new ErrorResponse(
                        $"Unbekannter Prop-Anker '{prop?.Anchor}' in 'appearance.props' (erlaubt: {string.Join(", ", Engine.Build.GtaSlots.PropAnchorIds.Keys)})."));
                if (prop.Drawable < 0 || prop.Texture < 0)
                    return Results.BadRequest(new ErrorResponse(
                        $"Feld 'appearance.props' ({anchor}): 'drawable' und 'texture' müssen Zahlen >= 0 sein."));
                // Duplicate anchors would make the canonical key ambiguous —
                // reject them exactly like duplicate component slots.
                if (!seenAnchors.Add(anchor))
                    return Results.BadRequest(new ErrorResponse(
                        $"Anker '{anchor}' ist in 'appearance.props' mehrfach angegeben."));
                props.Add(prop with { Anchor = anchor });
            }
        }

        // Face block: out-of-range NUMERIC fields are CLAMPED (never a 400);
        // the whole block is dropped only when JSON-structurally absent.
        var face = NormalizeFace(raw.Face);

        if (components == null && props == null && face == null) return null; // empty appearance == default
        normalized = new PedAppearanceDto(components, props, face);
        return null;
    }

    /// <summary>
    /// Clamps every face field into its contract range (parents 0..45, mixes
    /// 0..1, overlay slot 0..12 / index 0..255 / opacity 0..1 / colours 0..63,
    /// eye colour 0..31) and drops overlays that are off (index 255). Per the
    /// contract a structurally present but out-of-range face is corrected, not
    /// rejected — so this only returns null when there is no face at all.
    /// </summary>
    private static PedFaceDto? NormalizeFace(PedFaceDto? raw)
    {
        if (raw == null) return null;

        List<PedFaceOverlayDto>? overlays = null;
        if (raw.Overlays is { Count: > 0 })
        {
            overlays = new List<PedFaceOverlayDto>(raw.Overlays.Count);
            var seenSlots = new HashSet<int>();
            foreach (var overlay in raw.Overlays)
            {
                if (overlay == null) continue;
                var slot = Math.Clamp(overlay.Slot, 0, 12);
                var index = Math.Clamp(overlay.Index ?? PedAppearanceKey.OverlayOff, 0, 255);
                if (index == PedAppearanceKey.OverlayOff) continue; // layer off — never rendered/keyed
                // Duplicate slots would make the canonical key ambiguous; the
                // first wins (later ones are ignored, mirroring component slots).
                if (!seenSlots.Add(slot)) continue;
                overlays.Add(new PedFaceOverlayDto(
                    slot,
                    index,
                    overlay.Opacity.HasValue ? Math.Clamp(overlay.Opacity.Value, 0f, 1f) : null,
                    overlay.Colour.HasValue ? Math.Clamp(overlay.Colour.Value, 0, 63) : null,
                    overlay.ColourSecondary.HasValue ? Math.Clamp(overlay.ColourSecondary.Value, 0, 63) : null));
            }
            if (overlays.Count == 0) overlays = null;
        }

        return new PedFaceDto(
            Math.Clamp(raw.ShapeFirst, 0, 45),
            Math.Clamp(raw.ShapeSecond, 0, 45),
            Math.Clamp(raw.ShapeThird, 0, 45),
            Math.Clamp(raw.ShapeMix, 0f, 1f),
            Math.Clamp(raw.ThirdMix, 0f, 1f),
            Math.Clamp(raw.SkinFirst, 0, 45),
            Math.Clamp(raw.SkinSecond, 0, 45),
            Math.Clamp(raw.SkinThird, 0, 45),
            Math.Clamp(raw.SkinMix, 0f, 1f),
            overlays,
            raw.EyeColour.HasValue ? Math.Clamp(raw.EyeColour.Value, 0, 31) : null);
    }

    private static void MapOutfitEndpoint(IEndpointRouteBuilder app)
    {
        // POST /preview/outfit-glb -> ONE GLB containing all garments at once;
        // with includePedBody the garments REPLACE the ped's default
        // components in their slots (true outfit preview, grzy-style).
        app.MapPost("/preview/outfit-glb", (
            PreviewOutfitRequest request,
            HttpContext ctx,
            AppState state,
            PedBodyService pedBody,
            PoseEngine poseEngine,
            ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("Atelier.Preview.Outfit");

            var items = request?.Items;
            if (items == null || items.Count == 0)
                return Results.BadRequest(new ErrorResponse("Feld 'items' fehlt oder ist leer."));
            if (items.Count > 8)
                return Results.BadRequest(new ErrorResponse("Maximal 8 Teile pro Outfit-Vorschau."));

            var pedModel = (request?.PedModel ?? DefaultPedModel).Trim().ToLowerInvariant();
            if (!AllowedPedModels.Contains(pedModel))
                return Results.BadRequest(new ErrorResponse(
                    "Feld 'pedModel' muss 'mp_m_freemode_01' oder 'mp_f_freemode_01' sein."));

            var includePedBody = request?.IncludePedBody ?? false;
            if (includePedBody && !state.GtaPathReady)
                return PedBodyUnavailable();

            var poseCheck = ValidatePose(request?.Pose, state, out var pose);
            if (poseCheck != null) return poseCheck;

            var animCheck = ValidateAnimation(request?.Animation, state, out var anim);
            if (animCheck != null) return animCheck;

            var appearanceCheck = ValidateAppearance(request?.Appearance, out var appearance);
            if (appearanceCheck != null) return appearanceCheck;
            // Appearance only changes the bytes when the ped body is rendered.
            var appearanceKey = includePedBody ? PedAppearanceKey.Canonical(appearance) : "default";

            // Global 3D-preview heel lift (metres) — derived client-side from
            // the feet item's high-heels flag, raises the WHOLE scene. hairScale
            // is per-item (read in the loop). Absent => 0 => byte-identical.
            var heelLift = NormalizeHeelLift(request?.HeelLift);

            // Read all files + build the content-hash cache key in one pass.
            var builderItems = new List<GlbBuilder.OutfitItem>(items.Count);
            var keyParts = new List<string>(items.Count);
            foreach (var item in items)
            {
                var yddRead = TryReadAssetFile(item?.YddPath, ".ydd", log, out var yddBytes);
                if (yddRead != null) return yddRead;

                byte[]? ytdBytes = null;
                var ytdPaths = item?.YtdPaths;
                if (ytdPaths is { Count: > 0 })
                {
                    var textureIndex = Math.Clamp(item?.TextureIndex ?? 0, 0, ytdPaths.Count - 1);
                    var ytdRead = TryReadAssetFile(ytdPaths[textureIndex], ".ytd", log, out var selectedYtdBytes);
                    if (ytdRead != null) return ytdRead;
                    ytdBytes = selectedYtdBytes;
                }

                var covers = CoversComponentIndex(item?.Slot?.Trim().ToLowerInvariant());
                // Per-item hair shrink (only the hair/p_head item carries it).
                var itemHairScale = NormalizeHairScale(item?.HairScale);
                builderItems.Add(new GlbBuilder.OutfitItem(yddBytes, ytdBytes, covers, itemHairScale));
                // Item key string mirrors the client outfitCacheKey part format:
                // the per-item hair suffix ":h<F2>" is appended only when set,
                // so an item without it keys exactly as before the contract.
                var hairKeyPart = itemHairScale is double h ? ":h" + PedAppearanceKey.FmtScale((float)h) : string.Empty;
                keyParts.Add($"{Sha256Hex(yddBytes)}:{(ytdBytes != null ? Sha256Hex(ytdBytes) : "none")}:{covers?.ToString(CultureInfo.InvariantCulture) ?? "p"}{hairKeyPart}");
            }

            // Global heel lift goes in the key Extra (NOT per item) — empty when
            // off, so an outfit without heels keys byte-identically to before.
            var extra = PreviewExtraKey(null, heelLift);

            var cacheKey = new PreviewGlbCache.Key(
                Sha256Hex(System.Text.Encoding.UTF8.GetBytes(string.Join("|", keyParts))),
                "outfit",
                includePedBody,
                includePedBody || pose != null || anim != null ? pedModel : string.Empty,
                anim != null ? "anim:" + anim : pose ?? "none",
                appearanceKey,
                extra);
            if (PreviewGlbCache.TryGet(cacheKey, out var cached, out var cachedFallbacks))
                return GlbResponse(ctx, cached, cachedFallbacks);

            var poseLoad = TryLoadPose(poseEngine, state, pedModel, pose, log, out var poseData);
            if (poseLoad != null) return poseLoad;

            var animLoad = TryLoadAnimation(poseEngine, state, pedModel, anim, log, out var animData);
            if (animLoad != null) return animLoad;

            IReadOnlyList<PedBodyService.PedComponent>? pedComponents = null;
            string? appearanceFallbacks = null;
            var cacheable = true;
            if (includePedBody)
            {
                try
                {
                    var loaded = pedBody.LoadComponents(state.GtaPath!, pedModel, appearance);
                    pedComponents = loaded.Components;
                    if (loaded.FallbackSlots.Count > 0)
                        appearanceFallbacks = string.Join(",", loaded.FallbackSlots);
                    // Same poisoning guard as /preview/glb: transient load
                    // timeouts keep the degraded GLB out of the cache.
                    cacheable = !loaded.HadTransientLoadFailure;
                }
                catch (Exception ex)
                {
                    log.LogError(ex, "Ped body load failed for {PedModel}", pedModel);
                    return PedBodyUnavailable();
                }
            }

            GlbBuilder.Result result;
            try
            {
                result = GlbBuilder.BuildOutfit(builderItems, pedComponents, log, poseData, (float)heelLift, animation: animData);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Outfit preview build failed");
                return Results.BadRequest(new ErrorResponse(
                    $"Outfit-Vorschau konnte nicht erstellt werden: {ex.Message}"));
            }

            if (cacheable)
                PreviewGlbCache.Put(cacheKey, result, appearanceFallbacks);
            else
                log.LogWarning("Outfit GLB not cached (transient component load failure) for appearance={Appearance}", appearanceKey);
            log.LogInformation("Outfit GLB built: {Items} items, {Bytes} bytes, {Vertices} vertices, ped={Ped}, pose={Pose}, appearance={Appearance}",
                builderItems.Count, result.Glb.Length, result.VertexCount, includePedBody ? pedModel : "none", pose ?? "none", appearanceKey);
            return GlbResponse(ctx, result, appearanceFallbacks, transientDegraded: !cacheable);
        });
    }

    private static IResult GlbResponse(HttpContext ctx, GlbBuilder.Result result, string? appearanceFallbacks = null, bool transientDegraded = false)
    {
        ctx.Response.Headers["X-FG-Vertex-Count"] = result.VertexCount.ToString(CultureInfo.InvariantCulture);
        ctx.Response.Headers["X-FG-Poly-Count"] = result.PolyCount.ToString(CultureInfo.InvariantCulture);
        // Comma-separated slot names that fell back to the ped default
        // (unresolvable DLC/out-of-range indices) — only set when non-empty.
        if (!string.IsNullOrEmpty(appearanceFallbacks))
            ctx.Response.Headers["X-FG-Appearance-Fallbacks"] = appearanceFallbacks;
        // Mirrors the server-side cache skip on transient component-load
        // failures: tells the client not to freeze this GLB in ITS cache either.
        if (transientDegraded)
            ctx.Response.Headers["X-FG-Transient-Degraded"] = "1";
        return Results.Bytes(result.Glb, GlbContentType);
    }

    private static IResult PedBodyUnavailable() =>
        Results.Json(new ErrorResponse("ped_body_unavailable"), statusCode: StatusCodes.Status422UnprocessableEntity);

    /// <summary>Contract shape: { "error": "pose_unavailable", "pose": "<id>" } with 422.</summary>
    private static IResult PoseUnavailable(string pose) =>
        Results.Json(new { error = "pose_unavailable", pose }, statusCode: StatusCodes.Status422UnprocessableEntity);

    /// <summary>Validates + reads one asset path; returns a 400 IResult on failure, null on success.</summary>
    private static IResult? TryReadAssetFile(string? rawPath, string expectedExtension, ILogger log, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();

        if (string.IsNullOrWhiteSpace(rawPath))
            return Results.BadRequest(new ErrorResponse(
                expectedExtension == ".ydd" ? "Feld 'yddPath' fehlt." : "Feld 'ytdPaths' enthält einen leeren Pfad."));

        var path = rawPath.Trim();
        if (!Path.GetExtension(path).Equals(expectedExtension, StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new ErrorResponse($"Erwartet wird eine {expectedExtension}-Datei: {path}"));

        if (!File.Exists(path))
            return Results.BadRequest(new ErrorResponse($"Datei nicht gefunden: {path}"));

        try
        {
            bytes = File.ReadAllBytes(path);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to read {Path}", path);
            return Results.BadRequest(new ErrorResponse($"Datei konnte nicht gelesen werden: {ex.Message}"));
        }

        if (bytes.Length == 0)
            return Results.BadRequest(new ErrorResponse($"Datei ist leer: {path}"));

        return null;
    }

    private static string Sha256Hex(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
