/**
 * Recently opened projects, persisted via @tauri-apps/plugin-store
 * (recents.json in the app data dir). Max 10 entries, deduped by dirPath
 * (case-insensitive — Windows paths), newest first.
 */

import { load, type Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "recents.json";
const STORE_KEY = "recentProjects";
const MAX_RECENTS = 10;

export interface RecentProject {
  /** Absolute path of the project directory (contains pack.atelier). */
  dirPath: string;
  name: string;
  lastOpenedAt: string;
}

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, {
      autoSave: true,
      defaults: { [STORE_KEY]: [] },
    });
  }
  return storePromise;
}

function normalizeKey(dirPath: string): string {
  return dirPath.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function sanitize(entries: unknown): RecentProject[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e): e is RecentProject =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as RecentProject).dirPath === "string" &&
      typeof (e as RecentProject).name === "string" &&
      typeof (e as RecentProject).lastOpenedAt === "string",
  );
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  const store = await getStore();
  return sanitize(await store.get(STORE_KEY));
}

/** Adds/refreshes an entry and returns the updated list (newest first). */
export async function addRecentProject(entry: {
  dirPath: string;
  name: string;
}): Promise<RecentProject[]> {
  const store = await getStore();
  const key = normalizeKey(entry.dirPath);
  const rest = sanitize(await store.get(STORE_KEY)).filter(
    (e) => normalizeKey(e.dirPath) !== key,
  );
  const next: RecentProject[] = [
    { ...entry, lastOpenedAt: new Date().toISOString() },
    ...rest,
  ].slice(0, MAX_RECENTS);
  await store.set(STORE_KEY, next);
  return next;
}

/** Removes an entry (e.g. via context menu or when the folder is gone). */
export async function removeRecentProject(
  dirPath: string,
): Promise<RecentProject[]> {
  const store = await getStore();
  const key = normalizeKey(dirPath);
  const next = sanitize(await store.get(STORE_KEY)).filter(
    (e) => normalizeKey(e.dirPath) !== key,
  );
  await store.set(STORE_KEY, next);
  return next;
}
