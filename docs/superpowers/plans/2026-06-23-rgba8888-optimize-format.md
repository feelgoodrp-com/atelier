# RGBA8888 Optimize Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **RGBA8888** (uncompressed `A8R8G8B8`) as an explicitly selectable format in both the single-texture and bulk texture-optimize dialogs.

**Architecture:** The C# sidecar already maps uncompressed sources to `CompressionFormat.Rgba` as an auto-fallback. This feature exposes that existing encode path as an explicit choice. The format string flows unchanged from the React dialogs → `optimizeProjectTexture()` → sidecar client → `POST /texture/optimize` → `TextureOptimizer.ResolveFormat()`. We widen the accepted format set at each station and add a shared TS helper so both dialogs share one source of truth.

**Tech Stack:** React + TypeScript (Vite), Tauri, C# .NET sidecar (BCnEncoder + CodeWalker), i18n via i18next (DE/EN JSON).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-23-rgba8888-optimize-format-design.md`.
- Format token is exactly `"RGBA8888"` (uppercase) across all layers — must match the C# switch arm verbatim.
- Bulk dialog default format stays `Keep` (token `null`) so the "shrink oversized" purpose is unchanged.
- No JS unit-test framework or C# test project exists in this repo. Verification is: `npx tsc --noEmit` (TS), `dotnet build` (C# sidecar), and a manual in-app round-trip. Follow this existing pattern — do NOT introduce vitest/xunit.
- Labels: DE "RGBA8888 (unkomprimiert)", EN "RGBA8888 (uncompressed)".
- All PR titles/bodies and commit messages in English.

---

### Task 1: C# sidecar — accept RGBA8888 in ResolveFormat

**Files:**
- Modify: `sidecar/Engine/Build/TextureOptimizer.cs:112-135` (`ResolveFormat`)

**Interfaces:**
- Produces: the sidecar now accepts `format: "RGBA8888"` on `POST /texture/optimize`, mapping it to `CompressionFormat.Rgba` (uncompressed output).

- [ ] **Step 1: Add the RGBA8888 switch arm + update the error message**

In `ResolveFormat`, change the `requested` switch (currently BC1/BC3/BC7) to:

```csharp
        if (!string.IsNullOrWhiteSpace(requested))
        {
            return requested.ToUpperInvariant() switch
            {
                "BC1" => CompressionFormat.Bc1,
                "BC3" => CompressionFormat.Bc3,
                "BC7" => CompressionFormat.Bc7,
                "RGBA8888" => CompressionFormat.Rgba,
                _ => throw new ArgumentException($"Unbekanntes Format '{requested}' — erlaubt sind BC1, BC3, BC7, RGBA8888."),
            };
        }
```

Leave the source-format fallback switch below it unchanged.

- [ ] **Step 2: Build the sidecar to verify it compiles**

Run (PowerShell, repo root):
```
dotnet build sidecar/Feelgood.Atelier.Sidecar.csproj -c Debug
```
Expected: `Build succeeded` with 0 errors.

- [ ] **Step 3: Commit**

```
git add sidecar/Engine/Build/TextureOptimizer.cs
git commit -m "feat(sidecar): accept RGBA8888 as an explicit optimize format"
```

---

### Task 2: TS types + shared format helper

**Files:**
- Modify: `src/lib/sidecar/types.ts:370-381` (`TextureOptimizeRequest.format`)
- Modify: `src/lib/project/texture-optimize.ts:27-33` (`OptimizeSettings`) and add shared exports near the top of the file.

**Interfaces:**
- Produces (from `texture-optimize.ts`):
  - `export const KEEP_FORMAT = "keep"`
  - `export type ForcedFormat = "BC1" | "BC3" | "BC7" | "RGBA8888"`
  - `export type FormatChoice = typeof KEEP_FORMAT | ForcedFormat`
  - `export function resolveFormatChoice(choice: FormatChoice): ForcedFormat | null`
  - `OptimizeSettings.format` is now `ForcedFormat | null`
- Both dialogs (Tasks 4, 5) consume these.

- [ ] **Step 1: Widen the request DTO union in `types.ts`**

Change the `format` field of `TextureOptimizeRequest`:

```ts
  /** Forced format; null keeps the source's BC family. */
  format: "BC1" | "BC3" | "BC7" | "RGBA8888" | null;
```

- [ ] **Step 2: Add shared format types + helper in `texture-optimize.ts`**

Just below the imports (before `OptimizeSettings`), add:

```ts
/** Dropdown sentinel: keep the source's compression family. */
export const KEEP_FORMAT = "keep";

/** Explicitly forced output formats (uncompressed RGBA8888 included). */
export type ForcedFormat = "BC1" | "BC3" | "BC7" | "RGBA8888";

/** A format dropdown value: a forced format or "keep". */
export type FormatChoice = typeof KEEP_FORMAT | ForcedFormat;

/** Maps a dropdown choice to the sidecar `format` (null = keep family). */
export function resolveFormatChoice(choice: FormatChoice): ForcedFormat | null {
  return choice === KEEP_FORMAT ? null : choice;
}
```

- [ ] **Step 3: Narrow `OptimizeSettings.format` to the shared type**

```ts
export interface OptimizeSettings {
  /** Longest-edge cap in pixels (512/1024/2048 in the UI). */
  maxDimension: number;
  /** Forced format; null keeps the source's BC family. */
  format: ForcedFormat | null;
  regenerateMips: boolean;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Dialogs still compile — they pass `null` or BC* string literals which remain valid.)

- [ ] **Step 5: Commit**

```
git add src/lib/sidecar/types.ts src/lib/project/texture-optimize.ts
git commit -m "feat: add RGBA8888 to optimize format types + shared helper"
```

---

### Task 3: i18n — RGBA8888 label + size hint (DE + EN)

**Files:**
- Modify: `src/lib/i18n/locales/de/build.json:82-100` (`texture` block)
- Modify: `src/lib/i18n/locales/en/build.json:82-100` (`texture` block)

**Interfaces:**
- Produces: i18n keys `texture.formatRGBA8888` and `texture.rgbaSizeHint` in the `build` namespace. Both dialogs (Tasks 4, 5) use them via `t("texture.formatRGBA8888")` / `t("texture.rgbaSizeHint")`.

- [ ] **Step 1: Add keys to `de/build.json`**

In the `"texture"` object, after the `"formatBC7"` line, add:

```json
    "formatBC7": "BC7 (beste Qualität)",
    "formatRGBA8888": "RGBA8888 (unkomprimiert)",
    "rgbaSizeHint": "Verlustfrei, aber deutlich größere Datei (keine Kompression).",
```

- [ ] **Step 2: Add keys to `en/build.json`**

In the `"texture"` object, after the `"formatBC7"` line, add:

```json
    "formatBC7": "BC7 (best quality)",
    "formatRGBA8888": "RGBA8888 (uncompressed)",
    "rgbaSizeHint": "Lossless, but a noticeably larger file (no compression).",
```

- [ ] **Step 3: Validate JSON parses**

Run: `node -e "require('./src/lib/i18n/locales/de/build.json');require('./src/lib/i18n/locales/en/build.json');console.log('ok')"`
Expected: `ok` (no JSON syntax error).

- [ ] **Step 4: Commit**

```
git add src/lib/i18n/locales/de/build.json src/lib/i18n/locales/en/build.json
git commit -m "i18n: add RGBA8888 format label + size hint (de/en)"
```

---

### Task 4: Single-texture dialog — RGBA8888 option + size hint

**Files:**
- Modify: `src/components/build/texture-optimize-dialog.tsx`

**Interfaces:**
- Consumes: `KEEP_FORMAT`, `FormatChoice`, `resolveFormatChoice` from `@/lib/project/texture-optimize`.

- [ ] **Step 1: Replace the local format constants with shared imports**

Delete the local declarations (lines 39-41):
```ts
const KEEP_FORMAT = "keep";

type FormatChoice = typeof KEEP_FORMAT | "BC1" | "BC3" | "BC7";
```

Add to the existing import from texture-optimize (currently imports `applyOptimizedTextures, optimizeProjectTexture`):
```ts
import {
  applyOptimizedTextures,
  KEEP_FORMAT,
  optimizeProjectTexture,
  resolveFormatChoice,
  type FormatChoice,
} from "@/lib/project/texture-optimize";
```

- [ ] **Step 2: Use the shared resolver in `run()`**

Replace the `format` mapping in the `optimizeProjectTexture` call:
```ts
      const result = await optimizeProjectTexture(projectDir, texture, {
        maxDimension,
        format: resolveFormatChoice(format),
        regenerateMips,
      });
```

- [ ] **Step 3: Add the RGBA8888 SelectItem**

In the format `<SelectContent>`, after the BC7 item:
```tsx
                <SelectItem value="BC7">{t("texture.formatBC7")}</SelectItem>
                <SelectItem value="RGBA8888">{t("texture.formatRGBA8888")}</SelectItem>
```

- [ ] **Step 4: Add the size hint under the format row**

Immediately after the closing `</div>` of the format row (the `<div className="flex items-center justify-between gap-3">` that holds the format `<Select>`), add:
```tsx
          {format === "RGBA8888" && (
            <p className="-mt-1 text-[11px] leading-relaxed text-amber-200/70">
              {t("texture.rgbaSizeHint")}
            </p>
          )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/components/build/texture-optimize-dialog.tsx
git commit -m "feat(ui): offer RGBA8888 in the single-texture optimize dialog"
```

---

### Task 5: Bulk dialog — add format select + RGBA8888 + size hint

**Files:**
- Modify: `src/components/build/bulk-optimize-dialog.tsx`

**Interfaces:**
- Consumes: `KEEP_FORMAT`, `FormatChoice`, `resolveFormatChoice` from `@/lib/project/texture-optimize`; `Select*` from `@/components/ui/select` (already imported).

- [ ] **Step 1: Import the shared format helpers**

Extend the existing import from texture-optimize to add the three names:
```ts
import {
  applyOptimizedTextures,
  collectProjectTextures,
  KEEP_FORMAT,
  maxEdgeOf,
  optimizeProjectTexture,
  resolveFormatChoice,
  type FormatChoice,
  type OptimizedTexture,
} from "@/lib/project/texture-optimize";
```

- [ ] **Step 2: Add a `format` state (default Keep)**

Next to the existing `maxDimension` state:
```ts
  const [format, setFormat] = useState<FormatChoice>(KEEP_FORMAT);
```

- [ ] **Step 3: Pass the resolved format into the batch loop**

Replace the hardcoded `format: null` in the `optimizeProjectTexture` call inside `run()`:
```ts
          results.push(
            await optimizeProjectTexture(projectDir, texture, {
              maxDimension,
              format: resolveFormatChoice(format),
              regenerateMips: true,
            }),
          );
```

- [ ] **Step 4: Add a format `<Select>` next to the "Shrink to" row**

Immediately after the existing "Shrink to" row `<div className="flex items-center justify-between gap-3">…</div>` (the one with the `maxDimension` select), add:
```tsx
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-white/70">{t("texture.format")}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as FormatChoice)}>
                <SelectTrigger className="h-8 w-28 border-white/15 bg-white/5 text-xs text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_FORMAT}>{t("texture.formatKeep")}</SelectItem>
                  <SelectItem value="BC1">{t("texture.formatBC1")}</SelectItem>
                  <SelectItem value="BC3">{t("texture.formatBC3")}</SelectItem>
                  <SelectItem value="BC7">{t("texture.formatBC7")}</SelectItem>
                  <SelectItem value="RGBA8888">{t("texture.formatRGBA8888")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {format === "RGBA8888" && (
              <p className="text-[11px] leading-relaxed text-amber-200/70">
                {t("texture.rgbaSizeHint")}
              </p>
            )}
```

(`Label`, `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` are already imported in this file.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/components/build/bulk-optimize-dialog.tsx
git commit -m "feat(ui): add format select with RGBA8888 to the bulk optimize dialog"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only). This is the real test for the channel-order risk noted in the spec.

- [ ] **Step 1: Build the sidecar and run the app**

```
bun run sidecar:publish
bun run tauri:dev
```
Expected: app launches, sidecar status pill goes `ready`.

- [ ] **Step 2: Single dialog — optimize one texture as RGBA8888**

Open a project, right-click a texture → Optimize. Confirm the **RGBA8888 (uncompressed)** option appears and the size hint shows when selected. Run it.
Expected: success toast; the result's "after" size is **larger** than a BC equivalent (uncompressed).

- [ ] **Step 3: Verify colors/alpha in the 3D preview (channel order)**

Inspect the optimized drawable in the 3D preview.
Expected: colors are correct (no red/blue swap) and alpha/transparency is intact. If channels are swapped, revisit `TextureOptimizer.OptimizeTexture` swizzle (`TextureOptimizer.cs:77`) for the uncompressed path.

- [ ] **Step 4: Bulk dialog — default + RGBA8888**

Open "Optimize oversized textures". Confirm the new **Format** select defaults to **Keep**. Run once with Keep (sizes shrink as before), then once with RGBA8888 on a small selection.
Expected: Keep behaves exactly as before; RGBA8888 produces uncompressed output with correct colors.

- [ ] **Step 5: Final full build**

Run: `npx tsc --noEmit` then `dotnet build sidecar/Feelgood.Atelier.Sidecar.csproj -c Debug`
Expected: both succeed.

---

## Self-Review

**Spec coverage:**
- C# `ResolveFormat` RGBA8888 → Task 1. ✓
- TS unions widened (types.ts + texture-optimize.ts) → Task 2. ✓
- Single dialog option + size hint → Task 4. ✓
- Bulk dialog format select + size hint → Task 5. ✓
- i18n DE/EN keys → Task 3. ✓
- Channel-order risk verification → Task 6 (Step 3). ✓
- Spec's "C# unit test" is intentionally replaced by `dotnet build` + manual round-trip, per Global Constraints (no C# test harness exists; spec listed it as optional).

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. ✓

**Type consistency:** `FormatChoice`, `KEEP_FORMAT`, `resolveFormatChoice`, `ForcedFormat` are defined in Task 2 and consumed with identical names in Tasks 4 and 5. The `"RGBA8888"` token is identical in C# (Task 1), the DTO union (Task 2), the SelectItem values (Tasks 4, 5), and the `format === "RGBA8888"` hint guards. ✓
