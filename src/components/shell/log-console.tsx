/**
 * Live log console panel — fills the dedicated log WINDOW (see
 * src/windows/log-window.tsx) and streams the Rust tracing pipeline
 * (app + sidecar stderr + webview logs) in real time.
 */

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine, Copy, Eraser, Languages, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  levelRank,
  LOG_LEVELS,
  startLogStream,
  stopLogStream,
  useLogConsoleStore,
  type LogEntry,
  type LogLevel,
} from "@/lib/stores/log-console-store";
import { humanizeEntry, sourceLabel, type HumanLine } from "@/lib/log-humanize";
import { getLogPlainLanguage, setLogPlainLanguage } from "@/lib/settings";

const LEVEL_STYLES: Record<string, string> = {
  TRACE: "text-white/30",
  DEBUG: "text-white/40",
  INFO: "text-sky-300/80",
  WARN: "text-amber-300",
  ERROR: "text-red-400",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * One log line. In plain-language mode `human` carries the rewritten text and
 * the raw line moves into the tooltip; without it the row stays verbatim.
 */
function LogRow({
  entry,
  human,
  t,
}: {
  entry: LogEntry;
  human: HumanLine | null;
  t: Translate;
}) {
  const plain = human !== null;
  const untranslated = human?.kind === "raw";
  return (
    <div
      className={cn(
        "flex gap-2 px-3 py-px text-[11px] leading-[1.5] hover:bg-white/5",
        plain ? "font-sans" : "font-mono",
      )}
    >
      <span className="shrink-0 font-mono text-white/25">{formatTime(entry.ts)}</span>
      <span
        className={cn(
          "shrink-0 font-semibold",
          plain ? "w-16" : "w-12",
          LEVEL_STYLES[entry.level] ?? "text-white/50",
        )}
      >
        {plain ? t(`level.${entry.level.toUpperCase()}`, { defaultValue: entry.level }) : entry.level}
      </span>
      <span className="max-w-40 shrink-0 truncate text-[#7289DA]/70" title={entry.target}>
        {plain ? sourceLabel(entry.target, t) : entry.target}
      </span>
      <span
        className={cn(
          "min-w-0 whitespace-pre-wrap break-all",
          untranslated ? "font-mono text-white/50" : "text-white/75",
        )}
        title={plain ? entry.message : undefined}
      >
        {human ? human.text : entry.message}
      </span>
    </div>
  );
}

/** Toolbar + entry list, fills its container (the log window). */
export function LogConsolePanel() {
  const { t } = useTranslation("shell");
  const { t: tRaw, i18n } = useTranslation("logtext");
  // i18next types TFunction on the resource shape; the humanizer only ever
  // passes dynamic keys, so narrow it to a plain lookup once here.
  const tl = tRaw as unknown as Translate;
  const entries = useLogConsoleStore((s) => s.entries);
  const minLevel = useLogConsoleStore((s) => s.minLevel);
  const search = useLogConsoleStore((s) => s.search);
  const autoScroll = useLogConsoleStore((s) => s.autoScroll);
  const plainLanguage = useLogConsoleStore((s) => s.plainLanguage);
  const setMinLevel = useLogConsoleStore((s) => s.setMinLevel);
  const setSearch = useLogConsoleStore((s) => s.setSearch);
  const setAutoScroll = useLogConsoleStore((s) => s.setAutoScroll);
  const setPlainLanguage = useLogConsoleStore((s) => s.setPlainLanguage);
  const clear = useLogConsoleStore((s) => s.clear);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Stream lifecycle is bound to this panel (= the log window). The store is
  // per-window state, so the persisted toggle is hydrated here, not in App.
  useEffect(() => {
    void startLogStream();
    void getLogPlainLanguage()
      .then(setPlainLanguage)
      .catch(() => {});
    return () => {
      void stopLogStream();
    };
  }, [setPlainLanguage]);

  const prepared = useMemo(
    () =>
      entries.map((entry) => ({
        entry,
        human: plainLanguage ? humanizeEntry(entry, tl, i18n.language) : null,
      })),
    [entries, plainLanguage, tl, i18n.language],
  );

  // Plumbing (formatter headers, stack frames, framework chatter) only ever
  // hides in plain mode — the raw view stays a faithful transcript.
  const visible = useMemo(() => prepared.filter((r) => r.human?.kind !== "noise"), [prepared]);
  const hiddenCount = prepared.length - visible.length;

  const filtered = useMemo(() => {
    const min = levelRank(minLevel);
    const needle = search.trim().toLowerCase();
    return visible.filter(({ entry, human }) => {
      if (levelRank(entry.level) < min) return false;
      if (needle === "") return true;
      // Search both forms — users type what they SEE, but the raw text has to
      // stay findable for bug reports.
      return (
        entry.message.toLowerCase().includes(needle) ||
        entry.target.toLowerCase().includes(needle) ||
        (human?.text.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [visible, minLevel, search]);

  // Stick to the bottom while auto-scroll is on.
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered, autoScroll]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/45">
          {filtered.length}/{entries.length}
        </span>
        {plainLanguage && hiddenCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/30">
                −{hiddenCount}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {tl("ui.hiddenLines", { n: hiddenCount })}
            </TooltipContent>
          </Tooltip>
        )}

        <Select value={minLevel} onValueChange={(v) => setMinLevel(v as LogLevel)}>
          <SelectTrigger size="sm" className="h-7 w-28 border-white/15 bg-white/5 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {t("log.level", { level })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("log.filterPlaceholder")}
          className="h-7 max-w-72 border-white/15 bg-white/5 text-xs"
        />

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-7 w-7 p-0", plainLanguage && "text-[#7289DA]")}
                onClick={() => {
                  const next = !plainLanguage;
                  setPlainLanguage(next);
                  void setLogPlainLanguage(next).catch(() => {});
                }}
              >
                <Languages className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {plainLanguage ? tl("ui.plainOn") : tl("ui.plainOff")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setAutoScroll(!autoScroll)}
              >
                {autoScroll ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {autoScroll ? t("log.pauseScroll") : t("log.resumeScroll")}
            </TooltipContent>
          </Tooltip>
          {!autoScroll && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setAutoScroll(true);
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
                  }}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("log.jumpToBottom")}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  // Always the RAW lines — a support copy has to be faithful,
                  // regardless of what the window is showing.
                  const text = filtered
                    .map(
                      ({ entry: e }) =>
                        `${formatTime(e.ts)} ${e.level} ${e.target}: ${e.message}`,
                    )
                    .join("\n");
                  void navigator.clipboard
                    .writeText(text)
                    .then(() =>
                      toast.success(
                        t("log.linesCopied", { count: filtered.length }),
                      ),
                    )
                    .catch(() => toast.error(t("log.copyFailed")));
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("log.copyVisible")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={clear}>
                <Eraser className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("log.clear")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Entries — user-select enabled so lines can be copied directly. */}
      <div
        ref={scrollRef}
        onWheel={() => {
          const el = scrollRef.current;
          if (!el) return;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (!atBottom && autoScroll) setAutoScroll(false);
        }}
        className="min-h-0 flex-1 select-text overflow-y-auto bg-black/40 py-1"
        style={{ userSelect: "text" }}
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-white/35">
            {t("log.noEntries")}{" "}
            {search || minLevel !== "TRACE" ? t("log.filterActive") : ""}
          </p>
        ) : (
          filtered.map(({ entry, human }, i) => (
            <LogRow key={`${entry.ts}-${i}`} entry={entry} human={human} t={tl} />
          ))
        )}
      </div>
    </div>
  );
}
