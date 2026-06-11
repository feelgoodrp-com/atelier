import { useEffect, useState } from "react";
import { FolderOpen, Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AssignTypeDialog } from "@/components/workbench/assign-type-dialog";
import { CategoryTree } from "@/components/workbench/category-tree";
import { DrawableList } from "@/components/workbench/drawable-list";
import { DropOverlay } from "@/components/workbench/drop-overlay";
import { DuplicatesDialog } from "@/components/workbench/duplicates-dialog";
import { Inspector } from "@/components/workbench/inspector";
import { WorkbenchHeader } from "@/components/workbench/workbench-header";
import { useProjectStore } from "@/lib/stores/project-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** Strg+S / Strg+Z / Strg+Y(+Shift+Z) — active while the workbench is mounted. */
function useWorkbenchShortcuts() {
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
      // Leave native text-field undo/redo alone.
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
  const setScreen = useUiStore((s) => s.setScreen);
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="glass-border-subtle flex h-14 w-14 items-center justify-center rounded-[10px]">
        <Shirt className="h-6 w-6 text-white/30" />
      </div>
      <p className="mt-4 text-sm font-medium text-white/60">
        Kein Projekt geöffnet
      </p>
      <p className="mt-1 max-w-64 text-xs text-white/35">
        Erstelle oder öffne ein Projekt, um an Drawables zu arbeiten.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-4"
        onClick={() => setScreen("launcher")}
      >
        <FolderOpen className="h-4 w-4" />
        Zum Start-Bildschirm
      </Button>
    </div>
  );
}

export function WorkbenchScreen() {
  const project = useProjectStore((s) => s.project);
  const initForProject = useWorkbenchStore((s) => s.initForProject);
  const previewOpen = useWorkbenchStore((s) => s.previewOpen);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);

  useWorkbenchShortcuts();

  // Apply per-project view defaults exactly once per opened project.
  useEffect(() => {
    if (project) initForProject(project.id, project.settings.defaultGender);
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
        <WorkbenchHeader onOpenDuplicates={() => setDuplicatesOpen(true)} />

        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          {/* Left: categories */}
          <ResizablePanel defaultSize={20} minSize={14} maxSize={30}>
            <CategoryTree />
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-white/8" />

          {/* Center: drawables + dockable 3D preview */}
          <ResizablePanel defaultSize={52} minSize={30}>
            <ResizablePanelGroup direction="vertical" className="min-h-0">
              <ResizablePanel id="drawables" order={1} defaultSize={60} minSize={25}>
                <DrawableList />
              </ResizablePanel>
              {previewOpen && (
                <>
                  <ResizableHandle withHandle className="bg-white/8" />
                  <ResizablePanel id="preview-3d" order={2} defaultSize={40} minSize={20}>
                    <PreviewPane />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-white/8" />

          {/* Right: inspector */}
          <ResizablePanel defaultSize={28} minSize={18} maxSize={40}>
            <Inspector />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <DropOverlay />
      <DuplicatesDialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen} />
      <AssignTypeDialog />
    </div>
  );
}
