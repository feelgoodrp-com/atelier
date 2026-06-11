namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Lazily checks that the CodeWalker.Core assembly can actually be loaded
/// (single-file publish or trimming issues would surface here instead of
/// crashing the first /parse request).
/// </summary>
public static class CodeWalkerProbe
{
    private static readonly Lazy<bool> Probe = new(() =>
    {
        try
        {
            // Touch a CodeWalker type so the assembly gets resolved + JITed.
            return typeof(CodeWalker.GameFiles.YddFile).Assembly.GetName().Name == "CodeWalker.Core";
        }
        catch
        {
            return false;
        }
    });

    public static bool IsLoaded => Probe.Value;
}
