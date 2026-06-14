import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  FileBox,
  Layers,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { baseName, formatBytes } from "@/lib/format";
import { textureIndexToLetter } from "@/lib/gta/filename-classifier";
import {
  clampTextureIndex,
  selectPreviewedDrawables,
  usePreview3dStore,
} from "@/lib/stores/preview-3d-store";
import {
  GTA_COMPONENTS,
  GTA_PROPS,
  getSlotById,
  type SlotId,
} from "@/lib/gta/components";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCollabStore } from "@/lib/stores/collab-store";
import { selectDerivedDrawableIds, useProjectStore } from "@/lib/stores/project-store";
import { canonicalYddName } from "@/lib/gta/stream-names";
import type { Gender, ProjectDrawable } from "@/lib/project/schema";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { GroupDialog } from "./group-dialog";
import { TexturePanel } from "./texture-panel";

const NO_GROUP = "__none__";
const NEW_GROUP = "__new__";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
      {children}
    </Label>
  );
}

function EmptyInspector() {
  const { t } = useTranslation("workbench");
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="glass-border-subtle flex h-14 w-14 items-center justify-center rounded-[10px]">
        <Layers className="h-6 w-6 text-white/30" />
      </div>
      <p className="mt-4 text-sm font-medium text-white/60">
        {t("inspector.emptyTitle")}
      </p>
      <p className="mt-1 max-w-60 text-xs text-white/35">
        {t("inspector.emptyDescription")}
      </p>
    </div>
  );
}

/**
 * Per-drawable texture switcher for multi-selection: the 3D preview renders
 * the whole selection as one outfit — here each rendered piece gets its own
 * a–z variant chips, so combinations can be tried without deselecting.
 */
function BulkTextureSwitcher({ ids }: { ids: string[] }) {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const textureIndexByDrawable = usePreview3dStore((s) => s.textureIndexByDrawable);
  const setTextureIndex = usePreview3dStore((s) => s.setTextureIndex);

  const { rendered } = useMemo(
    () => selectPreviewedDrawables(project, ids),
    [project, ids],
  );
  const withTextures = rendered.filter((d) => d.textures.length > 0);
  if (withTextures.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <FieldLabel>{t("inspector.previewTextures")}</FieldLabel>
        {withTextures.map((drawable) => {
          const active = clampTextureIndex(
            drawable,
            textureIndexByDrawable[drawable.id],
          );
          return (
            <div key={drawable.id} className="flex flex-col gap-1">
              <span className="truncate text-xs text-white/60">{drawable.label}</span>
              <div className="flex flex-wrap gap-1">
                {drawable.textures.map((texture, index) => (
                  <Tooltip key={`${index}:${texture.hash}`}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setTextureIndex(drawable.id, index)}
                        className={cn(
                          "h-6 w-6 rounded-[6px] font-mono text-[11px] transition-colors",
                          index === active
                            ? "bg-[#5865F2]/30 text-white ring-1 ring-inset ring-[#5865F2]/50"
                            : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        {textureIndexToLetter(index)}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-64 break-all">
                      {baseName(texture.path)}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Separator className="bg-white/8" />
    </>
  );
}

/** Bulk actions when 2+ drawables are selected. */
function BulkPanel({ ids }: { ids: string[] }) {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const assignGroup = useProjectStore((s) => s.assignGroup);
  const updateDrawable = useProjectStore((s) => s.updateDrawable);
  const removeDrawables = useProjectStore((s) => s.removeDrawables);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  const moveToGender = (gender: Gender) => {
    for (const d of project?.drawables ?? []) {
      if (ids.includes(d.id) && d.gender !== gender) {
        updateDrawable(d.id, { gender });
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm font-semibold text-white">
          {t("inspector.bulkSelected", { count: ids.length })}
        </p>
        <p className="mt-0.5 text-xs text-white/40">
          {t("inspector.bulkHint")}
        </p>
      </div>

      <Separator className="bg-white/8" />

      <BulkTextureSwitcher ids={ids} />

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t("inspector.assignGroup")}</FieldLabel>
        <Select
          onValueChange={(v) => {
            if (v === NEW_GROUP) setGroupDialogOpen(true);
            else assignGroup(ids, v === NO_GROUP ? null : v);
          }}
        >
          <SelectTrigger className="h-8 w-full border-white/15 bg-white/5 text-xs text-white">
            <SelectValue placeholder={t("inspector.selectGroup")} />
          </SelectTrigger>
          <SelectContent>
            {(project?.groups ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: g.color }}
                  />
                  {g.name}
                </span>
              </SelectItem>
            ))}
            <SelectItem value={NO_GROUP}>{t("inspector.noGroup")}</SelectItem>
            <SelectItem value={NEW_GROUP}>{t("inspector.newGroup")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t("inspector.moveGender")}</FieldLabel>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 font-mono text-xs"
            onClick={() => moveToGender("male")}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            mp_m
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 font-mono text-xs"
            onClick={() => moveToGender("female")}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            mp_f
          </Button>
        </div>
      </div>

      <Separator className="bg-white/8" />

      <Button
        size="sm"
        variant="outline"
        className="h-8 border-red-500/30 text-red-300 hover:bg-red-500/10"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t("inspector.deleteSelection")}
      </Button>

      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={ids.length}
        onConfirm={() => removeDrawables(ids)}
      />
      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        onCreated={(groupId) => assignGroup(ids, groupId)}
      />
    </div>
  );
}

function SingleInspector({ drawable }: { drawable: ProjectDrawable }) {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const updateDrawable = useProjectStore((s) => s.updateDrawable);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  // Build-time number (bucket position / replace target) — drives the
  // canonical file names shown in the Dateien section.
  const derivedId = project ? (selectDerivedDrawableIds(project)[drawable.id] ?? 0) : 0;

  // Advisory lock hint — editing stays possible, this is information only.
  const lock = useCollabStore((s) => s.locks[drawable.id]);
  const selfDiscordId = useAuthStore((s) => s.user?.discordId);
  const foreignLock =
    lock && lock.lockedByDiscordId !== selfDiscordId ? lock : null;

  // Label commits on blur/Enter so typing does not flood the undo history.
  const [labelDraft, setLabelDraft] = useState(drawable.label);
  useEffect(() => {
    setLabelDraft(drawable.label);
  }, [drawable.id, drawable.label]);

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed && trimmed !== drawable.label) {
      updateDrawable(drawable.id, { label: trimmed });
    } else {
      setLabelDraft(drawable.label);
    }
  };

  const handleTypeChange = (type: SlotId) => {
    const slot = getSlotById(type);
    if (!slot) return;
    updateDrawable(drawable.id, {
      type,
      kind: slot.kind,
      // Hair scale applies to hair drawables AND head props (hats compress
      // the hair underneath — the YMT generator writes the prop expression).
      flags:
        type === "hair" || type === "p_head"
          ? drawable.flags
          : { ...drawable.flags, hairScaleValue: null },
    });
  };

  const handleModeChange = (mode: "addon" | "replace") => {
    updateDrawable(drawable.id, {
      mode,
      replaceTargetId: mode === "replace" ? (drawable.replaceTargetId ?? 0) : null,
    });
  };

  const hairScale = drawable.flags.hairScaleValue;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-4">
        {foreignLock && (
          <div className="flex items-start gap-2 rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("inspector.lockNotice", { name: foreignLock.username })}</span>
          </div>
        )}

        {/* Label */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("inspector.label")}</FieldLabel>
          <Input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
            }}
            className="h-8 border-white/15 bg-white/5 text-sm text-white"
          />
        </div>

        {/* Gender + Type */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t("inspector.gender")}</FieldLabel>
            <Select
              value={drawable.gender}
              onValueChange={(v) =>
                updateDrawable(drawable.id, { gender: v as Gender })
              }
            >
              <SelectTrigger className="h-8 w-full border-white/15 bg-white/5 font-mono text-xs text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">mp_m</SelectItem>
                <SelectItem value="female">mp_f</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t("inspector.slot")}</FieldLabel>
            <Select
              value={drawable.type}
              onValueChange={(v) => handleTypeChange(v as SlotId)}
            >
              <SelectTrigger className="h-8 w-full border-white/15 bg-white/5 text-xs text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t("inspector.components")}</SelectLabel>
                  {GTA_COMPONENTS.map((slot) => (
                    <SelectItem key={slot.id} value={slot.id}>
                      {t(`slot.${slot.id}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t("inspector.props")}</SelectLabel>
                  {GTA_PROPS.map((slot) => (
                    <SelectItem key={slot.id} value={slot.id}>
                      {t(`slot.${slot.id}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Mode */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("inspector.mode")}</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={drawable.mode}
              onValueChange={(v) => handleModeChange(v as "addon" | "replace")}
            >
              <SelectTrigger className="h-8 w-full border-white/15 bg-white/5 text-xs text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addon">{t("inspector.addon")}</SelectItem>
                <SelectItem value="replace">{t("inspector.replace")}</SelectItem>
              </SelectContent>
            </Select>
            {drawable.mode === "replace" && (
              <Input
                type="number"
                min={0}
                value={drawable.replaceTargetId ?? 0}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  updateDrawable(drawable.id, {
                    replaceTargetId:
                      Number.isNaN(parsed) || parsed < 0 ? 0 : parsed,
                  });
                }}
                placeholder={t("inspector.targetId")}
                className="h-8 border-white/15 bg-white/5 font-mono text-xs text-white"
                title={t("inspector.targetIdTooltip")}
              />
            )}
          </div>
        </div>

        {/* Group */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("inspector.group")}</FieldLabel>
          <Select
            value={drawable.groupId ?? NO_GROUP}
            onValueChange={(v) => {
              if (v === NEW_GROUP) setGroupDialogOpen(true);
              else {
                updateDrawable(drawable.id, {
                  groupId: v === NO_GROUP ? null : v,
                });
              }
            }}
          >
            <SelectTrigger className="h-8 w-full border-white/15 bg-white/5 text-xs text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP}>{t("inspector.noGroup")}</SelectItem>
              {(project?.groups ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: g.color }}
                    />
                    {g.name}
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={NEW_GROUP}>
                <span className="flex items-center gap-2">
                  <Plus className="h-3 w-3" />
                  {t("inspector.newGroup")}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator className="bg-white/8" />

        {/* Flags */}
        <div className="flex flex-col gap-3">
          <FieldLabel>{t("inspector.flags")}</FieldLabel>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/70">{t("inspector.highHeels")}</span>
            <Switch
              checked={drawable.flags.highHeels}
              onCheckedChange={(checked) =>
                updateDrawable(drawable.id, {
                  flags: { ...drawable.flags, highHeels: checked },
                })
              }
            />
          </div>
          {(drawable.type === "hair" || drawable.type === "p_head") && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/70">
                  {t("inspector.hairScale")}
                  {drawable.type === "p_head" && (
                    <span className="ml-1 text-white/35">
                      {t("inspector.hairScaleHatHint")}
                    </span>
                  )}
                </span>
                <Switch
                  checked={hairScale !== null}
                  onCheckedChange={(checked) =>
                    updateDrawable(drawable.id, {
                      flags: {
                        ...drawable.flags,
                        hairScaleValue: checked ? 0.5 : null,
                      },
                    })
                  }
                />
              </div>
              {hairScale !== null && (
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={hairScale}
                    onChange={(e) =>
                      updateDrawable(drawable.id, {
                        flags: {
                          ...drawable.flags,
                          hairScaleValue: Number.parseFloat(e.target.value),
                        },
                      })
                    }
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-[#5865F2]"
                  />
                  <span className="w-10 text-right font-mono text-xs text-white/60">
                    {hairScale.toFixed(2)}
                  </span>
                </div>
              )}
              {hairScale !== null && drawable.type === "hair" && (
                <p className="text-[10px] leading-relaxed text-white/30">
                  {t("inspector.hairScalePreviewOnly")}
                </p>
              )}
            </div>
          )}
        </div>

        <Separator className="bg-white/8" />

        {/* Mesh / files */}
        <div className="flex flex-col gap-2">
          <FieldLabel>{t("inspector.files")}</FieldLabel>
          {drawable.ydd ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-white/5 px-2.5 py-2">
              <FileBox className="h-4 w-4 shrink-0 text-[#7289DA]" />
              <div className="min-w-0 flex-1" title={drawable.ydd.path}>
                {/* Name in the BUILT pack — derived from slot + number. */}
                <p className="truncate text-xs text-white/75">
                  {canonicalYddName(drawable, derivedId)}
                </p>
                <p className="truncate text-[10px] text-white/30">
                  {t("inspector.source", {
                    name: baseName(drawable.ydd.path),
                  })}
                </p>
              </div>
              <span className="shrink-0 text-[10px] text-white/35">
                {formatBytes(drawable.ydd.size)}
              </span>
            </div>
          ) : (
            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
              {t("inspector.noYddMesh")}
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-white/30">
            {t("inspector.filesHint")}
          </p>
          <div className="flex gap-1.5">
            {drawable.physics && (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-[10px] text-emerald-300"
                title={drawable.physics.path}
              >
                {t("inspector.physics")}
              </Badge>
            )}
            {drawable.firstPerson && (
              <Badge
                variant="outline"
                className="border-white/15 text-[10px] text-white/60"
                title={drawable.firstPerson.path}
              >
                {t("inspector.firstPerson")}
              </Badge>
            )}
          </div>
        </div>

        <Separator className="bg-white/8" />

        <TexturePanel drawable={drawable} />
      </div>

      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        onCreated={(groupId) =>
          updateDrawable(drawable.id, { groupId })
        }
      />
    </ScrollArea>
  );
}

export function Inspector() {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);

  const selected = useMemo(
    () => (project?.drawables ?? []).filter((d) => selection.includes(d.id)),
    [project, selection],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/8 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          {t("inspector.title")}
        </span>
        {selected.length > 0 && (
          <span className="font-mono text-[10px] text-white/30">
            {t("inspector.selected", { count: selected.length })}
          </span>
        )}
      </div>
      {selected.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyInspector />
        </div>
      ) : selected.length === 1 ? (
        <SingleInspector drawable={selected[0]} />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <BulkPanel ids={selection} />
        </ScrollArea>
      )}
    </div>
  );
}
