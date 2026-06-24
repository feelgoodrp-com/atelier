using SharpDX;

namespace Feelgood.Atelier.Sidecar.Engine.Pose;

/// <summary>
/// One joint in the emitted skeleton (skeleton bone-array order, so the joint
/// index equals the bone index used by BlendIndices). Transforms are in native
/// GTA (Z-up) space — the Z-up→Y-up swap is applied by a root node in the GLB,
/// NOT baked here.
/// </summary>
public sealed class AnimJoint
{
    public required int ParentIndex { get; init; }            // -1 = root
    public required Vector3 BindTranslation { get; init; }    // bind-pose local TRS
    public required Quaternion BindRotation { get; init; }
    public required Vector3 BindScale { get; init; }
    public required Matrix InverseBind { get; init; }         // absolute, affine-sanitized
}

/// <summary>Per-frame local TRS for one animated joint (shared time array).</summary>
public sealed class AnimTrack
{
    public required int JointIndex { get; init; }
    public required Vector3[] Translations { get; init; }
    public required Quaternion[] Rotations { get; init; }
    public required Vector3[] Scales { get; init; }
}

/// <summary>
/// A fully sampled looping animation for one (pedModel, anim): the skeleton
/// (joints + inverse-bind) plus keyframe tracks for the animated joints.
/// `GlbBuilder` turns this into a glTF skin + animation; the viewer plays it.
/// </summary>
public sealed class AnimationData
{
    public required string AnimId { get; init; }
    public required string ClipDict { get; init; }
    public required string ClipName { get; init; }
    public required AnimJoint[] Joints { get; init; }
    public required int RootJointIndex { get; init; }
    /// <summary>Keyframe times in seconds, starting at 0 (the clip window length).</summary>
    public required float[] Times { get; init; }
    public required AnimTrack[] Tracks { get; init; }
}
