# Design: RGBA8888 as a texture-optimize format

**Date:** 2026-06-23
**Status:** Approved (brainstorming)
**Branch:** `feat/rgba8888-optimize-format`

## Goal

Add **RGBA8888** (uncompressed `A8R8G8B8`) as an explicitly selectable format in
the texture-optimize flow, alongside the existing `Keep / BC1 / BC3 / BC7`
choices. It serves the **maximum-quality** use case: lossless textures without
BC compression artifacts, at the cost of larger files.

Scope: selectable in **both** the single-texture dialog and the bulk dialog.

## Key insight

The C# sidecar can already produce uncompressed RGBA. `TextureOptimizer.ResolveFormat()`
returns `CompressionFormat.Rgba` today as the auto-fallback for uncompressed
source textures (`TextureOptimizer.cs:133`). This feature **exposes that existing,
already-exercised code path as an explicit choice** — it does not add a new
encode path. That materially lowers the risk.

## Data flow (unchanged)

```
Dialog (format string)
  -> optimizeProjectTexture()            src/lib/project/texture-optimize.ts
  -> sidecar client                      src/lib/sidecar/client.ts
  -> POST /texture/optimize              sidecar/Api/...
  -> TextureOptimizer.ResolveFormat()    sidecar/Engine/Build/TextureOptimizer.cs
  -> BcEncoder (CompressionFormat.Rgba)
```

We only widen the accepted format set at each station; no new wiring.

## Changes per layer

### 1. C# sidecar — `sidecar/Engine/Build/TextureOptimizer.cs`
Add a branch to the `requested` switch in `ResolveFormat()`:

```csharp
"RGBA8888" => CompressionFormat.Rgba,
```

Update the `ArgumentException` message to list `BC1, BC3, BC7, RGBA8888`.

### 2. TS types — `src/lib/sidecar/types.ts` and `src/lib/project/texture-optimize.ts`
Widen both `format` unions:

```ts
format: "BC1" | "BC3" | "BC7" | "RGBA8888" | null;
```

(`TextureOptimizeRequest.format` in types.ts; `OptimizeSettings.format` in
texture-optimize.ts.)

### 3. Single-texture dialog — `src/components/build/texture-optimize-dialog.tsx`
- Extend `FormatChoice` and add `<SelectItem value="RGBA8888">`.
- Show a discreet size hint when `RGBA8888` is selected ("lossless, but a
  noticeably larger file").

### 4. Bulk dialog — `src/components/build/bulk-optimize-dialog.tsx` (new: format select)
- Currently hardcodes `format: null`. Add a format `<Select>` with the same
  options as the single dialog (`Keep / BC1 / BC3 / BC7 / RGBA8888`).
- **Default stays `Keep`** so the bulk "shrink oversized" purpose is unchanged.
- Add `format` state and pass it into `optimizeProjectTexture`.
- Same RGBA8888 size hint.

### 5. i18n — `src/lib/i18n/locales/{de,en}/build.json`
- New key `texture.formatRGBA8888` — DE: "RGBA8888 (unkomprimiert)", EN:
  "RGBA8888 (uncompressed)".
- New size-hint key, e.g. `texture.rgbaSizeHint`.
- Bulk dialog reuses the `texture.format*` keys (or mirrors them under `bulk`)
  for its new format select.

## Technical risk (verify during implementation)

**Channel order.** GTA textures are BGRA. The optimizer swizzles BGRA→RGBA
before encoding (`TextureOptimizer.cs:77`) because BcEncoder consumes `Rgba32`.
For uncompressed RGBA output the round-trip through `DDSIO.GetTexture` must
preserve channel order (no R/B swap). The auto-fallback path already does this
today, so it is expected correct — but it must be verified: optimize a texture
as RGBA8888 and confirm colors/alpha in the 3D preview.

## Testing

- C# unit: `ResolveFormat("RGBA8888")` → `CompressionFormat.Rgba`; an unknown
  format still throws `ArgumentException`.
- Optional round-trip: optimize a small .ytd as RGBA8888, re-read it, assert the
  resulting `TextureFormat` is `D3DFMT_A8R8G8B8` and colors/alpha are intact.
- Manual: single + bulk dialog each offer RGBA8888; bulk default remains `Keep`;
  3D preview renders correct colors after an RGBA8888 optimize.

## Out of scope (YAGNI)

- Other uncompressed variants (RGB888, BGRA explicit, 16-bit) — not requested.
- Per-texture automatic format heuristics.
