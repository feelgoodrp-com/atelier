namespace Feelgood.Atelier.Sidecar.Engine.Pose;

/// <summary>
/// One concrete animation clip candidate for a pose: clip dictionary name
/// (ycd short name), clip name within the dictionary and the normalized
/// playback position (0..1 of the clip duration) that gets baked into the
/// static preview mesh.
/// </summary>
public sealed record PoseClip(string ClipDict, string ClipName, float TimeFraction = 0f);

/// <summary>
/// One selectable preview pose. Each gender has an ORDERED candidate list -
/// the first clip that actually loads from the configured GTA install wins.
/// Candidates exist because clip dictionary availability differs between
/// installs (DLC state); all listed dicts are expected in the base game.
/// </summary>
public sealed record PoseDefinition(
    string Id,
    string Label,
    IReadOnlyList<PoseClip> MaleClips,
    IReadOnlyList<PoseClip> FemaleClips);

/// <summary>
/// Static pose list for the preview endpoints (mirrored by the frontend via
/// GET /preview/poses). Pose ids are part of the API contract - labels are
/// German UI strings by convention.
/// </summary>
public static class PoseCatalog
{
    public static readonly IReadOnlyList<PoseDefinition> Poses = new[]
    {
        // stand/walk: the exact dictionaries grzyClothTool uses for freemode
        // ped animation previews (move_m@generic / move_f@generic).
        new PoseDefinition(
            "stand", "Stehen (Idle)",
            new[] { new PoseClip("move_m@generic", "idle") },
            new[] { new PoseClip("move_f@generic", "idle") }),
        new PoseDefinition(
            "walk", "Gehen (eingefroren)",
            new[] { new PoseClip("move_m@generic", "walk", 0.25f) },
            new[] { new PoseClip("move_f@generic", "walk", 0.25f) }),
        new PoseDefinition(
            "sit", "Sitzen",
            new[]
            {
                new PoseClip("amb@world_human_picnic@male@base", "base"),
                new PoseClip("amb@world_human_seat_wall@male@hands_by_sides@base", "base"),
            },
            new[]
            {
                new PoseClip("amb@world_human_picnic@female@base", "base"),
                new PoseClip("amb@world_human_seat_wall@female@hands_by_sides@base", "base"),
            }),
        new PoseDefinition(
            "hands_up", "Hände hoch",
            new[]
            {
                new PoseClip("missminuteman_1ig_2", "handsup_base"),
                new PoseClip("random@mugging3", "handsup_standing_base"),
            },
            new[]
            {
                new PoseClip("missminuteman_1ig_2", "handsup_base"),
                new PoseClip("random@mugging3", "handsup_standing_base"),
            }),
        new PoseDefinition(
            "aim", "Zielen",
            new[]
            {
                new PoseClip("reaction@intimidation@1h", "intro", 0.99f),
                new PoseClip("weapons@projectile@", "aimlive_m"),
            },
            new[]
            {
                new PoseClip("reaction@intimidation@1h", "intro", 0.99f),
                new PoseClip("weapons@projectile@", "aimlive_m"),
            }),
        new PoseDefinition(
            "arms_crossed", "Arme verschränkt",
            new[]
            {
                new PoseClip("amb@world_human_hang_out_street@male_c@base", "base"),
                new PoseClip("amb@world_human_hang_out_street@male_b@base", "base"),
            },
            new[]
            {
                new PoseClip("amb@world_human_hang_out_street@female_arms_crossed@base", "base"),
                new PoseClip("amb@world_human_hang_out_street@female_arm_side@base", "base"),
            }),
    };

    public static PoseDefinition? Find(string id) =>
        Poses.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.Ordinal));
}
