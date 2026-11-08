using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var options = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
        options.Logging.ClearProviders();
        options.WebHost.ConfigureKestrel(k => { k.Listen(IPAddress.Loopback, 0); k.Limits.MaxRequestBodySize = 2048; });
        var app = options.Build();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var origins = new HashSet<string> { "https://onlyfr.github.io", "https://localhost:3000" };
        var originArg = Array.IndexOf(args, "--allow-origin");
        if (originArg >= 0 && originArg + 1 < args.Length && Uri.TryCreate(args[originArg + 1], UriKind.Absolute, out var local)
            && local.Scheme == "https" && local.Host == "localhost" && local.PathAndQuery == "/") origins.Add(local.GetLeftPart(UriPartial.Authority));
        app.Use(async (context, next) =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (!origins.Contains(origin)) { context.Response.StatusCode = 403; return; }
            context.Response.Headers.AccessControlAllowOrigin = origin;
            context.Response.Headers.Vary = "Origin";
            context.Response.Headers.CacheControl = "no-store";
            if (context.Request.Method == "OPTIONS")
            {
                context.Response.Headers.AccessControlAllowMethods = "POST";
                context.Response.Headers.AccessControlAllowHeaders = "Authorization,Content-Type";
                context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
                context.Response.StatusCode = 204; return;
            }
            if (context.Request.Method != "POST" || context.Request.Headers.Authorization != "Bearer " + token)
            { context.Response.StatusCode = 403; return; }
            await next(context);
        });
        app.MapPost("/status", () => Results.Json(new { protocol = 1 }));
        app.MapPost("/asset", (Func<HttpContext, Task<IResult>>)Downloads.Asset);
        app.StartAsync().GetAwaiter().GetResult();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        var connection = address + "/#" + token;
        var fileArg = Array.IndexOf(args, "--connection-file");
        if (fileArg >= 0 && fileArg + 1 < args.Length)
        {
            // Development harness only. Tokens are never logged or stored by the normal application.
            File.WriteAllText(args[fileArg + 1], JsonSerializer.Serialize(new { connection }));
            var exitArg = Array.IndexOf(args, "--exit-after");
            var seconds = exitArg >= 0 && exitArg + 1 < args.Length && int.TryParse(args[exitArg + 1], out var parsedSeconds)
                ? Math.Clamp(parsedSeconds, 5, 600) : 600;
            using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(seconds));
            app.WaitForShutdownAsync(lifetime.Token).GetAwaiter().GetResult();
        }
        else
        {
            System.Windows.Forms.Application.SetHighDpiMode(HighDpiMode.SystemAware);
            System.Windows.Forms.Application.EnableVisualStyles();
            using var form = new Form { Text = "Word 플러그인 다운로드 도우미", Width = 580, Height = 220, StartPosition = FormStartPosition.CenterScreen };
            var text = new Label { Text = "작업창 → 설정 → 커뮤니티 플러그인에 아래 연결 주소를 붙여넣으세요.\n도우미는 켜져 있는 동안 GitHub 릴리스 파일만 내려받습니다.", Dock = DockStyle.Top, Height = 65, Padding = new Padding(12) };
            var input = new TextBox { Text = connection, ReadOnly = true, Dock = DockStyle.Top, Margin = new Padding(12) };
            var copy = new Button { Text = "연결 주소 복사", Dock = DockStyle.Top, Height = 38 };
            copy.Click += (_, _) => { Clipboard.SetText(connection); copy.Text = "복사됨"; };
            form.Controls.Add(copy); form.Controls.Add(input); form.Controls.Add(text);
            System.Windows.Forms.Application.Run(form);
        }
        app.StopAsync().GetAwaiter().GetResult();
        app.DisposeAsync().AsTask().GetAwaiter().GetResult();
    }

}
