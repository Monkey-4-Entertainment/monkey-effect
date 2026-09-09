using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace TempleGiftRelay;

/// <summary>
/// After some ISP outages (AIS), IPv6 to Cloudflare/Euler is black-holed while
/// www.tiktok.com (Akamai) still works. RoomId lookup succeeds, then webcast hangs.
/// Force outbound HttpClient/WebSocket through an IPv4-first CONNECT proxy.
/// </summary>
internal static class Ipv4Network
{
	private static int _started;
	private static int _proxyPort;

	public static IWebProxy? Proxy { get; private set; }

	[DllImport("dnsapi.dll", EntryPoint = "DnsFlushResolverCache")]
	private static extern uint DnsFlushResolverCache();

	public static void ApplyAtStartup()
	{
		FlushDns();
		try
		{
			StartProxy();
		}
		catch (Exception ex)
		{
			AppPaths.Log("ipv4-proxy start fail: " + ex.Message);
		}
	}

	public static void FlushDns()
	{
		try
		{
			DnsFlushResolverCache();
		}
		catch
		{
		}
	}

	public static async ValueTask<Stream> ConnectIPv4FirstAsync(SocketsHttpConnectionContext ctx, CancellationToken token)
	{
		Socket socket = await ConnectIPv4FirstSocketAsync(ctx.DnsEndPoint.Host, ctx.DnsEndPoint.Port, token);
		return new NetworkStream(socket, ownsSocket: true);
	}

	public static async Task<bool> CanReachSigningHostAsync(CancellationToken token)
	{
		(bool v4, bool v6) = await ProbeHostAsync("tiktok.eulerstream.com", 443, token);
		(bool ws4, bool ws6) = await ProbeHostAsync("webcast.tiktok.com", 443, token);
		AppPaths.Log($"webcast-preflight euler v4={v4} v6={v6}; webcast v4={ws4} v6={ws6}");
		return v4 || v6 || ws4 || ws6;
	}

	private static void StartProxy()
	{
		if (Interlocked.Exchange(ref _started, 1) != 0)
		{
			return;
		}
		TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
		listener.Start();
		_proxyPort = ((IPEndPoint)listener.LocalEndpoint).Port;
		WebProxy proxy = new WebProxy(new Uri("http://127.0.0.1:" + _proxyPort), BypassOnLocal: true);
		proxy.BypassList = new[] { "localhost", "127\\.0\\.0\\.1", "\\[::1\\]" };
		Proxy = proxy;
		HttpClient.DefaultProxy = proxy;
		_ = Task.Run(() => AcceptLoopAsync(listener));
		AppPaths.Log("ipv4-proxy 127.0.0.1:" + _proxyPort);
	}

	private static async Task AcceptLoopAsync(TcpListener listener)
	{
		while (true)
		{
			try
			{
				TcpClient inbound = await listener.AcceptTcpClientAsync();
				_ = Task.Run(() => HandleConnectAsync(inbound));
			}
			catch (Exception ex)
			{
				AppPaths.Log("ipv4-proxy accept: " + ex.Message);
				await Task.Delay(400);
			}
		}
	}

	private static async Task HandleConnectAsync(TcpClient inbound)
	{
		try
		{
			inbound.NoDelay = true;
			inbound.ReceiveTimeout = 20000;
			inbound.SendTimeout = 20000;
			using (inbound)
			{
				NetworkStream inboundStream = inbound.GetStream();
				string header = await ReadHttpHeadAsync(inboundStream);
				if (string.IsNullOrEmpty(header) || !header.StartsWith("CONNECT ", StringComparison.OrdinalIgnoreCase))
				{
					byte[] deny = Encoding.ASCII.GetBytes("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n");
					await inboundStream.WriteAsync(deny);
					return;
				}
				string target = header.Split(' ')[1];
				int colon = target.LastIndexOf(':');
				if (colon <= 0 || colon >= target.Length - 1)
				{
					return;
				}
				string host = target[..colon].Trim().Trim('[', ']');
				if (!int.TryParse(target[(colon + 1)..], out int port) || port <= 0)
				{
					return;
				}

				Socket outbound = await ConnectIPv4FirstSocketAsync(host, port, CancellationToken.None);
				try
				{
					byte[] ok = Encoding.ASCII.GetBytes("HTTP/1.1 200 Connection Established\r\n\r\n");
					await inboundStream.WriteAsync(ok);
					using NetworkStream outboundStream = new NetworkStream(outbound, ownsSocket: true);
					outbound = null!;
					await Task.WhenAny(
						inboundStream.CopyToAsync(outboundStream),
						outboundStream.CopyToAsync(inboundStream));
				}
				finally
				{
					try { outbound?.Dispose(); } catch { }
				}
			}
		}
		catch
		{
		}
	}

	private static async Task<string> ReadHttpHeadAsync(NetworkStream stream)
	{
		MemoryStream buf = new MemoryStream(512);
		byte[] one = new byte[1];
		while (buf.Length < 8192)
		{
			int n = await stream.ReadAsync(one);
			if (n <= 0)
			{
				break;
			}
			buf.WriteByte(one[0]);
			if (buf.Length >= 4)
			{
				byte[] arr = buf.GetBuffer();
				int len = (int)buf.Length;
				if (arr[len - 4] == (byte)'\r' && arr[len - 3] == (byte)'\n'
					&& arr[len - 2] == (byte)'\r' && arr[len - 1] == (byte)'\n')
				{
					break;
				}
			}
		}
		return Encoding.ASCII.GetString(buf.ToArray());
	}

	private static async Task<Socket> ConnectIPv4FirstSocketAsync(string host, int port, CancellationToken token)
	{
		if (IPAddress.TryParse(host, out IPAddress? literal))
		{
			return await ConnectSocketAsync(literal, port, token);
		}

		Exception? last = null;
		foreach (AddressFamily family in new[] { AddressFamily.InterNetwork, AddressFamily.InterNetworkV6 })
		{
			IPAddress[] addrs;
			try
			{
				addrs = await Dns.GetHostAddressesAsync(host, family, token);
			}
			catch (Exception ex)
			{
				last = ex;
				continue;
			}
			foreach (IPAddress ip in addrs)
			{
				try
				{
					using CancellationTokenSource cts = CancellationTokenSource.CreateLinkedTokenSource(token);
					cts.CancelAfter(TimeSpan.FromSeconds(4));
					return await ConnectSocketAsync(ip, port, cts.Token);
				}
				catch (Exception ex)
				{
					last = ex;
				}
			}
		}
		throw last ?? new SocketException((int)SocketError.HostNotFound);
	}

	private static async Task<Socket> ConnectSocketAsync(IPAddress ip, int port, CancellationToken token)
	{
		Socket socket = new Socket(ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
		{
			NoDelay = true
		};
		try
		{
			await socket.ConnectAsync(new IPEndPoint(ip, port), token);
			return socket;
		}
		catch
		{
			socket.Dispose();
			throw;
		}
	}

	private static async Task<(bool v4, bool v6)> ProbeHostAsync(string host, int port, CancellationToken token)
	{
		Task<bool> t4 = ProbeFamilyAsync(host, port, AddressFamily.InterNetwork, token);
		Task<bool> t6 = ProbeFamilyAsync(host, port, AddressFamily.InterNetworkV6, token);
		bool[] ok = await Task.WhenAll(t4, t6);
		return (ok[0], ok[1]);
	}

	private static async Task<bool> ProbeFamilyAsync(string host, int port, AddressFamily family, CancellationToken token)
	{
		try
		{
			IPAddress[] addrs = await Dns.GetHostAddressesAsync(host, family, token);
			foreach (IPAddress ip in addrs)
			{
				try
				{
					using CancellationTokenSource cts = CancellationTokenSource.CreateLinkedTokenSource(token);
					cts.CancelAfter(TimeSpan.FromSeconds(3));
					using Socket socket = await ConnectSocketAsync(ip, port, cts.Token);
					return true;
				}
				catch
				{
				}
			}
		}
		catch
		{
		}
		return false;
	}
}
