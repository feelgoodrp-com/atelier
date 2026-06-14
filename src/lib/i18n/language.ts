/**
 * Applying + persisting the UI language. The choice lives in the Tauri settings
 * store (settings.ts); on startup `loadStoredLanguage()` applies it, defaulting
 * to English when nothing is stored or the bridge is unavailable (browser dev).
 */

import i18n, { SUPPORTED_LANGUAGES, type LanguageCode } from "./index";
import { getLanguage, setLanguage } from "../settings";

export function isSupportedLanguage(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

/** Read the persisted language and apply it. Called once at startup. */
export async function loadStoredLanguage(): Promise<void> {
  try {
    const stored = await getLanguage();
    if (stored && isSupportedLanguage(stored) && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    // No store (browser dev) — keep the default.
  }
}

/** Switch the language and persist the choice. */
export async function changeLanguage(code: LanguageCode): Promise<void> {
  await i18n.changeLanguage(code);
  try {
    await setLanguage(code);
  } catch {
    // Persistence is best-effort.
  }
}
