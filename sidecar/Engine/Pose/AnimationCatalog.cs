namespace Feelgood.Atelier.Sidecar.Engine.Pose;

/// <summary>One animation clip candidate (ycd dict + clip name).</summary>
public sealed record AnimClip(string ClipDict, string ClipName);

/// <summary>
/// A previewable looping animation: an id, a label and an ordered list of clip
/// candidates per gender (first that loads from the install wins).
/// </summary>
public sealed record AnimDefinition(
    string Id,
    string Label,
    IReadOnlyList<AnimClip> MaleClips,
    IReadOnlyList<AnimClip> FemaleClips);

/// <summary>
/// Catalog of looping animations the 3D preview can play. Distinct from
/// <see cref="PoseCatalog"/> (single frozen frames) — these are sampled across
/// the whole clip and played back with a mixer in the viewer.
/// </summary>
public static class AnimationCatalog
{
    public static readonly IReadOnlyList<AnimDefinition> All = new[]
    {
        new AnimDefinition("idle", "Idle",
            new[] { new AnimClip("move_m@generic", "idle") },
            new[] { new AnimClip("move_f@generic", "idle") }),
        new AnimDefinition("walk", "Walk",
            new[] { new AnimClip("move_m@generic", "walk") },
            new[] { new AnimClip("move_f@generic", "walk") }),
        new AnimDefinition("run", "Run",
            new[] { new AnimClip("move_m@generic", "run"), new AnimClip("move_m@generic", "run_01") },
            new[] { new AnimClip("move_f@generic", "run"), new AnimClip("move_f@generic", "run_01") }),
    };

    public static AnimDefinition? Find(string id) =>
        All.FirstOrDefault(a => string.Equals(a.Id, id, StringComparison.Ordinal));
}
