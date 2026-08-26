# Import-Bugfix-Plan — Mehrfach-YDD, First-Person, Texturen, High-Heels

Stand 2026-08-26. Gemeldet gegen v1.11.0 (Discord, epsilon [5WAY]). Alles unten ist
gegen echten Code verifiziert; die eine offene Frage (`_2/_3`) ist als solche markiert.

## Die Meldungen

- **R1/R2** Ein Hair-Drawable (und andere Komponenten) mit mehreren YDDs
  (`hair_000_u.ydd`, `hair_000_u_1.ydd`, `_2`, `_3`) wird als **mehrere getrennte
  Drawables** importiert. First-Person-Modelle und `_a`/`_b`-Texturen müssen manuell
  zugewiesen werden.
- **R5** Ein JBIB mit **vielen Texturen** wird **ohne Textur** importiert.
- **R4** Vorschlag: High-Heels-Flag nur bei `feet` zeigen.
- **R6** Vorschlag: Inspector soll die weiteren YDD-Namen zeigen / First-Person setzbar machen.
- **R3** „In älteren Versionen ging es." → Git-Historie ist gesquasht (Scanner seit
  Initial-Commit unverändert), die alte Version liegt davor. Regression nicht per Diff
  auffindbar — wir fixen das Verhalten direkt.

## Root Cause (verifiziert)

**`{slot}_{NNN}_u_1.ydd` ist der First-Person-Alternate — ateliers eigener Baukontrakt.**
`BuildPlanner.cs:206` `InnerFirstPersonYdd => "{slot}_{nnn:D3}_u_1.ydd"`,
`BuildCommon.cs:66-71` `FirstPersonAssetName` schneidet `_1.ydd` ab. Der Build **liest**
`drawable.FirstPerson` (`BuildPlanner.cs:583-589`) und re-emittiert `_1.ydd`, das Schema
hat `firstPerson` (`schema.ts:95`), der Inspector **zeigt** es (`inspector.tsx:582`).
**Nur der Import setzt es nie** — der Scanner kennt die `_1`-Konvention nicht.

Daraus folgen beide Bugs:

- **RC-A (R1/R2):** `hair_000_u_1.ydd` matcht `YddComponentFull`
  (`^(?<slot>[a-z]+)_(?<num>\d{3})_(?<variant>[a-z])\.ydd$`) **nicht** (das `_1` hinter
  dem Variantenbuchstaben passt nicht) und fällt aufs Loose-Matching
  (`ImportScanner.cs:381-399`): Slot `hair`, Nummer `000`. `ScanByConvention` fügt
  **jeden YDD als eigenen Entry** hinzu (`ImportScanner.cs:339-356`) → das FP-Modell wird
  ein **Phantom-Drawable** statt an `hair_000_u.ydd` zu hängen.
- **RC-B (R5):** Sobald ein Drawable ein `_N`-Geschwister hat, gibt es **zwei** Kandidaten
  mit gleichem (Slot, DrawableId). `FindOwner` gibt bei `exact.Count > 1` **null** zurück
  (`ImportScanner.cs:406-409`) → **alle** Texturen finden keinen Owner → landen in
  `unmatchedTextures` → **verworfen** = „imported without texture". Gleiche Wurzel wie RC-A.

Die „viele Texturen" bei JBIB sind also kein Textur-Bug — das JBIB hatte (wie das Hair)
mehrere YDDs, wodurch der Owner mehrdeutig wurde. (Der 26-Textur-Cap in
`import-assets.ts:502` ist ein separates, korrektes GTA-Limit und **nicht** die Ursache
für *null* Texturen.)

## Die offene Frage (zuerst verifizieren, P0)

atelier emittiert nur `_1` (First-Person). **`_2`/`_3` baut atelier nicht** — sie stammen
aus einem fremden Pack, Bedeutung **unverifiziert** (LODs? Cloth-Varianten? mehrere FP?).
Das Datenmodell kann pro Drawable **genau ein** `ydd` + **ein** `firstPerson` halten,
keine weiteren YDDs.

→ **Bevor ich `_2/_3` anfasse: ein echtes Pack von epsilon holen** (das Hair **und** das
JBIB), die YDDs per Sidecar parsen und vergleichen (Bones/Geometrie), um zu klären, was
`_2/_3` sind. Der `_1 = First-Person`-Fix ist davon unabhängig sicher.

## Fixes

### 1. Scanner: `_1` als First-Person erkennen + Geschwister falten (C#)
`sidecar/Api/Dtos.cs` — `ImportScanEntry` um `string? FirstPersonPath` erweitern.
`sidecar/Parsing/ImportScanner.cs` — in `ScanByConvention`, nachdem die Kandidaten
klassifiziert sind, **vor** der Texturzuordnung:
- Für jeden Kandidaten `{stem}_1.ydd`, zu dem ein `{stem}.ydd`-Kandidat mit gleichem
  Prefix existiert: als dessen `FirstPersonPath` setzen und den `_1`-Kandidaten aus der
  Liste **entfernen** (kein eigener Entry, `consumed`).
- Ergebnis: Basis ist der **einzige** Kandidat für (Slot, DrawableId) → `FindOwner`
  eindeutig → Texturen hängen wieder → **R1, R2, R5 zusammen gefixt**, FP automatisch.
- `_N` mit N≥2 (bis P0 geklärt): ebenfalls unter die Basis falten (aus Kandidaten
  entfernen) **plus Warnung** „Zusätzliche YDD-Variante nicht importiert: <name>", damit
  sie weder Phantom-Drawable werden noch die Textur-Zuordnung brechen.
- `FirstPersonPath` auf dem Basis-Entry mit ausgeben.

### 2. TS-Import: firstPerson übernehmen
`src/lib/project/import-assets.ts` — den ImportScanEntry-Typ (~Z. 436) um
`firstPersonPath?: string` erweitern; wenn gesetzt: `parseYdd` + `copyIntoAssets` und an
`createDrawable({ …, firstPerson })` durchreichen (`createDrawable` akzeptiert es bereits,
`schema.ts:287`). Keine Schema-Migration nötig.

### 3. Inspector: High-Heels nur bei `feet` (R4)
`src/components/workbench/inspector.tsx:476` — den High-Heels-Switch in
`{drawable.type === "feet" && ( … )}` wickeln, analog zum bereits slot-gateten
hairScale-Block (`:486`). Slot-ids aus `gta/components.ts`.

### 4. Inspector: First-Person setzbar (R6)
firstPerson wird bereits **angezeigt** (`inspector.tsx:582`). Klein ergänzen: Button zum
Zuweisen (YDD-Datei picken) und Entfernen. Niedrige Priorität — Fix 1 nimmt den manuellen
Fall ohnehin weg.

## Reihenfolge

- **P0** Echtes Pack von epsilon holen, `_1` als FP bestätigen und `_2/_3` klären
  (billig, entscheidet nur über deren Behandlung — der Rest hängt nicht daran).
- **P1** Fix 1 + 2 (Scanner-FP-Erkennung + Faltung + Dtos + TS). Selftest mit
  synthetischem Ordner (`base.ydd` + `_1.ydd` + mehrere `_diff_000_[a..].ytd`) →
  ein Drawable, firstPerson gesetzt, alle Texturen dran. Sidecar lokal bauen (`.dotnet8`).
- **P2** Fix 3 (High-Heels-Gate) — trivial.
- **P3** Fix 4 (FP-Assign-UI) — optional.

## Kein Build-Change nötig
Der Build-Roundtrip steht schon: `BuildPlanner` liest `drawable.FirstPerson` und
re-emittiert `_1.ydd`. Import setzt es künftig, Build gibt es korrekt wieder aus.
