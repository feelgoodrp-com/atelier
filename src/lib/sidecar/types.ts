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

/** One selectable preview pose (GET /preview/poses) — label is German. */
export interface PoseInfo {
  id: string;
  label: string;
}

/** Response of GET /preview/poses (static sidecar pose catalog). */
export interface PosesResponse {
  poses: PoseInfo[];
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
}

/** One garment of an outfit preview (mirrors sidecar OutfitItemRequest). */
export interface PreviewOutfitItem {
  yddPath: string;
  ytdPaths: string[];
  textureIndex?: number;
  /** Slot id (e.g. "uppr", "p_head") — component slots replace the ped default. */
  slot: string;
}

/** POST /preview/outfit-glb — several garments on ONE ped in one scene. */
export interface PreviewOutfitRequest {
  items: PreviewOutfitItem[];
  pedModel?: PedModel;
  includePedBody?: boolean;
  /** Pose id (see {@link PreviewGlbRequest.pose}); null/undefined = bind pose. */
  pose?: string | null;
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
  /** Forced BC format; null keeps the source's BC family. */
  format: "BC1" | "BC3" | "BC7" | null;
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

export type HealthState = "unknown" | "ok" | "failing";
