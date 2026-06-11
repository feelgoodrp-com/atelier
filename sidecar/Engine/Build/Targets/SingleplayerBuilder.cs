using System.Text;
using CodeWalker.GameFiles;

namespace Feelgood.Atelier.Sidecar.Engine.Build.Targets;

/// <summary>
/// Singleplayer output: one <c>dlc.rpf</c> (RpfFile.CreateNew, OPEN
/// encryption) per build containing
/// <c>content.xml</c> + <c>setup2.xml</c>, per-(part, gender) component/prop
/// rpfs under <c>x64/models/cdimages/</c>, ShopPedApparel metas under
/// <c>common/data/</c> and creature metadata under
/// <c>x64/anim/creaturemetadata.rpf</c>. Install via dlcpacks/&lt;dlcName&gt;/dlc.rpf
/// + dlclist.xml entry.
/// </summary>
public static class SingleplayerBuilder
{
    public static BuildReport Build(BuildPlan plan, string outDir, BuildProgress progress)
    {
        var folder = Path.Combine(outDir, plan.Options.ResourceName);
        Directory.CreateDirectory(folder);
        var report = BuildDlcRpf(plan, folder, progress);
        BuildCommon.WriteBuildManifest(folder, "singleplayer", plan.Options.DlcName,
            plan.Parts.Sum(p => p.DrawableCount));
        return report;
    }

    /// <summary>Creates dlc.rpf inside <paramref name="folder"/> (shared with the RageMP target).</summary>
    public static BuildReport BuildDlcRpf(BuildPlan plan, string folder, BuildProgress progress)
    {
        var warnings = new List<string>(plan.Warnings);
        var resources = new List<BuildResourceReport>();
        var dlcName = plan.Options.DlcName;

        var rpfPath = Path.Combine(folder, "dlc.rpf");
        if (File.Exists(rpfPath)) File.Delete(rpfPath);

        progress("package", 0, 1, "Erzeuge dlc.rpf");
        var dlcRpf = RpfFile.CreateNew(folder, "dlc.rpf", RpfEncryption.OPEN);

        var x64 = RpfFile.CreateDirectory(dlcRpf.Root, "x64");
        var common = RpfFile.CreateDirectory(dlcRpf.Root, "common");
        var dataFolder = RpfFile.CreateDirectory(common, "data");
        var models = RpfFile.CreateDirectory(x64, "models");
        var cdimages = RpfFile.CreateDirectory(models, "cdimages");

        var totalFiles = plan.Parts.Sum(p => p.Files.Count);
        var written = 0;
        var contentEntries = new List<ContentEntry>();
        var creatureMetadatas = new List<(string FileName, byte[] Bytes)>();

        foreach (var part in plan.Parts)
        {
            foreach (var gender in part.Genders)
            {
                var genderSuffix = gender.Gender == "female" ? "_female" : "_male";

                // Components rpf always exists — it hosts the variation YMT.
                var componentsRpf = RpfFile.CreateNew(cdimages, $"{part.DlcName}{genderSuffix}.rpf");
                var componentsFolder = RpfFile.CreateDirectory(componentsRpf.Root, $"{gender.PedName}_{part.DlcName}");
                contentEntries.Add(ContentEntry.Rpf($"%PLATFORM%/models/cdimages/{part.DlcName}{genderSuffix}.rpf"));

                RpfDirectoryEntry? propsFolder = null;
                if (gender.Props.Count > 0)
                {
                    var propsRpf = RpfFile.CreateNew(cdimages, $"{part.DlcName}{genderSuffix}_p.rpf");
                    propsFolder = RpfFile.CreateDirectory(propsRpf.Root, $"{gender.PedName}_p_{part.DlcName}");
                    contentEntries.Add(ContentEntry.Rpf($"%PLATFORM%/models/cdimages/{part.DlcName}{genderSuffix}_p.rpf"));
                }

                progress("ymt", 0, 1, $"Erzeuge CPedVariationInfo für {gender.PedName} ({part.DlcName})");
                RpfFile.CreateFile(componentsRpf.Root,
                    StreamNames.Ymt(gender.PedName, part.DlcName),
                    YmtGenerator.BuildYmt(gender));

                foreach (var file in part.Files.Where(f => f.Gender == gender.Gender))
                {
                    var target = file.IsProp ? propsFolder : componentsFolder;
                    if (target == null) continue;
                    RpfFile.CreateFile(target, file.InnerName, File.ReadAllBytes(file.SourcePath));
                    written++;
                    progress("copy", written, totalFiles, file.InnerName);
                }

                var creatureBytes = CreatureMetadataGenerator.Build(gender);
                if (creatureBytes != null)
                {
                    creatureMetadatas.Add(($"mp_creaturemetadata_{gender.GenderLetter}_{part.DlcName}.ymt", creatureBytes));
                }

                // SHOP_PED_APPAREL meta is what registers the dlc with the ped —
                // required for SP regardless of options.generateShopMeta.
                var metaName = $"{gender.PedName}_{part.DlcName}.meta";
                RpfFile.CreateFile(dataFolder, metaName,
                    Encoding.UTF8.GetBytes(ShopMetaGenerator.Build(gender, creatureBytes != null)));
                contentEntries.Add(ContentEntry.Meta($"common/data/{metaName}"));
            }

            resources.Add(new BuildResourceReport(part.FolderName, part.DrawableCount));
        }

        if (creatureMetadatas.Count > 0)
        {
            progress("meta", 0, 1, "Schreibe Creature-Metadata");
            var animFolder = RpfFile.CreateDirectory(x64, "anim");
            var creatureRpf = RpfFile.CreateNew(animFolder, "creaturemetadata.rpf");
            foreach (var (fileName, bytes) in creatureMetadatas)
                RpfFile.CreateFile(creatureRpf.Root, fileName, bytes);
            contentEntries.Add(ContentEntry.Rpf("%PLATFORM%/anim/creaturemetadata.rpf"));
        }

        progress("meta", 0, 1, "Schreibe content.xml + setup2.xml");
        RpfFile.CreateFile(dlcRpf.Root, "content.xml",
            Encoding.UTF8.GetBytes(BuildContentXml(dlcName, contentEntries)));
        RpfFile.CreateFile(dlcRpf.Root, "setup2.xml",
            Encoding.UTF8.GetBytes(BuildSetupXml(dlcName)));

        return new BuildReport(resources, warnings);
    }

    private sealed record ContentEntry(string Path, string FileType, bool Persistent)
    {
        public static ContentEntry Meta(string path) => new(path, "SHOP_PED_APPAREL_META_FILE", false);
        public static ContentEntry Rpf(string path) => new(path, "RPF_FILE", true);
    }

    private static string BuildContentXml(string dlcName, List<ContentEntry> entries)
    {
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<CDataFileMgr__ContentsOfDataFileXml>");
        sb.AppendLine("  <disabledFiles />");
        sb.AppendLine("  <includedXmlFiles />");
        sb.AppendLine("  <includedDataFiles />");
        sb.AppendLine("  <dataFiles>");
        foreach (var entry in entries)
        {
            sb.AppendLine("    <Item>");
            sb.AppendLine($"      <filename>dlc_{dlcName}:/{entry.Path}</filename>");
            sb.AppendLine($"      <fileType>{entry.FileType}</fileType>");
            sb.AppendLine("      <overlay value=\"false\" />");
            sb.AppendLine("      <disabled value=\"true\" />");
            sb.AppendLine($"      <persistent value=\"{(entry.Persistent ? "true" : "false")}\" />");
            sb.AppendLine("    </Item>");
        }
        sb.AppendLine("  </dataFiles>");
        sb.AppendLine("  <contentChangeSets>");
        sb.AppendLine("    <Item>");
        sb.AppendLine($"      <changeSetName>{dlcName.ToUpperInvariant()}_GEN</changeSetName>");
        sb.AppendLine("      <mapChangeSetData />");
        sb.AppendLine("      <filesToInvalidate />");
        sb.AppendLine("      <filesToDisable />");
        sb.AppendLine("      <filesToEnable>");
        foreach (var entry in entries)
            sb.AppendLine($"        <Item>dlc_{dlcName}:/{entry.Path}</Item>");
        sb.AppendLine("      </filesToEnable>");
        sb.AppendLine("      <txdToLoad />");
        sb.AppendLine("      <txdToUnload />");
        sb.AppendLine("      <residentResources />");
        sb.AppendLine("      <unregisterResources />");
        sb.AppendLine("      <requiresLoadingScreen value=\"false\" />");
        sb.AppendLine("    </Item>");
        sb.AppendLine("  </contentChangeSets>");
        sb.AppendLine("  <patchFiles />");
        sb.AppendLine("</CDataFileMgr__ContentsOfDataFileXml>");
        return sb.ToString();
    }

    private static string BuildSetupXml(string dlcName)
    {
        var timestamp = DateTimeOffset.UtcNow.ToString("dd/MM/yyyy HH:mm:ss");
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<SSetupData>");
        sb.AppendLine($"  <deviceName>dlc_{dlcName}</deviceName>");
        sb.AppendLine("  <datFile>content.xml</datFile>");
        sb.AppendLine($"  <timeStamp>{timestamp}</timeStamp>");
        sb.AppendLine($"  <nameHash>{dlcName}</nameHash>");
        sb.AppendLine("  <contentChangeSets />");
        sb.AppendLine("  <contentChangeSetGroups>");
        sb.AppendLine("    <Item>");
        sb.AppendLine("      <NameHash>GROUP_STARTUP</NameHash>");
        sb.AppendLine("      <ContentChangeSets>");
        sb.AppendLine($"        <Item>{dlcName.ToUpperInvariant()}_GEN</Item>");
        sb.AppendLine("      </ContentChangeSets>");
        sb.AppendLine("    </Item>");
        sb.AppendLine("  </contentChangeSetGroups>");
        sb.AppendLine("  <startupScript />");
        sb.AppendLine("  <scriptCallstackSize value=\"0\" />");
        sb.AppendLine("  <type>EXTRACONTENT_COMPAT_PACK</type>");
        sb.AppendLine("  <order value=\"999\" />");
        sb.AppendLine("  <minorOrder value=\"0\" />");
        sb.AppendLine("  <isLevelPack value=\"false\" />");
        sb.AppendLine("  <dependencyPackHash />");
        sb.AppendLine("  <requiredVersion />");
        sb.AppendLine("  <subPackCount value=\"0\" />");
        sb.AppendLine("</SSetupData>");
        return sb.ToString();
    }
}
