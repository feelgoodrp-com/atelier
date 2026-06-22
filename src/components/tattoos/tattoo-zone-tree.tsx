/**
 * Left panel of the tattoos screen: the six body zones plus an "Alle" pseudo
 * filter, each with a live count. Mirrors the clothing category-tree, but tattoo
 * zones are flat (no component/prop split).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  MoveDownLeft,
  MoveDownRight,
  ScanFace,
  Shirt,
  type LucideIcon,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { TATTOO_ZONES } from "@/lib/gta/tattoos";
import { useProjectStore } from "@/lib/stores/project-store";
import {
  useTattooWorkbenchStore,
  type TattooZoneFilter,
} from "@/lib/stores/tattoo-workbench-store";

const ZONE_ICONS: Record<string, LucideIcon> = {
  Shirt,
  ScanFace,
  ArrowLeft,
  ArrowRight,
  MoveDownLeft,
  MoveDownRight,
};

function Row({
  icon: Icon,
  label,
  count,
  active,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-[#5865F2]/20 text-white"
          : "text-white/70 hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[#7289DA]" : "text-white/45")} />
      <span className="flex-1 truncate">{label}</span>
      <span
        className={cn(
          "min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px]",
          count > 0 ? "bg-white/10 text-white/60" : "text-white/25",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function TattooZoneTree() {
  const { t } = useTranslation("tattoos");
  const project = useProjectStore((s) => s.project);
  const zoneFilter = useTattooWorkbenchStore((s) => s.zoneFilter);
  const setZoneFilter = useTattooWorkbenchStore((s) => s.setZoneFilter);

  const { countByZone, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tat of project?.tattoos ?? []) {
      counts.set(tat.zone, (counts.get(tat.zone) ?? 0) + 1);
    }
    return { countByZone: counts, total: project?.tattoos.length ?? 0 };
  }, [project]);

  const select = (zone: TattooZoneFilter) => setZoneFilter(zone);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-white/8 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          {t("zoneTree.title")}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          <Row
            icon={LayoutGrid}
            label={t("zoneTree.all")}
            count={total}
            active={zoneFilter === "all"}
            onSelect={() => select("all")}
          />
          {TATTOO_ZONES.map((zone) => (
            <Row
              key={zone.id}
              icon={ZONE_ICONS[zone.icon] ?? Shirt}
              label={zone.label}
              count={countByZone.get(zone.id) ?? 0}
              active={zoneFilter === zone.id}
              onSelect={() => select(zone.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
