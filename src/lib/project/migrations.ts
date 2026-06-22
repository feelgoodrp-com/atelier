/**
 * Version migrations for `pack.atelier` files.
 *
 * Each released file format version gets a lift in {@link migrateProjectFile}.
 * Lifts chain (v1 → v2 → …) until {@link PROJECT_FILE_VERSION} is reached; zod
 * validation runs AFTER migration (in lib/project/io.ts).
 *   v1 → v2: adds the tattoo model (tattooCollection + empty tattoos[]).
 */

import i18n from "@/lib/i18n";
import { PROJECT_FILE_VERSION, suggestDlcName } from "./schema";

export class ProjectMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectMigrationError";
  }
}

/**
 * Lifts a v1 project to v2 additively: nothing in the v1 payload is touched, we
 * only append `tattooCollection` + an empty `tattoos` array. The collection name
 * is derived from the existing dlcName (re-slugged so it satisfies the stricter
 * `[a-z0-9_]` collection charset), falling back to the project name.
 */
function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = (raw.settings ?? {}) as { dlcName?: unknown };
  const source =
    typeof settings.dlcName === "string" && settings.dlcName.length > 0
      ? settings.dlcName
      : typeof raw.name === "string"
        ? raw.name
        : "";
  return {
    ...raw,
    fgcloth: 2,
    tattooCollection: { name: suggestDlcName(source), label: "Tattoos" },
    tattoos: [],
  };
}

/**
 * Takes the raw JSON.parse result of a pack.atelier file and returns an object
 * shaped like the current {@link PROJECT_FILE_VERSION}. Zod validation happens
 * AFTER migration (in lib/project/io.ts) — this only lifts old versions.
 */
export function migrateProjectFile(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProjectMigrationError(i18n.t("errors:migration.noProjectObject"));
  }

  let doc = raw as Record<string, unknown>;
  let version = doc.fgcloth;

  if (version === 1) {
    doc = migrateV1ToV2(doc);
    version = doc.fgcloth;
  }

  if (version === PROJECT_FILE_VERSION) {
    return doc;
  }

  throw new ProjectMigrationError(
    typeof version === "number" && version > PROJECT_FILE_VERSION
      ? i18n.t("errors:migration.newerVersion", { version })
      : i18n.t("errors:migration.unknownVersion", {
          version: String(version),
        }),
  );
}
