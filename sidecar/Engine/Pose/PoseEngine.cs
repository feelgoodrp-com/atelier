using System.Diagnostics;
using CodeWalker.GameFiles;
using SharpDX;

namespace Feelgood.Atelier.Sidecar.Engine.Pose;

/// <summary>Pose id exists in no loadable clip dictionary (or is unknown) — maps to 422 pose_unavailable.</summary>
public sealed class PoseUnavailableException : Exception
{
    public string PoseId { get; }

    public PoseUnavailableException(string poseId, string message) : base(message) => PoseId = poseId;
}

/// <summary>
/// Evaluated pose for one (pedModel, pose): per-bone skinning matrices in
/// skeleton bone-array order. SkinTransforms[i] = inverseBindPose[i] *
/// animatedAbsolute[i] (row-vector convention, like the CodeWalker renderer)
/// — applying it to a bind-pose vertex yields the posed vertex, and it is the
/// IDENTITY in bind pose. Vertices without blend data use the matrix of their
/// model's bone index, which keeps them where today's bind-pose preview puts
/// them and moves them rigidly with that bone under a pose.
/// </summary>
public sealed class PoseData
{
    public required string PoseId { get; init; }
    public required string ClipDict { get; init; }
    public required string ClipName { get; init; }
    public required Matrix[] SkinTransforms { get; init; }
}

/// <summary>
/// Loads a pose clip (ycd via GameFileCache, content pump in PedBodyService)
/// and bakes it ONCE into per-bone skinning matrices for the freemode ped
/// skeleton. Clean-room implementation of the CodeWalker renderer semantics:
/// evaluate translation/rotation/scale tracks at a fixed time, compose
/// local->absolute down the bone hierarchy, multiply with the inverse bind
/// pose. Results are cached per (gtaPath, pedModel, pose).
/// </summary>
public sealed class PoseEngine
{
    private const int YcdLoadTimeoutMs = 8000;

    // Animation track ids (rage clip data): bone position/orientation/scale.
    private const byte TrackBonePosition = 0;
    private const byte TrackBoneRotation = 1;
    private const byte TrackBoneScale = 2;

    // Roll helper bones mirror their parent thigh's animated rotation
    // (renderer behavior; without this the thigh roll bones stay in bind
    // pose and the upper legs shear visibly).
    private static readonly (ushort RollTag, ushort SourceTag)[] RollBoneFixups =
    {
        (23639, 58271), // RB_L_ThighRoll <- SKEL_L_Thigh
        (6442, 51826),  // RB_R_ThighRoll <- SKEL_R_Thigh
    };

    /// <summary>Keyframe count is capped so a long clip can't bloat the GLB.</summary>
    private const int MaxAnimationFrames = 256;

    private readonly ILogger<PoseEngine> _log;
    private readonly PedBodyService _pedBody;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, PoseData> _poseCache = new();
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, AnimationData> _animCache = new();

    public PoseEngine(ILogger<PoseEngine> log, PedBodyService pedBody)
    {
        _log = log;
        _pedBody = pedBody;
    }

    /// <summary>
    /// Resolves the skinning matrices for one pose on one freemode ped.
    /// Throws <see cref="PoseUnavailableException"/> when no clip candidate
    /// loads from this install; other exceptions mean broken game data
    /// (callers map those to ped_body_unavailable).
    /// </summary>
    public PoseData GetPose(string gtaPath, string pedModel, string poseId)
    {
        var definition = PoseCatalog.Find(poseId)
            ?? throw new PoseUnavailableException(poseId, $"Unknown pose id '{poseId}'.");

        var cacheKey = $"{gtaPath.ToLowerInvariant()}|{pedModel}|{poseId}";
        if (_poseCache.TryGetValue(cacheKey, out var cached))
            return cached;

        var bindSkeleton = _pedBody.LoadPed(gtaPath, pedModel).Skeleton
            ?? throw new InvalidOperationException($"Ped '{pedModel}' has no skeleton in the game data.");
        var cache = _pedBody.GetCache(gtaPath);

        var isFemale = pedModel.Contains("_f_", StringComparison.OrdinalIgnoreCase);
        var candidates = isFemale ? definition.FemaleClips : definition.MaleClips;

        foreach (var candidate in candidates)
        {
            var clipEntry = TryLoadClip(cache, candidate);
            if (clipEntry == null)
            {
                _log.LogInformation("Pose {Pose}: clip {Dict}/{Clip} not available, trying next candidate",
                    poseId, candidate.ClipDict, candidate.ClipName);
                continue;
            }

            var data = TryEvaluate(bindSkeleton, clipEntry, candidate, poseId);
            if (data == null) continue;

            _log.LogInformation("Pose {Pose} resolved via {Dict}/{Clip} (t={T:0.##})",
                poseId, candidate.ClipDict, candidate.ClipName, candidate.TimeFraction);
            _poseCache[cacheKey] = data;
            return data;
        }

        throw new PoseUnavailableException(poseId, $"No clip candidate for pose '{poseId}' loaded from this install.");
    }

    /// <summary>
    /// Samples a looping animation over its whole clip window into keyframe
    /// tracks (skeleton + per-joint local TRS), for the glTF skin + animation
    /// the preview plays. Same clip-loading and bone math as <see cref="GetPose"/>,
    /// but evaluated at many times instead of one. Throws
    /// <see cref="PoseUnavailableException"/> when no candidate loads.
    /// </summary>
    public AnimationData GetAnimation(string gtaPath, string pedModel, string animId)
    {
        var definition = AnimationCatalog.Find(animId)
            ?? throw new PoseUnavailableException(animId, $"Unknown animation id '{animId}'.");

        var cacheKey = $"{gtaPath.ToLowerInvariant()}|{pedModel}|{animId}";
        if (_animCache.TryGetValue(cacheKey, out var cached))
            return cached;

        var bindSkeleton = _pedBody.LoadPed(gtaPath, pedModel).Skeleton
            ?? throw new InvalidOperationException($"Ped '{pedModel}' has no skeleton in the game data.");
        var cache = _pedBody.GetCache(gtaPath);

        var isFemale = pedModel.Contains("_f_", StringComparison.OrdinalIgnoreCase);
        var candidates = isFemale ? definition.FemaleClips : definition.MaleClips;

        foreach (var candidate in candidates)
        {
            var clipEntry = TryLoadClip(cache, new PoseClip(candidate.ClipDict, candidate.ClipName));
            if (clipEntry == null)
            {
                _log.LogInformation("Animation {Anim}: clip {Dict}/{Clip} not available, trying next",
                    animId, candidate.ClipDict, candidate.ClipName);
                continue;
            }

            var data = TrySample(bindSkeleton, clipEntry, candidate, animId);
            if (data == null) continue;

            _log.LogInformation("Animation {Anim} resolved via {Dict}/{Clip} ({Frames} frames, {Joints} animated)",
                animId, candidate.ClipDict, candidate.ClipName, data.Times.Length, data.Tracks.Length);
            _animCache[cacheKey] = data;
            return data;
        }

        throw new PoseUnavailableException(animId, $"No clip candidate for animation '{animId}' loaded from this install.");
    }

    /// <summary>Samples one clip into <see cref="AnimationData"/>; null on broken clip data.</summary>
    private AnimationData? TrySample(Skeleton bindSkeleton, ClipMapEntry clipEntry, AnimClip candidate, string animId)
    {
        try
        {
            var skeleton = bindSkeleton.Clone();
            var bones = skeleton.Bones?.Items;
            if (bones == null || bones.Length == 0) return null;

            // The animation(s) in this clip, with their per-clip time windows.
            var anims = new List<(Animation Anim, float StartTime, float EndTime)>();
            if (clipEntry.Clip is ClipAnimation ca && ca.Animation != null)
                anims.Add((ca.Animation, ca.StartTime, ca.EndTime));
            else if (clipEntry.Clip is ClipAnimationList cl && cl.Animations?.Data != null)
                foreach (var e in cl.Animations.Data)
                    if (e?.Animation != null) anims.Add((e.Animation, e.StartTime, e.EndTime));
            if (anims.Count == 0) return null;

            var windowDuration = anims.Max(a => Math.Max(0f, a.EndTime - a.StartTime));
            if (windowDuration <= 1e-4f) windowDuration = anims.Max(a => a.Anim.Duration);
            if (windowDuration <= 1e-4f) return null;
            var frameCount = Math.Clamp(anims.Max(a => (int)a.Anim.Frames), 2, MaxAnimationFrames);

            // Bones the clip actually drives (others keep their bind local TRS).
            var animatedTags = new HashSet<ushort>();
            foreach (var (anim, _, _) in anims)
            {
                var bids = anim.BoneIds?.data_items;
                if (bids != null) foreach (var b in bids) animatedTags.Add(b.BoneId);
            }

            // Joint list in bone-array order: index == BlendIndices bone index.
            var boneToIndex = new Dictionary<Bone, int>(bones.Length);
            for (var i = 0; i < bones.Length; i++) boneToIndex[bones[i]] = i;
            var joints = new AnimJoint[bones.Length];
            var rootJoint = 0;
            for (var i = 0; i < bones.Length; i++)
            {
                var b = bones[i];
                var parent = b.Parent != null && boneToIndex.TryGetValue(b.Parent, out var pi) ? pi : -1;
                if (parent < 0) rootJoint = i;
                var inv = b.BindTransformInv;
                inv.M14 = 0f; inv.M24 = 0f; inv.M34 = 0f; inv.M44 = 1f; // affine sanitize (see GetPose)
                joints[i] = new AnimJoint
                {
                    ParentIndex = parent,
                    BindTranslation = b.Translation,
                    BindRotation = b.Rotation,
                    BindScale = b.Scale,
                    InverseBind = inv,
                };
            }

            var animatedJointIdx = new List<int>();
            for (var i = 0; i < bones.Length; i++)
                if (animatedTags.Contains(bones[i].Tag)) animatedJointIdx.Add(i);
            if (animatedJointIdx.Count == 0) return null;

            var times = new float[frameCount];
            var trans = new Vector3[animatedJointIdx.Count][];
            var rots = new Quaternion[animatedJointIdx.Count][];
            var scales = new Vector3[animatedJointIdx.Count][];
            for (var k = 0; k < animatedJointIdx.Count; k++)
            {
                trans[k] = new Vector3[frameCount];
                rots[k] = new Quaternion[frameCount];
                scales[k] = new Vector3[frameCount];
            }

            for (var f = 0; f < frameCount; f++)
            {
                var fraction = frameCount == 1 ? 0f : (float)f / (frameCount - 1);
                times[f] = fraction * windowDuration;

                foreach (var bone in bones)
                {
                    bone.AnimRotation = bone.Rotation;
                    bone.AnimTranslation = bone.Translation;
                    bone.AnimScale = bone.Scale;
                }
                foreach (var (anim, startTime, endTime) in anims)
                    ApplyAnimation(skeleton, anim, ClipTime(startTime, endTime, anim, fraction));

                foreach (var (rollTag, sourceTag) in RollBoneFixups)
                {
                    if (skeleton.BonesMap != null &&
                        skeleton.BonesMap.TryGetValue(rollTag, out var rollBone) &&
                        skeleton.BonesMap.TryGetValue(sourceTag, out var sourceBone) &&
                        sourceTag != rollBone.Parent?.Tag)
                        rollBone.AnimRotation = sourceBone.AnimRotation;
                }

                for (var k = 0; k < animatedJointIdx.Count; k++)
                {
                    var b = bones[animatedJointIdx[k]];
                    trans[k][f] = b.AnimTranslation;
                    rots[k][f] = b.AnimRotation;
                    scales[k][f] = b.AnimScale;
                }
            }

            var tracks = new AnimTrack[animatedJointIdx.Count];
            for (var k = 0; k < animatedJointIdx.Count; k++)
                tracks[k] = new AnimTrack
                {
                    JointIndex = animatedJointIdx[k],
                    Translations = trans[k],
                    Rotations = rots[k],
                    Scales = scales[k],
                };

            return new AnimationData
            {
                AnimId = animId,
                ClipDict = candidate.ClipDict,
                ClipName = candidate.ClipName,
                Joints = joints,
                RootJointIndex = rootJoint,
                Times = times,
                Tracks = tracks,
            };
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Animation sampling failed for {Anim} via {Dict}/{Clip}",
                animId, candidate.ClipDict, candidate.ClipName);
            return null;
        }
    }

    /// <summary>
    /// Loads the clip dict through the GameFileCache (grzy pattern: GetYcd +
    /// wait for the content pump) and picks the clip by name hash.
    /// </summary>
    private ClipMapEntry? TryLoadClip(GameFileCache cache, PoseClip candidate)
    {
        try
        {
            var ycdHash = JenkHash.GenHash(candidate.ClipDict.ToLowerInvariant());
            var ycd = cache.GetYcd(ycdHash);
            if (ycd == null) return null; // not in this install's ycd index

            var sw = Stopwatch.StartNew();
            while (!ycd.Loaded && sw.ElapsedMilliseconds < YcdLoadTimeoutMs)
            {
                Thread.Sleep(10);
                ycd = cache.GetYcd(ycdHash); // re-enqueues the load when needed
                if (ycd == null) return null;
            }
            if (!ycd.Loaded || ycd.ClipMap == null) return null;

            var clipHash = JenkHash.GenHash(candidate.ClipName.ToLowerInvariant());
            ycd.ClipMap.TryGetValue(clipHash, out var entry);
            return entry?.Clip != null ? entry : null;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Clip dict load failed for {Dict}", candidate.ClipDict);
            return null;
        }
    }

    /// <summary>Evaluates the clip on a CLONE of the bind skeleton; null on broken clip data (try next candidate).</summary>
    private PoseData? TryEvaluate(Skeleton bindSkeleton, ClipMapEntry clipEntry, PoseClip candidate, string poseId)
    {
        try
        {
            var skeleton = bindSkeleton.Clone();
            var bones = skeleton.Bones?.Items;
            if (bones == null || bones.Length == 0) return null;

            // Start from the bind pose locals; the clip overrides the
            // animated tracks only.
            foreach (var bone in bones)
            {
                bone.AnimRotation = bone.Rotation;
                bone.AnimTranslation = bone.Translation;
                bone.AnimScale = bone.Scale;
            }

            var applied = false;
            if (clipEntry.Clip is ClipAnimation clipAnim && clipAnim.Animation != null)
            {
                applied |= ApplyAnimation(skeleton, clipAnim.Animation,
                    ClipTime(clipAnim.StartTime, clipAnim.EndTime, clipAnim.Animation, candidate.TimeFraction));
            }
            else if (clipEntry.Clip is ClipAnimationList clipList && clipList.Animations?.Data != null)
            {
                foreach (var entry in clipList.Animations.Data)
                {
                    if (entry?.Animation == null) continue;
                    applied |= ApplyAnimation(skeleton, entry.Animation,
                        ClipTime(entry.StartTime, entry.EndTime, entry.Animation, candidate.TimeFraction));
                }
            }
            if (!applied) return null;

            // Roll helper bones copy the animated rotation of their source
            // bone — but NOT when the roll bone is parented to that source
            // (then it inherits the rotation through the hierarchy already
            // and copying would apply it twice; renderer semantics).
            foreach (var (rollTag, sourceTag) in RollBoneFixups)
            {
                if (skeleton.BonesMap != null &&
                    skeleton.BonesMap.TryGetValue(rollTag, out var rollBone) &&
                    skeleton.BonesMap.TryGetValue(sourceTag, out var sourceBone))
                {
                    if (sourceTag != rollBone.Parent?.Tag)
                        rollBone.AnimRotation = sourceBone.AnimRotation;
                    else
                        _log.LogDebug("Pose {Pose}: roll bone {Roll} is parented to {Source}, fixup skipped",
                            poseId, rollTag, sourceTag);
                }
            }

            // Compose local -> absolute strictly parents-first (robust against
            // bone array ordering), then build the skinning matrices.
            foreach (var bone in ParentsFirst(bones))
            {
                bone.UpdateAnimTransform();
                bone.UpdateSkinTransform();
            }

            var skinTransforms = new Matrix[bones.Length];
            var column4Dirt = 0f;
            for (var i = 0; i < bones.Length; i++)
            {
                var m = bones[i].SkinTransform;
                // The yft's inverse bind matrices come straight from the file
                // and may carry a non-affine 4th column (only M44 gets fixed
                // up at load). The GPU renderer drops that column entirely
                // (3x4 bone matrices) — TransformCoordinate would w-divide by
                // it instead, so force a clean affine matrix here.
                column4Dirt = Math.Max(column4Dirt,
                    Math.Max(Math.Abs(m.M14), Math.Max(Math.Abs(m.M24), Math.Abs(m.M34))));
                m.M14 = 0f;
                m.M24 = 0f;
                m.M34 = 0f;
                m.M44 = 1f;
                skinTransforms[i] = m;
            }
            if (column4Dirt > 1e-6f)
                _log.LogDebug("Pose {Pose}: sanitized non-affine skin matrix column 4 (max |value| {Dirt})",
                    poseId, column4Dirt);

            return new PoseData
            {
                PoseId = poseId,
                ClipDict = candidate.ClipDict,
                ClipName = candidate.ClipName,
                SkinTransforms = skinTransforms,
            };
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Pose evaluation failed for {Pose} via {Dict}/{Clip}",
                poseId, candidate.ClipDict, candidate.ClipName);
            return null;
        }
    }

    /// <summary>Clip-local sample time: StartTime + fraction of the clip window, clamped into the animation.</summary>
    private static float ClipTime(float startTime, float endTime, Animation anim, float fraction)
    {
        var f = Math.Clamp(fraction, 0f, 1f);
        var t = startTime + f * Math.Max(0f, endTime - startTime);
        // GetFramePosition wraps via modulo; stay strictly inside the
        // animation so fraction 1.0 doesn't wrap back to frame 0.
        var limit = Math.Max(0f, anim.Duration - 0.001f);
        return Math.Min(t, limit);
    }

    /// <summary>
    /// Writes the animated local transforms (position/rotation/scale tracks)
    /// of one animation at time t into the skeleton bones. Root motion
    /// (tracks 5/6) is intentionally skipped — the preview ped stays at the
    /// origin — and facial tracks are out of scope for body poses.
    /// </summary>
    private static bool ApplyAnimation(Skeleton skeleton, Animation anim, float t)
    {
        var boneIds = anim.BoneIds?.data_items;
        if (boneIds == null || anim.Sequences?.data_items == null) return false;
        if (skeleton.BonesMap == null) return false;

        var frame = anim.GetFramePosition(t);
        var applied = false;

        for (var i = 0; i < boneIds.Length; i++)
        {
            var boneId = boneIds[i];
            if (!skeleton.BonesMap.TryGetValue(boneId.BoneId, out var bone) || bone == null)
                continue;

            switch (boneId.Track)
            {
                case TrackBonePosition:
                {
                    var v = anim.EvaluateVector4(frame, i, interpolate: true);
                    bone.AnimTranslation = new Vector3(v.X, v.Y, v.Z);
                    applied = true;
                    break;
                }
                case TrackBoneRotation:
                {
                    bone.AnimRotation = anim.EvaluateQuaternion(frame, i, interpolate: true);
                    applied = true;
                    break;
                }
                case TrackBoneScale:
                {
                    var v = anim.EvaluateVector4(frame, i, interpolate: true);
                    bone.AnimScale = new Vector3(v.X, v.Y, v.Z);
                    applied = true;
                    break;
                }
                // 5/6 = root motion, 24..26 = facial — not used for static body poses.
            }
        }

        return applied;
    }

    /// <summary>Bone iteration order with every parent before its children.</summary>
    private static IEnumerable<Bone> ParentsFirst(Bone[] bones)
    {
        var emitted = new HashSet<Bone>();
        var remaining = new List<Bone>(bones.Where(b => b != null));
        while (remaining.Count > 0)
        {
            var progressed = false;
            for (var i = 0; i < remaining.Count;)
            {
                var bone = remaining[i];
                if (bone.Parent == null || emitted.Contains(bone.Parent))
                {
                    emitted.Add(bone);
                    remaining.RemoveAt(i);
                    progressed = true;
                    yield return bone;
                }
                else
                {
                    i++;
                }
            }
            if (!progressed)
            {
                // Orphaned parents (parent outside the array): emit as-is.
                foreach (var bone in remaining) yield return bone;
                yield break;
            }
        }
    }
}
