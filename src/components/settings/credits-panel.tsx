/**
 * Credits sidebar for the settings screen — thanks to the people atelier
 * stands on the shoulders of, mirroring the "Mentions" section of
 * grzyClothTool's README (grzybeek, dexyfex/CodeWalker, JagodaMods, ook).
 * atelier reimplements grzyClothTool (GPL-3.0; no code reused) and links
 * dexyfex's CodeWalker.Core, so crediting + linking their Patreon/Ko-fi/
 * GitHub/Discord is the least we can do.
 */

import { Trans, useTranslation } from "react-i18next";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { Heart } from "lucide-react";
import { PatreonMark, KofiMark, DiscordMark } from "@/components/shell/credits";
import { cn } from "@/lib/utils";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.04 1.53 1.04.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z" />
    </svg>
  );
}

type LinkKind = "patreon" | "kofi" | "github" | "discord";

interface CreditLink {
  kind: LinkKind;
  url: string;
}

interface Person {
  name: string;
  /** i18n key (settings:credits.roles.*) for the one-line contribution note. */
  roleKey: string;
  links: CreditLink[];
}

/**
 * Mirrors grzyClothTool's README: grzybeek (the tool atelier reimplements),
 * dexyfex (CodeWalker — the 3D engine), and his mentions JagodaMods + ook.
 */
const PEOPLE: Person[] = [
  {
    name: "grzybeek",
    roleKey: "credits.roles.grzybeek",
    links: [
      { kind: "patreon", url: "https://patreon.com/grzybeek" },
      { kind: "kofi", url: "https://ko-fi.com/grzybeek" },
      { kind: "github", url: "https://github.com/grzybeek/grzyClothTool" },
      { kind: "discord", url: "https://discord.gg/HCQutNhxWt" },
    ],
  },
  {
    name: "dexyfex",
    roleKey: "credits.roles.dexyfex",
    links: [
      { kind: "patreon", url: "https://www.patreon.com/dexyfex" },
      { kind: "github", url: "https://github.com/dexyfex/CodeWalker" },
    ],
  },
  {
    name: "JagodaMods",
    roleKey: "credits.roles.jagodaMods",
    links: [{ kind: "discord", url: "https://discord.com/invite/JagodaMods" }],
  },
  {
    name: "ook",
    roleKey: "credits.roles.ook",
    links: [{ kind: "github", url: "https://github.com/ook3d" }],
  },
];

/** feelgood's own community Discord — distinct from the third-party credits above. */
const FEELGOOD_DISCORD_URL = "https://discord.gg/Y8kkKyShZx";

const LINK_META: Record<
  LinkKind,
  { label: string; hover: string; icon: (c: string) => React.ReactNode }
> = {
  patreon: {
    label: "Patreon",
    hover: "hover:text-[#FF424D] hover:border-[#FF424D]/40",
    icon: (c) => <PatreonMark className={c} />,
  },
  kofi: {
    label: "Ko-fi",
    hover: "hover:text-[#FF5E5B] hover:border-[#FF5E5B]/40",
    icon: (c) => <KofiMark className={c} />,
  },
  github: {
    label: "GitHub",
    hover: "hover:text-white hover:border-white/40",
    icon: (c) => <GitHubMark className={c} />,
  },
  discord: {
    label: "Discord",
    hover: "hover:text-[#7289DA] hover:border-[#5865F2]/40",
    icon: (c) => <DiscordMark className={c} />,
  },
};

function LinkChip({ kind, url }: CreditLink) {
  const { t } = useTranslation("settings");
  const meta = LINK_META[kind];
  return (
    <button
      type="button"
      onClick={() => void openInBrowser(url).catch(() => {})}
      title={`${meta.label} · ${url}`}
      aria-label={t("credits.openLink", { label: meta.label })}
      className={cn(
        "glass-border-subtle flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10",
        meta.hover,
      )}
    >
      {meta.icon("h-3.5 w-3.5")}
    </button>
  );
}

/**
 * Right-hand credits column on the settings screen. Static, no state — just
 * thanks + outbound support links.
 */
export function CreditsPanel({ className }: { className?: string }) {
  const { t } = useTranslation("settings");
  return (
    <div
      className={cn(
        "glass-border-subtle flex flex-col gap-4 rounded-[12px] bg-transparent p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-[#7289DA]" />
        <h2 className="text-sm font-semibold text-white">{t("credits.title")}</h2>
      </div>
      <p className="text-xs leading-relaxed text-white/45">
        <Trans
          t={t}
          i18nKey="credits.intro"
          components={{ hl: <span className="text-white/65" /> }}
        />
      </p>

      <div className="flex flex-col gap-3.5">
        {PEOPLE.map((person) => (
          <div key={person.name} className="flex flex-col gap-1.5">
            <div>
              <p className="text-sm font-medium text-white/85">{person.name}</p>
              <p className="text-xs text-white/40">{t(person.roleKey)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {person.links.map((link) => (
                <LinkChip key={link.kind} {...link} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void openInBrowser(FEELGOOD_DISCORD_URL).catch(() => {})}
        title={`Discord · ${FEELGOOD_DISCORD_URL}`}
        className="glass-border-subtle mt-0.5 flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-white/55 transition-colors hover:border-[#5865F2]/40 hover:bg-[#5865F2]/15 hover:text-[#7289DA]"
      >
        <DiscordMark className="h-3.5 w-3.5" />
        {t("credits.joinFeelgood")}
      </button>
    </div>
  );
}
