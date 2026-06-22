using System.Text.Json;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// tattoos.json — the runtime manifest fg-core/qbx_core reads to apply tattoos
/// via AddPedDecorationFromHashes (illenium/fivem-appearance superset). Written
/// to the resource root (NOT stream/) so it is read via LoadResourceFile, never
/// streamed.
///
/// Single-gender null contract (Review fix): a missing per-gender hash falls
/// back to the present one (never null) so a consumer doing
/// `IsPedModel(...) and hashFemale or hashMale` never joaats nil; `genders`
/// lists which hashes are genuinely authored.
/// </summary>
public static class TattooManifestGenerator
{
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static string Build(TattooPlanCollection plan, string resourceName)
    {
        var tattoos = plan.Items.Select(item =>
        {
            var genders = new List<string>();
            if (item.NameMale != null) genders.Add("male");
            if (item.NameFemale != null) genders.Add("female");

            var hashMale = item.NameMale ?? item.NameFemale;
            var hashFemale = item.NameFemale ?? item.NameMale;

            return new
            {
                name = item.YtdName,
                label = item.Label,
                hashMale,
                hashFemale,
                zone = item.ZoneOverlay,
                collection = plan.Collection,
                type = item.OverlayType,
                genders,
            };
        }).ToList();

        var manifest = new
        {
            schema = "feelgood.atelier.tattoos/1",
            tool = "atelier by feelgood",
            builtAt = DateTimeOffset.UtcNow.ToString("o"),
            collection = plan.Collection,
            resource = resourceName,
            tattoos,
        };

        return JsonSerializer.Serialize(manifest, JsonOptions);
    }
}
