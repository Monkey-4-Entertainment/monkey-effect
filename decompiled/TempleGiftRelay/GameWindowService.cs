using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace TempleGiftRelay;

public sealed class GameWindowService
{
	private delegate bool EnumWindowsProc(nint hWnd, nint lParam);

	private struct CopyDataStruct
	{
		public nint DwData;

		public int CbData;

		public nint LpData;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct Input
	{
		public uint Type;

		public InputUnion Union;
	}

	[StructLayout(LayoutKind.Explicit)]
	private struct InputUnion
	{
		[FieldOffset(0)]
		public KeyboardInput Keyboard;

		[FieldOffset(0)]
		public MousePad Mouse;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct KeyboardInput
	{
		public ushort VirtualKey;

		public ushort ScanCode;

		public uint Flags;

		public uint Time;

		public nint ExtraInfo;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct MousePad
	{
		public int Dx;
		public int Dy;
		public uint MouseData;
		public uint Flags;
		public uint Time;
		public nint ExtraInfo;
	}

	private readonly RelayState _state;

	private readonly object _lock = new object();

	private nint _cachedHwnd = IntPtr.Zero;

	private string _cachedTitle = string.Empty;

	private GameSelection _selection;

	private GameProfile _profile;

	private const int WmCopyData = 74;

	private const byte VkReturn = 13;

	private const byte VkControl = 17;

	private const byte VkV = 86;

	private const uint KeyeventfKeyup = 2u;

	private const uint GmemMoveable = 2u;

	private const uint CfUnicode = 13u;

	public GameWindowService(RelayState state)
	{
		_state = state;
		_selection = GameCatalog.LoadSelection();
		_profile = GameCatalog.ResolveEffective(_selection);
		ApplySelectionToState();
	}

	public GameSelection GetSelection()
	{
		lock (_lock)
		{
			return new GameSelection
			{
				Id = _selection.Id,
				CustomProcess = _selection.CustomProcess,
				CustomTitle = _selection.CustomTitle,
				DisplayName = _selection.DisplayName ?? _profile.Name
			};
		}
	}

	public GameProfile GetProfile()
	{
		lock (_lock)
		{
			return _profile;
		}
	}

	public void SetSelection(GameSelection selection)
	{
		if (selection == null || string.IsNullOrWhiteSpace(selection.Id))
		{
			selection = new GameSelection { Id = "temple-escape" };
		}
		GameProfile profile = GameCatalog.ResolveEffective(selection);
		selection.DisplayName = GameCatalog.DisplayNameFor(selection.Id, selection.DisplayName);
		if (string.IsNullOrWhiteSpace(selection.DisplayName))
		{
			selection.DisplayName = profile.Name;
		}
		lock (_lock)
		{
			_selection = selection;
			_profile = profile;
			_cachedHwnd = IntPtr.Zero;
			_cachedTitle = string.Empty;
		}
		GameCatalog.SaveSelection(selection);
		ApplySelectionToState();
		Refresh();
	}

	private void ApplySelectionToState()
	{
		_state.SelectedGameId = _selection.Id;
		_state.SelectedGameName = _selection.DisplayName ?? _profile.Name;
	}

	public void Refresh()
	{
		nint num = FindGameWindow();
		lock (_lock)
		{
			_cachedHwnd = num;
			_cachedTitle = ((num == IntPtr.Zero) ? string.Empty : GetWindowTitle(num));
		}
		_state.GameWindowFound = num != IntPtr.Zero;
		_state.GameWindowTitle = _cachedTitle;
		ApplySelectionToState();
	}

	public bool TryGetWindow(out nint hwnd, out string title)
	{
		Refresh();
		lock (_lock)
		{
			hwnd = _cachedHwnd;
			title = _cachedTitle;
			return hwnd != IntPtr.Zero;
		}
	}

	/// <summary>
	/// Bring the real game window forward (click + focus) then inject the key.
	/// SendInput only lands if the game process actually has foreground —
	/// otherwise we refuse so keys do not type into Monkeyeffect / Edge / AskLink.
	/// </summary>
	public bool TrySendVirtualKey(byte virtualKey, int count, int holdMs, out string detail)
	{
		detail = "";
		if (!TryGetWindow(out nint hwnd, out string title))
		{
			detail = "no-window";
			AppPaths.Log("keymap miss no-window " + DescribeSearch());
			return false;
		}
		count = Math.Max(1, count);
		holdMs = Math.Max(20, holdMs);
		if (IsIconic(hwnd)) ShowWindow(hwnd, 9);

		string fgBefore = DescribeForeground();
		ActivateGameWindow(hwnd);

		GetWindowThreadProcessId(hwnd, out uint destPid);
		uint destTid = GetWindowThreadProcessId(hwnd, out _);
		nint fg = GetForegroundWindow();
		uint fgTid = GetWindowThreadProcessId(fg, out _);
		uint selfTid = GetCurrentThreadId();
		bool attachedFg = false;
		bool attachedSelf = false;
		uint scan = MapVirtualKey(virtualKey, 0);
		nint downLParam = MakeKeyLParam(scan, keyUp: false);
		nint upLParam = MakeKeyLParam(scan, keyUp: true);
		List<nint> targets = CollectKeyTargets(hwnd);
		try
		{
			if (fgTid != 0 && fgTid != destTid) attachedFg = AttachThreadInput(fgTid, destTid, true);
			if (selfTid != destTid) attachedSelf = AttachThreadInput(selfTid, destTid, true);
			SetForegroundWindow(hwnd);
			SetActiveWindow(hwnd);
			SetFocus(hwnd);
			for (int i = 0; i < count; i++)
			{
				foreach (nint t in targets)
				{
					PostMessage(t, 0x0100, virtualKey, downLParam);
				}
				SendScanKey(virtualKey, (ushort)scan, keyUp: false);
				Thread.Sleep(holdMs);
				foreach (nint t in targets)
				{
					PostMessage(t, 0x0101, virtualKey, upLParam);
				}
				SendScanKey(virtualKey, (ushort)scan, keyUp: true);
				if (i < count - 1) Thread.Sleep(40);
			}
		}
		finally
		{
			if (attachedSelf) AttachThreadInput(selfTid, destTid, false);
			if (attachedFg) AttachThreadInput(fgTid, destTid, false);
		}

		string fgAfter = DescribeForeground();
		detail = $"vk{virtualKey}/sc{scan} x{count} hwnd={hwnd:X} pid={destPid} title={title} fg={fgAfter}";
		AppPaths.Log($"keymap key {detail} before={fgBefore}");
		return true;
	}

	private static string DescribeForeground()
	{
		try
		{
			nint fg = GetForegroundWindow();
			if (fg == IntPtr.Zero) return "(none)";
			GetWindowThreadProcessId(fg, out uint pid);
			string title = GetWindowTitle(fg);
			string proc = "?";
			try
			{
				using Process p = Process.GetProcessById((int)pid);
				proc = p.ProcessName;
			}
			catch { }
			return $"{proc}:{pid} '{title}'";
		}
		catch
		{
			return "(error)";
		}
	}

	private static bool IsGameForeground(nint hwnd)
	{
		if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
		nint fg = GetForegroundWindow();
		if (fg == hwnd) return true;
		GetWindowThreadProcessId(fg, out uint fgPid);
		GetWindowThreadProcessId(hwnd, out uint destPid);
		return fgPid != 0 && fgPid == destPid;
	}

	private static List<nint> CollectKeyTargets(nint hwnd)
	{
		List<nint> list = new List<nint> { hwnd };
		try
		{
			EnumChildWindows(hwnd, delegate(nint child, nint _)
			{
				if (child != IntPtr.Zero) list.Add(child);
				return true;
			}, IntPtr.Zero);
		}
		catch { }
		return list;
	}

	private static void ClickWindowCenter(nint hwnd)
	{
		if (!GetWindowRect(hwnd, out RECT rc)) return;
		int width = rc.Right - rc.Left;
		int height = rc.Bottom - rc.Top;
		if (width < 40 || height < 40) return;
		int x = rc.Left + width / 2;
		int y = rc.Top + Math.Max(48, height * 2 / 3);
		try
		{
			SetCursorPos(x, y);
			mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
			Thread.Sleep(20);
			mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
		}
		catch { }
		try
		{
			int vx = GetSystemMetrics(76);
			int vy = GetSystemMetrics(77);
			int vw = GetSystemMetrics(78);
			int vh = GetSystemMetrics(79);
			if (vw <= 0 || vh <= 0) return;
			int ax = (int)((x - vx) * 65535L / vw);
			int ay = (int)((y - vy) * 65535L / vh);
			SendInput(3u, new[]
			{
				MouseAbs(ax, ay, 0x8001),
				MouseAbs(ax, ay, 0x8002),
				MouseAbs(ax, ay, 0x8004)
			}, Marshal.SizeOf<Input>());
		}
		catch { }
	}

	private static Input MouseAbs(int ax, int ay, uint flags)
	{
		return new Input
		{
			Type = 0,
			Union = new InputUnion
			{
				Mouse = new MousePad
				{
					Dx = ax,
					Dy = ay,
					Flags = flags
				}
			}
		};
	}

	private string DescribeSearch()
	{
		GameProfile profile;
		lock (_lock) { profile = _profile; }
		List<string> bits = new List<string>();
		foreach (string name in profile.ProcessNames)
		{
			if (string.IsNullOrWhiteSpace(name)) continue;
			try
			{
				Process[] ps = Process.GetProcessesByName(name);
				bits.Add(name + "=" + ps.Length);
				foreach (Process p in ps)
				{
					try { p.Dispose(); } catch { }
				}
			}
			catch
			{
				bits.Add(name + "=?");
			}
		}
		return $"game={profile.Id} {string.Join(" ", bits)}";
	}

	private static void ActivateGameWindow(nint hwnd)
	{
		try
		{
			LockSetForegroundWindow(2);
			SystemParametersInfo(0x2001, 0, IntPtr.Zero, 0x0002);
			AllowSetForegroundWindow(-1);
			ShowWindow(hwnd, 9);
			keybd_event(0x12, 0, 0, 0);
			keybd_event(0x12, 0, 2, 0);
			nint fg = GetForegroundWindow();
			uint fgTid = GetWindowThreadProcessId(fg, out _);
			uint destTid = GetWindowThreadProcessId(hwnd, out _);
			uint selfTid = GetCurrentThreadId();
			if (fgTid != destTid) AttachThreadInput(fgTid, destTid, true);
			if (selfTid != destTid) AttachThreadInput(selfTid, destTid, true);
			BringWindowToTop(hwnd);
			SwitchToThisWindow(hwnd, true);
			SetForegroundWindow(hwnd);
			SetActiveWindow(hwnd);
			SetFocus(hwnd);
			if (selfTid != destTid) AttachThreadInput(selfTid, destTid, false);
			if (fgTid != destTid) AttachThreadInput(fgTid, destTid, false);
		}
		catch
		{
			try { SetForegroundWindow(hwnd); } catch { }
		}
	}

	private static nint MakeKeyLParam(uint scan, bool keyUp)
	{
		uint lp = 1u | ((scan & 0xFF) << 16);
		if (keyUp) lp |= 1u << 30 | 1u << 31;
		return unchecked((nint)lp);
	}

	private static void SendScanKey(byte virtualKey, ushort scan, bool keyUp)
	{
		uint flags = 0x0008; // KEYEVENTF_SCANCODE
		if (keyUp) flags |= 0x0002; // KEYEVENTF_KEYUP
		Input scancode = new Input
		{
			Type = 1,
			Union = new InputUnion
			{
				Keyboard = new KeyboardInput
				{
					VirtualKey = 0,
					ScanCode = scan,
					Flags = flags
				}
			}
		};
		Input vk = new Input
		{
			Type = 1,
			Union = new InputUnion
			{
				Keyboard = new KeyboardInput
				{
					VirtualKey = virtualKey,
					ScanCode = scan,
					Flags = keyUp ? 0x0002u : 0u
				}
			}
		};
		SendInput(2u, new[] { scancode, vk }, Marshal.SizeOf<Input>());
	}

	public bool TryDeliverGiftName(string giftName, int repeatCount, out string method)
	{
		method = string.Empty;
		if (!TryGetWindow(out nint hwnd, out string _))
		{
			return false;
		}
		GiftPayload value = new GiftPayload
		{
			GiftName = giftName,
			RepeatCount = repeatCount
		};
		string json = JsonSerializer.Serialize(value);
		try
		{
			SetForegroundWindow(hwnd);
			Thread.Sleep(120);
			if (TrySendCopyData(hwnd, json))
			{
				method = "wm-copydata";
			}
			for (int i = 0; i < Math.Max(1, repeatCount); i++)
			{
				ClipboardSetText(giftName);
				Thread.Sleep(50);
				SendChord(17, 86);
				Thread.Sleep(50);
				SendKey(13);
				Thread.Sleep(180);
			}
			method = (string.IsNullOrEmpty(method) ? "gift-name+enter" : (method + "+gift-name"));
			return true;
		}
		catch
		{
			return false;
		}
	}

	private static bool TrySendCopyData(nint hwnd, string json)
	{
		byte[] bytes = Encoding.UTF8.GetBytes(json);
		nint num = Marshal.AllocHGlobal(bytes.Length);
		try
		{
			Marshal.Copy(bytes, 0, num, bytes.Length);
			nint[] array = new nint[8] { 1, 2, 100, 20049, 22851, 15500, 12922, 8888 };
			nint[] array2 = array;
			nint[] array3 = array2;
			nint[] array4 = array3;
			foreach (nint dwData in array4)
			{
				CopyDataStruct lParam = new CopyDataStruct
				{
					DwData = dwData,
					CbData = bytes.Length,
					LpData = num
				};
				SendMessage(hwnd, 74, IntPtr.Zero, ref lParam);
			}
			return true;
		}
		catch
		{
			return false;
		}
		finally
		{
			Marshal.FreeHGlobal(num);
		}
	}

	private static readonly HashSet<string> BlockedWindowProcesses = new(StringComparer.OrdinalIgnoreCase)
	{
		"msedge", "chrome", "firefox", "brave", "opera", "iexplore",
		"Cursor", "Code", "devenv", "AskLink", "AskLinkSession",
		"TempleGiftRelay", "TikTokLIVEStudio"
	};

	private static bool IsBlockedProcess(uint pid)
	{
		try
		{
			using Process p = Process.GetProcessById((int)pid);
			return BlockedWindowProcesses.Contains(p.ProcessName);
		}
		catch
		{
			return false;
		}
	}

	private nint FindGameWindow()
	{
		GameProfile profile;
		lock (_lock)
		{
			profile = _profile;
		}
		if (profile.TitleContains.Length == 0 && profile.ProcessNames.Length == 0)
			return IntPtr.Zero;

		HashSet<uint> pids = new HashSet<uint>();
		foreach (string processName in profile.ProcessNames)
		{
			if (string.IsNullOrWhiteSpace(processName)) continue;
			try
			{
				foreach (Process process in Process.GetProcessesByName(processName))
				{
					try { pids.Add((uint)process.Id); }
					catch { }
					finally { try { process.Dispose(); } catch { } }
				}
			}
			catch { }
		}

		// If the game process is running, never pick a browser tab that happens
		// to contain the same words (e.g. Edge "JOJO Matrix - Lark Docs").
		bool requirePid = pids.Count > 0;
		nint best = IntPtr.Zero;
		int bestScore = -1;
		EnumWindows(delegate(nint hwnd, nint _)
		{
			if (!IsWindowVisible(hwnd))
				return true;
			if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
			GetWindowThreadProcessId(hwnd, out uint pid);
			if (IsBlockedProcess(pid))
				return true;
			if (requirePid && !pids.Contains(pid))
				return true;
			string title = GetWindowTitle(hwnd);
			if (IsSystemNoiseTitle(title))
				return true;
			bool pidMatch = pids.Contains(pid);
			bool titleMatch = false;
			if (!string.IsNullOrWhiteSpace(title))
			{
				foreach (string needle in profile.TitleContains)
				{
					if (!string.IsNullOrWhiteSpace(needle) &&
					    title.Contains(needle, StringComparison.OrdinalIgnoreCase))
					{
						titleMatch = true;
						break;
					}
				}
			}
			if (!pidMatch && !titleMatch)
				return true;
			GetWindowRect(hwnd, out RECT rc);
			int area = Math.Max(0, rc.Right - rc.Left) * Math.Max(0, rc.Bottom - rc.Top);
			if (area < 80 * 60)
				return true;
			int score = area + (pidMatch ? 8_000_000 : 0) + (titleMatch ? 1_000_000 : 0);
			if (score > bestScore)
			{
				bestScore = score;
				best = hwnd;
			}
			return true;
		}, IntPtr.Zero);
		if (best == IntPtr.Zero && pids.Count > 0)
		{
			foreach (uint pid in pids)
			{
				try
				{
					using Process process = Process.GetProcessById((int)pid);
					nint main = process.MainWindowHandle;
					if (main != IntPtr.Zero && IsWindow(main) && !IsBlockedProcess(pid))
					{
						if (IsIconic(main)) ShowWindow(main, 9);
						best = main;
						break;
					}
				}
				catch { }
			}
		}
		if (best == IntPtr.Zero)
		{
			AppPaths.Log($"find-window miss game={profile.Id} pids={pids.Count}");
		}
		return best;
	}

	/// <summary>
	/// Force-close every known/running game so the streamer must reopen manually.
	/// Closes all catalog games + custom process — not only the currently selected one.
	/// </summary>
	public (bool Ok, int Killed, string Detail, string GameName) TryCloseSelectedGame()
	{
		HashSet<int> killedIds = new HashSet<int>();
		List<string> details = new List<string>();
		HashSet<string> processNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		HashSet<string> titleNeedles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

		void KillOne(Process process)
		{
			if (process == null || !killedIds.Add(process.Id)) return;
			try
			{
				string name = process.ProcessName;
				// ห้ามฆ่าตัวแอปเอง
				if (name.Equals("TempleGiftRelay", StringComparison.OrdinalIgnoreCase) ||
				    name.Equals("Monkeyeffect", StringComparison.OrdinalIgnoreCase) ||
				    name.Equals("MonkeyeffectSetup", StringComparison.OrdinalIgnoreCase))
				{
					killedIds.Remove(process.Id);
					return;
				}
				string label = name + ":" + process.Id;
				process.Kill(entireProcessTree: true);
				details.Add(label);
			}
			catch
			{
				killedIds.Remove(process.Id);
			}
			finally
			{
				try { process.Dispose(); } catch { }
			}
		}

		foreach (GameProfile p in GameCatalog.BuiltIn)
		{
			if (p.Id is "auto" or "custom") continue;
			foreach (string n in p.ProcessNames)
			{
				if (!string.IsNullOrWhiteSpace(n)) processNames.Add(n.Trim());
			}
			foreach (string t in p.TitleContains)
			{
				if (!string.IsNullOrWhiteSpace(t)) titleNeedles.Add(t.Trim());
			}
		}

		GameSelection selection;
		lock (_lock)
		{
			selection = _selection;
		}
		if (!string.IsNullOrWhiteSpace(selection.CustomProcess))
		{
			processNames.Add(selection.CustomProcess.Trim().Replace(".exe", "", StringComparison.OrdinalIgnoreCase));
		}
		if (!string.IsNullOrWhiteSpace(selection.CustomTitle))
		{
			titleNeedles.Add(selection.CustomTitle.Trim());
		}

		// 1) ปิดทุกโปรเซสตามชื่อเกมในแคตตาล็อก
		foreach (string processName in processNames)
		{
			try
			{
				foreach (Process process in Process.GetProcessesByName(processName))
				{
					KillOne(process);
				}
			}
			catch
			{
			}
		}

		// 2) สแกนหน้าต่างที่เปิด — ชื่อตรงเกม / Unreal *Win64-Shipping ที่รู้จัก
		try
		{
			foreach (Process process in Process.GetProcesses())
			{
				try
				{
					nint hwnd = process.MainWindowHandle;
					if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd)) continue;
					string title = GetWindowTitle(hwnd);
					if (string.IsNullOrWhiteSpace(title) || IsSystemNoiseTitle(title)) continue;

					string pname = process.ProcessName;
					bool nameHit = processNames.Contains(pname);
					bool titleHit = titleNeedles.Any(n =>
						title.Equals(n, StringComparison.OrdinalIgnoreCase) ||
						title.Contains(n, StringComparison.OrdinalIgnoreCase));
					bool shippingKnown =
						pname.Contains("Win64-Shipping", StringComparison.OrdinalIgnoreCase) &&
						(titleHit || nameHit);

					if (nameHit || titleHit || shippingKnown)
					{
						KillOne(process);
					}
					else
					{
						try { process.Dispose(); } catch { }
					}
				}
				catch
				{
					try { process.Dispose(); } catch { }
				}
			}
		}
		catch
		{
		}

		Refresh();
		string detail = details.Count > 0 ? string.Join(", ", details) : "";
		return (details.Count > 0, details.Count, detail, "ทุกเกมที่เปิดอยู่");
	}

	public List<object> ListRunningCandidates()
	{
		var results = new List<(string processName, string windowTitle, int pid, int rank)>();
		var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		try
		{
			foreach (Process process in Process.GetProcesses())
			{
				try
				{
					nint hwnd = process.MainWindowHandle;
					if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd)) continue;
					string title = GetWindowTitle(hwnd);
					if (string.IsNullOrWhiteSpace(title) || title.Length < 2) continue;
					if (IsSystemNoiseTitle(title)) continue;
					string name = process.ProcessName;
					bool shipping = name.Contains("Win64-Shipping", StringComparison.OrdinalIgnoreCase);
					bool known = GameCatalog.BuiltIn.Any(p =>
						p.TitleContains.Any(t => !string.IsNullOrWhiteSpace(t) && title.Contains(t, StringComparison.OrdinalIgnoreCase)) ||
						p.ProcessNames.Any(pn => name.Equals(pn, StringComparison.OrdinalIgnoreCase)));
					if (!shipping && !known && title.Length < 3) continue;
					string key = name + "|" + title;
					if (!seen.Add(key)) continue;
					int rank = shipping ? 0 : (known ? 1 : 2);
					results.Add((name, title, process.Id, rank));
				}
				catch
				{
				}
			}
		}
		catch
		{
		}
		return results
			.OrderBy(r => r.rank)
			.ThenBy(r => r.windowTitle)
			.Take(80)
			.Select(r => (object)new { processName = r.processName, windowTitle = r.windowTitle, pid = r.pid })
			.ToList();
	}

	private static bool IsSystemNoiseTitle(string title)
	{
		string[] noise =
		{
			"Program Manager", "Settings", "Microsoft Text Input Application",
			"Windows Input Experience", "Cursor", "Task Manager", "File Explorer",
			"Microsoft Edge", "Lark Docs", "- Google Chrome", "Mozilla Firefox"
		};
		foreach (string n in noise)
		{
			if (title.Equals(n, StringComparison.OrdinalIgnoreCase) ||
			    title.Contains(n, StringComparison.OrdinalIgnoreCase)) return true;
		}
		return false;
	}

	private static string GetWindowTitle(nint hwnd)
	{
		StringBuilder stringBuilder = new StringBuilder(512);
		GetWindowText(hwnd, stringBuilder, stringBuilder.Capacity);
		return stringBuilder.ToString();
	}

	[DllImport("user32.dll")]
	private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);

	[DllImport("user32.dll")]
	private static extern bool EnumChildWindows(nint hWndParent, EnumWindowsProc lpEnumFunc, nint lParam);

	[DllImport("user32.dll")]
	private static extern bool IsWindow(nint hWnd);

	[DllImport("user32.dll")]
	private static extern bool SetCursorPos(int x, int y);

	[DllImport("user32.dll")]
	private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, nint dwExtraInfo);

	[DllImport("user32.dll")]
	private static extern int GetSystemMetrics(int nIndex);

	[DllImport("user32.dll")]
	private static extern bool LockSetForegroundWindow(uint uLockCode);

	[DllImport("user32.dll")]
	private static extern nint SetFocus(nint hWnd);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern int GetWindowText(nint hWnd, StringBuilder lpString, int nMaxCount);

	[DllImport("user32.dll")]
	private static extern bool IsWindowVisible(nint hWnd);

	[DllImport("user32.dll")]
	private static extern uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);

	[StructLayout(LayoutKind.Sequential)]
	private struct RECT
	{
		public int Left;
		public int Top;
		public int Right;
		public int Bottom;
	}

	[DllImport("user32.dll")]
	private static extern bool GetWindowRect(nint hWnd, out RECT lpRect);

	[DllImport("user32.dll")]
	private static extern bool IsIconic(nint hWnd);

	[DllImport("user32.dll")]
	private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, nint dwExtraInfo);

	[DllImport("user32.dll")]
	private static extern bool SystemParametersInfo(uint uiAction, uint uiParam, nint pvParam, uint fWinIni);

	[DllImport("user32.dll")]
	private static extern void SwitchToThisWindow(nint hWnd, bool fAltTab);

	[DllImport("user32.dll")]
	private static extern bool SetForegroundWindow(nint hWnd);

	[DllImport("user32.dll")]
	private static extern nint GetForegroundWindow();

	[DllImport("user32.dll")]
	private static extern bool BringWindowToTop(nint hWnd);

	[DllImport("user32.dll")]
	private static extern bool SetActiveWindow(nint hWnd);

	[DllImport("user32.dll")]
	private static extern bool ShowWindow(nint hWnd, int nCmdShow);

	[DllImport("user32.dll")]
	private static extern bool AllowSetForegroundWindow(int dwProcessId);

	[DllImport("user32.dll")]
	private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

	[DllImport("kernel32.dll")]
	private static extern uint GetCurrentThreadId();

	[DllImport("user32.dll")]
	private static extern bool PostMessage(nint hWnd, int msg, nint wParam, nint lParam);

	[DllImport("user32.dll")]
	private static extern uint MapVirtualKey(uint uCode, uint uMapType);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern uint SendInput(uint count, Input[] inputs, int size);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern nint SendMessage(nint hWnd, int msg, nint wParam, ref CopyDataStruct lParam);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern bool OpenClipboard(nint hWnd);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern bool CloseClipboard();

	[DllImport("user32.dll", SetLastError = true)]
	private static extern bool EmptyClipboard();

	[DllImport("user32.dll", SetLastError = true)]
	private static extern nint SetClipboardData(uint format, nint hMem);

	[DllImport("kernel32.dll", SetLastError = true)]
	private static extern nint GlobalAlloc(uint flags, nuint bytes);

	[DllImport("kernel32.dll", SetLastError = true)]
	private static extern nint GlobalLock(nint hMem);

	[DllImport("kernel32.dll", SetLastError = true)]
	private static extern bool GlobalUnlock(nint hMem);

	private static void SendKey(byte virtualKey)
	{
		Input input = KeyDown(virtualKey);
		Input input2 = KeyUp(virtualKey);
		SendInput(2u, new Input[2] { input, input2 }, Marshal.SizeOf<Input>());
	}

	private static void SendChord(byte modifier, byte key)
	{
		SendInput(4u, new Input[4]
		{
			KeyDown(modifier),
			KeyDown(key),
			KeyUp(key),
			KeyUp(modifier)
		}, Marshal.SizeOf<Input>());
	}

	private static Input KeyDown(byte virtualKey)
	{
		return new Input
		{
			Type = 1u,
			Union = new InputUnion
			{
				Keyboard = new KeyboardInput
				{
					VirtualKey = virtualKey
				}
			}
		};
	}

	private static Input KeyUp(byte virtualKey)
	{
		return new Input
		{
			Type = 1u,
			Union = new InputUnion
			{
				Keyboard = new KeyboardInput
				{
					VirtualKey = virtualKey,
					Flags = 2u
				}
			}
		};
	}

	private static void ClipboardSetText(string text)
	{
		if (!OpenClipboard(IntPtr.Zero))
		{
			throw new InvalidOperationException("OpenClipboard failed");
		}
		try
		{
			EmptyClipboard();
			byte[] bytes = Encoding.Unicode.GetBytes(text + "\0");
			nint num = GlobalAlloc(2u, (nuint)bytes.Length);
			if (num == IntPtr.Zero)
			{
				throw new OutOfMemoryException();
			}
			nint destination = GlobalLock(num);
			try
			{
				Marshal.Copy(bytes, 0, destination, bytes.Length);
			}
			finally
			{
				GlobalUnlock(num);
			}
			if (SetClipboardData(13u, num) == IntPtr.Zero)
			{
				throw new InvalidOperationException("SetClipboardData failed");
			}
		}
		finally
		{
			CloseClipboard();
		}
	}
}
