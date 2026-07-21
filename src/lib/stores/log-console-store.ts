/**
 * Live log console state. The console lives in its OWN window (label "logs",
 * opened via the `open_log_window` command). Entries come from the Rust
 * tracing pipeline: history via `get_log_buffer`, live updates via the
 * "log://entry" event — forwarding is enabled only while the window is open.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface LogEntry {
  ts: number;
  level: string; // TRACE | DEBUG | INFO | WARN | ERROR
  target: string;
  message: string;
}

export const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Client-side cap — older entries fall off the top. */
const MAX_ENTRIES = 2000;

interface LogConsoleState {
  /** Feature switch (Settings) — shows the toggle button in the top bar. */
  enabled: boolean;
  entries: LogEntry[];
  /** Minimum level shown (filtering is display-only). */
  minLevel: LogLevel;
  search: string;
  autoScroll: boolean;
  /**
   * Rewrite log lines into plain language (see lib/log-humanize.ts) and hide
   * pure plumbing. On by default — the raw view is the expert mode.
   */
  plainLanguage: boolean;

  setEnabled: (enabled: boolean) => void;
  setMinLevel: (level: LogLevel) => void;
  setSearch: (search: string) => void;
  setAutoScroll: (autoScroll: boolean) => void;
  setPlainLanguage: (plain: boolean) => void;
  clear: () => void;
}

export const useLogConsoleStore = create<LogConsoleState>((set) => ({
  enabled: false,
  entries: [],
  minLevel: "DEBUG",
  search: "",
  autoScroll: true,
  plainLanguage: true,

  setEnabled: (enabled) => set({ enabled }),
  setMinLevel: (minLevel) => set({ minLevel }),
  setSearch: (search) => set({ search }),
  setAutoScroll: (autoScroll) => set({ autoScroll }),
  setPlainLanguage: (plainLanguage) => set({ plainLanguage }),
  clear: () => set({ entries: [] }),
}));

/** Opens (or focuses) the dedicated log window. */
export function openLogWindow(): void {
  void invoke("open_log_window").catch(() => {});
}

let unlisten: UnlistenFn | null = null;

/** Called by the log WINDOW on mount: seed history + subscribe to the stream. */
export async function startLogStream(): Promise<void> {
  try {
    const history = await invoke<LogEntry[]>("get_log_buffer");
    useLogConsoleStore.setState({ entries: history.slice(-MAX_ENTRIES) });
    unlisten = await listen<LogEntry>("log://entry", (event) => {
      useLogConsoleStore.setState((state) => {
        const entries =
          state.entries.length >= MAX_ENTRIES
            ? [...state.entries.slice(-MAX_ENTRIES + 1), event.payload]
            : [...state.entries, event.payload];
        return { entries };
      });
    });
    await invoke("set_log_stream", { enabled: true });
  } catch {
    // No Tauri bridge (browser dev) — console stays empty.
  }
}

/** Called by the log WINDOW on unmount/close. */
export async function stopLogStream(): Promise<void> {
  try {
    await invoke("set_log_stream", { enabled: false });
  } catch {
    /* ignore */
  }
  unlisten?.();
  unlisten = null;
}

export function levelRank(level: string): number {
  const index = LOG_LEVELS.indexOf(level.toUpperCase() as LogLevel);
  return index === -1 ? 2 : index;
}
