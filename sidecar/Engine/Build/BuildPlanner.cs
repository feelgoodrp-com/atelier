namespace Feelgood.Atelier.Sidecar.Engine.Build;

// ---------------------------------------------------------------------------
// Plan types (pure data, no IO)
// ---------------------------------------------------------------------------

/// <summary>Normalized build options with all defaults applied.</summary>
public sealed record BuildOptions(
    string Target,            // fivem | singleplayer | ragemp | altv
    string DlcName,
    string ResourceName,
    bool GenerateShopMeta,
    int SplitAt,
    bool GenerateTattooShopMeta = false,
    // Writes atelier-pack.json (labels + groups) per part — FiveM only, opt-in.
    // Purely additive: no other output file changes when it is on.
    bool GenerateViewerManifest = false);

public enum PlanFileKind { Ydd, Ytd, Yld, FirstPersonYdd }

/// <summary>
/// One file copy: project-relative source resolved to an absolute path plus the
/// canonical FiveM stream name and the short name used INSIDE rpf gender
/// folders (singleplayer / alt:V layouts).
/// </summary>
public sealed record PlanFile(
    string SourcePath,
    string StreamName,
    string InnerName,
    string Gender,
    bool IsProp,
    bool IsReplace,
    PlanFileKind Kind);

/// <summary>
/// Component drawable as it appears in one part's YMT.
///
/// The trailing three members are AUTHORING metadata (label, group, replace
/// target). The YMT generator ignores them; they exist so the opt-in viewer
/// manifest can be written from the same plan.
/// </summary>
public sealed record PlanComponent(
    string DrawableUuid,
    int SlotId,
    string SlotName,
    int LocalIndex,
    int TextureCount,
    bool OwnsCloth,
    bool HasFirstPerson,
    bool HighHeels,
    string Label = "",
    string? GroupId = null,
    int? ReplaceTargetId = null);

/// <summary>
/// Prop drawable as it appears in one part's YMT prop section. Same authoring
/// metadata tail as <see cref="PlanComponent"/>.
/// </summary>
public sealed record PlanProp(
    string DrawableUuid,
    int AnchorId,
    string SlotName,
    int LocalIndex,
    int TextureCount,
    double? HairScaleValue,
    string Label = "",
    string? GroupId = null,
    int? ReplaceTargetId = null);

/// <summary>
/// Everything the YMT generator needs for one (part, gender): the per-slot
/// component drawables and the prop metadata, with derived local indices.
/// </summary>
public sealed class BuildPlanGender
{
    public required string Gender { get; init; }        // male | female
    public required string PedName { get; init; }       // mp_m_freemode_01 / mp_f_freemode_01
    public required string GenderLetter { get; init; }  // m | f
    public required string DlcName { get; init; }       // per-part dlc name
    /// <summary>Flat, ordered by (slotId asc, localIndex asc).</summary>
    public required List<PlanComponent> Components { get; init; }
    /// <summary>Flat, ordered by (anchorId asc, localIndex asc).</summary>
    public required List<PlanProp> Props { get; init; }

    public bool HasAnything => Components.Count > 0 || Props.Count > 0;
}

/// <summary>One output resource folder (<c>name</c> or <c>name_partN</c>).</summary>
public sealed class BuildPart
{
    public required string FolderName { get; init; }
    public required string DlcName { get; init; }
    /// <summary>Per-gender YMT inputs; only genders that have addon drawables.</summary>
    public required List<BuildPlanGender> Genders { get; init; }
    /// <summary>
    /// Replace-mode drawables of this part, in the same per-gender shape — but
    /// NEVER YMT input (planner rule 5). LocalIndex is the replaceTargetId and
    /// DlcName is empty, because a replace file overrides a base-game asset.
    /// Only the viewer manifest reads this; no builder touches it.
    /// </summary>
    public required List<BuildPlanGender> ReplaceGenders { get; init; }
    public required List<PlanFile> Files { get; init; }
    /// <summary>Addon drawables in this part (YMT entries across genders).</summary>
    public required int AddonDrawableCount { get; init; }
    /// <summary>Replace-mode drawables emitted into this part (fivem only).</summary>
    public required int ReplaceDrawableCount { get; init; }

    public int DrawableCount => AddonDrawableCount + ReplaceDrawableCount;
}

/// <summary>
/// One tattoo overlay as it will be built. The YTD file name IS txdHash IS
/// txtHash (hard engine rule). Index is the GLOBAL position in project.tattoos
/// (matches selectDerivedTattooBuild on the TS side exactly).
/// </summary>
public sealed record TattooPlanItem(
    int Index,
    string YtdName,
    string SourceImagePath,
    string ZoneOverlay,
    string ZoneShop,
    string EFacing,
    string OverlayType,
    string Gender,
    string? NameMale,
    string? NameFemale,
    string Label,
    string TextLabel,
    int Cost,
    double UvPosX, double UvPosY, double ScaleX, double ScaleY, double Rotation);

/// <summary>Shared overlay collection + its overlays (FiveM only).</summary>
public sealed record TattooPlanCollection(string Collection, List<TattooPlanItem> Items);

/// <summary>One authoring group, flattened for the viewer manifest.</summary>
public sealed record PlanGroup(string Id, string Name);

/// <summary>
/// Project-level authoring metadata. Read by the viewer manifest only — no
/// builder and no asset generator looks at it.
/// </summary>
public sealed record PlanProjectMeta(string ProjectId, string ProjectName, List<PlanGroup> Groups);

public sealed class BuildPlan
{
    public required BuildOptions Options { get; init; }
    public required List<BuildPart> Parts { get; init; }
    public required List<string> Warnings { get; init; }
    /// <summary>Tattoo overlays (emitted into part 1 by the FiveM builder only).</summary>
    public required TattooPlanCollection Tattoos { get; init; }
    /// <summary>Labels/groups for the opt-in viewer manifest.</summary>
    public required PlanProjectMeta Project { get; init; }
}

// ---------------------------------------------------------------------------
// Canonical stream names (shared contract — keep in sync with atelier-api)
// ---------------------------------------------------------------------------

/// <summary>
/// Canonical file naming for built resources.
///
/// Components: <c>{ped}_{dlc}^{slot}_{NNN}_u.ydd</c> and
/// <c>{ped}_{dlc}^{slot}_diff_{NNN}_{letter}_uni.ytd</c>.
/// Props: the ped name gains <c>_p</c> and the slot KEEPS its <c>p_</c> prefix
/// (<c>{ped}_p_{dlc}^p_head_{NNN}.ydd</c>) — this deviates from the contract
/// text ("propSlot minus p_") on purpose: the game resolves prop drawables as
/// <c>p_{anchor}_{NNN}</c> (vanilla files + cfx.re streaming tutorial +
/// grzyClothTool behavior), so stripping the prefix would make props
/// invisible in-game.
/// Replace mode: no dlc suffix — the file overrides the base-game asset and
/// NNN is the replaceTargetId.
/// </summary>
public static class StreamNames
{
    public static string TextureLetter(int index) => ((char)('a' + (index % 26))).ToString();

    private static string Prefix(string pedName, string? dlcName, bool isProp)
    {
        var ped = isProp ? pedName + "_p" : pedName;
        return dlcName == null ? ped : $"{ped}_{dlcName}";
    }

    public static string Ydd(string pedName, string? dlcName, string slot, bool isProp, int nnn) =>
        $"{Prefix(pedName, dlcName, isProp)}^{InnerYdd(slot, isProp, nnn)}";

    public static string Ytd(string pedName, string? dlcName, string slot, bool isProp, int nnn, int textureIndex) =>
        $"{Prefix(pedName, dlcName, isProp)}^{InnerYtd(slot, isProp, nnn, textureIndex)}";

    public static string Yld(string pedName, string? dlcName, string slot, bool isProp, int nnn) =>
        $"{Prefix(pedName, dlcName, isProp)}^{InnerYld(slot, nnn)}";

    public static string FirstPersonYdd(string pedName, string? dlcName, string slot, bool isProp, int nnn) =>
        $"{Prefix(pedName, dlcName, isProp)}^{InnerFirstPersonYdd(slot, nnn)}";

    // Short names inside the per-ped rpf folders (singleplayer / alt:V).
    public static string InnerYdd(string slot, bool isProp, int nnn) =>
        isProp ? $"{slot}_{nnn:D3}.ydd" : $"{slot}_{nnn:D3}_u.ydd";

    public static string InnerYtd(string slot, bool isProp, int nnn, int textureIndex) =>
        isProp
            ? $"{slot}_diff_{nnn:D3}_{TextureLetter(textureIndex)}.ytd"
            : $"{slot}_diff_{nnn:D3}_{TextureLetter(textureIndex)}_uni.ytd";

    public static string InnerYld(string slot, int nnn) => $"{slot}_{nnn:D3}_u.yld";

    public static string InnerFirstPersonYdd(string slot, int nnn) => $"{slot}_{nnn:D3}_u_1.ydd";

    public static string Ymt(string pedName, string dlcName) => $"{pedName}_{dlcName}.ymt";

    public static string CreatureMetadata(string genderLetter, string dlcName) =>
        $"mp_creaturemetadata_{genderLetter}_{dlcName}.ymt";
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/// <summary>
/// Turns a pack.atelier project into a deterministic build plan.
///
/// Split semantics (documented contract behavior):
/// 1. Per gender, the ADDON drawables are taken in project file order as one
///    flat list (components and props interleaved, like
///    creative/lib/server/cloth-export.ts) and chunked into groups of
///    <c>splitAt</c> (default 256).
/// 2. Part k contains chunk k of the male list plus chunk k of the female
///    list; the number of parts is the maximum chunk count over both genders.
///    This guarantees no (gender, slot) bucket inside one part ever exceeds
///    splitAt — the game-side limit of 256 drawables per (dlc, gender, slot).
/// 3. With a single part the folder is <c>resourceName</c> and the dlc name is
///    <c>dlcName</c>; with N&gt;1 parts EVERY part is suffixed
///    (<c>resourceName_part1..N</c>, <c>dlcName_part1..N</c>) so YMT names and
///    stream prefixes stay unique per part.
/// 4. Drawable numbers (NNN in file names, pedXml_drawblIdx in the YMT) are the
///    0-based index within the (part, gender, slot) bucket in project order —
///    they restart at 000 for every part, matching how each part is its own
///    dlc with its own YMT.
/// 5. Replace-mode drawables never enter a YMT; they are emitted into part 1
///    as base-name override files (fivem only) using replaceTargetId as NNN.
///
/// Pure: only string/path manipulation, no filesystem access.
/// </summary>
public static class BuildPlanner
{
    public static BuildPlan Plan(AtelierProjectDto project, string projectDir, BuildOptions options)
    {
        var warnings = new List<string>();
        var drawables = project.Drawables ?? new List<ProjectDrawableDto>();

        // Planner input filter: a drawable without a YDD cannot be built.
        // (The validator reports this as an error before any build runs.)
        var buildable = new List<ProjectDrawableDto>();
        foreach (var drawable in drawables)
        {
            if (drawable.Ydd?.Path == null)
            {
                warnings.Add($"Drawable \"{drawable.DisplayLabel}\" hat keine YDD-Datei und wurde übersprungen.");
                continue;
            }
            if (!GtaSlots.IsValidSlot(drawable))
            {
                warnings.Add($"Drawable \"{drawable.DisplayLabel}\" hat einen unbekannten Slot \"{drawable.Type}\" und wurde übersprungen.");
                continue;
            }
            buildable.Add(drawable);
        }

        var addons = buildable.Where(d => !d.IsReplace).ToList();
        var replaces = buildable.Where(d => d.IsReplace).ToList();

        if (replaces.Count > 0 && options.Target != "fivem")
        {
            warnings.Add($"{replaces.Count} Replace-Drawable(s) werden für das Ziel \"{options.Target}\" nicht unterstützt und wurden übersprungen.");
            replaces.Clear();
        }
        foreach (var replace in replaces.Where(r => r.ReplaceTargetId == null).ToList())
        {
            warnings.Add($"Replace-Drawable \"{replace.DisplayLabel}\" hat kein replaceTargetId und wurde übersprungen.");
            replaces.Remove(replace);
        }

        // 1+2: per-gender flat chunks, part k = chunk k of each gender.
        var chunksByGender = new Dictionary<string, List<List<ProjectDrawableDto>>>();
        foreach (var gender in new[] { "male", "female" })
        {
            var list = addons.Where(d => d.Gender == gender).ToList();
            chunksByGender[gender] = Chunk(list, options.SplitAt);
        }
        var partCount = Math.Max(1, Math.Max(chunksByGender["male"].Count, chunksByGender["female"].Count));

        var parts = new List<BuildPart>(partCount);
        for (var partIndex = 0; partIndex < partCount; partIndex++)
        {
            var suffix = partCount > 1 ? $"_part{partIndex + 1}" : string.Empty;
            var partDlc = options.DlcName + suffix;
            var genders = new List<BuildPlanGender>();
            var files = new List<PlanFile>();
            var addonCount = 0;

            foreach (var gender in new[] { "male", "female" })
            {
                var chunks = chunksByGender[gender];
                var chunk = partIndex < chunks.Count ? chunks[partIndex] : new List<ProjectDrawableDto>();
                if (chunk.Count == 0) continue;

                var plan = PlanGender(gender, partDlc, chunk, projectDir, files);
                genders.Add(plan);
                addonCount += chunk.Count;
            }

            // 5: replace overrides ride along in part 1 only.
            var replaceCount = 0;
            var replaceGenders = new List<BuildPlanGender>();
            if (partIndex == 0)
            {
                foreach (var replace in replaces)
                {
                    AddDrawableFiles(files, replace, projectDir,
                        pedName: GtaSlots.PedName(replace.Gender ?? "male"),
                        dlcName: null, nnn: replace.ReplaceTargetId!.Value);
                    replaceCount++;
                }
                replaceGenders = PlanReplaceMetadata(replaces);
            }

            parts.Add(new BuildPart
            {
                FolderName = options.ResourceName + suffix,
                DlcName = partDlc,
                Genders = genders,
                ReplaceGenders = replaceGenders,
                Files = files,
                AddonDrawableCount = addonCount,
                ReplaceDrawableCount = replaceCount,
            });
        }

        var tattoos = PlanTattoos(project, projectDir, warnings);

        var projectMeta = new PlanProjectMeta(
            project.Id ?? string.Empty,
            project.Name ?? string.Empty,
            (project.Groups ?? new List<ProjectGroupDto>())
                .Where(g => g.Id != null)
                .Select(g => new PlanGroup(g.Id!, g.Name ?? string.Empty))
                .ToList());

        return new BuildPlan
        {
            Options = options,
            Parts = parts,
            Warnings = warnings,
            Tattoos = tattoos,
            Project = projectMeta,
        };
    }

    /// <summary>
    /// Plans the tattoo overlays. The collection name comes from the project's
    /// tattooCollection (NOT the part-suffixed dlc) so it matches the TS-side
    /// selectDerivedTattooBuild. The YTD name uses the GLOBAL index into
    /// project.tattoos so both sides agree even if an entry is skipped.
    /// </summary>
    private static TattooPlanCollection PlanTattoos(
        AtelierProjectDto project, string projectDir, List<string> warnings)
    {
        var collection = project.TattooCollection?.Name
            ?? project.Settings?.DlcName
            ?? "atelier_pack";
        var items = new List<TattooPlanItem>();
        var tattoos = project.Tattoos ?? new List<ProjectTattooDto>();

        for (var i = 0; i < tattoos.Count; i++)
        {
            var t = tattoos[i];
            var ytdName = $"{collection}_tat_{i:D3}";

            if (t.Image?.Path == null)
            {
                warnings.Add($"Tattoo \"{t.Label ?? ytdName}\" hat kein Bild und wurde übersprungen.");
                continue;
            }
            var zone = TattooZones.ById(t.Zone);
            if (zone == null)
            {
                warnings.Add($"Tattoo \"{t.Label ?? ytdName}\" hat eine unbekannte Zone \"{t.Zone}\" und wurde übersprungen.");
                continue;
            }

            var gender = t.Gender ?? "both";
            var wantsMale = gender is "both" or "male";
            var wantsFemale = gender is "both" or "female";
            var nameMale = wantsMale
                ? (string.IsNullOrEmpty(t.NameMale) ? $"{ytdName}_M" : t.NameMale)
                : null;
            var nameFemale = wantsFemale
                ? (string.IsNullOrEmpty(t.NameFemale) ? $"{ytdName}_F" : t.NameFemale)
                : null;
            var facing = string.IsNullOrEmpty(t.EFacing) ? zone.DefaultFacing : t.EFacing!;
            var p = t.Placement;

            items.Add(new TattooPlanItem(
                i,
                ytdName,
                Resolve(projectDir, t.Image!.Path!),
                zone.OverlayName,
                zone.ShopZone,
                facing,
                TattooZones.OverlayType(t.Type),
                gender,
                nameMale,
                nameFemale,
                t.Label ?? string.Empty,
                string.IsNullOrEmpty(t.TextLabel) ? (t.Label ?? string.Empty) : t.TextLabel!,
                t.Cost,
                p?.UvPosX ?? 0, p?.UvPosY ?? 0, p?.ScaleX ?? 1, p?.ScaleY ?? 1, p?.Rotation ?? 0));
        }

        return new TattooPlanCollection(collection, items);
    }

    private static BuildPlanGender PlanGender(
        string gender, string partDlc, List<ProjectDrawableDto> chunk, string projectDir, List<PlanFile> files)
    {
        var pedName = GtaSlots.PedName(gender);
        var components = new List<PlanComponent>();
        var props = new List<PlanProp>();
        var localIndexBySlot = new Dictionary<string, int>();

        foreach (var drawable in chunk)
        {
            var slot = drawable.Type!;
            var localIndex = localIndexBySlot.GetValueOrDefault(slot);
            localIndexBySlot[slot] = localIndex + 1;

            var textureCount = drawable.Textures?.Count ?? 0;
            if (drawable.IsProp)
            {
                props.Add(new PlanProp(
                    drawable.Id ?? string.Empty,
                    GtaSlots.PropAnchorIds[slot],
                    slot,
                    localIndex,
                    textureCount,
                    drawable.Flags?.HairScaleValue,
                    Label: drawable.Label ?? string.Empty,
                    GroupId: drawable.GroupId));
            }
            else
            {
                components.Add(new PlanComponent(
                    drawable.Id ?? string.Empty,
                    GtaSlots.ComponentIds[slot],
                    slot,
                    localIndex,
                    textureCount,
                    OwnsCloth: drawable.Physics?.Path != null,
                    HasFirstPerson: drawable.FirstPerson?.Path != null,
                    HighHeels: drawable.Flags?.HighHeels == true,
                    Label: drawable.Label ?? string.Empty,
                    GroupId: drawable.GroupId));
            }

            AddDrawableFiles(files, drawable, projectDir, pedName, partDlc, localIndex);
        }

        return new BuildPlanGender
        {
            Gender = gender,
            PedName = pedName,
            GenderLetter = GtaSlots.GenderLetter(gender),
            DlcName = partDlc,
            Components = components.OrderBy(c => c.SlotId).ThenBy(c => c.LocalIndex).ToList(),
            Props = props.OrderBy(p => p.AnchorId).ThenBy(p => p.LocalIndex).ToList(),
        };
    }

    /// <summary>
    /// Describes the replace-mode drawables for the viewer manifest ONLY. This
    /// deliberately does not feed <see cref="BuildPart.Genders"/>: a replace
    /// drawable must never enter a YMT (planner rule 5), so mixing it in would
    /// change the built output. LocalIndex is the replaceTargetId (the NNN the
    /// file was written under) and DlcName stays empty — the file overrides a
    /// base-game asset and belongs to no dlc.
    /// </summary>
    private static List<BuildPlanGender> PlanReplaceMetadata(List<ProjectDrawableDto> replaces)
    {
        var result = new List<BuildPlanGender>();

        foreach (var gender in new[] { "male", "female" })
        {
            var forGender = replaces.Where(r => (r.Gender ?? "male") == gender).ToList();
            if (forGender.Count == 0) continue;

            var components = new List<PlanComponent>();
            var props = new List<PlanProp>();

            foreach (var drawable in forGender)
            {
                var slot = drawable.Type!;
                var targetId = drawable.ReplaceTargetId!.Value;
                var textureCount = drawable.Textures?.Count ?? 0;

                if (drawable.IsProp)
                {
                    props.Add(new PlanProp(
                        drawable.Id ?? string.Empty,
                        GtaSlots.PropAnchorIds[slot],
                        slot,
                        targetId,
                        textureCount,
                        drawable.Flags?.HairScaleValue,
                        Label: drawable.Label ?? string.Empty,
                        GroupId: drawable.GroupId,
                        ReplaceTargetId: targetId));
                }
                else
                {
                    components.Add(new PlanComponent(
                        drawable.Id ?? string.Empty,
                        GtaSlots.ComponentIds[slot],
                        slot,
                        targetId,
                        textureCount,
                        OwnsCloth: drawable.Physics?.Path != null,
                        HasFirstPerson: drawable.FirstPerson?.Path != null,
                        HighHeels: drawable.Flags?.HighHeels == true,
                        Label: drawable.Label ?? string.Empty,
                        GroupId: drawable.GroupId,
                        ReplaceTargetId: targetId));
                }
            }

            result.Add(new BuildPlanGender
            {
                Gender = gender,
                PedName = GtaSlots.PedName(gender),
                GenderLetter = GtaSlots.GenderLetter(gender),
                DlcName = string.Empty,
                Components = components.OrderBy(c => c.SlotId).ThenBy(c => c.LocalIndex).ToList(),
                Props = props.OrderBy(p => p.AnchorId).ThenBy(p => p.LocalIndex).ToList(),
            });
        }

        return result;
    }

    private static void AddDrawableFiles(
        List<PlanFile> files, ProjectDrawableDto drawable, string projectDir,
        string pedName, string? dlcName, int nnn)
    {
        var slot = drawable.Type!;
        var isProp = drawable.IsProp;
        var gender = drawable.Gender ?? "male";
        var isReplace = dlcName == null;

        files.Add(new PlanFile(
            Resolve(projectDir, drawable.Ydd!.Path!),
            StreamNames.Ydd(pedName, dlcName, slot, isProp, nnn),
            StreamNames.InnerYdd(slot, isProp, nnn),
            gender, isProp, isReplace, PlanFileKind.Ydd));

        var textures = drawable.Textures ?? new List<AssetRefDto>();
        for (var i = 0; i < textures.Count; i++)
        {
            if (textures[i].Path == null) continue;
            files.Add(new PlanFile(
                Resolve(projectDir, textures[i].Path!),
                StreamNames.Ytd(pedName, dlcName, slot, isProp, nnn, i),
                StreamNames.InnerYtd(slot, isProp, nnn, i),
                gender, isProp, isReplace, PlanFileKind.Ytd));
        }

        if (drawable.Physics?.Path != null && !isProp)
        {
            files.Add(new PlanFile(
                Resolve(projectDir, drawable.Physics.Path!),
                StreamNames.Yld(pedName, dlcName, slot, isProp, nnn),
                StreamNames.InnerYld(slot, nnn),
                gender, isProp, isReplace, PlanFileKind.Yld));
        }

        if (drawable.FirstPerson?.Path != null && !isProp)
        {
            files.Add(new PlanFile(
                Resolve(projectDir, drawable.FirstPerson.Path!),
                StreamNames.FirstPersonYdd(pedName, dlcName, slot, isProp, nnn),
                StreamNames.InnerFirstPersonYdd(slot, nnn),
                gender, isProp, isReplace, PlanFileKind.FirstPersonYdd));
        }
    }

    /// <summary>Resolves a project-relative forward-slash path (absolute paths pass through).</summary>
    public static string Resolve(string projectDir, string relativePath)
    {
        var normalized = relativePath.Replace('/', Path.DirectorySeparatorChar);
        return Path.IsPathRooted(normalized)
            ? Path.GetFullPath(normalized)
            : Path.GetFullPath(Path.Combine(projectDir, normalized));
    }

    private static List<List<T>> Chunk<T>(List<T> source, int size)
    {
        var chunks = new List<List<T>>();
        for (var i = 0; i < source.Count; i += size)
            chunks.Add(source.GetRange(i, Math.Min(size, source.Count - i)));
        return chunks;
    }
}
