# atelier sidecar (Feelgood.Atelier.Sidecar)

.NET 8 Minimal-API sidecar for **atelier by feelgood** (GTA V addon-clothing
tool). The Tauri desktop app spawns this process and talks to it over loopback
HTTP. It parses RAGE asset files (`.ydd` drawable dictionaries, `.ytd` texture
dictionaries) via the vendored **CodeWalker.Core**.

## Startup handshake

- Binds Kestrel to `http://127.0.0.1:0` (OS-assigned ephemeral port).
- After startup it prints **exactly one line to stdout** and flushes:

  ```
  FG_SIDECAR_READY port={port}
  ```

- All logging goes to **stderr** so stdout stays machine-parseable.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `FG_SIDECAR_TOKEN` | Shared secret. All endpoints except `GET /health` require the request header `x-fg-atelier-token` to match. If unset, the check is **skipped with a warning** (manual dev only — the Tauri host always sets it). |
| `FG_SIDECAR_DEV_PORT` | Pins a fixed port instead of an ephemeral one (manual dev, e.g. `5099`). Invalid values are ignored with a stderr warning. |

Errors are always returned as `{ "error": "message" }` (400 for bad input /
unparseable files, 401 for bad token).

## Endpoints

### `GET /health` (no token required)

```json
{ "ok": true, "version": "0.1.0" }
```

### `GET /info`

```json
{ "version": "0.1.0", "gtaPathReady": false, "gtaPath": null, "codewalkerLoaded": true }
```

### `POST /config`

Body: `{ "gtaPath": "C:\\Path\\To\\GTAV" }` — validates the folder exists and
stores it **in memory only** (the app re-sends it on every connect).
Response: `{ "ok": true, "gtaPath": "...", "gtaPathReady": true }`.

### `POST /parse/ydd`

Body: `{ "path": "C:\\path\\to\\file.ydd" }`

```json
{
  "fileName": "jbib_000_u.ydd",
  "sizeBytes": 393769,
  "sha256": "…hex…",
  "drawables": [
    {
      "name": "jbib_000_u",
      "geometryCount": 2,
      "vertexCount": 12345,
      "polyCount": 6789,
      "lods": { "high": true, "med": false, "low": false }
    }
  ]
}
```

Vertex/poly counts come from the highest LOD level that contains geometry.

### `POST /parse/ytd`

Body: `{ "path": "C:\\path\\to\\file.ytd" }`

```json
{
  "fileName": "jbib_diff_000_a_uni.ytd",
  "sizeBytes": 245144,
  "sha256": "…hex…",
  "textures": [
    {
      "name": "jbib_diff_000_a_uni",
      "width": 512,
      "height": 512,
      "mipCount": 10,
      "format": "D3DFMT_DXT5",
      "isPowerOfTwo": true
    }
  ]
}
```

`sha256` is always the hash of the raw file bytes.

### `POST /preview/glb`

Builds a preview mesh (GLB 2.0, `model/gltf-binary`) from a standalone `.ydd`.

Body:

```json
{
  "yddPath": "C:\\path\\to\\file.ydd",
  "ytdPaths": ["C:\\path\\to\\file_a.ytd", "C:\\path\\to\\file_b.ytd"],
  "textureIndex": 0,
  "pedModel": "mp_m_freemode_01",
  "includePedBody": false
}
```

- `yddPath` (required) — all drawables of the YDD end up in one GLB scene,
  using the highest LOD level that contains geometry (matches `/parse/ydd`).
- `ytdPaths` (optional, default `[]`) — texture dict variants in letter order
  (a, b, c, …). `textureIndex` selects which one to embed (default `0`,
  **clamped** into `[0, ytdPaths.length - 1]` — out-of-range values never
  fail). The diffuse texture is decoded via DDSIO, embedded as PNG and bound
  as plain `pbrMetallicRoughness` `baseColorTexture` (roughness 0.9,
  metallic 0, no extensions). Texture decode failures degrade to an
  untextured mesh instead of failing the request.
- `includePedBody` (optional, default `false`) — merges the default freemode
  ped components (`pedModel`: `mp_m_freemode_01` | `mp_f_freemode_01`,
  default male) into the scene. Requires a configured `gtaPath`; the first
  use initializes the CodeWalker GameFileCache (slow, one-time per process).

Responses:

- `200` GLB bytes with `X-FG-Vertex-Count` / `X-FG-Poly-Count` headers
  (counts cover the whole scene; without ped body they equal the
  `/parse/ydd` sums).
- `400 { "error": … }` for missing/invalid paths or unparseable files.
- `422 { "error": "ped_body_unavailable" }` when `includePedBody` is
  requested but no usable `gtaPath` is configured.

Results are cached in-memory (LRU 64) keyed by **content hashes**
(`sha256(ydd bytes)`, `sha256(selected ytd bytes)` or `none`,
`includePedBody`, `pedModel`) — clients can cache by the same key.

### `POST /validate`

Body: `{ "projectDir": "C:\\…", "project": <pack.atelier JSON> }` →
`{ "findings": [{ "severity": "error"|"warn"|"info", "code": "…", "drawableId": "<uuid>|null", "message": "…(German)…" }] }`.
Checks: missing/unreadable/changed (hash mismatch) ydd + texture files,
replace without `replaceTargetId`, missing Med/Low LODs, textures > 2048 px /
non-PoT / > 26, duplicate ydd hashes, per-(gender, slot) bucket counts and
split prediction.

### `POST /build` → `202 { "jobId": "…" }`

Body:

```json
{
  "projectDir": "C:\\…", "project": { "fgcloth": 1, … },
  "target": "fivem" | "singleplayer" | "ragemp" | "altv",
  "outDir": "C:\\out",
  "options": { "dlcName": "mypack", "resourceName": null, "generateShopMeta": true, "splitAt": 128 }
}
```

One build per process — a second `POST /build` while one runs returns
`409 { "error": "busy" }`. Build errors (including validation errors — the
build runs `/validate` first and refuses on `error` findings) surface in the
SSE stream, not on this request.

### `GET /build/progress?jobId=…` (SSE)

`text/event-stream`; events `{ "phase", "current", "total", "message" }`,
keep-alive comment every 10 s, terminal event
`{ "done": true, "outDir", "report": { "resources": [{ "folder", "drawables" }], "warnings": [] } }`
or `{ "done": true, "error": "…" }`. The stream replays from the start on
reconnect; finished jobs stay queryable ~10 minutes.

Split semantics: per gender the addon drawables are chunked (project order)
into groups of `splitAt` (default 128); part *k* = chunk *k* of both genders.
With more than one part **every** part gets `_partN` suffixes on resource
folder + dlc name and its own complete YMTs; drawable numbering (NNN)
restarts at `000` per (part, gender, slot). Replace-mode drawables (fivem
only) ride along in part 1 as base-name overrides without YMT entries.

Parity: the atelier-api server builder (`atelier-api/src/cloth/fivem-export.ts`)
mirrors this planner 1:1 — stream names, `shop_ped_apparel*.meta` and
`fxmanifest.lua` are byte-identical (all such text artifacts use `\n` line
endings via `BuildCommon.AppendLf`); the server artifact only lacks the
binary YMTs.

### `POST /texture/optimize`

Body: `{ "ytdPath": "C:\\…\\file.ytd", "outPath": null, "maxDimension": 1024, "format": "BC1"|"BC3"|"BC7"|null, "regenerateMips": true }`
→ `{ "outPath", "before": { "width", "height", "sizeBytes" }, "after": { … } }`.
`outPath: null` = in-place (atomic `.tmp` + replace); `format: null` keeps the
source compression family. Decode via CodeWalker DDSIO, box-filter downscale,
re-encode via BCnEncoder.NET (parallel), mips regenerated, output is a valid
`.ytd`.

### `POST /debug/ymt`, `POST /debug/rpf`

Diagnostics: round-trip a generated `.ymt` (component/prop/texture counts +
MetaXml snippet) or list all entries of a generated `dlc.rpf`.

## Development

The machine-wide `dotnet` may be 3.1 — always use the user-scoped .NET 8 SDK:

```powershell
$env:DOTNET_ROOT = "$env:USERPROFILE\.dotnet8"
$env:FG_SIDECAR_DEV_PORT = "5099"
$env:FG_SIDECAR_TOKEN = "test"
& "$env:USERPROFILE\.dotnet8\dotnet.exe" run --project .\Feelgood.Atelier.Sidecar.csproj
```

```powershell
curl.exe http://127.0.0.1:5099/health
curl.exe -H "x-fg-atelier-token: test" http://127.0.0.1:5099/info
curl.exe -X POST -H "x-fg-atelier-token: test" -H "Content-Type: application/json" `
  -d '{"path":"C:\\path\\to\\file.ydd"}' http://127.0.0.1:5099/parse/ydd
```

## Publish

```powershell
powershell -ExecutionPolicy Bypass -File .\publish.ps1
```

Runs `dotnet publish -c Release -r win-x64 --self-contained
-p:PublishSingleFile=true -p:PublishTrimmed=false` and copies the exe to
`atelier/src-tauri/binaries/fg-atelier-sidecar-x86_64-pc-windows-msvc.exe`
(Tauri externalBin target-triple naming). Trimming stays **off** — CodeWalker
uses reflection-heavy patterns that trimming would break.

## License guardrail

- This project references **only** the vendored
  `rage-sidecar/third_party/grzyClothTool/CodeWalker/CodeWalker.Core` project
  (CodeWalker component, MIT-compatible).
- The `grzyClothTool*` sources in the same vendor folder are **GPL-3.0** and
  are strictly **reference-only**: never copy from them, never add a
  ProjectReference to them, never link them.
- The vendored CodeWalker.Core csproj must not be modified; compat issues are
  solved on this project's side.
