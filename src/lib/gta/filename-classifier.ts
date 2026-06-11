/**
 * Heuristic classifier for GTA V addon-clothing file names.
 *
 * Ports the concepts from creative/lib/cloth-gta-filename.ts (grzyClothTool /
 * Durty naming, https://docs.gta.clothing/game-mechanics/files-naming):
 *  - ped/gender markers:   mp_m_freemode_01^…  /  mp_f_…  (or anywhere in name)
 *  - slot prefix:          jbib_ / uppr_ / p_head_ / …
 *  - drawable number:      jbib_000_u.ydd → 0
 *  - texture letter:       jbib_diff_000_a_uni.ytd → "a"   (also trailing "_a")
 *
 * Everything that cannot be classified stays `null` — the import pipeline
 * (lib/project/import-assets.ts) falls back to project defaults and the UI
 * asks the user for the missing pieces.
 */

import {
  ALL_SLOT_IDS,
  getSlotById,
  type SlotId,
  type SlotKind,
} from "@/lib/gta/components";
import type { Gender } from "@/lib/project/schema";

export type ClothingFileKind = "ydd" | "ytd" | "yld" | "other";
export type TextureMapKind = "diffuse" | "normal" | "specular";

export interface ClassifiedClothingFile {
  fileKind: ClothingFileKind;
  /** Lowercased file name with directory + `mp_…^` ped prefix stripped. */
  baseName: string;
  gender: Gender | null;
  kind: SlotKind | null;
  type: SlotId | null;
  /** Drawable number parsed from the name (e.g. jbib_000_u.ydd → 0). */
  drawableId: number | null;
  /** Texture variation letter "a".."z" (ytd only). */
  textureLetter: string | null;
  /** diffuse / normal / specular when a map token was found (ytd only). */
  textureMap: TextureMapKind | null;
}

/** Longest ids first so "p_head" wins over a hypothetical "p" prefix. */
const SLOT_ALTERNATION = [...ALL_SLOT_IDS]
  .sort((a, b) => b.length - a.length)
  .join("|");

const YDD_RE = new RegExp(
  `^(${SLOT_ALTERNATION})_(\\d{1,3})(?:_([a-z]))?\\.ydd$`,
);
const YLD_RE = new RegExp(`^(${SLOT_ALTERNATION})_(\\d{1,3})\\.yld$`);
// e.g. jbib_diff_000_a_uni.ytd / p_head_diff_002_a.ytd / uppr_n_001_b.ytd
const YTD_MAP_RE =
  /^([a-z0-9_]+?)_(diff|normal|spec|n|s)_(\d{1,3})_([a-z])(?:_[a-z0-9_]+)?\.ytd$/;
// e.g. jbib_000_a.ytd (drawable-style texture name without a map token)
const YTD_PLAIN_RE = new RegExp(
  `^(${SLOT_ALTERNATION})_(\\d{1,3})_([a-z])\\.ytd$`,
);
const TRAILING_LETTER_RE = /_([a-z])\.ytd$/;

const MAP_TOKEN_TO_KIND: Record<string, TextureMapKind> = {
  diff: "diffuse",
  normal: "normal",
  n: "normal",
  spec: "specular",
  s: "specular",
};

/** z. B. mp_m_freemode_01^jbib_000_u.ydd → jbib_000_u.ydd */
export function stripPedPrefix(fileName: string): string {
  const idx = fileName.indexOf("^");
  return idx === -1 ? fileName : fileName.slice(idx + 1);
}

/** Letter "a".."z" → texture index 0..25. */
export function textureLetterToIndex(letter: string): number {
  const code = letter.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
  return Math.max(0, Math.min(25, code));
}

/** Texture index 0..25 → letter "a".."z". */
export function textureIndexToLetter(index: number): string {
  return String.fromCharCode(
    "a".charCodeAt(0) + Math.max(0, Math.min(25, index)),
  );
}

function detectGender(lowerName: string): Gender | null {
  // Check female first: "mp_f" can never be a substring of "mp_m" and vice
  // versa, but explicit ordering keeps the intent obvious.
  if (lowerName.includes("mp_f")) return "female";
  if (lowerName.includes("mp_m")) return "male";
  return null;
}

function fileKindOf(lowerName: string): ClothingFileKind {
  if (lowerName.endsWith(".ydd")) return "ydd";
  if (lowerName.endsWith(".ytd")) return "ytd";
  if (lowerName.endsWith(".yld")) return "yld";
  return "other";
}

function slotInfo(slotId: string): { kind: SlotKind; type: SlotId } | null {
  const slot = getSlotById(slotId);
  return slot ? { kind: slot.kind, type: slot.id } : null;
}

/**
 * Classifies a clothing file by its name. Accepts absolute paths or bare file
 * names — only the last path segment is inspected.
 */
export function classifyClothingFilename(
  pathOrName: string,
): ClassifiedClothingFile {
  const fileName = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  const lower = fileName.trim().toLowerCase();
  const base = stripPedPrefix(lower);

  const result: ClassifiedClothingFile = {
    fileKind: fileKindOf(base),
    baseName: base,
    gender: detectGender(lower),
    kind: null,
    type: null,
    drawableId: null,
    textureLetter: null,
    textureMap: null,
  };

  if (result.fileKind === "ydd") {
    const m = YDD_RE.exec(base);
    if (m) {
      const slot = slotInfo(m[1]);
      if (slot) {
        result.kind = slot.kind;
        result.type = slot.type;
      }
      result.drawableId = Number.parseInt(m[2], 10);
    }
    return result;
  }

  if (result.fileKind === "yld") {
    const m = YLD_RE.exec(base);
    if (m) {
      const slot = slotInfo(m[1]);
      if (slot) {
        result.kind = slot.kind;
        result.type = slot.type;
      }
      result.drawableId = Number.parseInt(m[2], 10);
    }
    return result;
  }

  if (result.fileKind === "ytd") {
    const mapMatch = YTD_MAP_RE.exec(base);
    if (mapMatch) {
      const slot = slotInfo(mapMatch[1]);
      if (slot) {
        result.kind = slot.kind;
        result.type = slot.type;
      }
      result.drawableId = Number.parseInt(mapMatch[3], 10);
      result.textureLetter = mapMatch[4];
      result.textureMap = MAP_TOKEN_TO_KIND[mapMatch[2]] ?? null;
      return result;
    }

    const plainMatch = YTD_PLAIN_RE.exec(base);
    if (plainMatch) {
      const slot = slotInfo(plainMatch[1]);
      if (slot) {
        result.kind = slot.kind;
        result.type = slot.type;
      }
      result.drawableId = Number.parseInt(plainMatch[2], 10);
      result.textureLetter = plainMatch[3];
      result.textureMap = "diffuse";
      return result;
    }

    // Last resort: a trailing single-letter suffix still tells us the slot
    // letter (e.g. "my_custom_top_a.ytd" → "a").
    const trailing = TRAILING_LETTER_RE.exec(base);
    if (trailing) result.textureLetter = trailing[1];
    return result;
  }

  return result;
}
