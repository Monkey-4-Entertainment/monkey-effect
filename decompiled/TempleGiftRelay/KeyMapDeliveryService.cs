using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;

namespace TempleGiftRelay;

/// <summary>
/// Delivers gifts to keyboard-input games (like THE RIDER) by pressing
/// mapped virtual keys via SendInput when the game window is focused.
/// Config lives in userdata/rider-keymap.json.
/// </summary>
public sealed class KeyMapDeliveryService
{
	public sealed class KeyMapConfig
	{
		[JsonPropertyName("enabled")]
		public bool Enabled { get; set; } = true;

		[JsonPropertyName("rules")]
		public List<KeyMapRule> Rules { get; set; } = new();
	}

	public sealed class KeyMapRule
	{
		[JsonPropertyName("giftName")]
		public string GiftName { get; set; } = "";

		[JsonPropertyName("key")]
		public string Key { get; set; } = "";

		[JsonPropertyName("vk")]
		public int Vk { get; set; }

		[JsonPropertyName("label")]
		public string Label { get; set; } = "";

		[JsonPropertyName("holdMs")]
		public int HoldMs { get; set; } = 100;
	}

	private readonly GameWindowService _gameWindow;
	private KeyMapConfig _config = new();
	private readonly object _lock = new();
	private string _activeFile = "rider-keymap.json";

	public string ConfigPath => Path.Combine(AppPaths.UserDataDir, _activeFile);

	public KeyMapDeliveryService(GameWindowService gameWindow)
	{
		_gameWindow = gameWindow;
		// Auto-activate from current game selection
		AutoActivateFromGame(gameWindow.GetSelection());
	}

	/// <summary>
	/// Called when the user selects a game. If the game profile has a KeyMapFile,
	/// load that keymap and enable it. Otherwise disable keymap delivery.
	/// </summary>
	public void AutoActivateFromGame(GameSelection? selection)
	{
		if (selection == null)
		{
			SetDisabled();
			return;
		}

		GameProfile? profile = GameCatalog.FindById(selection.Id);
		// Also check custom game — resolve effective to get KeyMapFile
		if (profile == null)
		{
			profile = GameCatalog.ResolveEffective(selection);
		}

		if (profile != null && !string.IsNullOrWhiteSpace(profile.KeyMapFile))
		{
			_activeFile = profile.KeyMapFile!;
			Load();
			AppPaths.Log($"keymap auto-activated for game '{profile.Name}' -> {_activeFile}");
		}
		else
		{
			// Check if custom game matches a known keymap game by process/title
			string? keyMapFile = DetectKeyMapFromCustom(selection);
			if (keyMapFile != null)
			{
				_activeFile = keyMapFile;
				Load();
				AppPaths.Log($"keymap auto-detected from custom game -> {_activeFile}");
			}
			else
			{
				SetDisabled();
				AppPaths.Log($"keymap disabled for game '{selection.Id}' (no KeyMapFile)");
			}
		}
	}

	/// <summary>
	/// For "custom" games, check if process/title matches a built-in game that has a KeyMapFile.
	/// </summary>
	private static string? DetectKeyMapFromCustom(GameSelection selection)
	{
		string proc = (selection.CustomProcess ?? "").Trim();
		string title = (selection.CustomTitle ?? "").Trim();
		string display = (selection.DisplayName ?? "").Trim();

		foreach (GameProfile g in GameCatalog.BuiltIn)
		{
			if (string.IsNullOrWhiteSpace(g.KeyMapFile)) continue;

			// Match by process name
			if (proc.Length > 0 && g.ProcessNames.Any(p =>
				p.Equals(proc, StringComparison.OrdinalIgnoreCase)))
				return g.KeyMapFile;

			// Match by title
			if (title.Length > 0 && g.TitleContains.Any(t =>
				title.Contains(t, StringComparison.OrdinalIgnoreCase)))
				return g.KeyMapFile;

			// Match by display name
			if (display.Length > 0 && g.TitleContains.Any(t =>
				display.Contains(t, StringComparison.OrdinalIgnoreCase)))
				return g.KeyMapFile;
		}
		return null;
	}

	private void SetDisabled()
	{
		lock (_lock)
		{
			_config = new KeyMapConfig { Enabled = false };
		}
	}

	public void Load()
	{
		try
		{
			if (File.Exists(ConfigPath))
			{
				string json = File.ReadAllText(ConfigPath);
				var cfg = JsonSerializer.Deserialize<KeyMapConfig>(json, new JsonSerializerOptions
				{
					PropertyNameCaseInsensitive = true
				});
				if (cfg != null)
				{
					lock (_lock) { _config = cfg; }
					AppPaths.Log($"keymap loaded {cfg.Rules.Count} rules from {ConfigPath}");
				}
			}
			else
			{
				AppPaths.Log("keymap config not found: " + ConfigPath);
			}
		}
		catch (Exception ex)
		{
			AppPaths.Log("keymap load error: " + ex.Message);
		}
	}

	public KeyMapConfig GetSnapshot()
	{
		lock (_lock)
		{
			return JsonSerializer.Deserialize<KeyMapConfig>(
				JsonSerializer.Serialize(_config))!;
		}
	}

	public void Save(KeyMapConfig config)
	{
		lock (_lock) { _config = config; }
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
			File.WriteAllText(ConfigPath, JsonSerializer.Serialize(config, new JsonSerializerOptions
			{
				WriteIndented = true
			}));
			AppPaths.Log("keymap saved " + config.Rules.Count + " rules");
		}
		catch (Exception ex)
		{
			AppPaths.Log("keymap save error: " + ex.Message);
		}
	}

	/// <summary>
	/// Try to deliver the gift by pressing a mapped key.
	/// Returns true if a mapping was found and key was sent.
	/// </summary>
	public bool TryDeliver(GiftPayload payload, out string channel)
	{
		channel = "";
		KeyMapConfig cfg;
		lock (_lock) { cfg = _config; }

		if (!cfg.Enabled || cfg.Rules.Count == 0)
			return false;

		string gift = (payload.GiftName ?? "").Trim();
		if (gift.Length == 0) return false;

		KeyMapRule? rule = cfg.Rules.FirstOrDefault(r =>
			!string.IsNullOrWhiteSpace(r.GiftName) &&
			string.Equals(r.GiftName.Trim(), gift, StringComparison.OrdinalIgnoreCase));

		if (rule == null || rule.Vk <= 0) return false;

		if (!_gameWindow.TryGetWindow(out nint hwnd, out string _))
			return false;

		try
		{
			SetForegroundWindow(hwnd);
			Thread.Sleep(80);

			int count = Math.Max(1, payload.RepeatCount);
			int holdMs = Math.Max(20, rule.HoldMs);

			for (int i = 0; i < count; i++)
			{
				SendKeyPress((byte)rule.Vk, holdMs);
				if (i < count - 1) Thread.Sleep(50);
			}

			channel = $"keymap:{rule.Key}(vk{rule.Vk})x{count}";
			AppPaths.Log($"keymap delivered {gift} -> {rule.Key} x{count} ({rule.Label})");
			return true;
		}
		catch (Exception ex)
		{
			AppPaths.Log("keymap deliver error: " + ex.Message);
			return false;
		}
	}

	#region Win32 SendInput

	[StructLayout(LayoutKind.Sequential)]
	private struct INPUT
	{
		public uint Type;
		public INPUTUNION Union;
	}

	[StructLayout(LayoutKind.Explicit)]
	private struct INPUTUNION
	{
		[FieldOffset(0)]
		public KEYBDINPUT Keyboard;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct KEYBDINPUT
	{
		public ushort VirtualKey;
		public ushort ScanCode;
		public uint Flags;
		public uint Time;
		public nint ExtraInfo;
	}

	private const uint INPUT_KEYBOARD = 1;
	private const uint KEYEVENTF_KEYUP = 0x0002;

	[DllImport("user32.dll", SetLastError = true)]
	private static extern uint SendInput(uint count, INPUT[] inputs, int size);

	[DllImport("user32.dll")]
	private static extern bool SetForegroundWindow(nint hWnd);

	private static void SendKeyPress(byte vk, int holdMs)
	{
		INPUT down = new()
		{
			Type = INPUT_KEYBOARD,
			Union = new INPUTUNION
			{
				Keyboard = new KEYBDINPUT { VirtualKey = vk }
			}
		};
		INPUT up = new()
		{
			Type = INPUT_KEYBOARD,
			Union = new INPUTUNION
			{
				Keyboard = new KEYBDINPUT { VirtualKey = vk, Flags = KEYEVENTF_KEYUP }
			}
		};
		SendInput(1, new[] { down }, Marshal.SizeOf<INPUT>());
		Thread.Sleep(holdMs);
		SendInput(1, new[] { up }, Marshal.SizeOf<INPUT>());
	}

	#endregion
}
