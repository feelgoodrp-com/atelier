/**
 * Login gate — the app is NOT usable without a logged-in, APPROVED account.
 * Three states rendered here:
 *  - loggedOut / loggingIn: Discord login card (+ advanced API-URL setting)
 *  - pending: "Warte auf Freigabe" card with status polling
 *  - locked: locked notice with logout
 * The window is frameless, so the gate carries its own drag region + controls.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import atelierLogo from "@/assets/atelier-logo.png";
import { HeroBackdrop } from "@/components/shell/hero-backdrop";
import { WindowControls } from "@/components/shell/top-bar";
import { GrzybeekCredits } from "@/components/shell/credits";
import { useAuthStore, type LoginPhase } from "@/lib/stores/auth-store";
import { cn } from "@/lib/utils";

const PENDING_POLL_MS = 15_000;

/** Maps a login sub-phase to its `login` namespace translation key. */
const LOGIN_PHASE_KEY: Record<Exclude<LoginPhase, "idle">, string> = {
  connecting: "phase.connecting",
  awaiting: "phase.awaiting",
  exchanging: "phase.exchanging",
  success: "phase.success",
};

/** Animated green checkmark shown the moment auth succeeds (matches the
 *  browser success page's draw-in). */
function SuccessCheck() {
  return (
    <div className="atelier-pop flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
      <svg
        viewBox="0 0 52 52"
        className="h-8 w-8"
        fill="none"
        stroke="#4ade80"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle className="atelier-check-circle" cx="26" cy="26" r="24" strokeWidth={2.5} />
        <path className="atelier-check-tick" d="M14 27l8 8 16-17" strokeWidth={3} />
      </svg>
    </div>
  );
}

/** Loading bar (or checkmark on success) replacing the login button while an
 *  interactive Discord login runs. */
function LoginProgress({ phase }: { phase: Exclude<LoginPhase, "idle"> }) {
  const { t } = useTranslation("login");
  if (phase === "success") {
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <SuccessCheck />
        <p className="text-sm font-medium text-emerald-300">
          {t(LOGIN_PHASE_KEY.success)}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-8 flex flex-col gap-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="atelier-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-[#5865F2] to-[#7289DA]" />
      </div>
      <p className="text-center text-sm text-white/55">{t(LOGIN_PHASE_KEY[phase])}</p>
    </div>
  );
}

export function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#0b0b0b] text-foreground">
      {/* Hero video + gradient veil + subtle grid (shared with launcher/settings). */}
      <HeroBackdrop />

      {/* Minimal title strip: draggable, window controls only. */}
      <div
        data-tauri-drag-region
        className="relative z-20 flex h-12 shrink-0 items-center px-4"
      >
        <span className="pointer-events-none flex items-center gap-2">
          <img src={atelierLogo} alt="" className="h-6 w-6" draggable={false} />
          <span className="flex items-baseline gap-1.5">
            <span className="text-base font-semibold tracking-tight text-white">atelier</span>
            <span className="text-[11px] font-medium text-[#7289DA]">by feelgood</span>
          </span>
        </span>
        <div className="ml-auto">
          <WindowControls />
        </div>
      </div>

      {/* Content region — consumers place their own card/splash + can pin
          things (e.g. the credits) to its edges. */}
      <div className="relative z-10 min-h-0 flex-1">{children}</div>
    </div>
  );
}

function ApiUrlAdvanced() {
  const { t } = useTranslation("login");
  const apiUrl = useAuthStore((s) => s.apiUrl);
  const setApiUrl = useAuthStore((s) => s.setApiUrl);
  const [value, setValue] = useState(apiUrl);
  const [open, setOpen] = useState(false);

  useEffect(() => setValue(apiUrl), [apiUrl]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-white/70">
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        {t("advanced")}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <Label htmlFor="gate-api-url" className="text-xs text-white/50">
          {t("apiUrlLabel")}
        </Label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="gate-api-url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="http://127.0.0.1:3095"
            className="h-8 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              void setApiUrl(value).then(() => toast.success(t("apiUrlSaved")));
            }}
          >
            {t("common:save")}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LoginCard() {
  const { t } = useTranslation("login");
  const loginPhase = useAuthStore((s) => s.loginPhase);
  const login = useAuthStore((s) => s.login);
  const busy = loginPhase !== "idle";

  return (
    <div className="liquid-glass w-full max-w-sm rounded-2xl p-8">
      <h2 className="text-xl font-semibold text-white">{t("signIn")}</h2>
      <p className="mt-1 text-sm text-white/50">{t("signInSubtitle")}</p>

      {busy ? (
        <LoginProgress phase={loginPhase} />
      ) : (
        <Button
          className="mt-6 h-11 w-full bg-[#5865F2] text-white hover:bg-[#4752C4]"
          onClick={() => {
            login().catch((e: unknown) => {
              toast.error(t("signInFailed"), {
                description: e instanceof Error ? e.message : String(e),
              });
            });
          }}
        >
          {t("signInWithDiscord")}
        </Button>
      )}

      <div className="mt-6 border-t border-white/10 pt-4">
        <ApiUrlAdvanced />
      </div>

      <div className="mt-4 flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-white/50 hover:text-white/80"
          onClick={() => useAuthStore.getState().setAppMode("solo")}
        >
          {t("soloOption")}
        </Button>
        <p className="text-xs text-white/35">{t("soloHint")}</p>
      </div>
    </div>
  );
}

function PendingCard() {
  const { t } = useTranslation("login");
  const reloadUser = useAuthStore((s) => s.reloadUser);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [checking, setChecking] = useState(false);

  // Poll the approval status — an admin click in another session should
  // unlock the app without a manual refresh.
  useEffect(() => {
    const timer = setInterval(() => void reloadUser().catch(() => {}), PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [reloadUser]);

  return (
    <div className="liquid-glass w-full max-w-sm rounded-2xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
        <ShieldCheck className="h-6 w-6 text-amber-300" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-white">{t("pending.title")}</h2>
      <p className="mt-2 text-sm text-white/55">
        {user?.username
          ? t("pending.bodyNamed", { name: user.username })
          : t("pending.body")}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void reloadUser()
              .catch(() => {})
              .finally(() => setChecking(false));
          }}
        >
          <RefreshCw className={cn("h-4 w-4", checking && "animate-spin")} />
          {t("pending.checkStatus")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          {t("pending.logout")}
        </Button>
      </div>
    </div>
  );
}

function LockedCard() {
  const { t } = useTranslation("login");
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="liquid-glass w-full max-w-sm rounded-2xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
        <Lock className="h-6 w-6 text-red-400" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-white">{t("locked.title")}</h2>
      <p className="mt-2 text-sm text-white/55">{t("locked.body")}</p>
      <Button variant="ghost" size="sm" className="mt-6" onClick={() => void logout()}>
        {t("locked.logout")}
      </Button>
    </div>
  );
}

/** Splash while the silent login attempt runs (avoids a login-screen flash). */
export function BootSplash() {
  return (
    <GateShell>
      <div className="flex h-full items-center justify-center">
        <div className="flex animate-pulse flex-col items-center gap-4">
          <img src={atelierLogo} alt="" className="h-20 w-20" draggable={false} />
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight text-white">atelier</span>
            <span className="text-sm font-medium text-[#7289DA]">by feelgood</span>
          </div>
        </div>
      </div>
    </GateShell>
  );
}

export function LoginGate() {
  const { t } = useTranslation("login");
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  let card: React.ReactNode;
  if (status === "loggedIn" && user?.status === "pending") card = <PendingCard />;
  else if (status === "loggedIn" && user?.status === "locked") card = <LockedCard />;
  else card = <LoginCard />;

  return (
    <GateShell>
      <div className="flex h-full items-center justify-between gap-10 px-10 xl:px-20">
        {/* Left: big standalone branding over the video. */}
        <div className="flex max-w-md flex-col items-start gap-5">
          <img src={atelierLogo} alt="" className="h-28 w-28" draggable={false} />
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-semibold tracking-tight text-white">
                atelier
              </span>
              <span className="text-lg font-medium text-[#7289DA]">by feelgood</span>
            </div>
            <p className="mt-3 text-base text-white/55">
              {t("tagline")}
            </p>
          </div>
        </div>

        {/* Right: the login / pending / locked card. */}
        {card}
      </div>

      {/* Credits centered along the bottom edge. */}
      <div className="absolute inset-x-0 bottom-6 flex justify-center px-8">
        <GrzybeekCredits />
      </div>
    </GateShell>
  );
}
