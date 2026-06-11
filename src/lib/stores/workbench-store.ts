/**
 * UI state of the workbench (not undoable, not persisted): which gender view
 * is active, which category filters the center list, search text, plus the
 * cross-screen import-wizard state and drafts that still need a slot.
 */

import { create } from "zustand";
import { toast } from "sonner";
import type { SlotId } from "@/lib/gta/components";
import type { Gender } from "@/lib/project/schema";
import type { ImportedDrawable } from "@/lib/project/import-assets";
import { saveProject } from "@/lib/project/io";
import { useProjectStore } from "@/lib/stores/project-store";

/** "all" is the pseudo-category showing every slot of the active gender. */
export type CategoryId = SlotId | "all";

interface WorkbenchState {
  /** Gender whose drawables are listed (independent of settings.defaultGender). */
  viewGender: Gender;
  /** Category filtering the center list. */
  category: CategoryId;
  /** Center-list search (filters by label, case-insensitive). */
  search: string;
  /** Project id the view state was last initialized for. */
  initializedForProjectId: string | null;
  /** Import wizard is mounted app-wide so it survives screen switches. */
  importWizardOpen: boolean;
  /** Imported drafts without a resolvable slot — the assign dialog consumes these. */
  pendingDrafts: ImportedDrawable[];
  /** Drawable uuid the center list should scroll into view (jump-to). */
  scrollTarget: string | null;
  /** True while a manual Strg+S save is writing pack.atelier. */
  saving: boolean;
  /** 3D preview panel visibility — survives project switches (not reset). */
  previewOpen: boolean;

  setViewGender: (gender: Gender) => void;
  setCategory: (category: CategoryId) => void;
  setSearch: (search: string) => void;
  /** Applies per-project defaults exactly once per opened project. */
  initForProject: (projectId: string, defaultGender: Gender) => void;
  setImportWizardOpen: (open: boolean) => void;
  setPendingDrafts: (drafts: ImportedDrawable[]) => void;
  requestScrollTo: (drawableId: string | null) => void;
  setPreviewOpen: (open: boolean) => void;
  /** Manual save (Strg+S / header button) — writes pack.atelier atomically. */
  saveNow: () => Promise<void>;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  viewGender: "male",
  category: "all",
  search: "",
  initializedForProjectId: null,
  importWizardOpen: false,
  pendingDrafts: [],
  scrollTarget: null,
  saving: false,
  previewOpen: true,

  setViewGender: (viewGender) => {
    // The center list only shows one gender — drop selections that would
    // otherwise keep invisible rows alive in the inspector.
    if (get().viewGender !== viewGender) {
      useProjectStore.getState().setSelection([]);
    }
    set({ viewGender });
  },
  setCategory: (category) => set({ category }),
  setSearch: (search) => set({ search }),

  initForProject: (projectId, defaultGender) => {
    if (get().initializedForProjectId === projectId) return;
    set({
      initializedForProjectId: projectId,
      viewGender: defaultGender,
      category: "all",
      search: "",
      pendingDrafts: [],
      scrollTarget: null,
    });
  },

  setImportWizardOpen: (importWizardOpen) => set({ importWizardOpen }),
  setPendingDrafts: (pendingDrafts) => set({ pendingDrafts }),
  requestScrollTo: (scrollTarget) => set({ scrollTarget }),
  setPreviewOpen: (previewOpen) => set({ previewOpen }),

  saveNow: async () => {
    const { project, projectDir, dirty, markSaved } =
      useProjectStore.getState();
    if (!project || !projectDir || !dirty || get().saving) return;
    set({ saving: true });
    try {
      await saveProject(projectDir, project);
      markSaved();
    } catch (e) {
      toast.error("Speichern fehlgeschlagen", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      set({ saving: false });
    }
  },
}));
