/**
 * Add-drawable pipeline: takes absolute file paths (drag & drop / file dialog),
 * parses them through the sidecar (sha256 + mesh/texture stats), copies them
 * into `<projectDir>/assets/<gender>/<type>/` and returns ready
 * ProjectDrawable drafts for the store.
 *
 * Classification is name-based (lib/gta/filename-classifier.ts). Files that
 * cannot be classified fall back to the project defaults; a draft without a
 * resolvable slot keeps `type: null` and the caller must ask the user.
 */

import { copyFile, exists, mkdir, readFile } from "@tauri-apps/plugin-fs";
import { parseYdd, parseYtd } from "@/lib/sidecar/client";
import {
  classifyClothingFilename,
  type ClassifiedClothingFile,
} from "@/lib/gta/filename-classifier";
import { getSlotById, type SlotId } from "@/lib/gta/components";
import { ASSETS_DIR_NAME, joinPath } from "./io";
import {
  createDrawable,
  type AssetRef,
  type Gender,
  type ProjectDrawable,
} from "./schema";

/** Draft drawable — `type` may still be unresolved (caller asks the user). */
export interface DrawableDraft extends Omit<ProjectDrawable, "type"> {
  type: SlotId | null;
}

export interface ImportedDrawable {
  draft: DrawableDraft;
  /** True when the slot could not be classified — UI must ask before adding. */
  needsType: boolean;
  warnings: string[];
}

export interface ImportSkipped {
  path: string;
  reason: string;
}

export interface ImportAssetsResult {
  drawables: ImportedDrawable[];
  skipped: ImportSkipped[];
}

export interface ImportAssetsOptions {
  projectDir: string;
  /** Absolute paths of dropped/picked files (.ydd/.ytd/.yld). */
  filePaths: string[];
  /** Fallback gender when the file name carries no mp_m/mp_f marker. */
  defaultGender: Gender;
  /** Optional fallback slot (e.g. when dropping onto a slot category). */
  defaultType?: SlotId;
}

/** Folder name for assets whose slot is still unresolved. */
const UNSORTED_DIR = "unsorted";

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

/** sha256 of a local file, hashed in the webview (no sidecar endpoint needed). */
async function sha256OfFile(
  path: string,
): Promise<{ hash: string; size: number }> {
  const bytes = await readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { hash, size: bytes.byteLength };
}

/**
 * Copies `srcPath` into `<projectDir>/assets/<gender>/<typeFolder>/` and
 * returns the project-relative forward-slash path. Name collisions get a
 * numeric suffix (`jbib_000_u_1.ydd`).
 */
async function copyIntoAssets(
  projectDir: string,
  srcPath: string,
  gender: Gender,
  type: SlotId | null,
): Promise<string> {
  const typeFolder = type ?? UNSORTED_DIR;
  const destDir = joinPath(projectDir, ASSETS_DIR_NAME, gender, typeFolder);
  await mkdir(destDir, { recursive: true });

  const originalName = fileNameOf(srcPath);
  const dot = originalName.lastIndexOf(".");
  const stem = dot === -1 ? originalName : originalName.slice(0, dot);
  const ext = dot === -1 ? "" : originalName.slice(dot);

  let destName = originalName;
  for (let i = 1; await exists(joinPath(destDir, destName)); i++) {
    destName = `${stem}_${i}${ext}`;
  }

  await copyFile(srcPath, joinPath(destDir, destName));
  return `${ASSETS_DIR_NAME}/${gender}/${typeFolder}/${destName}`;
}

interface ClassifiedPath {
  path: string;
  classified: ClassifiedClothingFile;
}

/**
 * Group key for matching textures/physics to their drawable. mp_m and mp_f
 * packs reuse the same slot+number per gender, so the key includes the
 * gender marker ("any" when the file name carries none).
 */
function groupKeyOf(c: ClassifiedClothingFile): string | null {
  if (c.type === null || c.drawableId === null) return null;
  return `${c.gender ?? "any"}|${c.type}|${c.drawableId}`;
}

/** Lookup keys for a ydd: its resolved gender first, then unmarked files. */
function lookupKeysOf(
  c: ClassifiedClothingFile,
  resolvedGender: Gender,
): string[] {
  if (c.type === null || c.drawableId === null) return [];
  return [
    `${resolvedGender}|${c.type}|${c.drawableId}`,
    `any|${c.type}|${c.drawableId}`,
  ];
}

/**
 * Runs the import pipeline. Sidecar must be ready (parse calls throw a
 * readable German error otherwise — surface it via toast).
 */
export async function importAssetFiles(
  options: ImportAssetsOptions,
): Promise<ImportAssetsResult> {
  const { projectDir, defaultGender, defaultType } = options;

  const ydds: ClassifiedPath[] = [];
  const ytds: ClassifiedPath[] = [];
  const ylds: ClassifiedPath[] = [];
  const skipped: ImportSkipped[] = [];

  for (const path of options.filePaths) {
    const classified = classifyClothingFilename(path);
    switch (classified.fileKind) {
      case "ydd":
        ydds.push({ path, classified });
        break;
      case "ytd":
        ytds.push({ path, classified });
        break;
      case "yld":
        ylds.push({ path, classified });
        break;
      default:
        skipped.push({
          path,
          reason: "Dateityp wird nicht unterstützt (nur YDD, YTD, YLD).",
        });
    }
  }

  // Index textures/physics by (type, drawableId) so they attach to their ydd.
  const texturesByGroup = new Map<string, ClassifiedPath[]>();
  for (const ytd of ytds) {
    const key = groupKeyOf(ytd.classified);
    if (key === null) continue; // handled as leftover below
    const list = texturesByGroup.get(key) ?? [];
    list.push(ytd);
    texturesByGroup.set(key, list);
  }
  const physicsByGroup = new Map<string, ClassifiedPath>();
  for (const yld of ylds) {
    const key = groupKeyOf(yld.classified);
    if (key !== null && !physicsByGroup.has(key)) {
      physicsByGroup.set(key, yld);
    } else {
      skipped.push({
        path: yld.path,
        reason: "YLD konnte keinem Drawable zugeordnet werden.",
      });
    }
  }

  const drawables: ImportedDrawable[] = [];
  const claimedYtds = new Set<string>();
  const claimedYlds = new Set<string>();

  for (const ydd of ydds) {
    const warnings: string[] = [];
    const c = ydd.classified;

    const gender = c.gender ?? defaultGender;
    const type = c.type ?? defaultType ?? null;
    const kind =
      type !== null
        ? (getSlotById(type)?.kind ?? "component")
        : (c.kind ?? "component");

    let yddRef: AssetRef;
    try {
      const parsed = await parseYdd(ydd.path);
      const relPath = await copyIntoAssets(projectDir, ydd.path, gender, type);
      yddRef = { path: relPath, hash: parsed.sha256, size: parsed.sizeBytes };
    } catch (e) {
      skipped.push({
        path: ydd.path,
        reason: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // Matching textures, ordered by variation letter (array order == a,b,c…).
    const lookupKeys = lookupKeysOf(c, gender);
    const matching = lookupKeys
      .flatMap((key) => texturesByGroup.get(key) ?? [])
      .sort((a, b) =>
        (a.classified.textureLetter ?? "z").localeCompare(
          b.classified.textureLetter ?? "z",
        ),
      );

    const textures: AssetRef[] = [];
    for (const ytd of matching) {
      // Only diffuse maps become texture variations; normal/spec maps belong
      // to the embedded drawable textures and are skipped with a hint.
      if (
        ytd.classified.textureMap !== null &&
        ytd.classified.textureMap !== "diffuse"
      ) {
        claimedYtds.add(ytd.path);
        skipped.push({
          path: ytd.path,
          reason: "Normal-/Specular-Maps werden nicht als Variante importiert.",
        });
        continue;
      }
      if (textures.length >= 26) {
        claimedYtds.add(ytd.path);
        skipped.push({
          path: ytd.path,
          reason: "Maximal 26 Textur-Varianten pro Drawable (a–z).",
        });
        continue;
      }
      try {
        const parsed = await parseYtd(ytd.path);
        const relPath = await copyIntoAssets(projectDir, ytd.path, gender, type);
        textures.push({
          path: relPath,
          hash: parsed.sha256,
          size: parsed.sizeBytes,
        });
        claimedYtds.add(ytd.path);
      } catch (e) {
        claimedYtds.add(ytd.path);
        skipped.push({
          path: ytd.path,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (textures.length === 0) {
      warnings.push("Keine Texturen gefunden — Drawable hat noch keine Variante.");
    }

    // Optional physics file (.yld) for the same slot + drawable number.
    let physics: AssetRef | null = null;
    const yld = lookupKeys
      .map((key) => physicsByGroup.get(key))
      .find((entry) => entry !== undefined);
    if (yld && !claimedYlds.has(yld.path)) {
      claimedYlds.add(yld.path);
      try {
        const { hash, size } = await sha256OfFile(yld.path);
        const relPath = await copyIntoAssets(projectDir, yld.path, gender, type);
        physics = { path: relPath, hash, size };
      } catch (e) {
        skipped.push({
          path: yld.path,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (c.gender === null) {
      warnings.push(
        `Geschlecht nicht erkannt — Standard (${gender === "male" ? "Männlich" : "Weiblich"}) verwendet.`,
      );
    }

    const drawable = createDrawable({
      gender,
      kind,
      // `createDrawable` needs a concrete slot — drafts patch it back to null
      // below when unresolved.
      type: type ?? "jbib",
      label: stripExtension(c.baseName),
      ydd: yddRef,
      textures,
      physics,
    });

    drawables.push({
      draft: { ...drawable, type },
      needsType: type === null,
      warnings,
    });
  }

  // Leftover ytds/ylds that never matched a ydd in this batch.
  for (const ytd of ytds) {
    if (claimedYtds.has(ytd.path)) continue;
    skipped.push({
      path: ytd.path,
      reason: "Keine zugehörige YDD-Datei im Import gefunden.",
    });
  }
  for (const yld of physicsByGroup.values()) {
    if (claimedYlds.has(yld.path)) continue;
    skipped.push({
      path: yld.path,
      reason: "Keine zugehörige YDD-Datei im Import gefunden.",
    });
  }

  return { drawables, skipped };
}

// ---------------------------------------------------------------------------
// Single-file + pre-planned imports (texture panel / import wizard)
// ---------------------------------------------------------------------------

/**
 * Imports one .ytd as an additional texture variant of an existing drawable:
 * sidecar parse (sha256 + size) and copy into the drawable's asset folder.
 */
export async function importTextureFile(
  projectDir: string,
  filePath: string,
  gender: Gender,
  type: SlotId,
): Promise<AssetRef> {
  const parsed = await parseYtd(filePath);
  const relPath = await copyIntoAssets(projectDir, filePath, gender, type);
  return { path: relPath, hash: parsed.sha256, size: parsed.sizeBytes };
}

/**
 * One reviewed row of the import wizard: gender/type were confirmed by the
 * user, texture paths are already matched + ordered (a, b, c, …) by the
 * sidecar /import/scan endpoint — no filename re-classification happens here.
 */
export interface PlannedImportEntry {
  yddPath: string;
  /** Ordered texture variants (array order == a, b, c, …). */
  texturePaths: string[];
  yldPath: string | null;
  gender: Gender;
  type: SlotId;
  label: string;
}

export interface PlannedImportResult {
  drawables: ProjectDrawable[];
  skipped: ImportSkipped[];
}

/**
 * Imports pre-planned entries (import wizard). Per entry: parse + copy the
 * ydd, every texture (max 26) and the optional yld. A failing ydd skips the
 * whole entry; failing textures/ylds only drop that file.
 */
export async function importPlannedEntries(
  projectDir: string,
  entries: PlannedImportEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<PlannedImportResult> {
  const drawables: ProjectDrawable[] = [];
  const skipped: ImportSkipped[] = [];

  let done = 0;
  onProgress?.(0, entries.length);

  for (const entry of entries) {
    const kind = getSlotById(entry.type)?.kind ?? "component";

    let yddRef: AssetRef;
    try {
      const parsed = await parseYdd(entry.yddPath);
      const relPath = await copyIntoAssets(
        projectDir,
        entry.yddPath,
        entry.gender,
        entry.type,
      );
      yddRef = { path: relPath, hash: parsed.sha256, size: parsed.sizeBytes };
    } catch (e) {
      skipped.push({
        path: entry.yddPath,
        reason: e instanceof Error ? e.message : String(e),
      });
      onProgress?.(++done, entries.length);
      continue;
    }

    const textures: AssetRef[] = [];
    for (const texturePath of entry.texturePaths) {
      if (textures.length >= 26) {
        skipped.push({
          path: texturePath,
          reason: "Maximal 26 Textur-Varianten pro Drawable (a–z).",
        });
        continue;
      }
      try {
        textures.push(
          await importTextureFile(projectDir, texturePath, entry.gender, entry.type),
        );
      } catch (e) {
        skipped.push({
          path: texturePath,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let physics: AssetRef | null = null;
    if (entry.yldPath) {
      try {
        const { hash, size } = await sha256OfFile(entry.yldPath);
        const relPath = await copyIntoAssets(
          projectDir,
          entry.yldPath,
          entry.gender,
          entry.type,
        );
        physics = { path: relPath, hash, size };
      } catch (e) {
        skipped.push({
          path: entry.yldPath,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    drawables.push(
      createDrawable({
        gender: entry.gender,
        kind,
        type: entry.type,
        label: entry.label,
        ydd: yddRef,
        textures,
        physics,
      }),
    );
    onProgress?.(++done, entries.length);
  }

  return { drawables, skipped };
}
