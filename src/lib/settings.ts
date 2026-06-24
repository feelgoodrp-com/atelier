import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { FormatChoice } from "@/lib/project/texture-optimize";
import type { BuildTarget } from "@/lib/sidecar/types";

export const DEFAULT_API_URL = "http://127.0.0.1:3095";

const STORE_FILE = "settings.json";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, {
      autoSave: true,
      defaults: { apiUrl: DEFAULT_API_URL },
    });
  }
  return storePromise;
}

export async function getGtaPath(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>("gtaPath")) ?? null;
}

export async function setGtaPath(path: string | null): Promise<void> {
  const store = await getStore();
  if (path === null) {
    await store.delete("gtaPath");
  } else {
    await store.set("gtaPath", path);
  }
}

/**
 * Whether the first-run setup wizard has been completed. Existing installs
 * (a GTA path is already configured) are treated as done so an update never
 * re-shows the wizard.
 */
export async function getOnboardingDone(): Promise<boolean> {
  const store = await getStore();
  if ((await store.get<boolean>("onboardingDone")) === true) return true;
  return (await store.get<string>("gtaPath")) != null;
}

export async function setOnboardingDone(done: boolean): Promise<void> {
  const store = await getStore();
  await store.set("onboardingDone", done);
}

/** Feature switch for the live log console (Settings → Logs). */
export async function getLogConsoleEnabled(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("logConsoleEnabled")) ?? false;
}

export async function setLogConsoleEnabled(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("logConsoleEnabled", enabled);
}

/** UI language code (e.g. "en", "de"). Null = not chosen yet (defaults to English). */
export async function getLanguage(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>("language")) ?? null;
}

export async function setLanguage(code: string): Promise<void> {
  const store = await getStore();
  await store.set("language", code);
}

export async function getApiUrl(): Promise<string> {
  const store = await getStore();
  return (await store.get<string>("apiUrl")) ?? DEFAULT_API_URL;
}

export async function setApiUrl(url: string): Promise<void> {
  const store = await getStore();
  await store.set("apiUrl", url.trim().replace(/\/+$/, "") || DEFAULT_API_URL);
}

/**
 * How the app runs:
 *  - "cloud": Discord login + the atelier-api team backend (sync, presence, …)
 *  - "solo":  fully local — no backend, no login; every cloud feature is hidden.
 * Defaults to "cloud" so existing installs keep their behavior; new users pick
 * during onboarding and can switch any time in Settings.
 */
export type AppMode = "solo" | "cloud";

export async function getAppMode(): Promise<AppMode> {
  const store = await getStore();
  return (await store.get<AppMode>("appMode")) === "solo" ? "solo" : "cloud";
}

export async function setAppMode(mode: AppMode): Promise<void> {
  const store = await getStore();
  await store.set("appMode", mode);
}

/** Last output folder used by the build dialog (remembered across sessions). */
export async function getLastBuildOutDir(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>("lastBuildOutDir")) ?? null;
}

export async function setLastBuildOutDir(path: string): Promise<void> {
  const store = await getStore();
  await store.set("lastBuildOutDir", path);
}

// ---------------------------------------------------------------------------
// Refresh token — OS keychain (Windows Credential Manager) via Rust commands.
// Falls back to the plugin store only when the Tauri bridge is unavailable
// (plain-browser dev). Tokens persisted by older builds in settings.json are
// migrated into the keychain on first read and removed from the store.
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_KEY = "refreshToken";

async function deleteStoreToken(): Promise<void> {
  try {
    const store = await getStore();
    await store.delete(REFRESH_TOKEN_KEY);
  } catch {
    // store unavailable — nothing to clean up
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    const fromKeychain = await invoke<string | null>("secret_get", { key: REFRESH_TOKEN_KEY });
    if (fromKeychain) return fromKeychain;

    // One-time migration: older builds kept the token in plain settings.json.
    const store = await getStore();
    const legacy = (await store.get<string>(REFRESH_TOKEN_KEY)) ?? null;
    if (legacy) {
      await invoke("secret_set", { key: REFRESH_TOKEN_KEY, value: legacy });
      await deleteStoreToken();
      return legacy;
    }
    return null;
  } catch {
    // No Tauri bridge (browser dev) — plugin-store fallback.
    const store = await getStore();
    return (await store.get<string>(REFRESH_TOKEN_KEY)) ?? null;
  }
}

export async function setRefreshToken(token: string | null): Promise<void> {
  try {
    if (token === null) {
      await invoke("secret_delete", { key: REFRESH_TOKEN_KEY });
    } else {
      await invoke("secret_set", { key: REFRESH_TOKEN_KEY, value: token });
    }
    // Never leave a (stale) plain-text copy behind.
    await deleteStoreToken();
  } catch {
    const store = await getStore();
    if (token === null) {
      await store.delete(REFRESH_TOKEN_KEY);
    } else {
      await store.set(REFRESH_TOKEN_KEY, token);
    }
  }
}

// ---------------------------------------------------------------------------
// Texture-optimize preferences (Settings → General). The default format is the
// one the optimize dialogs pre-select; optimizeOnImport runs an optimize over
// every imported texture with that format right after an import wizard run.
// ---------------------------------------------------------------------------

const TEXTURE_FORMATS: readonly FormatChoice[] = ["keep", "BC1", "BC3", "BC7", "RGBA8888"];

export async function getDefaultTextureFormat(): Promise<FormatChoice> {
  const store = await getStore();
  const value = await store.get<string>("defaultTextureFormat");
  return TEXTURE_FORMATS.includes(value as FormatChoice) ? (value as FormatChoice) : "keep";
}

export async function setDefaultTextureFormat(format: FormatChoice): Promise<void> {
  const store = await getStore();
  await store.set("defaultTextureFormat", format);
}

export async function getOptimizeOnImport(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("optimizeOnImport")) ?? false;
}

export async function setOptimizeOnImport(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("optimizeOnImport", enabled);
}

/** Longest-edge cap applied by optimize-on-import (one of {@link IMPORT_MAX_DIMENSIONS}). */
export const IMPORT_MAX_DIMENSIONS = [512, 1024, 2048, 4096] as const;
export type ImportMaxDimension = (typeof IMPORT_MAX_DIMENSIONS)[number];

export async function getImportMaxDimension(): Promise<ImportMaxDimension> {
  const store = await getStore();
  const value = await store.get<number>("importMaxDimension");
  return IMPORT_MAX_DIMENSIONS.includes(value as ImportMaxDimension)
    ? (value as ImportMaxDimension)
    : 2048;
}

export async function setImportMaxDimension(value: ImportMaxDimension): Promise<void> {
  const store = await getStore();
  await store.set("importMaxDimension", value);
}

/** Whether the app checks for updates on startup (Settings → Preferences). */
export async function getAutoCheckUpdates(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("autoCheckUpdates")) ?? true;
}

export async function setAutoCheckUpdates(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("autoCheckUpdates", enabled);
}

/** Install a found startup update automatically instead of only notifying. */
export async function getAutoInstallUpdates(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("autoInstallUpdates")) ?? false;
}

export async function setAutoInstallUpdates(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("autoInstallUpdates", enabled);
}

/** Default export target pre-selected in the build dialog. */
const BUILD_TARGETS: readonly BuildTarget[] = ["fivem", "singleplayer", "ragemp", "altv"];

export async function getDefaultExportTarget(): Promise<BuildTarget> {
  const store = await getStore();
  const value = await store.get<string>("defaultExportTarget");
  return BUILD_TARGETS.includes(value as BuildTarget) ? (value as BuildTarget) : "fivem";
}

export async function setDefaultExportTarget(target: BuildTarget): Promise<void> {
  const store = await getStore();
  await store.set("defaultExportTarget", target);
}

/** Folder the new-project pickers open in by default (null = OS default). */
export async function getDefaultProjectFolder(): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>("defaultProjectFolder")) ?? null;
}

export async function setDefaultProjectFolder(path: string | null): Promise<void> {
  const store = await getStore();
  if (path === null) await store.delete("defaultProjectFolder");
  else await store.set("defaultProjectFolder", path);
}

/** Ask for confirmation before deleting drawables (default on). */
export async function getConfirmBeforeDelete(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("confirmBeforeDelete")) ?? true;
}

export async function setConfirmBeforeDelete(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("confirmBeforeDelete", enabled);
}

/** Open the 3D preview automatically when a drawable is selected. */
export async function getAutoOpenPreview(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("autoOpenPreview")) ?? false;
}

export async function setAutoOpenPreview(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("autoOpenPreview", enabled);
}

/** Recovery autosave on/off + how often it force-saves at most. */
export const AUTOSAVE_INTERVALS = [30, 60, 120, 300] as const;
export type AutosaveInterval = (typeof AUTOSAVE_INTERVALS)[number];

export async function getAutosaveEnabled(): Promise<boolean> {
  const store = await getStore();
  return (await store.get<boolean>("autosaveEnabled")) ?? true;
}

export async function setAutosaveEnabled(enabled: boolean): Promise<void> {
  const store = await getStore();
  await store.set("autosaveEnabled", enabled);
}

export async function getAutosaveInterval(): Promise<AutosaveInterval> {
  const store = await getStore();
  const value = await store.get<number>("autosaveIntervalSec");
  return AUTOSAVE_INTERVALS.includes(value as AutosaveInterval)
    ? (value as AutosaveInterval)
    : 60;
}

export async function setAutosaveInterval(value: AutosaveInterval): Promise<void> {
  const store = await getStore();
  await store.set("autosaveIntervalSec", value);
}
