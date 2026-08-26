import { create } from "zustand";
import type { SyncProgress } from "@/lib/sync/pack-sync";

export type LiveStatus = "off" | "connecting" | "syncing" | "online" | "error";

export interface LiveTransfer {
  direction: "push" | "pull";
  progress: SyncProgress;
}

interface LiveState {
  status: LiveStatus;
  version: number | null;
  pending: number;
  error: string | null;
  /** Initial workspace bootstrap/clone transfer shown in the cloud dialog. */
  transfer: LiveTransfer | null;
  setStatus: (status: LiveStatus, error?: string | null) => void;
  setVersion: (version: number | null) => void;
  setPending: (pending: number) => void;
  setTransfer: (transfer: LiveTransfer | null) => void;
  reset: () => void;
}

export const useLiveStore = create<LiveState>((set) => ({
  status: "off",
  version: null,
  pending: 0,
  error: null,
  transfer: null,
  setStatus: (status, error = null) => set({ status, error }),
  setVersion: (version) => set({ version }),
  setPending: (pending) => set({ pending }),
  setTransfer: (transfer) => set({ transfer }),
  reset: () =>
    set({ status: "off", version: null, pending: 0, error: null, transfer: null }),
}));
