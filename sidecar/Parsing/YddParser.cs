using CodeWalker.GameFiles;
using Feelgood.Atelier.Sidecar.Api;

namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Loads a standalone .ydd (RSC7 resource) via CodeWalker.Core and extracts
/// per-drawable mesh stats. Loading pattern adapted from the Feelgood
/// rage-sidecar (GrzyCodeWalkerPreviewEngine).
/// </summary>
public static class YddParser
{
    public static IReadOnlyList<DrawableInfo> Parse(byte[] fileBytes)
    {
        // CreateResourceFileEntry mutates the buffer (strips the RSC7 header),
        // so work on a copy.
        var data = (byte[])fileBytes.Clone();
        var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
        var decompressed = ResourceBuilder.Decompress(data);
        var ydd = RpfFile.GetFile<YddFile>(entry, decompressed);

        if (ydd?.Drawables == null || ydd.Drawables.Length == 0)
            throw new InvalidDataException("Keine Drawables in der YDD-Datei gefunden.");

        var result = new List<DrawableInfo>(ydd.Drawables.Length);
        for (var i = 0; i < ydd.Drawables.Length; i++)
        {
            var drawable = ydd.Drawables[i];
            if (drawable == null) continue;

            var name = string.IsNullOrWhiteSpace(drawable.Name) ? $"drawable_{i}" : drawable.Name;
            var blocks = drawable.DrawableModels;
            var lods = new LodFlags(
                HasGeometry(blocks?.High),
                HasGeometry(blocks?.Med),
                HasGeometry(blocks?.Low));

            // Count from the highest LOD that has geometry (matches what the
            // game renders up close and what creators care about).
            var models = FirstWithGeometry(blocks?.High, blocks?.Med, blocks?.Low, blocks?.VLow);
            var geometryCount = 0;
            var vertexCount = 0;
            var polyCount = 0;

            if (models != null)
            {
                foreach (var model in models)
                {
                    if (model?.Geometries == null) continue;
                    foreach (var geom in model.Geometries)
                    {
                        var vd = geom?.VertexData;
                        if (vd == null || vd.VertexCount <= 0) continue;
                        geometryCount++;
                        vertexCount += vd.VertexCount;

                        var indices = geom!.IndexBuffer?.Indices;
                        polyCount += indices is { Length: >= 3 }
                            ? indices.Length / 3
                            : vd.VertexCount / 3; // non-indexed fallback
                    }
                }
            }

            result.Add(new DrawableInfo(name, geometryCount, vertexCount, polyCount, lods));
        }

        if (result.Count == 0)
            throw new InvalidDataException("Keine Drawables in der YDD-Datei gefunden.");

        return result;
    }

    private static bool HasGeometry(DrawableModel[]? models)
    {
        if (models == null) return false;
        foreach (var model in models)
        {
            var geoms = model?.Geometries;
            if (geoms == null) continue;
            foreach (var geom in geoms)
            {
                if (geom?.VertexData is { VertexCount: > 0 }) return true;
            }
        }
        return false;
    }

    private static DrawableModel[]? FirstWithGeometry(params DrawableModel[]?[] lodLevels)
    {
        foreach (var level in lodLevels)
        {
            if (HasGeometry(level)) return level;
        }
        return null;
    }
}
