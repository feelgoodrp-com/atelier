using BCnEncoder.Encoder;
using BCnEncoder.Shared;
using CodeWalker.GameFiles;
using CodeWalker.Utils;
using ImageMagick;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

/// <summary>
/// Builds a single-texture YTD from a tattoo decal image. The reusable tail
/// (RGBA → BcEncoder → DDS → DDSIO.GetTexture → TextureDictionary →
/// YtdFile.Save) is identical to TextureOptimizer; only the decode HEAD is new:
///   - .dds / .ytd are decoded via CodeWalker DDSIO (BGRA, swizzled to RGBA),
///   - everything else (png/jpg/webp) via Magick.NET (already RGBA, no swizzle).
///
/// The texture name INSIDE the dictionary is set to the YTD file name so the
/// engine rule txdHash == txtHash == YTD file name holds mechanically.
///
/// NOTE (Review R4): the channel order coming out of DDSIO vs Magick differs.
/// DDS/YTD paths swizzle BGRA→RGBA (same as TextureOptimizer); the Magick path
/// requests RGBA directly. A colour round-trip test must confirm this on a real
/// .NET 8 build before shipping.
/// </summary>
public static class TattooTextureBuilder
{
    public static byte[] BuildYtd(string sourceImagePath, string ytdName, int maxDimension = 512, string format = "BC3")
    {
        var (rgba, width, height) = DecodeToRgba(sourceImagePath);
        var (scaled, newWidth, newHeight) = RgbaResize.FitLongestEdge(rgba, width, height, maxDimension);

        var encoder = new BcEncoder
        {
            OutputOptions =
            {
                GenerateMipMaps = true,
                Quality = CompressionQuality.Balanced,
                Format = ResolveFormat(format),
                FileFormat = OutputFileFormat.Dds,
            },
        };
        encoder.Options.IsParallel = true;
        encoder.Options.TaskCount = Math.Max(1, Environment.ProcessorCount - 1);

        var dds = encoder.EncodeToDds(scaled, newWidth, newHeight, PixelFormat.Rgba32);
        using var ms = new MemoryStream();
        dds.Write(ms);

        var texture = DDSIO.GetTexture(ms.ToArray());
        texture.Name = ytdName;
        texture.NameHash = JenkHash.GenHash(ytdName.ToLowerInvariant());

        var dictionary = new TextureDictionary();
        dictionary.BuildFromTextureList(new List<Texture> { texture });
        return new YtdFile { TextureDict = dictionary }.Save();
    }

    /// <summary>Decodes a source image to a top-mip RGBA buffer.</summary>
    private static (byte[] rgba, int width, int height) DecodeToRgba(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();

        if (ext == ".dds")
        {
            var texture = DDSIO.GetTexture(File.ReadAllBytes(path))
                ?? throw new InvalidDataException($"DDS konnte nicht dekodiert werden: {path}");
            return PixelsFrom(texture);
        }

        if (ext == ".ytd")
        {
            var data = File.ReadAllBytes(path);
            var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
            var ytd = RpfFile.GetFile<YtdFile>(entry, ResourceBuilder.Decompress(data));
            var texture = ytd?.TextureDict?.Textures?.data_items?.FirstOrDefault(t => t != null)
                ?? throw new InvalidDataException($"Keine Textur in der YTD-Datei: {path}");
            return PixelsFrom(texture);
        }

        // Raster (png/jpg/webp/…) via Magick.NET — already RGBA, no swizzle.
        using var image = new MagickImage(path);
        var width = (int)image.Width;
        var height = (int)image.Height;
        using var pixels = image.GetPixels();
        var rgba = pixels.ToByteArray(PixelMapping.RGBA)
            ?? throw new InvalidDataException($"Bild konnte nicht dekodiert werden: {path}");
        return (rgba, width, height);
    }

    /// <summary>DDSIO.GetPixels returns BGRA (GDI+ order) — swap to RGBA.</summary>
    private static (byte[] rgba, int width, int height) PixelsFrom(Texture texture)
    {
        var rgba = DDSIO.GetPixels(texture, 0)
            ?? throw new InvalidDataException($"Textur '{texture.Name}' konnte nicht dekodiert werden.");
        PixelSwizzle.BgraToRgbaInPlace(rgba);
        return (rgba, Math.Max(1, (int)texture.Width), Math.Max(1, (int)texture.Height));
    }

    private static CompressionFormat ResolveFormat(string format) => format.ToUpperInvariant() switch
    {
        "BC1" => CompressionFormat.Bc1,
        "BC3" => CompressionFormat.Bc3,
        "BC7" => CompressionFormat.Bc7,
        _ => CompressionFormat.Bc3, // tattoos are alpha decals → BC3 default
    };
}
