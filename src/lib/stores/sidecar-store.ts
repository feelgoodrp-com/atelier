import { create } from "zustand";
import type { HealthState, SidecarInfo } from "@/lib/sidecar/types";

interface SidecarState {
  info: SidecarInfo;
  health: HealthState;
  setInfo: (info: SidecarInfo) => void;
  setHealth: (health: HealthState) => void;
}

export const useSidecarStore = create<SidecarState>((set) => ({
  info: {
    status: "connecting",
    port: null,
    token: null,
    detail: "Sidecar startet…",
  },
  health: "unknown",
  setInfo: (info) => set({ info }),
  setHealth: (health) => set({ health }),
}));
