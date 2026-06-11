/**
 * UI orchestration of cloud sync (push/pull/link dialogs of the workbench
 * header). The actual pipeline lives in lib/sync/pack-sync.ts; this store
 * only tracks busy/progress state, the 409 conflict and the confirm dialogs.
 */

import { create } from "zustand";
import { toast } from "sonner";
import {
  getServerBuild,
  startServerBuild,
  type ServerBuildStatus,
} from "@/lib/sync/api-client";
import {
  pullProject,
  pushProject,
  type SyncProgress,
} from "@/lib/sync/pack-sync";
import { useProjectStore } from "@/lib/stores/project-store";

export type SyncBusy = "push" | "pull" | null;

/**
 * Server-build hook-in after a push: "offer" shows the subtle
 * "Server-Build anstoßen" action in the Cloud section; once requested, the
 * WS "build-status" broadcasts drive the status until done/error (toast).
 */
export interface ServerBuildState {
  packId: string;
  revision: number;
  /** Set once the build was requested (matches the WS broadcasts). */
  buildId: string | null;
  status: "offer" | ServerBuildStatus;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True when local state has edits the cloud has not seen yet. */
export function hasUnsyncedLocalChanges(): boolean {
  const { project, dirty } = useProjectStore.getState();
  if (!project) return false;
  if (dirty) return true;
  const { lastSyncedAt } = project.sync;
  if (!lastSyncedAt) return true; // linked but never pushed/pulled
  return Date.parse(project.updatedAt) > Date.parse(lastSyncedAt);
}

interface SyncState {
  busy: SyncBusy;
  /** Live progress of the running push/pull (drives the progress dialog). */
  progress: SyncProgress | null;
  linkDialogOpen: boolean;
  /** "Neueste Version laden?" confirm (only when local changes would be lost). */
  pullConfirmOpen: boolean;
  /** Non-null opens the 409 conflict dialog (value = current remote head). */
  conflictHeadRevision: number | null;

  /** Non-null after a successful push (offer) / while a server build runs. */
  serverBuild: ServerBuildState | null;

  setLinkDialogOpen: (open: boolean) => void;
  setPullConfirmOpen: (open: boolean) => void;
  dismissConflict: () => void;
  /** Uploads the local state; pass the remote head to force after a conflict. */
  push: (baseRevisionOverride?: number) => Promise<void>;
  /** Loads the remote head; asks for confirmation when local changes exist. */
  pull: (opts?: { force?: boolean }) => Promise<void>;
  /** "Server-Build anstoßen" — requests the build of the offered revision. */
  requestServerBuild: () => Promise<void>;
  /** WS "build-status" hook (lib/sync/collab.ts). */
  applyServerBuildStatus: (buildId: string, status: ServerBuildStatus) => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  busy: null,
  progress: null,
  linkDialogOpen: false,
  pullConfirmOpen: false,
  conflictHeadRevision: null,
  serverBuild: null,

  setLinkDialogOpen: (linkDialogOpen) => set({ linkDialogOpen }),
  setPullConfirmOpen: (pullConfirmOpen) => set({ pullConfirmOpen }),
  dismissConflict: () => set({ conflictHeadRevision: null }),

  push: async (baseRevisionOverride) => {
    if (get().busy) return;
    set({ busy: "push", progress: null, conflictHeadRevision: null });
    try {
      const result = await pushProject({
        baseRevisionOverride,
        onProgress: (progress) => set({ progress }),
      });
      if (result.status === "conflict") {
        set({ conflictHeadRevision: result.headRevision });
      } else {
        toast.success(`Hochgeladen — Rev ${result.revision}`);
        // Offer the server build for the just-pushed revision (subtle action
        // in the Cloud section).
        const packId =
          useProjectStore.getState().project?.sync.remoteProjectId ?? null;
        if (packId) {
          set({
            serverBuild: {
              packId,
              revision: result.revision,
              buildId: null,
              status: "offer",
            },
          });
        }
      }
    } catch (e) {
      toast.error("Hochladen fehlgeschlagen", { description: errorMessage(e) });
    } finally {
      set({ busy: null, progress: null });
    }
  },

  pull: async (opts) => {
    if (get().busy) return;
    if (!opts?.force && hasUnsyncedLocalChanges()) {
      set({ pullConfirmOpen: true });
      return;
    }
    set({ busy: "pull", progress: null, pullConfirmOpen: false });
    try {
      const result = await pullProject({
        onProgress: (progress) => set({ progress }),
      });
      toast.success(`Rev ${result.revision} geladen`, {
        description:
          result.downloadedAssets > 0
            ? `${result.downloadedAssets} Datei(en) heruntergeladen.`
            : "Alle Dateien waren bereits lokal vorhanden.",
      });
    } catch (e) {
      toast.error("Laden fehlgeschlagen", { description: errorMessage(e) });
    } finally {
      set({ busy: null, progress: null });
    }
  },

  requestServerBuild: async () => {
    const offer = get().serverBuild;
    if (!offer || offer.status !== "offer") return;
    try {
      const build = await startServerBuild(offer.packId, offer.revision);
      if (build.status === "done") {
        // Cached artifact of the immutable revision — nothing to wait for.
        toast.success(`Server-Build für Rev ${build.revision} ist fertig`);
        set({ serverBuild: null });
        return;
      }
      set({
        serverBuild: { ...offer, buildId: build.buildId, status: build.status },
      });
    } catch (e) {
      toast.error("Server-Build konnte nicht gestartet werden", {
        description: errorMessage(e),
      });
    }
  },

  applyServerBuildStatus: (buildId, status) => {
    const current = get().serverBuild;
    if (!current || current.buildId !== buildId) return;

    if (status === "done") {
      toast.success(`Server-Build abgeschlossen (Rev ${current.revision})`);
      set({ serverBuild: null });
      return;
    }
    if (status === "error") {
      set({ serverBuild: null });
      // Fetch the German error detail (best effort).
      void getServerBuild(buildId)
        .then((build) => {
          toast.error("Server-Build fehlgeschlagen", {
            description: build.error ?? undefined,
          });
        })
        .catch(() => {
          toast.error("Server-Build fehlgeschlagen");
        });
      return;
    }
    set({ serverBuild: { ...current, status } });
  },
}));
