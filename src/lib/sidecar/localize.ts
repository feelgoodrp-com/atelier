/**
 * Rendering the sidecar's language-neutral messages in the UI language.
 *
 * The sidecar (and the Tauri host) never send prose: every user-facing message
 * crosses the boundary as a machine `code` plus the values to interpolate. This
 * module is the single place that turns such a pair into a sentence, so adding
 * a new code only means adding one key to `errors.json` / `build.json`.
 *
 * Unknown codes fall through to the code itself rather than an empty string —
 * a sidecar newer than the app must still say *something* readable.
 */

import i18n from "@/lib/i18n";
import type {
  BuildProgressEvent,
  LocalizedMessage,
  ValidationFinding,
} from "./types";

type Params = Record<string, string> | null | undefined;

function render(key: string, params: Params, fallback: string): string {
  const text = i18n.t(key, { ...(params ?? {}), defaultValue: "" });
  return text || fallback;
}

/** `{ error, params }` of a non-2xx sidecar response, or a build's fail event. */
export function localizeApiError(code: string, params?: Params): string {
  return render(`errors:api.${code}`, params, code);
}

/** One build/import warning (`LocalizedMessage`). */
export function localizeWarning(warning: LocalizedMessage): string {
  return render(`errors:warnings.${warning.code}`, warning.params, warning.code);
}

/** One validation finding of POST /validate. */
export function localizeFinding(finding: ValidationFinding): string {
  return render(`errors:findings.${finding.code}`, finding.params, finding.code);
}

/** The detail line of one build progress tick. */
export function localizeProgress(event: BuildProgressEvent): string {
  return render(
    `build:progress.${event.messageCode}`,
    event.messageParams,
    event.messageCode,
  );
}
