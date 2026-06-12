/**
 * Plain bun-runnable selftest for the Menyoo XML parser + the canonical
 * appearance key (NO tauri/DOM imports):
 *   bun run src/lib/preview/__selftest__.ts   (or: bun run selftest:menyoo)
 *
 * Covers: complete OutfitPedData (HeadFeatures WasInArray=true, clamps,
 * sparse _N children, "-1,-1" props, anonymous tattoo decals), a
 * SpoonerPlacements file with two peds + a vehicle (hex AND decimal hashes,
 * WasInArray=false defaults), broken XML -> warnings, ISO-8859-1/UTF-8
 * byte decoding, the shared appearance-key canonicalization contract
 * (incl. all-default normalization), overflow indices -> slot default,
 * duplicate prop anchors and face-only imports/presets.
 */

import {
  appearanceKey,
  EYE_COLOUR_UNSET,
  extrasToFace,
  hasUnrenderedExtras,
  normalizeAppearance,
  sanitizeAppearance,
  sanitizeAppearancePresets,
  sanitizeFace,
  STANDARD_APPEARANCE_PRESETS,
} from "./appearance";
import { parseMenyooXml, parseMenyooXmlText } from "./menyoo";
import type { PedAppearanceExtras } from "./appearance";

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

// ---------------------------------------------------------------------------
console.log("\n[1] OutfitPedData (full, WasInArray=true)");
// ---------------------------------------------------------------------------

const OUTFIT_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<OutfitPedData>
  <ClearDecalOverlays>true</ClearDecalOverlays>
  <ModelHash>0x705e61f2</ModelHash>
  <Type>1</Type>
  <Dynamic>false</Dynamic>
  <HashName>Freemode Male</HashName>
  <PedProperties>
    <IsStill>false</IsStill>
    <CanRagdoll>true</CanRagdoll>
    <Armour>0</Armour>
    <CurrentWeapon>0x1B06D571</CurrentWeapon>
    <PedProps>
      <_0>1,2</_0>
      <_1>-1,-1</_1>
      <_6>3,0</_6>
      <_9>4,0</_9>
    </PedProps>
    <PedComps>
      <_11>5,0</_11>
      <_2>2,1</_2>
      <_0>0,0</_0>
      <_4>1,0</_4>
    </PedComps>
    <HeadFeatures WasInArray="true">
      <ShapeAndSkinTone>
        <ShapeFatherId>46</ShapeFatherId>
        <ShapeMotherId>21</ShapeMotherId>
        <ShapeOverrideId>0</ShapeOverrideId>
        <ToneFatherId>0</ToneFatherId>
        <ToneMotherId>21</ToneMotherId>
        <ToneOverrideId>0</ToneOverrideId>
        <ShapeVal>-0.500000</ShapeVal>
        <ToneVal>0.350000</ToneVal>
        <OverrideVal>-1.33514404e-005</OverrideVal>
        <IsP>false</IsP>
      </ShapeAndSkinTone>
      <HairColour>12</HairColour>
      <HairColourStreaks>3</HairColourStreaks>
      <EyeColour>32</EyeColour>
      <FacialFeatures>
        <_0>0.250000</_0>
        <_19>2.000000</_19>
      </FacialFeatures>
      <Overlays>
        <_0 index="255" colour="0" colourSecondary="0" opacity="1" />
        <_1 index="3" colour="12" colourSecondary="0" opacity="0.75" />
      </Overlays>
    </HeadFeatures>
    <TattooLogoDecals>
      <:anonymous collection="0x39F9F21A" value="0x4B813F4A" />
    </TattooLogoDecals>
  </PedProperties>
  <PositionRotation><X>0</X><Y>0</Y><Z>72.5</Z><Pitch>0</Pitch><Roll>0</Roll><Yaw>0</Yaw></PositionRotation>
  <Attachment isAttached="false" />
</OutfitPedData>`;

const outfit = parseMenyooXmlText(OUTFIT_XML);
checkEq("one ped found", outfit.peds.length, 1);
const ped = outfit.peds[0];
checkEq("ped model is mp_m", ped.pedModel, "mp_m_freemode_01");
checkEq("HashName becomes the display name", ped.name, "Freemode Male");
checkEq(
  "components map sparse/unsorted _N (0,0 = default omitted)",
  ped.appearance.components,
  {
    jbib: { drawable: 5, texture: 0 },
    hair: { drawable: 2, texture: 1 },
    lowr: { drawable: 1, texture: 0 },
  },
);
checkEq(
  "props: -1,-1 skipped, anchors mapped, slot 9 unsupported",
  ped.appearance.props,
  [
    { anchor: "p_head", drawable: 1, texture: 2 },
    { anchor: "p_lwrist", drawable: 3, texture: 0 },
  ],
);
check(
  "unsupported prop slot produced a CLOTHING warning (dropped on face-only import)",
  ped.clothingWarnings.some((w) => w.includes("_9")),
  JSON.stringify(ped.clothingWarnings),
);
check(
  "…and it did NOT leak into the face-relevant warnings",
  !ped.warnings.some((w) => w.includes("_9")),
  JSON.stringify(ped.warnings),
);
checkEq("ShapeFatherId 46 clamps to 45", ped.extras.headBlend?.shapeFatherId, 45);
checkEq("ShapeVal -0.5 clamps to 0", ped.extras.headBlend?.shapeMix, 0);
checkEq("ToneVal stays 0.35", ped.extras.headBlend?.toneMix, 0.35);
checkEq(
  "exponential OverrideVal parses and clamps to 0",
  ped.extras.headBlend?.overrideMix,
  0,
);
checkEq("HairColour", ped.extras.hairColour, 12);
checkEq("HairColourStreaks", ped.extras.hairHighlightColour, 3);
checkEq("EyeColour 32 clamps to 31", ped.extras.eyeColour, 31);
checkEq("FacialFeatures _0", ped.extras.faceFeatures[0], 0.25);
checkEq("FacialFeatures _19 clamps to 1", ped.extras.faceFeatures[19], 1);
checkEq("FacialFeatures default 0", ped.extras.faceFeatures[7], 0);
checkEq("overlay index 255 = off", ped.extras.overlays[0].index, null);
checkEq(
  "overlay attributes parse",
  ped.extras.overlays[1],
  { index: 3, opacity: 0.75, colour: 12, colourSecondary: 0 },
);
checkEq(
  "anonymous tattoo decals are collected",
  ped.extras.tattoos,
  [{ collection: "0x39F9F21A", value: "0x4B813F4A" }],
);
check(
  "clamped values produce one aggregated warning",
  ped.warnings.some((w) => w.includes("außerhalb des gültigen Bereichs")),
);
checkEq(
  "canonical key matches the shared contract",
  appearanceKey(ped.appearance),
  "hair=2:1,jbib=5:0,lowr=1:0|p_head=1:2,p_lwrist=3:0",
);

// ---------------------------------------------------------------------------
console.log("\n[2] SpoonerPlacements (2 peds + vehicle, WasInArray=false)");
// ---------------------------------------------------------------------------

const SPOONER_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<SpoonerPlacements>
  <Note />
  <ClearDatabase>true</ClearDatabase>
  <ReferenceCoords><X>0</X><Y>0</Y><Z>0</Z></ReferenceCoords>
  <Placement>
    <ModelHash>0xADCDE75</ModelHash>
    <Type>2</Type>
    <HashName>Auto</HashName>
    <VehicleProperties />
  </Placement>
  <Placement>
    <ModelHash>2627665880</ModelHash>
    <Type>1</Type>
    <HashName>Frau</HashName>
    <PedProperties>
      <PedComps><_2>4,0</_2></PedComps>
      <PedProps><_0>-1,-1</_0></PedProps>
      <HeadFeatures WasInArray="false">
        <ShapeAndSkinTone>
          <ShapeFatherId>21</ShapeFatherId>
          <ShapeMotherId>25</ShapeMotherId>
          <ShapeOverrideId>0</ShapeOverrideId>
          <ToneFatherId>21</ToneFatherId>
          <ToneMotherId>25</ToneMotherId>
          <ToneOverrideId>0</ToneOverrideId>
          <ShapeVal>0.500000</ShapeVal>
          <ToneVal>0.500000</ToneVal>
          <OverrideVal>0.000000</OverrideVal>
          <IsP>false</IsP>
        </ShapeAndSkinTone>
      </HeadFeatures>
    </PedProperties>
  </Placement>
  <Placement>
    <ModelHash>0x705E61F2</ModelHash>
    <Type>1</Type>
    <HashName>Mann</HashName>
    <PedProperties>
      <PedComps><_11>5,0</_11></PedComps>
    </PedProperties>
  </Placement>
</SpoonerPlacements>`;

const spooner = parseMenyooXmlText(SPOONER_XML);
checkEq("vehicle filtered, both peds returned", spooner.peds.length, 2);
checkEq(
  "decimal ModelHash resolves mp_f",
  [spooner.peds[0].pedModel, spooner.peds[0].name],
  ["mp_f_freemode_01", "Frau"],
);
checkEq(
  "female components",
  spooner.peds[0].appearance.components,
  { hair: { drawable: 4, texture: 0 } },
);
checkEq(
  "WasInArray=false keeps blend but defaults the rest (eye colour = unset 255)",
  [
    spooner.peds[0].extras.headBlend?.shapeFatherId,
    spooner.peds[0].extras.headBlend?.shapeMix,
    spooner.peds[0].extras.eyeColour,
    spooner.peds[0].extras.overlays[1].index,
  ],
  // eyeColour 255 = unset (absent EyeColour field): index 0 is now a valid
  // eye colour, so the "no eye colour" default can no longer be 0.
  [21, 0.5, 255, null],
);
checkEq(
  "hex ModelHash resolves mp_m",
  [spooner.peds[1].pedModel, spooner.peds[1].name],
  ["mp_m_freemode_01", "Mann"],
);
checkEq(
  "ped without HeadFeatures gets null headBlend",
  spooner.peds[1].extras.headBlend,
  null,
);

// ---------------------------------------------------------------------------
console.log("\n[3] broken / foreign XML -> warnings");
// ---------------------------------------------------------------------------

const broken = parseMenyooXmlText(
  "<OutfitPedData><PedProperties></OutfitPedData>",
);
checkEq("mismatched close tag yields no peds", broken.peds.length, 0);
check("…and a warning", broken.warnings.length > 0);

const garbage = parseMenyooXmlText("definitiv kein XML");
checkEq("plain text yields no peds", garbage.peds.length, 0);
check("…and a warning", garbage.warnings.length > 0);

const foreign = parseMenyooXmlText("<Settings><Foo>1</Foo></Settings>");
checkEq("foreign root yields no peds", foreign.peds.length, 0);
check(
  "…and an unknown-format warning",
  foreign.warnings.some((w) => w.includes("Settings")),
);

// ---------------------------------------------------------------------------
console.log("\n[4] byte decoding (UTF-8 strict, ISO-8859-1 fallback)");
// ---------------------------------------------------------------------------

const MINI_XML = (name: string) =>
  `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>${name}</HashName><PedProperties><PedComps><_2>1,0</_2></PedComps></PedProperties></OutfitPedData>`;

const utf8 = parseMenyooXml(new TextEncoder().encode(MINI_XML("Müller")));
checkEq("UTF-8 bytes decode", utf8.peds[0]?.name, "Müller");

// "Schön" with ö as single 0xF6 byte — invalid UTF-8, valid ISO-8859-1.
const latin1Source = MINI_XML("Schön");
const latin1Bytes = new Uint8Array(latin1Source.length);
for (let i = 0; i < latin1Source.length; i++) {
  latin1Bytes[i] = latin1Source.charCodeAt(i) & 0xff;
}
const latin1 = parseMenyooXml(latin1Bytes);
checkEq("ISO-8859-1 bytes fall back correctly", latin1.peds[0]?.name, "Schön");

// ---------------------------------------------------------------------------
console.log("\n[5] appearance key + sanitizer contract");
// ---------------------------------------------------------------------------

checkEq("null appearance -> default", appearanceKey(null), "default");
checkEq("empty appearance -> default", appearanceKey({}), "default");
checkEq(
  "contract example",
  appearanceKey({
    components: {
      jbib: { drawable: 5, texture: 0 },
      hair: { drawable: 2, texture: 1 },
    },
    props: [{ anchor: "p_head", drawable: 1, texture: 0 }],
  }),
  "hair=2:1,jbib=5:0|p_head=1:0",
);
checkEq(
  "alt only appended when != 0",
  appearanceKey({
    components: {
      hair: { drawable: 2, texture: 1, alt: 2 },
      jbib: { drawable: 5, texture: 0, alt: 0 },
    },
  }),
  "hair=2:1:a2,jbib=5:0|",
);
checkEq(
  "props-only appearance keeps the separator",
  appearanceKey({ props: [{ anchor: "p_eyes", drawable: 2, texture: 0 }] }),
  "|p_eyes=2:0",
);

checkEq(
  "sanitizeAppearance drops unknown slots/anchors + broken entries",
  sanitizeAppearance({
    components: {
      hair: { drawable: 3, texture: 1 },
      bogus: { drawable: 1, texture: 0 },
      jbib: { drawable: -1, texture: 0 },
    },
    props: [
      { anchor: "p_head", drawable: 1, texture: 0 },
      { anchor: "p_nose", drawable: 1, texture: 0 },
      { anchor: "p_eyes", drawable: "x", texture: 0 },
    ],
  }),
  {
    components: { hair: { drawable: 3, texture: 1 } },
    props: [{ anchor: "p_head", drawable: 1, texture: 0 }],
  },
);
checkEq("sanitizeAppearance normalizes empty to null", sanitizeAppearance({}), null);

for (const preset of STANDARD_APPEARANCE_PRESETS) {
  check(
    `standard preset "${preset.name}" sanitizes losslessly`,
    JSON.stringify(sanitizeAppearance(preset.appearance)) ===
      JSON.stringify(preset.appearance),
  );
}

// ---------------------------------------------------------------------------
console.log("\n[6] all-default normalization (shared contract)");
// ---------------------------------------------------------------------------

checkEq(
  "all-default components -> default",
  appearanceKey({
    components: {
      hair: { drawable: 0, texture: 0 },
      jbib: { drawable: 0, texture: 0, alt: 0 },
    },
  }),
  "default",
);
checkEq(
  "default entries are skipped next to real ones",
  appearanceKey({
    components: {
      hair: { drawable: 0, texture: 0 },
      jbib: { drawable: 5, texture: 0 },
    },
  }),
  "jbib=5:0|",
);
checkEq(
  "default components with props keep the props",
  appearanceKey({
    components: { hair: { drawable: 0, texture: 0 } },
    props: [{ anchor: "p_head", drawable: 1, texture: 0 }],
  }),
  "|p_head=1:0",
);
checkEq(
  "alt != 0 keeps an otherwise-default entry",
  appearanceKey({ components: { hair: { drawable: 0, texture: 0, alt: 2 } } }),
  "hair=0:0:a2|",
);

// ---------------------------------------------------------------------------
console.log("\n[7] overflow indices -> slot default + warning");
// ---------------------------------------------------------------------------

const OVERFLOW_XML = `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>Overflow</HashName><PedProperties>
  <PedComps><_2>99999999999999999999,0</_2><_4>3,99999</_4><_11>5,0</_11></PedComps>
  <PedProps><_0>123456789012345,0</_0><_6>2,1</_6></PedProps>
</PedProperties></OutfitPedData>`;

const overflow = parseMenyooXmlText(OVERFLOW_XML);
checkEq(
  "overflow component falls back to the slot default",
  overflow.peds[0]?.appearance.components,
  { jbib: { drawable: 5, texture: 0 } },
);
checkEq(
  "overflow prop is dropped, valid one survives",
  overflow.peds[0]?.appearance.props,
  [{ anchor: "p_lwrist", drawable: 2, texture: 1 }],
);
check(
  "overflow produced per-slot CLOTHING warnings (dropped on face-only import)",
  (overflow.peds[0]?.clothingWarnings ?? []).filter((w) =>
    w.includes("außerhalb des gültigen Bereichs"),
  ).length >= 3,
  JSON.stringify(overflow.peds[0]?.clothingWarnings),
);
check(
  "…and the garment-index overflow did NOT surface as a face warning",
  !(overflow.peds[0]?.warnings ?? []).some((w) =>
    w.includes("außerhalb des gültigen Bereichs"),
  ),
  JSON.stringify(overflow.peds[0]?.warnings),
);

checkEq(
  "sanitizeAppearance drops overflow indices + oversized alt",
  sanitizeAppearance({
    components: {
      hair: { drawable: 1e20, texture: 0 },
      jbib: { drawable: 5, texture: 0, alt: 999999 },
    },
    props: [{ anchor: "p_head", drawable: 0, texture: 99999 }],
  }),
  { components: { jbib: { drawable: 5, texture: 0 } } },
);

// ---------------------------------------------------------------------------
console.log("\n[8] duplicate prop anchors");
// ---------------------------------------------------------------------------

const DUPLICATE_PROP_XML = `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>Doppelt</HashName><PedProperties>
  <PedComps><_2>2,1</_2></PedComps>
  <PedProps><_0>1,0</_0><_0>3,2</_0></PedProps>
</PedProperties></OutfitPedData>`;

const duplicateProps = parseMenyooXmlText(DUPLICATE_PROP_XML);
checkEq(
  "duplicate _N prop keeps only the first (sidecar rejects duplicate anchors)",
  duplicateProps.peds[0]?.appearance.props,
  [{ anchor: "p_head", drawable: 1, texture: 0 }],
);
check(
  "…and warns about the duplicate (in the clothing bucket — prop-related)",
  (duplicateProps.peds[0]?.clothingWarnings ?? []).some((w) =>
    w.includes("doppelt"),
  ),
  JSON.stringify(duplicateProps.peds[0]?.clothingWarnings),
);

checkEq(
  "sanitizeAppearance dedupes persisted duplicate anchors",
  sanitizeAppearance({
    props: [
      { anchor: "p_head", drawable: 1, texture: 0 },
      { anchor: "p_head", drawable: 2, texture: 0 },
    ],
  }),
  { props: [{ anchor: "p_head", drawable: 1, texture: 0 }] },
);

// ---------------------------------------------------------------------------
console.log("\n[9] face-only import + presets");
// ---------------------------------------------------------------------------

const FACE_ONLY_XML = `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>Gesicht</HashName><PedProperties>
  <PedComps><_0>0,0</_0><_2>0,0</_2><_11>0,0</_11></PedComps>
  <HeadFeatures WasInArray="true">
    <HairColour>5</HairColour>
    <EyeColour>3</EyeColour>
  </HeadFeatures>
</PedProperties></OutfitPedData>`;

const faceOnly = parseMenyooXmlText(FACE_ONLY_XML);
checkEq(
  "face-only import normalizes to the default key",
  appearanceKey(faceOnly.peds[0]?.appearance ?? null),
  "default",
);
check(
  "…but the extras carry the head features",
  hasUnrenderedExtras(faceOnly.peds[0]?.extras ?? null) &&
    faceOnly.peds[0]?.extras.hairColour === 5,
);

const persistedPresets = sanitizeAppearancePresets([
  {
    name: "Nur Gesicht",
    pedModel: "mp_m_freemode_01",
    appearance: null,
    extras: { hairColour: 7 },
  },
  { name: "Leer", pedModel: null, appearance: null, extras: null },
  {
    name: "Klamotten",
    pedModel: null,
    appearance: { components: { jbib: { drawable: 5, texture: 0 } } },
    extras: null,
  },
]);
checkEq(
  "face-only preset survives the rehydrate, empty one is dropped",
  persistedPresets.map((p) => p.name),
  ["Nur Gesicht", "Klamotten"],
);
checkEq(
  "face-only preset keeps appearance=null + extras",
  [persistedPresets[0]?.appearance, persistedPresets[0]?.extras?.hairColour],
  [null, 7],
);

// ---------------------------------------------------------------------------
console.log("\n[10] extrasToFace mapping + face key segment + clamps");
// ---------------------------------------------------------------------------

// A FULL Menyoo head (HeadFeatures WasInArray=true) so overlays/eye colour map.
const FACE_XML = `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>FaceMap</HashName><PedProperties>
  <PedComps><_3>7,0</_3></PedComps>
  <HeadFeatures WasInArray="true">
    <ShapeAndSkinTone>
      <ShapeFatherId>21</ShapeFatherId>
      <ShapeMotherId>25</ShapeMotherId>
      <ShapeOverrideId>3</ShapeOverrideId>
      <ToneFatherId>11</ToneFatherId>
      <ToneMotherId>33</ToneMotherId>
      <ToneOverrideId>0</ToneOverrideId>
      <ShapeVal>0.500000</ShapeVal>
      <ToneVal>0.750000</ToneVal>
      <OverrideVal>0.250000</OverrideVal>
      <IsP>false</IsP>
    </ShapeAndSkinTone>
    <HairColour>5</HairColour>
    <EyeColour>3</EyeColour>
    <Overlays>
      <_1 index="4" colour="12" colourSecondary="7" opacity="0.80" />
      <_2 index="6" colour="9" colourSecondary="2" opacity="1" />
      <_0 index="2" colour="0" colourSecondary="0" opacity="0.50" />
      <_3 index="255" colour="0" colourSecondary="0" opacity="1" />
    </Overlays>
  </HeadFeatures>
</PedProperties></OutfitPedData>`;

const faceImport = parseMenyooXmlText(FACE_XML);
const faceExtras = faceImport.peds[0]!.extras;
const mappedFace = extrasToFace(faceExtras);

checkEq(
  "extrasToFace maps the head blend (Shape*->shape*, Tone*->skin*)",
  mappedFace && {
    shapeFirst: mappedFace.shapeFirst,
    shapeSecond: mappedFace.shapeSecond,
    shapeThird: mappedFace.shapeThird,
    shapeMix: mappedFace.shapeMix,
    thirdMix: mappedFace.thirdMix,
    skinFirst: mappedFace.skinFirst,
    skinSecond: mappedFace.skinSecond,
    skinThird: mappedFace.skinThird,
    skinMix: mappedFace.skinMix,
    eyeColour: mappedFace.eyeColour,
  },
  {
    shapeFirst: 21,
    shapeSecond: 25,
    shapeThird: 3,
    shapeMix: 0.5,
    thirdMix: 0.25,
    skinFirst: 11,
    skinSecond: 33,
    skinThird: 0,
    skinMix: 0.75,
    eyeColour: 3,
  },
);
checkEq(
  "overlays: 255 dropped, tinted slots (1,2) keep colour, untinted (0) drops it, sorted",
  mappedFace?.overlays,
  [
    { slot: 0, index: 2, opacity: 0.5 },
    { slot: 1, index: 4, opacity: 0.8, colour: 12, colourSecondary: 7 },
    { slot: 2, index: 6, opacity: 1, colour: 9, colourSecondary: 2 },
  ],
);

// Makeup (slot 4) is a TINTED slot too (must match the sidecar's tintable set,
// FaceCalibration Tintable=true for 1,2,4,5,8,10) — its colour must survive.
const makeupExtras = parseMenyooXmlText(
  `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>Makeup</HashName><PedProperties>
  <HeadFeatures WasInArray="true">
    <Overlays>
      <_4 index="5" colour="3" colourSecondary="6" opacity="0.50" />
      <_6 index="2" colour="9" colourSecondary="9" opacity="1" />
    </Overlays>
  </HeadFeatures>
</PedProperties></OutfitPedData>`,
).peds[0]!.extras;
checkEq(
  "makeup (slot 4) keeps colour (tinted); complexion (slot 6) drops it (untinted)",
  extrasToFace(makeupExtras)?.overlays,
  [
    { slot: 4, index: 5, opacity: 0.5, colour: 3, colourSecondary: 6 },
    { slot: 6, index: 2, opacity: 1 },
  ],
);
checkEq(
  "face key segment is byte-exact (f=/k=/o<slot>=/e=, F2 floats, '-' for missing colour)",
  appearanceKey({ face: mappedFace! }),
  "||f=21:25:3:0.50:0.25,k=11:33:0:0.75,o0=2:0.50:-:-,o1=4:0.80:12:7,o2=6:1.00:9:2,e=3",
);

// F2 quantization cross-check — the .xx5 half-steps that diverged between the
// old `toFixed(2)` (JS double) and the sidecar `float.ToString("0.00")` (C#
// 32-bit float). The expected strings are the SIDECAR's output (32-bit float +
// round-half-away-from-zero); the client must now produce them byte-identically
// after the Math.fround + integer-quantize rewrite. These are the values an
// overlay opacity or a HeadBlend mix can carry from a hand-edited/foreign XML.
// (See sidecar/Api/Dtos.cs F2 — keep this list in sync if F2 ever changes.)
const F2_XX5: Array<[number, string]> = [
  [0.005, "0.01"],
  [0.015, "0.02"],
  [0.045, "0.05"],
  [0.145, "0.15"],
  [0.175, "0.18"],
  [0.245, "0.25"],
  [0.295, "0.29"],
  [0.525, "0.52"],
  [0.565, "0.57"],
  [0.745, "0.75"],
  [0.995, "1.00"],
  [0, "0.00"],
  [0.5, "0.50"],
  [1, "1.00"],
];
for (const [opacity, expectedF2] of F2_XX5) {
  // Drive f2 through the public key: an active overlay's opacity field is the
  // only single-float key slot, so the segment "o0=1:<F2>:-:-" isolates it.
  // (faceKeySegment reads every field directly, so we pass a complete face.)
  checkEq(
    `F2(${opacity}) is byte-identical to the sidecar -> "${expectedF2}"`,
    appearanceKey({
      face: {
        shapeFirst: 0,
        shapeSecond: 0,
        shapeThird: 0,
        shapeMix: 0,
        thirdMix: 0,
        skinFirst: 0,
        skinSecond: 0,
        skinThird: 0,
        skinMix: 0,
        overlays: [{ slot: 0, index: 1, opacity }],
      },
    }),
    `||f=0:0:0:0.00:0.00,k=0:0:0:0.00,o0=1:${expectedF2}:-:-,e=-`,
  );
}

// Face-only with NO head blend + NO overlays + NO eye colour -> null face.
const emptyExtras: PedAppearanceExtras = {
  ...faceExtras,
  headBlend: null,
  overlays: faceExtras.overlays.map(() => ({
    index: null,
    opacity: 1,
    colour: 0,
    colourSecondary: 0,
  })),
  // 255 = unset (NOT 0 — index 0 is a valid eye colour now).
  eyeColour: EYE_COLOUR_UNSET,
};
checkEq("extrasToFace returns null when nothing renderable", extrasToFace(emptyExtras), null);

// Eye colour only (no blend) -> neutral default blend + eyeColour, no overlays.
const eyeOnly = extrasToFace({ ...emptyExtras, eyeColour: 7 });
checkEq("eye-only face carries a neutral blend + eyeColour", eyeOnly, {
  shapeFirst: 0,
  shapeSecond: 0,
  shapeThird: 0,
  shapeMix: 0,
  thirdMix: 0,
  skinFirst: 0,
  skinSecond: 0,
  skinThird: 0,
  skinMix: 0,
  eyeColour: 7,
});

// Eye colour INDEX 0 is a VALID atlas tile — importing it must NOT be swallowed
// as "unset". It produces a face with eyeColour=0 and lands in the key as e=0.
const eyeZero = extrasToFace({ ...emptyExtras, eyeColour: 0 });
checkEq("eye colour index 0 is importable (valid eye colour, not unset)", eyeZero, {
  shapeFirst: 0,
  shapeSecond: 0,
  shapeThird: 0,
  shapeMix: 0,
  thirdMix: 0,
  skinFirst: 0,
  skinSecond: 0,
  skinThird: 0,
  skinMix: 0,
  eyeColour: 0,
});
checkEq(
  "eye colour 0 reaches the canonical key as e=0",
  appearanceKey({ face: eyeZero! }),
  "||f=0:0:0:0.00:0.00,k=0:0:0:0.00,e=0",
);
// Clean baseline (no hairColour/blend/overlay) so ONLY eyeColour drives the
// result — emptyExtras still carries the parsed hairColour=5.
const cleanExtras: PedAppearanceExtras = {
  ...emptyExtras,
  hairColour: 0,
  hairHighlightColour: 0,
  faceFeatures: emptyExtras.faceFeatures.map(() => 0),
  tattoos: undefined,
};
check(
  "hasUnrenderedExtras: eye colour 0 counts as set, 255 does not",
  hasUnrenderedExtras({ ...cleanExtras, eyeColour: 0 }) === true &&
    hasUnrenderedExtras({ ...cleanExtras, eyeColour: EYE_COLOUR_UNSET }) === false,
);

// sanitizeFace clamps out-of-range ids/mix/overlay/eye and drops 255 overlays.
checkEq(
  "sanitizeFace clamps ids/mix, drops index 255 + untinted colour, clamps eye",
  sanitizeFace({
    shapeFirst: 99,
    shapeSecond: -3,
    shapeThird: 4,
    shapeMix: 2,
    thirdMix: -1,
    skinFirst: 5,
    skinSecond: 6,
    skinThird: 7,
    skinMix: 0.4,
    eyeColour: 99,
    overlays: [
      { slot: 2, index: 255, opacity: 1, colour: 5, colourSecondary: 5 },
      { slot: 1, index: 3, opacity: 9, colour: 99, colourSecondary: -2 },
      { slot: 0, index: 1, opacity: 0.5, colour: 40, colourSecondary: 40 },
    ],
  }),
  {
    shapeFirst: 45,
    shapeSecond: 0,
    shapeThird: 4,
    shapeMix: 1,
    thirdMix: 0,
    skinFirst: 5,
    skinSecond: 6,
    skinThird: 7,
    skinMix: 0.4,
    overlays: [
      { slot: 0, index: 1, opacity: 0.5 },
      { slot: 1, index: 3, opacity: 1, colour: 63, colourSecondary: 0 },
    ],
    eyeColour: 31,
  },
);
checkEq(
  "sanitizeFace returns null when nothing renderable remains",
  sanitizeFace({ overlays: [{ slot: 2, index: 255, opacity: 1 }] }),
  null,
);

// A face block survives sanitizeAppearance even with no components/props, and
// the resulting key keeps the empty component+prop separators ("||").
checkEq(
  "sanitizeAppearance keeps a face-only appearance",
  appearanceKey(
    sanitizeAppearance({ face: { skinFirst: 11, skinMix: 0.5, eyeColour: 3 } }),
  ),
  "||f=0:0:0:0.00:0.00,k=11:0:0:0.50,e=3",
);

// ---------------------------------------------------------------------------
console.log("\n[11] FACE-ONLY import: clothing/hair from the XML is IGNORED");
// ---------------------------------------------------------------------------

// A Menyoo XML with FILLED clothing/hair PedComps (hair=5, jbib=3) AND head
// features — mirrors the store's applyImportedAppearance (face-only).
const FACE_ONLY_IMPORT_XML = `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>NurGesicht</HashName><PedProperties>
  <PedComps><_2>5,1</_2><_11>3,0</_11><_4>2,0</_4></PedComps>
  <PedProps><_0>1,0</_0></PedProps>
  <HeadFeatures WasInArray="true">
    <ShapeAndSkinTone>
      <ShapeFatherId>21</ShapeFatherId>
      <ShapeMotherId>25</ShapeMotherId>
      <ShapeOverrideId>0</ShapeOverrideId>
      <ToneFatherId>21</ToneFatherId>
      <ToneMotherId>25</ToneMotherId>
      <ToneOverrideId>0</ToneOverrideId>
      <ShapeVal>0.500000</ShapeVal>
      <ToneVal>0.500000</ToneVal>
      <OverrideVal>0.000000</OverrideVal>
      <IsP>false</IsP>
    </ShapeAndSkinTone>
    <HairColour>5</HairColour>
    <EyeColour>4</EyeColour>
  </HeadFeatures>
</PedProperties></OutfitPedData>`;

const faceOnlyImport = parseMenyooXmlText(FACE_ONLY_IMPORT_XML);
const importedPed = faceOnlyImport.peds[0]!;
// Sanity: the parser DID read the clothing (hair=5, jbib=3) + the prop.
checkEq(
  "parser still reads the XML clothing (proves it is later ignored on purpose)",
  importedPed.appearance.components,
  { hair: { drawable: 5, texture: 1 }, jbib: { drawable: 3, texture: 0 }, lowr: { drawable: 2, texture: 0 } },
);

// Mirror of preview-3d-store.applyImportedAppearance: start from the user's
// manually set components (here: just a manually picked uppr) and write ONLY
// the face — NOTHING from the XML's components/props is taken.
const userComponents = { uppr: { drawable: 4, texture: 2 } };
const importedFace = extrasToFace(importedPed.extras);
const afterImport = normalizeAppearance({
  components: userComponents,
  ...(importedFace ? { face: importedFace } : {}),
});
check(
  "face-only import sets appearance.face",
  afterImport?.face != null && afterImport.face.skinMix === 0.5,
);
checkEq(
  "face-only import keeps ONLY the user's manual components — no XML clothing",
  afterImport?.components,
  { uppr: { drawable: 4, texture: 2 } },
);
check(
  "face-only import takes NO prop from the XML",
  afterImport?.props === undefined,
);
check(
  "none of the XML PedComps (hair/jbib/lowr) leaked into the appearance",
  afterImport?.components?.hair === undefined &&
    afterImport?.components?.jbib === undefined &&
    afterImport?.components?.lowr === undefined,
);

// ---------------------------------------------------------------------------
console.log("\n[12] FACE-ONLY import: clothing/prop/model warnings are dropped");
// ---------------------------------------------------------------------------

// One XML that triggers EVERY clothing-warning kind (unknown comp slot _40,
// oversized garment index, unsupported prop slot _9) AND a face-relevant clamp
// (EyeColour 32 -> 31). Face-only import must surface ONLY the face warning.
const MIXED_WARNINGS_XML = `<OutfitPedData><ModelHash>0x705E61F2</ModelHash><Type>1</Type><HashName>Gemischt</HashName><PedProperties>
  <PedComps><_40>1,0</_40><_2>99999,0</_2><_4>3,0</_4></PedComps>
  <PedProps><_9>1,0</_9></PedProps>
  <HeadFeatures WasInArray="true">
    <EyeColour>32</EyeColour>
  </HeadFeatures>
</PedProperties></OutfitPedData>`;

const mixed = parseMenyooXmlText(MIXED_WARNINGS_XML);
const mixedPed = mixed.peds[0]!;
check(
  "face clamp warning is in the face bucket (survives the import)",
  mixedPed.warnings.some((w) => w.includes("außerhalb des gültigen Bereichs")),
  JSON.stringify(mixedPed.warnings),
);
check(
  "the face bucket carries NO clothing/prop/model warnings",
  !mixedPed.warnings.some(
    (w) =>
      w.includes("Komponenten-Slot") ||
      w.includes("Prop-Slot") ||
      w.includes("Freemode-Ped"),
  ),
  JSON.stringify(mixedPed.warnings),
);
check(
  "unknown component slot, oversized garment + unsupported prop are all in the clothing bucket",
  mixedPed.clothingWarnings.some((w) => w.includes("_40")) &&
    mixedPed.clothingWarnings.some((w) => w.includes("_2")) &&
    mixedPed.clothingWarnings.some((w) => w.includes("_9")),
  JSON.stringify(mixedPed.clothingWarnings),
);

// A non-freemode ped: the ModelHash hint must be a clothing warning, never face.
const NON_FREEMODE_XML = `<OutfitPedData><ModelHash>0xDEADBEEF</ModelHash><Type>1</Type><HashName>Fremd</HashName><PedProperties>
  <PedComps><_2>1,0</_2></PedComps>
</PedProperties></OutfitPedData>`;
const nonFreemode = parseMenyooXmlText(NON_FREEMODE_XML).peds[0]!;
check(
  "non-freemode ModelHash hint is a clothing warning, not a face warning",
  nonFreemode.clothingWarnings.some((w) => w.includes("Freemode-Ped")) &&
    !nonFreemode.warnings.some((w) => w.includes("Freemode-Ped")),
  JSON.stringify([nonFreemode.warnings, nonFreemode.clothingWarnings]),
);

// ---------------------------------------------------------------------------
console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} check(s) FAILED, ${passed} passed.`);
  throw new Error(`Selftest failed:\n- ${failures.join("\n- ")}`);
}
console.log(`All ${passed} checks passed.`);
