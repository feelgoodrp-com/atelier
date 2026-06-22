import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { log } from "@/lib/log";

/**
 * Auto-updater state machine (Tauri `plugin-updater`).
 *
 *   idle ─check()─▶ checking ─┬─▶ upToDate
 *                             └─▶ available ─install()─▶ downloading ─▶ relaunch
 *
 * `check()` talks to the GitHub-releases `latest.json` endpoint configured in
 * tauri.conf.json; the downloaded installer is verified against the bundled
 * public key by the Rust plugin before it ever runs. Everything no-ops outside
 * the Tauri runtime (plain-browser dev / selftests) so nothing throws there.
 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "ready"
  | "error";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

interface UpdateState {
  phase: UpdatePhase;
  available: AvailableUpdate | null;
  /** Bytes downloaded / total, while phase === "downloading". */
  downloaded: number;
  contentLength: number | null;
  error: string | null;
  /** Live Update handle kept between check() and install(). Not for the UI. */
  _handle: Update | null;

  /**
   * Query the update endpoint. `notify` shows a toast with a one-click install
   * action when an update is found (used by the silent startup check).
   */
  check: (opts?: { notify?: boolean }) => Promise<void>;
  /** Download, verify, install the pending update, then relaunch. */
  install: () => Promise<void>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  available: null,
  downloaded: 0,
  contentLength: null,
  error: null,
  _handle: null,

  check: async ({ notify = false } = {}) => {
    // Outside Tauri there is no updater bridge — stay idle silently so dev and
    // the bun selftests never hit a thrown invoke.
    if (!isTauri()) return;
    // Don't re-check while a download is in flight.
    if (get().phase === "downloading") return;

    set({ phase: "checking", error: null });
    try {
      const update = await check();
      if (!update) {
        set({ phase: "upToDate", available: null, _handle: null });
        return;
      }
      const available: AvailableUpdate = {
        version: update.version,
        currentVersion: update.currentVersion,
        notes: update.body ?? null,
        date: update.date ?? null,
      };
      set({ phase: "available", available, _handle: update });
      log.info("update available", {
        version: update.version,
        current: update.currentVersion,
      });
      if (notify) {
        toast.info(i18n.t("settings:updates.toastTitle", { version: update.version }), {
          description: i18n.t("settings:updates.toastBody"),
          duration: 10000,
          action: {
            label: i18n.t("settings:updates.install"),
            onClick: () => void get().install(),
          },
        });
      }
    } catch (e) {
      log.error("update check failed", { error: errMsg(e) });
      set({ phase: "error", error: errMsg(e) });
    }
  },

  install: async () => {
    const update = get()._handle;
    if (!update) return;
    if (get().phase === "downloading") return;

    set({ phase: "downloading", downloaded: 0, contentLength: null, error: null });
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            set({ contentLength: event.data.contentLength ?? null, downloaded: 0 });
            break;
          case "Progress":
            set((s) => ({ downloaded: s.downloaded + event.data.chunkLength }));
            break;
          case "Finished":
            set({ phase: "ready" });
            break;
        }
      });
      log.info("update installed — relaunching");
      // NSIS (passive mode) has swapped the binaries; restart into the new
      // version. On Windows the installer may already be terminating us, so a
      // failure here is non-fatal — the next manual launch is up to date.
      await relaunch();
    } catch (e) {
      log.error("update install failed", { error: errMsg(e) });
      set({ phase: "error", error: errMsg(e) });
      toast.error(i18n.t("settings:updates.installFailed"), {
        description: errMsg(e),
      });
    }
  },
}));
