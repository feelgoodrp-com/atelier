namespace Feelgood.Atelier.Sidecar.Engine;

/// <summary>
/// Small process-wide LRU cache for built preview GLBs, keyed by content
/// hashes (sha256 of the file BYTES, never paths) so renamed/moved files
/// still hit. Mirrors the ThumbnailCache pattern. GLBs can be multiple MB
/// (embedded textures), hence the small capacity.
/// </summary>
public static class PreviewGlbCache
{
    private const int Capacity = 64;

    /// <summary>
    /// YtdSha is "none" when no texture dict is applied; PedModel is "" unless
    /// it influences the output (ped body included OR posed — pose clips are
    /// gender-specific); Pose is the pose id or "none" for bind pose.
    /// </summary>
    public readonly record struct Key(string YddSha, string YtdSha, bool IncludePedBody, string PedModel, string Pose);

    private sealed record Entry(Key CacheKey, GlbBuilder.Result Result);

    private static readonly object Gate = new();
    private static readonly Dictionary<Key, LinkedListNode<Entry>> Map = new();
    private static readonly LinkedList<Entry> Lru = new();

    public static bool TryGet(Key key, out GlbBuilder.Result result)
    {
        lock (Gate)
        {
            if (Map.TryGetValue(key, out var node))
            {
                // Refresh recency: move to the front of the LRU list.
                Lru.Remove(node);
                Lru.AddFirst(node);
                result = node.Value.Result;
                return true;
            }
        }

        result = null!;
        return false;
    }

    public static void Put(Key key, GlbBuilder.Result result)
    {
        lock (Gate)
        {
            if (Map.TryGetValue(key, out var existing))
            {
                Lru.Remove(existing);
                Map.Remove(key);
            }

            while (Map.Count >= Capacity && Lru.Last != null)
            {
                Map.Remove(Lru.Last.Value.CacheKey);
                Lru.RemoveLast();
            }

            Map[key] = Lru.AddFirst(new Entry(key, result));
        }
    }
}
