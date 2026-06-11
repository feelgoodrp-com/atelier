using System.Globalization;
using System.Xml;
using System.Xml.Linq;
using CodeWalker.GameFiles;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// Generates <c>mp_creaturemetadata_{m|f}_{dlc}.ymt</c> (RBF-format
/// CCreatureMetaData) for one (part, gender).
///
/// The creature metadata wires ped EXPRESSIONS, not cloth physics: feet
/// components flagged as high heels get a pedCompExpressions entry
/// (expression index 4 = heel lift) and p_head props with a hair-scale value
/// get a pedPropExpressions entry (expression 0 = hair scale). YLD cloth
/// physics need no creature metadata — the .yld file streamed next to the
/// .ydd plus ownsCloth=1 in the variation YMT is sufficient.
///
/// The track/id constants (tracks=33, ids=28462/13201, types=2, components=1)
/// and the leading dummy prop entry mirror what vanilla creature metadata
/// files contain (grzyClothTool used as behavior reference; missing dummy
/// entry reportedly crashes FiveM).
/// </summary>
public static class CreatureMetadataGenerator
{
    /// <summary>Returns the RBF .ymt bytes, or null when no expressions are needed.</summary>
    public static byte[]? Build(BuildPlanGender plan)
    {
        var heelFeet = plan.Components
            .Where(c => c.HighHeels && c.SlotId == 6)
            .OrderBy(c => c.LocalIndex)
            .ToList();
        var scaledHats = plan.Props
            .Where(p => p.AnchorId == 0 && p.HairScaleValue != null)
            .OrderBy(p => p.LocalIndex)
            .ToList();

        if (heelFeet.Count == 0 && scaledHats.Count == 0) return null;

        var root = new XElement("CCreatureMetaData");

        var compExpressions = new XElement("pedCompExpressions");
        foreach (var feet in heelFeet)
        {
            compExpressions.Add(ExpressionItem(
                idTag: "pedCompID", id: 6,
                varIndexTag: "pedCompVarIndex", varIndex: feet.LocalIndex,
                exprIndexTag: "pedCompExpressionIndex", exprIndex: 4,
                ids: 28462));
        }
        root.Add(compExpressions);

        var propExpressions = new XElement("pedPropExpressions");
        if (scaledHats.Count > 0)
        {
            // Vanilla files start with this placeholder entry; FiveM is known
            // to misbehave without it.
            propExpressions.Add(ExpressionItem(
                idTag: "pedPropID", id: 0,
                varIndexTag: "pedPropVarIndex", varIndex: -1,
                exprIndexTag: "pedPropExpressionIndex", exprIndex: -1,
                ids: 13201));

            foreach (var hat in scaledHats)
            {
                propExpressions.Add(ExpressionItem(
                    idTag: "pedPropID", id: 0,
                    varIndexTag: "pedPropVarIndex", varIndex: hat.LocalIndex,
                    exprIndexTag: "pedPropExpressionIndex", exprIndex: 0,
                    ids: 13201));
            }
        }
        root.Add(propExpressions);

        var document = new XmlDocument();
        document.Load(root.CreateReader());

        return XmlRbf.GetRbf(document).Save();
    }

    private static XElement ExpressionItem(
        string idTag, int id, string varIndexTag, int varIndex,
        string exprIndexTag, int exprIndex, int ids)
    {
        var item = new XElement("Item");
        item.Add(new XElement(idTag, new XAttribute("value", Hex(id))));
        item.Add(new XElement(varIndexTag, new XAttribute("value", Hex(varIndex))));
        item.Add(new XElement(exprIndexTag, new XAttribute("value", Hex(exprIndex))));
        item.Add(new XElement("tracks", new XAttribute("content", "char_array"), 33));
        item.Add(new XElement("ids", new XAttribute("content", "short_array"), ids));
        item.Add(new XElement("types", new XAttribute("content", "char_array"), 2));
        item.Add(new XElement("components", new XAttribute("content", "char_array"), 1));
        return item;
    }

    private static string Hex(int value) =>
        string.Format(CultureInfo.InvariantCulture, "0x{0:X}", value);
}
