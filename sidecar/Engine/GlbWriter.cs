using System.Globalization;
using System.Text;

namespace Feelgood.Atelier.Sidecar.Engine;

/// <summary>
/// Minimal GLB 2.0 serializer for preview meshes: one scene, one mesh with
/// N primitives, shared POSITION/NORMAL/TEXCOORD_0 attributes and optional
/// embedded PNG textures (plain pbrMetallicRoughness baseColorTexture,
/// roughness 0.9, metallic 0 - no extensions). Adapted from the
/// Feelgood rage-sidecar GlbFromMeshBuilder.
/// </summary>
public static class GlbWriter
{
    /// <summary>One draw call: triangle indices + material (-1 = untextured default).</summary>
    public readonly record struct PrimitiveSpec(IReadOnlyList<uint> Indices, int MaterialIndex);

    /// <summary>One embedded PNG image; index doubles as the material index.</summary>
    public readonly record struct TextureSpec(byte[] PngBytes);

    public static byte[] Write(
        IReadOnlyList<float> positions,
        IReadOnlyList<PrimitiveSpec> primitives,
        IReadOnlyList<float>? normals,
        IReadOnlyList<float>? texcoords0,
        IReadOnlyList<TextureSpec> textures)
    {
        if (positions.Count % 3 != 0)
            throw new ArgumentException("positions must be xyz triplets");
        if (primitives.Count == 0)
            throw new ArgumentException("at least one primitive required");
        if (normals != null && normals.Count != positions.Count)
            throw new ArgumentException("normals must match positions length");
        if (texcoords0 != null && texcoords0.Count / 2 != positions.Count / 3)
            throw new ArgumentException("texcoords0 vertex count mismatch");

        var posBytes = new byte[positions.Count * sizeof(float)];
        Buffer.BlockCopy(positions.ToArray(), 0, posBytes, 0, posBytes.Length);

        var idxBytesPerPrim = new List<byte[]>(primitives.Count);
        foreach (var prim in primitives)
        {
            if (prim.Indices.Count % 3 != 0)
                throw new ArgumentException("indices must be triangles");
            var bytes = new byte[prim.Indices.Count * sizeof(uint)];
            Buffer.BlockCopy(prim.Indices.ToArray(), 0, bytes, 0, bytes.Length);
            idxBytesPerPrim.Add(bytes);
        }

        byte[]? nrmBytes = null;
        if (normals != null)
        {
            nrmBytes = new byte[normals.Count * sizeof(float)];
            Buffer.BlockCopy(normals.ToArray(), 0, nrmBytes, 0, nrmBytes.Length);
        }

        byte[]? uvBytes = null;
        if (texcoords0 != null)
        {
            uvBytes = new byte[texcoords0.Count * sizeof(float)];
            Buffer.BlockCopy(texcoords0.ToArray(), 0, uvBytes, 0, uvBytes.Length);
        }

        // Binary chunk layout: positions, normals, uvs, index buffers, images.
        var posOffset = 0;
        var nrmOffset = Align4(posOffset + posBytes.Length);
        var uvOffset = Align4(nrmOffset + (nrmBytes?.Length ?? 0));
        var offset = Align4(uvOffset + (uvBytes?.Length ?? 0));
        var idxOffsets = new List<int>(idxBytesPerPrim.Count);
        foreach (var idxBytes in idxBytesPerPrim)
        {
            idxOffsets.Add(offset);
            offset = Align4(offset + idxBytes.Length);
        }

        var imageOffsets = new List<int>(textures.Count);
        foreach (var tex in textures)
        {
            imageOffsets.Add(offset);
            offset = Align4(offset + tex.PngBytes.Length);
        }

        var bin = new byte[Align4(offset)];
        Buffer.BlockCopy(posBytes, 0, bin, posOffset, posBytes.Length);
        if (nrmBytes != null) Buffer.BlockCopy(nrmBytes, 0, bin, nrmOffset, nrmBytes.Length);
        if (uvBytes != null) Buffer.BlockCopy(uvBytes, 0, bin, uvOffset, uvBytes.Length);
        for (var i = 0; i < idxBytesPerPrim.Count; i++)
            Buffer.BlockCopy(idxBytesPerPrim[i], 0, bin, idxOffsets[i], idxBytesPerPrim[i].Length);
        for (var i = 0; i < textures.Count; i++)
            Buffer.BlockCopy(textures[i].PngBytes, 0, bin, imageOffsets[i], textures[i].PngBytes.Length);

        var (minX, minY, minZ, maxX, maxY, maxZ) = MinMax(positions);
        var vertexCount = positions.Count / 3;

        var primAttribs = "\"POSITION\":0";
        var accessorIdx = 1;
        var bufferViewIdx = 1;
        var accessorJson = new List<string>
        {
            "{\"bufferView\":0,\"byteOffset\":0,\"componentType\":5126,\"count\":" + vertexCount +
            ",\"type\":\"VEC3\",\"min\":[" + F(minX) + "," + F(minY) + "," + F(minZ) +
            "],\"max\":[" + F(maxX) + "," + F(maxY) + "," + F(maxZ) + "]}"
        };
        var bufferViewJson = new List<string>
        {
            "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":" + posBytes.Length + ",\"target\":34962}"
        };

        if (nrmBytes != null)
        {
            primAttribs += ",\"NORMAL\":" + accessorIdx;
            bufferViewJson.Add("{\"buffer\":0,\"byteOffset\":" + nrmOffset + ",\"byteLength\":" + nrmBytes.Length + ",\"target\":34962}");
            accessorJson.Add("{\"bufferView\":" + bufferViewIdx + ",\"byteOffset\":0,\"componentType\":5126,\"count\":" + vertexCount + ",\"type\":\"VEC3\"}");
            accessorIdx++;
            bufferViewIdx++;
        }
        if (uvBytes != null)
        {
            primAttribs += ",\"TEXCOORD_0\":" + accessorIdx;
            bufferViewJson.Add("{\"buffer\":0,\"byteOffset\":" + uvOffset + ",\"byteLength\":" + uvBytes.Length + ",\"target\":34962}");
            accessorJson.Add("{\"bufferView\":" + bufferViewIdx + ",\"byteOffset\":0,\"componentType\":5126,\"count\":" + vertexCount + ",\"type\":\"VEC2\"}");
            accessorIdx++;
            bufferViewIdx++;
        }

        var indexAccessorByPrim = new List<int>(primitives.Count);
        for (var i = 0; i < idxBytesPerPrim.Count; i++)
        {
            var idxBytes = idxBytesPerPrim[i];
            bufferViewJson.Add("{\"buffer\":0,\"byteOffset\":" + idxOffsets[i] + ",\"byteLength\":" + idxBytes.Length + ",\"target\":34963}");
            accessorJson.Add("{\"bufferView\":" + bufferViewIdx + ",\"byteOffset\":0,\"componentType\":5125,\"count\":" + idxBytes.Length / sizeof(uint) + ",\"type\":\"SCALAR\"}");
            indexAccessorByPrim.Add(accessorIdx);
            accessorIdx++;
            bufferViewIdx++;
        }

        // Materials only make sense with UVs; without them the writer keeps
        // the GLB untextured (callers pass MaterialIndex -1 in that case).
        var textureBlocks = string.Empty;
        var emitMaterials = textures.Count > 0 && uvBytes != null;
        if (emitMaterials)
        {
            var imageJson = new List<string>(textures.Count);
            var materialJson = new List<string>(textures.Count);
            for (var i = 0; i < textures.Count; i++)
            {
                bufferViewJson.Add("{\"buffer\":0,\"byteOffset\":" + imageOffsets[i] + ",\"byteLength\":" + textures[i].PngBytes.Length + "}");
                imageJson.Add("{\"bufferView\":" + bufferViewIdx + ",\"mimeType\":\"image/png\"}");
                materialJson.Add("{\"pbrMetallicRoughness\":{\"baseColorTexture\":{\"index\":" + i + "},\"metallicFactor\":0,\"roughnessFactor\":0.9},\"doubleSided\":true}");
                bufferViewIdx++;
            }

            var texturesJson = Enumerable.Range(0, textures.Count)
                .Select(i => "{\"sampler\":0,\"source\":" + i + "}");
            textureBlocks =
                ",\"images\":[" + string.Join(",", imageJson) + "]" +
                ",\"samplers\":[{\"magFilter\":9729,\"minFilter\":9987,\"wrapS\":10497,\"wrapT\":10497}]" +
                ",\"textures\":[" + string.Join(",", texturesJson) + "]" +
                ",\"materials\":[" + string.Join(",", materialJson) + "]";
        }

        var primitiveJson = new List<string>(primitives.Count);
        for (var i = 0; i < primitives.Count; i++)
        {
            var materialIndex = emitMaterials ? primitives[i].MaterialIndex : -1;
            var materialPart = materialIndex >= 0 ? ",\"material\":" + materialIndex : string.Empty;
            primitiveJson.Add("{\"attributes\":{" + primAttribs + "},\"indices\":" + indexAccessorByPrim[i] + ",\"mode\":4" + materialPart + "}");
        }

        var json = "{" +
                   "\"asset\":{\"version\":\"2.0\",\"generator\":\"fg-atelier-sidecar\"}," +
                   "\"scene\":0," +
                   "\"scenes\":[{\"nodes\":[0]}]," +
                   "\"nodes\":[{\"mesh\":0}]," +
                   "\"meshes\":[{\"primitives\":[" + string.Join(",", primitiveJson) + "]}]," +
                   "\"buffers\":[{\"byteLength\":" + bin.Length + "}]," +
                   "\"bufferViews\":[" + string.Join(",", bufferViewJson) + "]," +
                   "\"accessors\":[" + string.Join(",", accessorJson) + "]" +
                   textureBlocks +
                   "}";

        var jsonPadded = PadWithSpaces(Encoding.UTF8.GetBytes(json));
        var totalLength = 12 + 8 + jsonPadded.Length + 8 + bin.Length;

        using var ms = new MemoryStream(totalLength);
        using var bw = new BinaryWriter(ms);
        bw.Write(0x46546C67); // "glTF"
        bw.Write(2);          // container version
        bw.Write(totalLength);
        bw.Write(jsonPadded.Length);
        bw.Write(0x4E4F534A); // "JSON"
        bw.Write(jsonPadded);
        bw.Write(bin.Length);
        bw.Write(0x004E4942); // "BIN\0"
        bw.Write(bin);
        return ms.ToArray();
    }

    private static string F(float f) => f.ToString("0.######", CultureInfo.InvariantCulture);

    private static (float minX, float minY, float minZ, float maxX, float maxY, float maxZ) MinMax(IReadOnlyList<float> p)
    {
        float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
        float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;
        for (var i = 0; i < p.Count; i += 3)
        {
            if (p[i] < minX) minX = p[i];
            if (p[i + 1] < minY) minY = p[i + 1];
            if (p[i + 2] < minZ) minZ = p[i + 2];
            if (p[i] > maxX) maxX = p[i];
            if (p[i + 1] > maxY) maxY = p[i + 1];
            if (p[i + 2] > maxZ) maxZ = p[i + 2];
        }
        return (minX, minY, minZ, maxX, maxY, maxZ);
    }

    private static int Align4(int x) => (x + 3) & ~3;

    /// <summary>The JSON chunk must be 4-byte aligned, padded with spaces per spec.</summary>
    private static byte[] PadWithSpaces(byte[] src)
    {
        var len = Align4(src.Length);
        if (len == src.Length) return src;
        var dst = new byte[len];
        Buffer.BlockCopy(src, 0, dst, 0, src.Length);
        for (var i = src.Length; i < len; i++) dst[i] = 0x20;
        return dst;
    }
}
