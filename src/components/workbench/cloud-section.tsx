/**
 * Cloud area of the workbench header: link state, push/pull controls,
 * revision indicator, the online roster of the joined pack room and all
 * sync dialogs (link, progress, 409 conflict, pull confirm).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CircleUser,
  Cloud,
  CloudDownload,
  CloudUpload,
  Loader2,
  Plus,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { listMyPacks, createPack, type Pack } from "@/lib/sync/api-client";
import { linkProject } from "@/lib/sync/pack-sync";
import type { SyncPhase } from "@/lib/sync/pack-sync";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCollabStore } from "@/lib/stores/collab-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useSyncStore } from "@/lib/stores/sync-store";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True when local state has edits the cloud has not seen yet (reactive). */
function useUnsyncedChanges(): boolean {
  const dirty = useProjectStore((s) => s.dirty);
  const updatedAt = useProjectStore((s) => s.project?.updatedAt ?? null);
  const lastSyncedAt = useProjectStore(
    (s) => s.project?.sync.lastSyncedAt ?? null,
  );
  if (dirty) return true;
  if (!lastSyncedAt) return true;
  return updatedAt !== null && Date.parse(updatedAt) > Date.parse(lastSyncedAt);
}

// ---------------------------------------------------------------------------
// Roster (avatar stack)
// ---------------------------------------------------------------------------

const ROSTER_MAX_AVATARS = 4;

function RosterStack() {
  const { t } = useTranslation("workbench");
  const roster = useCollabStore((s) => s.roster);
  const selfId = useAuthStore((s) => s.user?.discordId);
  if (roster.length === 0) return null;

  const shown = roster.slice(0, ROSTER_MAX_AVATARS);
  const extra = roster.length - shown.length;
  const names = roster
    .map((u) =>
      u.discordId === selfId ? t("cloud.you", { name: u.username }) : u.username,
    )
    .join(", ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex cursor-default items-center -space-x-1.5">
          {shown.map((u) =>
            u.avatar ? (
              <img
                key={u.discordId}
                src={u.avatar}
                alt={u.username}
                className="h-5 w-5 rounded-full border border-[#101010] object-cover"
              />
            ) : (
              <CircleUser
                key={u.discordId}
                className="h-5 w-5 rounded-full border border-[#101010] bg-[#1a1a1a] text-white/40"
              />
            ),
          )}
          {extra > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full border border-[#101010] bg-white/10 px-1 text-[9px] font-semibold text-white/70">
              +{extra}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t("cloud.onlineInPack", { names })}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Link dialog (create new pack OR pick an existing one)
// ---------------------------------------------------------------------------

function CloudLinkDialog() {
  const { t } = useTranslation("workbench");
  const open = useSyncStore((s) => s.linkDialogOpen);
  const setOpen = useSyncStore((s) => s.setLinkDialogOpen);
  const projectName = useProjectStore((s) => s.project?.name ?? "");

  const [name, setName] = useState(projectName);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(projectName);
    setPacks(null);
    listMyPacks()
      .then(setPacks)
      .catch((e) => {
        setPacks([]);
        toast.error(t("cloud.packsLoadFailed"), {
          description: errorMessage(e),
        });
      });
  }, [open, projectName]);

  const createAndLink = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const pack = await createPack(trimmed);
      await linkProject(pack.packId);
      toast.success(t("cloud.linkedToast", { name: pack.name }), {
        description: t("cloud.linkedDescriptionUpload"),
      });
      setOpen(false);
    } catch (e) {
      toast.error(t("cloud.createFailed"), {
        description: errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const linkExisting = async (pack: Pack) => {
    if (busy) return;
    setBusy(true);
    try {
      await linkProject(pack.packId);
      toast.success(t("cloud.linkedToast", { name: pack.name }), {
        description:
          pack.headRevision > 0
            ? t("cloud.linkedDescriptionPull", {
                revision: pack.headRevision,
              })
            : t("cloud.linkedDescriptionUpload"),
      });
      setOpen(false);
    } catch (e) {
      toast.error(t("cloud.linkFailed"), { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent className="liquid-glass border-white/15 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{t("cloud.linkTitle")}</DialogTitle>
          <DialogDescription className="text-white/50">
            {t("cloud.linkDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cloud-pack-name" className="text-white/70">
              {t("cloud.createNewPack")}
            </Label>
            <div className="flex gap-2">
              <Input
                id="cloud-pack-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("cloud.packNamePlaceholder")}
                className="border-white/15 bg-white/5 text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createAndLink();
                }}
              />
              <Button
                disabled={busy || !name.trim()}
                onClick={() => void createAndLink()}
              >
                <Plus className="h-4 w-4" />
                {t("cloud.create")}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1 bg-white/8" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
              {t("cloud.orExistingPack")}
            </span>
            <Separator className="flex-1 bg-white/8" />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-[10px] border border-white/8">
            {packs === null ? (
              <div className="flex flex-col gap-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-[8px] bg-white/5" />
                ))}
              </div>
            ) : packs.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-white/35">
                {t("cloud.noPacksFound")}
              </p>
            ) : (
              packs.map((pack) => (
                <button
                  key={pack.packId}
                  type="button"
                  disabled={busy}
                  onClick={() => void linkExisting(pack)}
                  className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-white/5 disabled:opacity-50"
                >
                  <Cloud className="h-3.5 w-3.5 shrink-0 text-[#7289DA]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                    {pack.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-white/40">
                    {t("cloud.rev", { revision: pack.headRevision })}
                  </span>
                  <span className="shrink-0 text-[10px] text-white/30">
                    {formatRelativeTime(pack.updatedAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Progress dialog (push/pull phases)
// ---------------------------------------------------------------------------

const PUSH_PHASES: Array<{ id: SyncPhase; labelKey: string }> = [
  { id: "check", labelKey: "cloud.phaseCheck" },
  { id: "upload", labelKey: "cloud.phaseUpload" },
  { id: "commit", labelKey: "cloud.phaseCommit" },
];
const PULL_PHASES: Array<{ id: SyncPhase; labelKey: string }> = [
  { id: "download", labelKey: "cloud.phaseDownload" },
];

function SyncProgressDialog() {
  const { t } = useTranslation("workbench");
  const busy = useSyncStore((s) => s.busy);
  const progress = useSyncStore((s) => s.progress);
  if (!busy) return null;

  const phases = busy === "push" ? PUSH_PHASES : PULL_PHASES;
  const activeIndex = progress
    ? phases.findIndex((p) => p.id === progress.phase)
    : 0;
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <Dialog open>
      <DialogContent
        className="liquid-glass border-white/15 sm:max-w-sm"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-white">
            {busy === "push"
              ? t("cloud.uploading")
              : t("cloud.loadingLatest")}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {t("cloud.pleaseWait")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {phases.map((phase, index) => {
            const done = index < activeIndex;
            const active = index === activeIndex;
            return (
              <div key={phase.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs">
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7289DA]" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                  )}
                  <span
                    className={cn(
                      "text-white/40",
                      active && "font-medium text-white",
                      done && "text-white/60",
                    )}
                  >
                    {t(phase.labelKey)}
                  </span>
                  {active && progress && progress.total > 1 && (
                    <span className="ml-auto font-mono text-[10px] text-white/35">
                      {Math.min(progress.current + 1, progress.total)}/{progress.total}
                    </span>
                  )}
                </div>
                {active && (
                  <>
                    <Progress value={percent} className="h-1.5 bg-white/10" />
                    {progress?.label && (
                      <p className="truncate text-[10px] text-white/35">
                        {progress.label}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 409 conflict dialog (contract: two options, German)
// ---------------------------------------------------------------------------

function ConflictDialog() {
  const { t } = useTranslation("workbench");
  const headRevision = useSyncStore((s) => s.conflictHeadRevision);
  const dismiss = useSyncStore((s) => s.dismissConflict);
  const push = useSyncStore((s) => s.push);
  const pull = useSyncStore((s) => s.pull);

  return (
    <Dialog open={headRevision !== null} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="liquid-glass border-white/15 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {t("cloud.conflictTitle")}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {t("cloud.conflictDescription", { revision: headRevision })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              dismiss();
              void pull({ force: true });
            }}
          >
            <CloudDownload className="h-4 w-4" />
            {t("cloud.loadRemoteDiscard")}
          </Button>
          <Button
            className="w-full justify-start"
            onClick={() => {
              const base = headRevision;
              dismiss();
              if (base !== null) void push(base);
            }}
          >
            <CloudUpload className="h-4 w-4" />
            {t("cloud.retryOnRemote")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pull confirm (only when local changes would be lost)
// ---------------------------------------------------------------------------

function PullConfirmDialog() {
  const { t } = useTranslation("workbench");
  const open = useSyncStore((s) => s.pullConfirmOpen);
  const setOpen = useSyncStore((s) => s.setPullConfirmOpen);
  const pull = useSyncStore((s) => s.pull);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="liquid-glass border-white/15 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">{t("cloud.pullConfirmTitle")}</DialogTitle>
          <DialogDescription className="text-white/50">
            {t("cloud.pullConfirmDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common:cancel")}
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              void pull({ force: true });
            }}
          >
            <CloudDownload className="h-4 w-4" />
            {t("cloud.loadLatest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Server build (subtle post-push action + running indicator)
// ---------------------------------------------------------------------------

function ServerBuildAction() {
  const { t } = useTranslation("workbench");
  const serverBuild = useSyncStore((s) => s.serverBuild);
  const requestServerBuild = useSyncStore((s) => s.requestServerBuild);
  const packId = useProjectStore(
    (s) => s.project?.sync.remoteProjectId ?? null,
  );

  if (!serverBuild || !packId || serverBuild.packId !== packId) return null;

  if (serverBuild.status === "offer") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-white/55 hover:bg-white/10 hover:text-white"
            onClick={() => void requestServerBuild()}
          >
            <Server className="h-3.5 w-3.5" />
            {t("cloud.triggerServerBuild")}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("cloud.serverBuildTooltip", { revision: serverBuild.revision })}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-7 cursor-default items-center gap-1.5 rounded-full bg-white/5 px-2.5 text-xs text-white/55">
          <Loader2 className="h-3 w-3 animate-spin text-[#7289DA]" />
          {t("cloud.serverBuildRunning")}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t("cloud.serverBuildRunningTooltip", {
          revision: serverBuild.revision,
        })}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Header section
// ---------------------------------------------------------------------------

function LinkedControls() {
  const { t } = useTranslation("workbench");
  const baseRevision = useProjectStore(
    (s) => s.project?.sync.baseRevision ?? null,
  );
  const lastSyncedAt = useProjectStore(
    (s) => s.project?.sync.lastSyncedAt ?? null,
  );
  const collabStatus = useCollabStore((s) => s.status);
  const busy = useSyncStore((s) => s.busy);
  const push = useSyncStore((s) => s.push);
  const pull = useSyncStore((s) => s.pull);
  const unsynced = useUnsyncedChanges();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex h-7 cursor-default items-center gap-1.5 rounded-full bg-white/5 px-2.5">
            <Cloud
              className={cn(
                "h-3.5 w-3.5",
                collabStatus === "online"
                  ? "text-emerald-400"
                  : collabStatus === "connecting"
                    ? "text-amber-300"
                    : "text-white/35",
              )}
            />
            <span className="font-mono text-[10px] text-white/60">
              {t("cloud.rev", { revision: baseRevision ?? 0 })}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {collabStatus === "online"
            ? t("cloud.connected")
            : collabStatus === "connecting"
              ? t("cloud.connecting")
              : t("cloud.offline")}
          {" · "}
          {lastSyncedAt
            ? t("cloud.lastSynced", {
                time: formatRelativeTime(lastSyncedAt),
              })
            : t("cloud.neverSynced")}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={busy !== null}
            onClick={() => void push()}
          >
            {busy === "push" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudUpload className="h-3.5 w-3.5" />
            )}
            {unsynced ? t("cloud.uploadChanges") : t("cloud.upload")}
            {unsynced && (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("cloud.uploadTooltip")}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[8px] text-white/55 hover:bg-white/10 hover:text-white"
            disabled={busy !== null}
            onClick={() => void pull()}
            aria-label={t("cloud.loadLatest")}
          >
            {busy === "pull" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("cloud.loadLatest")}</TooltipContent>
      </Tooltip>

      <ServerBuildAction />
    </>
  );
}

export function CloudSection() {
  const { t } = useTranslation("workbench");
  const linked = useProjectStore(
    (s) => (s.project?.sync.remoteProjectId ?? null) !== null,
  );
  const setLinkDialogOpen = useSyncStore((s) => s.setLinkDialogOpen);

  return (
    <div className="flex items-center gap-1.5">
      <RosterStack />

      {linked ? (
        <LinkedControls />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setLinkDialogOpen(true)}
            >
              <Cloud className="h-3.5 w-3.5" />
              {t("cloud.linkWithCloud")}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("cloud.linkWithCloudTooltip")}
          </TooltipContent>
        </Tooltip>
      )}

      <CloudLinkDialog />
      <SyncProgressDialog />
      <ConflictDialog />
      <PullConfirmDialog />
    </div>
  );
}
