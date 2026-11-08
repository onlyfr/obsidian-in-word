using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

internal static class Program
{
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(25) };
    private static readonly SemaphoreSlim Gate = new(2);
    private static readonly Regex Repo = new(@"^[a-zA-Z0-9][a-zA-Z0-9_.-]*/(?!\.{1,2}$)[a-zA-Z0-9_.-]+$", RegexOptions.CultureInvariant);
    private static Dictionary<string, string>? catalog;
    private static DateTime catalogAt;
    private const string CatalogUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

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
        app.MapPost("/asset", async (HttpContext context) =>
        {
            if (!await Gate.WaitAsync(0)) return Results.Problem("다운로드가 진행 중입니다. 잠시 후 다시 시도하세요.", statusCode: 429);
            try
            {
                var request = await JsonSerializer.DeserializeAsync<AssetRequest>(context.Request.Body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, context.RequestAborted);
                if (request is null || request.Repo is null || !Repo.IsMatch(request.Repo) || request.AssetId < 1 || request.MaxBytes < 1 || request.MaxBytes > 20 * 1024 * 1024)
                    return Results.Problem("잘못된 다운로드 요청입니다.", statusCode: 400);
                var map = await GetCatalog(context.RequestAborted);
                if (request.Id is null || !map.TryGetValue(request.Id, out var repo) || repo != request.Repo)
                    return Results.Problem("공식 목록의 플러그인 출처와 일치하지 않습니다.", statusCode: 400);
                var bytes = await Read($"https://api.github.com/repos/{repo}/releases/assets/{request.AssetId}", request.MaxBytes, true, context.RequestAborted);
                return Results.Bytes(bytes, "application/octet-stream");
            }
            catch (Exception error) when (error is HttpRequestException or IOException or JsonException or OperationCanceledException)
            { return Results.Problem("GitHub 파일을 받지 못했습니다. 네트워크·요청 한도·파일 크기를 확인하고 다시 시도하세요.", statusCode: 502); }
            finally { Gate.Release(); }
        });
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

    private static async Task<Dictionary<string, string>> GetCatalog(CancellationToken cancel)
    {
        if (catalog is not null && DateTime.UtcNow - catalogAt < TimeSpan.FromMinutes(5)) return catalog;
        using var json = JsonDocument.Parse(await Read(CatalogUrl, 8 * 1024 * 1024, false, cancel));
        var result = new Dictionary<string, string>();
        foreach (var item in json.RootElement.EnumerateArray()) result.Add(item.GetProperty("id").GetString()!, item.GetProperty("repo").GetString()!);
        catalog = result; catalogAt = DateTime.UtcNow; return result;
    }

    private static async Task<byte[]> Read(string address, int max, bool asset, CancellationToken cancel)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        deadline.CancelAfter(TimeSpan.FromSeconds(25));
        var uri = new Uri(address);
        for (var hop = 0; hop < 5; hop++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd("obsidian-in-word-plugin-downloader/1");
            request.Headers.Accept.ParseAdd(asset ? "application/octet-stream" : "application/json");
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is >= 300 and < 400)
            {
                var target = response.Headers.Location ?? throw new HttpRequestException("Missing redirect");
                if (!target.IsAbsoluteUri) target = new Uri(uri, target);
                if (target.Scheme != "https" || target.Port != 443 || target.UserInfo != "" ||
                    target.Host is not ("release-assets.githubusercontent.com" or "objects.githubusercontent.com")) throw new HttpRequestException("Unsupported redirect");
                uri = target; continue;
            }
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > max) throw new IOException("File too large");
            using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            using var output = new MemoryStream();var buffer = new byte[32768];
            for (;;)
            {
                var count = await stream.ReadAsync(buffer, deadline.Token);if (count == 0) break;
                if (output.Length + count > max) throw new IOException("File too large");
                output.Write(buffer, 0, count);
            }
            return output.ToArray();
        }
        throw new HttpRequestException("Too many redirects");
    }
    private sealed record AssetRequest(string? Id, string? Repo, long AssetId, int MaxBytes);
}
