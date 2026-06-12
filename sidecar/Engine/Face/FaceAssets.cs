using CodeWalker.GameFiles;
using CodeWalker.Utils;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Engine.Face;

/// <summary>
/// Thrown when a face source asset load fails for a TRANSIENT reason (an IO
/// contention / sharing violation / timeout — NOT a deterministic "file
/// missing / dictionary broken"). The compositor catches it, skips caching the
/// degraded region AND propagates a transient flag so neither the region LRU
/// nor the GLB endpoint freezes a momentarily-degraded face under its key — the
/// Stufe-1 cache-poisoning lesson, applied to face assets (see PedBodyService
/// HadTransientLoadFailure / the X-FG-Transient-Degraded header). A genuinely
/// missing/broken asset is deterministic and may be cached.
/// </summary>
public sealed class TransientFaceLoadException : Exception
{
    public TransientFaceLoadException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// Lazy, RpfMan-backed loader for the raw face-rendering source textures
/// (parent skin diffuse, faov overlay decals, eye-colour atlas), decoded to
/// straight RGBA8 and held in a byte-budgeted LRU. Mirrors the Stage-1
/// component LRU in <see cref="PedBodyService"/> but for full-image pixel
/// buffers instead of drawables.
///
/// All loads go through GameFileCache.RpfMan.GetFile&lt;YtdFile&gt;(path), which
/// extracts + parses the dictionary synchronously off the calling thread (no
/// content-pump wait needed — these are on-disk dictionary files, not the
/// streamed component dicts). DDSIO.GetPixels returns BGRA, so every decode
/// runs through <see cref="PixelSwizzle.BgraToRgbaInPlace"/> exactly once
/// before the buffer leaves this loader.
/// </summary>
public sealed class FaceAssets
{
    /// <summary>One decoded source image: straight RGBA8, width*height*4 bytes.</summary>
    public sealed record Image(byte[] Rgba, int Width, int Height)
    {
        public long ApproxBytes => Rgba.LongLength;
    }

    private readonly ILogger _log;
    private readonly GameFileCache _cache;

    // Byte-budgeted LRU keyed by a fully-qualified asset id (rpf path or
    // "category|index" composite). Decoded face source images are 512x512x4 =
    // 1 MB (overlays/skins) or 512x256x4 = 0.5 MB (eye atlas); the ~128 MB
    // budget keeps a working set warm without unbounded growth.
    private const int Capacity = 192;
    private const long ByteBudget = 128L * 1024L * 1024L;
    private readonly object _gate = new();
    private readonly Dictionary<string, LinkedListNode<(string Key, Image? Value, long Bytes)>> _map = new();
    private readonly LinkedList<(string Key, Image? Value, long Bytes)> _lru = new();
    private long _bytes;

    public FaceAssets(GameFileCache cache, ILogger log)
    {
        _cache = cache;
        _log = log;
    }

    /// <summary>
    /// Resolves a faov overlay decal for a slot + index to a decoded RGBA
    /// image. The slot's calibrated categories are tried in order (gendered
    /// slots front-load the matching male/female category); the first whose
    /// "&lt;folder&gt;\&lt;category&gt;_&lt;NNN&gt;.ytd" resolves AND contains the named
    /// texture wins.
    ///
    /// An index OUTSIDE a category's [MinIndex, MaxIndex] is SKIPPED for that
    /// category — it is NOT clamped to MaxIndex. Clamping would silently render
    /// a different, wrong-but-plausible decal (e.g. brow 30 -> brow 16) and,
    /// because the canonical key keeps the UNCLAMPED index, two distinct keys
    /// would map to the same image and waste cache slots. Returning null lets
    /// the caller treat the slot as "off" and record an "overlay:&lt;slot&gt;"
    /// fallback instead of showing the wrong brow. Returns null when no
    /// category resolves an in-range texture.
    /// </summary>
    public Image? LoadOverlay(FaceCalibration.OverlaySlot slot, int index, bool isFemale)
    {
        foreach (var category in FaceCalibration.ResolveCategories(slot, isFemale))
        {
            if (!FaceCalibration.Categories.TryGetValue(category, out var cat)) continue;
            // Out-of-range for this category — skip it (do NOT clamp to a wrong
            // texture). Another category for the slot may still cover the index.
            if (index < cat.MinIndex || index > cat.MaxIndex) continue;
            var textureName = string.Create(System.Globalization.CultureInfo.InvariantCulture,
                $"{category}_{index:000}");
            var cacheKey = $"ov|{textureName}";

            var image = GetOrLoad(cacheKey, () => LoadTextureFromFolders(
                FaceCalibration.OverlayRpfFolders, $"{textureName}.ytd", textureName));
            if (image != null) return image;
        }
        return null;
    }

    /// <summary>
    /// Resolves a parent skin diffuse (head/uppr/lowr/feet) for a parent index.
    /// The freemode ped's OWN per-index head diffuse is tried first (model
    /// folder), then the shared mp_headtargets parents; the requested ethnicity
    /// leads, the remaining ethnicities are fallbacks. Returns null when no
    /// variant resolves.
    /// </summary>
    public Image? LoadSkin(string pedModel, string region, int parentIndex, string ethnicity)
    {
        var clamped = Math.Clamp(parentIndex, 0, FaceCalibration.MaxSkinParentIndex);
        // Preferred ethnicity first, then the rest (a missing variant still
        // resolves to a real skin instead of falling through to grey).
        var ethnicities = new List<string> { ethnicity };
        ethnicities.AddRange(FaceCalibration.SkinEthnicities.Where(e => e != ethnicity));

        foreach (var eth in ethnicities)
        {
            var name = FaceCalibration.SkinDiffName(region, clamped, eth);
            var cacheKey = $"skin|{name}";
            var fileName = $"{name}.ytd";

            // The freemode HEAD diffuse lives in the per-ped model folder; the
            // uppr/lowr/feet body skins (and the shared head parents) live in
            // mp_headtargets.
            var image = GetOrLoad(cacheKey, () =>
            {
                if (region == "head")
                {
                    var own = LoadTextureFromFolders(
                        new[] { FaceCalibration.FreemodeModelFolder(pedModel) }, fileName, name);
                    if (own != null) return own;
                }
                return LoadTextureFromFolders(FaceCalibration.HeadTargetFolders, fileName, name);
            });
            if (image != null) return image;
        }
        return null;
    }

    /// <summary>The eye-colour atlas (mp_eye_colour, 512x256 DXT5), decoded once.</summary>
    public Image? LoadEyeAtlas()
    {
        return GetOrLoad("eye|atlas", () =>
        {
            var ytd = TryGetYtd(FaceCalibration.EyeColourRpfPath);
            if (ytd == null) return null;
            var tex = ytd.TextureDict?.Lookup(JenkHash.GenHash(FaceCalibration.EyeColourTextureName))
                      ?? ytd.TextureDict?.Textures?.data_items?.FirstOrDefault(t => t != null);
            return Decode(tex);
        });
    }

    /// <summary>
    /// Tries the given folders in order, building "&lt;folder&gt;\&lt;fileName&gt;",
    /// loading the dict and looking up the named texture (with a first-texture
    /// fallback for single-texture dicts). Later folders override earlier ones
    /// only when the earlier miss — patch dictionaries take precedence by being
    /// listed last and being checked AFTER the base (we keep the LAST hit).
    /// </summary>
    private Image? LoadTextureFromFolders(IReadOnlyList<string> folders, string fileName, string textureName)
    {
        Image? result = null;
        var hash = JenkHash.GenHash(textureName.ToLowerInvariant());
        foreach (var folder in folders)
        {
            var path = $@"{folder}\{fileName}";
            var ytd = TryGetYtd(path);
            if (ytd?.TextureDict == null) continue;
            var tex = ytd.TextureDict.Lookup(hash)
                      ?? ytd.TextureDict.Textures?.data_items?.FirstOrDefault(t => t != null);
            var decoded = Decode(tex);
            if (decoded != null) result = decoded; // last (patch) hit wins
        }
        return result;
    }

    /// <summary>
    /// Synchronous RpfMan extract+parse. Returns null on a DETERMINISTIC miss
    /// (path/entry not found, dictionary broken) — that is a stable result and
    /// safe to cache. Re-throws as <see cref="TransientFaceLoadException"/> on a
    /// TRANSIENT IO failure (file locked / sharing violation / timeout) so the
    /// caller can avoid caching a momentarily-degraded face.
    /// </summary>
    private YtdFile? TryGetYtd(string rpfPath)
    {
        try
        {
            return _cache.RpfMan.GetFile<YtdFile>(rpfPath);
        }
        catch (Exception ex) when (IsTransient(ex))
        {
            _log.LogWarning(ex, "Face asset: TRANSIENT load failure for YTD {Path} — not caching", rpfPath);
            throw new TransientFaceLoadException($"Transient face asset load failure: {rpfPath}", ex);
        }
        catch (Exception ex)
        {
            // Deterministic miss (entry absent, corrupt dict, …) — stable, may
            // be treated as "asset not present" and cached as such by callers.
            _log.LogWarning(ex, "Face asset: failed to load YTD {Path}", rpfPath);
            return null;
        }
    }

    /// <summary>
    /// True when an exception from the RpfMan load is a transient IO contention
    /// rather than a deterministic miss. A FileNotFound/DirectoryNotFound is
    /// deterministic (the asset is simply absent); other IO/timeouts (the file
    /// is momentarily locked or the read timed out) are transient.
    /// </summary>
    private static bool IsTransient(Exception ex) => ex switch
    {
        FileNotFoundException => false,
        DirectoryNotFoundException => false,
        TimeoutException => true,
        IOException => true,
        _ => false,
    };

    /// <summary>Decodes one texture to straight RGBA8 (mip 0), swizzling BGRA->RGBA. Null on failure.</summary>
    private Image? Decode(Texture? texture)
    {
        if (texture == null) return null;
        try
        {
            var rgba = DDSIO.GetPixels(texture, 0);
            if (rgba == null || rgba.Length == 0) return null;
            var width = Math.Max(1, (int)texture.Width);
            var height = Math.Max(1, (int)texture.Height);
            if (rgba.Length < width * height * 4) return null;
            // DDSIO yields BGRA; normalize to RGBA exactly once here so every
            // downstream pixel op (lerp/tint/blend) treats [0]=R.
            PixelSwizzle.BgraToRgbaInPlace(rgba);
            return new Image(rgba, width, height);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Face asset: failed to decode texture {Texture}", texture.Name);
            return null;
        }
    }

    /// <summary>
    /// LRU get-or-load. Misses are NOT cached negatively (a transient RpfMan
    /// hiccup would otherwise freeze a slot empty); successful loads cache the
    /// decoded image keyed by the asset id.
    /// </summary>
    private Image? GetOrLoad(string key, Func<Image?> loader)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _lru.Remove(node);
                _lru.AddFirst(node);
                return node.Value.Value;
            }
        }

        var image = loader();
        if (image == null) return null; // never cache a miss

        lock (_gate)
        {
            if (_map.TryGetValue(key, out var existing))
            {
                _bytes -= existing.Value.Bytes;
                _lru.Remove(existing);
                _map.Remove(key);
            }

            var entryBytes = image.ApproxBytes;
            while ((_map.Count >= Capacity || _bytes + entryBytes > ByteBudget) && _lru.Last != null)
            {
                _bytes -= _lru.Last.Value.Bytes;
                _map.Remove(_lru.Last.Value.Key);
                _lru.RemoveLast();
            }

            _map[key] = _lru.AddFirst((key, image, entryBytes));
            _bytes += entryBytes;
            return image;
        }
    }
}
