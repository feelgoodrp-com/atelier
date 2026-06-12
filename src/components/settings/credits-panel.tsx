/**
 * Credits sidebar for the settings screen — thanks to the people atelier
 * stands on the shoulders of, mirroring the "Mentions" section of
 * grzyClothTool's README (grzybeek, dexyfex/CodeWalker, JagodaMods, ook).
 * atelier reimplements grzyClothTool (GPL-3.0; no code reused) and links
 * dexyfex's CodeWalker.Core, so crediting + linking their Patreon/Ko-fi/
 * GitHub/Discord is the least we can do.
 */

import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { Heart } from "lucide-react";
import { PatreonMark, KofiMark } from "@/components/shell/credits";
import { cn } from "@/lib/utils";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.04 1.53 1.04.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z" />
    </svg>
  );
}

function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3c-.21.38-.46.9-.63 1.3a18.3 18.3 0 0 0-5.5 0C9.14 3.9 8.88 3.38 8.67 3a19.7 19.7 0 0 0-4.87 1.37C.7 8.97-.15 13.46.27 17.88a19.9 19.9 0 0 0 6 3.04c.49-.66.92-1.37 1.29-2.11-.71-.27-1.39-.6-2.03-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.06 0c.16.14.33.27.5.4-.64.39-1.32.72-2.03.99.37.74.8 1.45 1.29 2.11a19.9 19.9 0 0 0 6-3.04c.5-5.18-.84-9.63-3.52-13.51zM8.02 15.18c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.94-2.42 2.15-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.33-.95 2.41-2.16 2.41z" />
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
  /** One-line German note on what they contributed. */
  role: string;
  links: CreditLink[];
}

/**
 * Mirrors grzyClothTool's README: grzybeek (the tool atelier reimplements),
 * dexyfex (CodeWalker — the 3D engine), and his mentions JagodaMods + ook.
 */
const PEOPLE: Person[] = [
  {
    name: "grzybeek",
    role: "grzyClothTool — die Vorlage für atelier",
    links: [
      { kind: "patreon", url: "https://patreon.com/grzybeek" },
      { kind: "kofi", url: "https://ko-fi.com/grzybeek" },
      { kind: "github", url: "https://github.com/grzybeek/grzyClothTool" },
      { kind: "discord", url: "https://discord.gg/HCQutNhxWt" },
    ],
  },
  {
    name: "dexyfex",
    role: "CodeWalker — ohne ihn gäbe es keine 3D-Vorschau",
    links: [
      { kind: "patreon", url: "https://www.patreon.com/dexyfex" },
      { kind: "github", url: "https://github.com/dexyfex/CodeWalker" },
    ],
  },
  {
    name: "JagodaMods",
    role: "Ideen & Motivation",
    links: [{ kind: "discord", url: "https://discord.gg/jagoda" }],
  },
  {
    name: "ook",
    role: "Beiträge & Fixes",
    links: [{ kind: "github", url: "https://github.com/ook3d" }],
  },
];

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
  const meta = LINK_META[kind];
  return (
    <button
      type="button"
      onClick={() => void openInBrowser(url).catch(() => {})}
      title={`${meta.label} · ${url}`}
      aria-label={`${meta.label} öffnen`}
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
  return (
    <div
      className={cn(
        "glass-border-subtle flex flex-col gap-4 rounded-[12px] bg-transparent p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-[#7289DA]" />
        <h2 className="text-sm font-semibold text-white">Credits & Danke</h2>
      </div>
      <p className="text-xs leading-relaxed text-white/45">
        atelier ist ein eigenständiger Nachbau von{" "}
        <span className="text-white/65">grzyClothTool</span> und nutzt{" "}
        <span className="text-white/65">CodeWalker</span> für die 3D-Vorschau.
        Unterstütze die Leute, die das möglich gemacht haben:
      </p>

      <div className="flex flex-col gap-3.5">
        {PEOPLE.map((person) => (
          <div key={person.name} className="flex flex-col gap-1.5">
            <div>
              <p className="text-sm font-medium text-white/85">{person.name}</p>
              <p className="text-xs text-white/40">{person.role}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {person.links.map((link) => (
                <LinkChip key={link.kind} {...link} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
