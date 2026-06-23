/**
 * In-place texture optimization pipeline (single + bulk UI):
 *
 *   sidecar POST /texture/optimize (in-place, .tmp + replace)
 *   -> re-parse via /parse/ytd (new sha256 + size)
 *   -> ONE batched project-store update (every drawable referencing the
 *      same file path gets the new ref — single undo step)
 *   -> preview cache invalidation for the old hash (thumbnail + GLBs)
 *
 * The optimize call and the store write are split so the bulk flow can run
 * files sequentially and still commit everything as one history entry.
 */

import { copyFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { optimizeTexture, parseYtd } from "@/lib/sidecar/client";
import type {
  TextureDimensions,
  TextureOptimizeRequest,
} from "@/lib/sidecar/types";
import { baseName } from "@/lib/format";
import { joinPath } from "@/lib/project/io";
import { usePreview3dStore } from "@/lib/stores/preview-3d-store";
import { usePreviewStore } from "@/lib/stores/preview-store";
import { useProjectStore } from "@/lib/stores/project-store";
import type { AssetRef, AtelierProject } from "@/lib/project/schema";

/** Dropdown sentinel: keep the source's compression family. */
export const KEEP_FORMAT = "keep";

/** Explicitly forced output formats (uncompressed RGBA8888 included). */
export type ForcedFormat = "BC1" | "BC3" | "BC7" | "RGBA8888";

/** A format dropdown value: a forced format or "keep". */
export type FormatChoice = typeof KEEP_FORMAT | ForcedFormat;

/** Maps a dropdown choice to the sidecar `format` (null = keep family). */
export function resolveFormatChoice(choice: FormatChoice): ForcedFormat | null {
  return choice === KEEP_FORMAT ? null : choice;
}

export interface OptimizeSettings {
  /** Longest-edge cap in pixels (512/1024/2048 in the UI). */
  maxDimension: number;
  /** Forced format; null keeps the source's BC family. */
  format: ForcedFormat | null;
  regenerateMips: boolean;
}

/** Result of one optimized file — input for {@link applyOptimizedTextures}. */
export interface OptimizedTexture {
  /** Project-relative forward-slash path (unchanged — in-place write). */
  path: string;
  oldHash: string;
  /** New ref with re-hashed sha256 + size. */
  next: AssetRef;
  before: TextureDimensions;
  after: TextureDimensions;
}

/**
 * Optimizes ONE project texture in place and re-hashes it. Does NOT touch
 * the store — collect results and commit via {@link applyOptimizedTextures}.
 */
/** Where original .ytd files are kept before destructive in-place shrinking. */
export function textureBackupDir(projectDir: string): string {
  return joinPath(projectDir, ".atelier-cache/texture-backups");
}

export async function optimizeProjectTexture(
  projectDir: string,
  texture: AssetRef,
  settings: OptimizeSettings,
): Promise<OptimizedTexture> {
  const absPath = joinPath(projectDir, texture.path);

  // The optimize is LOSSY and in-place — keep the original under
  // .atelier-cache/texture-backups/<hash>-<name> (content-addressed, so
  // repeated runs never overwrite an older original).
  const backupDir = textureBackupDir(projectDir);
  const backupPath = joinPath(backupDir, `${texture.hash}-${baseName(texture.path)}`);
  await mkdir(backupDir, { recursive: true }).catch(() => {});
  if (!(await exists(backupPath).catch(() => false))) {
    await copyFile(absPath, backupPath);
  }

  const request: TextureOptimizeRequest = {
    ytdPath: absPath,
    outPath: null, // in-place
    maxDimension: settings.maxDimension,
    format: settings.format,
    regenerateMips: settings.regenerateMips,
  };
  try {
    const result = await optimizeTexture(request);
    const parsed = await parseYtd(absPath);
    return {
      path: texture.path,
      oldHash: texture.hash,
      next: { path: texture.path, hash: parsed.sha256, size: parsed.sizeBytes },
      before: result.before,
      after: result.after,
    };
  } catch (e) {
    // Failed mid-way (optimize error or re-hash failure): restore the
    // original so the file on disk never diverges from the project refs.
    await copyFile(backupPath, absPath).catch(() => {});
    throw e;
  }
}

/**
 * Commits optimize results: ONE undoable store update + cache invalidation
 * (texture thumbnails/meta and every GLB rendered with the old hash).
 */
export function applyOptimizedTextures(results: OptimizedTexture[]): void {
  if (results.length === 0) return;
  useProjectStore
    .getState()
    .updateTexturesBatch(results.map((r) => ({ path: r.path, next: r.next })));
  for (const result of results) {
    if (result.oldHash === result.next.hash) continue;
    usePreviewStore.getState().invalidatePreview(result.oldHash);
    usePreview3dStore.getState().invalidateGlbsByTextureHash(result.oldHash);
  }
}

/** Unique texture refs of the whole project, keyed by project-relative path. */
export function collectProjectTextures(project: AtelierProject): AssetRef[] {
  const byPath = new Map<string, AssetRef>();
  for (const drawable of project.drawables) {
    for (const texture of drawable.textures) {
      if (!byPath.has(texture.path)) byPath.set(texture.path, texture);
    }
  }
  return [...byPath.values()];
}

/** Longest texture edge inside a parsed .ytd (0 when meta is empty). */
export function maxEdgeOf(
  textures: Array<{ width: number; height: number }>,
): number {
  let max = 0;
  for (const t of textures) max = Math.max(max, t.width, t.height);
  return max;
}
