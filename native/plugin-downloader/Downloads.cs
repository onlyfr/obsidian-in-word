using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

internal static class Downloads
{
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(25) };
    private static readonly SemaphoreSlim Gate = new(2);
    private static Dictionary<string, string>? catalog;
    private static DateTime catalogAt;
    internal sealed record AssetRequest(string? Id, string? Repo, long AssetId, int MaxBytes);
    internal static async Task<IResult> Asset(HttpContext context)
    {
        if (!await Gate.WaitAsync(0)) return Results.Problem("다운로드가 진행 중입니다.", statusCode: 429);
        try
        {
            var request = await JsonSerializer.DeserializeAsync<AssetRequest>(context.Request.Body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, context.RequestAborted);
            if (request is null || request.Repo is null || !Regex.IsMatch(request.Repo, @"^[a-zA-Z0-9][a-zA-Z0-9_.-]*/(?!\.{1,2}$)[a-zA-Z0-9_.-]+$") || request.AssetId < 1 || request.MaxBytes < 1 || request.MaxBytes > 20 * 1024 * 1024)
                return Results.Problem("잘못된 다운로드 요청입니다.", statusCode: 400);
            if (catalog is null || DateTime.UtcNow - catalogAt > TimeSpan.FromMinutes(5))
            {
                using var json = JsonDocument.Parse(await Read("https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json", 8 * 1024 * 1024, false, context.RequestAborted));
                var entries = new Dictionary<string, string>();
                foreach (var item in json.RootElement.EnumerateArray()) entries.Add(item.GetProperty("id").GetString()!, item.GetProperty("repo").GetString()!);
                catalog = entries; catalogAt = DateTime.UtcNow;
            }
            if (request.Id is null || !catalog.TryGetValue(request.Id, out var repo) || repo != request.Repo)
                return Results.Problem("공식 목록의 플러그인 출처와 일치하지 않습니다.", statusCode: 400);
            return Results.Bytes(await Read($"https://api.github.com/repos/{repo}/releases/assets/{request.AssetId}", request.MaxBytes, true, context.RequestAborted), "application/octet-stream");
        }
        catch (Exception error) when (error is HttpRequestException or IOException or JsonException or OperationCanceledException)
        { return Results.Problem("GitHub 파일을 받지 못했습니다. 네트워크·요청 한도·파일 크기를 확인하세요.", statusCode: 502); }
        finally { Gate.Release(); }
    }
    private static async Task<byte[]> Read(string address, int max, bool asset, CancellationToken cancel)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancel);deadline.CancelAfter(TimeSpan.FromSeconds(25));
        var uri = new Uri(address);
        for (var hop = 0; hop < 5; hop++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd("obsidian-in-word/1");request.Headers.Accept.ParseAdd(asset ? "application/octet-stream" : "application/json");
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is >= 300 and < 400)
            {
                var target = response.Headers.Location ?? throw new HttpRequestException("Missing redirect");if (!target.IsAbsoluteUri) target = new Uri(uri, target);
                if (target.Scheme != "https" || target.Port != 443 || target.UserInfo != "" || target.Host is not ("release-assets.githubusercontent.com" or "objects.githubusercontent.com")) throw new HttpRequestException("Unsupported redirect");
                uri = target;continue;
            }
            response.EnsureSuccessStatusCode();if (response.Content.Headers.ContentLength > max) throw new IOException("File too large");
            using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);using var output = new MemoryStream();var buffer = new byte[32768];
            for (;;){var count = await stream.ReadAsync(buffer, deadline.Token);if (count == 0) break;if (output.Length + count > max) throw new IOException("File too large");output.Write(buffer, 0, count);}
            return output.ToArray();
        }
        throw new HttpRequestException("Too many redirects");
    }
}
