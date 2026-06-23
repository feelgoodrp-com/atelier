/**
 * Bulk texture optimize ("Alle übergroßen Texturen optimieren…"):
 * scans every unique project texture via the cached /parse/ytd metadata
 * (preview store), lists files whose longest edge exceeds 2048 px and runs
 * the in-place optimization sequentially with progress. All successful
 * results are committed as ONE undo step via updateTexturesBatch.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, Images, Loader2 } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { baseName, formatBytes } from "@/lib/format";
import { joinPath } from "@/lib/project/io";
import {
  applyOptimizedTextures,
  collectProjectTextures,
  KEEP_FORMAT,
  maxEdgeOf,
  optimizeProjectTexture,
  resolveFormatChoice,
  type FormatChoice,
  type OptimizedTexture,
} from "@/lib/project/texture-optimize";
import { usePreviewStore } from "@/lib/stores/preview-store";
import { useProjectStore } from "@/lib/stores/project-store";
import type { AssetRef } from "@/lib/project/schema";

/** Longest edge above which a texture counts as übergroß. */
const OVERSIZE_THRESHOLD = 2048;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface BulkOptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkOptimizeDialog({ open, onOpenChange }: BulkOptimizeDialogProps) {
  const { t } = useTranslation("build");
  const project = useProjectStore((s) => s.project);
  const projectDir = useProjectStore((s) => s.projectDir);
  const previews = usePreviewStore((s) => s.previews);
  const ensurePreview = usePreviewStore((s) => s.ensurePreview);

  const [maxDimension, setMaxDimension] = useState<number>(2048);
  const [format, setFormat] = useState<FormatChoice>(KEEP_FORMAT);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>(
    { done: 0, total: 0, label: "" },
  );

  /** Unique textures of the project (by path). */
  const textures = useMemo(
    () => (project ? collectProjectTextures(project) : []),
    [project],
  );

  // Kick off metadata parsing for every texture as soon as the dialog opens.
  useEffect(() => {
    if (!open || !projectDir) return;
    for (const texture of textures) {
      ensurePreview(texture.hash, joinPath(projectDir, texture.path));
    }
  }, [open, projectDir, textures, ensurePreview]);

  // Reset the controls each time the dialog opens so a previous run's format
  // (especially the file-enlarging RGBA8888) never silently carries over.
  useEffect(() => {
    if (open) {
      setFormat(KEEP_FORMAT);
      setMaxDimension(2048);
    }
  }, [open]);

  const scan = useMemo(() => {
    let pending = 0;
    let unreadable = 0;
    const oversized: Array<{ texture: AssetRef; maxEdge: number }> = [];
    for (const texture of textures) {
      const preview = previews[texture.hash];
      if (!preview || preview.status === "loading") {
        pending++;
        continue;
      }
      if (preview.status === "error") {
        unreadable++;
        continue;
      }
      const maxEdge = maxEdgeOf(preview.textures);
      if (maxEdge > OVERSIZE_THRESHOLD) oversized.push({ texture, maxEdge });
    }
    oversized.sort((a, b) => b.maxEdge - a.maxEdge || b.texture.size - a.texture.size);
    return { pending, unreadable, oversized };
  }, [textures, previews]);

  const close = (next: boolean) => {
    if (!next && running) return; // do not abandon a running batch
    onOpenChange(next);
  };

  const run = async () => {
    if (!projectDir || running || scan.oversized.length === 0) return;
    setRunning(true);
    const targets = scan.oversized;
    setProgress({ done: 0, total: targets.length, label: "" });

    const results: OptimizedTexture[] = [];
    const failures: string[] = [];
    try {
      for (const [index, { texture }] of targets.entries()) {
        setProgress({
          done: index,
          total: targets.length,
          label: baseName(texture.path),
        });
        try {
          results.push(
            await optimizeProjectTexture(projectDir, texture, {
              maxDimension,
              format: resolveFormatChoice(format),
              regenerateMips: true,
            }),
          );
        } catch (e) {
          failures.push(`${baseName(texture.path)}: ${errorMessage(e)}`);
        }
      }
      setProgress({ done: targets.length, total: targets.length, label: "" });

      // ONE undo step for the whole batch.
      applyOptimizedTextures(results);

      if (results.length > 0) {
        const saved = results.reduce(
          (sum, r) => sum + Math.max(0, r.before.sizeBytes - r.after.sizeBytes),
          0,
        );
        toast.success(t("bulk.toast.optimized", { count: results.length }), {
          description:
            failures.length > 0
              ? t("bulk.toast.savedWithFailures", {
                  size: formatBytes(saved),
                  count: failures.length,
                })
              : t("bulk.toast.saved", { size: formatBytes(saved) }),
        });
      }
      if (failures.length > 0) {
        toast.error(
          results.length > 0
            ? t("bulk.toast.someFailed")
            : t("bulk.toast.noneOptimized"),
          { description: failures.slice(0, 3).join("\n") },
        );
      }
      onOpenChange(false);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="liquid-glass max-h-[80vh] border-white/15 sm:max-w-md"
        showCloseButton={!running}
        onInteractOutside={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Images className="h-4 w-4 text-[#7289DA]" />
            {t("bulk.title")}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {t("bulk.description", { threshold: OVERSIZE_THRESHOLD })}
          </DialogDescription>
        </DialogHeader>

        <p className="-mt-1 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
          {t("bulk.permanentWarning")}
        </p>

        {running ? (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-2 text-sm text-white">
              <Loader2 className="h-4 w-4 animate-spin text-[#7289DA]" />
              {t("bulk.optimizing", {
                done: Math.min(progress.done + 1, progress.total),
                total: progress.total,
              })}
            </div>
            <Progress
              value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
              className="h-1.5 bg-white/10"
            />
            <p className="min-h-4 truncate text-[11px] text-white/40">
              {progress.label}
            </p>
          </div>
        ) : scan.pending > 0 ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#7289DA]" />
            <p className="text-xs text-white/45">
              {t("bulk.analyzing", {
                pending: scan.pending,
                total: textures.length,
              })}
            </p>
          </div>
        ) : scan.oversized.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CircleCheck className="h-7 w-7 text-emerald-400" />
            <p className="text-sm text-white/60">
              {t("bulk.noOversized")}
            </p>
            {scan.unreadable > 0 && (
              <p className="text-[11px] text-white/35">
                {t("bulk.unreadable", { count: scan.unreadable })}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <ScrollArea className="max-h-[38vh] rounded-[10px] border border-white/8">
              <div className="flex flex-col">
                {scan.oversized.map(({ texture, maxEdge }) => (
                  <div
                    key={texture.path}
                    className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-xs last:border-b-0"
                  >
                    <span
                      className="min-w-0 flex-1 truncate text-white/80"
                      title={texture.path}
                    >
                      {baseName(texture.path)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-amber-300">
                      {maxEdge} px
                    </span>
                    <span className="w-16 shrink-0 text-right text-[10px] text-white/40">
                      {formatBytes(texture.size)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-white/70">{t("bulk.shrinkTo")}</Label>
              <Select
                value={String(maxDimension)}
                onValueChange={(v) => setMaxDimension(Number.parseInt(v, 10))}
              >
                <SelectTrigger className="h-8 w-28 border-white/15 bg-white/5 font-mono text-xs text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1024">1024 px</SelectItem>
                  <SelectItem value="2048">2048 px</SelectItem>
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
              <p className="text-[11px] leading-relaxed text-amber-200/70">
                {t("texture.rgbaSizeHint")}
              </p>
            )}

            {scan.unreadable > 0 && (
              <p className="text-[10px] text-white/35">
                {t("bulk.skipped", { count: scan.unreadable })}
              </p>
            )}
          </div>
        )}

        {!running && (
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              disabled={scan.pending > 0 || scan.oversized.length === 0 || !projectDir}
              onClick={() => void run()}
            >
              <Images className="h-4 w-4" />
              {t("bulk.optimizeCount", { count: scan.oversized.length })}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
