/**
 * Version migrations for `pack.atelier` files.
 *
 * Each released file format version gets a case in {@link migrateProjectFile}.
 * Currently only fgcloth v1 exists, so this is a passthrough — future versions
 * chain upgrades (v1 → v2 → …) until {@link PROJECT_FILE_VERSION} is reached.
 */

import { PROJECT_FILE_VERSION } from "./schema";

export class ProjectMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectMigrationError";
  }
}

/**
 * Takes the raw JSON.parse result of a pack.atelier file and returns an object
 * shaped like the current {@link PROJECT_FILE_VERSION}. Zod validation happens
 * AFTER migration (in lib/project/io.ts) — this only lifts old versions.
 */
export function migrateProjectFile(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProjectMigrationError(
      "pack.atelier enthält kein gültiges Projektobjekt.",
    );
  }

  const version = (raw as { fgcloth?: unknown }).fgcloth;
  switch (version) {
    case PROJECT_FILE_VERSION:
      return raw;
    default:
      throw new ProjectMigrationError(
        typeof version === "number" && version > PROJECT_FILE_VERSION
          ? `Das Projekt wurde mit einer neueren atelier-Version erstellt (fgcloth v${version}). Bitte aktualisiere atelier.`
          : `Unbekannte Projektversion (fgcloth=${String(version)}).`,
      );
  }
}
