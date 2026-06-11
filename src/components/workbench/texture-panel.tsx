import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, ImageOff, Plus, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { TextureOptimizeDialog } from "@/components/build/texture-optimize-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { baseName, formatBytes } from "@/lib/format";
import { textureIndexToLetter } from "@/lib/gta/filename-classifier";
import { canonicalYtdName } from "@/lib/gta/stream-names";
import { joinPath } from "@/lib/project/io";
import { importTextureFile } from "@/lib/project/import-assets";
import {
  clampTextureIndex,
  usePreview3dStore,
} from "@/lib/stores/preview-3d-store";
import { usePreviewStore } from "@/lib/stores/preview-store";
import { selectDerivedDrawableIds, useProjectStore } from "@/lib/stores/project-store";
import type { AssetRef, ProjectDrawable } from "@/lib/project/schema";

function transformStyle(
  transform: { x: number; y: number; scaleX: number; scaleY: number } | null,
): string | undefined {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

function TextureThumb({ texture, projectDir }: { texture: AssetRef; projectDir: string }) {
  const preview = usePreviewStore((s) => s.previews[texture.hash]);
  const ensurePreview = usePreviewStore((s) => s.ensurePreview);

  useEffect(() => {
    ensurePreview(texture.hash, joinPath(projectDir, texture.path));
  }, [texture.hash, texture.path, projectDir, ensurePreview]);

  if (!preview || preview.status === "loading") {
    return <Skeleton className="h-10 w-10 shrink-0 rounded-[8px] bg-white/10" />;
  }
  if (preview.status === "error" || !preview.dataUrl) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-white/5">
        <ImageOff className="h-4 w-4 text-white/25" />
      </div>
    );
  }
  return (
    <img
      src={preview.dataUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded-[8px] bg-black/40 object-contain"
    />
  );
}

function TextureMetaTooltip({ texture }: { texture: AssetRef }) {
  const preview = usePreviewStore((s) => s.previews[texture.hash]);
  const meta = preview?.textures ?? [];
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="font-medium">{baseName(texture.path)}</span>
      <span className="text-white/60">{formatBytes(texture.size)}</span>
      {meta.length === 0 && preview?.status === "ready" && (
        <span className="text-white/60">Keine Texturen im Dictionary</span>
      )}
      {meta.slice(0, 4).map((t) => (
        <span key={t.name} className="text-white/60">
          {t.name}: {t.width}×{t.height} · {t.format} · {t.mipCount} Mips
        </span>
      ))}
      {meta.length > 4 && (
        <span className="text-white/40">… und {meta.length - 4} weitere</span>
      )}
    </div>
  );
}

function TextureRow({
  texture,
  index,
  projectDir,
  active,
  canonicalName,
  onSelect,
  onRemove,
  onOptimize,
}: {
  texture: AssetRef;
  index: number;
  projectDir: string;
  /** This variant is the one shown in the 3D preview. */
  active: boolean;
  /** Name this texture gets in the BUILT pack (slot + Nr + letter). */
  canonicalName: string;
  onSelect: () => void;
  onRemove: () => void;
  /** Opens the optimize dialog for this texture (context menu). */
  onOptimize: () => void;
}) {
  const sortableId = `${index}:${texture.hash}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });

  const style: CSSProperties = {
    transform: transformStyle(transform),
    transition,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          onClick={onSelect}
          title="Klicken: Variante in der 3D-Vorschau anzeigen"
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-[10px] px-1.5 py-1.5 transition-colors hover:bg-white/5",
            active && "bg-[#5865F2]/10 ring-1 ring-inset ring-[#5865F2]/30",
            isDragging && "z-10 bg-white/10 opacity-80",
          )}
        >
          <button
            type="button"
            {...attributes}
            {...listeners}
            tabIndex={-1}
            className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-white/25 hover:text-white/60 active:cursor-grabbing"
            title="Ziehen zum Sortieren"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <span
            className={cn(
              "w-4 shrink-0 text-center font-mono text-xs font-semibold",
              active ? "text-white" : "text-[#7289DA]",
            )}
          >
            {textureIndexToLetter(index)}
          </span>
          <TextureThumb texture={texture} projectDir={projectDir} />
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="min-w-0 flex-1">
                {/* Name in the BUILT pack — derived from slot + number,
                    independent of label and source file name. */}
                <p className="truncate text-xs text-white/70">{canonicalName}</p>
                <p className="truncate text-[10px] text-white/30">
                  Quelle: {baseName(texture.path)}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-72">
              <TextureMetaTooltip texture={texture} />
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-400"
            aria-label="Textur entfernen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={onOptimize}>
          <Wand2 className="h-4 w-4" />
          Optimieren…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TexturePanel({ drawable }: { drawable: ProjectDrawable }) {
  const projectDir = useProjectStore((s) => s.projectDir);
  const project = useProjectStore((s) => s.project);
  const setTextures = useProjectStore((s) => s.setTextures);
  const removeTexture = useProjectStore((s) => s.removeTexture);
  const reorderTexture = useProjectStore((s) => s.reorderTexture);

  // Build-time number of this drawable (position in its gender+slot bucket,
  // or the replace target) — drives the canonical names shown per variant.
  const derivedId = project ? (selectDerivedDrawableIds(project)[drawable.id] ?? 0) : 0;
  const [adding, setAdding] = useState(false);
  /** Texture the optimize dialog operates on (null = closed). */
  const [optimizeTarget, setOptimizeTarget] = useState<AssetRef | null>(null);

  // The active variant drives `textureIndex` of the 3D preview (default "a").
  const rawPreviewIndex = usePreview3dStore(
    (s) => s.textureIndexByDrawable[drawable.id],
  );
  const setTextureIndex = usePreview3dStore((s) => s.setTextureIndex);
  const previewIndex = clampTextureIndex(drawable, rawPreviewIndex);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const sortableIds = drawable.textures.map((t, i) => `${i}:${t.hash}`);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = sortableIds.indexOf(String(active.id));
      const to = sortableIds.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      reorderTexture(drawable.id, from, to);
    },
    [sortableIds, reorderTexture, drawable.id],
  );

  const addTextures = useCallback(async () => {
    if (!projectDir) return;
    const selected = await openDialog({
      multiple: true,
      title: "Textur-Varianten wählen (YTD)",
      filters: [{ name: "Texturen (YTD)", extensions: ["ytd"] }],
    }).catch(() => null);
    const paths = Array.isArray(selected)
      ? selected
      : typeof selected === "string"
        ? [selected]
        : [];
    if (paths.length === 0) return;

    setAdding(true);
    try {
      const current = useProjectStore
        .getState()
        .project?.drawables.find((d) => d.id === drawable.id);
      if (!current) return;
      const next = [...current.textures];
      let skippedMax = 0;
      const errors: string[] = [];
      for (const path of paths) {
        if (next.length >= 26) {
          skippedMax++;
          continue;
        }
        try {
          next.push(
            await importTextureFile(
              projectDir,
              path,
              current.gender,
              current.type,
            ),
          );
        } catch (e) {
          errors.push(
            `${baseName(path)}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      setTextures(drawable.id, next);
      const added = next.length - current.textures.length;
      if (added > 0) {
        toast.success(`${added} Textur(en) hinzugefügt`, {
          description:
            errors.length > 0 || skippedMax > 0
              ? [
                  ...errors.slice(0, 3),
                  skippedMax > 0
                    ? `${skippedMax} über dem Limit von 26 Varianten (a–z)`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n")
              : undefined,
        });
      } else {
        toast.error("Keine Textur hinzugefügt", {
          description:
            errors.slice(0, 3).join("\n") ||
            (skippedMax > 0
              ? "Maximal 26 Textur-Varianten pro Drawable (a–z)."
              : undefined),
        });
      }
    } finally {
      setAdding(false);
    }
  }, [projectDir, drawable.id, setTextures]);

  if (!projectDir) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Texturen ({drawable.textures.length}/26)
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={adding || drawable.textures.length >= 26}
          className="h-6 gap-1 px-2 text-[11px] text-white/55 hover:bg-white/10 hover:text-white"
          onClick={() => void addTextures()}
        >
          <Plus className="h-3 w-3" />
          {adding ? "Lädt…" : "Hinzufügen"}
        </Button>
      </div>

      {drawable.textures.length === 0 ? (
        <div className="glass-border-subtle flex flex-col items-center justify-center rounded-[10px] px-4 py-6 text-center">
          <ImageOff className="h-5 w-5 text-white/25" />
          <p className="mt-2 text-xs text-white/40">
            Noch keine Texturvarianten — füge YTD-Dateien hinzu.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col">
              {drawable.textures.map((texture, index) => (
                <TextureRow
                  key={`${index}:${texture.hash}`}
                  texture={texture}
                  index={index}
                  projectDir={projectDir}
                  active={index === previewIndex}
                  canonicalName={canonicalYtdName(drawable, derivedId, index)}
                  onSelect={() => setTextureIndex(drawable.id, index)}
                  onRemove={() => removeTexture(drawable.id, index)}
                  onOptimize={() => setOptimizeTarget(texture)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <TextureOptimizeDialog
        texture={optimizeTarget}
        onClose={() => setOptimizeTarget(null)}
      />
    </div>
  );
}
