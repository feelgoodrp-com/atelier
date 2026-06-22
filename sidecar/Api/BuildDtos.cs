using Feelgood.Atelier.Sidecar.Engine.Build;

namespace Feelgood.Atelier.Sidecar.Api;

public sealed record ValidateRequest(string? ProjectDir, AtelierProjectDto? Project);

public sealed record ValidateResponse(IReadOnlyList<Finding> Findings);

public sealed record BuildRequestOptions(
    string? DlcName,
    string? ResourceName,
    bool? GenerateShopMeta,
    int? SplitAt,
    bool? GenerateTattooShopMeta);

public sealed record BuildRequest(
    string? ProjectDir,
    AtelierProjectDto? Project,
    string? Target,
    string? OutDir,
    BuildRequestOptions? Options);

public sealed record TextureOptimizeRequest(
    string? YtdPath,
    string? OutPath,
    int? MaxDimension,
    string? Format,
    bool? RegenerateMips);

/// <summary>Debug helper: round-trip inspect a generated .ymt / dlc.rpf.</summary>
public sealed record DebugPathRequest(string? Path);
