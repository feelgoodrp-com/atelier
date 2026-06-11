/**
 * Keeps the sidecar's GTA-V path in sync with the persisted setting.
 *
 * The sidecar holds the path ONLY in memory (POST /config) — after an app
 * start or a sidecar respawn it knows nothing, so the ped-body preview would
 * stay disabled forever even though the setting is saved. This module pushes
 * the stored path on every "ready" transition and after the settings picker.
 */

import { useEffect } from "react";
import { configureSidecarGtaPath, fetchSidecarServerInfo } from "@/lib/sidecar/client";
import { getGtaPath } from "@/lib/settings";
import { usePreview3dStore } from "@/lib/stores/preview-3d-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";

/**
 * Sends the given path (or just refreshes the readiness flag when null) to
 * the sidecar and mirrors the result into the preview store. Returns whether
 * the sidecar now reports gtaPathReady.
 */
export async function pushGtaPathToSidecar(path: string | null): Promise<boolean> {
  const setReady = usePreview3dStore.getState().setGtaPathReady;
  try {
    if (path && path.trim() !== "") {
      const result = await configureSidecarGtaPath(path);
      setReady(result.gtaPathReady);
      return result.gtaPathReady;
    }
    const info = await fetchSidecarServerInfo();
    setReady(info.gtaPathReady);
    return info.gtaPathReady;
  } catch {
    setReady(null); // sidecar unreachable — unknown
    return false;
  }
}

/**
 * App-wide hook (mounted once in App.tsx): every time the sidecar becomes
 * ready (start, respawn, manual restart), re-send the persisted GTA path.
 */
export function useGtaPathSync(): void {
  const status = useSidecarStore((s) => s.info.status);

  useEffect(() => {
    if (status !== "ready") return;
    getGtaPath()
      .then((path) => pushGtaPathToSidecar(path))
      .catch(() => {
        /* settings store unavailable (browser dev) */
      });
  }, [status]);
}
