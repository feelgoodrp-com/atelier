using System.Globalization;

namespace Feelgood.Atelier.Sidecar.Engine.Face;

/// <summary>
/// VERBATIM transcription of the face-rendering calibration data (probed on
/// the real GTA V install via a temporary CodeWalker.Core console; see
/// .claude-research/assets-probe.md). Single source of truth shared by
/// <see cref="FaceAssets"/> and <see cref="FaceCompositor"/>:
///   - SetPedHeadOverlay slot -> faov category mapping + compositing mode,
///   - per-category index ranges + gendering,
///   - the 64-entry hair tint palette (community placeholder, see warning),
///   - the eye-colour atlas geometry + iris UV rect on the head diffuse,
///   - the on-disk RPF paths of the overlay / parent-skin / eye dictionaries.
///
/// CALIBRATION UNCERTAINTIES (verify visually before shipping tint):
///   - slot 3 (Ageing) vs slot 7 (SunDamage) both map to mp_fm_faov_weather —
///     ambiguous, marked below.
///   - the hair RGB palette is the de-facto community table (48 real hair
///     tints exist; this 64-list matches the facepaint count). Engine natives
///     _GET_PED_HAIR_RGB_COLOR are authoritative — dump in-game to verify.
///   - the makeup RGB palette is NOT extractable from static game data; makeup
///     overlays therefore render UNTINTED until a native dump fills it in.
/// </summary>
public static class FaceCalibration
{
    /// <summary>How an overlay decal is blended onto the head diffuse.</summary>
    public enum Compositing
    {
        /// <summary>DXT1 full-face, no alpha cutout (neutral grey, tint via blend). Slots 0/6.</summary>
        FullFaceDxt1,
        /// <summary>DXT5 full-face, no alpha cutout (weather/sun damage). Slots 3/7.</summary>
        FullFaceDxt5,
        /// <summary>DXT5 decal with a real alpha cutout (brows, beard, makeup, ...). Most slots.</summary>
        DecalDxt5Alpha,
    }

    /// <summary>Which palette an overlay's colour index indexes into.</summary>
    public enum TintPalette
    {
        /// <summary>Untintable (blemishes, complexion, weather, moles).</summary>
        None,
        /// <summary>Hair tint table (eyebrows, beard, chest hair).</summary>
        Hair,
        /// <summary>Makeup tint table (makeup, blush, lipstick) — empty until dumped.</summary>
        Makeup,
    }

    /// <summary>
    /// One head-overlay slot's render recipe. Categories are tried in order;
    /// the FIRST one whose YTD for the requested index resolves wins (gendered
    /// slots pick the male/female category up front, see <see cref="ResolveCategory"/>).
    /// </summary>
    public sealed record OverlaySlot(
        int Slot,
        string Name,
        IReadOnlyList<string> Categories,
        bool Render,
        Compositing Compositing,
        bool Tintable,
        TintPalette Palette,
        bool Gendered);

    /// <summary>One faov category's index range + texture format facts.</summary>
    public sealed record Category(
        string Name,
        int MinIndex,
        int MaxIndex,
        bool Gendered,
        string Format,
        bool AlphaCutout);

    /// <summary>Slot sentinel: overlay disabled (SetPedHeadOverlay "no overlay").</summary>
    public const int OverlayOff = 255;

    // ---- Slot -> faov mapping (head slots 0..9 render; body slots 10..12 excluded) ----
    public static readonly IReadOnlyList<OverlaySlot> Slots = new[]
    {
        new OverlaySlot(0, "Blemishes",   new[] { "mp_fm_faov_acne", "mp_fm_faov_spots" },                    true,  Compositing.FullFaceDxt1,   false, TintPalette.None,   false),
        new OverlaySlot(1, "FacialHair",  new[] { "mp_fm_faov_beard" },                                       true,  Compositing.DecalDxt5Alpha, true,  TintPalette.Hair,   true),
        new OverlaySlot(2, "Eyebrows",    new[] { "mp_fm_faov_eyebrowm", "mp_fm_faov_eyebrowf" },             true,  Compositing.DecalDxt5Alpha, true,  TintPalette.Hair,   true),
        new OverlaySlot(3, "Ageing",      new[] { "mp_fm_faov_weather" },                                     true,  Compositing.FullFaceDxt5,   false, TintPalette.None,   false),
        new OverlaySlot(4, "Makeup",      new[] { "mp_fm_faov_makeup", "mp_fm_faov_makeupm" },                true,  Compositing.DecalDxt5Alpha, true,  TintPalette.Makeup, true),
        new OverlaySlot(5, "Blush",       new[] { "mp_fm_faov_blusher" },                                     true,  Compositing.DecalDxt5Alpha, true,  TintPalette.Makeup, false),
        new OverlaySlot(6, "Complexion",  new[] { "mp_fm_faov_skin" },                                        true,  Compositing.FullFaceDxt1,   false, TintPalette.None,   false),
        new OverlaySlot(7, "SunDamage",   new[] { "mp_fm_faov_flan", "mp_fm_faov_weather" },                  true,  Compositing.FullFaceDxt5,   false, TintPalette.None,   false),
        new OverlaySlot(8, "Lipstick",    new[] { "mp_fm_faov_lips", "mp_fm_faov_lips_g", "mp_fm_faov_lipsm" }, true, Compositing.DecalDxt5Alpha, true,  TintPalette.Makeup, true),
        new OverlaySlot(9, "MolesFreckles", new[] { "mp_fm_faov_mole", "mp_fm_faov_flan" },                   true,  Compositing.DecalDxt5Alpha, false, TintPalette.None,   false),
        // Body slots 10..12 (chest hair / body blemishes) live on uppr, not the
        // head diffuse — honestly excluded from stage 2 (Render=false).
        new OverlaySlot(10, "ChestHair",        new[] { "mp_fm_body_hair" },                  false, Compositing.DecalDxt5Alpha, true,  TintPalette.Hair,   false),
        new OverlaySlot(11, "BodyBlemishes",    new[] { "mp_fm_body_moles", "mp_fm_body_spots" },     false, Compositing.DecalDxt5Alpha, false, TintPalette.None,   false),
        new OverlaySlot(12, "AddBodyBlemishes", new[] { "mp_fm_body_moles_f", "mp_fm_body_spots_f" }, false, Compositing.DecalDxt5Alpha, false, TintPalette.None,   false),
    };

    private static readonly IReadOnlyDictionary<int, OverlaySlot> SlotsByIndex =
        Slots.ToDictionary(s => s.Slot);

    public static OverlaySlot? FindSlot(int slot) =>
        SlotsByIndex.TryGetValue(slot, out var s) ? s : null;

    // ---- Per-category facts (index ranges + format) ----
    public static readonly IReadOnlyDictionary<string, Category> Categories = new Dictionary<string, Category>
    {
        ["mp_fm_faov_acne"]     = new("mp_fm_faov_acne",     0, 17, false, "DXT1", false),
        ["mp_fm_faov_bags"]     = new("mp_fm_faov_bags",     0, 0,  false, "DXT5", true),
        ["mp_fm_faov_beard"]    = new("mp_fm_faov_beard",    0, 25, true,  "DXT5", true),
        ["mp_fm_faov_blusher"]  = new("mp_fm_faov_blusher",  0, 6,  false, "DXT5", true),
        ["mp_fm_faov_cheeks"]   = new("mp_fm_faov_cheeks",   0, 9,  false, "DXT5", true),
        ["mp_fm_faov_eyebrowm"] = new("mp_fm_faov_eyebrowm", 0, 16, true,  "DXT5", true),
        ["mp_fm_faov_eyebrowf"] = new("mp_fm_faov_eyebrowf", 0, 16, true,  "DXT5", true),
        ["mp_fm_faov_flan"]     = new("mp_fm_faov_flan",     0, 7,  false, "DXT5", true),
        ["mp_fm_faov_foundation"] = new("mp_fm_faov_foundation", 0, 1, false, "DXT5", false),
        ["mp_fm_faov_infect"]   = new("mp_fm_faov_infect",   0, 1,  false, "DXT5", false),
        ["mp_fm_faov_lips"]     = new("mp_fm_faov_lips",     0, 3,  true,  "DXT5", true),
        ["mp_fm_faov_lips_g"]   = new("mp_fm_faov_lips_g",   0, 3,  false, "DXT5", false),
        ["mp_fm_faov_lipsm"]    = new("mp_fm_faov_lipsm",    0, 1,  true,  "DXT5", false),
        ["mp_fm_faov_makeup"]   = new("mp_fm_faov_makeup",   0, 32, true,  "DXT5", true),
        ["mp_fm_faov_makeupm"]  = new("mp_fm_faov_makeupm",  0, 7,  true,  "DXT5", false),
        ["mp_fm_faov_mole"]     = new("mp_fm_faov_mole",     0, 9,  false, "DXT5", true),
        ["mp_fm_faov_skin"]     = new("mp_fm_faov_skin",     0, 10, false, "DXT1", false),
        ["mp_fm_faov_spots"]    = new("mp_fm_faov_spots",    0, 3,  false, "DXT5", false),
        ["mp_fm_faov_weather"]  = new("mp_fm_faov_weather",  0, 13, false, "DXT5", true),
    };

    /// <summary>
    /// Picks the right category for a (possibly gendered) slot: the male/female
    /// categories are selected by the freemode ped's gender; non-gendered slots
    /// just return the first category. The caller then tries to resolve the YTD
    /// for the requested index and falls back to the slot's other categories.
    /// </summary>
    public static IReadOnlyList<string> ResolveCategories(OverlaySlot slot, bool isFemale)
    {
        if (!slot.Gendered) return slot.Categories;

        // Gendered slots: male-vs-female categories are distinguished by the
        // "m"/"f" suffix (eyebrowm/eyebrowf, makeup/makeupm, lips/lipsm). The
        // preferred category leads; the others stay as fallbacks so a male ped
        // with a female-only makeup index still renders something.
        var preferred = new List<string>(slot.Categories.Count);
        var fallback = new List<string>(slot.Categories.Count);
        foreach (var cat in slot.Categories)
        {
            var maleCat = cat.EndsWith('m');
            var femaleCat = cat.EndsWith('f') || cat == "mp_fm_faov_makeup" || cat == "mp_fm_faov_lips";
            var matchesGender = isFemale ? femaleCat : maleCat;
            if (matchesGender) preferred.Add(cat);
            else fallback.Add(cat);
        }
        preferred.AddRange(fallback);
        return preferred.Count > 0 ? preferred : slot.Categories;
    }

    // ---- On-disk RPF paths (probed; base + patch overrides searched in order) ----

    /// <summary>
    /// Folders that hold the faov overlay YTDs. The compositor builds
    /// "&lt;folder&gt;\&lt;category&gt;_&lt;NNN&gt;.ytd" and asks RpfMan for the first that
    /// resolves; later (DLC patch) folders override earlier ones.
    /// </summary>
    public static readonly IReadOnlyList<string> OverlayRpfFolders = new[]
    {
        @"x64v.rpf\models\cdimages\ped_mp_overlay_txds.rpf",
        @"update\x64\dlcpacks\patchday1ng\dlc.rpf\x64\models\cdimages\ped_mp_overlay_txds.rpf",
        @"update\x64\dlcpacks\patchday4ng\dlc.rpf\x64\models\ped_mp_overlay_txds.rpf",
    };

    /// <summary>
    /// Folders that hold the parent HeadBlend skin YTDs (head/uppr/lowr/feet
    /// diffuse per parent index + ethnicity). The freemode ped's OWN per-index
    /// head diffuse lives in its model folder (see <see cref="FreemodeModelFolder"/>);
    /// the shared parent skins live in mp_headtargets.
    /// </summary>
    public static readonly IReadOnlyList<string> HeadTargetFolders = new[]
    {
        @"x64v.rpf\models\cdimages\streamedpeds_mp.rpf\mp_headtargets",
        @"update\x64\dlcpacks\mppatchesng\dlc.rpf\x64\models\cdimages\mppatches.rpf\mp_headtargets",
    };

    /// <summary>Per-freemode-ped model folder under streamedpeds_mp (holds head_diff_XXX_a_&lt;eth&gt;.ytd).</summary>
    public static string FreemodeModelFolder(string pedModel) =>
        $@"x64v.rpf\models\cdimages\streamedpeds_mp.rpf\{pedModel.ToLowerInvariant()}";

    /// <summary>Eye-colour atlas YTD path (single texture mp_eye_colour, 512x256 DXT5).</summary>
    public const string EyeColourRpfPath =
        @"x64w.rpf\dlcpacks\mpbusiness\dlc.rpf\x64\models\cdimages\mpbusiness_ped_mp_overlay_txds.rpf\mp_eye_colour.ytd";

    public const string EyeColourTextureName = "mp_eye_colour";

    // ---- Skin tone (HeadBlend) parent texture naming ----

    /// <summary>
    /// Ethnicity suffixes for head/uppr/lowr/feet_diff_&lt;NNN&gt;_a_&lt;eth&gt;.ytd. The
    /// parent skin index does NOT carry an ethnicity by itself; the engine uses
    /// the ped's currently selected ethnicity. The freemode default is "whi";
    /// the compositor tries "whi" first, then the rest as a fallback so a
    /// missing variant still resolves to a real skin.
    /// </summary>
    public static readonly IReadOnlyList<string> SkinEthnicities = new[]
    {
        "whi", "bla", "lat", "chi", "pak", "ara",
    };

    /// <summary>Highest parent skin index present on disk (head/uppr/lowr/feet_diff up to 079).</summary>
    public const int MaxSkinParentIndex = 45;

    /// <summary>
    /// Builds the parent skin diffuse texture/dict base name for a body region
    /// ("head"/"uppr"/"lowr"/"feet") + parent index + ethnicity. The YTD file
    /// name equals the texture name: e.g. "head_diff_003_a_whi".
    /// </summary>
    public static string SkinDiffName(string region, int parentIndex, string ethnicity) =>
        string.Create(CultureInfo.InvariantCulture, $"{region}_diff_{parentIndex:000}_a_{ethnicity}");

    /// <summary>Body regions whose diffuse is re-composited to match the head skin tone.</summary>
    public static readonly IReadOnlyList<string> SkinRegions = new[] { "head", "uppr", "lowr", "feet" };

    // ---- Eye-colour atlas geometry (8x4 tiles, 64x64, row-major) ----
    public const int EyeAtlasCols = 8;
    public const int EyeAtlasRows = 4;
    public const int EyeAtlasTileW = 64;
    public const int EyeAtlasTileH = 64;
    public const int EyeColourMax = 31;

    /// <summary>Iris UV rect on the head diffuse (eyeball UV island isl272, both genders).</summary>
    public const float EyeUvU0 = 0.8331f;
    public const float EyeUvV0 = 0.8381f;
    public const float EyeUvU1 = 0.9281f;
    public const float EyeUvV1 = 0.9331f;

    // ---- Hair tint palette (64 RGB, community placeholder; verify in-game) ----

    /// <summary>True — the hair palette below is a community placeholder, not engine ground truth.</summary>
    public const bool HairColorsVerified = false;

    private static readonly string[] HairHex =
    {
        "#221c1a","#2f2922","#3b352f","#4a4039","#5c4f44","#6f5d4f","#82705b","#947f66",
        "#a78f72","#b99e7d","#cbab88","#d3b48f","#dcbf9b","#dfc6a4","#e3cbac","#e7d2b6",
        "#cdb595","#c3a883","#b89c74","#ac8e64","#a18055","#946f44","#875f34","#7a4f25",
        "#6e4019","#5e3411","#4f2a0b","#412108","#3a1d07","#331a06","#2c1705","#251404",
        "#dededb","#d6d6d2","#c6c6c2","#b3b3af","#a0a09c","#8d8d89","#7a7a76","#676763",
        "#545450","#41413d","#2e2e2a","#1b1b17","#9b6b4a","#7a4a32","#5e3624","#472718",
        "#33806c","#2d6e5b","#3b5fa0","#5a3214","#9a5a2a","#c83232","#11642f","#3264c8",
        "#ffff5a","#fe5caa","#dc95dc","#50b4ff","#b4cdff","#ff5050","#505050","#505050",
    };

    /// <summary>Decoded (R,G,B) hair tints, indexed by colour 0..63 (last entry pads to 64).</summary>
    public static readonly IReadOnlyList<(byte R, byte G, byte B)> HairColors =
        HairHex.Select(ParseHex).ToArray();

    /// <summary>
    /// Makeup tint table — EMPTY (not extractable from static game data; needs
    /// an in-game _GET_PED_MAKEUP_RGB_COLOR dump). Makeup/blush/lipstick render
    /// untinted until this is filled in.
    /// </summary>
    public static readonly IReadOnlyList<(byte R, byte G, byte B)> MakeupColors =
        Array.Empty<(byte, byte, byte)>();

    /// <summary>
    /// Looks up an RGB tint for an overlay colour index. Returns null when the
    /// palette is empty (makeup, not dumped yet) or the layer is untintable —
    /// the caller then blends the decal at its original colour.
    /// </summary>
    public static (byte R, byte G, byte B)? TintRgb(TintPalette palette, int colourIndex)
    {
        var table = palette switch
        {
            TintPalette.Hair => HairColors,
            TintPalette.Makeup => MakeupColors,
            _ => null,
        };
        if (table == null || table.Count == 0) return null;
        var idx = Math.Clamp(colourIndex, 0, table.Count - 1);
        return table[idx];
    }

    private static (byte R, byte G, byte B) ParseHex(string hex)
    {
        var h = hex.TrimStart('#');
        var r = byte.Parse(h.Substring(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        var g = byte.Parse(h.Substring(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        var b = byte.Parse(h.Substring(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return (r, g, b);
    }
}
