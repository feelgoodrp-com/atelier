using System.Text;
using System.Text.Json;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

public sealed record BuildResourceReport(string Folder, int Drawables);

/// <summary>Terminal build report (mirrored into the SSE done event).</summary>
public sealed record BuildReport(List<BuildResourceReport> Resources, List<string> Warnings);

/// <summary>Progress callback: phase, current, total, human message (German).</summary>
public delegate void BuildProgress(string phase, int current, int total, string message);

public static class BuildCommon
{
    /// <summary>
    /// Appends <paramref name="value"/> plus a single LF. Text files that must
    /// stay byte-identical with the atelier-api server builder (fxmanifest.lua,
    /// shop_ped_apparel*.meta) always use "\n", independent of the host OS.
    /// </summary>
    public static StringBuilder AppendLf(this StringBuilder sb, string value = "") =>
        sb.Append(value).Append('\n');

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    /// <summary>Writes atelier-build.json into one resource part folder.</summary>
    public static void WriteBuildManifest(string partFolder, string target, string dlcName, int drawables)
    {
        var manifest = new
        {
            builtAt = DateTimeOffset.UtcNow.ToString("o"),
            target,
            dlcName,
            drawables,
            tool = "atelier by feelgood",
        };
        File.WriteAllText(
            Path.Combine(partFolder, "atelier-build.json"),
            JsonSerializer.Serialize(manifest, JsonOptions));
    }

    /// <summary>
    /// Copies all planned files of a part, reporting per-file progress.
    /// <paramref name="targetName"/> picks stream vs inner naming per file.
    /// </summary>
    public static void CopyPlanFiles(
        IReadOnlyList<PlanFile> files,
        Func<PlanFile, string> targetPath,
        BuildProgress progress,
        ref int current,
        int total)
    {
        foreach (var file in files)
        {
            var destination = targetPath(file);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file.SourcePath, destination, overwrite: true);
            current++;
            progress("copy", current, total, Path.GetFileName(destination));
        }
    }

    /// <summary>First-person alternate asset name: stream name minus "_1.ydd", '^' → '/'.</summary>
    public static string FirstPersonAssetName(PlanFile file)
    {
        var name = file.StreamName;
        if (name.EndsWith("_1.ydd", StringComparison.OrdinalIgnoreCase))
            name = name[..^"_1.ydd".Length];
        return name.Replace('^', '/');
    }
}
