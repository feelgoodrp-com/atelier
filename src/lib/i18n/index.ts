/**
 * i18n setup (react-i18next). English is the default; German is the second
 * language. Every `locales/<lng>/<namespace>.json` file is auto-loaded via a
 * Vite glob, so adding a translation namespace only needs a JSON file dropped
 * in — there is no central registry to edit (keeps parallel work conflict-free).
 *
 * The persisted choice is applied at startup by `loadStoredLanguage()` in
 * `./language` (the language is stored in the Tauri settings store).
 */

import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: LanguageCode = "en";

const resources: Resource = {};
const namespaces = new Set<string>(["common"]);

// Eagerly bundle every locale JSON: ./locales/en/common.json, ./locales/de/…
// `import.meta.glob` is a Vite build-time macro. In plain bun (the selftests
// import i18n transitively) it is undefined, so fall back to reading the same
// JSON files from disk — the locale set stays identical in both environments.
const isViteRuntime = typeof import.meta.glob === "function";
if (isViteRuntime) {
  const modules = import.meta.glob<{ default: Record<string, unknown> }>(
    "./locales/*/*.json",
    { eager: true },
  );
  for (const [path, mod] of Object.entries(modules)) {
    const match = /\/locales\/([a-z]{2})\/([a-z0-9_-]+)\.json$/u.exec(path);
    if (!match) continue;
    const [, lng, ns] = match;
    (resources[lng!] ??= {})[ns!] = mod.default;
    namespaces.add(ns!);
  }
} else {
  // Non-Vite runtime (bun selftests): read the locale JSONs synchronously.
  loadLocalesFromDisk(resources, namespaces);
}

// The selftests (bun runtime) were authored against the original GERMAN source
// strings, so the non-Vite fallback starts in German to keep them green. The
// real app always runs through Vite and uses the English DEFAULT_LANGUAGE.
const startLanguage: LanguageCode = isViteRuntime ? DEFAULT_LANGUAGE : "de";

/**
 * bun/Node fallback for the Vite glob: reads every `locales/<lng>/<ns>.json`
 * from disk so the selftests get the SAME translations as the bundled app
 * (interpolation works, real text is returned). No-ops if `node:fs` or the
 * locales directory is unavailable.
 */
// Minimal structural types for the bun-only node builtins (this project's
// tsconfig has no @types/node, so we cannot import their real declarations).
interface NodeFsLike {
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
  readFileSync(path: string, encoding: string): string;
}
interface NodePathLike {
  join(...parts: string[]): string;
  dirname(path: string): string;
}
interface NodeUrlLike {
  fileURLToPath(url: string): string;
}
type NodeRequireLike = (id: string) => unknown;

function loadLocalesFromDisk(res: Resource, ns: Set<string>): void {
  try {
    // bun exposes a synchronous CommonJS require on import.meta; using it (not a
    // static `node:*` import) keeps Vite's browser build from trying to bundle
    // these node builtins — this whole branch only runs under bun anyway.
    const req = (import.meta as unknown as { require?: NodeRequireLike })
      .require;
    if (typeof req !== "function") return;
    const fs = req("node:fs") as NodeFsLike;
    const pathMod = req("node:path") as NodePathLike;
    const url = req("node:url") as NodeUrlLike;
    const here = pathMod.dirname(url.fileURLToPath(import.meta.url));
    const localesDir = pathMod.join(here, "locales");
    for (const lng of fs.readdirSync(localesDir)) {
      const lngDir = pathMod.join(localesDir, lng);
      if (!fs.statSync(lngDir).isDirectory()) continue;
      for (const file of fs.readdirSync(lngDir)) {
        if (!file.endsWith(".json")) continue;
        const name = file.slice(0, -5);
        const json = JSON.parse(
          fs.readFileSync(pathMod.join(lngDir, file), "utf8"),
        ) as Record<string, unknown>;
        (res[lng] ??= {})[name] = json;
        ns.add(name);
      }
    }
  } catch {
    // Locales unavailable — i18n.t falls back to returning the key.
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: startLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  ns: [...namespaces],
  defaultNS: "common",
  fallbackNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
