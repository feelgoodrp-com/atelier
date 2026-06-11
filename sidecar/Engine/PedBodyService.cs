using System.Diagnostics;
using CodeWalker.GameFiles;
using CodeWalker.World;
using Feelgood.Atelier.Sidecar.Api;

namespace Feelgood.Atelier.Sidecar.Engine;

/// <summary>
/// Lazily initialized CodeWalker GameFileCache + default ped components for
/// the "show ped body" preview option. Cache init scans the whole GTA V
/// install (EXPENSIVE, tens of seconds) so it runs at most once per process
/// and is kept for the process lifetime (DI singleton, like AppState).
/// Adapted from the Feelgood rage-sidecar GrzyGameFileCacheProvider.
/// </summary>
public sealed class PedBodyService
{
    /// <summary>
    /// One ped component drawable plus its matching diffuse texture (may be
    /// null). ComponentIndex is the GTA component slot (0=head .. 11=jbib) —
    /// outfit previews use it to REPLACE defaults with selected garments.
    /// </summary>
    public sealed record PedComponent(int ComponentIndex, Drawable Drawable, Texture? Texture);

    /// <summary>
    /// Default components + the ped's bind-pose skeleton (from its YFT), plus
    /// the variation metadata / file dictionaries needed to RESOLVE non-default
    /// component variations without re-initializing (or mutating) a Ped.
    /// </summary>
    public sealed record PedData(
        IReadOnlyList<PedComponent> Components,
        Skeleton? Skeleton,
        PedFile? Ymt,
        YddFile? Ydd,
        YtdFile? Ytd,
        Dictionary<MetaHash, RpfFileEntry>? DrawableFilesDict,
        Dictionary<MetaHash, RpfFileEntry>? TextureFilesDict);

    /// <summary>
    /// Component list for one appearance + the slots that fell back to the ped
    /// default (unresolvable DLC/out-of-range indices) — reported to clients
    /// via the X-FG-Appearance-Fallbacks response header.
    /// HadTransientLoadFailure is true when at least one fallback / missing
    /// texture was caused by a LOAD failure (content-pump timeout) instead of
    /// a deterministic miss — callers must NOT cache the built GLB then (a
    /// retry may succeed and produce different bytes for the same key).
    /// </summary>
    public sealed record AppearanceComponents(
        IReadOnlyList<PedComponent> Components,
        IReadOnlyList<string> FallbackSlots,
        bool HadTransientLoadFailure = false);

    /// <summary>
    /// One resolved non-default component variation (LRU-cached). ApproxBytes
    /// is the approximated PRIVATE memory of the entry (0 for buffers shared
    /// with the process-wide ped data) — feeds the LRU byte budget.
    /// </summary>
    private sealed record LoadedComponent(Drawable Drawable, Texture? Texture, long ApproxBytes);

    /// <summary>Mirror of the vendored Ped.FileLoadTimeoutMs (Ped.cs is private about it).</summary>
    private const int FileLoadTimeoutMs = 2000;

    private readonly object _gate = new();
    private readonly ILogger<PedBodyService> _log;
    private GameFileCache? _cache;
    private string? _cachePath;

    /// <summary>Resolved ped data per "{path}|{ped}" — avoids re-walking the cache per preview request.</summary>
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, PedData> _componentCache = new();

    // Per-component LRU for NON-default variations, keyed by
    // "{gtaPath}|{ped}|{slot}|{drawableName}|{textureName}". Holds the loaded
    // (Drawable, Texture) pair only — NEVER a full PedData per appearance
    // variant (12 components are 20-80 MB; the key space would explode).
    // Same LinkedList LRU pattern as PreviewGlbCache: bounded by an entry cap
    // AND a byte budget (DrawableFilesDict entries own their geometry +
    // DDS buffers — ~1-9 MB each, so 64 entries alone could exceed 300 MB).
    private const int LoadedComponentCapacity = 64;
    /// <summary>Upper bound for the approximated bytes held by the component LRU.</summary>
    private const long LoadedComponentByteBudget = 150L * 1024L * 1024L;
    private readonly object _loadedGate = new();
    private readonly Dictionary<string, LinkedListNode<(string Key, LoadedComponent Value)>> _loadedMap = new();
    private readonly LinkedList<(string Key, LoadedComponent Value)> _loadedLru = new();
    /// <summary>Approximated bytes currently held by the component LRU.</summary>
    private long _loadedBytes;
    /// <summary>Path a background prewarm was started for (dedupe guard).</summary>
    private string? _prewarmPath;
    /// <summary>True once the background prewarm finished for the current path.</summary>
    public bool IsPrewarmed { get; private set; }

    public PedBodyService(ILogger<PedBodyService> log) => _log = log;

    /// <summary>
    /// Builds the GameFileCache and resolves both freemode peds in the
    /// background so the FIRST ped-body preview request is a cache hit.
    /// Called fire-and-forget after /config sets a valid path.
    /// </summary>
    public void PrewarmInBackground(string gtaPath)
    {
        lock (_gate)
        {
            if (string.Equals(_prewarmPath, gtaPath, StringComparison.OrdinalIgnoreCase)) return;
            _prewarmPath = gtaPath;
            IsPrewarmed = false;
        }

        Task.Run(() =>
        {
            try
            {
                _log.LogInformation("Ped-body prewarm started for {GtaPath}", gtaPath);
                foreach (var ped in new[] { "mp_m_freemode_01", "mp_f_freemode_01" })
                {
                    try
                    {
                        var components = LoadDefaultComponents(gtaPath, ped);
                        _log.LogInformation("Prewarmed {Ped} ({Count} components)", ped, components.Count);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Prewarm failed for {Ped}", ped);
                    }
                }
                IsPrewarmed = true;
                _log.LogInformation("Ped-body prewarm complete");
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Ped-body prewarm crashed");
            }
        });
    }

    /// <summary>
    /// Loads the default components (head, torso, legs, ...) of the given
    /// freemode ped. Throws when the game data cannot be loaded - callers map
    /// that to 422 ped_body_unavailable.
    /// </summary>
    public IReadOnlyList<PedComponent> LoadDefaultComponents(string gtaPath, string pedModel) =>
        LoadPed(gtaPath, pedModel).Components;

    /// <summary>
    /// Loads the ped components with optional appearance overrides. A null /
    /// empty appearance is EXACTLY the default path (prewarm-warm, no extra
    /// work). Overridden slots are resolved via the ped's Ymt variation info
    /// (pure function — the shared Ped instance is never mutated, see
    /// vendored Ped.SetComponentDrawable which writes shared arrays and is
    /// not thread safe). Unresolvable indices (DLC drawables the base Ymt
    /// does not know, EnableDlc=false) fall back to the slot default and are
    /// reported in FallbackSlots — never an error (Menyoo imports render
    /// "best effort").
    /// </summary>
    public AppearanceComponents LoadComponents(string gtaPath, string pedModel, PedAppearanceDto? appearance)
    {
        var pedData = LoadPed(gtaPath, pedModel);
        var overrides = appearance?.Components;
        if (overrides == null || overrides.Count == 0)
            return new AppearanceComponents(pedData.Components, Array.Empty<string>());

        var cache = GetOrCreateCache(gtaPath);
        var bySlot = pedData.Components.ToDictionary(c => c.ComponentIndex);
        var fallbacks = new List<string>();
        var hadTransientFailure = false;

        foreach (var (slot, request) in overrides)
        {
            if (request == null) continue; // validated upstream; defensive
            if (!Build.GtaSlots.ComponentIds.TryGetValue(slot, out var slotIndex))
            {
                // Validated upstream (400) — defensive: report as fallback.
                fallbacks.Add(slot);
                continue;
            }

            var alt = request.Alt ?? 0;
            if (request.Drawable == 0 && request.Texture == 0 && alt == 0)
                continue; // exactly the ped default — keep the prewarmed component

            var resolved = TryResolveComponent(cache, pedData, gtaPath, pedModel, slot, slotIndex,
                request.Drawable, request.Texture, alt, out var transientFailure);
            hadTransientFailure |= transientFailure;
            if (resolved == null)
            {
                fallbacks.Add(slot);
                continue;
            }

            bySlot[slotIndex] = new PedComponent(slotIndex, resolved.Drawable, resolved.Texture);
        }

        var merged = bySlot.Values.OrderBy(c => c.ComponentIndex).ToList();
        fallbacks.Sort(StringComparer.Ordinal);
        return new AppearanceComponents(merged, fallbacks, hadTransientFailure);
    }

    /// <summary>
    /// Resolves ONE component variation to its loaded drawable + texture
    /// (LRU-cached). Mirrors the resolution of the vendored
    /// Ped.SetComponentDrawable (third_party/CodeWalker.Core/World/Ped.cs)
    /// as a pure function. Returns null when the drawable index cannot be
    /// resolved or loaded (caller falls back to the slot default).
    /// transientFailure is true when a drawable/texture load timed out on the
    /// content pump (NOT a deterministic miss) — such results are not cached
    /// here and the caller must keep the built GLB out of its cache too,
    /// otherwise one slow load is frozen until process end (cache poisoning).
    /// </summary>
    private LoadedComponent? TryResolveComponent(
        GameFileCache cache,
        PedData pedData,
        string gtaPath,
        string pedModel,
        string slot,
        int slotIndex,
        int drawable,
        int texture,
        int alt,
        out bool transientFailure)
    {
        transientFailure = false;
        var compData = pedData.Ymt?.VariationInfo?.GetComponentData(slotIndex);
        var drawables = compData?.DrawblData3;
        var item = drawables != null && drawable >= 0 && drawable < drawables.Length ? drawables[drawable] : null;
        if (item == null)
        {
            _log.LogWarning(
                "Appearance: slot {Slot} drawable {Drawable} not in the {Ped} variation info (DLC/out of range) - falling back to default",
                slot, drawable, pedModel);
            return null;
        }

        var drawableName = item.GetDrawableName(alt);
        string? textureName = null;
        var texData = item.TexData;
        if (texData is { Length: > 0 })
        {
            // GetTextureSuffix only clamps NEGATIVE indices — clamp the upper
            // bound ourselves or TexData[texnum] throws IndexOutOfRange.
            var texIndex = Math.Clamp(texture, 0, texData.Length - 1);
            if (texIndex != texture)
                _log.LogWarning("Appearance: slot {Slot} texture {Texture} clamped to {Clamped} for {Ped}",
                    slot, texture, texIndex, pedModel);
            textureName = item.GetTextureName(texIndex);
        }

        var cacheKey = $"{gtaPath.ToLowerInvariant()}|{pedModel}|{slot}|{drawableName}|{textureName ?? "none"}";
        if (TryGetLoadedComponent(cacheKey, out var cached))
            return cached;

        var loadedDrawable = LoadComponentDrawable(cache, pedData, drawableName, out var drawableTimedOut, out var drawableShared);
        if (loadedDrawable == null)
        {
            transientFailure = drawableTimedOut;
            _log.LogWarning(
                "Appearance: drawable {Name} for slot {Slot} of {Ped} could not be loaded ({Reason}) - falling back to default",
                drawableName, slot, pedModel, drawableTimedOut ? "load timeout" : "not found");
            return null;
        }

        Texture? loadedTexture = null;
        var textureTimedOut = false;
        var textureShared = false;
        if (textureName != null)
        {
            loadedTexture = LoadComponentTexture(cache, pedData, textureName, out textureTimedOut, out textureShared);
            if (loadedTexture == null)
                _log.LogWarning(
                    "Appearance: texture {Name} for slot {Slot} of {Ped} could not be loaded ({Reason}) - drawable stays untextured",
                    textureName, slot, pedModel, textureTimedOut ? "load timeout" : "not found");
        }

        var approxBytes = (drawableShared ? 0L : ApproximateDrawableBytes(loadedDrawable))
            + (loadedTexture == null || textureShared ? 0L : ApproximateTextureBytes(loadedTexture));
        var loaded = new LoadedComponent(loadedDrawable, loadedTexture, approxBytes);

        // A texture TIMEOUT is transient: caching the untextured pair would
        // freeze a grey component until eviction/process end while the
        // contract reports no fallback for texture misses. Skip the cache so
        // the next request retries; deterministic misses cache as usual.
        transientFailure = textureTimedOut;
        if (!transientFailure)
            PutLoadedComponent(cacheKey, loaded);
        return loaded;
    }

    /// <summary>
    /// Drawable lookup: ped's own YDD dict first, then the per-file drawable
    /// dict (uncached RPF load). timedOut distinguishes a content-pump
    /// timeout (transient, retry next request) from a deterministic miss;
    /// shared is true when the result reuses process-wide buffers
    /// (ShallowCopy) and must not count against the LRU byte budget.
    /// </summary>
    private Drawable? LoadComponentDrawable(GameFileCache cache, PedData pedData, string name, out bool timedOut, out bool shared)
    {
        timedOut = false;
        shared = false;
        MetaHash namehash = JenkHash.GenHash(name.ToLowerInvariant());

        if (pedData.Ydd?.Dict != null && pedData.Ydd.Dict.TryGetValue(namehash, out var sharedDrawable) && sharedDrawable != null)
        {
            // The ped's own YDD is shared process-wide — hand out a shallow
            // copy (same vertex/texture buffers, fresh wrapper) exactly like
            // the vendored Ped.SetComponentDrawable does.
            shared = true;
            return sharedDrawable.ShallowCopy() as Drawable;
        }

        if (pedData.DrawableFilesDict != null && pedData.DrawableFilesDict.TryGetValue(namehash, out var file))
        {
            var ydd = cache.GetFileUncached<YddFile>(file);
            if (ydd != null && !WaitForFileLoad(ydd, () => cache.TryLoadEnqueue(ydd)))
            {
                timedOut = true; // pump under load — transient, do not poison caches
                return null;
            }
            if (ydd?.Drawables?.Length > 0)
                return ydd.Drawables[0]; // should only be one in this dict
        }

        return null;
    }

    /// <summary>
    /// Texture lookup: ped's own YTD dict first, then the per-file texture
    /// dict (uncached RPF load). timedOut/shared semantics as in
    /// <see cref="LoadComponentDrawable"/>.
    /// </summary>
    private Texture? LoadComponentTexture(GameFileCache cache, PedData pedData, string name, out bool timedOut, out bool shared)
    {
        timedOut = false;
        shared = false;
        MetaHash texhash = JenkHash.GenHash(name.ToLowerInvariant());

        Texture? texture = null;
        pedData.Ytd?.TextureDict?.Dict?.TryGetValue(texhash, out texture);
        if (texture != null)
        {
            // The ped's own YTD lives in the process-wide PedData — costs the
            // LRU nothing extra.
            shared = true;
            return texture;
        }

        if (pedData.TextureFilesDict != null && pedData.TextureFilesDict.TryGetValue(texhash, out var file))
        {
            var ytd = cache.GetFileUncached<YtdFile>(file);
            if (ytd != null && !WaitForFileLoad(ytd, () => cache.TryLoadEnqueue(ytd)))
            {
                timedOut = true; // pump under load — transient, do not poison caches
                return null;
            }
            if (ytd?.TextureDict?.Textures?.data_items?.Length > 0)
                return ytd.TextureDict.Textures.data_items[0]; // should only be one in this dict
        }

        return null;
    }

    /// <summary>
    /// Approximated private memory of an owned drawable: vertex bytes +
    /// index bytes of every LOD/geometry (the dominating buffers). Falls back
    /// to a conservative 2 MB when no geometry is reachable.
    /// </summary>
    private static long ApproximateDrawableBytes(Drawable drawable)
    {
        const long fallbackEstimate = 2L * 1024L * 1024L;
        long bytes = 0;
        var blocks = drawable.DrawableModels;
        foreach (var models in new[] { blocks?.High, blocks?.Med, blocks?.Low, blocks?.VLow })
        {
            if (models == null) continue;
            foreach (var model in models)
            {
                if (model?.Geometries == null) continue;
                foreach (var geom in model.Geometries)
                {
                    bytes += geom?.VertexData?.VertexBytes?.LongLength ?? 0;
                    bytes += (geom?.IndexBuffer?.Indices?.LongLength ?? 0) * sizeof(ushort);
                }
            }
        }
        return bytes > 0 ? bytes : fallbackEstimate;
    }

    /// <summary>Approximated private memory of an owned texture (raw DDS data).</summary>
    private static long ApproximateTextureBytes(Texture texture) =>
        texture.Data?.FullData?.LongLength ?? 512L * 1024L;

    /// <summary>
    /// Waits for the content pump thread to load the file (mirror of the
    /// private Ped.WaitForFileLoad: 2 s timeout, re-enqueue every 50 ms).
    /// </summary>
    private static bool WaitForFileLoad(GameFile? file, Action retryAction)
    {
        if (file == null) return false;
        if (file.Loaded) return true;

        const int retryIntervalMs = 50;
        var sw = Stopwatch.StartNew();
        long lastRetryTime = 0;

        while (!file.Loaded)
        {
            if (sw.ElapsedMilliseconds > FileLoadTimeoutMs) return false;

            if (sw.ElapsedMilliseconds - lastRetryTime >= retryIntervalMs)
            {
                retryAction();
                lastRetryTime = sw.ElapsedMilliseconds;
            }

            Thread.Sleep(1);
        }

        return true;
    }

    private bool TryGetLoadedComponent(string key, out LoadedComponent value)
    {
        lock (_loadedGate)
        {
            if (_loadedMap.TryGetValue(key, out var node))
            {
                // Refresh recency: move to the front of the LRU list.
                _loadedLru.Remove(node);
                _loadedLru.AddFirst(node);
                value = node.Value.Value;
                return true;
            }
        }

        value = null!;
        return false;
    }

    private void PutLoadedComponent(string key, LoadedComponent value)
    {
        lock (_loadedGate)
        {
            if (_loadedMap.TryGetValue(key, out var existing))
            {
                _loadedBytes -= existing.Value.Value.ApproxBytes;
                _loadedLru.Remove(existing);
                _loadedMap.Remove(key);
            }

            // Evict by entry count AND byte budget (mirror of PreviewGlbCache:
            // an entry larger than the whole budget still gets cached after
            // draining the list — never drop the fresh result).
            while ((_loadedMap.Count >= LoadedComponentCapacity
                    || _loadedBytes + value.ApproxBytes > LoadedComponentByteBudget)
                   && _loadedLru.Last != null)
            {
                _loadedBytes -= _loadedLru.Last.Value.Value.ApproxBytes;
                _loadedMap.Remove(_loadedLru.Last.Value.Key);
                _loadedLru.RemoveLast();
            }

            _loadedMap[key] = _loadedLru.AddFirst((key, value));
            _loadedBytes += value.ApproxBytes;
        }
    }

    /// <summary>
    /// Loads components AND skeleton of the given freemode ped (one Ped.Init
    /// per process, cached). The skeleton is the BIND POSE skeleton from the
    /// ped's YFT - PoseEngine clones it before animating, so this instance is
    /// never mutated.
    /// </summary>
    public PedData LoadPed(string gtaPath, string pedModel)
    {
        var cacheKey = $"{gtaPath.ToLowerInvariant()}|{pedModel}";
        if (_componentCache.TryGetValue(cacheKey, out var cached))
            return cached;

        var cache = GetOrCreateCache(gtaPath);

        var ped = new Ped();
        ped.Init(pedModel, cache);
        if (ped.InitData == null)
            throw new InvalidOperationException($"Ped '{pedModel}' not found in the game data.");
        ped.LoadDefaultComponents(cache);

        var components = new List<PedComponent>();
        for (var i = 0; i < ped.Drawables.Length; i++)
        {
            var drawable = ped.Drawables[i];
            if (drawable == null) continue;
            components.Add(new PedComponent(i, drawable, ped.Textures[i]));
        }

        if (components.Count == 0)
            throw new InvalidOperationException($"No default components resolved for ped '{pedModel}'.");

        _log.LogInformation("Loaded {Count} default components for ped {PedModel} (skeleton: {HasSkeleton})",
            components.Count, pedModel, ped.Skeleton != null);
        // Keep the Ymt/Ydd/Ytd/file-dict references so non-default appearance
        // variations can be resolved later WITHOUT another Ped.Init (and
        // without mutating this shared instance's Drawables/Textures arrays).
        var data = new PedData(components, ped.Skeleton,
            ped.Ymt, ped.Ydd, ped.Ytd, ped.DrawableFilesDict, ped.TextureFilesDict);
        _componentCache[cacheKey] = data;
        return data;
    }

    /// <summary>
    /// The (initialized) GameFileCache for the given install — used by
    /// PoseEngine to load clip dictionaries (ycd). Triggers the expensive
    /// one-time init when no cache exists yet.
    /// </summary>
    public GameFileCache GetCache(string gtaPath) => GetOrCreateCache(gtaPath);

    private GameFileCache GetOrCreateCache(string gtaPath)
    {
        lock (_gate)
        {
            if (_cache != null && string.Equals(_cachePath, gtaPath, StringComparison.OrdinalIgnoreCase))
                return _cache;

            // MANDATORY before any RPF access: extract the decryption keys
            // from GTA5.exe. Without them every encrypted RPF scan dies with
            // a NullReference deep in GTACrypto and update.rpf never loads.
            _log.LogInformation("Loading GTA V encryption keys from {GtaPath} ...", gtaPath);
            GTA5Keys.LoadFromPath(gtaPath);

            _log.LogInformation("Initializing GameFileCache for {GtaPath} (one-time, this can take a while) ...", gtaPath);
            // EXACT mirror of grzyClothTool's proven CustomPedsForm setup:
            // EnableDlc=false (the freemode peds load from base+update.rpf,
            // NOT via the DLC mount path), excludeFolders skips irrelevant
            // trees for a faster scan, no extended Jenkins index.
            var cache = new GameFileCache(
                size: 1024L * 1024L * 1024L,
                cacheTime: 60.0,
                folder: gtaPath,
                dlc: string.Empty,
                mods: false,
                excludeFolders: "levels;anim;audio;data;")
            {
                EnableDlc = false,
                EnableMods = false,
                LoadArchetypes = false,
                LoadVehicles = false,
                LoadAudio = false,
                LoadPeds = true,
                BuildExtendedJenkIndex = false,
                DoFullStringIndex = true,
            };
            cache.Init(
                status => _log.LogDebug("GameFileCache: {Status}", status),
                error => _log.LogWarning("GameFileCache: {Error}", error));

            _cachePath = gtaPath;
            _cache = cache;

            // CodeWalker loads queued files (ydd/ytd/ymt requests from
            // Ped.SetComponentDrawable -> TryLoadEnqueue) on a "content
            // thread" that the HOST must pump — grzy's preview form runs
            // exactly this loop. Without it WaitForFileLoad times out and
            // every ped component stays null. The thread stops by itself
            // when this cache instance gets replaced (path change).
            var pump = new Thread(() =>
            {
                while (ReferenceEquals(_cache, cache))
                {
                    try
                    {
                        if (!cache.ContentThreadProc())
                            Thread.Sleep(1);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "GameFileCache content pump error");
                        Thread.Sleep(50);
                    }
                }
            })
            {
                IsBackground = true,
                Name = "gamefilecache-pump",
            };
            pump.Start();

            _log.LogInformation("GameFileCache ready for {GtaPath}", gtaPath);
            return cache;
        }
    }
}
