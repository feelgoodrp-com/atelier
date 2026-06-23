import { useMemo, useRef, useState } from "react";
import { DocNavContext, type DocNav } from "@/components/help/doc-nav";
import { DOCS_PAGES } from "@/components/help/docs-nav";
import { HelpSidebar } from "@/components/help/help-sidebar";
import { OverviewDoc } from "@/components/help/overview-doc";
import { AtelierDoc } from "@/components/help/atelier-doc";
import { AtelierApiDoc } from "@/components/help/atelier-api-doc";

/**
 * Help tab — the full documentation (overview + atelier + atelier-api), ported
 * from the landing site and bundled into the app so it works fully offline (in
 * solo mode too). A left rail switches pages and jumps to sections; everything
 * scrolls inside this screen's own container.
 */
export function HelpScreen() {
  const [slug, setSlug] = useState("overview");
  const scrollRef = useRef<HTMLDivElement>(null);

  const nav: DocNav = useMemo(
    () => ({
      navigate: (hrefOrSlug) => {
        const [path, hash] = hrefOrSlug.split("#");
        const page = DOCS_PAGES.find((p) => p.href === path || p.slug === path);
        if (page) {
          setSlug(page.slug);
          scrollRef.current?.scrollTo({ top: 0 });
        }
        if (hash) {
          // Let the target page render before scrolling to its anchor.
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              document.getElementById(hash)?.scrollIntoView({ block: "start" }),
            ),
          );
        }
      },
      scrollToId: (id) => {
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    }),
    [],
  );

  return (
    <DocNavContext.Provider value={nav}>
      <div className="screen-fade-in flex h-full">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-white/10 px-4 py-8 lg:block">
          <HelpSidebar activeSlug={slug} scrollRoot={scrollRef} />
        </aside>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10"
        >
          <div className="mx-auto max-w-3xl pb-16">
            {slug === "overview" && <OverviewDoc />}
            {slug === "atelier" && <AtelierDoc />}
            {slug === "atelier-api" && <AtelierApiDoc />}
          </div>
        </div>
      </div>
    </DocNavContext.Provider>
  );
}
