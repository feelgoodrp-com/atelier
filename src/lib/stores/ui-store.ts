import { create } from "zustand";

export type Screen =
  | "launcher"
  | "workbench"
  | "tattoos"
  | "settings"
  | "help"
  /** Validation + build session (see stores/build-store.ts). */
  | "build";

interface UiState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  /**
   * Force the first-run setup wizard to show again (Settings → "Einrichtung
   * erneut durchlaufen"), even while already logged in. Cleared when the
   * wizard finishes.
   */
  rerunOnboarding: boolean;
  setRerunOnboarding: (rerun: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  screen: "launcher",
  setScreen: (screen) => set({ screen }),
  rerunOnboarding: false,
  setRerunOnboarding: (rerunOnboarding) => set({ rerunOnboarding }),
}));
