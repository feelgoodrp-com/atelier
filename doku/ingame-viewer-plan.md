# In-Game-Viewer (FiveM) + Fortschrittsring für den Projekt-Check

Stand 2026-07-21. Recherche gegen den echten Code (atelier, qbx_core, fg-core, fgTxAdmin),
anschließend ein Kritik-Durchgang; die Korrekturen daraus sind hier schon eingearbeitet.
Alles mit `?` ist **unbewiesen** und muss im P0-Spike gemessen werden, nicht angenommen.

---

## 0. Was der Viewer NICHT kann — bitte zuerst lesen

**Der Viewer kann nur Kleidung zeigen, die auf dem Server läuft, mit dem du gerade verbunden bist.**

FiveM lädt Assets ausschließlich vom verbundenen Server. Weder `LoadResourceFile` noch die
Ped-Natives sehen eine Resource, die nur lokal auf deiner Platte liegt. Es gibt keine
Laufzeit-Injektion von Streaming-Assets.

Daraus folgt der reale Arbeitsablauf:

```
atelier-Build  →  Pack in den resources-Ordner des Servers  →  ensure/restart  →  /atelier im Spiel
```

Das ist ein **QA- und Browse-Werkzeug für deployte Packs**, kein Ersatz für die
3D-Vorschau im atelier (die deckt den lokalen Fall schon ab). Für einen schnellen Loop
lohnt sich ein lokaler FXServer, in den das Pack direkt gebaut wird.

Wenn du dir etwas anderes vorgestellt hast — sag es, bevor gebaut wird: dann ist es ein
anderes Produkt mit anderer UI.

---

## 1. Das eigentliche Risiko: der Drawable-Index

Ein Pack wird mit **lokalen** Indizes gebaut: `localIndex` im `atelier-pack.json` ist
identisch mit dem `NNN` im Streamnamen und mit `pedXml_drawblIdx` im YMT
(`BuildPlanner.cs:374-380` ↔ `YmtGenerator.cs:104-105`) und beginnt in **jedem Part**
wieder bei 0 (`BuildPlanner.cs:197-202`).

`SetPedComponentVariation` nimmt aber einen **globalen** Index über Vanilla + alle DLCs.
Der Zusammenhang zwischen beiden ist damit **nicht bekannt** und wird auch nicht durch
das Manifest gelöst.

Drei mögliche Auflösungen, in dieser Reihenfolge zu prüfen:

1. **Enumerations-Natives für DLC-Daten** (`GET_NUM_DLC_*` o. ä.) — *Existenz unbewiesen,
   möglicherweise erfunden.* Zuerst verifizieren, nicht einplanen.
2. **Offset-Heuristik:** `GetNumberOfPedDrawableVariations(ped, slot)` vor und nach dem
   Laden des Packs vergleichen; die Differenz ist der Offset-Block. Nur belastbar mit
   Read-back (siehe unten) und nur solange genau ein Pack pro Slot dazukommt.
3. **Browse-Modus:** gar nicht zuordnen, sondern alle vorhandenen Indizes eines Slots
   durchblättern und die Labels des Manifests nur dort anzeigen, wo die Zuordnung
   sicher ist. Funktioniert immer, ist der Fallback und deshalb ohnehin nötig.

**Read-back ist Pflicht.** Es gibt keine „hat geklappt"-API: die Engine clamped einen
ungültigen Index still auf einen gültigen. Nach jedem `SetPedComponentVariation` muss mit
`GetPedDrawableVariation` zurückgelesen werden — ohne das ist Variante 2 nicht messbar,
sondern Glaube.

`mode: "replace"`-Drawables sind der Sonderfall mit **stabilem** globalem Index: sie
ersetzen ein Vanilla-Teil und benutzen `replaceTargetId` als NNN
(`BuildPlanner.cs:276-286`). Sie funktionieren auch dann, wenn 1–3 scheitern.

---

## 2. Erkennung: nur mit Haken, sonst unsichtbar

Belegt durch echten Code in diesem Workspace:
`LoadResourceFile(res, path)` liest aus **fremden** Resources
(`qbx_core/bridge/qb/shared/compat.lua:51`, `qbx_core/inventory/clothing_cloud_sync.lua:39`),
`GetNumResources()`/`GetResourceByFindIndex(i)` zählen alle auf
(`fgTxAdmin/resource/sv_main.lua:107-109`).

```lua
for i = 0, GetNumResources() - 1 do
  local res = GetResourceByFindIndex(i)
  if res and GetResourceState(res):find('start') then      -- 'starting' beim Boot mitnehmen
    local raw = LoadResourceFile(res, 'atelier-pack.json')
    if raw then
      local ok, m = pcall(json.decode, raw)
      if ok and type(m) == 'table' and (m.schema or ''):sub(1, 22) == 'feelgood.atelier.pack/' then
        packs[#packs + 1] = m
      end
    end
  end
end
```

Kein Haken → keine Datei → das Pack existiert für den Viewer nicht. Keine Heuristik,
kein Einsammeln fremder Kleidungs-Resources.

**Falle:** Die Datei muss in `files{}` der fxmanifest stehen, sonst ist sie clientseitig
nicht lesbar — genau der Fehler, den `atelier-build.json` heute schon hat.

**Zweites Signal, gratis:** `manifest.textures` gegen `GetNumberOfPedTextureVariations`
vergleichen → Badge **„live"** vs. **„nicht geladen"** in der Pack-Liste. Fängt den Fall
ab, dass das Manifest da ist, die Assets aber nicht (Resource gestoppt, Server-Build ohne
YMT). Ohne dieses Badge sieht der Nutzer nur einen Standard-Torso ohne Erklärung.

---

## 3. `atelier-pack.json` (Schema v1)

Geschrieben **pro Part** neben `BuildCommon.WriteBuildManifest` (`FivemBuilder.cs:128`),
Vorbild ist der bereits existierende `TattooManifestGenerator.cs`.

```jsonc
{
  "schema": "feelgood.atelier.pack/1",
  "generatedAt": "2026-07-21T12:00:00Z",
  "tool": "atelier 1.9.0",
  "pack": {
    "projectId": "…",              // Join-Key über alle Parts
    "name": "Winter Drop",
    "resource": "winterdrop_part2",
    "dlcName": "winterdrop2",      // pro Part verschieden!
    "part": 2, "partCount": 3
  },
  "groups": [ { "id": "g1", "name": "Hoodies" } ],
  "items": [
    {
      "kind": "component",         // "component" | "prop"  → macht slotId eindeutig
      "gender": "male",
      "ped": "mp_m_freemode_01",   // IMMER gesetzt, auch bei Props
      "slot": "uppr",
      "slotId": 3,                 // componentId bei kind=component, anchorId bei kind=prop
      "localIndex": 12,
      "textures": 4,
      "label": "Hoodie Oversized",
      "groupId": "g1",
      "mode": "addon",             // "addon" | "replace"
      "replaceTargetId": null,     // nur bei mode=replace
      "flags": { "highHeels": false, "firstPerson": true, "hairScale": null }
    }
  ]
}
```

**Multi-Part-Merge (im Viewer):** über `pack.projectId` gruppieren, nach `pack.part`
sortieren, `groups[]` per `id` deduplizieren (erste Definition gewinnt). Der Schlüssel
eines Items ist **immer** `(dlcName, gender, slotId, localIndex)` — `localIndex` allein
ist mehrdeutig, weil er pro Part neu bei 0 beginnt.

**Vorarbeit in atelier, nicht unterschätzen:** `AtelierProjectDto` hat kein `Groups`
(`ProjectModel.cs:8-16`), und `PlanComponent`/`PlanProp` (`BuildPlanner.cs:33-50`) tragen
weder `Label` noch `GroupId` noch `ReplaceTargetId` bis zum Schreibort. Ohne diese
Durchreichung liegt dort nichts Menschenlesbares vor — und genau dafür ist die Checkbox da.

---

## 4. Die Checkbox

Flag `GenerateViewerManifest`, Default **aus**, FiveM-only (neben `generateShopMeta`).
Kette, 7 Stellen: `sidecar/types.ts` → `build-store.ts` (Interface + Options-Literal) →
`build-dialog.tsx` (useState, Reset, Payload, Switch-Block) → `BuildDtos.cs` →
`BuildEndpoints.cs` → `BuildPlanner.cs`.

Label: „Viewer-Metadaten (`atelier-pack.json`)", Hint: „nötig für den In-Game-Viewer;
enthält Labels und Gruppen".

**Offene Entscheidung:** `atelier-api/src/cloth/fivem-export.ts` erklärt sich als
byte-identisch zum Desktop-Build. Eine neue Datei bricht diese Invariante still.
Empfehlung: für v1 **Desktop-only**, im `ATELIER_README.txt` vermerken, und der Viewer
toleriert Packs ohne Manifest (sie erscheinen dann schlicht nicht).

---

## 5. Resource

Repo `atelier-viewer` (privat), Resource `atelier_viewer`.

```
client/  main.lua discovery.lua scene.lua apply.lua indexmap.lua
server/  main.lua
framework/ resolve.lua qbx.lua qb.lua esx.lua none.lua
web/     eigenes Vite+React (NUI)
```

`fxmanifest.lua`: **keine** `dependency`-Einträge — die Falle aus `kq_towing2`, das nur
deshalb auf Qbox läuft, weil `qbx_core` `provide 'qb-core'` deklariert, und auf
ESX/standalone gar nicht erst startet. Framework-Erkennung ausschließlich zur Laufzeit
über `GetResourceState`. In der NUI `GetParentResourceName()` statt hardcodierter
Resource-Namen (fg-core darf das hardcodieren, weil die Handler dort in qbx_core wohnen).

`files{}` **ohne Globs** auflisten, bis das Gegenteil bewiesen ist (qbx_core listet
bewusst von Hand).

**Vom Framework hängt fast nichts ab.** Ehrlich betrachtet: Command-Registrierung,
optionales Job-/Permission-Gating, Notification. Alles andere ist reines Client-Lua.
Standalone ist deshalb der Normalfall, nicht der Notnagel.

**NUI-Regel aus diesem Workspace:** kein CSS-`blur`/`backdrop-blur` — CEF rendert das als
harte Kästen (im Browser-Preview unsichtbar, im Spiel hässlich). Glows über
`radial-gradient`, Schleier über `bg-black/XX`.

---

## 6. Szene & Anwenden

- Eigener Ped (`mp_m_freemode_01`/`mp_f_freemode_01`), **`SetPedHeadBlendData` setzen** —
  ein frischer Freemode-Ped ohne HeadBlend rendert als undefiniertes Graugesicht.
- Kamera: `CreateCam` + `PointCamAtEntity`, Maus-Drag rotiert den Ped, Rad zoomt.
  HUD/Radar aus, Timecycle-Modifier für neutrales Licht.
- Eigener Routing-Bucket, damit niemand die Mannequin-Show sieht — mit
  Acquire/Release-Pool und Freigabe bei `playerDropped`, sonst leaken Buckets.
- **Props zählen anders:** Minimum ist `-1` (= nichts), Entfernen über `ClearPedProp`,
  nicht `SetPedPropIndex(-1)`. Die Runtime-Konvention dieses Codebases ist
  `PED_PROPS_IDS = {0,1,2,6,7}` (`appearance.lua:13-14`) — **`p_hip`=8 fehlt dort**,
  obwohl atelier es buildseitig kennt. Vor dem Bau klären.
- **Teardown vollständig** (auch bei `onResourceStop` und Absturz): Focus, Cam, Ped,
  `SetTimecycleModifier('default')`, `DisplayRadar(true)`, Bucket zurück auf 0.
  Sonst bleibt der Spieler mit Dauerblur und ohne Radar zurück.
- **Vorbedingungen** beim Öffnen prüfen: nicht im Fahrzeug, nicht tot, nicht im Wasser,
  nicht bereits in einem fremden Bucket.

**Performance:** 256 Drawables × 12 Slots × 2 Gender ≈ 6000 Listeneinträge — Liste
virtualisieren, Apply mit ~120 ms debouncen (Pfeiltasten-Scrubbing triggert sonst pro
Anschlag einen Streaming-Request), Texturzahlen erst nach dem Settle neu abfragen.

**Tattoos sind ein anderes Thema.** Sie laufen über
`AddPedDecorationFromHashes(ped, collection, overlay)` / `ClearPedDecorations` mit den
`hashMale`/`hashFemale` aus `tattoos.json` — nicht über die Component-Engine. Eigene
Phase, keine Wiederverwendung.

---

## 7. Phasen

**P0 — Spike, alles andere hängt daran (kein atelier-Code!)**
1. Scope-Frage aus §0 mit dir klären.
2. 20-Zeilen-Testresource mit **handgeschriebener** `atelier-pack.json` in `files{}`:
   beweist Discovery komplett ohne atelier-Änderung.
3. Index-Frage messen: existiert eine DLC-Enumerations-Native? Wie verhält sich
   `GetNumberOfPedDrawableVariations` mit geladenem Pack? **Read-back nach jedem Apply.**
   Ergebnis entscheidet, ob §1 Variante 1, 2 oder 3 gebaut wird.

**P1** Resource-Gerüst: Discovery, Pack-Liste mit live/nicht-geladen-Badge, Szene, Apply
über Browse-Modus (Variante 3, funktioniert immer). Ab hier im Spiel benutzbar.

**P2** atelier-Seite: Groups/Label/ReplaceTargetId durchreichen, `atelier-pack.json`
schreiben, Checkbox. Erst jetzt, weil P0 die Discovery bereits bewiesen hat.

**P3** NUI-Menü als Workbench-Spiegel: Slot-Tabs, Gruppen, Suche, Textur-Swatches,
Inspector.

**P4** Framework-Erkennung + optionales Gating, Multi-Part-Merge, Gender-Switch.

**P5** Tattoos (eigene API), Outfit-Export.

---

# Fortschrittsring für den Projekt-Check

**Empfehlung: die vorhandene Log-Zeile als Quelle — zusammen mit einem Busy-Guard.**

`Validator.cs:41` sendet bereits `Validating drawable {i}/{n}: {label}`, der Weg ins
Frontend steht (`sidecar.rs:174` → `sidecar::stderr` → Log-Stream), und
`log-humanize.ts` fängt `current/total/label` schon mit einem durch den Selftest
fixierten Regex. **Verifiziert:** der Store hält **rohe** Einträge (`event.payload`),
übersetzt wird erst beim Rendern — der Regex greift also.

Die saubere Alternative (`/validate` wird ein Job mit SSE wie `/build`) bricht den
`/validate`-Contract und braucht neue Typen, Client-Funktion und ein umgeschriebenes
`recheck()`. Für einen Fortschrittsbalken ist das zu teuer — aber der Preis ist ehrlich:
**ein englischer Log-String wird zum Datenvertrag**, abgesichert nur durch den Selftest.

### Änderungen

- **Sidecar:** Busy-Guard in `HandleValidate` (409 im selben Envelope wie `/build`);
  `/build` und `/validate` schließen sich gegenseitig aus. `Validator.cs` bleibt unangetastet.
  *Grund:* die Log-Zeile trägt keine Run-ID — zwei parallele Prüfungen sind
  ununterscheidbar und der Ring springt zwischen zwei Zählern.
- **App:** `parseValidateProgress()` in `log-humanize.ts` (gleicher Regex),
  Selftest zusätzlich auf `current/total/label` numerisch; `validateProgress` im
  build-store; Log-Abo **direkt in `recheck()`** (nicht über die Pane — die unmountet beim
  Sprung ins Workbench); `validateProject` mappt 409 auf `BuildBusyError`; neue
  `circular-progress.tsx`; im `validating`-Block den Spinner ersetzen.
- **Wichtig:** das Abo braucht einen `since`-Filter wie die Log-Pane. Ohne ihn liefert der
  Ring-Buffer beim zweiten Recheck die Zeilen des ersten Laufs erneut → der Ring springt
  sofort auf N/N und dann zurück.

### Was die UI zeigt

- Normal: determinater Ring, Mitte `12/48`, darunter das gerade geprüfte Teil.
  `total` ist vorab bekannt (`project.drawables.length`), der Ring startet also determinate.
- `N/N` heißt **nicht fertig** — nach der Item-Schleife kommen noch die Bucket-Prüfungen.
  Text wechselt, Ring geht auf pulsierend.
- Keine Zeilen trotz `total > 0`: nach ~2 s auf indeterminate, kein Fehler.
- `total = 0` (reines Tattoo-Projekt): indeterminater Ring, keine erfundene Zahl.
- Mindestanzeigedauer, sonst blitzt der Ring bei 5 Drawables nur auf.
- 409: eigener Zustand „Prüfung läuft bereits", kein generischer Fehler-Toast.
