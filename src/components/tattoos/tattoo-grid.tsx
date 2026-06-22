/**
 * Center column of the tattoos screen: a toolbar (search + import) and a grid of
 * tattoo cards filtered by the active zone + search. Import copies images into
 * assets/tattoos/ and appends ProjectTattoo entries (works without a GTA path).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Search, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { pickAndImportTattoos } from "@/lib/project/import-tattoos";
import { useProjectStore } from "@/lib/stores/project-store";
import { useTattooWorkbenchStore } from "@/lib/stores/tattoo-workbench-store";
import { TattooCard } from "./tattoo-card";

export function TattooGrid() {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project);
  const addTattoo = useProjectStore((s) => s.addTattoo);
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

      {/* Grid */}
      <ScrollArea className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
            <div className="glass-border-subtle flex h-12 w-12 items-center justify-center rounded-[10px]">
              <Stamp className="h-5 w-5 text-white/30" />
            </div>
            <p className="mt-3 text-sm font-medium text-white/60">
              {project && project.tattoos.length > 0 ? t("grid.noMatches") : t("grid.empty")}
            </p>
            <p className="mt-1 max-w-64 text-xs text-white/35">{t("grid.emptyHint")}</p>
          </div>
        ) : (
          <div
            className={cn(
              "grid gap-2 p-3",
              "grid-cols-[repeat(auto-fill,minmax(120px,1fr))]",
            )}
            onClick={(e) => {
              // Click on empty grid space clears the selection.
              if (e.target === e.currentTarget) setSelection([]);
            }}
          >
            {visible.map((tat) => (
              <TattooCard
                key={tat.id}
                tattoo={tat}
                selected={selection.includes(tat.id)}
                onSelect={(additive) => toggleSelection(tat.id, additive)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
