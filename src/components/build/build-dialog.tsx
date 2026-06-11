/**
 * Build dialog (workbench header "Bauen"):
 *
 *   1. setup      — target, dlcName (persisted back to the project settings),
 *                   optional resourceName, output folder (remembered in the
 *                   plugin store), shop-meta switch (fivem only)
 *   2. validation — POST /validate, findings grouped by severity; errors
 *                   block the build button, drawable findings can jump into
 *                   the workbench list
 *   3. build      — POST /build + SSE progress, terminal report summary with
 *                   "Ordner öffnen" or a readable German error
 *
 * Closing is blocked while validation/build is running (like the import
 * wizard) — the sidecar runs one job at a time per process.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Crosshair,
  FolderOpen,
  Hammer,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getSlotById } from "@/lib/gta/components";
import { getLastBuildOutDir, setLastBuildOutDir } from "@/lib/settings";
import {
  BuildBusyError,
  buildProgress,
  startBuild,
  validateProject,
} from "@/lib/sidecar/client";
import type {
  BuildProgressEvent,
  BuildReport,
  BuildTarget,
  FindingSeverity,
  ValidationFinding,
} from "@/lib/sidecar/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";

type BuildStep = "setup" | "validating" | "findings" | "building" | "done" | "failed";

const DLC_NAME_RE = /^[a-z0-9_]+$/;
const RESOURCE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

interface TargetOption {
  id: BuildTarget;
  label: string;
  description: string;
}

const TARGETS: TargetOption[] = [
  {
    id: "fivem",
    label: "FiveM",
    description: "Streambare Server-Ressource mit echten YMT-Dateien (empfohlen).",
  },
  {
    id: "singleplayer",
    label: "Singleplayer",
    description: "dlc.rpf für den GTA-V-Einzelspieler (dlclist.xml-Eintrag nötig).",
  },
  {
    id: "ragemp",
    label: "RageMP",
    description: "dlc.rpf im Client-Format für RageMP-Server (experimentell).",
  },
  {
    id: "altv",
    label: "alt:V",
    description: "Ordner-Struktur als DLC-Ressource für alt:V (experimentell).",
  },
];

/** German labels for the SSE progress phases of the sidecar builders. */
const PHASE_LABELS: Record<string, string> = {
  validate: "Validierung",
  plan: "Build-Plan",
  copy: "Dateien kopieren",
  ymt: "YMT-Generierung",
  meta: "Manifeste schreiben",
  package: "Paketierung",
};

const SEVERITY_ORDER: FindingSeverity[] = ["error", "warn", "info"];

const SEVERITY_META: Record<
  FindingSeverity,
  { label: string; icon: typeof Info; row: string; iconColor: string }
> = {
  error: {
    label: "Fehler",
    icon: CircleAlert,
    row: "border-red-500/25 bg-red-500/10 text-red-200",
    iconColor: "text-red-400",
  },
  warn: {
    label: "Warnungen",
    icon: TriangleAlert,
    row: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    iconColor: "text-amber-300",
  },
  info: {
    label: "Hinweise",
    icon: Info,
    row: "border-white/10 bg-white/5 text-white/60",
    iconColor: "text-white/40",
  },
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
      {children}
    </Label>
  );
}

/** One finding row, with a jump-to button when it points at a drawable. */
function FindingRow({
  finding,
  onJump,
}: {
  finding: ValidationFinding;
  onJump: (drawableId: string) => void;
}) {
  const project = useProjectStore((s) => s.project);
  const drawable = finding.drawableId
    ? project?.drawables.find((d) => d.id === finding.drawableId)
    : undefined;
  const meta = SEVERITY_META[finding.severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[10px] border px-2.5 py-2 text-xs",
        meta.row,
      )}
    >
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.iconColor)} />
      <div className="min-w-0 flex-1">
        {drawable && (
          <p className="mb-0.5 flex items-center gap-1.5 text-[10px] opacity-75">
            <span className="font-mono">
              {drawable.gender === "male" ? "mp_m" : "mp_f"} ·{" "}
              {getSlotById(drawable.type)?.label ?? drawable.type}
            </span>
            <span className="truncate font-semibold">{drawable.label}</span>
          </p>
        )}
        <p className="break-words">{finding.message}</p>
      </div>
      {drawable && (
        <button
          type="button"
          onClick={() => onJump(drawable.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-current opacity-50 transition-opacity hover:opacity-100"
          title="Im Workbench anzeigen"
        >
          <Crosshair className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface BuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuildDialog({ open, onOpenChange }: BuildDialogProps) {
  const project = useProjectStore((s) => s.project);
  const projectDir = useProjectStore((s) => s.projectDir);
  const updateSettings = useProjectStore((s) => s.updateSettings);

  const setViewGender = useWorkbenchStore((s) => s.setViewGender);
  const setCategory = useWorkbenchStore((s) => s.setCategory);
  const setSearch = useWorkbenchStore((s) => s.setSearch);
  const requestScrollTo = useWorkbenchStore((s) => s.requestScrollTo);
  const setSelection = useProjectStore((s) => s.setSelection);

  const [step, setStep] = useState<BuildStep>("setup");
  const [target, setTarget] = useState<BuildTarget>("fivem");
  const [dlcName, setDlcName] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [outDir, setOutDir] = useState<string | null>(null);
  const [generateShopMeta, setGenerateShopMeta] = useState(true);
  const [findings, setFindings] = useState<ValidationFinding[]>([]);
  const [progress, setProgress] = useState<BuildProgressEvent | null>(null);
  const [report, setReport] = useState<BuildReport | null>(null);
  const [builtOutDir, setBuiltOutDir] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const running = step === "validating" || step === "building";

  // Re-initialize from project settings + remembered folder on every open.
  // Only depends on `open` — persisting the dlcName during validation must
  // not reset the wizard mid-flight.
  useEffect(() => {
    if (!open) return;
    setStep("setup");
    setTarget("fivem");
    setDlcName(useProjectStore.getState().project?.settings.dlcName ?? "");
    setResourceName("");
    setGenerateShopMeta(true);
    setFindings([]);
    setProgress(null);
    setReport(null);
    setBuiltOutDir(null);
    setBuildError(null);
    void getLastBuildOutDir().then((dir) => {
      if (dir) setOutDir((current) => current ?? dir);
    });
  }, [open]);

  const close = useCallback(
    (next: boolean) => {
      if (!next && running) return; // never abandon a running job silently
      onOpenChange(next);
    },
    [onOpenChange, running],
  );

  const normalizedDlc = dlcName.trim().toLowerCase();
  const dlcValid = DLC_NAME_RE.test(normalizedDlc);
  const trimmedResource = resourceName.trim();
  const resourceValid =
    trimmedResource.length === 0 || RESOURCE_NAME_RE.test(trimmedResource);
  const setupValid = dlcValid && resourceValid && outDir !== null;

  const grouped = useMemo(() => {
    const bySeverity: Record<FindingSeverity, ValidationFinding[]> = {
      error: [],
      warn: [],
      info: [],
    };
    for (const finding of findings) {
      (bySeverity[finding.severity] ?? bySeverity.info).push(finding);
    }
    return bySeverity;
  }, [findings]);
  const errorCount = grouped.error.length;

  const pickOutDir = async () => {
    const selected = await openDialog({
      directory: true,
      title: "Ausgabeordner für den Build wählen",
      defaultPath: outDir ?? undefined,
    }).catch(() => null);
    if (typeof selected === "string") {
      setOutDir(selected);
      void setLastBuildOutDir(selected);
    }
  };

  const jumpToDrawable = (drawableId: string) => {
    const drawable = project?.drawables.find((d) => d.id === drawableId);
    if (!drawable) return;
    setViewGender(drawable.gender);
    setCategory(drawable.type);
    setSearch("");
    setSelection([drawableId]);
    requestScrollTo(drawableId);
    onOpenChange(false);
  };

  const runValidation = async () => {
    if (!project || !projectDir || !setupValid) return;
    // Persist the (normalized) DLC name back into the project settings.
    if (normalizedDlc !== project.settings.dlcName) {
      updateSettings({ dlcName: normalizedDlc });
    }
    setStep("validating");
    try {
      setFindings(await validateProject(projectDir, project));
      setStep("findings");
    } catch (e) {
      toast.error("Validierung fehlgeschlagen", { description: errorMessage(e) });
      setStep("setup");
    }
  };

  const runBuild = async () => {
    const current = useProjectStore.getState().project;
    if (!current || !projectDir || !outDir || errorCount > 0) return;
    setStep("building");
    setProgress(null);
    try {
      const { jobId } = await startBuild({
        projectDir,
        project: current,
        target,
        outDir,
        options: {
          dlcName: normalizedDlc,
          resourceName: trimmedResource || null,
          generateShopMeta,
          splitAt: 128,
        },
      });
      const done = await buildProgress(jobId, setProgress);
      if ("error" in done) {
        setBuildError(done.error);
        setStep("failed");
        return;
      }
      setReport(done.report);
      setBuiltOutDir(done.outDir);
      setStep("done");
      toast.success("Build abgeschlossen", {
        description: `${done.report.resources.length} Ressource(n) in ${done.outDir}`,
      });
    } catch (e) {
      if (e instanceof BuildBusyError) {
        toast.error("Sidecar ist beschäftigt", { description: errorMessage(e) });
        setStep("findings");
        return;
      }
      setBuildError(errorMessage(e));
      setStep("failed");
    }
  };

  const openOutputFolder = async () => {
    if (!builtOutDir) return;
    try {
      await openPath(builtOutDir);
    } catch (e) {
      toast.error("Ordner konnte nicht geöffnet werden", {
        description: errorMessage(e),
      });
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="liquid-glass max-h-[85vh] border-white/15 sm:max-w-xl"
        showCloseButton={!running}
        onInteractOutside={(e) => {
          if (running) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Hammer className="h-4 w-4 text-[#7289DA]" />
            Pack bauen
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Baut das Projekt als installierbare Clothing-Ressource für das
            gewählte Ziel.
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Ziel</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                {TARGETS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTarget(option.id)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left transition-colors",
                      target === option.id
                        ? "border-[#5865F2]/60 bg-[#5865F2]/10"
                        : "border-white/10 bg-white/5 hover:border-white/25",
                    )}
                  >
                    <span className="text-sm font-semibold text-white">
                      {option.label}
                    </span>
                    <span className="text-[11px] leading-snug text-white/45">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>DLC-Name</FieldLabel>
                <Input
                  value={dlcName}
                  onChange={(e) => setDlcName(e.target.value)}
                  placeholder="z. B. fgsommer"
                  className={cn(
                    "h-8 border-white/15 bg-white/5 font-mono text-xs text-white",
                    dlcName.length > 0 && !dlcValid && "border-red-500/50",
                  )}
                />
                {dlcName.length > 0 && !dlcValid && (
                  <p className="text-[10px] text-red-300">
                    Nur Kleinbuchstaben, Ziffern und Unterstriche (a–z, 0–9, _).
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Ressourcen-Name (optional)</FieldLabel>
                <Input
                  value={resourceName}
                  onChange={(e) => setResourceName(e.target.value)}
                  placeholder={normalizedDlc || "wie DLC-Name"}
                  className={cn(
                    "h-8 border-white/15 bg-white/5 font-mono text-xs text-white",
                    !resourceValid && "border-red-500/50",
                  )}
                />
                {!resourceValid && (
                  <p className="text-[10px] text-red-300">
                    Erlaubt sind Buchstaben, Ziffern, _ und -.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>Ausgabeordner</FieldLabel>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={outDir ?? ""}
                  placeholder="Noch kein Ordner gewählt…"
                  className="h-8 border-white/15 bg-white/5 text-xs text-white"
                  title={outDir ?? undefined}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => void pickOutDir()}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Durchsuchen
                </Button>
              </div>
            </div>

            {target === "fivem" && (
              <div className="flex items-center justify-between rounded-[10px] border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex flex-col">
                  <span className="text-xs text-white/70">
                    shop_ped_apparel.meta erzeugen
                  </span>
                  <span className="text-[10px] text-white/35">
                    Macht die Drawables für Shop-/Kleidungs-Scripts auffindbar.
                  </span>
                </div>
                <Switch
                  checked={generateShopMeta}
                  onCheckedChange={setGenerateShopMeta}
                />
              </div>
            )}
          </div>
        )}

        {step === "validating" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#7289DA]" />
            <p className="text-sm text-white/50">Projekt wird geprüft…</p>
          </div>
        )}

        {step === "findings" && (
          <div className="flex min-h-0 flex-col gap-3">
            {findings.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <CircleCheck className="h-8 w-8 text-emerald-400" />
                <p className="text-sm text-white/60">
                  Keine Probleme gefunden — bereit zum Bauen.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[45vh] pr-1">
                <div className="flex flex-col gap-3">
                  {SEVERITY_ORDER.map((severity) => {
                    const list = grouped[severity];
                    if (list.length === 0) return null;
                    return (
                      <div key={severity} className="flex flex-col gap-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                          {SEVERITY_META[severity].label} ({list.length})
                        </p>
                        {list.map((finding, i) => (
                          <FindingRow
                            key={`${finding.code}:${finding.drawableId ?? "global"}:${i}`}
                            finding={finding}
                            onJump={jumpToDrawable}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
            {errorCount > 0 && (
              <p className="text-xs text-red-300">
                {errorCount} Fehler verhindern den Build — bitte beheben und
                erneut prüfen.
              </p>
            )}
          </div>
        )}

        {step === "building" && (
          <div className="flex flex-col gap-3 py-6">
            <div className="flex items-center gap-2 text-sm text-white">
              <Loader2 className="h-4 w-4 animate-spin text-[#7289DA]" />
              {progress
                ? (PHASE_LABELS[progress.phase] ?? progress.phase)
                : "Build wird gestartet…"}
              {progress && progress.total > 1 && (
                <span className="ml-auto font-mono text-[10px] text-white/35">
                  {Math.min(progress.current, progress.total)}/{progress.total}
                </span>
              )}
            </div>
            <Progress value={percent} className="h-1.5 bg-white/10" />
            <p className="min-h-4 truncate text-[11px] text-white/40">
              {progress?.message ?? ""}
            </p>
          </div>
        )}

        {step === "done" && report && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CircleCheck className="h-5 w-5 shrink-0 text-emerald-400" />
              <p className="text-sm text-white">
                Build abgeschlossen — {report.resources.length} Ressource(n)
                erstellt.
              </p>
            </div>
            <div className="rounded-[10px] border border-white/10">
              {report.resources.map((resource) => (
                <div
                  key={resource.folder}
                  className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-xs last:border-b-0"
                >
                  <span className="truncate font-mono text-white/80">
                    {resource.folder}
                  </span>
                  <span className="shrink-0 text-white/40">
                    {resource.drawables} Drawable(s)
                  </span>
                </div>
              ))}
            </div>
            {report.warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                <div className="min-w-0 text-xs text-amber-200">
                  {report.warnings.map((warning) => (
                    <p key={warning} className="break-words">
                      {warning}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === "failed" && (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-start gap-2 rounded-[10px] border border-red-500/25 bg-red-500/10 px-3 py-2.5">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="break-words text-sm text-red-200">
                {buildError ?? "Der Build ist fehlgeschlagen."}
              </p>
            </div>
          </div>
        )}

        {step === "setup" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Abbrechen
            </Button>
            <Button disabled={!setupValid} onClick={() => void runValidation()}>
              Weiter zur Prüfung
            </Button>
          </DialogFooter>
        )}

        {step === "findings" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("setup")}>
              Zurück
            </Button>
            <Button disabled={errorCount > 0} onClick={() => void runBuild()}>
              <Hammer className="h-4 w-4" />
              Bauen
            </Button>
          </DialogFooter>
        )}

        {step === "done" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => void openOutputFolder()}>
              <FolderOpen className="h-4 w-4" />
              Ordner öffnen
            </Button>
            <Button onClick={() => close(false)}>Schließen</Button>
          </DialogFooter>
        )}

        {step === "failed" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("setup")}>
              Zurück
            </Button>
            <Button onClick={() => close(false)}>Schließen</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
