namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Channel-order helper for CodeWalker texture decodes. DDSIO.GetPixels
/// returns pixels in BGRA byte order (the GDI+/WPF Bgra32 convention all its
/// decode paths normalize to), so every consumer that treats the buffer as
/// RGBA — PNG encoding, BCnEncoder input — must swap R and B first.
/// </summary>
public static class PixelSwizzle
{
    /// <summary>
    /// Swaps the R and B channel of every 4-byte pixel in place and returns
    /// the same buffer. Required for single-channel decodes too (L8/R8 come
    /// back as (v,0,0) post-DDSIO); only true grayscale (R == B) is a no-op.
    /// </summary>
    public static byte[] BgraToRgbaInPlace(byte[] pixels)
    {
        for (var i = 0; i + 3 < pixels.Length; i += 4)
        {
            (pixels[i], pixels[i + 2]) = (pixels[i + 2], pixels[i]);
        }
        return pixels;
    }
}
