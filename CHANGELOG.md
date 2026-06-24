# Changelog

All notable changes to **atelier** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project follows [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-06-24

### Added

- **Animated 3D preview** — the preview can now play looping skeletal animations
  (idle / walk / run) on the ped instead of a single frozen pose. A new
  **Animation** picker with play/pause in the preview header drives a real
  skinned, animated model; the ped body and every garment stay in sync. Needs a
  configured GTA path, like the static poses.
- **RGBA8888 texture-optimize format** — uncompressed, lossless RGBA is now an
  explicit choice in both the single-texture and bulk optimize dialogs, next to
  Keep / BC1 / BC3 / BC7, for maximum quality at the cost of larger files. The
  bulk default stays on **Keep**. Thanks to @gitBitsystem ([#6]).
- The launcher and login footer now show the running **app version**.

## [1.2.7] — 2026-06-23

### Added

- **Help tab** — the full documentation (overview, the desktop app, and the
  self-hosted backend) is now built into atelier under a new **Help** tab, so you
  can read it offline without leaving the app — solo mode included. Available in
  English and German, following the app language.

## [1.2.6] — 2026-06-23

### Changed

- **Calmer update card** — the "update available" panel uses a more subtle
  background so it no longer dominates the Settings page.
- Release notes now render as proper **Markdown** (headings, bullet lists,
  emphasis and [links](https://github.com/feelgoodrp-com/atelier)) instead of
  raw text.

## [1.2.5] — 2026-06-23

### Added

- **Release notes in the updater** — when an update is available, the **Updates**
  card in Settings → General now shows the new version's changelog right inside
  atelier, so you can see what changed before installing. The startup
  notification links straight to it.

## [1.2.4] — 2026-06-23

### Changed

- Maintenance release that validates the automatic updater end to end. No
  functional changes.

## [1.2.3] — 2026-06-22

### Added

- **Automatic updates** — atelier now checks for a new release on startup and
  installs it with one click; a manual **Check for updates** card also lives in
  Settings → General. Updates are downloaded from GitHub and cryptographically
  verified against a signing key before they install, then the app restarts into
  the new version.

> ⚠️ **One-time manual update required.** Versions before 1.2.3 don't have the
> updater yet, so you must download and install the **latest version manually
> once** — grab the `*-setup.exe` from the
> [releases page](https://github.com/feelgoodrp-com/atelier/releases/latest).
> From then on, updates install themselves. (The portable ZIP does **not**
> auto-update — use the `setup.exe` installer to get automatic updates.)

## [1.2.2] — 2026-06-22

### Added

- **Tattoo authoring** — a dedicated **Tattoos** area alongside the clothing
  workbench:
  - Import decals (PNG / DDS / YTD) into the project; works fully offline (no
    GTA path or sidecar needed for import).
  - Organize by the six body zones (torso, head, left/right arm, left/right leg)
    with a zone tree, searchable grid and an inspector for label, zone, gender,
    type, garment, draw order and the shop fields.
  - Right-click context menu on tattoos: duplicate, change zone/gender, assign
    group, delete.
  - Header showing the current project plus the live **coworking roster**
    (who's working on the pack) and cloud push/pull.
- **Tattoo build pipeline** (FiveM) — one click produces a streamable pack: a
  BC3 **YTD** per decal, a `<PedDecorationCollection>` **overlay**, an optional
  `shop_tattoo.meta`, a `tattoos.json` **runtime manifest** for the server, and
  the matching `fxmanifest.lua` `data_file` entries
  (`PED_OVERLAY_FILE` / `TATTOO_SHOP_DLC_FILE`).
- **feelgood Discord** link added to the in-app credits and the launcher/login
  footer.

### Changed

- Project file format bumped to **fgcloth v2** (adds `tattoos` +
  `tattooCollection`). Existing v1 projects migrate automatically and losslessly.
- The native WebView context menu is now suppressed app-wide (text fields keep
  it for copy/paste) so right-click shows the app's own menus instead.

### Fixed

- Corrected the **JagodaMods** Discord invite in the credits
  (`discord.gg/jagoda` → `discord.com/invite/JagodaMods`).
- The build backend now accepts both fgcloth v1 and v2, so clothing builds keep
  working after the v2 upgrade.

## [1.0.1] — 2026-06-17

### Fixed

- Locales are now loaded in the production build (the i18n glob ran only in dev).

## [1.0.0] — 2026-06-17

### Added

- **Solo / local mode** — build, preview and export fully offline with no
  account or backend.

> ⚠️ 1.0.0 shipped with a locale-loading regression — use 1.0.1 or newer.

[1.3.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.3.0
[#6]: https://github.com/feelgoodrp-com/atelier/pull/6
[1.2.7]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.7
[1.2.6]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.6
[1.2.5]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.5
[1.2.4]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.4
[1.2.3]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.3
[1.2.2]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.2
[1.0.1]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.0.1
[1.0.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.0.0
