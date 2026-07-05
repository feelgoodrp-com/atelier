import type { ComponentSlotId, PropSlotId } from "@/lib/gta/components";

/** Mirror of the Rust `SidecarStatus` enum (serialized lowercase). */
export type SidecarStatus = "connecting" | "ready" | "unavailable" | "error";

/** Mirror of the Rust `SidecarInfo` struct (camelCase). */
export interface SidecarInfo {
  status: SidecarStatus;
  port: number | null;
  /** Per-session token, sent as `x-fg-atelier-token` header. */
  token: string | null;
  /** Human readable detail (German), used for tooltips. */
  detail: string | null;
}

// ---------------------------------------------------------------------------
// HTTP DTOs — mirror of sidecar/Api/Dtos.cs (System.Text.Json web defaults,
// camelCase). Errors are always `{ "error": "message" }` with a non-2xx status.
// ---------------------------------------------------------------------------

/** Response of GET /health (the only endpoint exempt from the token check). */
export interface SidecarHealth {
  ok: boolean;
  version: string;
}

/** Response of GET /info. */
export interface SidecarServerInfo {
  version: string;
  gtaPathReady: boolean;
  gtaPath: string | null;
  codewalkerLoaded: boolean;
  /** True once the background ped-body prewarm (both freemode peds) finished. */
  pedBodyPrewarmed: boolean;
}

/** Response of POST /config { gtaPath }. */
export interface SidecarConfigResult {
  ok: boolean;
  gtaPath: string | null;
  gtaPathReady: boolean;
}

/** Which LOD levels of a drawable contain geometry. */
export interface LodFlags {
  high: boolean;
  med: boolean;
  low: boolean;
}

/**
 * Per-drawable mesh stats. Vertex/poly counts are taken from the highest
 * LOD level that contains geometry (High, then Med, Low, VLow).
 */
export interface DrawableInfo {
  name: string;
  geometryCount: number;
  vertexCount: number;
  polyCount: number;
  lods: LodFlags;
}

/** Response of POST /parse/ydd { path }. */
export interface YddParseResult {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  drawables: DrawableInfo[];
}

export interface TextureInfo {
  name: string;
  width: number;
  height: number;
  mipCount: number;
  format: string;
  isPowerOfTwo: boolean;
  /** PNG (base64), longest edge <= maxSize — only when thumbnails were requested. */
  thumbnailPngBase64?: string;
}

/** Response of POST /parse/ytd { path }. */
export interface YtdParseResult {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  textures: TextureInfo[];
}

/** Optional thumbnail rendering for POST /parse/ytd. */
export interface YtdParseOptions {
  thumbnails?: { maxSize: number };
}

/** One texture candidate of an import-scan entry (letter = variant a..z). */
export interface ImportScanTexture {
  path: string;
  letter: string;
}

/**
 * One import candidate of POST /import/scan, anchored at a .ydd file. All
 * guessed* fields derive from naming conventions and may be null.
 */
export interface ImportScanEntry {
  yddPath: string;
  guessedGender: "male" | "female" | null;
  guessedKind: "component" | "prop" | null;
  guessedType: string | null;
  guessedDrawableId: number | null;
  textures: ImportScanTexture[];
  yldPath: string | null;
  confidence: "high" | "medium" | "low";
}

/** Response of POST /import/scan { folderPath }. */
export interface ImportScanResult {
  entries: ImportScanEntry[];
  warnings: string[];
}

/** Freemode ped skeleton/body the preview can render the clothing on. */
export type PedModel = "mp_m_freemode_01" | "mp_f_freemode_01";

/** One component-slot override of the ped appearance. */
export interface PedAppearanceComponent {
  drawable: number;
  texture: number;
  /** Alternative drawable suffix (GetDrawableName alt) — omitted/0 = none. */
  alt?: number;
}

/** One attached prop — Stufe 1: validated by the sidecar but NOT rendered. */
export interface PedAppearanceProp {
  /** Anchor key, e.g. "p_head" (GtaSlots.PropAnchorIds). */
  anchor: PropSlotId;
  drawable: number;
  texture: number;
}

/**
 * One SET_PED_HEAD_OVERLAY slot of the rendered face (Stufe 2) — mirror of the
 * sidecar PedAppearanceOverlayDto. `index` 255 means "off"; such slots are
 * dropped before the request (they never reach this type). `colour`/
 * `colourSecondary` index the 64-entry hair-tint palette and only matter for
 * the tinted brow/beard/makeup slots (others ignore them server-side).
 */
export interface PedAppearanceOverlay {
  /** Overlay slot id 0..12 (eyebrows=2, beard=1, …). */
  slot: number;
  /** Variation index 0..255 (255 = off — omitted, not sent). */
  index: number;
  /** 0..1 */
  opacity: number;
  /** Palette index 0..63 — only for tinted slots; omitted otherwise. */
  colour?: number;
  colourSecondary?: number;
}

/**
 * Rendered head/face block (Stufe 2) — mirror of the sidecar PedAppearanceFace
 * DTO. Drives SET_PED_HEAD_BLEND_DATA (shape + skin tone), the head overlays
 * and the eye-colour atlas. FaceFeatures (micro-morphs) are intentionally NOT
 * part of this contract — they need engine morph assets the tool has no honest
 * way to render, so they stay stored-only. Only effective with a rendered ped
 * body (same gating as {@link PedAppearance.components}).
 */
export interface PedAppearanceFace {
  /** SET_PED_HEAD_BLEND_DATA shape parents/override (0..45). */
  shapeFirst: number;
  shapeSecond: number;
  shapeThird: number;
  /** Shape blend 0..1 (0 = 100% first, 1 = 100% second). */
  shapeMix: number;
  /** Override (third) shape blend 0..1. */
  thirdMix: number;
  /** SET_PED_HEAD_BLEND_DATA skin-tone parents/override (0..45). */
  skinFirst: number;
  skinSecond: number;
  skinThird: number;
  /** Skin-tone blend 0..1. */
  skinMix: number;
  /** Active head overlays (index != 255), ascending by slot. */
  overlays?: PedAppearanceOverlay[];
  /** Eye-colour atlas row 0..31. */
  eyeColour?: number;
}

/**
 * Mirror of sidecar PedAppearanceDto: component variations + props of the
 * freemode ped body. Only effective when the ped body is rendered; slots the
 * sidecar cannot resolve (DLC indices) fall back to default and are reported
 * via the X-FG-Appearance-Fallbacks response header.
 */
export interface PedAppearance {
  components?: Partial<Record<ComponentSlotId, PedAppearanceComponent>>;
  props?: PedAppearanceProp[];
  /**
   * Rendered face (Stufe 2 — HeadBlend + overlays + eye colour). Only effective
   * when the ped body is rendered; absent face keeps the Stufe-1 keys
   * byte-identical (no `|f=…` segment is appended).
   */
  face?: PedAppearanceFace;
}

/** One selectable preview pose (GET /preview/poses) — label is German. */
export interface PoseInfo {
  id: string;
  label: string;
}

/** Response of GET /preview/poses (static sidecar pose catalog). */
export interface PosesResponse {
  poses: PoseInfo[];
}

/** One selectable looping animation (GET /preview/animations). */
export interface AnimInfo {
  id: string;
  label: string;
}

/** Response of GET /preview/animations (looping animation catalog). */
export interface AnimationsResponse {
  animations: AnimInfo[];
}

/** Request body of POST /preview/glb. */
export interface PreviewGlbRequest {
  /** Absolute path of the drawable dictionary (.ydd). */
  yddPath: string;
  /** Texture dictionaries in variant order (index 0 = letter "a"). */
  ytdPaths: string[];
  /** Which entry of `ytdPaths` is applied as diffuse (default 0). */
  textureIndex?: number;
  pedModel?: PedModel;
  /** Render the freemode body under the clothing (needs configured gtaPath). */
  includePedBody?: boolean;
  /**
   * Pose id (GET /preview/poses) baked statically into the mesh — needs a
   * configured gtaPath (else 422). Null/undefined = bind pose.
   */
  pose?: string | null;
  /** Ped-body appearance — only effective when the ped body is rendered. */
  appearance?: PedAppearance;
  /**
   * Uniform mesh scale of the whole drawable (0..1, 1 = vanish), preview-only —
   * mirrors the build-time hairScale for hair/p_head drawables so the slider is
   * SEEN in 3D. Absent/null = no scaling (GLB bytes byte-identical to before).
   * The single /preview/glb holds exactly one ydd, so this applies to it whole.
   */
  hairScale?: number | null;
  /**
   * Vertical scene lift in meters (glTF up = Y), preview-only — raises the
   * whole single-garment scene as if it "stood on heels". Set only for a feet
   * drawable with highHeels (value = {@link HEEL_LIFT_M}). Absent/null = 0.
   */
  heelLift?: number | null;
  /**
   * Looping animation id (GET /preview/animations). When set the mesh is
   * emitted SKINNED + ANIMATED (played by the viewer's mixer); takes precedence
   * over `pose` and ignores hairScale/heelLift. Needs a configured gtaPath.
   */
  animation?: string | null;
}

/** One garment of an outfit preview (mirrors sidecar OutfitItemRequest). */
export interface PreviewOutfitItem {
  yddPath: string;
  ytdPaths: string[];
  textureIndex?: number;
  /** Slot id (e.g. "uppr", "p_head") — component slots replace the ped default. */
  slot: string;
  /**
   * Uniform mesh scale for THIS item (0..1), preview-only — set only for the
   * hair/p_head garment so its mesh shrinks per the hairScale slider. heelLift
   * is GLOBAL (request level), not per item. Absent/null = no scaling.
   */
  hairScale?: number | null;
}

/** POST /preview/outfit-glb — several garments on ONE ped in one scene. */
export interface PreviewOutfitRequest {
  items: PreviewOutfitItem[];
  pedModel?: PedModel;
  includePedBody?: boolean;
  /** Pose id (see {@link PreviewGlbRequest.pose}); null/undefined = bind pose. */
  pose?: string | null;
  /** Ped-body appearance — only effective when the ped body is rendered. */
  appearance?: PedAppearance;
  /**
   * GLOBAL vertical scene lift in meters (glTF up = Y), preview-only — raises
   * the WHOLE scene (ped body + all garments), derived from any rendered feet
   * item with highHeels (value = {@link HEEL_LIFT_M}). Absent/null = 0. Lives at
   * request level (not per item) because the whole ped "stands on heels".
   */
  heelLift?: number | null;
  /** Looping animation id (see {@link PreviewGlbRequest.animation}). */
  animation?: string | null;
}

/**
 * Response of POST /preview/glb: raw GLB bytes (model/gltf-binary) plus the
 * counts from the X-FG-Vertex-Count / X-FG-Poly-Count headers (null when a
 * header is missing or unreadable).
 */
export interface PreviewGlbResult {
  glb: ArrayBuffer;
  vertexCount: number | null;
  polyCount: number | null;
  /**
   * Slot names that fell back to the default drawable (DLC/out-of-range
   * indices) — from the X-FG-Appearance-Fallbacks header, [] when absent.
   */
  appearanceFallbacks: string[];
  /**
   * True when the sidecar built this GLB while a component load timed out
   * (X-FG-Transient-Degraded header) — the result may be missing a texture
   * and must not be frozen in the client GLB cache; a retry can succeed.
   */
  transientDegraded: boolean;
}

// ---------------------------------------------------------------------------
// Build & validate DTOs — mirror of sidecar/Api/BuildDtos.cs +
// Engine/Build/{Validator,BuildCommon,TextureOptimizer}.cs (camelCase).
// ---------------------------------------------------------------------------

export type FindingSeverity = "error" | "warn" | "info";

/** One validation finding of POST /validate (message is German). */
export interface ValidationFinding {
  severity: FindingSeverity;
  code: string;
  /** Drawable uuid the finding belongs to (null = project-wide). */
  drawableId: string | null;
  message: string;
}

/** Response of POST /validate { projectDir, project }. */
export interface ValidateResponse {
  findings: ValidationFinding[];
}

export type BuildTarget = "fivem" | "singleplayer" | "ragemp" | "altv";

/** `options` block of POST /build (all fields optional server-side). */
export interface BuildRequestOptions {
  dlcName: string;
  resourceName: string | null;
  generateShopMeta: boolean;
  splitAt: number;
}

/** Request body of POST /build — `project` is the pack.atelier JSON. */
export interface StartBuildRequest {
  projectDir: string;
  project: unknown;
  target: BuildTarget;
  outDir: string;
  options: BuildRequestOptions;
}

export interface BuildResourceReport {
  folder: string;
  drawables: number;
}

/** Terminal build report (part of the SSE done event). */
export interface BuildReport {
  resources: BuildResourceReport[];
  warnings: string[];
}

/** Non-terminal SSE event of GET /build/progress. */
export interface BuildProgressEvent {
  phase: string;
  current: number;
  total: number;
  /** Live progress detail (German). */
  message: string;
}

/** Terminal SSE event — either a report or a German error. */
export type BuildDoneEvent =
  | { done: true; outDir: string; report: BuildReport }
  | { done: true; error: string };

/** Request body of POST /texture/optimize. */
export interface TextureOptimizeRequest {
  /** Absolute path of the .ytd to optimize. */
  ytdPath: string;
  /** Output path; null optimizes in-place (.tmp + replace). */
  outPath: string | null;
  /** Longest-edge cap in pixels (16–8192). */
  maxDimension: number;
  /** Forced format; null keeps the source's BC family. */
  format: "BC1" | "BC3" | "BC7" | "RGBA8888" | null;
  regenerateMips: boolean;
}

export interface TextureDimensions {
  width: number;
  height: number;
  sizeBytes: number;
}

/** Response of POST /texture/optimize. */
export interface TextureOptimizeResult {
  outPath: string;
  before: TextureDimensions;
  after: TextureDimensions;
}

/** Request body of POST /texture/from-image. */
export interface TextureFromImageRequest {
  /** Absolute path of the source image (.png/.jpg/.jpeg/.webp). */
  imagePath: string;
  /** Absolute path of the .ytd to write. */
  outPath: string;
  /** Longest-edge cap in pixels (16–8192). */
  maxDimension: number;
  format: "BC1" | "BC3" | "BC7" | "RGBA8888";
}

/** Response of POST /texture/from-image. */
export interface TextureFromImageResult {
  sizeBytes: number;
}

export type HealthState = "unknown" | "ok" | "failing";
