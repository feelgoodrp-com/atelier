/**
 * Build session state — everything after the setup dialog.
 *
 * This lives in a store rather than in the screen component on purpose: a
 * check or build runs for minutes, and the user must be able to jump to a
 * drawable in the workbench and come back without losing the session (or
 * killing the job). The async work runs in the actions, so unmounting the
 * screen never interrupts it.
 */

import { create } from "zustand";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { log } from "@/lib/log";
import { parseValidateProgress, type ValidateProgress } from "@/lib/log-humanize";
import {
  startLogStream,
  stopLogStream,
  useLogConsoleStore,
} from "@/lib/stores/log-console-store";
import { errorMessage } from "@/lib/utils";
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
import { useUiStore, type Screen } from "@/lib/stores/ui-store";

export type BuildStep = "validating" | "findings" | "building" | "done" | "failed";

export interface BuildOptions {
  target: BuildTarget;
  outDir: string;
  /** Already normalized (lowercase, trimmed). */
  dlcName: string;
  resourceName: string | null;
  generateShopMeta: boolean;
}

interface BuildState {
  /** A session exists (the build screen has something to show). */
  active: boolean;
  /**
   * Project this session belongs to. The session outlives the screen, so it
   * must NOT outlive the project — otherwise a project switch would build the
   * new project into the old one's output folder.
   */
  projectDir: string | null;
  /** Screen to return to when the session is left or finished. */
  origin: Screen;
  step: BuildStep;
  options: BuildOptions | null;
  findings: ValidationFinding[];
  progress: BuildProgressEvent | null;
  report: BuildReport | null;
  builtOutDir: string | null;
  error: string | null;
  /** Wall-clock start of the session — the log pane's cutoff. */
  startedAt: number;
  /** Position of the running check, read from the sidecar's log pulse. */
  validateProgress: ValidateProgress | null;
  /** Id of the running build job (kept for diagnostics on a lost stream). */
  jobId: string | null;
  /** Findings list UI, here so it survives a jump to the workbench. */
  filter: FindingSeverity | null;
  query: string;

  /** Opens the build screen and immediately starts the check. */
  start: (options: BuildOptions, origin: Screen) => void;
  /** Re-runs the check with the same options (after fixing something). */
  recheck: () => Promise<void>;
  runBuild: () => Promise<void>;
  setFilter: (filter: FindingSeverity | null) => void;
  setQuery: (query: string) => void;
  /** Leaves the session and returns to the origin screen. */
  end: () => void;
  /** Drops the session without navigating (project switch / close). */
  discard: () => void;
}

const initial = {
  active: false,
  projectDir: null,
  origin: "workbench" as Screen,
  step: "validating" as BuildStep,
  options: null,
  findings: [],
  progress: null,
  report: null,
  builtOutDir: null,
  error: null,
  startedAt: 0,
  validateProgress: null,
  jobId: null,
  filter: null,
  query: "",
};

export const useBuildStore = create<BuildState>((set, get) => ({
  ...initial,

  start: (options, origin) => {
    const { projectDir } = useProjectStore.getState();
    if (!projectDir) return;
    set({
      ...initial,
      active: true,
      projectDir,
      origin,
      options,
      step: "validating",
      startedAt: Date.now(),
    });
    useUiStore.getState().setScreen("build");
    void get().recheck();
  },

  recheck: async () => {
    const { options } = get();
    const { project, projectDir } = useProjectStore.getState();
    if (!options || !project || !projectDir) return;
    if (projectDir !== get().projectDir) return; // session belongs elsewhere
    if (get().step === "validating" && get().validateProgress) return; // already checking

    const startedAt = Date.now();
    set({
      step: "validating",
      findings: [],
      error: null,
      // `total` is known up front, so the ring starts determinate instead of
      // spinning until the first line arrives.
      validateProgress: { current: 0, total: project.drawables.length, label: "" },
    });
    log.info("checking project", {
      drawables: project.drawables.length,
      dlcName: options.dlcName,
    });

    // /validate is a plain request/response — its only progress signal is the
    // sidecar's per-item log line. Subscribe HERE (not in a component): the
    // build screen unmounts whenever the user jumps to the workbench, and the
    // ring must keep counting. `since` keeps the ring buffer's replay of an
    // earlier run from snapping this one straight to N/N.
    const unsubscribe = useLogConsoleStore.subscribe((state, previous) => {
      if (state.entries === previous.entries) return;
      for (let i = previous.entries.length; i < state.entries.length; i++) {
        const entry = state.entries[i];
        if (!entry || entry.ts < startedAt) continue;
        const progress = parseValidateProgress(entry.message);
        if (progress) set({ validateProgress: progress });
      }
    });
    void startLogStream();

    try {
      const findings = await validateProject(projectDir, project);
      log.info("project checked", {
        findings: findings.length,
        errors: findings.filter((f) => f.severity === "error").length,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      });
      set({ findings, step: "findings" });
    } catch (e) {
      const error = errorMessage(e);
      log.error("project check failed", { error });
      toast.error(i18n.t("build:toast.validateFailed"), { description: error });
      set({ step: "failed", error });
    } finally {
      unsubscribe();
      void stopLogStream();
      set({ validateProgress: null });
    }
  },

  runBuild: async () => {
    const { options, findings } = get();
    const { project, projectDir } = useProjectStore.getState();
    if (!options || !project || !projectDir) return;
    if (projectDir !== get().projectDir) return; // session belongs elsewhere
    if (findings.some((f) => f.severity === "error")) return;
    if (get().step === "building") return; // never start a second job

    set({ step: "building", progress: null, error: null });
    const startedAt = Date.now();
    log.info("build started", {
      target: options.target,
      outDir: options.outDir,
      dlcName: options.dlcName,
      resourceName: options.resourceName,
      drawables: project.drawables.length,
    });
    try {
      const { jobId } = await startBuild({
        projectDir,
        project,
        target: options.target,
        outDir: options.outDir,
        options: {
          dlcName: options.dlcName,
          resourceName: options.resourceName,
          generateShopMeta: options.generateShopMeta,
          splitAt: 256,
        },
      });

      set({ jobId });

      // Mirror every SSE tick into the log pipeline so the live pane shows the
      // build is still moving: phase changes at INFO, individual ticks DEBUG.
      let lastPhase = "";
      const done = await buildProgress(jobId, (event) => {
        // A throw in here would abort the progress reader and orphan the job.
        try {
          set({ progress: event });
          if (event.phase !== lastPhase) {
            lastPhase = event.phase;
            log.info(`build phase: ${event.phase}`, { total: event.total });
          }
          log.debug(`build ${event.phase} ${event.current}/${event.total} — ${event.message}`);
        } catch {
          /* progress display is never worth killing the build for */
        }
      });

      if ("error" in done) {
        log.error("build failed", { error: done.error, jobId });
        set({ step: "failed", error: done.error });
        return;
      }
      log.info("build finished", {
        resources: done.report.resources.length,
        warnings: done.report.warnings.length,
        outDir: done.outDir,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      });
      set({ step: "done", report: done.report, builtOutDir: done.outDir });
      toast.success(i18n.t("build:toast.buildDone"), {
        description: i18n.t("build:toast.buildDoneDesc", {
          count: done.report.resources.length,
          dir: done.outDir,
        }),
      });
    } catch (e) {
      const error = errorMessage(e);
      if (e instanceof BuildBusyError) {
        log.warn("build rejected — sidecar busy", { error });
        toast.error(i18n.t("build:toast.sidecarBusy"), { description: error });
        set({ step: "findings" });
        return;
      }
      log.error("build failed", { error });
      set({ step: "failed", error });
    }
  },

  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),

  end: () => {
    const { origin, step } = get();
    // Never abandon a running job silently.
    if (step === "validating" || step === "building") return;
    set({ ...initial });
    useUiStore.getState().setScreen(origin);
  },

  discard: () => set({ ...initial }),
}));

// A session is tied to one project: opening or closing a project must not
// leave a stale session behind that would build into the old output folder.
useProjectStore.subscribe((state, previous) => {
  if (state.projectDir === previous.projectDir) return;
  const { active, projectDir } = useBuildStore.getState();
  if (active && projectDir !== state.projectDir) useBuildStore.getState().discard();
});

/** True while a check or build is in flight (blocks leaving the session). */
export function isBuildRunning(step: BuildStep): boolean {
  return step === "validating" || step === "building";
}
