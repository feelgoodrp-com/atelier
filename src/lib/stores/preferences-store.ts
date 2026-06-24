/**
 * User preferences that aren't per-project (Settings → Preferences). Loaded
 * once on startup from settings.json (via {@link loadPreferences}) and persisted
 * on every change. Kept in zustand so the settings UI, the optimize dialogs, the
 * import wizard and the startup update-check stay in sync.
 */

import { create } from "zustand";
import {
  getAutoCheckUpdates,
  getDefaultTextureFormat,
  getImportMaxDimension,
  getOptimizeOnImport,
  setAutoCheckUpdates as persistAutoCheckUpdates,
  setDefaultTextureFormat as persistDefaultTextureFormat,
  setImportMaxDimension as persistImportMaxDimension,
  setOptimizeOnImport as persistOptimizeOnImport,
  type ImportMaxDimension,
} from "@/lib/settings";
import type { FormatChoice } from "@/lib/project/texture-optimize";

interface PreferencesState {
  /** Pre-selected format in the optimize dialogs + used by optimize-on-import. */
  defaultTextureFormat: FormatChoice;
  /** Run an optimize over every imported texture right after an import. */
  optimizeOnImport: boolean;
  /** Longest-edge cap optimize-on-import applies. */
  importMaxDimension: ImportMaxDimension;
  /** Check for updates on startup. */
  autoCheckUpdates: boolean;
  /** True once the persisted values have been read at startup. */
  loaded: boolean;

  setDefaultTextureFormat: (format: FormatChoice) => void;
  setOptimizeOnImport: (enabled: boolean) => void;
  setImportMaxDimension: (value: ImportMaxDimension) => void;
  setAutoCheckUpdates: (enabled: boolean) => void;
  /** Reads the persisted values into the store (called once at startup). */
  load: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  defaultTextureFormat: "keep",
  optimizeOnImport: false,
  importMaxDimension: 2048,
  autoCheckUpdates: true,
  loaded: false,

  setDefaultTextureFormat: (defaultTextureFormat) => {
    set({ defaultTextureFormat });
    void persistDefaultTextureFormat(defaultTextureFormat).catch(() => {});
  },

  setOptimizeOnImport: (optimizeOnImport) => {
    set({ optimizeOnImport });
    void persistOptimizeOnImport(optimizeOnImport).catch(() => {});
  },

  setImportMaxDimension: (importMaxDimension) => {
    set({ importMaxDimension });
    void persistImportMaxDimension(importMaxDimension).catch(() => {});
  },

  setAutoCheckUpdates: (autoCheckUpdates) => {
    set({ autoCheckUpdates });
    void persistAutoCheckUpdates(autoCheckUpdates).catch(() => {});
  },

  load: async () => {
    const [defaultTextureFormat, optimizeOnImport, importMaxDimension, autoCheckUpdates] =
      await Promise.all([
        getDefaultTextureFormat(),
        getOptimizeOnImport(),
        getImportMaxDimension(),
        getAutoCheckUpdates(),
      ]);
    set({
      defaultTextureFormat,
      optimizeOnImport,
      importMaxDimension,
      autoCheckUpdates,
      loaded: true,
    });
  },
}));

/** Loads the persisted preferences at startup (no-op-safe outside Tauri). */
export function loadPreferences(): void {
  void usePreferencesStore
    .getState()
    .load()
    .catch(() => {});
}
