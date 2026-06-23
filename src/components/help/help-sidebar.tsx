/**
 * Help-tab sidebar: the doc pages as a vertical list, the active page expanded
 * into its section anchors with scroll-spy. Adapted from the landing's
 * docs-sidebar — page switching and scrolling go through the in-app DocNav, and
 * the scroll-spy observer watches the Help scroll container (not the window).
 */

import { useEffect, useState, type RefObject } from "react";
import { DOCS_PAGES, DOCS_UI, t } from "./docs-nav";
import { useLocale } from "./locale";
import { useDocNav } from "./doc-nav";
import { cn } from "@/lib/utils";

export function HelpSidebar({
  activeSlug,
  scrollRoot,
}: {
  activeSlug: string;
  scrollRoot: RefObject<HTMLElement | null>;
}) {
  const { locale } = useLocale();
  const { navigate, scrollToId } = useDocNav();
  const active = DOCS_PAGES.find((p) => p.slug === activeSlug) ?? DOCS_PAGES[0];
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    setActiveSection("");
    if (!active.sections.length) return;
    const els = active.sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { root: scrollRoot.current ?? null, rootMargin: "-8px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [active, scrollRoot]);

  return (
    <nav aria-label={t(DOCS_UI.sidebarAria, locale)}>
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        {t(DOCS_UI.sidebarHeading, locale)}
      </p>
      <ul className="flex flex-col gap-1">
        {DOCS_PAGES.map((p) => {
          const on = p.slug === activeSlug;
          return (
            <li key={p.slug}>
              <button
                type="button"
                onClick={() => navigate(p.href)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  on
                    ? "bg-white/[0.06] font-medium text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white",
                )}
              >
                {t(p.short, locale)}
              </button>

              {on && p.sections.length ? (
                <ul className="mt-1 space-y-0.5 border-l border-white/10 pl-3">
                  {p.sections.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => scrollToId(s.id)}
                        className={cn(
                          "block w-full py-1 text-left text-sm transition-colors",
                          activeSection === s.id
                            ? "font-medium text-[#7289DA]"
                            : "text-white/45 hover:text-white/80",
                        )}
                      >
                        {t(s.label, locale)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
