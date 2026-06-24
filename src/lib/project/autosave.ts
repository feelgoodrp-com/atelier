/**
 * Autosave driver: subscribes to the project store and writes recovery
 * snapshots (lib/project/io.ts writeAutosave) — debounced 5s after the last
 * mutation, but at most 60s after the first unsaved mutation.
 *
 * Also covers undo/redo: zundo restores `project` without going through the
 * store actions, so the subscription re-marks `dirty` whenever the project
 * reference changes underneath us.
 */

import { useProjectStore } from "@/lib/stores/project-store";
import { usePreferencesStore } from "@/lib/stores/preferences-store";
import { writeAutosave } from "./io";

const DEBOUNCE_MS = 5_000;

/**
 * Starts the autosave subscription. Returns a cleanup function — call once
 * from App (useEffect) so HMR/unmount does not leak timers.
 */
export function startAutosave(): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let writing = false;

  const clearTimers = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (forceTimer !== null) clearTimeout(forceTimer);
    debounceTimer = null;
    forceTimer = null;
  };

  const flush = async () => {
    clearTimers();
    pending = false;

    const { project, projectDir, dirty, markAutosaved } =
      useProjectStore.getState();
    if (!project || !projectDir || !dirty || writing) return;

    writing = true;
    try {
      await writeAutosave(projectDir, project);
      markAutosaved();
    } catch {
      // Autosave is best effort — never interrupt the user. The next
      // mutation schedules a retry automatically.
    } finally {
      writing = false;
    }
  };

  const schedule = () => {
    if (!pending) {
      pending = true;
      // Hard ceiling: even under constant mutations, write at most every
      // <autosaveInterval> seconds (Settings → Preferences).
      const forceMs = usePreferencesStore.getState().autosaveInterval * 1000;
      forceTimer = setTimeout(() => void flush(), forceMs);
    }
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  let lastProject = useProjectStore.getState().project;
  let lastProjectDir = useProjectStore.getState().projectDir;

  const unsubscribe = useProjectStore.subscribe((state) => {
    // Project switched or closed — drop pending snapshots of the old one.
    if (state.projectDir !== lastProjectDir) {
      lastProjectDir = state.projectDir;
      lastProject = state.project;
      clearTimers();
      pending = false;
      return;
    }

    if (state.project === lastProject) return;
    lastProject = state.project;
    if (!state.project || !state.projectDir) return;

    // Undo/redo bypasses the actions — make sure the dirty flag follows.
    if (!state.dirty) state.markDirty();
    // Recovery autosave can be turned off in Settings → Preferences.
    if (!usePreferencesStore.getState().autosaveEnabled) return;
    schedule();
  });

  return () => {
    unsubscribe();
    clearTimers();
    pending = false;
  };
}
