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
  hasUnrenderedExtras,
  sanitizeAppearance,
  sanitizeAppearancePresets,
  STANDARD_APPEARANCE_PRESETS,
} from "./appearance";
import { parseMenyooXml, parseMenyooXmlText } from "./menyoo";

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
  "unsupported prop slot produced a warning",
  ped.warnings.some((w) => w.includes("_9")),
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
  "WasInArray=false keeps blend but defaults the rest",
  [
    spooner.peds[0].extras.headBlend?.shapeFatherId,
    spooner.peds[0].extras.headBlend?.shapeMix,
    spooner.peds[0].extras.eyeColour,
    spooner.peds[0].extras.overlays[1].index,
  ],
  [21, 0.5, 0, null],
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
  "overflow produced per-slot warnings",
  (overflow.peds[0]?.warnings ?? []).filter((w) =>
    w.includes("außerhalb des gültigen Bereichs"),
  ).length >= 3,
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
  "…and warns about the duplicate",
  (duplicateProps.peds[0]?.warnings ?? []).some((w) => w.includes("doppelt")),
  JSON.stringify(duplicateProps.peds[0]?.warnings),
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
console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} check(s) FAILED, ${passed} passed.`);
  throw new Error(`Selftest failed:\n- ${failures.join("\n- ")}`);
}
console.log(`All ${passed} checks passed.`);
