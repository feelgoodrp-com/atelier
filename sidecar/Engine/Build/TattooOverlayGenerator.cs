using System.Globalization;
using System.Security;
using System.Text;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// PedDecorationCollection overlay metadata. The MVP emits XML (data_file
/// 'PED_OVERLAY_FILE' accepts it; community packs ship .xml). A real PSO .ymt is
/// P3 — CodeWalker.Core has no CPedDecorationCollection struct layout, so a PSO
/// compile would silently write an empty file (plan risk R1).
///
/// Each overlay preset references the SAME txdHash/txtHash (== its own YTD file
/// name). A "both"-gender tattoo emits two presets (GENDER_MALE + GENDER_FEMALE)
/// over the one shared YTD — the verified fivem-appearance model.
/// </summary>
public static class TattooOverlayGenerator
{
    public static string BuildXml(TattooPlanCollection plan)
    {
        var sb = new StringBuilder();
        sb.AppendLf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLf("<PedDecorationCollection>");
        sb.AppendLf("  <presets>");
        foreach (var item in plan.Items)
        {
            if (item.NameMale != null) WritePreset(sb, item, item.NameMale, "GENDER_MALE");
            if (item.NameFemale != null) WritePreset(sb, item, item.NameFemale, "GENDER_FEMALE");
        }
        sb.AppendLf("  </presets>");
        sb.AppendLf("</PedDecorationCollection>");
        return sb.ToString();
    }

    private static void WritePreset(StringBuilder sb, TattooPlanItem item, string nameHash, string gender)
    {
        sb.AppendLf("    <Item>");
        sb.AppendLf($"      <nameHash>{Escape(nameHash)}</nameHash>");
        sb.AppendLf($"      <txdHash>{Escape(item.YtdName)}</txdHash>");
        sb.AppendLf($"      <txtHash>{Escape(item.YtdName)}</txtHash>");
        sb.AppendLf($"      <uvPos x=\"{F(item.UvPosX)}\" y=\"{F(item.UvPosY)}\" />");
        sb.AppendLf($"      <scale x=\"{F(item.ScaleX)}\" y=\"{F(item.ScaleY)}\" />");
        sb.AppendLf($"      <rotation value=\"{F(item.Rotation)}\" />");
        sb.AppendLf("      <faction>FM</faction>");
        sb.AppendLf("      <garment>All</garment>");
        sb.AppendLf($"      <zone>{item.ZoneOverlay}</zone>");
        sb.AppendLf($"      <type>{item.OverlayType}</type>");
        sb.AppendLf($"      <gender>{gender}</gender>");
        sb.AppendLf("      <award />");
        sb.AppendLf("      <awardLevel />");
        sb.AppendLf("    </Item>");
    }

    private static string F(double value) => value.ToString("0.000000", CultureInfo.InvariantCulture);

    private static string Escape(string value) => SecurityElement.Escape(value) ?? value;
}
