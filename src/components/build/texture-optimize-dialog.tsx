/**
 * Single-texture optimize dialog (inspector texture row context menu):
 * maxDimension 512/1024/2048, format keep/BC1/BC3/BC7, mip switch — runs the
 * sidecar /texture/optimize IN PLACE, re-hashes the file and updates every
 * drawable referencing it (one undo step) + invalidates preview caches.
 */

import { useEffect, useState } from "react";
import { usePreferencesStore } from "@/lib/stores/preferences-store";
import { useTranslation } from "react-i18next";
import { Loader2, Wand2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { baseName, formatBytes } from "@/lib/format";
import {
  applyOptimizedTextures,
  KEEP_FORMAT,
  optimizeProjectTexture,
  resolveFormatChoice,
  type FormatChoice,
} from "@/lib/project/texture-optimize";
import { usePreviewStore } from "@/lib/stores/preview-store";
import { useProjectStore } from "@/lib/stores/project-store";
import type { AssetRef } from "@/lib/project/schema";

const MAX_DIMENSIONS = [512, 1024, 2048] as const;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface TextureOptimizeDialogProps {
  /** Texture to optimize — null keeps the dialog closed. */
  texture: AssetRef | null;
  onClose: () => void;
}

export function TextureOptimizeDialog({
  texture,
  onClose,
}: TextureOptimizeDialogProps) {
  const { t } = useTranslation("build");
  const projectDir = useProjectStore((s) => s.projectDir);
  const preview = usePreviewStore((s) =>
    texture ? s.previews[texture.hash] : undefined,
  );

  const [maxDimension, setMaxDimension] = useState<number>(1024);
  const [format, setFormat] = useState<FormatChoice>(KEEP_FORMAT);
  const [regenerateMips, setRegenerateMips] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reset per texture so a previous run's settings don't stick surprisingly —
  // the format starts from the configured default (Settings → Texture
  // optimization).
  useEffect(() => {
    if (texture) {
      setMaxDimension(1024);
      setFormat(usePreferencesStore.getState().defaultTextureFormat);
      setRegenerateMips(true);
      setBusy(false);
    }
  }, [texture]);

  const run = async () => {
    if (!texture || !projectDir || busy) return;
    setBusy(true);
    try {
      const result = await optimizeProjectTexture(projectDir, texture, {
        maxDimension,
        format: resolveFormatChoice(format),
        regenerateMips,
      });
      applyOptimizedTextures([result]);
      toast.success(t("texture.toast.optimized"), {
        description:
          `${result.before.width}×${result.before.height} · ${formatBytes(result.before.sizeBytes)}` +
          ` → ${result.after.width}×${result.after.height} · ${formatBytes(result.after.sizeBytes)}`,
      });
      onClose();
    } catch (e) {
      toast.error(t("texture.toast.failed"), { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const meta = preview?.textures ?? [];

  return (
    <Dialog open={texture !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="liquid-glass border-white/15 sm:max-w-sm"
        showCloseButton={!busy}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wand2 className="h-4 w-4 text-[#7289DA]" />
            {t("texture.title")}
          </DialogTitle>
          <DialogDescription className="min-w-0 [overflow-wrap:anywhere] text-white/50">
            {texture
              ? t("texture.description", {
                  name: baseName(texture.path),
                  size: formatBytes(texture.size),
                })
              : ""}
          </DialogDescription>
        </DialogHeader>

        <p className="-mt-1 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
          {t("texture.permanentWarning")}
        </p>

        {meta.length > 0 && (
          <p className="-mt-2 text-[11px] text-white/35">
            {t("texture.current", {
              list: meta
                .slice(0, 3)
                .map((tx) => `${tx.width}×${tx.height} ${tx.format}`)
                .join(", "),
            })}
            {meta.length > 3 &&
              t("texture.currentMore", { count: meta.length - 3 })}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-white/70">{t("texture.maxEdge")}</Label>
            <Select
              value={String(maxDimension)}
              onValueChange={(v) => setMaxDimension(Number.parseInt(v, 10))}
            >
              <SelectTrigger className="h-8 w-28 border-white/15 bg-white/5 font-mono text-xs text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAX_DIMENSIONS.map((dim) => (
                  <SelectItem key={dim} value={String(dim)}>
                    {dim} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-white/70">{t("texture.format")}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as FormatChoice)}>
              <SelectTrigger className="h-8 w-28 border-white/15 bg-white/5 text-xs text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_FORMAT}>{t("texture.formatKeep")}</SelectItem>
                <SelectItem value="BC1">{t("texture.formatBC1")}</SelectItem>
                <SelectItem value="BC3">{t("texture.formatBC3")}</SelectItem>
                <SelectItem value="BC7">{t("texture.formatBC7")}</SelectItem>
                <SelectItem value="RGBA8888">{t("texture.formatRGBA8888")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {format === "RGBA8888" && (
            <p className="-mt-1 text-[11px] leading-relaxed text-amber-200/70">
              {t("texture.rgbaSizeHint")}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-white/70">{t("texture.regenerateMips")}</Label>
            <Switch checked={regenerateMips} onCheckedChange={setRegenerateMips} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("common:cancel")}
          </Button>
          <Button disabled={busy || !projectDir} onClick={() => void run()}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {t("texture.optimize")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
