/**
 * First-run setup wizard — shown once before the login gate when the app has
 * never been configured. Walks through the same settings the user would
 * otherwise hunt for in Settings, step by step: the sync server address (with
 * a live health check against the API), the GTA V install folder, and the
 * live-log feature. Completing it sets the `onboardingDone` flag.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronLeft,
  Cloud,
  FolderOpen,
  Globe,
  HardDrive,
  Loader2,
  ScrollText,
  ServerCog,
  X,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import atelierLogo from "@/assets/atelier-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { GateShell } from "@/screens/login";
import i18n, { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { changeLanguage } from "@/lib/i18n/language";
import { checkApiHealth } from "@/lib/sync/api-client";
import { pushGtaPathToSidecar } from "@/lib/sidecar/gta-path";
import {
  DEFAULT_API_URL,
  getApiUrl,
  getGtaPath,
  getLogConsoleEnabled,
  setGtaPath,
  setLogConsoleEnabled,
  setOnboardingDone,
} from "@/lib/settings";
import { useAuthStore } from "@/lib/stores/auth-store";
import { openLogWindow, useLogConsoleStore } from "@/lib/stores/log-console-store";
import { cn } from "@/lib/utils";

type Step = { id: string; title: string };

const STEPS: readonly Step[] = [
  { id: "language", title: "Language" },
  { id: "mode", title: "Mode" },
  { id: "server", title: "Server" },
  { id: "gta", title: "GTA V" },
  { id: "logs", title: "Logs" },
];

type HealthState = "idle" | "checking" | "ok" | "fail";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function StepDots({ steps, index }: { steps: readonly Step[]; index: number }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
              i < index && "bg-emerald-500/20 text-emerald-300",
              i === index && "bg-[#5865F2] text-white",
              i > index && "bg-white/8 text-white/40",
            )}
          >
            {i < index ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          {i < steps.length - 1 && (
            <span className={cn("h-px w-6", i < index ? "bg-emerald-500/40" : "bg-white/10")} />
          )}
        </div>
      ))}
    </div>
  );
}

export function OnboardingWizard({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  /** When set (re-run from Settings), shows an "Abbrechen" exit on step 1. */
  onCancel?: () => void;
}) {
  const { t } = useTranslation("onboarding");
  const setApiUrl = useAuthStore((s) => s.setApiUrl);
  const appMode = useAuthStore((s) => s.appMode);
  const setAppMode = useAuthStore((s) => s.setAppMode);
  const [stepIdx, setStepIdx] = useState(0);

  // Solo mode is fully local, so the sync-server step is dropped from the flow.
  const steps = STEPS.filter((s) => s.id !== "server" || appMode === "cloud");
  // Re-render on language switch so the highlighted option stays in sync.
  const [currentLang, setCurrentLang] = useState(i18n.language);

  // Step 1 — server address + health check.
  const [apiDraft, setApiDraft] = useState(DEFAULT_API_URL);
  const [health, setHealth] = useState<HealthState>("idle");
  const [healthMsg, setHealthMsg] = useState<string | null>(null);

  // Step 2 — GTA path.
  const [gtaPath, setGtaPathState] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Step 3 — live log console.
  const [logEnabled, setLogEnabled] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    void getApiUrl().then(setApiDraft).catch(() => {});
    void getGtaPath().then(setGtaPathState).catch(() => {});
    void getLogConsoleEnabled().then(setLogEnabled).catch(() => {});
  }, []);

  const runHealthCheck = async () => {
    setHealth("checking");
    setHealthMsg(null);
    try {
      const { version } = await checkApiHealth(apiDraft);
      setHealth("ok");
      setHealthMsg(
        version ? t("server.apiRunningHere", { version }) : t("server.apiReachable"),
      );
    } catch (e) {
      setHealth("fail");
      setHealthMsg(errorMessage(e));
    }
  };

  const pickGtaPath = async () => {
    setPicking(true);
    try {
      const selected = await openDialog({
        directory: true,
        title: t("gta.pickerTitle"),
      });
      if (typeof selected === "string") {
        setGtaPathState(selected);
        await setGtaPath(selected);
        const ready = await pushGtaPathToSidecar(selected);
        toast[ready ? "success" : "warning"](t("gta.pathSaved"), {
          description: ready
            ? t("gta.pathSavedReady")
            : t("gta.pathSavedUnverified"),
        });
      }
    } catch (e) {
      toast.error(t("gta.pickFailed"), { description: errorMessage(e) });
    } finally {
      setPicking(false);
    }
  };

  const next = async () => {
    // Persist the server address before leaving the server step (cloud only).
    if (steps[stepIdx].id === "server") {
      await setApiUrl(apiDraft).catch(() => {});
    }
    if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
  };

  const finish = async () => {
    setFinishing(true);
    try {
      await setLogConsoleEnabled(logEnabled);
      useLogConsoleStore.getState().setEnabled(logEnabled);
      if (logEnabled) openLogWindow();
      await setOnboardingDone(true);
      onDone();
    } catch (e) {
      toast.error(t("finishFailed"), {
        description: errorMessage(e),
      });
      setFinishing(false);
    }
  };

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  return (
    <GateShell>
      <div className="flex h-full items-center justify-center px-8">
        <div className="liquid-glass w-full max-w-lg rounded-2xl p-8">
          <div className="flex items-center gap-3">
            <img src={atelierLogo} alt="" className="h-9 w-9" draggable={false} />
            <div>
              <h1 className="text-lg font-semibold text-white">{t("welcomeTitle")}</h1>
              <p className="text-xs text-white/45">{t("welcomeSubtitle")}</p>
            </div>
            <div className="ml-auto">
              <StepDots steps={steps} index={stepIdx} />
            </div>
          </div>

          <div className="mt-7 min-h-[184px]">
            {step.id === "language" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <Globe className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">{t("language.title")}</span>
                </div>
                <p className="text-sm text-white/50">{t("language.description")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const active = currentLang === lang.code;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => {
                          void changeLanguage(lang.code).then(() =>
                            setCurrentLang(lang.code),
                          );
                        }}
                        className={cn(
                          "flex items-center justify-between rounded-[10px] border px-3 py-2.5 text-sm transition-colors",
                          active
                            ? "border-[#5865F2] bg-[#5865F2]/15 text-white"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
                        )}
                      >
                        <span>{lang.label}</span>
                        {active && <Check className="h-4 w-4 shrink-0 text-[#7289DA]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step.id === "mode" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <Cloud className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">{t("mode.title")}</span>
                </div>
                <p className="text-sm text-white/50">{t("mode.description")}</p>
                <div className="flex flex-col gap-2">
                  {(["solo", "cloud"] as const).map((m) => {
                    const active = appMode === m;
                    const Icon = m === "solo" ? HardDrive : Cloud;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void setAppMode(m)}
                        className={cn(
                          "flex items-start gap-3 rounded-[10px] border px-3 py-3 text-left transition-colors",
                          active
                            ? "border-[#5865F2] bg-[#5865F2]/15"
                            : "border-white/10 bg-white/5 hover:bg-white/10",
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#7289DA]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-white">
                            {t(`mode.${m}.title`)}
                          </span>
                          <span className="mt-0.5 block text-xs text-white/50">
                            {t(`mode.${m}.description`)}
                          </span>
                        </span>
                        {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7289DA]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step.id === "server" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <ServerCog className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">{t("server.title")}</span>
                </div>
                <p className="text-sm text-white/50">{t("server.description")}</p>
                <div className="flex gap-2">
                  <Input
                    value={apiDraft}
                    onChange={(e) => {
                      setApiDraft(e.target.value);
                      setHealth("idle");
                      setHealthMsg(null);
                    }}
                    placeholder={DEFAULT_API_URL}
                    className="border-white/15 bg-white/5 text-white"
                  />
                  <Button
                    variant="outline"
                    disabled={health === "checking"}
                    onClick={() => void runHealthCheck()}
                  >
                    {health === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("server.check")
                    )}
                  </Button>
                </div>
                {healthMsg && (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                      health === "ok" && "bg-emerald-500/10 text-emerald-300",
                      health === "fail" && "bg-red-500/10 text-red-300",
                    )}
                  >
                    {health === "ok" ? (
                      <Check className="h-4 w-4 shrink-0" />
                    ) : (
                      <X className="h-4 w-4 shrink-0" />
                    )}
                    <span>{healthMsg}</span>
                  </div>
                )}
              </div>
            )}

            {step.id === "gta" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <FolderOpen className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">{t("gta.title")}</span>
                </div>
                <p className="text-sm text-white/50">{t("gta.description")}</p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={gtaPath ?? ""}
                    placeholder={t("gta.noPathYet")}
                    className="border-white/15 bg-white/5 text-white"
                  />
                  <Button variant="outline" disabled={picking} onClick={() => void pickGtaPath()}>
                    <FolderOpen className="h-4 w-4" />
                    {t("gta.browse")}
                  </Button>
                </div>
                {gtaPath && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                    <Check className="h-4 w-4 shrink-0" />
                    <span>{t("gta.directorySet")}</span>
                  </div>
                )}
              </div>
            )}

            {step.id === "logs" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <ScrollText className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">{t("logs.title")}</span>
                </div>
                <p className="text-sm text-white/50">{t("logs.description")}</p>
                <div className="flex items-center justify-between gap-4 rounded-[10px] bg-white/5 px-3 py-2.5">
                  <span className="text-sm text-white/85">{t("logs.enableWindow")}</span>
                  <Switch checked={logEnabled} onCheckedChange={setLogEnabled} />
                </div>
              </div>
            )}
          </div>

          <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-5">
            {stepIdx > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("common:back")}
              </Button>
            ) : onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {t("common:cancel")}
              </Button>
            ) : (
              <span />
            )}

            {isLast ? (
              <Button
                disabled={finishing}
                className="bg-[#5865F2] text-white hover:bg-[#4752C4]"
                onClick={() => void finish()}
              >
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : t("finish")}
              </Button>
            ) : (
              <Button
                className="bg-[#5865F2] text-white hover:bg-[#4752C4]"
                onClick={() => void next()}
              >
                {t("common:next")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </GateShell>
  );
}
