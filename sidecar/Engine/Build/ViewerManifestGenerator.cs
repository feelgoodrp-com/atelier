using System.Reflection;
using System.Text.Json;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// atelier-pack.json — the human-readable side of a built pack, read by the
/// in-game viewer (atelier-fivem) via LoadResourceFile. Opt-in
/// (<c>options.generateViewerManifest</c>) and FiveM only; it carries the
/// labels and groups the engine formats throw away, nothing the game itself
/// needs. Written PER PART, next to atelier-build.json in the resource root.
///
/// Schema "feelgood.atelier.pack/1" — the exact shape is a contract shared with
/// the resource; adding/renaming a field breaks the Lua reader. The item key is
/// (dlcName, gender, slotId, localIndex): localIndex restarts at 0 in every
/// part, so it is ambiguous on its own.
///
/// The consumer MUST be listed in the generated fxmanifest's files{} block —
/// a resource file that is not listed cannot be read from Lua at all.
/// </summary>
public static class ViewerManifestGenerator
{
    /// <summary>File name in the resource root (also the fxmanifest files{} entry).</summary>
    public const string FileName = "atelier-pack.json";

    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>
    /// Version of the SIDECAR assembly, not of the desktop app: the app never
    /// sends its own version with a build request, so this is the most precise
    /// thing the writer honestly knows about itself.
    /// </summary>
    private static readonly string ToolVersion = ResolveToolVersion();

    public static string Build(BuildPlan plan, BuildPart part, int partIndex, int partCount)
    {
        var items = new List<object>();

        // Addon drawables first (in YMT order), then the replace overrides —
        // both flattened per gender, components before props.
        foreach (var gender in part.Genders)
            AddGender(items, gender);
        foreach (var gender in part.ReplaceGenders)
            AddGender(items, gender);

        var manifest = new
        {
            schema = "feelgood.atelier.pack/1",
            generatedAt = DateTimeOffset.UtcNow.ToString("o"),
            tool = $"atelier {ToolVersion}",
            pack = new
            {
                projectId = plan.Project.ProjectId,
                name = plan.Project.ProjectName,
                resource = part.FolderName,
                dlcName = part.DlcName,
                part = partIndex + 1,
                partCount,
            },
            groups = plan.Project.Groups.Select(g => new { id = g.Id, name = g.Name }).ToList(),
            items,
        };

        return JsonSerializer.Serialize(manifest, JsonOptions);
    }

    /// <summary>
    /// Flattens one gender bucket. The item carries no dlcName — pack.dlcName
    /// already identifies the dlc for the whole part.
    /// </summary>
    private static void AddGender(List<object> items, BuildPlanGender gender)
    {
        foreach (var component in gender.Components)
        {
            items.Add(new
            {
                kind = "component",
                gender = gender.Gender,
                ped = gender.PedName,
                slot = component.SlotName,
                slotId = component.SlotId,
                localIndex = component.LocalIndex,
                textures = component.TextureCount,
                label = component.Label,
                groupId = NullIfEmpty(component.GroupId),
                mode = component.ReplaceTargetId == null ? "addon" : "replace",
                replaceTargetId = component.ReplaceTargetId,
                flags = new
                {
                    highHeels = component.HighHeels,
                    firstPerson = component.HasFirstPerson,
                    // Components have no hair scale — that is a prop-only flag.
                    hairScale = (double?)null,
                },
            });
        }

        foreach (var prop in gender.Props)
        {
            items.Add(new
            {
                kind = "prop",
                gender = gender.Gender,
                ped = gender.PedName,
                slot = prop.SlotName,
                // Props are NOT components: slotId is the ANCHOR id here, and
                // the viewer must remove them with ClearPedProp, never index -1.
                slotId = prop.AnchorId,
                localIndex = prop.LocalIndex,
                textures = prop.TextureCount,
                label = prop.Label,
                groupId = NullIfEmpty(prop.GroupId),
                mode = prop.ReplaceTargetId == null ? "addon" : "replace",
                replaceTargetId = prop.ReplaceTargetId,
                flags = new
                {
                    // Props carry neither of the component-only flags.
                    highHeels = false,
                    firstPerson = false,
                    hairScale = prop.HairScaleValue,
                },
            });
        }
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string ResolveToolVersion()
    {
        var assembly = typeof(ViewerManifestGenerator).Assembly;
        var informational = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (string.IsNullOrWhiteSpace(informational))
            return assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        var plus = informational.IndexOf('+');
        return plus > 0 ? informational[..plus] : informational;
    }
}

