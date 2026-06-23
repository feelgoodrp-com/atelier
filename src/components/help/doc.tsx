/**
 * Documentation primitives — the small prose toolkit every docs page is built
 * from. Ported from the landing site into the desktop Help tab: same dark glass
 * look, but links route through the in-app DocNav (no router/new tabs).
 */

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { useDocNav, openExternal } from "./doc-nav";

/* ----------------------------------------------------------------- headings */

export function DocH1({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
      {children}
    </h1>
  );
}

export function DocLead({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-base leading-relaxed text-white/55">{children}</p>;
}

export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const { scrollToId } = useDocNav();
  return (
    <section id={id} className="scroll-mt-6 border-t border-white/10 pt-12">
      <h2 className="text-2xl font-semibold tracking-[-0.01em] text-white">
        <a
          href={`#${id}`}
          onClick={(e) => {
            e.preventDefault();
            scrollToId(id);
          }}
          className="group inline-flex cursor-pointer items-center gap-2"
        >
          {title}
          <span
            aria-hidden="true"
            className="text-[#7289DA] opacity-0 transition-opacity group-hover:opacity-100"
          >
            #
          </span>
        </a>
      </h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

export function DocH3({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 text-lg font-semibold text-white">{children}</h3>;
}

/* -------------------------------------------------------------------- prose */

export function DocP({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-white/65">{children}</p>;
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-[#9aa6e8]">
      {children}
    </code>
  );
}

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  const { navigate, scrollToId } = useDocNav();
  const cls =
    "cursor-pointer font-medium text-[#7289DA] underline decoration-white/20 underline-offset-2 transition-colors hover:text-white hover:decoration-white/60";
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (/^https?:\/\//.test(href)) openExternal(href);
        else if (href.startsWith("#")) scrollToId(href.slice(1));
        else navigate(href);
      }}
      className={cls}
    >
      {children}
    </a>
  );
}

export function DocUl({ children }: { children: ReactNode }) {
  return <ul className="space-y-2.5">{children}</ul>;
}

export function DocLi({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[15px] leading-relaxed text-white/65">
      <span
        aria-hidden="true"
        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5865F2]"
      />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function DocSteps({ children }: { children: ReactNode }) {
  return <ol className="space-y-4">{children}</ol>;
}

export function DocStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5865F2]/15 text-sm font-semibold text-[#7289DA] ring-1 ring-inset ring-[#5865F2]/30">
        {n}
      </span>
      <div className="min-w-0 pt-0.5 text-[15px] leading-relaxed text-white/65">{children}</div>
    </li>
  );
}

/* --------------------------------------------------------------- code block */

export function DocCode({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/50">
      {title ? (
        <div className="border-b border-white/10 px-4 py-2 font-mono text-xs text-white/40">
          {title}
        </div>
      ) : null}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-white/80">
        {children}
      </pre>
    </div>
  );
}

/* ----------------------------------------------------------------- callout */

const CALLOUT = {
  info: { icon: Info, ring: "ring-[#5865F2]/30", bar: "bg-[#5865F2]", tint: "text-[#7289DA]" },
  warn: { icon: TriangleAlert, ring: "ring-amber-400/30", bar: "bg-amber-400", tint: "text-amber-300" },
  tip: { icon: Lightbulb, ring: "ring-emerald-400/30", bar: "bg-emerald-400", tint: "text-emerald-300" },
} as const;

export function DocCallout({
  kind = "info",
  title,
  children,
}: {
  kind?: keyof typeof CALLOUT;
  title?: string;
  children: ReactNode;
}) {
  const c = CALLOUT[kind];
  const Icon = c.icon;
  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-white/[0.03] p-4 pl-5 ring-1 ring-inset ${c.ring}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${c.bar}`} />
      <div className="flex gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.tint}`} aria-hidden="true" />
        <div className="min-w-0">
          {title ? <p className={`text-sm font-semibold ${c.tint}`}>{title}</p> : null}
          <div className="text-[14px] leading-relaxed text-white/60">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- table */

export function DocTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            {head.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/40"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/5 align-top last:border-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={
                    j === 0
                      ? "whitespace-nowrap px-4 py-3 font-mono text-[13px] text-[#9aa6e8]"
                      : "px-4 py-3 text-[14px] leading-relaxed text-white/60"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- overview cards */

export function DocCardGrid({ children }: { children: ReactNode }) {
  return <div className="mt-8 grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function DocCard({
  href,
  eyebrow,
  title,
  desc,
  cta = "Read",
}: {
  href: string;
  eyebrow?: string;
  title: string;
  desc: string;
  /** Localized "Read" CTA label; English default for SEO/static use. */
  cta?: string;
}) {
  const { navigate } = useDocNav();
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="liquid-glass group flex flex-col rounded-2xl p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
    >
      {eyebrow ? (
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7289DA]">
          {eyebrow}
        </span>
      ) : null}
      <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-white/55">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#7289DA]">
        {cta}
        <ChevronRight
          className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- prev/next */

type PagerLink = { href: string; title: string };

export function DocPager({
  prev,
  next,
  ariaLabel = "Page navigation",
  prevLabel = "Back",
  nextLabel = "Next",
}: {
  prev?: PagerLink;
  next?: PagerLink;
  /** Localized chrome; English defaults for SEO/static use. */
  ariaLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
}) {
  const { navigate } = useDocNav();
  return (
    <nav
      aria-label={ariaLabel}
      className="mt-16 flex flex-col gap-4 border-t border-white/10 pt-8 sm:flex-row"
    >
      {prev ? (
        <button
          type="button"
          onClick={() => navigate(prev.href)}
          className="liquid-glass flex flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:border-white/20"
        >
          <ChevronLeft className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs text-white/40">{prevLabel}</span>
            <span className="block truncate text-sm font-medium text-white">{prev.title}</span>
          </span>
        </button>
      ) : (
        <span className="flex-1" aria-hidden="true" />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => navigate(next.href)}
          className="liquid-glass flex flex-1 items-center justify-end gap-3 rounded-xl px-4 py-3 text-right transition-colors hover:border-white/20"
        >
          <span className="min-w-0">
            <span className="block text-xs text-white/40">{nextLabel}</span>
            <span className="block truncate text-sm font-medium text-white">{next.title}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
        </button>
      ) : (
        <span className="flex-1" aria-hidden="true" />
      )}
    </nav>
  );
}
