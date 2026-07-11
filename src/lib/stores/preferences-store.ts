/**
 * User preferences that aren't per-project (Settings → Preferences). Loaded
 * once on startup from settings.json (via {@link loadPreferences}) and persisted
 * on every change. Kept in zustand so the settings UI and every consumer (the
 * optimize dialogs, import wizard, build dialog, autosave, update check, …) stay
 * in sync.
 */

import { create } from "zustand";
import {
  getAutoCheckUpdates,
  getAutoInstallUpdates,
  getAutoOpenPreview,
  getAutosaveEnabled,
  getAutosaveInterval,
  getConfirmBeforeDelete,
  getDefaultExportTarget,
  getDefaultProjectFolder,
  getDefaultTextureFormat,
  getImportMaxDimension,
  getOptimizeOnImport,
  getSkipDuplicatesOnImport,
  setAutoCheckUpdates as persistAutoCheckUpdates,
  setAutoInstallUpdates as persistAutoInstallUpdates,
  setAutoOpenPreview as persistAutoOpenPreview,
  setAutosaveEnabled as persistAutosaveEnabled,
  setAutosaveInterval as persistAutosaveInterval,
  setConfirmBeforeDelete as persistConfirmBeforeDelete,
  setDefaultExportTarget as persistDefaultExportTarget,
  setDefaultProjectFolder as persistDefaultProjectFolder,
  setDefaultTextureFormat as persistDefaultTextureFormat,
  setImportMaxDimension as persistImportMaxDimension,
  setOptimizeOnImport as persistOptimizeOnImport,
  setSkipDuplicatesOnImport as persistSkipDuplicatesOnImport,
  type AutosaveInterval,
  type ImportMaxDimension,
} from "@/lib/settings";
import type { FormatChoice } from "@/lib/project/texture-optimize";
import type { BuildTarget } from "@/lib/sidecar/types";

interface PreferencesState {
  // Texture optimization
  defaultTextureFormat: FormatChoice;
  optimizeOnImport: boolean;
  skipDuplicatesOnImport: boolean;
  importMaxDimension: ImportMaxDimension;
  // Updates
  autoCheckUpdates: boolean;
  autoInstallUpdates: boolean;
  // Build / projects
  defaultExportTarget: BuildTarget;
  defaultProjectFolder: string | null;
  // Editor behavior
  confirmBeforeDelete: boolean;
  autoOpenPreview: boolean;
  autosaveEnabled: boolean;
  autosaveInterval: AutosaveInterval;
  /** True once the persisted values have been read at startup. */
  loaded: boolean;

  setDefaultTextureFormat: (format: FormatChoice) => void;
  setOptimizeOnImport: (enabled: boolean) => void;
  setSkipDuplicatesOnImport: (enabled: boolean) => void;
  setImportMaxDimension: (value: ImportMaxDimension) => void;
  setAutoCheckUpdates: (enabled: boolean) => void;
  setAutoInstallUpdates: (enabled: boolean) => void;
  setDefaultExportTarget: (target: BuildTarget) => void;
  setDefaultProjectFolder: (path: string | null) => void;
  setConfirmBeforeDelete: (enabled: boolean) => void;
  setAutoOpenPreview: (enabled: boolean) => void;
  setAutosaveEnabled: (enabled: boolean) => void;
  setAutosaveInterval: (value: AutosaveInterval) => void;
  /** Reads the persisted values into the store (called once at startup). */
  load: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  defaultTextureFormat: "keep",
  optimizeOnImport: false,
  skipDuplicatesOnImport: false,
  importMaxDimension: 2048,
  autoCheckUpdates: true,
  autoInstallUpdates: false,
  defaultExportTarget: "fivem",
  defaultProjectFolder: null,
  confirmBeforeDelete: true,
  autoOpenPreview: false,
  autosaveEnabled: true,
  autosaveInterval: 60,
  loaded: false,

  setDefaultTextureFormat: (defaultTextureFormat) => {
    set({ defaultTextureFormat });
    void persistDefaultTextureFormat(defaultTextureFormat).catch(() => {});
  },
  setOptimizeOnImport: (optimizeOnImport) => {
    set({ optimizeOnImport });
    void persistOptimizeOnImport(optimizeOnImport).catch(() => {});
  },
  setSkipDuplicatesOnImport: (skipDuplicatesOnImport) => {
    set({ skipDuplicatesOnImport });
    void persistSkipDuplicatesOnImport(skipDuplicatesOnImport).catch(() => {});
  },
  setImportMaxDimension: (importMaxDimension) => {
    set({ importMaxDimension });
    void persistImportMaxDimension(importMaxDimension).catch(() => {});
  },
  setAutoCheckUpdates: (autoCheckUpdates) => {
    set({ autoCheckUpdates });
    void persistAutoCheckUpdates(autoCheckUpdates).catch(() => {});
  },
  setAutoInstallUpdates: (autoInstallUpdates) => {
    set({ autoInstallUpdates });
    void persistAutoInstallUpdates(autoInstallUpdates).catch(() => {});
  },
  setDefaultExportTarget: (defaultExportTarget) => {
    set({ defaultExportTarget });
    void persistDefaultExportTarget(defaultExportTarget).catch(() => {});
  },
  setDefaultProjectFolder: (defaultProjectFolder) => {
    set({ defaultProjectFolder });
    void persistDefaultProjectFolder(defaultProjectFolder).catch(() => {});
  },
  setConfirmBeforeDelete: (confirmBeforeDelete) => {
    set({ confirmBeforeDelete });
    void persistConfirmBeforeDelete(confirmBeforeDelete).catch(() => {});
  },
  setAutoOpenPreview: (autoOpenPreview) => {
    set({ autoOpenPreview });
    void persistAutoOpenPreview(autoOpenPreview).catch(() => {});
  },
  setAutosaveEnabled: (autosaveEnabled) => {
    set({ autosaveEnabled });
    void persistAutosaveEnabled(autosaveEnabled).catch(() => {});
  },
  setAutosaveInterval: (autosaveInterval) => {
    set({ autosaveInterval });
    void persistAutosaveInterval(autosaveInterval).catch(() => {});
  },

  load: async () => {
    const [
      defaultTextureFormat,
      optimizeOnImport,
      skipDuplicatesOnImport,
      importMaxDimension,
      autoCheckUpdates,
      autoInstallUpdates,
      defaultExportTarget,
      defaultProjectFolder,
      confirmBeforeDelete,
      autoOpenPreview,
      autosaveEnabled,
      autosaveInterval,
    ] = await Promise.all([
      getDefaultTextureFormat(),
      getOptimizeOnImport(),
      getSkipDuplicatesOnImport(),
      getImportMaxDimension(),
      getAutoCheckUpdates(),
      getAutoInstallUpdates(),
      getDefaultExportTarget(),
      getDefaultProjectFolder(),
      getConfirmBeforeDelete(),
      getAutoOpenPreview(),
      getAutosaveEnabled(),
      getAutosaveInterval(),
    ]);
    set({
      defaultTextureFormat,
      optimizeOnImport,
      skipDuplicatesOnImport,
      importMaxDimension,
      autoCheckUpdates,
      autoInstallUpdates,
      defaultExportTarget,
      defaultProjectFolder,
      confirmBeforeDelete,
      autoOpenPreview,
      autosaveEnabled,
      autosaveInterval,
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
