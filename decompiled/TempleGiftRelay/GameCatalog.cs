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
			Id = "roblox",
			Name = "Roblox",
			ProcessNames = new[] { "RobloxPlayerBeta", "RobloxPlayer", "Roblox" },
			TitleContains = new[] { "Roblox", "JOJO MATRIX" },
			KeyMapFile = "roblox-keymap.json"
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

	public static string ConfigPath => Path.Combine(
		Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
		"Monkeyeffect",
		"game-config.json");

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
		return BuiltIn.FirstOrDefault(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
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
			foreach (GameProfile p in BuiltIn)
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
