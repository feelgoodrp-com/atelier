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
        var firstPart = true;

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

            // Tattoos do not split — they ride along in part 1 only. The overlay
            // metadata + shop meta + runtime manifest are data_files at the
            // resource ROOT; the YTDs are streamed.
            string? overlayFile = null;
            string? tattooShopFile = null;
            string? tattooManifestFile = null;
            if (firstPart && plan.Tattoos.Items.Count > 0)
            {
                progress("tattoos", 0, plan.Tattoos.Items.Count,
                    $"Erzeuge {plan.Tattoos.Items.Count} Tattoo-Overlay(s)");

                var tattooDone = 0;
                foreach (var item in plan.Tattoos.Items)
                {
                    var ytdBytes = TattooTextureBuilder.BuildYtd(item.SourceImagePath, item.YtdName);
                    File.WriteAllBytes(Path.Combine(streamFolder, $"{item.YtdName}.ytd"), ytdBytes);
                    progress("tattoos", ++tattooDone, plan.Tattoos.Items.Count, $"{item.YtdName}.ytd");
                }

                overlayFile = $"{plan.Tattoos.Collection}_overlays.xml";
                File.WriteAllText(
                    Path.Combine(partFolder, overlayFile),
                    TattooOverlayGenerator.BuildXml(plan.Tattoos));

                if (plan.Options.GenerateTattooShopMeta)
                {
                    tattooShopFile = "shop_tattoo.meta";
                    File.WriteAllText(
                        Path.Combine(partFolder, tattooShopFile),
                        TattooShopMetaGenerator.Build(plan.Tattoos));
                }

                tattooManifestFile = "tattoos.json";
                File.WriteAllText(
                    Path.Combine(partFolder, tattooManifestFile),
                    TattooManifestGenerator.Build(plan.Tattoos, part.FolderName));
            }

            File.WriteAllText(
                Path.Combine(partFolder, "fxmanifest.lua"),
                BuildFxManifest(shopMetaFiles, firstPersonMeta, overlayFile, tattooShopFile, tattooManifestFile));

            BuildCommon.WriteBuildManifest(partFolder, "fivem", part.DlcName, part.DrawableCount);

            resources.Add(new BuildResourceReport(part.FolderName, part.DrawableCount));
            firstPart = false;
        }

        return new BuildReport(resources, warnings);
    }

    private static string BuildFxManifest(
        List<string> shopMetaFiles,
        string? firstPersonMeta,
        string? overlayFile,
        string? tattooShopFile,
        string? tattooManifestFile)
    {
        // Root-level files must be listed explicitly — the glob is stream/-scoped.
        var files = new List<string>
        {
            "stream/*.ydd", "stream/*.ytd", "stream/*.yld", "stream/*.meta", "stream/*.ymt",
        };
        if (firstPersonMeta != null) files.Add(firstPersonMeta);
        if (overlayFile != null) files.Add(overlayFile);
        if (tattooShopFile != null) files.Add(tattooShopFile);
        if (tattooManifestFile != null) files.Add(tattooManifestFile);

        var sb = new StringBuilder();
        sb.AppendLf("fx_version 'cerulean'");
        sb.AppendLf("game 'gta5'");
        sb.AppendLf();
        sb.AppendLf("files {");
        for (var i = 0; i < files.Count; i++)
            sb.AppendLf($"  '{files[i]}'{(i < files.Count - 1 ? "," : string.Empty)}");
        sb.AppendLf("}");
        sb.AppendLf();
        foreach (var metaFile in shopMetaFiles)
            sb.AppendLf($"data_file 'SHOP_PED_APPAREL_META_FILE' '{metaFile}'");
        if (firstPersonMeta != null)
            sb.AppendLf($"data_file 'PED_FIRST_PERSON_ALTERNATE_DATA' '{firstPersonMeta}'");
        if (overlayFile != null)
            sb.AppendLf($"data_file 'PED_OVERLAY_FILE' '{overlayFile}'");
        if (tattooShopFile != null)
            sb.AppendLf($"data_file 'TATTOO_SHOP_DLC_FILE' '{tattooShopFile}'");
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
