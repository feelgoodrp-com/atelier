namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Small process-wide LRU cache for rendered texture thumbnails, keyed by
/// (file sha256, texture name, maxSize). Repeated /parse/ytd calls (UI
/// refreshes) skip the expensive DDS decode without growing memory unbounded.
/// </summary>
public static class ThumbnailCache
{
    private const int Capacity = 256;

    private sealed record Entry((string FileSha, string TextureName, int MaxSize) Key, string PngBase64);

    private static readonly object Gate = new();
    private static readonly Dictionary<(string FileSha, string TextureName, int MaxSize), LinkedListNode<Entry>> Map = new();
    private static readonly LinkedList<Entry> Lru = new();

    public static bool TryGet(string fileSha, string textureName, int maxSize, out string pngBase64)
    {
        lock (Gate)
        {
            if (Map.TryGetValue((fileSha, textureName, maxSize), out var node))
            {
                // Refresh recency: move to the front of the LRU list.
                Lru.Remove(node);
                Lru.AddFirst(node);
                pngBase64 = node.Value.PngBase64;
                return true;
            }
        }

        pngBase64 = string.Empty;
        return false;
    }

    public static void Put(string fileSha, string textureName, int maxSize, string pngBase64)
    {
        var key = (fileSha, textureName, maxSize);
        lock (Gate)
        {
            if (Map.TryGetValue(key, out var existing))
            {
                Lru.Remove(existing);
                Map.Remove(key);
            }

            while (Map.Count >= Capacity && Lru.Last != null)
            {
                Map.Remove(Lru.Last.Value.Key);
                Lru.RemoveLast();
            }

            Map[key] = Lru.AddFirst(new Entry(key, pngBase64));
        }
    }
}
