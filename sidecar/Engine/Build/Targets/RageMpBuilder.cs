using System.Text;

namespace Feelgood.Atelier.Sidecar.Engine.Build.Targets;

/// <summary>
/// RAGE Multiplayer output. RageMP loads singleplayer-format dlc packs from
/// <c>client_packages/game_resources/dlcpacks/&lt;dlcName&gt;/dlc.rpf</c>, so this
/// target reuses the singleplayer dlc.rpf builder inside that folder layout.
/// Best-effort: RageMP has no official addon-clothes spec beyond the dlcpack
/// mechanism — flagged as a warning in the report.
/// </summary>
public static class RageMpBuilder
{
    public static BuildReport Build(BuildPlan plan, string outDir, BuildProgress progress)
    {
        var resourceFolder = Path.Combine(outDir, plan.Options.ResourceName);
        var dlcFolder = Path.Combine(
            resourceFolder, "client_packages", "game_resources", "dlcpacks", plan.Options.DlcName);
        Directory.CreateDirectory(dlcFolder);

        var report = SingleplayerBuilder.BuildDlcRpf(plan, dlcFolder, progress);
        report.Warnings.Add(
            "RageMP-Ziel ist Best-Effort: dlc.rpf im Singleplayer-Format unter " +
            "client_packages/game_resources/dlcpacks/ — bitte in-game gegentesten.");

        var readme = new StringBuilder();
        readme.AppendLine("atelier by feelgood — RageMP Addon-Kleidung");
        readme.AppendLine();
        readme.AppendLine("Installation:");
        readme.AppendLine("  Den Ordner client_packages/ in den RageMP-Server kopieren (mergen).");
        readme.AppendLine($"  Der DLC-Pack wird als dlcpacks/{plan.Options.DlcName}/dlc.rpf geladen.");
        readme.AppendLine();
        readme.AppendLine("Hinweis: RageMP laedt clientseitige dlcpacks automatisch aus");
        readme.AppendLine("client_packages/game_resources/dlcpacks/.");
        File.WriteAllText(Path.Combine(resourceFolder, "README.txt"), readme.ToString());

        BuildCommon.WriteBuildManifest(resourceFolder, "ragemp", plan.Options.DlcName,
            plan.Parts.Sum(p => p.DrawableCount));

        return report;
    }
}
