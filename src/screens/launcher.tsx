import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Cloud,
  CloudOff,
  Folder,
  FolderOpen,
  Loader2,
  PackageOpen,
  Plus,
} from "lucide-react";
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
import { useAuthStore } from "@/lib/stores/auth-store";
import { listMyPacks, type Pack } from "@/lib/sync/api-client";
import { clonePackToLocal } from "@/lib/sync/clone";
import { formatRelativeTime } from "@/lib/format";

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
  const { t } = useTranslation("launcher");
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [recovery, setRecovery] = useState<PendingRecovery | null>(null);
  const [opening, setOpening] = useState(false);
  /** Which recent entry is currently loading (spinner on that row). */
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  // Cloud projects: every approved team member sees all packs and can clone
  // one into a fresh local project with a single click.
  const apiReady = useAuthStore(
    (s) => s.status === "loggedIn" && s.user?.status === "approved",
  );
  /** null = still loading, [] = loaded but empty/unavailable. */
  const [cloudPacks, setCloudPacks] = useState<Pack[] | null>(null);
  /** packId of the pack currently being cloned (spinner on that row). */
  const [cloningId, setCloningId] = useState<string | null>(null);

  useEffect(() => {
    getRecentProjects()
      .then(setRecents)
      .catch(() => {
        /* store plugin unavailable (plain browser dev) */
      });
  }, []);

  useEffect(() => {
    if (!apiReady) {
      setCloudPacks(null);
      return;
    }
    setCloudPacks(null);
    listMyPacks()
      .then(setCloudPacks)
      // Sidecar/API unreachable — render the empty hint rather than an error.
      .catch(() => setCloudPacks([]));
  }, [apiReady]);

  const openFromDir = useCallback(async (dirPath: string) => {
    setOpening(true);
    setOpeningPath(dirPath);
    try {
      const { recovery } = await openProjectFromDir(dirPath);
      if (recovery) setRecovery(recovery);
    } catch (e) {
      toast.error(t("openProjectFailed"), {
        description: errorMessage(e),
      });
    } finally {
      setOpening(false);
      setOpeningPath(null);
    }
  }, [t]);

  const browseAndOpen = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        title: t("projectPickerTitle"),
      });
      if (typeof selected === "string") await openFromDir(selected);
    } catch (e) {
      toast.error(t("selectFolderFailed"), {
        description: errorMessage(e),
      });
    }
  }, [openFromDir, t]);

  const removeRecent = useCallback(async (dirPath: string) => {
    try {
      setRecents(await removeRecentProject(dirPath));
    } catch {
      /* best effort */
    }
  }, []);

  const cloneCloudPack = useCallback(async (pack: Pack) => {
    let parentDir: string | null;
    try {
      const selected = await openDialog({
        directory: true,
        title: t("cloud.clonePickerTitle"),
      });
      parentDir = typeof selected === "string" ? selected : null;
    } catch (e) {
      toast.error(t("selectFolderFailed"), {
        description: errorMessage(e),
      });
      return;
    }
    if (!parentDir) return;

    setCloningId(pack.packId);
    try {
      await clonePackToLocal(pack, parentDir);
      toast.success(t("cloud.clonedAndOpened", { name: pack.name }));
    } catch (e) {
      toast.error(t("cloud.cloneFailed"), {
        description: errorMessage(e),
      });
    } finally {
      setCloningId(null);
    }
  }, [t]);

  const actions = [
    {
      title: t("actions.newProject.title"),
      description: t("actions.newProject.description"),
      icon: Plus,
      cta: t("actions.newProject.cta"),
      onClick: () => setNewProjectOpen(true),
    },
    {
      title: t("actions.openProject.title"),
      description: t("actions.openProject.description"),
      icon: FolderOpen,
      cta: t("actions.openProject.cta"),
      onClick: () => void browseAndOpen(),
    },
    {
      title: t("actions.importPack.title"),
      description: t("actions.importPack.description"),
      icon: PackageOpen,
      cta: t("actions.importPack.cta"),
      onClick: () => useWorkbenchStore.getState().setImportWizardOpen(true),
    },
  ] as const;

  return (
    <div className="screen-fade-in flex h-full gap-8 overflow-hidden px-10 py-10">
      {/* Main column — full width with breathing room, scrolls independently. */}
      <div className="min-w-0 flex-1 overflow-y-auto pr-1">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-white/50">{t("subtitle")}</p>

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

        {apiReady && (
          <>
            <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-white/40">
              {t("cloud.heading")}
            </h2>
            {cloudPacks === null ? (
              <div className="glass-border-subtle mt-3 flex flex-col gap-2 rounded-[10px] p-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-[10px] bg-white/5"
                  />
                ))}
              </div>
            ) : cloudPacks.length === 0 ? (
              <div className="glass-border-subtle mt-3 flex flex-col items-center justify-center rounded-[10px] px-6 py-12 text-center">
                <CloudOff className="h-8 w-8 text-white/25" />
                <p className="mt-3 text-sm font-medium text-white/60">
                  {t("cloud.emptyTitle")}
                </p>
                <p className="mt-1 max-w-sm text-xs text-white/40">
                  {t("cloud.emptyHint")}
                </p>
              </div>
            ) : (
              <div className="glass-border-subtle mt-3 flex flex-col rounded-[10px] p-2">
                {cloudPacks.map((pack) => {
                  const cloning = cloningId === pack.packId;
                  return (
                    <button
                      key={pack.packId}
                      type="button"
                      disabled={cloningId !== null}
                      onClick={() => void cloneCloudPack(pack)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-white/10 disabled:opacity-50",
                        cloning && "bg-[#5865F2]/10 !opacity-100",
                      )}
                    >
                      {cloning ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#7289DA]" />
                      ) : (
                        <Cloud className="h-4 w-4 shrink-0 text-[#7289DA]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white/85">
                          {pack.name}
                        </p>
                        <p className="truncate text-xs text-white/40">
                          {cloning
                            ? t("cloud.cloning")
                            : t("cloud.revision", { revision: pack.headRevision })}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-white/35">
                        {formatRelativeTime(pack.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-white/40">
          {t("recents.heading")}
        </h2>
        {recents.length === 0 ? (
          <div className="glass-border-subtle mt-3 flex flex-col items-center justify-center rounded-[10px] px-6 py-12 text-center">
            <Clock className="h-8 w-8 text-white/25" />
            <p className="mt-3 text-sm font-medium text-white/60">
              {t("recents.emptyTitle")}
            </p>
            <p className="mt-1 max-w-sm text-xs text-white/40">
              {t("recents.emptyHint")}
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
                          ? t("recents.loading")
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
                    {t("recents.open")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => void removeRecent(recent.dirPath)}
                  >
                    {t("recents.removeFromList")}
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
