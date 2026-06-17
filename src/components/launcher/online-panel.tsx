/**
 * Online panel (launcher right sidebar): who is online right now and which
 * project they are working in. Data comes from the presence heartbeat
 * (GET /api/v1/presence), refreshed every 15s.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleUser, Folder, Users } from "lucide-react";
import { fetchPresence, type PresenceUser } from "@/lib/sync/api-client";
import { useAuthStore, useCloudEnabled } from "@/lib/stores/auth-store";

const REFRESH_MS = 15_000;

function UserRow({ user, isSelf }: { user: PresenceUser; isSelf: boolean }) {
  const { t } = useTranslation("launcher");
  return (
    <div className="flex items-start gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-white/5">
      <div className="relative shrink-0">
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.username}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <CircleUser className="h-8 w-8 text-white/40" />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#101010] bg-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white/85">
          {user.username}
          {isSelf && (
            <span className="ml-1.5 text-xs font-normal text-white/35">
              {t("online.you")}
            </span>
          )}
        </p>
        {user.project ? (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#7289DA]">
            <Folder className="h-3 w-3 shrink-0" />
            <span className="truncate">{user.project.name}</span>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-white/35">{t("online.inLauncher")}</p>
        )}
      </div>
    </div>
  );
}

export function OnlinePanel() {
  // Solo mode has no cloud presence: hide the panel and never start the poll.
  if (!useCloudEnabled()) return null;

  const { t } = useTranslation("launcher");
  const [users, setUsers] = useState<PresenceUser[] | null>(null);
  const selfId = useAuthStore((s) => s.user?.discordId);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPresence()
        .then((list) => {
          if (!cancelled) setUsers(list);
        })
        .catch(() => {
          /* keep last known list; next refresh retries */
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="liquid-glass flex h-full max-h-full flex-col rounded-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Users className="h-4 w-4 text-[#7289DA]" />
        <h2 className="text-sm font-semibold text-white">{t("online.title")}</h2>
        {users !== null && (
          <span className="ml-auto rounded-full bg-[#5865F2]/20 px-2 py-0.5 text-xs font-medium text-[#7289DA]">
            {users.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {users === null ? (
          <div className="flex flex-col gap-2 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-2 py-1.5">
                <div className="h-8 w-8 rounded-full bg-white/10" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-24 rounded bg-white/10" />
                  <div className="h-2 w-16 rounded bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <Users className="h-7 w-7 text-white/20" />
            <p className="mt-3 text-sm text-white/50">{t("online.nobodyOnline")}</p>
            <p className="mt-1 text-xs text-white/30">{t("online.nobodyHint")}</p>
          </div>
        ) : (
          users.map((u) => (
            <UserRow key={u.discordId} user={u} isSelf={u.discordId === selfId} />
          ))
        )}
      </div>
    </div>
  );
}
