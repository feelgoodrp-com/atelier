import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

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

export async function getApiUrl(): Promise<string> {
  const store = await getStore();
  return (await store.get<string>("apiUrl")) ?? DEFAULT_API_URL;
}

export async function setApiUrl(url: string): Promise<void> {
  const store = await getStore();
  await store.set("apiUrl", url.trim().replace(/\/+$/, "") || DEFAULT_API_URL);
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
