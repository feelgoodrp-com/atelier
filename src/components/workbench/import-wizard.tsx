import { useCallback, useMemo, useState } from "react";
import {
  Check,
  FolderInput,
  FolderOpen,
  Loader2,
  PackageOpen,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { baseName } from "@/lib/format";
import {
  ALL_SLOT_IDS,
  GTA_COMPONENTS,
  GTA_PROPS,
  type SlotId,
} from "@/lib/gta/components";
import { joinPath } from "@/lib/project/io";
import {
  importPlannedEntries,
  type PlannedImportEntry,
} from "@/lib/project/import-assets";
import {
  createAndOpenProject,
  openProjectFromDir,
} from "@/lib/project/session";
import { importScan } from "@/lib/sidecar/client";
import type { ImportScanEntry } from "@/lib/sidecar/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { Gender } from "@/lib/project/schema";

type WizardStep = "project" | "folder" | "scanning" | "review" | "importing";

interface ReviewRow {
  entry: ImportScanEntry;
  include: boolean;
  gender: Gender;
  type: SlotId | null;
  drawableId: number | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asSlotId(value: string | null): SlotId | null {
  return value && (ALL_SLOT_IDS as readonly string[]).includes(value)
    ? (value as SlotId)
    : null;
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "border-emerald-500/40 text-emerald-300",
  medium: "border-amber-500/40 text-amber-300",
  low: "border-red-500/40 text-red-300",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "hoch",
  medium: "mittel",
  low: "niedrig",
};

/** Minimal include checkbox (no radix checkbox dependency in the project). */
function IncludeCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-4.5 w-4.5 items-center justify-center rounded-[5px] border transition-colors",
        checked
          ? "border-[#5865F2] bg-[#5865F2]"
          : "border-white/25 bg-white/5 hover:border-white/40",
      )}
    >
      {checked && <Check className="h-3 w-3 text-white" />}
    </button>
  );
}

/** Turns a project name into a safe Windows folder name. */
function sanitizeFolderName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "atelier-projekt"
  );
}

/** First wizard step when no project is open: create or open a target project. */
function ProjectStep({ onReady }: { onReady: () => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projectDir = useMemo(
    () => (location ? joinPath(location, sanitizeFolderName(name || "")) : null),
    [location, name],
  );

  const pickLocation = async () => {
    const selected = await openDialog({
      directory: true,
      title: "Speicherort für das Projekt wählen",
    }).catch(() => null);
    if (typeof selected === "string") setLocation(selected);
  };

  const create = async () => {
    if (!name.trim() || !projectDir) return;
    setBusy(true);
    try {
      await createAndOpenProject(projectDir, name.trim());
      onReady();
    } catch (e) {
      toast.error("Projekt konnte nicht erstellt werden", {
        description: errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const openExisting = async () => {
    const selected = await openDialog({
      directory: true,
      title: "atelier-Projektordner wählen",
    }).catch(() => null);
    if (typeof selected !== "string") return;
    setBusy(true);
    try {
      const { recovery } = await openProjectFromDir(selected);
      if (recovery) {
        toast.info("Projekt hat ein neueres Autosave", {
          description:
            "Bitte öffne das Projekt über den Start-Bildschirm, um die Wiederherstellung zu beantworten.",
        });
        return;
      }
      onReady();
    } catch (e) {
      toast.error("Projekt konnte nicht geöffnet werden", {
        description: errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-white/60">
        Der Import braucht ein Ziel-Projekt. Erstelle ein neues oder öffne ein
        bestehendes.
      </p>

      <div className="glass-border-subtle flex flex-col gap-3 rounded-[10px] p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="wizard-project-name" className="text-white/70">
            Projektname
          </Label>
          <Input
            id="wizard-project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Importierter Pack"
            className="border-white/15 bg-white/5 text-white"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-white/70">Speicherort</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={location ?? ""}
              placeholder="Noch kein Ordner gewählt…"
              className="border-white/15 bg-white/5 text-white"
            />
            <Button variant="outline" onClick={() => void pickLocation()}>
              <FolderOpen className="h-4 w-4" />
              Durchsuchen
            </Button>
          </div>
          {projectDir && (
            <p className="break-all text-xs text-white/35">
              Wird erstellt in: {projectDir}
            </p>
          )}
        </div>
        <Button
          disabled={busy || !name.trim() || !location}
          onClick={() => void create()}
        >
          <Plus className="h-4 w-4" />
          Projekt erstellen und fortfahren
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-white/35">oder</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <Button variant="outline" disabled={busy} onClick={() => void openExisting()}>
        <FolderOpen className="h-4 w-4" />
        Bestehendes Projekt öffnen…
      </Button>
    </div>
  );
}

export function ImportWizard() {
  const open = useWorkbenchStore((s) => s.importWizardOpen);
  const setOpen = useWorkbenchStore((s) => s.setImportWizardOpen);
  const hasProject = useProjectStore((s) => s.project !== null);
  const addDrawable = useProjectStore((s) => s.addDrawable);

  const [step, setStep] = useState<WizardStep>("folder");
  const [folder, setFolder] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const effectiveStep: WizardStep =
    !hasProject && step !== "importing" ? "project" : step;

  const reset = useCallback(() => {
    setStep("folder");
    setFolder(null);
    setRows([]);
    setWarnings([]);
    setProgress({ done: 0, total: 0 });
  }, []);

  const close = useCallback(
    (next: boolean) => {
      if (!next && step === "importing") return; // do not abort mid-import
      setOpen(next);
      if (!next) reset();
    },
    [setOpen, step, reset],
  );

  const pickFolderAndScan = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      title: "Clothing-Pack-Ordner wählen",
    }).catch(() => null);
    if (typeof selected !== "string") return;
    setFolder(selected);
    setStep("scanning");
    try {
      const result = await importScan(selected);
      const defaultGender =
        useProjectStore.getState().project?.settings.defaultGender ?? "male";
      setRows(
        result.entries.map((entry) => ({
          entry,
          include: true,
          gender: entry.guessedGender ?? defaultGender,
          type: asSlotId(entry.guessedType),
          drawableId: entry.guessedDrawableId,
        })),
      );
      setWarnings(result.warnings);
      setStep("review");
    } catch (e) {
      toast.error("Ordner konnte nicht gescannt werden", {
        description: errorMessage(e),
      });
      setStep("folder");
    }
  }, []);

  const updateRow = useCallback(
    (index: number, patch: Partial<Omit<ReviewRow, "entry">>) => {
      setRows((prev) =>
        prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const included = rows.filter((r) => r.include);
  const missingType = included.some((r) => r.type === null);

  const runImport = useCallback(async () => {
    const projectDir = useProjectStore.getState().projectDir;
    if (!projectDir || included.length === 0 || missingType) return;

    // Sort so derived drawableIds follow the original pack numbering.
    const planned: PlannedImportEntry[] = included
      .slice()
      .sort(
        (a, b) =>
          a.gender.localeCompare(b.gender) ||
          (a.type ?? "").localeCompare(b.type ?? "") ||
          (a.drawableId ?? Number.MAX_SAFE_INTEGER) -
            (b.drawableId ?? Number.MAX_SAFE_INTEGER) ||
          a.entry.yddPath.localeCompare(b.entry.yddPath),
      )
      .map((row) => ({
        yddPath: row.entry.yddPath,
        texturePaths: row.entry.textures.map((t) => t.path),
        yldPath: row.entry.yldPath,
        gender: row.gender,
        type: row.type as SlotId,
        label: stripExtension(baseName(row.entry.yddPath)),
      }));

    setStep("importing");
    setProgress({ done: 0, total: planned.length });
    try {
      const result = await importPlannedEntries(
        projectDir,
        planned,
        (done, total) => setProgress({ done, total }),
      );
      for (const drawable of result.drawables) addDrawable(drawable);

      const parts = [`${result.drawables.length} Drawable(s) importiert`];
      if (result.skipped.length > 0) {
        parts.push(`${result.skipped.length} übersprungen`);
      }
      toast.success(parts.join(" · "), {
        description:
          result.skipped.length > 0
            ? result.skipped
                .slice(0, 3)
                .map((s) => `${baseName(s.path)}: ${s.reason}`)
                .join("\n")
            : undefined,
      });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Import fehlgeschlagen", { description: errorMessage(e) });
      setStep("review");
    }
  }, [included, missingType, addDrawable, setOpen, reset]);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="liquid-glass max-h-[85vh] border-white/15 sm:max-w-3xl"
        onInteractOutside={(e) => {
          if (step === "importing") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <PackageOpen className="h-4 w-4 text-[#7289DA]" />
            Pack importieren
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Scannt einen Clothing-Pack-Ordner (YDD/YTD/YLD) und übernimmt die
            Drawables in das Projekt.
          </DialogDescription>
        </DialogHeader>

        {effectiveStep === "project" && (
          <ProjectStep onReady={() => setStep("folder")} />
        )}

        {effectiveStep === "folder" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="glass-border-subtle flex h-14 w-14 items-center justify-center rounded-[10px]">
              <FolderInput className="h-6 w-6 text-white/40" />
            </div>
            <p className="max-w-sm text-center text-sm text-white/50">
              Wähle den Ordner eines bestehenden Clothing-Packs. Der Inhalt
              wird analysiert und automatisch zugeordnet.
            </p>
            <Button onClick={() => void pickFolderAndScan()}>
              <FolderOpen className="h-4 w-4" />
              Ordner wählen und scannen
            </Button>
          </div>
        )}

        {effectiveStep === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#7289DA]" />
            <p className="text-sm text-white/50">
              Scanne {folder ? baseName(folder) : "Ordner"}…
            </p>
          </div>
        )}

        {effectiveStep === "review" && (
          <div className="flex min-h-0 flex-col gap-3">
            {warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                <div className="text-xs text-amber-200">
                  {warnings.slice(0, 3).map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                  {warnings.length > 3 && (
                    <p className="text-amber-200/60">
                      … und {warnings.length - 3} weitere Hinweise
                    </p>
                  )}
                </div>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-white/40">
                Keine YDD-Dateien im gewählten Ordner gefunden.
              </p>
            ) : (
              <ScrollArea className="max-h-[45vh] rounded-[10px] border border-white/8">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/8 hover:bg-transparent">
                      <TableHead className="w-8">
                        <IncludeCheckbox
                          checked={included.length === rows.length}
                          onChange={(checked) =>
                            setRows((prev) =>
                              prev.map((r) => ({ ...r, include: checked })),
                            )
                          }
                        />
                      </TableHead>
                      <TableHead className="text-white/50">Datei</TableHead>
                      <TableHead className="w-24 text-white/50">
                        Geschlecht
                      </TableHead>
                      <TableHead className="w-36 text-white/50">Slot</TableHead>
                      <TableHead className="w-16 text-white/50">Nr.</TableHead>
                      <TableHead className="w-14 text-center text-white/50">
                        Tex
                      </TableHead>
                      <TableHead className="w-20 text-white/50">
                        Qualität
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow
                        key={row.entry.yddPath}
                        className={cn(
                          "border-white/8 hover:bg-white/5",
                          !row.include && "opacity-40",
                        )}
                      >
                        <TableCell>
                          <IncludeCheckbox
                            checked={row.include}
                            onChange={(include) => updateRow(i, { include })}
                          />
                        </TableCell>
                        <TableCell>
                          <span
                            className="block max-w-44 truncate text-xs text-white/85"
                            title={row.entry.yddPath}
                          >
                            {baseName(row.entry.yddPath)}
                          </span>
                          {row.entry.yldPath && (
                            <span className="text-[10px] text-emerald-300/70">
                              + Physik (YLD)
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.gender}
                            onValueChange={(v) =>
                              updateRow(i, { gender: v as Gender })
                            }
                          >
                            <SelectTrigger className="h-7 w-20 border-white/15 bg-white/5 font-mono text-[11px] text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">mp_m</SelectItem>
                              <SelectItem value="female">mp_f</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.type ?? undefined}
                            onValueChange={(v) =>
                              updateRow(i, { type: v as SlotId })
                            }
                          >
                            <SelectTrigger
                              className={cn(
                                "h-7 w-32 border-white/15 bg-white/5 text-[11px] text-white",
                                row.type === null &&
                                  row.include &&
                                  "border-amber-500/50",
                              )}
                            >
                              <SelectValue placeholder="Slot wählen…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Components</SelectLabel>
                                {GTA_COMPONENTS.map((slot) => (
                                  <SelectItem key={slot.id} value={slot.id}>
                                    {slot.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel>Props</SelectLabel>
                                {GTA_PROPS.map((slot) => (
                                  <SelectItem key={slot.id} value={slot.id}>
                                    {slot.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={row.drawableId ?? ""}
                            onChange={(e) => {
                              const parsed = Number.parseInt(
                                e.target.value,
                                10,
                              );
                              updateRow(i, {
                                drawableId: Number.isNaN(parsed)
                                  ? null
                                  : Math.max(0, parsed),
                              });
                            }}
                            className="h-7 w-14 border-white/15 bg-white/5 font-mono text-[11px] text-white"
                          />
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs text-white/60">
                          {row.entry.textures.length}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              CONFIDENCE_STYLE[row.entry.confidence] ??
                                "border-white/15 text-white/50",
                            )}
                          >
                            {CONFIDENCE_LABEL[row.entry.confidence] ??
                              row.entry.confidence}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}

            {missingType && (
              <p className="text-xs text-amber-300">
                Einige ausgewählte Einträge haben noch keinen Slot — bitte
                zuweisen oder abwählen.
              </p>
            )}
          </div>
        )}

        {effectiveStep === "importing" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-[#7289DA]" />
            <Progress
              value={
                progress.total > 0
                  ? (progress.done / progress.total) * 100
                  : 0
              }
              className="w-72"
            />
            <p className="text-sm text-white/50">
              Importiere {progress.done}/{progress.total} Drawables…
            </p>
          </div>
        )}

        {effectiveStep === "review" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("folder")}>
              Zurück
            </Button>
            <Button
              disabled={included.length === 0 || missingType}
              onClick={() => void runImport()}
            >
              <PackageOpen className="h-4 w-4" />
              {included.length} Drawable(s) importieren
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
