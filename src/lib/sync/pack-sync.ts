/**
 * Cloud sync of the open project against atelier-api packs/revisions.
 *
 * PUSH: assets/check (batches of 500) -> upload missing files via the
 *       resumable chunk protocol -> POST revision with baseRevision
 *       (409 head_changed becomes a typed "conflict" result for the UI).
 * PULL: head manifest -> download missing CAS assets into
 *       <projectDir>/assets/<gender>/<type>/<exportName> (collision suffix)
 *       -> replace drawables + sync block in ONE undo step -> save.
 * LINK: writes the sync block (remoteProjectId) without touching content.
 *
 * All thrown errors carry German user-facing messages (surfaced via toasts).
 */

import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  ApiError,
  checkAssets,
  completeUpload,
  downloadAsset,
  getHeadManifest,
  getPack,
  initUpload,
  postRevision,
  putChunk,
  type RemoteRevision,
  type UploadSession,
} from "@/lib/sync/api-client";
import {
  collectLocalAssets,
  collectRemoteAssets,
  fromRevisionDrawable,
  sanitizeExportName,
  toRevisionDrawable,
  type LocalAsset,
} from "@/lib/sync/revision-mapping";
import { baseName } from "@/lib/format";
import { ASSETS_DIR_NAME, joinPath, saveProject } from "@/lib/project/io";
import { useProjectStore } from "@/lib/stores/project-store";
import type { AtelierProject, ProjectDrawable } from "@/lib/project/schema";

/** assets/check accepts at most 500 hashes per request. */
const CHECK_BATCH_SIZE = 500;

export type SyncPhase = "check" | "upload" | "commit" | "download";

export interface SyncProgress {
  phase: SyncPhase;
  current: number;
  total: number;
  label: string;
}

export type ProgressFn = (progress: SyncProgress) => void;

export type PushResult =
  | { status: "ok"; revision: number }
  /** Head moved — UI offers "pull" or "force push onto headRevision". */
  | { status: "conflict"; headRevision: number };

export interface PullResult {
  revision: number;
  downloadedAssets: number;
}

function requireLinkedProject(): {
  project: AtelierProject;
  projectDir: string;
  packId: string;
} {
  const { project, projectDir } = useProjectStore.getState();
  if (!project || !projectDir) {
    throw new Error("Kein Projekt geöffnet.");
  }
  const packId = project.sync.remoteProjectId;
  if (!packId) {
    throw new Error("Das Projekt ist noch nicht mit der Cloud verknüpft.");
  }
  return { project, projectDir, packId };
}

/** sha256 of raw bytes, hashed in the webview (same helper as the importer). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Persists the (already updated) store state to pack.atelier. */
async function saveOpenProject(): Promise<void> {
  const { project, projectDir, markSaved } = useProjectStore.getState();
  if (!project || !projectDir) return;
  await saveProject(projectDir, project);
  markSaved();
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

/**
 * Links the open project to a pack. baseRevision stays null — pushing onto a
 * pack that already has revisions therefore surfaces the conflict dialog
 * instead of silently overwriting the remote head.
 */
export async function linkProject(packId: string): Promise<void> {
  const { project, projectDir, setSyncState } = useProjectStore.getState();
  if (!project || !projectDir) throw new Error("Kein Projekt geöffnet.");
  setSyncState({ remoteProjectId: packId, baseRevision: null, lastSyncedAt: null });
  await saveOpenProject();
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** Uploads one local file via the resumable chunk protocol. */
async function uploadLocalAsset(projectDir: string, asset: LocalAsset): Promise<void> {
  const name = baseName(asset.ref.path);
  const absPath = joinPath(projectDir, asset.ref.path);

  let bytes: Uint8Array;
  try {
    bytes = await readFile(absPath);
  } catch {
    throw new Error(`Datei fehlt lokal: ${asset.ref.path}`);
  }

  // The revision will reference ref.hash — a drifted file would brick the
  // upload at /complete anyway, so fail early with a readable message.
  if ((await sha256Hex(bytes)) !== asset.ref.hash) {
    throw new Error(
      `„${name}" wurde außerhalb von atelier verändert (Hash weicht ab). Bitte die Datei neu importieren.`,
    );
  }

  let session: UploadSession;
  try {
    session = await initUpload({
      sha256: asset.ref.hash,
      kind: asset.kind,
      size: bytes.byteLength,
    });
  } catch (e) {
    // Someone else finished the same content in the meantime — done.
    if (e instanceof ApiError && e.status === 409 && e.message === "already_exists") return;
    throw e;
  }

  const received = new Set(session.receivedChunks);
  for (let index = 0; index < session.totalChunks; index++) {
    if (received.has(index)) continue; // resume path
    const start = index * session.chunkSize;
    const end = Math.min(start + session.chunkSize, bytes.byteLength);
    await putChunk(session.uploadId, index, bytes.subarray(start, end));
  }

  try {
    await completeUpload(session.uploadId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      throw new Error(`Upload von „${name}" ist fehlgeschlagen (Hash-Prüfung). Bitte erneut versuchen.`);
    }
    throw e;
  }
}

export interface PushOptions {
  /** Optional revision message (max 500 chars server-side). */
  message?: string;
  /** Conflict resolution: commit on top of the remote head ("erzwingen"). */
  baseRevisionOverride?: number;
  onProgress?: ProgressFn;
}

export async function pushProject(options: PushOptions = {}): Promise<PushResult> {
  const { project, projectDir, packId } = requireLinkedProject();
  const onProgress = options.onProgress ?? (() => {});

  const drawables = project.drawables.map(toRevisionDrawable);
  const localAssets = collectLocalAssets(project);

  // -- phase 1: which assets does the CAS already have? ----------------------
  const shas = [...localAssets.keys()];
  const missing: string[] = [];
  const batchCount = Math.max(1, Math.ceil(shas.length / CHECK_BATCH_SIZE));
  onProgress({ phase: "check", current: 0, total: batchCount, label: "Dateien werden geprüft…" });
  for (let i = 0; i < shas.length; i += CHECK_BATCH_SIZE) {
    const batch = shas.slice(i, i + CHECK_BATCH_SIZE);
    const result = await checkAssets(batch);
    missing.push(...result.missing);
    onProgress({
      phase: "check",
      current: Math.floor(i / CHECK_BATCH_SIZE) + 1,
      total: batchCount,
      label: "Dateien werden geprüft…",
    });
  }

  // -- phase 2: upload everything the server is missing ----------------------
  for (let i = 0; i < missing.length; i++) {
    const asset = localAssets.get(missing[i]);
    if (!asset) continue; // server reported a sha we never sent — ignore
    onProgress({
      phase: "upload",
      current: i,
      total: missing.length,
      label: baseName(asset.ref.path),
    });
    await uploadLocalAsset(projectDir, asset);
  }
  if (missing.length > 0) {
    onProgress({ phase: "upload", current: missing.length, total: missing.length, label: "Fertig" });
  }

  // -- phase 3: commit the revision ------------------------------------------
  onProgress({ phase: "commit", current: 0, total: 1, label: "Revision wird erstellt…" });
  const baseRevision =
    options.baseRevisionOverride ?? project.sync.baseRevision ?? 0;
  const result = await postRevision(packId, {
    baseRevision,
    message: options.message ?? "",
    drawables,
    // Server builds derive stream names/YMT hashes from this — must match
    // what a desktop build of the same project uses.
    dlcName: project.settings.dlcName,
  });

  if (!result.ok) {
    // 409 head_changed — resolve the actual head for the conflict dialog.
    const headRevision =
      result.head?.revision ?? (await getPack(packId)).headRevision;
    return { status: "conflict", headRevision };
  }

  useProjectStore.getState().setSyncState({
    remoteProjectId: packId,
    baseRevision: result.revision.revision,
    lastSyncedAt: new Date().toISOString(),
  });
  await saveOpenProject();
  onProgress({ phase: "commit", current: 1, total: 1, label: "Fertig" });
  return { status: "ok", revision: result.revision.revision };
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/** Free destination path inside assets/<gender>/<type>/ (collision suffix). */
async function resolveDownloadTarget(
  projectDir: string,
  gender: string,
  type: string,
  exportName: string,
): Promise<{ absPath: string; relPath: string }> {
  const destDir = joinPath(projectDir, ASSETS_DIR_NAME, gender, type);
  await mkdir(destDir, { recursive: true });

  const dot = exportName.lastIndexOf(".");
  const stem = dot === -1 ? exportName : exportName.slice(0, dot);
  const ext = dot === -1 ? "" : exportName.slice(dot);

  let destName = exportName;
  for (let i = 1; await exists(joinPath(destDir, destName)); i++) {
    destName = `${stem}_${i}${ext}`;
  }
  return {
    absPath: joinPath(destDir, destName),
    relPath: `${ASSETS_DIR_NAME}/${gender}/${type}/${destName}`,
  };
}

export interface PullOptions {
  onProgress?: ProgressFn;
}

export async function pullProject(options: PullOptions = {}): Promise<PullResult> {
  const { project, projectDir, packId } = requireLinkedProject();
  const onProgress = options.onProgress ?? (() => {});

  let manifest: RemoteRevision;
  try {
    manifest = await getHeadManifest(packId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      throw new Error("In der Cloud existiert noch keine Version dieses Packs.");
    }
    throw e;
  }

  // Reuse local files whose content we already have (matched by sha256).
  const pathBySha = new Map<string, string>();
  for (const [sha, asset] of collectLocalAssets(project)) {
    if (await exists(joinPath(projectDir, asset.ref.path))) {
      pathBySha.set(sha, asset.ref.path);
    }
  }

  const remoteAssets = collectRemoteAssets(manifest.drawables);
  const toDownload = [...remoteAssets.values()].filter((a) => !pathBySha.has(a.sha256));

  onProgress({
    phase: "download",
    current: 0,
    total: toDownload.length,
    label: toDownload.length === 0 ? "Alle Dateien sind bereits lokal vorhanden" : "Download startet…",
  });

  for (let i = 0; i < toDownload.length; i++) {
    const asset = toDownload[i];
    const exportName = sanitizeExportName(asset.exportName, asset.sha256);
    onProgress({ phase: "download", current: i, total: toDownload.length, label: exportName });

    const bytes = await downloadAsset(asset.sha256);
    if ((await sha256Hex(bytes)) !== asset.sha256) {
      throw new Error(`Download von „${exportName}" ist beschädigt angekommen. Bitte erneut versuchen.`);
    }
    const target = await resolveDownloadTarget(projectDir, asset.gender, asset.type, exportName);
    await writeFile(target.absPath, bytes);
    pathBySha.set(asset.sha256, target.relPath);
  }
  if (toDownload.length > 0) {
    onProgress({ phase: "download", current: toDownload.length, total: toDownload.length, label: "Fertig" });
  }

  const localGroupIds = new Set(project.groups.map((g) => g.id));
  const mapped: ProjectDrawable[] = manifest.drawables.map((d) =>
    fromRevisionDrawable(d, pathBySha, localGroupIds),
  );

  // ONE undo step: drawables + sync block together.
  useProjectStore.getState().applyPulledState(mapped, {
    remoteProjectId: packId,
    baseRevision: manifest.revision,
    lastSyncedAt: new Date().toISOString(),
  });
  await saveOpenProject();

  return { revision: manifest.revision, downloadedAssets: toDownload.length };
}
