using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using TempleGiftRelay;

public class Program
{
	[STAThread]
	public static void Main(string[] args)
	{
		ApplicationConfiguration.Initialize();
		WebApplication app = null;
		try
		{
			AppPaths.Initialize();
			AppPaths.ValidatePortableLayout();
		}
		catch (Exception ex)
		{
			MessageBox.Show(ex.Message + "\n\nLog: " + AppPaths.LogFile, "Monkeyeffect", MessageBoxButtons.OK, MessageBoxIcon.Hand);
			return;
		}
		string appDir = AppPaths.AppDir;

		// Reclaim ports aggressively — old instances / stuck process on new PCs
		for (int attempt = 0; attempt < 8; attempt++)
		{
			TryClosePreviousInstance();
			if (IsPortFree(3847) && IsPortFree(12922))
			{
				break;
			}
			Thread.Sleep(700);
		}

		if (!IsPortFree(3847) || !IsPortFree(12922))
		{
			string holders = DescribePortHolders(3847) + "\n" + DescribePortHolders(12922);
			DialogResult force = MessageBox.Show(
				"พอร์ตยังถูกใช้งานอยู่ ระบบจะบังคับปิดโปรเซสที่ค้างแล้วเปิดใหม่\n\n" + holders + "\n\nกด Yes เพื่อบังคับเปิด",
				"Monkeyeffect",
				MessageBoxButtons.YesNo,
				MessageBoxIcon.Warning);
			if (force != DialogResult.Yes)
			{
				return;
			}
			TryClosePreviousInstance();
			ForceKillByPort(3847);
			ForceKillByPort(12922);
			ForceKillByPort(3848);
			Thread.Sleep(1500);
			TryClosePreviousInstance();
			Thread.Sleep(800);
		}

		if (!IsPortFree(3847))
		{
			MessageBox.Show(
				"ยังเปิดไม่ได้ เพราะพอร์ต 3847 ถูกจองอยู่\n\n" + DescribePortHolders(3847) +
				"\n\nเปิด Task Manager แล้ว End task ตามชื่อด้านบน แล้วเปิด Monkeyeffect ใหม่",
				"Monkeyeffect",
				MessageBoxButtons.OK,
				MessageBoxIcon.Hand);
			return;
		}
		if (!IsPortFree(12922))
		{
			MessageBox.Show(
				"พอร์ต 12922 ถูกใช้งานอยู่ (มักเป็น ycLive)\n\nปิด ycLive ให้หมด แล้วเปิด Monkeyeffect ใหม่\n\n" + DescribePortHolders(12922),
				"Monkeyeffect",
				MessageBoxButtons.OK,
				MessageBoxIcon.Hand);
			return;
		}
		if (!IsPortFree(15500))
		{
			MessageBox.Show($"พอร์ต 15500 ถูกใช้แล้ว — WebSocket เกมอาจใช้ไม่ได้", "Monkeyeffect", MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
		}
		try
		{
			WebApplicationBuilder webApplicationBuilder = WebApplication.CreateBuilder(new WebApplicationOptions
			{
				Args = args,
				ContentRootPath = appDir,
				WebRootPath = Path.Combine(appDir, "wwwroot")
			});
			webApplicationBuilder.WebHost.UseUrls("http://127.0.0.1:3847", "http://127.0.0.1:12922");
			webApplicationBuilder.WebHost.UseContentRoot(appDir);
			webApplicationBuilder.WebHost.UseWebRoot(Path.Combine(appDir, "wwwroot"));
			RelayState relayState = new RelayState
			{
				GameWsPort = 15500,
				GameHttpPort = 12922,
				DeliveryMode = "direct-livemsg"
			};
			webApplicationBuilder.Services.AddSingleton(relayState);
			webApplicationBuilder.Services.AddSingleton<GameWindowService>();
			webApplicationBuilder.Services.AddSingleton<KeyMapDeliveryService>();
			webApplicationBuilder.Services.AddSingleton<AvatarCacheService>();
			webApplicationBuilder.Services.AddSingleton<LocalLiveHttpService>();
			webApplicationBuilder.Services.AddSingleton<YcLiveBridgeService>();
			webApplicationBuilder.Services.AddSingleton<GameBridgeService>();
			webApplicationBuilder.Services.AddSingleton<RouletteConfigService>();
			webApplicationBuilder.Services.AddSingleton<RouletteSpinService>();
			webApplicationBuilder.Services.AddSingleton<LiveStatsOverlayService>();
			webApplicationBuilder.Services.AddSingleton<MinecraftRconService>();
			webApplicationBuilder.Services.AddSingleton<BrowserGiftReaderService>();
			app = webApplicationBuilder.Build();
			GameBridgeService gameBridge = app.Services.GetRequiredService<GameBridgeService>();
			GameWindowService gameWindow = app.Services.GetRequiredService<GameWindowService>();
			LocalLiveHttpService liveHttp = app.Services.GetRequiredService<LocalLiveHttpService>();
			YcLiveBridgeService ycLiveBridge = app.Services.GetRequiredService<YcLiveBridgeService>();
			app.Services.GetRequiredService<RouletteSpinService>().Start();
			liveHttp.MarkRunning();
			gameBridge.Start();
			gameWindow.Refresh();
			relayState.PushLog(new LogEntry
			{
				Kind = "system",
				Text = (gameWindow.TryGetWindow(out nint _, out string title) ? ("Found game window: " + title) : ("Game not found (" + (relayState.SelectedGameName ?? "selected game") + ") — open the game before testing gifts"))
			});
			relayState.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "Selected game: " + (relayState.SelectedGameName ?? relayState.SelectedGameId)
			});
			relayState.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "Delivery mode: TikTok -> Relay AES /livemsg :12922 (Kestrel) -> game"
			});
			app.Lifetime.ApplicationStopping.Register(delegate
			{
				gameBridge.Dispose();
				liveHttp.IsRunning = false;
			});
			Task.Run(async delegate
			{
				while (!app.Lifetime.ApplicationStopping.IsCancellationRequested)
				{
					try
					{
						gameWindow.Refresh();
						relayState.YcLiveRunning = ycLiveBridge.IsProcessRunning;
						relayState.YcLiveReady = false;
						relayState.DirectLiveReady = liveHttp.IsRunning;
						await Task.Delay(2000, app.Lifetime.ApplicationStopping);
					}
					catch (OperationCanceledException)
					{
						break;
					}
				}
			});
			app.UseDefaultFiles();
			app.UseStaticFiles(new StaticFileOptions
			{
				OnPrepareResponse = (ctx) =>
				{
					string path = ctx.File.Name;
					if (path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
						|| path.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
						|| path.EndsWith(".css", StringComparison.OrdinalIgnoreCase))
					{
						ctx.Context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
						ctx.Context.Response.Headers["Pragma"] = "no-cache";
						ctx.Context.Response.Headers["Expires"] = "0";
					}
				}
			});
			app.MapGet("/livemsg", (Func<LocalLiveHttpService, IResult>)delegate(LocalLiveHttpService live)
			{
				string content = live.SerializeLiveMsgResponse();
				return Results.Content(content, "application/json; charset=utf-8");
			});
			app.MapMethods("/livemsg", new string[1] { "OPTIONS" }, (Func<IResult>)(() => Results.NoContent()));
			app.MapGet("/health", (Func<LocalLiveHttpService, IResult>)((LocalLiveHttpService live) => Results.Json(new
			{
				ok = true,
				service = "TempleGiftRelay",
				mode = "direct-livemsg",
				httpPort = live.Port,
				pending = live.PendingCount,
				serves = live.ServeCount
			})));
			app.MapGet("/avatar-cache/{fileName}", (Func<string, AvatarCacheService, IResult>)((string fileName, AvatarCacheService avatars) => (!avatars.TryGetFile(fileName, out string fullPath, out string contentType)) ? Results.NotFound() : Results.File(fullPath, contentType)));
			app.MapGet("/api/status", (Func<RelayState, LocalLiveHttpService, IResult>)delegate(RelayState state, LocalLiveHttpService live)
			{
				StatusDto statusDto = state.ToStatus();
				return Results.Json(new
				{
					TikTokUsername = statusDto.TikTokUsername,
					readerSource = statusDto.ReaderSource,
					TikTokConnected = statusDto.TikTokConnected,
					TikTokLive = statusDto.TikTokLive,
					TikTokConnecting = statusDto.TikTokConnecting,
					TikTokReconnecting = statusDto.TikTokReconnecting,
					GameClients = statusDto.GameClients,
					GameWsPort = statusDto.GameWsPort,
					GameHttpPort = statusDto.GameHttpPort,
					GameWindowFound = statusDto.GameWindowFound,
					GameWindowTitle = statusDto.GameWindowTitle,
					SelectedGameId = statusDto.SelectedGameId,
					SelectedGameName = statusDto.SelectedGameName,
					YcLiveRunning = statusDto.YcLiveRunning,
					YcLiveReady = statusDto.YcLiveReady,
					YcLiveError = statusDto.YcLiveError,
					DeliveryMode = statusDto.DeliveryMode,
					DirectLiveReady = statusDto.DirectLiveReady,
					GamePolledLive = statusDto.GamePolledLive,
					GameError = statusDto.GameError,
					TikTokError = statusDto.TikTokError,
					GiftLog = statusDto.GiftLog,
					livePending = live.PendingCount,
					liveServes = live.ServeCount,
					lastServed = live.LastServedJson
				});
			});
			app.MapGet("/api/live-stats", (Func<LiveStatsOverlayService, RelayState, HttpResponse, IResult>)((LiveStatsOverlayService stats, RelayState state, HttpResponse response) =>
			{
				response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				response.Headers["Pragma"] = "no-cache";
				response.Headers["Access-Control-Allow-Origin"] = "*";
				return Results.Json(stats.ToSnapshot(state.TikTokConnected, state.TikTokLive));
			}));
			app.MapPost("/api/live-stats/reset", async (HttpRequest request, LiveStatsOverlayService stats, RelayState state) =>
			{
				bool coins = true;
				bool gifters = true;
				bool likes = false;
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body);
					if (doc.RootElement.ValueKind == JsonValueKind.Object)
					{
						if (doc.RootElement.TryGetProperty("coins", out JsonElement c) && (c.ValueKind == JsonValueKind.False || c.ValueKind == JsonValueKind.True))
						{
							coins = c.GetBoolean();
						}
						if (doc.RootElement.TryGetProperty("gifters", out JsonElement g) && (g.ValueKind == JsonValueKind.False || g.ValueKind == JsonValueKind.True))
						{
							gifters = g.GetBoolean();
						}
						if (doc.RootElement.TryGetProperty("likes", out JsonElement l) && (l.ValueKind == JsonValueKind.False || l.ValueKind == JsonValueKind.True))
						{
							likes = l.GetBoolean();
						}
						if (doc.RootElement.TryGetProperty("all", out JsonElement all) && all.ValueKind == JsonValueKind.True)
						{
							coins = gifters = likes = true;
						}
					}
				}
				catch
				{
				}
				stats.Reset(coins, gifters, likes);
				return Results.Json(stats.ToSnapshot(state.TikTokConnected, state.TikTokLive));
			});
			app.MapPost("/api/live-stats/settings", async (HttpRequest request, LiveStatsOverlayService stats, RelayState state) =>
			{
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body);
					if (doc.RootElement.ValueKind == JsonValueKind.Object)
					{
						stats.ApplySettings(doc.RootElement);
					}
				}
				catch
				{
				}
				return Results.Json(stats.ToSnapshot(state.TikTokConnected, state.TikTokLive));
			});
			app.MapPost("/api/minecraft/rcon", async (HttpRequest request, MinecraftRconService rcon, CancellationToken ct) =>
			{
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body);
					JsonElement root = doc.RootElement;
					string host = root.TryGetProperty("host", out JsonElement hostEl) ? (hostEl.GetString() ?? "") : "";
					int port = 25575;
					if (root.TryGetProperty("port", out JsonElement portEl) && portEl.ValueKind == JsonValueKind.Number)
					{
						port = portEl.GetInt32();
					}
					else if (root.TryGetProperty("port", out portEl) && int.TryParse(portEl.GetString(), out int parsedPort))
					{
						port = parsedPort;
					}
					string password = root.TryGetProperty("password", out JsonElement pwEl) ? (pwEl.GetString() ?? "") : "";
					string command = root.TryGetProperty("command", out JsonElement cmdEl) ? (cmdEl.GetString() ?? "") : "";
					MinecraftRconService.RconResult result = await rcon.SendAsync(host, port, password, command, ct);
					return Results.Json(new { ok = result.Ok, detail = result.Detail });
				}
				catch (Exception ex)
				{
					return Results.Json(new { ok = false, detail = ex.Message });
				}
			});
			app.MapGet("/api/games", (Func<GameWindowService, IResult>)(gameWindow =>
			{
				GameSelection sel = gameWindow.GetSelection();
				return Results.Json(new
				{
					selected = sel,
					games = GameCatalog.BuiltIn.Select(g => new { id = g.Id, name = g.Name, processNames = g.ProcessNames, titleContains = g.TitleContains, keyMapFile = g.KeyMapFile })
				});
			}));
			app.MapPut("/api/games/selected", async (HttpRequest request, GameWindowService gameWindow, RelayState state, KeyMapDeliveryService keyMap) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				GameSelection? sel = System.Text.Json.JsonSerializer.Deserialize<GameSelection>(json, new System.Text.Json.JsonSerializerOptions
				{
					PropertyNameCaseInsensitive = true
				});
				if (sel == null || string.IsNullOrWhiteSpace(sel.Id))
				{
					return Results.BadRequest(new { ok = false, error = "invalid selection" });
				}
				gameWindow.SetSelection(sel);
				// Auto-activate/deactivate keymap based on game profile
				keyMap.AutoActivateFromGame(sel);
				state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "Selected game: " + (state.SelectedGameName ?? sel.Id)
				});
				return Results.Json(new
				{
					ok = true,
					selected = gameWindow.GetSelection(),
					gameWindowFound = state.GameWindowFound,
					gameWindowTitle = state.GameWindowTitle
				});
			});
			app.MapGet("/api/games/windows", (Func<GameWindowService, IResult>)(gameWindow =>
				Results.Json(new { windows = gameWindow.ListRunningCandidates() })));
			app.MapPost("/api/games/close", (Func<GameWindowService, RelayState, IResult>)((gameWindow, state) =>
			{
				var (ok, killed, detail, gameName) = gameWindow.TryCloseSelectedGame();
				state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = ok
						? $"Closed all open games ({killed}): {detail}"
						: "Close games failed — no running game process found"
				});
				return Results.Json(new
				{
					ok,
					killed,
					detail,
					gameName,
					gameWindowFound = state.GameWindowFound
				});
			}));
			app.MapGet("/api/tts/health", async (CancellationToken ct) =>
			{
				TtsProcessHost.EnsureStarted();
				await TtsProcessHost.WaitUntilReadyAsync(5000);
				bool ok = await TtsProcessHost.IsHealthyAsync(ct);
				return Results.Json(new
				{
					ok,
					service = "Monkeyeffect TTS",
					via = "app-proxy",
					port = TtsProcessHost.Port
				});
			});
			app.MapMethods("/api/tts/speak", new[] { "POST", "OPTIONS" }, async (HttpRequest request, CancellationToken ct) =>
			{
				if (HttpMethods.IsOptions(request.Method))
				{
					return Results.NoContent();
				}
				TtsProcessHost.EnsureStarted();
				await TtsProcessHost.WaitUntilReadyAsync(8000);
				using MemoryStream ms = new MemoryStream();
				await request.Body.CopyToAsync(ms, ct);
				using HttpResponseMessage upstream = await TtsProcessHost.ForwardAsync(
					HttpMethod.Post,
					"/speak",
					ms.ToArray(),
					request.ContentType ?? "application/json",
					ct);
				byte[] bytes = await upstream.Content.ReadAsByteArrayAsync(ct);
				string? media = upstream.Content.Headers.ContentType?.ToString();
				if (!upstream.IsSuccessStatusCode)
				{
					return Results.Content(
						System.Text.Encoding.UTF8.GetString(bytes),
						media ?? "application/json",
						statusCode: (int)upstream.StatusCode);
				}
				return Results.File(bytes, media ?? "audio/mpeg");
			});
			// Play TTS outside WebView (keeps speaking when main window is minimized).
			app.MapMethods("/api/tts/speak-play", new[] { "POST", "OPTIONS" }, async (HttpRequest request, CancellationToken ct) =>
			{
				if (HttpMethods.IsOptions(request.Method))
				{
					return Results.NoContent();
				}
				TtsProcessHost.EnsureStarted();
				await TtsProcessHost.WaitUntilReadyAsync(8000);
				using MemoryStream ms = new MemoryStream();
				await request.Body.CopyToAsync(ms, ct);
				using HttpResponseMessage upstream = await TtsProcessHost.ForwardAsync(
					HttpMethod.Post,
					"/speak-play",
					ms.ToArray(),
					request.ContentType ?? "application/json",
					ct);
				byte[] bytes = await upstream.Content.ReadAsByteArrayAsync(ct);
				string? media = upstream.Content.Headers.ContentType?.ToString() ?? "application/json";
				return Results.Content(
					System.Text.Encoding.UTF8.GetString(bytes),
					media,
					statusCode: (int)upstream.StatusCode);
			});
			app.MapGet("/api/version", (Func<IResult>)(() =>
			{
				UpdateConfig cfg = AppUpdateService.LoadConfig();
				return Results.Json(new
				{
					ok = true,
					version = AppVersion.ReadInstalledVersion(),
					product = "Monkeyeffect",
					feedUrl = cfg.FeedUrl ?? "",
					autoCheck = cfg.AutoCheck
				});
			}));
			app.MapPut("/api/update/feed", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string body = await reader.ReadToEndAsync();
				string feedUrl = "";
				bool autoCheck = true;
				try
				{
					using JsonDocument doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
					if (doc.RootElement.TryGetProperty("feedUrl", out JsonElement u))
					{
						feedUrl = u.GetString() ?? "";
					}
					if (doc.RootElement.TryGetProperty("autoCheck", out JsonElement a) && a.ValueKind is JsonValueKind.True or JsonValueKind.False)
					{
						autoCheck = a.GetBoolean();
					}
				}
				catch
				{
					return Results.BadRequest(new { ok = false, error = "invalid json" });
				}
				UpdateConfig cfg = AppUpdateService.LoadConfig();
				cfg.FeedUrl = string.IsNullOrWhiteSpace(feedUrl) ? AppUpdateService.ResolveDefaultFeedUrl() : feedUrl.Trim();
				cfg.AutoCheck = autoCheck;
				AppUpdateService.SaveConfig(cfg);
				return Results.Json(new { ok = true, feedUrl = cfg.FeedUrl, autoCheck = cfg.AutoCheck });
			});
			app.MapPost("/api/update/check", async (CancellationToken ct) =>
			{
				var (ok, message, man) = await AppUpdateService.CheckAsync(ct);
				string current = AppVersion.ReadInstalledVersion();
				bool hasUpdate = man != null && AppVersion.Compare(man.Version, current) > 0;
				return Results.Json(new
				{
					ok,
					message,
					current,
					hasUpdate,
					latest = man == null ? null : new
					{
						version = man.Version,
						notes = man.Notes,
						zipUrl = man.ZipUrl,
						mandatory = man.Mandatory
					}
				});
			});
			app.MapPost("/api/update/apply", async (CancellationToken ct) =>
			{
				var (okCheck, messageCheck, man) = await AppUpdateService.CheckAsync(ct);
				if (!okCheck || man == null)
				{
					return Results.Json(new { ok = false, error = messageCheck });
				}
				string current = AppVersion.ReadInstalledVersion();
				if (AppVersion.Compare(man.Version, current) <= 0)
				{
					return Results.Json(new { ok = false, error = messageCheck });
				}
				var (okDl, msgDl) = await AppUpdateService.DownloadAndStageAsync(man, null, ct);
				if (!okDl)
				{
					return Results.Json(new { ok = false, error = msgDl });
				}
				var (okApply, msgApply) = AppUpdateService.LaunchApplyAndExit();
				if (!okApply)
				{
					return Results.Json(new { ok = false, error = msgApply });
				}
				// Exit shortly so apply script can overwrite files
				_ = Task.Run(async () =>
				{
					await Task.Delay(600);
					Environment.Exit(0);
				});
				return Results.Json(new { ok = true, message = msgApply, version = man.Version });
			});
			app.MapGet("/api/diagnostics", (Func<RelayState, LocalLiveHttpService, IResult>)delegate(RelayState state, LocalLiveHttpService live)
			{
				(string, string)? tuple = AppPaths.ResolveYcLive();
				string appDir2 = AppPaths.AppDir;
				bool hasWwwroot = Directory.Exists(Path.Combine(AppPaths.AppDir, "wwwroot"));
				InlineArray5<string> buffer = default(InlineArray5<string>);
				buffer[0] = AppPaths.AppDir;
				buffer[1] = ".playwright";
				buffer[2] = "node";
				buffer[3] = "win32_x64";
				buffer[4] = "node.exe";
				return Results.Json(new
				{
					appDir = appDir2,
					hasWwwroot = hasWwwroot,
					hasPlaywrightDriver = File.Exists(Path.Combine(buffer)),
					chrome = AppPaths.FindChrome(),
					ycLiveExe = tuple?.Item1,
					ycLiveDir = tuple?.Item2,
					deliveryMode = state.DeliveryMode,
					directLiveReady = state.DirectLiveReady,
					gamePolledLive = state.GamePolledLive,
					livePending = live.PendingCount,
					liveServes = live.ServeCount,
					lastServed = live.LastServedJson,
					ycLiveReady = state.YcLiveReady,
					ycLiveError = state.YcLiveError,
					tikTokError = state.TikTokError,
					logFile = AppPaths.LogFile
				});
			});
			app.MapPost("/api/connect", (Func<ConnectRequest, RelayState, BrowserGiftReaderService, CancellationToken, Task<IResult>>)async delegate(ConnectRequest request, RelayState state, BrowserGiftReaderService browser, CancellationToken ct)
			{
				try
				{
					int? gameWsPort = request.GameWsPort;
					if (gameWsPort.HasValue)
					{
						int valueOrDefault = gameWsPort.GetValueOrDefault();
						if (valueOrDefault > 0 && valueOrDefault <= 65535)
						{
							state.GameWsPort = request.GameWsPort.Value;
						}
					}
					if (!state.DirectLiveReady)
					{
						throw new InvalidOperationException(state.GameError ?? "Direct /livemsg not ready — close ycLive and restart Relay");
					}
					await browser.ConnectAsync(request.Username ?? string.Empty, ct);
					return Results.Json(new
					{
						ok = true,
						status = state.ToStatus()
					});
				}
				catch (Exception ex3)
				{
					state.TikTokError = ex3.Message;
					AppPaths.Log($"connect failed: {ex3}");
					return Results.BadRequest(new
					{
						ok = false,
						error = ex3.Message,
						tikTokError = ex3.Message
					});
				}
			});
			app.MapPost("/api/disconnect", (Func<BrowserGiftReaderService, RelayState, Task<IResult>>)async delegate(BrowserGiftReaderService browser, RelayState state)
			{
				await browser.DisconnectAsync();
				return Results.Json(new
				{
					ok = true,
					status = state.ToStatus()
				});
			});
			app.MapPost("/api/tiktok-login-chrome", (Func<BrowserGiftReaderService, RelayState, CancellationToken, Task<IResult>>)async delegate(BrowserGiftReaderService browser, RelayState state, CancellationToken ct)
			{
				try
				{
					await browser.OpenLoginChromeAsync(ct);
					return Results.Json(new
					{
						ok = true,
						status = state.ToStatus()
					});
				}
				catch (Exception ex3)
				{
					state.TikTokError = ex3.Message;
					AppPaths.Log("open login chrome failed: " + ex3);
					return Results.BadRequest(new
					{
						ok = false,
						error = ex3.Message
					});
				}
			});
			app.MapGet("/api/roulette/config", (Func<RouletteConfigService, IResult>)((RouletteConfigService roulette) =>
				Results.Json(new { ok = true, config = roulette.GetSnapshot() })));
			app.MapPut("/api/roulette/config", async (HttpRequest request, RouletteConfigService roulette) =>
			{
				try
				{
					RouletteConfig? body = await JsonSerializer.DeserializeAsync<RouletteConfig>(request.Body, new JsonSerializerOptions
					{
						PropertyNameCaseInsensitive = true
					});
					if (body == null)
					{
						return Results.BadRequest(new { ok = false, error = "invalid body" });
					}
					roulette.Save(body);
					return Results.Json(new { ok = true, config = roulette.GetSnapshot() });
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			});
			// Roulette winner → game ONLY (no kind=ui fan-out / no second spin side-effects).
			ConcurrentDictionary<string, long> rouletteDeliverTokens = new ConcurrentDictionary<string, long>(StringComparer.Ordinal);
			app.MapPost("/api/roulette/deliver", (Func<TestGiftRequest, GameBridgeService, RelayState, GameWindowService, AvatarCacheService, Task<IResult>>)async delegate(TestGiftRequest request, GameBridgeService gameBridgeService, RelayState state, GameWindowService gameWindowService, AvatarCacheService avatars)
			{
				gameWindowService.Refresh();
				string giftName = string.IsNullOrWhiteSpace(request.GiftName) ? "" : request.GiftName.Trim();
				if (string.IsNullOrWhiteSpace(giftName))
				{
					return Results.BadRequest(new { ok = false, error = "giftName required" });
				}
				string token = (request.Token ?? "").Trim();
				long now = Environment.TickCount64;
				if (token.Length > 0)
				{
					if (!rouletteDeliverTokens.TryAdd(token, now))
					{
						AppPaths.Log("roulette-deliver dedupe token=" + token);
						return Results.Json(new { ok = true, deduped = true, giftName });
					}
					if (rouletteDeliverTokens.Count > 200)
					{
						foreach (KeyValuePair<string, long> pair in rouletteDeliverTokens.ToArray())
						{
							if (now - pair.Value > 120000)
							{
								rouletteDeliverTokens.TryRemove(pair.Key, out _);
							}
						}
					}
				}
				string nickname = !string.IsNullOrWhiteSpace(request.Nickname) ? request.Nickname.Trim() : "ผู้ชม";
				string userName = !string.IsNullOrWhiteSpace(request.UserName)
					? request.UserName.Trim()
					: ("u_" + string.Concat(nickname.Where(char.IsLetterOrDigit)).ToLowerInvariant());
				if (string.IsNullOrWhiteSpace(userName) || userName == "u_")
				{
					userName = "viewer";
				}
				string avatarUrl = (request.AvatarUrl ?? "").Trim();
				string imageId = (request.ImageId ?? "").Trim();
				if (string.IsNullOrWhiteSpace(avatarUrl) && imageId.Length > 0)
				{
					string? imagePath = RouletteSpinService.FindRouletteImagePath(imageId);
					if (imagePath != null)
					{
						avatarUrl = avatars.ImportLocalFile(imagePath, "roulette:" + imageId);
					}
				}
				GiftPayload payload = new GiftPayload
				{
					MessageType = "SendGift",
					Type = "SendGift",
					MsgType = "SendGift",
					GiftName = giftName,
					RepeatCount = 1,
					UserName = userName,
					Nickname = nickname,
					AvatarUrl = avatarUrl
				};
				DeliveryResult deliveryResult = await gameBridgeService.DeliverGiftAsync(payload);
				string line = $"[ROULETTE-WIN] {giftName} x1 from {nickname}";
				state.PushLog(new LogEntry
				{
					Kind = "game",
					Text = line,
					Sent = deliveryResult.TotalSent,
					WindowSent = deliveryResult.YcLiveSent
				});
				AppPaths.Log($"roulette-win gift={giftName} nick={nickname} imageId={imageId} avatar={(string.IsNullOrWhiteSpace(avatarUrl) ? "none" : "yes")} sent={deliveryResult.TotalSent} yc={deliveryResult.YcLiveSent}");
				DevLogService.Write("gift.roulette", "winner delivered", new
				{
					giftName,
					nickname,
					token,
					imageId,
					hasAvatar = !string.IsNullOrWhiteSpace(avatarUrl),
					sent = deliveryResult.TotalSent,
					yc = deliveryResult.YcLiveSent
				});
				if (!deliveryResult.YcLiveSent)
				{
					state.GameError = state.GameError ?? "Direct /livemsg enqueue failed — check port 12922";
				}
				else
				{
					state.ClearGameError();
				}
				return Results.Json(new
				{
					ok = deliveryResult.YcLiveSent,
					payload,
					sent = deliveryResult.TotalSent,
					ycLiveSent = deliveryResult.YcLiveSent,
					status = state.ToStatus()
				});
			});
			app.MapPost("/api/test-gift", (Func<TestGiftRequest, GameBridgeService, RelayState, GameWindowService, AvatarCacheService, LiveStatsOverlayService, Task<IResult>>)async delegate(TestGiftRequest request, GameBridgeService gameBridgeService, RelayState state, GameWindowService gameWindowService, AvatarCacheService avatars, LiveStatsOverlayService liveStats)
			{
				gameWindowService.Refresh();
				string msgType = (string.IsNullOrWhiteSpace(request.MessageType) ? "SendGift" : request.MessageType.Trim());
				string giftName = ((!string.IsNullOrWhiteSpace(request.GiftName)) ? request.GiftName.Trim() : (msgType.Contains("Like", StringComparison.OrdinalIgnoreCase) ? "Like" : (msgType.Contains("Follow", StringComparison.OrdinalIgnoreCase) ? "Follow" : "Rose")));
				int repeatCount = ((request.RepeatCount <= 0) ? 1 : request.RepeatCount);
				bool fromRoulette = string.Equals(request.Source?.Trim(), "roulette", StringComparison.OrdinalIgnoreCase);
				// Legacy roulette callers → game-only (no kind=ui, which used to re-trigger functions).
				if (fromRoulette)
				{
					string nickR = !string.IsNullOrWhiteSpace(request.Nickname) ? request.Nickname.Trim() : "ผู้ชม";
					string userR = !string.IsNullOrWhiteSpace(request.UserName)
						? request.UserName.Trim()
						: ("u_" + string.Concat(nickR.Where(char.IsLetterOrDigit)).ToLowerInvariant());
					if (string.IsNullOrWhiteSpace(userR) || userR == "u_") userR = "viewer";
					string tokenR = (request.Token ?? "").Trim();
					long nowR = Environment.TickCount64;
					if (tokenR.Length > 0 && !rouletteDeliverTokens.TryAdd(tokenR, nowR))
					{
						return Results.Json(new { ok = true, deduped = true, giftName });
					}
					string avatarR = (request.AvatarUrl ?? "").Trim();
					string imageIdR = (request.ImageId ?? "").Trim();
					if (string.IsNullOrWhiteSpace(avatarR) && imageIdR.Length > 0)
					{
						string? imagePathR = RouletteSpinService.FindRouletteImagePath(imageIdR);
						if (imagePathR != null)
						{
							avatarR = avatars.ImportLocalFile(imagePathR, "roulette:" + imageIdR);
						}
					}
					GiftPayload winPayload = new GiftPayload
					{
						MessageType = "SendGift",
						Type = "SendGift",
						MsgType = "SendGift",
						GiftName = giftName,
						RepeatCount = 1,
						UserName = userR,
						Nickname = nickR,
						AvatarUrl = avatarR
					};
					DeliveryResult winResult = await gameBridgeService.DeliverGiftAsync(winPayload);
					state.PushLog(new LogEntry
					{
						Kind = "game",
						Text = $"[ROULETTE-WIN] {giftName} x1 from {nickR}",
						Sent = winResult.TotalSent,
						WindowSent = winResult.YcLiveSent
					});
					return Results.Json(new
					{
						ok = winResult.YcLiveSent,
						payload = winPayload,
						sent = winResult.TotalSent,
						ycLiveSent = winResult.YcLiveSent,
						status = state.ToStatus()
					});
				}
				string nickname = !string.IsNullOrWhiteSpace(request.Nickname)
					? request.Nickname.Trim()
					: "Test User";
				string userName = !string.IsNullOrWhiteSpace(request.UserName)
					? request.UserName.Trim()
					: "test_user";
				if (string.IsNullOrWhiteSpace(userName) || userName == "u_")
				{
					userName = "test_user";
				}
				GiftPayload payload = new GiftPayload
				{
					MessageType = msgType,
					Type = msgType,
					MsgType = msgType,
					GiftName = giftName,
					Comment = (request.Comment ?? "").Trim(),
					RepeatCount = repeatCount,
					UserName = userName,
					Nickname = nickname
				};
				if (msgType.Contains("Chat", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(payload.Comment))
				{
					payload.Comment = giftName;
				}
				DevLogService.Write("gift.test", "test-gift enqueue", new { giftName, repeatCount, msgType, nickname, source = request.Source });
				string kind = (msgType.Contains("Like", StringComparison.OrdinalIgnoreCase) ? "like" : (msgType.Contains("Follow", StringComparison.OrdinalIgnoreCase) ? "follow" : (msgType.Contains("Chat", StringComparison.OrdinalIgnoreCase) ? "chat" : "gift")));
				try
				{
					if (kind == "like") liveStats.RecordLike(payload);
					else if (kind == "follow") liveStats.RecordFollow(payload);
					else if (kind == "chat") liveStats.RecordChat(payload);
					else liveStats.RecordGift(payload);
				}
				catch { }
				string prefix = "[TEST] ";
				string line = kind == "follow"
					? $"{prefix}Follow from {payload.Nickname}"
					: kind == "chat"
						? $"{prefix}Chat: {payload.Comment} from {payload.Nickname}"
						: $"{prefix}{giftName} x{repeatCount} from {payload.Nickname}";
				if (kind == "chat")
				{
					state.PushLog(new LogEntry
					{
						Kind = "chat",
						Text = $"Chat: {payload.Comment} from {payload.Nickname}",
						Sent = 0,
						WindowSent = false
					});
					return Results.Json(new
					{
						ok = true,
						payload,
						sent = 0,
						status = state.ToStatus()
					});
				}
				// Dual-path A: UI first, then game (test is instantaneous both ways).
				state.PushLog(new LogEntry
				{
					Kind = "ui",
					Text = line,
					Sent = 0,
					WindowSent = false
				});
				DeliveryResult deliveryResult = await gameBridgeService.DeliverGiftAsync(payload);
				state.PushLog(new LogEntry
				{
					Kind = "game",
					Text = line + (string.IsNullOrWhiteSpace(deliveryResult.Channel) ? "" : $" [{deliveryResult.Channel}]"),
					Sent = deliveryResult.TotalSent,
					WindowSent = deliveryResult.YcLiveSent
				});
				DevLogService.Write("gift.test", "test-gift delivered", new
				{
					giftName,
					repeatCount,
					nickname,
					sent = deliveryResult.TotalSent,
					yc = deliveryResult.YcLiveSent
				});
				if (!deliveryResult.YcLiveSent)
				{
					state.GameError = state.GameError ?? "Direct /livemsg enqueue failed — check port 12922";
				}
				else
				{
					state.ClearGameError();
				}
				return Results.Json(new
				{
					ok = deliveryResult.YcLiveSent,
					payload = payload,
					sent = deliveryResult.TotalSent,
					wsSent = deliveryResult.WebSocketSent,
					ycLiveSent = deliveryResult.YcLiveSent,
					channel = deliveryResult.Channel,
					gameClients = deliveryResult.ClientCount,
					gameWindowFound = deliveryResult.GameWindowFound,
					directLiveReady = state.DirectLiveReady,
					deliveryMode = state.DeliveryMode,
					status = state.ToStatus()
				});
			});
			// ──── KeyMap (THE RIDER keyboard delivery) API ────
			app.MapGet("/api/keymap", (KeyMapDeliveryService km) =>
			{
				var snap = km.GetSnapshot();
				return Results.Json(new
				{
					enabled = snap.Enabled,
					comment = snap.Comment,
					rules = snap.Rules,
					events = snap.Events ?? new List<KeyMapDeliveryService.KeyMapEvent>()
				});
			});
			app.MapPost("/api/keymap", async (HttpRequest request, KeyMapDeliveryService km) =>
			{
				using var doc = await JsonDocument.ParseAsync(request.Body);
				var cfg = JsonSerializer.Deserialize<KeyMapDeliveryService.KeyMapConfig>(doc.RootElement.GetRawText(),
					new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
				if (cfg != null)
				{
					if (!doc.RootElement.TryGetProperty("events", out _))
						cfg.Events = km.GetSnapshot().Events;
					km.Save(cfg);
					return Results.Json(new { ok = true, rules = cfg.Rules.Count, events = cfg.Events.Count });
				}
				return Results.BadRequest(new { ok = false, error = "invalid config" });
			});
			app.MapPost("/api/keymap/reload", (KeyMapDeliveryService km) =>
			{
				km.Load();
				return Results.Json(new { ok = true, rules = km.GetSnapshot().Rules.Count, events = km.GetSnapshot().Events.Count });
			});
			app.MapGet("/api/keymap/export", (KeyMapDeliveryService km) =>
			{
				byte[] bytes = System.Text.Encoding.UTF8.GetBytes(km.ExportJson());
				return Results.File(bytes, "application/json", "THE-RIDER-preset.json");
			});
			app.MapPost("/api/keymap/import", async (HttpRequest request, KeyMapDeliveryService km, GameWindowService gameWindow) =>
			{
				using var reader = new StreamReader(request.Body);
				string text = await reader.ReadToEndAsync();
				if (text.TrimStart().StartsWith("{") && text.Contains("\"text\""))
				{
					try
					{
						using JsonDocument wrap = JsonDocument.Parse(text);
						if (wrap.RootElement.TryGetProperty("text", out JsonElement t) && t.ValueKind == JsonValueKind.String)
							text = t.GetString() ?? text;
					}
					catch
					{
						/* body is the preset itself */
					}
				}
				if (!km.TryImport(text, out var cfg, out string error))
				{
					return Results.Json(new { ok = false, error });
				}
				string fileName = request.Query["file"].ToString();
				if (string.IsNullOrWhiteSpace(fileName))
					fileName = Uri.UnescapeDataString(request.Headers["X-Preset-Filename"].ToString() ?? "");
				string requestedGame = request.Query["game"].ToString();
				if (string.IsNullOrWhiteSpace(requestedGame))
					requestedGame = gameWindow.GetSelection()?.Id ?? "";
				if (!km.TryBindImportToSelected(requestedGame, fileName, cfg, out string gameId, out string displayName, out string? presetGame, out string bindError))
				{
					return Results.Json(new
					{
						ok = false,
						error = bindError,
						mismatch = true,
						game = gameId,
						displayName,
						presetGame
					});
				}
				km.Save(cfg);
				km.AutoActivateFromGame(gameWindow.GetSelection());
				return Results.Json(new { ok = true, rules = cfg.Rules.Count, events = cfg.Events.Count, game = gameId, displayName });
			});
			app.MapPost("/api/keymap/import-default", (KeyMapDeliveryService km, GameWindowService gameWindow) =>
			{
				if (!km.TryImportDefaultPack(out var cfg, out string error))
				{
					return Results.Json(new { ok = false, error });
				}
				km.PrepareImportTarget(cfg, "THE-RIDER-v2.json");
				km.Save(cfg);
				gameWindow.SetSelection(new GameSelection { Id = "the-rider", DisplayName = "THE RIDER" });
				km.AutoActivateFromGame(gameWindow.GetSelection());
				return Results.Json(new { ok = true, rules = cfg.Rules.Count, events = cfg.Events.Count, game = "the-rider", displayName = "THE RIDER" });
			});
			app.MapPost("/api/keymap/test", async (HttpRequest request, KeyMapDeliveryService km) =>
			{
				using var doc = await JsonDocument.ParseAsync(request.Body);
				JsonElement root = doc.RootElement;
				string key = root.TryGetProperty("key", out JsonElement keyEl) ? (keyEl.GetString() ?? "") : "";
				string webhookUrl = root.TryGetProperty("webhookUrl", out JsonElement whEl) ? (whEl.GetString() ?? "") : "";
				if (!string.IsNullOrWhiteSpace(webhookUrl))
				{
					var testPayload = new GiftPayload
					{
						GiftName = "Rose",
						RepeatCount = 1,
						UserName = "test_user",
						Nickname = "Test User"
					};
					if (km.TryFireWebhook(webhookUrl, out string whDetail, testPayload))
						return Results.Json(new { ok = true, detail = whDetail, webhook = true });
					return Results.Json(new { ok = false, error = string.IsNullOrWhiteSpace(whDetail) ? "webhook failed" : whDetail });
				}
				int vk = 0;
				if (root.TryGetProperty("vk", out JsonElement vkEl) && vkEl.ValueKind == JsonValueKind.Number)
				{
					vk = vkEl.GetInt32();
				}
				int holdMs = 80;
				if (root.TryGetProperty("holdMs", out JsonElement holdEl) && holdEl.ValueKind == JsonValueKind.Number)
				{
					holdMs = holdEl.GetInt32();
				}
				int count = 1;
				if (root.TryGetProperty("count", out JsonElement countEl) && countEl.ValueKind == JsonValueKind.Number)
				{
					count = countEl.GetInt32();
				}
				if (km.TrySendKey(key, vk, holdMs, count, out string detail))
				{
					return Results.Json(new { ok = true, detail });
				}
				return Results.Json(new { ok = false, error = string.IsNullOrWhiteSpace(detail) ? "send failed" : detail });
			});

			app.MapPost("/api/test-replay-sample", (Func<LocalLiveHttpService, RelayState, IResult>)delegate(LocalLiveHttpService live, RelayState state)
			{
				try
				{
					string path = Path.Combine(AppPaths.AppDir, "tools", "livemsg-samples.json");
					if (!File.Exists(path))
					{
						path = "C:\\Users\\PC\\Desktop\\temple-gift-relay-dotnet\\tools\\livemsg-samples.json";
					}
					if (!File.Exists(path))
					{
						throw new FileNotFoundException("livemsg-samples.json not found");
					}
					using JsonDocument jsonDocument = JsonDocument.Parse(File.ReadAllText(path));
					JsonElement jsonElement = jsonDocument.RootElement.GetProperty("samples")[0];
					live.EnqueueRaw(jsonElement.GetProperty("id").GetString(), jsonElement.GetProperty("content").GetString(), jsonElement.GetProperty("time").GetString());
					state.PushLog(new LogEntry
					{
						Kind = "gift",
						Text = "[TEST] RAW replay Heart Me sample"
					});
					return Results.Json(new
					{
						ok = true,
						id = jsonElement.GetProperty("id").GetString()
					});
				}
				catch (Exception ex3)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = ex3.Message
					});
				}
			});
			app.MapPost("/api/video-overlay/open", (Func<GameWindowService, HttpRequest, IResult>)delegate(GameWindowService gameWindow, HttpRequest request)
			{
				bool followGame = string.Equals(request.Query["followGame"], "1", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["followGame"], "true", StringComparison.OrdinalIgnoreCase);
				bool fullscreen = string.Equals(request.Query["fullscreen"], "1", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["fullscreen"], "true", StringComparison.OrdinalIgnoreCase);
				bool clickThrough = string.Equals(request.Query["clickThrough"], "1", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["clickThrough"], "true", StringComparison.OrdinalIgnoreCase);
				string modeRaw = request.Query["mode"].ToString();
				VideoOverlayForm.OverlayMode mode = string.Equals(modeRaw, "clear", StringComparison.OrdinalIgnoreCase)
					? VideoOverlayForm.OverlayMode.Clear
					: VideoOverlayForm.OverlayMode.Chroma;
				if (followGame && gameWindow.TryGetWindow(out nint hwnd, out string _))
				{
					VideoOverlayHost.FollowWindow(hwnd, mode);
				}
				else
				{
					VideoOverlayHost.Open(clickThrough: clickThrough, mode: mode, recreate: !VideoOverlayHost.IsOpen, fullscreen: fullscreen);
				}
				return Results.Json(new
				{
					ok = true,
					open = VideoOverlayHost.IsOpen,
					followGame,
					fullscreen,
					clickThrough,
					mode = mode.ToString().ToLowerInvariant()
				});
			});
			app.MapPost("/api/video-overlay/close", (Func<IResult>)(() =>
			{
				VideoOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			}));
			app.MapGet("/api/video-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = VideoOverlayHost.IsOpen,
				lastStatus = VideoOverlayBus.LastStatus
			})));
			app.MapPost("/api/video-overlay/cmd", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				VideoOverlayBus.EnqueueRaw(json);
				return Results.Json(new { ok = true });
			});
			app.MapGet("/api/video-overlay/poll", (Func<IResult>)(() =>
			{
				var cmds = VideoOverlayBus.Drain();
				return Results.Json(new { ok = true, commands = cmds });
			}));
			app.MapPost("/api/video-overlay/status", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				VideoOverlayBus.SetStatus(json);
				return Results.Json(new { ok = true });
			});
			app.MapGet("/api/chroma-overlay/layers", (Func<IResult>)(() => Results.Json(ChromaOverlayHost.LayersJson())));
			app.MapPost("/api/win-overlay/open", (Func<IResult>)(() =>
			{
				WinScoreOverlayHost.Open(recreate: !WinScoreOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = WinScoreOverlayHost.IsOpen
				});
			}));
			app.MapPost("/api/win-overlay/close", (Func<IResult>)(() =>
			{
				WinScoreOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			}));
			app.MapGet("/api/win-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = WinScoreOverlayHost.IsOpen
			})));
			app.MapPost("/api/jar-overlay/open", (Func<IResult>)(() =>
			{
				JarOverlayHost.Open(recreate: !JarOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = JarOverlayHost.IsOpen
				});
			}));
			app.MapPost("/api/jar-overlay/close", (Func<IResult>)(() =>
			{
				JarOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			}));
			app.MapGet("/api/jar-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = JarOverlayHost.IsOpen
			})));
			app.MapPost("/api/win-pad/open", (Func<IResult>)(() =>
			{
				WinPadHost.Open(recreate: !WinPadHost.IsOpen);
				return Results.Json(new { ok = true, open = WinPadHost.IsOpen });
			}));
			app.MapPost("/api/win-pad/close", (Func<IResult>)(() =>
			{
				WinPadHost.ClosePad();
				return Results.Json(new { ok = true, open = false });
			}));
			app.MapGet("/api/win-pad/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = WinPadHost.IsOpen
			})));
			app.MapGet("/api/agency/creators", (Func<IResult>)(() =>
			{
				try
				{
					string userPath = Path.Combine(AppPaths.UserDataDir, "creators-snapshot.json");
					string bundled = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "agency", "creators-snapshot.json");
					string path = File.Exists(userPath) ? userPath : bundled;
					if (!File.Exists(path))
					{
						return Results.NotFound(new { ok = false, error = "creators snapshot missing" });
					}
					string json = File.ReadAllText(path);
					return Results.Content(json, "application/json");
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			}));
			app.MapGet("/api/agency/pastlive-archive", (Func<IResult>)(() =>
			{
				try
				{
					string userArchive = Path.Combine(AppPaths.UserDataDir, "creators-pastlive-archive.json");
					string bundledArchive = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "agency", "all-creators-pastlive.json");
					string path = File.Exists(userArchive) ? userArchive : bundledArchive;
					if (!File.Exists(path))
						return Results.NotFound(new { ok = false, error = "pastlive archive missing" });
					return Results.Content(File.ReadAllText(path), "application/json");
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			}));
			app.MapPost("/api/agency/creators/sync", async (HttpRequest request) =>
			{
				try
				{
					string? day = request.Query["day"].FirstOrDefault()
						?? request.Headers["X-Agency-Day"].FirstOrDefault();
					await AgencyBackstageSyncHost.SyncFullAsync(day);
					string userPath = Path.Combine(AppPaths.UserDataDir, "creators-snapshot.json");
					string bundled = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "agency", "creators-snapshot.json");
					string path = File.Exists(userPath) ? userPath : bundled;
					if (!File.Exists(path))
					{
						return Results.NotFound(new { ok = false, error = "creators snapshot missing" });
					}
					if (!string.IsNullOrWhiteSpace(AgencyBackstageSyncHost.LastError)
						&& AgencyBackstageSyncHost.LastOkUtc == DateTime.MinValue)
					{
						return Results.BadRequest(new
						{
							ok = false,
							error = AgencyBackstageSyncHost.LastError,
							lastError = AgencyBackstageSyncHost.LastError
						});
					}
					return Results.Content(File.ReadAllText(path), "application/json");
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = ex.Message,
						lastError = AgencyBackstageSyncHost.LastError
					});
				}
			});
			app.MapGet("/api/agency/creators/sync/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				lastOkUtc = AgencyBackstageSyncHost.LastOkUtc == DateTime.MinValue ? null : AgencyBackstageSyncHost.LastOkUtc.ToString("o"),
				lastError = AgencyBackstageSyncHost.LastError
			})));
			app.MapPost("/api/agency/creators/live-poll", async () =>
			{
				try
				{
					await AgencyLivePollHost.TriggerNowAsync();
					string userPath = Path.Combine(AppPaths.UserDataDir, "creators-snapshot.json");
					string bundled = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "agency", "creators-snapshot.json");
					string path = File.Exists(userPath) ? userPath : bundled;
					if (!File.Exists(path))
					{
						return Results.NotFound(new { ok = false, error = "creators snapshot missing" });
					}
					if (!string.IsNullOrWhiteSpace(AgencyLivePollHost.LastError) && AgencyLivePollHost.LastOkUtc == DateTime.MinValue)
					{
						return Results.BadRequest(new
						{
							ok = false,
							error = AgencyLivePollHost.LastError,
							lastError = AgencyLivePollHost.LastError
						});
					}
					return Results.Content(File.ReadAllText(path), "application/json");
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = ex.Message,
						lastError = AgencyLivePollHost.LastError
					});
				}
			});
			app.MapGet("/api/agency/creators/live-poll/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				running = AgencyLivePollHost.IsRunning,
				lastOkUtc = AgencyLivePollHost.LastOkUtc == DateTime.MinValue ? null : AgencyLivePollHost.LastOkUtc.ToString("o"),
				lastError = AgencyLivePollHost.LastError
			})));
			app.MapPost("/api/agency/creators", async (HttpRequest request) =>
			{
				try
				{
					Directory.CreateDirectory(AppPaths.UserDataDir);
					string userPath = Path.Combine(AppPaths.UserDataDir, "creators-snapshot.json");
					using StreamReader reader = new StreamReader(request.Body);
					string json = await reader.ReadToEndAsync();
					await File.WriteAllTextAsync(userPath, json);
					return Results.Json(new { ok = true });
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			});
			app.MapPost("/api/agency/dashboard/open", (Func<IResult>)(() =>
			{
				CreatorDashboardHost.Open(recreate: !CreatorDashboardHost.IsOpen);
				return Results.Json(new { ok = true, open = CreatorDashboardHost.IsOpen });
			}));
			app.MapPost("/api/agency/dashboard/close", (Func<IResult>)(() =>
			{
				CreatorDashboardHost.CloseDashboard();
				return Results.Json(new { ok = true, open = false });
			}));
			app.MapGet("/api/agency/dashboard/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = CreatorDashboardHost.IsOpen
			})));
			app.MapPost("/api/roulette-overlay/open", (Func<IResult>)(() =>
			{
				// Standalone resizable chroma window — spin UI only (not tied to game HWND).
				RouletteOverlayHost.Open(
					clickThrough: false,
					mode: RouletteOverlayForm.OverlayMode.Chroma,
					recreate: !RouletteOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = RouletteOverlayHost.IsOpen,
					mode = "chroma"
				});
			}));
			app.MapPost("/api/roulette-overlay/close", (Func<IResult>)(() =>
			{
				RouletteOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			}));
			app.MapGet("/api/roulette-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = RouletteOverlayHost.IsOpen,
				lastStatus = RouletteOverlayBus.LastStatus
			})));
			app.MapPost("/api/roulette-overlay/cmd", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				RouletteOverlayBus.EnqueueRaw(json);
				return Results.Json(new { ok = true });
			});
			app.MapGet("/api/roulette-overlay/poll", (Func<IResult>)(() =>
			{
				var cmds = RouletteOverlayBus.Drain();
				return Results.Json(new { ok = true, commands = cmds });
			}));
			app.MapPost("/api/roulette-overlay/status", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				RouletteOverlayBus.SetStatus(json);
				return Results.Json(new { ok = true });
			});
			app.MapPost("/api/roulette/spin", (Func<HttpRequest, RouletteSpinService, RouletteConfigService, Task<IResult>>)async delegate(HttpRequest request, RouletteSpinService spin, RouletteConfigService roulette)
			{
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body);
					JsonElement root = doc.RootElement;
					string trigger = root.TryGetProperty("triggerGift", out JsonElement tg) ? (tg.GetString() ?? "") : "";
					string sender = root.TryGetProperty("sender", out JsonElement sd) ? (sd.GetString() ?? "ทดสอบ") : "ทดสอบ";
					int count = root.TryGetProperty("count", out JsonElement ct) && ct.TryGetInt32(out int c) ? Math.Max(1, c) : 1;
					List<RouletteOutcome> outcomes = new List<RouletteOutcome>();
					if (root.TryGetProperty("outcomes", out JsonElement arr) && arr.ValueKind == JsonValueKind.Array)
					{
						foreach (JsonElement o in arr.EnumerateArray())
						{
							string giftName = o.TryGetProperty("giftName", out JsonElement gn) ? (gn.GetString() ?? "").Trim() : "";
							if (giftName.Length == 0) continue;
							outcomes.Add(new RouletteOutcome
							{
								GiftName = giftName,
								Label = o.TryGetProperty("label", out JsonElement lb) ? (lb.GetString() ?? giftName) : giftName,
								ImageId = o.TryGetProperty("imageId", out JsonElement im) ? (im.GetString() ?? "") : ""
							});
						}
					}
					bool multiply = false;
					if (root.TryGetProperty("multiply", out JsonElement mx))
					{
						multiply = mx.ValueKind == JsonValueKind.True
							|| (mx.ValueKind == JsonValueKind.String && string.Equals(mx.GetString(), "true", StringComparison.OrdinalIgnoreCase))
							|| (mx.ValueKind == JsonValueKind.String && string.Equals(mx.GetString(), "multiply", StringComparison.OrdinalIgnoreCase));
					}
					if (root.TryGetProperty("mode", out JsonElement modeEl)
						&& string.Equals(modeEl.GetString(), "multiply", StringComparison.OrdinalIgnoreCase))
					{
						multiply = true;
					}
					if (outcomes.Count < 1 && !string.IsNullOrWhiteSpace(trigger) && roulette.TryMatch(trigger, out RouletteRule rule))
					{
						outcomes = rule.Outcomes.ToList();
						if (string.Equals(rule.Mode, "multiply", StringComparison.OrdinalIgnoreCase))
						{
							multiply = true;
						}
					}
					if (outcomes.Count < 1)
					{
						return Results.BadRequest(new { ok = false, error = "outcomes required" });
					}
					spin.Enqueue(trigger, count, sender, outcomes, multiply);
					return Results.Json(new { ok = true, queued = true });
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			});
			app.MapGet("/api/interrupt-overlay/screens", (Func<IResult>)(() =>
			{
				var screens = InterruptOverlayForm.ListScreens();
				Screen? studio = InterruptOverlayForm.FindLiveStudioScreen();
				return Results.Json(new
				{
					ok = true,
					count = screens.Count,
					liveStudioFound = studio != null,
					liveStudio = studio == null ? null : studio.DeviceName,
					screens
				});
			}));
			app.MapPost("/api/interrupt-overlay/open", (Func<HttpRequest, IResult>)((HttpRequest request) =>
			{
				int? screenIndex = null;
				if (int.TryParse(request.Query["screen"], out int screen) && screen >= 0)
				{
					screenIndex = screen;
				}
				bool avoid = true;
				if (bool.TryParse(request.Query["avoidLiveStudio"], out bool avoidParsed))
				{
					avoid = avoidParsed;
				}
				bool underStudio = true;
				if (bool.TryParse(request.Query["underLiveStudio"], out bool underParsed))
				{
					underStudio = underParsed;
				}
				bool popupMode = string.Equals(request.Query["mode"], "popup", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["popup"], "1", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["popup"], "true", StringComparison.OrdinalIgnoreCase);
				bool recreate = !InterruptOverlayHost.IsOpen;
				if (bool.TryParse(request.Query["recreate"], out bool recreateParsed))
				{
					recreate = recreateParsed;
				}
				DevLogService.Write("interrupt.open", "open requested", new
				{
					screenIndex,
					avoid,
					underStudio,
					popupMode,
					recreate,
					wasOpen = InterruptOverlayHost.IsOpen
				});
				InterruptOverlayHost.Open(
					recreate: recreate,
					screenIndex: screenIndex,
					avoidLiveStudio: avoid,
					underLiveStudio: underStudio,
					popupMode: popupMode);
				return Results.Json(new
				{
					ok = true,
					open = InterruptOverlayHost.IsOpen,
					avoidLiveStudio = avoid,
					underLiveStudio = underStudio,
					popupMode,
					screen = screenIndex,
					liveStudioFound = InterruptOverlayForm.FindLiveStudioHwnd() != IntPtr.Zero
				});
			}));
			app.MapPost("/api/interrupt-overlay/layout", (Func<HttpRequest, IResult>)((HttpRequest request) =>
			{
				bool popup = string.Equals(request.Query["mode"], "popup", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["popup"], "1", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(request.Query["popup"], "true", StringComparison.OrdinalIgnoreCase);
				int? width = null;
				int? height = null;
				if (int.TryParse(request.Query["w"], out int w) && w > 0) width = w;
				if (int.TryParse(request.Query["h"], out int h) && h > 0) height = h;
				InterruptOverlayHost.SetLayout(popup, width, height);
				return Results.Json(new { ok = true, popupMode = popup, open = InterruptOverlayHost.IsOpen });
			}));
			app.MapPost("/api/interrupt-overlay/close", (Func<IResult>)(() =>
			{
				InterruptOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			}));
			app.MapGet("/api/interrupt-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = InterruptOverlayHost.IsOpen,
				lastStatus = InterruptOverlayBus.LastStatus
			})));
			app.MapPost("/api/interrupt-overlay/cmd", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				DevLogService.Write("interrupt.cmd", "enqueue", new { json = json.Length > 240 ? json[..240] + "…" : json });
				InterruptOverlayBus.EnqueueRaw(json);
				return Results.Json(new { ok = true });
			});
			app.MapGet("/api/interrupt-overlay/poll", (Func<IResult>)(() =>
			{
				var cmds = InterruptOverlayBus.Drain();
				return Results.Json(new { ok = true, commands = cmds });
			}));
			app.MapPost("/api/interrupt-overlay/status", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				InterruptOverlayBus.SetStatus(json);
				return Results.Json(new { ok = true });
			});
			app.MapPost("/api/dev-log", async (HttpRequest request) =>
			{
				using StreamReader reader = new StreamReader(request.Body);
				string json = await reader.ReadToEndAsync();
				try
				{
					using JsonDocument doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
					JsonElement root = doc.RootElement;
					string scope = root.TryGetProperty("scope", out JsonElement s) ? (s.GetString() ?? "ui") : "ui";
					string message = root.TryGetProperty("message", out JsonElement m) ? (m.GetString() ?? "") : "";
					string level = root.TryGetProperty("level", out JsonElement l) ? (l.GetString() ?? "info") : "info";
					object? data = null;
					if (root.TryGetProperty("data", out JsonElement d) && d.ValueKind is not JsonValueKind.Undefined and not JsonValueKind.Null)
					{
						data = JsonSerializer.Deserialize<object>(d.GetRawText());
					}
					DevLogService.Write(scope, message, data, level);
					return Results.Json(new { ok = true });
				}
				catch (Exception ex)
				{
					DevLogService.Write("dev-log", "bad payload: " + ex.Message, level: "warn");
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			});
			app.MapGet("/api/dev-log", (Func<HttpRequest, IResult>)((HttpRequest request) =>
			{
				int limit = 200;
				if (int.TryParse(request.Query["limit"], out int lim)) limit = lim;
				long after = 0;
				if (long.TryParse(request.Query["after"], out long a)) after = a;
				string? scope = request.Query["scope"].FirstOrDefault();
				var entries = DevLogService.Snapshot(limit, scope, after);
				return Results.Json(new
				{
					ok = true,
					file = DevLogService.DevLogFile,
					count = entries.Count,
					entries
				});
			}));
			app.MapPost("/api/dev-log/clear", (Func<IResult>)(() =>
			{
				DevLogService.Clear();
				DevLogService.Write("dev-log", "cleared by UI");
				return Results.Json(new { ok = true, file = DevLogService.DevLogFile });
			}));
			app.MapGet("/api/stickers/temple-escape/zip", (Func<IResult>)(() =>
			{
				string dir = Path.Combine(AppPaths.AppDir, "wwwroot", "stickers", "temple-escape");
				if (!Directory.Exists(dir))
				{
					return Results.NotFound(new { ok = false, error = "stickers missing" });
				}
				string zipPath = Path.Combine(Path.GetTempPath(), "monkeyeffect-temple-escape-stickers.zip");
				try
				{
					if (File.Exists(zipPath)) File.Delete(zipPath);
					System.IO.Compression.ZipFile.CreateFromDirectory(dir, zipPath, System.IO.Compression.CompressionLevel.Fastest, includeBaseDirectory: false);
					byte[] bytes = File.ReadAllBytes(zipPath);
					try { File.Delete(zipPath); } catch { }
					return Results.File(bytes, "application/zip", "TempleEscape-StickerSheets.zip");
				}
				catch (Exception ex)
				{
					return Results.Json(new { ok = false, error = ex.Message });
				}
			}));
			static string FileSha12(string path)
			{
				if (!File.Exists(path)) return "";
				using var sha = System.Security.Cryptography.SHA256.Create();
				using FileStream fs = File.OpenRead(path);
				byte[] hash = sha.ComputeHash(fs);
				return Convert.ToHexString(hash).Substring(0, 12);
			}
			app.MapGet("/api/temple-escape/defaults/status", (Func<IResult>)(() =>
			{
				string packDir = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "temple-escape", "SaveGames");
				string gameDir = Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"Temple_Escape", "Saved", "SaveGames");
				string[] names = { "CusFucSetting.sav", "PHBSave.sav", "MuztoMod.sav" };
				var files = names.Select(n =>
				{
					string packPath = Path.Combine(packDir, n);
					string gamePath = Path.Combine(gameDir, n);
					bool bundled = File.Exists(packPath);
					bool installed = File.Exists(gamePath);
					string packHash = bundled ? FileSha12(packPath) : "";
					string gameHash = installed ? FileSha12(gamePath) : "";
					return new
					{
						file = n,
						bundled,
						installed,
						matchesPack = bundled && installed && string.Equals(packHash, gameHash, StringComparison.OrdinalIgnoreCase),
						packBytes = bundled ? new FileInfo(packPath).Length : 0L,
						installedBytes = installed ? new FileInfo(gamePath).Length : 0L,
						packHash,
						gameHash
					};
				}).ToArray();
				bool gameRunning = Process.GetProcessesByName("Temple_Escape").Length > 0
					|| Process.GetProcessesByName("TempleEscape").Length > 0;
				return Results.Json(new
				{
					ok = true,
					packDir,
					gameDir,
					files,
					ready = files.All(f => f.bundled),
					applied = files.All(f => f.matchesPack),
					installedAny = files.Any(f => f.installed),
					gameRunning
				});
			}));
			app.MapPost("/api/temple-escape/defaults/apply", (Func<IResult>)(() =>
			{
				string packDir = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "temple-escape", "SaveGames");
				string[] names = { "CusFucSetting.sav", "PHBSave.sav", "MuztoMod.sav" };
				if (!Directory.Exists(packDir) || !names.All(n => File.Exists(Path.Combine(packDir, n))))
				{
					return Results.NotFound(new { ok = false, error = "defaults pack missing (CusFucSetting / PHBSave / MuztoMod)" });
				}
				bool gameRunning = Process.GetProcessesByName("Temple_Escape").Length > 0
					|| Process.GetProcessesByName("TempleEscape").Length > 0;
				string gameDir = Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"Temple_Escape", "Saved", "SaveGames");
				Directory.CreateDirectory(gameDir);
				int copied = 0;
				var copiedFiles = new List<string>();
				foreach (string name in names)
				{
					string src = Path.Combine(packDir, name);
					string dest = Path.Combine(gameDir, name);
					File.Copy(src, dest, overwrite: true);
					copied++;
					copiedFiles.Add(name);
				}
				string cfgSrc = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "temple-escape", "Config", "Windows", "GameUserSettings.ini");
				if (File.Exists(cfgSrc))
				{
					string cfgDestDir = Path.Combine(
						Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
						"Temple_Escape", "Saved", "Config", "Windows");
					Directory.CreateDirectory(cfgDestDir);
					File.Copy(cfgSrc, Path.Combine(cfgDestDir, "GameUserSettings.ini"), overwrite: true);
				}
				return Results.Json(new { ok = true, copied, files = copiedFiles, gameDir, gameRunning });
			}));
			app.MapPost("/api/temple-escape/defaults/export", (Func<IResult>)(() =>
			{
				string gameDir = Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"Temple_Escape", "Saved", "SaveGames");
				string packDir = Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "temple-escape", "SaveGames");
				Directory.CreateDirectory(packDir);
				string[] names = { "CusFucSetting.sav", "PHBSave.sav", "MuztoMod.sav" };
				int copied = 0;
				var missing = new List<string>();
				foreach (string name in names)
				{
					string src = Path.Combine(gameDir, name);
					if (!File.Exists(src))
					{
						missing.Add(name);
						continue;
					}
					File.Copy(src, Path.Combine(packDir, name), overwrite: true);
					copied++;
				}
				return Results.Json(new { ok = true, copied, missing, packDir });
			}));
			app.MapMethods("/api/video-cache/{id}", new[] { "PUT" }, async (string id, HttpRequest request) =>
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest(new { ok = false, error = "invalid id" });
				}
				string dir = AppPaths.MediaCacheDir;
				Directory.CreateDirectory(dir);
				string path = Path.Combine(dir, id + ".mp4");
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new { ok = true, id, bytes = new FileInfo(path).Length });
			});
			// Default music pack (bundled in Setup for new installs)
			static string DefaultsMusicDir() => Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "music");
			static string DefaultsMusicFilesDir() => Path.Combine(DefaultsMusicDir(), "files");
			static bool IsSafeMediaId(string id) =>
				!string.IsNullOrWhiteSpace(id) && id.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && !id.Contains("..", StringComparison.Ordinal);
			app.MapGet("/api/defaults/music/export-flag", (Func<IResult>)(() =>
			{
				string flag = Path.Combine(AppPaths.AppDir, "EXPORT_MUSIC_PACK.flag");
				return Results.Json(new { ok = true, export = File.Exists(flag) });
			}));
			app.MapPost("/api/defaults/music/export-flag/clear", (Func<IResult>)(() =>
			{
				string flag = Path.Combine(AppPaths.AppDir, "EXPORT_MUSIC_PACK.flag");
				try
				{
					if (File.Exists(flag)) File.Delete(flag);
				}
				catch
				{
				}
				return Results.Json(new { ok = true });
			}));
			app.MapMethods("/api/defaults/music/config", new[] { "PUT" }, async (HttpRequest request) =>
			{
				string dir = DefaultsMusicDir();
				Directory.CreateDirectory(dir);
				string path = Path.Combine(dir, "config.json");
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new { ok = true, path, bytes = new FileInfo(path).Length });
			});
			app.MapMethods("/api/defaults/music/file/{id}", new[] { "PUT" }, async (string id, HttpRequest request) =>
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest(new { ok = false, error = "invalid id" });
				}
				string dir = DefaultsMusicFilesDir();
				Directory.CreateDirectory(dir);
				string ext = ".mp3";
				string? nameHeader = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(nameHeader))
				{
					try
					{
						string decoded = Uri.UnescapeDataString(nameHeader);
						string e = Path.GetExtension(decoded);
						if (!string.IsNullOrWhiteSpace(e) && e.Length <= 8) ext = e;
					}
					catch
					{
					}
				}
				string path = Path.Combine(dir, id + ext);
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new { ok = true, id, file = Path.GetFileName(path), bytes = new FileInfo(path).Length });
			});
			app.MapGet("/api/audio-file/{id}", (string id) =>
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest();
				}
				string? found = FindMediaAudioPath(id);
				if (found == null) return Results.NotFound();
				string ext = Path.GetExtension(found).ToLowerInvariant();
				string contentType = ext switch
				{
					".m4a" => "audio/mp4",
					".wav" => "audio/wav",
					".ogg" => "audio/ogg",
					".aac" => "audio/aac",
					".mp4" => "audio/mp4",
					".png" => "image/png",
					".jpg" or ".jpeg" => "image/jpeg",
					".webp" => "image/webp",
					".gif" => "image/gif",
					_ => "audio/mpeg"
				};
				return Results.File(found, contentType, enableRangeProcessing: true);
			});
			// Play media outside WebView (music keeps working while main window is minimized).
			app.MapPost("/api/media/play", async (HttpRequest request, CancellationToken ct) =>
			{
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body, cancellationToken: ct);
					JsonElement root = doc.RootElement;
					string id = root.TryGetProperty("id", out JsonElement idEl) ? (idEl.GetString() ?? "").Trim() : "";
					if (!IsSafeMediaId(id)) return Results.BadRequest(new { ok = false, error = "invalid id" });
					string? path = FindMediaAudioPath(id);
					if (path == null) return Results.NotFound(new { ok = false, error = "file not found" });
					double startSec = root.TryGetProperty("startSec", out JsonElement sEl) && sEl.TryGetDouble(out double s) ? Math.Max(0, s) : 0;
					double? durationSec = null;
					if (root.TryGetProperty("durationSec", out JsonElement dEl) && dEl.TryGetDouble(out double d) && d > 0)
					{
						durationSec = d;
					}
					double volume = root.TryGetProperty("volume", out JsonElement vEl) && vEl.TryGetDouble(out double v) ? v : 0.8;
					(bool ok, string? error) = await HostMediaPlayer.PlayAsync(path, startSec, durationSec, volume, ct);
					return Results.Json(new { ok, played = ok, cancelled = error == "cancelled", error, path = Path.GetFileName(path) });
				}
				catch (Exception ex)
				{
					return Results.BadRequest(new { ok = false, error = ex.Message });
				}
			});
			app.MapPost("/api/media/stop", (Func<IResult>)(() =>
			{
				HostMediaPlayer.Stop();
				return Results.Json(new { ok = true });
			}));
			app.MapPost("/api/media/duck", async (HttpRequest request) =>
			{
				double factor = 1;
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body);
					if (doc.RootElement.TryGetProperty("factor", out JsonElement f) && f.TryGetDouble(out double v))
					{
						factor = v;
					}
				}
				catch
				{
				}
				HostMediaPlayer.SetDuck(factor);
				return Results.Json(new { ok = true, factor = Math.Clamp(factor, 0, 1) });
			});
			static string? FindMediaAudioPath(string id)
			{
				string[] roots =
				{
					AppPaths.RoulettePortableFilesDir,
					AppPaths.MediaCacheDir,
					DefaultsMusicFilesDir(),
					Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "roulette", "files"),
					Path.Combine(AppPaths.AppDir, "media-cache")
				};
				string[] exts = { "", ".mp3", ".m4a", ".wav", ".ogg", ".aac", ".mp4", ".png", ".jpg", ".jpeg", ".webp", ".gif" };
				foreach (string root in roots)
				{
					if (!Directory.Exists(root)) continue;
					foreach (string ext in exts)
					{
						string candidate = Path.Combine(root, id + ext);
						if (File.Exists(candidate)) return candidate;
					}
					string exact = Path.Combine(root, id);
					if (File.Exists(exact)) return exact;
				}
				return null;
			}
			app.MapMethods("/api/audio-cache/{id}", new[] { "PUT" }, async (string id, HttpRequest request) =>
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest(new { ok = false, error = "invalid id" });
				}
				string dir = AppPaths.MediaCacheDir;
				Directory.CreateDirectory(dir);
				string ext = ".mp3";
				string? nameHeader = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(nameHeader))
				{
					try
					{
						string decoded = Uri.UnescapeDataString(nameHeader);
						string e = Path.GetExtension(decoded);
						if (!string.IsNullOrWhiteSpace(e) && e.Length <= 8) ext = e;
					}
					catch
					{
					}
				}
				string path = Path.Combine(dir, id + ext);
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				if (id.StartsWith("rlimg_", StringComparison.OrdinalIgnoreCase)
					|| ext is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif")
				{
					RouletteConfigService.MirrorUploadedImage(path, id);
				}
				return Results.Json(new { ok = true, id, bytes = new FileInfo(path).Length });
			});
			static string DefaultsInterruptDir() =>
				Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "interrupt");
			static string DefaultsInterruptFilesDir() =>
				Path.Combine(DefaultsInterruptDir(), "files");
			app.MapGet("/api/defaults/interrupt/export-flag", (Func<IResult>)(() =>
			{
				string flag = Path.Combine(AppPaths.AppDir, "EXPORT_INTERRUPT_PACK.flag");
				return Results.Json(new { ok = true, export = File.Exists(flag) });
			}));
			app.MapPost("/api/defaults/interrupt/export-flag/clear", (Func<IResult>)(() =>
			{
				string flag = Path.Combine(AppPaths.AppDir, "EXPORT_INTERRUPT_PACK.flag");
				try
				{
					if (File.Exists(flag)) File.Delete(flag);
				}
				catch
				{
				}
				return Results.Json(new { ok = true });
			}));
			app.MapMethods("/api/defaults/interrupt/config", new[] { "PUT" }, async (HttpRequest request) =>
			{
				string dir = DefaultsInterruptDir();
				Directory.CreateDirectory(dir);
				string path = Path.Combine(dir, "config.json");
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new { ok = true, path, bytes = new FileInfo(path).Length });
			});
			app.MapMethods("/api/defaults/interrupt/file/{id}", new[] { "PUT" }, async (string id, HttpRequest request) =>
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest(new { ok = false, error = "invalid id" });
				}
				string dir = DefaultsInterruptFilesDir();
				Directory.CreateDirectory(dir);
				string ext = ".mp4";
				string? nameHeader = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(nameHeader))
				{
					try
					{
						string decoded = Uri.UnescapeDataString(nameHeader);
						string e = Path.GetExtension(decoded);
						if (!string.IsNullOrWhiteSpace(e) && e.Length <= 8) ext = e;
					}
					catch
					{
					}
				}
				string path = Path.Combine(dir, id + ext);
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new { ok = true, id, file = Path.GetFileName(path), bytes = new FileInfo(path).Length });
			});
			app.MapGet("/api/video-file/{id}", (string id) =>
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest();
				}
				string path = Path.Combine(AppPaths.MediaCacheDir, id + ".mp4");
				// legacy install-dir / wwwroot cache fallback
				string appDirCache = Path.Combine(AppPaths.AppDir, "media-cache", id + ".mp4");
				string legacy = Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache", id);
				string legacyMp4 = legacy + ".mp4";
				string bundled = Path.Combine(DefaultsInterruptFilesDir(), id + ".mp4");
				string? file = File.Exists(path)
					? path
					: (File.Exists(appDirCache) ? appDirCache
					: (File.Exists(legacyMp4) ? legacyMp4
					: (File.Exists(legacy) ? legacy
					: (File.Exists(bundled) ? bundled : null))));
				if (file == null)
				{
					return Results.NotFound();
				}
				return Results.File(file, "video/mp4", enableRangeProcessing: true);
			});
			app.MapGet("/media-cache/{id}", (string id) =>
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest();
				}
				string name = id.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) ? id : id + ".mp4";
				string path = Path.Combine(AppPaths.MediaCacheDir, name);
				string appDirCache = Path.Combine(AppPaths.AppDir, "media-cache", name);
				string legacyDir = Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache");
				string legacy = Path.Combine(legacyDir, id);
				string legacyMp4 = Path.Combine(legacyDir, name);
				string? file = File.Exists(path)
					? path
					: (File.Exists(appDirCache) ? appDirCache
					: (File.Exists(legacyMp4) ? legacyMp4 : (File.Exists(legacy) ? legacy : null)));
				if (file == null)
				{
					return Results.NotFound();
				}
				return Results.File(file, "video/mp4", enableRangeProcessing: true);
			});
			app.MapDelete("/api/video-cache/{id}", (string id) =>
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest(new { ok = false, error = "invalid id" });
				}
				foreach (string p in new[]
				{
					Path.Combine(AppPaths.MediaCacheDir, id + ".mp4"),
					Path.Combine(AppPaths.AppDir, "media-cache", id + ".mp4"),
					Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache", id),
					Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache", id + ".mp4")
				})
				{
					if (File.Exists(p))
					{
						File.Delete(p);
					}
				}
				return Results.Json(new { ok = true });
			});
			TtsProcessHost.EnsureStarted();
			_ = Task.Run(async () =>
			{
				try { await TtsProcessHost.WaitUntilReadyAsync(12000); }
				catch { /* logged inside */ }
			});
			app.StartAsync().GetAwaiter().GetResult();
			Application.Run(new MainForm());
		}
		catch (Exception ex2)
		{
			MessageBox.Show(ex2.Message, "Monkeyeffect     ", MessageBoxButtons.OK, MessageBoxIcon.Hand);
		}
		finally
		{
			try { TtsProcessHost.Stop(); } catch { }
			try
			{
				if (app != null)
				{
					app.StopAsync().GetAwaiter().GetResult();
					app.DisposeAsync().AsTask().GetAwaiter()
						.GetResult();
				}
			}
			catch
			{
			}
		}
		static bool IsPortFree(int port)
		{
			try
			{
				using TcpListener tcpListener = new TcpListener(IPAddress.Loopback, port);
				tcpListener.Start();
				tcpListener.Stop();
				return true;
			}
			catch
			{
				return false;
			}
		}

		static void TryClosePreviousInstance()
		{
			int currentPid = Environment.ProcessId;
			string[] names = { "TempleGiftRelay", "Monkeyeffect-Setup" };
			foreach (string name in names)
			{
				foreach (Process process in Process.GetProcessesByName(name))
				{
					try
					{
						if (process.Id == currentPid) continue;
						process.Kill(entireProcessTree: true);
						process.WaitForExit(5000);
					}
					catch { }
				}
			}
			ForceKillByPort(3847);
			ForceKillByPort(12922);
			ForceKillByPort(3848);
		}

		static void ForceKillByPort(int port)
		{
			try
			{
				ProcessStartInfo psi = new ProcessStartInfo
				{
					FileName = "powershell.exe",
					Arguments =
						$"-NoProfile -Command \"Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ if ($_.OwningProcess -ne {Environment.ProcessId}) {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }} }}\"",
					CreateNoWindow = true,
					UseShellExecute = false
				};
				using Process? p = Process.Start(psi);
				p?.WaitForExit(8000);
			}
			catch { }

			try
			{
				ProcessStartInfo psi2 = new ProcessStartInfo
				{
					FileName = "cmd.exe",
					Arguments = $"/c for /f \"tokens=5\" %a in ('netstat -ano ^| findstr \":{port}\" ^| findstr LISTENING') do if not %a=={Environment.ProcessId} taskkill /F /PID %a",
					CreateNoWindow = true,
					UseShellExecute = false
				};
				using Process? p2 = Process.Start(psi2);
				p2?.WaitForExit(8000);
			}
			catch { }
		}

		static string DescribePortHolders(int port)
		{
			try
			{
				ProcessStartInfo psi = new ProcessStartInfo
				{
					FileName = "powershell.exe",
					Arguments =
						$"-NoProfile -Command \"$c=Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue; if(-not $c){{'port {port}: (none)'}} else {{ $c | ForEach-Object {{ $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; 'port {port}: PID '+$_.OwningProcess+' '+($p.ProcessName) }} }}\"",
					CreateNoWindow = true,
					UseShellExecute = false,
					RedirectStandardOutput = true
				};
				using Process? p = Process.Start(psi);
				if (p == null) return $"port {port}: unknown";
				string output = p.StandardOutput.ReadToEnd();
				p.WaitForExit(5000);
				return string.IsNullOrWhiteSpace(output) ? $"port {port}: unknown" : output.Trim();
			}
			catch
			{
				return $"port {port}: unknown";
			}
		}
	}
}
