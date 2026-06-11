using CodeWalker.GameFiles;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// Generates a REAL binary CPedVariationInfo .ymt (RSC7 meta, version 2) for
/// one (resource part, gender) via the CodeWalker MetaBuilder.
///
/// Field semantics were clean-room derived from the CodeWalker.Core struct
/// definitions (MetaTypes.cs) plus observing how working addon packs populate
/// them (grzyClothTool used as behavior reference only):
///  - availComp[12]: ordinal of the slot inside aComponentData3, 255 if the
///    slot has no drawables.
///  - CPVDrawblData.propMask: bit 0 = has model; bits 4-5 = skin-tone type
///    (0 = "u"). Our pipeline only emits non-skin ("_u") drawables → 1.
///  - CPVTextureData.texId: 0 = "uni" texture (non-skin) for components; for
///    props it is the texture index. distribution is always 255 in game files.
///  - CComponentInfo.pedXml_expressionMods[4]: high-heels expression value
///    (schema only stores the flag, so 1.0 is used when enabled).
///  - CPedPropMetaData.expressionMods[0]: NEGATIVE hair-scale value (hats).
///  - dlcName: JenkHash of the (per-part) dlc name.
/// </summary>
public static class YmtGenerator
{
    private const string DefaultAudio = "none";

    public static byte[] BuildYmt(BuildPlanGender plan)
    {
        var mb = new MetaBuilder();
        // Root block must be the first one so RootBlockIndex=1 points at it.
        mb.EnsureBlock(MetaName.CPedVariationInfo);

        var info = new CPedVariationInfo
        {
            bHasTexVariations = 1,
            bHasDrawblVariations = 1,
            bHasLowLODs = 0,
            bIsSuperLOD = 0,
        };

        // --- components -----------------------------------------------------
        var bySlot = plan.Components
            .GroupBy(c => c.SlotId)
            .OrderBy(g => g.Key)
            .ToList();

        var availComp = new ArrayOfBytes12();
        availComp.SetBytes(new byte[] { 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255 });
        byte ordinal = 0;
        foreach (var slotGroup in bySlot)
        {
            availComp.SetByte(slotGroup.Key, ordinal);
            ordinal++;
        }
        info.availComp = availComp;

        var componentData = new CPVComponentData[bySlot.Count];
        for (var s = 0; s < bySlot.Count; s++)
        {
            var slotDrawables = bySlot[s].OrderBy(c => c.LocalIndex).ToArray();
            var drawblData = new CPVDrawblData[slotDrawables.Length];
            for (var d = 0; d < slotDrawables.Length; d++)
            {
                var component = slotDrawables[d];
                var texData = new CPVTextureData[component.TextureCount];
                for (var t = 0; t < texData.Length; t++)
                {
                    texData[t].texId = 0;           // 0 = "uni" (we only build non-skin drawables)
                    texData[t].distribution = 255;  // constant in game files
                }

                drawblData[d].propMask = 1;
                drawblData[d].numAlternatives = (byte)(component.HasFirstPerson ? 1 : 0);
                drawblData[d].aTexData = mb.AddItemArrayPtr(MetaName.CPVTextureData, texData);
                drawblData[d].clothData = new CPVDrawblData__CPVClothComponentData
                {
                    ownsCloth = (byte)(component.OwnsCloth ? 1 : 0),
                };
            }

            componentData[s] = new CPVComponentData
            {
                numAvailTex = (byte)Math.Min(255, slotDrawables.Sum(c => c.TextureCount)),
                aDrawblData3 = mb.AddItemArrayPtr(MetaName.CPVDrawblData, drawblData),
            };
        }
        info.aComponentData3 = mb.AddItemArrayPtr(MetaName.CPVComponentData, componentData);

        var compInfos = new CComponentInfo[plan.Components.Count];
        for (var i = 0; i < compInfos.Length; i++)
        {
            var component = plan.Components[i];
            compInfos[i].pedXml_audioID = JenkHash.GenHash(DefaultAudio);
            compInfos[i].pedXml_audioID2 = JenkHash.GenHash(DefaultAudio);
            compInfos[i].pedXml_expressionMods = new ArrayOfFloats5
            {
                f4 = component.HighHeels ? 1.0f : 0f,
            };
            compInfos[i].flags = 0;
            compInfos[i].inclusions = 0;
            compInfos[i].exclusions = 0;
            compInfos[i].pedXml_vfxComps = ePedVarComp.PV_COMP_HEAD;
            compInfos[i].pedXml_flags = 0;
            compInfos[i].pedXml_compIdx = (byte)component.SlotId;
            compInfos[i].pedXml_drawblIdx = (byte)component.LocalIndex;
        }
        info.compInfos = mb.AddItemArrayPtr(MetaName.CComponentInfo, compInfos);

        // --- props -----------------------------------------------------------
        var propInfo = new CPedPropInfo
        {
            numAvailProps = (byte)Math.Min(255, plan.Props.Count),
        };

        var propMeta = new CPedPropMetaData[plan.Props.Count];
        for (var i = 0; i < propMeta.Length; i++)
        {
            var prop = plan.Props[i];
            var texData = new CPedPropTexData[prop.TextureCount];
            for (var t = 0; t < texData.Length; t++)
            {
                texData[t].inclusions = 0;
                texData[t].exclusions = 0;
                texData[t].texId = (byte)t;
                texData[t].inclusionId = 0;
                texData[t].exclusionId = 0;
                texData[t].distribution = 255;
            }

            propMeta[i].audioId = JenkHash.GenHash(DefaultAudio);
            propMeta[i].expressionMods = new ArrayOfFloats5
            {
                // Hair scale is stored NEGATED (pushes the hair down under hats).
                f0 = prop.HairScaleValue is double scale ? (float)-scale : 0f,
            };
            propMeta[i].texData = mb.AddItemArrayPtr(MetaName.CPedPropTexData, texData);
            propMeta[i].renderFlags = 0;
            propMeta[i].propFlags = 0;
            propMeta[i].flags = 0;
            propMeta[i].anchorId = (byte)prop.AnchorId;
            propMeta[i].propId = (byte)prop.LocalIndex;
            propMeta[i].Unk_2894625425 = 0;
        }
        propInfo.aPropMetaData = mb.AddItemArrayPtr(MetaName.CPedPropMetaData, propMeta);

        var anchorGroups = plan.Props.GroupBy(p => p.AnchorId).OrderBy(g => g.Key).ToArray();
        var anchors = new CAnchorProps[anchorGroups.Length];
        for (var i = 0; i < anchors.Length; i++)
        {
            // One byte per prop at this anchor: its texture-variation count.
            var texCounts = anchorGroups[i]
                .OrderBy(p => p.LocalIndex)
                .Select(p => (byte)p.TextureCount)
                .ToArray();
            anchors[i].props = mb.AddByteArrayPtr(texCounts);
            anchors[i].anchor = (eAnchorPoints)anchorGroups[i].Key;
        }
        propInfo.aAnchors = mb.AddItemArrayPtr(MetaName.CAnchorProps, anchors);
        info.propInfo = propInfo;

        info.dlcName = JenkHash.GenHash(plan.DlcName);

        mb.AddItem(MetaName.CPedVariationInfo, info);

        mb.AddStructureInfo(MetaName.CPedVariationInfo);
        mb.AddStructureInfo(MetaName.CPedPropInfo);
        mb.AddStructureInfo(MetaName.CPedPropTexData);
        mb.AddStructureInfo(MetaName.CAnchorProps);
        mb.AddStructureInfo(MetaName.CComponentInfo);
        mb.AddStructureInfo(MetaName.CPVComponentData);
        mb.AddStructureInfo(MetaName.CPVDrawblData);
        mb.AddStructureInfo(MetaName.CPVDrawblData__CPVClothComponentData);
        mb.AddStructureInfo(MetaName.CPVTextureData);
        mb.AddStructureInfo(MetaName.CPedPropMetaData);
        mb.AddEnumInfo(MetaName.ePedVarComp);
        mb.AddEnumInfo(MetaName.eAnchorPoints);
        mb.AddEnumInfo(MetaName.ePropRenderFlags);

        var meta = mb.GetMeta();
        meta.Name = plan.DlcName;

        return ResourceBuilder.Build(meta, 2); // .ymt = resource version 2
    }
}
