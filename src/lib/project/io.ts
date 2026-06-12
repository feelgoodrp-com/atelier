/**
 * Disk IO for atelier projects via @tauri-apps/plugin-fs.
 *
 * Project folder layout:
 *   <projectDir>/pack.atelier            project file (JSON, fgcloth v1)
 *   <projectDir>/assets/<gender>/<type>/ imported ydd/ytd/yld files
 *   <projectDir>/.atelier-cache/         derived data, never synced
 *   <projectDir>/.atelier-cache/autosave/<epochMs>.json  recovery snapshots
 *
 * fs scope note: project folders live at arbitrary user-chosen paths, so the
 * capability grants the used fs commands a global `**` scope (see
 * src-tauri/capabilities/default.json). Dialog-granted scopes alone are not
 * enough because recents reopen projects without a dialog after app restart.
 */

import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { migrateProjectFile, ProjectMigrationError } from "./migrations";
import {
  atelierProjectSchema,
  createEmptyProject,
  type AtelierProject,
} from "./schema";

export const PROJECT_FILE_NAME = "pack.atelier";
export const ASSETS_DIR_NAME = "assets";
export const CACHE_DIR_NAME = ".atelier-cache";
export const AUTOSAVE_DIR_NAME = "autosave";

/** Ring buffer size of recovery snapshots per project. */
const AUTOSAVE_KEEP = 20;

export class ProjectIoError extends Error {
  /** Underlying fs/parse error, for debugging (target ES2020 — no Error.cause). */
  readonly inner: unknown;

  constructor(message: string, inner?: unknown) {
    super(message);
    this.name = "ProjectIoError";
    this.inner = inner;
  }
}

/** Joins path segments with "/" (Windows APIs accept mixed separators). */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("/");
}

/** Turns a project name into a safe Windows folder name. */
export function sanitizeFolderName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "atelier-projekt"
  );
}

function serializeProject(project: AtelierProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

function autosaveDir(projectDir: string): string {
  return joinPath(projectDir, CACHE_DIR_NAME, AUTOSAVE_DIR_NAME);
}

/** Parses + migrates + validates raw pack.atelier JSON text. */
function parseProjectText(text: string, sourceLabel: string): AtelierProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectIoError(`${sourceLabel} ist beschädigt (ungültiges JSON).`);
  }

  let migrated: unknown;
  try {
    migrated = migrateProjectFile(raw);
  } catch (e) {
    if (e instanceof ProjectMigrationError) throw new ProjectIoError(e.message);
    throw e;
  }

  const result = atelierProjectSchema.safeParse(migrated);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (Feld: ${issue.path.join(".")})` : "";
    throw new ProjectIoError(
      `${sourceLabel} hat ein ungültiges Format${where}: ${issue?.message ?? "unbekannter Fehler"}`,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Create / load / save
// ---------------------------------------------------------------------------

/**
 * Creates a fresh project inside `dirPath` (created if missing): pack.atelier,
 * assets/, .atelier-cache/autosave/ and a .gitignore inside the cache dir.
 * Fails if the folder already contains a pack.atelier.
 */
export async function createProject(
  dirPath: string,
  name: string,
): Promise<AtelierProject> {
  const projectFile = joinPath(dirPath, PROJECT_FILE_NAME);
  if (await exists(projectFile)) {
    throw new ProjectIoError(
      "Im gewählten Ordner existiert bereits ein atelier-Projekt.",
    );
  }

  try {
    await mkdir(dirPath, { recursive: true });
    await mkdir(joinPath(dirPath, ASSETS_DIR_NAME), { recursive: true });
    await mkdir(autosaveDir(dirPath), { recursive: true });
    // The cache dir holds machine-local derived data — keep it out of git.
    await writeTextFile(joinPath(dirPath, CACHE_DIR_NAME, ".gitignore"), "*\n");
  } catch (e) {
    throw new ProjectIoError(
      "Projektordner konnte nicht angelegt werden. Prüfe Pfad und Schreibrechte.",
      e,
    );
  }

  const project = createEmptyProject(name);
  await saveProject(dirPath, project);
  return project;
}

/** Loads + migrates + validates `<dirPath>/pack.atelier`. */
export async function loadProject(dirPath: string): Promise<AtelierProject> {
  const projectFile = joinPath(dirPath, PROJECT_FILE_NAME);

  let fileExists: boolean;
  try {
    fileExists = await exists(projectFile);
  } catch (e) {
    throw new ProjectIoError(
      "Ordner konnte nicht gelesen werden. Prüfe, ob der Pfad noch existiert.",
      e,
    );
  }
  if (!fileExists) {
    throw new ProjectIoError(
      "Kein atelier-Projekt gefunden (pack.atelier fehlt in diesem Ordner).",
    );
  }

  let text: string;
  try {
    text = await readTextFile(projectFile);
  } catch (e) {
    throw new ProjectIoError("pack.atelier konnte nicht gelesen werden.", e);
  }

  return parseProjectText(text, "pack.atelier");
}

/**
 * Atomic save: writes `pack.atelier.tmp` first, then renames it over the real
 * file (std::fs::rename replaces existing files on Windows).
 */
export async function saveProject(
  dirPath: string,
  project: AtelierProject,
): Promise<void> {
  const projectFile = joinPath(dirPath, PROJECT_FILE_NAME);
  const tmpFile = `${projectFile}.tmp`;
  try {
    await writeTextFile(tmpFile, serializeProject(project));
    await rename(tmpFile, projectFile);
  } catch (e) {
    // Best effort cleanup of a stranded tmp file.
    await remove(tmpFile).catch(() => {});
    throw new ProjectIoError(
      "Projekt konnte nicht gespeichert werden. Prüfe Speicherplatz und Schreibrechte.",
      e,
    );
  }
}

// ---------------------------------------------------------------------------
// Autosave (recovery snapshots)
// ---------------------------------------------------------------------------

export interface AutosaveEntry {
  /** Absolute path of the snapshot file. */
  path: string;
  /** Wall-clock time the snapshot was written (from the file name). */
  savedAt: Date;
  /** Validated project state inside the snapshot. */
  project: AtelierProject;
}

const AUTOSAVE_FILE_RE = /^(\d{10,16})\.json$/;

async function listAutosaveFiles(
  projectDir: string,
): Promise<Array<{ path: string; epochMs: number }>> {
  const dir = autosaveDir(projectDir);
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  return entries
    .filter((e) => e.isFile)
    .map((e) => {
      const m = AUTOSAVE_FILE_RE.exec(e.name);
      return m
        ? { path: joinPath(dir, e.name), epochMs: Number.parseInt(m[1], 10) }
        : null;
    })
    .filter((e): e is { path: string; epochMs: number } => e !== null)
    .sort((a, b) => b.epochMs - a.epochMs); // newest first
}

/**
 * Writes a recovery snapshot into `.atelier-cache/autosave/<epochMs>.json`
 * and prunes the ring buffer down to the newest {@link AUTOSAVE_KEEP} files.
 */
export async function writeAutosave(
  projectDir: string,
  project: AtelierProject,
): Promise<void> {
  const dir = autosaveDir(projectDir);
  await mkdir(dir, { recursive: true });
  await writeTextFile(
    joinPath(dir, `${Date.now()}.json`),
    serializeProject(project),
  );

  const files = await listAutosaveFiles(projectDir);
  for (const stale of files.slice(AUTOSAVE_KEEP)) {
    await remove(stale.path).catch(() => {});
  }
}

/**
 * Returns the newest readable autosave whose state is newer than the saved
 * pack.atelier (compared via `updatedAt`), or null. Used for the recovery
 * prompt after a crash (autosaves survive, pack.atelier lags behind).
 */
export async function findNewerAutosave(
  dirPath: string,
): Promise<AutosaveEntry | null> {
  const saved = await loadProject(dirPath);
  const savedUpdatedAt = Date.parse(saved.updatedAt);

  for (const file of await listAutosaveFiles(dirPath)) {
    let candidate: AtelierProject;
    try {
      candidate = parseProjectText(
        await readTextFile(file.path),
        "Autosave-Datei",
      );
    } catch {
      continue; // corrupt/old snapshot — try the next newest
    }
    if (candidate.id !== saved.id) continue;
    if (Date.parse(candidate.updatedAt) > savedUpdatedAt) {
      return {
        path: file.path,
        savedAt: new Date(file.epochMs),
        project: candidate,
      };
    }
    // Newest valid snapshot is not newer than the save — nothing to recover.
    return null;
  }
  return null;
}

/** Removes all recovery snapshots (used when the user discards a recovery). */
export async function clearAutosaves(projectDir: string): Promise<void> {
  for (const file of await listAutosaveFiles(projectDir)) {
    await remove(file.path).catch(() => {});
  }
}
