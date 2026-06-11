using System.Reflection;
using Feelgood.Atelier.Sidecar.Engine;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Api;

public static class HealthEndpoints
{
    public static string Version { get; } = ResolveVersion();

    public static void MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        // /health is the only endpoint exempt from the token check.
        app.MapGet("/health", () => Results.Ok(new HealthResponse(true, Version)));

        app.MapGet("/info", (AppState state, PedBodyService pedBody) => Results.Ok(new InfoResponse(
            Version,
            state.GtaPathReady,
            state.GtaPath,
            CodeWalkerProbe.IsLoaded,
            pedBody.IsPrewarmed)));
    }

    private static string ResolveVersion()
    {
        var assembly = typeof(HealthEndpoints).Assembly;
        var informational = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (string.IsNullOrWhiteSpace(informational))
            return assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        // Strip SourceLink suffix ("0.1.0+abcdef") if present.
        var plus = informational.IndexOf('+');
        return plus > 0 ? informational[..plus] : informational;
    }
}
