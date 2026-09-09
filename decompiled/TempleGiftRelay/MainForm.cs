using System;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace TempleGiftRelay;

public sealed class MainForm : Form
{
	private readonly WebView2 _webView;

	private readonly Uri _uiUri = new Uri("http://127.0.0.1:3847/");

	private bool _navigated;

	private readonly System.Windows.Forms.Timer _keepAliveTimer;

	[DllImport("kernel32.dll")]
	private static extern uint SetThreadExecutionState(uint esFlags);

	private const uint EsContinuous = 0x80000000;
	private const uint EsSystemRequired = 0x00000001;

	public MainForm()
	{
		Text = "Monkeyeffect 1.0.8.1";
		base.StartPosition = FormStartPosition.CenterScreen;
		MinimumSize = new Size(960, 640);
		base.Size = new Size(1280, 800);
		base.WindowState = FormWindowState.Maximized;
		TryApplyAppIcon();
		_webView = new WebView2
		{
			Dock = DockStyle.Fill
		};
		base.Controls.Add(_webView);
		base.Shown += OnShownAsync;
		base.Resize += (_, _) => SyncKeepAliveInterval();
		base.FormClosed += delegate
		{
			try { _keepAliveTimer.Stop(); } catch { }
			SetThreadExecutionState(EsContinuous);
			Application.Exit();
		};
		// Host-driven poke — faster while minimized so interrupt drain / status keep moving.
		_keepAliveTimer = new System.Windows.Forms.Timer { Interval = 1000 };
		_keepAliveTimer.Tick += KeepAliveTick;
		_keepAliveTimer.Start();
	}

	private void SyncKeepAliveInterval()
	{
		try
		{
			_keepAliveTimer.Interval = 2000;
		}
		catch { }
	}

	private void KeepAliveTick(object? sender, EventArgs e)
	{
		try
		{
			SetThreadExecutionState(EsContinuous | EsSystemRequired);
			if (_webView.CoreWebView2 == null) return;
			if (WindowState == FormWindowState.Minimized) return;
			_ = _webView.CoreWebView2.ExecuteScriptAsync(
				"(function(){try{if(typeof window.__tgrKeepAlive==='function')window.__tgrKeepAlive();else if(typeof fetchStatus==='function')fetchStatus();}catch(e){}})();");
		}
		catch
		{
		}
	}

	private void TryApplyAppIcon()
	{
		try
		{
			string[] candidates =
			{
				Path.Combine(AppPaths.AppDir, "monkeyeffect.ico"),
				Path.Combine(AppPaths.AppDir, "wwwroot", "logo.png"),
				Path.Combine(AppPaths.AppDir, "app-icon.png")
			};
			foreach (string path in candidates)
			{
				if (!File.Exists(path))
				{
					continue;
				}
				if (path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
				{
					Icon = new Icon(path);
					return;
				}
				using Bitmap bmp = new Bitmap(path);
				Icon = Icon.FromHandle(bmp.GetHicon());
				return;
			}
		}
		catch
		{
		}
	}

	private async void OnShownAsync(object sender, EventArgs e)
	{
		_ = 1;
		try
		{
			await _webView.EnsureCoreWebView2Async(await WebViewEnv.GetAsync());
			await NavigateWhenReadyAsync();
		}
		catch (Exception ex)
		{
			MessageBox.Show(this, "WebView2 failed to start:\n" + ex.Message, "Monkeyeffect     ", MessageBoxButtons.OK, MessageBoxIcon.Hand);
		}
	}

	private async Task NavigateWhenReadyAsync()
	{
		for (int i = 0; i < 40; i++)
		{
			if (_navigated)
			{
				break;
			}
			try
			{
				using HttpClient client = new HttpClient
				{
					Timeout = TimeSpan.FromMilliseconds(500L)
				};
				using HttpResponseMessage httpResponseMessage = await client.GetAsync(_uiUri);
				if (httpResponseMessage.IsSuccessStatusCode)
				{
					_webView.CoreWebView2.Navigate(_uiUri.ToString());
					_navigated = true;
					return;
				}
			}
			catch
			{
			}
			await Task.Delay(250);
		}
		if (!_navigated && _webView.CoreWebView2 != null)
		{
			_webView.CoreWebView2.Navigate(_uiUri.ToString());
			_navigated = true;
		}
	}
}
