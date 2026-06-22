/**
 * Project-wide tattoo validation (the checks zod can't express on its own,
 * e.g. cross-entry uniqueness). Pure + bun-testable; mirrors the severity shape
 * the build/validate flow already uses for drawables.
 *
 * The derived YTD file name and per-gender overlay names come from
 * selectDerivedTattooBuild (project-store.ts) so this validates EXACTLY what the
 * build step will emit.
 */

import type { AtelierProject } from "./schema";
import { selectDerivedTattooBuild } from "@/lib/stores/project-store";

export interface TattooValidationFinding {
  severity: "error" | "warning";
  /** The offending tattoo uuid, or null for project-level findings. */
  tattooId: string | null;
  message: string;
}

export function validateTattoos(project: AtelierProject): TattooValidationFinding[] {
  const findings: TattooValidationFinding[] = [];
  const derived = selectDerivedTattooBuild(project);

  // 1) An image is required to build a YTD.
  for (const t of project.tattoos) {
    if (!t.image) {
      findings.push({
        severity: "error",
        tattooId: t.id,
        message: `Tattoo "${t.label || t.id}" hat kein Bild`,
      });
    }
  }

  // 2) Overlay nameHashes must be unique project-wide (collisions silently
  //    shadow each other in-game).
  const seenName = new Map<string, string>(); // nameHash -> tattooId
  for (const t of project.tattoos) {
    const d = derived[t.id];
    if (!d) continue;
    for (const name of [d.nameMale, d.nameFemale]) {
      if (!name) continue;
      const prev = seenName.get(name);
      if (prev && prev !== t.id) {
        findings.push({
          severity: "error",
          tattooId: t.id,
          message: `Overlay-Name "${name}" wird von mehreren Tattoos benutzt`,
        });
      } else {
        seenName.set(name, t.id);
      }
    }
  }

  // 3) Gender/name coherence (also enforced by zod superRefine; surfaced here so
  //    the build/validate UI reports it consistently).
  for (const t of project.tattoos) {
    const wantsM = t.gender === "both" || t.gender === "male";
    const wantsF = t.gender === "both" || t.gender === "female";
    const d = derived[t.id];
    if (wantsM && !d?.nameMale) {
      findings.push({
        severity: "error",
        tattooId: t.id,
        message: `Tattoo "${t.label || t.id}" fehlt der männliche Overlay-Name`,
      });
    }
    if (wantsF && !d?.nameFemale) {
      findings.push({
        severity: "error",
        tattooId: t.id,
        message: `Tattoo "${t.label || t.id}" fehlt der weibliche Overlay-Name`,
      });
    }
  }

  return findings;
}
