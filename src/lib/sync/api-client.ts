/**
 * Typed client for the atelier collaboration backend (atelier-api).
 *
 * Contract (verified against atelier-api/src/routes/* — keep in sync!):
 * - errors are always `{ "error": "message" }` with a non-2xx status
 * - browser login entry: GET  /api/v1/auth/discord/start?redirect_uri=...
 * - token exchange:      POST /api/v1/auth/device/exchange
 *                          { code, redirect_uri, device: { name, platform, appVersion } }
 *                          → { accessToken, refreshToken, user: User }
 * - rotating refresh:    POST /api/v1/auth/device/refresh { refreshToken }
 *                          → { accessToken, refreshToken, user: User }
 * - logout:              POST /api/v1/auth/device/logout → { ok }
 * - current user:        GET  /api/v1/me
 *                          → { user: User & { createdAt, lastLoginAt },
 *                              device: { deviceId, name } }
 * - devices:             GET  /api/v1/devices → { devices: Device[] }
 *                        DELETE /api/v1/devices/:deviceId → { ok }
 * - admin:               GET  /api/v1/admin/users?status=... → { users: AdminUser[] }
 *                        POST /api/v1/admin/users/:discordId/approve → { user }
 *                        POST /api/v1/admin/users/:discordId/lock → { user, revokedDevices }
 *                        POST /api/v1/admin/users/:discordId/role { role } → { user }
 * - packs:               POST/GET /api/v1/packs, GET /api/v1/packs/:packId
 * - revisions:           GET  /api/v1/packs/:packId/revisions/head/manifest → { revision }
 *                        POST /api/v1/packs/:packId/revisions { baseRevision, message, drawables }
 *                          → { revision } | 409 { error: "head_changed", head }
 * - CAS assets:          POST /api/v1/assets/check { files: [{ sha256 }] } → { missing, present }
 *                        GET  /api/v1/assets/:sha256 (binary download)
 * - uploads:             POST /api/v1/uploads → { uploadId, chunkSize, totalChunks, receivedChunks }
 *                        PUT  /api/v1/uploads/:id/chunks/:index (octet-stream)
 *                        POST /api/v1/uploads/:id/complete → { ok, sha256 }
 * - locks:               POST /api/v1/packs/:packId/locks { drawableEntryId }
 *                          → { lock } | 409 { error: "locked", lock }
 *                        PUT  /api/v1/packs/:packId/locks/:drawableEntryId/heartbeat → { lock }
 *                        DELETE /api/v1/packs/:packId/locks/:drawableEntryId[?force=1] → { ok }
 * - server builds:       POST /api/v1/packs/:packId/builds { revision: number|"head" }
 *                          → 202 { build } (queued) | 200 { build } (cached done)
 *                        GET  /api/v1/builds/:buildId → { build }
 *                        (status updates arrive as { type: "build-status" } WS broadcasts)
 *
 * Users are identified by their Discord snowflake (`discordId`) — there is
 * no separate `id` field.
 */

import i18n from "@/lib/i18n";
import type { SlotId } from "@/lib/gta/components";
import type {
  DrawableFlags,
  DrawableKind,
  DrawableMode,
  Gender,
} from "@/lib/project/schema";

export type UserStatus = "pending" | "approved" | "locked";
export type UserRole = "admin" | "member";

/** PublicUser as returned by exchange/refresh/me (atelierUser.toPublicUser). */
export interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  role: UserRole;
  status: UserStatus;
}

/** Extended view returned by the admin endpoints (adminUserView). */
export interface AdminUser extends User {
  createdAt: string;
  approvedByDiscordId: string | null;
  approvedAt: string | null;
  lastLoginAt: string;
}

export interface MeResponse {
  user: User & { createdAt?: string; lastLoginAt?: string };
  device: { deviceId: string; name: string };
}

export interface Device {
  deviceId: string;
  name: string;
  platform: string;
  appVersion: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp?: string | null;
  /** True for the device whose token made the request. */
  current: boolean;
}

export interface DeviceMeta {
  name: string;
  platform: string;
  appVersion: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export class ApiError extends Error {
  status: number;
  /** Parsed error response body (e.g. `{ error: "locked", lock }`), if any. */
  details: Record<string, unknown> | null;
  constructor(message: string, status: number, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

interface ApiClientConfig {
  getApiUrl: () => string;
  getAccessToken: () => string | null;
  getRefreshToken: () => Promise<string | null>;
  /** Called whenever the rotating refresh endpoint hands out new tokens. */
  onTokensRotated: (tokens: TokenResponse) => Promise<void> | void;
  /** Called when a refresh attempt itself fails (session is dead). */
  onSessionExpired: () => Promise<void> | void;
}

let config: ApiClientConfig | null = null;

export function configureApiClient(c: ApiClientConfig): void {
  config = c;
}

function requireConfig(): ApiClientConfig {
  if (!config) throw new Error(i18n.t("sync:api.notConfigured"));
  return config;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = i18n.t("sync:api.requestFailed", { status: res.status });
  let details: Record<string, unknown> | null = null;
  try {
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body === "object" && body !== null) {
      details = body;
      if (typeof body.error === "string" && body.error) message = body.error;
    }
  } catch {
    // non-JSON body
  }
  return new ApiError(message, res.status, details);
}

/** Single-flight guard so parallel 401s trigger only one refresh. */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const c = requireConfig();
      const refreshToken = await c.getRefreshToken();
      if (!refreshToken) return false;
      const res = await fetch(`${c.getApiUrl()}/api/v1/auth/device/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        await c.onSessionExpired();
        return false;
      }
      const tokens = (await res.json()) as TokenResponse;
      await c.onTokensRotated(tokens);
      return true;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const c = requireConfig();
  const accessToken = c.getAccessToken();
  const res = await fetch(`${c.getApiUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 && allowRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Browser URL that kicks off the Discord OAuth flow on the backend. */
export function discordStartUrl(apiUrl: string, redirectUri: string): string {
  return `${apiUrl}/api/v1/auth/discord/start?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

/**
 * Probes GET {apiUrl}/health and confirms an atelier-api answers there — used
 * by the first-run setup wizard. Throws a localized message on any failure
 * (unreachable, wrong service, timeout after 5s).
 */
export async function checkApiHealth(apiUrl: string): Promise<{ version: string | null }> {
  const base = apiUrl.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//u.test(base)) {
    throw new Error(i18n.t("sync:api.invalidUrl"));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  let res: Response;
  try {
    res = await fetch(`${base}/health`, { method: "GET", signal: ctrl.signal });
  } catch (e) {
    throw new Error(
      ctrl.signal.aborted
        ? i18n.t("sync:api.healthTimeout")
        : i18n.t("sync:api.healthUnreachable"),
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(i18n.t("sync:api.healthBadStatus", { status: res.status }));
  }
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; service?: string; version?: string }
    | null;
  if (!data || data.service !== "atelier-api") {
    throw new Error(i18n.t("sync:api.healthWrongService"));
  }
  return { version: typeof data.version === "string" ? data.version : null };
}

export interface ServerHealth {
  version: string | null;
  updateAvailable: boolean;
  latestVersion: string | null;
}

/**
 * Non-throwing full health probe for the Settings "server" row: returns the
 * connected atelier-api's version + whether it reports an available update
 * (the server compares itself against GitHub master). Returns null on any
 * failure so the UI can just hide the row.
 */
export async function fetchServerHealth(apiUrl: string): Promise<ServerHealth | null> {
  const base = apiUrl.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//u.test(base)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${base}/health`, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | { service?: string; version?: string; updateAvailable?: boolean; latestVersion?: string }
      | null;
    if (!data || data.service !== "atelier-api") return null;
    return {
      version: typeof data.version === "string" ? data.version : null,
      updateAvailable: data.updateAvailable === true,
      latestVersion: typeof data.latestVersion === "string" ? data.latestVersion : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Exchanges the one-time code from the loopback redirect for device tokens. */
export async function exchangeDeviceCode(args: {
  code: string;
  redirectUri: string;
  device: DeviceMeta;
}): Promise<TokenResponse> {
  const c = requireConfig();
  const res = await fetch(`${c.getApiUrl()}/api/v1/auth/device/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: args.code,
      redirect_uri: args.redirectUri,
      device: args.device,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TokenResponse;
}

/** Refreshes tokens on startup; returns null when no session exists. */
export async function refreshSession(): Promise<TokenResponse | null> {
  const c = requireConfig();
  const refreshToken = await c.getRefreshToken();
  if (!refreshToken) return null;
  const res = await fetch(`${c.getApiUrl()}/api/v1/auth/device/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    await c.onSessionExpired();
    return null;
  }
  const tokens = (await res.json()) as TokenResponse;
  await c.onTokensRotated(tokens);
  return tokens;
}

/**
 * Best-effort server-side logout: revokes the current device. Requires a
 * valid access token, so call it BEFORE clearing local tokens.
 */
export function logoutDevice(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/v1/auth/device/logout", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Me / devices
// ---------------------------------------------------------------------------

export function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/v1/me");
}

export async function listDevices(): Promise<Device[]> {
  const res = await request<{ devices: Device[] }>("/api/v1/devices");
  return res.devices;
}

export function revokeDevice(deviceId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Admin (users are addressed by discordId)
// ---------------------------------------------------------------------------

export async function adminListUsers(status?: UserStatus): Promise<AdminUser[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await request<{ users: AdminUser[] }>(`/api/v1/admin/users${qs}`);
  return res.users;
}

export async function adminApproveUser(discordId: string): Promise<AdminUser> {
  const res = await request<{ user: AdminUser }>(
    `/api/v1/admin/users/${encodeURIComponent(discordId)}/approve`,
    { method: "POST" },
  );
  return res.user;
}

export async function adminLockUser(discordId: string): Promise<AdminUser> {
  const res = await request<{ user: AdminUser; revokedDevices: number }>(
    `/api/v1/admin/users/${encodeURIComponent(discordId)}/lock`,
    { method: "POST" },
  );
  return res.user;
}

export async function adminSetUserRole(discordId: string, role: UserRole): Promise<AdminUser> {
  const res = await request<{ user: AdminUser }>(
    `/api/v1/admin/users/${encodeURIComponent(discordId)}/role`,
    { method: "POST", body: JSON.stringify({ role }) },
  );
  return res.user;
}

// ---------------------------------------------------------------------------
// Presence (who is online, and in which project)
// ---------------------------------------------------------------------------

export interface PresenceProject {
  id: string;
  name: string;
}

export interface PresenceUser {
  discordId: string;
  username: string;
  avatar: string | null;
  project: PresenceProject | null;
  lastSeenAt: string;
}

/** Heartbeat — call every ~30s; `project` is the currently open project or null. */
export function sendPresence(project: PresenceProject | null): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/v1/presence", {
    method: "POST",
    body: JSON.stringify({ project }),
  });
}

export async function fetchPresence(): Promise<PresenceUser[]> {
  const res = await request<{ users: PresenceUser[] }>("/api/v1/presence");
  return res.users;
}

/** Explicit offline (logout); best effort. */
export function clearPresence(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/v1/presence", { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Packs + revisions (cloud sync)
// ---------------------------------------------------------------------------

export type PackMemberRole = "editor" | "viewer";

export interface Pack {
  packId: string;
  name: string;
  slug: string;
  description: string;
  ownerDiscordId: string;
  members: Array<{ discordId: string; role: PackMemberRole; addedAt: string }>;
  /** 0 = no revisions yet. */
  headRevision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** CAS pointer inside a revision — local file paths never leave the client. */
export interface RevisionAssetRef {
  sha256: string;
  size: number;
  exportName: string;
}

/** Server-side drawable snapshot (atelierRevision contract). */
export interface RevisionDrawable {
  id: string;
  gender: Gender;
  kind: DrawableKind;
  type: SlotId;
  mode: DrawableMode;
  replaceTargetId: number | null;
  label: string;
  groupId: string | null;
  ydd: RevisionAssetRef | null;
  /** Array order == texture letter a, b, c, … */
  textures: RevisionAssetRef[];
  physics: RevisionAssetRef | null;
  firstPerson: RevisionAssetRef | null;
  flags: DrawableFlags;
}

export interface RemoteRevision {
  packId: string;
  revision: number;
  parentRevision: number;
  message: string;
  createdByDiscordId: string;
  deviceId: string;
  createdAt: string;
  drawables: RevisionDrawable[];
  stats: { drawableCount: number; totalBytes: number };
}

export async function createPack(name: string, description?: string): Promise<Pack> {
  const res = await request<{ pack: Pack }>("/api/v1/packs", {
    method: "POST",
    body: JSON.stringify(description === undefined ? { name } : { name, description }),
  });
  return res.pack;
}

/**
 * All non-archived team packs — every approved user has access (team-wide
 * model: the server lists all packs regardless of owner/membership).
 */
export async function listMyPacks(): Promise<Pack[]> {
  const res = await request<{ packs: Pack[] }>("/api/v1/packs");
  return res.packs;
}

/** Semantic alias for {@link listMyPacks} (team-wide pack access). */
export const listTeamPacks = listMyPacks;

export async function getPack(packId: string): Promise<Pack> {
  const res = await request<{ pack: Pack }>(`/api/v1/packs/${encodeURIComponent(packId)}`);
  return res.pack;
}

/** Full head revision (404 "no_revisions" while headRevision is 0). */
export async function getHeadManifest(packId: string): Promise<RemoteRevision> {
  const res = await request<{ revision: RemoteRevision }>(
    `/api/v1/packs/${encodeURIComponent(packId)}/revisions/head/manifest`,
  );
  return res.revision;
}

export type PostRevisionResult =
  | { ok: true; revision: RemoteRevision }
  /** Lost the head race — `head` is the current head revision (null while 0). */
  | { ok: false; head: RemoteRevision | null };

/** Commits a new head revision; 409 head_changed is a typed result, not a throw. */
export async function postRevision(
  packId: string,
  args: {
    baseRevision: number;
    message: string;
    drawables: RevisionDrawable[];
    /** Project settings.dlcName — server builds use it for stream-name parity. */
    dlcName?: string;
  },
): Promise<PostRevisionResult> {
  try {
    const res = await request<{ revision: RemoteRevision }>(
      `/api/v1/packs/${encodeURIComponent(packId)}/revisions`,
      { method: "POST", body: JSON.stringify(args) },
    );
    return { ok: true, revision: res.revision };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.details?.error === "head_changed") {
      return { ok: false, head: (e.details.head as RemoteRevision | null) ?? null };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Server-side builds (atelier-api routes/builds.ts — publicBuild shape)
// ---------------------------------------------------------------------------

export type ServerBuildStatus = "queued" | "running" | "done" | "error";

export interface ServerBuildReport {
  resources: Array<{ folder: string; drawables: number }>;
  warnings: string[];
}

/** publicBuild — optional fields are omitted while null server-side. */
export interface ServerBuild {
  buildId: string;
  packId: string;
  revision: number;
  status: ServerBuildStatus;
  error?: string;
  sizeBytes?: number;
  report?: ServerBuildReport;
  finishedAt?: string;
}

/**
 * Requests a server-side build of a revision (editor+). Cached builds of the
 * immutable revision return status "done" immediately (200), fresh requests
 * are queued (202) and report progress via WS "build-status" broadcasts.
 */
export async function startServerBuild(
  packId: string,
  revision: number | "head",
): Promise<ServerBuild> {
  const res = await request<{ build: ServerBuild }>(
    `/api/v1/packs/${encodeURIComponent(packId)}/builds`,
    { method: "POST", body: JSON.stringify({ revision }) },
  );
  return res.build;
}

export async function getServerBuild(buildId: string): Promise<ServerBuild> {
  const res = await request<{ build: ServerBuild }>(
    `/api/v1/builds/${encodeURIComponent(buildId)}`,
  );
  return res.build;
}

// ---------------------------------------------------------------------------
// CAS assets + resumable uploads
// ---------------------------------------------------------------------------

export type UploadAssetKind = "ydd" | "ytd" | "yld" | "glb";

export interface AssetCheckResult {
  missing: string[];
  present: string[];
}

/** Which of these hashes already live in the CAS? (max 500 per call) */
export function checkAssets(sha256s: string[]): Promise<AssetCheckResult> {
  return request<AssetCheckResult>("/api/v1/assets/check", {
    method: "POST",
    body: JSON.stringify({ files: sha256s.map((sha256) => ({ sha256 })) }),
  });
}

/** Download URL of a CAS asset — requests still need the bearer header. */
export function assetDownloadUrl(apiUrl: string, sha256: string): string {
  return `${apiUrl}/api/v1/assets/${sha256}`;
}

/** Downloads a CAS asset (authenticated, with one 401→refresh retry). */
export async function downloadAsset(sha256: string, allowRetry = true): Promise<Uint8Array> {
  const c = requireConfig();
  const accessToken = c.getAccessToken();
  const res = await fetch(assetDownloadUrl(c.getApiUrl(), sha256), {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  if (res.status === 401 && allowRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return downloadAsset(sha256, false);
  }
  if (!res.ok) throw await parseError(res);
  return new Uint8Array(await res.arrayBuffer());
}

export interface UploadSession {
  uploadId: string;
  /** Server-fixed — clients MUST chunk with exactly this size. */
  chunkSize: number;
  totalChunks: number;
  /** Already received chunk indices (resume path). */
  receivedChunks: number[];
}

/**
 * Starts (or resumes) an upload session. Throws ApiError 409 "already_exists"
 * when the asset is already in the CAS — callers treat that as success.
 */
export function initUpload(args: {
  sha256: string;
  kind: UploadAssetKind;
  size: number;
}): Promise<UploadSession> {
  return request<UploadSession>("/api/v1/uploads", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export function putChunk(
  uploadId: string,
  index: number,
  bytes: Uint8Array,
): Promise<{ receivedChunks: number[] }> {
  return request<{ receivedChunks: number[] }>(
    `/api/v1/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
    {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes as unknown as BodyInit,
    },
  );
}

export function completeUpload(uploadId: string): Promise<{ ok: boolean; sha256: string }> {
  return request<{ ok: boolean; sha256: string }>(
    `/api/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Drawable edit locks (advisory, 90s TTL, heartbeat extends)
// ---------------------------------------------------------------------------

export interface PackLock {
  packId: string;
  drawableEntryId: string;
  lockedByDiscordId: string;
  username: string;
  deviceId: string;
  acquiredAt: string;
  expiresAt: string;
}

export type AcquireLockResult =
  | { acquired: true; lock: PackLock }
  /** Held by someone else — `lock` is the current holder. */
  | { acquired: false; lock: PackLock };

/** Active-locks snapshot — fetched on room join so pre-existing locks show immediately. */
export async function listLocks(packId: string): Promise<PackLock[]> {
  const res = await request<{ locks: PackLock[] }>(
    `/api/v1/packs/${encodeURIComponent(packId)}/locks`,
  );
  return res.locks;
}

export async function acquireLock(
  packId: string,
  drawableEntryId: string,
): Promise<AcquireLockResult> {
  try {
    const res = await request<{ lock: PackLock }>(
      `/api/v1/packs/${encodeURIComponent(packId)}/locks`,
      { method: "POST", body: JSON.stringify({ drawableEntryId }) },
    );
    return { acquired: true, lock: res.lock };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.details?.error === "locked" && e.details.lock) {
      return { acquired: false, lock: e.details.lock as PackLock };
    }
    throw e;
  }
}

export async function heartbeatLock(packId: string, drawableEntryId: string): Promise<PackLock> {
  const res = await request<{ lock: PackLock }>(
    `/api/v1/packs/${encodeURIComponent(packId)}/locks/${encodeURIComponent(drawableEntryId)}/heartbeat`,
    { method: "PUT" },
  );
  return res.lock;
}

/** Releases own lock (idempotent); `force` breaks others' locks (logged + broadcast). */
export function releaseLock(
  packId: string,
  drawableEntryId: string,
  force = false,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/v1/packs/${encodeURIComponent(packId)}/locks/${encodeURIComponent(drawableEntryId)}${force ? "?force=1" : ""}`,
    { method: "DELETE" },
  );
}
