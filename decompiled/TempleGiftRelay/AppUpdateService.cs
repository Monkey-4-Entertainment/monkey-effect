using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace TempleGiftRelay;

public sealed class UpdateManifest
{
	[JsonPropertyName("version")]
	public string Version { get; set; } = "";

	[JsonPropertyName("notes")]
	public string? Notes { get; set; }

	[JsonPropertyName("zipUrl")]
	public string ZipUrl { get; set; } = "";

	[JsonPropertyName("sha256")]
	public string? Sha256 { get; set; }

	[JsonPropertyName("mandatory")]
	public bool Mandatory { get; set; }
}

public sealed class UpdateConfig
{
	[JsonPropertyName("feedUrl")]
	public string FeedUrl { get; set; } = "";

	[JsonPropertyName("autoCheck")]
	public bool AutoCheck { get; set; } = true;
}

public static class AppVersion
{
	public const string Current = "1.0.7.7";

	public const string DefaultFeedUrl =
		"https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json";

	public static string VersionFilePath => Path.Combine(AppPaths.AppDir, "wwwroot", "version.json");

	public static string ReadInstalledVersion()
	{
		try
		{
			string path = VersionFilePath;
			if (File.Exists(path))
			{
				using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(path));
				if (doc.RootElement.TryGetProperty("version", out JsonElement v))
				{
					string? s = v.GetString();
					if (!string.IsNullOrWhiteSpace(s)) return s.Trim().TrimStart('v', 'V');
				}
			}
		}
		catch
		{
		}
		return Current;
	}

	public static int Compare(string a, string b)
	{
		static int[] Parts(string s)
		{
			string clean = (s ?? "").Trim().TrimStart('v', 'V');
			string[] bits = clean.Split('.', StringSplitOptions.RemoveEmptyEntries);
			int[] n = new int[Math.Max(3, bits.Length)];
			for (int i = 0; i < bits.Length; i++)
			{
				int.TryParse(bits[i], out n[i]);
			}
			return n;
		}
		int[] pa = Parts(a);
		int[] pb = Parts(b);
		int len = Math.Max(pa.Length, pb.Length);
		for (int i = 0; i < len; i++)
		{
			int x = i < pa.Length ? pa[i] : 0;
			int y = i < pb.Length ? pb[i] : 0;
			if (x != y) return x.CompareTo(y);
		}
		return 0;
	}
}

public static class AppUpdateService
{
	private static readonly HttpClient Http = CreateHttp();

	private static HttpClient CreateHttp()
	{
		var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
		http.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue
		{
			NoCache = true,
			NoStore = true
		};
		http.DefaultRequestHeaders.Pragma.ParseAdd("no-cache");
		return http;
	}

	private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
	{
		PropertyNameCaseInsensitive = true,
		WriteIndented = true
	};

	public static string ConfigPath => Path.Combine(
		Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
		"Monkeyeffect",
		"update-config.json");

	public static string PendingDir => Path.Combine(
		Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
		"Monkeyeffect",
		"pending-update");

	public static string ResolveDefaultFeedUrl()
	{
		try
		{
			string bundled = Path.Combine(AppPaths.AppDir, "wwwroot", "update-feed.url");
			if (File.Exists(bundled))
			{
				foreach (string line in File.ReadAllLines(bundled))
				{
					string url = line.Trim();
					if (string.IsNullOrWhiteSpace(url) || url.StartsWith("#")) continue;
					return url;
				}
			}
		}
		catch
		{
		}
		return AppVersion.DefaultFeedUrl;
	}

	public static UpdateConfig LoadConfig()
	{
		UpdateConfig cfg = new UpdateConfig { FeedUrl = "", AutoCheck = true };
		try
		{
			if (File.Exists(ConfigPath))
			{
				UpdateConfig? parsed = JsonSerializer.Deserialize<UpdateConfig>(File.ReadAllText(ConfigPath), JsonOpts);
				if (parsed != null) cfg = parsed;
			}
		}
		catch
		{
		}
		if (string.IsNullOrWhiteSpace(cfg.FeedUrl))
		{
			cfg.FeedUrl = ResolveDefaultFeedUrl();
			try { SaveConfig(cfg); } catch { /* ignore */ }
		}
		return cfg;
	}

	public static void SaveConfig(UpdateConfig cfg)
	{
		if (cfg == null) throw new ArgumentNullException(nameof(cfg));
		if (string.IsNullOrWhiteSpace(cfg.FeedUrl))
		{
			cfg.FeedUrl = ResolveDefaultFeedUrl();
		}
		Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
		File.WriteAllText(ConfigPath, JsonSerializer.Serialize(cfg, JsonOpts));
	}

	public static async Task<(bool ok, string message, UpdateManifest? manifest)> CheckAsync(CancellationToken ct = default)
	{
		UpdateConfig cfg = LoadConfig();
		if (string.IsNullOrWhiteSpace(cfg.FeedUrl))
		{
			return (false, "ยังไม่ได้ตั้งค่า URL ไฟล์อัปเดต (feed) — ใส่ในแท็บเชื่อมต่อ", null);
		}

		// ดึงหลายแหล่งแล้วเลือกเวอร์ชันสูงสุด — raw.githubusercontent.com แคชค้างบ่อยมาก
		UpdateManifest? best = null;
		string? lastError = null;
		foreach (var candidate in ExpandFeedCandidates(cfg.FeedUrl.Trim()))
		{
			try
			{
				string? json = await FetchFeedJsonAsync(candidate.Url, candidate.GitHubRawAccept, ct);
				if (string.IsNullOrWhiteSpace(json)) continue;
				UpdateManifest? man = JsonSerializer.Deserialize<UpdateManifest>(json, JsonOpts);
				if (man == null || string.IsNullOrWhiteSpace(man.Version) || string.IsNullOrWhiteSpace(man.ZipUrl))
				{
					continue;
				}
				if (best == null || AppVersion.Compare(man.Version, best.Version) > 0)
				{
					best = man;
				}
			}
			catch (Exception ex)
			{
				lastError = ex.Message;
			}
		}

		if (best == null)
		{
			if (!string.IsNullOrWhiteSpace(lastError))
			{
				return (false, "เช็คอัปเดตไม่สำเร็จ: " + lastError, null);
			}
			return (false,
				"หาไฟล์อัปเดตไม่เจอ — ตรวจ URL feed / repo Public / อัปโหลด update/latest.json",
				null);
		}

		string current = AppVersion.ReadInstalledVersion();
		if (AppVersion.Compare(best.Version, current) <= 0)
		{
			return (true, $"เป็นเวอร์ชันล่าสุดแล้ว (v{current})", best);
		}

		return (true, $"มีอัปเดตใหม่ v{best.Version} (ตอนนี้ v{current})", best);
	}

	private readonly record struct FeedCandidate(string Url, bool GitHubRawAccept);

	private static IEnumerable<FeedCandidate> ExpandFeedCandidates(string feedUrl)
	{
		yield return new FeedCandidate(AppendCacheBust(feedUrl), false);

		if (!TryParseGithubRawFeed(feedUrl, out string owner, out string repo, out string branch, out string path))
		{
			yield break;
		}

		// GitHub Contents API — ไม่โดน raw CDN แคชค้าง
		yield return new FeedCandidate(
			$"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={Uri.EscapeDataString(branch)}",
			true);

		// Mirror ที่อัปเดตเร็วกว่า raw.githubusercontent.com
		yield return new FeedCandidate(
			AppendCacheBust($"https://raw.githack.com/{owner}/{repo}/{branch}/{path}"),
			false);
		yield return new FeedCandidate(
			AppendCacheBust($"https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}"),
			false);
	}

	private static bool TryParseGithubRawFeed(string feedUrl, out string owner, out string repo, out string branch, out string path)
	{
		owner = repo = branch = path = "";
		if (!Uri.TryCreate(feedUrl, UriKind.Absolute, out Uri? uri)) return false;
		string host = uri.Host;
		string[] segs = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
		// raw.githubusercontent.com/{owner}/{repo}/{branch}/update/latest.json
		if (host.Equals("raw.githubusercontent.com", StringComparison.OrdinalIgnoreCase) && segs.Length >= 4)
		{
			owner = segs[0];
			repo = segs[1];
			branch = segs[2];
			path = string.Join('/', segs.Skip(3));
			return true;
		}
		// raw.githack.com / rawcdn.githack.com/{owner}/{repo}/{branch}/...
		if ((host.Equals("raw.githack.com", StringComparison.OrdinalIgnoreCase) ||
		     host.Equals("rawcdn.githack.com", StringComparison.OrdinalIgnoreCase)) &&
		    segs.Length >= 4)
		{
			owner = segs[0];
			repo = segs[1];
			branch = segs[2];
			path = string.Join('/', segs.Skip(3));
			return true;
		}
		return false;
	}

	private static async Task<string?> FetchFeedJsonAsync(string url, bool githubRawAccept, CancellationToken ct)
	{
		using var req = new HttpRequestMessage(HttpMethod.Get, url);
		req.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true, NoStore = true };
		req.Headers.Pragma.ParseAdd("no-cache");
		req.Headers.UserAgent.ParseAdd("Monkeyeffect-Update");
		if (githubRawAccept)
		{
			req.Headers.Accept.Clear();
			req.Headers.Accept.ParseAdd("application/vnd.github.raw");
		}
		using HttpResponseMessage res = await Http.SendAsync(req, ct);
		if (!res.IsSuccessStatusCode) return null;
		string body = await res.Content.ReadAsStringAsync(ct);
		return string.IsNullOrWhiteSpace(body) ? null : body;
	}

	private static string AppendCacheBust(string url)
	{
		if (string.IsNullOrWhiteSpace(url)) return url;
		string sep = url.Contains('?', StringComparison.Ordinal) ? "&" : "?";
		return url + sep + "t=" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
	}

	public static async Task<(bool ok, string message)> DownloadAndStageAsync(UpdateManifest man, IProgress<string>? progress = null, CancellationToken ct = default)
	{
		if (string.IsNullOrWhiteSpace(man.ZipUrl))
		{
			return (false, "ไม่มี zipUrl ในไฟล์อัปเดต");
		}

		progress?.Report("กำลังดาวน์โหลดแพ็กอัปเดต...");
		string zipPath = Path.Combine(Path.GetTempPath(), "monkeyeffect-update-" + Guid.NewGuid().ToString("N") + ".zip");
		string? lastDlError = null;
		bool downloaded = false;
		foreach (string url in ExpandZipCandidates(man.ZipUrl.Trim()))
		{
			try
			{
				await DownloadToFileAsync(url, zipPath, ct);
				if (new FileInfo(zipPath).Length < 64) throw new IOException("ไฟล์ที่ดาวน์โหลดว่าง/เล็กผิดปกติ");
				// ZIP local header magic PK\x03\x04
				await using (FileStream fs = File.OpenRead(zipPath))
				{
					byte[] magic = new byte[4];
					int n = await fs.ReadAsync(magic.AsMemory(0, 4), ct);
					if (n < 4 || magic[0] != (byte)'P' || magic[1] != (byte)'K')
					{
						throw new InvalidDataException("ไม่ได้ไฟล์ ZIP (อาจเป็นหน้า error จาก CDN)");
					}
				}
				downloaded = true;
				break;
			}
			catch (Exception ex)
			{
				lastDlError = ex.Message;
				try { if (File.Exists(zipPath)) File.Delete(zipPath); } catch { }
			}
		}
		if (!downloaded)
		{
			return (false, "ดาวน์โหลดไม่สำเร็จ: " + (lastDlError ?? "unknown"));
		}

		if (!string.IsNullOrWhiteSpace(man.Sha256))
		{
			await using FileStream fs = File.OpenRead(zipPath);
			byte[] hashBytes = await SHA256.HashDataAsync(fs, ct);
			string hash = Convert.ToHexString(hashBytes).ToLowerInvariant();
			string expect = man.Sha256.Trim().ToLowerInvariant().Replace("-", "");
			if (!hash.Equals(expect, StringComparison.OrdinalIgnoreCase))
			{
				try { File.Delete(zipPath); } catch { }
				return (false, "ไฟล์อัปเดตเสียหาย (sha256 ไม่ตรง) — ลองใหม่หรือใช้ Setup");
			}
		}

		progress?.Report("กำลังแตกไฟล์อัปเดต...");
		try
		{
			if (Directory.Exists(PendingDir))
			{
				Directory.Delete(PendingDir, true);
			}
			Directory.CreateDirectory(PendingDir);
			try
			{
				SafeExtractZip(zipPath, PendingDir);
			}
			finally
			{
				try { File.Delete(zipPath); } catch { }
			}

			// Accept either flat zip or zip with a single root folder
			string[] top = Directory.GetDirectories(PendingDir);
			string[] topFiles = Directory.GetFiles(PendingDir);
			if (topFiles.Length == 0 && top.Length == 1)
			{
				string inner = top[0];
				foreach (string f in Directory.GetFiles(inner, "*", SearchOption.AllDirectories))
				{
					string rel = Path.GetRelativePath(inner, f);
					string dest = Path.Combine(PendingDir, rel);
					Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
					File.Copy(f, dest, overwrite: true);
				}
				try { Directory.Delete(inner, true); } catch { }
			}

			if (!File.Exists(Path.Combine(PendingDir, "TempleGiftRelay.dll")) &&
			    !Directory.Exists(Path.Combine(PendingDir, "wwwroot")))
			{
				return (false, "แพ็กอัปเดตไม่ครบ (ไม่มี TempleGiftRelay.dll / wwwroot)");
			}

			File.WriteAllText(Path.Combine(PendingDir, "UPDATE_VERSION.txt"), man.Version.Trim().TrimStart('v', 'V'));
		}
		catch (Exception ex)
		{
			return (false, "แตกไฟล์อัปเดตไม่สำเร็จ: " + ex.Message);
		}

		return (true, "ดาวน์โหลดพร้อมติดตั้งแล้ว");
	}

	private static async Task DownloadToFileAsync(string url, string destPath, CancellationToken ct)
	{
		using var req = new HttpRequestMessage(HttpMethod.Get, url);
		req.Headers.UserAgent.ParseAdd("Monkeyeffect-Update");
		req.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true, NoStore = true };
		using HttpResponseMessage res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
		res.EnsureSuccessStatusCode();
		await using Stream src = await res.Content.ReadAsStreamAsync(ct);
		await using FileStream dst = File.Create(destPath);
		await src.CopyToAsync(dst, ct);
	}

	private static IEnumerable<string> ExpandZipCandidates(string zipUrl)
	{
		yield return AppendCacheBust(zipUrl);
		if (!TryParseGithubRawFeed(zipUrl, out string owner, out string repo, out string branch, out string path))
		{
			yield break;
		}
		// jsDelivr / githack often succeed when raw.githubusercontent.com stalls on large zips
		yield return AppendCacheBust($"https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}");
		yield return AppendCacheBust($"https://raw.githack.com/{owner}/{repo}/{branch}/{path}");
		yield return $"https://media.githubusercontent.com/media/{owner}/{repo}/{branch}/{path}";
	}

	private static void SafeExtractZip(string zipPath, string destDir)
	{
		using ZipArchive zip = ZipFile.OpenRead(zipPath);
		foreach (ZipArchiveEntry entry in zip.Entries)
		{
			string name = (entry.FullName ?? "").Replace('\\', '/').TrimStart('/');
			if (string.IsNullOrWhiteSpace(name)) continue;
			// Skip installer/build helpers that used to ship by mistake and break extract on some PCs
			string lower = name.ToLowerInvariant();
			if (lower.Contains("innosetup") || lower.EndsWith(".pdb", StringComparison.Ordinal)) continue;
			if (name.EndsWith('/'))
			{
				Directory.CreateDirectory(Path.Combine(destDir, name.Replace('/', Path.DirectorySeparatorChar)));
				continue;
			}
			if (entry.Length == 0 && string.IsNullOrEmpty(entry.Name)) continue;

			string dest = Path.GetFullPath(Path.Combine(destDir, name.Replace('/', Path.DirectorySeparatorChar)));
			string root = Path.GetFullPath(destDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
			if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase))
			{
				throw new InvalidDataException("zip path escape: " + name);
			}
			Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
			entry.ExtractToFile(dest, overwrite: true);
		}
	}

	public static (bool ok, string message) LaunchApplyAndExit()
	{
		if (!Directory.Exists(PendingDir) || Directory.GetFileSystemEntries(PendingDir).Length == 0)
		{
			return (false, "ยังไม่มีแพ็กอัปเดตที่ดาวน์โหลดไว้");
		}

		string installDir = AppPaths.AppDir;
		string bat = Path.Combine(Path.GetTempPath(), "monkeyeffect-apply-update.cmd");
		string log = Path.Combine(
			Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
			"Monkeyeffect",
			"update.log");

		var sb = new StringBuilder();
		sb.AppendLine("@echo off");
		sb.AppendLine("chcp 65001 >nul");
		sb.AppendLine("setlocal");
		sb.AppendLine($"set \"INSTALL={installDir}\"");
		sb.AppendLine($"set \"PENDING={PendingDir}\"");
		sb.AppendLine($"set \"LOG={log}\"");
		sb.AppendLine("echo [%date% %time%] apply-update start>>\"%LOG%\"");
		sb.AppendLine("timeout /t 2 /nobreak >nul");
		sb.AppendLine("taskkill /F /IM TempleGiftRelay.exe >nul 2>&1");
		sb.AppendLine("timeout /t 1 /nobreak >nul");
		sb.AppendLine("robocopy \"%PENDING%\" \"%INSTALL%\" /E /IS /IT /NFL /NDL /NJH /NJS /nc /ns /np >nul");
		sb.AppendLine("set RC=%ERRORLEVEL%");
		sb.AppendLine("echo [%date% %time%] robocopy rc=%RC%>>\"%LOG%\"");
		sb.AppendLine("if exist \"%PENDING%\\UPDATE_VERSION.txt\" del \"%INSTALL%\\UPDATE_VERSION.txt\" >nul 2>&1");
		sb.AppendLine("rmdir /S /Q \"%PENDING%\" >nul 2>&1");
		sb.AppendLine("if exist \"%INSTALL%\\Monkeyeffect.bat\" (");
		sb.AppendLine("  start \"\" \"%INSTALL%\\Monkeyeffect.bat\"");
		sb.AppendLine(") else if exist \"%INSTALL%\\TempleGiftRelay.exe\" (");
		sb.AppendLine("  start \"\" \"%INSTALL%\\TempleGiftRelay.exe\"");
		sb.AppendLine(")");
		sb.AppendLine("echo [%date% %time%] apply-update done>>\"%LOG%\"");
		sb.AppendLine("del \"%~f0\" >nul 2>&1");
		File.WriteAllText(bat, sb.ToString(), Encoding.ASCII);

		Process.Start(new ProcessStartInfo
		{
			FileName = bat,
			UseShellExecute = true,
			WindowStyle = ProcessWindowStyle.Hidden,
			WorkingDirectory = installDir
		});

		return (true, "กำลังติดตั้งอัปเดตแล้วรีสตาร์ท...");
	}
}
