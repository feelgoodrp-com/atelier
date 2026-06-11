import { useEffect, useMemo, useRef, useState } from "react";
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
    title: "Clothing-Dateien wählen (YDD, YTD, YLD)",
    filters: [
      { name: "Clothing-Dateien", extensions: ["ydd", "ytd", "yld"] },
      { name: "Drawables (YDD)", extensions: ["ydd"] },
    ],
  });
  if (Array.isArray(selected) && selected.length > 0) {
    await runFileImport(selected);
  } else if (typeof selected === "string") {
    await runFileImport([selected]);
  }
}

function ProjectName() {
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
      title="Projekt umbenennen"
    >
      <span className="truncate text-sm font-semibold text-white">{name}</span>
      <Pencil className="h-3 w-3 shrink-0 text-white/0 transition-colors group-hover:text-white/40" />
    </button>
  );
}

function SaveIndicator() {
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
    ? "Speichert…"
    : dirty
      ? "Ungespeichert"
      : "Gespeichert";

  const tooltip = saving
    ? "pack.atelier wird geschrieben…"
    : dirty
      ? lastAutosavedAt
        ? `Letztes Autosave ${formatRelativeTime(lastAutosavedAt)} — Strg+S zum Speichern`
        : "Noch nicht gesichert — Strg+S zum Speichern"
      : lastSavedAt
        ? `Gespeichert ${formatRelativeTime(lastSavedAt)}`
        : "Alle Änderungen gespeichert";

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
            aria-label="Rückgängig"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Rückgängig (Strg+Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={iconButton}
            disabled={!canRedo}
            onClick={() => useProjectStore.temporal.getState().redo()}
            aria-label="Wiederholen"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Wiederholen (Strg+Y)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={iconButton}
            disabled={saving || !dirty}
            onClick={() => void saveNow()}
            aria-label="Speichern"
          >
            <Save className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Speichern (Strg+S)</TooltipContent>
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
            aria-label="3D-Vorschau"
          >
            <Rotate3d className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          3D-Vorschau {previewOpen ? "ausblenden" : "einblenden"}
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
              {duplicateCount} Duplikat{duplicateCount === 1 ? "" : "e"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Identische YDD-Dateien im Projekt anzeigen
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
              aria-label="Werkzeuge"
            >
              <Wrench className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onClick={() => setBulkOptimizeOpen(true)}>
              <Images className="h-4 w-4" />
              Alle übergroßen Texturen optimieren…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-3 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Importieren
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => void pickAndImportFiles()}>
              <Plus className="h-4 w-4" />
              Dateien hinzufügen…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImportWizardOpen(true)}>
              <FolderInput className="h-4 w-4" />
              Pack importieren…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={(project?.drawables.length ?? 0) === 0}
              onClick={() => setBuildOpen(true)}
            >
              <Hammer className="h-3.5 w-3.5" />
              Bauen
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Pack als Clothing-Ressource bauen (FiveM, Singleplayer, …)
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
