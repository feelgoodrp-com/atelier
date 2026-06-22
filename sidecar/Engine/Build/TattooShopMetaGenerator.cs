using System.Security;
using System.Text;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// shop_tattoo.meta (TattooShopItemArray) — exposes overlays to the in-game
/// tattoo shop. Only &lt;collection&gt; + &lt;preset&gt; are verified
/// load-bearing for application; the rest are shop cosmetics with sane defaults.
/// Opt-in (GenerateTattooShopMeta) — fg-core applies via tattoos.json instead.
///
/// One shop item per overlay preset, so a "both"-gender tattoo gets a male item
/// (eFaction TATTOO_MP_FM) and a female item (TATTOO_MP_FM_F).
/// </summary>
public static class TattooShopMetaGenerator
{
    public static string Build(TattooPlanCollection plan)
    {
        var sb = new StringBuilder();
        sb.AppendLf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLf("<TattooShopItemArray>");
        sb.AppendLf("  <TattooShopItems>");

        var id = 0;
        foreach (var item in plan.Items)
        {
            if (item.NameMale != null)
                WriteItem(sb, plan.Collection, item, item.NameMale, "TATTOO_MP_FM", id++);
            if (item.NameFemale != null)
                WriteItem(sb, plan.Collection, item, item.NameFemale, "TATTOO_MP_FM_F", id++);
        }

        sb.AppendLf("  </TattooShopItems>");
        sb.AppendLf("</TattooShopItemArray>");
        return sb.ToString();
    }

    private static void WriteItem(
        StringBuilder sb, string collection, TattooPlanItem item, string preset, string faction, int id)
    {
        sb.AppendLf("    <Item>");
        sb.AppendLf($"      <id>{id}</id>");
        sb.AppendLf($"      <cost value=\"{item.Cost}\" />");
        sb.AppendLf(string.IsNullOrEmpty(item.TextLabel)
            ? "      <textLabel />"
            : $"      <textLabel>{Escape(item.TextLabel)}</textLabel>");
        sb.AppendLf($"      <collection>{Escape(collection)}</collection>");
        sb.AppendLf($"      <preset>{Escape(preset)}</preset>");
        sb.AppendLf($"      <eFacing>{item.EFacing}</eFacing>");
        sb.AppendLf("      <updateGroup />");
        sb.AppendLf("      <lockHash>0x00000000</lockHash>");
        sb.AppendLf($"      <zone>{item.ZoneShop}</zone>");
        sb.AppendLf($"      <eFaction>{faction}</eFaction>");
        sb.AppendLf("    </Item>");
    }

    private static string Escape(string value) => SecurityElement.Escape(value) ?? value;
}
