/**
 * Clones a cloud pack into a fresh local project and opens it in the workbench.
 *
 * Flow: pick a collision-free subfolder under the chosen parent -> create an
 * empty local project there (createAndOpenProject opens it + records recents +
 * switches to the workbench) -> link it to the pack -> pull the head revision
 * (skipped for empty packs at headRevision 0, which have no manifest yet).
 *
 * A failing pull leaves the (already opened + linked) project in place so the
 * user can retry "Neueste Version laden" — the local project is never deleted.
 * All thrown errors carry German user-facing messages.
 */

import { exists } from "@tauri-apps/plugin-fs";
import { joinPath, sanitizeFolderName } from "@/lib/project/io";
import { createAndOpenProject } from "@/lib/project/session";
import { linkProject, pullProject, type ProgressFn } from "@/lib/sync/pack-sync";
import type { Pack } from "@/lib/sync/api-client";

/** Picks `<parentDir>/<name>`, appending _1, _2, … until the folder is free. */
async function resolveCloneDir(parentDir: string, name: string): Promise<string> {
  const base = sanitizeFolderName(name);
  let candidate = joinPath(parentDir, base);
  for (let i = 1; await exists(candidate); i++) {
    candidate = joinPath(parentDir, `${base}_${i}`);
  }
  return candidate;
}

/**
 * Clones `pack` into a new subfolder of `parentDir`, opens it and pulls the
 * head revision. Returns the absolute project directory of the clone.
 */
export async function clonePackToLocal(
  pack: Pack,
  parentDir: string,
  onProgress?: ProgressFn,
): Promise<string> {
  const targetDir = await resolveCloneDir(parentDir, pack.name);

  // Creates pack.atelier + assets/, opens the project, records it in recents
  // and switches to the workbench screen.
  await createAndOpenProject(targetDir, pack.name);

  // Link to the pack so push/pull operate against it (baseRevision stays null
  // until the pull below sets it to the head revision).
  await linkProject(pack.packId);

  // headRevision 0 = no revisions yet; the head manifest would 404, so we keep
  // the freshly opened (empty) project as-is.
  if (pack.headRevision > 0) {
    await pullProject({ onProgress });
  }

  return targetDir;
}
