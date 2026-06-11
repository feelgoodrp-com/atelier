using CodeWalker.GameFiles;
using CodeWalker.Utils;

namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Renders a PNG thumbnail for a CodeWalker texture: decode to RGBA via DDSIO
/// (mip 0, same approach as the Feelgood rage-sidecar YtdTexturePreviewEngine),
/// downscale so the longest edge fits maxSize (box filter) and encode as PNG.
/// Failures degrade to a missing thumbnail instead of failing the whole parse.
/// </summary>
public static class ThumbnailRenderer
{
    public static string? TryRender(Texture texture, string fileSha, string textureName, int maxSize, ILogger? log)
    {
        if (ThumbnailCache.TryGet(fileSha, textureName, maxSize, out var cached))
            return cached;

        try
        {
            var rgba = DDSIO.GetPixels(texture, 0);
            if (rgba == null || rgba.Length == 0) return null;

            var width = Math.Max(1, (int)texture.Width);
            var height = Math.Max(1, (int)texture.Height);
            if (rgba.Length < width * height * 4) return null;

            // DDSIO.GetPixels returns BGRA byte order (GDI+/WPF convention);
            // PNG scanlines are RGBA, so swap R/B before scaling/encoding.
            PixelSwizzle.BgraToRgbaInPlace(rgba);
            var (scaled, scaledWidth, scaledHeight) = RgbaResize.FitLongestEdge(rgba, width, height, maxSize);
            var pngBase64 = Convert.ToBase64String(PngEncoder.EncodeRgba(scaled, scaledWidth, scaledHeight));
            ThumbnailCache.Put(fileSha, textureName, maxSize, pngBase64);
            return pngBase64;
        }
        catch (Exception ex)
        {
            // Unsupported/exotic texture formats should not break the response.
            log?.LogWarning(ex, "Thumbnail rendering failed for texture {Texture}", textureName);
            return null;
        }
    }
}
