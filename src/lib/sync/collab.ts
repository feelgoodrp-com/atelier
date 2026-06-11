/**
 * Realtime collaboration client: WebSocket to {apiUrl}/api/v1/ws?token=…
 * while a cloud-linked project is open.
 *
 * - joins the pack room (remoteProjectId), reconnects with backoff and
 *   re-joins; a close before the socket ever opened usually means a rejected
 *   upgrade (stale JWT) -> refresh tokens before the next attempt.
 * - feeds collab-store: roster (joined/presence) + lock map (lock events).
 * - "head-changed" from someone else -> toast with a "Jetzt laden" action.
 * - advisory locks follow the selection: selected drawables are locked via
 *   REST (POST), kept alive with a 30s heartbeat and released on deselect /
 *   project close. Editing is NEVER blocked — the locks are hints only.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import {
  acquireLock,
  ApiError,
  heartbeatLock,
  listLocks,
  refreshSession,
  releaseLock,
  type PackLock,
} from "@/lib/sync/api-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCollabStore, type CollabLock, type CollabUser } from "@/lib/stores/collab-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useSyncStore } from "@/lib/stores/sync-store";

const PING_INTERVAL_MS = 25_000;
const LOCK_HEARTBEAT_MS = 30_000;
const RECONNECT_MAX_MS = 30_000;
/** Bulk selections lock at most this many drawables (server spam guard). */
const MAX_HELD_LOCKS = 16;

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

let socket: WebSocket | null = null;
let desiredPackId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;

function stopTimer(timer: ReturnType<typeof setInterval> | null) {
  if (timer) clearInterval(timer);
}

function teardownSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopTimer(pingTimer);
  pingTimer = null;
  if (socket) {
    const ws = socket;
    socket = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}

/**
 * Sets (or clears) the pack room this client should live in. Called from
 * useCollab() whenever auth state or the open project's link changes.
 */
export function setCollabTarget(packId: string | null): void {
  if (packId === desiredPackId) return;

  // Leaving a pack: free our advisory locks before switching context.
  releaseAllHeldLocks();
  desiredPackId = packId;
  reconnectAttempts = 0;
  teardownSocket();
  useCollabStore.getState().reset();

  stopTimer(heartbeatTimer);
  heartbeatTimer = null;
  if (packId) {
    connect();
    heartbeatTimer = setInterval(() => void heartbeatHeldLocks(), LOCK_HEARTBEAT_MS);
  }
}

function scheduleReconnect(refreshTokensFirst: boolean): void {
  if (!desiredPackId || reconnectTimer) return;
  const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** Math.min(reconnectAttempts, 5));
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void (async () => {
      if (refreshTokensFirst) await refreshSession().catch(() => null);
      connect();
    })();
  }, delay);
}

function connect(): void {
  if (!desiredPackId || socket) return;
  const { accessToken, apiUrl } = useAuthStore.getState();
  if (!accessToken) {
    scheduleReconnect(true);
    return;
  }

  useCollabStore.getState().setStatus("connecting");
  const wsUrl = `${apiUrl.replace(/^http/, "ws")}/api/v1/ws?token=${encodeURIComponent(accessToken)}`;
  let opened = false;
  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.onopen = () => {
    if (ws !== socket) return;
    opened = true;
    reconnectAttempts = 0;
    ws.send(JSON.stringify({ type: "join", packId: desiredPackId }));
    pingTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        // closing — onclose reconnects
      }
    }, PING_INTERVAL_MS);
  };

  ws.onmessage = (event) => {
    if (ws === socket) handleMessage(String(event.data));
  };

  ws.onclose = () => {
    if (ws !== socket) return;
    socket = null;
    stopTimer(pingTimer);
    pingTimer = null;
    if (!desiredPackId) return;
    useCollabStore.getState().setStatus("connecting");
    // Never opened = upgrade rejected (usually an expired access token).
    scheduleReconnect(!opened);
  };
}

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

function handleMessage(raw: string): void {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    msg = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  const store = useCollabStore.getState();
  switch (msg.type) {
    case "joined": {
      const packId = String(msg.packId ?? "");
      store.setJoined(packId, Array.isArray(msg.roster) ? (msg.roster as CollabUser[]) : []);
      // The server auto-released our locks when the previous socket closed —
      // a stale heldLocks set would skip the re-acquire until the heartbeat
      // hits a 404 (~30s of "unlocked" for everyone else). Start fresh.
      heldLocks.clear();
      // Snapshot so pre-existing foreign locks show immediately instead of
      // with the next broadcast (<=30s gap).
      void listLocks(packId)
        .then((locks) => useCollabStore.getState().replaceLocks(locks.map(toCollabLock)))
        .catch(() => {
          /* best effort — broadcasts keep us converging */
        });
      requestLockSync();
      break;
    }
    case "presence":
      if ((msg.event === "join" || msg.event === "leave") && msg.user) {
        store.applyPresence(msg.event, msg.user as CollabUser);
      }
      break;
    case "lock":
      if (
        (msg.event === "acquired" ||
          msg.event === "released" ||
          msg.event === "broken" ||
          msg.event === "expired") &&
        msg.lock
      ) {
        store.applyLockEvent(msg.event, msg.lock as CollabLock);
      }
      break;
    case "head-changed":
      onHeadChanged(msg);
      break;
    case "build-status":
      // Server-build progress of the pack room — only the build we requested
      // ourselves is tracked (sync-store ignores foreign buildIds).
      if (
        typeof msg.buildId === "string" &&
        (msg.status === "queued" ||
          msg.status === "running" ||
          msg.status === "done" ||
          msg.status === "error")
      ) {
        useSyncStore.getState().applyServerBuildStatus(msg.buildId, msg.status);
      }
      break;
    case "pong":
      break;
    case "error":
      console.warn("[collab] server error:", msg.error);
      break;
    default:
      break;
  }
}

function onHeadChanged(msg: Record<string, unknown>): void {
  const revision = typeof msg.revision === "number" ? msg.revision : null;
  if (revision === null) return;

  // Own pushes also broadcast into the room — no toast for those.
  const selfId = useAuthStore.getState().user?.discordId;
  if (selfId && msg.byDiscordId === selfId) return;

  const base = useProjectStore.getState().project?.sync.baseRevision ?? 0;
  if (revision <= base) return;

  toast.info(`Neue Version verfügbar (Rev ${revision})`, {
    id: "collab-head-changed",
    description: "Ein Teammitglied hat eine neue Revision hochgeladen.",
    duration: 15_000,
    action: {
      label: "Jetzt laden",
      onClick: () => void useSyncStore.getState().pull(),
    },
  });
}

// ---------------------------------------------------------------------------
// Advisory locks (follow the selection)
// ---------------------------------------------------------------------------

/** drawableEntryIds we currently hold on the server. */
const heldLocks = new Set<string>();
let lockSyncRunning = false;
let lockSyncQueued = false;

function toCollabLock(lock: PackLock): CollabLock {
  return {
    drawableEntryId: lock.drawableEntryId,
    lockedByDiscordId: lock.lockedByDiscordId,
    username: lock.username,
    expiresAt: lock.expiresAt,
  };
}

/** Selection ids that should be locked right now (existing drawables only). */
function desiredLockIds(): string[] {
  if (!desiredPackId) return [];
  if (useCollabStore.getState().lockDenied) return []; // viewer role
  const { project, selection } = useProjectStore.getState();
  if (!project || project.sync.remoteProjectId !== desiredPackId) return [];
  const existing = new Set(project.drawables.map((d) => d.id));
  return selection.filter((id) => existing.has(id)).slice(0, MAX_HELD_LOCKS);
}

/** Coalescing trigger — repeated calls while running queue ONE extra pass. */
export function requestLockSync(): void {
  if (lockSyncRunning) {
    lockSyncQueued = true;
    return;
  }
  lockSyncRunning = true;
  void (async () => {
    try {
      do {
        lockSyncQueued = false;
        await syncLocksOnce();
      } while (lockSyncQueued);
    } finally {
      lockSyncRunning = false;
    }
  })();
}

async function syncLocksOnce(): Promise<void> {
  const packId = desiredPackId;
  if (!packId) return;
  const desired = new Set(desiredLockIds());
  const store = useCollabStore.getState();

  // Release locks of deselected drawables (server broadcasts "released").
  for (const id of [...heldLocks]) {
    if (desired.has(id)) continue;
    heldLocks.delete(id);
    store.removeLock(id);
    void releaseLock(packId, id).catch(() => {
      // TTL (90s) cleans up when the request is lost.
    });
  }

  // Acquire locks for newly selected drawables.
  for (const id of desired) {
    if (heldLocks.has(id)) continue;
    try {
      const result = await acquireLock(packId, id);
      if (result.acquired) heldLocks.add(id);
      // Either our own lock or the current holder (409) — both belong in the
      // store so chips/banner can show "wird gerade von X bearbeitet".
      store.upsertLock(toCollabLock(result.lock));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        store.setLockDenied(true); // viewer — stop trying for this pack
        return;
      }
      // Transient failure — the next selection change / heartbeat retries.
    }
  }
}

async function heartbeatHeldLocks(): Promise<void> {
  const packId = desiredPackId;
  if (!packId || heldLocks.size === 0) return;
  for (const id of [...heldLocks]) {
    try {
      const lock = await heartbeatLock(packId, id);
      useCollabStore.getState().upsertLock(toCollabLock(lock));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Expired/taken over — drop and try a clean re-acquire.
        heldLocks.delete(id);
        requestLockSync();
      }
    }
  }
}

/** Fire-and-forget release of everything we hold (pack switch / logout). */
function releaseAllHeldLocks(): void {
  const packId = desiredPackId;
  if (!packId || heldLocks.size === 0) {
    heldLocks.clear();
    return;
  }
  for (const id of [...heldLocks]) {
    void releaseLock(packId, id).catch(() => {});
  }
  heldLocks.clear();
}

// ---------------------------------------------------------------------------
// React glue
// ---------------------------------------------------------------------------

/**
 * Mount once (App): drives the WebSocket lifecycle from auth + project state
 * and mirrors the drawable selection into advisory locks.
 */
export function useCollab(): void {
  const authStatus = useAuthStore((s) => s.status);
  const approved = useAuthStore((s) => s.user?.status === "approved");
  const remoteProjectId = useProjectStore(
    (s) => s.project?.sync.remoteProjectId ?? null,
  );
  const selection = useProjectStore((s) => s.selection);

  useEffect(() => {
    const target =
      authStatus === "loggedIn" && approved ? remoteProjectId : null;
    setCollabTarget(target);
  }, [authStatus, approved, remoteProjectId]);

  useEffect(() => {
    requestLockSync();
  }, [selection, remoteProjectId]);
}
