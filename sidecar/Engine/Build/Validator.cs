using System.Security.Cryptography;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

public sealed record Finding(string Severity, string Code, string? DrawableId, string Message);

/// <summary>
/// Project validation for POST /validate and the pre-build gate. Findings use
/// German messages; severity "error" blocks a build, "warn"/"info" do not.
/// </summary>
public static class Validator
{
    /// <param name="log">
    /// Optional progress sink. Validation reads and parses EVERY ydd and ytd,
    /// which runs for minutes on a big project — without a per-item line the
    /// app looks frozen and a hang cannot be attributed to a file.
    /// </param>
    public static List<Finding> Validate(
        AtelierProjectDto project,
        string projectDir,
        int splitAt,
        ILogger? log = null)
    {
        var findings = new List<Finding>();
        var drawables = project.Drawables ?? new List<ProjectDrawableDto>();
        var total = drawables.Count;
        var index = 0;

        // hash -> first drawable label, for duplicate detection.
        var seenYddHashes = new Dictionary<string, string>();
        // (gender|slot|targetId) -> first label, for replace-collision detection.
        var seenReplaceTargets = new Dictionary<string, string>();

        foreach (var drawable in drawables)
        {
            var id = drawable.Id;
            var label = drawable.DisplayLabel;

            // Emitted BEFORE the expensive work so a stall names its culprit.
            log?.LogInformation("Validating drawable {Index}/{Total}: {Label}", ++index, total, label);

            if (!GtaSlots.IsValidSlot(drawable))
            {
                findings.Add(new Finding("error", "invalid_slot", id,
                    $"Drawable \"{label}\": Slot \"{drawable.Type}\" passt nicht zu Kind \"{drawable.Kind}\"."));
                continue;
            }

            if (drawable.IsReplace && drawable.ReplaceTargetId == null)
            {
                findings.Add(new Finding("error", "replace_target_missing", id,
                    $"Drawable \"{label}\": Replace-Modus ohne replaceTargetId."));
            }
            else if (drawable.IsReplace && drawable.ReplaceTargetId != null)
            {
                // Two replaces aiming at the same vanilla slot produce identical
                // stream names — the later copy silently wins. Hard error.
                var replaceKey = $"{drawable.Gender}|{drawable.Type}|{drawable.ReplaceTargetId}";
                if (seenReplaceTargets.TryGetValue(replaceKey, out var firstReplaceLabel))
                {
                    findings.Add(new Finding("error", "duplicate_replace_target", id,
                        $"Drawable \"{label}\": gleiches Replace-Ziel ({drawable.Type} #{drawable.ReplaceTargetId}) wie \"{firstReplaceLabel}\" — die Dateien würden sich gegenseitig überschreiben."));
                }
                else
                {
                    seenReplaceTargets[replaceKey] = label;
                }
            }

            // --- YDD ---------------------------------------------------------
            if (drawable.Ydd?.Path == null)
            {
                findings.Add(new Finding("error", "ydd_missing", id,
                    $"Drawable \"{label}\": keine YDD-Datei zugewiesen."));
            }
            else
            {
                var yddPath = BuildPlanner.Resolve(projectDir, drawable.Ydd.Path);
                if (!File.Exists(yddPath))
                {
                    findings.Add(new Finding("error", "ydd_file_missing", id,
                        $"Drawable \"{label}\": YDD-Datei nicht gefunden: {yddPath}"));
                }
                else
                {
                    var bytes = TryRead(yddPath);
                    if (bytes == null)
                    {
                        findings.Add(new Finding("error", "ydd_file_unreadable", id,
                            $"Drawable \"{label}\": YDD-Datei konnte nicht gelesen werden: {yddPath}"));
                    }
                    else
                    {
                        var hash = Sha256Hex(bytes);
                        if (!string.IsNullOrEmpty(drawable.Ydd.Hash) &&
                            !hash.Equals(drawable.Ydd.Hash, StringComparison.OrdinalIgnoreCase))
                        {
                            findings.Add(new Finding("error", "ydd_hash_mismatch", id,
                                $"Drawable \"{label}\": YDD-Datei wurde verändert (Hash stimmt nicht mit dem Projekt überein)."));
                        }

                        if (seenYddHashes.TryGetValue(hash, out var firstLabel))
                        {
                            findings.Add(new Finding("warn", "duplicate_ydd", id,
                                $"Drawable \"{label}\": identische YDD-Datei wie \"{firstLabel}\" (gleicher Hash)."));
                        }
                        else
                        {
                            seenYddHashes[hash] = label;
                        }

                        CheckYddLods(findings, id, label, bytes);
                    }
                }
            }

            // --- textures ------------------------------------------------------
            var textures = drawable.Textures ?? new List<AssetRefDto>();
            if (textures.Count == 0)
            {
                findings.Add(new Finding("warn", "no_textures", id,
                    $"Drawable \"{label}\": keine Texturen — in-game wäre das Drawable unsichtbar texturiert."));
            }
            if (textures.Count > 26)
            {
                // Error, not warn: TextureLetter wraps modulo 26, so the 27th
                // texture would silently overwrite letter "a" in the output.
                findings.Add(new Finding("error", "too_many_textures", id,
                    $"Drawable \"{label}\": {textures.Count} Texturen — das Spiel unterstützt maximal 26 (a–z)."));
            }

            for (var i = 0; i < textures.Count; i++)
            {
                var texture = textures[i];
                var letter = StreamNames.TextureLetter(i);
                if (texture.Path == null)
                {
                    findings.Add(new Finding("error", "texture_file_missing", id,
                        $"Drawable \"{label}\": Textur {letter} hat keinen Pfad."));
                    continue;
                }

                var texPath = BuildPlanner.Resolve(projectDir, texture.Path);
                if (!File.Exists(texPath))
                {
                    findings.Add(new Finding("error", "texture_file_missing", id,
                        $"Drawable \"{label}\": Textur {letter} nicht gefunden: {texPath}"));
                    continue;
                }

                var texBytes = TryRead(texPath);
                if (texBytes == null)
                {
                    findings.Add(new Finding("error", "texture_file_unreadable", id,
                        $"Drawable \"{label}\": Textur {letter} konnte nicht gelesen werden: {texPath}"));
                    continue;
                }

                if (!string.IsNullOrEmpty(texture.Hash) &&
                    !Sha256Hex(texBytes).Equals(texture.Hash, StringComparison.OrdinalIgnoreCase))
                {
                    findings.Add(new Finding("error", "texture_hash_mismatch", id,
                        $"Drawable \"{label}\": Textur {letter} wurde verändert (Hash stimmt nicht mit dem Projekt überein)."));
                }

                CheckYtd(findings, id, label, letter, texBytes);
            }
        }

        AddBucketFindings(findings, drawables, splitAt);

        return findings;
    }

    public static bool HasErrors(IEnumerable<Finding> findings) =>
        findings.Any(f => f.Severity == "error");

    private static void CheckYddLods(List<Finding> findings, string? id, string label, byte[] bytes)
    {
        try
        {
            var drawableInfos = YddParser.Parse(bytes);
            var missing = new List<string>();
            if (!drawableInfos.Any(d => d.Lods.Med)) missing.Add("Med");
            if (!drawableInfos.Any(d => d.Lods.Low)) missing.Add("Low");
            if (missing.Count > 0)
            {
                findings.Add(new Finding("warn", "missing_lods", id,
                    $"Drawable \"{label}\": YDD ohne {string.Join("/", missing)}-LOD — kann in-game ab mittlerer Distanz unsichtbar sein."));
            }
        }
        catch (Exception ex)
        {
            findings.Add(new Finding("error", "ydd_parse_failed", id,
                $"Drawable \"{label}\": YDD-Datei konnte nicht geparst werden: {ex.Message}"));
        }
    }

    private static void CheckYtd(List<Finding> findings, string? id, string label, string letter, byte[] bytes)
    {
        try
        {
            foreach (var texture in YtdParser.Parse(bytes))
            {
                if (texture.Width > 2048 || texture.Height > 2048)
                {
                    findings.Add(new Finding("warn", "texture_large", id,
                        $"Drawable \"{label}\": Textur {letter} ({texture.Name}) ist {texture.Width}x{texture.Height} — über 2048px kostet unnötig Speicher; /texture/optimize kann verkleinern."));
                }
                if (!texture.IsPowerOfTwo)
                {
                    findings.Add(new Finding("warn", "texture_not_pot", id,
                        $"Drawable \"{label}\": Textur {letter} ({texture.Name}) ist {texture.Width}x{texture.Height} — keine Zweierpotenz, das Spiel rendert sie evtl. fehlerhaft."));
                }
            }
        }
        catch (Exception ex)
        {
            findings.Add(new Finding("error", "ytd_parse_failed", id,
                $"Drawable \"{label}\": Textur {letter} konnte nicht geparst werden: {ex.Message}"));
        }
    }

    private static void AddBucketFindings(List<Finding> findings, List<ProjectDrawableDto> drawables, int splitAt)
    {
        var buckets = drawables
            .Where(GtaSlots.IsValidSlot)
            .GroupBy(d => (Gender: d.Gender ?? "male", Slot: d.Type!, Mode: d.Mode ?? "addon"))
            .OrderBy(g => g.Key.Gender).ThenBy(g => g.Key.Slot).ThenBy(g => g.Key.Mode);

        foreach (var bucket in buckets)
        {
            var (gender, slot, mode) = bucket.Key;
            var count = bucket.Count();
            findings.Add(new Finding("info", "bucket_count", null,
                $"{count} Drawable(s) im Bucket {gender}/{slot}/{mode}."));

            if (mode == "addon" && count > splitAt)
            {
                findings.Add(new Finding("warn", "bucket_split", null,
                    $"Bucket {gender}/{slot}: {count} Drawables überschreiten das Limit von {splitAt} — der Build wird in mehrere _partN-Ressourcen aufgeteilt."));
            }
        }
    }

    private static byte[]? TryRead(string path)
    {
        try { return File.ReadAllBytes(path); }
        catch { return null; }
    }

    private static string Sha256Hex(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
