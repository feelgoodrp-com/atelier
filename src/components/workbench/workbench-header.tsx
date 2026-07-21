import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import {
  Check,
  CopyX,
  FolderInput,
  Hammer,
  Images,
  Loader2,
  Pencil,
  Plus,
  Redo2,
  Rotate3d,
  Save,
  Undo2,
  Wrench,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BuildDialog } from "@/components/build/build-dialog";
import { isBuildRunning, useBuildStore } from "@/lib/stores/build-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { BulkOptimizeDialog } from "@/components/build/bulk-optimize-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/format";
import { runFileImport } from "@/lib/project/import-flow";
import {
  selectDuplicateYddMap,
  useProjectStore,
} from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import { CloudSection } from "@/components/workbench/cloud-section";
import type { Gender } from "@/lib/project/schema";

/** Opens the multi-file dialog for clothing files and runs the import. */
export async function pickAndImportFiles(): Promise<void> {
  const selected = await openDialog({
    multiple: true,
    title: i18n.t("workbench:filePicker.clothingTitle"),
    filters: [
      {
        name: i18n.t("workbench:filePicker.clothingFiles"),
        extensions: ["ydd", "ytd", "yld"],
      },
      {
        name: i18n.t("workbench:filePicker.drawablesYdd"),
        extensions: ["ydd"],
      },
    ],
  });
  if (Array.isArray(selected) && selected.length > 0) {
    await runFileImport(selected);
  } else if (typeof selected === "string") {
    await runFileImport([selected]);
  }
}

export function ProjectName() {
  const { t } = useTranslation("workbench");
  const name = useProjectStore((s) => s.project?.name ?? "");
  const renameProject = useProjectStore((s) => s.renameProject);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) renameProject(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-56 border-white/15 bg-white/5 text-sm text-white"
      />
    );
  }

  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-1 text-left transition-colors hover:bg-white/10"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title={t("header.renameProject")}
    >
      <span className="truncate text-sm font-semibold text-white">{name}</span>
      <Pencil className="h-3 w-3 shrink-0 text-white/0 transition-colors group-hover:text-white/40" />
    </button>
  );
}

export function SaveIndicator() {
  const { t } = useTranslation("workbench");
  const dirty = useProjectStore((s) => s.dirty);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const lastAutosavedAt = useProjectStore((s) => s.lastAutosavedAt);
  const saving = useWorkbenchStore((s) => s.saving);

  // Re-render every 10s so the relative time stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, []);

  const relative = formatRelativeTime(
    dirty ? (lastAutosavedAt ?? lastSavedAt) : (lastSavedAt ?? lastAutosavedAt),
  );

  const label = saving
    ? t("header.saving")
    : dirty
      ? t("header.unsaved")
      : t("header.saved");

  const tooltip = saving
    ? t("header.writingPack")
    : dirty
      ? lastAutosavedAt
        ? t("header.lastAutosave", {
            time: formatRelativeTime(lastAutosavedAt),
          })
        : t("header.notYetSaved")
      : lastSavedAt
        ? t("header.savedAt", { time: formatRelativeTime(lastSavedAt) })
        : t("header.allChangesSaved");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-7 cursor-default items-center gap-1.5 rounded-full px-2.5 text-xs text-white/55">
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#7289DA]" />
          ) : dirty ? (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          ) : (
            <Check className="h-3 w-3 text-emerald-400" />
          )}
          <span>{label}</span>
          {relative && !saving && (
            <span className="text-white/30">· {relative}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface WorkbenchHeaderProps {
  onOpenDuplicates: () => void;
}

export function WorkbenchHeader({ onOpenDuplicates }: WorkbenchHeaderProps) {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const viewGender = useWorkbenchStore((s) => s.viewGender);
  const setViewGender = useWorkbenchStore((s) => s.setViewGender);
  const saving = useWorkbenchStore((s) => s.saving);
  const dirty = useProjectStore((s) => s.dirty);
  const saveNow = useWorkbenchStore((s) => s.saveNow);
  const setImportWizardOpen = useWorkbenchStore((s) => s.setImportWizardOpen);
  const previewOpen = useWorkbenchStore((s) => s.previewOpen);
  const setPreviewOpen = useWorkbenchStore((s) => s.setPreviewOpen);

  const [buildOpen, setBuildOpen] = useState(false);
  const buildActive = useBuildStore(
    // A finished session must not keep the button on "back to build".
    (s) => s.active && s.step !== "done" && s.step !== "failed",
  );
  // A check/build reads every ydd and ytd from disk — block the actions that
  // would rewrite those files underneath it.
  const buildRunning = useBuildStore((s) => s.active && isBuildRunning(s.step));
  const setScreen = useUiStore((s) => s.setScreen);
  const [bulkOptimizeOpen, setBulkOptimizeOpen] = useState(false);

  const canUndo = useStore(
    useProjectStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useProjectStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  const duplicateCount = useMemo(
    () => (project ? Object.keys(selectDuplicateYddMap(project)).length : 0),
    [project],
  );

  const iconButton =
    "h-7 w-7 rounded-[8px] text-white/55 hover:bg-white/10 hover:text-white";

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/8 px-3">
      <ProjectName />

      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* Gender view toggle — independent of settings.defaultGender. */}
      <Tabs
        value={viewGender}
        onValueChange={(v) => setViewGender(v as Gender)}
      >
        <TabsList className="h-8 bg-white/5">
          <TabsTrigger value="male" className="h-6 px-3 font-mono text-xs">
            mp_m
          </TabsTrigger>
          <TabsTrigger value="female" className="h-6 px-3 font-mono text-xs">
            mp_f
          </TabsTrigger>
        </TabsList>
      </Tabs>

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
        <TooltipContent side="bottom">{t("header.undoShortcut")}</TooltipContent>
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
        <TooltipContent side="bottom">{t("header.redoShortcut")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={iconButton}
            disabled={saving || !dirty}
            onClick={() => void saveNow()}
            aria-label={t("header.save")}
          >
            <Save className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("header.saveShortcut")}</TooltipContent>
      </Tooltip>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              iconButton,
              previewOpen && "bg-white/10 text-[#7289DA] hover:text-[#7289DA]",
            )}
            onClick={() => setPreviewOpen(!previewOpen)}
            aria-label={t("header.preview3d")}
          >
            <Rotate3d className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("header.preview3dToggle", {
            action: previewOpen ? t("header.hide") : t("header.show"),
          })}
        </TooltipContent>
      </Tooltip>

      {duplicateCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 rounded-[8px] px-2 text-xs text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
              onClick={onOpenDuplicates}
            >
              <CopyX className="h-3.5 w-3.5" />
              {t("header.duplicates", { count: duplicateCount })}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("header.showDuplicates")}
          </TooltipContent>
        </Tooltip>
      )}

      <div className="ml-auto flex items-center gap-2">
        <CloudSection />
        <div className="h-5 w-px bg-white/10" />
        <SaveIndicator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={iconButton}
              aria-label={t("header.tools")}
            >
              <Wrench className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {/* Rewrites texture files in place — must not run while the
                sidecar is reading them for a check or build. */}
            <DropdownMenuItem
              disabled={buildRunning}
              onClick={() => setBulkOptimizeOpen(true)}
            >
              <Images className="h-4 w-4" />
              {t("header.optimizeOversized")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={buildRunning}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("header.import")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => void pickAndImportFiles()}>
              <Plus className="h-4 w-4" />
              {t("header.addFiles")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImportWizardOpen(true)}>
              <FolderInput className="h-4 w-4" />
              {t("header.importPack")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={
                (project?.drawables.length ?? 0) === 0 &&
                (project?.tattoos.length ?? 0) === 0
              }
              onClick={() =>
                // Jumped here from a running session? Go back to it instead of
                // starting a second one.
                buildActive ? setScreen("build") : setBuildOpen(true)
              }
            >
              <Hammer className="h-3.5 w-3.5" />
              {buildActive ? t("header.backToBuild") : t("header.build")}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {buildActive ? t("header.backToBuildTooltip") : t("header.buildTooltip")}
          </TooltipContent>
        </Tooltip>
      </div>

      <BuildDialog open={buildOpen} onOpenChange={setBuildOpen} />
      <BulkOptimizeDialog
        open={bulkOptimizeOpen}
        onOpenChange={setBulkOptimizeOpen}
      />
    </div>
  );
}
