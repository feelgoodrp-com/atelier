/**
 * Realtime live-workspace bridge.
 *
 * Existing Zustand actions stay the single UI mutation API. This bridge
 * observes project snapshots, derives stable-id/field-level operations,
 * uploads referenced binary assets before publishing them, and applies the
 * authoritative workspace after joins/reconnects. Accepted WebSocket
 * operations are applied directly for low latency; authenticated HTTP
 * snapshots recover any version gap.
 */

import { useEffect } from "react";
import {
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { baseName } from "@/lib/format";
import i18n from "@/lib/i18n";
import { ASSETS_DIR_NAME, CACHE_DIR_NAME, joinPath, saveProject } from "@/lib/project/io";
import {
  PROJECT_FILE_VERSION,
  atelierProjectSchema,
  type AssetRef,
  type AtelierProject,
} from "@/lib/project/schema";
import { useAuthStore, useCloudEnabled } from "@/lib/stores/auth-store";
import { useLiveStore } from "@/lib/stores/live-store";
import { clearProjectHistory, useProjectStore } from "@/lib/stores/project-store";
import { useTattooWorkbenchStore } from "@/lib/stores/tattoo-workbench-store";
import {
  ApiError,
  checkAssets,
  downloadAsset,
  getPack,
  getWorkspace,
  initializeWorkspace,
  postWorkspaceOperation,
  type LiveWorkspace,
  type RevisionAssetRef,
  type WorkspaceLeafOperation,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspaceTattoo,
} from "./api-client";
import { pullProject, uploadLocalAsset, type ProgressFn } from "./pack-sync";
import {
  collectLocalAssets,
  fromRevisionDrawable,
  sanitizeExportName,
  toRevisionDrawable,
} from "./revision-mapping";

const CHANGE_DEBOUNCE_MS = 120;
const RESYNC_DEBOUNCE_MS = 40;
const ASSET_CHECK_BATCH = 500;
const ASSET_UPLOAD_CONCURRENCY = 3;
const ASSET_DOWNLOAD_CONCURRENCY = 3;
const OPERATION_BATCH_SIZE = 500;
const LIVE_QUEUE_SCHEMA_VERSION = 1;
const OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface PendingOperation {
  packId: string;
  sessionKey: string;
  operationId: string;
  operation: WorkspaceOperation;
  localProject: AtelierProject;
}

interface PersistedLiveQueue {
  schemaVersion: typeof LIVE_QUEUE_SCHEMA_VERSION;
  packId: string;
  operations: PendingOperation[];
}

let targetPackId: string | null = null;
let targetSessionKey: string | null = null;
let targetProjectDir: string | null = null;
let suppressStoreEvents = false;
let observedProject: AtelierProject | null = null;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let projectSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingBase: WorkspaceProject | null = null;
let pendingLatest: WorkspaceProject | null = null;
let pendingLocalProject: AtelierProject | null = null;
let sendChain: Promise<void> = Promise.resolve();
let pendingOperations: PendingOperation[] = [];
const knownServerAssets = new Set<string>();
let unsubscribeProject: (() => void) | null = null;
let bootstrapTask: Promise<void> | null = null;
let queueWriteChain: Promise<void> = Promise.resolve();
let remoteApplyChain: Promise<void> = Promise.resolve();

class LiveQueuePersistenceError extends Error {
  constructor(cause: unknown) {
    super(`Live-Warteschlange konnte nicht gespeichert werden: ${errorMessage(cause)}`);
    this.name = "LiveQueuePersistenceError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function liveSessionKey(packId: string): string | null {
  const { project, projectDir } = useProjectStore.getState();
  if (!project || !projectDir || project.sync.remoteProjectId !== packId) return null;
  return `${projectDir}\u0000${project.id}\u0000${packId}`;
}

function targetSessionIsCurrent(packId = targetPackId): boolean {
  return (
    packId !== null &&
    packId === targetPackId &&
    targetSessionKey !== null &&
    liveSessionKey(packId) === targetSessionKey
  );
}

function scheduleOpenProjectSave(): void {
  if (projectSaveTimer) clearTimeout(projectSaveTimer);
  projectSaveTimer = setTimeout(() => {
    projectSaveTimer = null;
    const { project, projectDir } = useProjectStore.getState();
    if (!project || !projectDir) return;
    const snapshot = project;
    void saveProject(projectDir, snapshot)
      .then(() => {
        const state = useProjectStore.getState();
        if (state.project !== snapshot) return;
        state.markSaved();
        if (pendingOperations.length > 0 || pendingBase !== null) state.markDirty();
      })
      .catch((error) => {
        useLiveStore.getState().setStatus("error", errorMessage(error));
      });
  }, 400);
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function queueFilePath(projectDir: string, packId: string): string {
  const safePackId = packId.replace(/[^a-z0-9-]/giu, "_");
  return joinPath(projectDir, CACHE_DIR_NAME, `live-queue-${safePackId}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsUnsafeObjectKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeObjectKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      containsUnsafeObjectKey(nested),
  );
}

function isWorkspaceLeafOperation(value: unknown): value is WorkspaceLeafOperation {
  if (!isRecord(value) || typeof value.kind !== "string" || containsUnsafeObjectKey(value)) {
    return false;
  }
  if (value.kind === "project.patch") return isRecord(value.patch);
  const entityType = value.entityType;
  if (entityType !== "group" && entityType !== "drawable" && entityType !== "tattoo") {
    return false;
  }
  if (value.kind === "entity.upsert") {
    return isRecord(value.entity) && typeof value.entity.id === "string";
  }
  if (value.kind === "entity.patch") {
    return typeof value.id === "string" && isRecord(value.patch);
  }
  if (value.kind === "entity.delete") return typeof value.id === "string";
  return (
    value.kind === "order.set" &&
    entityType !== "group" &&
    Array.isArray(value.ids) &&
    value.ids.every((id) => typeof id === "string")
  );
}

function isWorkspaceOperation(value: unknown): value is WorkspaceOperation {
  if (isWorkspaceLeafOperation(value)) return true;
  return (
    isRecord(value) &&
    value.kind === "batch" &&
    Array.isArray(value.operations) &&
    value.operations.length > 0 &&
    value.operations.length <= 1_000 &&
    value.operations.every(isWorkspaceLeafOperation)
  );
}

async function restorePendingQueue(packId: string): Promise<void> {
  const projectDir = targetProjectDir;
  const expectedSessionKey = targetSessionKey;
  if (!projectDir) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(queueFilePath(projectDir, packId)));
  } catch {
    return;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== LIVE_QUEUE_SCHEMA_VERSION ||
    (parsed as { packId?: unknown }).packId !== packId ||
    !Array.isArray((parsed as { operations?: unknown }).operations)
  ) {
    return;
  }
  const restored: PendingOperation[] = [];
  for (const item of (parsed as PersistedLiveQueue).operations) {
    if (
      typeof item?.operationId !== "string" ||
      !OPERATION_ID_RE.test(item.operationId) ||
      item.packId !== packId ||
      !isWorkspaceOperation(item.operation)
    ) {
      continue;
    }
    const localProject = atelierProjectSchema.safeParse(item.localProject);
    if (!localProject.success) continue;
    restored.push({
      packId,
      sessionKey: targetSessionKey ?? "",
      operationId: item.operationId,
      operation: item.operation,
      localProject: localProject.data,
    });
  }
  if (
    targetPackId !== packId ||
    targetSessionKey !== expectedSessionKey ||
    !targetSessionIsCurrent(packId)
  ) return;
  pendingOperations = restored;
  useLiveStore.getState().setPending(restored.length);
}

function persistPendingQueue(packId = targetPackId): Promise<void> {
  const projectDir = targetProjectDir;
  if (!projectDir || !packId) return Promise.resolve();
  const operations = structuredClone(pendingOperations);
  const path = queueFilePath(projectDir, packId);
  const write = queueWriteChain
    .catch(() => {})
    .then(async () => {
      try {
        await mkdir(joinPath(projectDir, CACHE_DIR_NAME), { recursive: true });
        if (operations.length === 0) {
          if (await exists(path)) await remove(path);
          return;
        }
        const tmpPath = `${path}.part`;
        const payload: PersistedLiveQueue = {
          schemaVersion: LIVE_QUEUE_SCHEMA_VERSION,
          packId,
          operations,
        };
        await writeTextFile(tmpPath, JSON.stringify(payload));
        try {
          await rename(tmpPath, path);
        } finally {
          await remove(tmpPath).catch(() => {});
        }
      } catch (error) {
        throw new LiveQueuePersistenceError(error);
      }
    });
  // Keep the shared chain handled so fire-and-forget cursor/ack writes never
  // create an unhandled rejection. Callers that need durability await `write`.
  queueWriteChain = write.catch((error) => {
    if (targetProjectDir === projectDir && targetPackId === packId) {
      useLiveStore.getState().setStatus("error", errorMessage(error));
    }
  });
  return write;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toRemoteAsset(ref: AssetRef | null): RevisionAssetRef | null {
  return ref ? { sha256: ref.hash, size: ref.size, exportName: baseName(ref.path) } : null;
}

function toWorkspaceTattoo(tattoo: AtelierProject["tattoos"][number]): WorkspaceTattoo {
  return { ...tattoo, image: toRemoteAsset(tattoo.image) };
}

export function toWorkspaceProject(project: AtelierProject): WorkspaceProject {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    settings: { ...project.settings },
    groups: project.groups.map((group) => ({ ...group })),
    drawables: project.drawables.map(toRevisionDrawable),
    tattooCollection: { ...project.tattooCollection },
    tattoos: project.tattoos.map(toWorkspaceTattoo),
  };
}

function mergeObject(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      next[key] !== null &&
      typeof next[key] === "object" &&
      !Array.isArray(next[key])
    ) {
      next[key] = mergeObject(
        next[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      next[key] = value;
    }
  }
  return next;
}

function applyLeaf(project: WorkspaceProject, operation: WorkspaceLeafOperation): WorkspaceProject {
  const next = structuredClone(project);
  if (operation.kind === "project.patch") {
    if (operation.patch.name !== undefined) next.name = operation.patch.name;
    if (operation.patch.settings !== undefined) {
      next.settings = { ...next.settings, ...operation.patch.settings };
    }
    if (operation.patch.tattooCollection !== undefined) {
      next.tattooCollection = {
        ...next.tattooCollection,
        ...operation.patch.tattooCollection,
      };
    }
    return next;
  }

  const key =
    operation.entityType === "group"
      ? "groups"
      : operation.entityType === "drawable"
        ? "drawables"
        : "tattoos";
  const list = next[key] as Array<{ id: string }>;
  if (operation.kind === "entity.delete") {
    (next as unknown as Record<string, unknown>)[key] = list.filter(
      (item) => item.id !== operation.id,
    );
    if (operation.entityType === "group") {
      next.drawables = next.drawables.map((drawable) =>
        drawable.groupId === operation.id ? { ...drawable, groupId: null } : drawable,
      );
      next.tattoos = next.tattoos.map((tattoo) =>
        tattoo.groupId === operation.id ? { ...tattoo, groupId: null } : tattoo,
      );
    }
    return next;
  }
  if (operation.kind === "entity.upsert") {
    const entity = operation.entity as { id: string };
    const index = list.findIndex((item) => item.id === entity.id);
    if (index === -1) list.push(entity);
    else list[index] = entity;
    return next;
  }
  if (operation.kind === "entity.patch") {
    const index = list.findIndex((item) => item.id === operation.id);
    if (index !== -1) {
      list[index] = mergeObject(
        list[index] as unknown as Record<string, unknown>,
        operation.patch,
      ) as unknown as { id: string };
      list[index]!.id = operation.id;
    }
    return next;
  }

  const byId = new Map(list.map((item) => [item.id, item]));
  const used = new Set<string>();
  const ordered: Array<{ id: string }> = [];
  for (const id of operation.ids) {
    const item = byId.get(id);
    if (item && !used.has(id)) {
      used.add(id);
      ordered.push(item);
    }
  }
  for (const item of list) if (!used.has(item.id)) ordered.push(item);
  (next as unknown as Record<string, unknown>)[key] = ordered;
  return next;
}

function applyOperation(project: WorkspaceProject, operation: WorkspaceOperation): WorkspaceProject {
  const operations = operation.kind === "batch" ? operation.operations : [operation];
  return operations.reduce(applyLeaf, project);
}

function objectPatch(before: Record<string, unknown>, after: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (key === "id" || equal(before[key], value)) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      before[key] !== null &&
      typeof before[key] === "object" &&
      !Array.isArray(before[key])
    ) {
      const nested = objectPatch(
        before[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      if (Object.keys(nested).length > 0) patch[key] = nested;
    } else {
      patch[key] = value;
    }
  }
  return patch;
}

function diffEntities(
  entityType: "group" | "drawable" | "tattoo",
  before: Array<{ id: string }>,
  after: Array<{ id: string }>,
): WorkspaceLeafOperation[] {
  const operations: WorkspaceLeafOperation[] = [];
  const beforeById = new Map(before.map((entity) => [entity.id, entity]));
  const afterById = new Map(after.map((entity) => [entity.id, entity]));
  for (const entity of before) {
    if (!afterById.has(entity.id)) {
      operations.push({ kind: "entity.delete", entityType, id: entity.id });
    }
  }
  for (const entity of after) {
    const previous = beforeById.get(entity.id);
    if (!previous) {
      operations.push({ kind: "entity.upsert", entityType, entity } as WorkspaceLeafOperation);
      continue;
    }
    const patch = objectPatch(
      previous as unknown as Record<string, unknown>,
      entity as unknown as Record<string, unknown>,
    );
    if (Object.keys(patch).length > 0) {
      operations.push({ kind: "entity.patch", entityType, id: entity.id, patch });
    }
  }
  if (
    entityType !== "group" &&
    !equal(before.map((entity) => entity.id), after.map((entity) => entity.id))
  ) {
    operations.push({
      kind: "order.set",
      entityType,
      ids: after.map((entity) => entity.id),
    });
  }
  return operations;
}

export function diffWorkspaceProjects(
  before: WorkspaceProject,
  after: WorkspaceProject,
): WorkspaceOperation | null {
  const operations: WorkspaceLeafOperation[] = [];
  const projectPatch: Extract<WorkspaceLeafOperation, { kind: "project.patch" }>["patch"] = {};
  if (before.name !== after.name) projectPatch.name = after.name;
  if (!equal(before.settings, after.settings)) {
    projectPatch.settings = objectPatch(
      before.settings as unknown as Record<string, unknown>,
      after.settings as unknown as Record<string, unknown>,
    );
  }
  if (!equal(before.tattooCollection, after.tattooCollection)) {
    projectPatch.tattooCollection = objectPatch(
      before.tattooCollection as unknown as Record<string, unknown>,
      after.tattooCollection as unknown as Record<string, unknown>,
    );
  }
  if (Object.keys(projectPatch).length > 0) {
    operations.push({ kind: "project.patch", patch: projectPatch });
  }
  operations.push(...diffEntities("group", before.groups, after.groups));
  operations.push(...diffEntities("drawable", before.drawables, after.drawables));
  operations.push(...diffEntities("tattoo", before.tattoos, after.tattoos));
  if (operations.length === 0) return null;
  return operations.length === 1 ? operations[0]! : { kind: "batch", operations };
}

function liveProgress(direction: "push" | "pull"): ProgressFn {
  return (progress) => useLiveStore.getState().setTransfer({ direction, progress });
}

async function ensureProjectAssetsUploaded(
  project: AtelierProject,
  onProgress: ProgressFn = () => {},
): Promise<void> {
  const { projectDir } = useProjectStore.getState();
  if (!projectDir) throw new Error("Kein Projektordner geöffnet.");
  const assets = collectLocalAssets(project);
  const hashes = [...assets.keys()].filter((hash) => !knownServerAssets.has(hash));
  const missing: string[] = [];
  const checkTotal = Math.max(1, Math.ceil(hashes.length / ASSET_CHECK_BATCH));
  onProgress({
    phase: "check",
    current: hashes.length === 0 ? 1 : 0,
    total: checkTotal,
    label:
      hashes.length === 0
        ? i18n.t("sync:progress.allLocal")
        : i18n.t("sync:progress.checking"),
  });
  for (let index = 0; index < hashes.length; index += ASSET_CHECK_BATCH) {
    const result = await checkAssets(hashes.slice(index, index + ASSET_CHECK_BATCH));
    missing.push(...result.missing);
    result.present.forEach((hash) => knownServerAssets.add(hash));
    onProgress({
      phase: "check",
      current: Math.floor(index / ASSET_CHECK_BATCH) + 1,
      total: checkTotal,
      label: i18n.t("sync:progress.checking"),
    });
  }
  let cursor = 0;
  let completed = 0;
  const uploadNext = async (): Promise<void> => {
    while (cursor < missing.length) {
      const hash = missing[cursor++]!;
      const asset = assets.get(hash);
      if (asset) {
        const label = baseName(asset.ref.path);
        onProgress({ phase: "upload", current: completed, total: missing.length, label });
        await uploadLocalAsset(projectDir, asset);
        knownServerAssets.add(hash);
        completed += 1;
        onProgress({ phase: "upload", current: completed, total: missing.length, label });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(ASSET_UPLOAD_CONCURRENCY, missing.length) },
      () => uploadNext(),
    ),
  );
  if (missing.length === 0) {
    onProgress({
      phase: "upload",
      current: 1,
      total: 1,
      label: i18n.t("sync:progress.allLocal"),
    });
  }
}

async function localPathMap(
  project: AtelierProject,
  projectDir: string,
  trustCurrentRefs: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const assets = [...collectLocalAssets(project)];
  let cursor = 0;
  const verifyNext = async (): Promise<void> => {
    while (cursor < assets.length) {
      const [sha, asset] = assets[cursor++]!;
      if (trustCurrentRefs) {
        map.set(sha, asset.ref.path);
        continue;
      }
      const path = joinPath(projectDir, asset.ref.path);
      if (!(await exists(path))) continue;
      const bytes = await readFile(path);
      if (bytes.byteLength === asset.ref.size && (await sha256Hex(bytes)) === sha) {
        map.set(sha, asset.ref.path);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(ASSET_DOWNLOAD_CONCURRENCY, assets.length) },
      () => verifyNext(),
    ),
  );
  return map;
}

function allRemoteAssets(project: WorkspaceProject): RevisionAssetRef[] {
  const bySha = new Map<string, RevisionAssetRef>();
  const add = (asset: RevisionAssetRef | null) => {
    if (asset && !bySha.has(asset.sha256)) bySha.set(asset.sha256, asset);
  };
  for (const drawable of project.drawables) {
    add(drawable.ydd);
    drawable.textures.forEach(add);
    add(drawable.physics);
    add(drawable.firstPerson);
  }
  for (const tattoo of project.tattoos) add(tattoo.image);
  return [...bySha.values()];
}

async function ensureRemoteAssets(
  cloud: WorkspaceProject,
  current: AtelierProject,
  projectDir: string,
  trustCurrentRefs = false,
  onProgress: ProgressFn = () => {},
): Promise<Map<string, string>> {
  const paths = await localPathMap(current, projectDir, trustCurrentRefs);
  const missingAssets = allRemoteAssets(cloud).filter((asset) => !paths.has(asset.sha256));
  if (missingAssets.length === 0) {
    onProgress({
      phase: "download",
      current: 1,
      total: 1,
      label: i18n.t("sync:progress.allLocal"),
    });
    return paths;
  }
  onProgress({
    phase: "download",
    current: 0,
    total: missingAssets.length,
    label: i18n.t("sync:progress.downloadStarting"),
  });
  const cloudDir = joinPath(projectDir, ASSETS_DIR_NAME, ".cloud");
  await mkdir(cloudDir, { recursive: true });
  let completed = 0;
  const materialize = async (asset: RevisionAssetRef): Promise<void> => {
    const safeName = sanitizeExportName(asset.exportName, asset.sha256);
    const relPath = `${ASSETS_DIR_NAME}/.cloud/${asset.sha256.slice(0, 16)}-${safeName}`;
    const absPath = joinPath(projectDir, relPath);
    if (await exists(absPath)) {
      const bytes = await readFile(absPath);
      if ((await sha256Hex(bytes)) === asset.sha256) {
        paths.set(asset.sha256, relPath);
        completed += 1;
        onProgress({
          phase: "download",
          current: completed,
          total: missingAssets.length,
          label: safeName,
        });
        return;
      }
    }
    onProgress({
      phase: "download",
      current: completed,
      total: missingAssets.length,
      label: safeName,
    });
    const bytes = await downloadAsset(asset.sha256);
    if ((await sha256Hex(bytes)) !== asset.sha256) {
      throw new Error(`Cloud-Datei ${safeName} ist beschädigt.`);
    }
    const tmpPath = `${absPath}.part-${crypto.randomUUID()}`;
    await writeFile(tmpPath, bytes);
    try {
      await rename(tmpPath, absPath);
    } finally {
      await remove(tmpPath).catch(() => {});
    }
    paths.set(asset.sha256, relPath);
    completed += 1;
    onProgress({
      phase: "download",
      current: completed,
      total: missingAssets.length,
      label: safeName,
    });
  };
  let cursor = 0;
  const downloadNext = async (): Promise<void> => {
    while (cursor < missingAssets.length) {
      await materialize(missingAssets[cursor++]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(ASSET_DOWNLOAD_CONCURRENCY, missingAssets.length) },
      () => downloadNext(),
    ),
  );
  return paths;
}

async function materializeWorkspace(
  workspace: LiveWorkspace,
  overlayPending = true,
  trustCurrentRefs = false,
  onProgress: ProgressFn = () => {},
): Promise<AtelierProject> {
  const initialState = useProjectStore.getState();
  if (!initialState.project || !initialState.projectDir) {
    throw new Error("Kein Projekt geöffnet.");
  }
  const projectDir = initialState.projectDir;
  const withPendingOverlay = (): WorkspaceProject => {
    let next = structuredClone(workspace.project);
    if (!overlayPending) return next;
    for (const pending of pendingOperations) next = applyOperation(next, pending.operation);
    if (pendingBase && pendingLatest) {
      const scheduled = diffWorkspaceProjects(pendingBase, pendingLatest);
      if (scheduled) next = applyOperation(next, scheduled);
    }
    return next;
  };

  let current = initialState.project;
  let cloud = withPendingOverlay();
  let paths: Map<string, string>;
  // Asset downloads can take long enough for another local edit to happen.
  // Rebuild the optimistic overlay after every await and materialize any newly
  // introduced binary before replacing the store, otherwise that edit could
  // be overwritten by the older snapshot.
  while (true) {
    paths = await ensureRemoteAssets(cloud, current, projectDir, trustCurrentRefs, onProgress);
    const latestState = useProjectStore.getState();
    if (!latestState.project) throw new Error("Kein Projekt geöffnet.");
    current = latestState.project;
    const latestCloud = withPendingOverlay();
    if (allRemoteAssets(latestCloud).every((asset) => paths.has(asset.sha256))) {
      cloud = latestCloud;
      break;
    }
    cloud = latestCloud;
  }
  const localGroups = new Set(cloud.groups.map((group) => group.id));
  const localRef = (asset: RevisionAssetRef | null): AssetRef | null => {
    if (!asset) return null;
    const path = paths.get(asset.sha256);
    if (!path) throw new Error(`Cloud-Datei ${asset.exportName} wurde nicht materialisiert.`);
    return { path, hash: asset.sha256, size: asset.size };
  };
  const now = new Date().toISOString();
  return {
    fgcloth: PROJECT_FILE_VERSION,
    id: cloud.id,
    name: cloud.name,
    createdAt: cloud.createdAt,
    updatedAt: now,
    settings: { ...cloud.settings },
    groups: cloud.groups.map((group) => ({ ...group })),
    drawables: cloud.drawables.map((drawable) =>
      fromRevisionDrawable(drawable, paths, localGroups),
    ),
    tattooCollection: { ...cloud.tattooCollection },
    tattoos: cloud.tattoos.map((tattoo) => ({
      ...tattoo,
      image: localRef(tattoo.image),
    })),
    sync: {
      remoteProjectId: workspace.packId,
      baseRevision: current.sync.baseRevision,
      workspaceVersion: workspace.version,
      lastSyncedAt: now,
    },
  };
}

async function applyAuthoritativeWorkspace(
  workspace: LiveWorkspace,
  trustCurrentRefs = false,
  onProgress: ProgressFn = () => {},
): Promise<void> {
  if (workspace.packId !== targetPackId || !targetSessionIsCurrent(workspace.packId)) return;
  const beforeVersion = useLiveStore.getState().version;
  if (beforeVersion !== null && workspace.version < beforeVersion) return;
  const local = await materializeWorkspace(workspace, true, trustCurrentRefs, onProgress);
  if (workspace.packId !== targetPackId || !targetSessionIsCurrent(workspace.packId)) return;
  const latestVersion = useLiveStore.getState().version;
  if (latestVersion !== null && workspace.version < latestVersion) return;
  suppressStoreEvents = true;
  try {
    useProjectStore.getState().applyLiveProject(local);
    // zundo snapshots contain the whole project. Keeping a snapshot from
    // before a teammate's operation would let a later local Undo overwrite
    // that teammate's accepted change, so stale history must not survive an
    // authoritative replacement.
    clearProjectHistory();
    const tattooIds = new Set(local.tattoos.map((tattoo) => tattoo.id));
    const tattooWorkbench = useTattooWorkbenchStore.getState();
    const validTattooSelection = tattooWorkbench.selection.filter((id) => tattooIds.has(id));
    if (validTattooSelection.length !== tattooWorkbench.selection.length) {
      tattooWorkbench.setSelection(validTattooSelection);
    }
    observedProject = local;
  } finally {
    suppressStoreEvents = false;
  }
  scheduleOpenProjectSave();
  allRemoteAssets(workspace.project).forEach((asset) => knownServerAssets.add(asset.sha256));
  useLiveStore.getState().setVersion(workspace.version);
}

async function fetchAndApplyWorkspace(onProgress: ProgressFn = () => {}): Promise<number | null> {
  const packId = targetPackId;
  if (!packId) return null;
  const workspace = await getWorkspace(packId);
  await applyAuthoritativeWorkspace(workspace, false, onProgress);
  if (targetPackId === packId) useLiveStore.getState().setStatus("online");
  return workspace.version;
}

function scheduleResync(): void {
  if (!targetPackId || resyncTimer) return;
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    const bootstrap = bootstrapTask;
    void (async () => {
      // Queue restoration is the first bootstrap step. A joined/broadcast
      // resync must not overtake it and replace locally persisted optimistic
      // edits before their durable operations have been overlaid.
      if (bootstrap) await bootstrap.catch(() => {});
      await fetchAndApplyWorkspace();
    })().catch((error) => {
      useLiveStore.getState().setStatus("error", errorMessage(error));
    });
  }, RESYNC_DEBOUNCE_MS);
}

async function applyBroadcastOperation(
  expectedPackId: string,
  version: number,
  operation: WorkspaceOperation,
): Promise<void> {
  const packId = targetPackId;
  const currentVersion = useLiveStore.getState().version;
  if (!packId || packId !== expectedPackId) return;
  if (currentVersion === null) {
    // A broadcast can race the first HTTP snapshot during startup. There is no
    // safe base to apply it to yet, so fetch the now-committed authoritative
    // version instead of silently dropping the only notification.
    scheduleResync();
    return;
  }
  if (version <= currentVersion) return;
  if (version !== currentVersion + 1) {
    scheduleResync();
    return;
  }
  const current = useProjectStore.getState().project;
  if (!current || current.sync.remoteProjectId !== packId) return;
  const workspace: LiveWorkspace = {
    packId,
    schemaVersion: 1,
    version,
    project: applyOperation(toWorkspaceProject(current), operation),
    updatedAt: new Date().toISOString(),
    updatedByDiscordId: "",
  };
  // Existing local refs are already hash-verified by the importer/optimizer.
  // This lets metadata-only broadcasts update the UI immediately; only a new
  // remote binary needs an authenticated CAS download first.
  await applyAuthoritativeWorkspace(workspace, true);
}

function queueBroadcastOperation(
  packId: string,
  version: number,
  operation: WorkspaceOperation,
): void {
  remoteApplyChain = remoteApplyChain
    .catch(() => {})
    .then(() => applyBroadcastOperation(packId, version, operation))
    .catch((error) => {
      if (targetPackId !== packId) return;
      useLiveStore.getState().setStatus("error", errorMessage(error));
      scheduleResync();
    });
}

async function persistSyncCursor(version: number): Promise<void> {
  suppressStoreEvents = true;
  try {
    const state = useProjectStore.getState();
    if (!state.project) return;
    state.setSyncState({
      ...state.project.sync,
      workspaceVersion: version,
      lastSyncedAt: new Date().toISOString(),
    });
    observedProject = useProjectStore.getState().project;
  } finally {
    suppressStoreEvents = false;
  }
  scheduleOpenProjectSave();
}

function removePending(operationId: string): void {
  pendingOperations = pendingOperations.filter((item) => item.operationId !== operationId);
  useLiveStore.getState().setPending(pendingOperations.length + (pendingBase ? 1 : 0));
  persistPendingQueue();
}

function workspaceErrorCode(error: ApiError): string {
  return typeof error.details?.error === "string" ? error.details.error : error.message;
}

/** 4xx does not always mean the operation is invalid. Busy/rate-limit/auth and
 * missing-CAS responses are recoverable and must retain the durable outbox. */
export function shouldRetryWorkspaceRequest(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  const code = workspaceErrorCode(error);
  return (
    error.status === 401 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500 ||
    code === "workspace_busy" ||
    code === "missing_assets"
  );
}

async function sendPending(item: PendingOperation): Promise<void> {
  let retryMs = 750;
  let queuePersisted = false;
  while (targetSessionIsCurrent(item.packId) && targetSessionKey === item.sessionKey) {
    const packId = item.packId;
    try {
      // Never begin an ambiguous network write until the operation id and
      // payload are recoverable after a crash.
      if (!queuePersisted) {
        await persistPendingQueue(packId);
        queuePersisted = true;
      }
      await ensureProjectAssetsUploaded(item.localProject);
      const baseVersion = useLiveStore.getState().version ?? 0;
      const result = await postWorkspaceOperation(packId, {
        operationId: item.operationId,
        baseVersion,
        operation: item.operation,
      });
      if (packId !== targetPackId || targetSessionKey !== item.sessionKey) return;
      removePending(item.operationId);
      const knownVersion = useLiveStore.getState().version ?? 0;
      const acceptedVersion = Math.max(knownVersion, result.version);
      useLiveStore.getState().setVersion(acceptedVersion);
      useLiveStore.getState().setStatus("online");
      await persistSyncCursor(acceptedVersion);
      if (result.rebased || result.duplicate || result.version < acceptedVersion) scheduleResync();
      return;
    } catch (error) {
      if (packId !== targetPackId || targetSessionKey !== item.sessionKey) return;
      if (error instanceof ApiError && workspaceErrorCode(error) === "missing_assets") {
        const missing = error.details?.missing;
        if (Array.isArray(missing)) {
          for (const sha of missing) if (typeof sha === "string") knownServerAssets.delete(sha);
        }
      }
      if (error instanceof ApiError && !shouldRetryWorkspaceRequest(error)) {
        removePending(item.operationId);
        useLiveStore.getState().setStatus("error", error.message);
        toast.error("Live-Änderung konnte nicht übernommen werden", {
          description: workspaceErrorCode(error) === "locked"
            ? "Das Objekt wird gerade von einem anderen Teammitglied bearbeitet."
            : error.message,
        });
        // Revert only the rejected optimistic operation, while overlaying any
        // later durable operations before their serial send turn starts.
        try {
          await fetchAndApplyWorkspace();
        } catch (resyncError) {
          useLiveStore.getState().setStatus("error", errorMessage(resyncError));
          scheduleResync();
        }
        return;
      }
      useLiveStore.getState().setStatus(
        error instanceof LiveQueuePersistenceError ? "error" : "connecting",
        errorMessage(error),
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      retryMs = Math.min(10_000, retryMs * 2);
    }
  }
}

function enqueueOperation(operation: WorkspaceOperation, localProject: AtelierProject): void {
  if (!targetPackId) return;
  const item: PendingOperation = {
    packId: targetPackId,
    sessionKey: targetSessionKey ?? "",
    operationId: crypto.randomUUID(),
    operation,
    localProject,
  };
  pendingOperations.push(item);
  useLiveStore.getState().setPending(pendingOperations.length);
  persistPendingQueue();
  sendChain = sendChain.then(() => sendPending(item)).catch(() => {});
}

function enqueueOperationChunks(
  operation: WorkspaceOperation,
  localProject: AtelierProject,
): void {
  const leaves = operation.kind === "batch" ? operation.operations : [operation];
  for (let index = 0; index < leaves.length; index += OPERATION_BATCH_SIZE) {
    const chunk = leaves.slice(index, index + OPERATION_BATCH_SIZE);
    enqueueOperation(
      chunk.length === 1 ? chunk[0]! : { kind: "batch", operations: chunk },
      localProject,
    );
  }
}

function flushLocalChanges(): void {
  mutationTimer = null;
  const before = pendingBase;
  const after = pendingLatest;
  const localProject = pendingLocalProject;
  pendingBase = null;
  pendingLatest = null;
  pendingLocalProject = null;
  if (!before || !after || !localProject || !targetPackId) return;
  const operation = diffWorkspaceProjects(before, after);
  if (operation) enqueueOperationChunks(operation, localProject);
}

function observeProjectChanges(): void {
  if (unsubscribeProject) return;
  observedProject = useProjectStore.getState().project;
  unsubscribeProject = useProjectStore.subscribe((state) => {
    const current = state.project;
    const previous = observedProject;
    observedProject = current;
    if (
      suppressStoreEvents ||
      !targetPackId ||
      !targetSessionIsCurrent() ||
      !current ||
      !previous
    ) return;
    if (
      current.sync.remoteProjectId !== targetPackId ||
      previous.sync.remoteProjectId !== targetPackId
    ) {
      return;
    }
    const before = toWorkspaceProject(previous);
    const after = toWorkspaceProject(current);
    if (equal(before, after)) return; // sync cursor / updatedAt only
    if (!pendingBase) pendingBase = before;
    pendingLatest = after;
    pendingLocalProject = current;
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(flushLocalChanges, CHANGE_DEBOUNCE_MS);
    useLiveStore.getState().setPending(pendingOperations.length + 1);
  });
}

async function bootstrapWorkspace(packId: string): Promise<void> {
  const expectedSessionKey = targetSessionKey;
  const stillCurrent = () =>
    expectedSessionKey !== null &&
    targetSessionKey === expectedSessionKey &&
    targetSessionIsCurrent(packId);
  useLiveStore.getState().setStatus("syncing");
  const reportPull = liveProgress("pull");
  const reportPush = liveProgress("push");
  reportPull({
    phase: "download",
    current: 0,
    total: 1,
    label: i18n.t("sync:progress.workspaceLoading"),
  });
  try {
    let project = useProjectStore.getState().project;
    if (!project || project.sync.remoteProjectId !== packId) return;
    await restorePendingQueue(packId);
    if (!stillCurrent()) return;
    try {
      const existing = await getWorkspace(packId);
      if (!stillCurrent()) return;
      await applyAuthoritativeWorkspace(existing, false, reportPull);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      if (!stillCurrent()) return;
      const pack = await getPack(packId);
      if (!stillCurrent()) return;
      if (pack.headRevision > 0 && project.sync.baseRevision !== pack.headRevision) {
        await pullProject({ onProgress: reportPull });
        if (!stillCurrent()) return;
        project = useProjectStore.getState().project;
        if (!project) return;
      }
      await ensureProjectAssetsUploaded(project, reportPush);
      if (!stillCurrent()) return;
      reportPush({
        phase: "commit",
        current: 0,
        total: 1,
        label: i18n.t("sync:progress.workspaceInitializing"),
      });
      const initialized = await initializeWorkspace(
        packId,
        toWorkspaceProject(project),
        pack.headRevision,
      );
      if (!stillCurrent()) return;
      reportPush({
        phase: "commit",
        current: 1,
        total: 1,
        label: i18n.t("sync:progress.done"),
      });
      await applyAuthoritativeWorkspace(initialized);
    }
    if (stillCurrent()) {
      useLiveStore.getState().setStatus("online");
      for (const item of pendingOperations) {
        sendChain = sendChain.then(() => sendPending(item)).catch(() => {});
      }
    }
  } finally {
    if (stillCurrent()) useLiveStore.getState().setTransfer(null);
  }
}

export function setLiveWorkspaceTarget(packId: string | null): void {
  const nextSessionKey = packId ? liveSessionKey(packId) : null;
  if (targetPackId === packId && targetSessionKey === nextSessionKey) return;
  if (targetPackId && pendingBase && pendingLatest && pendingLocalProject) {
    flushLocalChanges();
  }
  targetPackId = packId;
  targetSessionKey = nextSessionKey;
  targetProjectDir = nextSessionKey ? useProjectStore.getState().projectDir : null;
  if (mutationTimer) clearTimeout(mutationTimer);
  if (resyncTimer) clearTimeout(resyncTimer);
  mutationTimer = null;
  resyncTimer = null;
  pendingBase = null;
  pendingLatest = null;
  pendingLocalProject = null;
  pendingOperations = [];
  sendChain = Promise.resolve();
  remoteApplyChain = Promise.resolve();
  knownServerAssets.clear();
  useLiveStore.getState().reset();
  observedProject = useProjectStore.getState().project;
  if (packId && nextSessionKey) {
    useLiveStore.getState().setStatus("connecting");
    bootstrapTask = bootstrapWorkspace(packId);
    const startedSessionKey = nextSessionKey;
    void bootstrapTask.catch((error) => {
      if (targetPackId !== packId || targetSessionKey !== startedSessionKey) return;
      useLiveStore.getState().setStatus("error", errorMessage(error));
      toast.error("Live-Projekt konnte nicht verbunden werden", {
        description: errorMessage(error),
      });
    });
  } else {
    bootstrapTask = null;
  }
}

/** Used by the clone flow so it only reports success once the first
 * authoritative live snapshot and its binaries have been materialized. */
export async function connectLiveWorkspace(packId: string): Promise<void> {
  setLiveWorkspaceTarget(packId);
  const task = bootstrapTask;
  if (task) await task;
}

/** Explicitly reloads the authoritative live snapshot. This replaces the old
 * revision-only download action for realtime projects and also exposes its
 * binary download progress in the existing cloud progress dialog. */
export async function refreshLiveWorkspace(): Promise<number> {
  const packId = targetPackId;
  if (!packId || !targetSessionIsCurrent(packId)) {
    throw new Error(i18n.t("sync:errors.notLinked"));
  }
  const runningBootstrap = bootstrapTask;
  if (runningBootstrap) await runningBootstrap;
  if (!targetSessionIsCurrent(packId)) {
    throw new Error(i18n.t("sync:errors.projectChanged"));
  }
  const reportPull = liveProgress("pull");
  useLiveStore.getState().setStatus("syncing");
  reportPull({
    phase: "download",
    current: 0,
    total: 1,
    label: i18n.t("sync:progress.workspaceLoading"),
  });
  try {
    const version = await fetchAndApplyWorkspace(reportPull);
    if (version === null) throw new Error(i18n.t("sync:errors.notLinked"));
    return version;
  } catch (error) {
    if (targetSessionIsCurrent(packId)) {
      useLiveStore.getState().setStatus("error", errorMessage(error));
    }
    throw error;
  } finally {
    if (targetSessionIsCurrent(packId)) useLiveStore.getState().setTransfer(null);
  }
}

/** Called by the collaboration WebSocket dispatcher. */
export function handleLiveWorkspaceMessage(message: Record<string, unknown>): void {
  if (!targetSessionIsCurrent()) return;
  if (message.type === "joined") {
    const serverVersion =
      typeof message.workspaceVersion === "number" ? message.workspaceVersion : null;
    const localVersion = useLiveStore.getState().version;
    if (serverVersion !== null && serverVersion !== localVersion) {
      scheduleResync();
    }
    return;
  }
  if (message.type === "workspace-reset") {
    scheduleResync();
    return;
  }
  if (message.type !== "workspace-changed" || typeof message.version !== "number") return;
  const operationId = typeof message.operationId === "string" ? message.operationId : "";
  const ownPending = pendingOperations.some((item) => item.operationId === operationId);
  const currentVersion = useLiveStore.getState().version ?? -1;
  if (ownPending) {
    if (message.version === currentVersion + 1) {
      useLiveStore.getState().setVersion(message.version);
    } else if (message.version > currentVersion) {
      // Our operation was accepted after a version we did not receive. Do not
      // jump the cursor over that gap; the HTTP response/retry is idempotent
      // and the authoritative resync will overlay the still-pending operation.
      scheduleResync();
    }
    return;
  }
  if (isWorkspaceOperation(message.operation)) {
    const packId = targetPackId;
    if (packId) queueBroadcastOperation(packId, message.version, message.operation);
  } else {
    scheduleResync();
  }
}

/** Mount once from App. */
export function useLiveWorkspace(): void {
  const cloudEnabled = useCloudEnabled();
  const authStatus = useAuthStore((state) => state.status);
  const approved = useAuthStore((state) => state.user?.status === "approved");
  const packId = useProjectStore(
    (state) => state.project?.sync.remoteProjectId ?? null,
  );
  const projectId = useProjectStore((state) => state.project?.id ?? null);
  const projectDir = useProjectStore((state) => state.projectDir);

  useEffect(() => {
    observeProjectChanges();
    const target = cloudEnabled && authStatus === "loggedIn" && approved ? packId : null;
    setLiveWorkspaceTarget(target);
  }, [cloudEnabled, authStatus, approved, packId, projectId, projectDir]);
}
