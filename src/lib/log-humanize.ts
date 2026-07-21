/**
 * Turns raw log lines into sentences a non-technical user can read.
 *
 * The live log window streams three very different sources through one flat
 * string (see src-tauri/src/logging.rs — message + " key=value" field tail):
 *   - `webview`             — React logs, with a JSON `context={…}` tail
 *   - `atelier_lib` / `sidecar` — Rust app + sidecar lifecycle
 *   - `sidecar::stderr`     — the .NET sidecar's ILogger output, which the
 *                             default console formatter splits into TWO lines:
 *                             a `info: Category[0]` header and an indented
 *                             message line. The header carries no information
 *                             for a user and is dropped as noise.
 *
 * Matching is by regex against the message text; `target` only picks which
 * rule sets are worth trying. Anything that matches nothing falls through
 * UNCHANGED — a missing rule must never hide a line.
 */

import { ALL_SLOTS } from "@/lib/gta/components";
import type { LogEntry } from "@/lib/stores/log-console-store";

/** Minimal shape of i18next's `t` — avoids leaking the generic TFunction type. */
type Translate = (key: string, vars?: Record<string, unknown>) => string;

export type HumanKind =
  /** Rewritten into a human sentence. */
  | "human"
  /** No rule matched — shown verbatim. */
  | "raw"
  /** Pure plumbing (formatter headers, stack frames, framework chatter). */
  | "noise";

export interface HumanLine {
  kind: HumanKind;
  text: string;
}

interface Rule {
  re: RegExp;
  key: string;
  /** Interpolation values, built from the regex captures. */
  vars?: (m: RegExpMatchArray, ctx: Ctx) => Record<string, unknown>;
}

interface Ctx {
  t: Translate;
  /** Parsed `context={…}` JSON tail of a webview line, if present. */
  json: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Last path segment — full paths are unreadable in a log row. */
function fileName(path: string): string {
  const cleaned = path.trim().replace(/[\\/]+$/u, "");
  const cut = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return cut === -1 ? cleaned : cleaned.slice(cut + 1);
}

function bytes(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return String(raw);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** `mp_m_freemode_01` → "male" / "female", anything else stays as-is. */
function pedLabel(model: string, t: Translate): string {
  const m = model.toLowerCase();
  if (m.includes("mp_m_freemode")) return t("ped.male");
  if (m.includes("mp_f_freemode")) return t("ped.female");
  return model;
}

/**
 * Clothing slot as a wearable name. The sidecar writes either the slot id
 * ("uppr") or the native component number ("3"); components win over props
 * on a numeric collision because appearance warnings are component-side.
 */
function slotLabel(raw: string, t: Translate): string {
  const key = raw.trim();
  const byId = ALL_SLOTS.find((s) => s.id === key);
  const numeric = Number.parseInt(key, 10);
  const byNumber = Number.isFinite(numeric)
    ? (ALL_SLOTS.find((s) => s.kind === "component" && s.componentId === numeric) ??
      ALL_SLOTS.find((s) => s.componentId === numeric))
    : undefined;
  const slot = byId ?? byNumber;
  return slot ? t(`slot.${slot.id}`, { defaultValue: slot.label }) : key;
}

/** Build phase ids emitted by the sidecar's SSE progress. */
function phaseLabel(phase: string, t: Translate): string {
  return t(`phase.${phase.trim()}`, { defaultValue: phase.trim() });
}

// ---------------------------------------------------------------------------
// Noise — lines that carry no information for a human reader
// ---------------------------------------------------------------------------

const NOISE: RegExp[] = [
  // .NET console formatter header: "info: Atelier.Preview.Glb[0]"
  /^(trce|dbug|info|warn|fail|crit):\s+\S+\[\d+\]\s*$/u,
  // .NET stack frames + exception separators
  /^\s+at\s+\S+/u,
  /^\s*---\s*End of (inner exception )?stack trace/iu,
  // ASP.NET request/pipeline chatter (muted at the source since 1.8.1, but
  // older sidecar builds and the replayed ring buffer still contain it)
  /^\s*Request (starting|finished) HTTP\//u,
  /^\s*CORS policy execution (successful|failed)/u,
  /^\s*(Executing|Executed) endpoint /u,
  /^\s*Setting HTTP status code \d+\./u,
  /^\s*Writing value of type /u,
  /^\s*Sending file with download name /u,
  /^\s*Now listening on: /u,
  /^\s*Application started\. Press Ctrl\+C/u,
  /^\s*(Hosting environment|Content root path): /u,
];

// ---------------------------------------------------------------------------
// Rules — ordered specific → generic within each group
// ---------------------------------------------------------------------------

/** React logs (target `webview`). Their values come from the JSON context. */
const WEBVIEW_RULES: Rule[] = [
  {
    re: /^build started\b/u,
    key: "build.started",
    vars: (_m, c) => ({
      target: String(c.json?.target ?? "?"),
      // Never invent a number: an unreadable context shows "?", not "0".
      n: c.json?.drawables ?? "?",
    }),
  },
  { re: /^build phase: (\S+)/u, key: "build.phase", vars: (m, c) => ({ phase: phaseLabel(m[1]!, c.t) }) },
  {
    re: /^build (\S+) (\d+)\/(\d+) — (.*)$/u,
    key: "build.tick",
    vars: (m, c) => ({
      phase: phaseLabel(m[1]!, c.t),
      current: m[2],
      total: m[3],
      detail: m[4]!.trim(),
    }),
  },
  {
    re: /^build finished\b/u,
    key: "build.finished",
    vars: (_m, c) => ({
      n: c.json?.resources ?? "?",
      warnings: c.json?.warnings ?? "?",
      seconds: String(c.json?.seconds ?? "?"),
    }),
  },
  { re: /^build rejected — sidecar busy/u, key: "build.busy" },
  {
    re: /^build failed\b/u,
    key: "build.failed",
    vars: (_m, c) => ({ error: String(c.json?.error ?? "") }),
  },
  {
    re: /^update available\b/u,
    key: "update.available",
    vars: (_m, c) => ({ version: String(c.json?.version ?? c.json?.latest ?? "") }),
  },
  { re: /^update check failed\b/u, key: "update.checkFailed" },
  { re: /^update installed — relaunching/u, key: "update.installed" },
  { re: /^update install failed\b/u, key: "update.installFailed" },
];

/** Rust app + sidecar lifecycle (targets `atelier_lib*`, `sidecar`). */
const APP_RULES: Rule[] = [
  { re: /^atelier starting\b/u, key: "app.starting" },
  { re: /^logging initialized \(console \+ file\)/u, key: "app.loggingReady" },
  { re: /^logging initialized console-only/u, key: "app.loggingNoFile" },
  { re: /^window effects applied\b/u, key: "app.effectsOk" },
  { re: /^window effects could not be applied: (.*)$/u, key: "app.effectsFailed", vars: (m) => ({ error: m[1] }) },
  { re: /^app exiting — killing sidecar/u, key: "app.exiting" },

  { re: /^spawning sidecar process\b/u, key: "svc.starting" },
  { re: /^sidecar ready\b/u, key: "svc.ready" },
  { re: /^manual restart requested\b/u, key: "svc.manualRestart" },
  {
    re: /^sidecar terminated unexpectedly\b.*?\battempt=(\d+).*?\bmax_attempts=(\d+)/u,
    key: "svc.crashed",
    vars: (m) => ({ attempt: m[1], max: m[2] }),
  },
  { re: /^sidecar terminated unexpectedly\b/u, key: "svc.crashedPlain" },
  { re: /^giving up after (\d+) respawn attempts/u, key: "svc.gaveUp", vars: (m) => ({ n:m[1] }) },
  { re: /^command error: (.*)$/u, key: "svc.commandError", vars: (m) => ({ error: m[1] }) },
  { re: /^sidecar (?:command error|spawn failed): (.*)$/u, key: "svc.spawnFailed", vars: (m) => ({ error: m[1] }) },

  // Raw Console.Error lines from the sidecar's own startup path
  { re: /^warn: ignoring invalid FG_SIDECAR_DEV_PORT/u, key: "svc.badDevPort" },
  { re: /^error: FG_SIDECAR_TOKEN is not set\./u, key: "svc.noToken" },
  { re: /^info: host process (exited|already gone)/u, key: "svc.hostGone" },
];

/** .NET sidecar ILogger messages (target `sidecar::stderr`). */
const SIDECAR_RULES: Rule[] = [
  // --- startup / GTA files -------------------------------------------------
  { re: /^atelier sidecar v(\S+) listening on/u, key: "svc.listening", vars: (m) => ({ version: m[1] }) },
  { re: /^GTA path configured: (.*)$/u, key: "gta.pathSet", vars: (m) => ({ path: m[1]!.trim() }) },
  { re: /^Loading GTA V encryption keys from /u, key: "gta.keys" },
  { re: /^Initializing GameFileCache for /u, key: "gta.cacheInit" },
  { re: /^GameFileCache ready for /u, key: "gta.cacheReady" },
  { re: /^GameFileCache content pump error/u, key: "gta.pumpError" },
  { re: /^GameFileCache: (.*)$/u, key: "gta.cacheStatus", vars: (m) => ({ detail: m[1]!.trim() }) },
  { re: /^Ped-body prewarm started for /u, key: "ped.prewarmStart" },
  { re: /^Ped-body prewarm complete/u, key: "ped.prewarmDone" },
  { re: /^Ped-body prewarm crashed/u, key: "ped.prewarmCrashed" },
  {
    re: /^Prewarmed (\S+) \((\d+) components?\)/u,
    key: "ped.prewarmed",
    vars: (m, c) => ({ ped: pedLabel(m[1]!, c.t), n:Number(m[2]) }),
  },
  { re: /^Prewarm failed for (\S+)/u, key: "ped.prewarmFailed", vars: (m, c) => ({ ped: pedLabel(m[1]!, c.t) }) },
  {
    re: /^Loaded (\d+) default components for ped (\S+)/u,
    key: "ped.baseLoaded",
    vars: (m, c) => ({ n:Number(m[1]), ped: pedLabel(m[2]!, c.t) }),
  },
  { re: /^Ped body load failed for (\S+)/u, key: "ped.loadFailed", vars: (m, c) => ({ ped: pedLabel(m[1]!, c.t) }) },

  // --- preview -------------------------------------------------------------
  {
    re: /^Outfit GLB built: (\d+) items, (\d+) bytes/u,
    key: "preview.outfitBuilt",
    vars: (m) => ({ n:Number(m[1]), size: bytes(m[2]!) }),
  },
  {
    re: /^Preview GLB built: (\d+) bytes, (\d+) vertices/u,
    key: "preview.built",
    vars: (m) => ({ size: bytes(m[1]!), vertices: Number(m[2]) }),
  },
  { re: /^(Preview|Outfit) GLB not cached/u, key: "preview.notCached" },
  { re: /^Outfit preview build failed/u, key: "preview.outfitFailed" },
  { re: /^Preview build failed for (.*)$/u, key: "preview.failed", vars: (m) => ({ file: fileName(m[1]!) }) },
  { re: /^Preview texture decode failed for (\S+)/u, key: "preview.textureFailed", vars: (m) => ({ texture: m[1] }) },
  { re: /^Thumbnail rendering failed for texture (\S+)/u, key: "preview.thumbFailed", vars: (m) => ({ texture: m[1] }) },

  // --- appearance (clothing slots) ----------------------------------------
  {
    re: /^Appearance: slot (\S+) drawable (\S+) not in the (\S+) variation info/u,
    key: "appearance.drawableMissing",
    vars: (m, c) => ({ slot: slotLabel(m[1]!, c.t), drawable: m[2] }),
  },
  {
    re: /^Appearance: slot (\S+) texture (\S+) clamped to (\S+)/u,
    key: "appearance.textureClamped",
    vars: (m, c) => ({ slot: slotLabel(m[1]!, c.t), texture: m[2], used: m[3] }),
  },
  {
    re: /^Appearance: drawable (\S+) for slot (\S+) of \S+ could not be loaded \(([^)]*)\)/u,
    key: "appearance.drawableFailed",
    vars: (m, c) => ({ name: m[1], slot: slotLabel(m[2]!, c.t), reason: m[3] }),
  },
  {
    re: /^Appearance: texture (\S+) for slot (\S+) of \S+ could not be loaded \(([^)]*)\)/u,
    key: "appearance.textureFailed",
    vars: (m, c) => ({ name: m[1], slot: slotLabel(m[2]!, c.t), reason: m[3] }),
  },

  // --- face ----------------------------------------------------------------
  { re: /^Face compositing failed for (\S+)/u, key: "face.compositeFailed" },
  { re: /^Face asset: TRANSIENT load failure for YTD (.*?) —/u, key: "face.transient", vars: (m) => ({ file: fileName(m[1]!) }) },
  { re: /^Face asset: failed to load YTD (.*)$/u, key: "face.ytdFailed", vars: (m) => ({ file: fileName(m[1]!) }) },
  { re: /^Face asset: failed to decode texture (\S+)/u, key: "face.textureFailed", vars: (m) => ({ texture: m[1] }) },
  { re: /^Face: skin parent (\S+) unresolved/u, key: "face.skinParent" },
  { re: /^Face diffuse override encode failed/u, key: "face.encodeFailed" },

  // --- poses / animations --------------------------------------------------
  { re: /^Pose (\S+) resolved via /u, key: "pose.resolved", vars: (m) => ({ pose: m[1] }) },
  { re: /^Pose (\S+): clip \S+ not available/u, key: "pose.candidate", vars: (m) => ({ pose: m[1] }) },
  { re: /^Pose unavailable: (\S+) \(([^)]*)\)/u, key: "pose.unavailable", vars: (m) => ({ pose: m[1], reason: m[2] }) },
  { re: /^Pose load failed for (\S+)/u, key: "pose.loadFailed", vars: (m) => ({ pose: m[1] }) },
  { re: /^Pose evaluation failed for (\S+)/u, key: "pose.evalFailed", vars: (m) => ({ pose: m[1] }) },
  {
    re: /^Animation (\S+) resolved via \S+ \((\d+) frames/u,
    key: "anim.resolved",
    vars: (m) => ({ anim: m[1], frames: Number(m[2]) }),
  },
  { re: /^Animation (\S+): clip \S+ not available/u, key: "anim.candidate", vars: (m) => ({ anim: m[1] }) },
  { re: /^Animation unavailable: (\S+) \(([^)]*)\)/u, key: "anim.unavailable", vars: (m) => ({ anim: m[1], reason: m[2] }) },
  { re: /^Animation load failed for (\S+)/u, key: "anim.loadFailed", vars: (m) => ({ anim: m[1] }) },
  { re: /^Animation sampling failed for (\S+)/u, key: "anim.sampleFailed", vars: (m) => ({ anim: m[1] }) },
  { re: /^Clip dict load failed for (\S+)/u, key: "anim.dictFailed", vars: (m) => ({ dict: m[1] }) },

  // --- project files -------------------------------------------------------
  {
    re: /^Scanned (.*?): (\d+) entries, (\d+) warnings/u,
    key: "io.scanned",
    vars: (m) => ({ folder: fileName(m[1]!), n:Number(m[2]), warnings: Number(m[3]) }),
  },
  { re: /^Import scan failed for (.*)$/u, key: "io.scanFailed", vars: (m) => ({ folder: fileName(m[1]!) }) },
  { re: /^Parse failed for (.*?) \(\d+ bytes\)/u, key: "io.parseFailed", vars: (m) => ({ file: fileName(m[1]!) }) },
  { re: /^Failed to parse (.*)$/u, key: "io.parseFailed", vars: (m) => ({ file: fileName(m[1]!) }) },
  { re: /^Failed to read (.*)$/u, key: "io.readFailed", vars: (m) => ({ file: fileName(m[1]!) }) },

  // --- validation / build --------------------------------------------------
  {
    re: /^Validated project (.*?): (\d+) findings \((\d+) errors\)/u,
    key: "build.validated",
    vars: (m) => ({ n:Number(m[2]), errors: Number(m[3]) }),
  },
  { re: /^Validation failed/u, key: "build.validationFailed" },
  { re: /^Build job \S+ started: target=(\S+)/u, key: "build.jobStarted", vars: (m) => ({ target: m[1] }) },
  {
    re: /^Build job \S+ done: (\d+) resource\(s\), (\d+) warning\(s\)/u,
    key: "build.jobDone",
    vars: (m) => ({ n:Number(m[1]), warnings: Number(m[2]) }),
  },
  { re: /^Build job \S+ failed/u, key: "build.jobFailed" },
  { re: /^Debug (ymt parse|rpf scan) failed for (.*)$/u, key: "build.debugFailed", vars: (m) => ({ file: fileName(m[2]!) }) },

  // --- textures ------------------------------------------------------------
  {
    re: /^Optimized (.*?): (\d+)x(\d+)\/\d+B -> (\d+)x(\d+)\/(\d+)B/u,
    key: "texture.optimized",
    vars: (m) => ({
      file: fileName(m[1]!),
      before: `${m[2]}×${m[3]}`,
      after: `${m[4]}×${m[5]}`,
      size: bytes(m[6]!),
    }),
  },
  { re: /^Texture optimize failed for (.*)$/u, key: "texture.optimizeFailed", vars: (m) => ({ file: fileName(m[1]!) }) },
  {
    re: /^Converted (.*?) -> (\S+) \(/u,
    key: "texture.converted",
    vars: (m) => ({ from: fileName(m[1]!), to: fileName(m[2]!) }),
  },
  { re: /^Image->YTD conversion failed for (.*)$/u, key: "texture.convertFailed", vars: (m) => ({ file: fileName(m[1]!) }) },

  // --- auth ----------------------------------------------------------------
  { re: /^\S+ is not set - token check disabled/u, key: "svc.devNoAuth" },
  { re: /^Rejected (\S+) (\S+): missing or invalid/u, key: "svc.rejected", vars: (m) => ({ path: m[2] }) },
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Splits off the trailing `context={…}` JSON that `frontend_log` appends. */
function splitContext(message: string): { text: string; json: Record<string, unknown> | null } {
  const at = message.indexOf(" context={");
  if (at === -1) return { text: message, json: null };
  const raw = message.slice(at + " context=".length);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { text: message.slice(0, at), json: parsed as Record<string, unknown> };
    }
  } catch {
    // Truncated or non-JSON tail — keep the line as it is.
  }
  return { text: message.slice(0, at), json: null };
}

function rulesFor(target: string): Rule[] {
  if (target === "webview") return WEBVIEW_RULES;
  if (target.startsWith("sidecar::")) return SIDECAR_RULES;
  // `sidecar` (lifecycle) and `atelier_lib*` share the app rule set; the
  // sidecar's own stderr startup lines are matched there too.
  return APP_RULES;
}

// Humanizing runs per visible row on every render — memoize by content.
const cache = new Map<string, HumanLine>();
const CACHE_CAP = 4000;

/** Rewrites one entry; falls back to the raw message when nothing matches. */
export function humanizeEntry(entry: LogEntry, t: Translate, lang: string): HumanLine {
  const cacheKey = `${lang} ${entry.target} ${entry.message}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const result = compute(entry, t);
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(cacheKey, result);
  return result;
}

function compute(entry: LogEntry, t: Translate): HumanLine {
  const { text, json } = splitContext(entry.message);
  // The .NET console formatter indents its message lines by six spaces.
  const line = text.replace(/\s+$/u, "");
  const trimmed = line.trimStart();

  if (trimmed === "") return { kind: "noise", text: "" };
  for (const re of NOISE) {
    if (re.test(line)) return { kind: "noise", text: line };
  }

  const ctx: Ctx = { t, json };
  const sets = [rulesFor(entry.target)];
  // Sidecar startup writes plain Console.Error lines that live in APP_RULES,
  // and lifecycle lines can carry .NET text — try the other set as a backup.
  if (entry.target.startsWith("sidecar")) sets.push(entry.target === "sidecar" ? SIDECAR_RULES : APP_RULES);

  for (const rules of sets) {
    for (const rule of rules) {
      const m = rule.re.exec(trimmed);
      if (!m) continue;
      const vars = rule.vars ? rule.vars(m, ctx) : {};
      return { kind: "human", text: t(rule.key, vars) };
    }
  }

  return { kind: "raw", text: trimmed };
}

/** Friendly name for the `target` column. */
export function sourceLabel(target: string, t: Translate): string {
  if (target === "webview") return t("source.app");
  if (target.startsWith("atelier_lib")) return t("source.app");
  if (target.startsWith("sidecar")) return t("source.engine");
  return target;
}

/** Test seam — the selftest drives the rule table without React. */
export const __rules = { WEBVIEW_RULES, APP_RULES, SIDECAR_RULES, NOISE, splitContext, compute };
