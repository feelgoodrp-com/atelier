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
  PedAppearanceFace,
  PedAppearanceOverlay as PedAppearanceFaceOverlay,
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

/** Inclusive head-blend parent/override id bound (SET_PED_HEAD_BLEND_DATA). */
export const FACE_BLEND_ID_MAX = 45;
/** Inclusive overlay variation index bound (255 = off, dropped before send). */
export const OVERLAY_INDEX_MAX = 255;
/** Inclusive overlay/hair tint palette bound. */
export const OVERLAY_COLOUR_MAX = 63;
/** Inclusive eye-colour atlas row bound. */
export const EYE_COLOUR_MAX = 31;
/**
 * Sentinel for "eye colour not set" in {@link PedAppearanceExtras.eyeColour}.
 * Index 0 is a VALID eye-colour tile (menyoo-spec.md §4: game data 0..31), so
 * it must NOT double as "unset" — only a missing/255 field means unset. 255
 * mirrors the game's GET_PED_*-returns-255-when-unset convention and stays out
 * of the 0..31 atlas range. extrasToFace/sanitize treat 0..31 as a real index
 * and anything else (255 / out of range) as unset (no eye colour in the key).
 */
export const EYE_COLOUR_UNSET = 255;

/**
 * Vertical scene lift (meters, glTF up = Y) applied to the WHOLE preview scene
 * — ped body + every garment — when a rendered feet item has highHeels=true.
 * SHARED CONTRACT with the sidecar (used 1:1 as the yLift transform): the
 * client sends this numeric value as `heelLift`, the sidecar offsets every
 * vertex's Y by it. The schema carries no real heel height (highHeels is a
 * bool), so this is a deliberate fixed constant (~grzy UI 1.0 / 10 ≈ 0.1 m).
 * If a real height field is ever added it replaces this constant in ONE place.
 */
export const HEEL_LIFT_M = 0.08;

/** True when an extras eye-colour value is a real atlas index (0..31), not unset. */
function isEyeColourSet(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= EYE_COLOUR_MAX;
}

/**
 * Head-overlay slots that carry a tint colour. MUST match the sidecar's
 * tintable slots (FaceCalibration.Slots with Tintable=true) so both sides
 * agree which overlays forward colour into the face block / canonical key:
 *   beard (1) + eyebrows (2) + chest hair (10)  -> hair palette  (ColourType 1)
 *   makeup (4) + blush (5) + lipstick (8)        -> makeup palette (Menyoo
 *     derives makeup as ColourType 1, blush/lipstick as 2 — both tinted).
 * This mirrors GetPedHeadOverlayColourType (menyoo-spec.md §1.e/§3): everything
 * except 0/3/6/7/9/11/12 is tinted. Slot 4 (makeup) was missing before — it is
 * a tinted slot per the spec, so an imported makeup colour is now kept. The
 * remaining overlays (blemishes, ageing, complexion, sun damage, moles, body
 * blemishes) ignore tint, so sending it would only bloat the canonical key.
 */
export const OVERLAY_TINTED_SLOTS: ReadonlySet<number> = new Set([
  1, 2, 4, 5, 8, 10,
]);

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
  /**
   * i18n key for built-in presets ("preview:presets.*") — rendered at display
   * time instead of {@link name}, which stays the STABLE identity (lookups,
   * isStandardPresetName, persisted user-preset shadowing). User presets carry
   * no key and render their literal {@link name}.
   */
  nameKey?: string;
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
    // 255 = unset (index 0 is a real eye colour, so it can't be the default).
    eyeColour: EYE_COLOUR_UNSET,
    faceFeatures: new Array<number>(FACE_FEATURE_COUNT).fill(0),
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Maps the stored Menyoo {@link PedAppearanceExtras} to the RENDERED
 * {@link PedAppearanceFace} block — SHARED CONTRACT mapping:
 *   ShapeFatherId   -> shapeFirst    ShapeMotherId  -> shapeSecond
 *   ShapeOverrideId -> shapeThird    ShapeVal       -> shapeMix
 *   OverrideVal     -> thirdMix
 *   ToneFatherId    -> skinFirst     ToneMotherId   -> skinSecond
 *   ToneOverrideId  -> skinThird     ToneVal        -> skinMix
 *   overlays[slot]  -> overlays (only index != 255 / non-null; colour +
 *     colourSecondary ONLY for {@link OVERLAY_TINTED_SLOTS} brow/beard/makeup)
 *   eyeColour       -> eyeColour
 * FaceFeatures are DELIBERATELY excluded — they need engine micro-morph assets
 * the preview cannot honestly render, so they remain stored-only in extras.
 * HairColour is NOT applied either (the hair STYLE is a tool-set component).
 * Returns null when there is no head blend AND no active overlay AND no eye
 * colour, i.e. nothing the face renderer could show.
 */
export function extrasToFace(
  extras: PedAppearanceExtras | null,
): PedAppearanceFace | null {
  if (!extras) return null;

  const overlays: PedAppearanceFaceOverlay[] = [];
  for (let slot = 0; slot < extras.overlays.length; slot++) {
    const o = extras.overlays[slot];
    // index null / 255 = overlay off — never sent (mirrors the key contract).
    if (o.index === null) continue;
    const tinted = OVERLAY_TINTED_SLOTS.has(slot);
    overlays.push({
      slot,
      index: clampInt(o.index, 0, OVERLAY_INDEX_MAX),
      opacity: clamp(o.opacity, 0, 1),
      // Only tinted slots forward colour — others ignore it (key + bytes).
      ...(tinted
        ? {
            colour: clampInt(o.colour, 0, OVERLAY_COLOUR_MAX),
            colourSecondary: clampInt(o.colourSecondary, 0, OVERLAY_COLOUR_MAX),
          }
        : {}),
    });
  }

  const blend = extras.headBlend;
  // Index 0 is a valid eye colour — only 255/out-of-range means "unset".
  const eyeColour = isEyeColourSet(extras.eyeColour)
    ? extras.eyeColour
    : undefined;

  // Nothing renderable -> no face block (keeps the key at "default").
  if (!blend && overlays.length === 0 && eyeColour === undefined) return null;

  const face: PedAppearanceFace = blend
    ? {
        shapeFirst: clampInt(blend.shapeFatherId, 0, FACE_BLEND_ID_MAX),
        shapeSecond: clampInt(blend.shapeMotherId, 0, FACE_BLEND_ID_MAX),
        shapeThird: clampInt(blend.shapeOverrideId, 0, FACE_BLEND_ID_MAX),
        shapeMix: clamp(blend.shapeMix, 0, 1),
        thirdMix: clamp(blend.overrideMix, 0, 1),
        skinFirst: clampInt(blend.toneFatherId, 0, FACE_BLEND_ID_MAX),
        skinSecond: clampInt(blend.toneMotherId, 0, FACE_BLEND_ID_MAX),
        skinThird: clampInt(blend.toneOverrideId, 0, FACE_BLEND_ID_MAX),
        skinMix: clamp(blend.toneMix, 0, 1),
      }
    : // Overlays/eye colour without an explicit head blend: send the neutral
      // default blend so the sidecar still applies the overlays/eyes.
      {
        shapeFirst: 0,
        shapeSecond: 0,
        shapeThird: 0,
        shapeMix: 0,
        thirdMix: 0,
        skinFirst: 0,
        skinSecond: 0,
        skinThird: 0,
        skinMix: 0,
      };

  return {
    ...face,
    ...(overlays.length > 0 ? { overlays } : {}),
    ...(eyeColour !== undefined ? { eyeColour } : {}),
  };
}

/**
 * Invariant 2-decimal formatting — SHARED CONTRACT with the sidecar
 * (PedAppearanceKey.F2 in sidecar/Api/Dtos.cs, byte-identical). We DO NOT use
 * `toFixed(2)` / `float.ToString("0.00")` directly: those round a JS 64-bit
 * double resp. a C# 32-bit float and diverge at .xx5 half-steps (48 values
 * across 0.000..1.000, e.g. 0.015 -> JS "0.01" / C# "0.02"). Instead BOTH
 * sides quantize to whole hundredths and build the 2-decimal string
 * DETERMINISTICALLY from that integer, so no float formatter is left to
 * disagree. Two things make the integer identical on both sides:
 *   1. The sidecar's DTO field is a 32-bit `float`; the same logical value is
 *      a 64-bit double here. So we `Math.fround` FIRST to collapse to the
 *      exact 32-bit value the sidecar will receive (and again on `v*100`, to
 *      mirror C#'s `(float)v * 100f`), THEN round-half-away-from-zero — which
 *      `Math.round` is for the non-negative inputs here, == MidpointRounding.
 *      AwayFromZero in C#.
 *   2. n = round(clamp(v,0,1)*100) in 0..100 -> "<n/100>.<two digits of n%100>".
 * Verified byte-identical to F2 across 0.000..1.000 (step 0.001).
 * Examples: 0.005 -> "0.01", 0.50 -> "0.50", 1 -> "1.00".
 *
 * Exported so the preview store reuses the EXACT same quantization for the
 * hairScale cache-key segment — re-implementing it there would risk a silent
 * divergence from the sidecar's F2.
 */
export function f2(value: number): string {
  const n = f2Hundredths(value); // 0..100, mirrors (float)v*100f
  const whole = (n / 100) | 0; // 0 or 1
  const frac = n % 100; // 0..99
  return `${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

/**
 * The shared 0..100 integer behind {@link f2}: collapse to the 32-bit float the
 * sidecar holds, clamp to [0,1] (also collapses -0 -> 0 so it can never escape
 * 0..100), then round (float)v*100f.
 */
function f2Hundredths(value: number): number {
  const f = Math.fround(value);
  const v = f > 0 ? (f < 1 ? f : 1) : 0;
  return Math.round(Math.fround(v * 100));
}

/**
 * Numeric F2-quantization of a 0..1 preview scale: the float value the client
 * must SEND so the rendered mesh matches its {@link f2} cache-key bucket. The
 * sidecar transforms with the raw request value, so the request and the key
 * would otherwise disagree for sub-0.01 inputs (two values in one F2 bucket key
 * the same but render differently). Quantizing here BEFORE building both the
 * request body and the key keeps render-value == key-value. Idempotent:
 * f2(quantizeScale(x)) === f2(x).
 */
export function quantizeScale(value: number): number {
  return f2Hundredths(value) / 100;
}

/**
 * Canonical face-key segment — SHARED CONTRACT with the sidecar
 * (PedAppearanceFaceKey in sidecar/Api/Dtos.cs, byte-identical). Layout:
 *   f=<shapeFirst>:<shapeSecond>:<shapeThird>:<shapeMix>:<thirdMix>,
 *   k=<skinFirst>:<skinSecond>:<skinThird>:<skinMix>,
 *   o<slot>=<index>:<opacity>:<colour|->:<colourSecondary|->  (ascending slot,
 *     active slots only — index 255 entries are dropped before this point),
 *   e=<eyeColour|->
 * All mix/opacity floats use {@link f2} ("0.00"); a missing colour/eyeColour
 * renders as "-". The whole segment is prefixed with "|" by the caller; an
 * absent face block appends NOTHING, so Stufe-1 keys stay byte-identical.
 */
function faceKeySegment(face: PedAppearanceFace): string {
  const parts = [
    `f=${face.shapeFirst}:${face.shapeSecond}:${face.shapeThird}:${f2(
      face.shapeMix,
    )}:${f2(face.thirdMix)}`,
    `k=${face.skinFirst}:${face.skinSecond}:${face.skinThird}:${f2(
      face.skinMix,
    )}`,
  ];
  const overlays = [...(face.overlays ?? [])].sort((a, b) => a.slot - b.slot);
  for (const o of overlays) {
    const colour = o.colour ?? null;
    const colourSecondary = o.colourSecondary ?? null;
    parts.push(
      `o${o.slot}=${o.index}:${f2(o.opacity)}:${colour ?? "-"}:${
        colourSecondary ?? "-"
      }`,
    );
  }
  parts.push(`e=${face.eyeColour ?? "-"}`);
  return parts.join(",");
}

/**
 * Canonical appearance key — SHARED CONTRACT with the sidecar
 * (PedAppearanceKey.Canonical in sidecar/Api/Dtos.cs, byte-identical):
 * component entries that are EXACTLY the ped default (drawable=0, texture=0,
 * alt 0/absent) are skipped; the rest is sorted alphabetically as
 * "slot=drawable:texture" joined with ",", then "|", then props sorted
 * alphabetically as "anchor=drawable:texture" joined with ","; `alt` is
 * appended as ":a<alt>" ONLY when != 0. A {@link PedAppearanceFace} appends a
 * THIRD segment "|f=…,k=…,o<slot>=…,e=…" (see {@link faceKeySegment}); when
 * `face` is absent the key ends after the props segment, so every Stufe-1 key
 * stays byte-identical. Empty/null appearance — every component skipped, no
 * props, no face — -> "default".
 * Example: "hair=2:1,jbib=5:0|p_head=1:0|f=21:25:0:0.50:0.00,k=21:25:0:0.50,o2=3:0.75:5:-,e=3".
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
  if (components === "" && props === "" && !appearance.face) return "default";
  const base = `${components}|${props}`;
  // The face segment NEVER alters the first two segments — without a face the
  // key ends here, identical to Stufe 1.
  return appearance.face ? `${base}|${faceKeySegment(appearance.face)}` : base;
}

/**
 * Drops empty components/props blocks; null when nothing is left. A `face`
 * block keeps the appearance ALIVE even with no components/props — a face-only
 * appearance (Menyoo face import) is a valid, renderable payload.
 */
export function normalizeAppearance(
  appearance: PedAppearance | null,
): PedAppearance | null {
  if (!appearance) return null;
  const components = appearance.components ?? {};
  const props = appearance.props ?? [];
  const hasComponents = Object.keys(components).length > 0;
  const face = appearance.face;
  if (!hasComponents && props.length === 0 && !face) return null;
  return {
    ...(hasComponents ? { components } : {}),
    ...(props.length > 0 ? { props } : {}),
    ...(face ? { face } : {}),
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
 * Validates an untrusted face blob (persisted state OR a freshly mapped face)
 * — every field is clamped to its contract range, overlays with index 255 (or
 * null/out-of-range) are dropped, tint colours survive only on
 * {@link OVERLAY_TINTED_SLOTS}, overlays are deduped + sorted by slot. Returns
 * null when nothing renderable remains (so it never produces an empty `face`
 * that would still alter the canonical key).
 */
export function sanitizeFace(value: unknown): PedAppearanceFace | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = (v: unknown) => clamp(asInt(v) ?? 0, 0, FACE_BLEND_ID_MAX);
  const mix = (v: unknown) => asClampedNumber(v, 0, 1, 0);

  const overlays: PedAppearanceFaceOverlay[] = [];
  const seenSlots = new Set<number>();
  if (Array.isArray(raw.overlays)) {
    for (const entry of raw.overlays) {
      if (typeof entry !== "object" || entry === null) continue;
      const o = entry as Record<string, unknown>;
      const slot = asInt(o.slot);
      if (slot === null || slot < 0 || slot >= OVERLAY_SLOT_COUNT) continue;
      if (seenSlots.has(slot)) continue;
      const index = asInt(o.index);
      // 255 / null / out-of-range = off — dropped (mirrors the key contract).
      if (index === null || index < 0 || index >= OVERLAY_INDEX_MAX) continue;
      seenSlots.add(slot);
      const tinted = OVERLAY_TINTED_SLOTS.has(slot);
      overlays.push({
        slot,
        index,
        opacity: asClampedNumber(o.opacity, 0, 1, 1),
        ...(tinted
          ? {
              colour: clamp(asInt(o.colour) ?? 0, 0, OVERLAY_COLOUR_MAX),
              colourSecondary: clamp(
                asInt(o.colourSecondary) ?? 0,
                0,
                OVERLAY_COLOUR_MAX,
              ),
            }
          : {}),
      });
    }
  }
  overlays.sort((a, b) => a.slot - b.slot);

  // The face block's eyeColour is a real index when present — index 0 IS a
  // valid eye colour (the old `> 0` test silently dropped it). A present
  // non-negative value is CLAMPED into 0..31 (mirrors the sidecar's
  // NormalizeFace Math.Clamp); a missing/negative value stays unset.
  const eyeRaw = asInt(raw.eyeColour);
  const eyeColour =
    eyeRaw !== null && eyeRaw >= 0 ? clamp(eyeRaw, 0, EYE_COLOUR_MAX) : undefined;

  const hasBlend =
    typeof raw.shapeFirst === "number" ||
    typeof raw.skinFirst === "number" ||
    typeof raw.shapeMix === "number" ||
    typeof raw.skinMix === "number";

  // Nothing renderable -> no face (keeps the key normalized to "default").
  if (!hasBlend && overlays.length === 0 && eyeColour === undefined) {
    return null;
  }

  return {
    shapeFirst: id(raw.shapeFirst),
    shapeSecond: id(raw.shapeSecond),
    shapeThird: id(raw.shapeThird),
    shapeMix: mix(raw.shapeMix),
    thirdMix: mix(raw.thirdMix),
    skinFirst: id(raw.skinFirst),
    skinSecond: id(raw.skinSecond),
    skinThird: id(raw.skinThird),
    skinMix: mix(raw.skinMix),
    ...(overlays.length > 0 ? { overlays } : {}),
    ...(eyeColour !== undefined ? { eyeColour } : {}),
  };
}

/**
 * Validates an untrusted appearance blob (persisted localStorage state) —
 * unknown slots/anchors, malformed entries, indices beyond
 * {@link APPEARANCE_INDEX_MAX} and duplicate prop anchors are dropped, never
 * thrown (out-of-bound values would 400 the sidecar request, duplicate
 * anchors are rejected there too). A `face` block is sanitized via
 * {@link sanitizeFace} and survives even when components/props are empty.
 */
export function sanitizeAppearance(value: unknown): PedAppearance | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { components?: unknown; props?: unknown; face?: unknown };
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

  const face = sanitizeFace(raw.face);

  return normalizeAppearance({
    ...(Object.keys(components).length > 0 ? { components } : {}),
    ...(props.length > 0 ? { props } : {}),
    ...(face ? { face } : {}),
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
  // Eye colour: 0..31 is a real index, anything else collapses to the unset
  // sentinel (index 0 must NOT be turned into "unset" by a clamp/default).
  {
    const eye = asInt(raw.eyeColour);
    extras.eyeColour =
      eye !== null && isEyeColourSet(eye) ? eye : EYE_COLOUR_UNSET;
  }

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
    // 0..31 is a set eye colour (index 0 included); 255 = unset.
    isEyeColourSet(extras.eyeColour) ||
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
    nameKey: "presets.standardMale",
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
    nameKey: "presets.standardFemale",
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
