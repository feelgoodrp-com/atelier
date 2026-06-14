/**
 * 3D preview state for the workbench viewport:
 *
 * - GLB blob cache keyed by ydd hash + applied texture hash + ped-body mode
 *   + pose id (+ canonical appearance key when the ped body is merged). LRU
 *   with cap {@link GLB_CACHE_MAX}; evicted entries revoke their object URL.
 *   In-flight requests are deduped per key.
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
import i18n from "@/lib/i18n";
import {
  PoseUnavailableError,
  fetchPreviewGlb,
  fetchPreviewOutfitGlb,
  parseYdd,
} from "@/lib/sidecar/client";
import type {
  DrawableInfo,
  PedAppearance,
  PedModel,
  PoseInfo,
  PreviewGlbRequest,
  PreviewOutfitRequest,
} from "@/lib/sidecar/types";
import {
  appearanceKey,
  extrasToFace,
  f2,
  quantizeScale,
  normalizeAppearance,
  sanitizeAppearance,
  sanitizeAppearanceExtras,
  sanitizeAppearancePresets,
  type AppearancePreset,
  type PedAppearanceExtras,
} from "@/lib/preview/appearance";
import type { AtelierProject, ProjectDrawable } from "@/lib/project/schema";

// Canonical appearance-key helper (shared sidecar contract) — re-exported so
// UI code can keep importing preview concerns from the store module.
export { appearanceKey };

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
  /**
   * Slots the sidecar reset to default (X-FG-Appearance-Fallbacks header) —
   * stored PER ENTRY so the warnings stay correct on cache hits and cannot be
   * overwritten by prefetch responses for other genders/appearances. The UI
   * derives its hints from the entry that is actually rendered.
   */
  appearanceFallbacks: string[];
  /**
   * Mirrors the sidecar's X-FG-Transient-Degraded header: the GLB was built
   * while a component load timed out and may miss a texture. ensureGlb and
   * the prefetcher treat such entries as retryable instead of frozen.
   */
  transient: boolean;
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
  /** Active ped-body appearance (null = game default) — sent with outfit GLBs. */
  appearance: PedAppearance | null;
  /** Head-feature extras of the last import — stored for presets, not rendered. */
  appearanceExtras: PedAppearanceExtras | null;
  /** German parser warnings of the last Menyoo import (transient). */
  appearanceWarnings: string[];
  /** Named USER presets — the built-in standard presets live in appearance.ts. */
  appearancePresets: AppearancePreset[];

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
  /** Sets the active appearance (stepper edits) — keeps extras/warnings. */
  setAppearance: (appearance: PedAppearance | null) => void;
  /**
   * FACE-ONLY Menyoo import (hard product rule): applies ONLY the face derived
   * from the imported head features and stores the raw extras + warnings. The
   * imported clothing/hair (components) and props are IGNORED on purpose — they
   * never touch appearance.components/props, which keep whatever the user set
   * manually. Only appearance.face is (re)written from {@link extrasToFace}.
   */
  applyImportedAppearance: (
    extras: PedAppearanceExtras | null,
    warnings: string[],
  ) => void;
  /**
   * Applies a SAVED preset: replaces components/props with the preset's
   * appearance AND sets face from the preset's extras (presets are authored in
   * the tool, so their clothing is intentional — unlike the face-only import).
   */
  applyPreset: (
    appearance: PedAppearance | null,
    extras: PedAppearanceExtras | null,
  ) => void;
  /** Drops the rendered face but keeps the manually set components/props. */
  removeFace: () => void;
  /** Back to the game default (clears extras, warnings and fallbacks). */
  resetAppearance: () => void;
  /** Upserts a user preset by name (case-insensitive). */
  saveAppearancePreset: (preset: AppearancePreset) => void;
  deleteAppearancePreset: (name: string) => void;
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
  appearance: string = "default",
  hairScale: number | null = null,
  heelLift: boolean = false,
): string {
  const body = pedModel ?? (poseSkeleton ? `skel-${poseSkeleton}` : "off");
  const base = `${yddHash}|${textureHash ?? "none"}|${body}|${pose ?? "none"}`;
  // Appearance changes the bytes ONLY when the ped body is merged — garment-
  // only and "skel-" keys stay untouched (appending there would invalidate
  // every cached GLB for nothing).
  let key = pedModel ? `${base}|app:${appearance}` : base;
  // hairScale/heelLift mutate the GARMENT mesh itself, so they apply in BOTH
  // variants (garment-only AND body-merged), unlike appearance. Appended last
  // and ONLY when active, so a request without them stays byte-identical to a
  // pre-feature key — exactly mirroring the conditional request body. f2 is
  // the SHARED quantizer with the sidecar (byte-identical to F2).
  if (hairScale != null) key += `|hs:${f2(hairScale)}`;
  if (heelLift) key += `|hl1`;
  return key;
}

/**
 * Outfit cache key: order-independent over the garment hashes so re-selecting
 * the same combination in a different order still hits the cache. Texture
 * hashes are embedded, so {@link invalidateGlbsByTextureHash} catches outfit
 * entries too.
 */
export function outfitCacheKey(
  parts: Array<{
    yddHash: string;
    textureHash: string | null;
    /** Per-item uniform scale (hair/p_head only) — folded into the part string. */
    hairScale?: number | null;
  }>,
  pedModel: PedModel | null,
  pose: string | null,
  appearance: string = "default",
  /** GLOBAL heel lift (any feet item has highHeels) — appended once at the end. */
  heelLift: boolean = false,
): string {
  const sorted = parts
    // hairScale is PER ITEM, so it must travel INSIDE the sorted part string
    // (an item with a shrunk hair mesh is a different cache entry). Only
    // appended when set, so heel-/hair-free outfits keep their old part hashes.
    .map(
      (p) =>
        `${p.yddHash}:${p.textureHash ?? "none"}${
          p.hairScale != null ? `:h${f2(p.hairScale)}` : ""
        }`,
    )
    .sort()
    .join("+");
  const base = `outfit|${sorted}|${pedModel ?? "off"}|${pose ?? "none"}`;
  // Same rule as glbCacheKey: the appearance segment exists only when the
  // ped body is part of the request.
  let key = pedModel ? `${base}|app:${appearance}` : base;
  // heelLift lifts the WHOLE scene -> global, appended once and only when
  // active (an outfit without heels keeps its pre-feature key).
  if (heelLift) key += `|hl1`;
  return key;
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

/**
 * Preview-only hairScale of a drawable (null = feature off). Mirrors the
 * inspector's gating: only hair (component 2) and p_head (prop) carry it. The
 * value is the stored slider (flags.hairScaleValue 0..1); the build path writes
 * it for p_head only, but the preview shows it for both, matching the inspector
 * which exposes the slider on both. Shared by the pane AND the prefetch hook so
 * their cache keys / requests cannot diverge.
 *
 * The slider value is F2-quantized HERE so the value that travels into the
 * request body is EXACTLY the value the cache key buckets it into (f2). Without
 * this, the sidecar would render with the raw value while the key uses f2(raw)
 * — two distinct sub-0.01 inputs in one bucket would key identically yet render
 * differently, serving a stale GLB. {@link quantizeScale} is idempotent w.r.t.
 * {@link f2}, so the key segment is unchanged for already-quantized values.
 */
export function drawableHairScale(drawable: ProjectDrawable): number | null {
  if (drawable.type !== "hair" && drawable.type !== "p_head") return null;
  if (drawable.flags.hairScaleValue == null) return null;
  return quantizeScale(drawable.flags.hairScaleValue);
}

/** True when a drawable is a feet item flagged highHeels (drives the scene lift). */
export function drawableHasHeelLift(drawable: ProjectDrawable): boolean {
  return drawable.type === "feet" && drawable.flags.highHeels;
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
  | "cameraPreset"
  | "autoRotate"
  | "includePedBody"
  | "pose"
  | "appearance"
  | "appearanceExtras"
  | "appearancePresets"
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
          appearanceFallbacks: [],
          transient: false,
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
      // Fallback slots live ON the entry (keyed by ped model + appearance):
      // cache hits keep their warnings and prefetch responses for other
      // genders/appearances can never overwrite the visible hints.
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: {
            status: "ready",
            url: URL.createObjectURL(blob),
            vertexCount: result.vertexCount,
            polyCount: result.polyCount,
            appearanceFallbacks: result.appearanceFallbacks,
            transient: result.transientDegraded,
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
          // Prefer the localized pose label; fall back to the catalog label
          // (live sidecar list) and finally the raw id for unknown poses.
          const poseKey = `preview:pose.${poseId}`;
          const localized = i18n.t(poseKey);
          const label =
            localized !== poseKey
              ? localized
              : (poses.find((p) => p.id === poseId)?.label ?? poseId);
          set({
            poses: poses.filter((p) => p.id !== poseId),
            ...(pose === poseId ? { pose: null } : {}),
          });
          toast.error(i18n.t("sync:pose.unavailable"), {
            // Stable id: queued prefetch items with the same dead pose would
            // otherwise stack one toast per request.
            id: `pose-unavailable-${poseId}`,
            description: i18n.t("sync:pose.unavailableDescription", { label }),
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
            appearanceFallbacks: [],
            transient: false,
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
        const landed = get().entries[next.key];
        // Transient-degraded entries are worth a retry, everything else
        // (loading/ready/error) landed meanwhile and is skipped.
        if (landed && !(landed.status === "ready" && landed.transient)) continue;
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
    appearance: null,
    appearanceExtras: null,
    appearanceWarnings: [],
    appearancePresets: [],

    ensureGlb: (key, request) => {
      const existing = get().entries[key];
      // Transient-degraded results (sidecar load timeout) are retryable:
      // re-fetch instead of freezing the possibly texture-less GLB.
      if (existing && !(existing.status === "ready" && existing.transient)) {
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
      prefetchQueue = items.filter((item) => {
        const existing = get().entries[item.key];
        return !existing || (existing.status === "ready" && existing.transient);
      });
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

    // Appearance changes need no explicit cache flush — the |app:<key>
    // segment of the outfit cache keys re-fetches automatically, and the
    // fallback hints travel with the entries (no transient state to clear).
    setAppearance: (appearance) => set({ appearance }),

    // FACE-ONLY import: the imported components/props are deliberately dropped
    // — only the face (derived from the head features) is written, merged onto
    // whatever the user already set manually. The raw extras stay stored so a
    // preset save keeps the full head data; warnings surface in the popover.
    applyImportedAppearance: (extras, warnings) =>
      set((state) => {
        const face = extrasToFace(extras) ?? undefined;
        const next = normalizeAppearance({
          ...(state.appearance?.components
            ? { components: state.appearance.components }
            : {}),
          ...(state.appearance?.props ? { props: state.appearance.props } : {}),
          ...(face ? { face } : {}),
        });
        return {
          appearance: next,
          appearanceExtras: extras,
          appearanceWarnings: warnings,
        };
      }),

    // Saved presets carry intentional clothing — apply components AND face,
    // clear transient import warnings.
    applyPreset: (appearance, extras) => {
      const face = extrasToFace(extras);
      set({
        appearance: normalizeAppearance({
          ...(appearance ?? {}),
          ...(face ? { face } : {}),
        }),
        appearanceExtras: extras,
        appearanceWarnings: [],
      });
    },

    removeFace: () =>
      set((state) => ({
        appearance: state.appearance
          ? normalizeAppearance({
              ...(state.appearance.components
                ? { components: state.appearance.components }
                : {}),
              ...(state.appearance.props
                ? { props: state.appearance.props }
                : {}),
            })
          : null,
        appearanceExtras: null,
        appearanceWarnings: [],
      })),

    resetAppearance: () =>
      set({
        appearance: null,
        appearanceExtras: null,
        appearanceWarnings: [],
      }),

    saveAppearancePreset: (preset) =>
      set((state) => ({
        appearancePresets: [
          ...state.appearancePresets.filter(
            (p) => p.name.toLowerCase() !== preset.name.toLowerCase(),
          ),
          preset,
        ],
      })),

    deleteAppearancePreset: (name) =>
      set((state) => ({
        appearancePresets: state.appearancePresets.filter(
          (p) => p.name.toLowerCase() !== name.toLowerCase(),
        ),
      })),
  };
};

export const usePreview3dStore = create<Preview3dState>()(
  persist(createPreview3dState, {
    name: "atelier:preview3d-prefs",
    version: 2,
    storage: createJSONStorage(() => localStorage),
    partialize: (s): Preview3dPersisted => ({
      cameraPreset: s.cameraPreset,
      autoRotate: s.autoRotate,
      includePedBody: s.includePedBody,
      pose: s.pose,
      appearance: s.appearance,
      appearanceExtras: s.appearanceExtras,
      appearancePresets: s.appearancePresets,
    }),
    // v1 -> v2 (appearance fields): old blobs pass through unchanged — the
    // new fields are simply absent and the validating merge below defaults
    // them. Newly written blobs carry version 2. The Stufe-2 `face` block is a
    // PURELY ADDITIVE field inside the existing appearance object: persisted v2
    // blobs without it stay valid (sanitizeAppearance leaves face undefined),
    // so no version bump / migrate step is needed.
    migrate: (persisted) => persisted as Preview3dPersisted,
    // Validating merge — a stale/tampered blob must never yield an unknown
    // camera preset (the toolbar select would render empty). A persisted
    // pose the installation no longer serves is fine: setPoses drops it
    // once the live list arrives, and the 422 handler falls back to the
    // bind pose. includePedBody without a GTA path stays inert thanks to
    // the gtaPathReady guard in the preview pane. Appearance blobs are
    // structurally validated — unknown slots/anchors are dropped, so the
    // sidecar never sees an invalid request (it would answer 400).
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
        appearance: sanitizeAppearance(p.appearance),
        appearanceExtras: sanitizeAppearanceExtras(p.appearanceExtras),
        appearancePresets: sanitizeAppearancePresets(p.appearancePresets),
      };
    },
  }),
);
