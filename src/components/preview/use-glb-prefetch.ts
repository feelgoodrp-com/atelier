/**
 * Warms the GLB cache for the drawables the user is LOOKING AT (the filtered
 * center list) before anything is selected — switching selection in the 3D
 * preview then hits the cache instead of waiting for the sidecar.
 *
 * Low priority by design: debounced, capped, strictly sequential (the store's
 * prefetch queue), gated on an open preview pane and a ready sidecar.
 */

import { useEffect } from "react";
import { joinPath } from "@/lib/project/io";
import {
  clampTextureIndex,
  glbCacheKey,
  outfitCacheKey,
  pedModelFor,
  usePreview3dStore,
} from "@/lib/stores/preview-3d-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { ProjectDrawable } from "@/lib/project/schema";

/** How many list entries get pre-built (top of the visible list). */
const PREFETCH_MAX = 12;
const PREFETCH_DEBOUNCE_MS = 400;

export function useGlbPrefetch(visible: ProjectDrawable[]): void {
  const projectDir = useProjectStore((s) => s.projectDir);
  const previewOpen = useWorkbenchStore((s) => s.previewOpen);
  const sidecarReady = useSidecarStore((s) => s.info.status === "ready");
  const textureIndexByDrawable = usePreview3dStore((s) => s.textureIndexByDrawable);
  const includePedBody = usePreview3dStore((s) => s.includePedBody);
  const gtaPathReady = usePreview3dStore((s) => s.gtaPathReady);
  const pose = usePreview3dStore((s) => s.pose);
  const prefetchGlbs = usePreview3dStore((s) => s.prefetchGlbs);

  useEffect(() => {
    if (!previewOpen || !projectDir || !sidecarReady) return;
    const pedBodyActive = includePedBody && gtaPathReady === true;
    // Mirror of the pane: poses need game data, so browsing only stays warm
    // for the pose that is actually requested (bind pose without GTA path).
    const poseActive = gtaPathReady === true ? pose : null;

    const timer = setTimeout(() => {
      const items = visible
        .filter((d) => d.ydd != null)
        .slice(0, PREFETCH_MAX)
        .map((drawable) => {
          const ydd = drawable.ydd!;
          const textureIndex = clampTextureIndex(
            drawable,
            textureIndexByDrawable[drawable.id],
          );
          const textureHash = drawable.textures[textureIndex]?.hash ?? null;
          const pedModel = pedModelFor(drawable);
          const yddPath = joinPath(projectDir, ydd.path);
          const ytdPaths = drawable.textures.map((t) => joinPath(projectDir, t.path));

          // With ped body the pane requests OUTFIT GLBs — prefetch the
          // single-garment outfit (the likely click target) so the keys match.
          if (pedBodyActive) {
            return {
              key: outfitCacheKey(
                [{ yddHash: ydd.hash, textureHash }],
                pedModel,
                poseActive,
              ),
              request: {
                items: [{ yddPath, ytdPaths, textureIndex, slot: drawable.type }],
                pedModel,
                includePedBody: true,
                pose: poseActive,
              },
            };
          }
          // Posed garment-only previews bake with the gender skeleton — the
          // request AND the cache key must carry it (matches the pane).
          const poseSkeleton = poseActive ? pedModel : null;
          return {
            key: glbCacheKey(ydd.hash, textureHash, null, poseActive, poseSkeleton),
            request: {
              yddPath,
              ytdPaths,
              textureIndex,
              includePedBody: false,
              pose: poseActive,
              ...(poseSkeleton ? { pedModel: poseSkeleton } : {}),
            },
          };
        });
      prefetchGlbs(items);
    }, PREFETCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    visible,
    previewOpen,
    projectDir,
    sidecarReady,
    textureIndexByDrawable,
    includePedBody,
    gtaPathReady,
    pose,
    prefetchGlbs,
  ]);
}
