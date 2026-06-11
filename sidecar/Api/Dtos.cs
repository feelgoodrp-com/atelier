using System.Text.Json.Serialization;

namespace Feelgood.Atelier.Sidecar.Api;

/// <summary>Uniform error shape: serialized as { "error": "message" }.</summary>
public sealed record ErrorResponse(string Error);

public sealed record HealthResponse(bool Ok, string Version);

public sealed record InfoResponse(string Version, bool GtaPathReady, string? GtaPath, bool CodewalkerLoaded, bool PedBodyPrewarmed);

public sealed record ConfigRequest(string? GtaPath);

public sealed record ConfigResponse(bool Ok, string? GtaPath, bool GtaPathReady);

public sealed record ParseRequest(string? Path);

/// <summary>One garment of an outfit preview (POST /preview/outfit-glb).</summary>
public sealed record OutfitItemRequest(string? YddPath, List<string>? YtdPaths, int? TextureIndex, string? Slot);

/// <summary>POST /preview/outfit-glb — several garments on ONE ped at once. Pose: see GET /preview/poses (null = bind pose).</summary>
public sealed record PreviewOutfitRequest(List<OutfitItemRequest>? Items, string? PedModel, bool? IncludePedBody, string? Pose);

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
/// </summary>
public sealed record PreviewGlbRequest(
    string? YddPath,
    IReadOnlyList<string>? YtdPaths,
    int? TextureIndex,
    string? PedModel,
    bool? IncludePedBody,
    string? Pose);

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
