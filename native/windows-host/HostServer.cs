using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

public static class HostServer
{
    public const int Port = 49175;
    public const string Origin = "https://localhost:49175";
    public static WebApplication Build(X509Certificate2 certificate)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k => { k.ListenLocalhost(Port, listen => listen.UseHttps(certificate)); k.Limits.MaxRequestBodySize = 2048; });
        var app = builder.Build();var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var assembly = typeof(HostServer).Assembly;
        var resources = assembly.GetManifestResourceNames().Where(n => n.StartsWith("pane/", StringComparison.Ordinal))
            .ToDictionary(n => n[5..].Replace('\\', '/'), n => n, StringComparer.Ordinal);
        if (!resources.ContainsKey("index.html")) throw new InvalidOperationException("편집기 번들이 없습니다. 앱을 다시 설치하세요.");
        app.Use(async (context, next) =>
        {
            if (context.Request.Host.Value != "localhost:" + Port) { context.Response.StatusCode = 403;return; }
            context.Response.Headers.CacheControl = "no-store";context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
            await next(context);
        });
        app.MapGet("/host-session", (HttpContext context) =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (context.Request.Headers["X-OIW-Host"] != "1" || (origin != "" && origin != Origin))
                return Results.StatusCode(403);
            return Results.Json(new { protocol = 1, token, capabilities = new { downloads = true, body = false } });
        });
        var api = app.MapGroup("").AddEndpointFilter(async (invocation, next) =>
        {
            var headers = invocation.HttpContext.Request.Headers;
            if (headers.Origin != Origin || headers.Authorization != "Bearer " + token)
                return Results.StatusCode(403);
            return await next(invocation);
        });
        api.MapPost("/status", () => Results.Json(new { protocol = 1 }));
        api.MapPost("/asset", (Func<HttpContext, Task<IResult>>)Downloads.Asset);
        app.MapGet("/{**path}", (string? path) =>
        {
            path = string.IsNullOrEmpty(path) ? "index.html" : path;
            if (!resources.TryGetValue(path, out var resource)) return Results.NotFound();
            var stream = assembly.GetManifestResourceStream(resource)!;
            if (path == "index.html")
            {
                using var reader = new StreamReader(stream);return Results.Content(reader.ReadToEnd().Replace("<head>", "<head><meta name=\"oiw-windows-host\" content=\"1\">"), "text/html", Encoding.UTF8);
            }
            var mime = Path.GetExtension(path) switch { ".js" => "text/javascript", ".css" => "text/css", ".woff2" => "font/woff2", ".svg" => "image/svg+xml", ".png" => "image/png", _ => "application/octet-stream" };
            return Results.Stream(stream, mime);
        });
        return app;
    }
}
