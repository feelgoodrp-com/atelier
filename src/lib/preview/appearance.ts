/**
 * Pure ped-appearance helpers shared by the preview store, the Menyoo parser,
 * the character popover and the bun selftest — NO tauri/DOM imports.
 *
 * The canonical appearance key implemented here is a SHARED CONTRACT with the
 * sidecar (PedAppearance canonicalization in sidecar/Api): both sides must
 * produce byte-identical strings, they feed the GLB cache keys.
 */

import {
  isComponentSlotId,
  isPropSlotId,
  type ComponentSlotId,
} from "@/lib/gta/components";
import type {
  PedAppearance,
  PedAppearanceComponent,
  PedAppearanceProp,
  PedModel,
} from "@/lib/sidecar/types";

/** SET_PED_HEAD_BLEND_DATA arguments (Menyoo ShapeAndSkinTone) — stored only. */
export interface AppearanceHeadBlend {
  shapeFatherId: number;
  shapeMotherId: number;
  shapeOverrideId: number;
  toneFatherId: number;
  toneMotherId: number;
  toneOverrideId: number;
  /** 0 = 100% father, 1 = 100% mother. */
  shapeMix: number;
  toneMix: number;
  overrideMix: number;
  isParent: boolean;
}

/** One SET_PED_HEAD_OVERLAY slot — `index: null` = overlay off (Menyoo 255). */
export interface AppearanceOverlay {
  index: number | null;
  /** 0..1 */
  opacity: number;
  /** 0..63 (hair/makeup tint palette index). */
  colour: number;
  colourSecondary: number;
}

export const OVERLAY_SLOT_COUNT = 13;
export const FACE_FEATURE_COUNT = 20;

/**
 * Upper bound for drawable/texture/alt indices (shared with the Menyoo
 * parser): real GTA inventories stay far below it, while corrupt or
 * hand-edited values beyond int32 would 400 the whole sidecar request
 * (PedAppearanceComponentDto is an int). Entries above the bound are dropped
 * to the slot default instead.
 */
export const APPEARANCE_INDEX_MAX = 4095;

/**
 * Head features parsed from a Menyoo XML. Stored in presets from day one but
 * NOT rendered yet (texture compositing / geometry morph come in Stufe 2b/3).
 */
export interface PedAppearanceExtras {
  headBlend: AppearanceHeadBlend | null;
  /** Exactly {@link OVERLAY_SLOT_COUNT} entries (slot id = array index). */
  overlays: AppearanceOverlay[];
  /** 0..63 — hair TINT colour (the hair STYLE is components.hair). */
  hairColour: number;
  hairHighlightColour: number;
  /** 0..31 */
  eyeColour: number;
  /** Exactly {@link FACE_FEATURE_COUNT} micro-morph values, each -1..1. */
  faceFeatures: number[];
  /** TattooLogoDecals collection/value hashes — export-roundtrip only. */
  tattoos?: Array<{ collection: string; value: string }>;
}

/** Named appearance preset (character popover). */
export interface AppearancePreset {
  name: string;
  /** Gender the preset was authored for (null = either). */
  pedModel: PedModel | null;
  /**
   * null = default clothing — valid for "face only" presets that carry their
   * payload exclusively in {@link extras} (e.g. a Menyoo character export
   * whose PedComps are all "0,0").
   */
  appearance: PedAppearance | null;
  extras: PedAppearanceExtras | null;
}

/** Extras object representing the untouched game default. */
export function defaultExtras(): PedAppearanceExtras {
  return {
    headBlend: null,
    overlays: Array.from({ length: OVERLAY_SLOT_COUNT }, () => ({
      index: null,
      opacity: 1,
      colour: 0,
      colourSecondary: 0,
    })),
    hairColour: 0,
    hairHighlightColour: 0,
    eyeColour: 0,
    faceFeatures: new Array<number>(FACE_FEATURE_COUNT).fill(0),
  };
}

/**
 * Canonical appearance key — SHARED CONTRACT with the sidecar
 * (PedAppearanceKey.Canonical in sidecar/Api/Dtos.cs, byte-identical):
 * component entries that are EXACTLY the ped default (drawable=0, texture=0,
 * alt 0/absent) are skipped; the rest is sorted alphabetically as
 * "slot=drawable:texture" joined with ",", then "|", then props sorted
 * alphabetically as "anchor=drawable:texture" joined with ","; `alt` is
 * appended as ":a<alt>" ONLY when != 0; empty/null appearance — including one
 * where every component was skipped and no props remain — -> "default".
 * Example: "hair=2:1,jbib=5:0|p_head=1:0".
 */
export function appearanceKey(
  appearance: PedAppearance | null | undefined,
): string {
  if (!appearance) return "default";
  const components = Object.entries(appearance.components ?? {})
    // All-default normalization (shared contract): drawable=0/texture=0/alt=0
    // IS the ped default, so it must not create a distinct key.
    .filter(
      ([, c]) => c.drawable !== 0 || c.texture !== 0 || (c.alt ?? 0) !== 0,
    )
    .map(
      ([slot, c]) =>
        `${slot}=${c.drawable}:${c.texture}${c.alt ? `:a${c.alt}` : ""}`,
    )
    .sort()
    .join(",");
  const props = (appearance.props ?? [])
    .map((p) => `${p.anchor}=${p.drawable}:${p.texture}`)
    .sort()
    .join(",");
  if (components === "" && props === "") return "default";
  return `${components}|${props}`;
}

/** Drops empty components/props blocks; null when nothing is left. */
export function normalizeAppearance(
  appearance: PedAppearance | null,
): PedAppearance | null {
  if (!appearance) return null;
  const components = appearance.components ?? {};
  const props = appearance.props ?? [];
  const hasComponents = Object.keys(components).length > 0;
  if (!hasComponents && props.length === 0) return null;
  return {
    ...(hasComponents ? { components } : {}),
    ...(props.length > 0 ? { props } : {}),
  };
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates an untrusted appearance blob (persisted localStorage state) —
 * unknown slots/anchors, malformed entries, indices beyond
 * {@link APPEARANCE_INDEX_MAX} and duplicate prop anchors are dropped, never
 * thrown (out-of-bound values would 400 the sidecar request, duplicate
 * anchors are rejected there too).
 */
export function sanitizeAppearance(value: unknown): PedAppearance | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { components?: unknown; props?: unknown };
  const inRange = (n: number) => n >= 0 && n <= APPEARANCE_INDEX_MAX;

  const components: Partial<Record<ComponentSlotId, PedAppearanceComponent>> =
    {};
  if (typeof raw.components === "object" && raw.components !== null) {
    for (const [slot, entry] of Object.entries(raw.components)) {
      if (!isComponentSlotId(slot)) continue;
      if (typeof entry !== "object" || entry === null) continue;
      const c = entry as Record<string, unknown>;
      const drawable = asInt(c.drawable);
      const texture = asInt(c.texture);
      if (
        drawable === null ||
        texture === null ||
        !inRange(drawable) ||
        !inRange(texture)
      )
        continue;
      const alt = asInt(c.alt);
      components[slot] = {
        drawable,
        texture,
        ...(alt !== null && alt > 0 && alt <= APPEARANCE_INDEX_MAX
          ? { alt }
          : {}),
      };
    }
  }

  const props: PedAppearanceProp[] = [];
  const seenAnchors = new Set<string>();
  if (Array.isArray(raw.props)) {
    for (const entry of raw.props) {
      if (typeof entry !== "object" || entry === null) continue;
      const p = entry as Record<string, unknown>;
      const drawable = asInt(p.drawable);
      const texture = asInt(p.texture);
      if (typeof p.anchor !== "string" || !isPropSlotId(p.anchor)) continue;
      if (
        drawable === null ||
        texture === null ||
        !inRange(drawable) ||
        !inRange(texture)
      )
        continue;
      if (seenAnchors.has(p.anchor)) continue; // duplicate anchor -> sidecar 400
      seenAnchors.add(p.anchor);
      props.push({ anchor: p.anchor, drawable, texture });
    }
  }

  return normalizeAppearance({
    ...(Object.keys(components).length > 0 ? { components } : {}),
    ...(props.length > 0 ? { props } : {}),
  });
}

function asClampedNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

/** Validates untrusted extras (persisted state) — rebuilt with exact shapes. */
export function sanitizeAppearanceExtras(
  value: unknown,
): PedAppearanceExtras | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const extras = defaultExtras();

  if (typeof raw.headBlend === "object" && raw.headBlend !== null) {
    const hb = raw.headBlend as Record<string, unknown>;
    const id = (v: unknown) => clamp(asInt(v) ?? 0, 0, 45);
    const mix = (v: unknown) => asClampedNumber(v, 0, 1, 0);
    extras.headBlend = {
      shapeFatherId: id(hb.shapeFatherId),
      shapeMotherId: id(hb.shapeMotherId),
      shapeOverrideId: id(hb.shapeOverrideId),
      toneFatherId: id(hb.toneFatherId),
      toneMotherId: id(hb.toneMotherId),
      toneOverrideId: id(hb.toneOverrideId),
      shapeMix: mix(hb.shapeMix),
      toneMix: mix(hb.toneMix),
      overrideMix: mix(hb.overrideMix),
      isParent: hb.isParent === true,
    };
  }

  if (Array.isArray(raw.overlays)) {
    for (let slot = 0; slot < OVERLAY_SLOT_COUNT; slot++) {
      const entry = raw.overlays[slot];
      if (typeof entry !== "object" || entry === null) continue;
      const o = entry as Record<string, unknown>;
      const index = asInt(o.index);
      extras.overlays[slot] = {
        index: index !== null && index >= 0 && index !== 255 ? index : null,
        opacity: asClampedNumber(o.opacity, 0, 1, 1),
        colour: clamp(asInt(o.colour) ?? 0, 0, 63),
        colourSecondary: clamp(asInt(o.colourSecondary) ?? 0, 0, 63),
      };
    }
  }

  extras.hairColour = clamp(asInt(raw.hairColour) ?? 0, 0, 63);
  extras.hairHighlightColour = clamp(asInt(raw.hairHighlightColour) ?? 0, 0, 63);
  extras.eyeColour = clamp(asInt(raw.eyeColour) ?? 0, 0, 31);

  if (Array.isArray(raw.faceFeatures)) {
    for (let i = 0; i < FACE_FEATURE_COUNT; i++) {
      extras.faceFeatures[i] = asClampedNumber(raw.faceFeatures[i], -1, 1, 0);
    }
  }

  if (Array.isArray(raw.tattoos)) {
    const tattoos = raw.tattoos.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const t = entry as Record<string, unknown>;
      return typeof t.collection === "string" && typeof t.value === "string"
        ? [{ collection: t.collection, value: t.value }]
        : [];
    });
    if (tattoos.length > 0) extras.tattoos = tattoos;
  }

  return extras;
}

function isPedModel(value: unknown): value is PedModel {
  return value === "mp_m_freemode_01" || value === "mp_f_freemode_01";
}

/** Validates the persisted preset list (drops broken/builtin-shadowing rows). */
export function sanitizeAppearancePresets(value: unknown): AppearancePreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const presets: AppearancePreset[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const p = entry as Record<string, unknown>;
    if (typeof p.name !== "string") continue;
    const name = p.name.trim().slice(0, 64);
    if (name.length === 0) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower) || isStandardPresetName(name)) continue;
    const appearance = sanitizeAppearance(p.appearance);
    const extras = sanitizeAppearanceExtras(p.extras);
    // "Face only" presets (appearance=null, payload in extras) are valid —
    // only presets carrying NOTHING are dropped.
    if (!appearance && !hasUnrenderedExtras(extras)) continue;
    seen.add(lower);
    presets.push({
      name,
      pedModel: isPedModel(p.pedModel) ? p.pedModel : null,
      appearance,
      extras,
    });
  }
  return presets;
}

/** True when the extras carry anything the preview cannot show yet. */
export function hasUnrenderedExtras(
  extras: PedAppearanceExtras | null,
): boolean {
  if (!extras) return false;
  return (
    extras.headBlend !== null ||
    extras.overlays.some((o) => o.index !== null) ||
    extras.hairColour > 0 ||
    extras.hairHighlightColour > 0 ||
    extras.eyeColour > 0 ||
    extras.faceFeatures.some((f) => f !== 0) ||
    (extras.tattoos?.length ?? 0) > 0
  );
}

/**
 * Curated built-in presets ("hübscher" default with ONE click) — every index
 * is inside the base-game inventory (EnableDlc=false) verified by the live
 * asset probe, so they render without fallback warnings. Not deletable, not
 * persisted (they live here, the store only keeps user presets).
 */
export const STANDARD_APPEARANCE_PRESETS: ReadonlyArray<AppearancePreset> = [
  {
    name: "Standard (männlich)",
    pedModel: "mp_m_freemode_01",
    appearance: {
      components: {
        hair: { drawable: 2, texture: 1 },
        uppr: { drawable: 1, texture: 0 },
        lowr: { drawable: 1, texture: 0 },
        feet: { drawable: 1, texture: 0 },
        accs: { drawable: 2, texture: 0 },
        jbib: { drawable: 5, texture: 0 },
      },
    },
    extras: null,
  },
  {
    name: "Standard (weiblich)",
    pedModel: "mp_f_freemode_01",
    appearance: {
      components: {
        hair: { drawable: 2, texture: 1 },
        uppr: { drawable: 1, texture: 0 },
        lowr: { drawable: 1, texture: 0 },
        feet: { drawable: 1, texture: 0 },
        jbib: { drawable: 5, texture: 0 },
      },
    },
    extras: null,
  },
];

/** Case-insensitive check against the built-in preset names. */
export function isStandardPresetName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return STANDARD_APPEARANCE_PRESETS.some(
    (p) => p.name.toLowerCase() === lower,
  );
}
