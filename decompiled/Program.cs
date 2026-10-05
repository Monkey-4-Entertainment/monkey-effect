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
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
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
			Ipv4Network.ApplyAtStartup();
			AppPaths.ValidatePortableLayout();
		}
		catch (Exception ex)
		{
			MessageBox.Show(ex.Message + "\n\nLog: " + AppPaths.LogFile, "Monkeyeffect", MessageBoxButtons.OK, MessageBoxIcon.Hand);
			return;
		}
		string appDir = AppPaths.AppDir;
		for (int i = 0; i < 8; i++)
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
			string text = DescribePortHolders(3847) + "\n" + DescribePortHolders(12922);
			if (MessageBox.Show("พอร\u0e4cตย\u0e31งถ\u0e39กใช\u0e49งานอย\u0e39\u0e48 ระบบจะบ\u0e31งค\u0e31บป\u0e34ดโปรเซสท\u0e35\u0e48ค\u0e49างแล\u0e49วเป\u0e34ดใหม\u0e48\n\n" + text + "\n\nกด Yes เพ\u0e37\u0e48อบ\u0e31งค\u0e31บเป\u0e34ด", "Monkeyeffect", MessageBoxButtons.YesNo, MessageBoxIcon.Exclamation) != DialogResult.Yes)
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
			MessageBox.Show("ย\u0e31งเป\u0e34ดไม\u0e48ได\u0e49 เพราะพอร\u0e4cต 3847 ถ\u0e39กจองอย\u0e39\u0e48\n\n" + DescribePortHolders(3847) + "\n\nเป\u0e34ด Task Manager แล\u0e49ว End task ตามช\u0e37\u0e48อด\u0e49านบน แล\u0e49วเป\u0e34ด Monkeyeffect ใหม\u0e48", "Monkeyeffect", MessageBoxButtons.OK, MessageBoxIcon.Hand);
			return;
		}
		if (!IsPortFree(12922))
		{
			MessageBox.Show("พอร\u0e4cต 12922 ถ\u0e39กใช\u0e49งานอย\u0e39\u0e48 (ม\u0e31กเป\u0e47น ycLive)\n\nป\u0e34ด ycLive ให\u0e49หมด แล\u0e49วเป\u0e34ด Monkeyeffect ใหม\u0e48\n\n" + DescribePortHolders(12922), "Monkeyeffect", MessageBoxButtons.OK, MessageBoxIcon.Hand);
			return;
		}
		if (!IsPortFree(15500))
		{
			MessageBox.Show("พอร\u0e4cต 15500 ถ\u0e39กใช\u0e49แล\u0e49ว — WebSocket เกมอาจใช\u0e49ไม\u0e48ได\u0e49", "Monkeyeffect", MessageBoxButtons.OK, MessageBoxIcon.Exclamation);
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
			webApplicationBuilder.Services.AddSingleton<MemberDbService>();
			webApplicationBuilder.Services.AddSingleton<LiveStatsOverlayService>();
			webApplicationBuilder.Services.AddSingleton<PhotoPrintService>();
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
				OnPrepareResponse = delegate(StaticFileResponseContext ctx)
				{
					string name = ctx.File.Name;
					if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".css", StringComparison.OrdinalIgnoreCase))
					{
						ctx.Context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
						ctx.Context.Response.Headers["Pragma"] = "no-cache";
						ctx.Context.Response.Headers["Expires"] = "0";
					}
				}
			});
			app.MapGet("/livemsg", (Func<LocalLiveHttpService, IResult>)((LocalLiveHttpService live) => Results.Content(live.SerializeLiveMsgResponse(), "application/json; charset=utf-8")));
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
			app.MapGet("/avatar-cache/{fileName}", (Func<string, AvatarCacheService, IResult>)((string fileName, AvatarCacheService avatars) => avatars.TryGetFile(fileName, out string fullPath, out string contentType) ? Results.File(fullPath, contentType) : Results.NotFound()));
			app.MapGet("/api/avatar", (Func<HttpRequest, AvatarCacheService, CancellationToken, Task<IResult>>)async delegate(HttpRequest request, AvatarCacheService avatars, CancellationToken ct)
			{
				string text2 = (request.Query["url"].ToString() ?? "").Trim();
				if (string.IsNullOrWhiteSpace(text2) || text2.Length > 2000)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "url required"
					});
				}
				bool flag = text2.StartsWith("http://127.0.0.1:12922/avatar-cache/", StringComparison.OrdinalIgnoreCase) || text2.StartsWith("http://localhost:12922/avatar-cache/", StringComparison.OrdinalIgnoreCase) || text2.StartsWith("/avatar-cache/", StringComparison.OrdinalIgnoreCase);
				bool flag2 = text2.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || text2.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
				if (!flag && !flag2)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid url"
					});
				}
				if (flag && avatars.TryGetLocalPath(text2.StartsWith("/") ? ("http://127.0.0.1:12922" + text2) : text2, out string fullPath) && File.Exists(fullPath) && new FileInfo(fullPath).Length > 64)
				{
					return Results.File(fullPath, "image/png");
				}
				if (!flag2)
				{
					return Results.NotFound();
				}
				string fullPath2;
				return (avatars.TryGetLocalPath(await avatars.EnsureLocalUrlAsync(text2, ct), out fullPath2) && File.Exists(fullPath2) && new FileInfo(fullPath2).Length > 64) ? Results.File(fullPath2, "image/png") : Results.NotFound();
			});
			app.MapGet("/api/status", (Func<RelayState, LocalLiveHttpService, HttpRequest, IResult>)delegate(RelayState state, LocalLiveHttpService live, HttpRequest request)
			{
				StatusDto statusDto = state.ToStatus();
				bool flag = string.Equals(request.Query["debug"], "1", StringComparison.OrdinalIgnoreCase);
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
					lastServed = (flag ? live.LastServedJson : null)
				});
			});
			app.MapGet("/api/members/status", (Func<MemberDbService, IResult>)((MemberDbService members) => Results.Json(members.Status())));
			app.MapPost("/api/members/sync-folder", (Func<HttpRequest, MemberDbService, Task<IResult>>)async delegate(HttpRequest request, MemberDbService members)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement value;
				string syncFolder = (jsonDocument.RootElement.TryGetProperty("path", out value) ? (value.GetString() ?? "") : "");
				object obj3 = members.SetSyncFolder(syncFolder);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : 400));
			});
			app.MapPost("/api/members/register", (Func<HttpRequest, HttpResponse, MemberDbService, Task<IResult>>)async delegate(HttpRequest request, HttpResponse response, MemberDbService members)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string username = (rootElement.TryGetProperty("username", out value) ? (value.GetString() ?? "") : "");
				JsonElement value2;
				string password = (rootElement.TryGetProperty("password", out value2) ? (value2.GetString() ?? "") : "");
				JsonElement value3;
				string displayName = (rootElement.TryGetProperty("displayName", out value3) ? (value3.GetString() ?? "") : "");
				object obj3 = members.Register(username, password, displayName);
				int num = members.AuthStatusCode(obj3);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				if (valueOrDefault && members.TryExtractToken(obj3, out string token))
				{
					members.WriteSessionCookie(response, token);
				}
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : ((num == 200) ? 400 : num)));
			});
			app.MapPost("/api/members/login", (Func<HttpRequest, HttpResponse, MemberDbService, Task<IResult>>)async delegate(HttpRequest request, HttpResponse response, MemberDbService members)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string username = (rootElement.TryGetProperty("username", out value) ? (value.GetString() ?? "") : "");
				JsonElement value2;
				string password = (rootElement.TryGetProperty("password", out value2) ? (value2.GetString() ?? "") : "");
				object obj3 = members.Login(username, password);
				int num = members.AuthStatusCode(obj3);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				if (valueOrDefault && members.TryExtractToken(obj3, out string token))
				{
					members.WriteSessionCookie(response, token);
				}
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : ((num == 200) ? 400 : num)));
			});
			app.MapPost("/api/members/logout", (Func<HttpRequest, HttpResponse, MemberDbService, IResult>)delegate(HttpRequest request, HttpResponse response, MemberDbService members)
			{
				object data = members.Logout(request);
				members.ClearSessionCookie(response);
				return Results.Json(data);
			});
			app.MapGet("/api/members/me", (Func<HttpRequest, MemberDbService, IResult>)delegate(HttpRequest request, MemberDbService members)
			{
				object obj3 = members.Me(request);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : 401));
			});
			app.MapGet("/api/members/accounts", (Func<HttpRequest, MemberDbService, IResult>)delegate(HttpRequest request, MemberDbService members)
			{
				object obj3 = members.ListAccounts(request);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					403 => 403,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapPost("/api/members/accounts/{id}/enabled", (Func<string, HttpRequest, MemberDbService, Task<IResult>>)async delegate(string id, HttpRequest request, MemberDbService members)
			{
				bool enabled = true;
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					if (jsonDocument.RootElement.TryGetProperty("enabled", out var value))
					{
						enabled = value.ValueKind == JsonValueKind.True || (value.ValueKind == JsonValueKind.String && value.GetString() == "true");
					}
				}
				catch
				{
				}
				object obj4 = members.SetAccountEnabled(request, id, enabled);
				bool valueOrDefault = obj4.GetType().GetProperty("ok")?.GetValue(obj4) as bool? == true;
				int num = members.AuthStatusCode(obj4);
				return Results.Json(obj4, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					404 => 404,
					403 => 403,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapPost("/api/members/accounts", (Func<HttpRequest, MemberDbService, Task<IResult>>)async delegate(HttpRequest request, MemberDbService members)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string username = (rootElement.TryGetProperty("username", out value) ? (value.GetString() ?? "") : "");
				JsonElement value2;
				string password = (rootElement.TryGetProperty("password", out value2) ? (value2.GetString() ?? "") : "");
				JsonElement value3;
				string displayName = (rootElement.TryGetProperty("displayName", out value3) ? (value3.GetString() ?? "") : "");
				bool enabled = true;
				if (rootElement.TryGetProperty("enabled", out var value4))
				{
					enabled = value4.ValueKind != JsonValueKind.False;
				}
				object obj3 = members.AdminCreateAccount(request, username, password, displayName, enabled);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					403 => 403,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapPut("/api/members/accounts/{id}", (Func<string, HttpRequest, MemberDbService, Task<IResult>>)async delegate(string id, HttpRequest request, MemberDbService members)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string displayName = (rootElement.TryGetProperty("displayName", out value) ? value.GetString() : null);
				JsonElement value2;
				string password = (rootElement.TryGetProperty("password", out value2) ? value2.GetString() : null);
				bool? enabled = null;
				if (rootElement.TryGetProperty("enabled", out var value3))
				{
					if (value3.ValueKind == JsonValueKind.True)
					{
						enabled = true;
					}
					else if (value3.ValueKind == JsonValueKind.False)
					{
						enabled = false;
					}
				}
				object obj3 = members.AdminUpdateAccount(request, id, displayName, password, enabled);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					404 => 404,
					403 => 403,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapDelete("/api/members/accounts/{id}", (Func<string, HttpRequest, MemberDbService, IResult>)delegate(string id, HttpRequest request, MemberDbService members)
			{
				object obj3 = members.AdminDeleteAccount(request, id);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					404 => 404,
					403 => 403,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapPut("/api/members/me", (Func<HttpRequest, MemberDbService, Task<IResult>>)async delegate(HttpRequest request, MemberDbService members)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string displayName = (rootElement.TryGetProperty("displayName", out value) ? value.GetString() : null);
				JsonElement value2;
				string password = (rootElement.TryGetProperty("password", out value2) ? value2.GetString() : null);
				object obj3 = members.UpdateMyProfile(request, displayName, password);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : ((num == 401) ? 401 : 400)));
			});
			app.MapGet("/api/members/records", (Func<HttpRequest, MemberDbService, IResult>)delegate(HttpRequest request, MemberDbService members)
			{
				string q = request.Query["q"].ToString() ?? "";
				string asMemberId = request.Query["as"].ToString() ?? "";
				object obj3 = members.ListRecords(request, q, asMemberId);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : ((num == 401) ? 401 : 400)));
			});
			app.MapPost("/api/members/records", (Func<HttpRequest, MemberDbService, Task<IResult>>)async delegate(HttpRequest request, MemberDbService members)
			{
				object obj3 = members.UpsertRecord(request, (await JsonSerializer.DeserializeAsync<MemberRecordInput>(request.Body, new JsonSerializerOptions
				{
					PropertyNameCaseInsensitive = true
				})) ?? new MemberRecordInput(), null);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : ((num == 401) ? 401 : 400)));
			});
			app.MapPut("/api/members/records/{id}", (Func<string, HttpRequest, MemberDbService, Task<IResult>>)async delegate(string id, HttpRequest request, MemberDbService members)
			{
				object obj3 = members.UpsertRecord(request, (await JsonSerializer.DeserializeAsync<MemberRecordInput>(request.Body, new JsonSerializerOptions
				{
					PropertyNameCaseInsensitive = true
				})) ?? new MemberRecordInput(), id);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					404 => 404,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapDelete("/api/members/records/{id}", (Func<string, HttpRequest, MemberDbService, IResult>)delegate(string id, HttpRequest request, MemberDbService members)
			{
				object obj3 = members.DeleteRecord(request, id);
				bool valueOrDefault = obj3.GetType().GetProperty("ok")?.GetValue(obj3) as bool? == true;
				int num = members.AuthStatusCode(obj3);
				return Results.Json(obj3, (JsonSerializerOptions?)null, (string?)null, (int?)(valueOrDefault ? 200 : (num switch
				{
					404 => 404,
					401 => 401,
					_ => 400,
				})));
			});
			app.MapGet("/api/live-stats", (Func<LiveStatsOverlayService, RelayState, HttpResponse, IResult>)delegate(LiveStatsOverlayService stats, RelayState state, HttpResponse response)
			{
				response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
				response.Headers["Pragma"] = "no-cache";
				response.Headers["Access-Control-Allow-Origin"] = "*";
				return Results.Json(stats.ToSnapshot(state.TikTokConnected, state.TikTokLive));
			});
			app.MapPost("/api/live-stats/reset", (Func<HttpRequest, LiveStatsOverlayService, RelayState, Task<IResult>>)async delegate(HttpRequest request, LiveStatsOverlayService stats, RelayState state)
			{
				bool coins = true;
				bool gifters = true;
				bool likes = false;
				bool people = false;
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					if (jsonDocument.RootElement.ValueKind == JsonValueKind.Object)
					{
						if (jsonDocument.RootElement.TryGetProperty("coins", out var value) && (value.ValueKind == JsonValueKind.False || value.ValueKind == JsonValueKind.True))
						{
							coins = value.GetBoolean();
						}
						if (jsonDocument.RootElement.TryGetProperty("gifters", out var value2) && (value2.ValueKind == JsonValueKind.False || value2.ValueKind == JsonValueKind.True))
						{
							gifters = value2.GetBoolean();
						}
						if (jsonDocument.RootElement.TryGetProperty("likes", out var value3) && (value3.ValueKind == JsonValueKind.False || value3.ValueKind == JsonValueKind.True))
						{
							likes = value3.GetBoolean();
						}
						if (jsonDocument.RootElement.TryGetProperty("people", out var value4) && (value4.ValueKind == JsonValueKind.False || value4.ValueKind == JsonValueKind.True))
						{
							people = value4.GetBoolean();
						}
						if (jsonDocument.RootElement.TryGetProperty("all", out var value5) && value5.ValueKind == JsonValueKind.True)
						{
							bool flag;
							likes = (flag = true);
							gifters = (flag = flag);
							coins = flag;
							people = true;
						}
					}
				}
				catch
				{
				}
				stats.Reset(coins, gifters, likes, people);
				return Results.Json(stats.ToSnapshot(state.TikTokConnected, state.TikTokLive));
			});
			app.MapPost("/api/live-stats/settings", (Func<HttpRequest, LiveStatsOverlayService, RelayState, Task<IResult>>)async delegate(HttpRequest request, LiveStatsOverlayService stats, RelayState state)
			{
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					if (jsonDocument.RootElement.ValueKind == JsonValueKind.Object)
					{
						stats.ApplySettings(jsonDocument.RootElement);
					}
				}
				catch
				{
				}
				return Results.Json(stats.ToSnapshot(state.TikTokConnected, state.TikTokLive));
			});
			app.MapGet("/api/photo-print/printers", (Func<PhotoPrintService, IResult>)((PhotoPrintService print) => Results.Json(print.Status())));
			app.MapGet("/api/photo-print/status", (Func<PhotoPrintService, IResult>)((PhotoPrintService print) => Results.Json(print.Status())));
			app.MapPost("/api/photo-print/clear", (Func<PhotoPrintService, IResult>)((PhotoPrintService print) => Results.Json(print.ClearQueue())));
			app.MapPost("/api/photo-print/config", (Func<HttpRequest, PhotoPrintService, Task<IResult>>)async delegate(HttpRequest request, PhotoPrintService print)
			{
				bool enabled = false;
				string printer = "";
				string giftName = "";
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					JsonElement rootElement = jsonDocument.RootElement;
					if (rootElement.TryGetProperty("enabled", out var value))
					{
						enabled = value.ValueKind == JsonValueKind.True || (value.ValueKind == JsonValueKind.String && value.GetString() == "true");
					}
					if (rootElement.TryGetProperty("printer", out var value2))
					{
						printer = value2.GetString() ?? "";
					}
					if (rootElement.TryGetProperty("giftName", out var value3))
					{
						giftName = value3.GetString() ?? "";
					}
				}
				catch (Exception ex3)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = ex3.Message
					});
				}
				return Results.Json(print.ApplyConfig(enabled, printer, giftName));
			});
			app.MapPost("/api/photo-print", (Func<HttpRequest, PhotoPrintService, Task<IResult>>)async delegate(HttpRequest request, PhotoPrintService print)
			{
				string nick = "";
				string user = "";
				string avatarUrl = "";
				string gift = "";
				string printer = "";
				int copies = 1;
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					JsonElement rootElement = jsonDocument.RootElement;
					if (rootElement.ValueKind == JsonValueKind.Object)
					{
						if (rootElement.TryGetProperty("nick", out var value))
						{
							nick = value.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("nickname", out var value2) && string.IsNullOrWhiteSpace(nick))
						{
							nick = value2.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("user", out var value3))
						{
							user = value3.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("userName", out var value4) && string.IsNullOrWhiteSpace(user))
						{
							user = value4.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("avatarUrl", out var value5))
						{
							avatarUrl = value5.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("avatar", out var value6) && string.IsNullOrWhiteSpace(avatarUrl))
						{
							avatarUrl = value6.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("gift", out var value7))
						{
							gift = value7.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("giftName", out var value8) && string.IsNullOrWhiteSpace(gift))
						{
							gift = value8.GetString() ?? "";
						}
						if (rootElement.TryGetProperty("printer", out var value9))
						{
							printer = value9.GetString() ?? "";
						}
						JsonElement value11;
						if (rootElement.TryGetProperty("copies", out var value10) && value10.ValueKind == JsonValueKind.Number)
						{
							copies = value10.GetInt32();
						}
						else if (rootElement.TryGetProperty("count", out value11) && value11.ValueKind == JsonValueKind.Number)
						{
							copies = value11.GetInt32();
						}
					}
				}
				catch (Exception ex3)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = ex3.Message
					});
				}
				return Results.Json(await print.EnqueueAsync(nick, user, avatarUrl, gift, printer, copies));
			});
			app.MapPost("/api/minecraft/rcon", (Func<HttpRequest, MinecraftRconService, CancellationToken, Task<IResult>>)async delegate(HttpRequest request, MinecraftRconService rcon, CancellationToken ct)
			{
				_ = 1;
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body);
					JsonElement rootElement = doc.RootElement;
					JsonElement value;
					string host = (rootElement.TryGetProperty("host", out value) ? (value.GetString() ?? "") : "");
					int port = 25575;
					int result;
					if (rootElement.TryGetProperty("port", out var value2) && value2.ValueKind == JsonValueKind.Number)
					{
						port = value2.GetInt32();
					}
					else if (rootElement.TryGetProperty("port", out value2) && int.TryParse(value2.GetString(), out result))
					{
						port = result;
					}
					JsonElement value3;
					string password = (rootElement.TryGetProperty("password", out value3) ? (value3.GetString() ?? "") : "");
					JsonElement value4;
					string command = (rootElement.TryGetProperty("command", out value4) ? (value4.GetString() ?? "") : "");
					MinecraftRconService.RconResult rconResult = await rcon.SendAsync(host, port, password, command, ct);
					return Results.Json(new
					{
						ok = rconResult.Ok,
						detail = rconResult.Detail
					});
				}
				catch (Exception ex3)
				{
					return Results.Json(new
					{
						ok = false,
						detail = ex3.Message
					});
				}
			});
			app.MapGet("/api/games", (Func<GameWindowService, IResult>)((GameWindowService gameWindowService) => Results.Json(new
			{
				selected = gameWindowService.GetSelection(),
				games = GameCatalog.All.Select((GameProfile g) => new
				{
					id = g.Id,
					name = g.Name,
					processNames = g.ProcessNames,
					titleContains = g.TitleContains,
					keyMapFile = g.KeyMapFile
				})
			})));
			app.MapPut("/api/games/selected", (Func<HttpRequest, GameWindowService, RelayState, KeyMapDeliveryService, RouletteConfigService, Task<IResult>>)async delegate(HttpRequest request, GameWindowService gameWindowService, RelayState state, KeyMapDeliveryService keyMap, RouletteConfigService roulette)
			{
				using StreamReader reader = new StreamReader(request.Body);
				GameSelection gameSelection = JsonSerializer.Deserialize<GameSelection>(await reader.ReadToEndAsync(), new JsonSerializerOptions
				{
					PropertyNameCaseInsensitive = true
				});
				if (gameSelection == null || string.IsNullOrWhiteSpace(gameSelection.Id))
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid selection"
					});
				}
				gameWindowService.SetSelection(gameSelection);
				keyMap.AutoActivateFromGame(gameSelection);
				roulette.BindToGame(gameSelection.Id);
				state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "Selected game: " + (state.SelectedGameName ?? gameSelection.Id)
				});
				return Results.Json(new
				{
					ok = true,
					selected = gameWindowService.GetSelection(),
					gameWindowFound = state.GameWindowFound,
					gameWindowTitle = state.GameWindowTitle
				});
			});
			app.MapPost("/api/games/user", (Func<HttpRequest, GameWindowService, KeyMapDeliveryService, RouletteConfigService, Task<IResult>>)async delegate(HttpRequest request, GameWindowService gameWindowService, KeyMapDeliveryService keyMap, RouletteConfigService roulette)
			{
				using StreamReader reader = new StreamReader(request.Body);
				string text2 = await reader.ReadToEndAsync();
				using JsonDocument jsonDocument = JsonDocument.Parse(string.IsNullOrWhiteSpace(text2) ? "{}" : text2);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string text3 = (rootElement.TryGetProperty("name", out value) ? (value.GetString() ?? "") : "");
				JsonElement value2;
				string text4 = (rootElement.TryGetProperty("processName", out value2) ? (value2.GetString() ?? "") : "");
				JsonElement value3;
				string text5 = (rootElement.TryGetProperty("windowTitle", out value3) ? (value3.GetString() ?? "") : "");
				if (string.IsNullOrWhiteSpace(text3) && string.IsNullOrWhiteSpace(text5) && string.IsNullOrWhiteSpace(text4))
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "ใส\u0e48ช\u0e37\u0e48อเกม หร\u0e37อเล\u0e37อกหน\u0e49าต\u0e48างท\u0e35\u0e48เป\u0e34ดอย\u0e39\u0e48"
					});
				}
				GameProfile gameProfile = GameCatalog.UpsertUserGame(text3, text4, text5);
				GameSelection gameSelection = new GameSelection
				{
					Id = gameProfile.Id,
					DisplayName = gameProfile.Name,
					CustomProcess = (string.IsNullOrWhiteSpace(text4) ? null : text4),
					CustomTitle = (string.IsNullOrWhiteSpace(text5) ? null : text5)
				};
				gameWindowService.SetSelection(gameSelection);
				keyMap.AutoActivateFromGame(gameSelection);
				roulette.BindToGame(gameSelection.Id);
				return Results.Json(new
				{
					ok = true,
					game = new
					{
						id = gameProfile.Id,
						name = gameProfile.Name,
						keyMapFile = gameProfile.KeyMapFile
					},
					selected = gameWindowService.GetSelection(),
					games = GameCatalog.All.Select((GameProfile g) => new
					{
						id = g.Id,
						name = g.Name,
						processNames = g.ProcessNames,
						titleContains = g.TitleContains,
						keyMapFile = g.KeyMapFile
					})
				});
			});
			app.MapGet("/api/games/windows", (Func<GameWindowService, IResult>)((GameWindowService gameWindowService) => Results.Json(new
			{
				windows = gameWindowService.ListRunningCandidates()
			})));
			app.MapPost("/api/games/close", (Func<GameWindowService, RelayState, IResult>)delegate(GameWindowService gameWindowService, RelayState state)
			{
				var (flag, num, text2, gameName) = gameWindowService.TryCloseSelectedGame();
				state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = (flag ? $"Closed all open games ({num}): {text2}" : "Close games failed — no running game process found")
				});
				return Results.Json(new
				{
					ok = flag,
					killed = num,
					detail = text2,
					gameName = gameName,
					gameWindowFound = state.GameWindowFound
				});
			});
			TtsProviderSettings.MapEndpoints(app);
            app.MapGet("/api/tts/health", (Func<CancellationToken, Task<IResult>>)async delegate(CancellationToken ct)
			{
				TtsProcessHost.EnsureStarted();
				await TtsProcessHost.WaitUntilReadyAsync(5000);
				return Results.Json(new
				{
					ok = await TtsProcessHost.IsHealthyAsync(ct),
					service = "Monkeyeffect TTS",
					via = "app-proxy",
					port = TtsProcessHost.Port
				});
			});
			app.MapMethods("/api/tts/speak", new string[2] { "POST", "OPTIONS" }, (Func<HttpRequest, CancellationToken, Task<IResult>>)async delegate(HttpRequest request, CancellationToken ct)
			{
                if (!TtsProviderSettings.IsSameOrigin(request)) return Results.Json(new { error = "Origin not allowed" }, statusCode: 403);
				if (HttpMethods.IsOptions(request.Method))
				{
					return Results.NoContent();
				}
				TtsProcessHost.EnsureStarted();
				await TtsProcessHost.WaitUntilReadyAsync();
				using MemoryStream ms = new MemoryStream();
				await request.Body.CopyToAsync(ms, ct);
				using HttpResponseMessage upstream = await TtsProcessHost.ForwardAsync(HttpMethod.Post, "/speak", ms.ToArray(), request.ContentType ?? "application/json", ct);
				byte[] array = await upstream.Content.ReadAsByteArrayAsync(ct);
				string text2 = upstream.Content.Headers.ContentType?.ToString();
				if (!upstream.IsSuccessStatusCode)
				{
					return Results.Content(Encoding.UTF8.GetString(array), text2 ?? "application/json", null, (int)upstream.StatusCode);
				}
				return Results.File(array, text2 ?? "audio/mpeg");
			});
			app.MapMethods("/api/tts/speak-play", new string[2] { "POST", "OPTIONS" }, (Func<HttpRequest, CancellationToken, Task<IResult>>)async delegate(HttpRequest request, CancellationToken ct)
			{
                if (!TtsProviderSettings.IsSameOrigin(request)) return Results.Json(new { error = "Origin not allowed" }, statusCode: 403);
				if (HttpMethods.IsOptions(request.Method))
				{
					return Results.NoContent();
				}
				TtsProcessHost.EnsureStarted();
				await TtsProcessHost.WaitUntilReadyAsync();
				using MemoryStream ms = new MemoryStream();
				await request.Body.CopyToAsync(ms, ct);
				using HttpResponseMessage upstream = await TtsProcessHost.ForwardAsync(HttpMethod.Post, "/speak-play", ms.ToArray(), request.ContentType ?? "application/json", ct);
				byte[] bytes = await upstream.Content.ReadAsByteArrayAsync(ct);
				string contentType = upstream.Content.Headers.ContentType?.ToString() ?? "application/json";
				return Results.Content(Encoding.UTF8.GetString(bytes), contentType, null, (int)upstream.StatusCode);
			});
            app.MapPost("/api/tts/cancel", async (HttpRequest request, CancellationToken ct) =>
            {
                using MemoryStream ms = new MemoryStream();
                await request.Body.CopyToAsync(ms, ct);
                using HttpResponseMessage upstream = await TtsProcessHost.ForwardAsync(
                    HttpMethod.Post, "/cancel", ms.ToArray(), "application/json", ct);
                string body = await upstream.Content.ReadAsStringAsync(ct);
                return Results.Content(body, "application/json", statusCode: (int)upstream.StatusCode);
            });
			app.MapGet("/api/version", (Func<IResult>)delegate
			{
				UpdateConfig updateConfig = AppUpdateService.LoadConfig();
				return Results.Json(new
				{
					ok = true,
					version = AppVersion.ReadInstalledVersion(),
					product = "Monkeyeffect",
					feedUrl = (updateConfig.FeedUrl ?? ""),
					autoCheck = updateConfig.AutoCheck
				});
			});
			app.MapPut("/api/update/feed", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				string text2 = await reader.ReadToEndAsync();
				string text3 = "";
				bool autoCheck = true;
				try
				{
					using JsonDocument jsonDocument = JsonDocument.Parse(string.IsNullOrWhiteSpace(text2) ? "{}" : text2);
					if (jsonDocument.RootElement.TryGetProperty("feedUrl", out var value))
					{
						text3 = value.GetString() ?? "";
					}
					JsonElement value2;
					bool flag = jsonDocument.RootElement.TryGetProperty("autoCheck", out value2);
					if (flag)
					{
						JsonValueKind valueKind = value2.ValueKind;
						bool flag2 = valueKind - 5 <= JsonValueKind.Object;
						flag = flag2;
					}
					if (flag)
					{
						autoCheck = value2.GetBoolean();
					}
				}
				catch
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid json"
					});
				}
				UpdateConfig updateConfig = AppUpdateService.LoadConfig();
				updateConfig.FeedUrl = (string.IsNullOrWhiteSpace(text3) ? AppUpdateService.ResolveDefaultFeedUrl() : text3.Trim());
				updateConfig.AutoCheck = autoCheck;
				AppUpdateService.SaveConfig(updateConfig);
				return Results.Json(new
				{
					ok = true,
					feedUrl = updateConfig.FeedUrl,
					autoCheck = updateConfig.AutoCheck
				});
			});
			app.MapPost("/api/update/check", (Func<CancellationToken, Task<IResult>>)async delegate(CancellationToken ct)
			{
				(bool, string, UpdateManifest) obj3 = await AppUpdateService.CheckAsync(ct);
				bool item = obj3.Item1;
				string item2 = obj3.Item2;
				UpdateManifest item3 = obj3.Item3;
				string text2 = AppVersion.ReadInstalledVersion();
				bool hasUpdate = item3 != null && AppVersion.Compare(item3.Version, text2) > 0;
				return Results.Json(new
				{
					ok = item,
					message = item2,
					current = text2,
					hasUpdate = hasUpdate,
					latest = ((item3 == null) ? null : new
					{
						version = item3.Version,
						notes = item3.Notes,
						zipUrl = item3.ZipUrl,
						mandatory = item3.Mandatory
					})
				});
			});
			app.MapPost("/api/update/apply", (Func<CancellationToken, Task<IResult>>)async delegate(CancellationToken ct)
			{
				var (flag, error, man) = await AppUpdateService.CheckAsync(ct);
				if (!flag || man == null)
				{
					return Results.Json(new
					{
						ok = false,
						error = error
					});
				}
				string b = AppVersion.ReadInstalledVersion();
				if (AppVersion.Compare(man.Version, b) <= 0)
				{
					return Results.Json(new
					{
						ok = false,
						error = error
					});
				}
				var (flag2, error2) = await AppUpdateService.DownloadAndStageAsync(man, null, ct);
				if (!flag2)
				{
					return Results.Json(new
					{
						ok = false,
						error = error2
					});
				}
				var (flag3, text2) = AppUpdateService.LaunchApplyAndExit();
				if (!flag3)
				{
					return Results.Json(new
					{
						ok = false,
						error = text2
					});
				}
				Task.Run(async delegate
				{
					await Task.Delay(600);
					Environment.Exit(0);
				});
				return Results.Json(new
				{
					ok = true,
					message = text2,
					version = man.Version
				});
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
			app.MapGet("/api/roulette/config", (Func<RouletteConfigService, GameWindowService, IResult>)delegate(RouletteConfigService roulette, GameWindowService gameWindowService)
			{
				roulette.BindToGame(gameWindowService.GetSelection()?.Id);
				return Results.Json(new
				{
					ok = true,
					game = roulette.ActiveGameId,
					gameName = roulette.CurrentGameName(),
					config = roulette.GetSnapshot()
				});
			});
			app.MapPut("/api/roulette/config", (Func<HttpRequest, RouletteConfigService, Task<IResult>>)async delegate(HttpRequest request, RouletteConfigService roulette)
			{
				try
				{
					RouletteConfig rouletteConfig = await JsonSerializer.DeserializeAsync<RouletteConfig>(request.Body, new JsonSerializerOptions
					{
						PropertyNameCaseInsensitive = true
					});
					if (rouletteConfig == null)
					{
						return Results.BadRequest(new
						{
							ok = false,
							error = "invalid body"
						});
					}
					roulette.Save(rouletteConfig);
					return Results.Json(new
					{
						ok = true,
						game = roulette.ActiveGameId,
						gameName = roulette.CurrentGameName(),
						config = roulette.GetSnapshot()
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
			app.MapGet("/api/roulette/export", (Func<RouletteConfigService, GameWindowService, IResult>)delegate(RouletteConfigService roulette, GameWindowService gameWindowService)
			{
				roulette.BindToGame(gameWindowService.GetSelection()?.Id);
				return Results.File(Encoding.UTF8.GetBytes(roulette.ExportPresetJson()), "application/json; charset=utf-8", roulette.ExportFileName());
			});
			app.MapPost("/api/roulette/import", (Func<HttpRequest, RouletteConfigService, Task<IResult>>)async delegate(HttpRequest request, RouletteConfigService roulette)
			{
				using StreamReader reader = new StreamReader(request.Body);
				string text2 = await reader.ReadToEndAsync();
				if (text2.TrimStart().StartsWith("{") && text2.Contains("\"text\""))
				{
					try
					{
						using JsonDocument jsonDocument = JsonDocument.Parse(text2);
						if (jsonDocument.RootElement.TryGetProperty("text", out var value) && value.ValueKind == JsonValueKind.String)
						{
							text2 = value.GetString() ?? text2;
						}
					}
					catch
					{
					}
				}
				string text3 = request.Query["file"].ToString();
				if (string.IsNullOrWhiteSpace(text3))
				{
					text3 = Uri.UnescapeDataString(request.Headers["X-Preset-Filename"].ToString() ?? "");
				}
				string requestedGame = request.Query["game"].ToString();
				if (!roulette.TryImportPreset(text2, text3, requestedGame, out RouletteConfig config, out string gameId, out string displayName, out string presetGame, out string error, out bool mismatch))
				{
					return Results.Json(new
					{
						ok = false,
						error = error,
						mismatch = mismatch,
						game = gameId,
						displayName = displayName,
						presetGame = presetGame
					});
				}
				roulette.Save(config);
				return Results.Json(new
				{
					ok = true,
					rules = config.Rules.Count,
					enabled = config.Enabled,
					game = gameId,
					displayName = displayName,
					presetGame = presetGame,
					config = roulette.GetSnapshot()
				});
			});
			ConcurrentDictionary<string, long> rouletteDeliverTokens = new ConcurrentDictionary<string, long>(StringComparer.Ordinal);
			app.MapPost("/api/roulette/deliver", (Func<TestGiftRequest, GameBridgeService, RelayState, GameWindowService, AvatarCacheService, Task<IResult>>)async delegate(TestGiftRequest request, GameBridgeService gameBridgeService, RelayState state, GameWindowService gameWindowService, AvatarCacheService avatars)
			{
				gameWindowService.Refresh();
				string giftName = (string.IsNullOrWhiteSpace(request.GiftName) ? "" : request.GiftName.Trim());
				if (string.IsNullOrWhiteSpace(giftName))
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "giftName required"
					});
				}
				string token = (request.Token ?? "").Trim();
				long tickCount = Environment.TickCount64;
				if (token.Length > 0)
				{
					if (!rouletteDeliverTokens.TryAdd(token, tickCount))
					{
						AppPaths.Log("roulette-deliver dedupe token=" + token);
						return Results.Json(new
						{
							ok = true,
							deduped = true,
							giftName = giftName
						});
					}
					if (rouletteDeliverTokens.Count > 200)
					{
						KeyValuePair<string, long>[] array = rouletteDeliverTokens.ToArray();
						for (int j = 0; j < array.Length; j++)
						{
							KeyValuePair<string, long> keyValuePair = array[j];
							if (tickCount - keyValuePair.Value > 120000)
							{
								rouletteDeliverTokens.TryRemove(keyValuePair.Key, out var _);
							}
						}
					}
				}
				string nickname = ((!string.IsNullOrWhiteSpace(request.Nickname)) ? request.Nickname.Trim() : "ผ\u0e39\u0e49ชม");
				string text2 = ((!string.IsNullOrWhiteSpace(request.UserName)) ? request.UserName.Trim() : ("u_" + string.Concat(nickname.Where(char.IsLetterOrDigit)).ToLowerInvariant()));
				if (string.IsNullOrWhiteSpace(text2) || text2 == "u_")
				{
					text2 = "viewer";
				}
				string avatarUrl = (request.AvatarUrl ?? "").Trim();
				string imageId = (request.ImageId ?? "").Trim();
				if (string.IsNullOrWhiteSpace(avatarUrl) && imageId.Length > 0)
				{
					string text3 = RouletteSpinService.FindRouletteImagePath(imageId);
					if (text3 != null)
					{
						avatarUrl = avatars.ImportLocalFile(text3, "roulette:" + imageId);
					}
				}
				GiftPayload payload = new GiftPayload
				{
					MessageType = "SendGift",
					Type = "SendGift",
					MsgType = "SendGift",
					GiftName = giftName,
					RepeatCount = 1,
					UserName = text2,
					Nickname = nickname,
					AvatarUrl = avatarUrl
				};
				DeliveryResult deliveryResult = await gameBridgeService.DeliverGiftAsync(payload);
				string text4 = "[ROULETTE-WIN] " + giftName + " x1 from " + nickname;
				state.PushLog(new LogEntry
				{
					Kind = "game",
					Text = text4,
					Sent = deliveryResult.TotalSent,
					WindowSent = deliveryResult.YcLiveSent
				});
				AppPaths.Log($"roulette-win gift={giftName} nick={nickname} imageId={imageId} avatar={(string.IsNullOrWhiteSpace(avatarUrl) ? "none" : "yes")} sent={deliveryResult.TotalSent} yc={deliveryResult.YcLiveSent}");
				DevLogService.Write("gift.roulette", "winner delivered", new
				{
					giftName = giftName,
					nickname = nickname,
					token = token,
					imageId = imageId,
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
					payload = payload,
					sent = deliveryResult.TotalSent,
					ycLiveSent = deliveryResult.YcLiveSent,
					status = state.ToStatus()
				});
			});
			app.MapPost("/api/test-gift", (Func<TestGiftRequest, GameBridgeService, RelayState, GameWindowService, AvatarCacheService, LiveStatsOverlayService, PhotoPrintService, Task<IResult>>)async delegate(TestGiftRequest request, GameBridgeService gameBridgeService, RelayState state, GameWindowService gameWindowService, AvatarCacheService avatars, LiveStatsOverlayService liveStats, PhotoPrintService photoPrint)
			{
				gameWindowService.Refresh();
				string text2 = (string.IsNullOrWhiteSpace(request.MessageType) ? "SendGift" : request.MessageType.Trim());
				string giftName = ((!string.IsNullOrWhiteSpace(request.GiftName)) ? request.GiftName.Trim() : (text2.Contains("Like", StringComparison.OrdinalIgnoreCase) ? "Like" : (text2.Contains("Follow", StringComparison.OrdinalIgnoreCase) ? "Follow" : "Rose")));
				int repeatCount = ((request.RepeatCount <= 0) ? 1 : request.RepeatCount);
				if (string.Equals(request.Source?.Trim(), "roulette", StringComparison.OrdinalIgnoreCase))
				{
					string nickR = ((!string.IsNullOrWhiteSpace(request.Nickname)) ? request.Nickname.Trim() : "ผ\u0e39\u0e49ชม");
					string text3 = ((!string.IsNullOrWhiteSpace(request.UserName)) ? request.UserName.Trim() : ("u_" + string.Concat(nickR.Where(char.IsLetterOrDigit)).ToLowerInvariant()));
					if (string.IsNullOrWhiteSpace(text3) || text3 == "u_")
					{
						text3 = "viewer";
					}
					string text4 = (request.Token ?? "").Trim();
					long tickCount = Environment.TickCount64;
					if (text4.Length > 0 && !rouletteDeliverTokens.TryAdd(text4, tickCount))
					{
						return Results.Json(new
						{
							ok = true,
							deduped = true,
							giftName = giftName
						});
					}
					string text5 = (request.AvatarUrl ?? "").Trim();
					string text6 = (request.ImageId ?? "").Trim();
					if (string.IsNullOrWhiteSpace(text5) && text6.Length > 0)
					{
						string text7 = RouletteSpinService.FindRouletteImagePath(text6);
						if (text7 != null)
						{
							text5 = avatars.ImportLocalFile(text7, "roulette:" + text6);
						}
					}
					GiftPayload winPayload = new GiftPayload
					{
						MessageType = "SendGift",
						Type = "SendGift",
						MsgType = "SendGift",
						GiftName = giftName,
						RepeatCount = 1,
						UserName = text3,
						Nickname = nickR,
						AvatarUrl = text5
					};
					GiftCatalog.Fill(winPayload);
					DeliveryResult deliveryResult = await gameBridgeService.DeliverGiftAsync(winPayload);
					state.PushLog(new LogEntry
					{
						Kind = "game",
						Text = "[ROULETTE-WIN] " + giftName + " x1 from " + nickR,
						Sent = deliveryResult.TotalSent,
						WindowSent = deliveryResult.YcLiveSent
					});
					return Results.Json(new
					{
						ok = deliveryResult.YcLiveSent,
						payload = winPayload,
						sent = deliveryResult.TotalSent,
						ycLiveSent = deliveryResult.YcLiveSent,
						status = state.ToStatus()
					});
				}
				string nickname = ((!string.IsNullOrWhiteSpace(request.Nickname)) ? request.Nickname.Trim() : "Test User");
				string text8 = ((!string.IsNullOrWhiteSpace(request.UserName)) ? request.UserName.Trim() : "test_user");
				if (string.IsNullOrWhiteSpace(text8) || text8 == "u_")
				{
					text8 = "test_user";
				}
				GiftPayload payload = new GiftPayload
				{
					MessageType = text2,
					Type = text2,
					MsgType = text2,
					GiftName = giftName,
					Comment = (request.Comment ?? "").Trim(),
					RepeatCount = repeatCount,
					UserName = text8,
					Nickname = nickname,
					AvatarUrl = (request.AvatarUrl ?? "").Trim()
				};
				GiftCatalog.Fill(payload);
				if (text2.Contains("Chat", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(payload.Comment))
				{
					payload.Comment = giftName;
				}
				DevLogService.Write("gift.test", "test-gift enqueue", new
				{
					giftName = giftName,
					repeatCount = repeatCount,
					msgType = text2,
					nickname = nickname,
					source = request.Source
				});
				string text9 = (text2.Contains("Like", StringComparison.OrdinalIgnoreCase) ? "like" : (text2.Contains("Follow", StringComparison.OrdinalIgnoreCase) ? "follow" : (text2.Contains("Chat", StringComparison.OrdinalIgnoreCase) ? "chat" : "gift")));
				try
				{
					switch (text9)
					{
					case "like":
						liveStats.RecordLike(payload);
						break;
					case "follow":
						liveStats.RecordFollow(payload);
						break;
					case "chat":
						liveStats.RecordChat(payload);
						break;
					default:
						liveStats.RecordGift(payload);
						photoPrint.EnqueueFromGift(payload.Nickname, payload.UserName, payload.AvatarUrl, payload.GiftName, payload.RepeatCount);
						break;
					}
				}
				catch
				{
				}
				string text10 = "[TEST] ";
				string line = ((text9 == "follow") ? (text10 + "Follow from " + payload.Nickname) : ((text9 == "chat") ? $"{text10}Chat: {payload.Comment} from {payload.Nickname}" : $"{text10}{giftName} x{repeatCount} from {payload.Nickname}"));
				if (text9 == "chat")
				{
					state.PushLog(new LogEntry
					{
						Kind = "chat",
						Text = "Chat: " + payload.Comment + " from " + payload.Nickname,
						Sent = 0,
						WindowSent = false
					});
				}
				state.PushLog(new LogEntry
				{
					Kind = "ui",
					Text = line,
					Sent = 0,
					WindowSent = false,
					Nickname = payload.Nickname,
					AvatarUrl = (payload.AvatarUrl ?? "").Trim()
				});
				DeliveryResult deliveryResult2 = await gameBridgeService.DeliverGiftAsync(payload);
				state.PushLog(new LogEntry
				{
					Kind = "game",
					Text = line + (string.IsNullOrWhiteSpace(deliveryResult2.Channel) ? "" : (" [" + deliveryResult2.Channel + "]")),
					Sent = deliveryResult2.TotalSent,
					WindowSent = deliveryResult2.YcLiveSent
				});
				DevLogService.Write("gift.test", "test-gift delivered", new
				{
					giftName = giftName,
					repeatCount = repeatCount,
					nickname = nickname,
					sent = deliveryResult2.TotalSent,
					yc = deliveryResult2.YcLiveSent
				});
				if (!deliveryResult2.YcLiveSent)
				{
					state.GameError = state.GameError ?? "Direct /livemsg enqueue failed — check port 12922";
				}
				else
				{
					state.ClearGameError();
				}
				return Results.Json(new
				{
					ok = deliveryResult2.YcLiveSent,
					payload = payload,
					sent = deliveryResult2.TotalSent,
					wsSent = deliveryResult2.WebSocketSent,
					ycLiveSent = deliveryResult2.YcLiveSent,
					channel = deliveryResult2.Channel,
					gameError = (deliveryResult2.YcLiveSent ? null : (deliveryResult2.Channel ?? state.GameError)),
					gameClients = deliveryResult2.ClientCount,
					gameWindowFound = deliveryResult2.GameWindowFound,
					directLiveReady = state.DirectLiveReady,
					deliveryMode = state.DeliveryMode,
					status = state.ToStatus()
				});
			});
			app.MapGet("/api/keymap", (Func<KeyMapDeliveryService, IResult>)delegate(KeyMapDeliveryService km)
			{
				KeyMapDeliveryService.KeyMapConfig snapshot = km.GetSnapshot();
				return Results.Json(new
				{
					enabled = snapshot.Enabled,
					comment = snapshot.Comment,
					rules = snapshot.Rules,
					events = (snapshot.Events ?? new List<KeyMapDeliveryService.KeyMapEvent>())
				});
			});
			app.MapPost("/api/keymap", (Func<HttpRequest, KeyMapDeliveryService, Task<IResult>>)async delegate(HttpRequest request, KeyMapDeliveryService km)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement value = jsonDocument.RootElement;
				KeyMapDeliveryService.KeyMapConfig keyMapConfig = JsonSerializer.Deserialize<KeyMapDeliveryService.KeyMapConfig>(value.GetRawText(), new JsonSerializerOptions
				{
					PropertyNameCaseInsensitive = true
				});
				if (keyMapConfig != null)
				{
					if (!jsonDocument.RootElement.TryGetProperty("events", out value))
					{
						keyMapConfig.Events = km.GetSnapshot().Events;
					}
					km.Save(keyMapConfig);
					return Results.Json(new
					{
						ok = true,
						rules = keyMapConfig.Rules.Count,
						events = keyMapConfig.Events.Count
					});
				}
				return Results.BadRequest(new
				{
					ok = false,
					error = "invalid config"
				});
			});
			app.MapPost("/api/keymap/reload", (Func<KeyMapDeliveryService, IResult>)delegate(KeyMapDeliveryService km)
			{
				km.Load();
				return Results.Json(new
				{
					ok = true,
					rules = km.GetSnapshot().Rules.Count,
					events = km.GetSnapshot().Events.Count
				});
			});
			app.MapGet("/api/keymap/export", (Func<KeyMapDeliveryService, IResult>)((KeyMapDeliveryService km) => Results.File(Encoding.UTF8.GetBytes(km.ExportJson()), "application/json", "THE-RIDER-preset.json")));
			app.MapPost("/api/keymap/import", (Func<HttpRequest, KeyMapDeliveryService, GameWindowService, Task<IResult>>)async delegate(HttpRequest request, KeyMapDeliveryService km, GameWindowService gameWindowService)
			{
				using StreamReader reader = new StreamReader(request.Body);
				string text2 = await reader.ReadToEndAsync();
				if (text2.TrimStart().StartsWith("{") && text2.Contains("\"text\""))
				{
					try
					{
						using JsonDocument jsonDocument = JsonDocument.Parse(text2);
						if (jsonDocument.RootElement.TryGetProperty("text", out var value) && value.ValueKind == JsonValueKind.String)
						{
							text2 = value.GetString() ?? text2;
						}
					}
					catch
					{
					}
				}
				if (!km.TryImport(text2, out KeyMapDeliveryService.KeyMapConfig config, out string error))
				{
					return Results.Json(new
					{
						ok = false,
						error = error
					});
				}
				string text3 = request.Query["file"].ToString();
				if (string.IsNullOrWhiteSpace(text3))
				{
					text3 = Uri.UnescapeDataString(request.Headers["X-Preset-Filename"].ToString() ?? "");
				}
				string text4 = request.Query["game"].ToString();
				if (string.IsNullOrWhiteSpace(text4))
				{
					text4 = gameWindowService.GetSelection()?.Id ?? "";
				}
				if (!km.TryBindImportToSelected(text4, text3, config, out string gameId, out string displayName, out string presetGameId, out string error2))
				{
					return Results.Json(new
					{
						ok = false,
						error = error2,
						mismatch = true,
						game = gameId,
						displayName = displayName,
						presetGame = presetGameId
					});
				}
				km.Save(config);
				km.AutoActivateFromGame(gameWindowService.GetSelection());
				return Results.Json(new
				{
					ok = true,
					rules = config.Rules.Count,
					events = config.Events.Count,
					game = gameId,
					displayName = displayName
				});
			});
			app.MapPost("/api/keymap/import-default", (Func<KeyMapDeliveryService, GameWindowService, IResult>)delegate(KeyMapDeliveryService km, GameWindowService gameWindowService)
			{
				if (!km.TryImportDefaultPack(out KeyMapDeliveryService.KeyMapConfig config, out string error))
				{
					return Results.Json(new
					{
						ok = false,
						error = error
					});
				}
				km.PrepareImportTarget(config, "THE-RIDER-v2.json");
				km.Save(config);
				gameWindowService.SetSelection(new GameSelection
				{
					Id = "the-rider",
					DisplayName = "THE RIDER"
				});
				km.AutoActivateFromGame(gameWindowService.GetSelection());
				return Results.Json(new
				{
					ok = true,
					rules = config.Rules.Count,
					events = config.Events.Count,
					game = "the-rider",
					displayName = "THE RIDER"
				});
			});
			app.MapPost("/api/keymap/test", (Func<HttpRequest, KeyMapDeliveryService, Task<IResult>>)async delegate(HttpRequest request, KeyMapDeliveryService km)
			{
				using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
				JsonElement rootElement = jsonDocument.RootElement;
				JsonElement value;
				string key = (rootElement.TryGetProperty("key", out value) ? (value.GetString() ?? "") : "");
				JsonElement value2;
				string text2 = (rootElement.TryGetProperty("label", out value2) ? (value2.GetString() ?? "") : "");
				JsonElement value3;
				string text3 = (rootElement.TryGetProperty("webhookUrl", out value3) ? (value3.GetString() ?? "") : "");
				JsonElement value4;
				string text4 = (rootElement.TryGetProperty("giftName", out value4) ? (value4.GetString() ?? "") : "");
				JsonElement value5;
				string text5 = (rootElement.TryGetProperty("nickname", out value5) ? (value5.GetString() ?? "") : "");
				int num = 1;
				if (rootElement.TryGetProperty("count", out var value6) && value6.ValueKind == JsonValueKind.Number)
				{
					num = value6.GetInt32();
				}
				if (num < 1)
				{
					num = 1;
				}
				if (num > 200)
				{
					num = 200;
				}
				if (!string.IsNullOrWhiteSpace(text3))
				{
					GiftPayload payload = new GiftPayload
					{
						GiftName = (string.IsNullOrWhiteSpace(text4) ? "Rose" : text4.Trim()),
						RepeatCount = num,
						UserName = "test_user",
						Nickname = (string.IsNullOrWhiteSpace(text5) ? "Test User" : text5.Trim())
					};
					GiftCatalog.Fill(payload);
					if (km.TryDeliverWebhookUrl(text3, payload, out string detail))
					{
						return Results.Json(new
						{
							ok = true,
							detail = detail,
							webhook = true,
							count = num
						});
					}
					return Results.Json(new
					{
						ok = false,
						error = (string.IsNullOrWhiteSpace(detail) ? "webhook failed" : detail)
					});
				}
				int vk = 0;
				if (rootElement.TryGetProperty("vk", out var value7) && value7.ValueKind == JsonValueKind.Number)
				{
					vk = value7.GetInt32();
				}
				int holdMs = 80;
				if (rootElement.TryGetProperty("holdMs", out var value8) && value8.ValueKind == JsonValueKind.Number)
				{
					holdMs = value8.GetInt32();
				}
				if (rootElement.TryGetProperty("count", out var value9) && value9.ValueKind == JsonValueKind.Number)
				{
					num = value9.GetInt32();
				}
				if (num < 1)
				{
					num = 1;
				}
				if (num > 200)
				{
					num = 200;
				}
				int num2 = 0;
				if (rootElement.TryGetProperty("times", out var value10) && value10.ValueKind == JsonValueKind.Number)
				{
					num2 = value10.GetInt32();
				}
				if (!string.IsNullOrWhiteSpace(text2) || num2 > 1)
				{
					KeyMapDeliveryService.StackedKeyPress stackedKeyPress = km.ExpandStackedKey(text2, key, vk, holdMs, num, num2);
					key = stackedKeyPress.Key;
					vk = stackedKeyPress.Vk;
					holdMs = stackedKeyPress.HoldMs;
					num = stackedKeyPress.Count;
				}
				if (km.TrySendKey(key, vk, holdMs, num, out string detail2))
				{
					return Results.Json(new
					{
						ok = true,
						detail = detail2,
						key = key,
						count = num,
						label = text2
					});
				}
				return Results.Json(new
				{
					ok = false,
					error = (string.IsNullOrWhiteSpace(detail2) ? "send failed" : detail2)
				});
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
			app.MapPost("/api/video-overlay/open", (Func<GameWindowService, HttpRequest, IResult>)delegate(GameWindowService gameWindowService, HttpRequest request)
			{
				bool flag = string.Equals(request.Query["followGame"], "1", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["followGame"], "true", StringComparison.OrdinalIgnoreCase);
				bool flag2 = string.Equals(request.Query["fullscreen"], "1", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["fullscreen"], "true", StringComparison.OrdinalIgnoreCase);
				bool flag3 = string.Equals(request.Query["clickThrough"], "1", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["clickThrough"], "true", StringComparison.OrdinalIgnoreCase);
				VideoOverlayForm.OverlayMode overlayMode = (string.Equals(request.Query["mode"].ToString(), "clear", StringComparison.OrdinalIgnoreCase) ? VideoOverlayForm.OverlayMode.Clear : VideoOverlayForm.OverlayMode.Chroma);
				if (flag && gameWindowService.TryGetWindow(out nint hwnd2, out string _))
				{
					VideoOverlayHost.FollowWindow(hwnd2, overlayMode);
				}
				else
				{
					bool clickThrough = flag3;
					VideoOverlayForm.OverlayMode mode = overlayMode;
					bool recreate = !VideoOverlayHost.IsOpen;
					bool fullscreen = flag2;
					VideoOverlayHost.Open(null, clickThrough, mode, recreate, fullscreen);
				}
				return Results.Json(new
				{
					ok = true,
					open = VideoOverlayHost.IsOpen,
					followGame = flag,
					fullscreen = flag2,
					clickThrough = flag3,
					mode = overlayMode.ToString().ToLowerInvariant()
				});
			});
			app.MapPost("/api/video-overlay/close", (Func<IResult>)delegate
			{
				VideoOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/video-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = VideoOverlayHost.IsOpen,
				lastStatus = VideoOverlayBus.LastStatus
			})));
			app.MapPost("/api/video-overlay/cmd", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				VideoOverlayBus.EnqueueRaw(await reader.ReadToEndAsync());
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapGet("/api/video-overlay/poll", (Func<IResult>)delegate
			{
				List<string> commands = VideoOverlayBus.Drain();
				return Results.Json(new
				{
					ok = true,
					commands = commands
				});
			});
			app.MapPost("/api/video-overlay/status", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				VideoOverlayBus.SetStatus(await reader.ReadToEndAsync());
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapGet("/api/chroma-overlay/layers", (Func<IResult>)(() => Results.Json(ChromaOverlayHost.LayersJson())));
			app.MapPost("/api/win-overlay/open", (Func<IResult>)delegate
			{
				WinScoreOverlayHost.Open(!WinScoreOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = WinScoreOverlayHost.IsOpen
				});
			});
			app.MapPost("/api/win-overlay/close", (Func<IResult>)delegate
			{
				WinScoreOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/win-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = WinScoreOverlayHost.IsOpen
			})));
			app.MapPost("/api/jar-overlay/open", (Func<IResult>)delegate
			{
				JarOverlayHost.Open(!JarOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = JarOverlayHost.IsOpen
				});
			});
			app.MapPost("/api/jar-overlay/close", (Func<IResult>)delegate
			{
				JarOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/jar-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = JarOverlayHost.IsOpen
			})));
			app.MapPost("/api/welcome-overlay/open", (Func<IResult>)delegate
			{
				WelcomeOverlayHost.Open(!WelcomeOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = WelcomeOverlayHost.IsOpen,
					w = 720,
					h = 960
				});
			});
			app.MapPost("/api/welcome-overlay/close", (Func<IResult>)delegate
			{
				WelcomeOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/welcome-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = WelcomeOverlayHost.IsOpen,
				w = 720,
				h = 960
			})));
			app.MapPost("/api/win-pad/open", (Func<IResult>)delegate
			{
				WinPadHost.Open(!WinPadHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = WinPadHost.IsOpen
				});
			});
			app.MapPost("/api/win-pad/close", (Func<IResult>)delegate
			{
				WinPadHost.ClosePad();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/win-pad/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = WinPadHost.IsOpen
			})));
			app.MapPost("/api/roulette-overlay/open", (Func<IResult>)delegate
			{
				RouletteOverlayHost.Open(clickThrough: false, RouletteOverlayForm.OverlayMode.Chroma, !RouletteOverlayHost.IsOpen);
				return Results.Json(new
				{
					ok = true,
					open = RouletteOverlayHost.IsOpen,
					mode = "chroma"
				});
			});
			app.MapPost("/api/roulette-overlay/close", (Func<IResult>)delegate
			{
				RouletteOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/roulette-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = RouletteOverlayHost.IsOpen,
				lastStatus = RouletteOverlayBus.LastStatus
			})));
			app.MapPost("/api/roulette-overlay/cmd", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				RouletteOverlayBus.EnqueueRaw(await reader.ReadToEndAsync());
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapGet("/api/roulette-overlay/poll", (Func<IResult>)delegate
			{
				List<string> commands = RouletteOverlayBus.Drain();
				return Results.Json(new
				{
					ok = true,
					commands = commands
				});
			});
			app.MapPost("/api/roulette-overlay/status", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				RouletteOverlayBus.SetStatus(await reader.ReadToEndAsync());
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapPost("/api/roulette/spin", (Func<HttpRequest, RouletteSpinService, RouletteConfigService, Task<IResult>>)async delegate(HttpRequest request, RouletteSpinService spin, RouletteConfigService roulette)
			{
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					JsonElement rootElement = jsonDocument.RootElement;
					JsonElement value;
					string text2 = (rootElement.TryGetProperty("triggerGift", out value) ? (value.GetString() ?? "") : "");
					JsonElement value2;
					string sender = (rootElement.TryGetProperty("sender", out value2) ? (value2.GetString() ?? "ทดสอบ") : "ทดสอบ");
					JsonElement value3;
					int value4;
					int count = ((!rootElement.TryGetProperty("count", out value3) || !value3.TryGetInt32(out value4)) ? 1 : Math.Max(1, value4));
					List<RouletteOutcome> list = new List<RouletteOutcome>();
					if (rootElement.TryGetProperty("outcomes", out var value5) && value5.ValueKind == JsonValueKind.Array)
					{
						foreach (JsonElement item4 in value5.EnumerateArray())
						{
							JsonElement value6;
							string text3 = (item4.TryGetProperty("giftName", out value6) ? (value6.GetString() ?? "").Trim() : "");
							if (text3.Length != 0)
							{
								list.Add(new RouletteOutcome
								{
									GiftName = text3,
									Label = (item4.TryGetProperty("label", out var value7) ? (value7.GetString() ?? text3) : text3),
									ImageId = (item4.TryGetProperty("imageId", out var value8) ? (value8.GetString() ?? "") : "")
								});
							}
						}
					}
					bool multiply = false;
					if (rootElement.TryGetProperty("multiply", out var value9))
					{
						multiply = value9.ValueKind == JsonValueKind.True || (value9.ValueKind == JsonValueKind.String && string.Equals(value9.GetString(), "true", StringComparison.OrdinalIgnoreCase)) || (value9.ValueKind == JsonValueKind.String && string.Equals(value9.GetString(), "multiply", StringComparison.OrdinalIgnoreCase));
					}
					if (rootElement.TryGetProperty("mode", out var value10) && string.Equals(value10.GetString(), "multiply", StringComparison.OrdinalIgnoreCase))
					{
						multiply = true;
					}
					if (list.Count < 1 && !string.IsNullOrWhiteSpace(text2) && roulette.TryMatch(text2, out RouletteRule rule))
					{
						list = rule.Outcomes.ToList();
						if (string.Equals(rule.Mode, "multiply", StringComparison.OrdinalIgnoreCase))
						{
							multiply = true;
						}
					}
					if (list.Count < 1)
					{
						return Results.BadRequest(new
						{
							ok = false,
							error = "outcomes required"
						});
					}
					spin.Enqueue(text2, count, sender, list, multiply);
					return Results.Json(new
					{
						ok = true,
						queued = true
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
			app.MapGet("/api/interrupt-overlay/screens", (Func<IResult>)delegate
			{
				List<object> list = InterruptOverlayForm.ListScreens();
				Screen screen = InterruptOverlayForm.FindLiveStudioScreen();
				return Results.Json(new
				{
					ok = true,
					count = list.Count,
					liveStudioFound = (screen != null),
					liveStudio = screen?.DeviceName,
					screens = list
				});
			});
			app.MapPost("/api/interrupt-overlay/open", (Func<HttpRequest, IResult>)delegate(HttpRequest request)
			{
				int? num = null;
				if (int.TryParse(request.Query["screen"], out var result) && result >= 0)
				{
					num = result;
				}
				bool flag = true;
				if (bool.TryParse(request.Query["avoidLiveStudio"], out var result2))
				{
					flag = result2;
				}
				bool flag2 = true;
				if (bool.TryParse(request.Query["underLiveStudio"], out var result3))
				{
					flag2 = result3;
				}
				bool flag3 = string.Equals(request.Query["mode"], "popup", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["popup"], "1", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["popup"], "true", StringComparison.OrdinalIgnoreCase);
				bool recreate = !InterruptOverlayHost.IsOpen;
				if (bool.TryParse(request.Query["recreate"], out var result4))
				{
					recreate = result4;
				}
				DevLogService.Write("interrupt.open", "open requested", new
				{
					screenIndex = num,
					avoid = flag,
					underStudio = flag2,
					popupMode = flag3,
					recreate = recreate,
					wasOpen = InterruptOverlayHost.IsOpen
				});
				InterruptOverlayHost.Open(recreate, num, flag, flag2, flag3);
				return Results.Json(new
				{
					ok = true,
					open = InterruptOverlayHost.IsOpen,
					avoidLiveStudio = flag,
					underLiveStudio = flag2,
					popupMode = flag3,
					screen = num,
					liveStudioFound = (InterruptOverlayForm.FindLiveStudioHwnd() != IntPtr.Zero)
				});
			});
			app.MapPost("/api/interrupt-overlay/layout", (Func<HttpRequest, IResult>)delegate(HttpRequest request)
			{
				bool popupMode = string.Equals(request.Query["mode"], "popup", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["popup"], "1", StringComparison.OrdinalIgnoreCase) || string.Equals(request.Query["popup"], "true", StringComparison.OrdinalIgnoreCase);
				int? width = null;
				int? height = null;
				if (int.TryParse(request.Query["w"], out var result) && result > 0)
				{
					width = result;
				}
				if (int.TryParse(request.Query["h"], out var result2) && result2 > 0)
				{
					height = result2;
				}
				InterruptOverlayHost.SetLayout(popupMode, width, height);
				return Results.Json(new
				{
					ok = true,
					popupMode = popupMode,
					open = InterruptOverlayHost.IsOpen
				});
			});
			app.MapPost("/api/interrupt-overlay/close", (Func<IResult>)delegate
			{
				InterruptOverlayHost.CloseOverlay();
				return Results.Json(new
				{
					ok = true,
					open = false
				});
			});
			app.MapGet("/api/interrupt-overlay/status", (Func<IResult>)(() => Results.Json(new
			{
				ok = true,
				open = InterruptOverlayHost.IsOpen,
				lastStatus = InterruptOverlayBus.LastStatus
			})));
			app.MapPost("/api/interrupt-overlay/cmd", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				string text2 = await reader.ReadToEndAsync();
				DevLogService.Write("interrupt.cmd", "enqueue", new
				{
					json = ((text2.Length > 240) ? (text2.Substring(0, 240) + "…") : text2)
				});
				InterruptOverlayBus.EnqueueRaw(text2);
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapGet("/api/interrupt-overlay/poll", (Func<IResult>)delegate
			{
				List<string> commands = InterruptOverlayBus.Drain();
				return Results.Json(new
				{
					ok = true,
					commands = commands
				});
			});
			app.MapPost("/api/interrupt-overlay/status", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				InterruptOverlayBus.SetStatus(await reader.ReadToEndAsync());
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapPost("/api/dev-log", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				using StreamReader reader = new StreamReader(request.Body);
				string text2 = await reader.ReadToEndAsync();
				try
				{
					using JsonDocument jsonDocument = JsonDocument.Parse(string.IsNullOrWhiteSpace(text2) ? "{}" : text2);
					JsonElement rootElement = jsonDocument.RootElement;
					JsonElement value;
					string scope = (rootElement.TryGetProperty("scope", out value) ? (value.GetString() ?? "ui") : "ui");
					JsonElement value2;
					string message = (rootElement.TryGetProperty("message", out value2) ? (value2.GetString() ?? "") : "");
					JsonElement value3;
					string level = (rootElement.TryGetProperty("level", out value3) ? (value3.GetString() ?? "info") : "info");
					object data = null;
					if (rootElement.TryGetProperty("data", out var value4))
					{
						JsonValueKind valueKind = value4.ValueKind;
						if (valueKind != JsonValueKind.Undefined && valueKind != JsonValueKind.Null)
						{
							data = JsonSerializer.Deserialize<object>(value4.GetRawText());
						}
					}
					DevLogService.Write(scope, message, data, level);
					return Results.Json(new
					{
						ok = true
					});
				}
				catch (Exception ex3)
				{
					DevLogService.Write("dev-log", "bad payload: " + ex3.Message, null, "warn");
					return Results.BadRequest(new
					{
						ok = false,
						error = ex3.Message
					});
				}
			});
			app.MapGet("/api/dev-log", (Func<HttpRequest, IResult>)delegate(HttpRequest request)
			{
				int limit = 200;
				if (int.TryParse(request.Query["limit"], out var result))
				{
					limit = result;
				}
				long afterMs = 0L;
				if (long.TryParse(request.Query["after"], out var result2))
				{
					afterMs = result2;
				}
				string scope = request.Query["scope"].FirstOrDefault();
				List<DevLogService.DevLogEntry> list = DevLogService.Snapshot(limit, scope, afterMs);
				return Results.Json(new
				{
					ok = true,
					file = DevLogService.DevLogFile,
					count = list.Count,
					entries = list
				});
			});
			app.MapPost("/api/dev-log/clear", (Func<IResult>)delegate
			{
				DevLogService.Clear();
				DevLogService.Write("dev-log", "cleared by UI");
				return Results.Json(new
				{
					ok = true,
					file = DevLogService.DevLogFile
				});
			});
			app.MapGet("/api/temple-escape/defaults/status", (Func<IResult>)delegate
			{
				InlineArray5<string> buffer = default(InlineArray5<string>);
				buffer[0] = AppPaths.AppDir;
				buffer[1] = "wwwroot";
				buffer[2] = "defaults";
				buffer[3] = "temple-escape";
				buffer[4] = "SaveGames";
				string packDir = Path.Combine(buffer);
				string gameDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temple_Escape", "Saved", "SaveGames");
				var array = new string[3] { "CusFucSetting.sav", "PHBSave.sav", "MuztoMod.sav" }.Select(delegate(string n)
				{
					string text2 = Path.Combine(packDir, n);
					string text3 = Path.Combine(gameDir, n);
					bool flag = File.Exists(text2);
					bool flag2 = File.Exists(text3);
					string text4 = (flag ? FileSha(text2) : "");
					string text5 = (flag2 ? FileSha(text3) : "");
					return new
					{
						file = n,
						bundled = flag,
						installed = flag2,
						matchesPack = (flag && flag2 && string.Equals(text4, text5, StringComparison.OrdinalIgnoreCase)),
						packBytes = (flag ? new FileInfo(text2).Length : 0),
						installedBytes = (flag2 ? new FileInfo(text3).Length : 0),
						packHash = text4,
						gameHash = text5
					};
				}).ToArray();
				bool gameRunning = Process.GetProcessesByName("Temple_Escape").Length != 0 || Process.GetProcessesByName("TempleEscape").Length != 0;
				return Results.Json(new
				{
					ok = true,
					packDir = packDir,
					gameDir = gameDir,
					files = array,
					ready = array.All(f => f.bundled),
					applied = array.All(f => f.matchesPack),
					installedAny = array.Any(f => f.installed),
					gameRunning = gameRunning
				});
			});
			app.MapPost("/api/temple-escape/defaults/apply", (Func<IResult>)delegate
			{
				InlineArray5<string> buffer = default(InlineArray5<string>);
				buffer[0] = AppPaths.AppDir;
				buffer[1] = "wwwroot";
				buffer[2] = "defaults";
				buffer[3] = "temple-escape";
				buffer[4] = "SaveGames";
				string packDir = Path.Combine(buffer);
				string[] array = new string[3] { "CusFucSetting.sav", "PHBSave.sav", "MuztoMod.sav" };
				if (!Directory.Exists(packDir) || !array.All((string n) => File.Exists(Path.Combine(packDir, n))))
				{
					return Results.NotFound(new
					{
						ok = false,
						error = "defaults pack missing (CusFucSetting / PHBSave / MuztoMod)"
					});
				}
				bool gameRunning = Process.GetProcessesByName("Temple_Escape").Length != 0 || Process.GetProcessesByName("TempleEscape").Length != 0;
				string text2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temple_Escape", "Saved", "SaveGames");
				Directory.CreateDirectory(text2);
				int num = 0;
				List<string> list = new List<string>();
				string[] array2 = array;
				foreach (string text3 in array2)
				{
					string sourceFileName = Path.Combine(packDir, text3);
					string destFileName = Path.Combine(text2, text3);
					File.Copy(sourceFileName, destFileName, overwrite: true);
					num++;
					list.Add(text3);
				}
				InlineArray7<string> buffer2 = default(InlineArray7<string>);
				buffer2[0] = AppPaths.AppDir;
				buffer2[1] = "wwwroot";
				buffer2[2] = "defaults";
				buffer2[3] = "temple-escape";
				buffer2[4] = "Config";
				buffer2[5] = "Windows";
				buffer2[6] = "GameUserSettings.ini";
				string text4 = Path.Combine(buffer2);
				if (File.Exists(text4))
				{
					InlineArray5<string> buffer3 = default(InlineArray5<string>);
					buffer3[0] = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
					buffer3[1] = "Temple_Escape";
					buffer3[2] = "Saved";
					buffer3[3] = "Config";
					buffer3[4] = "Windows";
					string text5 = Path.Combine(buffer3);
					Directory.CreateDirectory(text5);
					File.Copy(text4, Path.Combine(text5, "GameUserSettings.ini"), overwrite: true);
				}
				return Results.Json(new
				{
					ok = true,
					copied = num,
					files = list,
					gameDir = text2,
					gameRunning = gameRunning
				});
			});
			app.MapPost("/api/temple-escape/defaults/export", (Func<IResult>)delegate
			{
				string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temple_Escape", "Saved", "SaveGames");
				InlineArray5<string> buffer = default(InlineArray5<string>);
				buffer[0] = AppPaths.AppDir;
				buffer[1] = "wwwroot";
				buffer[2] = "defaults";
				buffer[3] = "temple-escape";
				buffer[4] = "SaveGames";
				string text2 = Path.Combine(buffer);
				Directory.CreateDirectory(text2);
				string[] obj3 = new string[3] { "CusFucSetting.sav", "PHBSave.sav", "MuztoMod.sav" };
				int num = 0;
				List<string> list = new List<string>();
				string[] array = obj3;
				foreach (string text3 in array)
				{
					string text4 = Path.Combine(path, text3);
					if (!File.Exists(text4))
					{
						list.Add(text3);
					}
					else
					{
						File.Copy(text4, Path.Combine(text2, text3), overwrite: true);
						num++;
					}
				}
				return Results.Json(new
				{
					ok = true,
					copied = num,
					missing = list,
					packDir = text2
				});
			});
			app.MapMethods("/api/video-cache/{id}", new string[1] { "PUT" }, (Func<string, HttpRequest, Task<IResult>>)async delegate(string id, HttpRequest request)
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid id"
					});
				}
				string mediaCacheDir = AppPaths.MediaCacheDir;
				Directory.CreateDirectory(mediaCacheDir);
				string text2 = ".mp4";
				string text3 = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(text3))
				{
					try
					{
						string extension = Path.GetExtension(Uri.UnescapeDataString(text3));
						if (!string.IsNullOrWhiteSpace(extension) && extension.Length <= 8)
						{
							text2 = extension.ToLowerInvariant();
						}
					}
					catch
					{
					}
				}
				string text4 = request.ContentType ?? "";
				if (text4.IndexOf("webm", StringComparison.OrdinalIgnoreCase) >= 0)
				{
					text2 = ".webm";
				}
				else if (text4.IndexOf("quicktime", StringComparison.OrdinalIgnoreCase) >= 0 || text4.IndexOf("mov", StringComparison.OrdinalIgnoreCase) >= 0)
				{
					text2 = ".mov";
				}
				string[] files = Directory.GetFiles(mediaCacheDir, id + ".*");
				foreach (string path in files)
				{
					try
					{
						File.Delete(path);
					}
					catch
					{
					}
				}
				string path2 = Path.Combine(mediaCacheDir, id + text2);
				await using (FileStream fs = File.Create(path2))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new
				{
					ok = true,
					id = id,
					file = Path.GetFileName(path2),
					bytes = new FileInfo(path2).Length
				});
			});
			app.MapGet("/api/defaults/music/export-flag", (Func<IResult>)delegate
			{
				string path = Path.Combine(AppPaths.AppDir, "EXPORT_MUSIC_PACK.flag");
				return Results.Json(new
				{
					ok = true,
					export = File.Exists(path)
				});
			});
			app.MapPost("/api/defaults/music/export-flag/clear", (Func<IResult>)delegate
			{
				string path = Path.Combine(AppPaths.AppDir, "EXPORT_MUSIC_PACK.flag");
				try
				{
					if (File.Exists(path))
					{
						File.Delete(path);
					}
				}
				catch
				{
				}
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapMethods("/api/defaults/music/config", new string[1] { "PUT" }, (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				string text2 = DefaultsMusicDir();
				Directory.CreateDirectory(text2);
				string path = Path.Combine(text2, "config.json");
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new
				{
					ok = true,
					path = path,
					bytes = new FileInfo(path).Length
				});
			});
			app.MapMethods("/api/defaults/music/file/{id}", new string[1] { "PUT" }, (Func<string, HttpRequest, Task<IResult>>)async delegate(string id, HttpRequest request)
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid id"
					});
				}
				string text2 = DefaultsMusicFilesDir();
				Directory.CreateDirectory(text2);
				string text3 = ".mp3";
				string text4 = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(text4))
				{
					try
					{
						string extension = Path.GetExtension(Uri.UnescapeDataString(text4));
						if (!string.IsNullOrWhiteSpace(extension) && extension.Length <= 8)
						{
							text3 = extension;
						}
					}
					catch
					{
					}
				}
				string path = Path.Combine(text2, id + text3);
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new
				{
					ok = true,
					id = id,
					file = Path.GetFileName(path),
					bytes = new FileInfo(path).Length
				});
			});
			app.MapGet("/api/audio-file/{id}", (Func<string, IResult>)delegate(string id)
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest();
				}
				string text2 = FindMediaAudioPath(id);
				if (text2 == null)
				{
					return Results.NotFound();
				}
				string text3 = Path.GetExtension(text2).ToLowerInvariant();
				string text4;
				if (text3 != null)
				{
					int length = text3.Length;
					if (length == 4)
					{
						switch (text3[1])
						{
						case 'm':
							break;
						case 'w':
							goto IL_00e5;
						case 'o':
							goto IL_00f7;
						case 'a':
							goto IL_0109;
						case 'p':
							goto IL_011b;
						case 'j':
							goto IL_012d;
						case 'g':
							goto IL_013c;
						default:
							goto IL_01b1;
						}
						if (!(text3 == ".m4a"))
						{
							if (!(text3 == ".mp4"))
							{
								goto IL_01b1;
							}
							text4 = "audio/mp4";
						}
						else
						{
							text4 = "audio/mp4";
						}
						goto IL_01b7;
					}
					if (length == 5)
					{
						char c = text3[1];
						if (c != 'j')
						{
							if (c == 'w' && text3 == ".webp")
							{
								text4 = "image/webp";
								goto IL_01b7;
							}
						}
						else if (text3 == ".jpeg")
						{
							goto IL_0199;
						}
					}
				}
				goto IL_01b1;
				IL_011b:
				if (!(text3 == ".png"))
				{
					goto IL_01b1;
				}
				text4 = "image/png";
				goto IL_01b7;
				IL_01b1:
				text4 = "audio/mpeg";
				goto IL_01b7;
				IL_00e5:
				if (!(text3 == ".wav"))
				{
					goto IL_01b1;
				}
				text4 = "audio/wav";
				goto IL_01b7;
				IL_0109:
				if (!(text3 == ".aac"))
				{
					goto IL_01b1;
				}
				text4 = "audio/aac";
				goto IL_01b7;
				IL_012d:
				if (text3 == ".jpg")
				{
					goto IL_0199;
				}
				goto IL_01b1;
				IL_01b7:
				string contentType = text4;
				return Results.File(text2, contentType, null, null, null, enableRangeProcessing: true);
				IL_013c:
				if (!(text3 == ".gif"))
				{
					goto IL_01b1;
				}
				text4 = "image/gif";
				goto IL_01b7;
				IL_0199:
				text4 = "image/jpeg";
				goto IL_01b7;
				IL_00f7:
				if (!(text3 == ".ogg"))
				{
					goto IL_01b1;
				}
				text4 = "audio/ogg";
				goto IL_01b7;
			});
			app.MapPost("/api/media/play", (Func<HttpRequest, CancellationToken, Task<IResult>>)async delegate(HttpRequest request, CancellationToken ct)
			{
				_ = 1;
				try
				{
					using JsonDocument doc = await JsonDocument.ParseAsync(request.Body, default(JsonDocumentOptions), ct);
					JsonElement rootElement = doc.RootElement;
					JsonElement value;
					string id = (rootElement.TryGetProperty("id", out value) ? (value.GetString() ?? "").Trim() : "");
					if (!IsSafeMediaId(id))
					{
						return Results.BadRequest(new
						{
							ok = false,
							error = "invalid id"
						});
					}
					string path = FindMediaAudioPath(id);
					if (path == null)
					{
						return Results.NotFound(new
						{
							ok = false,
							error = "file not found"
						});
					}
					JsonElement value2;
					double value3;
					double startSec = ((rootElement.TryGetProperty("startSec", out value2) && value2.TryGetDouble(out value3)) ? Math.Max(0.0, value3) : 0.0);
					double? durationSec = null;
					if (rootElement.TryGetProperty("durationSec", out var value4) && value4.TryGetDouble(out var value5) && value5 > 0.0)
					{
						durationSec = value5;
					}
					JsonElement value6;
					double value7;
					double volume = ((rootElement.TryGetProperty("volume", out value6) && value6.TryGetDouble(out value7)) ? value7 : 0.8);
					var (flag, text2) = await HostMediaPlayer.PlayAsync(path, startSec, durationSec, volume, ct);
					return Results.Json(new
					{
						ok = flag,
						played = flag,
						cancelled = (text2 == "cancelled"),
						error = text2,
						path = Path.GetFileName(path)
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
			app.MapPost("/api/media/stop", (Func<IResult>)delegate
			{
				HostMediaPlayer.Stop();
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapPost("/api/media/duck", (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				double factor = 1.0;
				try
				{
					using JsonDocument jsonDocument = await JsonDocument.ParseAsync(request.Body);
					if (jsonDocument.RootElement.TryGetProperty("factor", out var value) && value.TryGetDouble(out var value2))
					{
						factor = value2;
					}
				}
				catch
				{
				}
				HostMediaPlayer.SetDuck(factor);
				return Results.Json(new
				{
					ok = true,
					factor = Math.Clamp(factor, 0.0, 1.0)
				});
			});
			app.MapMethods("/api/audio-cache/{id}", new string[1] { "PUT" }, (Func<string, HttpRequest, Task<IResult>>)async delegate(string id, HttpRequest request)
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid id"
					});
				}
				string mediaCacheDir = AppPaths.MediaCacheDir;
				Directory.CreateDirectory(mediaCacheDir);
				string ext = ".mp3";
				string text2 = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(text2))
				{
					try
					{
						string extension = Path.GetExtension(Uri.UnescapeDataString(text2));
						if (!string.IsNullOrWhiteSpace(extension) && extension.Length <= 8)
						{
							ext = extension;
						}
					}
					catch
					{
					}
				}
				string path = Path.Combine(mediaCacheDir, id + ext);
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				bool flag = id.StartsWith("rlimg_", StringComparison.OrdinalIgnoreCase);
				if (!flag)
				{
					bool flag2;
					switch (ext)
					{
					case ".png":
					case ".jpg":
					case ".jpeg":
					case ".webp":
					case ".gif":
						flag2 = true;
						break;
					default:
						flag2 = false;
						break;
					}
					flag = flag2;
				}
				if (flag)
				{
					RouletteConfigService.MirrorUploadedImage(path, id);
				}
				return Results.Json(new
				{
					ok = true,
					id = id,
					bytes = new FileInfo(path).Length
				});
			});
			app.MapGet("/api/defaults/interrupt/export-flag", (Func<IResult>)delegate
			{
				string path = Path.Combine(AppPaths.AppDir, "EXPORT_INTERRUPT_PACK.flag");
				return Results.Json(new
				{
					ok = true,
					export = File.Exists(path)
				});
			});
			app.MapPost("/api/defaults/interrupt/export-flag/clear", (Func<IResult>)delegate
			{
				string path = Path.Combine(AppPaths.AppDir, "EXPORT_INTERRUPT_PACK.flag");
				try
				{
					if (File.Exists(path))
					{
						File.Delete(path);
					}
				}
				catch
				{
				}
				return Results.Json(new
				{
					ok = true
				});
			});
			app.MapMethods("/api/defaults/interrupt/config", new string[1] { "PUT" }, (Func<HttpRequest, Task<IResult>>)async delegate(HttpRequest request)
			{
				string text2 = DefaultsInterruptDir();
				Directory.CreateDirectory(text2);
				string path = Path.Combine(text2, "config.json");
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new
				{
					ok = true,
					path = path,
					bytes = new FileInfo(path).Length
				});
			});
			app.MapMethods("/api/defaults/interrupt/file/{id}", new string[1] { "PUT" }, (Func<string, HttpRequest, Task<IResult>>)async delegate(string id, HttpRequest request)
			{
				if (!IsSafeMediaId(id))
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid id"
					});
				}
				string text2 = DefaultsInterruptFilesDir();
				Directory.CreateDirectory(text2);
				string text3 = ".mp4";
				string text4 = request.Headers["X-File-Name"].FirstOrDefault();
				if (!string.IsNullOrWhiteSpace(text4))
				{
					try
					{
						string extension = Path.GetExtension(Uri.UnescapeDataString(text4));
						if (!string.IsNullOrWhiteSpace(extension) && extension.Length <= 8)
						{
							text3 = extension;
						}
					}
					catch
					{
					}
				}
				string path = Path.Combine(text2, id + text3);
				await using (FileStream fs = File.Create(path))
				{
					await request.Body.CopyToAsync(fs);
				}
				return Results.Json(new
				{
					ok = true,
					id = id,
					file = Path.GetFileName(path),
					bytes = new FileInfo(path).Length
				});
			});
			app.MapGet("/api/video-file/{id}", (Func<string, IResult>)delegate(string id)
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest();
				}
				string text2 = ResolveVideoPath(id);
				return (text2 == null) ? Results.NotFound() : Results.File(text2, GuessVideoContentType(text2), null, null, null, enableRangeProcessing: true);
			});
			app.MapGet("/media-cache/{id}", (Func<string, IResult>)delegate(string id)
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest();
				}
				string text2 = (id.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) ? id : (id + ".mp4"));
				string text3 = Path.Combine(AppPaths.MediaCacheDir, text2);
				string text4 = Path.Combine(AppPaths.AppDir, "media-cache", text2);
				string path = Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache");
				string text5 = Path.Combine(path, id);
				string text6 = Path.Combine(path, text2);
				string text7 = (File.Exists(text3) ? text3 : (File.Exists(text4) ? text4 : (File.Exists(text6) ? text6 : (File.Exists(text5) ? text5 : null))));
				return (text7 == null) ? Results.NotFound() : Results.File(text7, "video/mp4", null, null, null, enableRangeProcessing: true);
			});
			app.MapDelete("/api/video-cache/{id}", (Func<string, IResult>)delegate(string id)
			{
				if (string.IsNullOrWhiteSpace(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
				{
					return Results.BadRequest(new
					{
						ok = false,
						error = "invalid id"
					});
				}
				int num = 0;
				string[] array = new string[3]
				{
					AppPaths.MediaCacheDir,
					Path.Combine(AppPaths.AppDir, "media-cache"),
					Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache")
				};
				foreach (string text2 in array)
				{
					if (!string.IsNullOrWhiteSpace(text2) && Directory.Exists(text2))
					{
						try
						{
							string[] files = Directory.GetFiles(text2, id + ".*");
							foreach (string path in files)
							{
								try
								{
									File.Delete(path);
									num++;
								}
								catch
								{
								}
							}
							string path2 = Path.Combine(text2, id);
							if (File.Exists(path2))
							{
								try
								{
									File.Delete(path2);
									num++;
								}
								catch
								{
								}
							}
						}
						catch
						{
						}
					}
				}
				return Results.Json(new
				{
					ok = true,
					removed = num
				});
			});
			TtsProcessHost.EnsureStarted();
			Task.Run(async delegate
			{
				try
				{
					await TtsProcessHost.WaitUntilReadyAsync(12000);
				}
				catch
				{
				}
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
			try
			{
				TtsProcessHost.Stop();
			}
			catch
			{
			}
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
		static string DefaultsInterruptDir()
		{
			return Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "interrupt");
		}
		static string DefaultsInterruptFilesDir()
		{
			return Path.Combine(DefaultsInterruptDir(), "files");
		}
		static string DefaultsMusicDir()
		{
			return Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "music");
		}
		static string DefaultsMusicFilesDir()
		{
			return Path.Combine(DefaultsMusicDir(), "files");
		}
		static string DescribePortHolders(int port)
		{
			try
			{
				using Process process = Process.Start(new ProcessStartInfo
				{
					FileName = "powershell.exe",
					Arguments = $"-NoProfile -Command \"$c=Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue; if(-not $c){{'port {port}: (none)'}} else {{ $c | ForEach-Object {{ $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; 'port {port}: PID '+$_.OwningProcess+' '+($p.ProcessName) }} }}\"",
					CreateNoWindow = true,
					UseShellExecute = false,
					RedirectStandardOutput = true
				});
				if (process == null)
				{
					return $"port {port}: unknown";
				}
				string text2 = process.StandardOutput.ReadToEnd();
				process.WaitForExit(5000);
				return string.IsNullOrWhiteSpace(text2) ? $"port {port}: unknown" : text2.Trim();
			}
			catch
			{
				return $"port {port}: unknown";
			}
		}
		static string FileSha(string path)
		{
			if (!File.Exists(path))
			{
				return "";
			}
			using SHA256 sHA = SHA256.Create();
			using FileStream inputStream = File.OpenRead(path);
			return Convert.ToHexString(sHA.ComputeHash(inputStream)).Substring(0, 12);
		}
		static string? FindMediaAudioPath(string id)
		{
			string[] obj3 = new string[5]
			{
				AppPaths.RoulettePortableFilesDir,
				AppPaths.MediaCacheDir,
				DefaultsMusicFilesDir(),
				null,
				null
			};
			InlineArray5<string> buffer = default(InlineArray5<string>);
			buffer[0] = AppPaths.AppDir;
			buffer[1] = "wwwroot";
			buffer[2] = "defaults";
			buffer[3] = "roulette";
			buffer[4] = "files";
			obj3[3] = Path.Combine(buffer);
			obj3[4] = Path.Combine(AppPaths.AppDir, "media-cache");
			string[] array = obj3;
			string[] array2 = new string[12]
			{
				"", ".mp3", ".m4a", ".wav", ".ogg", ".aac", ".mp4", ".png", ".jpg", ".jpeg",
				".webp", ".gif"
			};
			string[] array3 = array;
			foreach (string text2 in array3)
			{
				if (Directory.Exists(text2))
				{
					string[] array4 = array2;
					foreach (string text3 in array4)
					{
						string text4 = Path.Combine(text2, id + text3);
						if (File.Exists(text4))
						{
							return text4;
						}
					}
					string text5 = Path.Combine(text2, id);
					if (File.Exists(text5))
					{
						return text5;
					}
				}
			}
			return null;
		}
		static void ForceKillByPort(int port)
		{
			try
			{
				using Process process = Process.Start(new ProcessStartInfo
				{
					FileName = "powershell.exe",
					Arguments = $"-NoProfile -Command \"Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ if ($_.OwningProcess -ne {Environment.ProcessId}) {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }} }}\"",
					CreateNoWindow = true,
					UseShellExecute = false
				});
				process?.WaitForExit(8000);
			}
			catch
			{
			}
			try
			{
				using Process process2 = Process.Start(new ProcessStartInfo
				{
					FileName = "cmd.exe",
					Arguments = $"/c for /f \"tokens=5\" %a in ('netstat -ano ^| findstr \":{port}\" ^| findstr LISTENING') do if not %a=={Environment.ProcessId} taskkill /F /PID %a",
					CreateNoWindow = true,
					UseShellExecute = false
				});
				process2?.WaitForExit(8000);
			}
			catch
			{
			}
		}
		static string GuessVideoContentType(string file)
		{
			try
			{
				using FileStream fileStream = File.OpenRead(file);
				Span<byte> buffer = stackalloc byte[12];
				int num = fileStream.Read(buffer);
				if (num >= 4 && buffer[0] == 26 && buffer[1] == 69 && buffer[2] == 223 && buffer[3] == 163)
				{
					return "video/webm";
				}
				if (num >= 8 && buffer[4] == 102 && buffer[5] == 116 && buffer[6] == 121 && buffer[7] == 112)
				{
					return "video/mp4";
				}
			}
			catch
			{
			}
			return Path.GetExtension(file).ToLowerInvariant() switch
			{
				".webm" => "video/webm",
				".mov" => "video/quicktime",
				".mkv" => "video/x-matroska",
				_ => "video/mp4",
			};
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
		static bool IsSafeMediaId(string id)
		{
			if (!string.IsNullOrWhiteSpace(id) && id.IndexOfAny(Path.GetInvalidFileNameChars()) < 0)
			{
				return !id.Contains("..", StringComparison.Ordinal);
			}
			return false;
		}
		static string? ResolveVideoPath(string id)
		{
			string[] obj3 = new string[4]
			{
				AppPaths.MediaCacheDir,
				Path.Combine(AppPaths.AppDir, "media-cache"),
				Path.Combine(AppPaths.AppDir, "wwwroot", "media-cache"),
				null
			};
			InlineArray5<string> buffer = default(InlineArray5<string>);
			buffer[0] = AppPaths.AppDir;
			buffer[1] = "wwwroot";
			buffer[2] = "defaults";
			buffer[3] = "interrupt";
			buffer[4] = "files";
			obj3[3] = Path.Combine(buffer);
			string[] array = obj3;
			string[] array2 = new string[6] { ".mp4", ".webm", ".mov", ".mkv", ".m4v", "" };
			string[] array3 = array;
			foreach (string text2 in array3)
			{
				if (!string.IsNullOrWhiteSpace(text2) && Directory.Exists(text2))
				{
					string[] array4 = array2;
					foreach (string text3 in array4)
					{
						string text4 = Path.Combine(text2, id + text3);
						if (File.Exists(text4))
						{
							return text4;
						}
					}
					try
					{
						string[] files = Directory.GetFiles(text2, id + ".*");
						if (files.Length != 0)
						{
							return files[0];
						}
					}
					catch
					{
					}
				}
			}
			string text5 = Path.Combine(DefaultsInterruptFilesDir(), id + ".mp4");
			if (!File.Exists(text5))
			{
				return null;
			}
			return text5;
		}
		static void TryClosePreviousInstance()
		{
			int processId = Environment.ProcessId;
			string[] array = new string[2] { "TempleGiftRelay", "Monkeyeffect-Setup" };
			for (int j = 0; j < array.Length; j++)
			{
				Process[] processesByName = Process.GetProcessesByName(array[j]);
				foreach (Process process in processesByName)
				{
					try
					{
						if (process.Id != processId)
						{
							process.Kill(entireProcessTree: true);
							process.WaitForExit(5000);
						}
					}
					catch
					{
					}
				}
			}
			ForceKillByPort(3847);
			ForceKillByPort(12922);
			ForceKillByPort(3848);
		}
	}
}
