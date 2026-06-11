/**
 * Presence heartbeat: while logged in + approved, tell the backend every 30s
 * which project is currently open (or null in the launcher). Sent immediately
 * on project switch so the online panel updates promptly for everyone.
 */

import { useEffect } from "react";
import { sendPresence } from "@/lib/sync/api-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useProjectStore } from "@/lib/stores/project-store";

const HEARTBEAT_MS = 30_000;

export function usePresenceHeartbeat(): void {
  const authStatus = useAuthStore((s) => s.status);
  const userStatus = useAuthStore((s) => s.user?.status);
  const projectId = useProjectStore((s) => s.project?.id ?? null);
  const projectName = useProjectStore((s) => s.project?.name ?? null);

  const active = authStatus === "loggedIn" && userStatus === "approved";

  useEffect(() => {
    if (!active) return;

    const beat = () => {
      void sendPresence(
        projectId && projectName ? { id: projectId, name: projectName } : null,
      ).catch(() => {
        /* backend briefly unreachable — next heartbeat retries */
      });
    };

    beat(); // immediately (login / project switch)
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [active, projectId, projectName]);
}
