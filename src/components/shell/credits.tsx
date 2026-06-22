/**
 * Credits for grzybeek — atelier is inspired by his open-source grzyClothTool
 * (https://github.com/grzybeek/grzyClothTool, GPL-3.0; reimplemented, no code
 * reused). Shown on the launcher and the login gate, linking to his
 * Patreon/Ko-fi. Brand marks as inline SVGs (not in lucide).
 */

import { useTranslation } from "react-i18next";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { cn } from "@/lib/utils";

const PATREON_URL = "https://patreon.com/grzybeek";
const KOFI_URL = "https://ko-fi.com/grzybeek";
/** feelgood's own community Discord — shown in the footer next to grzybeek's links. */
const FEELGOOD_DISCORD_URL = "https://discord.gg/Y8kkKyShZx";

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

export function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3c-.21.38-.46.9-.63 1.3a18.3 18.3 0 0 0-5.5 0C9.14 3.9 8.88 3.38 8.67 3a19.7 19.7 0 0 0-4.87 1.37C.7 8.97-.15 13.46.27 17.88a19.9 19.9 0 0 0 6 3.04c.49-.66.92-1.37 1.29-2.11-.71-.27-1.39-.6-2.03-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.06 0c.16.14.33.27.5.4-.64.39-1.32.72-2.03.99.37.74.8 1.45 1.29 2.11a19.9 19.9 0 0 0 6-3.04c.5-5.18-.84-9.63-3.52-13.51zM8.02 15.18c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.94-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41z" />
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
  const { t } = useTranslation("shell");
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-3", className)}>
      <span className="text-xs text-white/35">
        {t("credits.inspiredBy")}{" "}
        <span className="font-medium text-white/55">grzyClothTool</span>{" "}
        {t("credits.by")}{" "}
        <span className="font-medium text-white/55">grzybeek</span>{" "}
        {t("credits.supportHim")}
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
      <span className="h-3.5 w-px bg-white/15" aria-hidden="true" />
      <SupportLink
        label="feelgood Discord"
        url={FEELGOOD_DISCORD_URL}
        hoverClass="hover:text-[#7289DA]"
        icon={<DiscordMark className="h-4 w-4" />}
      />
    </div>
  );
}
