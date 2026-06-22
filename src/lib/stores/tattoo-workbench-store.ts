/**
 * UI state of the tattoos screen (NOT undoable, NOT persisted): which zone the
 * grid is filtered to, the search text, the grid selection and an importing
 * flag. Kept separate from the clothing workbench store + project-store
 * selection so the two authoring areas never fight over the same state.
 */

import { create } from "zustand";
import type { TattooZoneId } from "@/lib/gta/tattoos";

/** "all" shows every zone. */
export type TattooZoneFilter = TattooZoneId | "all";

interface TattooWorkbenchState {
  zoneFilter: TattooZoneFilter;
  search: string;
  /** Selected tattoo uuids (grid selection). */
  selection: string[];
  /** Project the view state was last initialized for. */
  initializedForProjectId: string | null;
  /** True while an import dialog/copy is running. */
  importing: boolean;

  setZoneFilter: (zone: TattooZoneFilter) => void;
  setSearch: (search: string) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  setImporting: (importing: boolean) => void;
  /** Applies per-project defaults exactly once per opened project. */
  initForProject: (projectId: string) => void;
}

export const useTattooWorkbenchStore = create<TattooWorkbenchState>((set, get) => ({
  zoneFilter: "all",
  search: "",
  selection: [],
  initializedForProjectId: null,
  importing: false,

  setZoneFilter: (zoneFilter) => set({ zoneFilter }),
  setSearch: (search) => set({ search }),
  setSelection: (selection) => set({ selection }),
  toggleSelection: (id, additive) =>
    set((state) => {
      if (!additive) return { selection: [id] };
      return state.selection.includes(id)
        ? { selection: state.selection.filter((s) => s !== id) }
        : { selection: [...state.selection, id] };
    }),
  setImporting: (importing) => set({ importing }),

  initForProject: (projectId) => {
    if (get().initializedForProjectId === projectId) return;
    set({
      initializedForProjectId: projectId,
      zoneFilter: "all",
      search: "",
      selection: [],
    });
  },
}));
