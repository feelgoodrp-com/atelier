using BCnEncoder.Encoder;
using BCnEncoder.Shared;
using CodeWalker.GameFiles;
using CodeWalker.Utils;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Engine.Build;

public sealed record TextureDimensions(int Width, int Height, long SizeBytes);

public sealed record TextureOptimizeResult(string OutPath, TextureDimensions Before, TextureDimensions After);

/// <summary>
/// POST /texture/optimize backend: decodes every texture of a .ytd via
/// CodeWalker DDSIO (mip 0), box-filter-downscales the longest edge to
/// maxDimension, re-encodes via BCnEncoder (parallel) into BC1/BC3/BC7 (or
/// the source's BC family when no format is forced), regenerates mips and
/// rebuilds a valid .ytd through CodeWalker's TextureDictionary. In-place
/// writes go through a .tmp + replace.
/// </summary>
public static class TextureOptimizer
{
    public static TextureOptimizeResult Optimize(
        string ytdPath, string? outPath, int maxDimension, string? format, bool regenerateMips)
    {
        var sourceBytes = File.ReadAllBytes(ytdPath);

        var data = (byte[])sourceBytes.Clone();
        var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
        var decompressed = ResourceBuilder.Decompress(data);
        var ytd = RpfFile.GetFile<YtdFile>(entry, decompressed);

        var sourceTextures = ytd?.TextureDict?.Textures?.data_items;
        if (sourceTextures == null || sourceTextures.Length == 0)
            throw new InvalidDataException("Keine Texturen in der YTD-Datei gefunden.");

        var before = Dimensions(sourceTextures, sourceBytes.LongLength);

        var rebuilt = new List<Texture>(sourceTextures.Length);
        foreach (var texture in sourceTextures)
        {
            if (texture == null) continue;
            rebuilt.Add(OptimizeTexture(texture, maxDimension, format, regenerateMips));
        }

        var dictionary = new TextureDictionary();
        dictionary.BuildFromTextureList(rebuilt);
        var outputBytes = new YtdFile { TextureDict = dictionary }.Save();

        var targetPath = string.IsNullOrWhiteSpace(outPath) ? ytdPath : outPath!;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(targetPath))!);
        var tmpPath = targetPath + ".tmp";
        File.WriteAllBytes(tmpPath, outputBytes);
        File.Move(tmpPath, targetPath, overwrite: true);

        // Re-parse the produced file so the response reflects what's on disk.
        var verifyData = (byte[])outputBytes.Clone();
        var verifyEntry = RpfFile.CreateResourceFileEntry(ref verifyData, 0);
        var verifyYtd = RpfFile.GetFile<YtdFile>(verifyEntry, ResourceBuilder.Decompress(verifyData));
        var verifyTextures = verifyYtd?.TextureDict?.Textures?.data_items
            ?? throw new InvalidDataException("Optimierte YTD-Datei konnte nicht zurückgelesen werden.");

        return new TextureOptimizeResult(
            Path.GetFullPath(targetPath),
            before,
            Dimensions(verifyTextures, outputBytes.LongLength));
    }

    private static Texture OptimizeTexture(Texture texture, int maxDimension, string? format, bool regenerateMips)
    {
        var rgba = DDSIO.GetPixels(texture, 0)
            ?? throw new InvalidDataException($"Textur '{texture.Name}' konnte nicht dekodiert werden.");

        // DDSIO.GetPixels returns BGRA byte order (GDI+/WPF convention);
        // BCnEncoder consumes the buffer as Rgba32, so swap R/B first or the
        // swapped channels get baked into the rebuilt .ytd on disk.
        PixelSwizzle.BgraToRgbaInPlace(rgba);

        var width = Math.Max(1, (int)texture.Width);
        var height = Math.Max(1, (int)texture.Height);
        var (scaled, newWidth, newHeight) = RgbaResize.FitLongestEdge(rgba, width, height, maxDimension);

        var encoder = new BcEncoder
        {
            OutputOptions =
            {
                GenerateMipMaps = regenerateMips,
                Quality = CompressionQuality.Balanced,
                Format = ResolveFormat(format, texture.Format),
                FileFormat = OutputFileFormat.Dds,
            },
        };
        encoder.Options.IsParallel = true;
        encoder.Options.TaskCount = Math.Max(1, Environment.ProcessorCount - 1);

        var dds = encoder.EncodeToDds(scaled, newWidth, newHeight, PixelFormat.Rgba32);
        using var ms = new MemoryStream();
        dds.Write(ms);

        var rebuilt = DDSIO.GetTexture(ms.ToArray());
        rebuilt.Name = texture.Name;
        rebuilt.NameHash = texture.NameHash != 0 ? texture.NameHash : JenkHash.GenHash(texture.Name?.ToLowerInvariant() ?? string.Empty);
        rebuilt.Usage = texture.Usage;
        rebuilt.UsageFlags = texture.UsageFlags;
        return rebuilt;
    }

    /// <summary>
    /// Explicit BC1/BC3/BC7 wins; otherwise stay in the source's compression
    /// family (uncompressed sources stay uncompressed RGBA).
    /// </summary>
    private static CompressionFormat ResolveFormat(string? requested, TextureFormat sourceFormat)
    {
        if (!string.IsNullOrWhiteSpace(requested))
        {
            return requested.ToUpperInvariant() switch
            {
                "BC1" => CompressionFormat.Bc1,
                "BC3" => CompressionFormat.Bc3,
                "BC7" => CompressionFormat.Bc7,
                "RGBA8888" => CompressionFormat.Rgba,
                _ => throw new ArgumentException($"Unbekanntes Format '{requested}' — erlaubt sind BC1, BC3, BC7, RGBA8888."),
            };
        }

        return sourceFormat switch
        {
            TextureFormat.D3DFMT_DXT1 => CompressionFormat.Bc1,
            TextureFormat.D3DFMT_DXT3 => CompressionFormat.Bc2,
            TextureFormat.D3DFMT_DXT5 => CompressionFormat.Bc3,
            TextureFormat.D3DFMT_ATI1 => CompressionFormat.Bc4,
            TextureFormat.D3DFMT_ATI2 => CompressionFormat.Bc5,
            TextureFormat.D3DFMT_BC7 => CompressionFormat.Bc7,
            _ => CompressionFormat.Rgba,
        };
    }

    /// <summary>Largest texture's dimensions + the file size.</summary>
    private static TextureDimensions Dimensions(Texture?[] textures, long sizeBytes)
    {
        var largest = textures
            .Where(t => t != null)
            .OrderByDescending(t => (int)t!.Width * (int)t.Height)
            .First()!;
        return new TextureDimensions(largest.Width, largest.Height, sizeBytes);
    }
}
