# Design: Import PNG/JPG/WebP images as texture variants

**Date:** 2026-07-04
**Status:** Approved (brainstorming)
**Branch:** `feat/png-texture-import`

## Goal

Allow raster images (**.png, .jpg/.jpeg, .webp**) to be added as texture
variants of an existing drawable via the texture panel's "add" button. The
image is converted to a **.ytd** immediately at import; from then on the
project contains only YTDs, exactly as today. Export/build is unchanged.

Scope: **texture panel only** (add-variant flow). Drag & drop into the
workbench and the import wizard keep their current YTD-only behavior.

## Key insight

The sidecar already contains the complete image→YTD pipeline:
`TattooTextureBuilder.BuildYtd(sourceImagePath, ytdName, maxDimension, format)`
decodes any raster format via Magick.NET, BC-encodes with mipmaps via
BCnEncoder and saves a single-texture `YtdFile` (CodeWalker). This feature
exposes that existing, already-exercised path through a new generic endpoint —
it does not add a new encode path.

## Decisions (from brainstorming)

- **Convert at import**, not at build. Preview, optimize, duplicate detection
  and build stay untouched because the stored asset is a normal YTD.
- **Silent defaults**, no extra dialog: format = `defaultTextureFormat`
  preference; if that is `"keep"` (meaningless for a source image) fall back
  to **BC3**. Longest edge capped at the `importMaxDimension` preference
  (default 2048); smaller images keep their size.
- **PNG + JPG + WebP** are accepted (same decode head, same effort).

## Data flow

```
texture panel "add" (file filter: ytd|png|jpg|jpeg|webp)
  -> raster file?  importImageAsTexture()      src/lib/project/import-assets.ts
       -> POST /texture/from-image             sidecar (new endpoint)
            TattooTextureBuilder.BuildYtd(...) -> writes YTD to outPath (temp)
       -> importTextureFile(tempYtd)           unchanged parse + copy
       -> delete temp file
  -> .ytd?         importTextureFile()         unchanged
```

## Sidecar

New endpoint `POST /texture/from-image`, registered in `BuildEndpoints`
next to `/texture/optimize`:

- Request: `{ imagePath, outPath, format, maxDimension }`
- Validation: format ∈ {BC1, BC3, BC7, RGBA8888} (same list as
  `/texture/optimize`); image file must exist.
- Behavior: `TattooTextureBuilder.BuildYtd` with the YTD name set to the
  file stem of `outPath` (keeps the txd==txt naming rule mechanically),
  write result to `outPath`.
- Response: `{ sizeBytes }`; errors as readable messages like the other
  endpoints.

`TattooTextureBuilder` stays where it is; no refactor needed (its API is
already generic).

## Frontend

- `texture-panel.tsx` `addTextures()`: extend the file-dialog filter to
  `["ytd", "png", "jpg", "jpeg", "webp"]`; route non-ytd paths through the
  new helper.
- `import-assets.ts` new `importImageAsTexture(projectDir, imagePath, gender,
  type)`: resolve format/cap from `usePreferencesStore` (with the
  keep→BC3 fallback), convert into `<projectDir>/.tmp-texture-import/<stem>.ytd`
  via the sidecar client (inside the project dir so the Tauri fs scope covers
  the cleanup), then run the unchanged `importTextureFile` against the temp
  YTD and delete it afterwards (best-effort cleanup in `finally`).
- `sidecar/client.ts` + `sidecar/types.ts`: thin `textureFromImage()` wrapper
  and DTO types.

## Error handling

- Undecodable/corrupt image: the sidecar returns a readable error; the file
  lands in the existing per-file skip list with that reason — remaining files
  continue. The 26-variant cap applies unchanged.
- Sidecar not ready: existing readable-error path (toast) applies.

## i18n

`de` + `en`: updated file-picker filter label (`texturePanel.pickFilter`) and,
if needed, a skip reason for failed conversions. No other UI text changes.

## Testing

- Sidecar: endpoint test — PNG in → valid single-texture YTD out (parseable by
  the existing YTD parser), requested format respected, invalid format
  rejected.
- Frontend: covered by the unchanged `importTextureFile` path; the selftest
  suite is not affected.
- Manual: in the dev app, add a PNG variant to a drawable → thumbnail and 3D
  preview render; optimize dialog works on the resulting YTD.

## Out of scope

- PNG support in workbench drag & drop and the import wizard.
- Storing original source images in the project.
- A per-import settings dialog (silent defaults are deliberate).
