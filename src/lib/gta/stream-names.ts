/**
 * Display mirror of the sidecar's canonical stream naming
 * (sidecar/Engine/Build/BuildPlanner.cs -> StreamNames). The build derives
 * ALL file names from slot + drawable number — labels and the original
 * file names on disk never influence the output. The workbench shows these
 * names so users see exactly what the built pack will contain.
 *
 * Short (inner) names only — the full stream name additionally carries the
 * `{ped}[_p]_{dlc}^` prefix, which depends on gender + dlcName at build time.
 */

import type { ProjectDrawable } from "@/lib/project/schema";
import { textureIndexToLetter } from "@/lib/gta/filename-classifier";

/** NNN of a drawable: derived bucket index (addon) or the replace target. */
export function streamNnn(drawable: ProjectDrawable, derivedId: number): number {
  return drawable.mode === "replace" ? (drawable.replaceTargetId ?? 0) : derivedId;
}

function pad3(n: number): string {
  return String(Math.max(0, n)).padStart(3, "0");
}

export function canonicalYddName(drawable: ProjectDrawable, derivedId: number): string {
  const nnn = pad3(streamNnn(drawable, derivedId));
  return drawable.kind === "prop"
    ? `${drawable.type}_${nnn}.ydd`
    : `${drawable.type}_${nnn}_u.ydd`;
}

export function canonicalYtdName(
  drawable: ProjectDrawable,
  derivedId: number,
  textureIndex: number,
): string {
  const nnn = pad3(streamNnn(drawable, derivedId));
  const letter = textureIndexToLetter(textureIndex);
  return drawable.kind === "prop"
    ? `${drawable.type}_diff_${nnn}_${letter}.ytd`
    : `${drawable.type}_diff_${nnn}_${letter}_uni.ytd`;
}
