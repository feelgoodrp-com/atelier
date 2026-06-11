using CodeWalker.GameFiles;
using Feelgood.Atelier.Sidecar.Api;

namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Loads a standalone .ytd (RSC7 texture dictionary) via CodeWalker.Core and
/// lists texture metadata. Loading pattern adapted from the Feelgood
/// rage-sidecar (YtdTexturePreviewEngine).
/// </summary>
public static class YtdParser
{
    public static IReadOnlyList<TextureInfo> Parse(
        byte[] fileBytes,
        string? fileSha = null,
        int? thumbnailMaxSize = null,
        ILogger? log = null)
    {
        var data = (byte[])fileBytes.Clone();
        var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
        var decompressed = ResourceBuilder.Decompress(data);
        var ytd = RpfFile.GetFile<YtdFile>(entry, decompressed);

        var items = ytd?.TextureDict?.Textures?.data_items;
        if (items == null || items.Length == 0)
            throw new InvalidDataException("Keine Texturen in der YTD-Datei gefunden.");

        var result = new List<TextureInfo>(items.Length);
        for (var i = 0; i < items.Length; i++)
        {
            var tex = items[i];
            if (tex == null) continue;

            var name = string.IsNullOrWhiteSpace(tex.Name) ? $"texture_{i}" : tex.Name;
            int width = tex.Width;
            int height = tex.Height;

            string? thumbnail = null;
            if (thumbnailMaxSize is int maxSize)
                thumbnail = ThumbnailRenderer.TryRender(tex, fileSha ?? string.Empty, name, maxSize, log);

            result.Add(new TextureInfo(
                name,
                width,
                height,
                tex.Levels,
                tex.Format.ToString(),
                IsPowerOfTwo(width) && IsPowerOfTwo(height),
                thumbnail));
        }

        if (result.Count == 0)
            throw new InvalidDataException("Keine Texturen in der YTD-Datei gefunden.");

        return result;
    }

    private static bool IsPowerOfTwo(int value) => value > 0 && (value & (value - 1)) == 0;
}
