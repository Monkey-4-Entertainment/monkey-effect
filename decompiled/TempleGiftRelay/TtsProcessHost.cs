using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace TempleGiftRelay;

/// <summary>Starts the built-in Node TTS server (:3848) with the main app.</summary>
public static class TtsProcessHost
{
	private static readonly object Gate = new object();
	private static Process? _proc;
	private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(180) };

	private static int _healthFailures;
	private static DateTime _lastRecoveryUtc = DateTime.MinValue;

	public static int Port { get; } = 3848;

	public static string BaseUrl => $"http://127.0.0.1:{Port}";

	public static void EnsureStarted()
	{
		lock (Gate)
		{
			if (_proc != null && !_proc.HasExited)
			{
				return;
			}
			_proc?.Dispose();
			_proc = null;

			string? node = AppPaths.PlaywrightNodePath;
			if (string.IsNullOrWhiteSpace(node) || !File.Exists(node))
			{
				node = Path.Combine(AppPaths.AppDir, ".playwright", "node", "win32_x64", "node.exe");
			}
			string script = Path.Combine(AppPaths.AppDir, "tools", "tts-server.mjs");
			if (!File.Exists(node) || !File.Exists(script))
			{
				AppPaths.Log("TTS skip: missing node or tts-server.mjs");
				return;
			}

			try
			{
				// Free stale TTS from a previous crash
				KillByPort(Port);
				Thread.Sleep(200);

				var psi = new ProcessStartInfo
				{
					FileName = node,
					Arguments = "\"" + script + "\"",
					WorkingDirectory = Path.Combine(AppPaths.AppDir, "tools"),
					UseShellExecute = false,
					CreateNoWindow = true,
					RedirectStandardOutput = true,
					RedirectStandardError = true,
				};
				psi.Environment["MONKEY_TTS_PORT"] = Port.ToString();
				_proc = Process.Start(psi);
				if (_proc == null)
				{
					AppPaths.Log("TTS start failed: Process.Start returned null");
					return;
				}
				_proc.EnableRaisingEvents = true;
				_proc.Exited += (_, _) => AppPaths.Log("TTS process exited");
                // Both redirected pipes must be drained for the lifetime of Node.
                // Otherwise provider-error logs fill the pipe and freeze HTTP/playback.
                _proc.OutputDataReceived += (_, e) => LogOutput(e.Data);
                _proc.ErrorDataReceived += (_, e) => LogOutput(e.Data);
                _proc.BeginOutputReadLine();
                _proc.BeginErrorReadLine();
				AppPaths.Log($"TTS started pid={_proc.Id}");
			}
			catch (Exception ex)
			{
				AppPaths.Log("TTS start error: " + ex.Message);
				_proc = null;
			}
		}
	}

    private static void LogOutput(string? line)
    {
        if (!string.IsNullOrWhiteSpace(line))
            AppPaths.Log("TTS " + (line.Length > 1200 ? line.Substring(0, 1200) : line));
    }

    public static async Task<bool> IsHealthyAsync(CancellationToken ct = default)
    {
        EnsureStarted();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(2000);
        try
        {
            using var res = await Http.GetAsync(BaseUrl + "/health", timeout.Token);
            if (res.IsSuccessStatusCode)
            {
                Interlocked.Exchange(ref _healthFailures, 0);
                return true;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return false; }
        catch { }
        if (Interlocked.Increment(ref _healthFailures) >= 2) RecoverUnresponsiveProcess();
        return false;
    }

    private static void RecoverUnresponsiveProcess()
    {
        lock (Gate)
        {
            if ((DateTime.UtcNow - _lastRecoveryUtc).TotalSeconds < 15) return;
            _lastRecoveryUtc = DateTime.UtcNow;
            Interlocked.Exchange(ref _healthFailures, 0);
            AppPaths.Log("TTS recovering: health checks failed");
            try
            {
                if (_proc != null && !_proc.HasExited)
                {
                    _proc.Kill(entireProcessTree: true);
                    _proc.WaitForExit(2000);
                }
                _proc?.Dispose();
            }
            catch (Exception ex) { AppPaths.Log("TTS recovery: " + ex.Message); }
            _proc = null;
            EnsureStarted();
        }
    }

    public static async Task WaitUntilReadyAsync(int timeoutMs = 8000)
    {
        using var deadline = new CancellationTokenSource(timeoutMs);
        EnsureStarted();
        try
        {
            while (!deadline.IsCancellationRequested)
            {
                if (await IsHealthyAsync(deadline.Token)) return;
                await Task.Delay(250, deadline.Token);
            }
        }
        catch (OperationCanceledException) { }
    }

	public static async Task<HttpResponseMessage> ForwardAsync(HttpMethod method, string pathAndQuery, byte[]? body, string? contentType, CancellationToken ct)
	{
		EnsureStarted();
		using var req = new HttpRequestMessage(method, BaseUrl + pathAndQuery);
        if (pathAndQuery is "/speak" or "/speak-play" or "/preview")
        {
            string key = TtsProviderSettings.ReadKey();
            if (key.Length > 0) req.Headers.TryAddWithoutValidation("X-Monkeyeffect-Paxa-Key", key);
        }
		if (body != null)
		{
			req.Content = new ByteArrayContent(body);
			if (!string.IsNullOrWhiteSpace(contentType))
			{
				req.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
			}
		}
		return await Http.SendAsync(req, HttpCompletionOption.ResponseContentRead, ct);
	}

	public static void Stop()
	{
		lock (Gate)
		{
			try
			{
				if (_proc != null && !_proc.HasExited)
				{
					_proc.Kill(entireProcessTree: true);
					_proc.WaitForExit(2000);
				}
			}
			catch
			{
			}
			_proc = null;
			try { KillByPort(Port); } catch { }
		}
	}

	private static void KillByPort(int port)
	{
		try
		{
			var psi = new ProcessStartInfo
			{
				FileName = "powershell",
				Arguments =
					$"-NoProfile -Command \"Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}\"",
				UseShellExecute = false,
				CreateNoWindow = true
			};
			using Process? p = Process.Start(psi);
			p?.WaitForExit(3000);
		}
		catch
		{
		}
	}
}
