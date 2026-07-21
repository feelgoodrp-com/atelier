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
    List<ProjectDrawableDto>? Drawables,
    // fgcloth v2 additions (optional so v1 senders still bind):
    List<ProjectTattooDto>? Tattoos = null,
    TattooCollectionDto? TattooCollection = null,
    // Authoring-only grouping (mirrors AtelierProject.groups in schema.ts). Has
    // NO effect on any built asset; it exists so the opt-in viewer manifest can
    // name the group a drawable belongs to.
    List<ProjectGroupDto>? Groups = null);

public sealed record ProjectSettingsDto(string? DlcName, string? DefaultGender);

/// <summary>Authoring group — C# mirror of ProjectGroup (schema.ts).</summary>
public sealed record ProjectGroupDto(string? Id, string? Name, string? Color);

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

/// <summary>Tattoo (ped decoration) — C# mirror of ProjectTattoo (schema.ts v2).</summary>
public sealed record ProjectTattooDto(
    string? Id,
    string? Label,
    string? GroupId,
    string? Zone,
    string? Type,
    string? Gender,
    string? NameMale,
    string? NameFemale,
    AssetRefDto? Image,
    string? Garment,
    string? TextLabel,
    string? EFacing,
    int Cost,
    TattooPlacementDto? Placement);

public sealed record TattooPlacementDto(
    double UvPosX, double UvPosY, double ScaleX, double ScaleY, double Rotation);

public sealed record TattooCollectionDto(string? Name, string? Label);

/// <summary>
/// Authorable tattoo zones — byte-identical to atelier/src/lib/gta/tattoos.ts
/// (TATTOO_ZONES). zone id → numeric enum, overlay <zone> name, shop PDZ_* name
/// and the default shop eFacing. Only the six body zones are authorable.
/// </summary>
public sealed record TattooZoneDef(
    string Id, int ZoneValue, string OverlayName, string ShopZone, string DefaultFacing);

public static class TattooZones
{
    public static readonly TattooZoneDef[] All =
    {
        new("torso", 0, "ZONE_TORSO", "PDZ_TORSO", "TATTOO_CHEST"),
        new("head", 1, "ZONE_HEAD", "PDZ_HEAD", "TATTOO_FRONT"),
        new("left_arm", 2, "ZONE_LEFT_ARM", "PDZ_LEFT_ARM", "TATTOO_LEFT"),
        new("right_arm", 3, "ZONE_RIGHT_ARM", "PDZ_RIGHT_ARM", "TATTOO_RIGHT"),
        new("left_leg", 4, "ZONE_LEFT_LEG", "PDZ_LEFT_LEG", "TATTOO_LEFT"),
        new("right_leg", 5, "ZONE_RIGHT_LEG", "PDZ_RIGHT_LEG", "TATTOO_RIGHT"),
    };

    public static TattooZoneDef? ById(string? id) =>
        id == null ? null : Array.Find(All, z => z.Id == id);

    public static string OverlayType(string? type) =>
        type == "badge" ? "TYPE_BADGE" : "TYPE_TATTOO";
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
