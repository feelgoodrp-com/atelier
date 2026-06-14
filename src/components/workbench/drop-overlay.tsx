import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileDown } from "lucide-react";
import { runFileImport } from "@/lib/project/import-flow";

/**
 * Full-window drag&drop target for the workbench: listens to the native
 * Tauri drag-drop events (HTML5 drops are disabled by dragDropEnabled) and
 * routes dropped .ydd/.ytd/.yld paths through the stage-1 import pipeline.
 */
export function DropOverlay() {
  const { t } = useTranslation("workbench");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let disposed = false;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (disposed) return;
      switch (event.payload.type) {
        case "enter":
          setDragging(true);
          break;
        case "leave":
          setDragging(false);
          break;
        case "drop":
          setDragging(false);
          void runFileImport(event.payload.paths);
          break;
        default:
          break; // "over" — position updates only
      }
    });
    return () => {
      disposed = true;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  if (!dragging) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-[14px] border-2 border-dashed border-[#5865F2] bg-[#5865F2]/10 px-16 py-12">
        <FileDown className="h-10 w-10 text-[#7289DA]" />
        <div className="text-center">
          <p className="text-lg font-semibold text-white">
            {t("dropOverlay.title")}
          </p>
          <p className="mt-1 text-sm text-white/50">
            {t("dropOverlay.description")}
          </p>
        </div>
      </div>
    </div>
  );
}
