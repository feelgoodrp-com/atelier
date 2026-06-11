/**
 * Working state of the currently opened atelier project.
 *
 * - zundo `temporal` middleware records project snapshots (undo/redo, max 100).
 *   Only `project` is partialized into history — selection, dirty flag and
 *   save markers are not undoable.
 * - Every mutating action bumps `project.updatedAt` and sets `dirty`.
 * - Derived data (bucket sorting, derived drawableIds, duplicate detection)
 *   lives in the pure `select*` helpers below so they stay bun-testable.
 */

import { create } from "zustand";
import { temporal } from "zundo";
import type { Gender, SlotId } from "@/lib/project/schema";
import type {
  AssetRef,
  AtelierProject,
  ProjectDrawable,
  ProjectGroup,
  ProjectSettings,
  ProjectSync,
} from "@/lib/project/schema";

export interface ProjectHistoryState {
  project: AtelierProject | null;
}

interface ProjectState {
  /** Currently opened project (null on the launcher). */
  project: AtelierProject | null;
  /** Absolute path of the project directory (contains pack.atelier). */
  projectDir: string | null;
  /** True when the working state differs from pack.atelier on disk. */
  dirty: boolean;
  /** ISO timestamp of the last successful pack.atelier write. */
  lastSavedAt: string | null;
  /** ISO timestamp of the last autosave snapshot (recovery ring buffer). */
  lastAutosavedAt: string | null;
  /** Selected drawable uuids (workbench list selection). */
  selection: string[];

  // -- lifecycle ------------------------------------------------------------
  openProject: (projectDir: string, project: AtelierProject) => void;
  closeProject: () => void;
  /** Marks the working state as flushed to pack.atelier. */
  markSaved: (savedAt?: string) => void;
  markAutosaved: (autosavedAt?: string) => void;
  /** Used by undo/redo bookkeeping — does not touch updatedAt. */
  markDirty: () => void;

  // -- selection ------------------------------------------------------------
  setSelection: (ids: string[]) => void;

  // -- drawables ------------------------------------------------------------
  addDrawable: (drawable: ProjectDrawable) => void;
  updateDrawable: (
    id: string,
    patch: Partial<Omit<ProjectDrawable, "id">>,
  ) => void;
  removeDrawables: (ids: string[]) => void;
  /** Moves a drawable to `toIndex` within its (gender, type) bucket. */
  reorderDrawable: (id: string, toIndex: number) => void;

  // -- textures -------------------------------------------------------------
  setTextures: (drawableId: string, textures: AssetRef[]) => void;
  addTexture: (drawableId: string, texture: AssetRef) => void;
  removeTexture: (drawableId: string, index: number) => void;
  reorderTexture: (drawableId: string, from: number, to: number) => void;
  /**
   * Replaces texture refs by project-relative path. Used after in-place
   * texture optimization: the file changed on disk, so EVERY drawable
   * referencing the same path gets the new hash/size. NOT undoable (the old
   * file bytes are gone) — clears the undo history to keep it consistent.
   */
  updateTexturesBatch: (updates: Array<{ path: string; next: AssetRef }>) => void;

  // -- groups ---------------------------------------------------------------
  addGroup: (name: string, color: string) => string;
  updateGroup: (id: string, patch: Partial<Omit<ProjectGroup, "id">>) => void;
  removeGroup: (id: string) => void;
  assignGroup: (drawableIds: string[], groupId: string | null) => void;

  // -- meta -----------------------------------------------------------------
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  renameProject: (name: string) => void;

  // -- cloud sync -------------------------------------------------------------
  /** Replaces ALL drawables in ONE undoable step (cloud pull). */
  replaceAllDrawables: (drawables: ProjectDrawable[]) => void;
  /**
   * Pull result: drawables + sync block in ONE history entry (single undo
   * step); clears the selection because old uuids may be gone.
   */
  applyPulledState: (drawables: ProjectDrawable[], sync: ProjectSync) => void;
  /**
   * Updates the sync block WITHOUT recording an undo step (link/push
   * bookkeeping must not be undoable). Still marks the project dirty.
   */
  setSyncState: (sync: ProjectSync) => void;
}

function touch(project: AtelierProject): AtelierProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => {
      /** Applies an immutable recipe to the open project + bumps updatedAt. */
      const mutate = (recipe: (project: AtelierProject) => AtelierProject) => {
        set((state) =>
          state.project
            ? { project: touch(recipe(state.project)), dirty: true }
            : state,
        );
      };

      const mutateDrawable = (
        id: string,
        recipe: (drawable: ProjectDrawable) => ProjectDrawable,
      ) => {
        mutate((project) => ({
          ...project,
          drawables: project.drawables.map((d) =>
            d.id === id ? recipe(d) : d,
          ),
        }));
      };

      return {
        project: null,
        projectDir: null,
        dirty: false,
        lastSavedAt: null,
        lastAutosavedAt: null,
        selection: [],

        openProject: (projectDir, project) =>
          set({
            project,
            projectDir,
            dirty: false,
            lastSavedAt: null,
            lastAutosavedAt: null,
            selection: [],
          }),

        closeProject: () =>
          set({
            project: null,
            projectDir: null,
            dirty: false,
            lastSavedAt: null,
            lastAutosavedAt: null,
            selection: [],
          }),

        markSaved: (savedAt) =>
          set({ dirty: false, lastSavedAt: savedAt ?? new Date().toISOString() }),

        markAutosaved: (autosavedAt) =>
          set({ lastAutosavedAt: autosavedAt ?? new Date().toISOString() }),

        markDirty: () => set({ dirty: true }),

        setSelection: (ids) => set({ selection: ids }),

        addDrawable: (drawable) =>
          mutate((project) => ({
            ...project,
            drawables: [...project.drawables, drawable],
          })),

        updateDrawable: (id, patch) =>
          mutateDrawable(id, (d) => ({ ...d, ...patch, id: d.id })),

        removeDrawables: (ids) => {
          const remove = new Set(ids);
          mutate((project) => ({
            ...project,
            drawables: project.drawables.filter((d) => !remove.has(d.id)),
          }));
          set((state) => ({
            selection: state.selection.filter((id) => !remove.has(id)),
          }));
        },

        reorderDrawable: (id, toIndex) =>
          mutate((project) => {
            const target = project.drawables.find((d) => d.id === id);
            if (!target) return project;

            // Global indices of all bucket members (stable positions for the
            // bucket inside the full array).
            const bucketPositions: number[] = [];
            const bucket: ProjectDrawable[] = [];
            project.drawables.forEach((d, index) => {
              if (d.gender === target.gender && d.type === target.type) {
                bucketPositions.push(index);
                bucket.push(d);
              }
            });

            const from = bucket.findIndex((d) => d.id === id);
            const to = Math.max(0, Math.min(bucket.length - 1, toIndex));
            if (from === -1 || from === to) return project;

            const reordered = [...bucket];
            const [moved] = reordered.splice(from, 1);
            reordered.splice(to, 0, moved);

            const drawables = [...project.drawables];
            bucketPositions.forEach((position, i) => {
              drawables[position] = reordered[i];
            });
            return { ...project, drawables };
          }),

        setTextures: (drawableId, textures) =>
          mutateDrawable(drawableId, (d) => ({ ...d, textures })),

        addTexture: (drawableId, texture) =>
          mutateDrawable(drawableId, (d) => ({
            ...d,
            textures: [...d.textures, texture],
          })),

        removeTexture: (drawableId, index) =>
          mutateDrawable(drawableId, (d) => ({
            ...d,
            textures: d.textures.filter((_, i) => i !== index),
          })),

        reorderTexture: (drawableId, from, to) =>
          mutateDrawable(drawableId, (d) => {
            if (from < 0 || from >= d.textures.length) return d;
            const clamped = Math.max(0, Math.min(d.textures.length - 1, to));
            if (from === clamped) return d;
            const textures = [...d.textures];
            const [moved] = textures.splice(from, 1);
            textures.splice(clamped, 0, moved);
            return { ...d, textures };
          }),

        updateTexturesBatch: (updates) => {
          if (updates.length === 0) return;
          const byPath = new Map(updates.map((u) => [u.path, u.next]));
          // NOT undoable: the .ytd files were rewritten IN PLACE on disk —
          // undoing back to the old hash refs would guarantee hash-mismatch
          // build errors while the old bytes are gone (backup aside).
          const temporalApi = useProjectStore.temporal.getState();
          temporalApi.pause();
          try {
            mutate((project) => ({
              ...project,
              drawables: project.drawables.map((d) => {
                if (!d.textures.some((t) => byPath.has(t.path))) return d;
                return {
                  ...d,
                  textures: d.textures.map((t) => byPath.get(t.path) ?? t),
                };
              }),
            }));
          } finally {
            temporalApi.resume();
          }
          // Every OLDER snapshot also references the destroyed file state —
          // drop the history so undo can never desync project vs disk.
          temporalApi.clear();
        },

        addGroup: (name, color) => {
          const id = crypto.randomUUID();
          mutate((project) => ({
            ...project,
            groups: [...project.groups, { id, name, color }],
          }));
          return id;
        },

        updateGroup: (id, patch) =>
          mutate((project) => ({
            ...project,
            groups: project.groups.map((g) =>
              g.id === id ? { ...g, ...patch, id: g.id } : g,
            ),
          })),

        removeGroup: (id) =>
          mutate((project) => ({
            ...project,
            groups: project.groups.filter((g) => g.id !== id),
            drawables: project.drawables.map((d) =>
              d.groupId === id ? { ...d, groupId: null } : d,
            ),
          })),

        assignGroup: (drawableIds, groupId) => {
          const targets = new Set(drawableIds);
          // Guard against dangling group references.
          if (groupId !== null) {
            const exists = get().project?.groups.some((g) => g.id === groupId);
            if (!exists) return;
          }
          mutate((project) => ({
            ...project,
            drawables: project.drawables.map((d) =>
              targets.has(d.id) ? { ...d, groupId } : d,
            ),
          }));
        },

        updateSettings: (patch) =>
          mutate((project) => ({
            ...project,
            settings: { ...project.settings, ...patch },
          })),

        renameProject: (name) =>
          mutate((project) => ({ ...project, name })),

        replaceAllDrawables: (drawables) => {
          const keep = new Set(drawables.map((d) => d.id));
          set((state) =>
            state.project
              ? {
                  project: touch({ ...state.project, drawables }),
                  dirty: true,
                  selection: state.selection.filter((id) => keep.has(id)),
                }
              : state,
          );
        },

        applyPulledState: (drawables, sync) =>
          set((state) =>
            state.project
              ? {
                  project: {
                    ...state.project,
                    drawables,
                    sync,
                    // Keep updatedAt == lastSyncedAt so "unsynced local
                    // changes" checks compare cleanly after a pull.
                    updatedAt: sync.lastSyncedAt ?? new Date().toISOString(),
                  },
                  dirty: true,
                  selection: [],
                }
              : state,
          ),

        setSyncState: (sync) => {
          const temporal = useProjectStore.temporal.getState();
          temporal.pause();
          try {
            set((state) =>
              state.project
                ? {
                    project: {
                      ...state.project,
                      sync,
                      updatedAt: sync.lastSyncedAt ?? state.project.updatedAt,
                    },
                    dirty: true,
                  }
                : state,
            );
          } finally {
            temporal.resume();
          }
        },
      };
    },
    {
      limit: 100,
      partialize: (state): ProjectHistoryState => ({ project: state.project }),
      equality: (pastState, currentState) =>
        pastState.project === currentState.project,
    },
  ),
);

/** Clears the undo/redo history (call after opening a project). */
export function clearProjectHistory(): void {
  useProjectStore.temporal.getState().clear();
}

// ---------------------------------------------------------------------------
// Pure derived selectors (bun-testable, no zustand required)
// ---------------------------------------------------------------------------

/**
 * Drawables of one (gender, type) bucket in canonical order (= array order,
 * which is what the in-game drawableId derives from).
 */
export function selectDrawablesBy(
  project: AtelierProject,
  gender: Gender,
  type: SlotId,
): ProjectDrawable[] {
  return project.drawables.filter(
    (d) => d.gender === gender && d.type === type,
  );
}

/**
 * Derived in-game drawableId per drawable uuid: the index within the
 * (gender, type, mode) bucket — exactly how the build step assigns ids.
 */
export function selectDerivedDrawableIds(
  project: AtelierProject,
): Record<string, number> {
  const counters = new Map<string, number>();
  const ids: Record<string, number> = {};
  for (const d of project.drawables) {
    const key = `${d.gender}|${d.type}|${d.mode}`;
    const next = counters.get(key) ?? 0;
    ids[d.id] = next;
    counters.set(key, next + 1);
  }
  return ids;
}

/**
 * Map of ydd hash → drawable uuids for every hash used by 2+ drawables
 * (duplicate mesh detection across the whole project).
 */
export function selectDuplicateYddMap(
  project: AtelierProject,
): Record<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const d of project.drawables) {
    if (!d.ydd) continue;
    const list = byHash.get(d.ydd.hash) ?? [];
    list.push(d.id);
    byHash.set(d.ydd.hash, list);
  }
  const duplicates: Record<string, string[]> = {};
  for (const [hash, ids] of byHash) {
    if (ids.length >= 2) duplicates[hash] = ids;
  }
  return duplicates;
}
