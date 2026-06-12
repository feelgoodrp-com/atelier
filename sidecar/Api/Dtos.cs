using System.Text.Json.Serialization;

namespace Feelgood.Atelier.Sidecar.Api;

/// <summary>Uniform error shape: serialized as { "error": "message" }.</summary>
public sealed record ErrorResponse(string Error);

public sealed record HealthResponse(bool Ok, string Version);

public sealed record InfoResponse(string Version, bool GtaPathReady, string? GtaPath, bool CodewalkerLoaded, bool PedBodyPrewarmed);

public sealed record ConfigRequest(string? GtaPath);

public sealed record ConfigResponse(bool Ok, string? GtaPath, bool GtaPathReady);

public sealed record ParseRequest(string? Path);

/// <summary>
/// One garment of an outfit preview (POST /preview/outfit-glb). HairScale is
/// the PER-ITEM 3D-preview hair shrink (0..1, null/absent = off) — only the
/// hair/p_head item carries it; the whole item mesh is uniformly scaled. See
/// the contract on <see cref="PreviewGlbRequest.HairScale"/> for the semantics.
/// </summary>
public sealed record OutfitItemRequest(string? YddPath, List<string>? YtdPaths, int? TextureIndex, string? Slot, double? HairScale);

/// <summary>
/// POST /preview/outfit-glb — several garments on ONE ped at once. Pose: see
/// GET /preview/poses (null = bind pose). HeelLift is the GLOBAL vertical
/// scene lift in metres (Y-up, null/absent = 0) derived from the feet item's
/// high-heels flag — it raises the WHOLE scene (ped body + all garments), not
/// a single item (hairScale is the garment-local one). See the contract on
/// <see cref="PreviewGlbRequest.HeelLift"/>.
/// </summary>
public sealed record PreviewOutfitRequest(List<OutfitItemRequest>? Items, string? PedModel, bool? IncludePedBody, string? Pose, PedAppearanceDto? Appearance, double? HeelLift);

/// <summary>
/// One ped component variation override. Dictionary keys follow
/// GtaSlots.ComponentIds ("head".."jbib"). Alt is the drawable alternative
/// (optional, defaults to 0 — Menyoo exports do not carry one).
/// </summary>
public sealed record PedAppearanceComponentDto(int Drawable, int Texture, int? Alt);

/// <summary>
/// One ped prop. Anchor keys follow GtaSlots.PropAnchorIds ("p_head", ...).
/// Stage 1: validated but NOT rendered yet (prop anchoring lands in stage 2a).
/// </summary>
public sealed record PedAppearancePropDto(string? Anchor, int Drawable, int Texture);

/// <summary>
/// One head-overlay layer of the face block (eyebrows, beard, makeup, ...).
/// Slot follows the SetPedHeadOverlay slot index (0..12); only head slots
/// 0..9 are rendered (body slots 10..12 are honestly excluded in stage 2).
/// Index 255 (or absent) means "overlay off". Colour/colourSecondary are
/// palette indices (hair palette for brow/beard/chest hair, makeup palette
/// for makeup/blush/lipstick) — null when the layer is untintable / no tint.
/// </summary>
public sealed record PedFaceOverlayDto(
    int Slot,
    int? Index,
    float? Opacity,
    int? Colour,
    int? ColourSecondary);

/// <summary>
/// Optional face block of an appearance: HeadBlend shape + skin tone (parent
/// indices 0..45 + blend mixes 0..1), head overlays, and the eye-colour atlas
/// tile (0..31). Mirrors the Menyoo HeadBlend/Overlays/EyeColour data; all
/// numeric fields are CLAMPED into range (never a 400) by the endpoint and
/// only take effect when the ped body is rendered (same gating as components).
/// FaceFeatures are intentionally NOT part of this DTO — they are engine
/// micro-morphs without assets and are honestly excluded from rendering.
/// </summary>
public sealed record PedFaceDto(
    int ShapeFirst,
    int ShapeSecond,
    int ShapeThird,
    float ShapeMix,
    float ThirdMix,
    int SkinFirst,
    int SkinSecond,
    int SkinThird,
    float SkinMix,
    List<PedFaceOverlayDto>? Overlays,
    int? EyeColour);

/// <summary>
/// Optional ped appearance for POST /preview/glb and /preview/outfit-glb.
/// Only changes the output when the ped body is rendered (includePedBody);
/// unlisted slots keep the ped defaults. Unresolvable drawable indices (DLC)
/// fall back to the slot default and are reported via the
/// X-FG-Appearance-Fallbacks response header. The optional <see cref="Face"/>
/// block re-composites the head/uppr/lowr/feet diffuse (HeadBlend skin tone +
/// overlays + eye colour) — same render gating as Components.
/// </summary>
public sealed record PedAppearanceDto(
    Dictionary<string, PedAppearanceComponentDto>? Components,
    List<PedAppearancePropDto>? Props,
    PedFaceDto? Face = null);

/// <summary>
/// Canonical appearance cache-key string — MUST stay byte-identical with the
/// client implementation (atelier/src: appearanceKey): component entries that
/// are EXACTLY the ped default (drawable=0, texture=0, alt 0/absent) are
/// skipped, the rest is sorted alphabetically as "slot=drawable:texture"
/// (":a&lt;alt&gt;" appended only when alt != 0), joined with ",", then "|", then
/// props sorted alphabetically as "anchor=drawable:texture" joined with ",";
/// null/empty appearance — INCLUDING one where every component was skipped
/// and no props remain — maps to "default".
/// Example: "hair=2:1,jbib=5:0|p_head=1:0".
///
/// When a face block is present a THIRD segment is appended after the props
/// (separated by "|"):
///   "f=&lt;shapeFirst&gt;:&lt;shapeSecond&gt;:&lt;shapeThird&gt;:&lt;shapeMix F2&gt;:&lt;thirdMix F2&gt;,
///    k=&lt;skinFirst&gt;:&lt;skinSecond&gt;:&lt;skinThird&gt;:&lt;skinMix F2&gt;,
///    o&lt;slot&gt;=&lt;index&gt;:&lt;opacity F2&gt;:&lt;colour|-&gt;:&lt;colourSecondary|-&gt;  (per active overlay,
///        ascending by slot, only index != 255),
///    e=&lt;eyeColour|-&gt;"
/// joined with ",". F2 = invariant "0.00" format. A missing face block omits
/// the segment entirely — keys produced before the face contract stay valid.
/// Example with face: "...|p_head=1:0|f=0:0:0:0.00:0.00,k=3:3:0:0.50,o2=4:0.85:1:-,e=2".
/// </summary>
public static class PedAppearanceKey
{
    /// <summary>Overlay index sentinel for "layer off" — never written to the key.</summary>
    public const int OverlayOff = 255;

    /// <summary>
    /// Public re-use of the invariant 2-decimal quantizer for the 3D-preview
    /// hair/heel cache key (PreviewEndpoints). Same byte-identical "0.00"..
    /// "1.00" output as the face mixes — keeping it here means there is ONE
    /// quantizer on the C# side, matching the single client-side f2.
    /// </summary>
    public static string FmtScale(float value) => F2(value);

    public static string Canonical(PedAppearanceDto? appearance)
    {
        // All-default normalization (shared contract): drawable=0/texture=0/
        // alt=0 IS the ped default, so it must not create a distinct key.
        var componentParts = (appearance?.Components ?? Enumerable.Empty<KeyValuePair<string, PedAppearanceComponentDto>>())
            .Where(kv => kv.Value.Drawable != 0 || kv.Value.Texture != 0 || (kv.Value.Alt ?? 0) != 0)
            .Select(kv => string.Create(System.Globalization.CultureInfo.InvariantCulture,
                $"{kv.Key}={kv.Value.Drawable}:{kv.Value.Texture}{((kv.Value.Alt ?? 0) != 0 ? $":a{kv.Value.Alt}" : string.Empty)}"))
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();
        var propParts = (appearance?.Props ?? Enumerable.Empty<PedAppearancePropDto>())
            .Select(p => string.Create(System.Globalization.CultureInfo.InvariantCulture,
                $"{p.Anchor}={p.Drawable}:{p.Texture}"))
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();

        var faceSegment = FaceSegment(appearance?.Face);
        if (componentParts.Count == 0 && propParts.Count == 0 && faceSegment == null) return "default";
        var key = string.Join(",", componentParts) + "|" + string.Join(",", propParts);
        if (faceSegment != null) key += "|" + faceSegment;
        return key;
    }

    /// <summary>
    /// Builds the "f=...,k=...,o&lt;slot&gt;=...,e=..." segment for a face block, or
    /// null when there is no face. Numbers use the invariant "0.00" format so
    /// the C# and TypeScript keys stay byte-identical.
    /// </summary>
    private static string? FaceSegment(PedFaceDto? face)
    {
        if (face == null) return null;
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        var parts = new List<string>(4 + (face.Overlays?.Count ?? 0))
        {
            string.Create(ci, $"f={face.ShapeFirst}:{face.ShapeSecond}:{face.ShapeThird}:{F2(face.ShapeMix)}:{F2(face.ThirdMix)}"),
            string.Create(ci, $"k={face.SkinFirst}:{face.SkinSecond}:{face.SkinThird}:{F2(face.SkinMix)}"),
        };

        var overlays = (face.Overlays ?? Enumerable.Empty<PedFaceOverlayDto>())
            .Where(o => (o.Index ?? OverlayOff) != OverlayOff)
            .OrderBy(o => o.Slot)
            .Select(o => string.Create(ci,
                $"o{o.Slot}={o.Index ?? OverlayOff}:{F2(o.Opacity ?? 1f)}:{ColourPart(o.Colour)}:{ColourPart(o.ColourSecondary)}"));
        parts.AddRange(overlays);

        parts.Add($"e={ColourPart(face.EyeColour)}");
        return string.Join(",", parts);
    }

    /// <summary>"-" for an absent palette index, the value otherwise (invariant).</summary>
    private static string ColourPart(int? colour) =>
        colour.HasValue ? colour.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : "-";

    /// <summary>
    /// Invariant 2-decimal format — byte-identical with the client (f2 in
    /// atelier/src/lib/preview/appearance.ts). We DELIBERATELY avoid
    /// float.ToString("0.00") / JS toFixed(2): those round a 32-bit float resp.
    /// a 64-bit double and diverge at .xx5 half-steps (48 values across
    /// 0.000..1.000). BOTH sides instead quantize to whole hundredths first
    /// (round-half-away-from-zero on a non-negative value) and build the string
    /// from the integer, so no float formatter is left to disagree.
    ///   n = round(clamp(v,0,1)*100) in 0..100 -> "&lt;n/100&gt;.&lt;two digits of n%100&gt;"
    /// Examples: 0.005f -> "0.01", 0.50f -> "0.50", 1f -> "1.00".
    /// </summary>
    private static string F2(float value)
    {
        // Callers clamp to [0,1]; clamp defensively so a stray -0 or tiny
        // overshoot can never escape the 0..100 integer range.
        var v = value > 0f ? (value < 1f ? value : 1f) : 0f;
        var n = (int)Math.Round(v * 100f, MidpointRounding.AwayFromZero); // 0..100
        var whole = n / 100; // 0 or 1
        var frac = n % 100;  // 0..99
        return string.Create(System.Globalization.CultureInfo.InvariantCulture,
            $"{whole}.{frac:00}");
    }
}

/// <summary>One selectable preview pose (GET /preview/poses).</summary>
public sealed record PoseInfo(string Id, string Label);

public sealed record PosesResponse(IReadOnlyList<PoseInfo> Poses);

/// <summary>Optional thumbnail rendering for /parse/ytd (longest edge &lt;= MaxSize).</summary>
public sealed record ThumbnailsOptions(int? MaxSize);

public sealed record YtdParseRequest(string? Path, ThumbnailsOptions? Thumbnails);

/// <summary>Which LOD levels of a drawable contain geometry.</summary>
public sealed record LodFlags(bool High, bool Med, bool Low);

/// <summary>
/// Per-drawable mesh stats. Vertex/poly counts are taken from the highest
/// LOD level that contains geometry (High, then Med, Low, VLow).
/// </summary>
public sealed record DrawableInfo(
    string Name,
    int GeometryCount,
    int VertexCount,
    int PolyCount,
    LodFlags Lods);

public sealed record YddParseResponse(
    string FileName,
    long SizeBytes,
    string Sha256,
    IReadOnlyList<DrawableInfo> Drawables);

public sealed record TextureInfo(
    string Name,
    int Width,
    int Height,
    int MipCount,
    string Format,
    bool IsPowerOfTwo,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ThumbnailPngBase64 = null);

public sealed record YtdParseResponse(
    string FileName,
    long SizeBytes,
    string Sha256,
    IReadOnlyList<TextureInfo> Textures);

/// <summary>
/// POST /preview/glb. YtdPaths are the texture variants in letter order
/// (a, b, c, ...); TextureIndex picks which one to embed (default 0, clamped
/// into range). IncludePedBody requires a configured gtaPath (else 422).
/// Pose (optional, see GET /preview/poses) bakes a static pose into the mesh
/// and also requires a configured gtaPath; null = bind pose.
///
/// HairScale + HeelLift are the 3D-preview-only hair/heel effects (no build
/// impact). Both are OPTIONAL and ABSENT/null means "today's behaviour" — the
/// GLB bytes are then bit-identical to before the contract. The client only
/// writes them when active.
///   HairScale: 0..1 uniform hair shrink. Only meaningful when this single ydd
///     IS a hair/p_head drawable (the client sends it only then); since the
///     single endpoint carries no slot, it applies to the WHOLE ydd.
///   HeelLift: metres (glTF-up = Y) the WHOLE scene is raised. Single mode only
///     sets it when this drawable is a feet item with high heels.
/// See <see cref="Feelgood.Atelier.Sidecar.Engine.GlbBuilder"/> for the exact
/// transform semantics.
/// </summary>
public sealed record PreviewGlbRequest(
    string? YddPath,
    IReadOnlyList<string>? YtdPaths,
    int? TextureIndex,
    string? PedModel,
    bool? IncludePedBody,
    string? Pose,
    PedAppearanceDto? Appearance,
    double? HairScale,
    double? HeelLift);

public sealed record ImportScanRequest(string? FolderPath);

/// <summary>One texture candidate for a drawable; Letter is the GTA texture variant (a..z).</summary>
public sealed record ImportScanTexture(string Path, string Letter);

/// <summary>
/// One import candidate, anchored at a .ydd file. All "guessed*" fields are
/// derived from naming conventions (or pack-metadata.json) and may be null.
/// </summary>
public sealed record ImportScanEntry(
    string YddPath,
    string? GuessedGender,
    string? GuessedKind,
    string? GuessedType,
    int? GuessedDrawableId,
    IReadOnlyList<ImportScanTexture> Textures,
    string? YldPath,
    string Confidence);

public sealed record ImportScanResponse(
    IReadOnlyList<ImportScanEntry> Entries,
    IReadOnlyList<string> Warnings);
