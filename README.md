<div align="center">

<img src="src/assets/atelier-logo.png" width="116" alt="atelier" />

# atelier

**Das kostenlose, quelloffene GTA-V-Addon-Clothing-Tool.**

Kleidung verwalten, in Echtzeit-3D prüfen und mit einem Klick für
**FiveM · Singleplayer · RageMP · alt:V** bauen.

[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/License-PolyForm%20NC%201.0.0-5865F2)](LICENSE.md)
&nbsp;![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-1f1f1f)
&nbsp;![Tauri 2 · React 19](https://img.shields.io/badge/Tauri%202%20·%20React%2019-1f1f1f)

[**⬇ Download**](https://github.com/feelgoodrp-com/atelier/releases) ·
[Backend](https://github.com/feelgoodrp-com/atelier-api) ·
[Im Geiste von grzyClothTool](https://github.com/grzybeek/grzyClothTool)

</div>

---

## Was ist atelier?

atelier ist eine Windows-Desktop-App zum Bauen, Prüfen und Veröffentlichen von
GTA-V-Addon-Kleidung — eigenständig neu gebaut im Geiste von grzyClothTool. Du
verwaltest Drawables in einer Werkbank, prüfst alles in Echtzeit-3D und baust
mit einem Klick ein in-game-taugliches Addon. Optional arbeitet ihr im Team über
eine Cloud.

## Features

- **3D-Echtzeit-Vorschau** — mehrere Drawables gleichzeitig, Kamera-Presets
  (Kopf/Torso/Beine/Füße), Animations-Posen, Hair-Shrink & Heel-Height live,
  optional auf dem echten Ped-Body. Texturen und Ped-Props inklusive.
- **Werkbank** — Kategoriebaum (12 Komponenten- + 6 Prop-Slots mit Warn-Badges),
  durchsuchbare Drawable-Liste (Reorder, Multi-Select), Inspector und
  Texturen-Panel (a–z) mit Duplikat-Erkennung.
- **Bauen** — echte binäre `CPedVariationInfo`-YMTs via CodeWalker für **FiveM**,
  **Singleplayer**, **RageMP** und **alt:V**; automatischer 128er-Split,
  Shop-Metas und `fxmanifest.lua`.
- **Textur-Optimierung** — BC1/BC3/BC7-Re-Encode, Downscale & Mips, einzeln oder
  als Batch über alle übergroßen Texturen.
- **Team-Cloud** _(optional)_ — Push/Pull gegen versionierte Pack-Revisionen,
  Live-Presence und Advisory-Locks (über [atelier-api](https://github.com/feelgoodrp-com/atelier-api)).
- **Import-Wizard** — bestehende Packs sowie `.ydd`/`.ytd`/`.yld` per Drag & Drop,
  mit automatischer Klassifizierung.

## Installation

Neueste Version aus den
[**GitHub-Releases**](https://github.com/feelgoodrp-com/atelier/releases):

| Variante | Datei | Wann |
| --- | --- | --- |
| Installer | `atelier-*-setup.exe` | Standardweg |
| MSI | `atelier-*.msi` | verwaltete Umgebungen |
| Portable | `atelier-*-portable.zip` | entpacken & starten (App + Sidecar enthalten) |

Beim ersten Start führt dich ein kurzer Assistent durch Server-Adresse
(optional, für die Cloud), GTA-V-Pfad und Logs.

## Aus dem Quellcode bauen

Voraussetzungen: [Bun](https://bun.sh), Rust (stable) und das .NET 8 SDK
(Details im [`sidecar/README.md`](sidecar/README.md)).

```powershell
bun install
bun run tauri dev        # startet die App und spawnt den .NET-Sidecar automatisch
```

Nützliche Skripte:

```powershell
bun run build             # Frontend-Typecheck + Vite-Build
bun run selftest:project  # Projektformat-/Sync-Selbsttest
bun run sidecar:publish   # baut den Sidecar (src-tauri/binaries/…)
bun run tauri:build       # Release-Bundle (Installer + Portable)
```

> `src-tauri/binaries/` ist gitignored. Bei frischem Checkout entweder
> `bun run sidecar:publish` ausführen oder eine 0-Byte-Platzhalterdatei
> `fg-atelier-sidecar-x86_64-pc-windows-msvc.exe` anlegen, damit
> `tauri dev`/`tauri build` grün bleiben.

## Architektur

```
┌────────────────────────────┐  spawn   ┌──────────────────────────────┐
│  atelier (Desktop-App)     │ ───────► │  fg-atelier-sidecar (.NET 8) │
│  Tauri 2 · React 19 · TS   │ ◄─────── │  CodeWalker.Core — YDD/YTD-  │
│                            │  stdout  │  Parsing, 3D-GLB, YMT-Build  │
└──────────────┬─────────────┘          └──────────────────────────────┘
               │ HTTPS (optional, fürs Team)
               ▼
        ┌────────────────────┐
        │  atelier-api (Bun) │  Discord-Login, Cloud-Sync, Storage
        └────────────────────┘
```

- **App** — Tauri 2 (Rust) + React 19 + Vite + Tailwind (dark-only:
  `#0b0b0b`, Blurple `#5865F2`, Sora).
- **Sidecar** — .NET-8-Minimal-API, lokal von der App gespawnt; nutzt
  CodeWalker.Core fürs Parsen, die 3D-Vorschau und echte binäre YMTs.
- **API** _(optional)_ — [atelier-api](https://github.com/feelgoodrp-com/atelier-api),
  nur für Login & Team-Cloud nötig.

## Lizenz

atelier steht unter der **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**.

✅ Du darfst es **nutzen, verändern, weitergeben und Forks/eigene Builds
erstellen** — für **nicht-kommerzielle** Zwecke (Hobby, Community, Lernen).
🚫 **Verkauf und kommerzielle Nutzung sind nicht gestattet.**
Behalte den Copyright-Hinweis (`Required Notice` in der Lizenz) bei.

### Drittanbieter-Komponenten

- **CodeWalker.Core** ([dexyfex](https://github.com/dexyfex/CodeWalker)) — im
  Sidecar als Bibliothek gelinkt (vendored unter
  `sidecar/third_party/CodeWalker.Core/`, unverändert), unter der Lizenz des
  Originalprojekts.
- **grzyClothTool** ([grzybeek](https://github.com/grzybeek/grzyClothTool)) —
  **GPL-3.0**, dient ausschließlich als *Referenz & Inspiration*. Es wird
  **kein Code kopiert oder gelinkt**.
- Tauri, React, three.js und weitere Abhängigkeiten unter ihren jeweiligen
  Lizenzen.

## Credits

- **[dexyfex](https://github.com/dexyfex/CodeWalker)** — CodeWalker, das Herz
  der 3D-Vorschau und der YMT-Pipeline. ❤️
- **[grzybeek](https://github.com/grzybeek/grzyClothTool)** — grzyClothTool, die
  Inspiration und Vorlage.
- Entwickelt vom **feelgood-Team**.
