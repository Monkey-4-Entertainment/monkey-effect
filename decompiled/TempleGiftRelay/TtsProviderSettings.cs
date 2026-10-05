using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace TempleGiftRelay;

internal static class TtsProviderSettings
{
    private static readonly object Gate = new();
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static readonly string KeyPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Monkeyeffect", "tts-paxa-key.dat");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Monkeyeffect.TTS.Paxa.v1");

    internal static string ReadKey()
    {
        lock (Gate)
        {
            try
            {
                if (!File.Exists(KeyPath)) return "";
                byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(KeyPath), Entropy, DataProtectionScope.CurrentUser);
                try { return Encoding.UTF8.GetString(plain); }
                finally { CryptographicOperations.ZeroMemory(plain); }
            }
            catch { return ""; }
        }
    }

    private static void SaveKey(string key)
    {
        lock (Gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(KeyPath)!);
            if (key.Length == 0) { if (File.Exists(KeyPath)) File.Delete(KeyPath); return; }
            byte[] plain = Encoding.UTF8.GetBytes(key);
            try
            {
                byte[] encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(KeyPath + ".new", encrypted);
                File.Move(KeyPath + ".new", KeyPath, overwrite: true);
            }
            finally { CryptographicOperations.ZeroMemory(plain); }
        }
    }

    internal static bool IsSameOrigin(HttpRequest request)
    {
        string origin = request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin)) return true;
        return Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            && uri.Scheme == "http" && uri.Port == 3847
            && (uri.Host == "127.0.0.1" || uri.Host == "localhost");
    }

    internal static void MapEndpoints(WebApplication app)
    {
        app.MapGet("/api/tts/providers", () => Results.Json(new { ok = true, paxaConfigured = ReadKey().Length > 0 }));
        app.MapPost("/api/tts/provider-key", async (HttpRequest request, CancellationToken ct) =>
        {
            if (!IsSameOrigin(request)) return Results.Json(new { error = "Origin not allowed" }, statusCode: 403);
            if (request.ContentLength is null or > 4096 || !request.HasJsonContentType())
                return Results.Json(new { error = "Invalid settings request" }, statusCode: 400);
            using var body = await JsonDocument.ParseAsync(request.Body, cancellationToken: ct);
            string key = body.RootElement.TryGetProperty("apiKey", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim() : "";
            if (key.Length == 0) { SaveKey(""); return Results.Json(new { ok = true, paxaConfigured = false }); }
            if (key.Length > 512 || !key.StartsWith("pxa_", StringComparison.Ordinal) || key.Contains('\r') || key.Contains('\n'))
                return Results.Json(new { error = "API key ของ Paxa ต้องขึ้นต้นด้วย pxa_" }, statusCode: 400);
            try
            {
                using var check = new HttpRequestMessage(HttpMethod.Get, "https://api.paxalabs.com/v1/account");
                check.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                using var response = await Client.SendAsync(check, ct);
                if (!response.IsSuccessStatusCode)
                    return Results.Json(new { error = "ตรวจสอบ API key ไม่ผ่าน กรุณาตรวจคีย์และบัญชี Paxa" }, statusCode: 400);
                SaveKey(key);
                return Results.Json(new { ok = true, paxaConfigured = true });
            }
            catch (OperationCanceledException) { return Results.Json(new { error = "Paxa ตอบช้า กรุณาลองบันทึกอีกครั้ง" }, statusCode: 504); }
            catch { return Results.Json(new { error = "เชื่อมต่อ Paxa ไม่สำเร็จ คีย์เดิมยังอยู่" }, statusCode: 502); }
        });
        app.MapPost("/api/tts/preview", async (HttpRequest request, CancellationToken ct) =>
        {
            if (!IsSameOrigin(request)) return Results.Json(new { error = "Origin not allowed" }, statusCode: 403);
            using var ms = new MemoryStream();
            await request.Body.CopyToAsync(ms, ct);
            using var upstream = await TtsProcessHost.ForwardAsync(HttpMethod.Post, "/preview", ms.ToArray(), "application/json", ct);
            return Results.Content(await upstream.Content.ReadAsStringAsync(ct), "application/json", statusCode: (int)upstream.StatusCode);
        });
    }
}
