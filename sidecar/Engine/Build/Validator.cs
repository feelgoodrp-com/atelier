using System.Security.Cryptography;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// One validation finding. It carries NO sentence: <c>Code</c> identifies the
/// problem and <c>Params</c> holds the values to fill in, so the desktop app
/// renders it as <c>errors:findings.&lt;code&gt;</c> in the UI language.
/// </summary>
public sealed record Finding(
    string Severity, string Code, string? DrawableId, IReadOnlyDictionary<string, string> Params)
{
    /// <summary>Terse constructor, e.g. Of("error", "ydd_missing", id, ("label", label)).</summary>
    public static Finding Of(string severity, string code, string? drawableId,
        params (string Key, string Value)[] args) =>
        new(severity, code, drawableId, args.ToDictionary(a => a.Key, a => a.Value));
}

/// <summary>
/// Project validation for POST /validate and the pre-build gate. Findings are
/// language-neutral (code + params); severity "error" blocks a build,
/// "warn"/"info" do not.
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
                findings.Add(Finding.Of("error", "invalid_slot", id,
                    ("label", label), ("slot", drawable.Type ?? string.Empty), ("kind", drawable.Kind ?? string.Empty)));
                continue;
            }

            if (drawable.IsReplace && drawable.ReplaceTargetId == null)
            {
                findings.Add(Finding.Of("error", "replace_target_missing", id, ("label", label)));
            }
            else if (drawable.IsReplace && drawable.ReplaceTargetId != null)
            {
                // Two replaces aiming at the same vanilla slot produce identical
                // stream names — the later copy silently wins. Hard error.
                var replaceKey = $"{drawable.Gender}|{drawable.Type}|{drawable.ReplaceTargetId}";
                if (seenReplaceTargets.TryGetValue(replaceKey, out var firstReplaceLabel))
                {
                    findings.Add(Finding.Of("error", "duplicate_replace_target", id,
                        ("label", label), ("slot", drawable.Type ?? string.Empty),
                        ("target", drawable.ReplaceTargetId?.ToString() ?? string.Empty),
                        ("first", firstReplaceLabel)));
                }
                else
                {
                    seenReplaceTargets[replaceKey] = label;
                }
            }

            // --- YDD ---------------------------------------------------------
            if (drawable.Ydd?.Path == null)
            {
                findings.Add(Finding.Of("error", "ydd_missing", id, ("label", label)));
            }
            else
            {
                var yddPath = BuildPlanner.Resolve(projectDir, drawable.Ydd.Path);
                if (!File.Exists(yddPath))
                {
                    findings.Add(Finding.Of("error", "ydd_file_missing", id, ("label", label), ("path", yddPath)));
                }
                else
                {
                    var bytes = TryRead(yddPath);
                    if (bytes == null)
                    {
                        findings.Add(Finding.Of("error", "ydd_file_unreadable", id, ("label", label), ("path", yddPath)));
                    }
                    else
                    {
                        var hash = Sha256Hex(bytes);
                        if (!string.IsNullOrEmpty(drawable.Ydd.Hash) &&
                            !hash.Equals(drawable.Ydd.Hash, StringComparison.OrdinalIgnoreCase))
                        {
                            findings.Add(Finding.Of("error", "ydd_hash_mismatch", id, ("label", label)));
                        }

                        if (seenYddHashes.TryGetValue(hash, out var firstLabel))
                        {
                            findings.Add(Finding.Of("warn", "duplicate_ydd", id, ("label", label), ("first", firstLabel)));
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
                findings.Add(Finding.Of("warn", "no_textures", id, ("label", label)));
            }
            if (textures.Count > 26)
            {
                // Error, not warn: TextureLetter wraps modulo 26, so the 27th
                // texture would silently overwrite letter "a" in the output.
                findings.Add(Finding.Of("error", "too_many_textures", id,
                    ("label", label), ("count", textures.Count.ToString())));
            }

            for (var i = 0; i < textures.Count; i++)
            {
                var texture = textures[i];
                var letter = StreamNames.TextureLetter(i);
                if (texture.Path == null)
                {
                    findings.Add(Finding.Of("error", "texture_path_missing", id, ("label", label), ("letter", letter)));
                    continue;
                }

                var texPath = BuildPlanner.Resolve(projectDir, texture.Path);
                if (!File.Exists(texPath))
                {
                    findings.Add(Finding.Of("error", "texture_file_missing", id,
                        ("label", label), ("letter", letter), ("path", texPath)));
                    continue;
                }

                var texBytes = TryRead(texPath);
                if (texBytes == null)
                {
                    findings.Add(Finding.Of("error", "texture_file_unreadable", id,
                        ("label", label), ("letter", letter), ("path", texPath)));
                    continue;
                }

                if (!string.IsNullOrEmpty(texture.Hash) &&
                    !Sha256Hex(texBytes).Equals(texture.Hash, StringComparison.OrdinalIgnoreCase))
                {
                    findings.Add(Finding.Of("error", "texture_hash_mismatch", id, ("label", label), ("letter", letter)));
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
                findings.Add(Finding.Of("warn", "missing_lods", id,
                    ("label", label), ("lods", string.Join("/", missing))));
            }
        }
        catch (Exception ex)
        {
            findings.Add(Finding.Of("error", "ydd_parse_failed", id, ("label", label), ("error", ex.Message)));
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
                    findings.Add(Finding.Of("warn", "texture_large", id,
                        ("label", label), ("letter", letter), ("texture", texture.Name ?? string.Empty),
                        ("width", texture.Width.ToString()), ("height", texture.Height.ToString())));
                }
                if (!texture.IsPowerOfTwo)
                {
                    findings.Add(Finding.Of("warn", "texture_not_pot", id,
                        ("label", label), ("letter", letter), ("texture", texture.Name ?? string.Empty),
                        ("width", texture.Width.ToString()), ("height", texture.Height.ToString())));
                }
            }
        }
        catch (Exception ex)
        {
            findings.Add(Finding.Of("error", "ytd_parse_failed", id,
                ("label", label), ("letter", letter), ("error", ex.Message)));
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
            findings.Add(Finding.Of("info", "bucket_count", null,
                ("count", count.ToString()), ("gender", gender), ("slot", slot), ("mode", mode)));

            if (mode == "addon" && count > splitAt)
            {
                findings.Add(Finding.Of("warn", "bucket_split", null,
                    ("gender", gender), ("slot", slot), ("count", count.ToString()), ("limit", splitAt.ToString())));
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
