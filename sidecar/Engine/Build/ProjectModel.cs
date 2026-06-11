namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// C# mirror of the `pack.atelier` project file (fgcloth v1, see
/// atelier/src/lib/project/schema.ts). Only build-relevant fields are mapped;
/// unknown JSON properties are ignored by the (case-insensitive) binder.
/// </summary>
public sealed record AtelierProjectDto(
    int Fgcloth,
    string? Id,
    string? Name,
    ProjectSettingsDto? Settings,
    List<ProjectDrawableDto>? Drawables);

public sealed record ProjectSettingsDto(string? DlcName, string? DefaultGender);

/// <summary>Relative (forward-slash) file reference inside the project folder.</summary>
public sealed record AssetRefDto(string? Path, string? Hash, long Size);

public sealed record DrawableFlagsDto(bool HighHeels, double? HairScaleValue);

public sealed record ProjectDrawableDto(
    string? Id,
    string? Gender,
    string? Kind,
    string? Type,
    string? Mode,
    int? ReplaceTargetId,
    string? Label,
    string? GroupId,
    AssetRefDto? Ydd,
    List<AssetRefDto>? Textures,
    AssetRefDto? Physics,
    AssetRefDto? FirstPerson,
    DrawableFlagsDto? Flags)
{
    public bool IsProp => Kind == "prop";
    public bool IsReplace => Mode == "replace";
    public string DisplayLabel => string.IsNullOrWhiteSpace(Label) ? (Type ?? "?") : Label!;
}

/// <summary>
/// Slot tables shared by planner/validator: internal slot id (pack.atelier
/// "type") to native componentId / prop anchor id. Mirrors
/// atelier/src/lib/gta/components.ts.
/// </summary>
public static class GtaSlots
{
    public static readonly IReadOnlyDictionary<string, int> ComponentIds = new Dictionary<string, int>
    {
        ["head"] = 0, ["berd"] = 1, ["hair"] = 2, ["uppr"] = 3, ["lowr"] = 4, ["hand"] = 5,
        ["feet"] = 6, ["teef"] = 7, ["accs"] = 8, ["task"] = 9, ["decl"] = 10, ["jbib"] = 11,
    };

    public static readonly IReadOnlyDictionary<string, int> PropAnchorIds = new Dictionary<string, int>
    {
        ["p_head"] = 0, ["p_eyes"] = 1, ["p_ears"] = 2, ["p_lwrist"] = 6, ["p_rwrist"] = 7, ["p_hip"] = 8,
    };

    /// <summary>PV_COMP_* native name by componentId (shop meta eCompType).</summary>
    public static readonly string[] CompNativeNames =
    {
        "PV_COMP_HEAD", "PV_COMP_BERD", "PV_COMP_HAIR", "PV_COMP_UPPR", "PV_COMP_LOWR", "PV_COMP_HAND",
        "PV_COMP_FEET", "PV_COMP_TEEF", "PV_COMP_ACCS", "PV_COMP_TASK", "PV_COMP_DECL", "PV_COMP_JBIB",
    };

    public static bool IsValidSlot(ProjectDrawableDto drawable) =>
        drawable.IsProp
            ? drawable.Type != null && PropAnchorIds.ContainsKey(drawable.Type)
            : drawable.Type != null && ComponentIds.ContainsKey(drawable.Type);

    public static string PedName(string gender) =>
        gender == "female" ? "mp_f_freemode_01" : "mp_m_freemode_01";

    public static string GenderLetter(string gender) => gender == "female" ? "f" : "m";
}
