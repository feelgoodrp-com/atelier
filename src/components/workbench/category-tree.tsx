import { useMemo, useState } from "react";
import {
  Anchor,
  Backpack,
  ChevronRight,
  Ear,
  Footprints,
  Gem,
  Glasses,
  HardHat,
  Layers,
  LayoutGrid,
  Link,
  PersonStanding,
  RectangleVertical,
  ScanFace,
  Scissors,
  Shield,
  Shirt,
  Sticker,
  TriangleAlert,
  VenetianMask,
  Watch,
  type LucideIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GTA_COMPONENTS, GTA_PROPS, type GtaSlot } from "@/lib/gta/components";
import { useProjectStore } from "@/lib/stores/project-store";
import {
  useWorkbenchStore,
  type CategoryId,
} from "@/lib/stores/workbench-store";

/** Maps the icon names from lib/gta/components.ts to lucide components. */
const SLOT_ICONS: Record<string, LucideIcon> = {
  ScanFace,
  VenetianMask,
  Scissors,
  PersonStanding,
  RectangleVertical,
  Backpack,
  Footprints,
  Link,
  Shirt,
  Shield,
  Sticker,
  Layers,
  HardHat,
  Glasses,
  Ear,
  Watch,
  Gem,
  Anchor,
};

interface CategoryStats {
  count: number;
  /** Placeholder warning counter: drawables without ydd or without textures. */
  warnings: number;
}

function CategoryRow({
  slot,
  stats,
  active,
  onSelect,
}: {
  slot: GtaSlot;
  stats: CategoryStats;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = SLOT_ICONS[slot.icon] ?? Shirt;
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
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-[#7289DA]" : "text-white/45",
        )}
      />
      <span className="flex-1 truncate">{slot.label}</span>
      {stats.warnings > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
              <TriangleAlert className="h-2.5 w-2.5" />
              {stats.warnings}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {stats.warnings} Drawable(s) ohne Mesh oder Texturen
          </TooltipContent>
        </Tooltip>
      )}
      <span
        className={cn(
          "min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px]",
          stats.count > 0 ? "bg-white/10 text-white/60" : "text-white/25",
        )}
      >
        {stats.count}
      </span>
    </button>
  );
}

function Section({
  title,
  slots,
  statsBySlot,
  category,
  onSelect,
}: {
  title: string;
  slots: GtaSlot[];
  statsBySlot: Map<string, CategoryStats>;
  category: CategoryId;
  onSelect: (id: CategoryId) => void;
}) {
  const [open, setOpen] = useState(true);
  const total = slots.reduce(
    (sum, slot) => sum + (statsBySlot.get(slot.id)?.count ?? 0),
    0,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35 transition-colors hover:text-white/60"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="flex-1 text-left">{title}</span>
          <span className="font-mono text-white/25">{total}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 pb-1">
          {slots.map((slot) => (
            <CategoryRow
              key={slot.id}
              slot={slot}
              stats={statsBySlot.get(slot.id) ?? { count: 0, warnings: 0 }}
              active={category === slot.id}
              onSelect={() => onSelect(slot.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CategoryTree() {
  const project = useProjectStore((s) => s.project);
  const viewGender = useWorkbenchStore((s) => s.viewGender);
  const category = useWorkbenchStore((s) => s.category);
  const setCategory = useWorkbenchStore((s) => s.setCategory);

  // Live counts + warning badge per slot for the active gender.
  const { statsBySlot, totalCount, totalWarnings } = useMemo(() => {
    const stats = new Map<string, CategoryStats>();
    let total = 0;
    let warnings = 0;
    for (const d of project?.drawables ?? []) {
      if (d.gender !== viewGender) continue;
      const entry = stats.get(d.type) ?? { count: 0, warnings: 0 };
      entry.count++;
      total++;
      if (!d.ydd || d.textures.length === 0) {
        entry.warnings++;
        warnings++;
      }
      stats.set(d.type, entry);
    }
    return { statsBySlot: stats, totalCount: total, totalWarnings: warnings };
  }, [project, viewGender]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/8 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          Kategorien
        </span>
        <span className="font-mono text-[10px] text-white/30">
          {viewGender === "male" ? "mp_m" : "mp_f"}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {/* "Alle" pseudo-category */}
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cn(
              "mb-1 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left text-sm transition-colors",
              category === "all"
                ? "bg-[#5865F2]/20 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            <LayoutGrid
              className={cn(
                "h-4 w-4 shrink-0",
                category === "all" ? "text-[#7289DA]" : "text-white/45",
              )}
            />
            <span className="flex-1">Alle</span>
            {totalWarnings > 0 && (
              <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                <TriangleAlert className="h-2.5 w-2.5" />
                {totalWarnings}
              </span>
            )}
            <span
              className={cn(
                "min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px]",
                totalCount > 0 ? "bg-white/10 text-white/60" : "text-white/25",
              )}
            >
              {totalCount}
            </span>
          </button>

          <Section
            title="Components"
            slots={GTA_COMPONENTS}
            statsBySlot={statsBySlot}
            category={category}
            onSelect={setCategory}
          />
          <Section
            title="Props"
            slots={GTA_PROPS}
            statsBySlot={statsBySlot}
            category={category}
            onSelect={setCategory}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
