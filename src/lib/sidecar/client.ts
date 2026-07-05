import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/lib/i18n";
import { useSidecarStore } from "@/lib/stores/sidecar-store";
import type {
  AnimInfo,
  AnimationsResponse,
  BuildDoneEvent,
  BuildProgressEvent,
  ImportScanResult,
  PoseInfo,
  PosesResponse,
  PreviewGlbRequest,
  PreviewGlbResult,
  PreviewOutfitRequest,
  SidecarConfigResult,
  SidecarHealth,
  SidecarInfo,
  SidecarServerInfo,
  StartBuildRequest,
  TextureFromImageRequest,
  TextureFromImageResult,
  TextureOptimizeRequest,
  TextureOptimizeResult,
  ValidateResponse,
  ValidationFinding,
  YddParseResult,
  YtdParseOptions,
  YtdParseResult,
} from "./types";

const HEALTH_POLL_MS = 5000;

/** Reads `{ status, port, token }` from the Rust managed state. */
export async function getSidecarInfo(): Promise<SidecarInfo> {
  return await invoke<SidecarInfo>("get_sidecar_info");
}

/** Kills the current sidecar child (if any) and spawns a fresh one. */
export async function restartSidecar(): Promise<void> {
  await invoke("restart_sidecar");
}

export class SidecarUnavailableError extends Error {
  constructor() {
    super(i18n.t("errors:sidecar.unavailable"));
    this.name = "SidecarUnavailableError";
  }
}

/** 422 ped_body_unavailable — includePedBody requested without a ready gtaPath. */
export class PedBodyUnavailableError extends Error {
  constructor() {
    super(i18n.t("errors:sidecar.pedBodyUnavailable"));
    this.name = "PedBodyUnavailableError";
  }
}

/** 422 pose_unavailable — the requested pose id cannot be served. */
export class PoseUnavailableError extends Error {
  /** Pose id from the error envelope (null when the sidecar omitted it). */
  readonly pose: string | null;
  constructor(pose: string | null) {
    super(i18n.t("errors:sidecar.poseUnavailable"));
    this.name = "PoseUnavailableError";
    this.pose = pose;
  }
}

/** Resolves base URL + token of the running sidecar (or throws). */
function sidecarTarget(): { base: string; token: string } {
  const info = useSidecarStore.getState().info;
  if (info.status !== "ready" || info.port == null || info.token == null) {
    throw new SidecarUnavailableError();
  }
  return { base: `http://127.0.0.1:${info.port}`, token: info.token };
}

/** Reads the `{ error }` envelope of a non-2xx sidecar response. */
async function sidecarErrorMessage(res: Response): Promise<string> {
  let message = i18n.t("errors:sidecar.genericError", { status: res.status });
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // non-JSON error body, keep generic message
  }
  return message;
}

/**
 * Typed fetch against the local sidecar HTTP server.
 * Adds the per-session `x-fg-atelier-token` header.
 */
export async function sidecarFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { base, token } = sidecarTarget();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-fg-atelier-token": token,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(await sidecarErrorMessage(res));
  }
  return (await res.json()) as T;
}

export async function fetchSidecarHealth(): Promise<SidecarHealth> {
  return await sidecarFetch<SidecarHealth>("/health");
}

/** GET /info — sidecar version + configured GTA path state. */
export async function fetchSidecarServerInfo(): Promise<SidecarServerInfo> {
  return await sidecarFetch<SidecarServerInfo>("/info");
}

/** POST /config — point the sidecar at the local GTA V folder. */
export async function configureSidecarGtaPath(gtaPath: string): Promise<SidecarConfigResult> {
  return await sidecarFetch<SidecarConfigResult>("/config", {
    method: "POST",
    body: JSON.stringify({ gtaPath }),
  });
}

/** POST /parse/ydd — parse a drawable dictionary file on disk. */
export async function parseYdd(path: string): Promise<YddParseResult> {
  return await sidecarFetch<YddParseResult>("/parse/ydd", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

/** POST /parse/ytd — parse a texture dictionary file on disk. */
export async function parseYtd(
  path: string,
  options?: YtdParseOptions,
): Promise<YtdParseResult> {
  return await sidecarFetch<YtdParseResult>("/parse/ytd", {
    method: "POST",
    body: JSON.stringify({ path, ...(options ?? {}) }),
  });
}

/** POST /import/scan — scan a clothing-pack folder for import candidates. */
export async function importScan(folderPath: string): Promise<ImportScanResult> {
  return await sidecarFetch<ImportScanResult>("/import/scan", {
    method: "POST",
    body: JSON.stringify({ folderPath }),
  });
}

/** Parses a count header value ("12345") to a number, null when unreadable. */
function parseCountHeader(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Parses the comma-separated X-FG-Appearance-Fallbacks header (slot names the
 * sidecar reset to default) — [] when the header is absent/empty.
 */
function parseFallbacksHeader(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((slot) => slot.trim())
    .filter((slot) => slot.length > 0);
}

/**
 * Maps a non-2xx preview response to a typed error. The 422 envelope of
 * pose_unavailable additionally carries the offending pose id.
 */
async function throwPreviewError(res: Response): Promise<never> {
  let envelope: { error?: string; pose?: string } = {};
  try {
    envelope = (await res.json()) as { error?: string; pose?: string };
  } catch {
    // non-JSON error body, keep generic message
  }
  if (res.status === 422 && envelope.error === "ped_body_unavailable") {
    throw new PedBodyUnavailableError();
  }
  if (res.status === 422 && envelope.error === "pose_unavailable") {
    throw new PoseUnavailableError(envelope.pose ?? null);
  }
  throw new Error(
    envelope.error ?? i18n.t("errors:sidecar.genericError", { status: res.status }),
  );
}

/** GET /preview/poses — static catalog of bakeable preview poses. */
export async function fetchPreviewPoses(): Promise<PoseInfo[]> {
  const res = await sidecarFetch<PosesResponse>("/preview/poses");
  return res.poses;
}

/** GET /preview/animations — catalog of looping preview animations. */
export async function fetchPreviewAnimations(): Promise<AnimInfo[]> {
  const res = await sidecarFetch<AnimationsResponse>("/preview/animations");
  return res.animations;
}

/**
 * POST /preview/glb — renders a drawable (+ optional ped body) to GLB bytes.
 * Binary response, so this bypasses the JSON-typed {@link sidecarFetch}.
 */
export async function fetchPreviewGlb(
  request: PreviewGlbRequest,
): Promise<PreviewGlbResult> {
  const { base, token } = sidecarTarget();
  const res = await fetch(`${base}/preview/glb`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fg-atelier-token": token,
    },
    body: JSON.stringify({
      yddPath: request.yddPath,
      ytdPaths: request.ytdPaths,
      textureIndex: request.textureIndex ?? 0,
      ...(request.pedModel ? { pedModel: request.pedModel } : {}),
      includePedBody: request.includePedBody ?? false,
      pose: request.pose ?? null,
      ...(request.appearance ? { appearance: request.appearance } : {}),
      // Preview-only transforms — written ONLY when active, so a request
      // without them stays byte-for-byte identical to before (sidecar reads
      // the missing fields as null -> Identity path -> same GLB bytes).
      ...(request.hairScale != null ? { hairScale: request.hairScale } : {}),
      ...(request.heelLift ? { heelLift: request.heelLift } : {}),
      // Animated mode (skinned GLB the viewer plays); overrides pose server-side.
      ...(request.animation ? { animation: request.animation } : {}),
    }),
  });
  if (!res.ok) {
    await throwPreviewError(res);
  }
  return {
    glb: await res.arrayBuffer(),
    vertexCount: parseCountHeader(res.headers.get("X-FG-Vertex-Count")),
    polyCount: parseCountHeader(res.headers.get("X-FG-Poly-Count")),
    appearanceFallbacks: parseFallbacksHeader(
      res.headers.get("X-FG-Appearance-Fallbacks"),
    ),
    transientDegraded: res.headers.get("X-FG-Transient-Degraded") === "1",
  };
}

/**
 * POST /preview/outfit-glb — several garments in ONE scene; with ped body the
 * garments REPLACE the ped's default components in their slots (no stacked
 * bodies, no default shirt under the selected jacket).
 */
export async function fetchPreviewOutfitGlb(
  request: PreviewOutfitRequest,
): Promise<PreviewGlbResult> {
  const { base, token } = sidecarTarget();
  const res = await fetch(`${base}/preview/outfit-glb`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fg-atelier-token": token,
    },
    body: JSON.stringify({
      items: request.items.map((item) => ({
        yddPath: item.yddPath,
        ytdPaths: item.ytdPaths,
        textureIndex: item.textureIndex ?? 0,
        slot: item.slot,
        // Per-item hairScale — only the hair/p_head item carries it; absent for
        // every other garment keeps those items' bytes identical to before.
        ...(item.hairScale != null ? { hairScale: item.hairScale } : {}),
      })),
      ...(request.pedModel ? { pedModel: request.pedModel } : {}),
      includePedBody: request.includePedBody ?? false,
      pose: request.pose ?? null,
      ...(request.appearance ? { appearance: request.appearance } : {}),
      // Global scene lift (derived from the feet item) — written only when
      // active so a heel-free outfit request stays byte-identical to before.
      ...(request.heelLift ? { heelLift: request.heelLift } : {}),
      // Animated mode (skinned GLB the viewer plays); overrides pose server-side.
      ...(request.animation ? { animation: request.animation } : {}),
    }),
  });
  if (!res.ok) {
    await throwPreviewError(res);
  }
  return {
    glb: await res.arrayBuffer(),
    vertexCount: parseCountHeader(res.headers.get("X-FG-Vertex-Count")),
    polyCount: parseCountHeader(res.headers.get("X-FG-Poly-Count")),
    appearanceFallbacks: parseFallbacksHeader(
      res.headers.get("X-FG-Appearance-Fallbacks"),
    ),
    transientDegraded: res.headers.get("X-FG-Transient-Degraded") === "1",
  };
}

// ---------------------------------------------------------------------------
// Build & validate (sidecar/Api/BuildEndpoints.cs)
// ---------------------------------------------------------------------------

/** 409 on POST /build — another build is already running in this sidecar. */
export class BuildBusyError extends Error {
  constructor() {
    super(i18n.t("errors:sidecar.buildBusy"));
    this.name = "BuildBusyError";
  }
}

/** POST /validate — runs the pre-build validation against the project on disk. */
export async function validateProject(
  projectDir: string,
  project: unknown,
): Promise<ValidationFinding[]> {
  const res = await sidecarFetch<ValidateResponse>("/validate", {
    method: "POST",
    body: JSON.stringify({ projectDir, project }),
  });
  return res.findings;
}

/**
 * POST /build — starts a build job (202 { jobId }). Throws
 * {@link BuildBusyError} on 409 busy, a readable German error otherwise.
 */
export async function startBuild(request: StartBuildRequest): Promise<{ jobId: string }> {
  const { base, token } = sidecarTarget();
  const res = await fetch(`${base}/build`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fg-atelier-token": token,
    },
    body: JSON.stringify(request),
  });
  if (res.status === 409) throw new BuildBusyError();
  if (!res.ok) throw new Error(await sidecarErrorMessage(res));
  return (await res.json()) as { jobId: string };
}

/** Parses one SSE `data:` payload; null for malformed/keep-alive lines. */
function parseSseData(payload: string): BuildProgressEvent | BuildDoneEvent | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as BuildProgressEvent | BuildDoneEvent;
  } catch {
    return null;
  }
}

/** One SSE pass over GET /build/progress; null when the stream ends early. */
async function readProgressStream(
  jobId: string,
  onProgress: (event: BuildProgressEvent) => void,
  signal?: AbortSignal,
): Promise<BuildDoneEvent | null> {
  const { base, token } = sidecarTarget();
  const res = await fetch(
    `${base}/build/progress?jobId=${encodeURIComponent(jobId)}`,
    { headers: { "x-fg-atelier-token": token }, signal },
  );
  if (!res.ok) throw new Error(await sidecarErrorMessage(res));
  if (!res.body) throw new Error(i18n.t("errors:sidecar.streamFailed"));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE framing: events are separated by a blank line; we only ever send
      // single-line `data:` payloads (comment lines `:` are keep-alives).
      let separator: number;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of rawEvent.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const event = parseSseData(line.slice(5).trim());
          if (!event) continue;
          if ("done" in event && event.done) return event;
          onProgress(event as BuildProgressEvent);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return null;
}

/**
 * GET /build/progress?jobId=… — consumes the SSE stream via fetch +
 * ReadableStream (EventSource cannot send the `x-fg-atelier-token` header).
 * Resolves with the terminal event; reconnects up to 2 times when the stream
 * drops mid-build (the sidecar replays events from the start — repeated
 * progress events are harmless for the UI).
 */
export async function buildProgress(
  jobId: string,
  onProgress: (event: BuildProgressEvent) => void,
  signal?: AbortSignal,
): Promise<BuildDoneEvent> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const done = await readProgressStream(jobId, onProgress, signal);
    if (done) return done;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(i18n.t("errors:sidecar.progressLost"));
}

/** POST /texture/optimize — resizes/re-encodes all textures of a .ytd. */
export async function optimizeTexture(
  request: TextureOptimizeRequest,
): Promise<TextureOptimizeResult> {
  return await sidecarFetch<TextureOptimizeResult>("/texture/optimize", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

/** POST /texture/from-image — converts a raster image into a single-texture .ytd. */
export async function textureFromImage(
  request: TextureFromImageRequest,
): Promise<TextureFromImageResult> {
  return await sidecarFetch<TextureFromImageResult>("/texture/from-image", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

/**
 * Drives the sidecar status pill:
 * - syncs Rust state via `get_sidecar_info` + the `sidecar://status` event
 * - polls GET /health while the sidecar reports ready
 */
export function useSidecarHealth(): void {
  const setInfo = useSidecarStore((s) => s.setInfo);
  const setHealth = useSidecarStore((s) => s.setHealth);

  useEffect(() => {
    let disposed = false;

    // Initial snapshot (the ready event may have fired before the webview loaded).
    getSidecarInfo()
      .then((info) => {
        if (!disposed) setInfo(info);
      })
      .catch(() => {
        /* invoke unavailable (e.g. plain browser dev) */
      });

    const unlistenPromise = listen<SidecarInfo>("sidecar://status", (event) => {
      if (!disposed) {
        setInfo(event.payload);
        if (event.payload.status !== "ready") setHealth("unknown");
      }
    });

    const interval = setInterval(async () => {
      const { info } = useSidecarStore.getState();
      if (info.status !== "ready") return;
      try {
        await fetchSidecarHealth();
        if (!disposed) setHealth("ok");
      } catch {
        if (!disposed) setHealth("failing");
      }
    }, HEALTH_POLL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [setInfo, setHealth]);
}
