/**
 * Pure mapping between local project drawables (pack.atelier, file paths)
 * and atelier-api revision drawables (CAS pointers sha256+size+exportName).
 *
 * NO tauri imports here — the module stays bun-testable; the IO half of the
 * sync pipeline (upload/download/copy) lives in pack-sync.ts.
 */

import { baseName } from "@/lib/format";
import type {
  RevisionAssetRef,
  RevisionDrawable,
  UploadAssetKind,
} from "@/lib/sync/api-client";
import type {
  AssetRef,
  AtelierProject,
  ProjectDrawable,
} from "@/lib/project/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upload kind from the file extension (server stores it for content-type). */
export function assetKindOf(path: string): UploadAssetKind {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === "ytd") return "ytd";
  if (ext === "yld") return "yld";
  return "ydd"; // .ydd + first-person meshes
}

/**
 * exportName is remote input (max 200 chars, otherwise unrestricted) — strip
 * any path segments and Windows-illegal characters before it touches disk.
 */
export function sanitizeExportName(exportName: string, sha256: string): string {
  const cleaned = baseName(exportName)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || sha256.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Local -> revision
// ---------------------------------------------------------------------------

function toRevisionAssetRef(ref: AssetRef): RevisionAssetRef {
  return { sha256: ref.hash, size: ref.size, exportName: baseName(ref.path) };
}

/** Maps one local drawable to its revision snapshot (contract mapping). */
export function toRevisionDrawable(d: ProjectDrawable): RevisionDrawable {
  return {
    id: d.id,
    gender: d.gender,
    kind: d.kind,
    type: d.type,
    mode: d.mode,
    replaceTargetId: d.replaceTargetId,
    label: d.label,
    groupId: d.groupId,
    ydd: d.ydd && toRevisionAssetRef(d.ydd),
    textures: d.textures.map(toRevisionAssetRef),
    physics: d.physics && toRevisionAssetRef(d.physics),
    firstPerson: d.firstPerson && toRevisionAssetRef(d.firstPerson),
    flags: { ...d.flags },
  };
}

export interface LocalAsset {
  ref: AssetRef;
  kind: UploadAssetKind;
}

/** All distinct local asset refs of a project, keyed by sha256. */
export function collectLocalAssets(
  project: AtelierProject,
): Map<string, LocalAsset> {
  const assets = new Map<string, LocalAsset>();
  const add = (ref: AssetRef | null) => {
    if (ref && !assets.has(ref.hash)) {
      assets.set(ref.hash, { ref, kind: assetKindOf(ref.path) });
    }
  };
  for (const d of project.drawables) {
    add(d.ydd);
    for (const t of d.textures) add(t);
    add(d.physics);
    add(d.firstPerson);
  }
  return assets;
}

// ---------------------------------------------------------------------------
// Revision -> local
// ---------------------------------------------------------------------------

export interface RemoteAssetTarget {
  sha256: string;
  size: number;
  exportName: string;
  /** Folder of the FIRST drawable referencing the asset (download target). */
  gender: ProjectDrawable["gender"];
  type: ProjectDrawable["type"];
}

/** Distinct assets of a revision, keyed by sha256 (first reference wins). */
export function collectRemoteAssets(
  drawables: RevisionDrawable[],
): Map<string, RemoteAssetTarget> {
  const assets = new Map<string, RemoteAssetTarget>();
  for (const d of drawables) {
    const add = (ref: RevisionAssetRef | null) => {
      if (ref && !assets.has(ref.sha256)) {
        assets.set(ref.sha256, {
          sha256: ref.sha256,
          size: ref.size,
          exportName: ref.exportName,
          gender: d.gender,
          type: d.type,
        });
      }
    };
    add(d.ydd);
    for (const t of d.textures) add(t);
    add(d.physics);
    add(d.firstPerson);
  }
  return assets;
}

/**
 * Maps a revision drawable back to a local one. `pathBySha` MUST contain a
 * project-relative path for every referenced sha256 (pull downloads them
 * first). Group references survive only when the local project still has the
 * group (groups are not synced); non-uuid ids get regenerated so the zod
 * schema keeps validating.
 */
export function fromRevisionDrawable(
  remote: RevisionDrawable,
  pathBySha: ReadonlyMap<string, string>,
  localGroupIds: ReadonlySet<string>,
): ProjectDrawable {
  const localRef = (ref: RevisionAssetRef | null): AssetRef | null => {
    if (!ref) return null;
    const path = pathBySha.get(ref.sha256);
    if (!path) {
      throw new Error(
        `Asset ${ref.exportName} (${ref.sha256.slice(0, 12)}…) wurde nicht heruntergeladen.`,
      );
    }
    return { path, hash: ref.sha256, size: ref.size };
  };

  return {
    id: UUID_RE.test(remote.id) ? remote.id : crypto.randomUUID(),
    gender: remote.gender,
    kind: remote.kind,
    type: remote.type,
    mode: remote.mode,
    replaceTargetId: remote.replaceTargetId,
    label: remote.label,
    groupId:
      remote.groupId !== null && localGroupIds.has(remote.groupId)
        ? remote.groupId
        : null,
    ydd: localRef(remote.ydd),
    textures: remote.textures.map((t) => localRef(t) as AssetRef),
    physics: localRef(remote.physics),
    firstPerson: localRef(remote.firstPerson),
    flags: { ...remote.flags },
  };
}
