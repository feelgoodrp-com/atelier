using CodeWalker.GameFiles;
using CodeWalker.World;

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

    /// <summary>Default components + the ped's bind-pose skeleton (from its YFT).</summary>
    public sealed record PedData(IReadOnlyList<PedComponent> Components, Skeleton? Skeleton);

    private readonly object _gate = new();
    private readonly ILogger<PedBodyService> _log;
    private GameFileCache? _cache;
    private string? _cachePath;

    /// <summary>Resolved ped data per "{path}|{ped}" — avoids re-walking the cache per preview request.</summary>
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, PedData> _componentCache = new();
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
        var data = new PedData(components, ped.Skeleton);
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
