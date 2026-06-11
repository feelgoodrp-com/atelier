/**
 * Live collaboration state of the joined pack room (fed by lib/sync/collab.ts):
 * connection status, roster ("wer ist im Pack online?") and the advisory lock
 * map (drawableEntryId -> holder). Locks arrive via WebSocket broadcasts and
 * via the REST acquire responses; there is no initial lock list endpoint, so
 * the map fills up as events come in.
 */

import { create } from "zustand";

export type CollabStatus = "off" | "connecting" | "online";

export interface CollabUser {
  discordId: string;
  username: string;
  avatar: string | null;
}

export interface CollabLock {
  drawableEntryId: string;
  lockedByDiscordId: string;
  username: string;
  expiresAt: string;
}

export type CollabLockEvent = "acquired" | "released" | "broken" | "expired";

interface CollabState {
  status: CollabStatus;
  /** Pack room the socket currently sits in (null while off/connecting). */
  packId: string | null;
  roster: CollabUser[];
  /** drawableEntryId -> current lock holder. */
  locks: Record<string, CollabLock>;
  /** True after a 403 on lock acquire (viewer role) — stops further tries. */
  lockDenied: boolean;

  setStatus: (status: CollabStatus) => void;
  setJoined: (packId: string, roster: CollabUser[]) => void;
  applyPresence: (event: "join" | "leave", user: CollabUser) => void;
  applyLockEvent: (event: CollabLockEvent, lock: CollabLock) => void;
  upsertLock: (lock: CollabLock) => void;
  /** Full snapshot replace (room join — GET /packs/:id/locks). */
  replaceLocks: (locks: CollabLock[]) => void;
  removeLock: (drawableEntryId: string) => void;
  setLockDenied: (lockDenied: boolean) => void;
  reset: () => void;
}

export const useCollabStore = create<CollabState>((set) => ({
  status: "off",
  packId: null,
  roster: [],
  locks: {},
  lockDenied: false,

  setStatus: (status) => set({ status }),

  setJoined: (packId, roster) =>
    set({ status: "online", packId, roster, lockDenied: false }),

  applyPresence: (event, user) =>
    set((state) => {
      const without = state.roster.filter((u) => u.discordId !== user.discordId);
      return { roster: event === "join" ? [...without, user] : without };
    }),

  applyLockEvent: (event, lock) =>
    set((state) => {
      const locks = { ...state.locks };
      if (event === "acquired") locks[lock.drawableEntryId] = lock;
      else delete locks[lock.drawableEntryId];
      return { locks };
    }),

  upsertLock: (lock) =>
    set((state) => ({
      locks: { ...state.locks, [lock.drawableEntryId]: lock },
    })),

  replaceLocks: (locks) =>
    set({
      locks: Object.fromEntries(locks.map((l) => [l.drawableEntryId, l])),
    }),

  removeLock: (drawableEntryId) =>
    set((state) => {
      if (!(drawableEntryId in state.locks)) return state;
      const locks = { ...state.locks };
      delete locks[drawableEntryId];
      return { locks };
    }),

  setLockDenied: (lockDenied) => set({ lockDenied }),

  reset: () =>
    set({ status: "off", packId: null, roster: [], locks: {}, lockDenied: false }),
}));
