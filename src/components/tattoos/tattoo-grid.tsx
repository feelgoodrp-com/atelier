/**
 * Center column of the tattoos screen: a toolbar (search + import) and a grid of
 * tattoo cards filtered by the active zone + search. Import copies images into
 * assets/tattoos/ and appends ProjectTattoo entries (works without a GTA path).
 *
 * The right-click menu wraps the whole grid container (a real DOM <div>, like
 * the clothing drawable-list) and acts on the grid selection — each card ensures
 * itself into the selection on context-menu capture before the menu opens.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  Copy,
  ImagePlus,
  MapPin,
  Search,
  Stamp,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
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
  TATTOO_ZONES,
  type TattooGenderId,
  type TattooZoneId,
} from "@/lib/gta/tattoos";
import { createTattoo } from "@/lib/project/schema";
import { pickAndImportTattoos } from "@/lib/project/import-tattoos";
import { useProjectStore } from "@/lib/stores/project-store";
import { useTattooWorkbenchStore } from "@/lib/stores/tattoo-workbench-store";
import { TattooCard } from "./tattoo-card";

export function TattooGrid() {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project);
  const addTattoo = useProjectStore((s) => s.addTattoo);
  const updateTattoo = useProjectStore((s) => s.updateTattoo);
  const removeTattoos = useProjectStore((s) => s.removeTattoos);
  const assignTattooGroup = useProjectStore((s) => s.assignTattooGroup);
  const projectDir = useProjectStore((s) => s.projectDir);

  const zoneFilter = useTattooWorkbenchStore((s) => s.zoneFilter);
  const search = useTattooWorkbenchStore((s) => s.search);
  const setSearch = useTattooWorkbenchStore((s) => s.setSearch);
  const selection = useTattooWorkbenchStore((s) => s.selection);
  const setSelection = useTattooWorkbenchStore((s) => s.setSelection);
  const toggleSelection = useTattooWorkbenchStore((s) => s.toggleSelection);
  const importing = useTattooWorkbenchStore((s) => s.importing);
  const setImporting = useTattooWorkbenchStore((s) => s.setImporting);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (project?.tattoos ?? []).filter((tat) => {
      if (zoneFilter !== "all" && tat.zone !== zoneFilter) return false;
      if (q && !tat.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [project, zoneFilter, search]);

  // Right-click on a card that isn't selected → select just it, so the menu
  // targets the clicked card; a card inside a multi-selection keeps the set.
  const ensureInSelection = (id: string) => {
    const sel = useTattooWorkbenchStore.getState().selection;
    if (!sel.includes(id)) setSelection([id]);
  };

  const duplicate = () => {
    const byId = new Map((project?.tattoos ?? []).map((tt) => [tt.id, tt]));
    const copies: string[] = [];
    for (const id of selection) {
      const src = byId.get(id);
      if (!src) continue;
      const copy = createTattoo({
        label: `${src.label} ${t("context.copySuffix")}`.trim(),
        zone: src.zone,
        gender: src.gender,
        type: src.type,
        garment: src.garment,
        textLabel: src.textLabel,
        eFacing: src.eFacing,
        cost: src.cost,
        image: src.image,
        // names left null → re-derived to fresh unique overlay names.
      });
      addTattoo(copy);
      copies.push(copy.id);
    }
    if (copies.length > 0) setSelection(copies);
  };
  const setZone = (zone: TattooZoneId) =>
    selection.forEach((id) => updateTattoo(id, { zone }));
  const setGender = (gender: TattooGenderId) =>
    selection.forEach((id) => updateTattoo(id, { gender }));
  const assign = (groupId: string | null) => assignTattooGroup(selection, groupId);
  const remove = () => {
    removeTattoos(selection);
    setSelection([]);
  };

  const onImport = async () => {
    if (!projectDir || importing) return;
    setImporting(true);
    try {
      const result = await pickAndImportTattoos(projectDir, {
        zone: zoneFilter === "all" ? "torso" : zoneFilter,
        gender: "both",
      });
      if (!result) return;
      const ids: string[] = [];
      for (const tat of result.tattoos) {
        addTattoo(tat);
        ids.push(tat.id);
      }
      if (ids.length > 0) setSelection(ids);
      if (result.skipped.length > 0) {
        toast.warning(t("import.partial", { ok: result.tattoos.length, skipped: result.skipped.length }));
      } else if (ids.length > 0) {
        toast.success(t("import.done", { count: ids.length }));
      }
    } catch (e) {
      toast.error(t("import.failed"), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setImporting(false);
    }
  };

  const noSel = selection.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/8 px-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("grid.searchPlaceholder")}
            className="h-7 border-white/10 bg-white/5 pl-8 text-xs text-white"
          />
        </div>
        <Button size="sm" className="h-7" disabled={!projectDir || importing} onClick={() => void onImport()}>
          <ImagePlus className="h-3.5 w-3.5" />
          {importing ? t("import.running") : t("grid.import")}
        </Button>
      </div>

      {/* Grid — context menu wraps a plain overflow-y-auto div (NOT a Radix
          ScrollArea), matching the working clothing drawable-list: a Radix
          ScrollArea viewport as the trigger swallowed the contextmenu event, so
          the native webview menu showed instead. */}
      {visible.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
            <div className="glass-border-subtle flex h-12 w-12 items-center justify-center rounded-[10px]">
              <Stamp className="h-5 w-5 text-white/30" />
            </div>
            <p className="mt-3 text-sm font-medium text-white/60">
              {project && project.tattoos.length > 0 ? t("grid.noMatches") : t("grid.empty")}
            </p>
            <p className="mt-1 max-w-64 text-xs text-white/35">{t("grid.emptyHint")}</p>
          </div>
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div
                className="grid gap-2 p-3 grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSelection([]);
                }}
              >
                {visible.map((tat) => (
                  <TattooCard
                    key={tat.id}
                    tattoo={tat}
                    selected={selection.includes(tat.id)}
                    onSelect={(additive) => toggleSelection(tat.id, additive)}
                    onContextMenuCapture={() => ensureInSelection(tat.id)}
                  />
                ))}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
              <ContextMenuItem disabled={noSel} onClick={duplicate}>
                <Copy className="h-4 w-4" />
                {t("context.duplicate")}
              </ContextMenuItem>

              <ContextMenuSub>
                <ContextMenuSubTrigger disabled={noSel}>
                  <MapPin className="mr-2 h-4 w-4" />
                  {t("context.setZone")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-44">
                  {TATTOO_ZONES.map((z) => (
                    <ContextMenuItem key={z.id} onClick={() => setZone(z.id)}>
                      {z.label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>

              <ContextMenuSub>
                <ContextMenuSubTrigger disabled={noSel}>
                  <ArrowLeftRight className="mr-2 h-4 w-4" />
                  {t("context.setGender")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-40">
                  <ContextMenuItem onClick={() => setGender("both")}>
                    {t("gender.both")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setGender("male")}>
                    {t("gender.male")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setGender("female")}>
                    {t("gender.female")}
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>

              {(project?.groups.length ?? 0) > 0 && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={noSel}>
                    <Users className="mr-2 h-4 w-4" />
                    {t("context.assignGroup")}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-48">
                    {(project?.groups ?? []).map((g) => (
                      <ContextMenuItem key={g.id} onClick={() => assign(g.id)}>
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: g.color }}
                        />
                        {g.name}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuItem onClick={() => assign(null)}>
                      {t("context.noGroup")}
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}

              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={noSel} onClick={remove}>
                <Trash2 className="h-4 w-4" />
                {t("context.delete")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
      )}
    </div>
  );
}
