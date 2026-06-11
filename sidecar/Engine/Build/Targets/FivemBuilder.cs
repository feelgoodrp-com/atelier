using System.Security;
using System.Text;

namespace Feelgood.Atelier.Sidecar.Engine.Build.Targets;

/// <summary>
/// FiveM resource output per the shared contract:
/// <c>outDir/&lt;resourceName&gt;[_partN]/fxmanifest.lua + stream/*</c> with
/// real binary CPedVariationInfo YMTs per gender, creature metadata when
/// expressions are needed, optional ShopPedApparel meta(s) and
/// atelier-build.json. Keep byte-compatible with the atelier-api builder.
/// </summary>
public static class FivemBuilder
{
    public static BuildReport Build(BuildPlan plan, string outDir, BuildProgress progress)
    {
        var resources = new List<BuildResourceReport>();
        var warnings = new List<string>(plan.Warnings);

        var totalFiles = plan.Parts.Sum(p => p.Files.Count);
        var copied = 0;

        foreach (var part in plan.Parts)
        {
            var partFolder = Path.Combine(outDir, part.FolderName);
            var streamFolder = Path.Combine(partFolder, "stream");
            Directory.CreateDirectory(streamFolder);

            BuildCommon.CopyPlanFiles(
                part.Files,
                file => Path.Combine(streamFolder, file.StreamName),
                progress, ref copied, totalFiles);

            var shopMetaFiles = new List<string>();

            foreach (var gender in part.Genders)
            {
                progress("ymt", 0, part.Genders.Count,
                    $"Erzeuge CPedVariationInfo für {gender.PedName} ({part.DlcName})");

                var ymtBytes = YmtGenerator.BuildYmt(gender);
                File.WriteAllBytes(
                    Path.Combine(streamFolder, StreamNames.Ymt(gender.PedName, gender.DlcName)),
                    ymtBytes);

                var creatureBytes = CreatureMetadataGenerator.Build(gender);
                var hasCreature = creatureBytes != null;
                if (hasCreature)
                {
                    File.WriteAllBytes(
                        Path.Combine(streamFolder, StreamNames.CreatureMetadata(gender.GenderLetter, gender.DlcName)),
                        creatureBytes!);
                }

                if (plan.Options.GenerateShopMeta)
                {
                    // Contract name when one gender; per-gender suffix when both
                    // (a single ShopPedApparel XML can only describe one ped).
                    var metaName = part.Genders.Count == 1
                        ? "shop_ped_apparel.meta"
                        : $"shop_ped_apparel_{gender.GenderLetter}.meta";
                    File.WriteAllText(
                        Path.Combine(streamFolder, metaName),
                        ShopMetaGenerator.Build(gender, hasCreature));
                    shopMetaFiles.Add($"stream/{metaName}");
                }
            }

            progress("meta", 0, 1, $"Schreibe Manifeste für {part.FolderName}");

            // First-person alternates (root-level meta + data_file).
            var firstPersonFiles = part.Files
                .Where(f => f.Kind == PlanFileKind.FirstPersonYdd)
                .Select(BuildCommon.FirstPersonAssetName)
                .ToList();
            string? firstPersonMeta = null;
            if (firstPersonFiles.Count > 0)
            {
                firstPersonMeta = $"first_person_alternates_{part.DlcName}.meta";
                File.WriteAllText(
                    Path.Combine(partFolder, firstPersonMeta),
                    BuildFirstPersonMeta(firstPersonFiles));
            }

            File.WriteAllText(
                Path.Combine(partFolder, "fxmanifest.lua"),
                BuildFxManifest(shopMetaFiles, firstPersonMeta));

            BuildCommon.WriteBuildManifest(partFolder, "fivem", part.DlcName, part.DrawableCount);

            resources.Add(new BuildResourceReport(part.FolderName, part.DrawableCount));
        }

        return new BuildReport(resources, warnings);
    }

    private static string BuildFxManifest(List<string> shopMetaFiles, string? firstPersonMeta)
    {
        var sb = new StringBuilder();
        sb.AppendLf("fx_version 'cerulean'");
        sb.AppendLf("game 'gta5'");
        sb.AppendLf();
        sb.AppendLf("files {");
        sb.AppendLf("  'stream/*.ydd',");
        sb.AppendLf("  'stream/*.ytd',");
        sb.AppendLf("  'stream/*.yld',");
        sb.AppendLf("  'stream/*.meta',");
        sb.Append("  'stream/*.ymt'");
        if (firstPersonMeta != null)
        {
            sb.AppendLf(",");
            sb.Append($"  '{firstPersonMeta}'");
        }
        sb.AppendLf();
        sb.AppendLf("}");
        sb.AppendLf();
        foreach (var metaFile in shopMetaFiles)
            sb.AppendLf($"data_file 'SHOP_PED_APPAREL_META_FILE' '{metaFile}'");
        if (firstPersonMeta != null)
            sb.AppendLf($"data_file 'PED_FIRST_PERSON_ALTERNATE_DATA' '{firstPersonMeta}'");
        return sb.ToString();
    }

    private static string BuildFirstPersonMeta(List<string> assetNames)
    {
        var sb = new StringBuilder();
        sb.AppendLf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLf("<FirstPersonAlternateData>");
        sb.AppendLf("  <alternates>");
        foreach (var assetName in assetNames)
        {
            sb.AppendLf("    <Item>");
            sb.AppendLf($"      <assetName>{SecurityElement.Escape(assetName)}</assetName>");
            sb.AppendLf("      <alternate value=\"1\" />");
            sb.AppendLf("    </Item>");
        }
        sb.AppendLf("  </alternates>");
        sb.AppendLf("</FirstPersonAlternateData>");
        return sb.ToString();
    }
}
