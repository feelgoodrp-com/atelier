using Feelgood.Atelier.Sidecar.Api;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Engine.Face;

/// <summary>
/// CPU compositor that turns a <see cref="PedFaceDto"/> into re-textured
/// body-skin diffuses (head/uppr/lowr/feet) for the rendered ped body. Per
/// region it:
///   (a) blends the HeadBlend parent skins (skinFirst/Second/Third with
///       skinMix/thirdMix) pixel-wise so head AND body share one skin tone;
///   (b) on the HEAD only, alpha-blends the calibrated head overlays in slot
///       order (brow/beard tinted via the hair palette, makeup via the makeup
///       palette when available), then composites the eye-colour atlas tile
///       into the iris UV rect.
/// Results are byte-budgeted LRU-cached per (ped, region, face-key) so warm
/// requests skip the pixel work (&lt;300 ms target). Garment textures are NEVER
/// touched — only the four body-skin components.
/// </summary>
public sealed class FaceCompositor
{
    /// <summary>Composited diffuse for one body region (straight RGBA8).</summary>
    public sealed record Composited(byte[] Rgba, int Width, int Height)
    {
        public long ApproxBytes => Rgba.LongLength;
    }

    /// <summary>
    /// The four composited body-skin diffuses keyed by component slot index
    /// (0=head, 3=uppr, 4=lowr, 6=feet) plus the granular fallback labels for
    /// the sources that had to be skipped (reported to clients via the
    /// X-FG-Appearance-Fallbacks header). Labels are e.g. "overlay:2" (the
    /// requested brow index resolved no texture and the slot was skipped),
    /// "skin" (a parent skin variant was missing) or "eye" (the atlas was
    /// missing). A region missing from <see cref="ByComponent"/> keeps the ped
    /// default texture (no override) — never an error. <see cref="HadFallback"/>
    /// is just "any fallback at all".
    /// </summary>
    public sealed record FaceResult(
        IReadOnlyDictionary<int, Composited> ByComponent,
        IReadOnlyList<string> Fallbacks,
        bool HadTransientFailure)
    {
        public bool HadFallback => Fallbacks.Count > 0;
    }

    /// <summary>Component slot index per body region (mirror of GtaSlots).</summary>
    private static readonly IReadOnlyDictionary<string, int> RegionComponent = new Dictionary<string, int>
    {
        ["head"] = 0, ["uppr"] = 3, ["lowr"] = 4, ["feet"] = 6,
    };

    private const int WorkSize = 512; // overlay/skin UV space is 512x512 coincident

    private readonly FaceAssets _assets;
    private readonly ILogger _log;

    // Per-region composited-diffuse LRU. Composited head/body skins are
    // 512x512x4 = 1 MB each; the ~96 MB budget keeps the recent face working
    // set warm across preview requests for the same character.
    private const int Capacity = 96;
    private const long ByteBudget = 96L * 1024L * 1024L;
    private readonly object _gate = new();
    private readonly Dictionary<string, LinkedListNode<(string Key, Composited Value)>> _map = new();
    private readonly LinkedList<(string Key, Composited Value)> _lru = new();
    private long _bytes;

    public FaceCompositor(FaceAssets assets, ILogger log)
    {
        _assets = assets;
        _log = log;
    }

    /// <summary>
    /// Composites all four body-skin diffuses for a face. faceKeyPart is the
    /// canonical face segment (PedAppearanceKey face part) used as the cache
    /// key suffix so identical faces reuse the pixel work. isFemale selects the
    /// gendered overlay categories.
    /// </summary>
    public FaceResult Composite(string pedModel, bool isFemale, PedFaceDto face, string faceKeyPart)
    {
        var byComponent = new Dictionary<int, Composited>(RegionComponent.Count);
        // Ordered set of granular fallback labels ("overlay:2", "skin", "eye").
        // A slot can fail in several regions (skin) — dedupe but keep order.
        var fallbacks = new List<string>();
        void AddFallback(string label)
        {
            if (!fallbacks.Contains(label)) fallbacks.Add(label);
        }

        var hadTransientFailure = false;

        foreach (var region in FaceCalibration.SkinRegions)
        {
            var componentIndex = RegionComponent[region];
            var cacheKey = $"{pedModel}|{region}|{faceKeyPart}";

            // NOTE: a cache HIT cannot re-report the fallbacks it had when first
            // composited — they are deterministic for the same face key, so the
            // first (cold) request already surfaced them; warm requests render
            // the identical (degraded-but-stable) image without the header.
            if (TryGetCached(cacheKey, out var cached))
            {
                byComponent[componentIndex] = cached;
                continue;
            }

            var (composited, regionFallbacks, regionTransient) =
                CompositeRegion(pedModel, isFemale, region, face);
            foreach (var label in regionFallbacks) AddFallback(label);
            hadTransientFailure |= regionTransient;
            if (composited == null) continue; // no parent skin resolved — keep ped default

            // A region whose degradation came from a TRANSIENT asset miss must
            // NOT be frozen in the LRU — a retry may resolve the asset and yield
            // a different (correct) image for the same key (cache poisoning).
            if (!regionTransient) Put(cacheKey, composited);
            byComponent[componentIndex] = composited;
        }

        return new FaceResult(byComponent, fallbacks, hadTransientFailure);
    }

    /// <summary>
    /// Composites one body region. Returns (image, fallbacks, transient): image
    /// is null when not even the dominant parent skin resolves (region keeps
    /// the ped default); fallbacks lists the granular labels of every source
    /// that had to be skipped ("skin", "overlay:&lt;slot&gt;", "eye"); transient is
    /// true when ANY of those skips came from a TRANSIENT asset-load failure
    /// (the region must then not be cached). An empty fallback list means a
    /// clean composite.
    /// </summary>
    private (Composited? Image, IReadOnlyList<string> Fallbacks, bool Transient) CompositeRegion(
        string pedModel, bool isFemale, string region, PedFaceDto face)
    {
        var fallbacks = new List<string>();
        var transient = false;

        // Wraps a skin load: a TRANSIENT failure becomes a null result + a
        // transient flag (so the region is degraded but never cached); a
        // deterministic miss is just null (stable, cacheable).
        FaceAssets.Image? LoadSkinSafe(int parentIndex)
        {
            try { return _assets.LoadSkin(pedModel, region, parentIndex, "whi"); }
            catch (TransientFaceLoadException) { transient = true; return null; }
        }

        // (a) Skin blend: lerp the three parent skins. "whi" is the freemode
        // default ethnicity; FaceAssets falls back across ethnicities/parents.
        var first = LoadSkinSafe(face.SkinFirst);
        if (first == null)
        {
            // Without the dominant parent skin there is no base to paint on —
            // leave the ped default for this region (honest, not grey).
            _log.LogWarning("Face: skin parent {Region}/{Index} unresolved — region keeps ped default",
                region, face.SkinFirst);
            return (null, new[] { "skin" }, transient);
        }

        var canvas = ToCanvas(first);
        var second = face.SkinSecond != face.SkinFirst
            ? LoadSkinSafe(face.SkinSecond)
            : first;
        if (second == null) { second = first; fallbacks.Add("skin"); }
        BlendSkin(canvas, second, face.SkinMix);

        // Third parent only contributes when thirdMix is non-zero (the
        // HeadBlend override slot is usually unused -> thirdMix 0).
        if (face.ThirdMix > 0f && face.SkinThird != face.SkinFirst)
        {
            var third = LoadSkinSafe(face.SkinThird);
            if (third != null) BlendSkin(canvas, third, face.ThirdMix);
            else if (!fallbacks.Contains("skin")) fallbacks.Add("skin");
        }

        // (b) HEAD only: overlays + eyes (uppr/lowr/feet are skin-tone only).
        if (region == "head")
        {
            // Each unresolved overlay names its own slot ("overlay:<slot>") so
            // the client can tell WHICH layer was skipped (e.g. "overlay:2").
            var (overlaySkips, overlayTransient) = ApplyOverlays(canvas, isFemale, face);
            foreach (var overlaySlot in overlaySkips)
                fallbacks.Add($"overlay:{overlaySlot}");
            transient |= overlayTransient;

            if (face.EyeColour.HasValue)
            {
                try
                {
                    if (!ApplyEyeColour(canvas, face.EyeColour.Value)) fallbacks.Add("eye");
                }
                catch (TransientFaceLoadException)
                {
                    fallbacks.Add("eye");
                    transient = true;
                }
            }
        }

        return (new Composited(canvas, WorkSize, WorkSize), fallbacks, transient);
    }

    /// <summary>
    /// Resamples a source skin into the 512x512 working canvas (a fresh,
    /// mutable buffer the caller owns). Sources are already 512x512 in practice
    /// so this is usually a straight copy; off-size sources are nearest-sampled.
    /// </summary>
    private static byte[] ToCanvas(FaceAssets.Image src)
    {
        if (src.Width == WorkSize && src.Height == WorkSize)
            return (byte[])src.Rgba.Clone();
        return ResampleNearest(src.Rgba, src.Width, src.Height, WorkSize, WorkSize);
    }

    /// <summary>
    /// In-place pixel lerp of the canvas toward another skin: canvas = lerp(
    /// canvas, other, mix). Alpha stays opaque (skin diffuse). other is
    /// resampled to the canvas size first if needed.
    /// </summary>
    private static void BlendSkin(byte[] canvas, FaceAssets.Image other, float mix)
    {
        if (mix <= 0f) return;
        var o = (other.Width == WorkSize && other.Height == WorkSize)
            ? other.Rgba
            : ResampleNearest(other.Rgba, other.Width, other.Height, WorkSize, WorkSize);
        var t = Math.Clamp(mix, 0f, 1f);
        var inv = 1f - t;
        for (var i = 0; i + 3 < canvas.Length && i + 3 < o.Length; i += 4)
        {
            canvas[i]     = (byte)(canvas[i]     * inv + o[i]     * t + 0.5f);
            canvas[i + 1] = (byte)(canvas[i + 1] * inv + o[i + 1] * t + 0.5f);
            canvas[i + 2] = (byte)(canvas[i + 2] * inv + o[i + 2] * t + 0.5f);
            // alpha left opaque — skin diffuse has no meaningful alpha
        }
    }

    /// <summary>
    /// Alpha-blends the active head overlays onto the canvas in slot order.
    /// Tintable decals (brows/beard via hair palette, makeup/blush/lipstick via
    /// makeup palette) get their RGB multiplied by the tint before the alpha
    /// blend; full-face DXT1 layers (blemishes/complexion) blend by opacity
    /// without a cutout. Returns (skipped, transient): skipped is the slot
    /// indices of the active overlays that could NOT be resolved (out-of-range
    /// / missing texture) so the caller can report them as "overlay:&lt;slot&gt;"
    /// fallbacks; transient is true when a skip came from a TRANSIENT load
    /// failure (the region must then not be cached). An empty skipped list
    /// means all active overlays rendered.
    /// </summary>
    private (IReadOnlyList<int> Skipped, bool Transient) ApplyOverlays(byte[] canvas, bool isFemale, PedFaceDto face)
    {
        if (face.Overlays == null || face.Overlays.Count == 0) return (Array.Empty<int>(), false);
        List<int>? skipped = null;
        var transient = false;

        foreach (var overlay in face.Overlays.OrderBy(o => o.Slot))
        {
            var index = overlay.Index ?? FaceCalibration.OverlayOff;
            if (index == FaceCalibration.OverlayOff) continue;

            var slot = FaceCalibration.FindSlot(overlay.Slot);
            if (slot == null || !slot.Render) continue; // body slots 10..12 excluded

            FaceAssets.Image? image;
            try
            {
                image = _assets.LoadOverlay(slot, index, isFemale);
            }
            catch (TransientFaceLoadException)
            {
                // Transient miss — skip the slot for now AND mark the region
                // uncacheable so a retry can still resolve the decal.
                (skipped ??= new List<int>()).Add(overlay.Slot);
                transient = true;
                continue;
            }
            if (image == null)
            {
                // Out-of-range or deterministically missing texture — the slot
                // is treated as "off" (no wrong/clamped decal) and reported by
                // slot index. This is a STABLE result (cacheable).
                (skipped ??= new List<int>()).Add(overlay.Slot);
                continue;
            }

            (byte R, byte G, byte B)? tint = null;
            if (slot.Tintable && overlay.Colour.HasValue)
                tint = FaceCalibration.TintRgb(slot.Palette, overlay.Colour.Value);

            var opacity = Math.Clamp(overlay.Opacity ?? 1f, 0f, 1f);
            BlendOverlay(canvas, image, slot.Compositing, opacity, tint);
        }

        return ((IReadOnlyList<int>?)skipped ?? Array.Empty<int>(), transient);
    }

    /// <summary>
    /// Alpha-composites one overlay decal onto the canvas. DXT5 decals use
    /// their own alpha as the cutout (multiplied by opacity); full-face layers
    /// blend the whole image at opacity. Tint, when present, multiplies the
    /// decal RGB first.
    /// </summary>
    private static void BlendOverlay(
        byte[] canvas,
        FaceAssets.Image image,
        FaceCalibration.Compositing mode,
        float opacity,
        (byte R, byte G, byte B)? tint)
    {
        if (opacity <= 0f) return;
        var src = (image.Width == WorkSize && image.Height == WorkSize)
            ? image.Rgba
            : ResampleNearest(image.Rgba, image.Width, image.Height, WorkSize, WorkSize);

        var useAlpha = mode == FaceCalibration.Compositing.DecalDxt5Alpha;
        var tr = tint?.R ?? 255; var tg = tint?.G ?? 255; var tb = tint?.B ?? 255;
        var hasTint = tint.HasValue;

        for (var i = 0; i + 3 < canvas.Length && i + 3 < src.Length; i += 4)
        {
            float sr = src[i], sg = src[i + 1], sb = src[i + 2];
            if (hasTint)
            {
                sr = sr * tr / 255f;
                sg = sg * tg / 255f;
                sb = sb * tb / 255f;
            }

            // Coverage: decals gate by their own alpha; full-face layers cover
            // everywhere. Both scale by the user opacity.
            var coverage = useAlpha ? (src[i + 3] / 255f) * opacity : opacity;
            if (coverage <= 0f) continue;
            var inv = 1f - coverage;

            canvas[i]     = (byte)(canvas[i]     * inv + sr * coverage + 0.5f);
            canvas[i + 1] = (byte)(canvas[i + 1] * inv + sg * coverage + 0.5f);
            canvas[i + 2] = (byte)(canvas[i + 2] * inv + sb * coverage + 0.5f);
        }
    }

    /// <summary>
    /// Composites the chosen eye-colour atlas tile into the iris UV rect of the
    /// head diffuse. The 8x4 atlas (64x64 tiles, row-major) is sampled per
    /// destination pixel inside the calibrated UV rect; the tile alpha cuts the
    /// rounded iris disc so the eyelids/sclera stay untouched. Returns false on
    /// a missing atlas (fallback).
    /// </summary>
    private bool ApplyEyeColour(byte[] canvas, int eyeColour)
    {
        var atlas = _assets.LoadEyeAtlas();
        if (atlas == null) return false;

        var index = Math.Clamp(eyeColour, 0, FaceCalibration.EyeColourMax);
        var tileCol = index % FaceCalibration.EyeAtlasCols;
        var tileRow = index / FaceCalibration.EyeAtlasCols;
        var tileX0 = tileCol * FaceCalibration.EyeAtlasTileW;
        var tileY0 = tileRow * FaceCalibration.EyeAtlasTileH;

        // Destination pixel rect on the 512x512 head canvas from the UV rect.
        var dx0 = (int)MathF.Floor(FaceCalibration.EyeUvU0 * WorkSize);
        var dy0 = (int)MathF.Floor(FaceCalibration.EyeUvV0 * WorkSize);
        var dx1 = (int)MathF.Ceiling(FaceCalibration.EyeUvU1 * WorkSize);
        var dy1 = (int)MathF.Ceiling(FaceCalibration.EyeUvV1 * WorkSize);
        dx0 = Math.Clamp(dx0, 0, WorkSize - 1);
        dy0 = Math.Clamp(dy0, 0, WorkSize - 1);
        dx1 = Math.Clamp(dx1, dx0 + 1, WorkSize);
        dy1 = Math.Clamp(dy1, dy0 + 1, WorkSize);

        var rectW = dx1 - dx0;
        var rectH = dy1 - dy0;

        for (var dy = dy0; dy < dy1; dy++)
        {
            // Normalized position within the dest rect -> tile pixel.
            var fy = (dy - dy0 + 0.5f) / rectH;
            var ty = Math.Clamp((int)(fy * FaceCalibration.EyeAtlasTileH), 0, FaceCalibration.EyeAtlasTileH - 1);
            for (var dx = dx0; dx < dx1; dx++)
            {
                var fx = (dx - dx0 + 0.5f) / rectW;
                var tx = Math.Clamp((int)(fx * FaceCalibration.EyeAtlasTileW), 0, FaceCalibration.EyeAtlasTileW - 1);

                var si = ((tileY0 + ty) * atlas.Width + (tileX0 + tx)) * 4;
                if (si + 3 >= atlas.Rgba.Length) continue;
                var coverage = atlas.Rgba[si + 3] / 255f; // tile alpha = iris disc cutout
                if (coverage <= 0f) continue;
                var inv = 1f - coverage;

                var di = (dy * WorkSize + dx) * 4;
                canvas[di]     = (byte)(canvas[di]     * inv + atlas.Rgba[si]     * coverage + 0.5f);
                canvas[di + 1] = (byte)(canvas[di + 1] * inv + atlas.Rgba[si + 1] * coverage + 0.5f);
                canvas[di + 2] = (byte)(canvas[di + 2] * inv + atlas.Rgba[si + 2] * coverage + 0.5f);
            }
        }
        return true;
    }

    /// <summary>Nearest-neighbour resample of an RGBA buffer (sources are usually already 512x512).</summary>
    private static byte[] ResampleNearest(byte[] src, int sw, int sh, int dw, int dh)
    {
        var dst = new byte[dw * dh * 4];
        for (var y = 0; y < dh; y++)
        {
            var sy = Math.Min(sh - 1, y * sh / dh);
            for (var x = 0; x < dw; x++)
            {
                var sx = Math.Min(sw - 1, x * sw / dw);
                var si = (sy * sw + sx) * 4;
                var di = (y * dw + x) * 4;
                if (si + 3 >= src.Length) continue;
                dst[di] = src[si];
                dst[di + 1] = src[si + 1];
                dst[di + 2] = src[si + 2];
                dst[di + 3] = src[si + 3];
            }
        }
        return dst;
    }

    // ---- result LRU ----

    private bool TryGetCached(string key, out Composited value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _lru.Remove(node);
                _lru.AddFirst(node);
                value = node.Value.Value;
                return true;
            }
        }
        value = null!;
        return false;
    }

    private void Put(string key, Composited value)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var existing))
            {
                _bytes -= existing.Value.Value.ApproxBytes;
                _lru.Remove(existing);
                _map.Remove(key);
            }

            while ((_map.Count >= Capacity || _bytes + value.ApproxBytes > ByteBudget) && _lru.Last != null)
            {
                _bytes -= _lru.Last.Value.Value.ApproxBytes;
                _map.Remove(_lru.Last.Value.Key);
                _lru.RemoveLast();
            }

            _map[key] = _lru.AddFirst((key, value));
            _bytes += value.ApproxBytes;
        }
    }
}
