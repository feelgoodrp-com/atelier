import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CircleUser,
  Copy,
  House,
  LogOut,
  Minus,
  Settings,
  Shirt,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import atelierLogo from "@/assets/atelier-logo.png";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUiStore, type Screen } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { openLogWindow, useLogConsoleStore } from "@/lib/stores/log-console-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";

const NAV_ITEMS: Array<{ screen: Screen; label: string; icon: typeof House }> = [
  { screen: "launcher", label: "Start", icon: House },
  { screen: "workbench", label: "Werkbank", icon: Shirt },
  { screen: "settings", label: "Einstellungen", icon: Settings },
];

function SidecarPill() {
  const info = useSidecarStore((s) => s.info);
  const health = useSidecarStore((s) => s.health);

  const ready = info.status === "ready" && health !== "failing";
  const connecting = info.status === "connecting";

  const dotClass = ready
    ? "bg-emerald-400"
    : connecting
      ? "bg-amber-400 animate-pulse"
      : "bg-red-500";

  const label = ready ? "Sidecar" : connecting ? "Sidecar…" : "Sidecar";

  const tooltip =
    info.status === "ready" && health === "failing"
      ? "Sidecar antwortet nicht auf /health"
      : (info.detail ?? "Sidecar-Status unbekannt");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="glass-border-subtle flex h-7 cursor-default items-center gap-2 rounded-full px-3 text-xs text-white/70"
          data-status={info.status}
        >
          <span className={cn("h-2 w-2 rounded-full", dotClass)} />
          {label}
          {ready && info.port != null && (
            <span className="text-white/35">:{info.port}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function UserChip() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const setScreen = useUiStore((s) => s.setScreen);

  if (status !== "loggedIn" || !user) {
    return (
      <Button
        size="sm"
        className="h-8"
        disabled={status === "loggingIn"}
        onClick={() => {
          login().catch((e: unknown) => {
            toast.error("Anmeldung fehlgeschlagen", {
              description: e instanceof Error ? e.message : String(e),
            });
          });
        }}
      >
        {status === "loggingIn" ? "Anmeldung läuft…" : "Anmelden"}
      </Button>
    );
  }

  const name = user.username;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="glass-border-subtle flex h-8 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm text-white/85 transition-colors hover:bg-white/10"
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={name}
              className="h-6 w-6 rounded-full object-cover"
            />
          ) : (
            <CircleUser className="h-6 w-6 text-white/60" />
          )}
          <span className="max-w-32 truncate">{name}</span>
          {user.status === "pending" && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
              Warte auf Freigabe
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-white/60">
          {name}
          <span className="block text-xs font-normal text-white/40">
            {user.role === "admin" ? "Administrator" : "Mitglied"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setScreen("settings")}>
          <Settings className="h-4 w-4" />
          Einstellungen
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            void logout().then(() => toast.success("Abgemeldet"));
          }}
        >
          <LogOut className="h-4 w-4" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Custom window controls — the native title bar is disabled (decorations: false). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => {});
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const buttonClass =
    "flex h-8 w-10 items-center justify-center rounded-[8px] text-white/55 transition-colors hover:bg-white/10 hover:text-white";

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={buttonClass}
        aria-label="Minimieren"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={maximized ? "Wiederherstellen" : "Maximieren"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="flex h-8 w-10 items-center justify-center rounded-[8px] text-white/55 transition-colors hover:bg-red-500/80 hover:text-white"
        aria-label="Schließen"
        onClick={() => void getCurrentWindow().close()}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TopBar() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);

  return (
    <header
      data-tauri-drag-region
      className="liquid-glass-header relative z-20 flex h-12 shrink-0 items-center gap-4 border-x-0 border-t-0 px-4"
    >
      {/* Logo + wordmark */}
      <button
        type="button"
        className="flex items-center gap-2 outline-none"
        onClick={() => setScreen("launcher")}
      >
        <img src={atelierLogo} alt="" className="h-6 w-6 shrink-0" draggable={false} />
        <span className="flex items-baseline gap-1.5">
          <span className="text-base font-semibold tracking-tight text-white">
            atelier
          </span>
          <span className="text-[11px] font-medium text-[#7289DA]">by feelgood</span>
        </span>
      </button>

      {/* Nav */}
      <nav className="ml-4 flex items-center gap-1">
        {NAV_ITEMS.map(({ screen: target, label, icon: Icon }) => (
          <Tooltip key={target}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setScreen(target)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white",
                  screen === target && "bg-[#5865F2]/20 text-[#7289DA]",
                )}
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <LogConsoleButton />
        <SidecarPill />
        <UserChip />
        <div className="mx-1 h-5 w-px bg-white/10" />
        <WindowControls />
      </div>
    </header>
  );
}

/** Only visible when the live log console is enabled in the settings. */
function LogConsoleButton() {
  const enabled = useLogConsoleStore((s) => s.enabled);

  if (!enabled) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => openLogWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Echtzeit-Log"
        >
          <Terminal className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Echtzeit-Log-Fenster (Strg+Shift+L)</TooltipContent>
    </Tooltip>
  );
}
