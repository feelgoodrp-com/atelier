using Feelgood.Atelier.Sidecar.Api;
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
        report.Warnings.Add(LocalizedMessage.Of("ragemp_best_effort"));

        var readme = new StringBuilder();
        readme.AppendLine("atelier by feelgood — RageMP add-on clothing");
        readme.AppendLine();
        readme.AppendLine("Installation:");
        readme.AppendLine("  Copy (merge) the client_packages/ folder into your RageMP server.");
        readme.AppendLine($"  The DLC pack loads as dlcpacks/{plan.Options.DlcName}/dlc.rpf.");
        readme.AppendLine();
        readme.AppendLine("Note: RageMP loads client-side dlcpacks automatically from");
        readme.AppendLine("client_packages/game_resources/dlcpacks/.");
        File.WriteAllText(Path.Combine(resourceFolder, "README.txt"), readme.ToString());

        BuildCommon.WriteBuildManifest(resourceFolder, "ragemp", plan.Options.DlcName,
            plan.Parts.Sum(p => p.DrawableCount));

        return report;
    }
}
