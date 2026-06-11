/**
 * Glue between project IO, the project store, recents and the UI shell.
 * Used by the launcher (and later the workbench) to open/create projects.
 */

import { addRecentProject } from "@/lib/recents";
import {
  clearProjectHistory,
  useProjectStore,
} from "@/lib/stores/project-store";
import { useUiStore } from "@/lib/stores/ui-store";
import {
  clearAutosaves,
  createProject,
  findNewerAutosave,
  loadProject,
  saveProject,
  type AutosaveEntry,
} from "./io";
import type { AtelierProject } from "./schema";

export interface PendingRecovery {
  dirPath: string;
  /** State as last saved in pack.atelier. */
  saved: AtelierProject;
  /** Newer autosave snapshot offered for recovery. */
  autosave: AutosaveEntry;
}

/**
 * Puts a loaded project into the store, resets undo history, records it in
 * the recents list and switches to the workbench.
 */
export async function activateProject(
  dirPath: string,
  project: AtelierProject,
): Promise<void> {
  useProjectStore.getState().openProject(dirPath, project);
  clearProjectHistory();
  useUiStore.getState().setScreen("workbench");
  await addRecentProject({ dirPath, name: project.name }).catch(() => {});
}

/**
 * Loads a project folder. When a newer autosave exists, nothing is activated
 * yet — the caller shows the recovery prompt and finishes via
 * {@link resolveRecovery}. Throws ProjectIoError with German messages.
 */
export async function openProjectFromDir(
  dirPath: string,
): Promise<{ recovery: PendingRecovery | null }> {
  const saved = await loadProject(dirPath);
  const autosave = await findNewerAutosave(dirPath).catch(() => null);
  if (autosave) {
    return { recovery: { dirPath, saved, autosave } };
  }
  await activateProject(dirPath, saved);
  return { recovery: null };
}

/**
 * Finishes a recovery prompt. `restore: true` activates the autosave state
 * and writes it straight back to pack.atelier; `false` keeps the saved state
 * and drops the stale snapshots so the prompt does not reappear.
 */
export async function resolveRecovery(
  recovery: PendingRecovery,
  restore: boolean,
): Promise<void> {
  if (restore) {
    await activateProject(recovery.dirPath, recovery.autosave.project);
    await saveProject(recovery.dirPath, recovery.autosave.project);
    useProjectStore.getState().markSaved();
  } else {
    await clearAutosaves(recovery.dirPath).catch(() => {});
    await activateProject(recovery.dirPath, recovery.saved);
  }
}

/** Creates a fresh project in `dirPath` and opens it. */
export async function createAndOpenProject(
  dirPath: string,
  name: string,
): Promise<AtelierProject> {
  const project = await createProject(dirPath, name);
  await activateProject(dirPath, project);
  return project;
}
