/**
 * Frontend logger that mirrors to the devtools console AND forwards into the
 * Rust tracing pipeline (target `webview`), so React logs end up in the same
 * rotating log files as the Rust/sidecar logs
 * (%LOCALAPPDATA%\com.feelgood.atelier\logs\atelier.YYYY-MM-DD.log).
 *
 * Usage: import { log } from "@/lib/log";
 *        log.info("Projekt geöffnet", { dirPath });
 */

import { invoke } from "@tauri-apps/api/core";

type LogLevel = "debug" | "info" | "warn" | "error";

function forward(level: LogLevel, message: string, context?: unknown): void {
  // Fire-and-forget; logging must never throw into app code (e.g. when
  // running in a plain browser without the Tauri bridge).
  void invoke("frontend_log", {
    level,
    message,
    context: context === undefined ? null : context,
  }).catch(() => {});
}

function entry(level: LogLevel) {
  return (message: string, context?: unknown): void => {
    const consoleFn =
      level === "debug" ? console.debug : level === "warn" ? console.warn : level === "error" ? console.error : console.info;
    if (context === undefined) consoleFn(message);
    else consoleFn(message, context);
    forward(level, message, context);
  };
}

export const log = {
  debug: entry("debug"),
  info: entry("info"),
  warn: entry("warn"),
  error: entry("error"),
};

/** Resolve the log directory path (for display in the settings screen). */
export async function getLogDir(): Promise<string | null> {
  try {
    return await invoke<string | null>("get_log_dir");
  } catch {
    return null;
  }
}
