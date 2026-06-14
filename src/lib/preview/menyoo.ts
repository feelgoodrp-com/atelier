/**
 * Menyoo XML import: maps Outfit- (<OutfitPedData>) and Spooner-Dateien
 * (<SpoonerPlacements>) to the PedAppearance contract + extras.
 * Format reference: .claude-research/menyoo-spec.md (the XML structure is a
 * file format / facts; NO MenyooSP code was copied — GPL).
 *
 * Deliberately built on a tiny tolerant XML reader instead of DOMParser:
 * - the bun selftest (CI gate) has no DOM,
 * - pugixml writes nameless TattooLogoDecals children as `<:anonymous …/>`,
 *   which strict XML parsers reject as an undefined namespace prefix.
 *
 * Robustness per spec: ISO-8859-1 OR UTF-8 bytes, BOM, hex (0x…) and decimal
 * ModelHash, sparse/unsorted _N children, "-1,-1" props, HeadFeatures
 * WasInArray, exponential floats, value clamps, unknown elements ignored.
 */

import i18n from "@/lib/i18n";
import {
  COMPONENT_SLOT_IDS,
  type ComponentSlotId,
  type PropSlotId,
} from "@/lib/gta/components";
import type {
  PedAppearance,
  PedAppearanceComponent,
  PedAppearanceProp,
  PedModel,
} from "@/lib/sidecar/types";
import {
  APPEARANCE_INDEX_MAX,
  EYE_COLOUR_UNSET,
  FACE_FEATURE_COUNT,
  OVERLAY_SLOT_COUNT,
  defaultExtras,
  normalizeAppearance,
  type PedAppearanceExtras,
} from "./appearance";

/** One importable ped found in the file (Spooner files may contain several). */
export interface MenyooPed {
  /** null = not a freemode model — indices may not match the preview body. */
  pedModel: PedModel | null;
  /** Display name (HashName) for the selection UI. */
  name: string;
  appearance: PedAppearance;
  extras: PedAppearanceExtras;
  /**
   * German FACE-RELEVANT per-ped warnings (clamped HeadBlend/overlay/eye
   * values …). These survive the FACE-ONLY import because the face IS applied.
   */
  warnings: string[];
  /**
   * German CLOTHING/PROP/MODEL warnings (unsupported component or prop slots,
   * out-of-range garment indices, non-freemode ModelHash …). The FACE-ONLY
   * import DROPS these — the clothing/props they refer to are deliberately not
   * applied, so surfacing them would only confuse (hard product rule: no
   * clothing/hair/prop/DLC warnings on import). Kept separate (not merged into
   * {@link warnings}) so a future "full import" path could still show them.
   */
  clothingWarnings: string[];
}

export interface MenyooParseResult {
  peds: MenyooPed[];
  /**
   * German file-level warnings (broken XML, no peds, …). These are import-
   * blocking / structural, NOT clothing-related, so they always surface.
   */
  warnings: string[];
}

// mp_m_freemode_01 / mp_f_freemode_01 joaat hashes (menyoo-spec.md §1).
const MP_M_HASH = 0x705e61f2;
const MP_F_HASH = 0x9c9effd8;

/** Menyoo PedProps slot -> contract anchor (3-5 and 9 are unused in GTA). */
const PROP_ANCHOR_BY_SLOT: Record<number, PropSlotId> = {
  0: "p_head",
  1: "p_eyes",
  2: "p_ears",
  6: "p_lwrist",
  7: "p_rwrist",
  8: "p_hip",
};

// ---------------------------------------------------------------------------
// Minimal tolerant XML reader
// ---------------------------------------------------------------------------

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (entity-decoded). */
  text: string;
}

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    switch (body) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

function isNameChar(ch: string): boolean {
  return ch !== "" && !/[\s/>=]/.test(ch);
}

/**
 * Parses a (machine-written) XML document to a tree; null on malformed input.
 * Tolerates prologs, comments, CDATA, DOCTYPE, `:`-prefixed names and
 * attributes in single or double quotes.
 */
function parseXml(input: string): XmlElement | null {
  const n = input.length;
  let i = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  const appendText = (text: string) => {
    const top = stack[stack.length - 1];
    if (top && text.length > 0) top.text += decodeEntities(text);
  };

  while (i < n) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      break; // trailing text outside any tag — ignore
    }
    appendText(input.slice(i, lt));

    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      if (end === -1) return null;
      i = end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt + 9);
      if (end === -1) return null;
      const top = stack[stack.length - 1];
      if (top) top.text += input.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (input.startsWith("<?", lt) || input.startsWith("<!", lt)) {
      const end = input.indexOf(">", lt);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    if (input.startsWith("</", lt)) {
      const end = input.indexOf(">", lt);
      if (end === -1) return null;
      const name = input.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) return null; // mismatched close tag
      if (stack.length === 0 && root === null) root = top;
      i = end + 1;
      continue;
    }

    // Opening tag.
    let p = lt + 1;
    const nameStart = p;
    while (p < n && isNameChar(input[p])) p++;
    const name = input.slice(nameStart, p);
    if (name.length === 0) return null;

    const element: XmlElement = { name, attributes: {}, children: [], text: "" };
    let selfClosing = false;
    for (;;) {
      while (p < n && /\s/.test(input[p])) p++;
      if (p >= n) return null;
      if (input[p] === ">") {
        p++;
        break;
      }
      if (input[p] === "/") {
        if (input[p + 1] !== ">") return null;
        selfClosing = true;
        p += 2;
        break;
      }
      // Attribute.
      const attrStart = p;
      while (p < n && isNameChar(input[p])) p++;
      const attrName = input.slice(attrStart, p);
      if (attrName.length === 0) return null;
      while (p < n && /\s/.test(input[p])) p++;
      let value = "";
      if (input[p] === "=") {
        p++;
        while (p < n && /\s/.test(input[p])) p++;
        const quote = input[p];
        if (quote === '"' || quote === "'") {
          const end = input.indexOf(quote, p + 1);
          if (end === -1) return null;
          value = decodeEntities(input.slice(p + 1, end));
          p = end + 1;
        } else {
          const valueStart = p;
          while (p < n && !/[\s/>]/.test(input[p])) p++;
          value = decodeEntities(input.slice(valueStart, p));
        }
      }
      element.attributes[attrName] = value;
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    if (selfClosing) {
      if (!parent && root === null) root = element;
    } else {
      stack.push(element);
    }
    i = p;
  }

  if (stack.length > 0) return null; // unclosed elements
  return root;
}

// ---------------------------------------------------------------------------
// Accessors / scalar parsing
// ---------------------------------------------------------------------------

function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

function textOf(el: XmlElement | undefined): string {
  return el?.text.trim() ?? "";
}

/** Children named `_<index>` — sparse and unsorted per spec. */
function indexedChildren(
  el: XmlElement | undefined,
): Array<{ index: number; el: XmlElement }> {
  if (!el) return [];
  return el.children.flatMap((c) => {
    const match = /^_(\d+)$/.exec(c.name);
    return match ? [{ index: Number.parseInt(match[1], 10), el: c }] : [];
  });
}

function parseBool(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return lower === "true" || lower === "1" || lower === "yes";
}

/** Tolerates exponential notation and a DE-locale comma decimal separator. */
function parseFloatLoose(text: string): number | null {
  let t = text.trim();
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  const value = Number.parseFloat(t);
  return Number.isFinite(value) ? value : null;
}

function parseIntLoose(text: string): number | null {
  const value = Number.parseInt(text.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/** "drawable,texture" pair; null when malformed. */
function parsePair(text: string): [number, number] | null {
  const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(text);
  if (!match) return null;
  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

/** ModelHash as unsigned 32-bit int — "0x…" hex, decimal or signed decimal. */
function parseModelHash(text: string): number | null {
  const t = text.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t.slice(2), 16);
  if (/^-?\d+$/.test(t)) {
    const value = Number.parseInt(t, 10);
    return value < 0 ? value + 0x100000000 : value;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Entity block -> MenyooPed
// ---------------------------------------------------------------------------

/** Tracks whether any value had to be clamped (one aggregated warning). */
class ClampTracker {
  clamped = false;
  int(text: string, min: number, max: number, fallback: number): number {
    const value = parseIntLoose(text);
    if (value === null) return fallback;
    const result = clamp(value, min, max);
    if (result !== value) this.clamped = true;
    return result;
  }
  float(text: string, min: number, max: number, fallback: number): number {
    const value = parseFloatLoose(text);
    if (value === null) return fallback;
    const result = clamp(value, min, max);
    if (result !== value) this.clamped = true;
    return result;
  }
}

function parseHeadFeatures(
  hf: XmlElement | undefined,
  track: ClampTracker,
): PedAppearanceExtras {
  const extras = defaultExtras();
  if (!hf) return extras;

  const blend = child(hf, "ShapeAndSkinTone");
  if (blend) {
    const id = (name: string) => track.int(textOf(child(blend, name)), 0, 45, 0);
    // Menyoo's UI allows -1..1 mixes and parent ids up to 46 — clamp to the
    // real game ranges (menyoo-spec.md §4).
    const mix = (name: string) =>
      track.float(textOf(child(blend, name)), 0, 1, 0);
    extras.headBlend = {
      shapeFatherId: id("ShapeFatherId"),
      shapeMotherId: id("ShapeMotherId"),
      shapeOverrideId: id("ShapeOverrideId"),
      toneFatherId: id("ToneFatherId"),
      toneMotherId: id("ToneMotherId"),
      toneOverrideId: id("ToneOverrideId"),
      shapeMix: mix("ShapeVal"),
      toneMix: mix("ToneVal"),
      overrideMix: mix("OverrideVal"),
      isParent: parseBool(textOf(child(blend, "IsP"))),
    };
  }

  // Hair/eye colour, features and overlays exist only when the ped was edited
  // in Menyoo's head-features menu (WasInArray="true") — defaults otherwise.
  if (!parseBool(hf.attributes["WasInArray"] ?? "")) return extras;

  extras.hairColour = track.int(textOf(child(hf, "HairColour")), 0, 63, 0);
  extras.hairHighlightColour = track.int(
    textOf(child(hf, "HairColourStreaks")),
    0,
    63,
    0,
  );
  // EyeColour: index 0 is a VALID eye colour, so an ABSENT/unparseable field
  // must map to the unset sentinel (255), NOT to 0 — otherwise a character
  // with eye colour 0 would be indistinguishable from "no eye colour set".
  // A present "0" stays 0 (the fallback is only returned when the text is
  // absent/unparseable, never via the clamp). Out-of-range (e.g. 32) still
  // clamps to 31 and flags the aggregated face warning.
  extras.eyeColour = track.int(
    textOf(child(hf, "EyeColour")),
    0,
    31,
    EYE_COLOUR_UNSET,
  );

  for (const { index, el } of indexedChildren(child(hf, "FacialFeatures"))) {
    if (index < 0 || index >= FACE_FEATURE_COUNT) continue;
    extras.faceFeatures[index] = track.float(textOf(el), -1, 1, 0);
  }

  // Overlays are the only place with ATTRIBUTE values; index 255 = off.
  for (const { index, el } of indexedChildren(child(hf, "Overlays"))) {
    if (index < 0 || index >= OVERLAY_SLOT_COUNT) continue;
    const overlayIndex = parseIntLoose(el.attributes["index"] ?? "");
    extras.overlays[index] = {
      index:
        overlayIndex !== null && overlayIndex >= 0 && overlayIndex !== 255
          ? overlayIndex
          : null,
      opacity: track.float(el.attributes["opacity"] ?? "", 0, 1, 1),
      colour: track.int(el.attributes["colour"] ?? "", 0, 63, 0),
      colourSecondary: track.int(
        el.attributes["colourSecondary"] ?? "",
        0,
        63,
        0,
      ),
    };
  }

  return extras;
}

/** Maps one entity block (OutfitPedData root or Placement) to a MenyooPed. */
function parseEntityPed(entity: XmlElement, fallbackName: string): MenyooPed | null {
  const pedProperties = child(entity, "PedProperties");
  if (!pedProperties) return null;

  // Face-relevant warnings (surface on the FACE-ONLY import) vs clothing/prop/
  // model warnings (dropped on import — the clothing they refer to is ignored).
  const warnings: string[] = [];
  const clothingWarnings: string[] = [];
  const track = new ClampTracker();

  const modelText = textOf(child(entity, "ModelHash"));
  const modelHash = parseModelHash(modelText);
  const pedModel: PedModel | null =
    modelHash === MP_M_HASH
      ? "mp_m_freemode_01"
      : modelHash === MP_F_HASH
        ? "mp_f_freemode_01"
        : null;
  if (pedModel === null) {
    // Purely about component-index matching — irrelevant for a face-only
    // import (no components are taken), so it goes to the clothing bucket.
    clothingWarnings.push(
      i18n.t("errors:menyoo.notFreemodePed", {
        hash: modelText || i18n.t("errors:menyoo.modelHashUnknown"),
      }),
    );
  }

  // PedComps/_N — slot index from the ELEMENT NAME, text "drawable,texture".
  const components: Partial<Record<ComponentSlotId, PedAppearanceComponent>> =
    {};
  for (const { index, el } of indexedChildren(child(pedProperties, "PedComps"))) {
    if (index < 0 || index >= COMPONENT_SLOT_IDS.length) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.unknownComponentSlot", { index }),
      );
      continue;
    }
    const pair = parsePair(textOf(el));
    if (!pair) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.componentSlotUnreadable", { index }),
      );
      continue;
    }
    const [drawable, rawTexture] = pair;
    if (drawable < 0) continue;
    const texture = Math.max(0, rawTexture);
    // Corrupt/hand-edited indices beyond any real inventory would 400 the
    // whole sidecar request (int32 overflow) — fall back to the slot default.
    if (drawable > APPEARANCE_INDEX_MAX || texture > APPEARANCE_INDEX_MAX) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.componentSlotOutOfRange", { index }),
      );
      continue;
    }
    // drawable 0 / texture 0 IS the game default — omitting it keeps the
    // canonical key (and thus the GLB cache) normalized.
    if (drawable === 0 && texture === 0) continue;
    components[COMPONENT_SLOT_IDS[index]] = { drawable, texture };
  }

  // PedProps/_N — "-1,-1" = empty slot; anchors per PROP_ANCHOR_BY_SLOT.
  const props: PedAppearanceProp[] = [];
  for (const { index, el } of indexedChildren(child(pedProperties, "PedProps"))) {
    const pair = parsePair(textOf(el));
    if (!pair) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.propSlotUnreadable", { index }),
      );
      continue;
    }
    const [drawable, rawTexture] = pair;
    if (drawable < 0) continue;
    const anchor = PROP_ANCHOR_BY_SLOT[index];
    if (!anchor) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.propSlotUnsupported", { index }),
      );
      continue;
    }
    const texture = Math.max(0, rawTexture);
    // Same upper-bound guard as components (sidecar int32 + 400 contract).
    if (drawable > APPEARANCE_INDEX_MAX || texture > APPEARANCE_INDEX_MAX) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.propSlotOutOfRange", { index }),
      );
      continue;
    }
    // Duplicate _N entries map to the same anchor — the sidecar rejects
    // duplicate anchors (400), so only the first one wins.
    if (props.some((p) => p.anchor === anchor)) {
      clothingWarnings.push(
        i18n.t("errors:menyoo.propSlotDuplicate", { index }),
      );
      continue;
    }
    props.push({ anchor, drawable, texture });
  }

  const extras = parseHeadFeatures(child(pedProperties, "HeadFeatures"), track);

  // TattooLogoDecals children are written WITHOUT a name by pugixml
  // (`<:anonymous …/>`) — iterate name-agnostically, keep raw hash strings.
  const tattoos: Array<{ collection: string; value: string }> = [];
  for (const decal of child(pedProperties, "TattooLogoDecals")?.children ?? []) {
    const collection = decal.attributes["collection"];
    const value = decal.attributes["value"];
    if (collection && value) tattoos.push({ collection, value });
  }
  if (tattoos.length > 0) extras.tattoos = tattoos;

  if (track.clamped) {
    // ClampTracker only fires on HEAD data (HeadBlend ids/mixes, hair/eye
    // colour, FacialFeatures, overlays) — the garment indices are guarded
    // separately above — so this is a face-relevant warning that survives the
    // face-only import.
    warnings.push(i18n.t("errors:menyoo.valuesClamped"));
  }

  return {
    pedModel,
    name: textOf(child(entity, "HashName")) || fallbackName,
    appearance: normalizeAppearance({ components, props }) ?? {},
    extras,
    warnings,
    clothingWarnings,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parses an already-decoded Menyoo XML string. */
export function parseMenyooXmlText(text: string): MenyooParseResult {
  const warnings: string[] = [];
  const root = parseXml(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!root) {
    return {
      peds: [],
      warnings: [i18n.t("errors:menyoo.notReadableXml")],
    };
  }

  const entities: XmlElement[] = [];
  if (root.name === "OutfitPedData") {
    entities.push(root);
  } else if (root.name === "SpoonerPlacements") {
    for (const placement of root.children.filter((c) => c.name === "Placement")) {
      // EntityType 1 = PED; vehicles (2) / props (3) have no PedProperties.
      const type = parseIntLoose(textOf(child(placement, "Type")));
      if (type !== null && type !== 1) continue;
      if (child(placement, "PedProperties")) entities.push(placement);
    }
  } else if (child(root, "PedProperties")) {
    // Unknown root — fall back to "looks like an entity block" detection.
    entities.push(root);
  } else {
    for (const c of root.children) {
      if (child(c, "PedProperties")) entities.push(c);
    }
    if (entities.length === 0) {
      warnings.push(i18n.t("errors:menyoo.unknownXmlFormat", { root: root.name }));
    }
  }

  const peds = entities.flatMap((entity, index) => {
    const ped = parseEntityPed(
      entity,
      i18n.t("errors:menyoo.pedFallbackName", { index: index + 1 }),
    );
    return ped ? [ped] : [];
  });
  if (peds.length === 0 && warnings.length === 0) {
    warnings.push(i18n.t("errors:menyoo.noPedWithProperties"));
  }
  return { peds, warnings };
}

/**
 * Decodes the raw file bytes (Tauri plugin-fs readFile): strict UTF-8 first,
 * ISO-8859-1 fallback — Menyoo declares ISO-8859-1, community files are often
 * re-encoded as UTF-8.
 */
export function decodeMenyooBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // ISO-8859-1: every byte maps 1:1 to the same code point.
    let out = "";
    const chunk = 0x2000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return out;
  }
}

/** Parses a Menyoo XML file from its raw bytes. */
export function parseMenyooXml(bytes: Uint8Array): MenyooParseResult {
  return parseMenyooXmlText(decodeMenyooBytes(bytes));
}
