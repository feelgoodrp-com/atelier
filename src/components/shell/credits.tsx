/**
 * Credits for grzybeek — atelier is inspired by his open-source grzyClothTool
 * (https://github.com/grzybeek/grzyClothTool, GPL-3.0; reimplemented, no code
 * reused). Shown on the launcher and the login gate, linking to his
 * Patreon/Ko-fi. Brand marks as inline SVGs (not in lucide).
 */

import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { cn } from "@/lib/utils";

const PATREON_URL = "https://patreon.com/grzybeek";
const KOFI_URL = "https://ko-fi.com/grzybeek";

export function PatreonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="15" cy="9.5" r="7" />
      <rect x="2.5" y="2.5" width="4" height="19" rx="1" />
    </svg>
  );
}

export function KofiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17 8.5h1.5a3 3 0 0 1 0 6H17" />
      <path d="M3.5 8.5H17v6.5a4 4 0 0 1-4 4h-5.5a4 4 0 0 1-4-4Z" />
      <path
        d="M10.2 11.1c-.55-.65-1.65-.55-2 .18-.27.55 0 1.18.52 1.62l1.48 1.2 1.48-1.2c.52-.44.79-1.07.52-1.62-.35-.73-1.45-.83-2-.18Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function SupportLink({
  label,
  url,
  hoverClass,
  icon,
}: {
  label: string;
  url: string;
  hoverClass: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void openInBrowser(url).catch(() => {})}
      title={url}
      className={cn(
        "glass-border-subtle flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/55 transition-colors hover:bg-white/10",
        hoverClass,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function GrzybeekCredits({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      <span className="text-xs text-white/35">
        Inspiriert von{" "}
        <span className="font-medium text-white/55">grzyClothTool</span> von{" "}
        <span className="font-medium text-white/55">grzybeek</span> — unterstütze ihn:
      </span>
      <div className="flex items-center gap-2">
        <SupportLink
          label="Patreon"
          url={PATREON_URL}
          hoverClass="hover:text-[#FF424D]"
          icon={<PatreonMark className="h-3.5 w-3.5" />}
        />
        <SupportLink
          label="Ko-fi"
          url={KOFI_URL}
          hoverClass="hover:text-[#FF5E5B]"
          icon={<KofiMark className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}
