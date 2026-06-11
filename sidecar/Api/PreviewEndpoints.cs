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

            // Content-hash cache key (file BYTES, not paths) so the client can
            // cache by the same key and renames/copies still hit server-side.
            var cacheKey = new PreviewGlbCache.Key(
                Sha256Hex(yddBytes),
                ytdBytes != null ? Sha256Hex(ytdBytes) : "none",
                includePedBody,
                includePedBody || pose != null ? pedModel : string.Empty,
                pose ?? "none");
            if (PreviewGlbCache.TryGet(cacheKey, out var cached))
                return GlbResponse(ctx, cached);

            var poseLoad = TryLoadPose(poseEngine, state, pedModel, pose, log, out var poseData);
            if (poseLoad != null) return poseLoad;

            IReadOnlyList<PedBodyService.PedComponent>? pedComponents = null;
            if (includePedBody)
            {
                try
                {
                    pedComponents = pedBody.LoadDefaultComponents(state.GtaPath!, pedModel);
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
                result = GlbBuilder.Build(yddBytes, ytdBytes, pedComponents, log, poseData);
            }
            catch (Exception ex)
            {
                // CodeWalker throws on garbage/non-RSC7 input - report as client error.
                log.LogError(ex, "Preview build failed for {Path}", request?.YddPath);
                return Results.BadRequest(new ErrorResponse(
                    $"Vorschau konnte nicht erstellt werden: {ex.Message}"));
            }

            PreviewGlbCache.Put(cacheKey, result);
            log.LogInformation("Preview GLB built: {Bytes} bytes, {Vertices} vertices, {Polys} polys, ped={Ped}, pose={Pose}",
                result.Glb.Length, result.VertexCount, result.PolyCount, includePedBody ? pedModel : "none", pose ?? "none");
            return GlbResponse(ctx, result);
        });

        // GET /preview/poses -> the static pose list (id + German label) so
        // the frontend stays in sync with the sidecar catalog.
        app.MapGet("/preview/poses", () => Results.Ok(new PosesResponse(
            PoseCatalog.Poses.Select(p => new PoseInfo(p.Id, p.Label)).ToList())));

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

    /// <summary>Maps an outfit-item slot to the ped component it replaces (props cover nothing).</summary>
    private static int? CoversComponentIndex(string? slot) =>
        slot != null && Engine.Build.GtaSlots.ComponentIds.TryGetValue(slot, out var id) ? id : null;

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
                builderItems.Add(new GlbBuilder.OutfitItem(yddBytes, ytdBytes, covers));
                keyParts.Add($"{Sha256Hex(yddBytes)}:{(ytdBytes != null ? Sha256Hex(ytdBytes) : "none")}:{covers?.ToString(CultureInfo.InvariantCulture) ?? "p"}");
            }

            var cacheKey = new PreviewGlbCache.Key(
                Sha256Hex(System.Text.Encoding.UTF8.GetBytes(string.Join("|", keyParts))),
                "outfit",
                includePedBody,
                includePedBody || pose != null ? pedModel : string.Empty,
                pose ?? "none");
            if (PreviewGlbCache.TryGet(cacheKey, out var cached))
                return GlbResponse(ctx, cached);

            var poseLoad = TryLoadPose(poseEngine, state, pedModel, pose, log, out var poseData);
            if (poseLoad != null) return poseLoad;

            IReadOnlyList<PedBodyService.PedComponent>? pedComponents = null;
            if (includePedBody)
            {
                try
                {
                    pedComponents = pedBody.LoadDefaultComponents(state.GtaPath!, pedModel);
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
                result = GlbBuilder.BuildOutfit(builderItems, pedComponents, log, poseData);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Outfit preview build failed");
                return Results.BadRequest(new ErrorResponse(
                    $"Outfit-Vorschau konnte nicht erstellt werden: {ex.Message}"));
            }

            PreviewGlbCache.Put(cacheKey, result);
            log.LogInformation("Outfit GLB built: {Items} items, {Bytes} bytes, {Vertices} vertices, ped={Ped}, pose={Pose}",
                builderItems.Count, result.Glb.Length, result.VertexCount, includePedBody ? pedModel : "none", pose ?? "none");
            return GlbResponse(ctx, result);
        });
    }

    private static IResult GlbResponse(HttpContext ctx, GlbBuilder.Result result)
    {
        ctx.Response.Headers["X-FG-Vertex-Count"] = result.VertexCount.ToString(CultureInfo.InvariantCulture);
        ctx.Response.Headers["X-FG-Poly-Count"] = result.PolyCount.ToString(CultureInfo.InvariantCulture);
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
