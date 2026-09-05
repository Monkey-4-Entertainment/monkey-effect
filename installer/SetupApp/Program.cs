using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

internal static class Program
{
	[STAThread]
	private static void Main()
	{
		ApplicationConfiguration.Initialize();
		Application.Run(new SetupForm());
	}
}

internal sealed class SetupForm : Form
{
	private readonly ProgressBar _bar = new ProgressBar { Dock = DockStyle.Bottom, Height = 22, Style = ProgressBarStyle.Continuous, Minimum = 0, Maximum = 100 };
	private readonly Label _status = new Label { Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter, Font = new System.Drawing.Font("Segoe UI", 11f) };
	private readonly Button _installBtn = new Button { Text = "ติดตั้ง Monkeyeffect", Dock = DockStyle.Top, Height = 44 };

	public SetupForm()
	{
		Text = "Monkeyeffect Setup 1.0.7.15";
		Width = 520;
		Height = 240;
		StartPosition = FormStartPosition.CenterScreen;
		FormBorderStyle = FormBorderStyle.FixedDialog;
		MaximizeBox = false;
		MinimizeBox = false;
		Controls.Add(_status);
		Controls.Add(_installBtn);
		Controls.Add(_bar);
		_bar.Visible = false;
		_status.Text = "ตัวติดตั้งไฟล์เดียว\nจะติดตั้งไปที่:\n" + InstallDir + "\n\nกดปุ่มเพื่อเริ่ม";
		_installBtn.Click += async (_, _) => await RunInstallAsync();
		TrySetIcon();
	}

	// Install under LocalAppData so WebView2/cache never need Admin write to Program Files
	private static string InstallDir => Path.Combine(
		Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
		"Programs",
		"Monkeyeffect");

	private void TrySetIcon()
	{
		try
		{
			using Stream? s = Assembly.GetExecutingAssembly().GetManifestResourceStream("MonkeyeffectSetup.monkeyeffect.ico");
			if (s != null)
			{
				Icon = new System.Drawing.Icon(s);
				return;
			}
			string ico = Path.Combine(AppContext.BaseDirectory, "monkeyeffect.ico");
			if (File.Exists(ico)) Icon = new System.Drawing.Icon(ico);
		}
		catch { }
	}

	private async System.Threading.Tasks.Task RunInstallAsync()
	{
		_installBtn.Enabled = false;
		_bar.Visible = true;
		_bar.Style = ProgressBarStyle.Marquee;
		try
		{
			if (!HasWebView2())
			{
				var go = MessageBox.Show(
					this,
					"เครื่องนี้ยังไม่มี WebView2 Runtime\n(จำเป็นสำหรับเปิด Monkeyeffect)\n\nต้องการเปิดหน้าดาวน์โหลดของ Microsoft ไหม?",
					"Monkeyeffect Setup",
					MessageBoxButtons.YesNo,
					MessageBoxIcon.Warning);
				if (go == DialogResult.Yes)
				{
					Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
				}
			}

			_status.Text = "กำลังปิด Monkeyeffect ที่เปิดอยู่...";
			StopMonkeyeffectBeforeInstall();

			_status.Text = "กำลังติดตั้งไฟล์ทั้งหมด (อาจใช้เวลา 1-3 นาที)...";
			await System.Threading.Tasks.Task.Run(ExtractPayloadToInstallDir);

			_status.Text = "กำลังใส่ค่าตั้งต้นเกม Temple Escape...";
			ApplyTempleEscapeGameDefaults(InstallDir);

			_status.Text = "กำลังสร้างทางลัด...";
			string bat = Path.Combine(InstallDir, "Monkeyeffect.bat");
			string ico = Path.Combine(InstallDir, "monkeyeffect.ico");
			if (!File.Exists(bat) || !File.Exists(Path.Combine(InstallDir, "TempleGiftRelay.exe")))
			{
				throw new InvalidOperationException("ติดตั้งไม่ครบ — ลองรัน Setup ใหม่แบบ Run as administrator");
			}

			// Remove confusing old shortcuts that may point to broken copies
			try
			{
				string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
				foreach (string f in Directory.GetFiles(desktop, "Monkeyeffect*.lnk"))
				{
					try { File.Delete(f); } catch { }
				}
			}
			catch { }

			try
			{
				CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Monkeyeffect.lnk"), bat, ico, InstallDir);
				string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Monkeyeffect");
				Directory.CreateDirectory(startMenu);
				CreateShortcut(Path.Combine(startMenu, "Monkeyeffect.lnk"), bat, ico, InstallDir);
			}
			catch
			{
				/* shortcuts are optional — install is still complete */
			}

			File.WriteAllText(Path.Combine(InstallDir, "VERSION.txt"), "Monkeyeffect 1.0.7.15 build " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
			try
			{
				// Clear leftover Program Files install that caused WebView2 write errors
				string legacy = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Monkeyeffect");
				if (Directory.Exists(legacy))
				{
					try { Directory.Delete(legacy, true); } catch { }
				}
			}
			catch { }

			_bar.Style = ProgressBarStyle.Continuous;
			_bar.Value = 100;
			_status.Text = "ติดตั้งเสร็จแล้ว!\n" + InstallDir;
			var launch = MessageBox.Show(
				this,
				"ติดตั้ง Monkeyeffect สำเร็จ\n\nที่ติดตั้ง:\n" + InstallDir +
				"\n\nใส่ค่าตั้งต้นเกม Temple Escape แล้ว\n(礼物事件配置 / 自定义盲盒)\n\nเปิดโปรแกรมเลยไหม?",
				"Monkeyeffect",
				MessageBoxButtons.YesNo,
				MessageBoxIcon.Information);
			if (launch == DialogResult.Yes)
			{
				Process.Start(new ProcessStartInfo(bat) { WorkingDirectory = InstallDir, UseShellExecute = true });
			}
			Close();
		}
		catch (Exception ex)
		{
			string hint = ex.Message.Contains("being used by another process", StringComparison.OrdinalIgnoreCase)
				? "\n\nปิด Monkeyeffect ให้หมดก่อน (รวมไอคอนลิงในทาสก์บาร์)\nแล้วเปิด Task Manager → End task:\n• TempleGiftRelay\n• node.exe (ถ้ามี)\nจากนั้นรัน Setup ใหม่"
				: "";
			MessageBox.Show(this, ex.Message + hint, "ติดตั้งไม่สำเร็จ", MessageBoxButtons.OK, MessageBoxIcon.Error);
			_installBtn.Enabled = true;
			_bar.Visible = false;
			_status.Text = "ติดตั้งไม่สำเร็จ — ปิด Monkeyeffect ก่อน แล้วลองใหม่";
		}
	}

	private static void StopMonkeyeffectBeforeInstall()
	{
		RunHidden("taskkill.exe", "/F /IM TempleGiftRelay.exe /T");
		RunHidden("taskkill.exe", "/F /IM Monkeyeffect.exe /T");
		ForceKillByPort(3847);
		ForceKillByPort(3848);
		ForceKillByPort(12922);
		System.Threading.Thread.Sleep(800);
	}

	private static void ForceKillByPort(int port)
	{
		try
		{
			var psi = new ProcessStartInfo
			{
				FileName = "cmd.exe",
				Arguments = "/c for /f \"tokens=5\" %a in ('netstat -ano ^| findstr \":" + port + "\"') do @if not %a==" + Environment.ProcessId + " taskkill /F /PID %a >nul 2>&1",
				CreateNoWindow = true,
				UseShellExecute = false
			};
			using Process? p = Process.Start(psi);
			p?.WaitForExit(4000);
		}
		catch { }
	}

	private static void RunHidden(string fileName, string arguments)
	{
		try
		{
			var psi = new ProcessStartInfo
			{
				FileName = fileName,
				Arguments = arguments,
				CreateNoWindow = true,
				UseShellExecute = false
			};
			using Process? p = Process.Start(psi);
			p?.WaitForExit(5000);
		}
		catch { }
	}

	/// <summary>
	/// Copy bundled Temple Escape gift-event save files into the game's Unreal save folder
	/// so a fresh PC gets the same 礼物事件配置 / 自定义盲盒 as the pack.
	/// </summary>
	private static void ApplyTempleEscapeGameDefaults(string installDir)
	{
		try
		{
			string srcDir = Path.Combine(installDir, "wwwroot", "defaults", "temple-escape", "SaveGames");
			if (!Directory.Exists(srcDir)) return;

			string destDir = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
				"Temple_Escape",
				"Saved",
				"SaveGames");
			Directory.CreateDirectory(destDir);

			foreach (string src in Directory.GetFiles(srcDir, "*.sav"))
			{
				string name = Path.GetFileName(src);
				File.Copy(src, Path.Combine(destDir, name), overwrite: true);
			}

			string cfgSrc = Path.Combine(installDir, "wwwroot", "defaults", "temple-escape", "Config", "Windows", "GameUserSettings.ini");
			if (File.Exists(cfgSrc))
			{
				string cfgDestDir = Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"Temple_Escape",
					"Saved",
					"Config",
					"Windows");
				Directory.CreateDirectory(cfgDestDir);
				File.Copy(cfgSrc, Path.Combine(cfgDestDir, "GameUserSettings.ini"), overwrite: true);
			}
		}
		catch
		{
			// Non-fatal: Monkeyeffect still installs; user can apply from Stickers tab later.
		}
	}

	private static bool HasWebView2()
	{
		try
		{
			string[] keys =
			{
				@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
				@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
			};
			foreach (string key in keys)
			{
				using var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(key);
				if (k?.GetValue("pv") is string pv && !string.IsNullOrWhiteSpace(pv) && pv != "0.0.0.0")
				{
					return true;
				}
			}
		}
		catch { }
		return false;
	}

	private static void ExtractPayloadToInstallDir()
	{
		Assembly asm = Assembly.GetExecutingAssembly();
		string? resName = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("payload.zip", StringComparison.OrdinalIgnoreCase));
		if (resName == null)
		{
			throw new InvalidOperationException("ไม่พบแพ็กเกจติดตั้งในไฟล์ Setup");
		}

		string tempRoot = Path.Combine(Path.GetTempPath(), "Monkeyeffect-Setup-" + Guid.NewGuid().ToString("N"));
		string tempZip = Path.Combine(tempRoot, "payload.zip");
		Directory.CreateDirectory(tempRoot);
		try
		{
			using (Stream? src = asm.GetManifestResourceStream(resName))
			{
				if (src == null) throw new InvalidOperationException("เปิดแพ็กเกจติดตั้งไม่สำเร็จ");
				using FileStream dst = File.Create(tempZip);
				src.CopyTo(dst);
			}

			Directory.CreateDirectory(InstallDir);
			ExtractZipOverwrite(tempZip, InstallDir);

			if (!File.Exists(Path.Combine(InstallDir, "TempleGiftRelay.exe")))
			{
				throw new InvalidOperationException("แพ็กเกจติดตั้งไม่สมบูรณ์");
			}
		}
		finally
		{
			try { Directory.Delete(tempRoot, true); } catch { }
		}
	}

	private static void CreateShortcut(string lnkPath, string targetPath, string iconPath, string workDir)
	{
		Type? t = Type.GetTypeFromProgID("WScript.Shell");
		if (t == null) return;
		dynamic shell = Activator.CreateInstance(t)!;
		dynamic sc = shell.CreateShortcut(lnkPath);
		sc.TargetPath = targetPath;
		sc.WorkingDirectory = workDir;
		if (File.Exists(iconPath)) sc.IconLocation = iconPath;
		sc.Save();
	}
}
