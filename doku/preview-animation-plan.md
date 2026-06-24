# Preview animation — plan

Goal: make the 3D preview play **real looping skeletal animations** (idle / walk /
run, …) instead of the current single frozen pose. Branch `feature/preview-animation`.

## Where we are today (verified in code)

- The preview bakes ONE static frame. `PoseEngine.GetPose()` evaluates a GTA clip
  (YCD) at a single `TimeFraction` and returns `PoseData.SkinTransforms` (per-bone
  `inverseBind * animatedAbsolute`). `GlbBuilder.Build/BuildOutfit` **CPU-skins the
  vertices into static positions/normals** and emits a GLB with **no skin, no
  skeleton nodes, no animation** (`GlbWriter.Write` → one node, one mesh, attributes
  POSITION/NORMAL/TEXCOORD_0 only).
- `GlbWriter.cs` is a hand-rolled GLB 2.0 serializer (string-concat JSON + one
  contiguous BIN chunk, manual accessor/bufferView bookkeeping, `Align4`). Clean and
  extensible — we extend it, no glTF library / no new NuGet dep.
- Viewer (`viewer-3d.tsx`) renders each GLB as a static `<primitive>`. Preview
  composes **multiple GLBs**: garment-only = one GLB per drawable; ped-body on = ONE
  outfit GLB (garments replace ped components). One shared `pose` applies to all.
- The clip-sampling primitive already supports arbitrary time: `PoseEngine.ApplyAnimation(skeleton, anim, t)` writes local TRS into a cloned skeleton; CodeWalker
  `Animation` exposes `Duration`, `Frames`, `GetFramePosition`, `EvaluateVector4`,
  `EvaluateQuaternion`. The skeleton (`Skeleton.Bones.Items`, `Bone.ParentIndex`,
  `.Tag`, bind-local `.Rotation/.Translation/.Scale`, `.BindTransformInv`) is reached
  via `PedBodyService` (ped YFT) and cloned per pose.

## Target architecture

Emit a **skinned, animated glTF** and play it with three.js `AnimationMixer`.

- One skin shared by the single mesh (keep the existing single-mesh / N-primitives
  layout). Per-vertex `JOINTS_0` (remapped bone index into the joint-node list) +
  `WEIGHTS_0` (normalized). Geometry is emitted in **bind pose** (NOT CPU-baked) when
  animating. `inverseBindMatrices` from `Skeleton.TransformationsInverted`
  (affine-sanitized: M14=M24=M34=0, M44=1).
- The joint hierarchy = a glTF `nodes` subtree from `Bone.ParentIndex`. Animation =
  one glTF `animation` with, per animated bone, TRS samplers (`input` = shared time
  array over `[StartTime, EndTime]`, `output` = sampled local TRS), LINEAR interp.
- **Coordinate frame (critical):** today the Z-up→Y-up swap `(x, z, -y)` is baked into
  the static positions. A skinned model can't bake it per-vertex. → put the swap on a
  **root node** (rotation −90° about X) that parents both the mesh node and the
  skeleton root; keep ALL joint transforms, inverse-bind matrices and keyframes in
  native GTA (Z-up) space under that root. (Alternative: pre-transform bind +
  inverse-bind + keyframes into Y-up; the root-node approach is simpler and least
  error-prone. Hair-scale / heel-lift go on the root or are dropped in animated mode
  for the MVP.)
- **Multi-GLB sync:** every GLB in the scene carries the SAME skeleton topology and
  the SAME clip (same keyframe times). The viewer keeps one mixer per loaded GLB and
  advances them all from a SHARED clock each frame → they stay frame-locked.

## Contract

- New optional field `Animation` (clip id) on `PreviewGlbRequest` and
  `PreviewOutfitRequest`. When set (and a gtaPath is ready), the builder emits the
  skinned+animated GLB; `Pose` (static) stays for the frozen single-frame path.
- `GET /preview/animations` → `[{ id, label }]` (mirrors `/preview/poses`).
- Animated GLBs participate in the cache key with a distinct `anim:<id>` segment so
  static and animated outputs never collide.

## New animation catalog (MVP)

Loop clips from base game move sets, one candidate list per gender (first that loads
wins), each a full clip window (StartTime..EndTime), sampled at its own FPS:
`idle` (`move_m@generic`/`idle`), `walk` (`move_m@generic`/`walk`),
`run` (`move_m@generic`/`run` or `move_m@generic`/`run_01`). Female: `move_f@generic`.
Extend later (sprint, jog, gestures). Existing single-frame `poses` stay as-is.

## Phases

- **P1 — sidecar sampling.** `AnimationCatalog` + `PoseEngine.GetAnimation(gtaPath,
  pedModel, animId)` → `AnimationData { Joint[] Joints (name, parentIndex, bindT/R/S,
  inverseBind), float[] Times, JointKeys[] (perJoint TRS arrays) }`. Reuse
  `ApplyAnimation` + roll-bone fixup; capture local TRS per sampled t. dotnet build.
- **P2 — sidecar emitter.** `GlbWriter.WriteSkinned(...)` (adds JOINTS_0/WEIGHTS_0,
  skin, joint nodes, inverse-bind accessor, animation samplers/channels, root-node
  axis swap). `GlbBuilder` animated path: bind-pose geometry + per-vertex joints/
  weights + AnimationData → WriteSkinned. dotnet build + **in-app visual check**.
- **P0 — contract.** DTO `Animation` field, `/preview/animations`, endpoint wiring,
  cache-key segment. dotnet build.
- **P3 — frontend.** Viewer `AnimationMixer` (shared clock, loop), store animation
  state, toolbar: animation select + play/pause + speed. tsc/vite build + in-app.
- **P4 — polish.** Outfit/garment parity, both genders, perf (GLB size with
  keyframes), graceful fallback when a clip is unavailable, persist last animation.

## Risks / open

- R1 Coordinate frame: the root-node swap must be exactly consistent across bind,
  inverse-bind and keyframes — easiest source of "exploded mesh". Verify with a
  trivial clip first.
- R2 Bone-index remap: `JOINTS_0` must index the emitted joint-node order; reuse the
  existing `geom.BoneIds` remap logic but map to joint-list indices, not skin-matrix
  indices.
- R3 Roll-bone fixup must run per sampled frame (else thighs shear under motion).
- R4 GLB size: ~N bones × M frames × TRS. Cap frame count (e.g. ≤ the clip's own
  frames, or resample to ~30 fps) and reuse one time array.
- R5 Local verification is compile-only (dotnet build) + in-app; no automated visual
  test. The existing static path must stay byte-identical when `Animation` is unset.
- D1 Animated mode: drop hair-scale/heel-lift for the MVP? (recommended yes).
- D2 Garment-only (no ped body): animate against the gender skeleton same as the
  static pose path — confirm the garment's own blend indices map to the ped skeleton.
