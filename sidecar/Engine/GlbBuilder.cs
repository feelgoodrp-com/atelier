using CodeWalker.GameFiles;
using CodeWalker.Utils;
using Feelgood.Atelier.Sidecar.Engine.Pose;
using Feelgood.Atelier.Sidecar.Parsing;
using SharpDX;

namespace Feelgood.Atelier.Sidecar.Engine;

/// <summary>
/// Builds a preview GLB from a standalone .ydd: extracts the highest-LOD
/// geometry (positions/normals/uv0/indices) of ALL drawables into one scene,
/// resolves the diffuse texture from an optional .ytd (DDSIO decode -> PNG)
/// and optionally merges the ped body drawables behind the garment.
/// Geometry walk and GTA->glTF conversion adapted from the Feelgood
/// rage-sidecar (GrzyCodeWalkerPreviewEngine); LOD selection matches
/// <see cref="YddParser"/> so vertex counts line up with /parse/ydd.
/// With a <see cref="PoseData"/> the vertices are CPU-skinned (4-bone blend
/// of BlendWeights/BlendIndices against the posed freemode skeleton) into a
/// STATIC posed mesh; pose=null keeps today's bind-pose output unchanged.
/// </summary>
public static class GlbBuilder
{
    public sealed record Result(byte[] Glb, int VertexCount, int PolyCount);

    public static Result Build(
        byte[] yddBytes,
        byte[]? ytdBytes,
        IReadOnlyList<PedBodyService.PedComponent>? pedComponents,
        ILogger log,
        PoseData? pose = null)
    {
        var ydd = LoadYdd(yddBytes);
        if (ydd?.Drawables == null || ydd.Drawables.Length == 0)
            throw new InvalidDataException("Keine Drawables in der YDD-Datei gefunden.");

        var mesh = new MeshAccumulator();

        // 1) Garment drawables (all of them - multi-drawable YDDs land in one scene).
        var garmentPrimitives = new List<Primitive>();
        foreach (var drawable in ydd.Drawables)
        {
            if (drawable == null) continue;
            AppendDrawable(drawable, mesh, garmentPrimitives, pose);
        }

        if (mesh.Positions.Count < 9 || garmentPrimitives.Count == 0)
            throw new InvalidDataException("Keine renderbare Geometrie in der YDD-Datei gefunden.");

        var garmentHasUv0 = mesh.HasUv0;

        // 2) Diffuse texture for the garment from the selected texture dict.
        var textures = new List<GlbWriter.TextureSpec>();
        if (ytdBytes != null && garmentHasUv0)
        {
            var textureDict = LoadYtd(ytdBytes);
            ResolveGarmentMaterials(textureDict, garmentPrimitives, textures, log);
        }

        // 3) Optional ped body, each component textured from the ped's own YTD.
        if (pedComponents != null)
        {
            foreach (var component in pedComponents)
            {
                var componentPrimitives = new List<Primitive>();
                AppendDrawable(component.Drawable, mesh, componentPrimitives, pose);
                if (componentPrimitives.Count == 0) continue;

                var materialIndex = ResolveComponentMaterial(component, textures, log);
                foreach (var primitive in componentPrimitives)
                    primitive.MaterialIndex = materialIndex;
                garmentPrimitives.AddRange(componentPrimitives);
            }
        }

        var primitiveSpecs = garmentPrimitives
            .Select(p => new GlbWriter.PrimitiveSpec(p.Indices, p.MaterialIndex))
            .ToList();
        var glb = GlbWriter.Write(
            mesh.Positions,
            primitiveSpecs,
            mesh.HasNormals ? mesh.Normals : null,
            mesh.HasUv0 ? mesh.Uvs0 : null,
            textures);

        var vertexCount = mesh.Positions.Count / 3;
        var polyCount = garmentPrimitives.Sum(p => p.Indices.Count) / 3;
        return new Result(glb, vertexCount, polyCount);
    }

    /// <summary>One outfit garment: mesh bytes, optional texture dict bytes,
    /// and the ped component slot it REPLACES (null for props/unknown).</summary>
    public sealed record OutfitItem(byte[] YddBytes, byte[]? YtdBytes, int? CoversComponentIndex);

    /// <summary>
    /// Builds ONE scene from several garments at once. With a ped body, the
    /// selected garments REPLACE the ped's default components in their slots
    /// (e.g. the default shirt disappears under a selected jacket) — like the
    /// grzyClothTool preview, instead of stacking full peds per garment.
    /// </summary>
    public static Result BuildOutfit(
        IReadOnlyList<OutfitItem> items,
        IReadOnlyList<PedBodyService.PedComponent>? pedComponents,
        ILogger log,
        PoseData? pose = null)
    {
        var mesh = new MeshAccumulator();
        var allPrimitives = new List<Primitive>();
        var textures = new List<GlbWriter.TextureSpec>();

        foreach (var item in items)
        {
            var ydd = LoadYdd(item.YddBytes);
            if (ydd?.Drawables == null || ydd.Drawables.Length == 0)
                throw new InvalidDataException("Keine Drawables in einer der YDD-Dateien gefunden.");

            var itemPrimitives = new List<Primitive>();
            foreach (var drawable in ydd.Drawables)
            {
                if (drawable == null) continue;
                AppendDrawable(drawable, mesh, itemPrimitives, pose);
            }
            if (itemPrimitives.Count == 0) continue;

            if (item.YtdBytes != null && mesh.HasUv0)
            {
                var textureDict = LoadYtd(item.YtdBytes);
                ResolveGarmentMaterials(textureDict, itemPrimitives, textures, log);
            }
            allPrimitives.AddRange(itemPrimitives);
        }

        if (mesh.Positions.Count < 9 || allPrimitives.Count == 0)
            throw new InvalidDataException("Keine renderbare Geometrie in den YDD-Dateien gefunden.");

        if (pedComponents != null)
        {
            // Slots covered by a selected garment lose their default component.
            var covered = new HashSet<int>(
                items.Where(i => i.CoversComponentIndex != null).Select(i => i.CoversComponentIndex!.Value));

            foreach (var component in pedComponents)
            {
                if (covered.Contains(component.ComponentIndex)) continue;

                var componentPrimitives = new List<Primitive>();
                AppendDrawable(component.Drawable, mesh, componentPrimitives, pose);
                if (componentPrimitives.Count == 0) continue;

                var materialIndex = ResolveComponentMaterial(component, textures, log);
                foreach (var primitive in componentPrimitives)
                    primitive.MaterialIndex = materialIndex;
                allPrimitives.AddRange(componentPrimitives);
            }
        }

        var primitiveSpecs = allPrimitives
            .Select(p => new GlbWriter.PrimitiveSpec(p.Indices, p.MaterialIndex))
            .ToList();
        var glb = GlbWriter.Write(
            mesh.Positions,
            primitiveSpecs,
            mesh.HasNormals ? mesh.Normals : null,
            mesh.HasUv0 ? mesh.Uvs0 : null,
            textures);

        var vertexCount = mesh.Positions.Count / 3;
        var polyCount = allPrimitives.Sum(p => p.Indices.Count) / 3;
        return new Result(glb, vertexCount, polyCount);
    }

    private static YddFile LoadYdd(byte[] fileBytes)
    {
        // CreateResourceFileEntry mutates the buffer (strips the RSC7 header),
        // so work on a copy. Same pattern as YddParser.
        var data = (byte[])fileBytes.Clone();
        var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
        var decompressed = ResourceBuilder.Decompress(data);
        return RpfFile.GetFile<YddFile>(entry, decompressed);
    }

    private static TextureDictionary? LoadYtd(byte[] fileBytes)
    {
        var data = (byte[])fileBytes.Clone();
        var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
        var decompressed = ResourceBuilder.Decompress(data);
        return RpfFile.GetFile<YtdFile>(entry, decompressed)?.TextureDict;
    }

    /// <summary>
    /// Assigns each garment primitive the texture its shader prefers (diffuse
    /// name hash), falling back to the dict's first texture when no shader
    /// hash resolves. Decode failures degrade to an untextured preview.
    /// </summary>
    private static void ResolveGarmentMaterials(
        TextureDictionary? textureDict,
        List<Primitive> garmentPrimitives,
        List<GlbWriter.TextureSpec> textures,
        ILogger log)
    {
        if (textureDict == null) return;

        var materialByHash = new Dictionary<uint, int>();
        foreach (var hash in garmentPrimitives.Select(p => p.TextureHash).Where(h => h != 0).Distinct())
        {
            var texture = textureDict.Lookup(hash);
            if (texture == null) continue;
            var materialIndex = TryAddTexture(texture, textures, log);
            if (materialIndex >= 0) materialByHash[hash] = materialIndex;
        }

        var fallbackMaterial = -1;
        if (materialByHash.Count == 0)
        {
            var firstTexture = textureDict.Textures?.data_items?.FirstOrDefault(t => t != null);
            if (firstTexture != null)
                fallbackMaterial = TryAddTexture(firstTexture, textures, log);
        }

        foreach (var primitive in garmentPrimitives)
        {
            primitive.MaterialIndex = materialByHash.TryGetValue(primitive.TextureHash, out var m)
                ? m
                : fallbackMaterial;
        }
    }

    /// <summary>
    /// Picks a component's material: the face compositor's pre-decoded diffuse
    /// override wins (head/uppr/lowr/feet skin); otherwise the component's own
    /// GTA texture is decoded as before. -1 leaves the component untextured.
    /// </summary>
    private static int ResolveComponentMaterial(
        PedBodyService.PedComponent component,
        List<GlbWriter.TextureSpec> textures,
        ILogger log)
    {
        if (component.DiffuseOverride != null)
            return TryAddRgbaTexture(component.DiffuseOverride, textures, log);
        return component.Texture != null ? TryAddTexture(component.Texture, textures, log) : -1;
    }

    /// <summary>
    /// Appends a pre-decoded straight-RGBA8 image (already R-first, no DDSIO
    /// swizzle needed) as an embedded PNG; -1 on a malformed buffer. Used for
    /// the composited face skin diffuses.
    /// </summary>
    private static int TryAddRgbaTexture(
        PedBodyService.DiffuseOverride diffuse,
        List<GlbWriter.TextureSpec> textures,
        ILogger log)
    {
        try
        {
            var width = Math.Max(1, diffuse.Width);
            var height = Math.Max(1, diffuse.Height);
            if (diffuse.Rgba.Length < width * height * 4) return -1;
            textures.Add(new GlbWriter.TextureSpec(PngEncoder.EncodeRgba(diffuse.Rgba, width, height)));
            return textures.Count - 1;
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Face diffuse override encode failed ({Width}x{Height})", diffuse.Width, diffuse.Height);
            return -1;
        }
    }

    /// <summary>Decodes a texture to RGBA (mip 0) and appends it as embedded PNG; -1 on failure.</summary>
    private static int TryAddTexture(Texture texture, List<GlbWriter.TextureSpec> textures, ILogger log)
    {
        try
        {
            var rgba = DDSIO.GetPixels(texture, 0);
            if (rgba == null || rgba.Length == 0) return -1;

            var width = Math.Max(1, (int)texture.Width);
            var height = Math.Max(1, (int)texture.Height);
            if (rgba.Length < width * height * 4) return -1;

            // DDSIO.GetPixels returns BGRA byte order (GDI+/WPF convention);
            // PNG scanlines are RGBA, so swap R/B before encoding.
            PixelSwizzle.BgraToRgbaInPlace(rgba);
            textures.Add(new GlbWriter.TextureSpec(PngEncoder.EncodeRgba(rgba, width, height)));
            return textures.Count - 1;
        }
        catch (Exception ex)
        {
            // Exotic texture formats must not break the mesh preview.
            log.LogWarning(ex, "Preview texture decode failed for {Texture}", texture?.Name);
            return -1;
        }
    }

    private sealed class Primitive
    {
        public List<uint> Indices { get; } = new(512);
        public uint TextureHash { get; set; }
        public int MaterialIndex { get; set; } = -1;
    }

    private sealed class MeshAccumulator
    {
        public List<float> Positions { get; } = new(8192);
        public List<float> Normals { get; } = new(8192);
        public List<float> Uvs0 { get; } = new(8192);
        public bool HasNormals { get; set; }
        public bool HasUv0 { get; set; }
        public uint VertexBase { get; set; }
    }

    /// <summary>
    /// Appends the highest LOD level that contains geometry (High, then Med,
    /// Low, VLow - same selection as <see cref="YddParser"/>) as one primitive
    /// per geometry. Vertices use glTF's Y-up convention. With a pose the
    /// positions AND normals are CPU-skinned in GTA space first (4-bone
    /// weighted blend); without one this path is byte-identical to before.
    /// </summary>
    private static void AppendDrawable(Drawable drawable, MeshAccumulator mesh, List<Primitive> primitives, PoseData? pose = null)
    {
        var blocks = drawable.DrawableModels;
        var models = FirstWithGeometry(blocks?.High, blocks?.Med, blocks?.Low, blocks?.VLow);
        if (models == null) return;

        foreach (var model in models)
        {
            if (model?.Geometries == null) continue;

            // Renderer semantics for vertices WITHOUT blend data: they move
            // rigidly with the model's bone. Our skin matrices are relative
            // to the bind pose (identity when unposed), so this also keeps
            // such geometry exactly where the bind-pose preview puts it.
            var modelMatrix = Matrix.Identity;
            if (pose != null)
            {
                int modelBone = model.BoneIndex;
                if (modelBone >= 0 && modelBone < pose.SkinTransforms.Length)
                    modelMatrix = pose.SkinTransforms[modelBone];
            }

            foreach (var geom in model.Geometries)
            {
                var vd = geom?.VertexData;
                if (vd == null || vd.VertexCount <= 0) continue;

                var primitive = new Primitive { TextureHash = ExtractPreferredTextureHash(geom!.Shader) };
                var hasNormals = HasSemantic(vd, VertexSemantics.Normal);
                var hasUv0 = HasSemantic(vd, VertexSemantics.TexCoord0);
                if (hasNormals) mesh.HasNormals = true;
                if (hasUv0) mesh.HasUv0 = true;

                var hasBlend = pose != null
                    && HasSemantic(vd, VertexSemantics.BlendWeights)
                    && HasSemantic(vd, VertexSemantics.BlendIndices);
                // Per-geometry bone list: maps the geometry-local blend index
                // to the skeleton bone index (renderer: only consulted when
                // its length differs from the skeleton's bone count).
                var geomBoneIds = geom.BoneIds;
                var remapBoneIds = geomBoneIds != null && pose != null
                    && geomBoneIds.Length != pose.SkinTransforms.Length;

                for (var v = 0; v < vd.VertexCount; v++)
                {
                    var skinMatrix = modelMatrix;
                    if (hasBlend)
                        skinMatrix = BlendSkinMatrix(vd, v, remapBoneIds ? geomBoneIds : null, pose!.SkinTransforms, modelMatrix);

                    var p = vd.GetVector3(v, (int)VertexSemantics.Position);
                    if (pose != null) p = Vector3.TransformCoordinate(p, skinMatrix);
                    // GTA is Z-up, glTF is Y-up (rotate -90deg around X).
                    mesh.Positions.Add(p.X);
                    mesh.Positions.Add(p.Z);
                    mesh.Positions.Add(-p.Y);

                    if (hasNormals)
                    {
                        var raw = GetSemanticVec3(vd, v, VertexSemantics.Normal);
                        var n = new Vector3(raw.x, raw.y, raw.z);
                        if (pose != null)
                        {
                            n = Vector3.TransformNormal(n, skinMatrix);
                            var length = n.Length();
                            if (length > 1e-6f) n /= length;
                        }
                        mesh.Normals.Add(n.X);
                        mesh.Normals.Add(n.Z);
                        mesh.Normals.Add(-n.Y);
                    }
                    else
                    {
                        mesh.Normals.Add(0f);
                        mesh.Normals.Add(1f);
                        mesh.Normals.Add(0f);
                    }

                    if (hasUv0)
                    {
                        var uv = GetSemanticVec2(vd, v, VertexSemantics.TexCoord0);
                        mesh.Uvs0.Add(uv.x);
                        mesh.Uvs0.Add(uv.y);
                    }
                    else
                    {
                        mesh.Uvs0.Add(0f);
                        mesh.Uvs0.Add(0f);
                    }
                }

                var indices = geom.IndexBuffer?.Indices;
                if (indices is { Length: >= 3 })
                {
                    for (var i = 0; i + 2 < indices.Length; i += 3)
                    {
                        primitive.Indices.Add(mesh.VertexBase + indices[i]);
                        primitive.Indices.Add(mesh.VertexBase + indices[i + 1]);
                        primitive.Indices.Add(mesh.VertexBase + indices[i + 2]);
                    }
                }
                else
                {
                    // Non-indexed fallback: consecutive triangles.
                    for (var i = 0u; i + 2 < vd.VertexCount; i += 3)
                    {
                        primitive.Indices.Add(mesh.VertexBase + i);
                        primitive.Indices.Add(mesh.VertexBase + i + 1);
                        primitive.Indices.Add(mesh.VertexBase + i + 2);
                    }
                }

                if (primitive.Indices.Count >= 3)
                    primitives.Add(primitive);
                mesh.VertexBase += (uint)vd.VertexCount;
            }
        }
    }

    private static DrawableModel[]? FirstWithGeometry(params DrawableModel[]?[] lodLevels)
    {
        foreach (var level in lodLevels)
        {
            if (level == null) continue;
            foreach (var model in level)
            {
                var geoms = model?.Geometries;
                if (geoms == null) continue;
                foreach (var geom in geoms)
                {
                    if (geom?.VertexData is { VertexCount: > 0 }) return level;
                }
            }
        }
        return null;
    }

    /// <summary>
    /// Picks the shader's diffuse texture name hash (highest weight wins);
    /// normal/bump maps are weighted last so they never beat a color map.
    /// </summary>
    private static uint ExtractPreferredTextureHash(ShaderFX? shader)
    {
        var hashes = shader?.ParametersList?.Hashes;
        var parameters = shader?.ParametersList?.Parameters;
        if (hashes == null || parameters == null) return 0;

        var count = Math.Min(hashes.Length, parameters.Length);
        uint chosen = 0;
        var bestWeight = int.MinValue;
        for (var i = 0; i < count; i++)
        {
            var param = parameters[i];
            if (param == null || param.DataType != 0) continue;
            // Texture derives from TextureBase, so one pattern covers both.
            if (param.Data is not TextureBase textureBase) continue;
            uint nameHash = textureBase.NameHash;
            if (nameHash == 0) continue;

            var paramName = ((ShaderParamNames)hashes[i]).ToString();
            var weight = 10;
            if (paramName.Contains("Diffuse", StringComparison.OrdinalIgnoreCase)) weight = 100;
            else if (paramName.Contains("BaseSampler", StringComparison.OrdinalIgnoreCase) ||
                     paramName.Contains("baseTextureSampler", StringComparison.OrdinalIgnoreCase)) weight = 90;
            else if (paramName.Contains("Color", StringComparison.OrdinalIgnoreCase)) weight = 80;
            else if (paramName.Contains("Normal", StringComparison.OrdinalIgnoreCase) ||
                     paramName.Contains("Bump", StringComparison.OrdinalIgnoreCase)) weight = 1;

            if (weight > bestWeight)
            {
                bestWeight = weight;
                chosen = nameHash;
            }
        }
        return chosen;
    }

    private static bool HasSemantic(VertexData vd, VertexSemantics semantic)
    {
        var flags = vd.Info?.Flags ?? 0u;
        return ((flags >> (int)semantic) & 0x1u) == 1u;
    }

    /// <summary>
    /// 4-bone weighted blend of the pose skin matrices for one vertex.
    /// Weights are UNORM bytes (sum typically 255, renormalized here);
    /// indices index the geometry bone list when one is supplied, otherwise
    /// the skeleton directly. Weightless vertices fall back to the model's
    /// bone matrix (renderer semantics for unskinned geometry).
    /// </summary>
    private static Matrix BlendSkinMatrix(
        VertexData vd,
        int vertexIndex,
        ushort[]? geomBoneIds,
        Matrix[] skinTransforms,
        Matrix fallback)
    {
        var (w0, w1, w2, w3) = ReadUByte4(vd, vertexIndex, VertexSemantics.BlendWeights);
        var sum = (w0 + w1 + w2 + w3) / 255f;
        if (sum <= 1e-5f) return fallback;

        var (i0, i1, i2, i3) = ReadUByte4(vd, vertexIndex, VertexSemantics.BlendIndices);
        var result = new Matrix(); // zero
        AddWeighted(ref result, skinTransforms, geomBoneIds, i0, w0 / 255f / sum);
        AddWeighted(ref result, skinTransforms, geomBoneIds, i1, w1 / 255f / sum);
        AddWeighted(ref result, skinTransforms, geomBoneIds, i2, w2 / 255f / sum);
        AddWeighted(ref result, skinTransforms, geomBoneIds, i3, w3 / 255f / sum);
        return result;
    }

    private static void AddWeighted(ref Matrix accumulator, Matrix[] skinTransforms, ushort[]? geomBoneIds, byte rawIndex, float weight)
    {
        if (weight <= 0f) return;
        int boneIndex = geomBoneIds != null
            ? (rawIndex < geomBoneIds.Length ? geomBoneIds[rawIndex] : -1)
            : rawIndex;
        var matrix = boneIndex >= 0 && boneIndex < skinTransforms.Length
            ? skinTransforms[boneIndex]
            : Matrix.Identity;
        accumulator += matrix * weight;
    }

    private static (byte x, byte y, byte z, byte w) ReadUByte4(VertexData vd, int vertexIndex, VertexSemantics semantic)
    {
        var c = (int)semantic;
        switch (vd.Info?.GetComponentType(c) ?? VertexComponentType.Nothing)
        {
            case VertexComponentType.UByte4:
            case VertexComponentType.Colour:
            {
                // Byte order matches the vertex stream (x = first byte).
                var bytes = vd.GetUByte4(vertexIndex, c);
                return (bytes.R, bytes.G, bytes.B, bytes.A);
            }
            case VertexComponentType.Float4:
            {
                var v = vd.GetVector4(vertexIndex, c);
                return ((byte)Math.Clamp(v.X * 255f, 0f, 255f),
                        (byte)Math.Clamp(v.Y * 255f, 0f, 255f),
                        (byte)Math.Clamp(v.Z * 255f, 0f, 255f),
                        (byte)Math.Clamp(v.W * 255f, 0f, 255f));
            }
            default:
                return (0, 0, 0, 0);
        }
    }

    private static (float x, float y, float z) GetSemanticVec3(VertexData vd, int vertexIndex, VertexSemantics semantic)
    {
        var c = (int)semantic;
        switch (vd.Info?.GetComponentType(c) ?? VertexComponentType.Nothing)
        {
            case VertexComponentType.Float3:
            {
                var v = vd.GetVector3(vertexIndex, c);
                return (v.X, v.Y, v.Z);
            }
            case VertexComponentType.Float4:
            {
                var v = vd.GetVector4(vertexIndex, c);
                return (v.X, v.Y, v.Z);
            }
            case VertexComponentType.Dec3N:
            {
                var v = vd.GetDec3N(vertexIndex, c);
                return (v.X, v.Y, v.Z);
            }
            default:
                return (0f, 1f, 0f);
        }
    }

    private static (float x, float y) GetSemanticVec2(VertexData vd, int vertexIndex, VertexSemantics semantic)
    {
        var c = (int)semantic;
        switch (vd.Info?.GetComponentType(c) ?? VertexComponentType.Nothing)
        {
            case VertexComponentType.Float2:
            {
                var v = vd.GetVector2(vertexIndex, c);
                return (v.X, v.Y);
            }
            case VertexComponentType.Half2:
            {
                var h = vd.GetHalf2(vertexIndex, c);
                return (h.X, h.Y);
            }
            case VertexComponentType.Float3:
            {
                var v = vd.GetVector3(vertexIndex, c);
                return (v.X, v.Y);
            }
            default:
                return (0f, 0f);
        }
    }
}
