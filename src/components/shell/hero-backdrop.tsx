/**
 * Shared hero backdrop: looping video + a darkening gradient veil + the subtle
 * Feelgood grid. Used by the login gate and the launcher/settings screens (NOT
 * the workbench, which keeps a plain grid so the 3D preview stays distraction
 * free). Renders three absolute z-0 layers — the host must be `relative` and
 * place its content at z-10+.
 *
 * `strong` darkens the veil for content-heavy screens (launcher/settings) so
 * cards and text stay readable; the login gate uses the lighter default.
 */

import heroVideo from "@/assets/hero-desktop.webm";
import { cn } from "@/lib/utils";

export function HeroBackdrop({ strong = false }: { strong?: boolean }) {
  return (
    <>
      <video
        className="absolute inset-0 z-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      >
        <source src={heroVideo} type="video/webm" />
      </video>
      <div
        className={cn(
          "absolute inset-0 z-0 bg-gradient-to-b",
          strong
            ? "from-[#0b0b0b]/90 via-[#0b0b0b]/84 to-[#0b0b0b]/95"
            : "from-[#0b0b0b]/75 via-[#0b0b0b]/55 to-[#0b0b0b]/92",
        )}
        aria-hidden="true"
      />
      <div className="grid-background absolute inset-0 z-0 opacity-50" aria-hidden="true" />
    </>
  );
}
