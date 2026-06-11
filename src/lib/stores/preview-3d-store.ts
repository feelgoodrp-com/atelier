/**
 * 3D preview state for the workbench viewport:
 *
 * - GLB blob cache keyed by ydd hash + applied texture hash + ped-body mode
 *   + pose id. LRU with cap {@link GLB_CACHE_MAX}; evicted entries revoke
 *   their object URL. In-flight requests are deduped per key.
 * - /parse/ydd metadata cache (LOD flags + mesh stats) keyed by ydd hash —
 *   feeds the LOD warning chips without refetching GLBs.
 * - Viewport options: camera preset, autorotate, ped-body toggle, per-drawable
 *   texture variant selection (drives `textureIndex` of /preview/glb).
 *
 * Global viewport prefs (camera preset, autorotate, ped body, pose) are
 * persisted to localStorage via zustand/persist — caches, blob URLs and
 * per-project state are excluded via partialize.
 */

import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import {
  PoseUnavailableError,
  fetchPreviewGlb,
  fetchPreviewOutfitGlb,
  parseYdd,
} from "@/lib/sidecar/client";
import type {
  DrawableInfo,
  PedModel,
  PoseInfo,
  PreviewGlbRequest,
  PreviewOutfitRequest,
} from "@/lib/sidecar/types";
import type { AtelierProject, ProjectDrawable } from "@/lib/project/schema";

/** Single-garment OR outfit request — the fetch dispatches on `items`. */
export type PreviewAnyRequest = PreviewGlbRequest | PreviewOutfitRequest;

/** Outfit preview cap — more selected drawables are skipped (hint toast). */
export const PREVIEW_MAX_MODELS = 8;
/** Max cached GLB blob URLs before LRU eviction kicks in. */
const GLB_CACHE_MAX = 32;

export type CameraPreset = "gesamt" | "kopf" | "torso" | "beine" | "fuesse";

export const CAMERA_PRESETS: ReadonlyArray<{ id: CameraPreset; label: string }> = [
  { id: "gesamt", label: "Gesamt" },
  { id: "kopf", label: "Kopf" },
  { id: "torso", label: "Torso" },
  { id: "beine", label: "Beine" },
  { id: "fuesse", label: "Füße" },
];

/**
 * Hardcoded mirror of the sidecar's static pose catalog (GET /preview/poses)
 * — used until the live list is fetched, per shared contract.
 */
export const POSES_FALLBACK: ReadonlyArray<PoseInfo> = [
  { id: "stand", label: "Stehen (Idle)" },
  { id: "walk", label: "Gehen (eingefroren)" },
  { id: "sit", label: "Sitzen" },
  { id: "hands_up", label: "Hände hoch" },
  { id: "aim", label: "Zielen" },
  { id: "arms_crossed", label: "Arme verschränkt" },
];

export type GlbStatus = "loading" | "ready" | "error";

export interface GlbEntry {
  status: GlbStatus;
  /** Object URL of the GLB blob (ready only) — revoked on LRU eviction. */
  url: string | null;
  /** From the X-FG-Vertex-Count / X-FG-Poly-Count response headers. */
  vertexCount: number | null;
  polyCount: number | null;
  /** German error message when status === "error". */
  error: string | null;
}

export interface YddMetaEntry {
  status: GlbStatus;
  /** Per-drawable mesh stats + LOD flags of the parsed .ydd. */
  drawables: DrawableInfo[];
  error: string | null;
}

interface Preview3dState {
  /** GLB cache, keyed via {@link glbCacheKey}. */
  entries: Record<string, GlbEntry>;
  /** /parse/ydd results keyed by ydd sha256 (LOD warnings, stat fallback). */
  yddMeta: Record<string, YddMetaEntry>;
  /** Selected texture variant per drawable uuid (default 0 = letter "a"). */
  textureIndexByDrawable: Record<string, number>;
  cameraPreset: CameraPreset;
  autoRotate: boolean;
  /** User wish — only effective while the sidecar reports gtaPathReady. */
  includePedBody: boolean;
  /** GET /info gtaPathReady (null = unknown / sidecar not ready). */
  gtaPathReady: boolean | null;
  /** Active pose id (null = bind pose) — only sent while gtaPathReady. */
  pose: string | null;
  /** Selectable poses — {@link POSES_FALLBACK} until the live list loads. */
  poses: PoseInfo[];
  /** True once GET /preview/poses succeeded (the list is fetched once). */
  posesLoaded: boolean;
  /** Bumped by the "Fokus" button — the viewer re-frames on change. */
  frameNonce: number;

  /** Fetches + caches the GLB for `key` once (no-op while loading/ready). */
  ensureGlb: (key: string, request: PreviewAnyRequest) => void;
  /**
   * Background prefetch: REPLACES the prefetch queue with these items and
   * works through them one at a time (skipping anything already cached) —
   * the visible drawable list warms the cache before the user selects.
   */
  prefetchGlbs: (items: Array<{ key: string; request: PreviewAnyRequest }>) => void;
  /** Drops an errored entry and refetches. */
  retryGlb: (key: string, request: PreviewAnyRequest) => void;
  /** Fetches /parse/ydd metadata for `hash` once. */
  ensureYddMeta: (hash: string, absPath: string) => void;
  /**
   * Evicts every cached GLB rendered with this texture hash (the .ytd file
   * changed on disk, e.g. after texture optimize) — revokes the blob URLs.
   */
  invalidateGlbsByTextureHash: (textureHash: string) => void;
  setTextureIndex: (drawableId: string, index: number) => void;
  setCameraPreset: (cameraPreset: CameraPreset) => void;
  setAutoRotate: (autoRotate: boolean) => void;
  setIncludePedBody: (includePedBody: boolean) => void;
  setGtaPathReady: (gtaPathReady: boolean | null) => void;
  setPose: (pose: string | null) => void;
  /** Replaces the pose list with the live GET /preview/poses result. */
  setPoses: (poses: PoseInfo[]) => void;
  requestFrame: () => void;
}

/** Freemode ped model matching a drawable's gender. */
export function pedModelFor(drawable: ProjectDrawable): PedModel {
  return drawable.gender === "male" ? "mp_m_freemode_01" : "mp_f_freemode_01";
}

/**
 * Cache key per shared contract: sha256(ydd) + sha256(applied ytd) +
 * ped-body mode + pose id ("none" = bind pose). The ped model is part of the
 * key so mp_m/mp_f bodies on an identical mesh never collide.
 *
 * `poseSkeleton`: garment-only posed previews (no ped body) still bake with a
 * gender-specific skeleton + clip — the key must disambiguate mp_m vs mp_f
 * WITHOUT colliding with the "body merged" variants ("skel-" prefix).
 */
export function glbCacheKey(
  yddHash: string,
  textureHash: string | null,
  pedModel: PedModel | null,
  pose: string | null,
  poseSkeleton: PedModel | null = null,
): string {
  const body = pedModel ?? (poseSkeleton ? `skel-${poseSkeleton}` : "off");
  return `${yddHash}|${textureHash ?? "none"}|${body}|${pose ?? "none"}`;
}

/**
 * Outfit cache key: order-independent over the garment hashes so re-selecting
 * the same combination in a different order still hits the cache. Texture
 * hashes are embedded, so {@link invalidateGlbsByTextureHash} catches outfit
 * entries too.
 */
export function outfitCacheKey(
  parts: Array<{ yddHash: string; textureHash: string | null }>,
  pedModel: PedModel | null,
  pose: string | null,
): string {
  const sorted = parts
    .map((p) => `${p.yddHash}:${p.textureHash ?? "none"}`)
    .sort()
    .join("+");
  return `outfit|${sorted}|${pedModel ?? "off"}|${pose ?? "none"}`;
}

/** Clamps a stored texture selection to the drawable's current variants. */
export function clampTextureIndex(
  drawable: ProjectDrawable,
  raw: number | undefined,
): number {
  if (drawable.textures.length === 0) return 0;
  const index = raw ?? 0;
  return Math.max(0, Math.min(drawable.textures.length - 1, index));
}

export interface PreviewSelection {
  /** Selected drawables with a ydd mesh, capped at {@link PREVIEW_MAX_MODELS}. */
  rendered: ProjectDrawable[];
  /** Selected drawables with a ydd beyond the cap (hint toast). */
  overCap: number;
  /** Selected drawables without a ydd mesh (cannot be rendered). */
  withoutYdd: number;
}

/** Which selected drawables the 3D preview renders (selection order, cap 8). */
export function selectPreviewedDrawables(
  project: AtelierProject | null,
  selection: string[],
): PreviewSelection {
  if (!project || selection.length === 0) {
    return { rendered: [], overCap: 0, withoutYdd: 0 };
  }
  const byId = new Map(project.drawables.map((d) => [d.id, d]));
  const withYdd: ProjectDrawable[] = [];
  let withoutYdd = 0;
  for (const id of selection) {
    const drawable = byId.get(id);
    if (!drawable) continue;
    if (drawable.ydd) withYdd.push(drawable);
    else withoutYdd++;
  }
  return {
    rendered: withYdd.slice(0, PREVIEW_MAX_MODELS),
    overCap: Math.max(0, withYdd.length - PREVIEW_MAX_MODELS),
    withoutYdd,
  };
}

/** Slice of {@link Preview3dState} written to localStorage. */
type Preview3dPersisted = Pick<
  Preview3dState,
  "cameraPreset" | "autoRotate" | "includePedBody" | "pose"
>;

const createPreview3dState: StateCreator<
  Preview3dState,
  [["zustand/persist", unknown]]
> = (set, get) => {
  /** LRU order, oldest first. Lives outside the reactive state. */
  let lruOrder: string[] = [];

  const touch = (key: string) => {
    lruOrder = [...lruOrder.filter((k) => k !== key), key];
  };

  /** Evicts oldest non-loading entries until the cache fits the cap. */
  const evictOverCap = () => {
    const { entries } = get();
    let keys = Object.keys(entries);
    if (keys.length <= GLB_CACHE_MAX) return;

    const next = { ...entries };
    for (const key of lruOrder) {
      if (keys.length <= GLB_CACHE_MAX) break;
      const entry = next[key];
      if (!entry || entry.status === "loading") continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      delete next[key];
      keys = keys.filter((k) => k !== key);
    }
    lruOrder = lruOrder.filter((k) => k in next);
    set({ entries: next });
  };

  const fetchGlb = async (key: string, request: PreviewAnyRequest) => {
    // Retry path: free the previous blob URL before replacing the entry.
    const previous = get().entries[key];
    if (previous?.url) URL.revokeObjectURL(previous.url);
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: {
          status: "loading",
          url: null,
          vertexCount: null,
          polyCount: null,
          error: null,
        },
      },
    }));
    touch(key);
    try {
      // Outfit requests (several garments on one ped) carry `items`.
      const result =
        "items" in request
          ? await fetchPreviewOutfitGlb(request)
          : await fetchPreviewGlb(request);
      const blob = new Blob([result.glb], { type: "model/gltf-binary" });
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: {
            status: "ready",
            url: URL.createObjectURL(blob),
            vertexCount: result.vertexCount,
            polyCount: result.polyCount,
            error: null,
          },
        },
      }));
      evictOverCap();
    } catch (e) {
      // Per contract, a pose answers 422 pose_unavailable when its clip
      // cannot be served — hide the pose and fall back to the bind pose
      // (the pane re-requests with pose=null automatically).
      if (e instanceof PoseUnavailableError) {
        const poseId = e.pose ?? request.pose ?? null;
        if (poseId !== null) {
          const { poses, pose } = get();
          const label = poses.find((p) => p.id === poseId)?.label ?? poseId;
          set({
            poses: poses.filter((p) => p.id !== poseId),
            ...(pose === poseId ? { pose: null } : {}),
          });
          toast.error("Pose nicht verfügbar", {
            // Stable id: queued prefetch items with the same dead pose would
            // otherwise stack one toast per request.
            id: `pose-unavailable-${poseId}`,
            description: `„${label}“ kann auf dieser Installation nicht geladen werden — zurück zur Bind-Pose.`,
          });
        }
      }
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: {
            status: "error",
            url: null,
            vertexCount: null,
            polyCount: null,
            error: e instanceof Error ? e.message : String(e),
          },
        },
      }));
    }
  };

  /**
   * Low-priority prefetch: strictly sequential so user-triggered loads stay
   * snappy. fetchGlb marks entries "loading" immediately, so ensureGlb never
   * double-fetches a key the prefetcher already started.
   */
  let prefetchQueue: Array<{ key: string; request: PreviewAnyRequest }> = [];
  let prefetchPumping = false;

  const pumpPrefetch = async () => {
    if (prefetchPumping) return;
    prefetchPumping = true;
    try {
      while (prefetchQueue.length > 0) {
        const next = prefetchQueue.shift()!;
        if (get().entries[next.key]) continue; // landed meanwhile
        await fetchGlb(next.key, next.request);
      }
    } finally {
      prefetchPumping = false;
    }
  };

  const fetchYddMeta = async (hash: string, absPath: string) => {
    set((state) => ({
      yddMeta: {
        ...state.yddMeta,
        [hash]: { status: "loading", drawables: [], error: null },
      },
    }));
    try {
      const parsed = await parseYdd(absPath);
      set((state) => ({
        yddMeta: {
          ...state.yddMeta,
          [hash]: { status: "ready", drawables: parsed.drawables, error: null },
        },
      }));
    } catch (e) {
      set((state) => ({
        yddMeta: {
          ...state.yddMeta,
          [hash]: {
            status: "error",
            drawables: [],
            error: e instanceof Error ? e.message : String(e),
          },
        },
      }));
    }
  };

  return {
    entries: {},
    yddMeta: {},
    textureIndexByDrawable: {},
    cameraPreset: "gesamt",
    autoRotate: false,
    includePedBody: false,
    gtaPathReady: null,
    pose: null,
    poses: [...POSES_FALLBACK],
    posesLoaded: false,
    frameNonce: 0,

    ensureGlb: (key, request) => {
      const existing = get().entries[key];
      if (existing) {
        // Errored entries stay until an explicit retry — touching keeps
        // recently shown models at the warm end of the LRU.
        touch(key);
        return;
      }
      void fetchGlb(key, request);
    },

    retryGlb: (key, request) => {
      if (get().entries[key]?.status === "loading") return;
      void fetchGlb(key, request);
    },

    prefetchGlbs: (items) => {
      prefetchQueue = items.filter((item) => !get().entries[item.key]);
      void pumpPrefetch();
    },

    ensureYddMeta: (hash, absPath) => {
      if (get().yddMeta[hash]) return;
      void fetchYddMeta(hash, absPath);
    },

    invalidateGlbsByTextureHash: (textureHash) =>
      set((state) => {
        // Both key layouts embed the applied texture hashes (glbCacheKey:
        // yddHash|textureHash|pedModel|pose; outfitCacheKey:
        // outfit|a:b+c:d|ped|pose) — a substring match on the 64-hex hash is
        // unambiguous.
        const stale = Object.keys(state.entries).filter((key) =>
          key.includes(textureHash),
        );
        if (stale.length === 0) return state;
        const entries = { ...state.entries };
        for (const key of stale) {
          const url = entries[key]?.url;
          if (url) URL.revokeObjectURL(url);
          delete entries[key];
        }
        lruOrder = lruOrder.filter((key) => key in entries);
        return { entries };
      }),

    setTextureIndex: (drawableId, index) =>
      set((state) => ({
        textureIndexByDrawable: {
          ...state.textureIndexByDrawable,
          [drawableId]: index,
        },
      })),

    setCameraPreset: (cameraPreset) => set({ cameraPreset }),
    setAutoRotate: (autoRotate) => set({ autoRotate }),
    setIncludePedBody: (includePedBody) => set({ includePedBody }),
    setGtaPathReady: (gtaPathReady) => set({ gtaPathReady }),
    setPose: (pose) => set({ pose }),

    setPoses: (poses) =>
      set((state) => ({
        poses,
        posesLoaded: true,
        // The live list is authoritative — drop an active pose it lacks.
        ...(state.pose !== null && !poses.some((p) => p.id === state.pose)
          ? { pose: null }
          : {}),
      })),

    requestFrame: () => set((state) => ({ frameNonce: state.frameNonce + 1 })),
  };
};

export const usePreview3dStore = create<Preview3dState>()(
  persist(createPreview3dState, {
    name: "atelier:preview3d-prefs",
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s): Preview3dPersisted => ({
      cameraPreset: s.cameraPreset,
      autoRotate: s.autoRotate,
      includePedBody: s.includePedBody,
      pose: s.pose,
    }),
    // Validating merge — a stale/tampered blob must never yield an unknown
    // camera preset (the toolbar select would render empty). A persisted
    // pose the installation no longer serves is fine: setPoses drops it
    // once the live list arrives, and the 422 handler falls back to the
    // bind pose. includePedBody without a GTA path stays inert thanks to
    // the gtaPathReady guard in the preview pane.
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<Preview3dPersisted>;
      return {
        ...current,
        cameraPreset: CAMERA_PRESETS.some((c) => c.id === p.cameraPreset)
          ? (p.cameraPreset as CameraPreset)
          : current.cameraPreset,
        autoRotate:
          typeof p.autoRotate === "boolean" ? p.autoRotate : current.autoRotate,
        includePedBody:
          typeof p.includePedBody === "boolean"
            ? p.includePedBody
            : current.includePedBody,
        pose: typeof p.pose === "string" ? p.pose : null,
      };
    },
  }),
);
