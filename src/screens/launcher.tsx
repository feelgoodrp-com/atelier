import { useCallback, useEffect, useState } from "react";
import { Clock, Folder, FolderOpen, Loader2, PackageOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { NewProjectDialog } from "@/components/project/new-project-dialog";
import { RecoveryDialog } from "@/components/project/recovery-dialog";
import { OnlinePanel } from "@/components/launcher/online-panel";
import { GrzybeekCredits } from "@/components/shell/credits";
import {
  openProjectFromDir,
  type PendingRecovery,
} from "@/lib/project/session";
import {
  getRecentProjects,
  removeRecentProject,
  type RecentProject,
} from "@/lib/recents";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatLastOpened(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export function LauncherScreen() {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [recovery, setRecovery] = useState<PendingRecovery | null>(null);
  const [opening, setOpening] = useState(false);
  /** Which recent entry is currently loading (spinner on that row). */
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  useEffect(() => {
    getRecentProjects()
      .then(setRecents)
      .catch(() => {
        /* store plugin unavailable (plain browser dev) */
      });
  }, []);

  const openFromDir = useCallback(async (dirPath: string) => {
    setOpening(true);
    setOpeningPath(dirPath);
    try {
      const { recovery } = await openProjectFromDir(dirPath);
      if (recovery) setRecovery(recovery);
    } catch (e) {
      toast.error("Projekt konnte nicht geöffnet werden", {
        description: errorMessage(e),
      });
    } finally {
      setOpening(false);
      setOpeningPath(null);
    }
  }, []);

  const browseAndOpen = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        title: "atelier-Projektordner wählen",
      });
      if (typeof selected === "string") await openFromDir(selected);
    } catch (e) {
      toast.error("Ordner konnte nicht gewählt werden", {
        description: errorMessage(e),
      });
    }
  }, [openFromDir]);

  const removeRecent = useCallback(async (dirPath: string) => {
    try {
      setRecents(await removeRecentProject(dirPath));
    } catch {
      /* best effort */
    }
  }, []);

  const actions = [
    {
      title: "Neues Projekt",
      description: "Starte ein leeres Addon-Kleidungs-Projekt.",
      icon: Plus,
      cta: "Erstellen",
      onClick: () => setNewProjectOpen(true),
    },
    {
      title: "Projekt öffnen",
      description: "Öffne ein bestehendes atelier-Projekt.",
      icon: FolderOpen,
      cta: "Durchsuchen",
      onClick: () => void browseAndOpen(),
    },
    {
      title: "Pack importieren",
      description: "Importiere einen bestehenden Clothing-Pack (YDD/YTD).",
      icon: PackageOpen,
      cta: "Importieren",
      onClick: () => useWorkbenchStore.getState().setImportWizardOpen(true),
    },
  ] as const;

  return (
    <div className="screen-fade-in flex h-full gap-8 overflow-hidden px-10 py-10">
      {/* Main column — full width with breathing room, scrolls independently. */}
      <div className="min-w-0 flex-1 overflow-y-auto pr-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Willkommen im atelier
        </h1>
        <p className="mt-1 text-sm text-white/50">
          Das feelgood-Werkzeug für GTA&nbsp;V Addon-Kleidung.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {actions.map(({ title, description, icon: Icon, cta, onClick }, i) => (
            <Card
              key={title}
              className={`liquid-glass animate-fade-in-up animation-delay-${(i + 1) * 100} border-white/15 bg-transparent`}
            >
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#5865F2]/15">
                  <Icon className="h-5 w-5 text-[#7289DA]" />
                </div>
                <CardTitle className="text-white">{title}</CardTitle>
                <CardDescription className="text-white/50">
                  {description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  size="sm"
                  disabled={opening}
                  onClick={onClick}
                >
                  {cta}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-white/40">
          Zuletzt geöffnet
        </h2>
        {recents.length === 0 ? (
          <div className="glass-border-subtle mt-3 flex flex-col items-center justify-center rounded-[10px] px-6 py-12 text-center">
            <Clock className="h-8 w-8 text-white/25" />
            <p className="mt-3 text-sm font-medium text-white/60">
              Noch keine Projekte
            </p>
            <p className="mt-1 max-w-sm text-xs text-white/40">
              Sobald du ein Projekt erstellst oder öffnest, erscheint es hier.
            </p>
          </div>
        ) : (
          <div className="glass-border-subtle mt-3 flex flex-col rounded-[10px] p-2">
            {recents.map((recent) => (
              <ContextMenu key={recent.dirPath}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={opening}
                    onClick={() => void openFromDir(recent.dirPath)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-white/10 disabled:opacity-50",
                      openingPath === recent.dirPath && "bg-[#5865F2]/10 !opacity-100",
                    )}
                  >
                    {openingPath === recent.dirPath ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#7289DA]" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-[#7289DA]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white/85">
                        {recent.name}
                      </p>
                      <p className="truncate text-xs text-white/40">
                        {openingPath === recent.dirPath
                          ? "Projekt wird geladen…"
                          : recent.dirPath}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-white/35">
                      {formatLastOpened(recent.lastOpenedAt)}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() => void openFromDir(recent.dirPath)}
                  >
                    Öffnen
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => void removeRecent(recent.dirPath)}
                  >
                    Aus Liste entfernen
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}

        <GrzybeekCredits className="mt-14 justify-start" />
      </div>

      {/* Right sidebar: who is online and in which project. */}
      <aside className="hidden w-80 shrink-0 lg:block">
        <OnlinePanel />
      </aside>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <RecoveryDialog recovery={recovery} onClose={() => setRecovery(null)} />
    </div>
  );
}
