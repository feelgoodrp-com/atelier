namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Shared RGBA8 box-filter downscaler (used by texture thumbnails and
/// /texture/optimize). Upscaling is never done.
/// </summary>
public static class RgbaResize
{
    /// <summary>
    /// Box-filter downscale so the longest edge is &lt;= maxSize. Images that
    /// already fit are returned unchanged.
    /// </summary>
    public static (byte[] Rgba, int Width, int Height) FitLongestEdge(byte[] rgba, int width, int height, int maxSize)
    {
        var longest = Math.Max(width, height);
        if (longest <= maxSize)
            return (rgba, width, height);

        var scale = (double)maxSize / longest;
        var dstWidth = Math.Clamp((int)Math.Round(width * scale), 1, maxSize);
        var dstHeight = Math.Clamp((int)Math.Round(height * scale), 1, maxSize);

        var dst = new byte[dstWidth * dstHeight * 4];
        for (var y = 0; y < dstHeight; y++)
        {
            // Source row range covered by this destination row (>= 1 row).
            var srcY0 = y * height / dstHeight;
            var srcY1 = Math.Max(srcY0 + 1, (y + 1) * height / dstHeight);

            for (var x = 0; x < dstWidth; x++)
            {
                var srcX0 = x * width / dstWidth;
                var srcX1 = Math.Max(srcX0 + 1, (x + 1) * width / dstWidth);

                long r = 0, g = 0, b = 0, a = 0;
                var samples = 0;
                for (var sy = srcY0; sy < srcY1; sy++)
                {
                    var rowOffset = sy * width;
                    for (var sx = srcX0; sx < srcX1; sx++)
                    {
                        var si = (rowOffset + sx) * 4;
                        r += rgba[si];
                        g += rgba[si + 1];
                        b += rgba[si + 2];
                        a += rgba[si + 3];
                        samples++;
                    }
                }

                var di = (y * dstWidth + x) * 4;
                dst[di] = (byte)(r / samples);
                dst[di + 1] = (byte)(g / samples);
                dst[di + 2] = (byte)(b / samples);
                dst[di + 3] = (byte)(a / samples);
            }
        }

        return (dst, dstWidth, dstHeight);
    }
}
