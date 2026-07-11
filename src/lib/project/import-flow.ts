/**
 * Workbench glue around the stage-1 import pipeline: runs importAssetFiles
 * against the open project, adds finished drafts to the store, queues drafts
 * without a resolvable slot for the assign dialog and reports a toast summary.
 */

import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { getSlotById, type SlotId } from "@/lib/gta/components";
import { useProjectStore } from "@/lib/stores/project-store";
import { usePreferencesStore } from "@/lib/stores/preferences-store";
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
  if (skipped.length > 3) {
    lines.push(i18n.t("errors:import.moreSkipped", { count: skipped.length - 3 }));
  }
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
    toast.error(i18n.t("errors:import.noProjectOpen"));
    return;
  }

  const clothingFiles = filePaths.filter((p) => CLOTHING_FILE_RE.test(p));
  const ignored = filePaths.length - clothingFiles.length;
  if (clothingFiles.length === 0) {
    toast.error(i18n.t("errors:import.noSupportedFiles"));
    return;
  }

  const toastId = toast.loading(
    clothingFiles.length === 1
      ? i18n.t("errors:import.importingOne")
      : i18n.t("errors:import.importingMany", { count: clothingFiles.length }),
  );

  try {
    const dedupExistingYddHashes = usePreferencesStore.getState()
      .skipDuplicatesOnImport
      ? new Set(
          project.drawables
            .map((d) => d.ydd?.hash)
            .filter((h): h is string => Boolean(h)),
        )
      : undefined;

    const result = await importAssetFiles({
      projectDir,
      filePaths: clothingFiles,
      defaultGender: workbench.viewGender,
      defaultType:
        workbench.category !== "all" ? workbench.category : undefined,
      dedupExistingYddHashes,
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
        path: i18n.t("errors:import.filesCount", { count: ignored }),
        reason: i18n.t("errors:import.unsupportedFileTypeShort"),
      });
    }

    const parts: string[] = [];
    if (added > 0) {
      parts.push(i18n.t("errors:import.addedDrawables", { count: added }));
    }
    if (pending.length > 0) {
      parts.push(i18n.t("errors:import.withoutSlot", { count: pending.length }));
    }
    if (skipped.length > 0) {
      parts.push(i18n.t("errors:import.skippedCount", { count: skipped.length }));
    }

    if (added > 0) {
      toast.success(parts.join(" · "), {
        id: toastId,
        description: describeSkipped(skipped),
      });
    } else if (pending.length > 0) {
      toast.info(parts.join(" · "), {
        id: toastId,
        description: i18n.t("errors:import.assignSlotGender"),
      });
    } else {
      toast.error(i18n.t("errors:import.nothingImported"), {
        id: toastId,
        description: describeSkipped(skipped),
      });
    }
  } catch (e) {
    toast.error(i18n.t("errors:import.importFailed"), {
      id: toastId,
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
