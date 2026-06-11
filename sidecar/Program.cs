using System.Diagnostics;
using System.Net;
using Feelgood.Atelier.Sidecar;
using Feelgood.Atelier.Sidecar.Api;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var builder = WebApplication.CreateBuilder(args);

// stdout is reserved for the single FG_SIDECAR_READY handshake line that the
// Tauri host parses; route ALL console logging to stderr instead.
builder.Logging.ClearProviders();
builder.Logging.AddConsole(options => options.LogToStandardErrorThreshold = LogLevel.Trace);

// Default: ephemeral loopback port (port 0, resolved after startup).
// FG_SIDECAR_DEV_PORT pins a fixed port for manual development.
var port = 0;
var devPortRaw = Environment.GetEnvironmentVariable("FG_SIDECAR_DEV_PORT");
if (!string.IsNullOrWhiteSpace(devPortRaw))
{
    if (int.TryParse(devPortRaw, out var devPort) && devPort is > 0 and < 65536)
        port = devPort;
    else
        Console.Error.WriteLine($"warn: ignoring invalid FG_SIDECAR_DEV_PORT '{devPortRaw}'");
}

// Fail closed: without a token, any local website could hit the loopback
// port cross-origin (CORS is wide open by design). Tauri always sets the
// token; tokenless runs are only allowed as EXPLICIT dev mode (fixed port).
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("FG_SIDECAR_TOKEN")) && port == 0)
{
    Console.Error.WriteLine(
        "error: FG_SIDECAR_TOKEN is not set. Refusing to start without auth — " +
        "set FG_SIDECAR_TOKEN, or set FG_SIDECAR_DEV_PORT for an explicit (tokenless) dev run.");
    Environment.Exit(1);
}

// Die with the host: when the Tauri app is force-killed or crashes, its
// RunEvent::Exit cleanup never runs and an orphaned sidecar keeps
// target/debug/fg-atelier-sidecar.exe locked — breaking the next `tauri dev`
// build (tauri-build cannot overwrite the binary). The host passes its PID.
var parentPidRaw = Environment.GetEnvironmentVariable("FG_SIDECAR_PARENT_PID");
if (int.TryParse(parentPidRaw, out var parentPid) && parentPid > 0)
{
    try
    {
        var parent = Process.GetProcessById(parentPid);
        parent.EnableRaisingEvents = true;
        parent.Exited += (_, _) =>
        {
            Console.Error.WriteLine("info: host process exited — shutting down sidecar");
            Environment.Exit(0);
        };
        if (parent.HasExited) Environment.Exit(0);
    }
    catch (ArgumentException)
    {
        Console.Error.WriteLine("info: host process already gone — shutting down sidecar");
        Environment.Exit(0);
    }
}

builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, port));

builder.Services.AddSingleton<AppState>();
// Singleton: holds the lazily initialized (expensive) CodeWalker GameFileCache.
builder.Services.AddSingleton<Feelgood.Atelier.Sidecar.Engine.PedBodyService>();
// Singleton: per-(ped, pose) baked skinning matrices for posed previews.
builder.Services.AddSingleton<Feelgood.Atelier.Sidecar.Engine.Pose.PoseEngine>();
// Singleton: in-memory build job registry (one running build per process).
builder.Services.AddSingleton<BuildJobStore>();
builder.Services.AddCors();

var app = builder.Build();

// The Tauri webview calls us cross-origin (http://localhost:1420 in dev,
// tauri://localhost in prod). Without CORS headers WebView2 blocks every
// response and the app shows the sidecar as unreachable. Loopback-only
// binding + the shared token are the actual access control; CORS origin
// restrictions add nothing here.
app.UseCors(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()
    // Custom response headers (preview mesh stats) must be exposed explicitly
    // or the webview's fetch() cannot read them.
    .WithExposedHeaders("X-FG-Vertex-Count", "X-FG-Poly-Count"));

app.UseMiddleware<TokenAuthMiddleware>();

app.MapHealthEndpoints();
app.MapConfigEndpoints();
app.MapParseEndpoints();
app.MapImportEndpoints();
app.MapPreviewEndpoints();
app.MapBuildEndpoints();

app.Lifetime.ApplicationStarted.Register(() =>
{
    var addresses = app.Services.GetRequiredService<IServer>()
        .Features.Get<IServerAddressesFeature>()?.Addresses;
    var boundPort = addresses?
        .Select(address => Uri.TryCreate(address, UriKind.Absolute, out var uri) ? uri.Port : 0)
        .FirstOrDefault(p => p > 0) ?? 0;

    // EXACTLY one stdout line - the host parses this to discover the port.
    Console.Out.WriteLine($"FG_SIDECAR_READY port={boundPort}");
    Console.Out.Flush();

    app.Logger.LogInformation("atelier sidecar v{Version} listening on 127.0.0.1:{Port}",
        HealthEndpoints.Version, boundPort);
});

app.Run();
