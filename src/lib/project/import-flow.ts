/**
 * Workbench glue around the stage-1 import pipeline: runs importAssetFiles
 * against the open project, adds finished drafts to the store, queues drafts
 * without a resolvable slot for the assign dialog and reports a toast summary.
 */

import { toast } from "sonner";
import { getSlotById, type SlotId } from "@/lib/gta/components";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import {
  importAssetFiles,
  type DrawableDraft,
  type ImportSkipped,
} from "./import-assets";
import type { Gender, ProjectDrawable } from "./schema";

const CLOTHING_FILE_RE = /\.(ydd|ytd|yld)$/i;

/** Turns a finished draft (type resolved) into a storable ProjectDrawable. */
export function finalizeDraft(
  draft: DrawableDraft,
  type: SlotId,
  gender?: Gender,
): ProjectDrawable {
  return {
    ...draft,
    type,
    kind: getSlotById(type)?.kind ?? draft.kind,
    gender: gender ?? draft.gender,
  };
}

function describeSkipped(skipped: ImportSkipped[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const lines = skipped
    .slice(0, 3)
    .map((s) => `${s.path.split(/[\\/]/).pop()}: ${s.reason}`);
  if (skipped.length > 3) lines.push(`… und ${skipped.length - 3} weitere`);
  return lines.join("\n");
}

/**
 * Imports dropped/picked files into the open project. Unsupported extensions
 * are filtered up front; drafts without a slot land in
 * workbench-store.pendingDrafts (the assign dialog opens automatically).
 */
export async function runFileImport(filePaths: string[]): Promise<void> {
  const { project, projectDir, addDrawable } = useProjectStore.getState();
  const workbench = useWorkbenchStore.getState();
  if (!project || !projectDir) {
    toast.error("Kein Projekt geöffnet");
    return;
  }

  const clothingFiles = filePaths.filter((p) => CLOTHING_FILE_RE.test(p));
  const ignored = filePaths.length - clothingFiles.length;
  if (clothingFiles.length === 0) {
    toast.error("Keine unterstützten Dateien (YDD, YTD, YLD) gefunden");
    return;
  }

  const toastId = toast.loading(
    clothingFiles.length === 1
      ? "Importiere 1 Datei…"
      : `Importiere ${clothingFiles.length} Dateien…`,
  );

  try {
    const result = await importAssetFiles({
      projectDir,
      filePaths: clothingFiles,
      defaultGender: workbench.viewGender,
      defaultType:
        workbench.category !== "all" ? workbench.category : undefined,
    });

    let added = 0;
    for (const imported of result.drawables) {
      if (imported.needsType || imported.draft.type === null) continue;
      addDrawable(finalizeDraft(imported.draft, imported.draft.type));
      added++;
    }

    const pending = result.drawables.filter(
      (d) => d.needsType || d.draft.type === null,
    );
    if (pending.length > 0) {
      useWorkbenchStore
        .getState()
        .setPendingDrafts([
          ...useWorkbenchStore.getState().pendingDrafts,
          ...pending,
        ]);
    }

    const skipped = [...result.skipped];
    if (ignored > 0) {
      skipped.push({
        path: `${ignored} Datei(en)`,
        reason: "Dateityp wird nicht unterstützt.",
      });
    }

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} Drawable(s) hinzugefügt`);
    if (pending.length > 0) parts.push(`${pending.length} ohne Slot`);
    if (skipped.length > 0) parts.push(`${skipped.length} übersprungen`);

    if (added > 0) {
      toast.success(parts.join(" · "), {
        id: toastId,
        description: describeSkipped(skipped),
      });
    } else if (pending.length > 0) {
      toast.info(parts.join(" · "), {
        id: toastId,
        description: "Bitte Slot und Geschlecht zuweisen.",
      });
    } else {
      toast.error("Nichts importiert", {
        id: toastId,
        description: describeSkipped(skipped),
      });
    }
  } catch (e) {
    toast.error("Import fehlgeschlagen", {
      id: toastId,
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
