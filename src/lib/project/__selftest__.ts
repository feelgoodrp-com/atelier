/**
 * Plain bun-runnable selftest for the pure project logic (NO tauri imports):
 *   bun run src/lib/project/__selftest__.ts   (or: bun run selftest:project)
 *
 * Covers: zod roundtrip of a sample project, filename classifier cases,
 * migrations, derived drawableIds + duplicate-map derivation and the
 * store-level reorder/undo behaviour (zustand/zundo run fine under bun).
 */

import { classifyClothingFilename } from "@/lib/gta/filename-classifier";
import { migrateProjectFile, ProjectMigrationError } from "./migrations";
import {
  atelierProjectSchema,
  createDrawable,
  createEmptyProject,
  suggestDlcName,
  type AtelierProject,
} from "./schema";
import {
  clearProjectHistory,
  selectDerivedDrawableIds,
  selectDrawablesBy,
  selectDuplicateYddMap,
  useProjectStore,
} from "@/lib/stores/project-store";
import {
  collectLocalAssets,
  fromRevisionDrawable,
  sanitizeExportName,
  toRevisionDrawable,
} from "@/lib/sync/revision-mapping";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function checkEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

function hash(fill: string): string {
  return fill.repeat(64 / fill.length).slice(0, 64);
}

// ---------------------------------------------------------------------------
console.log("\n[1] zod roundtrip");
// ---------------------------------------------------------------------------

const sample: AtelierProject = createEmptyProject("Feelgood Summer Pack");
sample.groups.push({ id: crypto.randomUUID(), name: "Jacken", color: "#5865F2" });
sample.drawables.push(
  createDrawable({
    gender: "male",
    kind: "component",
    type: "jbib",
    label: "jbib_000_u",
    groupId: sample.groups[0].id,
    ydd: { path: "assets/male/jbib/jbib_000_u.ydd", hash: hash("a"), size: 1234 },
    textures: [
      { path: "assets/male/jbib/jbib_diff_000_a_uni.ytd", hash: hash("b"), size: 99 },
      { path: "assets/male/jbib/jbib_diff_000_b_uni.ytd", hash: hash("c"), size: 88 },
    ],
  }),
  createDrawable({
    gender: "female",
    kind: "prop",
    type: "p_head",
    label: "p_head_002",
    mode: "replace",
    replaceTargetId: 12,
    flags: { hairScaleValue: 0.5 },
  }),
);

const roundtrip = atelierProjectSchema.safeParse(
  migrateProjectFile(JSON.parse(JSON.stringify(sample))),
);
check(
  "sample project validates",
  roundtrip.success,
  roundtrip.success ? undefined : JSON.stringify(roundtrip.error.issues[0]),
);
if (roundtrip.success) {
  checkEq("roundtrip is lossless", roundtrip.data, sample);
}

const badType = JSON.parse(JSON.stringify(sample)) as { drawables: { type: string }[] };
badType.drawables[0].type = "p_head"; // component drawable with prop slot
check(
  "kind/type mismatch is rejected",
  !atelierProjectSchema.safeParse(badType).success,
);

const badHash = JSON.parse(JSON.stringify(sample)) as {
  drawables: { ydd: { hash: string } }[];
};
badHash.drawables[0].ydd.hash = "nope";
check("invalid sha256 is rejected", !atelierProjectSchema.safeParse(badHash).success);

checkEq("suggestDlcName slugs", suggestDlcName("Feelgood Süßer-Pack 2!"), "feelgood_suesser_pack_2");

// ---------------------------------------------------------------------------
console.log("\n[2] migrations");
// ---------------------------------------------------------------------------

check("v1 passthrough", migrateProjectFile(JSON.parse(JSON.stringify(sample))) !== null);
let migrationThrew = false;
try {
  migrateProjectFile({ fgcloth: 99 });
} catch (e) {
  migrationThrew = e instanceof ProjectMigrationError;
}
check("unknown version throws ProjectMigrationError", migrationThrew);

// ---------------------------------------------------------------------------
console.log("\n[3] filename classifier");
// ---------------------------------------------------------------------------

const jbib = classifyClothingFilename("jbib_000_u.ydd");
checkEq(
  "jbib_000_u.ydd",
  [jbib.fileKind, jbib.kind, jbib.type, jbib.drawableId, jbib.gender],
  ["ydd", "component", "jbib", 0, null],
);

const male = classifyClothingFilename("mp_m_freemode_01^jbib_004_u.ydd");
checkEq(
  "mp_m ped prefix",
  [male.gender, male.type, male.drawableId, male.baseName],
  ["male", "jbib", 4, "jbib_004_u.ydd"],
);

const prop = classifyClothingFilename("p_head_002.ydd");
checkEq(
  "p_head_002.ydd is a prop",
  [prop.fileKind, prop.kind, prop.type, prop.drawableId],
  ["ydd", "prop", "p_head", 2],
);

const female = classifyClothingFilename("mp_f_freemode_01^lowr_015_r.ydd");
checkEq("mp_f marker", [female.gender, female.type, female.drawableId], ["female", "lowr", 15]);

const diff = classifyClothingFilename("jbib_diff_000_a_uni.ytd");
checkEq(
  "jbib_diff_000_a_uni.ytd",
  [diff.fileKind, diff.type, diff.drawableId, diff.textureLetter, diff.textureMap],
  ["ytd", "jbib", 0, "a", "diffuse"],
);

const propDiff = classifyClothingFilename("p_head_diff_002_b.ytd");
checkEq(
  "p_head_diff_002_b.ytd",
  [propDiff.kind, propDiff.type, propDiff.drawableId, propDiff.textureLetter],
  ["prop", "p_head", 2, "b"],
);

const normal = classifyClothingFilename("uppr_n_001_c_uni.ytd");
checkEq("normal map token", [normal.type, normal.textureMap, normal.textureLetter], ["uppr", "normal", "c"]);

const trailing = classifyClothingFilename("my_custom_top_a.ytd");
checkEq(
  "trailing letter fallback",
  [trailing.type, trailing.drawableId, trailing.textureLetter],
  [null, null, "a"],
);

const plain = classifyClothingFilename("jbib_000_a.ytd");
checkEq(
  "drawable-style ytd name",
  [plain.type, plain.drawableId, plain.textureLetter, plain.textureMap],
  ["jbib", 0, "a", "diffuse"],
);

const yld = classifyClothingFilename("feet_005.yld");
checkEq("feet_005.yld physics", [yld.fileKind, yld.type, yld.drawableId], ["yld", "feet", 5]);

const withPath = classifyClothingFilename("C:\\drop\\mp_m_freemode_01^accs_010_u.ydd");
checkEq("absolute path input", [withPath.gender, withPath.type], ["male", "accs"]);

checkEq("unsupported file", classifyClothingFilename("readme.txt").fileKind, "other");

// ---------------------------------------------------------------------------
console.log("\n[4] derived selectors");
// ---------------------------------------------------------------------------

const derived = createEmptyProject("derive");
const mk = (
  gender: "male" | "female",
  type: "jbib" | "p_head",
  mode: "addon" | "replace",
  yddHash: string | null,
) =>
  createDrawable({
    gender,
    kind: type === "jbib" ? "component" : "prop",
    type,
    mode,
    replaceTargetId: mode === "replace" ? 7 : null,
    label: `${gender}-${type}-${mode}`,
    ydd: yddHash ? { path: `assets/${yddHash}.ydd`, hash: yddHash, size: 1 } : null,
  });

const a1 = mk("male", "jbib", "addon", hash("1"));
const a2 = mk("male", "jbib", "addon", hash("2"));
const r1 = mk("male", "jbib", "replace", hash("1")); // duplicate of a1!
const f1 = mk("female", "jbib", "addon", hash("3"));
const p1 = mk("male", "p_head", "addon", null);
derived.drawables.push(a1, a2, r1, f1, p1);

const ids = selectDerivedDrawableIds(derived);
checkEq(
  "drawableId derives per (gender,type,mode) bucket",
  [ids[a1.id], ids[a2.id], ids[r1.id], ids[f1.id], ids[p1.id]],
  [0, 1, 0, 0, 0],
);

checkEq(
  "drawablesBy returns the gender+type bucket in order",
  selectDrawablesBy(derived, "male", "jbib").map((d) => d.id),
  [a1.id, a2.id, r1.id],
);

const duplicates = selectDuplicateYddMap(derived);
checkEq("duplicate map finds shared ydd hash", duplicates[hash("1")], [a1.id, r1.id]);
checkEq("unique hashes are not flagged", Object.keys(duplicates).length, 1);

// ---------------------------------------------------------------------------
console.log("\n[5] store mutations (reorder + undo)");
// ---------------------------------------------------------------------------

const store = useProjectStore.getState();
store.openProject("C:/tmp/selftest", createEmptyProject("store"));
clearProjectHistory();
store.addDrawable(a1);
store.addDrawable(a2);
store.addDrawable(p1); // different bucket — must keep its position

check("mutations mark the store dirty", useProjectStore.getState().dirty);

useProjectStore.getState().reorderDrawable(a2.id, 0);
checkEq(
  "reorder within the (gender,type) bucket",
  useProjectStore
    .getState()
    .project!.drawables.map((d) => d.id),
  [a2.id, a1.id, p1.id],
);

useProjectStore.temporal.getState().undo();
checkEq(
  "undo restores the previous order",
  useProjectStore
    .getState()
    .project!.drawables.map((d) => d.id),
  [a1.id, a2.id, p1.id],
);

const before = useProjectStore.getState().project!.updatedAt;
useProjectStore.getState().renameProject("store v2");
check(
  "actions bump updatedAt",
  useProjectStore.getState().project!.updatedAt >= before &&
    useProjectStore.getState().project!.name === "store v2",
);

// updateTexturesBatch: shared file path updates EVERY referencing drawable.
// NOT undoable — the .ytd was rewritten in place, so the action bypasses the
// history AND clears it (older snapshots reference the destroyed file state).
const sharedTexture = {
  path: "assets/male/jbib/shared_diff_000_a_uni.ytd",
  hash: hash("e"),
  size: 100,
};
useProjectStore.getState().setTextures(a1.id, [sharedTexture]);
useProjectStore.getState().setTextures(a2.id, [sharedTexture]);
const optimizedRef = { ...sharedTexture, hash: hash("f"), size: 40 };
useProjectStore
  .getState()
  .updateTexturesBatch([{ path: sharedTexture.path, next: optimizedRef }]);
checkEq(
  "updateTexturesBatch updates every drawable referencing the path",
  useProjectStore
    .getState()
    .project!.drawables.filter((d) => d.id === a1.id || d.id === a2.id)
    .map((d) => d.textures[0]),
  [optimizedRef, optimizedRef],
);
check(
  "updateTexturesBatch clears the undo history (disk state is gone)",
  useProjectStore.temporal.getState().pastStates.length === 0,
);
useProjectStore.temporal.getState().undo();
checkEq(
  "undo after updateTexturesBatch cannot restore stale hash refs",
  useProjectStore
    .getState()
    .project!.drawables.filter((d) => d.id === a1.id || d.id === a2.id)
    .map((d) => d.textures[0]),
  [optimizedRef, optimizedRef],
);

// ---------------------------------------------------------------------------
console.log("\n[6] cloud sync (revision mapping + batch store actions)");
// ---------------------------------------------------------------------------

const synced = mk("male", "jbib", "replace", hash("a"));
synced.textures = [
  { path: "assets/male/jbib/jbib_000_a.ytd", hash: hash("b"), size: 11 },
  { path: "assets/male/jbib/jbib_000_b.ytd", hash: hash("c"), size: 12 },
];
synced.physics = { path: "assets/male/jbib/jbib_000.yld", hash: hash("d"), size: 13 };
synced.groupId = crypto.randomUUID(); // not in the target project's groups

const revisionDrawable = toRevisionDrawable(synced);
checkEq(
  "toRevisionDrawable maps refs to sha256+size+exportName",
  revisionDrawable.ydd,
  { sha256: hash("a"), size: 1, exportName: `${hash("a")}.ydd` },
);
checkEq(
  "texture order survives the mapping (a, b, …)",
  revisionDrawable.textures.map((t) => t.exportName),
  ["jbib_000_a.ytd", "jbib_000_b.ytd"],
);
checkEq(
  "mode/replaceTargetId/flags survive the mapping",
  [revisionDrawable.mode, revisionDrawable.replaceTargetId, revisionDrawable.flags.highHeels],
  ["replace", 7, false],
);

const assetProject = createEmptyProject("assets");
assetProject.drawables.push(synced);
const localAssets = collectLocalAssets(assetProject);
checkEq("collectLocalAssets dedupes by hash", localAssets.size, 4);
checkEq("ytd kind derives from the extension", localAssets.get(hash("b"))!.kind, "ytd");
checkEq("yld kind derives from the extension", localAssets.get(hash("d"))!.kind, "yld");

const pathBySha = new Map<string, string>([
  [hash("a"), "assets/male/jbib/pulled.ydd"],
  [hash("b"), "assets/male/jbib/pulled_a.ytd"],
  [hash("c"), "assets/male/jbib/pulled_b.ytd"],
  [hash("d"), "assets/male/jbib/pulled.yld"],
]);
const roundtripped = fromRevisionDrawable(revisionDrawable, pathBySha, new Set());
checkEq("fromRevisionDrawable keeps the uuid", roundtripped.id, synced.id);
checkEq(
  "fromRevisionDrawable rebuilds local refs from the path map",
  roundtripped.ydd,
  { path: "assets/male/jbib/pulled.ydd", hash: hash("a"), size: 1 },
);
checkEq("unknown group references are dropped on pull", roundtripped.groupId, null);

const pulledProject = createEmptyProject("pulled");
pulledProject.drawables.push(roundtripped);
check(
  "pulled drawables still validate against the zod schema",
  atelierProjectSchema.safeParse(JSON.parse(JSON.stringify(pulledProject))).success,
);

checkEq(
  "sanitizeExportName strips path segments + illegal chars",
  sanitizeExportName("..\\evil:name.ydd", hash("a")),
  "evil_name.ydd",
);
checkEq(
  "sanitizeExportName falls back to the sha prefix",
  sanitizeExportName("///", hash("a")),
  hash("a").slice(0, 16),
);

// Batch store actions (pull pipeline) ----------------------------------------
clearProjectHistory();
const pulledSync = {
  remoteProjectId: "pack-1",
  baseRevision: 3,
  lastSyncedAt: new Date().toISOString(),
};
useProjectStore.getState().applyPulledState([roundtripped], pulledSync);
checkEq(
  "applyPulledState replaces drawables + sync block",
  [
    useProjectStore.getState().project!.drawables.map((d) => d.id),
    useProjectStore.getState().project!.sync.baseRevision,
  ],
  [[roundtripped.id], 3],
);
checkEq(
  "applyPulledState is ONE undo step",
  useProjectStore.temporal.getState().pastStates.length,
  1,
);
useProjectStore.temporal.getState().undo();
check(
  "undoing a pull restores drawables AND the old sync block",
  useProjectStore.getState().project!.drawables.length === 3 &&
    useProjectStore.getState().project!.sync.remoteProjectId === null,
);

clearProjectHistory();
useProjectStore.getState().replaceAllDrawables([a1, f1]);
checkEq(
  "replaceAllDrawables swaps the full array in ONE undo step",
  [
    useProjectStore.getState().project!.drawables.map((d) => d.id),
    useProjectStore.temporal.getState().pastStates.length,
  ],
  [[a1.id, f1.id], 1],
);

clearProjectHistory();
useProjectStore.getState().setSyncState(pulledSync);
checkEq(
  "setSyncState updates the sync block",
  useProjectStore.getState().project!.sync.remoteProjectId,
  "pack-1",
);
checkEq(
  "setSyncState records NO undo step",
  useProjectStore.temporal.getState().pastStates.length,
  0,
);

// ---------------------------------------------------------------------------
console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} check(s) FAILED, ${passed} passed.`);
  throw new Error(`Selftest failed:\n- ${failures.join("\n- ")}`);
}
console.log(`All ${passed} checks passed.`);
