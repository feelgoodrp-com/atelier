using System.Text.RegularExpressions;
using CodeWalker.GameFiles;
using Feelgood.Atelier.Sidecar.Engine.Build;
using Feelgood.Atelier.Sidecar.Engine.Build.Targets;

namespace Feelgood.Atelier.Sidecar.Api;

public static class BuildEndpoints
{
    private static readonly string[] Targets = { "fivem", "singleplayer", "ragemp", "altv" };
    private static readonly Regex DlcNamePattern = new("^[a-z0-9_]+$", RegexOptions.Compiled);
    private static readonly Regex ResourceNamePattern = new("^[a-zA-Z0-9_-]+$", RegexOptions.Compiled);

    public static void MapBuildEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/validate", HandleValidate);
        app.MapPost("/build", HandleBuild);
        app.MapGet("/build/progress", HandleBuildProgress);
        app.MapPost("/texture/optimize", HandleTextureOptimize);
        app.MapPost("/texture/from-image", HandleTextureFromImage);

        // Diagnostics for generated artifacts (round-trip via CodeWalker).
        app.MapPost("/debug/ymt", HandleDebugYmt);
        app.MapPost("/debug/rpf", HandleDebugRpf);
    }

    // ------------------------------------------------------------------
    // POST /validate
    // ------------------------------------------------------------------

    private static IResult HandleValidate(ValidateRequest request, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build.Validate");

        var input = ValidateProjectInput(request?.ProjectDir, request?.Project);
        if (input != null) return input;

        try
        {
            var findings = Validator.Validate(request!.Project!, request.ProjectDir!.Trim(), splitAt: 256);
            log.LogInformation("Validated project {Name}: {Count} findings ({Errors} errors)",
                request.Project!.Name, findings.Count, findings.Count(f => f.Severity == "error"));
            return Results.Ok(new ValidateResponse(findings));
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Validation failed");
            return Results.BadRequest(new ErrorResponse($"Projekt konnte nicht validiert werden: {ex.Message}"));
        }
    }

    // ------------------------------------------------------------------
    // POST /build  →  202 { jobId } | 400 | 409 { error: "busy" }
    // ------------------------------------------------------------------

    private static IResult HandleBuild(BuildRequest request, BuildJobStore jobs, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build");

        var input = ValidateProjectInput(request?.ProjectDir, request?.Project);
        if (input != null) return input;

        var target = request!.Target?.Trim().ToLowerInvariant();
        if (target == null || !Targets.Contains(target))
            return Results.BadRequest(new ErrorResponse(
                "Feld 'target' muss 'fivem', 'singleplayer', 'ragemp' oder 'altv' sein."));

        if (string.IsNullOrWhiteSpace(request.OutDir))
            return Results.BadRequest(new ErrorResponse("Feld 'outDir' fehlt."));
        var outDir = Path.GetFullPath(request.OutDir.Trim());

        var project = request.Project!;
        var dlcName = (request.Options?.DlcName ?? project.Settings?.DlcName ?? string.Empty)
            .Trim().ToLowerInvariant();
        if (!DlcNamePattern.IsMatch(dlcName))
            return Results.BadRequest(new ErrorResponse(
                "Feld 'options.dlcName' muss aus [a-z0-9_] bestehen (oder im Projekt gesetzt sein)."));

        var resourceName = request.Options?.ResourceName?.Trim();
        if (string.IsNullOrEmpty(resourceName)) resourceName = dlcName;
        if (!ResourceNamePattern.IsMatch(resourceName))
            return Results.BadRequest(new ErrorResponse(
                "Feld 'options.resourceName' muss aus [a-zA-Z0-9_-] bestehen."));

        var splitAt = request.Options?.SplitAt ?? 256;
        if (splitAt is < 1 or > 256)
            return Results.BadRequest(new ErrorResponse("Feld 'options.splitAt' muss zwischen 1 und 256 liegen."));

        var hasDrawables = project.Drawables is { Count: > 0 };
        var hasTattoos = project.Tattoos is { Count: > 0 };
        if (!hasDrawables && !hasTattoos)
            return Results.BadRequest(new ErrorResponse("Projekt enthält weder Drawables noch Tattoos."));

        var options = new BuildOptions(
            target, dlcName, resourceName,
            request.Options?.GenerateShopMeta ?? true,
            splitAt,
            request.Options?.GenerateTattooShopMeta ?? false);

        var job = jobs.TryStart();
        if (job == null)
            return Results.Json(new ErrorResponse("busy"), statusCode: StatusCodes.Status409Conflict);

        var projectDir = request.ProjectDir!.Trim();
        _ = Task.Run(() => RunBuildJob(job, project, projectDir, outDir, options, log));

        log.LogInformation("Build job {JobId} started: target={Target} dlc={Dlc} out={OutDir}",
            job.JobId, target, dlcName, outDir);
        return Results.Json(new { jobId = job.JobId }, statusCode: StatusCodes.Status202Accepted);
    }

    private static void RunBuildJob(
        BuildJob job, AtelierProjectDto project, string projectDir, string outDir,
        BuildOptions options, ILogger log)
    {
        try
        {
            job.Report("validate", 0, 1, "Validiere Projekt");
            var findings = Validator.Validate(project, projectDir, options.SplitAt);
            var errors = findings.Where(f => f.Severity == "error").ToList();
            if (errors.Count > 0)
            {
                var detail = string.Join(" | ", errors.Take(5).Select(e => e.Message));
                var more = errors.Count > 5 ? $" (+{errors.Count - 5} weitere)" : string.Empty;
                job.Fail($"Validierung fehlgeschlagen: {detail}{more}");
                return;
            }
            job.Report("validate", 1, 1, $"Validierung ok ({findings.Count} Hinweise)");

            job.Report("plan", 0, 1, "Erstelle Build-Plan");
            var plan = BuildPlanner.Plan(project, projectDir, options);
            var totalDrawables = plan.Parts.Sum(p => p.DrawableCount);
            // Tattoos are only emitted for the fivem target.
            var tattooCount = options.Target == "fivem" ? plan.Tattoos.Items.Count : 0;
            if (totalDrawables == 0 && tattooCount == 0)
            {
                job.Fail("Build-Plan enthält keine baubaren Drawables oder Tattoos.");
                return;
            }
            job.Report("plan", 1, 1,
                $"{totalDrawables} Drawable(s), {tattooCount} Tattoo(s) in {plan.Parts.Count} Ressource(n) geplant");

            Directory.CreateDirectory(outDir);
            void Progress(string phase, int current, int total, string message) =>
                job.Report(phase, current, total, message);

            var report = options.Target switch
            {
                "fivem" => FivemBuilder.Build(plan, outDir, Progress),
                "singleplayer" => SingleplayerBuilder.Build(plan, outDir, Progress),
                "ragemp" => RageMpBuilder.Build(plan, outDir, Progress),
                "altv" => AltVBuilder.Build(plan, outDir, Progress),
                _ => throw new InvalidOperationException($"Unbekanntes Ziel: {options.Target}"),
            };

            log.LogInformation("Build job {JobId} done: {Resources} resource(s), {Warnings} warning(s)",
                job.JobId, report.Resources.Count, report.Warnings.Count);
            job.Complete(outDir, report);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Build job {JobId} failed", job.JobId);
            job.Fail($"Build fehlgeschlagen: {ex.Message}");
        }
    }

    // ------------------------------------------------------------------
    // GET /build/progress?jobId=…  (SSE)
    // ------------------------------------------------------------------

    private static async Task HandleBuildProgress(HttpContext ctx, BuildJobStore jobs)
    {
        var jobId = ctx.Request.Query["jobId"].ToString();
        if (string.IsNullOrWhiteSpace(jobId))
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            await ctx.Response.WriteAsJsonAsync(new ErrorResponse("Query-Parameter 'jobId' fehlt."));
            return;
        }

        var job = jobs.Get(jobId);
        if (job == null)
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            await ctx.Response.WriteAsJsonAsync(new ErrorResponse("Unbekannte oder abgelaufene jobId."));
            return;
        }

        ctx.Response.Headers.ContentType = "text/event-stream";
        ctx.Response.Headers.CacheControl = "no-cache";
        var ct = ctx.RequestAborted;

        var index = 0;
        try
        {
            await ctx.Response.Body.FlushAsync(ct);
            while (!ct.IsCancellationRequested)
            {
                var (events, done) = job.Read(index);
                foreach (var payload in events)
                    await ctx.Response.WriteAsync($"data: {payload}\n\n", ct);
                if (events.Count > 0)
                    await ctx.Response.Body.FlushAsync(ct);
                index += events.Count;

                if (done && events.Count == 0) break;      // terminal event already sent
                if (done) continue;                         // flush remaining, then break next round

                var changed = await job.WaitForChangeAsync(index, TimeSpan.FromSeconds(10), ct);
                if (!changed)
                {
                    // Comment line = keep-alive; ignored by EventSource parsers.
                    await ctx.Response.WriteAsync(": keep-alive\n\n", ct);
                    await ctx.Response.Body.FlushAsync(ct);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // client went away — fine, the job keeps running
        }
        catch (IOException)
        {
            // broken pipe on client disconnect — same story
        }
    }

    // ------------------------------------------------------------------
    // POST /texture/optimize
    // ------------------------------------------------------------------

    private static IResult HandleTextureOptimize(TextureOptimizeRequest request, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build.TextureOptimize");

        if (string.IsNullOrWhiteSpace(request?.YtdPath))
            return Results.BadRequest(new ErrorResponse("Feld 'ytdPath' fehlt."));
        var ytdPath = request.YtdPath.Trim();
        if (!Path.GetExtension(ytdPath).Equals(".ytd", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new ErrorResponse("Erwartet wird eine .ytd-Datei."));
        if (!File.Exists(ytdPath))
            return Results.BadRequest(new ErrorResponse($"Datei nicht gefunden: {ytdPath}"));

        if (request.MaxDimension is not (>= 16 and <= 8192))
            return Results.BadRequest(new ErrorResponse("Feld 'maxDimension' muss zwischen 16 und 8192 liegen."));

        var format = string.IsNullOrWhiteSpace(request.Format) ? null : request.Format.Trim().ToUpperInvariant();
        if (format is not (null or "BC1" or "BC3" or "BC7" or "RGBA8888"))
            return Results.BadRequest(new ErrorResponse("Feld 'format' muss BC1, BC3, BC7, RGBA8888 oder null sein."));

        try
        {
            var result = TextureOptimizer.Optimize(
                ytdPath, request.OutPath?.Trim(), request.MaxDimension.Value, format,
                request.RegenerateMips ?? true);
            log.LogInformation("Optimized {Path}: {BeforeW}x{BeforeH}/{BeforeBytes}B -> {AfterW}x{AfterH}/{AfterBytes}B",
                ytdPath, result.Before.Width, result.Before.Height, result.Before.SizeBytes,
                result.After.Width, result.After.Height, result.After.SizeBytes);
            return Results.Ok(result);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Texture optimize failed for {Path}", ytdPath);
            return Results.BadRequest(new ErrorResponse($"Textur konnte nicht optimiert werden: {ex.Message}"));
        }
    }

    // ------------------------------------------------------------------
    // POST /texture/from-image  →  200 { sizeBytes } | 400 { error }
    // ------------------------------------------------------------------

    private static IResult HandleTextureFromImage(TextureFromImageRequest request, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build.TextureFromImage");

        if (string.IsNullOrWhiteSpace(request?.ImagePath))
            return Results.BadRequest(new ErrorResponse("Feld 'imagePath' fehlt."));
        var imagePath = request.ImagePath.Trim();
        if (!File.Exists(imagePath))
            return Results.BadRequest(new ErrorResponse($"Datei nicht gefunden: {imagePath}"));

        if (string.IsNullOrWhiteSpace(request.OutPath))
            return Results.BadRequest(new ErrorResponse("Feld 'outPath' fehlt."));
        var outPath = request.OutPath.Trim();
        if (!Path.GetExtension(outPath).Equals(".ytd", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new ErrorResponse("Feld 'outPath' muss auf .ytd enden."));

        if (request.MaxDimension is not (>= 16 and <= 8192))
            return Results.BadRequest(new ErrorResponse("Feld 'maxDimension' muss zwischen 16 und 8192 liegen."));

        var format = request.Format?.Trim().ToUpperInvariant();
        if (format is not ("BC1" or "BC3" or "BC7" or "RGBA8888"))
            return Results.BadRequest(new ErrorResponse("Feld 'format' muss BC1, BC3, BC7 oder RGBA8888 sein."));

        try
        {
            var ytdName = Path.GetFileNameWithoutExtension(outPath);
            var bytes = TattooTextureBuilder.BuildYtd(imagePath, ytdName, request.MaxDimension!.Value, format);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
            File.WriteAllBytes(outPath, bytes);
            log.LogInformation("Converted {Image} -> {Ytd} ({Format}, max {Max}px, {Size} bytes)",
                imagePath, outPath, format, request.MaxDimension, bytes.Length);
            return Results.Ok(new TextureFromImageResponse(bytes.LongLength));
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Image->YTD conversion failed for {Image}", request.ImagePath);
            return Results.BadRequest(new ErrorResponse($"Bild konnte nicht konvertiert werden: {ex.Message}"));
        }
    }

    // ------------------------------------------------------------------
    // POST /debug/ymt — round-trip a generated CPedVariationInfo .ymt
    // ------------------------------------------------------------------

    private static IResult HandleDebugYmt(DebugPathRequest request, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build.DebugYmt");

        if (string.IsNullOrWhiteSpace(request?.Path) || !File.Exists(request.Path.Trim()))
            return Results.BadRequest(new ErrorResponse("Feld 'path' fehlt oder Datei nicht gefunden."));
        var path = request.Path.Trim();

        try
        {
            var data = File.ReadAllBytes(path);
            var entry = RpfFile.CreateResourceFileEntry(ref data, 0);
            entry.Name = Path.GetFileName(path);
            var decompressed = ResourceBuilder.Decompress(data);
            var ped = RpfFile.GetFile<PedFile>(entry, decompressed);
            var info = ped.VariationInfo
                ?? throw new InvalidDataException("Keine CPedVariationInfo in der Datei.");

            var availComp = info.ComponentIndices ?? Array.Empty<byte>();
            var components = new List<object>();
            for (var slot = 0; slot < availComp.Length; slot++)
            {
                if (availComp[slot] == 255) continue;
                var componentData = availComp[slot] < (info.ComponentData3?.Length ?? 0)
                    ? info.ComponentData3![availComp[slot]]
                    : null;
                components.Add(new
                {
                    slot,
                    numAvailTex = componentData?.numAvailTex ?? 0,
                    drawables = (componentData?.DrawblData3 ?? Array.Empty<MCPVDrawblData>())
                        .Select(d => new
                        {
                            textures = d.TexData?.Length ?? 0,
                            propMask = d.PropMask,
                            numAlternatives = d.NumAlternatives,
                            ownsCloth = d.Data.clothData.ownsCloth,
                        })
                        .ToList(),
                });
            }

            var props = (info.PropInfo?.PropMetaData ?? Array.Empty<MCPedPropMetaData>())
                .Select(p => new
                {
                    anchorId = p.Data.anchorId,
                    propId = p.Data.propId,
                    textures = p.TexData?.Length ?? 0,
                    expressionMod0 = p.Data.expressionMods.f0,
                })
                .ToList();
            var anchors = (info.PropInfo?.Anchors ?? Array.Empty<MCAnchorProps>())
                .Select(a => new { anchor = (int)a.Data.anchor, propTexCounts = a.Props ?? Array.Empty<byte>() })
                .ToList();

            var xml = MetaXml.GetXml(ped.Meta);
            var snippet = xml.Length > 4000 ? xml[..4000] + "\n…" : xml;

            return Results.Ok(new
            {
                dlcNameHash = (uint)info.Data.dlcName,
                compInfoCount = info.CompInfos?.Length ?? 0,
                availComp,
                components,
                numAvailProps = info.PropInfo?.Data.numAvailProps ?? 0,
                props,
                anchors,
                xmlSnippet = snippet,
            });
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Debug ymt parse failed for {Path}", path);
            return Results.BadRequest(new ErrorResponse($"YMT konnte nicht geparst werden: {ex.Message}"));
        }
    }

    // ------------------------------------------------------------------
    // POST /debug/rpf — list all entries of a generated dlc.rpf
    // ------------------------------------------------------------------

    private static IResult HandleDebugRpf(DebugPathRequest request, ILoggerFactory loggerFactory)
    {
        var log = loggerFactory.CreateLogger("Atelier.Build.DebugRpf");

        if (string.IsNullOrWhiteSpace(request?.Path) || !File.Exists(request.Path.Trim()))
            return Results.BadRequest(new ErrorResponse("Feld 'path' fehlt oder Datei nicht gefunden."));
        var path = request.Path.Trim();

        try
        {
            var rpf = new RpfFile(path, Path.GetFileName(path));
            var errors = new List<string>();
            rpf.ScanStructure(null, message => errors.Add(message));

            var entries = new List<string>();
            CollectEntries(rpf, entries);

            return Results.Ok(new { entries, errors });
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Debug rpf scan failed for {Path}", path);
            return Results.BadRequest(new ErrorResponse($"RPF konnte nicht gelesen werden: {ex.Message}"));
        }
    }

    private static void CollectEntries(RpfFile rpf, List<string> entries)
    {
        foreach (var entry in rpf.AllEntries ?? Enumerable.Empty<RpfEntry>())
        {
            if (entry is RpfFileEntry file)
                entries.Add($"{file.Path} ({file.FileSize} B)");
        }
        foreach (var child in rpf.Children ?? Enumerable.Empty<RpfFile>())
            CollectEntries(child, entries);
    }

    // ------------------------------------------------------------------

    /// <summary>Shared projectDir/project input validation; null = ok.</summary>
    private static IResult? ValidateProjectInput(string? projectDir, AtelierProjectDto? project)
    {
        if (string.IsNullOrWhiteSpace(projectDir))
            return Results.BadRequest(new ErrorResponse("Feld 'projectDir' fehlt."));
        if (!Directory.Exists(projectDir.Trim()))
            return Results.BadRequest(new ErrorResponse($"Projektordner nicht gefunden: {projectDir}"));
        if (project == null)
            return Results.BadRequest(new ErrorResponse("Feld 'project' fehlt."));
        if (project.Fgcloth is not (1 or 2))
            return Results.BadRequest(new ErrorResponse(
                $"Nicht unterstützte Projektversion (fgcloth={project.Fgcloth}, erwartet 1 oder 2)."));
        return null;
    }
}
