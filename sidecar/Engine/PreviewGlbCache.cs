namespace Feelgood.Atelier.Sidecar.Engine;

/// <summary>
/// Small process-wide LRU cache for built preview GLBs, keyed by content
/// hashes (sha256 of the file BYTES, never paths) so renamed/moved files
/// still hit. Mirrors the ThumbnailCache pattern. GLBs can be multiple MB
/// (embedded textures), hence the small capacity PLUS a byte budget — the
/// appearance key multiplies the key space, so entry count alone no longer
/// bounds memory.
/// </summary>
public static class PreviewGlbCache
{
    private const int Capacity = 64;
    /// <summary>Upper bound for the summed GLB bytes kept in the cache.</summary>
    private const long ByteBudget = 256L * 1024L * 1024L;

    /// <summary>
    /// YtdSha is "none" when no texture dict is applied; PedModel is "" unless
    /// it influences the output (ped body included OR posed — pose clips are
    /// gender-specific); Pose is the pose id or "none" for bind pose;
    /// Appearance is the canonical appearance key (PedAppearanceKey.Canonical,
    /// "default" when none is applied or the ped body is not rendered).
    /// </summary>
    public readonly record struct Key(string YddSha, string YtdSha, bool IncludePedBody, string PedModel, string Pose, string Appearance);

    /// <summary>
    /// AppearanceFallbacks is the prebuilt X-FG-Appearance-Fallbacks header
    /// value (null when no slot fell back) — cached alongside the GLB so
    /// cache HITS answer with the exact same headers as the original build.
    /// </summary>
    private sealed record Entry(Key CacheKey, GlbBuilder.Result Result, string? AppearanceFallbacks);

    private static readonly object Gate = new();
    private static readonly Dictionary<Key, LinkedListNode<Entry>> Map = new();
    private static readonly LinkedList<Entry> Lru = new();
    private static long TotalBytes;

    public static bool TryGet(Key key, out GlbBuilder.Result result, out string? appearanceFallbacks)
    {
        lock (Gate)
        {
            if (Map.TryGetValue(key, out var node))
            {
                // Refresh recency: move to the front of the LRU list.
                Lru.Remove(node);
                Lru.AddFirst(node);
                result = node.Value.Result;
                appearanceFallbacks = node.Value.AppearanceFallbacks;
                return true;
            }
        }

        result = null!;
        appearanceFallbacks = null;
        return false;
    }

    public static void Put(Key key, GlbBuilder.Result result, string? appearanceFallbacks = null)
    {
        lock (Gate)
        {
            if (Map.TryGetValue(key, out var existing))
            {
                TotalBytes -= existing.Value.Result.Glb.LongLength;
                Lru.Remove(existing);
                Map.Remove(key);
            }

            // Evict by entry count AND byte budget. A single entry larger
            // than the whole budget still gets cached (after draining the
            // list) — unrealistic for GLBs, but never drop the fresh result.
            while ((Map.Count >= Capacity || TotalBytes + result.Glb.LongLength > ByteBudget) && Lru.Last != null)
            {
                TotalBytes -= Lru.Last.Value.Result.Glb.LongLength;
                Map.Remove(Lru.Last.Value.CacheKey);
                Lru.RemoveLast();
            }

            Map[key] = Lru.AddFirst(new Entry(key, result, appearanceFallbacks));
            TotalBytes += result.Glb.LongLength;
        }
    }
}
