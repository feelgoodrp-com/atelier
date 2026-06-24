/**
 * User preferences that aren't per-project: the default texture-optimize format
 * and whether imports auto-optimize. Loaded once on startup from settings.json
 * (via {@link loadPreferences}) and persisted on every change. Kept in zustand
 * so the settings UI, the optimize dialogs and the import wizard stay in sync.
 */

import { create } from "zustand";
import {
  getDefaultTextureFormat,
  getOptimizeOnImport,
  setDefaultTextureFormat as persistDefaultTextureFormat,
  setOptimizeOnImport as persistOptimizeOnImport,
} from "@/lib/settings";
import type { FormatChoice } from "@/lib/project/texture-optimize";

interface PreferencesState {
  /** Pre-selected format in the optimize dialogs + used by optimize-on-import. */
  defaultTextureFormat: FormatChoice;
  /** Run an optimize over every imported texture right after an import. */
  optimizeOnImport: boolean;
  /** True once the persisted values have been read at startup. */
  loaded: boolean;

  setDefaultTextureFormat: (format: FormatChoice) => void;
  setOptimizeOnImport: (enabled: boolean) => void;
  /** Reads the persisted values into the store (called once at startup). */
  load: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  defaultTextureFormat: "keep",
  optimizeOnImport: false,
  loaded: false,

  setDefaultTextureFormat: (defaultTextureFormat) => {
    set({ defaultTextureFormat });
    void persistDefaultTextureFormat(defaultTextureFormat).catch(() => {});
  },

  setOptimizeOnImport: (optimizeOnImport) => {
    set({ optimizeOnImport });
    void persistOptimizeOnImport(optimizeOnImport).catch(() => {});
  },

  load: async () => {
    const [defaultTextureFormat, optimizeOnImport] = await Promise.all([
      getDefaultTextureFormat(),
      getOptimizeOnImport(),
    ]);
    set({ defaultTextureFormat, optimizeOnImport, loaded: true });
  },
}));

/** Loads the persisted preferences at startup (no-op-safe outside Tauri). */
export function loadPreferences(): void {
  void usePreferencesStore
    .getState()
    .load()
    .catch(() => {});
}
