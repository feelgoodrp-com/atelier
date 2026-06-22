/**
 * Tattoos authoring screen — a sibling to the clothing workbench. Shares the
 * open project (useProjectStore) but has its own zone-tree / grid / inspector
 * layout and its own view state (tattoo-workbench-store). Saving + undo/redo
 * reuse the project store + the generic saveNow from the workbench store.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TattooZoneTree } from "@/components/tattoos/tattoo-zone-tree";
import { TattooGrid } from "@/components/tattoos/tattoo-grid";
import { TattooInspector } from "@/components/tattoos/tattoo-inspector";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import { useTattooWorkbenchStore } from "@/lib/stores/tattoo-workbench-store";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** Strg+S / Strg+Z / Strg+Y — active while the tattoos screen is mounted. */
function useTattooShortcuts() {
  const saveNow = useWorkbenchStore((s) => s.saveNow);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.temporal.getState().undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        useProjectStore.temporal.getState().redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveNow]);
}

function NoProject() {
  const { t } = useTranslation("tattoos");
  const setScreen = useUiStore((s) => s.setScreen);
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="glass-border-subtle flex h-14 w-14 items-center justify-center rounded-[10px]">
        <Stamp className="h-6 w-6 text-white/30" />
      </div>
      <p className="mt-4 text-sm font-medium text-white/60">{t("noProject.title")}</p>
      <p className="mt-1 max-w-64 text-xs text-white/35">{t("noProject.description")}</p>
      <Button size="sm" variant="outline" className="mt-4" onClick={() => setScreen("launcher")}>
        <FolderOpen className="h-4 w-4" />
        {t("noProject.toStart")}
      </Button>
    </div>
  );
}

export function TattoosScreen() {
  const project = useProjectStore((s) => s.project);
  const initForProject = useTattooWorkbenchStore((s) => s.initForProject);

  useTattooShortcuts();

  useEffect(() => {
    if (project) initForProject(project.id);
  }, [project, initForProject]);

  if (!project) {
    return (
      <div className="screen-fade-in h-full p-3">
        <div className="glass-border-subtle glass-hover-none h-full rounded-[10px]">
          <NoProject />
        </div>
      </div>
    );
  }

  return (
    <div className="screen-fade-in relative h-full p-3">
      <div className="glass-border-subtle glass-hover-none flex h-full flex-col rounded-[10px]">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="atelier:tattoos:h"
          className="min-h-0 flex-1"
        >
          <ResizablePanel id="zones" order={1} defaultSize={20} minSize={14} maxSize={30}>
            <TattooZoneTree />
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-white/8" />
          <ResizablePanel id="grid" order={2} defaultSize={52} minSize={30}>
            <TattooGrid />
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-white/8" />
          <ResizablePanel id="inspector" order={3} defaultSize={28} minSize={18} maxSize={40}>
            <TattooInspector />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
