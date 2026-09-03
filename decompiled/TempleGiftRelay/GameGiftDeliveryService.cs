using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace TempleGiftRelay;

public sealed class GameGiftDeliveryService
{
	private readonly GameWindowService _window;

	private readonly PixelStreamDeliveryService _pixel;

	private readonly KeyMapDeliveryService _keyMap;

	public GameGiftDeliveryService(GameWindowService window, KeyMapDeliveryService keyMap)
	{
		_window = window;
		_pixel = new PixelStreamDeliveryService(window);
		_keyMap = keyMap;
	}

	public bool TryDeliver(GiftPayload payload, out string channel)
	{
		channel = string.Empty;
		// Try keyboard key-map delivery first (for THE RIDER and similar games)
		if (_keyMap.TryDeliver(payload, out channel))
		{
			return true;
		}
		if (_pixel.TryDeliverPipeOnly(payload, out channel))
		{
			return true;
		}
		if (_window.TryDeliverGiftName(payload.GiftName, payload.RepeatCount, out string method))
		{
			channel = method;
			return true;
		}
		if (TryDeliverUdp(payload, out channel))
		{
			return true;
		}
		return false;
	}

	private static bool TryDeliverUdp(GiftPayload payload, out string channel)
	{
		channel = string.Empty;
		string s = JsonSerializer.Serialize(payload);
		byte[] bytes = Encoding.UTF8.GetBytes(s);
		int[] array = new int[3] { 8888, 12922, 7505 };
		int[] array2 = array;
		int[] array3 = array2;
		int[] array4 = array3;
		foreach (int num in array4)
		{
			try
			{
				using UdpClient udpClient = new UdpClient();
				udpClient.Send(bytes, bytes.Length, "127.0.0.1", num);
				channel = $"udp:{num}";
				return true;
			}
			catch
			{
			}
		}
		return false;
	}
}
