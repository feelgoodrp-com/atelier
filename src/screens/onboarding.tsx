/**
 * First-run setup wizard — shown once before the login gate when the app has
 * never been configured. Walks through the same settings the user would
 * otherwise hunt for in Settings, step by step: the sync server address (with
 * a live health check against the API), the GTA V install folder, and the
 * live-log feature. Completing it sets the `onboardingDone` flag.
 */

import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  FolderOpen,
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

const STEPS = [
  { id: "server", title: "Server" },
  { id: "gta", title: "GTA V" },
  { id: "logs", title: "Logs" },
] as const;

type HealthState = "idle" | "checking" | "ok" | "fail";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function StepDots({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, i) => (
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
          {i < STEPS.length - 1 && (
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
  const setApiUrl = useAuthStore((s) => s.setApiUrl);
  const [stepIdx, setStepIdx] = useState(0);

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
      setHealthMsg(version ? `atelier-api v${version} läuft hier.` : "atelier-api erreichbar.");
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
        title: "GTA V Installationsordner wählen",
      });
      if (typeof selected === "string") {
        setGtaPathState(selected);
        await setGtaPath(selected);
        const ready = await pushGtaPathToSidecar(selected);
        toast[ready ? "success" : "warning"]("GTA V Pfad gespeichert", {
          description: ready
            ? "Ped-Vorschau ist jetzt verfügbar."
            : "Pfad gespeichert, aber nicht verifiziert — enthält der Ordner GTA5.exe und .rpf-Archive?",
        });
      }
    } catch (e) {
      toast.error("Pfad konnte nicht gewählt werden", { description: errorMessage(e) });
    } finally {
      setPicking(false);
    }
  };

  const next = async () => {
    // Persist the server address before leaving step 1.
    if (STEPS[stepIdx].id === "server") {
      await setApiUrl(apiDraft).catch(() => {});
    }
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
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
      toast.error("Einrichtung konnte nicht abgeschlossen werden", {
        description: errorMessage(e),
      });
      setFinishing(false);
    }
  };

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  return (
    <GateShell>
      <div className="flex h-full items-center justify-center px-8">
        <div className="liquid-glass w-full max-w-lg rounded-2xl p-8">
          <div className="flex items-center gap-3">
            <img src={atelierLogo} alt="" className="h-9 w-9" draggable={false} />
            <div>
              <h1 className="text-lg font-semibold text-white">Willkommen bei atelier</h1>
              <p className="text-xs text-white/45">Lass uns das kurz einrichten.</p>
            </div>
            <div className="ml-auto">
              <StepDots index={stepIdx} />
            </div>
          </div>

          <div className="mt-7 min-h-[184px]">
            {step.id === "server" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <ServerCog className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">Server-Adresse</span>
                </div>
                <p className="text-sm text-white/50">
                  Adresse der atelier-api (Sync-Server). Prüfe, ob dort eine atelier-api
                  antwortet.
                </p>
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
                      "Prüfen"
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
                  <span className="text-sm font-medium">GTA V-Verzeichnis</span>
                </div>
                <p className="text-sm text-white/50">
                  Für die Ped-Vorschau und den Pack-Export. Du kannst das auch später in den
                  Einstellungen nachholen.
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={gtaPath ?? ""}
                    placeholder="Noch kein Pfad gewählt…"
                    className="border-white/15 bg-white/5 text-white"
                  />
                  <Button variant="outline" disabled={picking} onClick={() => void pickGtaPath()}>
                    <FolderOpen className="h-4 w-4" />
                    Durchsuchen
                  </Button>
                </div>
                {gtaPath && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                    <Check className="h-4 w-4 shrink-0" />
                    <span>Verzeichnis gesetzt.</span>
                  </div>
                )}
              </div>
            )}

            {step.id === "logs" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-white">
                  <ScrollText className="h-4 w-4 text-[#7289DA]" />
                  <span className="text-sm font-medium">Echtzeit-Logs</span>
                </div>
                <p className="text-sm text-white/50">
                  Ein eigenes Fenster mit Live-Logs (App, Sidecar, Oberfläche) — praktisch
                  beim Melden von Fehlern. Jederzeit per Strg+Shift+L.
                </p>
                <div className="flex items-center justify-between gap-4 rounded-[10px] bg-white/5 px-3 py-2.5">
                  <span className="text-sm text-white/85">Log-Fenster aktivieren</span>
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
                Zurück
              </Button>
            ) : onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Abbrechen
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
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Los geht's"}
              </Button>
            ) : (
              <Button
                className="bg-[#5865F2] text-white hover:bg-[#4752C4]"
                onClick={() => void next()}
              >
                Weiter
              </Button>
            )}
          </div>
        </div>
      </div>
    </GateShell>
  );
}
