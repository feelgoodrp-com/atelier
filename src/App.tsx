import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { TopBar } from "@/components/shell/top-bar";
import { ImportWizard } from "@/components/workbench/import-wizard";
import { LauncherScreen } from "@/screens/launcher";
import { WorkbenchScreen } from "@/screens/workbench";
import { SettingsScreen } from "@/screens/settings";
import { BootSplash, LoginGate } from "@/screens/login";
import { OnboardingWizard } from "@/screens/onboarding";
import { useUiStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useSidecarHealth } from "@/lib/sidecar/client";
import { useGtaPathSync } from "@/lib/sidecar/gta-path";
import { getLogConsoleEnabled, getOnboardingDone } from "@/lib/settings";
import { openLogWindow, useLogConsoleStore } from "@/lib/stores/log-console-store";
import { usePresenceHeartbeat } from "@/lib/sync/presence";
import { useCollab } from "@/lib/sync/collab";
import { startAutosave } from "@/lib/project/autosave";

function App() {
  const screen = useUiStore((s) => s.screen);
  const rerunOnboarding = useUiStore((s) => s.rerunOnboarding);
  const setRerunOnboarding = useUiStore((s) => s.setRerunOnboarding);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const bootstrapping = useAuthStore((s) => s.bootstrapping);
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  // First-run setup wizard gate (null = still loading the flag).
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  useEffect(() => {
    getOnboardingDone()
      .then(setOnboardingDone)
      .catch(() => setOnboardingDone(true));
  }, []);

  // Sidecar status pill (Rust events + /health polling).
  useSidecarHealth();

  // Re-send the persisted GTA path whenever the sidecar (re)connects —
  // it keeps the path in memory only, and ped-body preview needs it.
  useGtaPathSync();

  // "Wer ist online?" heartbeat (active only when logged in + approved).
  usePresenceHeartbeat();

  // Pack-room WebSocket + advisory edit locks (cloud-linked projects only).
  useCollab();

  // Restore settings + silent login on startup.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Recovery snapshots for the open project (5s debounce / 60s ceiling).
  useEffect(() => startAutosave(), []);

  // Restore the live-log-console feature switch (Settings → Logs).
  useEffect(() => {
    getLogConsoleEnabled()
      .then((enabled) => useLogConsoleStore.getState().setEnabled(enabled))
      .catch(() => {});
  }, []);

  // Strg+Shift+L opens the dedicated log window (when the feature is on).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        if (!useLogConsoleStore.getState().enabled) return;
        e.preventDefault();
        openLogWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // HARD GATE: without a logged-in AND approved account the tool is unusable.
  const authorized = authStatus === "loggedIn" && user?.status === "approved";
  // Setup wizard: first run (never configured + logged out) OR an explicit
  // re-run from Settings (works while logged in too).
  const showOnboarding =
    rerunOnboarding || (authStatus === "loggedOut" && onboardingDone === false);

  return (
    <TooltipProvider delayDuration={200}>
      {bootstrapping || onboardingDone === null ? (
        <BootSplash />
      ) : showOnboarding ? (
        <OnboardingWizard
          onDone={() => {
            setOnboardingDone(true);
            setRerunOnboarding(false);
          }}
          onCancel={rerunOnboarding ? () => setRerunOnboarding(false) : undefined}
        />
      ) : !authorized ? (
        <LoginGate />
      ) : (
        /* No solid bg here — the translucent body tint + OS acrylic blur show through. */
        <div className="grid-background flex h-full flex-col text-foreground">
          <TopBar />
          <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
            {screen === "launcher" && <LauncherScreen />}
            {screen === "workbench" && <WorkbenchScreen />}
            {screen === "settings" && <SettingsScreen />}
          </main>
          {/* Mounted app-wide so the wizard survives launcher → workbench switches. */}
          <ImportWizard />
        </div>
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;
