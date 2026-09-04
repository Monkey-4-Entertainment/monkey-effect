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

		[JsonPropertyName("comment")]
		public string? Comment { get; set; }

		[JsonPropertyName("rules")]
		public List<KeyMapRule> Rules { get; set; } = new();

		[JsonPropertyName("events")]
		public List<KeyMapEvent> Events { get; set; } = new();
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

		/// <summary>Null/missing means on (older keymap files have no field).</summary>
		[JsonPropertyName("enabled")]
		public bool? Enabled { get; set; }

		[JsonIgnore]
		public bool IsEnabled => Enabled != false;
	}

	public sealed class KeyMapEvent
	{
		[JsonPropertyName("enabled")]
		public bool? Enabled { get; set; }

		/// <summary>gift | like | follow</summary>
		[JsonPropertyName("trigger")]
		public string Trigger { get; set; } = "gift";

		[JsonPropertyName("giftName")]
		public string GiftName { get; set; } = "";

		/// <summary>Action label to fire (matches KeyMapRule.Label).</summary>
		[JsonPropertyName("action")]
		public string Action { get; set; } = "";

		[JsonIgnore]
		public bool IsEnabled => Enabled != false;
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
	/// Built-in games without a KeyMapFile (e.g. Temple Escape) never inherit
	/// leftover custom process/title from a previous THE RIDER selection.
	/// </summary>
	public void AutoActivateFromGame(GameSelection? selection)
	{
		string? keyMapFile = ResolveKeyMapFile(selection);
		if (keyMapFile != null)
		{
			_activeFile = keyMapFile;
			Load();
			AppPaths.Log($"keymap auto-activated for game '{selection?.Id}' -> {_activeFile}");
			return;
		}

		SetDisabled();
		AppPaths.Log($"keymap disabled for game '{selection?.Id}' (no KeyMapFile)");
	}

	/// <summary>
	/// Keymap delivery follows the selected game id — not leftover custom fields,
	/// and not whichever game window happens to be focused.
	/// </summary>
	private string? ResolveKeyMapFile(GameSelection? selection)
	{
		if (selection == null)
			return null;

		string id = selection.Id ?? "";
		GameProfile? profile = GameCatalog.FindById(id);

		if (profile != null && !string.IsNullOrWhiteSpace(profile.KeyMapFile))
			return profile.KeyMapFile;

		if (id.Equals("custom", StringComparison.OrdinalIgnoreCase))
			return DetectKeyMapFromCustom(selection);

		if (id.Equals("auto", StringComparison.OrdinalIgnoreCase))
		{
			string? fromFields = DetectKeyMapFromCustom(selection);
			if (fromFields != null)
				return fromFields;

			if (_gameWindow.TryGetWindow(out nint _, out string title) &&
			    !string.IsNullOrWhiteSpace(title))
			{
				foreach (GameProfile g in GameCatalog.BuiltIn)
				{
					if (string.IsNullOrWhiteSpace(g.KeyMapFile)) continue;
					if (g.TitleContains.Any(t => title.Contains(t, StringComparison.OrdinalIgnoreCase)))
						return g.KeyMapFile;
				}
			}
		}

		return null;
	}

	/// <summary>
	/// For "custom" / "auto" only: match process/title against a keymap game.
	/// Do not use the selected game id here — leftover CustomProcess "THE RIDER"
	/// must not activate keys while Temple Escape is selected.
	/// </summary>
	private static string? DetectKeyMapFromCustom(GameSelection selection)
	{
		string proc = (selection.CustomProcess ?? "").Trim();
		string title = (selection.CustomTitle ?? "").Trim();
		string display = (selection.DisplayName ?? "").Trim();
		string blob = string.Join(" ", proc, title, display);
		if (blob.Contains("RIDER", StringComparison.OrdinalIgnoreCase))
			return "rider-keymap.json";

		foreach (GameProfile g in GameCatalog.BuiltIn)
		{
			if (string.IsNullOrWhiteSpace(g.KeyMapFile)) continue;

			if (proc.Length > 0 && g.ProcessNames.Any(p =>
				p.Equals(proc, StringComparison.OrdinalIgnoreCase)))
				return g.KeyMapFile;

			if (title.Length > 0 && g.TitleContains.Any(t =>
				title.Contains(t, StringComparison.OrdinalIgnoreCase)))
				return g.KeyMapFile;

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

	/// <summary>
	/// Keep keymap on only while the selected game actually uses a keymap.
	/// Switching to Temple Escape (or any non-keymap game) turns keys off even if
	/// THE RIDER is still running, or leftover custom fields still say RIDER.
	/// </summary>
	private void EnsureActiveForCurrentGame()
	{
		try
		{
			GameSelection sel = _gameWindow.GetSelection();
			string? file = ResolveKeyMapFile(sel);
			if (file == null)
			{
				SetDisabled();
				return;
			}

			bool alreadyOn = false;
			lock (_lock)
			{
				alreadyOn = _config.Enabled && _config.Rules.Count > 0 &&
				            string.Equals(_activeFile, file, StringComparison.OrdinalIgnoreCase);
			}
			if (alreadyOn) return;

			_activeFile = file;
			Load();
		}
		catch
		{
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
					Normalize(cfg);
					lock (_lock) { _config = cfg; }
					AppPaths.Log($"keymap loaded {cfg.Rules.Count} rules, {cfg.Events.Count} events from {ConfigPath}");
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

	private static readonly JsonSerializerOptions JsonWriteOptions = new()
	{
		WriteIndented = true,
		Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
	};

	private static readonly JsonSerializerOptions JsonReadOptions = new()
	{
		PropertyNameCaseInsensitive = true
	};

	public string ExportJson()
	{
		EnsureActiveForCurrentGame();
		KeyMapConfig snap = GetSnapshot();
		var envelope = new
		{
			kind = "monkeyeffect-keymap-v1",
			game = "the-rider",
			enabled = snap.Enabled,
			comment = snap.Comment,
			rules = snap.Rules,
			events = snap.Events
		};
		return JsonSerializer.Serialize(envelope, JsonWriteOptions);
	}

	public bool TryImport(string raw, out KeyMapConfig config, out string error)
	{
		config = new KeyMapConfig();
		error = "";
		if (string.IsNullOrWhiteSpace(raw))
		{
			error = "ไฟล์ว่าง";
			return false;
		}
		string text = raw.Trim();
		if (TikFinityTfc.LooksEncrypted(text))
		{
			if (!TikFinityTfc.TryDecrypt(text, out string decrypted, out error))
				return false;
			text = decrypted;
		}
		try
		{
			using JsonDocument doc = JsonDocument.Parse(text);
			JsonElement root = doc.RootElement;
			if (root.ValueKind != JsonValueKind.Object)
			{
				error = "ไฟล์ต้องเป็น JSON object";
				return false;
			}

			if (root.TryGetProperty("rules", out JsonElement rulesEl) && rulesEl.ValueKind == JsonValueKind.Array)
			{
				KeyMapConfig? native = JsonSerializer.Deserialize<KeyMapConfig>(text, JsonReadOptions);
				if (native == null || native.Rules.Count == 0)
				{
					error = "JSON มี rules ว่าง";
					return false;
				}
				Normalize(native);
				config = native;
				return true;
			}

			if (TryParseTikFinity(root, out KeyMapConfig converted, out error))
			{
				Normalize(converted);
				config = converted;
				return true;
			}
			if (string.IsNullOrWhiteSpace(error))
				error = "ไม่รู้จักรูปแบบไฟล์ — ต้องเป็น Monkeyeffect .json หรือ TikFinity actions/events JSON";
			return false;
		}
		catch (Exception ex)
		{
			error = "อ่าน JSON ไม่ได้: " + ex.Message;
			return false;
		}
	}

	public bool TryImportDefaultPack(out KeyMapConfig config, out string error)
	{
		config = new KeyMapConfig();
		error = "";
		string[] paths =
		{
			Path.Combine(AppPaths.AppDir, "wwwroot", "defaults", "rider-v2.json"),
			Path.Combine(AppPaths.AppDir, "userdata", "rider-keymap.json"),
		};
		foreach (string path in paths)
		{
			if (!File.Exists(path)) continue;
			if (TryImport(File.ReadAllText(path), out config, out error))
				return true;
		}
		error = string.IsNullOrWhiteSpace(error) ? "ไม่พบพรีเซ็ต THE RIDER ในโฟลเดอร์แอพ" : error;
		return false;
	}

	private static void Normalize(KeyMapConfig cfg)
	{
		cfg.Enabled = true;
		cfg.Rules ??= new List<KeyMapRule>();
		cfg.Events ??= new List<KeyMapEvent>();
		foreach (KeyMapRule r in cfg.Rules)
		{
			r.Label = (r.Label ?? "").Trim();
			r.GiftName = (r.GiftName ?? "").Trim();
			r.Key = StripKeyToken(r.Key);
			if (r.Vk <= 0) r.Vk = ParseVirtualKey(r.Key);
			if (r.HoldMs < 20) r.HoldMs = 80;
		}
		foreach (KeyMapEvent e in cfg.Events)
		{
			e.Trigger = string.IsNullOrWhiteSpace(e.Trigger) ? "gift" : e.Trigger.Trim().ToLowerInvariant();
			e.GiftName = (e.GiftName ?? "").Trim();
			e.Action = (e.Action ?? "").Trim();
		}
		FillGiftNamesFromEvents(cfg);
		SeedEventsIfEmpty(cfg);
	}

	private static void FillGiftNamesFromEvents(KeyMapConfig cfg)
	{
		foreach (KeyMapEvent ev in cfg.Events)
		{
			if (ev.Trigger != "gift" || string.IsNullOrWhiteSpace(ev.GiftName) || string.IsNullOrWhiteSpace(ev.Action))
				continue;
			KeyMapRule? rule = cfg.Rules.FirstOrDefault(r =>
				string.Equals(r.Label, ev.Action, StringComparison.OrdinalIgnoreCase));
			if (rule != null && string.IsNullOrWhiteSpace(rule.GiftName))
				rule.GiftName = ev.GiftName;
		}
	}

	private static void SeedEventsIfEmpty(KeyMapConfig cfg)
	{
		if (cfg.Events.Count > 0) return;
		foreach (KeyMapRule r in cfg.Rules)
		{
			if (string.IsNullOrWhiteSpace(r.GiftName) && string.IsNullOrWhiteSpace(r.Label)) continue;
			cfg.Events.Add(new KeyMapEvent
			{
				Trigger = "gift",
				GiftName = r.GiftName,
				Action = r.Label,
				Enabled = r.IsEnabled
			});
		}
	}

	private static bool TryParseTikFinity(JsonElement root, out KeyMapConfig cfg, out string error)
	{
		cfg = new KeyMapConfig { Enabled = true, Comment = "imported from TikFinity" };
		error = "";
		JsonElement actions = default;
		bool hasActions = root.TryGetProperty("actions", out actions) && actions.ValueKind == JsonValueKind.Array;
		if (!hasActions && root.TryGetProperty("myActions", out actions) && actions.ValueKind == JsonValueKind.Array)
			hasActions = true;
		if (!hasActions)
			return false;

		var actionNames = new Dictionary<long, string>();
		foreach (JsonElement a in actions.EnumerateArray())
		{
			string label = (FirstString(a, "name", "label", "title", "actionName") ?? "").Trim();
			string key = FirstString(a, "key", "keystroke", "keystrokes", "keys", "sendKeys") ?? "";
			if (string.IsNullOrWhiteSpace(key))
				key = FirstString(a, "description", "desc") ?? "";
			key = StripKeyToken(key);
			if (string.IsNullOrWhiteSpace(label) && string.IsNullOrWhiteSpace(key)) continue;
			long id = FirstInt64(a, "id") ?? 0;
			if (id != 0 && !string.IsNullOrWhiteSpace(label) && !actionNames.ContainsKey(id))
				actionNames[id] = label;
			cfg.Rules.Add(new KeyMapRule
			{
				Label = label,
				Key = key,
				Vk = ParseVirtualKey(key),
				GiftName = FirstString(a, "giftName", "gift") ?? "",
				HoldMs = 80,
				Enabled = BoolOrTrue(a, "enabled", "active") && !BoolOrFalse(a, "isDeleted")
			});
		}

		JsonDocument? eventsDoc = null;
		try
		{
			if (TryReadTikFinityEvents(root, out JsonElement events, out eventsDoc))
			{
				foreach (JsonElement e in events.EnumerateArray())
				{
					string triggerRaw = FirstString(e, "trigger", "triggerType", "type", "event") ?? "";
					string gift = FirstString(e, "giftName", "gift", "triggerGift") ?? "";
					string action = (FirstString(e, "action", "actionName", "actionLabel") ?? "").Trim();
					if (string.IsNullOrWhiteSpace(action))
						action = MapActionIds(e, actionNames);
					ParseTikFinityTrigger(triggerRaw, ref gift, out string kind);
					if (string.IsNullOrWhiteSpace(kind) || kind == "gift")
					{
						int triggerId = (int)(FirstInt64(e, "triggerTypeId") ?? 0);
						if (triggerId == 2) kind = "like";
						else if (triggerId == 3) kind = "follow";
						else kind = "gift";
					}
					if (string.IsNullOrWhiteSpace(action) && e.TryGetProperty("actions", out JsonElement acts) &&
					    acts.ValueKind == JsonValueKind.Array && acts.GetArrayLength() > 0)
					{
						action = (FirstString(acts[0], "name", "label") ?? "").Trim();
					}
					if (string.IsNullOrWhiteSpace(gift) && string.IsNullOrWhiteSpace(action)) continue;
					cfg.Events.Add(new KeyMapEvent
					{
						Trigger = kind,
						GiftName = gift,
						Action = action,
						Enabled = BoolOrTrue(e, "enabled", "active")
					});
				}
			}
		}
		finally
		{
			eventsDoc?.Dispose();
		}

		if (cfg.Rules.Count == 0)
		{
			error = "ไฟล์ TikFinity ไม่มี actions";
			return false;
		}
		return true;
	}

	/// <summary>
	/// TikFinity stores live events in dynamicSettings.events (often a JSON string),
	/// not a top-level events array. Prefer the non-empty source.
	/// </summary>
	private static bool TryReadTikFinityEvents(JsonElement root, out JsonElement events, out JsonDocument? owned)
	{
		events = default;
		owned = null;
		if (TryEventsFromNode(root, "dynamicSettings", out events, out owned) &&
		    events.ValueKind == JsonValueKind.Array && events.GetArrayLength() > 0)
			return true;
		owned?.Dispose();
		owned = null;
		if (TryEventsFromNode(root, "settings", out events, out owned) &&
		    events.ValueKind == JsonValueKind.Array && events.GetArrayLength() > 0)
			return true;
		owned?.Dispose();
		owned = null;
		foreach (string name in new[] { "events", "myEvents" })
		{
			if (root.TryGetProperty(name, out JsonElement el) &&
			    el.ValueKind == JsonValueKind.Array && el.GetArrayLength() > 0)
			{
				owned?.Dispose();
				owned = null;
				events = el;
				return true;
			}
		}
		return events.ValueKind == JsonValueKind.Array && events.GetArrayLength() > 0;
	}

	private static bool TryEventsFromNode(JsonElement root, string objectName, out JsonElement events, out JsonDocument? owned)
	{
		events = default;
		owned = null;
		if (!root.TryGetProperty(objectName, out JsonElement node))
			return false;
		JsonElement dyn = node;
		if (node.ValueKind == JsonValueKind.String)
		{
			string raw = node.GetString() ?? "";
			if (string.IsNullOrWhiteSpace(raw) || raw == "{}") return false;
			try
			{
				owned = JsonDocument.Parse(raw);
				dyn = owned.RootElement;
			}
			catch
			{
				return false;
			}
		}
		if (dyn.ValueKind != JsonValueKind.Object || !dyn.TryGetProperty("events", out JsonElement dynEvents))
		{
			owned?.Dispose();
			owned = null;
			return false;
		}
		if (dynEvents.ValueKind == JsonValueKind.Array)
		{
			events = dynEvents;
			return true;
		}
		if (dynEvents.ValueKind != JsonValueKind.String) return false;
		string evJson = dynEvents.GetString() ?? "";
		if (string.IsNullOrWhiteSpace(evJson) || evJson == "[]") return false;
		try
		{
			owned?.Dispose();
			owned = JsonDocument.Parse(evJson);
			events = owned.RootElement;
			return events.ValueKind == JsonValueKind.Array;
		}
		catch
		{
			owned?.Dispose();
			owned = null;
			return false;
		}
	}

	private static string MapActionIds(JsonElement e, Dictionary<long, string> actionNames)
	{
		if (!e.TryGetProperty("actionIds", out JsonElement ids) || ids.ValueKind != JsonValueKind.Array)
			return "";
		foreach (JsonElement idEl in ids.EnumerateArray())
		{
			long aid = ReadInt64(idEl);
			if (aid != 0 && actionNames.TryGetValue(aid, out string? mapped) && !string.IsNullOrWhiteSpace(mapped))
				return mapped.Trim();
		}
		return "";
	}

	private static long ReadInt64(JsonElement el)
	{
		if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out long n)) return n;
		if (el.ValueKind == JsonValueKind.String && long.TryParse(el.GetString(), out long s)) return s;
		return 0;
	}

	private static void ParseTikFinityTrigger(string raw, ref string gift, out string kind)
	{
		string t = (raw ?? "").Trim();
		kind = "gift";
		if (t.Contains("like", StringComparison.OrdinalIgnoreCase))
		{
			kind = "like";
			return;
		}
		if (t.Contains("follow", StringComparison.OrdinalIgnoreCase))
		{
			kind = "follow";
			return;
		}
		if (t.StartsWith("Gift ", StringComparison.OrdinalIgnoreCase))
		{
			kind = "gift";
			string name = t.Substring(5).Trim();
			if (string.IsNullOrWhiteSpace(gift)) gift = name;
			return;
		}
		if (t.Equals("gift", StringComparison.OrdinalIgnoreCase) ||
		    t.Equals("SendGift", StringComparison.OrdinalIgnoreCase))
		{
			kind = "gift";
		}
	}

	private static string StripKeyToken(string? raw)
	{
		if (string.IsNullOrWhiteSpace(raw)) return "";
		string s = raw.Trim();
		int open = s.LastIndexOf('{');
		int close = s.LastIndexOf('}');
		if (open >= 0 && close > open)
			s = s.Substring(open + 1, close - open - 1).Trim();
		s = s.Replace("Send Keystrokes", "", StringComparison.OrdinalIgnoreCase).Trim().Trim('"', '\'');
		return s;
	}

	private static string? FirstString(JsonElement obj, params string[] names)
	{
		foreach (string n in names)
		{
			if (!obj.TryGetProperty(n, out JsonElement el)) continue;
			if (el.ValueKind == JsonValueKind.String)
			{
				string? v = el.GetString();
				if (!string.IsNullOrWhiteSpace(v)) return v;
			}
			else if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() > 0 &&
			         el[0].ValueKind == JsonValueKind.String)
			{
				string? v = el[0].GetString();
				if (!string.IsNullOrWhiteSpace(v)) return v;
			}
		}
		return null;
	}

	private static bool BoolOrTrue(JsonElement obj, params string[] names)
	{
		foreach (string n in names)
		{
			if (!obj.TryGetProperty(n, out JsonElement el)) continue;
			if (el.ValueKind == JsonValueKind.True) return true;
			if (el.ValueKind == JsonValueKind.False) return false;
		}
		return true;
	}

	private static bool BoolOrFalse(JsonElement obj, params string[] names)
	{
		foreach (string n in names)
		{
			if (!obj.TryGetProperty(n, out JsonElement el)) continue;
			if (el.ValueKind == JsonValueKind.True) return true;
			if (el.ValueKind == JsonValueKind.False) return false;
		}
		return false;
	}

	private static long? FirstInt64(JsonElement obj, params string[] names)
	{
		foreach (string n in names)
		{
			if (!obj.TryGetProperty(n, out JsonElement el)) continue;
			long v = ReadInt64(el);
			if (v != 0) return v;
			if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out long zero) && zero == 0)
				return 0;
		}
		return null;
	}

	public KeyMapConfig GetSnapshot()
	{
		EnsureActiveForCurrentGame();
		lock (_lock)
		{
			return JsonSerializer.Deserialize<KeyMapConfig>(
				JsonSerializer.Serialize(_config, JsonWriteOptions), JsonReadOptions)
				?? new KeyMapConfig();
		}
	}

	public void Save(KeyMapConfig config)
	{
		Normalize(config);
		lock (_lock) { _config = config; }
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
			File.WriteAllText(ConfigPath, JsonSerializer.Serialize(config, JsonWriteOptions));
			AppPaths.Log($"keymap saved {config.Rules.Count} rules, {config.Events.Count} events");
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
		EnsureActiveForCurrentGame();
		KeyMapConfig cfg;
		lock (_lock) { cfg = _config; }

		if (!cfg.Enabled || cfg.Rules.Count == 0)
			return false;

		string gift = (payload.GiftName ?? "").Trim();
		if (gift.Length == 0) return false;

		KeyMapRule? rule = ResolveRule(cfg, payload, gift);
		int vk = rule == null ? 0 : ResolveVk(rule);
		if (rule == null || vk <= 0) return false;

		try
		{
			int count = Math.Max(1, payload.RepeatCount);
			int holdMs = Math.Max(20, rule.HoldMs);
			if (!_gameWindow.TrySendVirtualKey((byte)vk, count, holdMs, out string detail))
			{
				AppPaths.Log($"keymap miss {gift}: {detail}");
				return false;
			}

			channel = $"keymap:{rule.Key}(vk{vk})x{count}";
			AppPaths.Log($"keymap delivered {gift} -> {rule.Key} x{count} ({rule.Label}) {detail}");
			return true;
		}
		catch (Exception ex)
		{
			AppPaths.Log("keymap deliver error: " + ex.Message);
			return false;
		}
	}

	private static KeyMapRule? ResolveRule(KeyMapConfig cfg, GiftPayload payload, string gift)
	{
		string kind = EventKind(payload, gift);
		if (cfg.Events.Count > 0)
		{
			KeyMapEvent? ev = cfg.Events.FirstOrDefault(e =>
				e.IsEnabled && EventMatches(e, kind, gift));
			if (ev != null)
			{
				KeyMapRule? byAction = cfg.Rules.FirstOrDefault(r =>
					r.IsEnabled &&
					!string.IsNullOrWhiteSpace(r.Label) &&
					string.Equals(r.Label.Trim(), ev.Action.Trim(), StringComparison.OrdinalIgnoreCase));
				if (byAction != null) return byAction;
			}
		}

		return cfg.Rules.FirstOrDefault(r =>
			r.IsEnabled &&
			!string.IsNullOrWhiteSpace(r.GiftName) &&
			GiftNamesMatch(r.GiftName.Trim(), gift));
	}

	private static string EventKind(GiftPayload payload, string gift)
	{
		string blob = string.Join(" ", payload.MessageType, payload.Type, payload.MsgType, gift);
		if (blob.Contains("Follow", StringComparison.OrdinalIgnoreCase) ||
		    gift.Equals("Follow", StringComparison.OrdinalIgnoreCase))
			return "follow";
		if (blob.Contains("Like", StringComparison.OrdinalIgnoreCase) ||
		    gift.Equals("Like", StringComparison.OrdinalIgnoreCase))
			return "like";
		return "gift";
	}

	private static bool EventMatches(KeyMapEvent ev, string kind, string gift)
	{
		string trigger = string.IsNullOrWhiteSpace(ev.Trigger) ? "gift" : ev.Trigger.Trim().ToLowerInvariant();
		if (trigger == "like" || trigger == "likes")
			return kind == "like";
		if (trigger == "follow" || trigger == "follower")
			return kind == "follow";
		if (kind != "gift") return false;
		return GiftNamesMatch(ev.GiftName, gift);
	}

	private static readonly (string A, string B)[] GiftAliases =
	{
		("Flower Garland", "Phuang Malai"),
		("The Lucky 9", "Lucky 9"),
		("Baby Hippo", "Moo Deng"),
		("Friendship Necklace", "Cuddle"),
		("Heart Me", "Hand Heart"),
		("Lots of Bread", "Super GG"),
	};

	private static bool GiftNamesMatch(string mapped, string incoming)
	{
		if (string.IsNullOrWhiteSpace(mapped) || string.IsNullOrWhiteSpace(incoming))
			return false;
		if (string.Equals(mapped.Trim(), incoming.Trim(), StringComparison.OrdinalIgnoreCase))
			return true;
		foreach ((string a, string b) in GiftAliases)
		{
			if ((string.Equals(mapped, a, StringComparison.OrdinalIgnoreCase) &&
			     string.Equals(incoming, b, StringComparison.OrdinalIgnoreCase)) ||
			    (string.Equals(mapped, b, StringComparison.OrdinalIgnoreCase) &&
			     string.Equals(incoming, a, StringComparison.OrdinalIgnoreCase)))
				return true;
		}
		return false;
	}

	public bool TrySendKey(string key, int vk, int holdMs, int count, out string detail)
	{
		int resolved = vk > 0 ? vk : ParseVirtualKey(key);
		if (resolved <= 0)
		{
			detail = "no-key";
			return false;
		}
		return _gameWindow.TrySendVirtualKey((byte)resolved, Math.Max(1, count), Math.Max(20, holdMs), out detail);
	}

	public static int ResolveVk(KeyMapRule rule)
	{
		if (rule.Vk > 0) return rule.Vk;
		return ParseVirtualKey(rule.Key);
	}

	/// <summary>TikFinity Send Keystrokes "{G}" / letter / digit / named keys.</summary>
	public static int ParseVirtualKey(string? key)
	{
		if (string.IsNullOrWhiteSpace(key)) return 0;
		string k = key.Trim().Trim('{', '}').Trim();
		if (k.Length == 0) return 0;
		if (k.StartsWith("VK", StringComparison.OrdinalIgnoreCase))
		{
			string num = k[2..].TrimStart('_');
			if (int.TryParse(num, out int parsed) && parsed > 0 && parsed < 256) return parsed;
		}
		if (k.Length == 1)
		{
			char c = char.ToUpperInvariant(k[0]);
			if (c >= 'A' && c <= 'Z') return c;
			if (c >= '0' && c <= '9') return c;
			return c switch
			{
				'-' => 189,
				'=' => 187,
				',' => 188,
				'.' => 190,
				'/' => 191,
				';' => 186,
				'\'' => 222,
				'[' => 219,
				']' => 221,
				'\\' => 220,
				'`' => 192,
				_ => 0
			};
		}
		return k.ToUpperInvariant() switch
		{
			"SPACE" or "SPACEBAR" => 32,
			"ENTER" or "RETURN" => 13,
			"TAB" => 9,
			"ESC" or "ESCAPE" => 27,
			"UP" => 38,
			"DOWN" => 40,
			"LEFT" => 37,
			"RIGHT" => 39,
			"SHIFT" => 16,
			"CTRL" or "CONTROL" => 17,
			"ALT" => 18,
			"F1" => 112, "F2" => 113, "F3" => 114, "F4" => 115,
			"F5" => 116, "F6" => 117, "F7" => 118, "F8" => 119,
			"F9" => 120, "F10" => 121, "F11" => 122, "F12" => 123,
			_ => 0
		};
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
