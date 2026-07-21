/**
 * Selftest for the log humanizer: `bun run selftest:logs`
 *
 * Two things are checked, and both catch a different class of bug:
 *  1. Every sample line — copied verbatim from real atelier log files — hits
 *     the rule it is supposed to hit, with the right variables extracted.
 *  2. Every key referenced by a rule exists in BOTH locale files, and both
 *     files agree on their key set. A typo'd key would otherwise render as
 *     the literal key string in the log window.
 */

import en from "./i18n/locales/en/logtext.json";
import de from "./i18n/locales/de/logtext.json";
import { __rules, humanizeEntry, sourceLabel } from "./log-humanize";
import type { LogEntry } from "./stores/log-console-store";

let failures = 0;
let checks = 0;

function ok(condition: boolean, label: string, detail?: string): void {
  checks++;
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  }
}

/** Stand-in for i18next: renders "key {json}" so rules stay assertable. */
const fakeT = (key: string, vars?: Record<string, unknown>): string => {
  if (vars && "defaultValue" in vars) return String(vars.defaultValue);
  return vars && Object.keys(vars).length > 0 ? `${key} ${JSON.stringify(vars)}` : key;
};

function entry(target: string, message: string, level = "INFO"): LogEntry {
  return { ts: 0, level, target, message };
}

function run(target: string, message: string) {
  return __rules.compute(entry(target, message), fakeT);
}

// ---------------------------------------------------------------------------
// 1. Rule matching
// ---------------------------------------------------------------------------

console.log("\nrules — webview (React)");
{
  const r = run("webview", 'build started context={"target":"fivem","drawables":12}');
  ok(r.kind === "human" && r.text.includes("build.started"), "build started matches");
  ok(r.text.includes('"target":"fivem"') && r.text.includes('"n":12'), "build started reads its JSON context", r.text);

  const tick = run("webview", "build copy 42/180 — jacket_diff.ytd");
  ok(
    tick.text.includes("build.tick") && tick.text.includes('"current":"42"') && tick.text.includes("jacket_diff.ytd"),
    "progress tick keeps step, total and detail",
    tick.text,
  );

  const phase = run("webview", "build phase: package");
  ok(phase.text.includes("build.phase"), "phase change matches");

  const done = run("webview", 'build finished context={"resources":2,"warnings":1,"outDir":"C:\\\\out","seconds":12.4}');
  ok(done.text.includes('"n":2') && done.text.includes('"seconds":"12.4"'), "build finished reads counts + duration", done.text);

  // A context that cannot be parsed must not turn into invented numbers.
  const broken = run("webview", "build finished context={not json");
  ok(
    broken.kind === "human" && broken.text.includes('"n":"?"') && !broken.text.includes('"n":0'),
    "an unreadable context shows ? instead of a made-up 0",
    broken.text,
  );

  const failed = run("webview", 'build failed context={"error":"Datei fehlt","jobId":"j1"}');
  ok(failed.text.includes("build.failed") && failed.text.includes("Datei fehlt"), "build failed carries the error");

  ok(run("webview", "build rejected — sidecar busy").text === "build.busy", "em-dash busy line matches");
  ok(run("webview", "update installed — relaunching").text === "update.installed", "em-dash update line matches");
  ok(run("webview", 'update available context={"version":"1.9.0"}').text.includes("1.9.0"), "update version extracted");
}

console.log("\nrules — Rust app + sidecar lifecycle");
{
  ok(run("atelier_lib", "atelier starting version=1.8.1").text === "app.starting", "startup line tolerates the field tail");
  ok(run("atelier_lib::logging", "logging initialized (console + file) log_dir=C:\\x").text === "app.loggingReady", "logging.rs target is covered");
  ok(run("sidecar", "spawning sidecar process generation=0").text === "svc.starting", "spawn matches");
  ok(run("sidecar", "sidecar ready port=51337").text === "svc.ready", "ready matches");

  const crash = run("sidecar", "sidecar terminated unexpectedly code=Some(3221225477) attempt=1 max_attempts=3");
  ok(
    crash.text.includes("svc.crashed") && crash.text.includes('"attempt":"1"') && crash.text.includes('"max":"3"'),
    "crash line extracts attempt counters (and hides the exit code)",
    crash.text,
  );

  ok(run("sidecar", "giving up after 3 respawn attempts").text.includes('"n":"3"'), "give-up count extracted");
  ok(run("sidecar", "sidecar spawn failed: os error 3").text.includes("os error 3"), "spawn failure keeps the cause");
}

console.log("\nrules — .NET sidecar (stderr)");
{
  const cases: [string, string][] = [
    ["GTA path configured: G:\\SteamLibrary\\GTAV", "gta.pathSet"],
    ["Initializing GameFileCache for G:\\GTAV (one-time, this can take a while) ...", "gta.cacheInit"],
    ["GameFileCache ready for G:\\GTAV", "gta.cacheReady"],
    ["Ped-body prewarm complete", "ped.prewarmDone"],
    ["Outfit preview build failed", "preview.outfitFailed"],
    ["Validation failed", "build.validationFailed"],
    ["Build job 7f3 failed", "build.jobFailed"],
    ["Face diffuse override encode failed (512x512)", "face.encodeFailed"],
  ];
  for (const [line, key] of cases) {
    ok(run("sidecar::stderr", line).text.startsWith(key), `${key} matches`, run("sidecar::stderr", line).text);
  }

  const ped = run("sidecar::stderr", "Prewarmed mp_f_freemode_01 (33 components)");
  ok(ped.text.includes("ped.female") && ped.text.includes('"n":33'), "ped model becomes a readable label", ped.text);

  const outfit = run("sidecar::stderr", "Outfit GLB built: 4 items, 2847392 bytes, 84213 vertices, ped=mp_f_freemode_01, pose=stand");
  ok(outfit.text.includes('"n":4') && outfit.text.includes("2.7 MB"), "byte counts become human sizes", outfit.text);

  const slot = run(
    "sidecar::stderr",
    "Appearance: slot 4 drawable 12 not in the mp_m_freemode_01 variation info (DLC/out of range) - falling back to default",
  );
  ok(slot.text.includes("Hosen") || slot.text.includes("slot.lowr"), "numeric component id resolves to a garment name", slot.text);

  const tex = run("sidecar::stderr", "Optimized C:\\p\\shirt_diff.ytd: 2048x2048/8388608B -> 1024x1024/2097152B");
  ok(
    tex.text.includes("shirt_diff.ytd") && tex.text.includes("2048×2048") && !tex.text.includes("C:\\"),
    "texture line keeps the file name and drops the path",
    tex.text,
  );

  const scan = run("sidecar::stderr", "Scanned C:\\assets\\pack: 412 entries, 3 warnings");
  ok(scan.text.includes('"n":412') && scan.text.includes('"warnings":3'), "scan counts extracted", scan.text);

  const anim = run("sidecar::stderr", "Animation wave resolved via anim@gen/wave (240 frames, 71 animated)");
  ok(anim.text.includes('"frames":240'), "animation frame count extracted", anim.text);
}

console.log("\nnoise suppression");
{
  ok(run("sidecar::stderr", "info: Atelier.Preview.Glb[0]").kind === "noise", ".NET formatter header is noise");
  ok(run("sidecar::stderr", "      at Feelgood.Atelier.Sidecar.Engine.Foo(String p) in C:\\x.cs:line 41").kind === "noise", "stack frame is noise");
  ok(
    run("sidecar::stderr", "      Request finished HTTP/1.1 POST http://127.0.0.1:1/parse/ytd - 200 12 application/json 9.5ms").kind === "noise",
    "ASP.NET request chatter is noise",
  );
  ok(run("sidecar::stderr", "CORS policy execution successful.").kind === "noise", "CORS chatter is noise");
  ok(run("sidecar::stderr", "Now listening on: http://127.0.0.1:51337").kind === "noise", "hosting banner is noise");
}

console.log("\nfallback + indentation");
{
  const unknown = run("sidecar::stderr", "      anim-skin comp3: geoms=2 verts=8421 weightless=0");
  ok(unknown.kind === "raw", "an unknown line is never hidden");
  ok(!unknown.text.startsWith(" "), "the .NET six-space indent is trimmed", JSON.stringify(unknown.text.slice(0, 12)));

  ok(sourceLabel("sidecar::stderr", fakeT) === "source.engine", "target column gets a friendly source name");
  ok(sourceLabel("webview", fakeT) === "source.app", "webview maps to the app");

  const cached = humanizeEntry(entry("sidecar", "sidecar ready port=1"), fakeT, "en");
  const again = humanizeEntry(entry("sidecar", "sidecar ready port=1"), fakeT, "en");
  ok(cached.text === again.text, "cache returns a stable result");
}

// ---------------------------------------------------------------------------
// 2. Locale coverage
// ---------------------------------------------------------------------------

console.log("\nlocale coverage");
{
  const flatten = (obj: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  const enKeys = new Set(flatten(en as Record<string, unknown>));
  const deKeys = new Set(flatten(de as Record<string, unknown>));

  const ruleKeys = [...__rules.WEBVIEW_RULES, ...__rules.APP_RULES, ...__rules.SIDECAR_RULES].map((r) => r.key);
  const missingEn = ruleKeys.filter((k) => !enKeys.has(k));
  const missingDe = ruleKeys.filter((k) => !deKeys.has(k));
  ok(missingEn.length === 0, "every rule key exists in en/logtext.json", missingEn.join(", "));
  ok(missingDe.length === 0, "every rule key exists in de/logtext.json", missingDe.join(", "));

  const onlyEn = [...enKeys].filter((k) => !deKeys.has(k));
  const onlyDe = [...deKeys].filter((k) => !enKeys.has(k));
  ok(onlyEn.length === 0, "no English-only keys", onlyEn.join(", "));
  ok(onlyDe.length === 0, "no German-only keys", onlyDe.join(", "));

  // Placeholders must line up or a translated line loses its numbers.
  const placeholders = (s: string) => (s.match(/\{\{(\w+)\}\}/gu) ?? []).sort().join(",");
  const walk = (a: Record<string, unknown>, b: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(a).flatMap(([k, v]) => {
      const other = b[k];
      if (v && typeof v === "object") return walk(v as Record<string, unknown>, (other ?? {}) as Record<string, unknown>, `${prefix}${k}.`);
      return typeof v === "string" && typeof other === "string" && placeholders(v) !== placeholders(other)
        ? [`${prefix}${k} (en: ${placeholders(v) || "—"} / de: ${placeholders(other) || "—"})`]
        : [];
    });
  const mismatched = walk(en as Record<string, unknown>, de as Record<string, unknown>);
  ok(mismatched.length === 0, "en and de use the same placeholders", mismatched.join("; "));
}

if (failures > 0) {
  console.log(`\n${failures} of ${checks} checks FAILED.`);
  throw new Error(`Log humanizer selftest failed (${failures} of ${checks}).`);
}
console.log(`\nAll ${checks} checks passed.\n`);
