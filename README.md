# atelier by feelgood

GTA V Addon-Clothing-Tool der feelgood-Community — eine Desktop-App zum
Verwalten, Prüfen und Bauen von Addon-Kleidung (grzyClothTool-Ersatz, besser),
mit kollaborativem Backend.

Stand: **Phase 0 (Foundation)**, **Phase 1 (Projekte & Drawables)**,
**Phase 2 (3D-Vorschau & Cloud-Sync)** und **Phase 3 (Build-Pipeline)** sind
fertig — App-Shell, Sidecar-Anbindung, Discord-Login mit Freigabe-Workflow,
lokales Projektformat, Drawable-Verwaltung in der Werkbank, Import-Scan +
Textur-Thumbnails, 3D-Vorschau (GLB aus dem Sidecar), Cloud-Sync (Push/Pull
gegen Pack-Revisionen), Live-Kollaboration (WebSocket-Presence +
Advisory-Locks) sowie die komplette Build-Pipeline (Validierung, FiveM/
Singleplayer/RageMP/alt:V-Targets mit echten binären YMTs, Textur-Optimierung,
Server-Builds + Publish/Registry).

## Phase-1-Features

**App (Werkbank):**

- Lokales Projektformat `pack.atelier` (fgcloth v1, zod-validiert,
  `src/lib/project/schema.ts`) mit atomarem Speichern, Migrationen,
  Autosave-Ringpuffer (`.atelier-cache/autosave/`, 5s-Debounce / 60s-Ceiling)
  und Recovery-Dialog beim Öffnen
- Launcher: „Neues Projekt" / „Projekt öffnen" / echte Zuletzt-geöffnet-Liste
  (plugin-store `recents.json`, max 10)
- Werkbank: Kategorie-Baum (12 Komponenten- + 6 Prop-Slots, Live-Zähler,
  Warn-Badges), Drawable-Liste (Suche, Mehrfachauswahl, Kontextmenü,
  Drag-Reorder, Windowing >100 Zeilen), Inspector (Label, Geschlecht, Slot,
  Addon/Replace, Gruppen, High-Heels-/Hair-Scale-Flags), Texturen-Panel
  (a–z-Varianten, Sidecar-Thumbnails, Reorder, max 26)
- Undo/Redo via zundo (Strg+Z / Strg+Y, Limit 100), Strg+S, Speicher-Indikator,
  Duplikat-Erkennung über identische YDD-Hashes (Dialog mit Jump-to)
- Import: Datei-Dialog oder Drag&Drop (`.ydd`/`.ytd`/`.yld`) mit
  Dateinamen-Klassifizierung (`src/lib/gta/filename-classifier.ts`), sowie
  Pack-Import-Wizard über Sidecar `POST /import/scan` (Review-Tabelle mit
  Confidence, Fortschritt, deutsche Skip-Gründe); Assets werden nach
  `<Projekt>/assets/<gender>/<type>/` kopiert (SHA-256 + Größe im Projektfile)

**Sidecar:**

- `POST /parse/ytd` optional mit `{ "thumbnails": { "maxSize": n } }` —
  PNG-Thumbnails (längste Kante ≤ maxSize, 1–4096) als
  `thumbnailPngBase64` pro Textur, LRU-Cache (256 Einträge)
- `POST /import/scan { folderPath }` — rekursiver Ordner-Scan, erkennt
  ped-prefixte (`mp_m_freemode_01_<dlc>^jbib_000_u.ydd`), einfache
  (`jbib_001_u.ydd` + `jbib_diff_001_a_uni.ytd`) und Prop-Konventionen
  (`p_head_002.ydd`), Feelgood-Creative-Exporte via `pack-metadata.json`;
  liefert Gender/Kind/Slot/DrawableId-Guesses, Textur-Buchstaben a–z,
  `.yld`-Physik und Confidence high/medium/low

**API (`../atelier-api/`):**

- Content-addressed Storage (CAS) + chunked, resumable Uploads:
  `POST /api/v1/assets/check`, `POST /api/v1/uploads` (+ Chunk-PUT, Status,
  Complete mit Hash-Verifikation), `GET /api/v1/assets/:sha256`
  (ETag, Range/206, immutable)
- Packs + Revisionen: `POST/GET/PATCH/DELETE /api/v1/packs`, Mitglieder
  (owner/editor/viewer), `POST /api/v1/packs/:id/revisions` mit
  optimistischem Locking (`409 head_changed`) und Asset-Vorabprüfung
  (`400 missing_assets`), Manifeste über `:rev` oder `head`
- Presence (`/api/v1/presence`) für die Online-Anzeige im Launcher,
  Rate-Limiting auf den Auth-Endpunkten

## Phase-2-Features

**App (3D-Vorschau):**

- Andockbares Vorschau-Panel unten in der Werkbank (Toggle im Header,
  `previewOpen` persistiert): rendert alle selektierten Drawables mit YDD
  (Outfit-Multi-Select, Cap 8) über `POST /preview/glb` des Sidecars —
  @react-three/fiber + GLTFLoader, dunkle Feelgood-Bühne, OrbitControls
  mit Damping/Autorotate
- GLB-Blob-Cache (`src/lib/stores/preview-3d-store.ts`): LRU 32, Key
  `sha256(ydd) | sha256(angewendete ytd) | pedModel-oder-off`, In-Flight-Dedupe,
  Klick-Retry pro Drawable bei Fehlern
- Kamera-Presets (Gesamt/Kopf/Torso/Beine/Füße) relativ zu den kombinierten
  Bounds, „Fokus"-Reframe; Overlay-Chips: Poly-/Vertex-Summen (GLB-Header,
  Fallback `/parse/ydd`), LOD-Warnungen (fehlende Med/Low), Untextured-Hinweis
- Textur-Varianten-Vorschau: Klick auf eine Zeile im Texturen-Panel wählt die
  aktive Variante (`textureIndex`), Auge-Indikator auf gerenderten Drawables
- Ped-Body-Schalter (`includePedBody`, benötigt konfigurierten GTA-Pfad im
  Sidecar — sonst deaktiviert mit Tooltip); Ped-Modell folgt dem Geschlecht

**App (Cloud-Sync & Kollaboration):**

- Cloud-Abschnitt im Werkbank-Header (`components/workbench/cloud-section.tsx`):
  „Mit Cloud verknüpfen" (Pack erstellen oder auswählen), Rev-Badge mit
  Verbindungs-Dot, „Änderungen hochladen" (dirty-aware), „Neueste Version
  laden" mit Bestätigung bei ungesicherten lokalen Änderungen,
  Fortschritts-Dialog pro Phase (check/upload/commit bzw. download)
- PUSH: `assets/check` (500er-Batches) → fehlende Dateien über das
  Chunk-Upload-Protokoll → `POST revisions { baseRevision, … }`; bei
  `409 head_changed` Konflikt-Dialog mit genau zwei Optionen
  („Remote-Stand laden (lokale Änderungen verwerfen)" / „Erneut versuchen auf
  Basis des Remote-Stands (lokal erzwingen)")
- PULL: Head-Manifest → fehlende CAS-Assets nach
  `<Projekt>/assets/<gender>/<type>/<exportName>` (Kollisions-Suffix,
  Hash-Verifikation) → Drawables ersetzen als EIN Undo-Schritt
- Mapping lokal ⇄ Revision in `src/lib/sync/revision-mapping.ts`
  (bun-testbar, Selftest-Sektion [6]); Sync-Block in `pack.atelier`:
  `{ remoteProjectId, baseRevision, lastSyncedAt }`
- WebSocket-Kollaboration (`src/lib/sync/collab.ts`): Roster-Avatare im
  Header, Toast „Neue Version verfügbar (Rev N)" mit „Jetzt laden" bei
  fremden Pushes, Advisory-Locks folgen der Selektion (Cap 16, 30s-Heartbeat,
  niemals blockierend — Lock-Chips an Zeilen + Hinweis-Banner im Inspector)

**Sidecar:**

- `POST /preview/glb { yddPath, ytdPaths[], textureIndex, pedModel?,
  includePedBody? }` → GLB-Bytes (`model/gltf-binary`) mit Headern
  `X-FG-Vertex-Count` / `X-FG-Poly-Count`; höchste LOD, GTA Z-up → glTF Y-up,
  Diffuse-Textur als eingebettetes PNG; `textureIndex` wird geklemmt;
  Server-LRU-Cache (64) über Content-Hashes; `422 ped_body_unavailable`
  wenn `includePedBody` ohne konfigurierten GTA-Pfad

**API (`../atelier-api/`):**

- Drawable-Locks: `POST /api/v1/packs/:id/locks { drawableEntryId }`
  (`409 { error: "locked", lock }` bei fremdem Halter), Heartbeat-PUT,
  DELETE (`?force=1` bricht fremde Locks, auditiert); TTL 90s
- WebSocket `GET /api/v1/ws?token=<access JWT>` (JWT-Prüfung VOR dem
  Upgrade): Räume pro Pack, `join`/`leave`/`ping`; Server sendet
  `joined` (mit Roster), `presence`, `lock`
  (`acquired|released|broken|expired`), `head-changed`, `pong`, `error`
- Revision-POSTs broadcasten `head-changed` in den Pack-Raum;
  Lock-Expiry-Sweep (30s) für aktive Räume

## Phase-3-Features (Build-Pipeline)

**App (Werkbank):**

- „Bauen"-Button im Werkbank-Header → Build-Dialog in drei Schritten:
  Ziel wählen (FiveM empfohlen / Singleplayer / RageMP / alt:V), `dlcName`
  (`[a-z0-9_]`, aus den Projekteinstellungen vorbelegt), optionaler
  Ressourcen-Name, Ausgabeordner (gemerkt), Shop-Meta-Schalter →
  Validierung (`POST /validate`, Findings gruppiert error/warn/info mit
  Jump-to-Drawable, Fehler blockieren) → Build mit SSE-Live-Fortschritt,
  Abschluss-Report (Ressourcen + Warnungen) und „Ordner öffnen"
- Textur-Optimierung: Kontextmenü „Optimieren…" auf Textur-Zeilen
  (maxDimension 512/1024/2048, BC1/BC3/BC7 oder Format beibehalten, Mips)
  sowie Bulk-Werkzeug „Alle übergroßen Texturen optimieren…" (>2048px);
  aktualisiert Hashes/Previews aller betroffenen Drawables als EIN
  Undo-Schritt
- Cloud: nach erfolgreichem Push „Server-Build anstoßen" — Status kommt als
  WS-Broadcast `{ type: "build-status", buildId, status }`, Toast bei
  done/error

**Sidecar (Build-Engine, `sidecar/Engine/Build/`):**

- `POST /validate` — Fehler (fehlende/abweichende Dateien, Replace ohne
  Target, Parse-Fehler), Warnungen (>26 Texturen, fehlende LODs, >2048px,
  non-PoT, doppelte YDD-Hashes, Split-Vorhersage), Infos (Bucket-Zähler),
  alle Meldungen deutsch
- `POST /build` (202 `{ jobId }`, ein Job pro Prozess → 409 busy) +
  `GET /build/progress` (SSE, Replay ab Start, 10s-Keep-Alive) —
  Targets: **FiveM** (Ressource mit `stream/*`, echte binäre
  CPedVariationInfo-YMTs pro Geschlecht via CodeWalker, Creature-Metadata
  bei High-Heels/Hair-Scale, ShopPedApparel-Metas, fxmanifest),
  **Singleplayer** (`dlc.rpf`), **RageMP**/**alt:V** (best-effort)
- Split-Semantik: pro Geschlecht flache 128er-Chunks (`splitAt`), Part k =
  Chunk k beider Geschlechter, `_partN`-Suffix auf Ordner UND dlcName,
  NNN startet pro (Part, Geschlecht, Slot) bei 000; Replace-Drawables
  landen ohne DLC-Präfix in Part 1 (NNN = replaceTargetId)
- `POST /texture/optimize` — BCnEncoder-Re-Encode (BC1/BC3/BC7), Box-Filter-
  Downscale, Mips, gültige .ytd via CodeWalker; in-place über `.tmp`+Replace
- Details + Debug-Endpunkte (`/debug/ymt`, `/debug/rpf`): `sidecar/README.md`

**API (`../atelier-api/`):**

- Server-Builds: `POST /api/v1/packs/:id/builds { revision }` (editor+,
  202/200-Cache pro unveränderlicher Revision), `GET /api/v1/builds/:id`,
  Artifact-ZIP-Download; FIFO-Queue, Status-Broadcasts in den Pack-Raum
- Publish + Registry (Service-Lane für hub/webseite):
  `POST /api/v1/packs/:id/publish`, `GET /api/v1/registry/packs[…]` inkl.
  Download (triggert den Build bei Bedarf); One-Shot-Import alter
  Creative-Packs (`POST /api/v1/import/creative/:id`, admin)
- **Server-Build-Limitierung:** echte binäre YMTs brauchen CodeWalker
  (.NET) — Server-Artefakte enthalten ALLE Stream-Dateien/Metas
  byte-identisch zum Desktop-Build, aber KEINE `.ymt`-Dateien
  (`stream/ATELIER_README.txt` + `"ymt": "missing-server-build"` in
  `atelier-build.json` dokumentieren das im Artefakt). Vollständige
  In-Game-Packs kommen aus dem Desktop-Build; die Parität (Stream-Namen,
  Shop-Metas, fxmanifest byte-identisch) ist durch einen
  Integrations-Diff verifiziert.

## Architektur

```
┌────────────────────────────┐         ┌──────────────────────────────┐
│  atelier (diese App)       │ stdout  │  fg-atelier-sidecar (.NET 8) │
│  Tauri 2 + React 19 + TS   │◄────────│  sidecar/  — CodeWalker.Core │
│                            │ spawn   │  YDD/YTD-Parsing, lokal      │
│  src-tauri/src/sidecar.rs ─┼────────►│  http://127.0.0.1:<port>     │
│                            │         │  Header: x-fg-atelier-token  │
└────────────┬───────────────┘         └──────────────────────────────┘
             │ HTTPS (Bearer-Token)
             ▼
┌────────────────────────────┐
│  atelier-api (Bun)         │
│  ../atelier-api — Port 3095│
│  Discord-OAuth, Geräte-    │
│  Tokens, Admin-Freigaben,  │
│  MongoDB Atlas             │
└────────────────────────────┘
```

1. **App** (`atelier/`): Tauri 2 (Rust) + React 19 + TypeScript + Vite 7,
   Tailwind CSS 4 (dark-only, feelgood Design-DNA: `#0b0b0b`, Blurple
   `#5865F2`, Sora), zustand (+ zundo), shadcn/ui-Komponenten (portiert aus
   `panel/`).
2. **Sidecar** (`atelier/sidecar/`): .NET-8-Minimal-API, die CodeWalker.Core
   für das Parsen von `.ydd`/`.ytd`-Dateien nutzt. Wird von der App pro
   Session mit einem Token gespawnt und meldet sich per
   `FG_SIDECAR_READY port=N` auf stdout. Alle Endpunkte (außer `/health`)
   verlangen den Header `x-fg-atelier-token`.
3. **API** (`../atelier-api/`): Bun-Backend auf Port 3095 — Discord-OAuth
   (mit Dev-Fake-Modus), rotierende Geräte-Refresh-Tokens, Pending/Approved/
   Locked-Workflow, Admin-Endpunkte. Fehler immer als `{ "error": "message" }`.

## Dev-Quickstart (3 Terminals)

Voraussetzungen: Bun, Rust (stable), .NET 8 SDK unter
`%USERPROFILE%\.dotnet8` (siehe `sidecar/README.md`).

**Terminal 1 — Backend (atelier-api):**

```powershell
cd ..\atelier-api
bun install
bun run dev          # http://127.0.0.1:3095, lädt .env.local automatisch
```

**Terminal 2 — Sidecar bauen (einmalig bzw. nach Änderungen):**

```powershell
powershell -ExecutionPolicy Bypass -File sidecar\publish.ps1
# legt src-tauri\binaries\fg-atelier-sidecar-x86_64-pc-windows-msvc.exe ab
```

Alternativ für manuelles Sidecar-Debugging mit festem Port:

```powershell
$env:DOTNET_ROOT="$env:USERPROFILE\.dotnet8"
$env:FG_SIDECAR_DEV_PORT="5099"; $env:FG_SIDECAR_TOKEN="test"
& "$env:USERPROFILE\.dotnet8\dotnet.exe" run --project sidecar\Feelgood.Atelier.Sidecar.csproj
```

**Terminal 3 — App:**

```powershell
bun install
bun run tauri dev    # spawnt den Sidecar automatisch mit Session-Token
```

Weitere Befehle:

```powershell
bun run build            # tsc + vite build (nur Frontend)
bun run selftest:project # Projektformat/Klassifizierer/Store/Sync-Selbsttest (47 Checks)
bun run sidecar:publish  # ruft sidecar/publish.ps1 auf
bun run tauri:build      # Release-Bundle (baut den Sidecar vorher)
cd src-tauri; cargo check
```

Backend-Tests (Server muss laufen):

```powershell
cd ..\atelier-api
bun run smoke           # Auth + CAS/Uploads/Packs + Locks/WS + Builds/Registry (120 Checks)
bun run sync-roundtrip  # Push/Pull-Roundtrip wie ihn die App fährt (15 Checks)
```

Ohne gebauten Sidecar startet die App trotzdem — der Status-Pill zeigt dann
„Sidecar nicht gefunden". `src-tauri/binaries/` ist gitignored: Bei frischem
Checkout entweder `sidecar:publish` ausführen oder eine 0-Byte-Platzhalterdatei
`fg-atelier-sidecar-x86_64-pc-windows-msvc.exe` anlegen, damit
`tauri dev`/`tauri build` grün bleiben.

## Protokolle / Contracts

- **App ⇄ Sidecar:** Spawn mit `FG_SIDECAR_TOKEN=<hex>`, Handshake
  `FG_SIDECAR_READY port=N` auf stdout, danach HTTP auf
  `http://127.0.0.1:N` mit Header `x-fg-atelier-token`. Endpunkte:
  `GET /health`, `GET /info`, `POST /config`, `POST /parse/ydd`,
  `POST /parse/ytd` (optional `thumbnails: { maxSize }`),
  `POST /import/scan { folderPath }`, `POST /preview/glb` (GLB-Bytes +
  `X-FG-Vertex-Count`/`X-FG-Poly-Count`, per CORS exposed),
  `POST /validate`, `POST /build` (202 `{ jobId }` / 409 busy),
  `GET /build/progress?jobId=…` (SSE via fetch + ReadableStream — EventSource
  kann den Token-Header nicht senden), `POST /texture/optimize` (in-place).
  TypeScript-Typen: `src/lib/sidecar/types.ts` (Spiegel von
  `sidecar/Api/Dtos.cs` + `BuildDtos.cs`, System.Text.Json-camelCase).
- **App ⇄ API:** dokumentiert im Header von `src/lib/sync/api-client.ts`
  und in `../atelier-api/README.md`. Nutzer werden über ihre Discord-ID
  (`discordId`) identifiziert. Eine Revision referenziert Assets
  ausschließlich über `{ sha256, size, exportName }` — lokale Pfade
  verlassen den Client nie. WebSocket-Nachrichten (join/leave/ping bzw.
  joined/presence/lock/head-changed/build-status/pong/error) sind in
  `../atelier-api/src/ws/collab.ts` definiert; der App-Client
  (`src/lib/sync/collab.ts`) spiegelt sie. Abgedeckt durch Smoke-Suite (120)
  und `sync-roundtrip` (15).
- **Projektformat:** `pack.atelier` (JSON, `fgcloth: 1`) — Schema in
  `src/lib/project/schema.ts`. Die In-Game-DrawableId wird NICHT
  gespeichert, sie ergibt sich beim Build aus dem Array-Index innerhalb
  des (gender, type, mode)-Buckets.

## Struktur

- `src/screens/` — Launcher, Werkbank (3-Pane), Einstellungen (inkl. Admin-Tab)
- `src/components/workbench/` — Header, Kategorie-Baum, Drawable-Liste,
  Inspector, Texturen-Panel, Import-Wizard, Duplikate-/Gruppen-/Lösch-Dialoge,
  Drop-Overlay
- `src/components/build/` — Build-Dialog (Ziel/Validierung/SSE-Fortschritt),
  Textur-Optimierung (einzeln per Kontextmenü + Bulk „übergroße Texturen")
- `src/components/project/` — Neues-Projekt- und Recovery-Dialog
- `src/components/preview/` — 3D-Vorschau (`preview-pane.tsx`,
  `viewer-3d.tsx`, three.js/R3F)
- `src/lib/project/` — Schema (zod), IO (atomar + Autosave), Migrationen,
  Import-Pipeline (`import-assets.ts`, `import-flow.ts`), Session-Helfer,
  Selbsttest (`__selftest__.ts`)
- `src/lib/stores/` — zustand-Stores (ui, sidecar, auth, project mit zundo,
  workbench, preview-Cache, preview-3d, collab, sync)
- `src/lib/sync/` — API-Client (vollständiger REST-Contract),
  OAuth-Loopback-Wrapper, Presence, `revision-mapping.ts` (pure),
  `pack-sync.ts` (Push/Pull/Link), `collab.ts` (WebSocket + Advisory-Locks)
- `src/lib/sidecar/` — typed Client (health/info/config/parse/import-scan/
  preview-glb/validate/build/build-progress-SSE/texture-optimize) +
  /health-Polling
- `src/lib/gta/` — `components.ts` (12 Komponenten- + 6 Prop-Slots),
  `filename-classifier.ts` (Dateinamen-Konventionen)
- `src/lib/recents.ts` — Zuletzt-geöffnet-Liste (plugin-store)
- `src-tauri/src/sidecar.rs` — Spawn, Watchdog (Backoff 1s/3s/10s), Token
- `sidecar/` — .NET-8-Sidecar (eigenes README)

## Lizenz-Leitplanke

- **CodeWalker.Core** wird im Sidecar als Bibliothek gelinkt (Vendored-Kopie
  unter `sidecar/third_party/CodeWalker.Core/`, unverändert).
- **grzyClothTool** ist **GPL-3.0** und dient ausschließlich als
  *Referenz zum Lesen* — es wird **kein Code kopiert oder gelinkt**.
  Dieser Hinweis steht auch in `sidecar/Feelgood.Atelier.Sidecar.csproj`
  und `sidecar/README.md`.

## CI & Release

- **CI** (`.github/workflows/ci.yml`, PRs + master): Frontend-Typecheck +
  Bundle, Projekt-Selftest, Sidecar-`dotnet build`, `cargo check` des
  Tauri-Hosts (mit Platzhalter-Sidecar-Exe — die echte baut nur das Release).
- **Release** (`.github/workflows/release.yml`): Tag `vX.Y.Z` pushen
  (muss der Version in `src-tauri/tauri.conf.json` entsprechen) →
  Sidecar-Publish + `tauri build` auf `windows-latest` → GitHub-Release
  mit NSIS-Installer (`*-setup.exe`) und MSI.
- `sidecar/publish.ps1` findet dotnet selbst: `ATELIER_DOTNET`-Override →
  `~/.dotnet8` (lokale Maschine) → `dotnet` im PATH (CI).
