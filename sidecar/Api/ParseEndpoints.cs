using System.Security.Cryptography;
using Feelgood.Atelier.Sidecar.Parsing;

namespace Feelgood.Atelier.Sidecar.Api;

public static class ParseEndpoints
{
    public static void MapParseEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/parse/ydd", (ParseRequest request, ILoggerFactory loggerFactory) =>
            HandleParse(request?.Path, ".ydd", loggerFactory.CreateLogger("Atelier.Parse.Ydd"),
                static (bytes, fileName, sizeBytes, sha256) =>
                    new YddParseResponse(fileName, sizeBytes, sha256, YddParser.Parse(bytes))));

        app.MapPost("/parse/ytd", (YtdParseRequest request, ILoggerFactory loggerFactory) =>
        {
            var log = loggerFactory.CreateLogger("Atelier.Parse.Ytd");

            int? thumbnailMaxSize = null;
            if (request?.Thumbnails != null)
            {
                if (request.Thumbnails.MaxSize is not (>= 1 and <= 4096))
                    return Fail.Bad("field_out_of_range",
                        ("field", "thumbnails.maxSize"), ("min", "1"), ("max", "4096"));
                thumbnailMaxSize = request.Thumbnails.MaxSize;
            }

            return HandleParse(request?.Path, ".ytd", log,
                (bytes, fileName, sizeBytes, sha256) =>
                    new YtdParseResponse(fileName, sizeBytes, sha256,
                        YtdParser.Parse(bytes, sha256, thumbnailMaxSize, log)));
        });
    }

    private static IResult HandleParse(
        string? rawPath,
        string expectedExtension,
        ILogger log,
        Func<byte[], string, long, string, object> parse)
    {
        if (string.IsNullOrWhiteSpace(rawPath))
            return Fail.Bad("field_missing", ("field", "path"));

        var path = rawPath.Trim();
        var extension = Path.GetExtension(path).ToLowerInvariant();
        if (extension != expectedExtension)
            return Fail.Bad("unexpected_extension", ("expected", expectedExtension));

        if (!File.Exists(path))
            return Fail.Bad("file_not_found", ("path", path));

        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(path);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Failed to read {Path}", path);
            return Fail.Bad("file_unreadable", ("path", path), ("error", ex.Message));
        }

        if (bytes.Length == 0)
            return Fail.Bad("file_empty", ("path", path));

        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        try
        {
            var response = parse(bytes, Path.GetFileName(path), bytes.LongLength, sha256);
            return Results.Ok(response);
        }
        catch (Exception ex)
        {
            // CodeWalker throws on garbage/non-RSC7 input - report as client error.
            log.LogError(ex, "Parse failed for {Path} ({Bytes} bytes)", path, bytes.Length);
            return Fail.Bad("parse_failed",
                ("extension", expectedExtension), ("error", ex.Message));
        }
    }
}
