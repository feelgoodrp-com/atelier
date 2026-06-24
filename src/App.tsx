import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { TopBar } from "@/components/shell/top-bar";
import { ImportWizard } from "@/components/workbench/import-wizard";
import { LauncherScreen } from "@/screens/launcher";
import { WorkbenchScreen } from "@/screens/workbench";
import { TattoosScreen } from "@/screens/tattoos";
import { SettingsScreen } from "@/screens/settings";
import { HelpScreen } from "@/screens/help";
import { BootSplash, LoginGate } from "@/screens/login";
import { OnboardingWizard } from "@/screens/onboarding";
import { HeroBackdrop } from "@/components/shell/hero-backdrop";
import { useUiStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useSidecarHealth } from "@/lib/sidecar/client";
import { useGtaPathSync } from "@/lib/sidecar/gta-path";
import { getLogConsoleEnabled, getOnboardingDone } from "@/lib/settings";
import { openLogWindow, useLogConsoleStore } from "@/lib/stores/log-console-store";
import { usePresenceHeartbeat } from "@/lib/sync/presence";
import { useCollab } from "@/lib/sync/collab";
import { startAutosave } from "@/lib/project/autosave";
import { useUpdateStore } from "@/lib/stores/update-store";
import { loadPreferences } from "@/lib/stores/preferences-store";

function App() {
  const screen = useUiStore((s) => s.screen);
  const rerunOnboarding = useUiStore((s) => s.rerunOnboarding);
  const setRerunOnboarding = useUiStore((s) => s.setRerunOnboarding);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const bootstrapping = useAuthStore((s) => s.bootstrapping);
  const authStatus = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const appMode = useAuthStore((s) => s.appMode);

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

  // Silent auto-update check on startup — pops a toast (with a one-click
  // install action) only when a newer release is available. No-ops outside the
  // Tauri runtime, so dev/browser builds are unaffected.
  useEffect(() => {
    void useUpdateStore.getState().check({ notify: true });
  }, []);

  // Restore the live-log-console feature switch (Settings → Logs).
  useEffect(() => {
    getLogConsoleEnabled()
      .then((enabled) => useLogConsoleStore.getState().setEnabled(enabled))
      .catch(() => {});
  }, []);

  // Restore the texture-optimize preferences (default format + optimize-on-import).
  useEffect(() => loadPreferences(), []);

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

  // Suppress the native WebView context menu app-wide — it shows on right-click
  // in dev (off in release) and looks out of place. Text fields keep it for
  // copy/paste. Radix context menus attach their own handlers on the React root
  // (which fires first) so they still open where defined; this only kills the
  // native fallback everywhere else.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // HARD GATE (cloud mode only): without a logged-in AND approved account the
  // tool is unusable. Solo mode is fully local and always authorized — the
  // LoginGate below only renders in cloud mode when not yet authorized.
  const cloudEnabled = appMode === "cloud";
  const authorized =
    !cloudEnabled || (authStatus === "loggedIn" && user?.status === "approved");
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
        <div className="relative flex h-full flex-col overflow-hidden text-foreground">
          {/* Hero video backdrop on Home + Settings; the editing screens keep a
              plain grid so the previews stay distraction free. */}
          {screen === "workbench" || screen === "tattoos" || screen === "help" ? (
            <div className="grid-background absolute inset-0" aria-hidden="true" />
          ) : (
            <HeroBackdrop strong />
          )}
          <TopBar />
          <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
            {screen === "launcher" && <LauncherScreen />}
            {screen === "workbench" && <WorkbenchScreen />}
            {screen === "tattoos" && <TattoosScreen />}
            {screen === "settings" && <SettingsScreen />}
            {screen === "help" && <HelpScreen />}
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
