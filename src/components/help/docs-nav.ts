/**
 * Documentation structure — single source of truth for the docs sidebar, the
 * per-page on-this-page anchors, and the prev/next pager. Section `id`s here
 * must match the `id`s of the <DocSection> blocks rendered on each page.
 *
 * Bilingual: every user-facing label is a `{ en, de }` pair (English default).
 * Anchors (`id`) and `href`/`slug` are language-neutral and never translated.
 * Use `t(value, locale)` to resolve a pair, or `localizeDocPage(page, locale)`
 * to get a flattened, single-language view of a page for rendering.
 */

import type { DocLocale as Locale } from "./locale";

/** A user-facing string that exists in both languages. */
export type I18nString = { en: string; de: string };

/** Resolve an {en,de} pair (or a plain string) for the active locale. */
export function t(value: I18nString | string, locale: Locale): string {
  return typeof value === "string" ? value : value[locale];
}

export type DocSectionLink = { id: string; label: I18nString };

export type DocPage = {
  slug: string;
  href: string;
  /** Full title shown as the page H1 / sidebar tooltip. */
  title: I18nString;
  /** Short label shown in the sidebar. */
  short: I18nString;
  /** One-line summary for the overview cards. */
  blurb: I18nString;
  sections: DocSectionLink[];
};

/** A page with every {en,de} label collapsed to a single language. */
export type LocalizedDocPage = {
  slug: string;
  href: string;
  title: string;
  short: string;
  blurb: string;
  sections: { id: string; label: string }[];
};

export const DOCS_PAGES: DocPage[] = [
  {
    slug: "overview",
    href: "/docs",
    title: { en: "Documentation", de: "Dokumentation" },
    short: { en: "Overview", de: "Übersicht" },
    blurb: {
      en: "Where to start — and how the pieces fit together.",
      de: "Wo du anfängst — und wie die Teile zusammenspielen.",
    },
    sections: [],
  },
  {
    slug: "atelier",
    href: "/docs/atelier",
    title: { en: "atelier — the desktop app", de: "atelier — die Desktop-App" },
    short: { en: "atelier · Desktop", de: "atelier · Desktop" },
    blurb: {
      en: "Install, set up, build clothing packs and share them with your team.",
      de: "Installieren, einrichten, Clothing-Packs bauen und im Team teilen.",
    },
    sections: [
      { id: "einstieg", label: { en: "What is atelier?", de: "Was ist atelier?" } },
      { id: "installation", label: { en: "Installation", de: "Installation" } },
      { id: "erste-schritte", label: { en: "Getting started", de: "Erste Schritte" } },
      { id: "login", label: { en: "Login & access", de: "Login & Freigabe" } },
      { id: "werkbank", label: { en: "The workbench", de: "Die Werkbank" } },
      { id: "vorschau", label: { en: "3D preview", de: "3D-Vorschau" } },
      { id: "tattoos", label: { en: "Tattoos", de: "Tattoos" } },
      { id: "bauen", label: { en: "Build & export", de: "Bauen & Export" } },
      { id: "cloud", label: { en: "Team cloud", de: "Team-Cloud" } },
      { id: "einstellungen", label: { en: "Settings & help", de: "Einstellungen & Hilfe" } },
    ],
  },
  {
    slug: "atelier-api",
    href: "/docs/atelier-api",
    title: { en: "atelier-api — the backend", de: "atelier-api — das Backend" },
    short: { en: "atelier-api · Backend", de: "atelier-api · Backend" },
    blurb: {
      en: "Self-host it: login, storage, team sync and deployment.",
      de: "Selbst hosten: Login, Storage, Team-Sync und Deployment.",
    },
    sections: [
      { id: "ueberblick", label: { en: "Overview", de: "Überblick" } },
      { id: "voraussetzungen", label: { en: "Requirements", de: "Voraussetzungen" } },
      { id: "env", label: { en: "Environment variables", de: "Environment-Variablen" } },
      { id: "discord", label: { en: "Discord OAuth & access", de: "Discord-OAuth & Freigabe" } },
      { id: "storage", label: { en: "Storage & volume", de: "Storage & Volume" } },
      { id: "deployment", label: { en: "Deployment (Dokploy)", de: "Deployment (Dokploy)" } },
      { id: "admin", label: { en: "Admin dashboard", de: "Admin-Dashboard" } },
      { id: "endpoints", label: { en: "Endpoint overview", de: "Endpoint-Übersicht" } },
    ],
  },
];

/**
 * Shared docs-chrome strings (sidebar heading, pager labels, card CTA). These
 * are used by the always-client docs primitives/sidebar. Resolve with `t(...)`.
 */
export const DOCS_UI = {
  sidebarHeading: { en: "Documentation", de: "Dokumentation" } as I18nString,
  sidebarAria: { en: "Documentation", de: "Dokumentation" } as I18nString,
  pagerAria: { en: "Page navigation", de: "Seitennavigation" } as I18nString,
  pagerPrev: { en: "Back", de: "Zurück" } as I18nString,
  pagerNext: { en: "Next", de: "Weiter" } as I18nString,
  cardCta: { en: "Read", de: "Lesen" } as I18nString,
} as const;

export const DOC_PRODUCT_PAGES = DOCS_PAGES.filter((p) => p.slug !== "overview");

export function docPageBySlug(slug: string): DocPage | undefined {
  return DOCS_PAGES.find((p) => p.slug === slug);
}

/** Flatten a page's {en,de} labels to a single language for rendering. */
export function localizeDocPage(page: DocPage, locale: Locale): LocalizedDocPage {
  return {
    slug: page.slug,
    href: page.href,
    title: page.title[locale],
    short: page.short[locale],
    blurb: page.blurb[locale],
    sections: page.sections.map((s) => ({ id: s.id, label: s.label[locale] })),
  };
}
