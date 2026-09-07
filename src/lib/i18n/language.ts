/**
 * Applying + persisting the UI language. The choice lives in the Tauri settings
 * store (settings.ts); on startup `loadStoredLanguage()` applies it, defaulting
 * to English when nothing is stored or the bridge is unavailable (browser dev).
 */

import { emit, listen } from "@tauri-apps/api/event";
import i18n, { SUPPORTED_LANGUAGES, type LanguageCode } from "./index";
import { getLanguage, setLanguage } from "../settings";

/** Broadcast so every open window switches together, not just the active one. */
const LANGUAGE_CHANGED_EVENT = "atelier://language-changed";

export function isSupportedLanguage(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

/**
 * Read the persisted language, apply it, and subscribe to the switch broadcast.
 * Called once per WINDOW at startup — each Tauri webview runs its own JS
 * context with its own i18next instance, so without the subscription the log
 * window would keep the language it booted with while the main window changed.
 */
export async function loadStoredLanguage(): Promise<void> {
  try {
    const stored = await getLanguage();
    if (stored && isSupportedLanguage(stored) && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    // No store (browser dev) — keep the default.
  }
  try {
    await listen<string>(LANGUAGE_CHANGED_EVENT, (event) => {
      const code = event.payload;
      if (isSupportedLanguage(code) && code !== i18n.language) {
        void i18n.changeLanguage(code);
      }
    });
  } catch {
    // No Tauri bridge (browser dev) — this window is the only one anyway.
  }
}

/** Switch the language, persist the choice, and tell the other windows. */
export async function changeLanguage(code: LanguageCode): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    await setLanguage(code);
  } catch {
    // Persistence is best-effort.
  }
  try {
    await emit(LANGUAGE_CHANGED_EVENT, code);
  } catch {
    // No Tauri bridge — nothing else to notify.
  }
}
