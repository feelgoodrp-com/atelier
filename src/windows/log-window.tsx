/**
 * Standalone log window (Tauri window label "logs", opened via the
 * `open_log_window` command). Rendered by main.tsx when the page is loaded
 * with ?window=logs — completely separate from the main app UI.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { WindowControls } from "@/components/shell/top-bar";
import { LogConsolePanel } from "@/components/shell/log-console";

export function LogWindow() {
  const { t } = useTranslation("shell");
  const title = t("log.button");

  // The window is created before the UI language is known (Rust sets a neutral
  // title), so the taskbar entry is corrected here.
  useEffect(() => {
    void getCurrentWindow()
      .setTitle(`atelier — ${title}`)
      .catch(() => {});
  }, [title]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid-background flex h-full flex-col text-foreground">
        {/* Title strip: draggable, own window controls (frameless window). */}
        <div
          data-tauri-drag-region
          className="liquid-glass-header relative z-20 flex h-11 shrink-0 items-center gap-2 border-x-0 border-t-0 px-3"
        >
          <Terminal className="pointer-events-none h-4 w-4 text-[#7289DA]" />
          <span className="pointer-events-none flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight text-white">
              {title}
            </span>
            <span className="text-[10px] font-medium text-[#7289DA]">atelier by feelgood</span>
          </span>
          <div className="ml-auto">
            <WindowControls />
          </div>
        </div>

        <LogConsolePanel />
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
