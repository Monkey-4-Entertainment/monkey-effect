using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Fleck;

namespace TempleGiftRelay;

public sealed class GameBridgeService : IDisposable
{
	private readonly RelayState _state;

	private readonly LocalLiveHttpService _liveHttp;

	private readonly KeyMapDeliveryService? _keyMap;

	private readonly ConcurrentDictionary<Guid, IWebSocketConnection> _clients = new ConcurrentDictionary<Guid, IWebSocketConnection>();

	private WebSocketServer? _server;

	private int _port = 15500;

	public int Port => _port;

	public GameBridgeService(RelayState state, LocalLiveHttpService liveHttp, KeyMapDeliveryService? keyMap = null)
	{
		_state = state;
		_liveHttp = liveHttp;
		_keyMap = keyMap;
	}

	public void SetPort(int port)
	{
		_port = port;
	}

	public void Start()
	{
		if (_server != null)
		{
			return;
		}
		_server = new WebSocketServer($"ws://0.0.0.0:{_port}");
		_server.Start(delegate(IWebSocketConnection socket)
		{
			Guid id = Guid.NewGuid();
			socket.OnOpen = delegate
			{
				OnClientConnected(id, socket);
			};
			socket.OnClose = delegate
			{
				OnClientDisconnected(id);
			};
			socket.OnError = delegate(Exception ex)
			{
				_state.PushLog(new LogEntry
				{
					Kind = "error",
					Text = "WebSocket error: " + ex.Message
				});
			};
		});
		_state.PushLog(new LogEntry
		{
			Kind = "system",
			Text = $"Fleck WebSocket ws://127.0.0.1:{_port}"
		});
	}

	public void Stop()
	{
		KeyValuePair<Guid, IWebSocketConnection>[] array = _clients.ToArray();
		for (int i = 0; i < array.Length; i++)
		{
			KeyValuePair<Guid, IWebSocketConnection> keyValuePair = array[i];
			try
			{
				keyValuePair.Value.Close();
			}
			catch
			{
			}
			_clients.TryRemove(keyValuePair.Key, out IWebSocketConnection _);
		}
		_server?.Dispose();
		_server = null;
		_state.GameClients = 0;
	}

	public async Task<DeliveryResult> DeliverGiftAsync(GiftPayload payload, CancellationToken cancellationToken = default(CancellationToken))
	{
		// Keyboard / localhost webhook first (THE RIDER, ZERO-HOUR).
		if (_keyMap != null && _keyMap.TryDeliver(payload, out string keyChannel))
		{
			_state.ClearGameError();
			return new DeliveryResult(1, YcLiveSent: true, _clients.Count, _state.GameWindowFound, keyChannel);
		}
		if (_keyMap != null && _keyMap.WebhookExclusive)
		{
			string fail = string.IsNullOrWhiteSpace(_keyMap.LastWebhookDetail)
				? "ยิง webhook ไม่ได้ — เปิดเกม CRITICAL LIVE และแดชบอร์ด :17180 บนเครื่องเดียวกับ Monkeyeffect"
				: _keyMap.LastWebhookDetail;
			_state.GameError = fail;
			return new DeliveryResult(0, YcLiveSent: false, _clients.Count, _state.GameWindowFound, fail);
		}

		int wsSent = 0;
		KeyValuePair<Guid, IWebSocketConnection>[] array = _clients.ToArray();
		for (int i = 0; i < array.Length; i++)
		{
			KeyValuePair<Guid, IWebSocketConnection> keyValuePair = array[i];
			IWebSocketConnection value;
			if (!keyValuePair.Value.IsAvailable)
			{
				_clients.TryRemove(keyValuePair.Key, out value);
				continue;
			}
			try
			{
				keyValuePair.Value.Send(JsonSerializer.Serialize(payload));
				wsSent++;
			}
			catch
			{
				_clients.TryRemove(keyValuePair.Key, out value);
			}
		}
		_state.GameClients = _clients.Count;
		if (!_liveHttp.IsRunning)
		{
			_state.GameError = "Direct /livemsg server is not running — close ycLive if it holds port 12922, then restart Relay";
			return new DeliveryResult(wsSent, YcLiveSent: false, _clients.Count, _state.GameWindowFound, "direct-livemsg-failed");
		}
		await _liveHttp.EnqueueGiftAsync(payload, cancellationToken);
		_state.ClearGameError();
		return new DeliveryResult(wsSent, YcLiveSent: true, _clients.Count, _state.GameWindowFound, "direct-livemsg");
	}

	private void OnClientConnected(Guid id, IWebSocketConnection socket)
	{
		_clients[id] = socket;
		_state.GameClients = _clients.Count;
		_state.PushLog(new LogEntry
		{
			Kind = "system",
			Text = "Game/plugin connected (" + socket.ConnectionInfo.ClientIpAddress + ")"
		});
		socket.Send(JsonSerializer.Serialize(new
		{
			type = "system",
			message = "连接成功",
			timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
			clients = _clients.Count
		}));
	}

	private void OnClientDisconnected(Guid id)
	{
		_clients.TryRemove(id, out IWebSocketConnection _);
		_state.GameClients = _clients.Count;
	}

	public void Dispose()
	{
		Stop();
	}
}
