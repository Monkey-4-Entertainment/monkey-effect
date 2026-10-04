using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace TempleGiftRelay;

internal static class WebViewEnv
{
	private static CoreWebView2Environment? _env;

	private static readonly object Gate = new object();

	public static async Task<CoreWebView2Environment> GetAsync()
	{
		lock (Gate)
		{
			if (_env != null)
			{
				return _env;
			}
		}
		// Must NOT live under Program Files — WebView2 needs write access for EBWebView.
		string userData = Path.Combine(
			Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
			"Monkeyeffect",
			"WebView2");
		Directory.CreateDirectory(userData);
		// Allow video autoplay WITH sound (otherwise overlay mutes / no audio)
		CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(
			"--autoplay-policy=no-user-gesture-required " +
			"--use-fake-ui-for-media-stream " +
			"--disable-backgrounding-occluded-windows " +
			"--disable-renderer-backgrounding " +
			"--disable-background-timer-throttling " +
			"--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling");
		CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, options);
		lock (Gate)
		{
			_env ??= env;
			return _env;
		}
	}
}
