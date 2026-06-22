/**
 * Header of the tattoos screen: current project name, undo/redo, save state, the
 * coworking roster + cloud controls (reused CloudSection — "wer arbeitet dran?"),
 * and a Build button. Mirrors the workbench header but tattoo-scoped.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Hammer, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BuildDialog } from "@/components/build/build-dialog";
import { CloudSection } from "@/components/workbench/cloud-section";
import { ProjectName, SaveIndicator } from "@/components/workbench/workbench-header";
import { useProjectStore } from "@/lib/stores/project-store";

export function TattooHeader() {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project);
  const [buildOpen, setBuildOpen] = useState(false);

  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);

  const iconButton =
    "h-7 w-7 rounded-[8px] text-white/55 hover:bg-white/10 hover:text-white";

  const canBuild =
    (project?.drawables.length ?? 0) > 0 || (project?.tattoos.length ?? 0) > 0;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/8 px-3">
      <ProjectName />
      <span className="rounded-full bg-[#5865F2]/15 px-2 py-0.5 text-[10px] font-medium text-[#7289DA]">
        {t("header.badge")}
      </span>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={iconButton}
            disabled={!canUndo}
            onClick={() => useProjectStore.temporal.getState().undo()}
            aria-label={t("header.undo")}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("header.undo")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={iconButton}
            disabled={!canRedo}
            onClick={() => useProjectStore.temporal.getState().redo()}
            aria-label={t("header.redo")}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("header.redo")}</TooltipContent>
      </Tooltip>

      <div className="ml-auto flex items-center gap-2">
        <CloudSection />
        <div className="h-5 w-px bg-white/10" />
        <SaveIndicator />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={!canBuild}
              onClick={() => setBuildOpen(true)}
            >
              <Hammer className="h-3.5 w-3.5" />
              {t("header.build")}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("header.buildTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      <BuildDialog open={buildOpen} onOpenChange={setBuildOpen} />
    </div>
  );
}
