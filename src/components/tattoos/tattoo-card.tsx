/**
 * One tattoo tile in the grid: thumbnail + label + zone/gender badges. Click to
 * select (Ctrl/Shift adds to the selection). Missing-image tattoos get an amber
 * warning ring so the author sees they won't build.
 */

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getTattooZone, type TattooGenderId } from "@/lib/gta/tattoos";
import type { ProjectTattoo } from "@/lib/project/schema";
import { TattooThumb } from "./tattoo-thumb";

const GENDER_LABEL: Record<TattooGenderId, string> = {
  both: "M/W",
  male: "M",
  female: "W",
};

export function TattooCard({
  tattoo,
  selected,
  onSelect,
}: {
  tattoo: ProjectTattoo;
  selected: boolean;
  onSelect: (additive: boolean) => void;
}) {
  const { t } = useTranslation("tattoos");
  const zone = getTattooZone(tattoo.zone);
  return (
    <button
      type="button"
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
      className={cn(
        "group flex flex-col gap-1.5 rounded-[10px] border p-2 text-left transition-colors",
        selected
          ? "border-[#5865F2]/60 bg-[#5865F2]/15"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
      )}
    >
      <TattooThumb
        image={tattoo.image}
        className={cn(
          "aspect-square w-full",
          !tattoo.image && "ring-1 ring-amber-500/40",
        )}
      />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-white/85">
          {tattoo.label || t("card.untitled")}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
          <span className="truncate">{zone?.label ?? tattoo.zone}</span>
          <span className="text-white/20">·</span>
          <span className="font-mono">{GENDER_LABEL[tattoo.gender]}</span>
        </div>
      </div>
    </button>
  );
}
