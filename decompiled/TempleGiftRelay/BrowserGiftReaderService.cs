using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Playwright;
using TikTokLiveSharp.Client;
using TikTokLiveSharp.Client.Config;
using TikTokLiveSharp.Events;
using TikTokLiveSharp.Events.Objects;
using SharpGiftMessage = TikTokLiveSharp.Events.GiftMessage;

namespace TempleGiftRelay;

public sealed class BrowserGiftReaderService
{
	private static readonly HttpClient WebcastHttp = CreateWebcastHttpClient();

	private readonly RelayState _state;

	private readonly GameBridgeService _gameBridge;

	private readonly RouletteConfigService _roulette;
	private readonly RouletteSpinService _rouletteSpin;

	private readonly LiveStatsOverlayService _liveStats;

	private readonly PhotoPrintService _photoPrint;

	private readonly List<(object Target, EventInfo Event, Delegate Handler)> _roomEventHooks = new();

	private readonly TikTokWebcastDecoder _decoder = new TikTokWebcastDecoder();

	private readonly SemaphoreSlim _sync = new SemaphoreSlim(1, 1);

	private TikTokLiveClient? _liveClient;

	/// <summary>User/system is tearing down — ignore disconnect events for reconnect UI.</summary>
	private int _disconnecting;

	private CancellationTokenSource? _reconnectUiCts;

	/// <summary>Keep LIVE in UI this long while TikTokLiveSharp retries the socket.</summary>
	private const int ReconnectUiGraceMs = 25000;

	private readonly ConcurrentDictionary<string, GiftPayload> _latestGift = new ConcurrentDictionary<string, GiftPayload>(StringComparer.OrdinalIgnoreCase);

	private readonly ConcurrentDictionary<string, CancellationTokenSource> _giftDebounce = new ConcurrentDictionary<string, CancellationTokenSource>(StringComparer.OrdinalIgnoreCase);

	private readonly ConcurrentDictionary<string, int> _deliveredCount = new ConcurrentDictionary<string, int>(StringComparer.OrdinalIgnoreCase);

	private readonly ConcurrentDictionary<string, long> _deliveredAt = new ConcurrentDictionary<string, long>(StringComparer.OrdinalIgnoreCase);

	/// <summary>Last TikTok GroupId delivered per user+gift — change means a new combo session.</summary>
	private readonly ConcurrentDictionary<string, long> _deliveredGroupId = new ConcurrentDictionary<string, long>(StringComparer.OrdinalIgnoreCase);

	/// <summary>OrderId/LogId already delivered — blocks CDP+Playwright duplicate frames of the same gift.</summary>
	private readonly ConcurrentDictionary<string, long> _deliveredEventIds = new ConcurrentDictionary<string, long>(StringComparer.Ordinal);

	/// <summary>
	/// Rapid non-streak gifts arrive as many x1 (Confetti/Overreact/…), often WITHOUT rising RepeatCount.
	/// MergeGiftPayload collapses them to one x1 — accumulate units here so game/interrupt get the real total.
	/// </summary>
	private readonly ConcurrentDictionary<string, int> _pendingSoloUnits = new ConcurrentDictionary<string, int>(StringComparer.OrdinalIgnoreCase);

	/// <summary>Last solo-accumulate tick (for empty OrderId/LogId soft dedupe).</summary>
	private readonly ConcurrentDictionary<string, long> _pendingSoloAt = new ConcurrentDictionary<string, long>(StringComparer.OrdinalIgnoreCase);

	/// <summary>mergeKey → count at UI announce (dual-path A).</summary>
	private readonly ConcurrentDictionary<string, int> _uiAnnouncedCount = new ConcurrentDictionary<string, int>(StringComparer.OrdinalIgnoreCase);

	/// <summary>
	/// Combos announced as roulette — always skip /livemsg for that mergeKey (even if config toggles mid-combo).
	/// </summary>
	private readonly ConcurrentDictionary<string, byte> _rouletteHeldMergeKeys = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);

	/// <summary>One spin per combo — enqueue on merge flush with final count, not on first UI tick.</summary>
	private readonly ConcurrentDictionary<string, byte> _rouletteEnqueuedMergeKeys = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);

	private readonly object _deliverGate = new object();

	private readonly object _likeGate = new object();

	private int _likePendingCount;

	private GiftPayload? _likePendingSample;

	private CancellationTokenSource? _likeFlushCts;

	private long _likeBatchStartedAt;

	private bool _likeUiAnnounced;

	/// <summary>
	/// Like bursts: flush after quiet, OR force-flush if batch held too long while still liking.
	/// </summary>
	private const int LikeFlushDelayMs = 250;

	/// <summary>Max time to hold coalesced likes before forcing a send even if still busy.</summary>
	private const int LikeMaxHoldMs = 800;

	/// <summary>
	/// After a roulette combo is finalized, wait this long before the same user+gift may spin again.
	/// Prevents TikTok count-reset ticks from starting a second spin, while allowing a real new gift.
	/// </summary>
	private const int RouletteRespinGapMs = 5500;

	/// <summary>
	/// Game-path only: quiet after last combo tick → send ONCE with final count.
	/// UI is announced immediately on first tick (Approach A dual-path).
	/// </summary>
	private const int GiftComboFinalizeMs = 500;

	/// <summary>
	/// Roulette waits for TikTok combo to go quiet (tap x1 then x2 then x3) before one spin with ×N.
	/// </summary>
	private const int GiftRouletteCoalesceMs = 2200;

	/// <summary>
	/// Quiet window for solo x1 bursts (with or without RepeatEnd) before one game flush.
	/// </summary>
	private const int GiftSoloCoalesceMs = 450;

	/// <summary>
	/// RepeatEnd quiet window for rising combos that end with RepeatEnd.
	/// </summary>
	private const int GiftDebounceRepeatEndMs = 320;

	/// <summary>Soft dedupe when OrderId/LogId missing (CDP+Playwright double frame).</summary>
	private const int SoloEmptyIdGapMs = 70;

	/// <summary>Follow → send immediately.</summary>
	private const int FollowDebounceMs = 0;

	private const int IdentityTtlMs = 180000;

	private const int FollowIdentityTtlMs = 25000;

	/// <summary>Same OrderId/LogId within this window is a duplicate wire frame, not a new gift.</summary>
	private const int DeliveredEventIdTtlMs = 120000;

	/// <summary>
	/// Minimum gap before another identical x1 (same user+gift) counts as a new send to game.
	/// </summary>
	private const int NewSoloGiftMinGapMs = 400;

	private IPlaywright? _playwright;

	private IBrowser? _cdpBrowser;

	private IBrowserContext? _context;

	private IPage? _page;

	private ICDPSession? _cdp;

	private Process? _chromeProcess;

	private Task? _runTask;

	private CancellationTokenSource? _runCts;

	private TaskCompletionSource<bool>? _webcastReady;

	private int _wsFrameCount;

	private readonly ConcurrentDictionary<string, byte> _seenWsUrls = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);

	private readonly ConcurrentDictionary<string, byte> _seenHttpUrls = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);

	private readonly ConcurrentDictionary<string, string> _cdpWsUrls = new ConcurrentDictionary<string, string>(StringComparer.Ordinal);

	private int _httpFrameCount;

	private const int ChromeDebugPort = 9333;

	public BrowserGiftReaderService(RelayState state, GameBridgeService gameBridge, RouletteConfigService roulette, RouletteSpinService rouletteSpin, LiveStatsOverlayService liveStats, PhotoPrintService photoPrint)
	{
		_state = state;
		_gameBridge = gameBridge;
		_roulette = roulette;
		_rouletteSpin = rouletteSpin;
		_liveStats = liveStats;
		_photoPrint = photoPrint;
	}

	public async Task ConnectAsync(string username, CancellationToken cancellationToken = default(CancellationToken))
	{
		await _sync.WaitAsync(cancellationToken);
		try
		{
			string cleanUsername = username.Trim().TrimStart('@');
			if (string.IsNullOrWhiteSpace(cleanUsername))
			{
				throw new InvalidOperationException("Please enter a TikTok username");
			}
			// TikTok uniqueId is case-sensitive (usually all lowercase).
			// Wrong case → "Could not find RoomId" / user_not_found even when the host is live.
			string normalizedUser = cleanUsername.ToLowerInvariant();
			if (!string.Equals(cleanUsername, normalizedUser, StringComparison.Ordinal))
			{
				AppPaths.Log($"username normalize '{cleanUsername}' -> '{normalizedUser}'");
				_state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "normalize @" + cleanUsername + " -> @" + normalizedUser
				});
			}
			cleanUsername = normalizedUser;
			await DisconnectInternalAsync();
			_state.TikTokUsername = cleanUsername;
			_state.ClearTikTokError();
			_state.TikTokConnecting = true;
			_state.TikTokReconnecting = false;
			Interlocked.Exchange(ref _disconnecting, 0);
			_webcastReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
			_wsFrameCount = 0;
			_httpFrameCount = 0;
			_seenWsUrls.Clear();
			_seenHttpUrls.Clear();
			_latestGift.Clear();
			_deliveredCount.Clear();
			_deliveredAt.Clear();
			_pendingSoloUnits.Clear();
			_pendingSoloAt.Clear();
			_uiAnnouncedCount.Clear();
			_rouletteHeldMergeKeys.Clear();
			_rouletteEnqueuedMergeKeys.Clear();
			lock (_likeGate)
			{
				_likePendingCount = 0;
				_likePendingSample = null;
				_likeBatchStartedAt = 0;
				_likeUiAnnounced = false;
				try
				{
					_likeFlushCts?.Cancel();
					_likeFlushCts?.Dispose();
				}
				catch
				{
				}
				_likeFlushCts = null;
			}
			_runCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
			CancellationToken token = _runCts.Token;
			// Main path: webcast (no Chrome). Chrome only when TEMPLEGIFT_USE_CHROME=1 / reader=chrome.
			// After AIS-style outages, Euler/Cloudflare can hang while RoomId (Akamai) still works.
			if (!UseChromeReader())
			{
				bool signingReachable = await Ipv4Network.CanReachSigningHostAsync(token);
				if (signingReachable)
				{
					try
					{
						await ConnectViaWebcastClientAsync(cleanUsername, token);
						return;
					}
					catch (Exception ex) when (ShouldFallbackToChrome(ex, token))
					{
						AppPaths.Log("webcast-hang fallback-chrome: " + ex.Message);
						_state.PushLog(new LogEntry
						{
							Kind = "system",
							Text = "webcast ค้างหลังเน็ตหลุด — สลับโหมด Chrome สำรอง"
						});
					}
				}
				else if (AppPaths.FindChrome() != null)
				{
					AppPaths.Log("webcast-preflight unreachable — chrome fallback");
					_state.PushLog(new LogEntry
					{
						Kind = "system",
						Text = "เน็ตไปเซิร์ฟเวอร์ไลฟ์ไม่ถึง — สลับโหมด Chrome สำรอง"
					});
				}
				else
				{
					throw new InvalidOperationException(
						"เน็ตไปเซิร์ฟเวอร์ไลฟ์ TikTok ไม่ถึง (พบบ่อยหลัง AIS หลุด). รีโมเด็มหรือเปลี่ยน DNS เป็น 1.1.1.1 แล้วกด Connect อีกครั้ง");
				}
			}
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "Opening Chrome LIVE page @" + cleanUsername + "..."
			});
			AppPaths.EnsurePlaywrightDriver();
			_playwright = await Playwright.CreateAsync();
			AppPaths.Log("Playwright driver ready");
			string text = AppPaths.FindChrome();
			if (text == null)
			{
				throw new InvalidOperationException("Google Chrome not found. Install Chrome, then Connect again.");
			}
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "เป\u0e34ด Chrome จร\u0e34ง (ไม\u0e48ใช\u0e48โหมดบอท) เพ\u0e37\u0e48อล\u0e47อกอ\u0e34น TikTok ได\u0e49"
			});
			AppPaths.Log("chrome: " + text);
			await AttachToRealChromeAsync(text, token);
			await EnsureTikTokLoginAsync(_page, token);
			string liveUrl = "https://www.tiktok.com/@" + cleanUsername + "/live";
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "เป\u0e34ดหน\u0e49า LIVE ใน Chrome ของ Relay..."
			});
			await _page.GotoAsync(liveUrl, new PageGotoOptions
			{
				WaitUntil = WaitUntilState.DOMContentLoaded,
				Timeout = 90000f
			});
			try
			{
				await Task.Delay(2500, token);
				await _page.ReloadAsync(new PageReloadOptions
				{
					WaitUntil = WaitUntilState.DOMContentLoaded,
					Timeout = 60000f
				});
			}
			catch
			{
			}
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "Chrome opened: " + liveUrl
			});
			string text2 = liveUrl;
			AppPaths.Log("opened: " + text2 + " title=" + await SafeTitleAsync(_page));
			if (await LooksLikeCommentsDisabledGuestAsync(_page))
			{
				_state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "ย\u0e31งเห\u0e47น Comments off — กร\u0e38ณาล\u0e47อกอ\u0e34นในหน\u0e49าต\u0e48าง Chrome น\u0e35\u0e49ให\u0e49เสร\u0e47จ (QR / โทรศ\u0e31พท\u0e4cได\u0e49)"
				});
				_state.TikTokError = "ล\u0e47อกอ\u0e34น TikTok ใน Chrome ท\u0e35\u0e48เป\u0e34ดอย\u0e39\u0e48ให\u0e49เสร\u0e47จ แล\u0e49วรอส\u0e31กคร\u0e39\u0e48";
				await EnsureTikTokLoginAsync(_page, token, forceLoginPage: true);
				await _page.GotoAsync(liveUrl, new PageGotoOptions
				{
					WaitUntil = WaitUntilState.DOMContentLoaded,
					Timeout = 90000f
				});
			}
			Task.Run(() => TryHelpLivePageAsync(_page, token), token);
			using CancellationTokenSource readyCts = CancellationTokenSource.CreateLinkedTokenSource(token);
			readyCts.CancelAfter(TimeSpan.FromSeconds(35L));
			bool gotStream;
			try
			{
				await _webcastReady.Task.WaitAsync(readyCts.Token);
				gotStream = true;
			}
			catch (OperationCanceledException)
			{
				gotStream = false;
			}
			string text3 = await SafeTitleAsync(_page);
			string text4 = _page.Url ?? string.Empty;
			bool flag = text4.Contains("/live", StringComparison.OrdinalIgnoreCase) && !text4.Contains("/login", StringComparison.OrdinalIgnoreCase) && !text3.Contains("Log in", StringComparison.OrdinalIgnoreCase) && !text3.Contains("login", StringComparison.OrdinalIgnoreCase);
			if (!gotStream && !flag)
			{
				string value = string.Join(" | ", _seenWsUrls.Keys.Take(6));
				string value2 = string.Join(" | ", _seenHttpUrls.Keys.Take(4));
				AppPaths.Log($"connect timeout title={text3} url={text4} ws=[{value}] http=[{value2}]");
				throw new InvalidOperationException("ต\u0e48อไลฟ\u0e4cไม\u0e48ต\u0e34ด: หน\u0e49า LIVE ไม\u0e48โหลด/ถ\u0e39กเด\u0e49ง login. ล\u0e47อกอ\u0e34น TikTok ในหน\u0e49าต\u0e48าง Chrome ท\u0e35\u0e48 Relay เป\u0e34ด แล\u0e49วกด Connect อ\u0e35กคร\u0e31\u0e49ง. หน\u0e49า: " + text3);
			}
			if (!gotStream)
			{
				_state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "หน\u0e49า LIVE เป\u0e34ดแล\u0e49ว แต\u0e48ย\u0e31งไม\u0e48เจอ gift stream — รอต\u0e48อ / ล\u0e47อกอ\u0e34นใน Chrome ของ Relay ถ\u0e49าถ\u0e39กถาม"
				});
				AppPaths.Log($"soft-connect title={text3} url={text4} ws={_seenWsUrls.Count} http={_seenHttpUrls.Count}");
			}
			_state.TikTokConnected = true;
			_state.TikTokLive = true;
			_state.ClearTikTokError();
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = (gotStream ? ("Ready — อ\u0e48าน gift จาก LIVE @" + cleanUsername) : ("Connected — กำล\u0e31งรอ gift จาก LIVE @" + cleanUsername))
			});
			_runTask = Task.Run(async delegate
			{
				try
				{
					while (!token.IsCancellationRequested && _context != null)
					{
						await Task.Delay(10000, token);
						_state.PushLog(new LogEntry
						{
							Kind = "system",
							Text = $"WS watch: frames={_wsFrameCount} http={_httpFrameCount} {_decoder.Stats}"
						});
					}
				}
				catch (OperationCanceledException)
				{
				}
			}, token);
		}
		finally
		{
			_state.TikTokConnecting = false;
			_sync.Release();
		}
	}

	public async Task DisconnectAsync()
	{
		await _sync.WaitAsync();
		try
		{
			await DisconnectInternalAsync();
		}
		finally
		{
			_sync.Release();
		}
	}

	private void AttachPageWatchers(IPage page)
	{
		SetupWebSocketWatch(page);
		SetupHttpWatch(page);
	}

	private async Task AttachCdpWatchAsync(IPage page)
	{
		_ = 1;
		try
		{
			_cdp = await page.Context.NewCDPSessionAsync(page);
			await _cdp.SendAsync("Network.enable");
			_cdp.Event("Network.webSocketCreated").OnEvent += delegate(object? _, JsonElement? payload)
			{
				try
				{
					if (payload.HasValue)
					{
						JsonElement value;
						string text = (payload.Value.TryGetProperty("url", out value) ? (value.GetString() ?? "") : "");
						JsonElement value2;
						string text2 = (payload.Value.TryGetProperty("requestId", out value2) ? (value2.GetString() ?? "") : "");
						if (!string.IsNullOrEmpty(text2))
						{
							_cdpWsUrls[text2] = text;
						}
						_seenWsUrls.TryAdd(TruncateUrl(text), 0);
						AppPaths.Log("cdp-ws-created: " + TruncateUrl(text));
						if (IsWebcastUrl(text))
						{
							MarkWebcastReady("CDP WebSocket");
						}
					}
				}
				catch (Exception ex2)
				{
					AppPaths.Log("cdp ws created: " + ex2.Message);
				}
			};
			_cdp.Event("Network.webSocketFrameReceived").OnEvent += delegate(object? _, JsonElement? payload)
			{
				try
				{
					if (payload.HasValue)
					{
						JsonElement value;
						string key = (payload.Value.TryGetProperty("requestId", out value) ? (value.GetString() ?? "") : "");
						_cdpWsUrls.TryGetValue(key, out string value2);
						if (value2 == null)
						{
							value2 = "";
						}
						if ((string.IsNullOrEmpty(value2) || IsWebcastUrl(value2)) && payload.Value.TryGetProperty("response", out var value3))
						{
							JsonElement value4;
							double num = (value3.TryGetProperty("opcode", out value4) ? value4.GetDouble() : 1.0);
							if (value3.TryGetProperty("payloadData", out var value5))
							{
								string text = value5.GetString();
								if (!string.IsNullOrEmpty(text))
								{
									byte[] data;
									if (num >= 2.0)
									{
										try
										{
											data = Convert.FromBase64String(text);
										}
										catch
										{
											return;
										}
									}
									else
									{
										data = Encoding.UTF8.GetBytes(text);
									}
									Interlocked.Increment(ref _wsFrameCount);
									MarkWebcastReady("CDP frame");
									{
										foreach (GiftPayload item in _decoder.TryParseGiftFrames(data))
										{
											QueueGiftDelivery(item);
										}
										return;
									}
								}
							}
						}
					}
				}
				catch (Exception ex2)
				{
					AppPaths.Log("cdp ws frame: " + ex2.Message);
				}
			};
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "CDP network watch enabled"
			});
		}
		catch (Exception ex)
		{
			AppPaths.Log("cdp attach failed: " + ex.Message);
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "CDP watch unavailable — using Playwright WS only"
			});
		}
	}

	private void MarkWebcastReady(string source)
	{
		TaskCompletionSource<bool> webcastReady = _webcastReady;
		if (webcastReady != null && webcastReady.TrySetResult(result: true))
		{
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "TikTok LIVE stream connected (" + source + ")"
			});
		}
	}

	private void SetupWebSocketWatch(IPage page)
	{
		page.WebSocket += delegate(object? _, IWebSocket webSocket)
		{
			string url = webSocket.Url ?? string.Empty;
			_seenWsUrls.TryAdd(TruncateUrl(url), 0);
			AppPaths.Log("ws: " + TruncateUrl(url));
			if (IsWebcastUrl(url))
			{
				MarkWebcastReady("Playwright WebSocket");
				webSocket.FrameReceived += delegate(object? obj, IWebSocketFrame frame)
				{
					try
					{
						Interlocked.Increment(ref _wsFrameCount);
						ProcessFrame(frame);
					}
					catch (Exception ex)
					{
						_state.PushLog(new LogEntry
						{
							Kind = "error",
							Text = "WS frame: " + ex.Message
						});
					}
				};
			}
		};
	}

	private void SetupHttpWatch(IPage page)
	{
		page.Response += delegate(object? _, IResponse response)
		{
			_ = Task.Run(async delegate
			{
				try
				{
					string url = response.Url ?? string.Empty;
					if (IsWebcastHttpUrl(url) || IsInterestingLiveUrl(url))
					{
						_seenHttpUrls.TryAdd(TruncateUrl(url), 0);
						int status = response.Status;
						if (status >= 200 && status < 300)
						{
							if (IsWebcastHttpUrl(url))
							{
								MarkWebcastReady("HTTP webcast");
							}
							byte[] array;
							try
							{
								array = await response.BodyAsync();
							}
							catch
							{
								return;
							}
							if (array.Length != 0)
							{
								Interlocked.Increment(ref _httpFrameCount);
								{
									foreach (GiftPayload item in _decoder.TryParseGiftFrames(array))
									{
										QueueGiftDelivery(item);
									}
									return;
								}
							}
						}
					}
				}
				catch (Exception ex)
				{
					_state.PushLog(new LogEntry
					{
						Kind = "error",
						Text = "HTTP webcast: " + ex.Message
					});
				}
			});
		};
	}

	public async Task OpenLoginChromeAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		await _sync.WaitAsync(cancellationToken);
		try
		{
			string chromePath = AppPaths.FindChrome() ?? throw new InvalidOperationException("Google Chrome not found");
			EnsureChromeProcessRunning(chromePath, openLogin: true, forceRestart: true);
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "เป\u0e34ด Chrome สำหร\u0e31บล\u0e47อกอ\u0e34น TikTok แล\u0e49ว — ล\u0e47อกอ\u0e34นด\u0e49วย QR/โทรศ\u0e31พท\u0e4cให\u0e49เสร\u0e47จ แล\u0e49วค\u0e48อยกด Connect"
			});
			_state.TikTokError = null;
		}
		finally
		{
			_sync.Release();
		}
	}

	private async Task AttachToRealChromeAsync(string chromePath, CancellationToken token)
	{
		EnsureChromeProcessRunning(chromePath, openLogin: false, forceRestart: true);
		string endpoint = $"http://127.0.0.1:{9333}";
		Exception last = null;
		for (int attempt = 0; attempt < 40; attempt++)
		{
			token.ThrowIfCancellationRequested();
			try
			{
				if (IsPortOpen(9333))
				{
					_cdpBrowser = await _playwright.Chromium.ConnectOverCDPAsync(endpoint);
					_context = _cdpBrowser.Contexts.FirstOrDefault() ?? throw new InvalidOperationException("Chrome CDP context missing");
					_context.Page += delegate(object? _, IPage newPage)
					{
						AttachPageWatchers(newPage);
					};
					foreach (IPage page3 in _context.Pages)
					{
						AttachPageWatchers(page3);
					}
					IPage page = _context.Pages.FirstOrDefault();
					IPage page2 = page;
					if (page2 == null)
					{
						page2 = await _context.NewPageAsync();
					}
					_page = page2;
					await AttachCdpWatchAsync(_page);
					_state.PushLog(new LogEntry
					{
						Kind = "system",
						Text = "เช\u0e37\u0e48อมต\u0e48อ Chrome จร\u0e34งผ\u0e48าน CDP :" + 9333 + " (ไม\u0e48ม\u0e35 --no-sandbox)"
					});
					return;
				}
				await Task.Delay(400, token);
			}
			catch (Exception ex)
			{
				last = ex;
				try
				{
					_cdpBrowser = null;
				}
				catch
				{
				}
				await Task.Delay(400, token);
			}
		}
		throw new InvalidOperationException("เช\u0e37\u0e48อมต\u0e48อ Chrome ไม\u0e48สำเร\u0e47จ (CDP). ป\u0e34ด Chrome ของ Relay ท\u0e31\u0e49งหมดแล\u0e49วกด Connect อ\u0e35กคร\u0e31\u0e49ง. " + last?.Message);
	}

	private void EnsureChromeProcessRunning(string chromePath, bool openLogin, bool forceRestart = false)
	{
		if (forceRestart || IsDirtyRelayChrome())
		{
			KillRelayChromeInstances();
			Thread.Sleep(900);
		}
		else if (IsPortOpen(9333))
		{
			AppPaths.Log("chrome debug port already open (clean)");
			return;
		}
		string browserProfileDir = GetBrowserProfileDir();
		Directory.CreateDirectory(browserProfileDir);
		string text = (openLogin ? "https://www.tiktok.com/login" : "https://www.tiktok.com/");
		string arguments = $"--remote-debugging-port={9333} --user-data-dir=\"{browserProfileDir}\" " + "--no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled --disable-features=IsolateOrigins,site-per-process \"" + text + "\"";
		_chromeProcess = Process.Start(new ProcessStartInfo
		{
			FileName = chromePath,
			Arguments = arguments,
			UseShellExecute = false
		});
		AppPaths.Log("started clean chrome pid=" + (_chromeProcess?.Id ?? 0) + " profile=" + browserProfileDir);
	}

	private static bool IsDirtyRelayChrome()
	{
		if (!IsPortOpen(9333))
		{
			return false;
		}
		foreach (int item in FindPidsListeningOnPort(9333))
		{
			string text = GetProcessCommandLine(item) ?? "";
			if (text.Contains("--no-sandbox", StringComparison.OrdinalIgnoreCase) || text.Contains("--enable-automation", StringComparison.OrdinalIgnoreCase))
			{
				return true;
			}
		}
		return false;
	}

	private static void KillRelayChromeInstances()
	{
		string value = "TempleGiftRelay";
		string value2 = $"--remote-debugging-port={9333}";
		foreach (int item in FindPidsListeningOnPort(9333))
		{
			try
			{
				AppPaths.Log("killing chrome on debug port pid=" + item);
				Process.GetProcessById(item).Kill(entireProcessTree: true);
			}
			catch
			{
			}
		}
		Process[] processesByName = Process.GetProcessesByName("chrome");
		Process[] array = processesByName;
		Process[] array2 = array;
		foreach (Process process in array2)
		{
			try
			{
				string processCommandLine = GetProcessCommandLine(process.Id);
				if (!string.IsNullOrEmpty(processCommandLine) && (processCommandLine.Contains(value, StringComparison.OrdinalIgnoreCase) || processCommandLine.Contains(value2, StringComparison.OrdinalIgnoreCase) || (processCommandLine.Contains("--no-sandbox", StringComparison.OrdinalIgnoreCase) && processCommandLine.Contains("browser-profile", StringComparison.OrdinalIgnoreCase))))
				{
					AppPaths.Log("killing dirty chrome pid=" + process.Id);
					process.Kill(entireProcessTree: true);
				}
			}
			catch
			{
			}
		}
	}

	private static List<int> FindPidsListeningOnPort(int port)
	{
		List<int> list = new List<int>();
		try
		{
			ProcessStartInfo startInfo = new ProcessStartInfo
			{
				FileName = "netstat",
				Arguments = "-ano",
				RedirectStandardOutput = true,
				UseShellExecute = false,
				CreateNoWindow = true
			};
			using Process process = Process.Start(startInfo);
			if (process == null)
			{
				return list;
			}
			string text = process.StandardOutput.ReadToEnd();
			process.WaitForExit(3000);
			string value = ":" + port;
			string[] array = text.Split('\n');
			string[] array2 = array;
			string[] array3 = array2;
			foreach (string text2 in array3)
			{
				if (text2.Contains("LISTENING", StringComparison.OrdinalIgnoreCase) && text2.Contains(value, StringComparison.OrdinalIgnoreCase))
				{
					string[] array4 = text2.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
					if (array4.Length != 0 && int.TryParse(array4[^1], out var result) && result > 0 && !list.Contains(result))
					{
						list.Add(result);
					}
				}
			}
		}
		catch
		{
		}
		return list;
	}

	private static string? GetProcessCommandLine(int pid)
	{
		try
		{
			ProcessStartInfo startInfo = new ProcessStartInfo
			{
				FileName = "powershell",
				Arguments = $"-NoProfile -Command \"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine\"",
				RedirectStandardOutput = true,
				UseShellExecute = false,
				CreateNoWindow = true
			};
			using Process process = Process.Start(startInfo);
			if (process == null)
			{
				return null;
			}
			string text = process.StandardOutput.ReadToEnd().Trim();
			process.WaitForExit(2000);
			return string.IsNullOrWhiteSpace(text) ? null : text;
		}
		catch
		{
			return null;
		}
	}

	private static string GetBrowserProfileDir()
	{
		return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TempleGiftRelay", "browser-profile");
	}

	private static bool IsPortOpen(int port)
	{
		try
		{
			using TcpClient tcpClient = new TcpClient();
			IAsyncResult asyncResult = tcpClient.BeginConnect(IPAddress.Loopback, port, null, null);
			if (!asyncResult.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(300L)))
			{
				return false;
			}
			tcpClient.EndConnect(asyncResult);
			return true;
		}
		catch
		{
			return false;
		}
	}

	private async Task EnsureTikTokLoginAsync(IPage page, CancellationToken token, bool forceLoginPage = false)
	{
		bool flag = !forceLoginPage;
		bool flag2 = flag;
		if (flag2)
		{
			flag2 = await HasTikTokSessionAsync(page);
		}
		if (flag2)
		{
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "พบ session TikTok ใน Chrome ของ Relay แล\u0e49ว"
			});
			return;
		}
		_state.PushLog(new LogEntry
		{
			Kind = "system",
			Text = "ล\u0e47อกอ\u0e34น TikTok ในหน\u0e49าต\u0e48าง Chrome น\u0e35\u0e49ได\u0e49เลย (QR / โทรศ\u0e31พท\u0e4c / อ\u0e35เมล) — รอส\u0e39งส\u0e38ด 5 นาท\u0e35"
		});
		_state.TikTokError = "กร\u0e38ณาล\u0e47อกอ\u0e34น TikTok ในหน\u0e49าต\u0e48าง Chrome ท\u0e35\u0e48เป\u0e34ดข\u0e36\u0e49นมา";
		try
		{
			await page.GotoAsync("https://www.tiktok.com/login", new PageGotoOptions
			{
				WaitUntil = WaitUntilState.DOMContentLoaded,
				Timeout = 90000f
			});
		}
		catch (Exception ex)
		{
			AppPaths.Log("login page: " + ex.Message);
		}
		DateTime deadline = DateTime.UtcNow.AddMinutes(5.0);
		while (DateTime.UtcNow < deadline && !token.IsCancellationRequested)
		{
			if (await HasTikTokSessionAsync(page))
			{
				_state.ClearTikTokError();
				_state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "ล\u0e47อกอ\u0e34น TikTok สำเร\u0e47จ — ไปหน\u0e49า LIVE ต\u0e48อ"
				});
				return;
			}
			await Task.Delay(2000, token);
		}
		if (await HasTikTokSessionAsync(page))
		{
			return;
		}
		throw new InvalidOperationException("ย\u0e31งไม\u0e48พบการล\u0e47อกอ\u0e34น TikTok. ในหน\u0e49าต\u0e48าง Chrome ของ Relay ให\u0e49ล\u0e47อกอ\u0e34นให\u0e49เสร\u0e47จ (ถ\u0e49า QR ไม\u0e48ข\u0e36\u0e49น ลองร\u0e35เฟรชหน\u0e49า login) แล\u0e49วกด Connect อ\u0e35กคร\u0e31\u0e49ง");
	}

	private static async Task<bool> HasTikTokSessionAsync(IPage page)
	{
		try
		{
			foreach (BrowserContextCookiesResult item in await page.Context.CookiesAsync("https://www.tiktok.com"))
			{
				string text = item.Name ?? "";
				if ((text.Equals("sessionid", StringComparison.OrdinalIgnoreCase) || text.Equals("sessionid_ss", StringComparison.OrdinalIgnoreCase) || text.Equals("sid_tt", StringComparison.OrdinalIgnoreCase) || text.Equals("sid_guard", StringComparison.OrdinalIgnoreCase)) && !string.IsNullOrWhiteSpace(item.Value) && item.Value.Length > 8)
				{
					return true;
				}
			}
		}
		catch
		{
		}
		return false;
	}

	private static async Task<bool> LooksLikeCommentsDisabledGuestAsync(IPage page)
	{
		try
		{
			string text = await page.EvaluateAsync<string>("() => (document.body && document.body.innerText) ? document.body.innerText : ''");
			if (string.IsNullOrEmpty(text))
			{
				return false;
			}
			return text.Contains("Comments off", StringComparison.OrdinalIgnoreCase) || text.Contains("ความค\u0e34ดเห\u0e47นถ\u0e39กป\u0e34ด", StringComparison.OrdinalIgnoreCase) || text.Contains("Log in to comment", StringComparison.OrdinalIgnoreCase) || text.Contains("Log in to see", StringComparison.OrdinalIgnoreCase);
		}
		catch
		{
			return false;
		}
	}

	private async Task TryHelpLivePageAsync(IPage page, CancellationToken token)
	{
		_ = 3;
		try
		{
			for (int i = 0; i < 12; i++)
			{
				if (token.IsCancellationRequested)
				{
					break;
				}
				if (_webcastReady?.Task.IsCompletedSuccessfully ?? false)
				{
					break;
				}
				await Task.Delay(2500, token);
				await DismissBlockingUiAsync(page);
				if (await LooksLikeCommentsDisabledGuestAsync(page) && i == 1)
				{
					_state.PushLog(new LogEntry
					{
						Kind = "system",
						Text = "ย\u0e31งข\u0e36\u0e49น Comments off ใน Chrome ของ Relay = ต\u0e49องล\u0e47อกอ\u0e34นบ\u0e31ญช\u0e35ในหน\u0e49าต\u0e48างน\u0e35\u0e49"
					});
				}
				if (i != 3)
				{
					continue;
				}
				TaskCompletionSource<bool> webcastReady = _webcastReady;
				if (webcastReady == null || !webcastReady.Task.IsCompletedSuccessfully)
				{
					_state.PushLog(new LogEntry
					{
						Kind = "system",
						Text = "Reloading LIVE page once..."
					});
					try
					{
						await page.ReloadAsync(new PageReloadOptions
						{
							WaitUntil = WaitUntilState.DOMContentLoaded,
							Timeout = 60000f
						});
					}
					catch
					{
					}
				}
			}
		}
		catch (OperationCanceledException)
		{
		}
		catch (Exception ex2)
		{
			AppPaths.Log("help live page: " + ex2.Message);
		}
	}

	private static async Task DismissBlockingUiAsync(IPage page)
	{
		string[] array = new string[9] { "button:has-text('Accept all')", "button:has-text('Accept')", "button:has-text('Allow all')", "button:has-text('Got it')", "button:has-text('Watch now')", "button:has-text('Continue')", "button:has-text('Refresh')", "[data-e2e='modal-close-inner-button']", "[aria-label='Close']" };
		string[] array2 = array;
		string[] array3 = array2;
		string[] array4 = array3;
		foreach (string selector in array4)
		{
			try
			{
				ILocator loc = page.Locator(selector).First;
				bool flag = await loc.CountAsync() > 0;
				bool flag2 = flag;
				if (flag2)
				{
					flag2 = await loc.IsVisibleAsync();
				}
				if (flag2)
				{
					await loc.ClickAsync(new LocatorClickOptions
					{
						Timeout = 800f
					});
				}
			}
			catch
			{
			}
		}
	}

	private static async Task<string> SafeTitleAsync(IPage page)
	{
		try
		{
			return await page.TitleAsync();
		}
		catch
		{
			return "(no title)";
		}
	}

	private static string TruncateUrl(string url)
	{
		if (string.IsNullOrEmpty(url))
		{
			return "";
		}
		if (url.Length > 180)
		{
			return url.Substring(0, 180) + "...";
		}
		return url;
	}

	private void ProcessFrame(IWebSocketFrame frame)
	{
		byte[] array = null;
		try
		{
			array = frame.Binary;
		}
		catch
		{
		}
		if (array != null && array.Length != 0)
		{
			foreach (GiftPayload item in _decoder.TryParseGiftFrames(array))
			{
				QueueGiftDelivery(item);
			}
			return;
		}
		string text = null;
		try
		{
			text = frame.Text;
		}
		catch
		{
		}
		if (string.IsNullOrEmpty(text))
		{
			return;
		}
		try
		{
			byte[] array2 = Convert.FromBase64String(text);
			if (array2.Length == 0)
			{
				return;
			}
			foreach (GiftPayload item2 in _decoder.TryParseGiftFrames(array2))
			{
				QueueGiftDelivery(item2);
			}
		}
		catch
		{
		}
	}

	private void QueueGiftDelivery(GiftPayload payload)
	{
		string text = payload.MessageType ?? "SendGift";
		if (IsRoomEnterMessage(text))
		{
			try { _liveStats.RecordWelcome(payload); }
			catch { }
		}
		if (text.Contains("Chat", StringComparison.OrdinalIgnoreCase))
		{
			if (string.IsNullOrWhiteSpace(payload.Comment))
			{
				return;
			}
			payload.Comment = payload.Comment.Trim();
			payload.RepeatCount = 1;
			payload.RepeatEnd = true;
			_ = Task.Run(async delegate
			{
				try
				{
					await DeliverGiftNowAsync(payload);
				}
				catch (Exception ex)
				{
					_state.PushLog(new LogEntry
					{
						Kind = "error",
						Text = ex.Message
					});
				}
			});
			return;
		}
		if (string.IsNullOrWhiteSpace(payload.GiftName))
		{
			if (text.Contains("Like", StringComparison.OrdinalIgnoreCase))
			{
				payload.GiftName = "Like";
			}
			else
			{
				if (!text.Contains("Follow", StringComparison.OrdinalIgnoreCase))
				{
					return;
				}
				payload.GiftName = "Follow";
			}
		}
		payload.GiftName = payload.GiftName.Trim();
		payload.RepeatCount = ((payload.RepeatCount <= 0) ? 1 : payload.RepeatCount);
		if (text.Contains("Like", StringComparison.OrdinalIgnoreCase))
		{
			QueueLikeCoalesced(payload);
			return;
		}
		bool isFollow = text.Contains("Follow", StringComparison.OrdinalIgnoreCase);
		string who = FirstNonEmpty(payload.UserName, payload.Nickname, "viewer");
		// IMPORTANT: merge by user+gift, NOT OrderId.
		// TikTok often changes OrderId every combo tick; merging by OrderId sends x1+x2+…+xN (=15 for combo 5).
		string mergeKey = isFollow ? BuildIdentity(payload, isFollow: true, who) : BuildComboMergeKey(payload, who);
		GiftPayload incoming = CloneGift(payload);

		// Solo / multi-send path: count stays at 1 (with OR without RepeatEnd).
		// Rose true-combo rises RepeatCount>1 and clears this accumulator.
		if (!isFollow && incoming.RepeatCount <= 1)
		{
			long soloNow = Environment.TickCount64;
			bool hasEventId = !string.IsNullOrWhiteSpace(incoming.OrderId) || !string.IsNullOrWhiteSpace(incoming.LogId);
			lock (_deliverGate)
			{
				if (hasEventId)
				{
					if (IsDuplicateGiftEventId(incoming, soloNow))
					{
						DevLogService.Write("gift.queue", "skip dup solo frame", new { mergeKey, gift = incoming.GiftName });
						return;
					}
					RememberGiftEventId(incoming, soloNow);
				}
				else if (_pendingSoloAt.TryGetValue(mergeKey, out long lastSolo) && soloNow - lastSolo < SoloEmptyIdGapMs)
				{
					DevLogService.Write("gift.queue", "skip empty-id solo gap", new { mergeKey, gift = incoming.GiftName });
					return;
				}
				_pendingSoloAt[mergeKey] = soloNow;
			}
			int add = Math.Max(1, incoming.RepeatCount);
			_pendingSoloUnits.AddOrUpdate(mergeKey, add, (_, n) => n + add);
			DevLogService.Write("gift.queue", "solo unit +", new
			{
				mergeKey,
				gift = incoming.GiftName,
				add,
				repeatEnd = incoming.RepeatEnd,
				pending = _pendingSoloUnits.TryGetValue(mergeKey, out int p) ? p : add
			});
		}
		else if (!isFollow && incoming.RepeatCount > 1)
		{
			// True combo growth — solo accumulator must not inflate sendCount.
			_pendingSoloUnits.TryRemove(mergeKey, out _);
			_pendingSoloAt.TryRemove(mergeKey, out _);
		}

		_latestGift.AddOrUpdate(mergeKey, incoming, (string _, GiftPayload prev) => MergeGiftPayload(prev, incoming));
		// Dual-path A: announce UI immediately (once per combo); game waits for finalize below.
		GiftPayload uiPayload = _latestGift.TryGetValue(mergeKey, out GiftPayload? latest) && latest != null ? latest : incoming;
		AnnounceUiOnce(mergeKey, uiPayload, isFollow);
		CancellationTokenSource cts = new CancellationTokenSource();
		_giftDebounce.AddOrUpdate(mergeKey, cts, delegate(string _, CancellationTokenSource previous)
		{
			try
			{
				previous.Cancel();
				previous.Dispose();
			}
			catch
			{
			}
			return cts;
		});
		bool rouletteGift = !isFollow && _roulette.TryMatch(incoming.GiftName, out _);
		// Solo bursts (count==1): always coalesce so N×x1 → one game line xN (like Rose).
		// Roulette: wait for the combo streak to finish, then one spin with the final ×N.
		int millisecondsDelay = isFollow
			? FollowDebounceMs
			: rouletteGift
				? GiftRouletteCoalesceMs
				: (incoming.RepeatCount <= 1
					? GiftSoloCoalesceMs
					: (payload.RepeatEnd ? GiftDebounceRepeatEndMs : GiftComboFinalizeMs));
		Task.Run(async delegate
		{
			try
			{
				if (millisecondsDelay > 0)
				{
					await Task.Delay(millisecondsDelay, cts.Token);
				}
				else
				{
					await Task.Yield();
				}
				cts.Token.ThrowIfCancellationRequested();
				await TryDeliverMergedAsync(mergeKey, isFollow, who);
			}
			catch (OperationCanceledException)
			{
			}
			catch (Exception ex2)
			{
				_state.PushLog(new LogEntry
				{
					Kind = "error",
					Text = ex2.Message
				});
			}
			finally
			{
				// Free debounce so RouletteRespinGapMs can release announce hold.
				if (_giftDebounce.TryGetValue(mergeKey, out CancellationTokenSource? cur) && ReferenceEquals(cur, cts))
				{
					_giftDebounce.TryRemove(mergeKey, out _);
					try { cts.Dispose(); } catch { }
				}
			}
		});
	}

	/// <summary>
	/// Approach A — fan-out to UI immediately (kind=ui / roulette). No /livemsg.
	/// One announce per combo mergeKey.
	/// Roulette: never re-announce on TikTok combo count reset (xN→x1) — that caused 2 spins / 2 winners.
	/// </summary>
	private void AnnounceUiOnce(string mergeKey, GiftPayload payload, bool isFollow)
	{
		int count = payload.RepeatCount <= 0 ? 1 : payload.RepeatCount;
		RouletteRule? rouletteRule = null;
		bool isRouletteTrigger = false;
		if (!isFollow && _roulette.TryMatch(payload.GiftName, out RouletteRule matchedRule))
		{
			isRouletteTrigger = true;
			rouletteRule = matchedRule;
		}
		bool should = false;
		long now = Environment.TickCount64;
		lock (_deliverGate)
		{
			MaybeReleaseRouletteAnnounce_NoLock(mergeKey, now);

			if (!_uiAnnouncedCount.TryGetValue(mergeKey, out int prev))
			{
				_uiAnnouncedCount[mergeKey] = count;
				should = true;
			}
			else if (!isRouletteTrigger && count == 1 && prev > 1)
			{
				// Normal gifts: new solo after combo. Roulette must NOT — TikTok often resets count mid-combo.
				_uiAnnouncedCount[mergeKey] = count;
				should = true;
			}
			else if (isRouletteTrigger)
			{
				// Keep hold sticky for the whole combo even if count ticks after announce.
				_rouletteHeldMergeKeys[mergeKey] = 1;
				if (count > prev) _uiAnnouncedCount[mergeKey] = count;
			}
		}
		if (!should) return;

		string who = FirstNonEmpty(payload.Nickname, payload.UserName, "viewer");
		if (isRouletteTrigger && rouletteRule != null)
		{
			_rouletteHeldMergeKeys[mergeKey] = 1;
			string options = string.Join("|", rouletteRule.Outcomes
				.Select((RouletteOutcome o) => (o.GiftName ?? string.Empty).Trim())
				.Where((string o) => o.Length > 0));
			_state.PushLog(new LogEntry
			{
				Kind = "roulette",
				Text = $"[ROULETTE] {payload.GiftName} x{count} :: {options} :: from {who}",
				Sent = 0,
				WindowSent = false,
				Nickname = who,
				AvatarUrl = (payload.AvatarUrl ?? "").Trim()
			});
			DevLogService.Write("gift.ui", "announce roulette", new { mergeKey, gift = payload.GiftName, count });
			return;
		}

		string line = isFollow
			? $"Follow from {who}"
			: $"{payload.GiftName} x{count} from {who}";
		_state.PushLog(new LogEntry
		{
			Kind = "ui",
			Text = line,
			Sent = 0,
			WindowSent = false,
			Nickname = who,
			AvatarUrl = (payload.AvatarUrl ?? "").Trim()
		});
		DevLogService.Write("gift.ui", "announce ui", new { mergeKey, gift = payload.GiftName, count, isFollow });
	}

	private static GiftPayload CloneGift(GiftPayload src)
	{
		return new GiftPayload
		{
			MessageType = src.MessageType,
			Type = src.Type,
			MsgType = src.MsgType,
			Platform = src.Platform,
			GiftName = src.GiftName,
			UserName = src.UserName,
			Nickname = src.Nickname,
			AvatarUrl = src.AvatarUrl,
			Comment = src.Comment,
			RepeatCount = src.RepeatCount,
			RepeatEnd = src.RepeatEnd,
			GiftId = src.GiftId,
			OrderId = src.OrderId,
			LogId = src.LogId,
			GroupId = src.GroupId,
			Timestamp = src.Timestamp,
			DiamondCount = src.DiamondCount,
			GiftPictureUrl = src.GiftPictureUrl,
			RoomUserSeq = src.RoomUserSeq,
			UserLevel = src.UserLevel,
			IsSuperFan = src.IsSuperFan,
			FanClubLevel = src.FanClubLevel
		};
	}

	private static GiftPayload MergeGiftPayload(GiftPayload prev, GiftPayload incoming)
	{
		GiftPayload best = prev;
		if (incoming.RepeatCount > prev.RepeatCount)
		{
			best = incoming;
		}
		else if (incoming.RepeatCount == prev.RepeatCount && incoming.RepeatEnd && !prev.RepeatEnd)
		{
			best = incoming;
		}
		else if (string.IsNullOrEmpty(prev.OrderId) && !string.IsNullOrEmpty(incoming.OrderId))
		{
			best = incoming;
		}
		else if (string.IsNullOrEmpty(prev.LogId) && !string.IsNullOrEmpty(incoming.LogId))
		{
			best = incoming;
		}
		else
		{
			return prev;
		}
		if (string.IsNullOrEmpty(best.OrderId) && !string.IsNullOrEmpty(prev.OrderId)) best.OrderId = prev.OrderId;
		if (string.IsNullOrEmpty(best.LogId) && !string.IsNullOrEmpty(prev.LogId)) best.LogId = prev.LogId;
		if (best.GroupId == 0 && prev.GroupId != 0) best.GroupId = prev.GroupId;
		if (best.GiftId == null && prev.GiftId != null) best.GiftId = prev.GiftId;
		if (string.IsNullOrEmpty(best.AvatarUrl) && !string.IsNullOrEmpty(prev.AvatarUrl)) best.AvatarUrl = prev.AvatarUrl;
		if (best.DiamondCount <= 0 && prev.DiamondCount > 0) best.DiamondCount = prev.DiamondCount;
		else if (prev.DiamondCount > best.DiamondCount) best.DiamondCount = prev.DiamondCount;
		if (string.IsNullOrEmpty(best.GiftPictureUrl) && !string.IsNullOrEmpty(prev.GiftPictureUrl))
			best.GiftPictureUrl = prev.GiftPictureUrl;
		if (best.RoomUserSeq <= 0 && prev.RoomUserSeq > 0) best.RoomUserSeq = prev.RoomUserSeq;
		else if (incoming.RoomUserSeq > 0) best.RoomUserSeq = incoming.RoomUserSeq;
		if (incoming.UserLevel > best.UserLevel) best.UserLevel = incoming.UserLevel;
		else if (prev.UserLevel > best.UserLevel) best.UserLevel = prev.UserLevel;
		if (incoming.FanClubLevel > best.FanClubLevel) best.FanClubLevel = incoming.FanClubLevel;
		else if (prev.FanClubLevel > best.FanClubLevel) best.FanClubLevel = prev.FanClubLevel;
		best.IsSuperFan = best.IsSuperFan || incoming.IsSuperFan || prev.IsSuperFan;
		return best;
	}

	private async Task TryDeliverMergedAsync(string mergeKey, bool isFollow, string who)
	{
		GiftPayload? value;
		if (!_latestGift.TryGetValue(mergeKey, out value) || value == null)
		{
			return;
		}
		int count = value.RepeatCount <= 0 ? 1 : value.RepeatCount;
		string identity = mergeKey; // same key used for debounce + dedupe
		long now = Environment.TickCount64;
		PruneDelivered(now);
		int sendCount = count;
		int comboUnits = count;
		RouletteRule? pendingRoulette = null;

		lock (_deliverGate)
		{
			if (!_latestGift.TryGetValue(mergeKey, out value) || value == null)
			{
				return;
			}
			count = value.RepeatCount <= 0 ? 1 : value.RepeatCount;
			identity = mergeKey;
			now = Environment.TickCount64;

			_deliveredCount.TryGetValue(identity, out int lastCount);
			_deliveredAt.TryGetValue(identity, out long lastAt);
				_pendingSoloUnits.TryRemove(mergeKey, out int soloUnits);
			_pendingSoloAt.TryRemove(mergeKey, out _);

			if (isFollow)
			{
				if (lastCount > 0 && now - lastAt < FollowIdentityTtlMs)
				{
					return;
				}
				sendCount = 1;
				_deliveredCount[identity] = 1;
				_deliveredAt[identity] = now;
				_latestGift.TryRemove(mergeKey, out _);
				_uiAnnouncedCount.TryRemove(mergeKey, out _);
			}
			else
			{
				// Games ADD each /livemsg — send finished combo ONCE with FULL final count.
				_deliveredGroupId.TryGetValue(identity, out long lastGroup);
				long groupId = value.GroupId;
				bool inWindow = lastCount > 0 && now - lastAt < IdentityTtlMs;
				bool groupChanged = groupId != 0 && lastGroup != 0 && groupId != lastGroup;
				long sinceLast = lastCount > 0 ? now - lastAt : long.MaxValue;

				// Solo spam flush: N distinct x1 events → one game line with sendCount=N.
				bool rouletteGift = _roulette.TryMatch(value.GiftName, out _);
				if (soloUnits > 0 && count <= 1)
				{
					sendCount = Math.Max(1, soloUnits);
					DevLogService.Write("gift.deliver", "solo flush", new { mergeKey, soloUnits, sendCount, gift = value.GiftName });
				}
				else
				{
					bool countIncreased = inWindow && !groupChanged && count > lastCount;
					// Never block combo growth on reused OrderId/LogId — only drop true duplicate frames.
					if (!countIncreased && IsDuplicateGiftEventId(value, now))
					{
						_latestGift.TryRemove(mergeKey, out _);
						_uiAnnouncedCount.TryRemove(mergeKey, out _);
						return;
					}

					if (inWindow && !groupChanged)
					{
						if (count < lastCount)
						{
							if (!rouletteGift && sinceLast < 400)
							{
								_latestGift.TryRemove(mergeKey, out _);
								return;
							}
							// new combo after reset → send full new count below
						}
						else if (count == lastCount)
						{
							if (rouletteGift)
							{
								// Same-size next combo (x3 then another x3) must still send.
								// Only drop duplicate ticks that arrive too close.
								if (sinceLast < NewSoloGiftMinGapMs)
								{
									_latestGift.TryRemove(mergeKey, out _);
									return;
								}
								sendCount = count;
							}
							else if (!(count == 1 && sinceLast >= NewSoloGiftMinGapMs))
							{
								_latestGift.TryRemove(mergeKey, out _);
								return;
							}
						}
						else if (count > lastCount)
						{
							// ALWAYS send only the delta. Sending full count again caused
							// triangular sums (1+2+…+N) when roses arrive one-by-one slower than 400ms.
							sendCount = count - lastCount;
						}
					}
				}

				if (sendCount <= 0)
				{
					_latestGift.TryRemove(mergeKey, out _);
					return;
				}

				value.RepeatEnd = true;
				value.RepeatCount = sendCount;
				// Solo spam stays at streak 1 in tracker; true combo stores peak count for deltas.
				_deliveredCount[identity] = (soloUnits > 0 && count <= 1) ? 1 : count;
				_deliveredAt[identity] = now;
				if (groupId != 0) _deliveredGroupId[identity] = groupId;
				RememberGiftEventId(value, now);
				_latestGift.TryRemove(mergeKey, out _);
				// Roulette: keep announce+hold markers so late combo ticks cannot spin again.
				bool rouletteCombo = _rouletteHeldMergeKeys.ContainsKey(mergeKey)
					|| _roulette.TryMatch(value.GiftName, out _);
				if (!rouletteCombo)
				{
					_uiAnnouncedCount.TryRemove(mergeKey, out _);
				}
				else
				{
					_uiAnnouncedCount[mergeKey] = Math.Max(count, _uiAnnouncedCount.TryGetValue(mergeKey, out int ac) ? ac : 0);
					_rouletteHeldMergeKeys[mergeKey] = 1;
					if (_roulette.TryMatch(value.GiftName, out RouletteRule spinRule))
					{
						// sendCount is already the unique units of THIS flush (solo N or combo delta).
						// Never use peak RepeatCount — that double-sends units already queued.
						comboUnits = sendCount < 1 ? 1 : sendCount;
						if (_rouletteEnqueuedMergeKeys.TryAdd(mergeKey, 1))
						{
							pendingRoulette = spinRule;
						}
						else if (_rouletteSpin.TryBumpCombo(mergeKey, comboUnits))
						{
							DevLogService.Write("gift.roulette", "combo bump", new { mergeKey, comboUnits, gift = value.GiftName });
						}
						else
						{
							// Spin already running — queue another job with only the new units.
							pendingRoulette = spinRule;
							DevLogService.Write("gift.roulette", "enqueue next spin", new { mergeKey, comboUnits, gift = value.GiftName });
						}
					}
				}
			}
		}

		if (sendCount <= 0)
		{
			return;
		}
		value!.RepeatCount = sendCount;
		DevLogService.Write("gift.deliver", "merged flush → game", new
		{
			mergeKey,
			isFollow,
			who,
			sendCount,
			gift = value.GiftName
		});

		if (pendingRoulette != null)
		{
			// Game overlay shows Nickname; UniqueId (A-tai888) must not replace display name (leetaifa).
			string displayWho = FirstNonEmpty(value.Nickname, value.UserName, "ผู้ชม");
			_rouletteSpin.EnqueueFromRule(value.GiftName ?? "", comboUnits, displayWho, pendingRoulette, value.UserName, mergeKey);
		}

		try
		{
			if (isFollow)
			{
				_liveStats.RecordFollow(value);
			}
			else
			{
				_liveStats.RecordGift(value);
				int copies = value.RepeatCount <= 0 ? 1 : value.RepeatCount;
				_photoPrint.EnqueueFromGift(
					FirstNonEmpty(value.Nickname, value.UserName, "ผู้ชม"),
					value.UserName ?? "",
					value.AvatarUrl ?? "",
					value.GiftName ?? "",
					copies);
			}
		}
		catch (Exception ex)
		{
			AppPaths.Log("live-stats gift: " + ex.Message);
		}

		await DeliverGiftToGameAsync(value, mergeKey);
	}

	private bool IsDuplicateGiftEventId(GiftPayload value, long now)
	{
		foreach (string? id in new[] { value.OrderId, value.LogId })
		{
			if (string.IsNullOrWhiteSpace(id)) continue;
			if (_deliveredEventIds.TryGetValue(id.Trim(), out long at) && now - at < DeliveredEventIdTtlMs)
			{
				return true;
			}
		}
		return false;
	}

	private void RememberGiftEventId(GiftPayload value, long now)
	{
		foreach (string? id in new[] { value.OrderId, value.LogId })
		{
			if (string.IsNullOrWhiteSpace(id)) continue;
			_deliveredEventIds[id.Trim()] = now;
		}
		// prune occasionally
		if (_deliveredEventIds.Count > 400)
		{
			foreach (KeyValuePair<string, long> pair in _deliveredEventIds.ToArray())
			{
				if (now - pair.Value >= DeliveredEventIdTtlMs)
				{
					_deliveredEventIds.TryRemove(pair.Key, out _);
				}
			}
		}
	}

	/// <summary>Merge key for gift combos: same sender+gift coalesces all ticks regardless of OrderId.</summary>
	private static string BuildComboMergeKey(GiftPayload payload, string who)
	{
		string gift = string.IsNullOrWhiteSpace(payload.GiftName) ? "?" : payload.GiftName.Trim();
		long gid = payload.GiftId ?? 0L;
		return $"combo:{who}|{gift}|{gid}";
	}

	/// <summary>Stable event identity — never includes RepeatCount (count tracked separately).</summary>
	private static string BuildIdentity(GiftPayload payload, bool isFollow, string who)
	{
		if (isFollow)
		{
			return "follow|" + who;
		}
		return BuildComboMergeKey(payload, who);
	}

	private void PruneDelivered(long now = -1L)
	{
		if (now < 0)
		{
			now = Environment.TickCount64;
		}
		foreach (KeyValuePair<string, long> pair in _deliveredAt.ToArray())
		{
			int ttl = pair.Key.StartsWith("follow|", StringComparison.OrdinalIgnoreCase)
				? FollowIdentityTtlMs
				: IdentityTtlMs;
			if (now - pair.Value >= ttl)
			{
				_deliveredAt.TryRemove(pair.Key, out _);
				_deliveredCount.TryRemove(pair.Key, out _);
				_deliveredGroupId.TryRemove(pair.Key, out _);
				_uiAnnouncedCount.TryRemove(pair.Key, out _);
				_rouletteHeldMergeKeys.TryRemove(pair.Key, out _);
				_rouletteEnqueuedMergeKeys.TryRemove(pair.Key, out _);
			}
			else if (_rouletteHeldMergeKeys.ContainsKey(pair.Key) && now - pair.Value >= RouletteRespinGapMs)
			{
				// Roulette combo finished — free the key so a real later gift can spin again.
				if (!_giftDebounce.ContainsKey(pair.Key) && !_latestGift.ContainsKey(pair.Key))
				{
					_uiAnnouncedCount.TryRemove(pair.Key, out _);
					_rouletteHeldMergeKeys.TryRemove(pair.Key, out _);
					_rouletteEnqueuedMergeKeys.TryRemove(pair.Key, out _);
				}
			}
		}
	}

	/// <summary>Caller must hold _deliverGate.</summary>
	private void MaybeReleaseRouletteAnnounce_NoLock(string mergeKey, long now)
	{
		if (!_rouletteHeldMergeKeys.ContainsKey(mergeKey)) return;
		if (_giftDebounce.ContainsKey(mergeKey) || _latestGift.ContainsKey(mergeKey)) return;
		if (!_deliveredAt.TryGetValue(mergeKey, out long at)) return;
		if (now - at < RouletteRespinGapMs) return;
		_uiAnnouncedCount.TryRemove(mergeKey, out _);
		_rouletteHeldMergeKeys.TryRemove(mergeKey, out _);
		_rouletteEnqueuedMergeKeys.TryRemove(mergeKey, out _);
	}

	private static string FirstNonEmpty(params string?[] values)
	{
		foreach (string text in values)
		{
			if (!string.IsNullOrWhiteSpace(text))
			{
				return text.Trim();
			}
		}
		return "";
	}

	private void QueueLikeCoalesced(GiftPayload payload)
	{
		bool forceNow = false;
		bool announceUi = false;
		CancellationTokenSource? cts = null;
		lock (_likeGate)
		{
			long now = Environment.TickCount64;
			if (_likePendingCount <= 0 || _likeBatchStartedAt == 0)
			{
				_likeBatchStartedAt = now;
				_likeUiAnnounced = false;
			}
			_likePendingCount += Math.Max(1, payload.RepeatCount);
			_likePendingSample = payload;
			if (!_likeUiAnnounced)
			{
				_likeUiAnnounced = true;
				announceUi = true;
			}

			if (now - _likeBatchStartedAt >= LikeMaxHoldMs)
			{
				forceNow = true;
				try
				{
					_likeFlushCts?.Cancel();
					_likeFlushCts?.Dispose();
				}
				catch
				{
				}
				_likeFlushCts = null;
			}
			else
			{
				try
				{
					_likeFlushCts?.Cancel();
					_likeFlushCts?.Dispose();
				}
				catch
				{
				}
				cts = new CancellationTokenSource();
				_likeFlushCts = cts;
			}
		}

		if (announceUi)
		{
			string who = FirstNonEmpty(payload.Nickname, payload.UserName, "viewer");
			_state.PushLog(new LogEntry
			{
				Kind = "ui",
				Text = $"Like x1 from {who}",
				Sent = 0,
				WindowSent = false,
				Nickname = who,
				AvatarUrl = (payload.AvatarUrl ?? "").Trim()
			});
			DevLogService.Write("gift.ui", "announce like", new { who });
		}

		if (forceNow)
		{
			_ = FlushPendingLikesAsync();
			return;
		}

		CancellationTokenSource delayCts = cts!;
		Task.Run(async delegate
		{
			try
			{
				await Task.Delay(LikeFlushDelayMs, delayCts.Token);
				await FlushPendingLikesAsync();
			}
			catch (OperationCanceledException)
			{
			}
			catch (Exception ex2)
			{
				_state.PushLog(new LogEntry
				{
					Kind = "error",
					Text = ex2.Message
				});
			}
		});
	}

	private async Task FlushPendingLikesAsync()
	{
		GiftPayload? payload2;
		lock (_likeGate)
		{
			if (_likePendingCount <= 0 || _likePendingSample == null)
			{
				return;
			}
			payload2 = new GiftPayload
			{
				MessageType = "SendLike",
				Type = "SendLike",
				MsgType = "SendLike",
				GiftName = "Like",
				RepeatCount = _likePendingCount,
				RepeatEnd = true,
				UserName = _likePendingSample.UserName,
				Nickname = _likePendingSample.Nickname,
				AvatarUrl = _likePendingSample.AvatarUrl,
				UserLevel = _likePendingSample.UserLevel,
				IsSuperFan = _likePendingSample.IsSuperFan,
				FanClubLevel = _likePendingSample.FanClubLevel
			};
			_likePendingCount = 0;
			_likePendingSample = null;
			_likeBatchStartedAt = 0;
			_likeUiAnnounced = false;
			try
			{
				_likeFlushCts?.Cancel();
				_likeFlushCts?.Dispose();
			}
			catch
			{
			}
			_likeFlushCts = null;
		}
		try { _liveStats.RecordLike(payload2); }
		catch { }
		await DeliverGiftToGameAsync(payload2);
	}

	/// <summary>Chat / legacy single-shot path (also used if something calls deliver without dual-path).</summary>
	private async Task DeliverGiftNowAsync(GiftPayload payload)
	{
		string text2 = payload.MessageType ?? "SendGift";
		if (text2.Contains("Chat", StringComparison.OrdinalIgnoreCase))
		{
			string who = FirstNonEmpty(payload.Nickname, payload.UserName, "viewer");
			try { _liveStats.RecordChat(payload); }
			catch { }
			_state.PushLog(new LogEntry
			{
				Kind = "chat",
				Text = $"Chat: {payload.Comment} from {who}",
				Sent = 0,
				WindowSent = false
			});
			await DeliverGiftToGameAsync(payload);
			return;
		}
		await DeliverGiftToGameAsync(payload);
	}

	/// <summary>
	/// Game path only — enqueue /livemsg. Logs kind=game so UI does not re-trigger functions.
	/// Roulette triggers are held (UI already spinning from kind=roulette announce).
	/// </summary>
	private async Task DeliverGiftToGameAsync(GiftPayload payload, string? mergeKey = null)
	{
		string text = FirstNonEmpty(payload.Nickname, payload.UserName, "viewer");
		string text2 = payload.MessageType ?? "SendGift";
		bool isLike = text2.Contains("Like", StringComparison.OrdinalIgnoreCase);
		bool isFollow = text2.Contains("Follow", StringComparison.OrdinalIgnoreCase);
		bool isChat = text2.Contains("Chat", StringComparison.OrdinalIgnoreCase) ||
		              text2.Contains("Comment", StringComparison.OrdinalIgnoreCase);
		string kind = isChat ? "chat" : (isLike ? "like" : (isFollow ? "follow" : "gift"));
		string text4 = kind switch
		{
			"like" => $"Like x{payload.RepeatCount} from {text}",
			"follow" => "Follow from " + text,
			"chat" => $"Chat: {payload.Comment} from {text}",
			_ => $"{payload.GiftName} x{payload.RepeatCount} from {text}"
		};

		// Sticky hold: announced as roulette for this combo → never send trigger to game.
		bool held = !string.IsNullOrEmpty(mergeKey) && _rouletteHeldMergeKeys.ContainsKey(mergeKey!);
		bool matched = kind == "gift" && _roulette.TryMatch(payload.GiftName, out _);
		if (kind == "gift" && (held || matched))
		{
			AppPaths.Log($"roulette-hold-game-skip gift={payload.GiftName} count={payload.RepeatCount} held={held} matched={matched}");
			DevLogService.Write("gift.deliver", "roulette skip game", new { gift = payload.GiftName, count = payload.RepeatCount, held, matched });
			_state.PushLog(new LogEntry
			{
				Kind = "game",
				Text = $"[GAME-SKIP roulette] {text4}",
				Sent = 0,
				WindowSent = false
			});
			return;
		}

		DeliveryResult deliveryResult = await _gameBridge.DeliverGiftAsync(payload);
		_state.PushLog(new LogEntry
		{
			Kind = "game",
			Text = text4,
			Sent = deliveryResult.TotalSent,
			WindowSent = deliveryResult.WindowSent
		});
		DevLogService.Write("gift.deliver", "game ok", new
		{
			gift = payload.GiftName,
			count = payload.RepeatCount,
			sent = deliveryResult.TotalSent
		});
	}

	private static bool UseChromeReader()
	{
		string? mode = Environment.GetEnvironmentVariable("TEMPLEGIFT_TIKTOK_READER");
		if (string.Equals(mode, "chrome", StringComparison.OrdinalIgnoreCase))
		{
			return true;
		}
		return string.Equals(Environment.GetEnvironmentVariable("TEMPLEGIFT_USE_CHROME"), "1", StringComparison.OrdinalIgnoreCase);
	}

	private static bool ShouldFallbackToChrome(Exception ex, CancellationToken token)
	{
		if (token.IsCancellationRequested) return false;
		if (AppPaths.FindChrome() == null) return false;
		string m = ex.Message ?? "";
		if (m.Contains("ยังไม่กำลังไลฟ์", StringComparison.Ordinal)) return false;
		if (m.Contains("หา RoomId ไม่ได้", StringComparison.Ordinal)) return false;
		return m.Contains("canceled", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("timeout", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("timed out", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("ค้าง", StringComparison.Ordinal)
			|| m.Contains("เน็ตไป", StringComparison.Ordinal)
			|| m.Contains("Unable to connect", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("No such host", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("connection attempt", StringComparison.OrdinalIgnoreCase);
	}

	private static HttpClient CreateWebcastHttpClient()
	{
		SocketsHttpHandler handler = new SocketsHttpHandler
		{
			UseProxy = false,
			ConnectTimeout = TimeSpan.FromSeconds(8),
			ConnectCallback = Ipv4Network.ConnectIPv4FirstAsync
		};
		HttpClient client = new HttpClient(handler)
		{
			Timeout = TimeSpan.FromSeconds(15L)
		};
		client.DefaultRequestHeaders.TryAddWithoutValidation(
			"User-Agent",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
		client.DefaultRequestHeaders.TryAddWithoutValidation("Referer", "https://www.tiktok.com/");
		client.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json, text/plain, */*");
		return client;
	}

	/// <summary>
	/// Resolve room id via TikTok web API (avoids brittle HTML scrape / wrong-case uniqueId).
	/// </summary>
	private static async Task<(string? RoomId, bool? IsLive)> TryResolveRoomViaApiAsync(string uniqueId, CancellationToken token)
	{
		string url =
			"https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId="
			+ Uri.EscapeDataString(uniqueId)
			+ "&roomId=0";
		try
		{
			using HttpResponseMessage resp = await WebcastHttp.GetAsync(url, token);
			string body = await resp.Content.ReadAsStringAsync(token);
			if (string.IsNullOrWhiteSpace(body))
			{
				return (null, null);
			}
			if (body.Contains("user_not_found", StringComparison.OrdinalIgnoreCase))
			{
				AppPaths.Log("room-api user_not_found uniqueId=" + uniqueId);
				return (null, null);
			}
			using JsonDocument doc = JsonDocument.Parse(body);
			JsonElement root = doc.RootElement;
			if (!root.TryGetProperty("data", out JsonElement data) || data.ValueKind != JsonValueKind.Object)
			{
				return (null, null);
			}

			string? roomId = null;
			bool? isLive = null;

			if (data.TryGetProperty("user", out JsonElement user) && user.ValueKind == JsonValueKind.Object)
			{
				roomId = ReadJsonStringOrNumber(user, "roomId") ?? ReadJsonStringOrNumber(user, "room_id");
			}
			roomId ??= ReadJsonStringOrNumber(data, "roomId") ?? ReadJsonStringOrNumber(data, "room_id");

			if (data.TryGetProperty("liveRoom", out JsonElement liveRoom) && liveRoom.ValueKind == JsonValueKind.Object)
			{
				roomId ??= ReadJsonStringOrNumber(liveRoom, "roomId")
					?? ReadJsonStringOrNumber(liveRoom, "roomID")
					?? ReadJsonStringOrNumber(liveRoom, "room_id");
				if (liveRoom.TryGetProperty("status", out JsonElement st) && st.TryGetInt32(out int status))
				{
					// TikTok: status 2 = currently live
					isLive = status == 2;
				}
				else if (liveRoom.TryGetProperty("liveRoomStatus", out JsonElement lrs) && lrs.TryGetInt32(out int liveStatus))
				{
					isLive = liveStatus == 2 || liveStatus == 1;
				}
			}

			if (string.IsNullOrWhiteSpace(roomId) || roomId == "0")
			{
				return (null, isLive);
			}
			AppPaths.Log($"room-api ok uniqueId={uniqueId} room={roomId} isLive={isLive}");
			return (roomId, isLive);
		}
		catch (Exception ex)
		{
			AppPaths.Log("room-api fail: " + ex.Message);
			return (null, null);
		}
	}

	private static string? ReadJsonStringOrNumber(JsonElement obj, string name)
	{
		if (!obj.TryGetProperty(name, out JsonElement el))
		{
			return null;
		}
		return el.ValueKind switch
		{
			JsonValueKind.String => el.GetString(),
			JsonValueKind.Number => el.GetRawText(),
			_ => null
		};
	}

	private async Task ConnectViaWebcastClientAsync(string cleanUsername, CancellationToken token)
	{
		_state.PushLog(new LogEntry
		{
			Kind = "system",
			Text = "Connecting TikTok LIVE via webcast @" + cleanUsername + " (no Chrome)..."
		});
		AppPaths.Log("webcast-connect user=" + cleanUsername);
		Ipv4Network.FlushDns();

		(string? resolvedRoomId, bool? isLive) = await TryResolveRoomViaApiAsync(cleanUsername, token);
		if (isLive == false && string.IsNullOrWhiteSpace(resolvedRoomId))
		{
			throw new InvalidOperationException(
				"@" + cleanUsername + " ยังไม่กำลังไลฟ์อยู่ — เปิดไลฟ์ก่อน แล้วกด Connect อีกครั้ง");
		}
		if (isLive == false)
		{
			AppPaths.Log("room-api not-live but room=" + resolvedRoomId + " — try webcast anyway");
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "TikTok บอกว่าไลฟ์ดับ แต่ยังมี RoomId — ลองเชื่อมต่อต่อ"
			});
		}

		WarnIfTikFinityLikelyConnected();

		Exception? lastHang = null;
		for (int attempt = 1; attempt <= 2; attempt++)
		{
			if (attempt > 1)
			{
				Ipv4Network.FlushDns();
				_state.PushLog(new LogEntry
				{
					Kind = "system",
					Text = "webcast ค้าง — ล้าง DNS แล้วลองใหม่ครั้งที่ 2"
				});
				AppPaths.Log("webcast-retry attempt=2");
				await Task.Delay(700, token);
			}
			try
			{
				await ConnectWebcastAttemptAsync(cleanUsername, resolvedRoomId, token);
				return;
			}
			catch (OperationCanceledException) when (token.IsCancellationRequested)
			{
				throw;
			}
			catch (Exception ex) when (attempt < 2 && IsRetryableWebcastHang(ex))
			{
				lastHang = ex;
				AppPaths.Log("webcast-attempt-fail: " + ex.Message);
			}
		}
		if (lastHang != null)
		{
			throw lastHang;
		}
		throw new InvalidOperationException(
			"เชื่อมต่อ LIVE ไม่สำเร็จ @" + cleanUsername
			+ " — เน็ตไปเซิร์ฟเวอร์ไลฟ์ TikTok ค้าง (พบบ่อยหลัง AIS หลุด). รีโมเด็มหรือเปลี่ยน DNS เป็น 1.1.1.1 แล้วกด Connect อีกครั้ง");
	}

	private static bool IsRetryableWebcastHang(Exception ex)
	{
		string m = ex.Message ?? "";
		if (m.Contains("ยังไม่กำลังไลฟ์", StringComparison.Ordinal)) return false;
		if (m.Contains("หา RoomId ไม่ได้", StringComparison.Ordinal)) return false;
		return m.Contains("canceled", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("timeout", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("timed out", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("ค้าง", StringComparison.Ordinal)
			|| m.Contains("เน็ตไป", StringComparison.Ordinal)
			|| m.Contains("Unable to connect", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("No such host", StringComparison.OrdinalIgnoreCase)
			|| m.Contains("connection attempt", StringComparison.OrdinalIgnoreCase);
	}

	private async Task ConnectWebcastAttemptAsync(string cleanUsername, string? resolvedRoomId, CancellationToken token)
	{
		ClientSettings settings = Constants.DEFAULT_SETTINGS;
		settings.PrintToConsole = false;
		settings.LogLevel = LogLevel.Error;
		settings.RetryOnConnectionFailure = true;
		settings.HandleExistingMessagesOnConnect = false;
		settings.DownloadGiftInfo = false;
		settings.Timeout = 12f;
		if (Ipv4Network.Proxy != null)
		{
			settings.Proxy = Ipv4Network.Proxy;
		}
		string? signingKey = TryLoadSigningKey();
		if (!string.IsNullOrWhiteSpace(signingKey))
		{
			settings.SigningKey = signingKey.Trim();
			AppPaths.Log("webcast signing key loaded");
		}

		TikTokLiveClient client;
		if (!string.IsNullOrWhiteSpace(resolvedRoomId))
		{
			// Skip HTML scrape — connect by room id directly (main path, no Chrome).
			settings.SkipRoomInfo = true;
			client = new TikTokLiveClient(cleanUsername, resolvedRoomId, settings, null);
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "RoomId=" + resolvedRoomId + " — webcast direct (no Chrome)"
			});
		}
		else
		{
			client = new TikTokLiveClient(cleanUsername, null, settings, null);
		}
		_liveClient = client;

		TaskCompletionSource<bool> ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
		client.OnConnected += delegate(TikTokLiveClient _, bool connected)
		{
			if (!connected) return;
			NoteWebcastRestored(client, firstConnect: !ready.Task.IsCompleted);
			ready.TrySetResult(true);
		};
		client.OnDisconnected += delegate
		{
			BeginWebcastReconnectUi(client);
		};
		client.OnLiveEnded += delegate
		{
			CancelReconnectUiTimer();
			_state.TikTokReconnecting = false;
			_state.TikTokLive = false;
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "Host ended LIVE @" + cleanUsername
			});
		};
		client.OnException += delegate(object? _, Exception ex)
		{
			AppPaths.Log("webcast-exception: " + ex.Message);
			ready.TrySetException(ex);
			// After first connect, retries are noisy — keep gift log clean.
			if (!ready.Task.IsCompletedSuccessfully && !_state.TikTokConnected)
			{
				_state.PushLog(new LogEntry
				{
					Kind = "error",
					Text = "Webcast: " + ex.Message
				});
			}
		};
		client.OnGiftMessage += Client_OnGiftMessage;
		client.OnLike += Client_OnLike;
		client.OnFollow += Client_OnFollow;
		client.OnChatMessage += Client_OnChatMessage;
		client.OnBarrage += Client_OnBarrage;
		HookLiveRoomEvents(client);

		Exception? startError = null;
		_runTask = Task.Run(async delegate
		{
			try
			{
				await client.RunAsync(token, delegate(Exception ex)
				{
					startError = ex;
					ready.TrySetException(ex);
				}, retryConnection: true);
			}
			catch (OperationCanceledException)
			{
			}
			catch (Exception ex2)
			{
				startError = ex2;
				ready.TrySetException(ex2);
				AppPaths.Log("webcast-run: " + ex2.Message);
			}
		}, token);

		try
		{
			using CancellationTokenSource readyCts = CancellationTokenSource.CreateLinkedTokenSource(token);
			readyCts.CancelAfter(TimeSpan.FromSeconds(18L));
			await ready.Task.WaitAsync(readyCts.Token);
		}
		catch (Exception ex)
		{
			try
			{
				await client.Stop();
			}
			catch
			{
			}
			_liveClient = null;
			string detail = startError?.Message ?? ex.Message;
			AppPaths.Log("webcast-connect-failed: " + detail);
			bool roomLookupFail = detail.Contains("RoomId", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("room_id", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("IP or country", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("might be blocked", StringComparison.OrdinalIgnoreCase);
			bool notLive = !roomLookupFail && (
				detail.Contains("Host online", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("LiveStream for HostID", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("HostID could not be found", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("offline", StringComparison.OrdinalIgnoreCase));
			if (notLive)
			{
				throw new InvalidOperationException(
					"@" + cleanUsername + " ยังไม่กำลังไลฟ์อยู่ (TikTok ไม่พบ LIVE ตอนนี้) — เปิดไลฟ์ก่อน แล้วกด Connect อีกครั้ง");
			}
			if (roomLookupFail)
			{
				throw new InvalidOperationException(
					"เชื่อมต่อ LIVE ไม่สำเร็จ @" + cleanUsername
					+ " — หา RoomId ไม่ได้ ตรวจว่ากำลังไลฟ์อยู่ / username ถูกต้อง (ตัวเล็ก) หรือใช้โหมด Chrome สำรองในตั้งค่าขั้นสูง");
			}
			bool canceled = ex is OperationCanceledException
				|| detail.Contains("canceled", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("timeout", StringComparison.OrdinalIgnoreCase)
				|| detail.Contains("timed out", StringComparison.OrdinalIgnoreCase);
			if (canceled)
			{
				throw new InvalidOperationException(
					"เชื่อมต่อ LIVE ไม่สำเร็จ @" + cleanUsername
					+ " — เน็ตไปเซิร์ฟเวอร์ไลฟ์ TikTok ค้าง (พบบ่อยหลัง AIS หลุด). รีโมเด็มหรือเปลี่ยน DNS เป็น 1.1.1.1 แล้วกด Connect อีกครั้ง");
			}
			throw new InvalidOperationException(
				"เชื่อมต่อ LIVE ไม่สำเร็จ @" + cleanUsername + " — " + detail);
		}

		_state.TikTokConnected = true;
		_state.TikTokLive = true;
		_state.ClearTikTokError();
		string room = client.RoomID ?? "";
		_state.PushLog(new LogEntry
		{
			Kind = "system",
			Text = "Ready — webcast LIVE @" + cleanUsername + (string.IsNullOrEmpty(room) ? "" : (" room=" + room))
		});
		AppPaths.Log("webcast-connected room=" + room);
		_ = PrefetchGiftNamesAsync(token);
	}

	private void WarnIfTikFinityLikelyConnected()
	{
		try
		{
			using TcpClient tcp = new TcpClient();
			IAsyncResult ar = tcp.BeginConnect(IPAddress.Loopback, 21213, null, null);
			bool ok = ar.AsyncWaitHandle.WaitOne(200);
			if (!ok)
			{
				return;
			}
			try { tcp.EndConnect(ar); } catch { return; }
			if (!tcp.Connected) return;
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "พบ TikFinity (พอร์ต 21213) — ถ้าทั้งคู่ต่อไลฟ์พร้อมกัน อาจหลุดได้ แนะนำปิด Connect ของ TikFinity แล้วใช้ Monkeyeffect อย่างเดียว"
			});
			AppPaths.Log("tikfinity-port-open 21213");
		}
		catch
		{
		}
	}

	private static string? TryLoadSigningKey()
	{
		string? env = Environment.GetEnvironmentVariable("TEMPLEGIFT_EULER_KEY");
		if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
		string[] paths =
		{
			Path.Combine(AppPaths.LogDir, "euler.key"),
			Path.Combine(AppPaths.AppDir, "euler.key")
		};
		foreach (string path in paths)
		{
			try
			{
				if (!File.Exists(path)) continue;
				string text = File.ReadAllText(path).Trim();
				if (!string.IsNullOrWhiteSpace(text)) return text;
			}
			catch
			{
			}
		}
		return null;
	}

	private async Task PrefetchGiftNamesAsync(CancellationToken token)
	{
		string[] urls =
		{
			"https://webcast.tiktok.com/webcast/gift/list/?aid=1988&language=en",
			"https://www.tiktok.com/api/gift/list/?aid=1988"
		};
		foreach (string url in urls)
		{
			if (token.IsCancellationRequested) return;
			try
			{
				using HttpResponseMessage resp = await WebcastHttp.GetAsync(url, token);
				if (!resp.IsSuccessStatusCode) continue;
				string body = await resp.Content.ReadAsStringAsync(token);
				int n = GiftNameCache.ImportFromJson(body);
				if (n > 0)
				{
					AppPaths.Log("gift-names imported " + n + " from " + url);
					return;
				}
			}
			catch (OperationCanceledException)
			{
				return;
			}
			catch (Exception ex)
			{
				AppPaths.Log("gift-names skip: " + ex.Message);
			}
		}
	}

	private void CancelReconnectUiTimer()
	{
		CancellationTokenSource? cts = Interlocked.Exchange(ref _reconnectUiCts, null);
		if (cts == null) return;
		try { cts.Cancel(); } catch { }
		try { cts.Dispose(); } catch { }
	}

	private void NoteWebcastRestored(TikTokLiveClient client, bool firstConnect)
	{
		if (_liveClient != null && !ReferenceEquals(_liveClient, client))
		{
			return;
		}
		CancelReconnectUiTimer();
		bool wasReconnect = _state.TikTokReconnecting;
		_state.TikTokReconnecting = false;
		_state.TikTokConnected = true;
		_state.TikTokLive = true;
		_state.ClearTikTokError();
		if (wasReconnect && !firstConnect)
		{
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "ต่อ webcast กลับมาแล้ว"
			});
			AppPaths.Log("webcast-reconnected");
		}
	}

	private void NoteLiveActivity()
	{
		if (Volatile.Read(ref _disconnecting) != 0) return;
		if (_state.TikTokReconnecting || !_state.TikTokLive)
		{
			_state.TikTokReconnecting = false;
			_state.TikTokConnected = true;
			_state.TikTokLive = true;
			CancelReconnectUiTimer();
		}
	}

	private void BeginWebcastReconnectUi(TikTokLiveClient client)
	{
		if (Volatile.Read(ref _disconnecting) != 0) return;
		if (!ReferenceEquals(_liveClient, client)) return;

		_state.TikTokReconnecting = true;
		_state.TikTokConnected = true;
		CancelReconnectUiTimer();
		CancellationTokenSource cts = new CancellationTokenSource();
		_reconnectUiCts = cts;
		_state.PushLog(new LogEntry
		{
			Kind = "system",
			Text = "ขาดการเชื่อมต่อชั่วคราว — กำลังต่อใหม่อัตโนมัติ"
		});
		AppPaths.Log("webcast-reconnect-ui");
		_ = Task.Run(async delegate
		{
			try
			{
				await Task.Delay(ReconnectUiGraceMs, cts.Token);
			}
			catch (OperationCanceledException)
			{
				return;
			}
			if (Volatile.Read(ref _disconnecting) != 0) return;
			if (!ReferenceEquals(_liveClient, client)) return;
			if (!_state.TikTokReconnecting) return;
			_state.TikTokReconnecting = false;
			_state.TikTokConnected = false;
			_state.TikTokLive = false;
			_state.PushLog(new LogEntry
			{
				Kind = "system",
				Text = "ต่อใหม่อัตโนมัติยังไม่สำเร็จ — กด Connect อีกครั้งถ้าไลฟ์ยังอยู่"
			});
			AppPaths.Log("webcast-reconnect-ui-timeout");
		});
	}

	private void HookLiveRoomEvents(TikTokLiveClient client)
	{
		UnhookLiveRoomEvents();
		foreach (string name in new[] { "OnRoomUpdate", "OnMemberMessage", "OnJoin", "OnSubscribe" })
		{
			try
			{
				EventInfo? ev = client.GetType().GetEvent(name, BindingFlags.Instance | BindingFlags.Public);
				if (ev?.EventHandlerType == null)
				{
					continue;
				}
				MethodInfo? invoke = ev.EventHandlerType.GetMethod("Invoke");
				ParameterInfo[]? ps = invoke?.GetParameters();
				if (invoke == null || ps == null || ps.Length != 2)
				{
					continue;
				}
				ParameterExpression pSender = Expression.Parameter(ps[0].ParameterType, "sender");
				ParameterExpression pArgs = Expression.Parameter(ps[1].ParameterType, "e");
				MethodInfo sink = typeof(BrowserGiftReaderService).GetMethod(
					nameof(OnLiveRoomEvent),
					BindingFlags.Instance | BindingFlags.NonPublic)!;
				Expression body = Expression.Call(Expression.Constant(this), sink, Expression.Convert(pArgs, typeof(object)));
				Delegate handler = Expression.Lambda(ev.EventHandlerType, body, pSender, pArgs).Compile();
				ev.AddEventHandler(client, handler);
				_roomEventHooks.Add((client, ev, handler));
			}
			catch (Exception ex)
			{
				AppPaths.Log("live-stats hook " + name + ": " + ex.Message);
			}
		}
	}

	private void UnhookLiveRoomEvents(TikTokLiveClient? _ = null)
	{
		foreach (var hook in _roomEventHooks)
		{
			try
			{
				hook.Event.RemoveEventHandler(hook.Target, hook.Handler);
			}
			catch
			{
			}
		}
		_roomEventHooks.Clear();
	}

	private void OnLiveRoomEvent(object? e)
	{
		if (e == null)
		{
			return;
		}
		try
		{
			int viewers = LiveEventValue.ReadInt(e, "ViewerCount", "MemberCount", "DisplayLong", "UserCount", "RoomUserSeq");
			if (viewers > 0)
			{
				_liveStats.SetViewers(viewers);
			}
			object? user = TikTokUserRank.FindUser(e);
			if (user == null)
			{
				return;
			}
			string typeName = e.GetType().Name;
			if (typeName.Contains("RoomUpdate", StringComparison.OrdinalIgnoreCase))
			{
				return;
			}
			if (typeName.Contains("Member", StringComparison.OrdinalIgnoreCase)
			    && !typeName.Contains("Join", StringComparison.OrdinalIgnoreCase)
			    && LiveEventValue.ReadLong(e, "Action") >= 2)
			{
				return;
			}
			GiftPayload payload = new GiftPayload
			{
				MessageType = typeName.Contains("Subscribe", StringComparison.OrdinalIgnoreCase) ? "SendSubscribe" : "SendJoin",
				Type = typeName.Contains("Subscribe", StringComparison.OrdinalIgnoreCase) ? "SendSubscribe" : "SendJoin",
				MsgType = typeName.Contains("Subscribe", StringComparison.OrdinalIgnoreCase) ? "SendSubscribe" : "SendJoin",
				UserName = TikTokUserRank.UniqueId(user),
				Nickname = TikTokUserRank.DisplayName(user),
				AvatarUrl = ExtractAvatarLoose(user)
			};
			TikTokUserRank.Apply(payload, user);
			TikTokUserRank.Apply(payload, e);
			bool force = typeName.Contains("Subscribe", StringComparison.OrdinalIgnoreCase);
			_liveStats.RecordWelcome(payload, force);
		}
		catch (Exception ex)
		{
			AppPaths.Log("live-stats room: " + ex.Message);
		}
	}

	private void Client_OnGiftMessage(TikTokLiveClient sender, SharpGiftMessage e)
	{
		try
		{
			NoteLiveActivity();
			string giftName = GiftNameCache.Resolve(e.GiftId, e.Gift?.Name);
			// Prefer the larger of streak repeat vs amount — some gifts put quantity only in Amount.
			long combo = Math.Max(e.RepeatCount > 0 ? e.RepeatCount : 0L, e.Amount > 0 ? e.Amount : 0L);
			if (combo <= 0) combo = 1L;
			GiftPayload giftPayload = new GiftPayload
			{
				MessageType = "SendGift",
				Type = "SendGift",
				MsgType = "SendGift",
				GiftName = giftName,
				GiftId = e.GiftId,
				RepeatCount = (int)Math.Max(1L, combo),
				RepeatEnd = e.StreakEnd,
				UserName = e.User?.UniqueId ?? string.Empty,
				Nickname = e.User?.NickName ?? string.Empty,
				AvatarUrl = ExtractEventAvatarUrl(e.User),
				OrderId = e.OrderId ?? string.Empty,
				LogId = FirstNonEmpty(e.LogId, e.Log_Id),
				GroupId = e.GroupId,
				Timestamp = e.TimeStamp > 0 ? e.TimeStamp : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
				DiamondCount = LiveEventValue.ReadInt(e.Gift, "DiamondCount", "DiamondCountValue", "FanTicketCount"),
				GiftPictureUrl = LiveEventValue.ReadString(e.Gift, "Image", "Icon", "PictureUrl", "GiftPictureUrl", "ImageUrl"),
				RoomUserSeq = LiveEventValue.ReadLong(e, "RoomUserSeq", "UserCount", "ViewerCount")
			};
			TikTokUserRank.Apply(giftPayload, e.User);
			TikTokUserRank.Apply(giftPayload, e);
			QueueGiftDelivery(giftPayload);
		}
		catch (Exception ex)
		{
			AppPaths.Log("webcast-gift: " + ex.Message);
		}
	}

	private void Client_OnLike(TikTokLiveClient sender, Like e)
	{
		try
		{
			NoteLiveActivity();
			GiftPayload likePayload = new GiftPayload
			{
				MessageType = "SendLike",
				Type = "SendLike",
				MsgType = "SendLike",
				GiftName = "Like",
				RepeatCount = (int)Math.Max(1L, e.Count > 0 ? e.Count : 1L),
				RepeatEnd = true,
				UserName = e.Sender?.UniqueId ?? string.Empty,
				Nickname = e.Sender?.NickName ?? string.Empty,
				AvatarUrl = ExtractEventAvatarUrl(e.Sender),
				LogId = e.LogId ?? string.Empty
			};
			TikTokUserRank.Apply(likePayload, e.Sender);
			TikTokUserRank.Apply(likePayload, e);
			QueueGiftDelivery(likePayload);
		}
		catch (Exception ex)
		{
			AppPaths.Log("webcast-like: " + ex.Message);
		}
	}

	private void Client_OnFollow(TikTokLiveClient sender, Follow e)
	{
		try
		{
			NoteLiveActivity();
			GiftPayload followPayload = new GiftPayload
			{
				MessageType = "SendFollow",
				Type = "SendFollow",
				MsgType = "SendFollow",
				GiftName = "Follow",
				RepeatCount = 1,
				RepeatEnd = true,
				UserName = e.User?.UniqueId ?? string.Empty,
				Nickname = e.User?.NickName ?? string.Empty,
				AvatarUrl = ExtractEventAvatarUrl(e.User),
				LogId = e.LogId ?? string.Empty
			};
			TikTokUserRank.Apply(followPayload, e.User);
			QueueGiftDelivery(followPayload);
		}
		catch (Exception ex)
		{
			AppPaths.Log("webcast-follow: " + ex.Message);
		}
	}

	private void Client_OnChatMessage(TikTokLiveClient sender, Chat e)
	{
		try
		{
			NoteLiveActivity();
			string content = (e.Message ?? string.Empty).Trim();
			if (string.IsNullOrWhiteSpace(content))
			{
				return;
			}
			GiftPayload chatPayload = new GiftPayload
			{
				MessageType = "SendChat",
				Type = "SendChat",
				MsgType = "SendChat",
				GiftName = string.Empty,
				Comment = content,
				RepeatCount = 1,
				RepeatEnd = true,
				UserName = e.Sender?.UniqueId ?? string.Empty,
				Nickname = e.Sender?.NickName ?? string.Empty,
				AvatarUrl = ExtractEventAvatarUrl(e.Sender),
				LogId = e.LogId ?? string.Empty
			};
			TikTokUserRank.Apply(chatPayload, e.Sender);
			TikTokUserRank.Apply(chatPayload, e);
			QueueGiftDelivery(chatPayload);
		}
		catch (Exception ex)
		{
			AppPaths.Log("webcast-chat: " + ex.Message);
		}
	}

	private void Client_OnBarrage(TikTokLiveClient sender, Barrage e)
	{
		try
		{
			if (e.MsgType != Barrage.BarrageType.GradeUserEntranceNotification)
			{
				return;
			}
			NoteLiveActivity();
			var param = e.UserGradeParam;
			object? user = param?.User;
			if (user == null && e.Content?.Pieces != null)
			{
				foreach (TextPiece piece in e.Content.Pieces)
				{
					if (piece?.UserValue?.User != null)
					{
						user = piece.UserValue.User;
						break;
					}
				}
			}
			if (user == null)
			{
				return;
			}
			int grade = param != null && param.CurrentGrade >= 1 && param.CurrentGrade <= 99
				? param.CurrentGrade
				: 0;
			GiftPayload payload = new GiftPayload
			{
				MessageType = "SendJoin",
				Type = "SendJoin",
				MsgType = "SendJoin",
				UserName = TikTokUserRank.UniqueId(user),
				Nickname = TikTokUserRank.DisplayName(user),
				AvatarUrl = ExtractAvatarLoose(user),
				UserLevel = grade
			};
			TikTokUserRank.Apply(payload, user);
			TikTokUserRank.Apply(payload, e);
			if (grade > payload.UserLevel) payload.UserLevel = grade;
			_liveStats.RecordWelcome(payload);
			DevLogService.Write("welcome.join", payload.Nickname, new
			{
				user = payload.UserName,
				level = payload.UserLevel,
				source = "barrage"
			});
		}
		catch (Exception ex)
		{
			AppPaths.Log("webcast-barrage: " + ex.Message);
		}
	}

	private static bool IsRoomEnterMessage(string? text)
	{
		if (string.IsNullOrWhiteSpace(text)) return false;
		if (text.Contains("Gift", StringComparison.OrdinalIgnoreCase)) return false;
		if (text.Contains("Chat", StringComparison.OrdinalIgnoreCase)) return false;
		if (text.Contains("Like", StringComparison.OrdinalIgnoreCase)) return false;
		return text.Contains("Join", StringComparison.OrdinalIgnoreCase)
			|| text.Contains("Member", StringComparison.OrdinalIgnoreCase)
			|| text.Contains("Subscribe", StringComparison.OrdinalIgnoreCase)
			|| text.Contains("Barrage", StringComparison.OrdinalIgnoreCase)
			|| text.Contains("Entrance", StringComparison.OrdinalIgnoreCase);
	}

	private static string ExtractAvatarLoose(object? user)
	{
		if (user is User typed)
		{
			return ExtractEventAvatarUrl(typed);
		}
		if (user == null)
		{
			return string.Empty;
		}
		foreach (string picName in new[] { "AvatarThumbnail", "AvatarMedium", "AvatarJpg", "AvatarLarge" })
		{
			object? pic = LiveEventValue.GetMember(user, picName);
			object? urls = LiveEventValue.GetMember(pic, "Urls") ?? LiveEventValue.GetMember(pic, "UrlList");
			if (urls is System.Collections.IEnumerable list)
			{
				foreach (object? item in list)
				{
					if (item is string url && !string.IsNullOrWhiteSpace(url))
					{
						return url;
					}
				}
			}
			if (LiveEventValue.GetMember(pic, "Uri") is string uri && !string.IsNullOrWhiteSpace(uri))
			{
				return uri;
			}
		}
		return string.Empty;
	}

	private static string ExtractEventAvatarUrl(User? user)
	{
		if (user == null)
		{
			return string.Empty;
		}
		Picture? pic = user.AvatarThumbnail ?? user.AvatarMedium ?? user.AvatarJpg;
		if (pic?.Urls != null)
		{
			foreach (string url in pic.Urls)
			{
				if (!string.IsNullOrWhiteSpace(url))
				{
					return url;
				}
			}
		}
		return pic?.Uri ?? pic?.OpenWebUrl ?? string.Empty;
	}

	private async Task FlushPendingGiftsOnDisconnectAsync()
	{
		KeyValuePair<string, GiftPayload>[] leftover = _latestGift.ToArray();
		foreach (KeyValuePair<string, GiftPayload> pair in leftover)
		{
			bool follow = pair.Key.StartsWith("follow|", StringComparison.OrdinalIgnoreCase);
			string who = FirstNonEmpty(pair.Value?.Nickname, pair.Value?.UserName, "viewer");
			try
			{
				await TryDeliverMergedAsync(pair.Key, follow, who);
			}
			catch (Exception ex)
			{
				AppPaths.Log("flush pending gift on disconnect: " + ex.Message);
			}
		}
	}

	private async Task DisconnectInternalAsync()
	{
		Interlocked.Exchange(ref _disconnecting, 1);
		try { _liveStats.ClearWelcomeSession(); }
		catch { }
		CancelReconnectUiTimer();
		_state.TikTokReconnecting = false;
		_runCts?.Cancel();
		try
		{
			_likeFlushCts?.Cancel();
			_likeFlushCts?.Dispose();
		}
		catch
		{
		}
		lock (_likeGate)
		{
			_likePendingCount = 0;
			_likePendingSample = null;
			_likeBatchStartedAt = 0;
			_likeFlushCts = null;
		}
		foreach (KeyValuePair<string, CancellationTokenSource> item in _giftDebounce)
		{
			try
			{
				item.Value.Cancel();
				item.Value.Dispose();
			}
			catch
			{
			}
		}
		_giftDebounce.Clear();
		try
		{
			await FlushPendingGiftsOnDisconnectAsync();
		}
		catch
		{
		}
		_latestGift.Clear();
		_deliveredCount.Clear();
		_deliveredAt.Clear();
		_deliveredGroupId.Clear();
		_deliveredEventIds.Clear();
		_pendingSoloUnits.Clear();
		_pendingSoloAt.Clear();
		_uiAnnouncedCount.Clear();
		_rouletteHeldMergeKeys.Clear();
		_rouletteEnqueuedMergeKeys.Clear();
		_cdpWsUrls.Clear();
		TikTokLiveClient? live = _liveClient;
		_liveClient = null;
		if (live != null)
		{
			try
			{
				live.OnGiftMessage -= Client_OnGiftMessage;
				live.OnLike -= Client_OnLike;
				live.OnFollow -= Client_OnFollow;
				live.OnChatMessage -= Client_OnChatMessage;
				live.OnBarrage -= Client_OnBarrage;
				UnhookLiveRoomEvents(live);
			}
			catch
			{
			}
			try
			{
				await live.Stop();
			}
			catch
			{
			}
		}
		if (_runTask != null)
		{
			try
			{
				await _runTask.WaitAsync(TimeSpan.FromSeconds(3L));
			}
			catch
			{
			}
		}
		if (_cdp != null)
		{
			try
			{
				await _cdp.DetachAsync();
			}
			catch
			{
			}
			_cdp = null;
		}
		_page = null;
		_context = null;
		_cdpBrowser = null;
		if (_playwright != null)
		{
			try
			{
				_playwright.Dispose();
			}
			catch
			{
			}
			_playwright = null;
		}
		_runCts?.Dispose();
		_runCts = null;
		_runTask = null;
		_webcastReady = null;
		_state.TikTokConnected = false;
		_state.TikTokLive = false;
		_state.TikTokConnecting = false;
		_state.TikTokReconnecting = false;
	}

	private static bool IsWebcastUrl(string url)
	{
		if (string.IsNullOrWhiteSpace(url))
		{
			return false;
		}
		if (!url.Contains("webcast", StringComparison.OrdinalIgnoreCase) && !url.Contains("tiktokv.com", StringComparison.OrdinalIgnoreCase) && !url.Contains("byteoversea.com", StringComparison.OrdinalIgnoreCase) && !url.Contains("im-api", StringComparison.OrdinalIgnoreCase) && !url.Contains("/im/", StringComparison.OrdinalIgnoreCase) && !url.Contains("webcast-ws", StringComparison.OrdinalIgnoreCase))
		{
			if (url.StartsWith("wss://", StringComparison.OrdinalIgnoreCase))
			{
				return url.Contains("tiktok", StringComparison.OrdinalIgnoreCase);
			}
			return false;
		}
		return true;
	}

	private static bool IsWebcastHttpUrl(string url)
	{
		if (string.IsNullOrWhiteSpace(url))
		{
			return false;
		}
		if (!url.Contains("webcast", StringComparison.OrdinalIgnoreCase) && !url.Contains("tiktokv.com", StringComparison.OrdinalIgnoreCase) && !url.Contains("byteoversea.com", StringComparison.OrdinalIgnoreCase))
		{
			return false;
		}
		if (!url.Contains("/im/", StringComparison.OrdinalIgnoreCase) && !url.Contains("im/fetch", StringComparison.OrdinalIgnoreCase) && !url.Contains("room/enter", StringComparison.OrdinalIgnoreCase) && !url.Contains("room/info", StringComparison.OrdinalIgnoreCase))
		{
			return url.Contains("gift/", StringComparison.OrdinalIgnoreCase);
		}
		return true;
	}

	private static bool IsInterestingLiveUrl(string url)
	{
		if (string.IsNullOrWhiteSpace(url))
		{
			return false;
		}
		if (!url.Contains("webcast", StringComparison.OrdinalIgnoreCase))
		{
			return url.Contains("/live/", StringComparison.OrdinalIgnoreCase);
		}
		return true;
	}
}
