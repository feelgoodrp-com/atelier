/** Small display formatters shared by the workbench UI. */

import i18n from "@/lib/i18n";

/** "gerade eben", "vor 42 s", "vor 5 min", "vor 2 h", else date. */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 10) return "gerade eben";
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  return new Date(time).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** 1536 → "1.5 KB" (number format follows the app language, 1 fraction digit). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} ${unit}`;
}

/** Last path segment ("C:\a\b\jbib_000_u.ydd" → "jbib_000_u.ydd"). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
