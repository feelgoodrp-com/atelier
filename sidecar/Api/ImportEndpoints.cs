using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Api;

public static class ImportEndpoints
{
    public static void MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/import/scan", (ImportScanRequest request, ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("Atelier.Import.Scan");

            if (string.IsNullOrWhiteSpace(request?.FolderPath))
                return Fail.Bad("field_missing", ("field", "folderPath"));

            var folderPath = request.FolderPath.Trim();
            if (!Directory.Exists(folderPath))
                return Fail.Bad("folder_not_found", ("path", folderPath));

            try
            {
                var (entries, warnings) = ImportScanner.Scan(folderPath, log);
                log.LogInformation("Scanned {Folder}: {Entries} entries, {Warnings} warnings",
                    folderPath, entries.Count, warnings.Count);
                return Results.Ok(new ImportScanResponse(entries, warnings));
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Import scan failed for {Folder}", folderPath);
                return Fail.Bad("scan_failed", ("error", ex.Message));
            }
        });
    }
}
