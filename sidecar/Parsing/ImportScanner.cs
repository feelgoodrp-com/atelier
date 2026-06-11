using System.Text.Json;
using System.Text.RegularExpressions;
using Feelgood.Atelier.Sidecar.Api;

namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Scans a folder for GTA V clothing assets (.ydd with sibling .ytd/.yld) and
/// groups them into import candidates via the common FiveM naming conventions
/// (behavior cross-checked against the Feelgood creative cloth-gta-filename
/// parser and real stream/ layouts):
///   mp_m_freemode_01_mydlc^jbib_000_u.ydd + mp_m_freemode_01_mydlc^jbib_diff_000_a_uni.ytd
///   jbib_000_u.ydd + jbib_diff_000_a_uni.ytd
///   p_head_000.ydd + p_head_diff_000_a.ytd
/// Folders containing a Feelgood Creative export (pack-metadata.json next to
/// the stream files) are mapped via that metadata with high confidence.
/// </summary>
public static class ImportScanner
{
    private const int MaxDepth = 6;
    private const int MaxFiles = 5000;
    private const int MaxUnmatchedWarnings = 15;

    private static readonly HashSet<string> IgnoredDirNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".svn", ".hg", ".vs", ".idea", ".vscode", "node_modules",
        "__pycache__", "$recycle.bin", "system volume information",
    };

    private static readonly HashSet<string> ComponentSlots = new(StringComparer.Ordinal)
    {
        "head", "berd", "hair", "uppr", "lowr", "hand", "feet", "teef", "accs", "task", "decl", "jbib",
    };

    private static readonly HashSet<string> PropSlots = new(StringComparer.Ordinal)
    {
        "p_head", "p_eyes", "p_ears", "p_lwrist", "p_rwrist", "p_hip",
    };

    /// <summary>
    /// Creative pack-metadata componentId -> slot. Canonical GTA ped component
    /// order (matches atelier/src/lib/gta/components.ts): 7 = teef, 8 = accs.
    /// </summary>
    private static readonly Dictionary<int, string> ComponentIdToSlot = new()
    {
        [0] = "head", [1] = "berd", [2] = "hair", [3] = "uppr", [4] = "lowr", [5] = "hand",
        [6] = "feet", [7] = "teef", [8] = "accs", [9] = "task", [10] = "decl", [11] = "jbib",
    };

    // Full convention: jbib_000_u.ydd (slot must additionally be a known component slot).
    private static readonly Regex YddComponentFull =
        new(@"^(?<slot>[a-z]+)_(?<num>\d{3})_(?<variant>[a-z])\.ydd$", RegexOptions.Compiled);

    // Full prop convention: p_head_000.ydd (an optional variant letter also occurs in the wild).
    private static readonly Regex YddPropFull =
        new(@"^(?<slot>p_[a-z]+)_(?<num>\d{3})(?:_(?<variant>[a-z]))?\.ydd$", RegexOptions.Compiled);

    // Diffuse textures: jbib_diff_000_a_uni.ytd / jbib_diff_000_a.ytd / p_head_diff_000_a.ytd
    private static readonly Regex YtdDiff =
        new(@"^(?<slot>[a-z0-9_]+?)_diff_(?<num>\d{1,3})_(?<letter>[a-z])(?:_[a-z0-9_]+)?\.ytd$", RegexOptions.Compiled);

    // Normal/specular maps follow the same scheme but have no place in the entry shape.
    private static readonly Regex YtdOtherMap =
        new(@"^[a-z0-9_]+?_(?:n|nrm|normal|s|spec|specular)_\d{1,3}_[a-z](?:_[a-z0-9_]+)?\.(?:ytd)$", RegexOptions.Compiled);

    // Loose fallbacks for "medium" confidence (known slot token + some number).
    private static readonly Regex LoosePropSlot =
        new(@"(?:^|_)(?<slot>p_(?:head|eyes|ears|lwrist|rwrist|hip))(?:_|\.)", RegexOptions.Compiled);
    private static readonly Regex LooseComponentSlot =
        new(@"(?:^|_)(?<slot>head|berd|hair|uppr|lowr|hand|feet|teef|accs|task|decl|jbib)(?:_|\.)", RegexOptions.Compiled);
    private static readonly Regex LooseNumber =
        new(@"(?:^|_)(?<num>\d{1,3})(?:_|\.|$)", RegexOptions.Compiled);

    // Gender markers in file or folder names (mp_m_freemode_01, mp_f, ...).
    private static readonly Regex MaleMarker =
        new(@"(?:^|[^a-z])mp_m(?![a-z])|_m_freemode", RegexOptions.Compiled);
    private static readonly Regex FemaleMarker =
        new(@"(?:^|[^a-z])mp_f(?![a-z])|_f_freemode", RegexOptions.Compiled);

    private sealed class YddCandidate
    {
        public required string Path { get; init; }
        public required string Prefix { get; init; }   // ped prefix incl. '^' (lowercase), "" if none
        public required string BaseName { get; init; } // file name after the prefix (lowercase)
        public string? Slot { get; set; }
        public string? Kind { get; set; }
        public int? DrawableId { get; set; }
        public string Confidence { get; set; } = "low";
        public string? YldPath { get; set; }
        public List<ImportScanTexture> Textures { get; } = new();
    }

    public static (IReadOnlyList<ImportScanEntry> Entries, IReadOnlyList<string> Warnings) Scan(
        string folderPath, ILogger? log = null)
    {
        var root = Path.GetFullPath(folderPath);
        var warnings = new List<string>();
        var filesByDir = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        var fileCount = 0;
        var truncated = false;
        var depthLimited = false;
        Walk(root, 0, filesByDir, ref fileCount, ref truncated, ref depthLimited, warnings);

        if (truncated)
            warnings.Add($"Maximale Dateianzahl ({MaxFiles}) erreicht – der Scan wurde abgebrochen.");
        if (depthLimited)
            warnings.Add($"Maximale Ordnertiefe ({MaxDepth}) erreicht – tiefere Ordner wurden übersprungen.");

        var entries = new List<ImportScanEntry>();
        var unmatchedTextures = new List<string>();
        var ignoredMapCount = 0;

        foreach (var (dir, files) in filesByDir)
        {
            var consumed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            TryApplyPackMetadata(dir, root, files, entries, consumed, warnings, log);
            ScanByConvention(dir, root, files, entries, consumed, unmatchedTextures, ref ignoredMapCount);
        }

        if (ignoredMapCount > 0)
            warnings.Add($"Normal-/Specular-Maps wurden ignoriert ({ignoredMapCount} Datei(en)).");

        foreach (var texture in unmatchedTextures.Take(MaxUnmatchedWarnings))
            warnings.Add($"Textur ohne passendes YDD: {texture}");
        if (unmatchedTextures.Count > MaxUnmatchedWarnings)
            warnings.Add($"... und {unmatchedTextures.Count - MaxUnmatchedWarnings} weitere Texturen ohne passendes YDD.");

        entries.Sort(static (a, b) => string.Compare(a.YddPath, b.YddPath, StringComparison.OrdinalIgnoreCase));
        return (entries, warnings);
    }

    private static void Walk(
        string dir, int depth,
        Dictionary<string, List<string>> filesByDir,
        ref int fileCount, ref bool truncated, ref bool depthLimited,
        List<string> warnings)
    {
        string[] files;
        string[] subDirs;
        try
        {
            files = Directory.GetFiles(dir);
            subDirs = Directory.GetDirectories(dir);
        }
        catch (Exception ex)
        {
            warnings.Add($"Ordner nicht lesbar: {dir} ({ex.Message})");
            return;
        }

        foreach (var file in files)
        {
            if (fileCount >= MaxFiles)
            {
                truncated = true;
                return;
            }
            fileCount++;

            var extension = Path.GetExtension(file).ToLowerInvariant();
            var isRelevant = extension is ".ydd" or ".ytd" or ".yld" ||
                string.Equals(Path.GetFileName(file), "pack-metadata.json", StringComparison.OrdinalIgnoreCase);
            if (!isRelevant) continue;

            if (!filesByDir.TryGetValue(dir, out var list))
                filesByDir[dir] = list = new List<string>();
            list.Add(file);
        }

        if (depth >= MaxDepth)
        {
            if (subDirs.Length > 0) depthLimited = true;
            return;
        }

        foreach (var subDir in subDirs)
        {
            if (IgnoredDirNames.Contains(Path.GetFileName(subDir))) continue;
            Walk(subDir, depth + 1, filesByDir, ref fileCount, ref truncated, ref depthLimited, warnings);
            if (truncated) return;
        }
    }

    /// <summary>
    /// Feelgood Creative export: pack-metadata.json (next to the stream files)
    /// lists every drawable with componentId/drawableId and export file names.
    /// </summary>
    private static void TryApplyPackMetadata(
        string dir, string root, List<string> files,
        List<ImportScanEntry> entries, HashSet<string> consumed,
        List<string> warnings, ILogger? log)
    {
        var metaPath = files.FirstOrDefault(static f =>
            string.Equals(Path.GetFileName(f), "pack-metadata.json", StringComparison.OrdinalIgnoreCase));
        if (metaPath == null) return;

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(File.ReadAllText(metaPath));
        }
        catch (Exception ex)
        {
            log?.LogWarning(ex, "Failed to parse {MetaPath}", metaPath);
            warnings.Add($"pack-metadata.json konnte nicht gelesen werden ({metaPath}): {ex.Message}");
            return;
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                !doc.RootElement.TryGetProperty("drawables", out var drawables) ||
                drawables.ValueKind != JsonValueKind.Array)
            {
                warnings.Add($"pack-metadata.json ohne 'drawables'-Liste: {metaPath}");
                return;
            }

            foreach (var drawable in drawables.EnumerateArray())
            {
                if (drawable.ValueKind != JsonValueKind.Object) continue;

                var yddName = GetString(drawable, "exportYddName");
                if (string.IsNullOrWhiteSpace(yddName)) continue;
                var yddPath = FindFile(files, yddName);
                if (yddPath == null) continue;

                int? drawableId = drawable.TryGetProperty("drawableId", out var idEl) &&
                    idEl.ValueKind == JsonValueKind.Number && idEl.TryGetInt32(out var id) ? id : null;
                string? slot = drawable.TryGetProperty("componentId", out var compEl) &&
                    compEl.ValueKind == JsonValueKind.Number && compEl.TryGetInt32(out var comp) &&
                    ComponentIdToSlot.TryGetValue(comp, out var mapped) ? mapped : null;

                var textures = new List<ImportScanTexture>();
                if (drawable.TryGetProperty("exportYtdNames", out var ytdNames) &&
                    ytdNames.ValueKind == JsonValueKind.Array)
                {
                    var index = 0;
                    foreach (var ytdNameEl in ytdNames.EnumerateArray())
                    {
                        if (ytdNameEl.ValueKind != JsonValueKind.String) continue;
                        var ytdPath = FindFile(files, ytdNameEl.GetString()!);
                        if (ytdPath == null) continue;

                        // Variant letter from the file name; array order as fallback.
                        var (_, ytdBase) = SplitPedPrefix(Path.GetFileName(ytdPath).ToLowerInvariant());
                        var diffMatch = YtdDiff.Match(ytdBase);
                        var letter = diffMatch.Success
                            ? diffMatch.Groups["letter"].Value
                            : ((char)('a' + Math.Min(index, 25))).ToString();
                        textures.Add(new ImportScanTexture(ytdPath, letter));
                        consumed.Add(ytdPath);
                        index++;
                    }
                }
                textures.Sort(static (a, b) => string.CompareOrdinal(a.Letter, b.Letter));

                consumed.Add(yddPath);
                entries.Add(new ImportScanEntry(
                    yddPath,
                    GuessGender(yddPath, root),
                    "component", // creative packs are component-only
                    slot,
                    drawableId,
                    textures,
                    YldPath: null,
                    Confidence: "high"));
            }
        }
    }

    private static void ScanByConvention(
        string dir, string root, List<string> files,
        List<ImportScanEntry> entries, HashSet<string> consumed,
        List<string> unmatchedTextures, ref int ignoredMapCount)
    {
        var candidates = new List<YddCandidate>();

        foreach (var file in files)
        {
            if (consumed.Contains(file)) continue;
            if (!string.Equals(Path.GetExtension(file), ".ydd", StringComparison.OrdinalIgnoreCase)) continue;

            var (prefix, baseName) = SplitPedPrefix(Path.GetFileName(file).ToLowerInvariant());
            var candidate = new YddCandidate { Path = file, Prefix = prefix, BaseName = baseName };
            ClassifyYdd(candidate);
            candidates.Add(candidate);
        }

        foreach (var file in files)
        {
            if (consumed.Contains(file)) continue;
            var extension = Path.GetExtension(file).ToLowerInvariant();

            if (extension == ".ytd")
            {
                var (prefix, baseName) = SplitPedPrefix(Path.GetFileName(file).ToLowerInvariant());
                var diff = YtdDiff.Match(baseName);
                if (diff.Success)
                {
                    var owner = FindOwner(candidates, prefix, diff.Groups["slot"].Value,
                        ParseNumber(diff.Groups["num"].Value));
                    if (owner != null)
                        owner.Textures.Add(new ImportScanTexture(file, diff.Groups["letter"].Value));
                    else
                        unmatchedTextures.Add(file);
                }
                else if (YtdOtherMap.IsMatch(baseName))
                {
                    ignoredMapCount++;
                }
                else
                {
                    unmatchedTextures.Add(file);
                }
            }
            else if (extension == ".yld")
            {
                var fileName = Path.GetFileName(file).ToLowerInvariant();
                var stem = fileName[..^".yld".Length];

                // Prefer the exact ydd twin (same name, .yld extension), then slot+number.
                var owner = candidates.FirstOrDefault(c =>
                        string.Equals(Path.GetFileNameWithoutExtension(c.Path), stem, StringComparison.OrdinalIgnoreCase));
                if (owner == null)
                {
                    var (prefix, baseName) = SplitPedPrefix(fileName);
                    var probe = new YddCandidate { Path = file, Prefix = prefix, BaseName = baseName.Replace(".yld", ".ydd") };
                    ClassifyYdd(probe);
                    if (probe.Slot != null && probe.DrawableId != null)
                        owner = FindOwner(candidates, prefix, probe.Slot, probe.DrawableId);
                }
                if (owner is { YldPath: null })
                    owner.YldPath = file;
            }
        }

        foreach (var candidate in candidates)
        {
            candidate.Textures.Sort(static (a, b) =>
            {
                var byLetter = string.CompareOrdinal(a.Letter, b.Letter);
                return byLetter != 0 ? byLetter : string.Compare(a.Path, b.Path, StringComparison.OrdinalIgnoreCase);
            });

            entries.Add(new ImportScanEntry(
                candidate.Path,
                GuessGender(candidate.Path, root),
                candidate.Kind,
                candidate.Slot,
                candidate.DrawableId,
                candidate.Textures,
                candidate.YldPath,
                candidate.Confidence));
        }
    }

    private static void ClassifyYdd(YddCandidate candidate)
    {
        var propFull = YddPropFull.Match(candidate.BaseName);
        if (propFull.Success && PropSlots.Contains(propFull.Groups["slot"].Value))
        {
            candidate.Slot = propFull.Groups["slot"].Value;
            candidate.Kind = "prop";
            candidate.DrawableId = ParseNumber(propFull.Groups["num"].Value);
            candidate.Confidence = "high";
            return;
        }

        var componentFull = YddComponentFull.Match(candidate.BaseName);
        if (componentFull.Success && ComponentSlots.Contains(componentFull.Groups["slot"].Value))
        {
            candidate.Slot = componentFull.Groups["slot"].Value;
            candidate.Kind = "component";
            candidate.DrawableId = ParseNumber(componentFull.Groups["num"].Value);
            candidate.Confidence = "high";
            return;
        }

        // Loose: a known slot token plus some number -> medium; anything less -> low.
        var looseProp = LoosePropSlot.Match(candidate.BaseName);
        var looseComponent = looseProp.Success ? Match.Empty : LooseComponentSlot.Match(candidate.BaseName);
        if (looseProp.Success)
        {
            candidate.Slot = looseProp.Groups["slot"].Value;
            candidate.Kind = "prop";
        }
        else if (looseComponent.Success)
        {
            candidate.Slot = looseComponent.Groups["slot"].Value;
            candidate.Kind = "component";
        }

        var number = LooseNumber.Match(candidate.BaseName);
        if (number.Success)
            candidate.DrawableId = ParseNumber(number.Groups["num"].Value);

        candidate.Confidence = candidate.Slot != null && candidate.DrawableId != null ? "medium" : "low";
    }

    private static YddCandidate? FindOwner(List<YddCandidate> candidates, string prefix, string slot, int? drawableId)
    {
        if (drawableId == null) return null;

        var exact = candidates.Where(c =>
            c.Prefix == prefix && c.Slot == slot && c.DrawableId == drawableId).ToList();
        if (exact.Count == 1) return exact[0];
        if (exact.Count > 1) return null; // ambiguous, leave unmatched

        // Mixed layouts (ydd with ped prefix, textures without or vice versa):
        // fall back to slot+number when that is unambiguous within the folder.
        var bySlot = candidates.Where(c => c.Slot == slot && c.DrawableId == drawableId).ToList();
        return bySlot.Count == 1 ? bySlot[0] : null;
    }

    /// <summary>mp_m_freemode_01_mydlc^jbib_000_u.ydd -> ("mp_m_freemode_01_mydlc^", "jbib_000_u.ydd")</summary>
    private static (string Prefix, string BaseName) SplitPedPrefix(string fileNameLower)
    {
        var caret = fileNameLower.IndexOf('^');
        return caret < 0
            ? (string.Empty, fileNameLower)
            : (fileNameLower[..(caret + 1)], fileNameLower[(caret + 1)..]);
    }

    private static string? GuessGender(string filePath, string root)
    {
        // Only look at the path below the scan root so unrelated parent folder
        // names cannot leak into the guess.
        var relative = Path.GetRelativePath(root, filePath).ToLowerInvariant();
        if (MaleMarker.IsMatch(relative)) return "male";
        if (FemaleMarker.IsMatch(relative)) return "female";
        return null;
    }

    private static int? ParseNumber(string raw) =>
        int.TryParse(raw, out var value) ? value : null;

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? FindFile(List<string> files, string fileName) =>
        files.FirstOrDefault(f =>
            string.Equals(Path.GetFileName(f), fileName, StringComparison.OrdinalIgnoreCase));
}
