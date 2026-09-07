using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TempleGiftRelay;

public sealed class GameProfile
{
	public string Id { get; set; } = "";

	public string Name { get; set; } = "";

	/// <summary>Process names without .exe</summary>
	public string[] ProcessNames { get; set; } = Array.Empty<string>();

	/// <summary>Window title must contain any of these (case-insensitive)</summary>
	public string[] TitleContains { get; set; } = Array.Empty<string>();

	/// <summary>If set, auto-enable keyboard key-map file (e.g. "rider-keymap.json") when this game is selected.</summary>
	public string? KeyMapFile { get; set; }
}

public sealed class GameSelection
{
	public string Id { get; set; } = "temple-escape";

	public string? CustomProcess { get; set; }

	public string? CustomTitle { get; set; }

	public string? DisplayName { get; set; }
}

public static class GameCatalog
{
	private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
	{
		WriteIndented = true,
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
	};

	public static IReadOnlyList<GameProfile> BuiltIn { get; } = new List<GameProfile>
	{
		new GameProfile
		{
			Id = "temple-escape",
			Name = "Temple Escape (神庙跑跑跑)",
			ProcessNames = new[] { "Temple_Escape-Win64-Shipping", "Temple_Escape" },
			TitleContains = new[] { "Temple_Escape", "Temple Escape", "神庙" }
		},
		new GameProfile
		{
			Id = "half-sword",
			Name = "Half Sword / 半剑",
			ProcessNames = new[] { "HalfSword-Win64-Shipping", "Half_Sword-Win64-Shipping", "BanJian-Win64-Shipping" },
			TitleContains = new[] { "HalfSword", "Half Sword", "半剑", "BanJian" }
		},
		new GameProfile
		{
			Id = "mario",
			Name = "Mario / 马里奥内部",
			ProcessNames = new[] { "Mario-Win64-Shipping", "SuperMario-Win64-Shipping" },
			TitleContains = new[] { "Mario", "马里奥" }
		},
		new GameProfile
		{
			Id = "moto",
			Name = "Violent Moto / 暴力摩托干",
			ProcessNames = new[] { "Moto-Win64-Shipping", "ViolentMoto-Win64-Shipping", "BaoLiMoTuo-Win64-Shipping" },
			TitleContains = new[] { "Moto", "摩托", "暴力摩托" }
		},
		new GameProfile
		{
			Id = "train",
			Name = "Little Train / 小火车惊魂",
			ProcessNames = new[] { "Train-Win64-Shipping", "LittleTrain-Win64-Shipping", "XiaoHuoChe-Win64-Shipping" },
			TitleContains = new[] { "Train", "小火车", "火车" }
		},
		new GameProfile
		{
			Id = "contra",
			Name = "Contra / 魂斗罗鸭鸭",
			ProcessNames = new[] { "Contra-Win64-Shipping", "HunDouLuo-Win64-Shipping" },
			TitleContains = new[] { "Contra", "魂斗罗" }
		},
		new GameProfile
		{
			Id = "horror-extract",
			Name = "Horror Extract / 恐怖搜打撤",
			ProcessNames = new[] { "Horror-Win64-Shipping", "SouDaChe-Win64-Shipping" },
			TitleContains = new[] { "Horror", "搜打撤", "恐怖" }
		},
		new GameProfile
		{
			Id = "king-canyon",
			Name = "King Canyon / 王者峡谷呀",
			ProcessNames = new[] { "KingCanyon-Win64-Shipping", "WangZhe-Win64-Shipping" },
			TitleContains = new[] { "Canyon", "王者", "峡谷" }
		},
		new GameProfile
		{
			Id = "chicken",
			Name = "Chicken / 小鸡鸡鸡鸡",
			ProcessNames = new[] { "Chicken-Win64-Shipping", "XiaoJi-Win64-Shipping" },
			TitleContains = new[] { "Chicken", "小鸡" }
		},
		new GameProfile
		{
			Id = "pig",
			Name = "Pig / 猪猪猪猪猪",
			ProcessNames = new[] { "Pig-Win64-Shipping", "ZhuZhu-Win64-Shipping" },
			TitleContains = new[] { "Pig", "猪猪" }
		},
		new GameProfile
		{
			Id = "library",
			Name = "Library / 图书馆整理",
			ProcessNames = new[] { "Library-Win64-Shipping", "TuShuGuan-Win64-Shipping" },
			TitleContains = new[] { "Library", "图书馆" }
		},
		new GameProfile
		{
			Id = "heavens",
			Name = "Jump Heavens / 跳上天庭咯",
			ProcessNames = new[] { "Heavens-Win64-Shipping", "TianTing-Win64-Shipping" },
			TitleContains = new[] { "Heaven", "天庭" }
		},
		new GameProfile
		{
			Id = "the-rider",
			Name = "THE RIDER",
			ProcessNames = new[] { "THE RIDER" },
			TitleContains = new[] { "THE RIDER" },
			KeyMapFile = "rider-keymap.json"
		},
		new GameProfile
		{
			Id = "zero-hour",
			Name = "ZERO-HOUR",
			ProcessNames = new[] { "generalszh", "generals", "Zero Hour", "ZeroHour", "ZeroHour-Win64-Shipping", "ZERO-HOUR" },
			TitleContains = new[] { "ZERO-HOUR", "Zero Hour", "ZeroHour", "CRITICAL ZERO", "Generals Zero Hour", "Command & Conquer" },
			KeyMapFile = "zero-hour-keymap.json"
		},
		new GameProfile
		{
			Id = "roblox",
			Name = "Roblox",
			ProcessNames = new[] { "RobloxPlayerBeta", "RobloxPlayer", "Roblox" },
			TitleContains = new[] { "Roblox" },
			KeyMapFile = "roblox-keymap.json"
		},
		new GameProfile
		{
			Id = "minecraft",
			Name = "Minecraft",
			ProcessNames = new[] { "javaw", "java", "Minecraft.Windows" },
			TitleContains = new[] { "Minecraft" },
			KeyMapFile = "minecraft-keymap.json"
		},
		new GameProfile
		{
			Id = "auto",
			Name = "ตรวจจับอัตโนมัติ (ทุกเกมในรายการ)",
			ProcessNames = Array.Empty<string>(),
			TitleContains = Array.Empty<string>()
		},
		new GameProfile
		{
			Id = "custom",
			Name = "กำหนดเอง (ใส่ชื่อโปรเซส / หน้าต่าง)",
			ProcessNames = Array.Empty<string>(),
			TitleContains = Array.Empty<string>()
		}
	};

	private static readonly object UserGate = new object();
	private static List<GameProfile>? _userGames;

	public static string ConfigPath => Path.Combine(
		Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
		"Monkeyeffect",
		"game-config.json");

	public static string UserGamesAppDataPath => Path.Combine(
		Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
		"Monkeyeffect",
		"user-games.json");

	public static string UserGamesPortablePath => Path.Combine(AppPaths.UserDataDir, "user-games.json");

	public static IReadOnlyList<GameProfile> UserGames
	{
		get
		{
			EnsureUserGamesLoaded();
			lock (UserGate) return _userGames!.ToList();
		}
	}

	public static IEnumerable<GameProfile> All
	{
		get
		{
			foreach (GameProfile g in BuiltIn) yield return g;
			foreach (GameProfile g in UserGames)
			{
				if (BuiltIn.Any(b => b.Id.Equals(g.Id, StringComparison.OrdinalIgnoreCase))) continue;
				yield return g;
			}
		}
	}

	/// <summary>
	/// Built-in games keep their catalog name. Never persist
	/// "Roblox · ZERO-HOUR-TikFinity" from an imported preset filename.
	/// </summary>
	public static string DisplayNameFor(string? id, string? current = null)
	{
		GameProfile? profile = FindById(id);
		if (profile != null &&
		    !profile.Id.Equals("custom", StringComparison.OrdinalIgnoreCase) &&
		    !profile.Id.Equals("auto", StringComparison.OrdinalIgnoreCase))
		{
			return string.IsNullOrWhiteSpace(profile.Name) ? (current ?? id ?? "") : profile.Name;
		}
		if (!string.IsNullOrWhiteSpace(current))
		{
			int sep = current.IndexOf(" · ", StringComparison.Ordinal);
			return sep > 0 ? current[..sep].Trim() : current.Trim();
		}
		return profile?.Name ?? id ?? "";
	}

	public static GameSelection LoadSelection()
	{
		try
		{
			if (File.Exists(ConfigPath))
			{
				string json = File.ReadAllText(ConfigPath);
				GameSelection? sel = JsonSerializer.Deserialize<GameSelection>(json, JsonOpts);
				if (sel != null && !string.IsNullOrWhiteSpace(sel.Id))
				{
					sel.DisplayName = DisplayNameFor(sel.Id, sel.DisplayName);
					return sel;
				}
			}
		}
		catch
		{
		}
		return new GameSelection { Id = "temple-escape", DisplayName = "Temple Escape (神庙跑跑跑)" };
	}

	public static void SaveSelection(GameSelection selection)
	{
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
			File.WriteAllText(ConfigPath, JsonSerializer.Serialize(selection, JsonOpts));
		}
		catch
		{
		}
	}

	public static GameProfile? FindById(string? id)
	{
		if (string.IsNullOrWhiteSpace(id))
		{
			return null;
		}
		GameProfile? built = BuiltIn.FirstOrDefault(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
		if (built != null) return built;
		EnsureUserGamesLoaded();
		lock (UserGate)
		{
			return _userGames!.FirstOrDefault(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
		}
	}

	public static string SlugFromName(string? raw)
	{
		string s = (raw ?? "").Trim().ToLowerInvariant();
		if (s.Length == 0) return "";
		var chars = new List<char>(s.Length);
		bool dash = false;
		foreach (char c in s)
		{
			if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
			{
				chars.Add(c);
				dash = false;
			}
			else if (!dash && chars.Count > 0)
			{
				chars.Add('-');
				dash = true;
			}
		}
		string slug = new string(chars.ToArray()).Trim('-');
		if (slug.Length > 60) slug = slug[..60].Trim('-');
		if (slug is "auto" or "custom" or "") return "game-" + Guid.NewGuid().ToString("N")[..8];
		return slug;
	}

	public static string KeyMapFileFor(string? gameId)
	{
		GameProfile? profile = FindById(gameId);
		if (!string.IsNullOrWhiteSpace(profile?.KeyMapFile))
			return profile!.KeyMapFile!;
		string slug = SlugFromName(gameId);
		if (string.IsNullOrWhiteSpace(slug)) slug = "user-game";
		return slug + "-keymap.json";
	}

	/// <summary>Create or update a user-added game. Does not overwrite built-in ids.</summary>
	public static GameProfile UpsertUserGame(string? name, string? processName, string? windowTitle, string? requestedId = null)
	{
		string display = (name ?? "").Trim();
		if (display.Length == 0) display = (windowTitle ?? "").Trim();
		if (display.Length == 0) display = (processName ?? "").Trim();
		if (display.Length == 0) display = "เกมใหม่";
		string id = SlugFromName(requestedId);
		if (id.Length == 0) id = SlugFromName(display);
		GameProfile? built = BuiltIn.FirstOrDefault(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
		if (built != null && built.Id is not ("auto" or "custom"))
		{
			return built;
		}
		if (id is "auto" or "custom") id = SlugFromName(display);

		string proc = (processName ?? "").Trim().Replace(".exe", "", StringComparison.OrdinalIgnoreCase);
		string title = (windowTitle ?? "").Trim();
		var next = new GameProfile
		{
			Id = id,
			Name = display,
			ProcessNames = string.IsNullOrWhiteSpace(proc) ? Array.Empty<string>() : new[] { proc },
			TitleContains = string.IsNullOrWhiteSpace(title) ? new[] { display } : new[] { title },
			KeyMapFile = id + "-keymap.json"
		};
		EnsureUserGamesLoaded();
		lock (UserGate)
		{
			int idx = _userGames!.FindIndex(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
			if (idx >= 0) _userGames[idx] = next;
			else _userGames.Add(next);
			SaveUserGamesUnlocked();
		}
		AppPaths.Log($"user-game upsert id={id} name={display} keymap={next.KeyMapFile}");
		return next;
	}

	private static void EnsureUserGamesLoaded()
	{
		if (_userGames != null) return;
		lock (UserGate)
		{
			if (_userGames != null) return;
			_userGames = new List<GameProfile>();
			foreach (string path in new[] { UserGamesPortablePath, UserGamesAppDataPath })
			{
				try
				{
					if (!File.Exists(path)) continue;
					List<GameProfile>? list = JsonSerializer.Deserialize<List<GameProfile>>(File.ReadAllText(path), JsonOpts);
					if (list == null || list.Count == 0) continue;
					foreach (GameProfile g in list)
					{
						if (string.IsNullOrWhiteSpace(g.Id) || g.Id is "auto" or "custom") continue;
						if (_userGames.Any(x => x.Id.Equals(g.Id, StringComparison.OrdinalIgnoreCase))) continue;
						if (string.IsNullOrWhiteSpace(g.KeyMapFile))
							g.KeyMapFile = g.Id + "-keymap.json";
						_userGames.Add(g);
					}
					break;
				}
				catch (Exception ex)
				{
					AppPaths.Log("user-games load failed: " + ex.Message);
				}
			}
		}
	}

	private static void SaveUserGamesUnlocked()
	{
		string json = JsonSerializer.Serialize(_userGames ?? new List<GameProfile>(), JsonOpts);
		foreach (string path in new[] { UserGamesPortablePath, UserGamesAppDataPath })
		{
			try
			{
				Directory.CreateDirectory(Path.GetDirectoryName(path)!);
				File.WriteAllText(path, json);
			}
			catch (Exception ex)
			{
				AppPaths.Log("user-games save failed: " + ex.Message);
			}
		}
	}

	public static GameProfile ResolveEffective(GameSelection selection)
	{
		GameProfile? builtIn = FindById(selection.Id);
		if (selection.Id.Equals("custom", StringComparison.OrdinalIgnoreCase))
		{
			List<string> procs = new List<string>();
			List<string> titles = new List<string>();
			if (!string.IsNullOrWhiteSpace(selection.CustomProcess))
			{
				procs.Add(selection.CustomProcess.Trim().Replace(".exe", "", StringComparison.OrdinalIgnoreCase));
			}
			if (!string.IsNullOrWhiteSpace(selection.CustomTitle))
			{
				titles.Add(selection.CustomTitle.Trim());
			}
			return new GameProfile
			{
				Id = "custom",
				Name = string.IsNullOrWhiteSpace(selection.DisplayName) ? "กำหนดเอง" : selection.DisplayName!,
				ProcessNames = procs.ToArray(),
				TitleContains = titles.ToArray()
			};
		}
		if (selection.Id.Equals("auto", StringComparison.OrdinalIgnoreCase))
		{
			List<string> procs = new List<string>();
			List<string> titles = new List<string>();
			foreach (GameProfile p in All)
			{
				if (p.Id is "auto" or "custom") continue;
				procs.AddRange(p.ProcessNames);
				titles.AddRange(p.TitleContains);
			}
			return new GameProfile
			{
				Id = "auto",
				Name = "ตรวจจับอัตโนมัติ",
				ProcessNames = procs.Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),
				TitleContains = titles.Distinct(StringComparer.OrdinalIgnoreCase).ToArray()
			};
		}
		return builtIn ?? BuiltIn[0];
	}
}
