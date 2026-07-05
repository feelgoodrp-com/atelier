# PNG/JPG/WebP Texture Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add raster images (.png/.jpg/.jpeg/.webp) as texture variants via the texture panel; they are converted to .ytd immediately at import through a new sidecar endpoint.

**Architecture:** A new `POST /texture/from-image` sidecar endpoint wraps the existing `TattooTextureBuilder.BuildYtd` pipeline (Magick.NET decode → BCnEncoder → CodeWalker YTD). The frontend converts picked raster files into a temp YTD inside the project dir, then funnels them through the unchanged `importTextureFile` path (parse → copy → AssetRef) and deletes the temp file.

**Tech Stack:** ASP.NET minimal APIs (sidecar, .NET 8), BCnEncoder + Magick.NET + CodeWalker (existing deps), React/TypeScript frontend, Tauri plugin-fs/-dialog, i18next.

**Spec:** `docs/superpowers/specs/2026-07-04-png-texture-import-design.md`

## Global Constraints

- Branch: `feat/png-texture-import`; commits in English, conventional-commit style, each ending with the Claude Fable 5 co-author trailer.
- Accepted formats: BC1, BC3, BC7, RGBA8888 (same list as `/texture/optimize`); sidecar error messages in German (existing convention, e.g. `"Feld 'imagePath' fehlt."`).
- Silent defaults in the frontend: format = `defaultTextureFormat` preference, `"keep"` falls back to `"BC3"`; longest edge capped at the `importMaxDimension` preference.
- Frontend typecheck must stay clean: `bun x tsc --noEmit`.
- The 26-variant cap and all existing texture-panel toasts stay unchanged.

---

### Task 1: Sidecar endpoint `POST /texture/from-image`

**Files:**
- Modify: `sidecar/Engine/Build/TattooTextureBuilder.cs:99-105` (ResolveFormat)
- Modify: `sidecar/Api/BuildDtos.cs` (append records)
- Modify: `sidecar/Api/BuildEndpoints.cs:19` (register) + new handler at file end
- Test: manual HTTP round-trip (the sidecar has no test project; do not add one)

**Interfaces:**
- Consumes: `TattooTextureBuilder.BuildYtd(string sourceImagePath, string ytdName, int maxDimension, string format)` → `byte[]` (existing).
- Produces: `POST /texture/from-image` with JSON body `{ imagePath: string, outPath: string, maxDimension: number, format: "BC1"|"BC3"|"BC7"|"RGBA8888" }` → `200 { sizeBytes: number }` | `400 { error: string }`. Task 2 builds the TS client for exactly this contract.

- [ ] **Step 1: Extend `ResolveFormat` with RGBA8888**

In `sidecar/Engine/Build/TattooTextureBuilder.cs` replace the switch:

```csharp
    private static CompressionFormat ResolveFormat(string format) => format.ToUpperInvariant() switch
    {
        "BC1" => CompressionFormat.Bc1,
        "BC3" => CompressionFormat.Bc3,
        "BC7" => CompressionFormat.Bc7,
        "RGBA8888" => CompressionFormat.Rgba,
        _ => CompressionFormat.Bc3, // tattoos are alpha decals → BC3 default
    };
```

- [ ] **Step 2: Append the DTO records**

At the end of `sidecar/Api/BuildDtos.cs`:

```csharp
/// <summary>POST /texture/from-image — converts a raster image to a single-texture YTD.</summary>
public sealed record TextureFromImageRequest(
    string? ImagePath,
    string? OutPath,
    int? MaxDimension,
    string? Format);

public sealed record TextureFromImageResponse(long SizeBytes);
```

- [ ] **Step 3: Register + implement the handler**

In `sidecar/Api/BuildEndpoints.cs`, after line 19 (`app.MapPost("/texture/optimize", HandleTextureOptimize);`) add:

```csharp
        app.MapPost("/texture/from-image", HandleTextureFromImage);
```

At the end of the class (next to `HandleTextureOptimize`) add:

```csharp
    // ------------------------------------------------------------------
    // POST /texture/from-image  →  200 { sizeBytes } | 400 { error }
    // ------------------------------------------------------------------

    private static IResult HandleTextureFromImage(TextureFromImageRequest request, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build.TextureFromImage");

        if (string.IsNullOrWhiteSpace(request?.ImagePath))
            return Results.BadRequest(new ErrorResponse("Feld 'imagePath' fehlt."));
        var imagePath = request.ImagePath.Trim();
        if (!File.Exists(imagePath))
            return Results.BadRequest(new ErrorResponse($"Datei nicht gefunden: {imagePath}"));

        if (string.IsNullOrWhiteSpace(request.OutPath))
            return Results.BadRequest(new ErrorResponse("Feld 'outPath' fehlt."));
        var outPath = request.OutPath.Trim();
        if (!Path.GetExtension(outPath).Equals(".ytd", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new ErrorResponse("Feld 'outPath' muss auf .ytd enden."));

        if (request.MaxDimension is not (>= 16 and <= 8192))
            return Results.BadRequest(new ErrorResponse("Feld 'maxDimension' muss zwischen 16 und 8192 liegen."));

        var format = request.Format?.Trim().ToUpperInvariant();
        if (format is not ("BC1" or "BC3" or "BC7" or "RGBA8888"))
            return Results.BadRequest(new ErrorResponse("Feld 'format' muss BC1, BC3, BC7 oder RGBA8888 sein."));

        try
        {
            var ytdName = Path.GetFileNameWithoutExtension(outPath);
            var bytes = TattooTextureBuilder.BuildYtd(imagePath, ytdName, request.MaxDimension!.Value, format);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
            File.WriteAllBytes(outPath, bytes);
            log.LogInformation("Converted {Image} -> {Ytd} ({Format}, max {Max}px, {Size} bytes)",
                imagePath, outPath, format, request.MaxDimension, bytes.Length);
            return Results.Ok(new TextureFromImageResponse(bytes.LongLength));
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Image->YTD conversion failed for {Image}", request.ImagePath);
            return Results.BadRequest(new ErrorResponse($"Bild konnte nicht konvertiert werden: {ex.Message}"));
        }
    }
```

- [ ] **Step 4: Build the sidecar**

Run: `dotnet build sidecar/Feelgood.Atelier.Sidecar.csproj`
Expected: `Build succeeded. 0 Error(s)` (warnings are pre-existing).

- [ ] **Step 5: HTTP round-trip test**

Start the sidecar on a pinned dev port (tokenless dev mode), PowerShell:

```powershell
$env:FG_SIDECAR_DEV_PORT = '51999'; dotnet run --project sidecar/Feelgood.Atelier.Sidecar.csproj
```

In a second shell, generate a 256×256 test PNG and convert it (PowerShell):

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 200, 60, 60))
$png = "$env:TEMP\atelier-test.png"; $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

$body = @{ imagePath = $png; outPath = "$env:TEMP\atelier-test.ytd"; maxDimension = 2048; format = 'BC3' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51999/texture/from-image -Method Post -ContentType 'application/json' -Body $body
```

Expected: `{ sizeBytes: <number> }` and `$env:TEMP\atelier-test.ytd` exists.

Verify the YTD parses and error handling works:

```powershell
$body = @{ path = "$env:TEMP\atelier-test.ytd" } | ConvertTo-Json
(Invoke-RestMethod -Uri http://127.0.0.1:51999/parse/ytd -Method Post -ContentType 'application/json' -Body $body).textures

$bad = @{ imagePath = $png; outPath = "$env:TEMP\x.ytd"; maxDimension = 2048; format = 'DXT1' } | ConvertTo-Json
try { Invoke-RestMethod -Uri http://127.0.0.1:51999/texture/from-image -Method Post -ContentType 'application/json' -Body $bad } catch { $_.ErrorDetails.Message }
```

Expected: textures list shows one 256×256 texture named `atelier-test`; the bad request returns `{"error":"Feld 'format' muss BC1, BC3, BC7 oder RGBA8888 sein."}`. Stop the sidecar afterwards.

- [ ] **Step 6: Commit**

```bash
git add sidecar/Engine/Build/TattooTextureBuilder.cs sidecar/Api/BuildDtos.cs sidecar/Api/BuildEndpoints.cs
git commit -m "feat(sidecar): add /texture/from-image endpoint (raster image -> YTD)"
```

---

### Task 2: TypeScript client wrapper

**Files:**
- Modify: `src/lib/sidecar/types.ts` (after `TextureOptimizeResult`, ~line 413)
- Modify: `src/lib/sidecar/client.ts` (after `optimizeTexture`, ~line 431)

**Interfaces:**
- Consumes: `POST /texture/from-image` from Task 1; existing `sidecarFetch<T>(path, init)` helper in `client.ts`.
- Produces: `textureFromImage(request: TextureFromImageRequest): Promise<TextureFromImageResult>` — Task 3 calls exactly this.

- [ ] **Step 1: Add the types**

In `src/lib/sidecar/types.ts` after the `TextureOptimizeResult` interface:

```typescript
/** Request body of POST /texture/from-image. */
export interface TextureFromImageRequest {
  /** Absolute path of the source image (.png/.jpg/.jpeg/.webp). */
  imagePath: string;
  /** Absolute path of the .ytd to write. */
  outPath: string;
  /** Longest-edge cap in pixels (16–8192). */
  maxDimension: number;
  format: "BC1" | "BC3" | "BC7" | "RGBA8888";
}

/** Response of POST /texture/from-image. */
export interface TextureFromImageResult {
  sizeBytes: number;
}
```

- [ ] **Step 2: Add the client wrapper**

In `src/lib/sidecar/client.ts` after `optimizeTexture` (extend the existing type import from `./types` with `TextureFromImageRequest, TextureFromImageResult`):

```typescript
/** POST /texture/from-image — converts a raster image into a single-texture .ytd. */
export async function textureFromImage(
  request: TextureFromImageRequest,
): Promise<TextureFromImageResult> {
  return await sidecarFetch<TextureFromImageResult>("/texture/from-image", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/sidecar/types.ts src/lib/sidecar/client.ts
git commit -m "feat(ui): sidecar client wrapper for /texture/from-image"
```

---

### Task 3: Import helper, texture-panel wiring, i18n

**Files:**
- Modify: `src/lib/project/import-assets.ts` (new export next to `importTextureFile`, ~line 363)
- Modify: `src/components/workbench/texture-panel.tsx:258-300` (`addTextures`)
- Modify: `src/lib/i18n/locales/de/workbench.json:148`, `src/lib/i18n/locales/en/workbench.json:148`

**Interfaces:**
- Consumes: `textureFromImage()` from Task 2; existing `importTextureFile(projectDir, filePath, gender, type): Promise<AssetRef>`, `usePreferencesStore.getState()` (`defaultTextureFormat: FormatChoice`, `importMaxDimension: number`), `KEEP_FORMAT` from `@/lib/project/texture-optimize`.
- Produces: `importImageAsTexture(projectDir: string, imagePath: string, gender: Gender, type: SlotId): Promise<AssetRef>` and `IMAGE_TEXTURE_RE` (RegExp) — used only by the texture panel.

- [ ] **Step 1: Add `importImageAsTexture` to `import-assets.ts`**

Extend the plugin-fs import at the top of the file with `remove`:

```typescript
import { copyFile, exists, mkdir, readFile, remove } from "@tauri-apps/plugin-fs";
```

Add the imports (top of file, with the existing ones):

```typescript
import { textureFromImage } from "@/lib/sidecar/client";
import { KEEP_FORMAT } from "@/lib/project/texture-optimize";
import { usePreferencesStore } from "@/lib/stores/preferences-store";
```

After `importTextureFile` add:

```typescript
/** Raster formats the texture panel accepts alongside .ytd. */
export const IMAGE_TEXTURE_RE = /\.(png|jpe?g|webp)$/i;

/**
 * Imports a raster image as a texture variant: converts it to a temporary
 * .ytd via the sidecar (format from the preferences, "keep" falls back to
 * BC3; longest edge capped at importMaxDimension), then runs the normal
 * importTextureFile path and removes the temp file.
 */
export async function importImageAsTexture(
  projectDir: string,
  imagePath: string,
  gender: Gender,
  type: SlotId,
): Promise<AssetRef> {
  const prefs = usePreferencesStore.getState();
  const format =
    prefs.defaultTextureFormat === KEEP_FORMAT
      ? "BC3"
      : prefs.defaultTextureFormat;

  const tmpDir = joinPath(projectDir, ".tmp-texture-import");
  await mkdir(tmpDir, { recursive: true });
  const stem = stripExtension(fileNameOf(imagePath));
  const tmpYtd = joinPath(tmpDir, `${stem}.ytd`);

  try {
    await textureFromImage({
      imagePath,
      outPath: tmpYtd,
      maxDimension: prefs.importMaxDimension,
      format,
    });
    return await importTextureFile(projectDir, tmpYtd, gender, type);
  } finally {
    await remove(tmpYtd).catch(() => {});
  }
}
```

- [ ] **Step 2: Wire the texture panel**

In `src/components/workbench/texture-panel.tsx` extend the import from `@/lib/project/import-assets`:

```typescript
import {
  IMAGE_TEXTURE_RE,
  importImageAsTexture,
  importTextureFile,
} from "@/lib/project/import-assets";
```

In `addTextures` change the file filter (line 263):

```typescript
      filters: [
        {
          name: t("texturePanel.pickFilter"),
          extensions: ["ytd", "png", "jpg", "jpeg", "webp"],
        },
      ],
```

And replace the per-path import call (lines 287-294):

```typescript
          next.push(
            IMAGE_TEXTURE_RE.test(path)
              ? await importImageAsTexture(
                  projectDir,
                  path,
                  current.gender,
                  current.type,
                )
              : await importTextureFile(
                  projectDir,
                  path,
                  current.gender,
                  current.type,
                ),
          );
```

- [ ] **Step 3: Update the i18n filter label**

`src/lib/i18n/locales/de/workbench.json` line 148:

```json
    "pickFilter": "Texturen (YTD, PNG, JPG, WebP)",
```

`src/lib/i18n/locales/en/workbench.json` line 148:

```json
    "pickFilter": "Textures (YTD, PNG, JPG, WebP)",
```

- [ ] **Step 4: Typecheck + build**

Run: `bun x tsc --noEmit && bun x vite build`
Expected: tsc clean; vite build succeeds (pre-existing chunk-size warning is fine).

- [ ] **Step 5: Commit**

```bash
git add src/lib/project/import-assets.ts src/components/workbench/texture-panel.tsx src/lib/i18n/locales/de/workbench.json src/lib/i18n/locales/en/workbench.json
git commit -m "feat(ui): accept PNG/JPG/WebP as texture variants in the texture panel"
```

---

### Task 4: End-to-end verification + PR

**Files:**
- No code changes (verification + PR only).

**Interfaces:**
- Consumes: everything from Tasks 1-3 via the running dev app.

- [ ] **Step 1: Manual E2E in the dev app**

Run: `npm run tauri:dev`, open a project, select a drawable, texture panel → "Hinzufügen", pick a .png.
Expected: a new variant appears with thumbnail; 3D preview renders it; the project's asset folder contains a .ytd (no .png); `.tmp-texture-import/` inside the project dir is empty or gone. Also verify a corrupt file (e.g. a .txt renamed to .png) lands in the error toast with a readable reason while other files still import.

- [ ] **Step 2: Push and open the PR (English, per user preference)**

```bash
git push -u fork feat/png-texture-import
gh pr create --repo feelgoodrp-com/atelier --base master --head gitBitsystem:feat/png-texture-import \
  --title "feat: import PNG/JPG/WebP images as texture variants" \
  --body "## What

The texture panel's \"add variant\" flow now accepts raster images (.png/.jpg/.jpeg/.webp) alongside .ytd. Images are converted to a single-texture YTD immediately at import — the project keeps containing only YTDs, so preview, optimize, duplicate detection and build stay untouched.

## How

- New sidecar endpoint \`POST /texture/from-image\` that reuses the existing \`TattooTextureBuilder.BuildYtd\` pipeline (Magick.NET decode → BCnEncoder with mipmaps → CodeWalker YTD); \`ResolveFormat\` learned RGBA8888.
- Frontend: \`importImageAsTexture\` converts into \`<projectDir>/.tmp-texture-import/\` and funnels the result through the unchanged \`importTextureFile\` path, then removes the temp file.
- Silent defaults: format from the texture-optimization preference (\"keep\" falls back to BC3), longest edge capped at the import-max-dimension preference.
- i18n: file-picker filter label updated (de/en).

## Verification

- Sidecar HTTP round-trip: generated PNG → endpoint → valid YTD (confirmed via /parse/ytd), invalid format rejected with a readable error.
- Manual E2E in the dev app: PNG variant added, thumbnail + 3D preview render, temp file cleaned up, corrupt file lands in the error toast without breaking the batch.

Spec: \`docs/superpowers/specs/2026-07-04-png-texture-import-design.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR URL printed.
