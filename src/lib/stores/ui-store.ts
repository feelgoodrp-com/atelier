import { create } from "zustand";

export type Screen = "launcher" | "workbench" | "settings";

interface UiState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export const useUiStore = create<UiState>((set) => ({
  screen: "launcher",
  setScreen: (screen) => set({ screen }),
}));
