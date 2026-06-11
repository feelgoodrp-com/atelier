using System.Security;
using System.Text;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// ShopPedApparel .meta XML for one (part, gender). Shape ported from
/// creative/lib/server/cloth-shop-meta.ts (pedComponents items) merged with
/// the registration fields working addon packs use (pedName/dlcName/
/// fullDlcName/eCharacter/creatureMetaData + empty pedOutfits/pedProps).
/// </summary>
public static class ShopMetaGenerator
{
    public static string Build(BuildPlanGender plan, bool hasCreatureMetadata)
    {
        var eCharacter = plan.Gender == "female" ? "SCR_CHAR_MULTIPLAYER_F" : "SCR_CHAR_MULTIPLAYER";
        var creatureMeta = hasCreatureMetadata
            ? $"mp_creaturemetadata_{plan.GenderLetter}_{plan.DlcName}"
            : null;

        var sb = new StringBuilder();
        sb.AppendLf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLf("<ShopPedApparel>");
        sb.AppendLf($"  <pedName>{Escape(plan.PedName)}</pedName>");
        sb.AppendLf($"  <dlcName>{Escape(plan.DlcName)}</dlcName>");
        sb.AppendLf($"  <fullDlcName>{Escape($"{plan.PedName}_{plan.DlcName}")}</fullDlcName>");
        sb.AppendLf($"  <eCharacter>{eCharacter}</eCharacter>");
        sb.AppendLf(creatureMeta == null
            ? "  <creatureMetaData />"
            : $"  <creatureMetaData>{Escape(creatureMeta)}</creatureMetaData>");
        sb.AppendLf("  <pedOutfits />");

        if (plan.Components.Count == 0)
        {
            sb.AppendLf("  <pedComponents />");
        }
        else
        {
            sb.AppendLf("  <pedComponents>");
            for (var i = 0; i < plan.Components.Count; i++)
            {
                var component = plan.Components[i];
                var unique = $"{plan.DlcName}_{plan.GenderLetter}_C{component.SlotId}_D{component.LocalIndex}_I{i}"
                    .ToUpperInvariant();
                sb.AppendLf("    <Item>");
                sb.AppendLf("      <lockHash>0x00000000</lockHash>");
                sb.AppendLf("      <cost value=\"0\" />");
                sb.AppendLf("      <textLabel />");
                sb.AppendLf($"      <uniqueNameHash>{Escape(unique)}</uniqueNameHash>");
                sb.AppendLf("      <eShopEnum>SHOP_PED_APPAREL</eShopEnum>");
                sb.AppendLf($"      <drawableIndex value=\"{component.LocalIndex}\" />");
                sb.AppendLf("      <textureIndex value=\"0\" />");
                sb.AppendLf($"      <eCompType>{GtaSlots.CompNativeNames[component.SlotId]}</eCompType>");
                sb.AppendLf("      <restrictionTags />");
                sb.AppendLf("    </Item>");
            }
            sb.AppendLf("  </pedComponents>");
        }

        sb.AppendLf("  <pedProps />");
        sb.AppendLf("</ShopPedApparel>");
        return sb.ToString();
    }

    private static string Escape(string value) => SecurityElement.Escape(value) ?? value;
}
