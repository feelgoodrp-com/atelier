/**
 * Texture preview cache: thumbnail PNG (as data URL) + texture metadata per
 * content hash. Entries are fetched once via the sidecar (POST /parse/ytd
 * with thumbnails { maxSize: 128 }) and kept for the app session — the key is
 * the sha256 of the .ytd file, so renames/moves never invalidate the cache.
 */

import { create } from "zustand";
import { parseYtd } from "@/lib/sidecar/client";
import type { TextureInfo } from "@/lib/sidecar/types";

export const THUMBNAIL_MAX_SIZE = 128;

export type PreviewStatus = "loading" | "ready" | "error";

export interface TexturePreview {
  status: PreviewStatus;
  /** data:image/png;base64,… of the first texture in the dictionary. */
  dataUrl: string | null;
  /** Metadata of every texture inside the .ytd (WxH, format, mips). */
  textures: TextureInfo[];
  /** German error message when status === "error". */
  error: string | null;
}

interface PreviewState {
  previews: Record<string, TexturePreview>;
  /**
   * Fetches thumbnail + metadata for `hash` from `absPath` once (no-op when
   * already loading/loaded). Fire-and-forget — components re-render via the
   * store subscription.
   */
  ensurePreview: (hash: string, absPath: string) => void;
  /** Drops a failed entry so the next ensurePreview retries. */
  retryPreview: (hash: string, absPath: string) => void;
  /** Drops a cached entry (file content changed, e.g. texture optimize). */
  invalidatePreview: (hash: string) => void;
}

export const usePreviewStore = create<PreviewState>((set, get) => {
  const fetchPreview = async (hash: string, absPath: string) => {
    set((state) => ({
      previews: {
        ...state.previews,
        [hash]: { status: "loading", dataUrl: null, textures: [], error: null },
      },
    }));
    try {
      const parsed = await parseYtd(absPath, {
        thumbnails: { maxSize: THUMBNAIL_MAX_SIZE },
      });
      const withThumb = parsed.textures.find((t) => t.thumbnailPngBase64);
      set((state) => ({
        previews: {
          ...state.previews,
          [hash]: {
            status: "ready",
            dataUrl: withThumb?.thumbnailPngBase64
              ? `data:image/png;base64,${withThumb.thumbnailPngBase64}`
              : null,
            textures: parsed.textures,
            error: null,
          },
        },
      }));
    } catch (e) {
      set((state) => ({
        previews: {
          ...state.previews,
          [hash]: {
            status: "error",
            dataUrl: null,
            textures: [],
            error: e instanceof Error ? e.message : String(e),
          },
        },
      }));
    }
  };

  return {
    previews: {},

    ensurePreview: (hash, absPath) => {
      if (get().previews[hash]) return;
      void fetchPreview(hash, absPath);
    },

    retryPreview: (hash, absPath) => {
      void fetchPreview(hash, absPath);
    },

    invalidatePreview: (hash) =>
      set((state) => {
        if (!(hash in state.previews)) return state;
        const previews = { ...state.previews };
        delete previews[hash];
        return { previews };
      }),
  };
});
