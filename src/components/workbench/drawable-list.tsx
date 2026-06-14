import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
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
import {
  ArrowLeftRight,
  Copy,
  Eye,
  GripVertical,
  Lock,
  Plus,
  Search,
  Shirt,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSlotById } from "@/lib/gta/components";
import { textureIndexToLetter } from "@/lib/gta/filename-classifier";
import { selectPreviewedDrawables } from "@/lib/stores/preview-3d-store";
import { useGlbPrefetch } from "@/components/preview/use-glb-prefetch";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCollabStore } from "@/lib/stores/collab-store";
import {
  selectDerivedDrawableIds,
  selectDuplicateYddMap,
  useProjectStore,
} from "@/lib/stores/project-store";
import { useWorkbenchStore } from "@/lib/stores/workbench-store";
import type { Gender, ProjectDrawable } from "@/lib/project/schema";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { GroupDialog } from "./group-dialog";
import { pickAndImportFiles } from "./workbench-header";

/** Fixed row height (px) — required for the simple windowing below. */
const ROW_HEIGHT = 44;
/** Lists longer than this render windowed instead of fully. */
const VIRTUALIZE_THRESHOLD = 100;
const OVERSCAN = 8;

function textureChipLabel(count: number): string {
  if (count === 0) return "0";
  if (count === 1) return "a";
  return `a–${textureIndexToLetter(count - 1)}`;
}

/** dnd-kit transform → CSS (avoids the undeclared @dnd-kit/utilities dep). */
function transformStyle(
  transform: { x: number; y: number; scaleX: number; scaleY: number } | null,
): string | undefined {
  if (!transform) return undefined;
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

interface RowProps {
  drawable: ProjectDrawable;
  index: number;
  derivedId: number;
  groupColor: string | null;
  groupName: string | null;
  isDuplicate: boolean;
  selected: boolean;
  /** True when the open 3D preview currently renders this drawable. */
  previewed: boolean;
  /** Username when someone ELSE holds the advisory edit lock. */
  lockedBy: string | null;
  canReorder: boolean;
  /** Absolute position (windowed mode) or undefined (normal flow). */
  virtualTop: number | undefined;
  editing: boolean;
  onStartEdit: () => void;
  onCommitEdit: (label: string) => void;
  onClick: (e: MouseEvent) => void;
  onContextMenuCapture: () => void;
}

function DrawableRow({
  drawable,
  derivedId,
  groupColor,
  groupName,
  isDuplicate,
  selected,
  previewed,
  lockedBy,
  canReorder,
  virtualTop,
  editing,
  onStartEdit,
  onCommitEdit,
  onClick,
  onContextMenuCapture,
}: RowProps) {
  const { t } = useTranslation("workbench");
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: drawable.id, disabled: !canReorder });

  const [draft, setDraft] = useState(drawable.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(drawable.label);
      inputRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const style: CSSProperties = {
    transform: transformStyle(transform),
    transition,
    height: ROW_HEIGHT,
    ...(virtualTop !== undefined
      ? { position: "absolute", top: virtualTop, left: 0, right: 0 }
      : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-drawable-id={drawable.id}
      onClick={onClick}
      onContextMenu={onContextMenuCapture}
      className={cn(
        "flex cursor-default items-center gap-2 border-b border-white/5 px-2 text-sm transition-colors",
        selected
          ? "bg-[#5865F2]/15 hover:bg-[#5865F2]/20"
          : "hover:bg-white/5",
        isDragging && "z-10 opacity-70",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        tabIndex={-1}
        className={cn(
          "flex h-6 w-5 shrink-0 items-center justify-center rounded text-white/25",
          canReorder
            ? "cursor-grab hover:text-white/60 active:cursor-grabbing"
            : "cursor-default opacity-30",
        )}
        title={
          canReorder
            ? t("drawableList.dragToSort")
            : t("drawableList.sortOnlyInCategory")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <span className="w-9 shrink-0 font-mono text-xs text-[#7289DA]">
        {String(derivedId).padStart(3, "0")}
      </span>

      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommitEdit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitEdit(draft);
            if (e.key === "Escape") onCommitEdit(drawable.label);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-7 flex-1 border-white/15 bg-white/5 text-sm text-white"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-white/85"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
          title={drawable.label}
        >
          {drawable.label || t("drawableList.noName")}
        </span>
      )}

      {previewed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Eye className="h-3.5 w-3.5 shrink-0 text-[#7289DA]" />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("drawableList.renderedInPreview")}
          </TooltipContent>
        </Tooltip>
      )}

      {lockedBy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex max-w-28 shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
              <Lock className="h-3 w-3 shrink-0" />
              <span className="truncate">{lockedBy}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("drawableList.lockedBy", { name: lockedBy })}
          </TooltipContent>
        </Tooltip>
      )}

      <Badge
        variant="outline"
        className={cn(
          "h-5 shrink-0 px-1.5 text-[10px]",
          drawable.mode === "addon"
            ? "border-[#5865F2]/40 text-[#7289DA]"
            : "border-amber-500/40 text-amber-300",
        )}
      >
        {drawable.mode === "addon"
          ? t("drawableList.addon")
          : t("drawableList.replace", {
              id: drawable.replaceTargetId ?? "?",
            })}
      </Badge>

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px]",
              drawable.textures.length > 0
                ? "bg-white/10 text-white/60"
                : "bg-amber-500/15 text-amber-300",
            )}
          >
            {textureChipLabel(drawable.textures.length)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("drawableList.textureVariants", {
            count: drawable.textures.length,
          })}
        </TooltipContent>
      </Tooltip>

      {isDuplicate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              DUP
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t("drawableList.duplicateTooltip")}
          </TooltipContent>
        </Tooltip>
      )}

      {groupColor ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: groupColor }}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">{groupName}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="h-2.5 w-2.5 shrink-0" />
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation("workbench");
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="glass-border-subtle flex h-14 w-14 items-center justify-center rounded-[10px]">
        <Shirt className="h-6 w-6 text-white/30" />
      </div>
      <p className="mt-4 text-sm font-medium text-white/60">
        {t("drawableList.emptyTitle")}
      </p>
      <p className="mt-1 max-w-64 text-xs text-white/35">
        {t("drawableList.emptyDescription")}
      </p>
      <Button size="sm" variant="outline" className="mt-4" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        {t("drawableList.addDrawable")}
      </Button>
    </div>
  );
}

export function DrawableList() {
  const { t } = useTranslation("workbench");
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);
  const setSelection = useProjectStore((s) => s.setSelection);
  const addDrawable = useProjectStore((s) => s.addDrawable);
  const updateDrawable = useProjectStore((s) => s.updateDrawable);
  const removeDrawables = useProjectStore((s) => s.removeDrawables);
  const reorderDrawable = useProjectStore((s) => s.reorderDrawable);
  const assignGroup = useProjectStore((s) => s.assignGroup);

  const viewGender = useWorkbenchStore((s) => s.viewGender);
  const category = useWorkbenchStore((s) => s.category);
  const search = useWorkbenchStore((s) => s.search);
  const setSearch = useWorkbenchStore((s) => s.setSearch);
  const scrollTarget = useWorkbenchStore((s) => s.scrollTarget);
  const requestScrollTo = useWorkbenchStore((s) => s.requestScrollTo);
  const previewOpen = useWorkbenchStore((s) => s.previewOpen);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // ---------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------

  const filtered = useMemo(() => {
    if (!project) return [];
    const query = search.trim().toLowerCase();
    return project.drawables.filter((d) => {
      if (d.gender !== viewGender) return false;
      if (category !== "all" && d.type !== category) return false;
      if (query && !d.label.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [project, viewGender, category, search]);

  const derivedIds = useMemo(
    () => (project ? selectDerivedDrawableIds(project) : {}),
    [project],
  );
  const duplicateMap = useMemo(
    () => (project ? selectDuplicateYddMap(project) : {}),
    [project],
  );
  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(duplicateMap)) {
      for (const id of list) ids.add(id);
    }
    return ids;
  }, [duplicateMap]);

  const groupsById = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const g of project?.groups ?? []) {
      map.set(g.id, { name: g.name, color: g.color });
    }
    return map;
  }, [project]);

  /** Drawables the open 3D preview renders ("Auge" row indicator). */
  const previewedIds = useMemo(() => {
    if (!previewOpen) return new Set<string>();
    const { rendered } = selectPreviewedDrawables(project, selection);
    return new Set(rendered.map((d) => d.id));
  }, [previewOpen, project, selection]);

  /** Advisory edit locks (collab) — chips only for OTHER users' locks. */
  const locks = useCollabStore((s) => s.locks);
  const selfDiscordId = useAuthStore((s) => s.user?.discordId);

  // Warm the GLB cache for what the user is looking at, before selection.
  useGlbPrefetch(filtered);

  /** Reorder is only meaningful when the visible list IS one bucket. */
  const canReorder = category !== "all" && search.trim() === "";

  // ---------------------------------------------------------------------
  // Windowing (fixed row height; only for long lists)
  // ---------------------------------------------------------------------

  const virtualize = filtered.length > VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const range = useMemo(() => {
    if (!virtualize) return { start: 0, end: filtered.length };
    const start = Math.max(
      0,
      Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
    );
    const end = Math.min(
      filtered.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    return { start, end };
  }, [virtualize, filtered.length, scrollTop, viewportHeight]);

  // Jump-to from the duplicates dialog: rows have a constant height in both
  // render paths, so a uniform scrollTo works.
  useEffect(() => {
    if (!scrollTarget) return;
    const index = filtered.findIndex((d) => d.id === scrollTarget);
    if (index === -1) return;
    scrollRef.current?.scrollTo({
      top: Math.max(0, index * ROW_HEIGHT - viewportHeight / 2),
      behavior: "smooth",
    });
    requestScrollTo(null);
  }, [scrollTarget, filtered, viewportHeight, requestScrollTo]);

  // ---------------------------------------------------------------------
  // Selection + actions
  // ---------------------------------------------------------------------

  const handleRowClick = useCallback(
    (e: MouseEvent, id: string, index: number) => {
      if (e.shiftKey && anchorIndex !== null) {
        const from = Math.min(anchorIndex, index);
        const to = Math.max(anchorIndex, index);
        setSelection(filtered.slice(from, to + 1).map((d) => d.id));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setSelection(
          selection.includes(id)
            ? selection.filter((s) => s !== id)
            : [...selection, id],
        );
        setAnchorIndex(index);
        return;
      }
      setSelection([id]);
      setAnchorIndex(index);
    },
    [anchorIndex, filtered, selection, setSelection],
  );

  const ensureInSelection = useCallback(
    (id: string) => {
      if (!selection.includes(id)) setSelection([id]);
    },
    [selection, setSelection],
  );

  const selectedDrawables = useMemo(
    () =>
      (project?.drawables ?? []).filter((d) => selection.includes(d.id)),
    [project, selection],
  );

  const duplicateSelection = useCallback(() => {
    for (const d of selectedDrawables) {
      addDrawable({
        ...d,
        id: crypto.randomUUID(),
        label: `${d.label} ${t("drawableList.copySuffix")}`,
        textures: [...d.textures],
        flags: { ...d.flags },
      });
    }
  }, [selectedDrawables, addDrawable]);

  const moveSelectionToGender = useCallback(
    (gender: Gender) => {
      for (const d of selectedDrawables) {
        if (d.gender !== gender) updateDrawable(d.id, { gender });
      }
    },
    [selectedDrawables, updateDrawable],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const toIndex = filtered.findIndex((d) => d.id === over.id);
      if (toIndex === -1) return;
      // canReorder guarantees filtered == the (gender, type) bucket, so the
      // visible index is the bucket index the store expects.
      reorderDrawable(String(active.id), toIndex);
    },
    [filtered, reorderDrawable],
  );

  const slotLabel =
    category === "all"
      ? t("categoryTree.all")
      : getSlotById(category)
        ? t(`slot.${category}`)
        : category;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const rows = filtered.slice(range.start, range.end).map((drawable, i) => {
    const index = range.start + i;
    const group = drawable.groupId
      ? (groupsById.get(drawable.groupId) ?? null)
      : null;
    const lock = locks[drawable.id];
    return (
      <DrawableRow
        key={drawable.id}
        drawable={drawable}
        index={index}
        derivedId={derivedIds[drawable.id] ?? 0}
        groupColor={group?.color ?? null}
        groupName={group?.name ?? null}
        isDuplicate={duplicateIds.has(drawable.id)}
        selected={selection.includes(drawable.id)}
        previewed={previewedIds.has(drawable.id)}
        lockedBy={
          lock && lock.lockedByDiscordId !== selfDiscordId
            ? lock.username
            : null
        }
        canReorder={canReorder}
        virtualTop={virtualize ? index * ROW_HEIGHT : undefined}
        editing={editingId === drawable.id}
        onStartEdit={() => setEditingId(drawable.id)}
        onCommitEdit={(label) => {
          const trimmed = label.trim();
          if (trimmed && trimmed !== drawable.label) {
            updateDrawable(drawable.id, { label: trimmed });
          }
          setEditingId(null);
        }}
        onClick={(e) => handleRowClick(e, drawable.id, index)}
        onContextMenuCapture={() => ensureInSelection(drawable.id)}
      />
    );
  });

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar: search + add */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/8 px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          {slotLabel}
        </span>
        <span className="font-mono text-[10px] text-white/30">
          {filtered.length}
        </span>
        <div className="relative ml-auto w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("drawableList.searchPlaceholder")}
            className="h-7 border-white/10 bg-white/5 pl-8 text-xs text-white"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          onClick={() => void pickAndImportFiles()}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("drawableList.addDrawable")}
        </Button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState onAdd={() => void pickAndImportFiles()} />
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={scrollRef}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filtered.map((d) => d.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {virtualize ? (
                    <div
                      className="relative"
                      style={{ height: filtered.length * ROW_HEIGHT }}
                    >
                      {rows}
                    </div>
                  ) : (
                    rows
                  )}
                </SortableContext>
              </DndContext>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuItem
              disabled={selection.length === 0}
              onClick={duplicateSelection}
            >
              <Copy className="h-4 w-4" />
              {t("drawableList.duplicate")}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={selection.length === 0}>
                <Users className="mr-2 h-4 w-4" />
                {t("drawableList.assignGroup")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                {(project?.groups ?? []).map((g) => (
                  <ContextMenuItem
                    key={g.id}
                    onClick={() => assignGroup(selection, g.id)}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: g.color }}
                    />
                    {g.name}
                  </ContextMenuItem>
                ))}
                <ContextMenuItem onClick={() => assignGroup(selection, null)}>
                  {t("drawableList.noGroup")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => setGroupDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t("drawableList.newGroup")}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={selection.length === 0}>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                {t("drawableList.changeGender")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-40">
                <ContextMenuItem onClick={() => moveSelectionToGender("male")}>
                  {t("drawableList.toMale")}
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => moveSelectionToGender("female")}
                >
                  {t("drawableList.toFemale")}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={selection.length === 0}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              {t("drawableList.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}

      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={selection.length}
        onConfirm={() => removeDrawables(selection)}
      />
      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        onCreated={(groupId) => assignGroup(selection, groupId)}
      />
    </div>
  );
}
