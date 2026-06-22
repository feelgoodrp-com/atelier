# Changelog

All notable changes to **atelier** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project follows [Semantic Versioning](https://semver.org/).

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

[1.2.3]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.3
[1.2.2]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.2
[1.0.1]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.0.1
[1.0.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.0.0
