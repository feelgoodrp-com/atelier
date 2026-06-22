# Tattoo-Authoring für „atelier by feelgood" — Implementierungsplan

> Stand: 2026-06-22 · Status: Architektur-Plan (genehmigungsreif) · Lens-Reviews eingearbeitet (Format-Korrektheit, Code-Feasibility, Scope/Phasing).
>
> Dieses Dokument ist die **einzige verbindliche Quelle** für das Tattoo-Feature. Es ersetzt die fünf Facetten-Entwürfe (A–E). Wo die Reviews einen Entwurf widerlegt haben, gilt die korrigierte Fassung hier — die widerlegten Behauptungen wurden **entfernt**, nicht wiederholt.

---

## 1. Überblick & Ziel

atelier authort heute **Kleidung** (Drawables/Props) und baut daraus eine streambare FiveM-Resource. Tattoos sind ein **neues Geschwister-Feature**: ein eigener Authoring-Bereich, der aus Bild-Dateien ein vollständiges, streambares **Tattoo-Pack** baut.

Ein Custom-Tattoo-Pack besteht aus drei koordinierten Artefakten plus einem Runtime-Manifest:
1. **YTD** (Texture-Dictionary) je Tattoo-Decal,
2. **Overlay-Collection-Metadaten** (`<collection>_overlays.ymt`, eine geteilte Collection pro Pack),
3. **`shop_tattoo.meta`** (Tattoo-Shop-Anbindung, optional),
4. **`tattoos.json`** — das Runtime-Manifest, das fg-core/qbx_core liest, um Tattoos per `AddPedDecorationFromHashes` anzuwenden.

**Warum:** Die feelgood-Server-Apps (fg-core/qbx_core) wenden Tattoos zur Laufzeit an, können sie aber nicht *erzeugen*. grzyClothTool unterstützt keine Tattoos. atelier füllt diese Lücke mit demselben CodeWalker-basierten Build-Stack, den es bereits für Kleidung nutzt.

**atelier's Job endet beim Bauen des Packs + dem Emittieren von `tattoos.json`.** Die In-Game-Anwendung (Lua) liegt in separaten Repos und ist explizites Nicht-Ziel (siehe §2).

---

## 2. Ziele / Nicht-Ziele

### Ziele
- Bild-Dateien (DDS/YTD im MVP, PNG später — siehe Entscheidung D2) importieren und als `ProjectTattoo` organisieren.
- Pro Tattoo: Zone, Geschlecht, Typ, Label, Overlay-Namen, optional Shop-Felder editieren.
- Ein vollständiges, streambares FiveM-Tattoo-Pack bauen: YTD + Overlay-Metadaten + (optional) `shop_tattoo.meta` + `fxmanifest.lua` + `tattoos.json`.
- Flache 2D-Decal-Vorschau + Zonen-Diagramm (sofort); On-Body-3D-Vorschau (später, optional).
- Verlustfreie Migration bestehender v1-Projekte; Tattoos teilen Undo/Save/Groups mit Kleidung.

### Nicht-Ziele (explizit)
- **Keine In-Game-Lua.** atelier emittiert `tattoos.json`; die Anwendung (`AddPedDecorationFromHashes`) passiert in fg-core/qbx_core.
- **Keine pixelgenaue Platzierung.** Tattoos sind **Fixed-UV-Decals** — die Platzierung ist in die Textur-UV eingebrannt. `uvPos`/`scale`/`rotation` existieren im Overlay-XML, aber ihre reale Wirkung ist **unbestätigt** (siehe Risiko a). Es gibt **kein** freies Repositionieren/Skalieren pro Instanz.
- **Kein Replace von Stock-Collections.** Nur **Addon-Collections** (neue, projektunieke Namen). Tattoo-„replace" ist out of scope.
- **Keine getrennte männliche/weibliche Bildkunst im MVP.** Das verifizierte Format teilt **ein** Decal über beide Freemode-Peds; nur der Overlay-*Name* trägt das Geschlechts-Suffix. (Review-Korrektur: der `_f.ytd`-Zweittextur-Pfad wurde verworfen — er verletzte die `txd==txt==Dateiname`-Regel.)
- **Keine echte UV-/Scale-/Rotation-Editier-UI im MVP.** Felder werden gespeichert, aber Controls erst gebaut, wenn ein Live-Test eine sichtbare Wirkung beweist.
- **Kein Multi-Collection pro Projekt.** Eine geteilte Collection pro Pack, abgeleitet aus `settings.dlcName`.

---

## 3. Hintergrund: So funktionieren GTA/FiveM-Tattoos

Ein Tattoo-Pack = drei Artefakte + Runtime-Native.

### Artefakt 1 — YTD (Texture-Dictionary)
Ein Alpha-Decal-Bild. Alpha-Decals → **DXT5/BC3** (BC7 = höhere Alpha-Qualität). Quellbilder sollen **Power-of-2** sein (512×512, 256×1024) für Mipmaps.
**Harte Engine-Regel:** `txdHash` UND `txtHash` MÜSSEN beide dem **bloßen YTD-Dateinamen** entsprechen (ohne `.ytd`), damit die Engine die YTD findet. Auch der Texture-Name *innerhalb* des Dictionarys muss gleich sein.

> **Verbindliches Dateinamen-Schema (Review-HIGH-Fix):** **Ein YTD pro Tattoo-Decal**, benannt `<collection>_tat_<NNN>` (3-stellig, 0-basiert, Reihenfolge = `project.tattoos`-Array-Reihenfolge). Jedes Overlay-Preset setzt `txdHash` = `txtHash` = **genau diesen** Dateinamen. (Die früheren Varianten „ein YTD pro Pack" und „zonen-gebucketete Namen" sind widerlegt — sie konnten die Per-Preset-Regel nicht erfüllen.)

### Artefakt 2 — Overlay-Collection-Metadaten
Rockstars PSO-Binär-YMT `<collection>_overlays.ymt`. Root `<PedDecorationCollection>` mit `<presets>`-Array. Jedes Preset `<Item>`:
- `<nameHash>` — Konvention `<ytd>_M` / `<ytd>_F` (muss nur eindeutig sein),
- `<txdHash>` = `<txtHash>` = YTD-Dateiname,
- `<zone>ZONE_*</zone>`, `<type>TYPE_TATTOO|TYPE_BADGE</type>`, `<faction>FM</faction>`, `<garment>All</garment>`,
- `<gender>GENDER_MALE|GENDER_FEMALE|GENDER_DONTCARE</gender>`,
- `uvPos`/`scale`/`rotation`/`award`/`awardLevel` (Defaults; Wirkung unbestätigt).

**Zonen** (numerischer Enum): `ZONE_TORSO=0, ZONE_HEAD=1, ZONE_LEFT_ARM=2, ZONE_RIGHT_ARM=3, ZONE_LEFT_LEG=4, ZONE_RIGHT_LEG=5` (+`ZONE_UNKNOWN=6`, `ZONE_NONE=7`). Nur 0–5 sind sinnvoll authorbar.

### Artefakt 3 — `shop_tattoo.meta` (optional)
Root `<TattooShopItemArray>/<TattooShopItems>`. Pro `<Item>`: `<collection>`, `<preset>` (= Overlay-`nameHash`), `<id>`, `<cost>`, `<textLabel>`, `<zone>PDZ_*</zone>`, `<eFacing>TATTOO_*</eFacing>`, `<updateGroup>`, `<eFaction>TATTOO_MP_FM (m) | TATTOO_MP_FM_F (w)</eFaction>`, `<lockHash>`.
**Nur `<collection>` + `<preset>` sind nachweislich load-bearing** für die Anwendung; alle anderen Felder sind kosmetisch/unbestätigt (Risiko c). Da fg-core über `tattoos.json` anwendet, ist `shop_tattoo.meta` reine Vanilla-Shop-Interop → **opt-in, Default aus**.

### Packaging (FiveM)
- YTDs → `stream/`.
- Overlay-`.ymt` und `shop_tattoo.meta` → **Resource-Root** (sie sind `data_file`s, analog zu den First-Person-Alternate-Metas), MIT expliziten `files{}`-Einträgen.
- `fxmanifest.lua`:
  ```lua
  data_file 'PED_OVERLAY_FILE'     '<collection>_overlays.ymt'
  data_file 'TATTOO_SHOP_DLC_FILE' 'shop_tattoo.meta'
  ```

### Runtime-Anwendung (Lua, in fg-core/qbx_core — nicht atelier)
```lua
ClearPedDecorations(ped)
AddPedDecorationFromHashes(ped, GetHashKey(collection), GetHashKey(overlayName))
-- overlayName = hashMale/hashFemale je Ped-Modell (mp_m/mp_f_freemode_01)
-- Native 0x5F5D1665E352A839 / Cfx 0x73115226F4814E62
-- Nach jedem Kleidungs-/Modellwechsel neu anwenden (ClearPedDecorations löscht alle Decals).
```

---

## 4. Offene Entscheidungen für den Nutzer

Diese Forks müssen **vor** dem Coden entschieden werden — sie setzen Phasengrenzen.

### D1 — Overlay-Format für den MVP: `.xml` zuerst oder PSO `.ymt` zuerst?
- **Hintergrund (kritische Code-Realität):** `CPedDecorationCollection`/`CPedDecorationPreset` existieren **nur** in `MetaNames.cs` (Name→Hash), **nicht** als Struct-Layout in `PsoTypes.cs`/`MetaTypes.cs`. `PsoTypes.GetStructureInfo(...)` ist ein hartkodierter Switch ohne diesen Typ → `XmlPso.Traverse` überspringt den Root **still** und schreibt eine leere Datei. `MetaBuilder.AddStructureInfo` no-oped ebenfalls bei `null`. **Beide CodeWalker-Compile-Pfade sind heute kaputt.** `YmtFile.Save()` ist ohnehin ein Dead-End (gibt `null` für diesen Content-Type).
- Option A — **`.xml` zuerst** (reiner `StringBuilder`, wie `ShopMetaGenerator`; Community-Packs liefern `.xml`, FiveM akzeptiert es laut Berichten). Geringes Implementierungsrisiko.
- Option B — PSO `.ymt` zuerst (erfordert mehrtägiges Reverse-Engineering der Struct-Offsets).
- **EMPFOHLENER DEFAULT: A.** `.xml` im MVP (P2) bauen, PSO als spätere Härtung (P3) mit Round-Trip-Assert. (Das invertiert die ursprüngliche Facetten-Empfehlung — bewusst, weil das Implementierungsrisiko größer ist als das Runtime-Akzeptanz-Risiko.)

### D2 — MVP-Bildeingabe: PNG+DDS (neue Dependency) oder nur DDS/YTD?
- **Hintergrund:** Es gibt **keinen PNG-Decoder** im Sidecar. `PngEncoder.cs` ist encode-only; kein `Magick`-Verweis; einzige Bild-Dependency ist `BCnEncoder.Net`. `DDSIO` decodiert nur DDS.
- Option A — `Magick.NET-Q8-AnyCPU` zur `.csproj` hinzufügen (konsistent mit `texture_magic`-Prior-Art), PNG-Input ab MVP.
- Option B — MVP auf `.dds`/`.ytd` beschränken (route durch bestehenden `DDSIO`/`TextureOptimizer`-Disk-Decode-Chain, **null neue Deps**), PNG in P5.
- **EMPFOHLENER DEFAULT: A**, *wenn* die Zielgruppe Tattoo-Künstler sind, die PNG aus Bildeditoren exportieren (sehr wahrscheinlich → PNG ist Table-Stakes). Sonst B. Nutzer entscheidet anhand der Zielgruppe.

### D3 — Separater Screen vs. Workbench-Tab?
- **EMPFOHLEN: separater `'tattoos'`-Screen.** Begründung in §7. (Bestätigen, da Nav/i18n/Persistenz-Verdrahtung danach teuer zu reverten ist.)

### D4 — Eine Collection pro Projekt — final oder Multi-Collection-Zukunft?
- **EMPFOHLEN: gesperrt auf eine.** Constraint-treibend für `txdHash`/Manifest. Bei echtem Bedarf später revisiten.

### D5 — `shop_tattoo.meta` im MVP enthalten?
- Da fg-core über `tattoos.json` anwendet, ist es Vanilla-Shop-Interop-only.
- **EMPFOHLEN: enthalten, Default aus** (`GenerateTattooShopMeta`). Billige String-Generierung, Geschwister von funktionierendem Code.

### D6 — MVP-Done-Akzeptanztest?
- **EMPFOHLEN (vom Nutzer zu ratifizieren):** *„Decal importieren → Zone/Geschlecht setzen → bauen → Resource auf Live-FiveM-Server `ensure`n → `AddPedDecorationFromHashes` rendert es auf einem Freemode-Ped."* Das ist die nicht-verhandelbare P2-Exit-Gate (siehe §10).

---

## 5. Architektur & Datenmodell

### 5.1 Neue GTA-Konstanten — `src/lib/gta/tattoos.ts` (NEU)

Spiegelt `components.ts` (Single Source of Truth, deutsche Labels, lucide-Icons). **Eine einzige Zone→eFacing-Quelle** (Review-MED-Fix: Data-Model und Sidecar müssen byte-identisch sein — der Sidecar `TattooZones`-Table spiegelt diese Tabelle).

```ts
export const TATTOO_ZONE_IDS = ["torso","head","left_arm","right_arm","left_leg","right_leg"] as const;
export type TattooZoneId = (typeof TATTOO_ZONE_IDS)[number];

export const TATTOO_TYPE_IDS = ["tattoo","badge"] as const;
export type TattooTypeId = (typeof TATTOO_TYPE_IDS)[number];

export const TATTOO_GENDER_IDS = ["both","male","female"] as const;
export type TattooGenderId = (typeof TATTOO_GENDER_IDS)[number];

export interface TattooZone {
  id: TattooZoneId;
  zoneValue: number;          // ZONE_* numerischer Enum (Build-Time int)
  overlayName: `ZONE_${string}`;
  shopZone: `PDZ_${string}`;
  defaultFacing: string;      // einzige Quelle für zone→eFacing
  label: string;              // deutsch
  icon: string;               // lucide
}

// Zone→eFacing FINAL (Review reconciled Torso auf CHEST):
export const TATTOO_ZONES: TattooZone[] = [
  { id:"torso",     zoneValue:0, overlayName:"ZONE_TORSO",     shopZone:"PDZ_TORSO",     defaultFacing:"TATTOO_CHEST", label:"Torso",        icon:"Shirt" },
  { id:"head",      zoneValue:1, overlayName:"ZONE_HEAD",      shopZone:"PDZ_HEAD",      defaultFacing:"TATTOO_FRONT", label:"Kopf",         icon:"ScanFace" },
  { id:"left_arm",  zoneValue:2, overlayName:"ZONE_LEFT_ARM",  shopZone:"PDZ_LEFT_ARM",  defaultFacing:"TATTOO_LEFT",  label:"Linker Arm",   icon:"ArrowLeft" },
  { id:"right_arm", zoneValue:3, overlayName:"ZONE_RIGHT_ARM", shopZone:"PDZ_RIGHT_ARM", defaultFacing:"TATTOO_RIGHT", label:"Rechter Arm",  icon:"ArrowRight" },
  { id:"left_leg",  zoneValue:4, overlayName:"ZONE_LEFT_LEG",  shopZone:"PDZ_LEFT_LEG",  defaultFacing:"TATTOO_LEFT",  label:"Linkes Bein",  icon:"MoveDownLeft" },
  { id:"right_leg", zoneValue:5, overlayName:"ZONE_RIGHT_LEG", shopZone:"PDZ_RIGHT_LEG", defaultFacing:"TATTOO_RIGHT", label:"Rechtes Bein", icon:"MoveDownRight" },
];
// ZONE_UNKNOWN=6 / ZONE_NONE=7 NICHT authorbar (kein Shop-Facing, keine sinnvolle Platzierung).

export function getTattooZone(id: string): TattooZone | undefined {
  return TATTOO_ZONES.find((z) => z.id === id);
}
export function isTattooZoneId(id: string): id is TattooZoneId {
  return (TATTOO_ZONE_IDS as readonly string[]).includes(id);
}
```

> **Konsistenz-Fix (Review-LOW):** UI exponiert **genau 6 Zonen** (keine UNKNOWN/NONE). Schema-Enum, UI-Select und i18n decken dieselben 6 Werte ab.

### 5.2 Schema — `src/lib/project/schema.ts`

```ts
export const PROJECT_FILE_VERSION = 2;
```

Tattoo-Felder (`garment`, `textLabel`, `eFacing` werden **gespeichert**, da die UI sie editierbar zeigt — Review-Reconciliation zwischen Facet A und C/E):

```ts
const overlayNameSchema = z.string().min(1).regex(/^[A-Za-z0-9_]+$/, "nur Buchstaben, Ziffern und _");

export const tattooPlacementSchema = z.object({
  uvPosX: z.number(), uvPosY: z.number(),
  scaleX: z.number(), scaleY: z.number(),
  rotation: z.number(),
});
export type TattooPlacement = z.infer<typeof tattooPlacementSchema>;

export const projectTattooSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  groupId: z.uuid().nullable(),

  zone: z.enum(TATTOO_ZONE_IDS),
  type: z.enum(TATTOO_TYPE_IDS),
  gender: z.enum(TATTOO_GENDER_IDS),

  nameMale: overlayNameSchema.nullable(),
  nameFemale: overlayNameSchema.nullable(),

  image: assetRefSchema.nullable(),     // EIN Decal-Bild; kein ydd, keine Textur-Variante

  // gespeicherte, editierbare Felder (Facet C/E Reconciliation):
  garment: z.string().default("All"),
  textLabel: z.string().default(""),
  eFacing: z.string().nullable(),       // null => aus zone.defaultFacing ableiten

  placement: tattooPlacementSchema.nullable(),   // optional; Wirkung unbestätigt
  cost: z.number().int().nonnegative().default(0),
}).superRefine((t, ctx) => {
  if ((t.gender === "both" || t.gender === "male") && !t.nameMale)
    ctx.addIssue({ code:"custom", path:["nameMale"], message:"Männlicher Overlay-Name erforderlich" });
  if ((t.gender === "both" || t.gender === "female") && !t.nameFemale)
    ctx.addIssue({ code:"custom", path:["nameFemale"], message:"Weiblicher Overlay-Name erforderlich" });
});
export type ProjectTattoo = z.infer<typeof projectTattooSchema>;

export const tattooCollectionSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),   // gleiche Charset wie dlcName
  label: z.string(),
});
export type TattooCollection = z.infer<typeof tattooCollectionSchema>;
```

Auf `atelierProjectSchema`:
```ts
  fgcloth: z.literal(PROJECT_FILE_VERSION),
  // ...
  tattooCollection: tattooCollectionSchema,
  tattoos: z.array(projectTattooSchema),
```

Factories: `createEmptyProject` seedet `tattooCollection: { name: dlcName, label: "Tattoos" }` und `tattoos: []`. `createTattoo(input)` mit Defaults (`gender:"both"`, `type:"tattoo"`, `garment:"All"`, `cost:0`, `eFacing:null`, `placement:null`).

### 5.3 Migration — `src/lib/project/migrations.ts`

v1→v2 additiv (nichts am v1-Payload anfassen; zod läuft danach):
```ts
function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = (raw.settings ?? {}) as { dlcName?: unknown };
  const dlcName = typeof settings.dlcName === "string" && settings.dlcName.length > 0
    ? settings.dlcName
    : suggestDlcName(typeof raw.name === "string" ? raw.name : "");
  return { ...raw, fgcloth: 2, tattooCollection: { name: dlcName, label: "Tattoos" }, tattoos: [] };
}
```
Chain in `migrateProjectFile`: `if (version === 1) { doc = migrateV1ToV2(doc); version = 2; }`. Unbekannte/neuere Versionen werfen `ProjectMigrationError` wie bisher.

### 5.4 Store — `src/lib/stores/project-store.ts`

Actions (alle via bestehendes `mutate`, daher **automatisch undoable** via zundo — `partialize` zeichnet nur `project` auf, Tattoos liegen darin):
- `addTattoo(t)`, `updateTattoo(id, patch)`, `removeTattoos(ids)`,
- `reorderTattoo(id, toIndex)` — Bucket-Reorder pro `zone` (spiegelt `reorderDrawable`),
- `updateTattooCollection(patch)`.
- **`removeGroup` erweitern:** auch `tattoos.groupId` nullen (Tattoos teilen `project.groups`).

Selektoren:
- `selectTattoosByZone(project, zone)` — Zone-Bucket in Array-Reihenfolge.
- `selectDerivedTattooBuild(project)` → `Record<id, { ytdFileName, nameMale, nameFemale, collection }>`:
  ```ts
  // ytdFileName = `${collection}_tat_${String(globalIndex).padStart(3,"0")}`  (Review-Fix: global, NICHT zonen-gebucketet)
  // nameMale  = wantsM ? (t.nameMale  ?? `${ytd}_M`) : null
  // nameFemale= wantsF ? (t.nameFemale?? `${ytd}_F`) : null
  ```
  **Wichtig:** `globalIndex` läuft über `project.tattoos` in Array-Reihenfolge (nicht pro Zone), damit `ytdFileName` genau dem Sidecar-`PlanTattoos`-Schema entspricht.

### 5.5 Validierung — `src/lib/project/validation.ts` (NEU)

zod kann keine projektweite Eindeutigkeit; `validateTattoos(project)` sammelt:
1. **Eindeutige Overlay-`nameHash`** projektweit (aus `selectDerivedTattooBuild`).
2. **Eindeutige `ytdFileName`** + `[a-z0-9_]`-Charset.
3. **Bild erforderlich** zum Bauen (`image === null` → Error).
4. Gender/Name-Kohärenz (auch als Build-Error gespiegelt).

### 5.6 Wo Tattoos bewusst von Drawables abweichen

| Aspekt | Drawable | Tattoo | Warum |
|---|---|---|---|
| Geschlecht | eine Zeile pro Geschlecht | eine Zeile trägt beide (`nameMale`/`nameFemale`) | geteilte Kunst über beide Peds |
| Quelldateien | ydd + textures[] + physics | ein `image` | Decal = eine Textur |
| In-Game-ID | numerische `drawableId` aus Bucket | keine — Identität = `collection`+`nameHash` | Native nutzt Hashes, keine Slot-ID |
| Mode | addon/replace | **nur addon** | nur neue Collections |
| Build-Identität | `drawableId` abgeleitet | `ytdFileName`/`txd`/`txt` abgeleitet | harte Engine-Regel txd==txt==Dateiname |

---

## 6. Sidecar-Buildpipeline (C#)

Tattoos sind ein **paralleler Plan-Branch** neben `BuildPlanGender`; der Kleidungspfad bleibt unberührt.

### 6.1 Verbindliche Code-Realitäten (Review-verifiziert — Plan baut darauf)
- **`YmtFile.Save()` ist Dead-End** für Overlay-Content (gibt `null`). Overlay-`.ymt` NIE über `YmtFile`.
- **CodeWalker kennt `CPedDecorationCollection` NICHT** als Struct-Layout. PSO-Compile (`XmlPso`/`MetaBuilder`) produziert heute eine **leere/kaputte Datei**. → **MVP liefert `.xml`** (D1).
- **Kein PNG-Decoder vorhanden.** → MVP `.dds`/`.ytd` ODER `Magick.NET` neu (D2).
- Der **wiederverwendbare** YTD-Tail ist verifiziert: `BcEncoder` (BC3/BC7) → DDS → `DDSIO.GetTexture` → `TextureDictionary.BuildFromTextureList` → `YtdFile.Save()`. Nur der *Head* (Datei→RGBA32) ist neu.

### 6.2 Neue Generatoren

**`sidecar/Engine/Build/TattooTextureBuilder.cs`** — Decal → YTD.
```csharp
public static byte[] BuildYtd(byte[] sourceImageBytes, string ytdName, int maxDim = 512, string format = "BC3");
private static (byte[] rgba, int w, int h) DecodeToRgba(byte[] src);   // DDS via DDSIO; PNG via Magick.NET (D2-A)
```
`tex.Name = ytdName; tex.NameHash = JenkHash.GenHash(ytdName.ToLowerInvariant());` → txd==txt==Dateiname mechanisch garantiert.
> **Review-HIGH-Fix:** Kanalreihenfolge (RGBA vs. BGRA) ist **NICHT** als „certain" zu behandeln. `DDSIO`/`Texture`/`FaceAssets` haben unterschiedliche Swizzle-Konventionen. **Pflicht:** Farb-Round-Trip-Test (bekannte Farbe encoden → re-decoden → R/G/B asserten). Die BC3/BC7-*Wahl* ist sicher; die Kanal-Plumbing nicht.

**`sidecar/Engine/Build/TattooOverlayGenerator.cs`** — Overlay-Metadaten.
```csharp
public static string BuildXml(TattooPlanCollection plan);   // PRIMÄR im MVP (P2)
public static byte[] BuildPso(TattooPlanCollection plan);    // P3, NUR nach Struct-Layout-Arbeit + Round-Trip-Assert
```
`BuildXml` = reiner `StringBuilder`/`AppendLf`/`SecurityElement.Escape` (Geschwister von `ShopMetaGenerator`). Pro Tattoo:
- `gender === "both"` mit geteilter Kunst → **ein** Preset `GENDER_DONTCARE` (ein `nameHash`); `tattoos.json` setzt `hashMale`=`hashFemale`=dieser Name. (Review-LOW-Fix: keine zwei DONTCARE-Presets.)
- `gender === "male"`/`"female"` → ein gegendertes Preset.
- Optional zwei gegenderte Presets nur bei echt unterschiedlicher Kunst (out of MVP scope).
- `<txdHash>`=`<txtHash>`=`ytdFileName` (immer der *eigene* YTD-Name).

**`sidecar/Engine/Build/TattooShopMetaGenerator.cs`** — `shop_tattoo.meta` (XML, opt-in via `GenerateTattooShopMeta`). Nur `<collection>`+`<preset>` load-bearing; Rest sane Defaults (`cost`, sequentielle `id`, `eFacing` aus Zone-Map, `lockHash=0x00000000`).

**`sidecar/Engine/Build/TattooManifestGenerator.cs`** — `tattoos.json` (§9). Resource-Root, NICHT `stream/`.

### 6.3 BuildPlanner — `sidecar/Engine/Build/BuildPlanner.cs`
Neue Plan-Typen `TattooPlanItem` (`YtdName`, `SourceImagePath`, `ZoneId`, `ZoneName`, `PdzZoneName`, `EFacing`, `OverlayType`, `Gender`, `TextLabel`, `Cost`, Placement-Floats) + `TattooPlanCollection { Collection, Items }`.
`PlanTattoos(project, projectDir, options)`: `YtdName = $"{options.DlcName}_tat_{nnn:D3}"`, nnn 0-basiert über `project.Tattoos` in Datei-Reihenfolge. Skip+Warn bei fehlendem Bild/unbekannter Zone/Dup-nameHash.
`BuildPlan` bekommt `TattooPlanCollection? Tattoos`. `StreamNames`-Helper für Collection/Overlay-Datei/Shop-Meta.
**`AtelierProjectDto` (`ProjectModel.cs`)** bekommt `List<ProjectTattooDto>? Tattoos` (case-insensitive Binder ignoriert es bei Kleidungs-only-Projekten → null Risiko) + `TattooZones`-Table in `GtaSlots` (spiegelt `tattoos.ts` byte-für-byte).

### 6.4 FivemBuilder — `sidecar/Engine/Build/Targets/FivemBuilder.cs`
Einmalige Pack-Emission nach der Part-Schleife (Tattoos splitten nicht → leben in Part 1):
- YTDs → `<part1>/stream/<YtdName>.ytd`.
- Overlay → `<part1>/<collection>_overlays.ymt` (oder `.xml`-Variante im MVP, gleicher Dateiname-Stamm) — **Resource-Root**.
- `shop_tattoo.meta` → `<part1>/shop_tattoo.meta` (nur wenn `GenerateTattooShopMeta`).
- `tattoos.json` → `<part1>/tattoos.json`.

**`BuildFxManifest`** (Review-HIGH-Reconciliation: Root-Platzierung + explizite `files{}`):
```lua
files {
  'stream/*.ydd', 'stream/*.ytd', 'stream/*.yld', 'stream/*.meta', 'stream/*.ymt',
  '<collection>_overlays.ymt',   -- explizit, da Root (Glob ist stream/-scoped)
  'shop_tattoo.meta',            -- explizit, nur wenn generiert
  'tattoos.json',
}
data_file 'PED_OVERLAY_FILE'     '<collection>_overlays.ymt'
data_file 'TATTOO_SHOP_DLC_FILE' 'shop_tattoo.meta'   -- nur wenn generiert
```
> Wenn D1=`.xml`: `data_file 'PED_OVERLAY_FILE' '<collection>_overlays.xml'` + `'<collection>_overlays.xml'` in `files{}`.

### 6.5 Build-Guards (Review-HIGH: ZWEI Guards!)
- `BuildEndpoints.cs:88` (`project.Drawables == null || Count == 0`) → `&& (Tattoos null/leer)`.
- `BuildEndpoints.cs:128` (`if (totalDrawables == 0) job.Fail(...)`) → ebenfalls `&& tattoos-empty`. **Beide** ändern, sonst scheitert ein Tattoo-only-Build als *Job-Fehler*.

### 6.6 `atelier-build.json` (`BuildCommon.WriteBuildManifest`)
Additiv: `"tattoos": { "collection": ..., "count": N, "manifest": "tattoos.json" }` (weggelassen wenn 0 → Kleidungs-Builds byte-stabil).

### 6.7 Neue Endpoints
- `/parse/tattoo` (Decode via DDSIO/Magick.NET → `{width,height,isPow2,hasAlpha,thumbBase64}`).
- `/debug/tattoo` (re-parst emittiertes Overlay → Preset-Count + nameHashes; testet PSO-Akzeptanz in-tool vor Server-Round-Trip).
- *(KEIN `/preview/tattoo` im MVP — die flache Vorschau nutzt `/parse/ytd`-Thumbnails; Review-Cut.)*

### 6.8 `.csproj`
Bei D2=A: `Magick.NET-Q8-AnyCPU` (Version pinnen). Bei D2=B: keine neue Dependency.

---

## 7. UI/UX — Der Tattoos-Bereich

### 7.1 Separater Screen (`'tattoos'`), Geschwister von `'workbench'`
Begründung: anderes Domänenmodell (Zone/Typ statt Slot/Component, ein Bild statt ydd+26 Texturen), eigenes Layout, eigene Panel-Persistenz. Ein Tab in `workbench.tsx` würde jeden Workbench-Selektor (`viewGender`, `category: SlotId`, `selectDerivedDrawableIds`) zum Mode-Branchen zwingen → Wartungsfalle. Beide Bereiche teilen automatisch `useProjectStore` (gleiches offenes Projekt).

### 7.2 Nav-Verdrahtung (paste-ready)
- `src/lib/stores/ui-store.ts`: `export type Screen = "launcher" | "workbench" | "tattoos" | "settings";`
- `src/components/shell/top-bar.tsx`: `NAV_ITEMS` += `{ screen:"tattoos", labelKey:"nav.tattoos", icon: Sparkles }` (Icon `Sparkles` — `Sticker` ist vom `decl`-Slot belegt). `nav.tattoos` in `shell.json` (de: „Tätowierungen", en: „Tattoos").
- `src/App.tsx`: Import + `{screen === "tattoos" && <TattoosScreen />}`; Backdrop-Branch auf Grid umstellen (`screen === "workbench" || screen === "tattoos"`).

### 7.3 Komponentenbaum (NEU, kebab-case, je Datei Doc-Comment)
```
src/screens/tattoos.tsx
src/lib/stores/tattoo-workbench-store.ts          (View-State: groupBy, Zone-Filter, Suche, Selektion)
src/components/tattoos/
  tattoo-header.tsx           tattoo-zone-tree.tsx     tattoo-grid.tsx
  tattoo-card.tsx             tattoo-inspector.tsx     tattoo-inspector-fields.tsx
  tattoo-thumb.tsx            tattoo-empty-state.tsx   tattoo-drop-overlay.tsx
src/lib/i18n/locales/{en,de}/tattoos.json
```
Layout: `ResizablePanelGroup autoSaveId="atelier:tattoos:h"` — Zone-Tree (20%) · Grid (52%) · Inspector (28%). **Kein 3D-Panel im Default** (Vorschau = Grid-Thumbnail im MVP).

### 7.4 Selektion & Gruppen
- Selektion im **separaten** `tattoo-workbench-store`, NICHT `useProjectStore.selection` (unabhängig von Kleidung).
- Gruppen werden **geteilt** (`project.groups`). `removeGroup`/`assignGroup` müssen Tattoos einbeziehen (§5.4). Mixed-Selektion vermeiden — separates `assignTattooGroup` falls nötig.
- **Drop-Overlay:** EIN globaler Tauri-`onFileDrop`-Listener, der per `useUiStore.getState().screen` dispatcht (nicht zwei konkurrierende Listener).

### 7.5 Import
- Picker `pickAndImportTattoos()` (Spiegel von `pickAndImportFiles()`), Extensions je D2 (`["dds","ytd"]` oder `+["png"]`).
- Drag-and-Drop via `tattoo-drop-overlay.tsx`.
- Jede Datei → ein `ProjectTattoo`: `label`=Dateiname-Stamm, `zone`="torso", `gender`=View-Filter oder "both", auto-`nameMale`/`nameFemale` (`<stem>_M`/`_F`), Bild kopiert nach `assets/tattoos/…` → `AssetRef` (erweitert `import-assets.ts`/`io.ts`).

### 7.6 Inspector-Felder → Schema
| Feld | Control | `ProjectTattoo` | Maps to |
|---|---|---|---|
| Thumbnail | `tattoo-thumb` (read-only) | `image` | YTD-Quelle |
| Label | Input | `label` | UI + shop `textLabel`-Default |
| Zone | Select (6) | `zone` | overlay `<zone>` + shop PDZ_* |
| Geschlecht | Select m/w/beide | `gender` | overlay `<gender>` + Namen + shop `eFaction` |
| Overlay-Name (M) | Input mono | `nameMale` | overlay `<nameHash>` / `hashMale` |
| Overlay-Name (F) | Input mono | `nameFemale` | overlay `<nameHash>` / `hashFemale` |
| Typ | Select | `type` | overlay `<type>` |
| Garment | Select (Default „Alle") | `garment` | overlay `<garment>` |
| Zeichenreihenfolge | Array-Position/Drag | array order | Stack-Order |
| Gruppe | Select | `groupId` | UI-only |
| — Shop — | Separator | | |
| Preis | Input | `cost` | shop `<cost>` |
| Shop-Label | Input | `textLabel` | shop `<textLabel>` |
| eFacing | Select | `eFacing` | shop `<eFacing>` (null→Zone-Default) |
| — Erweitert (collapsed, „experimentell") — | Collapsible | | |
| UV X/Y, Scale X/Y, Rotation | Inputs | `placement` | overlay uvPos/scale/rotation — Wirkung unbestätigt |

- **Collection** ist KEIN Inspector-Feld (eine pro Pack); read-only im Inspector + editierbar in Settings.
- `id`/`updateGroup`/`lockHash` werden NICHT exponiert.
- Single zeigt alles; Bulk (2+) nur sicher-setzbare: Zone/Geschlecht/Typ/Garment/Gruppe/Preis/Löschen.

### 7.7 i18n
Namespace = Dateiname (auto-globbed, keine Registrierung). `tattoos.json` (de/en) mit `noProject`/`header`/`zoneTree`/`zone`/`facing`/`grid`/`inspector`/`filePicker`/`dropOverlay`. Plus `nav.tattoos` in `shell.json`. Design-System (Farben, Glass-Container, Controls) komplett wiederverwendet.

---

## 8. 3D-Vorschau (phasiert)

### Phase früh (P1, MVP) — flache 2D-Vorschau
- **Decal-Bild** mit Alpha auf Schachbrett-Hintergrund: `parseYtd(path, { thumbnails })` liefert bereits `thumbnailPngBase64` (Wiederverwendung des YTD-Thumbnail-Pfads). Für DDS/PNG analog über `/parse/tattoo`.
- **Zonen-Diagramm:** statisches SVG-Körper-Silhouette (vorne/hinten) mit 6 hervorhebbaren Zonen; aktive Zone markiert. Reines Frontend.
- Funktioniert **ohne** konfigurierten GTA-Pfad (gleiche Population, die heute keinen Ped-Body hat). Ehrlich: Tattoos sind Fixed-UV — „wie das Decal aussieht + wo es landet" ist der Großteil der Wahrheit.

### Phase spät (P4, optional) — On-Body via Sidecar-Compositing (Approach A)
**Präzedenz:** `FaceCompositor` blendet bereits Alpha-Decals auf die 512×512-Body-Skin-Diffuses (head/uppr/lowr/feet) und gibt sie als `DiffuseOverride` RGBA in die GLB. Tattoos = derselbe Pfad, nur uppr/lowr-Regionen statt head. Kein Runtime-Material-Editing in three.js (Invariante bleibt).

**Approach B (Client-three.js-Decal) wird verworfen** — er würde eine parallele Renderarchitektur gegen die No-Runtime-Materials-Invariante bauen und die Body-Skin-UV in JS neu implementieren.

**Korrigierte Reuse-Claims (Review-MED):**
- **NICHT** `FaceAssets.Decode` wiederverwenden (RpfMan-gebunden, game-asset-scoped, private). Stattdessen den `TextureOptimizer`-Disk-Decode-Chain (`RpfFile.CreateResourceFileEntry`→`ResourceBuilder.Decompress`→`GetFile<YtdFile>`→`DDSIO.GetPixels`) für die User-YTD von der Platte.
- **Seed-from-base-diffuse ist echte Arbeit**, kein trivialer Helper: für Regionen ohne Face-Override muss die Freemode-Basis-Diffuse (uppr/lowr, inkl. Ethnizitäts-Fallback) aus dem RPF extrahiert werden.

**Contract-Plumbing (byte-identisch beide Sprachen):**
- `src/lib/sidecar/types.ts`: `PedAppearanceTattoo { ytdPath, zone, opacity? }`; auf `PedAppearance`/`PreviewGlbRequest`/`PreviewOutfitRequest`.
- `src/lib/preview/appearance.ts`: `appearanceKey()` += `|t=…`-Segment (sortiert, **absent-when-empty** → bestehende Keys byte-identisch).
- `src/lib/sidecar/client.ts`: `...(request.tattoos?.length ? { tattoos } : {})`.
- `sidecar/Api/Dtos.cs`: `PedAppearanceTattooDto` + `PedAppearanceKey.Canonical` += `|t=…` (byte-identisch zur TS-Seite).
- `sidecar/Api/PreviewEndpoints.cs`: `ValidateAppearance` (Zone-Enum, `.ytd` existiert, Opacity geclampt).
- Neu `sidecar/Engine/Face/TattooCompositor.cs` + `PedBodyService.cs` (Tattoo-Pass nach `ApplyFace`).

**Limits (ehrlich):**
- UV-Nähte sind im Preview sichtbar — aber **die Engine hat dieselben Nähte** (preview ist game-treu).
- Zone→Component ist grob: Torso+Arme→uppr(3), Beine→lowr(4), Kopf→head(0). **Hypothese, nicht format-zertifiziert** (Review-LOW) — als Runtime-Test-Gate flaggen. Zone repositioniert NICHT (nur informativ).
- `uvPos`/`scale`/`rotation` werden im Preview NICHT geehrt (Risiko a). Native UV, keine Transform.
- Layering = CPU-Alpha-over in fester Reihenfolge → „approximate stacking" (Risiko d).
- **Cross-Language-Key-Drift** (Review-MED): Pflicht-Fixture-Test, der TS- *und* C#-`Canonical` auf denselben Literal pinnt (sonst still falsches gecachtes GLB).

---

## 9. Interop & Runtime-Contract

### 9.1 `tattoos.json` (Runtime-Manifest)
Geschrieben nach `<resource>/tattoos.json` (Root, NICHT `stream/` → nie gestreamt; via `LoadResourceFile` gelesen). Superset des illenium/fivem-appearance-Rows.

```jsonc
{
  "schema": "feelgood.atelier.tattoos/1",
  "tool": "atelier by feelgood",
  "builtAt": "2026-06-22T10:00:00.0000000Z",
  "collection": "fg_ink_streetwear",
  "resource": "fg_ink_streetwear",
  "tattoos": [
    {
      "name": "fg_ink_streetwear_tat_000",
      "label": "Totenkopf (Rücken)",
      "hashMale":   "fg_ink_streetwear_tat_000_M",
      "hashFemale": "fg_ink_streetwear_tat_000_F",
      "zone": "ZONE_TORSO",
      "collection": "fg_ink_streetwear",
      "type": "TYPE_TATTOO",
      "genders": ["male","female"]
    }
  ]
}
```
- `hashMale`/`hashFemale` sind **Strings** (Runtime joaatet via `GetHashKey`) — diffbar, eindeutig.
- **Single-Gender-Null-Contract (Review-LOW-Fix):** Bei single-gender Tattoos wird der fehlende Hash auf den **vorhandenen** Hash gesetzt (Fallback), NICHT `null`. So ist ein illenium-geformter Konsument (`IsPedModel(...) and hashFemale or hashMale`) nie mit `GetHashKey(nil)` konfrontiert. `genders` zeigt zusätzlich, welche real sind.
- `name` = `ytdFileName` (stabile Identität über Rebuilds; Hashes leiten deterministisch aus den Strings ab).

### 9.2 Ableitungsregeln (atelier → Artefakt → Runtime)
| atelier-Quelle | Regel | overlay | shop | tattoos.json | Runtime |
|---|---|---|---|---|---|
| `settings.dlcName` | as-is (`[a-z0-9_]`) | collection-Name | `<collection>` | `collection` | `joaat(collection)` arg1 |
| `ytdFileName` = `<collection>_tat_<NNN>` | global indexiert | `<txdHash>`+`<txtHash>` | — | `name` | YTD-Lokalisierung |
| + `_M` / `_F` | gegendert-eindeutig | `<nameHash>` | `<preset>` | `hashMale`/`hashFemale` | `joaat(name)` arg2 |
| `zone` | numerisch + Name | `<zone>` | `<zone>`→PDZ_* | `zone` | Menü-Grouping |
| `type` | TYPE_TATTOO default | `<type>` | — | `type` | Klassifikation |
| `gender` | welche `_M`/`_F` real | `<gender>` | `<eFaction>` | `genders` | gültiger Native-Call |
| `eFacing` (oder Zone-Default) | aus `tattoos.ts` | — | `<eFacing>` | — | Shop-Anzeige |
| statisch | Konstanten | `faction=FM`, `garment=All`, uvPos/scale/rot/award Defaults | `cost`, seq. `id`, `lockHash=0x0` | — | — |

### 9.3 DurtyFree-Referenzdatensatz
**Getrimmte Kopie vendoren** (`src/lib/gta/stock-overlay-collections.json`), kein Runtime-Download. Zweck: Kollisions-Warnung wenn `dlcName`/`nameHash` mit Stock kollidiert. Nur Namens-Blockliste, kein Per-Overlay-Metadata. **P5 / optional cuttbar** (Addon-Collections nutzen ohnehin projektunieke Namen).

### 9.4 Server-Integrator-Checkliste (Lua, OUT of atelier scope)
1. Resource `ensure`n; `data_file`-Einträge laden Collection + Shop.
2. `json.decode(LoadResourceFile(res, 'tattoos.json'))` → `.tattoos` iterieren (NIE das YMT parsen).
3. Pro Ped: `ClearPedDecorations(ped)`, dann pro Tattoo `AddPedDecorationFromHashes(ped, GetHashKey(t.collection), GetHashKey(IsPedModel(ped, \`mp_f_freemode_01\`) and t.hashFemale or t.hashMale))`.
4. Nach jedem Modell-/Kleidungswechsel neu anwenden.
5. Persistieren per `{collection, name}` (stabil über Rebuilds).
6. Auf erstem Apply prüfen, ob YTD gestreamt wurde (fehlendes Decal rendert lautlos nichts — `txd==txt==Dateiname` ist der übliche Fehlerpunkt).

---

## 10. Phasenplan

Re-cut als **vertikale, lieferbare Inkremente** (nicht nach Facette). MVP-Linie = zwischen **P2 und P3**.

### P0 — Schema- & Migrations-Spine
- **Ziel:** `fgcloth 1→2`, `tattoos[]`/`tattooCollection`, `createTattoo`, Store-Actions, Validierung, Selftests.
- **Tasks:** `src/lib/gta/tattoos.ts` (NEU); `schema.ts` (Version-Bump, Tattoo-Zod+Typen, Factories); `migrations.ts` (v1→v2-Lift); `validation.ts` (NEU); `project-store.ts` (Actions, `reorderTattoo`, `selectDerivedTattooBuild`, `removeGroup`-Erweiterung); `__selftest__.ts` (`[7] tattoos` + `[2] migrations` aktualisiert).
- **Done:** `bun run selftest:project` grün; v1-Packs laden weiter; keine UI.

### P1 — Authoring-UI (kein Build, kein On-Body-Preview)
- **Ziel:** `'tattoos'`-Screen, Import → `ProjectTattoo`, Inspector, flache 2D-Vorschau + Zonen-SVG.
- **Tasks:** Nav-Verdrahtung (§7.2); alle `src/components/tattoos/*`; `tattoo-workbench-store.ts`; `tattoos.json` i18n; `import-assets.ts`/`io.ts` (`assets/tattoos/`); flache Vorschau via `/parse/ytd`-Thumbnail + Zonen-SVG.
- **Done:** Nutzer importiert Bilder, organisiert, setzt Felder, speichert `pack.atelier` mit Tattoos. **Noch kein Game-Pack.**

### P2 — MVP-BUILD (erstes echt nützliches Deliverable)
- **Ziel:** YTD-Build + Overlay (**als `.xml`**) + `shop_tattoo.meta` (opt-in) + `tattoos.json` + fxmanifest + `atelier-build.json`-Counts + Build-Guard-Fix.
- **Tasks:** `TattooTextureBuilder.cs` (+ Farb-Round-Trip-Test); `TattooOverlayGenerator.cs` (`BuildXml`); `TattooShopMetaGenerator.cs`; `TattooManifestGenerator.cs`; `BuildPlanner.cs` (`PlanTattoos`, Plan-Typen); `ProjectModel.cs` (`Tattoos`-DTO, `TattooZones`); `FivemBuilder.cs` (Emission + fxmanifest, Root-Platzierung + explizite `files{}`); `BuildCommon.cs`; `BuildEndpoints.cs` (**beide** Guards); `/parse/tattoo`, `/debug/tattoo`; `.csproj` (Magick.NET falls D2=A).
- **Done / EXIT-GATE (nicht-verhandelbar, D6):** Decal importieren → Zone/Geschlecht setzen → bauen → Resource auf **Live-FiveM-Server** `ensure`n → `AddPedDecorationFromHashes` rendert das Tattoo auf einem Freemode-Ped. Erst hier werden die offenen Fragen a–d beantwortet.

### P3 — PSO-Härtung
- **Ziel:** Overlay zu echtem PSO `.ymt` kompilieren — **nur** nach (a) Grep-Bestätigung, dass `PsoTypes.cs`/`MetaTypes.cs` `PedDecorationCollection` kennen, sonst (b) Hand-Authoring der Struct-Layouts (`CPedDecorationCollection`/`CPedDecorationPreset`, mehrtägiges RE, Gating-Task).
- **Tasks:** `TattooOverlayGenerator.BuildPso` + **Pflicht-Round-Trip-Assert** (`/debug/tattoo` re-parst → Preset-Count == erwartet); `.xml` als Fallback-Flag.
- **Done:** In-Game-Test bestätigt PSO lädt; `.xml` bleibt als Fallback.

### P4 — On-Body-3D-Vorschau
- **Ziel:** FaceCompositor → `TattooCompositor`, appearance-key `|t=…` (byte-identisch beide Sprachen), `ValidateAppearance`, ped-body-gated.
- **Tasks:** §8-Plumbing (types/client/appearance/Dtos/PreviewEndpoints/TattooCompositor/PedBodyService); TS-Selftest + **C#-Fixture-Test** für Key-Parität; Seed-from-base-diffuse-Pfad.
- **Done:** Decal backt auf uppr/lowr-Skin im 3D-Viewer; Key-Contract testabgedeckt.

### P5 — Politur & Guardrails
- **Ziel:** DurtyFree-Kollisions-Blockliste, uvPos/scale/rotation-„experimentell"-Block (nur wenn Live-Test Wirkung zeigt), PNG-Input (falls D2=B), Layering-Warnungen.
- **Done:** Nice-to-haves gelandet; experimentelle Felder hinter Disclosure.

---

## 11. Risiken & offene Fragen

### Offene Fragen (brauchen Live-FiveM-Test — NICHT als Fakt verkaufen)
- **(a) `.xml` vs. kompiliertes PSO `.ymt` für `PED_OVERLAY_FILE`.** MVP liefert `.xml` (geringeres Implementierungsrisiko). PSO ist Härtung (P3). XML-Akzeptanz durch FiveM ist die höchste-Risiko-Runtime-Behauptung → P2-Exit-Gate beweist sie.
- **(b) Wirkung von `uvPos`/`scale`/`rotation`.** Wahrscheinlich minimal (Fixed-UV). Felder gespeichert, Defaults emittiert, KEINE Editier-UI bis Test Wirkung beweist.
- **(c) Welche `shop_tattoo.meta`-Felder load-bearing sind.** Nur `collection`+`preset` sicher. Shop-Meta opt-in. Rest kosmetisch bis bewiesen.
- **(d) Layering / Z-Fighting** beim Stapeln mehrerer Decals pro Zone. Manifest trägt keine Z-Order; Stacking = sequenzielle Native-Calls (Server-Sache). Preview „approximate".

### Implementierungsrisiken (Code-verifiziert)
- **R1 (CRITICAL) — PSO-Struct-Info fehlt.** `CPedDecorationCollection` ist nicht im hartkodierten `PsoTypes`/`MetaTypes`-Switch → CodeWalker-Compile schreibt **still** eine leere Datei. Mitigation: MVP=`.xml`; vor P3 greppen; Round-Trip-Assert **pflicht**.
- **R2 (HIGH) — Runtime-Akzeptanz unbestätigt bis Live-Test.** Ein Pflicht-In-Game-Smoke-Test = P2-Exit. P3/P4 NIE auf unbestätigtem P2 bauen.
- **R3 (HIGH/Format) — YTD-Dateiname-Schema.** Genau ein YTD pro Decal, `<collection>_tat_<NNN>`, txd==txt==Dateiname. (Per-Pack-Single-YTD und zonen-gebucketet sind widerlegt.) `selectDerivedTattooBuild` (TS) und `PlanTattoos` (C#) müssen denselben globalen Index nutzen.
- **R4 (HIGH/Format) — Kanal-Swizzle.** RGBA vs. BGRA durch CodeWalker NICHT zertifiziert. Pflicht-Farb-Round-Trip-Test in P2.
- **R5 (MED) — PNG-Decoder fehlt.** Magick.NET neu (D2-A) oder DDS/YTD-only (D2-B).
- **R6 (MED) — Cross-Language-Key-Drift (P4).** Fixture-Test pinnt TS+C# auf denselben Literal; „absent-when-empty" hält bestehende Keys identisch.
- **R7 (MED) — fxmanifest-Platzierung.** Overlay/`.meta` im Resource-Root + explizite `files{}`-Einträge (Glob ist `stream/`-scoped). Nicht auf „schon geglobbt" verlassen.
- **R8 (LOW) — beide Build-Guards.** `BuildEndpoints.cs:88` UND `:128` relaxen.
- **R9 (LOW) — Zwei Selektions-/Gruppen-Systeme.** Tattoo-Selektion separat, Gruppen geteilt → `removeGroup`/`assignGroup` synchron halten.

---

## 12. Test-/Verifikationsstrategie

### Selftests (bun, `src/lib/project/__selftest__.ts` — `[7] tattoos`)
- zod-Round-Trip mit Tattoos (verlustfrei inkl. `tattooCollection`, `placement:null`, `cost:0`, `garment:"All"`).
- superRefine: `gender:"both"` mit `nameFemale:null` abgelehnt; `gender:"male"` mit nur `nameMale` akzeptiert.
- Bad Charset (`nameMale:"bad name!"`) + bad `tattooCollection.name` abgelehnt.
- Migration v1→v2: `{fgcloth:1,…}` → `fgcloth:2`, `tattoos:[]`, `tattooCollection.name === settings.dlcName`; v1-Drawables unverändert; `{fgcloth:99}` wirft.
- Derived Build-Namen: drei Tattoos → `<collection>_tat_000/001/002` (global indexiert); Reorder → Namen folgen.
- Konventions-Fallback: `nameMale:null, gender:"both"` → `<ytd>_M`/`_F`.
- `selectTattoosByZone`, `validateTattoos` (Duplikat-nameHash, fehlendes Bild).
- Store-Reorder + `temporal.undo()`; `removeGroup` nullt Tattoo-`groupId`.

### Sidecar-Tests (C#)
- **Farb-Round-Trip** (R4): bekannte-Farbe-PNG/DDS → YTD → re-decode → R/G/B asserten.
- **txd==txt==Dateiname** strukturell (kann nicht driften).
- `/debug/tattoo`: emittiertes Overlay re-parsen → Preset-Count == erwartet (Gate für PSO in P3).
- **Cross-Language-Key-Fixture** (P4): bekannte Appearance+Tattoo-Set → erwarteter Canonical-String, identisch in TS-Selftest und C#-Unit-Test.

### Live-FiveM-Smoke-Test (P2-Exit-Gate, nicht-verhandelbar)
Decal importieren → Zone/Geschlecht setzen → bauen → Resource `ensure`n → `tattoos.json` lesen → `AddPedDecorationFromHashes` auf `mp_m_freemode_01` UND `mp_f_freemode_01` → Tattoo sichtbar. Verifiziert offene Fragen a (XML-Akzeptanz), c (Shop-Felder), d (Layering) und die `txd==txt==Dateiname`-Regel in einem Durchlauf.

### Build-Befehle
- `tsc && vite build`, `bun run selftest:project`.
- Sidecar: `.NET 8`-Build + Unit-Tests vor jedem Pack-Build.
