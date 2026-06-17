import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useAuthStore, useCloudEnabled } from "@/lib/stores/auth-store";
import { openLogWindow, useLogConsoleStore } from "@/lib/stores/log-console-store";
import { useSidecarStore } from "@/lib/stores/sidecar-store";

const NAV_ITEMS: Array<{
  screen: Screen;
  labelKey: string;
  icon: typeof House;
}> = [
  { screen: "launcher", labelKey: "nav.start", icon: House },
  { screen: "workbench", labelKey: "nav.workbench", icon: Shirt },
  { screen: "settings", labelKey: "nav.settings", icon: Settings },
];

function SidecarPill() {
  const { t } = useTranslation("shell");
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
      ? t("sidecar.notResponding")
      : (info.detail ?? t("sidecar.statusUnknown"));

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
  const cloudEnabled = useCloudEnabled();
  const { t } = useTranslation("shell");
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const setScreen = useUiStore((s) => s.setScreen);

  if (!cloudEnabled) return null;

  if (status !== "loggedIn" || !user) {
    return (
      <Button
        size="sm"
        className="h-8"
        disabled={status === "loggingIn"}
        onClick={() => {
          login().catch((e: unknown) => {
            toast.error(t("user.loginFailed"), {
              description: e instanceof Error ? e.message : String(e),
            });
          });
        }}
      >
        {status === "loggingIn" ? t("user.loggingIn") : t("user.login")}
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
              {t("user.pendingApproval")}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-white/60">
          {name}
          <span className="block text-xs font-normal text-white/40">
            {user.role === "admin" ? t("user.admin") : t("user.member")}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setScreen("settings")}>
          <Settings className="h-4 w-4" />
          {t("user.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            void logout().then(() => toast.success(t("user.loggedOut")));
          }}
        >
          <LogOut className="h-4 w-4" />
          {t("user.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Custom window controls — the native title bar is disabled (decorations: false). */
export function WindowControls() {
  const { t } = useTranslation("shell");
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
        aria-label={t("window.minimize")}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="flex h-8 w-10 items-center justify-center rounded-[8px] text-white/55 transition-colors hover:bg-red-500/80 hover:text-white"
        aria-label={t("window.close")}
        onClick={() => void getCurrentWindow().close()}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TopBar() {
  const { t } = useTranslation("shell");
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
        {NAV_ITEMS.map(({ screen: target, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          return (
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
          );
        })}
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
  const { t } = useTranslation("shell");
  const enabled = useLogConsoleStore((s) => s.enabled);

  if (!enabled) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => openLogWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={t("log.button")}
        >
          <Terminal className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("log.buttonTooltip")}</TooltipContent>
    </Tooltip>
  );
}
