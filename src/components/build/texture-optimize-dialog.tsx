/**
 * Single-texture optimize dialog (inspector texture row context menu):
 * maxDimension 512/1024/2048, format keep/BC1/BC3/BC7, mip switch — runs the
 * sidecar /texture/optimize IN PLACE, re-hashes the file and updates every
 * drawable referencing it (one undo step) + invalidates preview caches.
 */

import { useEffect, useState } from "react";
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
  optimizeProjectTexture,
} from "@/lib/project/texture-optimize";
import { usePreviewStore } from "@/lib/stores/preview-store";
import { useProjectStore } from "@/lib/stores/project-store";
import type { AssetRef } from "@/lib/project/schema";

const KEEP_FORMAT = "keep";

type FormatChoice = typeof KEEP_FORMAT | "BC1" | "BC3" | "BC7";

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
  const projectDir = useProjectStore((s) => s.projectDir);
  const preview = usePreviewStore((s) =>
    texture ? s.previews[texture.hash] : undefined,
  );

  const [maxDimension, setMaxDimension] = useState<number>(1024);
  const [format, setFormat] = useState<FormatChoice>(KEEP_FORMAT);
  const [regenerateMips, setRegenerateMips] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reset per texture so a previous run's settings don't stick surprisingly.
  useEffect(() => {
    if (texture) {
      setMaxDimension(1024);
      setFormat(KEEP_FORMAT);
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
        format: format === KEEP_FORMAT ? null : format,
        regenerateMips,
      });
      applyOptimizedTextures([result]);
      toast.success("Textur optimiert", {
        description:
          `${result.before.width}×${result.before.height} · ${formatBytes(result.before.sizeBytes)}` +
          ` → ${result.after.width}×${result.after.height} · ${formatBytes(result.after.sizeBytes)}`,
      });
      onClose();
    } catch (e) {
      toast.error("Optimierung fehlgeschlagen", { description: errorMessage(e) });
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
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wand2 className="h-4 w-4 text-[#7289DA]" />
            Textur optimieren
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {texture
              ? `${baseName(texture.path)} (${formatBytes(texture.size)}) wird direkt in der Projektdatei verkleinert.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <p className="-mt-1 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
          Dauerhafte Änderung (nicht über Rückgängig umkehrbar) — das Original wird unter
          „.atelier-cache/texture-backups" im Projektordner gesichert.
        </p>

        {meta.length > 0 && (
          <p className="-mt-2 text-[11px] text-white/35">
            Aktuell:{" "}
            {meta
              .slice(0, 3)
              .map((t) => `${t.width}×${t.height} ${t.format}`)
              .join(", ")}
            {meta.length > 3 && ` … (+${meta.length - 3})`}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-white/70">Maximale Kantenlänge</Label>
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
            <Label className="text-xs text-white/70">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as FormatChoice)}>
              <SelectTrigger className="h-8 w-28 border-white/15 bg-white/5 text-xs text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_FORMAT}>Beibehalten</SelectItem>
                <SelectItem value="BC1">BC1 (klein)</SelectItem>
                <SelectItem value="BC3">BC3 (Alpha)</SelectItem>
                <SelectItem value="BC7">BC7 (beste Qualität)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-white/70">Mipmaps neu erzeugen</Label>
            <Switch checked={regenerateMips} onCheckedChange={setRegenerateMips} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={busy || !projectDir} onClick={() => void run()}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Optimieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
