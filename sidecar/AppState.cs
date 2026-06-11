namespace Feelgood.Atelier.Sidecar;

/// <summary>
/// In-memory app state. No persistence by design: the Tauri host re-sends
/// the configuration (POST /config) every time it (re)connects.
/// </summary>
public sealed class AppState
{
    private string? _gtaPath;

    public string? GtaPath
    {
        get => Volatile.Read(ref _gtaPath);
        set => Volatile.Write(ref _gtaPath, value);
    }

    public bool GtaPathReady
    {
        get
        {
            var path = GtaPath;
            return !string.IsNullOrWhiteSpace(path) && Directory.Exists(path);
        }
    }
}
