/**
 * Build setup dialog (workbench/tattoo header "Build"): target, dlcName
 * (persisted back to the project settings), optional resourceName, output
 * folder (remembered in the plugin store) and the shop-meta switch.
 *
 * Everything after this — checking, findings, building — happens on the build
 * SCREEN (screens/build.tsx), because those steps need room and must survive
 * jumping into the workbench to fix something. This dialog only collects the
 * options and hands them to the build store.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Hammer } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getLastBuildOutDir, setLastBuildOutDir } from "@/lib/settings";
import type { BuildTarget } from "@/lib/sidecar/types";
import { useBuildStore } from "@/lib/stores/build-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { usePreferencesStore } from "@/lib/stores/preferences-store";
import { useUiStore } from "@/lib/stores/ui-store";

interface TargetOption {
  id: BuildTarget;
}

const DLC_NAME_RE = /^[a-z0-9_]+$/;
const RESOURCE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const TARGETS: TargetOption[] = [
  { id: "fivem" },
  { id: "singleplayer" },
  { id: "ragemp" },
  { id: "altv" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
      {children}
    </Label>
  );
}

interface BuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuildDialog({ open, onOpenChange }: BuildDialogProps) {
  const { t } = useTranslation("build");
  const project = useProjectStore((s) => s.project);
  const projectDir = useProjectStore((s) => s.projectDir);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const startSession = useBuildStore((s) => s.start);

  const [target, setTarget] = useState<BuildTarget>(
    () => usePreferencesStore.getState().defaultExportTarget,
  );
  const [dlcName, setDlcName] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [outDir, setOutDir] = useState<string | null>(null);
  const [generateShopMeta, setGenerateShopMeta] = useState(true);
  // Off by default: pure viewer metadata, nothing the game itself needs.
  const [generateViewerManifest, setGenerateViewerManifest] = useState(false);

  // Re-initialize from project settings + remembered folder on every open.
  useEffect(() => {
    if (!open) return;
    setTarget(usePreferencesStore.getState().defaultExportTarget);
    setDlcName(useProjectStore.getState().project?.settings.dlcName ?? "");
    setResourceName("");
    setGenerateShopMeta(true);
    setGenerateViewerManifest(false);
    void getLastBuildOutDir().then((dir) => {
      if (dir) setOutDir((current) => current ?? dir);
    });
  }, [open]);

  const normalizedDlc = dlcName.trim().toLowerCase();
  const dlcValid = DLC_NAME_RE.test(normalizedDlc);
  const trimmedResource = resourceName.trim();
  const resourceValid =
    trimmedResource.length === 0 || RESOURCE_NAME_RE.test(trimmedResource);
  const setupValid = dlcValid && resourceValid && outDir !== null;

  const pickOutDir = async () => {
    const selected = await openDialog({
      directory: true,
      title: t("setup.outDirTitle"),
      defaultPath: outDir ?? undefined,
    }).catch(() => null);
    if (typeof selected === "string") {
      setOutDir(selected);
      void setLastBuildOutDir(selected);
    }
  };

  /** Hand the options to the store, which opens the build screen. */
  const startSessionAndClose = () => {
    if (!project || !projectDir || !setupValid || !outDir) return;
    // Persist the (normalized) DLC name back into the project settings.
    if (normalizedDlc !== project.settings.dlcName) {
      updateSettings({ dlcName: normalizedDlc });
    }
    startSession(
      {
        target,
        outDir,
        dlcName: normalizedDlc,
        resourceName: trimmedResource || null,
        generateShopMeta,
        generateViewerManifest,
      },
      useUiStore.getState().screen,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="liquid-glass max-h-[85vh] border-white/15 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Hammer className="h-4 w-4 text-[#7289DA]" />
            {t("dialog.title")}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {t("dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t("targets.label")}</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {TARGETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTarget(option.id)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left transition-colors",
                    target === option.id
                      ? "border-[#5865F2]/60 bg-[#5865F2]/10"
                      : "border-white/10 bg-white/5 hover:border-white/25",
                  )}
                >
                  <span className="text-sm font-semibold text-white">
                    {t(`targets.${option.id}.label`)}
                  </span>
                  <span className="text-[11px] leading-snug text-white/45">
                    {t(`targets.${option.id}.description`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("setup.dlcName")}</FieldLabel>
              <Input
                value={dlcName}
                onChange={(e) => setDlcName(e.target.value)}
                placeholder={t("setup.dlcPlaceholder")}
                className={cn(
                  "h-8 border-white/15 bg-white/5 font-mono text-xs text-white",
                  dlcName.length > 0 && !dlcValid && "border-red-500/50",
                )}
              />
              {dlcName.length > 0 && !dlcValid && (
                <p className="text-[10px] text-red-300">{t("setup.dlcInvalid")}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("setup.resourceName")}</FieldLabel>
              <Input
                value={resourceName}
                onChange={(e) => setResourceName(e.target.value)}
                placeholder={normalizedDlc || t("setup.resourcePlaceholderFallback")}
                className={cn(
                  "h-8 border-white/15 bg-white/5 font-mono text-xs text-white",
                  !resourceValid && "border-red-500/50",
                )}
              />
              {!resourceValid && (
                <p className="text-[10px] text-red-300">{t("setup.resourceInvalid")}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t("setup.outDir")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                readOnly
                value={outDir ?? ""}
                placeholder={t("setup.outDirPlaceholder")}
                className="h-8 border-white/15 bg-white/5 text-xs text-white"
                title={outDir ?? undefined}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void pickOutDir()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("setup.browse")}
              </Button>
            </div>
          </div>

          {target === "fivem" && (
            <>
              <div className="flex items-center justify-between rounded-[10px] border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex flex-col">
                  <span className="text-xs text-white/70">{t("setup.shopMeta")}</span>
                  <span className="text-[10px] text-white/35">{t("setup.shopMetaHint")}</span>
                </div>
                <Switch checked={generateShopMeta} onCheckedChange={setGenerateShopMeta} />
              </div>

              <div className="flex items-center justify-between rounded-[10px] border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex flex-col">
                  <span className="text-xs text-white/70">{t("setup.viewerManifest")}</span>
                  <span className="text-[10px] text-white/35">
                    {t("setup.viewerManifestHint")}
                  </span>
                </div>
                <Switch
                  checked={generateViewerManifest}
                  onCheckedChange={setGenerateViewerManifest}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:cancel")}
          </Button>
          <Button disabled={!setupValid} onClick={startSessionAndClose}>
            {t("setup.next")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
