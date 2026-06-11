using Feelgood.Atelier.Sidecar.Engine;

namespace Feelgood.Atelier.Sidecar.Api;

public static class ConfigEndpoints
{
    public static void MapConfigEndpoints(this IEndpointRouteBuilder app)
    {
        // Stores the GTA V install path in memory only; the Tauri host
        // re-sends it on every connect, so no persistence is needed.
        app.MapPost("/config", (ConfigRequest request, AppState state, PedBodyService pedBody, ILogger<AppState> log) =>
        {
            if (string.IsNullOrWhiteSpace(request?.GtaPath))
                return Results.BadRequest(new ErrorResponse("Feld 'gtaPath' fehlt."));

            var gtaPath = request.GtaPath.Trim();
            if (!Directory.Exists(gtaPath))
                return Results.BadRequest(new ErrorResponse($"Ordner nicht gefunden: {gtaPath}"));

            state.GtaPath = gtaPath;
            log.LogInformation("GTA path configured: {GtaPath}", gtaPath);

            // Build the expensive GameFileCache + resolve both freemode peds
            // NOW (fire-and-forget) — the first ped-body preview becomes a
            // cache hit instead of a multi-second stall.
            pedBody.PrewarmInBackground(gtaPath);

            return Results.Ok(new ConfigResponse(true, state.GtaPath, state.GtaPathReady));
        });
    }
}
