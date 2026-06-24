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

    // ----------------------------------------------------------------- skinned

    /// <summary>One joint: parent (−1 = root), bind-pose local TRS and the
    /// inverse-bind matrix as 16 floats (row-major SharpDX order, which IS the
    /// column-major glTF layout of its transpose — the correct conversion).</summary>
    public readonly record struct SkinJoint(
        int ParentIndex, float[] Translation, float[] Rotation, float[] Scale, float[] InverseBind16);

    /// <summary>Per-frame local TRS for one animated joint (shared time array).</summary>
    public readonly record struct SkinTrack(
        int JointIndex, float[] Translations, float[] Rotations, float[] Scales);

    /// <summary>Everything needed to write a skinned + animated GLB.</summary>
    public sealed class SkinnedMesh
    {
        public required IReadOnlyList<float> Positions { get; init; }     // bind pose, GTA (Z-up) space
        public required IReadOnlyList<PrimitiveSpec> Primitives { get; init; }
        public IReadOnlyList<float>? Normals { get; init; }
        public IReadOnlyList<float>? Texcoords0 { get; init; }
        public required IReadOnlyList<ushort> Joints0 { get; init; }       // 4 per vertex
        public required IReadOnlyList<float> Weights0 { get; init; }        // 4 per vertex
        public required IReadOnlyList<TextureSpec> Textures { get; init; }
        public required SkinJoint[] Joints { get; init; }
        public required int[] Roots { get; init; }                          // joint indices with no parent
        public required float[] Times { get; init; }                        // seconds, ascending from 0
        public required SkinTrack[] Tracks { get; init; }
    }

    /// <summary>
    /// Writes a skinned, animated GLB: one mesh + skin (JOINTS_0/WEIGHTS_0), a
    /// joint-node hierarchy with bind TRS, an inverse-bind accessor and one
    /// animation. The GTA Z-up→Y-up swap lives on a ROOT node above the joints
    /// (skinned-mesh node transforms are ignored per spec), so geometry, joints,
    /// inverse-bind and keyframes all stay in native GTA space.
    /// </summary>
    public static byte[] WriteSkinned(SkinnedMesh m)
    {
        var vertexCount = m.Positions.Count / 3;
        if (m.Positions.Count % 3 != 0) throw new ArgumentException("positions must be xyz triplets");
        if (m.Primitives.Count == 0) throw new ArgumentException("at least one primitive required");
        if (m.Joints0.Count != vertexCount * 4) throw new ArgumentException("joints0 must be 4 per vertex");
        if (m.Weights0.Count != vertexCount * 4) throw new ArgumentException("weights0 must be 4 per vertex");

        var bin = new List<byte>(1 << 16);
        var bufferViews = new List<string>();
        var accessors = new List<string>();

        int AddView(byte[] data, int? target)
        {
            while (bin.Count % 4 != 0) bin.Add(0);
            var offset = bin.Count;
            bin.AddRange(data);
            bufferViews.Add("{\"buffer\":0,\"byteOffset\":" + offset + ",\"byteLength\":" + data.Length +
                            (target != null ? ",\"target\":" + target : "") + "}");
            return bufferViews.Count - 1;
        }
        int AddAccessor(string json) { accessors.Add(json); return accessors.Count - 1; }

        // --- vertex attributes ---
        var (minX, minY, minZ, maxX, maxY, maxZ) = MinMax(m.Positions);
        var posView = AddView(FloatBytes(m.Positions), 34962);
        var posAcc = AddAccessor("{\"bufferView\":" + posView + ",\"componentType\":5126,\"count\":" + vertexCount +
            ",\"type\":\"VEC3\",\"min\":[" + F(minX) + "," + F(minY) + "," + F(minZ) + "],\"max\":[" + F(maxX) + "," + F(maxY) + "," + F(maxZ) + "]}");
        var attribs = "\"POSITION\":" + posAcc;

        if (m.Normals != null && m.Normals.Count == m.Positions.Count)
        {
            var v = AddView(FloatBytes(m.Normals), 34962);
            var a = AddAccessor("{\"bufferView\":" + v + ",\"componentType\":5126,\"count\":" + vertexCount + ",\"type\":\"VEC3\"}");
            attribs += ",\"NORMAL\":" + a;
        }
        if (m.Texcoords0 != null && m.Texcoords0.Count == vertexCount * 2)
        {
            var v = AddView(FloatBytes(m.Texcoords0), 34962);
            var a = AddAccessor("{\"bufferView\":" + v + ",\"componentType\":5126,\"count\":" + vertexCount + ",\"type\":\"VEC2\"}");
            attribs += ",\"TEXCOORD_0\":" + a;
        }
        {
            var v = AddView(UShortBytes(m.Joints0), 34962);
            var a = AddAccessor("{\"bufferView\":" + v + ",\"componentType\":5123,\"count\":" + vertexCount + ",\"type\":\"VEC4\"}");
            attribs += ",\"JOINTS_0\":" + a;
        }
        {
            var v = AddView(FloatBytes(m.Weights0), 34962);
            var a = AddAccessor("{\"bufferView\":" + v + ",\"componentType\":5126,\"count\":" + vertexCount + ",\"type\":\"VEC4\"}");
            attribs += ",\"WEIGHTS_0\":" + a;
        }

        // --- index buffers (one accessor per primitive) ---
        var indexAccessorByPrim = new List<int>(m.Primitives.Count);
        foreach (var prim in m.Primitives)
        {
            if (prim.Indices.Count % 3 != 0) throw new ArgumentException("indices must be triangles");
            var v = AddView(UIntBytes(prim.Indices), 34963);
            indexAccessorByPrim.Add(AddAccessor("{\"bufferView\":" + v + ",\"componentType\":5125,\"count\":" + prim.Indices.Count + ",\"type\":\"SCALAR\"}"));
        }

        // --- textures / materials (same scheme as Write) ---
        var emitMaterials = m.Textures.Count > 0 && m.Texcoords0 != null;
        var textureBlocks = string.Empty;
        if (emitMaterials)
        {
            var imageJson = new List<string>(m.Textures.Count);
            var materialJson = new List<string>(m.Textures.Count);
            for (var i = 0; i < m.Textures.Count; i++)
            {
                var v = AddView(m.Textures[i].PngBytes, null);
                imageJson.Add("{\"bufferView\":" + v + ",\"mimeType\":\"image/png\"}");
                materialJson.Add("{\"pbrMetallicRoughness\":{\"baseColorTexture\":{\"index\":" + i + "},\"metallicFactor\":0,\"roughnessFactor\":0.9},\"doubleSided\":true}");
            }
            var texturesJson = Enumerable.Range(0, m.Textures.Count).Select(i => "{\"sampler\":0,\"source\":" + i + "}");
            textureBlocks =
                ",\"images\":[" + string.Join(",", imageJson) + "]" +
                ",\"samplers\":[{\"magFilter\":9729,\"minFilter\":9987,\"wrapS\":10497,\"wrapT\":10497}]" +
                ",\"textures\":[" + string.Join(",", texturesJson) + "]" +
                ",\"materials\":[" + string.Join(",", materialJson) + "]";
        }

        var primitiveJson = new List<string>(m.Primitives.Count);
        for (var i = 0; i < m.Primitives.Count; i++)
        {
            var materialIndex = emitMaterials ? m.Primitives[i].MaterialIndex : -1;
            var materialPart = materialIndex >= 0 ? ",\"material\":" + materialIndex : string.Empty;
            primitiveJson.Add("{\"attributes\":{" + attribs + "},\"indices\":" + indexAccessorByPrim[i] + ",\"mode\":4" + materialPart + "}");
        }

        // --- skin: inverse-bind accessor + joint node list ---
        var ibm = new List<float>(m.Joints.Length * 16);
        foreach (var j in m.Joints) ibm.AddRange(j.InverseBind16);
        var ibmView = AddView(FloatBytes(ibm), null);
        var ibmAcc = AddAccessor("{\"bufferView\":" + ibmView + ",\"componentType\":5126,\"count\":" + m.Joints.Length + ",\"type\":\"MAT4\"}");

        // Node indices: 0 = mesh, 1 = axis-swap root, 2+jointIndex = joint nodes.
        const int meshNodeIdx = 0;
        const int swapNodeIdx = 1;
        const int jointBase = 2;
        var jointNode = new Func<int, int>(j => jointBase + j);

        var childrenByJoint = new List<int>[m.Joints.Length];
        for (var i = 0; i < m.Joints.Length; i++) childrenByJoint[i] = new List<int>();
        for (var i = 0; i < m.Joints.Length; i++)
        {
            var parent = m.Joints[i].ParentIndex;
            if (parent >= 0 && parent < m.Joints.Length) childrenByJoint[parent].Add(i);
        }

        var jointNodesJson = new List<string>(m.Joints.Length);
        for (var i = 0; i < m.Joints.Length; i++)
        {
            var j = m.Joints[i];
            var children = childrenByJoint[i].Count > 0
                ? ",\"children\":[" + string.Join(",", childrenByJoint[i].Select(c => jointNode(c))) + "]"
                : string.Empty;
            jointNodesJson.Add(
                "{\"translation\":[" + F(j.Translation[0]) + "," + F(j.Translation[1]) + "," + F(j.Translation[2]) + "]" +
                ",\"rotation\":[" + F(j.Rotation[0]) + "," + F(j.Rotation[1]) + "," + F(j.Rotation[2]) + "," + F(j.Rotation[3]) + "]" +
                ",\"scale\":[" + F(j.Scale[0]) + "," + F(j.Scale[1]) + "," + F(j.Scale[2]) + "]" + children + "}");
        }

        var jointList = string.Join(",", Enumerable.Range(0, m.Joints.Length).Select(jointNode));
        var skinJson = "{\"inverseBindMatrices\":" + ibmAcc + ",\"skeleton\":" + swapNodeIdx + ",\"joints\":[" + jointList + "]}";

        // --- animation: shared time input + per-track T/R/S samplers ---
        var timeMin = m.Times.Length > 0 ? m.Times[0] : 0f;
        var timeMax = m.Times.Length > 0 ? m.Times[^1] : 0f;
        var timeView = AddView(FloatBytes(m.Times), null);
        var timeAcc = AddAccessor("{\"bufferView\":" + timeView + ",\"componentType\":5126,\"count\":" + m.Times.Length +
            ",\"type\":\"SCALAR\",\"min\":[" + F(timeMin) + "],\"max\":[" + F(timeMax) + "]}");

        var samplers = new List<string>();
        var channels = new List<string>();
        void AddChannel(int targetJoint, string path, float[] values, string type, int components)
        {
            var count = values.Length / components;
            var v = AddView(FloatBytes(values), null);
            var outAcc = AddAccessor("{\"bufferView\":" + v + ",\"componentType\":5126,\"count\":" + count + ",\"type\":\"" + type + "\"}");
            var sampler = samplers.Count;
            samplers.Add("{\"input\":" + timeAcc + ",\"interpolation\":\"LINEAR\",\"output\":" + outAcc + "}");
            channels.Add("{\"sampler\":" + sampler + ",\"target\":{\"node\":" + jointNode(targetJoint) + ",\"path\":\"" + path + "\"}}");
        }
        foreach (var tr in m.Tracks)
        {
            if (tr.Translations.Length > 0) AddChannel(tr.JointIndex, "translation", tr.Translations, "VEC3", 3);
            if (tr.Rotations.Length > 0) AddChannel(tr.JointIndex, "rotation", tr.Rotations, "VEC4", 4);
            if (tr.Scales.Length > 0) AddChannel(tr.JointIndex, "scale", tr.Scales, "VEC3", 3);
        }
        var animationBlock = channels.Count > 0
            ? ",\"animations\":[{\"name\":\"clip\",\"channels\":[" + string.Join(",", channels) + "],\"samplers\":[" + string.Join(",", samplers) + "]}]"
            : string.Empty;

        // --- nodes / scene ---
        // -90° about X (Z-up→Y-up): quaternion (-sin45,0,0,cos45).
        var roots = m.Roots.Length > 0 ? m.Roots : new[] { 0 };
        var swapChildren = string.Join(",", roots.Select(jointNode));
        var nodesJson =
            "{\"mesh\":0,\"skin\":0}," +
            "{\"rotation\":[-0.70710677,0,0,0.70710677],\"children\":[" + swapChildren + "]}," +
            string.Join(",", jointNodesJson);

        var binArr = bin.ToArray();
        if (binArr.Length % 4 != 0) Array.Resize(ref binArr, Align4(binArr.Length));

        var json = "{" +
            "\"asset\":{\"version\":\"2.0\",\"generator\":\"fg-atelier-sidecar\"}," +
            "\"scene\":0,\"scenes\":[{\"nodes\":[" + meshNodeIdx + "," + swapNodeIdx + "]}]," +
            "\"nodes\":[" + nodesJson + "]," +
            "\"meshes\":[{\"primitives\":[" + string.Join(",", primitiveJson) + "]}]," +
            "\"skins\":[" + skinJson + "]," +
            "\"buffers\":[{\"byteLength\":" + binArr.Length + "}]," +
            "\"bufferViews\":[" + string.Join(",", bufferViews) + "]," +
            "\"accessors\":[" + string.Join(",", accessors) + "]" +
            textureBlocks + animationBlock + "}";

        var jsonPadded = PadWithSpaces(Encoding.UTF8.GetBytes(json));
        var totalLength = 12 + 8 + jsonPadded.Length + 8 + binArr.Length;
        using var ms = new MemoryStream(totalLength);
        using var bw = new BinaryWriter(ms);
        bw.Write(0x46546C67); bw.Write(2); bw.Write(totalLength);
        bw.Write(jsonPadded.Length); bw.Write(0x4E4F534A); bw.Write(jsonPadded);
        bw.Write(binArr.Length); bw.Write(0x004E4942); bw.Write(binArr);
        return ms.ToArray();
    }

    private static byte[] FloatBytes(IReadOnlyList<float> values)
    {
        var arr = values as float[] ?? values.ToArray();
        var bytes = new byte[arr.Length * sizeof(float)];
        Buffer.BlockCopy(arr, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    private static byte[] UIntBytes(IReadOnlyList<uint> values)
    {
        var arr = values as uint[] ?? values.ToArray();
        var bytes = new byte[arr.Length * sizeof(uint)];
        Buffer.BlockCopy(arr, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    private static byte[] UShortBytes(IReadOnlyList<ushort> values)
    {
        var arr = values as ushort[] ?? values.ToArray();
        var bytes = new byte[arr.Length * sizeof(ushort)];
        Buffer.BlockCopy(arr, 0, bytes, 0, bytes.Length);
        return bytes;
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
