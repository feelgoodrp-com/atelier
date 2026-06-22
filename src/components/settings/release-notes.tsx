import { type ReactNode } from "react";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";

/**
 * Tiny, dependency-free renderer for the slice of Markdown our release notes
 * use (the per-version CHANGELOG section the release workflow bakes into
 * `latest.json`): headings, bullet lists (with hard-wrapped continuations),
 * block quotes and paragraphs, plus inline **bold**, `code` and [links](url).
 * Not a general Markdown engine — just enough to render our own changelog.
 */

type Block =
  | { type: "h" | "p" | "quote"; text: string }
  | { type: "ul"; items: string[] };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const push = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      push();
      continue;
    }
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (head) {
      push();
      blocks.push({ type: "h", text: head[1]! });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!cur || cur.type !== "ul") {
        push();
        cur = { type: "ul", items: [] };
      }
      cur.items.push(bullet[1]!);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      if (cur && cur.type === "quote") cur.text += " " + quote[1];
      else {
        push();
        cur = { type: "quote", text: quote[1]! };
      }
      continue;
    }
    // Hard-wrapped continuation of the previous block, or a new paragraph.
    const indented = /^\s+\S/.test(line);
    if (cur && cur.type === "ul" && indented) {
      cur.items[cur.items.length - 1] += " " + line.trim();
      continue;
    }
    if (cur && cur.type === "quote" && indented) {
      cur.text += " " + line.trim();
      continue;
    }
    if (cur && cur.type === "p") {
      cur.text += " " + line.trim();
      continue;
    }
    push();
    cur = { type: "p", text: line.trim() };
  }
  push();
  return blocks;
}

/** Render inline **bold**, `code` and [text](url) inside a single line. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-white/90">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-white/80"
        >
          {m[2]}
        </code>,
      );
    } else {
      const url = m[4]!;
      nodes.push(
        <a
          key={key++}
          className="cursor-pointer text-[#7289DA] underline underline-offset-2 hover:text-[#9bb0ff]"
          onClick={() => void openInBrowser(url).catch(() => {})}
        >
          {m[3]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-white/60">
      {blocks.map((b, i) => {
        if (b.type === "h")
          return (
            <p key={i} className="mt-1 font-semibold text-white/85">
              {renderInline(b.text)}
            </p>
          );
        if (b.type === "quote")
          return (
            <p
              key={i}
              className="border-l-2 border-amber-400/40 pl-2.5 text-amber-200/85"
            >
              {renderInline(b.text)}
            </p>
          );
        if (b.type === "ul")
          return (
            <ul key={i} className="ml-1 flex flex-col gap-1">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/30" />
                  <span>{renderInline(it)}</span>
                </li>
              ))}
            </ul>
          );
        return <p key={i}>{renderInline(b.text)}</p>;
      })}
    </div>
  );
}
