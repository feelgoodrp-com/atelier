namespace Feelgood.Atelier.Sidecar.Api;

/// <summary>
/// Shared-token auth. Every endpoint except GET /health requires the header
/// <c>x-fg-atelier-token</c> to match the FG_SIDECAR_TOKEN environment variable.
/// If the env var is unset (manual dev runs), the check is skipped with a warning.
/// Pattern adapted from the Feelgood rage-sidecar (x-fg-rage-token).
/// </summary>
public sealed class TokenAuthMiddleware
{
    public const string HeaderName = "x-fg-atelier-token";
    public const string TokenEnvVar = "FG_SIDECAR_TOKEN";

    private readonly RequestDelegate _next;
    private readonly ILogger<TokenAuthMiddleware> _log;
    private readonly string? _token;
    private int _devWarningLogged;

    public TokenAuthMiddleware(RequestDelegate next, ILogger<TokenAuthMiddleware> log)
    {
        _next = next;
        _log = log;
        _token = Environment.GetEnvironmentVariable(TokenEnvVar);
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        if (ctx.Request.Path.Equals("/health", StringComparison.OrdinalIgnoreCase))
        {
            await _next(ctx);
            return;
        }

        if (string.IsNullOrEmpty(_token))
        {
            if (Interlocked.Exchange(ref _devWarningLogged, 1) == 0)
            {
                _log.LogWarning(
                    "{EnvVar} is not set - token check disabled. Only acceptable for manual dev runs.",
                    TokenEnvVar);
            }
            await _next(ctx);
            return;
        }

        if (!ctx.Request.Headers.TryGetValue(HeaderName, out var sent) ||
            !string.Equals(sent.ToString(), _token, StringComparison.Ordinal))
        {
            _log.LogWarning("Rejected {Method} {Path}: missing or invalid {Header}",
                ctx.Request.Method, ctx.Request.Path, HeaderName);
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await ctx.Response.WriteAsJsonAsync(new ErrorResponse("unauthorized"));
            return;
        }

        await _next(ctx);
    }
}
