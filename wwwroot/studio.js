(() => {
  const STUDIO_KEY = "tgr_studio_config";
  const COIN_TABLE = {
    rose: 1, tiktok: 1, gg: 1, heart: 1, "finger heart": 5, rosa: 10, perfume: 20,
    doughnut: 30, donut: 30, corgi: 299, "money gun": 500, confetti: 1,
    "cheer you up": 199, "super gg": 99, sunglasses: 199, galaxy: 1000,
    "disco ball": 1000, "sports car": 6999, universe: 10999, lion: 29999,
  };

  const studioState = loadStudio();
  let studioAlertFile = null;
  let studioMcCooldown = new Map();

  function uid() {
    return typeof window.uid === "function"
      ? window.uid()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultStudio() {
    return {
      alerts: { enabled: true, volume: 0.85, rules: [] },
      commands: {
        enabled: true,
        custom: [
          { id: uid(), cmd: "song", action: "song", reply: "ตั้งเพลงเป็น {arg}", enabled: true },
        ],
      },
      bot: {
        enabled: false,
        cooldownSec: 12,
        rules: [
          { id: uid(), match: "contains", keyword: "สวัสดี", reply: "สวัสดีค่ะ ยินดีต้อนรับสู่ไลฟ์", enabled: true },
          { id: uid(), match: "contains", keyword: "hi", reply: "Hello! Welcome to the live", enabled: true },
        ],
        lastReplies: [],
      },
      subathon: {
        enabled: false,
        secPerCoin: 1,
        secPerGift: 0,
        secPerLike: 0,
        maxSeconds: 14400,
      },
      points: {
        enabled: true,
        perCoin: 1,
        perLike: 1,
        perFollow: 10,
        perChat: 1,
        users: {},
      },
      dailyTts: {
        enabled: false,
        hour: 9,
        lastDate: "",
        snippets: [
          "สวัสดีตอนเช้า วันนี้พร้อมไลฟ์แล้ว",
          "อย่าลืมส่งกุหลาบทักทายกันนะ",
          "ขอบคุณที่อยู่ด้วยกันทุกวัน",
        ],
      },
      minecraft: {
        enabled: false,
        host: "127.0.0.1",
        port: 25575,
        password: "",
        rules: [
          { id: uid(), giftName: "Rose", command: "say {name} ส่ง {gift} x{count}", enabled: true },
        ],
      },
      welcome: {
        enabled: true,
        minLevel: 20,
        durationSec: 8,
      },
      profiles: [],
    };
  }

  function loadStudio() {
    const base = defaultStudio();
    try {
      const raw = localStorage.getItem(STUDIO_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        alerts: { ...base.alerts, ...(parsed.alerts || {}) },
        commands: { ...base.commands, ...(parsed.commands || {}) },
        bot: { ...base.bot, ...(parsed.bot || {}) },
        subathon: { ...base.subathon, ...(parsed.subathon || {}) },
        points: { ...base.points, ...(parsed.points || {}), users: parsed.points?.users || {} },
        dailyTts: { ...base.dailyTts, ...(parsed.dailyTts || {}) },
        minecraft: { ...base.minecraft, ...(parsed.minecraft || {}) },
        welcome: { ...base.welcome, ...(parsed.welcome || {}) },
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      };
    } catch {
      return base;
    }
  }

  function persistStudio() {
    localStorage.setItem(STUDIO_KEY, JSON.stringify(studioState));
    publishStudioOverlay();
  }

  function coinsFor(giftName) {
    const key = String(giftName || "").trim().toLowerCase();
    return COIN_TABLE[key] || 1;
  }

  function personKey(sender) {
    return String(sender || "ผู้ชม").trim().toLowerCase() || "viewer";
  }

  function touchUser(sender, extra) {
    const key = personKey(sender);
    const cur = studioState.points.users[key] || {
      nick: sender || "ผู้ชม",
      points: 0,
      coins: 0,
      likes: 0,
      gifts: 0,
      chats: 0,
    };
    cur.nick = sender || cur.nick;
    Object.assign(cur, extra || {});
    studioState.points.users[key] = cur;
    return cur;
  }

  function rankedUsers() {
    return Object.values(studioState.points.users || {})
      .filter((u) => (u.points || 0) > 0)
      .sort((a, b) => (b.points || 0) - (a.points || 0) || String(a.nick).localeCompare(String(b.nick)));
  }

  function fillTemplate(text, ctx) {
    return String(text || "")
      .replaceAll("{name}", ctx.name || "")
      .replaceAll("{gift}", ctx.gift || "")
      .replaceAll("{count}", String(ctx.count || 1))
      .replaceAll("{points}", String(ctx.points || 0))
      .replaceAll("{arg}", ctx.arg || "")
      .replaceAll("{rank}", String(ctx.rank || "-"));
  }

  async function patchLiveSettings(extra) {
    try {
      await fetch("/api/live-stats/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extra),
      });
    } catch {
      /* overlay sync is best-effort */
    }
  }

  function overlayStudioPayload() {
    return {
      pointsUsers: rankedUsers().slice(0, 12),
      botReplies: (studioState.bot.lastReplies || []).slice(0, 8),
      subathon: studioState.subathon,
      welcome: studioState.welcome,
      welcomeCard: studioState.welcomeCard || null,
    };
  }

  function publishStudioOverlay() {
    const payload = overlayStudioPayload();
    patchLiveSettings({
      studioJson: JSON.stringify(payload),
      subathonEnabled: !!studioState.subathon.enabled,
      subathonSecPerCoin: Number(studioState.subathon.secPerCoin) || 0,
      subathonSecPerGift: Number(studioState.subathon.secPerGift) || 0,
      subathonSecPerLike: Number(studioState.subathon.secPerLike) || 0,
      subathonMaxSeconds: Number(studioState.subathon.maxSeconds) || 14400,
      welcomeEnabled: studioState.welcome.enabled !== false,
      welcomeMinLevel: Number(studioState.welcome.minLevel) || 20,
      welcomeDurationSec: Number(studioState.welcome.durationSec) || 8,
    });
  }

  function setActivity(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function speak(text) {
    if (!text) return;
    if (typeof speakThai === "function") speakThai(text);
  }

  async function playAlertSound(rule) {
    if (!rule?.soundId) return;
    const volume = Math.max(0.05, Math.min(1, Number(studioState.alerts.volume) || 0.85));
    try {
      if (typeof ensureAudioOnDisk === "function") await ensureAudioOnDisk(rule.soundId);
      const res = await fetch("/api/media/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.soundId, volume }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false && data.played !== false) return;
    } catch {
      /* fallback below */
    }
    try {
      const row = typeof getAudioBlobCached === "function" ? await getAudioBlobCached(rule.soundId) : null;
      if (!row?.blob) return;
      const url = URL.createObjectURL(row.blob);
      const audio = new Audio(url);
      audio.volume = volume;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      /* browser may block until click */
    }
  }

  function matchAlert(parsed) {
    const gift = String(parsed.giftName || "").toLowerCase();
    return (studioState.alerts.rules || []).find((r) => {
      if (r.enabled === false) return false;
      if (r.trigger === "any") return true;
      if (r.trigger === "gift" && parsed.kind === "gift") {
        return !r.giftName || String(r.giftName).toLowerCase() === gift;
      }
      if (r.trigger === parsed.kind) {
        if (parsed.kind !== "gift") return true;
        return !r.giftName || String(r.giftName).toLowerCase() === gift;
      }
      return false;
    });
  }

  function awardPoints(parsed) {
    if (!studioState.points.enabled) return null;
    const p = studioState.points;
    const user = touchUser(parsed.sender);
    if (parsed.kind === "gift") {
      const coins = coinsFor(parsed.giftName) * (Number(parsed.count) || 1);
      user.coins += coins;
      user.gifts += Number(parsed.count) || 1;
      user.points += coins * (Number(p.perCoin) || 0);
    } else if (parsed.kind === "like") {
      const n = Number(parsed.count) || 1;
      user.likes += n;
      user.points += n * (Number(p.perLike) || 0);
    } else if (parsed.kind === "follow") {
      user.points += Number(p.perFollow) || 0;
    } else if (parsed.kind === "chat") {
      user.chats += 1;
      user.points += Number(p.perChat) || 0;
    }
    return user;
  }

  async function extendSubathon(parsed) {
    if (!studioState.subathon.enabled) return;
    const s = studioState.subathon;
    let add = 0;
    if (parsed.kind === "gift") {
      const coins = coinsFor(parsed.giftName) * (Number(parsed.count) || 1);
      add = (Number(s.secPerGift) || 0) * (Number(parsed.count) || 1) + (Number(s.secPerCoin) || 0) * coins;
    } else if (parsed.kind === "like") {
      add = (Number(s.secPerLike) || 0) * (Number(parsed.count) || 1);
    }
    if (add <= 0) return;
    let used = false;
    try {
      const snap = await fetch("/api/live-stats", { cache: "no-store" }).then((r) => r.json());
      const c = snap.config || {};
      if (!c.timerRunning) {
        setActivity("subathonActivity", "ยังไม่เริ่มจับเวลา — กดเริ่มก่อน แล้วค่อยส่งของขวัญ");
        return;
      }
      const before = c.timerEndsAt ? Math.max(0, Math.ceil((c.timerEndsAt - Date.now()) / 1000)) : 0;
      await patchLiveSettings({ addSeconds: add });
      const afterSnap = await fetch("/api/live-stats", { cache: "no-store" }).then((r) => r.json());
      const ac = afterSnap.config || {};
      const after = ac.timerEndsAt ? Math.max(0, Math.ceil((ac.timerEndsAt - Date.now()) / 1000)) : 0;
      used = after >= before + add - 1;
      if (!used) {
        const cap = Number(s.maxSeconds) || 14400;
        await patchLiveSettings({ timerSeconds: Math.min(cap, before + add), timer: "start" });
        used = true;
      }
    } catch {
      used = false;
    }
    if (used) setActivity("subathonActivity", `+${add} วินาที จาก ${parsed.sender} (${parsed.giftName || parsed.kind})`);
    renderSubathonClock();
  }

  function commandHelpText() {
    const builtin = new Set(["points", "rank", "timer", "help"]);
    const extra = (studioState.commands.custom || [])
      .filter((c) => c.enabled !== false && !builtin.has(String(c.cmd).toLowerCase()))
      .map((c) => `!${c.cmd}`)
      .join(" ");
    return `คำสั่ง: !points !rank !timer !help ${extra}`.trim();
  }

  function syncCommandOverlay() {
    const lines = [
      "!points ดูแต้มของตัวเอง",
      "!rank ดูอันดับ",
      "!timer เวลา Subathon ที่เหลือ",
      "!help รายการคำสั่ง",
      ...(studioState.commands.custom || [])
        .filter((c) => c.enabled !== false && !["points", "rank", "timer", "help"].includes(String(c.cmd).toLowerCase()))
        .map((c) => `!${c.cmd} ${c.reply || c.action || ""}`.trim()),
    ];
    const box = document.getElementById("liveCommands");
    if (box) box.value = lines.join("\n");
    patchLiveSettings({ commands: lines.join("\n") });
  }

  async function runChatCommand(parsed) {
    const raw = String(parsed.message || "").trim();
    if (!raw.startsWith("!")) return false;
    if (studioState.commands.enabled === false) return false;
    const [head, ...rest] = raw.slice(1).split(/\s+/);
    const cmd = (head || "").toLowerCase();
    if (!cmd) return false;
    const arg = rest.join(" ").trim();
    const user = touchUser(parsed.sender);
    const rank = rankedUsers().findIndex((u) => personKey(u.nick) === personKey(parsed.sender)) + 1;
    const ctx = { name: parsed.sender, gift: parsed.giftName, count: parsed.count, points: user.points, arg, rank: rank || "-" };

    if (cmd === "points") {
      speak(`${parsed.sender} มี ${user.points} แต้ม`);
      setActivity("chatActivity", `!points → ${parsed.sender} ${user.points} แต้ม`);
      return true;
    }
    if (cmd === "rank") {
      speak(rank ? `${parsed.sender} อันดับที่ ${rank}` : `${parsed.sender} ยังไม่มีอันดับ`);
      setActivity("chatActivity", `!rank → ${rank || "-"}`);
      return true;
    }
    if (cmd === "timer") {
      const remain = await remainingTimerSec();
      speak(remain > 0 ? `เหลือเวลา ${Math.floor(remain / 60)} นาที ${remain % 60} วินาที` : "ยังไม่ได้เริ่มจับเวลา");
      setActivity("chatActivity", `!timer → ${remain}s`);
      return true;
    }
    if (cmd === "help") {
      speak(commandHelpText());
      setActivity("chatActivity", commandHelpText());
      return true;
    }

    const custom = (studioState.commands.custom || []).find(
      (c) => c.enabled !== false && String(c.cmd).toLowerCase() === cmd
    );
    if (!custom) return false;
    if (custom.action === "song" || cmd === "song") {
      const song = arg || custom.reply || "";
      const songBox = document.getElementById("liveSong");
      if (songBox) songBox.value = song;
      await patchLiveSettings({ song });
    }
    const reply = fillTemplate(custom.reply || "", ctx) || (cmd === "song" ? `ตั้งเพลงเป็น ${arg}` : "");
    if (reply) speak(reply);
    setActivity("chatActivity", `!${cmd} จาก ${parsed.sender}`);
    return true;
  }

  function runChatbot(parsed) {
    if (!studioState.bot.enabled) return;
    const text = String(parsed.message || "").trim();
    if (!text || text.startsWith("!")) return;
    const now = Date.now();
    const key = personKey(parsed.sender);
    const wait = (Number(studioState.bot.cooldownSec) || 12) * 1000;
    const last = studioMcCooldown.get("bot:" + key) || 0;
    if (now - last < wait) return;
    const hit = (studioState.bot.rules || []).find((r) => {
      if (r.enabled === false || !r.keyword) return false;
      const a = text.toLowerCase();
      const b = String(r.keyword).toLowerCase();
      if (r.match === "exact") return a === b;
      if (r.match === "starts") return a.startsWith(b);
      return a.includes(b);
    });
    if (!hit) return;
    studioMcCooldown.set("bot:" + key, now);
    const reply = fillTemplate(hit.reply, { name: parsed.sender, arg: text });
    if (!reply) return;
    speak(reply);
    studioState.bot.lastReplies = [
      { nick: parsed.sender, text, reply, at: now },
      ...(studioState.bot.lastReplies || []),
    ].slice(0, 12);
    persistStudio();
    setActivity("chatActivity", `บอทตอบ ${parsed.sender}: ${reply}`);
    renderBotLog();
  }

  async function runMinecraft(parsed) {
    if (!studioState.minecraft.enabled || parsed.kind !== "gift") return;
    const gift = String(parsed.giftName || "").toLowerCase();
    const rule = (studioState.minecraft.rules || []).find(
      (r) => r.enabled !== false && String(r.giftName || "").toLowerCase() === gift
    );
    if (!rule?.command) return;
    const command = fillTemplate(rule.command, {
      name: parsed.sender,
      gift: parsed.giftName,
      count: parsed.count,
    });
    const result = await sendMinecraftCommand(command);
    setActivity("mcActivity", result);
  }

  async function sendMinecraftCommand(command) {
    const mc = studioState.minecraft;
    try {
      const res = await fetch("/api/minecraft/rcon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: mc.host,
          port: Number(mc.port) || 25575,
          password: mc.password || "",
          command,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) return "โปรแกรมยังไม่มี RCON — สร้างใหม่แล้วเปิดแอพอีกรอบ";
      return data.ok ? `ส่งแล้ว: ${data.detail || command}` : `RCON ไม่สำเร็จ: ${data.detail || res.status}`;
    } catch (err) {
      return "RCON เรียกไม่ได้: " + (err.message || err);
    }
  }

  async function remainingTimerSec() {
    try {
      const res = await fetch("/api/live-stats", { cache: "no-store" });
      const data = await res.json();
      const c = data.config || {};
      if (c.timerRunning && c.timerEndsAt) {
        return Math.max(0, Math.ceil((c.timerEndsAt - Date.now()) / 1000));
      }
      return Number(c.timerSeconds) || 0;
    } catch {
      return 0;
    }
  }

  window.handleStudioEvent = function handleStudioEvent(parsed) {
    if (!parsed) return;
    try {
      const user = awardPoints(parsed);
      if (studioState.alerts.enabled) {
        const rule = matchAlert(parsed);
        if (rule) playAlertSound(rule);
      }
      if (parsed.kind === "gift" || parsed.kind === "like") {
        extendSubathon(parsed);
      }
      if (parsed.kind === "chat") {
        if (studioState.commands.enabled !== false) {
          runChatCommand(parsed).then((ran) => {
            if (!ran) runChatbot(parsed);
          });
        } else {
          runChatbot(parsed);
        }
      }
      if (parsed.kind === "gift") runMinecraft(parsed);
      persistStudio();
      renderPointsTable();
      if (user && parsed.kind === "gift") {
        setActivity("pointsActivity", `${parsed.sender} +แต้ม รวม ${user.points}`);
      }
    } catch (err) {
      console.warn("studio event", err);
    }
  };

  const boundIds = new Set();
  function bindToggle(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!get();
    if (boundIds.has(id)) return;
    boundIds.add(id);
    el.addEventListener("change", () => {
      set(el.checked);
      persistStudio();
    });
  }

  function bindNumber(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(get());
    if (boundIds.has(id)) return;
    boundIds.add(id);
    el.addEventListener("change", () => {
      set(Number(el.value));
      persistStudio();
    });
  }

  function bindText(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = get() || "";
    if (boundIds.has(id)) return;
    boundIds.add(id);
    el.addEventListener("change", () => {
      set(el.value);
      persistStudio();
    });
  }

  function renderAlertRules() {
    const host = document.getElementById("alertRulesList");
    const chip = document.getElementById("alertRuleCount");
    if (chip) chip.textContent = `${studioState.alerts.rules.length} กฎ`;
    if (!host) return;
    if (!studioState.alerts.rules.length) {
      host.innerHTML = '<div class="hint">ยังไม่มีกฎ — อัปโหลดไฟล์เสียงแล้วบันทึกด้านบน</div>';
      return;
    }
    host.innerHTML = studioState.alerts.rules
      .map(
        (r) => `<article class="song-item ${r.enabled === false ? "disabled" : ""}">
          <div><b>${escapeHtml(r.giftName || r.trigger)}</b><div class="hint">${escapeHtml(r.soundName || r.soundId || "")} · ${escapeHtml(r.trigger)}</div></div>
          <div class="actions tight">
            <button type="button" class="btn ghost small" data-alert-test="${r.id}">ทดสอบ</button>
            <button type="button" class="btn ghost small" data-alert-del="${r.id}">ลบ</button>
          </div>
        </article>`
      )
      .join("");
  }

  function renderCommandRules() {
    const host = document.getElementById("commandRulesList");
    if (!host) return;
    const rows = (studioState.commands.custom || []).filter(
      (c) => !["points", "rank", "timer", "help"].includes(String(c.cmd).toLowerCase())
    );
    host.innerHTML = rows.length
      ? rows
          .map(
            (c) => `<article class="song-item">
              <div><b>!${escapeHtml(c.cmd)}</b><div class="hint">${escapeHtml(c.action)} · ${escapeHtml(c.reply || "")}</div></div>
              <button type="button" class="btn ghost small" data-cmd-del="${c.id}">ลบ</button>
            </article>`
          )
          .join("")
      : '<div class="hint">ยังไม่มีคำสั่งเพิ่มเอง — !points !rank !timer !help มีให้อยู่แล้ว</div>';
  }

  function renderBotRules() {
    const host = document.getElementById("botRulesList");
    if (!host) return;
    const rows = studioState.bot.rules || [];
    host.innerHTML =
      rows
        .map(
          (r) => `<article class="song-item">
            <div><b>${escapeHtml(r.keyword)}</b><div class="hint">${escapeHtml(r.match)} → ${escapeHtml(r.reply)}</div></div>
            <button type="button" class="btn ghost small" data-bot-del="${r.id}">ลบ</button>
          </article>`
        )
        .join("") || '<div class="hint">ยังไม่มีกฎบอท</div>';
  }

  function renderBotLog() {
    const host = document.getElementById("botReplyLog");
    if (!host) return;
    const rows = studioState.bot.lastReplies || [];
    host.innerHTML = rows.length
      ? rows.map((r) => `<div class="hint"><b>${escapeHtml(r.nick)}</b> ${escapeHtml(r.text)} → ${escapeHtml(r.reply)}</div>`).join("")
      : '<div class="hint">ยังไม่มีคำตอบ</div>';
  }

  function renderPointsTable() {
    const host = document.getElementById("pointsTable");
    const chip = document.getElementById("pointsUserCount");
    const rows = rankedUsers();
    if (chip) chip.textContent = `${rows.length} คน`;
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = '<div class="hint">ยังไม่มีแต้ม — ส่งของขวัญ/ไลค์/แชทเพื่อสะสม</div>';
      return;
    }
    host.innerHTML = `<table class="studio-table"><thead><tr><th>#</th><th>ผู้ชม</th><th>แต้ม</th><th>เพชร</th><th>ไลค์</th></tr></thead><tbody>${rows
      .slice(0, 40)
      .map(
        (u, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(u.nick)}</td><td>${u.points || 0}</td><td>${u.coins || 0}</td><td>${u.likes || 0}</td></tr>`
      )
      .join("")}</tbody></table>`;
  }

  function renderMcRules() {
    const host = document.getElementById("mcRulesList");
    if (!host) return;
    host.innerHTML =
      (studioState.minecraft.rules || [])
        .map(
          (r) => `<article class="song-item">
            <div><b>${escapeHtml(r.giftName)}</b><div class="hint"><code>${escapeHtml(r.command)}</code></div></div>
            <button type="button" class="btn ghost small" data-mc-del="${r.id}">ลบ</button>
          </article>`
        )
        .join("") || '<div class="hint">ยังไม่มีกฎของขวัญ → คำสั่ง</div>';
  }

  function renderProfiles() {
    const host = document.getElementById("profileList");
    if (!host) return;
    host.innerHTML =
      (studioState.profiles || [])
        .map(
          (p) => `<article class="song-item">
            <div><b>${escapeHtml(p.name)}</b><div class="hint">${new Date(p.at || Date.now()).toLocaleString("th-TH")}</div></div>
            <div class="actions tight">
              <button type="button" class="btn secondary small" data-profile-load="${p.id}">ใช้</button>
              <button type="button" class="btn ghost small" data-profile-del="${p.id}">ลบ</button>
            </div>
          </article>`
        )
        .join("") || '<div class="hint">ยังไม่มีโปรไฟล์ — บันทึกชุดตั้งค่าปัจจุบันด้านบน</div>';
  }

  function renderDailySnippets() {
    const host = document.getElementById("dailyTtsList");
    if (!host) return;
    const rows = studioState.dailyTts.snippets || [];
    host.innerHTML = rows
      .map((s, i) => `<article class="song-item"><div>${escapeHtml(s)}</div><button type="button" class="btn ghost small" data-daily-del="${i}">ลบ</button></article>`)
      .join("") || '<div class="hint">ยังไม่มีวลี</div>';
  }

  async function renderSubathonClock() {
    const el = document.getElementById("subathonClock");
    if (!el) return;
    const sec = await remainingTimerSec();
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    el.textContent = `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function collectLocalStorageBundle() {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("tgr_"));
    const data = {};
    for (const k of keys) data[k] = localStorage.getItem(k);
    return data;
  }

  async function snapshotProfile(name) {
    let keymap = null;
    let live = null;
    try {
      keymap = await (await fetch("/api/keymap")).json();
    } catch {
      keymap = null;
    }
    try {
      live = await (await fetch("/api/live-stats")).json();
    } catch {
      live = null;
    }
    return {
      id: uid(),
      name: name || "โปรไฟล์ใหม่",
      at: Date.now(),
      local: collectLocalStorageBundle(),
      keymap,
      liveConfig: live?.config || null,
      studio: JSON.parse(JSON.stringify(studioState)),
    };
  }

  async function applyProfile(profile) {
    if (!profile) return;
    if (profile.local && typeof profile.local === "object") {
      for (const [k, v] of Object.entries(profile.local)) {
        if (k === STUDIO_KEY) continue;
        try {
          localStorage.setItem(k, v);
        } catch {
          /* ignore */
        }
      }
    }
    if (profile.studio) {
      Object.assign(studioState, loadStudioFrom(profile.studio));
      persistStudio();
    }
    if (profile.keymap) {
      try {
        await fetch("/api/keymap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profile.keymap),
        });
      } catch {
        /* ignore */
      }
    }
    if (profile.liveConfig) {
      await patchLiveSettings(profile.liveConfig);
    }
    paintStudioUi();
    alert("ใช้โปรไฟล์แล้ว — รีเฟรชหน้าถ้าเมนูเพลง/วิดีโอยังไม่ตาม");
  }

  function loadStudioFrom(parsed) {
    const base = defaultStudio();
    return {
      ...base,
      ...parsed,
      alerts: { ...base.alerts, ...(parsed.alerts || {}) },
      commands: { ...base.commands, ...(parsed.commands || {}) },
      bot: { ...base.bot, ...(parsed.bot || {}) },
      subathon: { ...base.subathon, ...(parsed.subathon || {}) },
      points: { ...base.points, ...(parsed.points || {}), users: parsed.points?.users || {} },
      dailyTts: { ...base.dailyTts, ...(parsed.dailyTts || {}) },
      minecraft: { ...base.minecraft, ...(parsed.minecraft || {}) },
      welcome: { ...base.welcome, ...(parsed.welcome || {}) },
      profiles: studioState.profiles,
    };
  }

  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function maybeSpeakDailySnippet(force) {
    const cfg = studioState.dailyTts;
    if (!cfg.enabled && !force) return;
    const snippets = (cfg.snippets || []).map((s) => String(s).trim()).filter(Boolean);
    if (!snippets.length) return;
    const now = new Date();
    if (!force && now.getHours() < (Number(cfg.hour) || 0)) return;
    const stamp = todayStamp();
    if (!force && cfg.lastDate === stamp) return;
    const text = snippets[Math.floor(Math.random() * snippets.length)];
    cfg.lastDate = stamp;
    persistStudio();
    speak(text);
    setActivity("dailyTtsActivity", `อ่านวันนี้: ${text}`);
  }

  function paintStudioUi() {
    bindToggle("alertEnabled", () => studioState.alerts.enabled, (v) => (studioState.alerts.enabled = v));
    bindToggle("chatCmdEnabled", () => studioState.commands.enabled, (v) => (studioState.commands.enabled = v));
    bindToggle("botEnabled", () => studioState.bot.enabled, (v) => (studioState.bot.enabled = v));
    bindToggle("subathonEnabled", () => studioState.subathon.enabled, (v) => (studioState.subathon.enabled = v));
    bindToggle("pointsEnabled", () => studioState.points.enabled, (v) => (studioState.points.enabled = v));
    bindToggle("mcEnabled", () => studioState.minecraft.enabled, (v) => (studioState.minecraft.enabled = v));
    bindToggle("dailyTtsEnabled", () => studioState.dailyTts.enabled, (v) => (studioState.dailyTts.enabled = v));
    bindToggle("welcomeEnabled", () => studioState.welcome.enabled, (v) => (studioState.welcome.enabled = v));

    const vol = document.getElementById("alertVolume");
    const volLab = document.getElementById("alertVolumeLabel");
    if (vol) {
      vol.value = String(Math.round((studioState.alerts.volume || 0.85) * 100));
      if (volLab) volLab.textContent = vol.value;
    }
    bindNumber("botCooldown", () => studioState.bot.cooldownSec, (v) => (studioState.bot.cooldownSec = v));
    bindNumber("subathonSecPerCoin", () => studioState.subathon.secPerCoin, (v) => (studioState.subathon.secPerCoin = v));
    bindNumber("subathonSecPerGift", () => studioState.subathon.secPerGift, (v) => (studioState.subathon.secPerGift = v));
    bindNumber("subathonSecPerLike", () => studioState.subathon.secPerLike, (v) => (studioState.subathon.secPerLike = v));
    bindNumber("subathonMaxSeconds", () => studioState.subathon.maxSeconds, (v) => (studioState.subathon.maxSeconds = v));
    bindNumber("pointsPerCoin", () => studioState.points.perCoin, (v) => (studioState.points.perCoin = v));
    bindNumber("pointsPerLike", () => studioState.points.perLike, (v) => (studioState.points.perLike = v));
    bindNumber("pointsPerFollow", () => studioState.points.perFollow, (v) => (studioState.points.perFollow = v));
    bindNumber("pointsPerChat", () => studioState.points.perChat, (v) => (studioState.points.perChat = v));
    bindNumber("dailyTtsHour", () => studioState.dailyTts.hour, (v) => (studioState.dailyTts.hour = v));
    bindNumber("mcPort", () => studioState.minecraft.port, (v) => (studioState.minecraft.port = v));
    bindNumber("welcomeMinLevel", () => studioState.welcome.minLevel, (v) => (studioState.welcome.minLevel = v));
    bindNumber("welcomeDurationSec", () => studioState.welcome.durationSec, (v) => (studioState.welcome.durationSec = v));
    bindText("mcHost", () => studioState.minecraft.host, (v) => (studioState.minecraft.host = v));
    bindText("mcPassword", () => studioState.minecraft.password, (v) => (studioState.minecraft.password = v));

    const botEn = document.getElementById("botEnabled");
    if (botEn) botEn.checked = !!studioState.bot.enabled;

    renderAlertRules();
    renderCommandRules();
    renderBotRules();
    renderBotLog();
    renderPointsTable();
    renderMcRules();
    renderProfiles();
    renderDailySnippets();
    renderSubathonClock();
  }

  function wireStudio() {
    document.getElementById("alertVolume")?.addEventListener("input", (e) => {
      studioState.alerts.volume = Number(e.target.value) / 100;
      const lab = document.getElementById("alertVolumeLabel");
      if (lab) lab.textContent = e.target.value;
      persistStudio();
    });
    document.getElementById("alertFile")?.addEventListener("change", (e) => {
      studioAlertFile = e.target.files?.[0] || null;
    });
    document.getElementById("alertSaveBtn")?.addEventListener("click", async () => {
      const trigger = document.getElementById("alertTrigger")?.value || "gift";
      const giftName = document.getElementById("alertGiftName")?.value.trim() || "";
      if (!studioAlertFile) {
        alert("เลือกไฟล์เสียงก่อน");
        return;
      }
      const id = "alert_" + uid();
      await saveAudioBlob(id, studioAlertFile, studioAlertFile.name, studioAlertFile.type);
      if (typeof putAudioCacheToDisk === "function") {
        await putAudioCacheToDisk(id, studioAlertFile, studioAlertFile.name, studioAlertFile.type);
      }
      studioState.alerts.rules.push({
        id,
        trigger,
        giftName,
        soundId: id,
        soundName: studioAlertFile.name,
        enabled: true,
      });
      persistStudio();
      renderAlertRules();
      document.getElementById("alertGiftName").value = "";
      document.getElementById("alertFile").value = "";
      studioAlertFile = null;
    });
    document.getElementById("alertRulesList")?.addEventListener("click", async (e) => {
      const testId = e.target.dataset.alertTest;
      const delId = e.target.dataset.alertDel;
      if (testId) {
        const rule = studioState.alerts.rules.find((r) => r.id === testId);
        if (rule) await playAlertSound(rule);
      }
      if (delId) {
        studioState.alerts.rules = studioState.alerts.rules.filter((r) => r.id !== delId);
        persistStudio();
        renderAlertRules();
      }
    });

    document.getElementById("commandAddBtn")?.addEventListener("click", () => {
      const cmd = document.getElementById("commandName")?.value.trim().replace(/^!/, "");
      const action = document.getElementById("commandAction")?.value || "tts";
      const reply = document.getElementById("commandReply")?.value.trim() || "";
      if (!cmd) return alert("ใส่ชื่อคำสั่ง เช่น song");
      studioState.commands.custom.push({ id: uid(), cmd, action, reply, enabled: true });
      persistStudio();
      syncCommandOverlay();
      renderCommandRules();
      document.getElementById("commandName").value = "";
    });
    document.getElementById("commandRulesList")?.addEventListener("click", (e) => {
      const id = e.target.dataset.cmdDel;
      if (!id) return;
      studioState.commands.custom = studioState.commands.custom.filter((c) => c.id !== id);
      persistStudio();
      syncCommandOverlay();
      renderCommandRules();
    });
    document.getElementById("chatTestBtn")?.addEventListener("click", async () => {
      const text = document.getElementById("chatTestText")?.value.trim() || "!points";
      const name = document.getElementById("chatTestName")?.value.trim() || "Test User";
      window.handleStudioEvent({
        kind: "chat",
        sender: name,
        message: text,
        giftName: "",
        count: 1,
      });
    });

    document.getElementById("botAddBtn")?.addEventListener("click", () => {
      const keyword = document.getElementById("botKeyword")?.value.trim();
      const reply = document.getElementById("botReply")?.value.trim();
      const match = document.getElementById("botMatch")?.value || "contains";
      if (!keyword || !reply) return alert("ใส่คำที่เจอและคำตอบ");
      studioState.bot.rules.push({ id: uid(), keyword, reply, match, enabled: true });
      persistStudio();
      renderBotRules();
    });
    document.getElementById("botRulesList")?.addEventListener("click", (e) => {
      const id = e.target.dataset.botDel;
      if (!id) return;
      studioState.bot.rules = studioState.bot.rules.filter((r) => r.id !== id);
      persistStudio();
      renderBotRules();
    });

    document.getElementById("subathonSaveBtn")?.addEventListener("click", () => {
      persistStudio();
      publishStudioOverlay();
      setActivity("subathonActivity", "บันทึกกฎยืดเวลาแล้ว — กดเริ่ม Timer ใน Overlay Gallery ด้วย");
    });
    document.getElementById("subathonStartBtn")?.addEventListener("click", async () => {
      const sec = Number(document.getElementById("liveTimerSeconds")?.value) || Number(studioState.subathon.maxSeconds) || 300;
      await patchLiveSettings({ timerSeconds: sec, timer: "start", subathonEnabled: true });
      renderSubathonClock();
    });
    document.getElementById("subathonStopBtn")?.addEventListener("click", async () => {
      await patchLiveSettings({ timer: "stop" });
      renderSubathonClock();
    });
    document.getElementById("subathonTestBtn")?.addEventListener("click", () => {
      window.handleStudioEvent({ kind: "gift", sender: "Test User", giftName: "Rose", count: 1 });
    });

    document.querySelectorAll("[data-welcome-test]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.getAttribute("data-welcome-test") || "gold";
        const samples = {
          fan: { nick: "ผู้ชม Superfan", level: 20, superFan: true, fanLevel: 1 },
          silver: { nick: "ผู้ชม LV 20", level: 20, superFan: false, fanLevel: 0 },
          gold: { nick: "ผู้ชม LV 30", level: 30, superFan: false, fanLevel: 0 },
          platinum: { nick: "ผู้ชม LV 40", level: 40, superFan: true, fanLevel: 6 },
          diamond: { nick: "ผู้ชม LV 50", level: 50, superFan: true, fanLevel: 10 },
        };
        let sample = { ...(samples[kind] || samples.silver) };
        try {
          const snap = await fetch("/api/live-stats", { cache: "no-store" }).then((r) => r.json());
          const live = snap.welcome || snap.lastUser;
          if (live && (live.nick || live.user)) {
            sample.nick = live.nick || live.user;
            sample.user = live.user || live.nick;
            sample.avatar = live.avatar || "";
            if (Number(live.level) > 0) sample.level = Number(live.level);
            sample.superFan = !!(live.superFan || sample.superFan);
            if (Number(live.fanLevel) > 0) sample.fanLevel = Number(live.fanLevel);
          }
        } catch { /* demo still works offline */ }
        studioState.welcomeCard = { ...sample, at: Date.now(), tier: kind === "fan" ? "fan" : kind };
        persistStudio();
        const holdSec = Math.max(8, Number(studioState.welcome.durationSec) || 8);
        await patchLiveSettings({
          welcomeEnabled: studioState.welcome.enabled !== false,
          welcomeMinLevel: Number(studioState.welcome.minLevel) || 20,
          welcomeDurationSec: holdSec,
          welcomeNow: sample,
          studioJson: JSON.stringify(overlayStudioPayload()),
        });
        const frame = document.getElementById("welcomePreviewFrame");
        if (frame) {
          frame.src = `/live-overlay.html?panel=welcome&v=gal18&demo=${encodeURIComponent(kind)}&t=${Date.now()}`;
        }
        const label = sample.superFan && sample.level > 20
          ? `Superfan LV ${sample.level}`
          : sample.superFan
            ? "Superfan"
            : `LV ${sample.level}`;
        setActivity("welcomeActivity", `ทดสอบกรอบ ${label} · ${sample.nick}`);
      });
    });

    document.getElementById("pointsResetBtn")?.addEventListener("click", () => {
      if (!confirm("ล้างแต้มผู้ชมทั้งหมด?")) return;
      studioState.points.users = {};
      persistStudio();
      renderPointsTable();
    });

    document.getElementById("profileSaveBtn")?.addEventListener("click", async () => {
      const name = document.getElementById("profileName")?.value.trim() || `ไลฟ์ ${new Date().toLocaleString("th-TH")}`;
      const snap = await snapshotProfile(name);
      studioState.profiles = [snap, ...(studioState.profiles || [])].slice(0, 20);
      persistStudio();
      renderProfiles();
      document.getElementById("profileName").value = "";
    });
    document.getElementById("profileExportBtn")?.addEventListener("click", async () => {
      const name = document.getElementById("profileName")?.value.trim() || "monkeyeffect-profile";
      const snap = await snapshotProfile(name);
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[^\wก-๙-]+/g, "_")}.json`;
      a.click();
    });
    document.getElementById("profileImportFile")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const snap = JSON.parse(await file.text());
        studioState.profiles = [snap, ...(studioState.profiles || [])].slice(0, 20);
        persistStudio();
        renderProfiles();
        await applyProfile(snap);
      } catch (err) {
        alert("ไฟล์โปรไฟล์ไม่ถูกต้อง: " + (err.message || err));
      }
      e.target.value = "";
    });
    document.getElementById("profileList")?.addEventListener("click", async (e) => {
      const loadId = e.target.dataset.profileLoad;
      const delId = e.target.dataset.profileDel;
      if (loadId) {
        const p = studioState.profiles.find((x) => x.id === loadId);
        if (p && confirm(`ใช้โปรไฟล์ “${p.name}” ?`)) await applyProfile(p);
      }
      if (delId) {
        studioState.profiles = studioState.profiles.filter((x) => x.id !== delId);
        persistStudio();
        renderProfiles();
      }
    });

    document.getElementById("mcAddBtn")?.addEventListener("click", () => {
      const giftName = document.getElementById("mcGiftName")?.value.trim();
      const command = document.getElementById("mcCommand")?.value.trim();
      if (!giftName || !command) return alert("ใส่ชื่อของขวัญและคำสั่ง");
      studioState.minecraft.rules.push({ id: uid(), giftName, command, enabled: true });
      persistStudio();
      renderMcRules();
    });
    document.getElementById("mcRulesList")?.addEventListener("click", (e) => {
      const id = e.target.dataset.mcDel;
      if (!id) return;
      studioState.minecraft.rules = studioState.minecraft.rules.filter((r) => r.id !== id);
      persistStudio();
      renderMcRules();
    });
    document.getElementById("mcTestBtn")?.addEventListener("click", async () => {
      const cmd = document.getElementById("mcTestCommand")?.value.trim() || "list";
      setActivity("mcActivity", await sendMinecraftCommand(cmd));
    });

    document.getElementById("dailyTtsAddBtn")?.addEventListener("click", () => {
      const text = document.getElementById("dailyTtsText")?.value.trim();
      if (!text) return;
      studioState.dailyTts.snippets.push(text);
      persistStudio();
      renderDailySnippets();
      document.getElementById("dailyTtsText").value = "";
    });
    document.getElementById("dailyTtsList")?.addEventListener("click", (e) => {
      const i = e.target.dataset.dailyDel;
      if (i == null) return;
      studioState.dailyTts.snippets.splice(Number(i), 1);
      persistStudio();
      renderDailySnippets();
    });
    document.getElementById("dailyTtsTestBtn")?.addEventListener("click", () => maybeSpeakDailySnippet(true));

    setInterval(renderSubathonClock, 1000);
    setTimeout(() => maybeSpeakDailySnippet(false), 2500);
    setInterval(() => maybeSpeakDailySnippet(false), 60000);
    publishStudioOverlay();
    syncCommandOverlay();
  }

  paintStudioUi();
  wireStudio();
})();
