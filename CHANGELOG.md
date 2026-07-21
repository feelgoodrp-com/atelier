# Changelog

All notable changes to **atelier** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project follows [Semantic Versioning](https://semver.org/).

## [1.10.0] — 2026-07-21

### Added

- **Viewer metadata for the in-game viewer** — a new FiveM-only checkbox in the
  build dialog. With it ticked, the build also writes an `atelier-pack.json`
  into the resource, carrying what the game itself does not need and therefore
  loses: the **label**, **group**, slot name, texture count, mode and flags of
  every item.
  That file is what [atelier-fivem](https://github.com/feelgoodrp-com/atelier-fivem)
  looks for — a new companion resource that finds your packs on a running
  server and lets you browse them in-game on a mannequin. No checkbox, no file,
  and the pack stays invisible to it: nothing is guessed from folder contents.
  Off by default; with the option off the build output is unchanged.

## [1.9.1] — 2026-07-21

### Added

- **Progress ring for the project check.** Instead of a spinner that says
  nothing, the check now shows how far it is: `42/300`, the percentage, and the
  garment currently being read. The total is known before the first item, so
  the ring starts out determinate.
  It stays honest about what it does not know: when no progress arrives for two
  seconds it falls back to spinning, `N/N` switches to *"almost done — running
  the project-wide checks"* (the per-item loop finishes before the project-wide
  checks do, so `N/N` is not done), and a project without drawables spins
  rather than inventing a number. A check faster than 250 ms shows no ring at
  all instead of flashing one.

### Changed

- **One check or build at a time.** Both read every ydd and ytd of the project,
  so the engine now rejects a second one with a clear message instead of
  running them on top of each other. Repeatedly pressing "check again" used to
  stack concurrent full validations.

## [1.9.0] — 2026-07-21

### Added

- **Build is its own screen.** The dialog now only asks for target, DLC name
  and output folder — checking, findings and building happen on a full screen
  in the app. The findings list finally has room: clickable counters for
  errors/warnings/notes double as filters, there is a search field, and every
  finding shows where it comes from (gender, slot, garment), the message and
  its code.
- **Live log next to the work, not in a second window.** The build screen has
  a live log on the right rail the whole time, in plain language. The separate
  log window is still one click away from the pane's header.
- **Fix a finding and come back.** "Show in workbench" now leaves the build
  session alive: fix the drawable, and the header's Build button reads **"Back
  to build"** with the findings, filter and search still in place. A running
  build no longer dies when the dialog closes.
- **The check finally shows progress.** Project validation reads and parses
  every ydd and ytd, which runs for minutes on a big project — and it used to
  log nothing at all from start to finish. It now reports
  `Validating drawable 42/300: <name>` before each item, so the log moves and
  a stall names the file it is stuck on.

### Changed

- Importing files and optimizing textures in bulk are disabled while a check
  or build is running — both rewrite the exact files the engine is reading.

### Fixed

- A build session is bound to its project and is dropped when another project
  is opened. Without this, switching projects and pressing Build would have
  built the **new** project into the **old** project's output folder, under
  the old DLC name.
- The live log no longer comes up empty after leaving the build screen and
  returning while a job is running.
- The "show in workbench" button only appears when the drawable still exists
  (it silently did nothing after a delete), a finished session no longer
  claims to be running, a second build cannot be started on top of a running
  one, and a hiccup in the progress display can no longer abort the build's
  progress stream.

## [1.8.1] — 2026-07-21

### Added

- **Live logs during a build** — the build dialog now has a **"Live logs"**
  button (and one more on the failure screen) that opens the log window docked
  beside the main window, so you can see that the build is still working. Every
  build step is written to the log: start, each phase, every progress tick, and
  the result with its duration.
- **Plain language in the log window** — log lines are rewritten into readable
  sentences (`Outfit GLB built: 4 items, 2847392 bytes, ped=mp_f_freemode_01` →
  *"Outfit preview created (4 garments, 2.7 MB)"*), in English and German. File
  paths shrink to file names, byte counts become sizes, character models and
  clothing slots get real names. Toggle it with the **language button** in the
  log toolbar; hovering a line shows the original, and **Copy** always copies
  the raw lines for bug reports. Anything without a rule stays visible verbatim.

### Changed

- **Much quieter logs** — the sidecar no longer logs the ASP.NET request
  pipeline (`Request starting/finished`, CORS, endpoint execution). That was
  ~98% of all log volume and drowned out the app's own messages.
- The log window hides pure plumbing (stack frames, log-formatter headers) in
  plain-language mode and shows how many lines it hid; the raw view is
  unchanged.
- The log window title now follows the app language instead of always being
  German.

### Fixed

- Log lines coming from dependencies no longer carry `log.file=…` cargo-registry
  paths in the message; the record's own target is shown instead.

## [1.8.0] — 2026-07-17

### Added

- **Server update indicator** — Settings → Backend now shows the connected
  atelier-api server's version and an **"Update available"** badge when the
  server reports a newer version is on GitHub, mirroring the app's own updater
  card. ("Updating" the server means redeploying it.)

## [1.7.0] — 2026-07-17

### Changed

- **Higher drawable-split limit** — the automatic add-on split now goes up to
  **256 drawables** per gender/slot (was 128), matching the raised FiveM/CFX
  `.ymt` component limit. Bigger packs build into fewer parts. Thanks to
  @Blaccii ([#12]).

## [1.6.1] — 2026-07-11

### Changed

- Credit **gitBitsystem** in the README and the in-app credits (Settings) for
  their contributions — image-to-texture import, the RGBA8888 texture format and
  dialog fixes.

## [1.6.0] — 2026-07-11

### Added

- **Skip duplicates on import** — an opt-in option to skip drawables whose mesh
  (ydd) is already in the project when importing a folder/pack or adding files,
  using the same "duplicate mesh" definition as the duplicates dialog. It also
  skips duplicates within the same import. Toggle it in **Settings → Preferences
  → Editor**, or right in the import wizard's review step; skipped items are
  listed in the import summary. Off by default.

## [1.5.0] — 2026-07-05

### Added

- **Import images as texture variants** — the texture panel's "add variant" flow
  now accepts raster images (**PNG / JPG / WebP**) alongside `.ytd`. Each image is
  converted to a single-texture YTD right at import, so the project keeps
  containing only YTDs and preview, optimize, duplicate detection and build are
  all unaffected. The format follows your texture-optimization preference (falling
  back to BC3) and the longest edge is capped at your import max size. Thanks to
  @gitBitsystem ([#11]).

### Fixed

- **Dialog text overflow** — long unbroken names (file, project and drawable
  labels) no longer push badges and buttons out of dialogs. The fix lives in the
  shared dialog and scroll-area primitives, so every dialog — most visibly the
  duplicates dialog — now keeps its content inside the panel. Thanks to
  @gitBitsystem ([#10]).
- The packaged sidecar now bundles the Magick.NET native library, fixing image
  decoding — including **tattoo decal import** — in installed builds. Thanks to
  @gitBitsystem ([#11]).

## [1.4.0] — 2026-06-24

### Added

- **Preferences tab** (Settings → Preferences) with time-saving defaults and
  toggles, all wired to real behavior:
  - **Texture optimization** — a default optimize format (Keep / BC1 / BC3 /
    BC7 / RGBA8888) the optimize dialogs pre-select, an "optimize textures on
    import" toggle, and a max size on import.
  - **Build & projects** — a default export target (pre-selected in the build
    dialog) and a default project folder that pre-fills the new/open-project
    pickers.
  - **Editor** — confirm before deleting, auto-open the 3D preview on selection,
    render the ped body by default, and recovery autosave on/off + interval.
  - **Updates** — check for updates on startup, and optionally install a found
    update automatically.

### Changed

- Numbers (byte sizes, poly/vertex counts) now follow the app language instead
  of a fixed German format.

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

[1.10.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.10.0
[1.9.1]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.9.1
[1.9.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.9.0
[1.8.1]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.8.1
[1.8.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.8.0
[1.7.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.7.0
[#12]: https://github.com/feelgoodrp-com/atelier/pull/12
[1.6.1]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.6.1
[1.6.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.6.0
[1.5.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.5.0
[1.4.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.4.0
[1.3.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.3.0
[#6]: https://github.com/feelgoodrp-com/atelier/pull/6
[#10]: https://github.com/feelgoodrp-com/atelier/pull/10
[#11]: https://github.com/feelgoodrp-com/atelier/pull/11
[1.2.7]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.7
[1.2.6]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.6
[1.2.5]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.5
[1.2.4]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.4
[1.2.3]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.3
[1.2.2]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.2.2
[1.0.1]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.0.1
[1.0.0]: https://github.com/feelgoodrp-com/atelier/releases/tag/v1.0.0
