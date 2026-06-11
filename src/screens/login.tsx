/**
 * Login gate — the app is NOT usable without a logged-in, APPROVED account.
 * Three states rendered here:
 *  - loggedOut / loggingIn: Discord login card (+ advanced API-URL setting)
 *  - pending: "Warte auf Freigabe" card with status polling
 *  - locked: locked notice with logout
 * The window is frameless, so the gate carries its own drag region + controls.
 */

import { useEffect, useState } from "react";
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
import { WindowControls } from "@/components/shell/top-bar";
import { GrzybeekCredits } from "@/components/shell/credits";
import { useAuthStore } from "@/lib/stores/auth-store";
import { cn } from "@/lib/utils";

const PENDING_POLL_MS = 15_000;

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-background flex h-full flex-col text-foreground">
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

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center p-8">
        {children}
      </div>
    </div>
  );
}

function ApiUrlAdvanced() {
  const apiUrl = useAuthStore((s) => s.apiUrl);
  const setApiUrl = useAuthStore((s) => s.setApiUrl);
  const [value, setValue] = useState(apiUrl);
  const [open, setOpen] = useState(false);

  useEffect(() => setValue(apiUrl), [apiUrl]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-white/40 transition-colors hover:text-white/70">
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        Erweitert: Server-Adresse
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <Label htmlFor="gate-api-url" className="text-xs text-white/50">
          atelier-api URL
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
              void setApiUrl(value).then(() => toast.success("Server-Adresse gespeichert"));
            }}
          >
            Speichern
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LoginCard() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);

  return (
    <div className="liquid-glass w-full max-w-md rounded-2xl p-8">
      <div className="flex items-center gap-3">
        <img src={atelierLogo} alt="" className="h-12 w-12" draggable={false} />
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-white">atelier</span>
          <span className="text-sm font-medium text-[#7289DA]">by feelgood</span>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/55">
        GTA&nbsp;V Clothing-Werkstatt der Feelgood-Community. Melde dich mit Discord an, um
        Packs zu erstellen, zu teilen und gemeinsam zu bauen.
      </p>

      <Button
        className="mt-8 h-11 w-full bg-[#5865F2] text-white hover:bg-[#4752C4]"
        disabled={status === "loggingIn"}
        onClick={() => {
          login().catch((e: unknown) => {
            toast.error("Anmeldung fehlgeschlagen", {
              description: e instanceof Error ? e.message : String(e),
            });
          });
        }}
      >
        {status === "loggingIn" ? "Warte auf Discord…" : "Mit Discord anmelden"}
      </Button>
      <p className="mt-3 text-center text-xs text-white/35">
        Der Browser öffnet sich für die Anmeldung und du kehrst danach hierher zurück.
      </p>

      <div className="mt-6 border-t border-white/10 pt-4">
        <ApiUrlAdvanced />
      </div>
    </div>
  );
}

function PendingCard() {
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
    <div className="liquid-glass w-full max-w-md rounded-2xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
        <ShieldCheck className="h-6 w-6 text-amber-300" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-white">Warte auf Freigabe</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/55">
        Hey {user?.username ?? ""}! Dein Account wurde erstellt, muss aber noch von einem
        Admin freigeschaltet werden. Diese Seite prüft den Status automatisch.
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
          Status prüfen
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          Abmelden
        </Button>
      </div>
    </div>
  );
}

function LockedCard() {
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="liquid-glass w-full max-w-md rounded-2xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
        <Lock className="h-6 w-6 text-red-400" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-white">Account gesperrt</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/55">
        Dein Account wurde gesperrt. Wende dich an einen Admin, wenn du denkst, dass das ein
        Fehler ist.
      </p>
      <Button variant="ghost" size="sm" className="mt-6" onClick={() => void logout()}>
        Abmelden
      </Button>
    </div>
  );
}

/** Splash while the silent login attempt runs (avoids a login-screen flash). */
export function BootSplash() {
  return (
    <GateShell>
      <div className="flex animate-pulse flex-col items-center gap-4">
        <img src={atelierLogo} alt="" className="h-20 w-20" draggable={false} />
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-white">atelier</span>
          <span className="text-sm font-medium text-[#7289DA]">by feelgood</span>
        </div>
      </div>
    </GateShell>
  );
}

export function LoginGate() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  let card: React.ReactNode;
  if (status === "loggedIn" && user?.status === "pending") card = <PendingCard />;
  else if (status === "loggedIn" && user?.status === "locked") card = <LockedCard />;
  else card = <LoginCard />;

  return (
    <GateShell>
      <div className="flex w-full flex-col items-center gap-8">
        {card}
        <GrzybeekCredits />
      </div>
    </GateShell>
  );
}
