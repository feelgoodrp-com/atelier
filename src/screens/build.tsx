/**
 * Build screen — the check + build session as a full surface in the main app
 * (state in stores/build-store.ts, so leaving and coming back is safe).
 *
 * Layout: header with the session's settings, the step content in the middle,
 * and the live log on the right rail so there is always visible evidence that
 * something is happening.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  FolderOpen,
  Hammer,
  Info,
  Loader2,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, errorMessage } from "@/lib/utils";
import { getSlotById } from "@/lib/gta/components";
import { BuildLogPane } from "@/components/build/build-log-pane";
import { isBuildRunning, useBuildStore } from "@/lib/stores/build-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { FindingSeverity, ValidationFinding } from "@/lib/sidecar/types";

const SEVERITY_ORDER: FindingSeverity[] = ["error", "warn", "info"];

const SEVERITY_META: Record<
  FindingSeverity,
  { icon: typeof CircleAlert; row: string; iconColor: string; stat: string; dot: string }
> = {
  error: {
    icon: CircleAlert,
    row: "border-red-500/25 bg-red-500/10 text-red-100",
    iconColor: "text-red-400",
    stat: "border-red-500/25 bg-red-500/10",
    dot: "bg-red-400",
  },
  warn: {
    icon: TriangleAlert,
    row: "border-amber-500/25 bg-amber-500/10 text-amber-100",
    iconColor: "text-amber-300",
    stat: "border-amber-500/25 bg-amber-500/10",
    dot: "bg-amber-300",
  },
  info: {
    icon: Info,
    row: "border-white/10 bg-white/5 text-white/70",
    iconColor: "text-white/40",
    stat: "border-white/10 bg-white/5",
    dot: "bg-white/40",
  },
};

/** One finding: severity, the drawable it belongs to, message, machine code. */
function FindingRow({
  finding,
  onJump,
}: {
  finding: ValidationFinding;
  onJump: (drawableId: string) => void;
}) {
  const { t } = useTranslation("build");
  const project = useProjectStore((s) => s.project);
  const drawable = finding.drawableId
    ? project?.drawables.find((d) => d.id === finding.drawableId)
    : undefined;
  const meta = SEVERITY_META[finding.severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;

  return (
    <div className={cn("flex items-start gap-3 rounded-[10px] border px-3 py-2.5", meta.row)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.iconColor)} />
      <div className="min-w-0 flex-1">
        {drawable && (
          <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] opacity-70">
            <span>{drawable.gender === "male" ? "mp_m" : "mp_f"}</span>
            <span>·</span>
            <span>
              {getSlotById(drawable.type) ? t(`workbench:slot.${drawable.type}`) : drawable.type}
            </span>
            <span>·</span>
            <span className="truncate">{drawable.label || drawable.type}</span>
          </p>
        )}
        <p className="break-words text-xs leading-relaxed">{finding.message}</p>
        <p className="mt-1 font-mono text-[10px] opacity-40">{finding.code}</p>
      </div>
      {/* Only when the drawable still exists — otherwise the button is a lie. */}
      {drawable && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-[11px] opacity-70 hover:opacity-100"
          onClick={() => onJump(drawable.id)}
        >
          {t("findings.jumpToWorkbench")}
        </Button>
      )}
    </div>
  );
}

export function BuildScreen() {
  const { t } = useTranslation("build");
  const step = useBuildStore((s) => s.step);
  const options = useBuildStore((s) => s.options);
  const findings = useBuildStore((s) => s.findings);
  const progress = useBuildStore((s) => s.progress);
  const report = useBuildStore((s) => s.report);
  const builtOutDir = useBuildStore((s) => s.builtOutDir);
  const error = useBuildStore((s) => s.error);
  const startedAt = useBuildStore((s) => s.startedAt);
  const filter = useBuildStore((s) => s.filter);
  const query = useBuildStore((s) => s.query);
  const setFilter = useBuildStore((s) => s.setFilter);
  const setQuery = useBuildStore((s) => s.setQuery);
  const recheck = useBuildStore((s) => s.recheck);
  const runBuild = useBuildStore((s) => s.runBuild);
  const end = useBuildStore((s) => s.end);

  const project = useProjectStore((s) => s.project);
  const setSelection = useProjectStore((s) => s.setSelection);
  const setViewGender = useWorkbenchStore((s) => s.setViewGender);
  const setCategory = useWorkbenchStore((s) => s.setCategory);
  const setSearchTerm = useWorkbenchStore((s) => s.setSearch);
  const requestScrollTo = useWorkbenchStore((s) => s.requestScrollTo);
  const setScreen = useUiStore((s) => s.setScreen);

  const running = isBuildRunning(step);

  const counts = useMemo(() => {
    const by: Record<FindingSeverity, number> = { error: 0, warn: 0, info: 0 };
    for (const f of findings) by[f.severity] = (by[f.severity] ?? 0) + 1;
    return by;
  }, [findings]);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const by: Record<FindingSeverity, ValidationFinding[]> = { error: [], warn: [], info: [] };
    for (const f of findings) {
      if (filter && f.severity !== filter) continue;
      if (needle && !`${f.message} ${f.code}`.toLowerCase().includes(needle)) continue;
      (by[f.severity] ?? by.info).push(f);
    }
    return by;
  }, [findings, filter, query]);

  const visibleCount = grouped.error.length + grouped.warn.length + grouped.info.length;

  /** Go fix something in the workbench — the session stays alive. */
  const jumpToDrawable = (drawableId: string) => {
    const drawable = project?.drawables.find((d) => d.id === drawableId);
    if (!drawable) return;
    setViewGender(drawable.gender);
    setCategory(drawable.type);
    setSearchTerm("");
    setSelection([drawableId]);
    requestScrollTo(drawableId);
    setScreen("workbench");
  };

  const openOutputFolder = async () => {
    if (!builtOutDir) return;
    try {
      await openPath(builtOutDir);
    } catch (e) {
      toast.error(t("toast.openFolderFailed"), { description: errorMessage(e) });
    }
  };

  const percent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header ------------------------------------------------------- */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-white/60 hover:text-white"
          disabled={running}
          onClick={end}
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common:back")}
        </Button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Hammer className="h-4 w-4 text-[#7289DA]" />
            {t("screen.title")}
            <span className="truncate text-white/40">— {project?.name}</span>
          </h1>
          {options && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-white/35">
              <span>{t(`targets.${options.target}.label`)}</span>
              <span>·</span>
              <span>{options.dlcName}</span>
              <span>·</span>
              <span className="truncate">{options.outDir}</span>
            </p>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {step === "findings" && (
            <>
              <Button variant="outline" size="sm" onClick={() => void recheck()}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t("screen.recheck")}
              </Button>
              <Button size="sm" disabled={counts.error > 0} onClick={() => void runBuild()}>
                <Hammer className="h-4 w-4" />
                {t("findings.build")}
              </Button>
            </>
          )}
          {step === "done" && (
            <>
              <Button variant="outline" size="sm" onClick={() => void openOutputFolder()}>
                <FolderOpen className="h-4 w-4" />
                {t("done.openFolder")}
              </Button>
              <Button size="sm" onClick={end}>
                {t("common:close")}
              </Button>
            </>
          )}
          {step === "failed" && (
            <Button variant="outline" size="sm" onClick={() => void recheck()}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t("screen.recheck")}
            </Button>
          )}
        </div>
      </div>

      {/* Body --------------------------------------------------------- */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {step === "validating" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-[#7289DA]" />
              <p className="text-sm text-white/60">{t("validating")}</p>
              <p className="max-w-md text-center text-xs text-white/30">
                {t("validating.hint")}
              </p>
            </div>
          )}

          {step === "building" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <div className="w-full max-w-md">
                <div className="mb-2 flex items-center gap-2 text-sm text-white">
                  <Loader2 className="h-4 w-4 animate-spin text-[#7289DA]" />
                  {progress
                    ? t(`phase.${progress.phase}`, { defaultValue: progress.phase })
                    : t("building.starting")}
                  {progress && progress.total > 1 && (
                    <span className="ml-auto font-mono text-[10px] text-white/35">
                      {Math.min(progress.current, progress.total)}/{progress.total}
                    </span>
                  )}
                </div>
                <Progress value={percent} className="h-1.5 bg-white/10" />
                <p className="mt-2 min-h-4 truncate text-[11px] text-white/40">
                  {progress?.message ?? ""}
                </p>
              </div>
            </div>
          )}

          {step === "findings" && (
            <>
              {/* Summary + filters */}
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {SEVERITY_ORDER.map((severity) => {
                  const meta = SEVERITY_META[severity];
                  const active = filter === severity;
                  return (
                    <button
                      key={severity}
                      type="button"
                      onClick={() => setFilter(active ? null : severity)}
                      className={cn(
                        "flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-xs transition-colors",
                        meta.stat,
                        active ? "ring-1 ring-white/40" : "hover:border-white/25",
                        counts[severity] === 0 && "opacity-40",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                      <span className="font-semibold text-white">{counts[severity]}</span>
                      <span className="text-white/60">{t(`severity.${severity}`)}</span>
                    </button>
                  );
                })}
                <div className="ml-auto flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-2">
                    <Search className="h-3.5 w-3.5 text-white/30" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("screen.searchPlaceholder")}
                      className="h-7 w-52 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>

              {counts.error > 0 && (
                <p className="shrink-0 rounded-[10px] border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {t("findings.errorsBlock", { count: counts.error })}
                </p>
              )}

              {findings.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3">
                  <CircleCheck className="h-10 w-10 text-emerald-400" />
                  <p className="text-sm text-white/60">{t("findings.noIssues")}</p>
                  <Button onClick={() => void runBuild()}>
                    <Hammer className="h-4 w-4" />
                    {t("findings.build")}
                  </Button>
                </div>
              ) : visibleCount === 0 ? (
                <p className="flex-1 pt-10 text-center text-xs text-white/35">
                  {t("screen.noMatches")}
                </p>
              ) : (
                <ScrollArea className="min-h-0 flex-1 pr-2">
                  <div className="flex flex-col gap-4">
                    {SEVERITY_ORDER.map((severity) => {
                      const list = grouped[severity];
                      if (list.length === 0) return null;
                      return (
                        <div key={severity} className="flex flex-col gap-1.5">
                          <p className="sticky top-0 z-10 bg-[#0b0b0b]/80 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/40 backdrop-blur-sm">
                            {t(`severity.${severity}`)} ({list.length})
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
            </>
          )}

          {step === "done" && report && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center gap-2">
                <CircleCheck className="h-6 w-6 shrink-0 text-emerald-400" />
                <p className="text-sm text-white">
                  {t("done.title", { count: report.resources.length })}
                </p>
              </div>
              <ScrollArea className="min-h-0 flex-1 pr-2">
                <div className="rounded-[10px] border border-white/10">
                  {report.resources.map((resource) => (
                    <div
                      key={resource.folder}
                      className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-xs last:border-b-0"
                    >
                      <span className="truncate font-mono text-white/80">{resource.folder}</span>
                      <span className="shrink-0 text-white/40">
                        {t("done.drawables", { count: resource.drawables })}
                      </span>
                    </div>
                  ))}
                </div>
                {report.warnings.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2">
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
              </ScrollArea>
            </div>
          )}

          {step === "failed" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <CircleAlert className="h-10 w-10 text-red-400" />
              <p className="max-w-lg break-words text-center text-sm text-red-200">
                {error ?? t("failed.fallback")}
              </p>
              <Button variant="outline" onClick={end}>
                {t("common:back")}
              </Button>
            </div>
          )}
        </div>

        <BuildLogPane className="w-[360px] shrink-0" since={startedAt} />
      </div>
    </div>
  );
}
