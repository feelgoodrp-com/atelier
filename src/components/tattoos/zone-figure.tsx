/**
 * Abstract front-view body figure with the six authorable tattoo zones. Used as
 * a zone picker in the inspector and as a visual aid in the empty/preview state.
 * Tattoos are fixed-UV decals, so this is a ZONE indicator — not a placement
 * canvas. Shapes are deliberately simple (head/torso/arms/legs).
 */

import { cn } from "@/lib/utils";
import { TATTOO_ZONES, type TattooZoneId } from "@/lib/gta/tattoos";

/** SVG geometry per zone (viewBox 0 0 120 200). */
const ZONE_SHAPES: Record<TattooZoneId, { x: number; y: number; w: number; h: number; rx: number }> = {
  head: { x: 46, y: 8, w: 28, h: 30, rx: 13 },
  torso: { x: 40, y: 44, w: 40, h: 60, rx: 8 },
  left_arm: { x: 22, y: 46, w: 13, h: 54, rx: 6 },
  right_arm: { x: 85, y: 46, w: 13, h: 54, rx: 6 },
  left_leg: { x: 42, y: 108, w: 16, h: 70, rx: 6 },
  right_leg: { x: 62, y: 108, w: 16, h: 70, rx: 6 },
};

export function ZoneFigure({
  activeZone,
  onSelectZone,
  className,
}: {
  activeZone: TattooZoneId | null;
  onSelectZone?: (zone: TattooZoneId) => void;
  className?: string;
}) {
  const interactive = Boolean(onSelectZone);
  return (
    <svg
      viewBox="0 0 120 200"
      className={cn("h-full w-full", className)}
      role={interactive ? "group" : "img"}
      aria-label="Tattoo-Zonen"
    >
      {TATTOO_ZONES.map((zone) => {
        const s = ZONE_SHAPES[zone.id];
        const active = activeZone === zone.id;
        return (
          <rect
            key={zone.id}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx={s.rx}
            onClick={onSelectZone ? () => onSelectZone(zone.id) : undefined}
            className={cn(
              "transition-colors",
              interactive && "cursor-pointer",
              active
                ? "fill-[#5865F2]/40 stroke-[#7289DA]"
                : "fill-white/5 stroke-white/15 hover:fill-white/10",
            )}
            strokeWidth={1.5}
          >
            <title>{zone.label}</title>
          </rect>
        );
      })}
    </svg>
  );
}
