(() => {
  const params = new URLSearchParams(location.search);
  const panel = (params.get("panel") || "gifters").toLowerCase();
  const demo = (params.get("demo") || "").toLowerCase();
  const gallery = params.get("gallery") === "1";
  const chroma = params.get("chroma") === "1";
  const html = document.documentElement;
  const root = document.getElementById("root");
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  html.classList.toggle("chroma", chroma);
  html.classList.toggle("demo", !!demo || gallery);
  const CENTER = new Set(["coins", "points", "viewers", "coinmatch", "coinjar", "slider", "timer", "subathon", "fortune", "actions", "tiny", "songs", "userinfo", "social", "welcome"]);
  const FX_ONLY = new Set(["cannon", "likes", "snow", "firework", "emojify", "drop"]);
  const BOARD = new Set(["topgifters", "topliker", "ranking", "pointsboard"]);
  const INFO_LIST = new Set(["chat", "feed", "gifters", "userinfo", "commands", "myactions", "bot"]);
  const INFO_WIDE = new Set(["social", "points", "coins"]);
  if (CENTER.has(panel)) html.classList.add("center");
  if (FX_ONLY.has(panel)) html.classList.add("fx-only");
  if (BOARD.has(panel)) html.classList.add("board");
  if (INFO_LIST.has(panel)) html.classList.add("info-panel");
  if (INFO_WIDE.has(panel)) html.classList.add("info-wide");
  if (panel === "viewers") html.classList.add("stat-hero");

  const seen = new Set();
  let lastKey = "";
  let lastHtml = "";
  let spin = 0;
  let socialIdx = 0;
  let particles = [];
  let buddies = [];
  let hopUntil = 0;
  let w = 0, h = 0;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }
  function fmt(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }
  function initial(name) {
    return (String(name || "?").trim()[0] || "?").toUpperCase();
  }
  function lines(s) {
    return String(s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  }
  function cfg(data) {
    return data.config || {};
  }
  function studio(data) {
    const raw = cfg(data).studioJson;
    if (!raw) return data.studio || {};
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return data.studio || {};
    }
  }
  function av(row) {
    const nick = row.nick || row.user || "?";
    const letter = esc(initial(nick));
    const url = String(row.avatar || "").trim();
    if (!url) return `<span class="av-fallback">${letter}</span>`;
    return `<span class="av-wrap"><img class="av" alt="" referrerpolicy="no-referrer" src="${esc(url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="av-fallback" style="display:none">${letter}</span></span>`;
  }
  function medal(i) {
    const kind = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    if (kind) return `<img class="medal-art" alt="${i + 1}" src="/overlay/rank/medal-${kind}.png?v=png3" />`;
    return `<span class="place"><img class="place-art" alt="" src="/overlay/rank/rank-plate.png?v=png3" /><b>${i + 1}</b></span>`;
  }
  function boardShell(inner) {
    return `<div class="board-wrap"><img class="board-panel-art" alt="" src="/overlay/rank/board-panel.png?v=png3" /><div class="board-inner">${inner}</div></div>`;
  }
  function infoShell(kind, title, body) {
    const art = kind === "wide" ? "info-wide.png" : "info-panel.png";
    return `<div class="info-wrap info-${kind}"><img class="info-frame-art" alt="" src="/overlay/info/${art}?v=png1" /><div class="info-inner"><div class="info-head"><span class="kicker">${esc(title)}</span></div>${body}</div></div>`;
  }
  function takeN(data, rows, fallback) {
    const n = Math.max(3, Math.min(15, Number(cfg(data).lastCount) || fallback));
    return (Array.isArray(rows) ? rows : []).slice(0, n);
  }
  function infoRows(rows, htmlFn, empty) {
    if (!rows.length) return `<div class="info-empty">${esc(empty)}</div>`;
    return `<div class="info-list">${rows.map(htmlFn).join("")}</div>`;
  }
  function personRow(row, sub) {
    return `<div class="info-row">${av(row)}<div class="meta"><span class="nick">${esc(row.nick || row.user || "ผู้ชม")}</span><span class="gift">${esc(sub)}</span></div></div>`;
  }
  function rankList(rows, field) {
    const list = (Array.isArray(rows) ? rows : []).slice(0, 8);
    const titles = { coins: "TOP GIFTERS", likes: "TOP LIKER", rank: "RANKING", points: "POINTS" };
    const head = titles[field] || "LEADERBOARD";
    const title = `<div class="board-head"><img class="board-header-art" alt="" src="/overlay/rank/board-header.png?v=png3" /><span class="kicker">${esc(head)}</span></div>`;
    if (!list.length) return boardShell(`${title}<div class="board-empty">ยังไม่มีอันดับ</div>`);
    return boardShell(`${title}<div class="board-list">${list.map((row, i) => {
        let score;
        let sub;
        if (field === "likes") {
          score = row.likes;
          sub = "♥ " + fmt(row.likes);
        } else if (field === "rank") {
          score = (Number(row.coins) || 0) * 10 + (Number(row.likes) || 0);
          sub = "◆ " + fmt(row.coins);
        } else if (field === "points") {
          score = row.points;
          sub = fmt(row.points) + " แต้ม";
        } else {
          score = row.coins;
          sub = "◆ " + fmt(row.coins);
        }
        const portrait = row.avatar || row.user || row.nick
          ? av({ nick: row.nick || row.user, avatar: row.avatar })
          : `<span class="av-fallback">${esc(initial(row.nick || row.user))}</span>`;
        return `<div class="rank-row${i < 3 ? ` is-top is-top${i + 1}` : ""}"><div class="medal">${medal(i)}</div>${portrait}<div class="meta"><span class="nick">${esc(row.nick || row.user || "ผู้ชม")}</span><span class="gift">${esc(sub)}</span></div><div class="score">${fmt(score)}</div></div>`;
      }).join("")}</div>`);
  }
  function goalPct(data) {
    const goal = Math.max(1, Number(cfg(data).goal) || 1000);
    return Math.max(0, Math.min(100, Math.round((Number(data.coins) || 0) * 100 / goal)));
  }
  function remain(data) {
    const c = cfg(data);
    if (c.timerRunning && c.timerEndsAt) {
      return Math.max(0, Math.ceil((c.timerEndsAt - Date.now()) / 1000));
    }
    return Math.max(0, Number(c.timerSeconds) || 0);
  }
  function welcomeTier(card) {
    if (card.tier && !card._liveTier) return card.tier;
    const level = Number(card.level) || 0;
    if (level >= 50) return "diamond";
    if (level >= 40) return "platinum";
    if (level >= 30) return "gold";
    if (level >= 20) return "silver";
    return card.superFan ? "fan" : "silver";
  }
  const WELCOME_DEMOS = {
    fan: { nick: "ผู้ชม Superfan", level: 20, superFan: true, fanLevel: 1, tier: "fan" },
    silver: { nick: "ผู้ชม LV 20", level: 20, superFan: false, fanLevel: 0, tier: "silver" },
    gold: { nick: "ผู้ชม LV 30", level: 30, superFan: false, fanLevel: 0, tier: "gold" },
    platinum: { nick: "ผู้ชม LV 40", level: 40, superFan: true, fanLevel: 6, tier: "platinum" },
    diamond: { nick: "ผู้ชม LV 50", level: 50, superFan: true, fanLevel: 10, tier: "diamond" },
  };
  const TIER_TH = { fan: "Superfan", silver: "เงิน", gold: "ทอง", platinum: "แพลตินัม", diamond: "เพชร" };
  function liveWelcomePerson(data) {
    const wel = data?.welcome;
    const last = data?.lastUser;
    if (wel && (wel.nick || wel.user)) return wel;
    if (last && (last.nick || last.user)) return last;
    return null;
  }
  function welcomeDemoCard(data) {
    const base = WELCOME_DEMOS[demo];
    if (!base) return null;
    const live = liveWelcomePerson(data);
    if (!live) return { ...base };
    const level = Number(live.level) || Number(base.level) || 20;
    return {
      ...base,
      nick: live.nick || live.user || base.nick,
      user: live.user || live.nick || base.user,
      avatar: live.avatar || base.avatar || "",
      level,
      superFan: !!(live.superFan || live.fanLevel || base.superFan),
      fanLevel: Number(live.fanLevel) || base.fanLevel || 0,
      tier: base.tier,
    };
  }
  const GALLERY_SEED = {
    coins: 420,
    likes: 1288,
    viewers: 86,
    viewersKnown: true,
    live: true,
    gifters: [
      { nick: "สตอรี่", user: "story", gift: "Rose", count: 20, coins: 1050, likes: 420 },
      { nick: "Test User", user: "test", gift: "GG", count: 8, coins: 860, likes: 310 },
      { nick: "lekzaza", user: "lek", gift: "Rose", count: 6, coins: 640, likes: 220 },
      { nick: "Mew", user: "mew", gift: "Finger Heart", count: 4, coins: 480, likes: 180 },
      { nick: "Ploy", user: "ploy", gift: "TikTok", count: 3, coins: 320, likes: 140 },
      { nick: "Emma", user: "emma", gift: "Rose", count: 2, coins: 210, likes: 96 },
      { nick: "Nong", user: "nong", gift: "GG", count: 1, coins: 120, likes: 54 },
      { nick: "Alex", user: "alex", gift: "Rose", count: 1, coins: 80, likes: 28 },
    ],
  };
  function seedGallery(data) {
    if (!gallery) return data || {};
    const src = data || {};
    const gifters = (src.gifters && src.gifters.length) ? src.gifters : GALLERY_SEED.gifters;
    const studio = { ...(src.studio || {}) };
    if (!(studio.pointsUsers || []).length) {
      studio.pointsUsers = gifters.map((row, i) => ({ nick: row.nick, points: 140 - i * 28 }));
    }
    if (!(studio.botReplies || []).length) {
      studio.botReplies = [{ nick: "Alex", text: "!points", reply: "คุณมี 80 แต้ม" }];
    }
    return {
      ...src,
      coins: Number(src.coins) || GALLERY_SEED.coins,
      likes: Number(src.likes) || GALLERY_SEED.likes,
      viewers: src.viewersKnown ? src.viewers : GALLERY_SEED.viewers,
      viewersKnown: true,
      live: src.live || GALLERY_SEED.live,
      gifters,
      topGifters: (src.topGifters && src.topGifters.length) ? src.topGifters : gifters,
      topLikers: (src.topLikers && src.topLikers.length) ? src.topLikers : gifters,
      ranking: (src.ranking && src.ranking.length) ? src.ranking : gifters,
      chats: (src.chats && src.chats.length) ? src.chats : [
        { nick: "Alex", text: "สู้ๆ ค่ะ!" },
        { nick: "Nong", text: "ส่งกุหลาบแล้ว" },
        { nick: "Mew", text: "สวยมากกก" },
        { nick: "Ploy", text: "เอาอีกไหม" },
        { nick: "Emma", text: "ฮาๆๆ" },
        { nick: "lekzaza", text: "ของขวัญมาแล้ว" },
        { nick: "สตอรี่", text: "ไลฟ์ดีมาก" },
        { nick: "Test User", text: "Hello!" },
      ],
      lastUser: src.lastUser || gifters[0],
      events: (src.events && src.events.length) ? src.events : gifters.map((row, i) => ({ id: "gal" + i, kind: "gift", ...row })),
      studio,
      config: {
        goal: 1000,
        song: "เพลงตัวอย่าง",
        streamer: "Monkeyeffect",
        socials: "TikTok @yourname\nInstagram @yourname",
        commands: "!gift ส่งของขวัญเข้าเกม\n!song ขอเพลง\n!rank ดูอันดับ",
        ...(src.config || {}),
      },
    };
  }
  function welcomeVisible(data) {
    const shown = welcomeDemoCard(data);
    if (shown) return shown;
    const c = cfg(data);
    const st = studio(data).welcome || {};
    if (c.welcomeEnabled === false || st.enabled === false) return null;
    const fromLive = data.welcome;
    const fromStudio = studio(data).welcomeCard;
    const card = (!fromLive && !fromStudio)
      ? null
      : (!fromLive || (fromStudio && Number(fromStudio.at || 0) >= Number(fromLive.at || 0)))
        ? fromStudio
        : fromLive;
    if (!card || !(card.nick || card.user)) return null;
    const dur = Math.max(2, Number(c.welcomeDurationSec || st.durationSec) || 8) * 1000;
    if (Number(card.at || 0) > 0 && Date.now() - Number(card.at) > dur) return null;
    return card;
  }
  function clock(sec) {
    const s = Math.max(0, sec | 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }

  function render(data) {
    const c = cfg(data);
    const giftRows = data.gifters || [];
    const last = data.lastUser || giftRows[0] || null;
    switch (panel) {
      case "coins":
        return infoShell("wide", "เพชรไลฟ์นี้", `<div class="info-hero"><img class="info-gem" alt="" src="/overlay/info/info-gem.png?v=png1" /><div class="hero">${fmt(data.coins)}</div></div><div class="sub">สะสมจากของขวัญจริง</div>`);
      case "points": {
        const flash = last && last.kind === "gift" ? `+${fmt(last.coins || last.count || 1)}` : "";
        return infoShell("wide", "POINTS", `<div class="info-hero"><img class="info-gem" alt="" src="/overlay/info/info-gem.png?v=png1" /><div class="hero">${fmt(data.coins)}</div></div><div class="sub">${flash || "สะสมจากของขวัญจริง"}</div>`);
      }
      case "viewers":
        return `<div class="stat-wrap"><img class="stat-frame-art" alt="" src="/overlay/rank/viewers-frame.png?v=png3" /><div class="stat-inner"><span class="kicker">VIEWERS</span><div class="hero">${data.viewersKnown ? fmt(data.viewers) : "—"}</div><div class="sub">${data.live ? "LIVE ตอนนี้" : "รอเชื่อมต่อไลฟ์"}</div></div></div>`;
      case "gifters": {
        const rows = takeN(data, giftRows, 8);
        if (!rows.length && !gallery) return "";
        return infoShell("list", "LAST GIFTERS", infoRows(rows, (row) => personRow(row, `${row.gift || "Gift"} ×${Number(row.count) || 1}`), "ยังไม่มีคนส่งของขวัญ"));
      }
      case "feed": {
        const rows = takeN(data, giftRows, 6);
        if (!rows.length && !gallery) return "";
        return infoShell("list", "GIFT FEED", infoRows(rows, (row) => personRow(row, `${row.gift || "Gift"} ×${row.count || 1} · ◆${fmt(row.coins)}`), "ยังไม่มีของขวัญ"));
      }
      case "topgifters":
        return rankList(data.topGifters, "coins");
      case "topliker":
        return rankList(data.topLikers, "likes");
      case "ranking":
        return rankList(data.ranking, "rank");
      case "chat": {
        const rows = takeN(data, data.chats, 8);
        if (!rows.length && !gallery) return "";
        return infoShell("list", "CHAT", infoRows(rows, (row) => personRow(row, row.text || ""), "ยังไม่มีแชท"));
      }
      case "welcome": {
        const card = welcomeVisible(data);
        if (!card) return "";
        const tier = welcomeTier(card);
        const level = Number(card.level) || 0;
        const fanLv = Number(card.fanLevel) || 0;
        const tierName = TIER_TH[tier] || "ต้อนรับ";
        const kicker = card.superFan
          ? `Superfan${fanLv > 0 ? " · คลับ " + fanLv : ""}`
          : "เข้าไลฟ์";
        return `<div class="welcome welcome-${esc(tier)}">
          <div class="welcome-glow"></div>
          <div class="welcome-card">
            <div class="welcome-kicker">${esc(kicker)}</div>
            <div class="welcome-portrait">
              <div class="welcome-av">${av({ nick: card.nick || card.user, avatar: card.avatar })}</div>
              <img class="welcome-frame-art" alt="" src="/welcome/frames/${esc(tier)}.png" />
            </div>
            <div class="welcome-name">${esc(card.nick || card.user || "ผู้ชม")}</div>
            <div class="welcome-level">${level > 0 ? `<span>LV</span><b>${level}</b>` : `<b>${esc(tierName)}</b>`}</div>
            <div class="welcome-sub">${esc(tierName)}</div>
          </div>
        </div>`;
      }
      case "userinfo":
        if (!last && !gallery) return "";
        if (!last) return infoShell("list", "USER INFO", `<div class="info-empty">รอผู้ชมคนแรก</div>`);
        return infoShell("list", "USER INFO", `<div class="info-user">${av(last)}<div class="hero info-user-name">${esc(last.nick || last.user)}</div><div class="sub">${esc(last.kind === "like" ? "เพิ่งกดไลค์" : last.kind === "follow" ? "เพิ่งฟอลโลว์" : last.gift ? last.gift + " ×" + (last.count || 1) : last.text || "ผู้ชม")}</div><div class="sub">◆ ${fmt(last.coins)} · ♥ ${fmt(last.likes)}</div></div>`);
      case "commands": {
        const cmds = lines(c.commands);
        return infoShell("list", "COMMANDS", cmds.length ? `<div class="info-list">${cmds.map((x) => `<div class="cmd">${esc(x)}</div>`).join("")}</div>` : `<div class="info-empty">ตั้งคำสั่งใน Overlay Gallery</div>`);
      }
      case "myactions": {
        const rows = (data.events || []).slice(0, 6);
        if (!rows.length && !gallery) return "";
        return infoShell("list", "MY ACTIONS", infoRows(rows, (e) => `<div class="info-row"><div class="meta"><span class="nick">${esc(e.nick || "ผู้ชม")}</span><span class="gift">${esc(e.kind)} ${esc(e.gift || e.text || "")}</span></div></div>`, "รออีเวนต์จากไลฟ์"));
      }
      case "social": {
        const items = lines(c.socials);
        const item = items[socialIdx % Math.max(1, items.length)] || "เพิ่มโซเชียลใน Overlay Gallery";
        return infoShell("wide", "SOCIAL", `<div class="social">${esc(item)}</div>`);
      }
      case "songs":
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>NOW PLAYING</span><div class="hero" style="font-size:clamp(28px,6vw,56px)">${esc(c.song || "ยังไม่มีเพลง")}</div><div class="sub">Song Requests</div></div>`;
      case "timer":
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>TIMER</span><div class="hero">${clock(remain(data))}</div><div class="sub">${c.timerRunning ? "กำลังนับ" : "พร้อมเริ่ม"}</div></div>`;
      case "subathon": {
        const st = studio(data).subathon || {};
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>SUBATHON</span><div class="hero">${clock(remain(data))}</div><div class="sub">${c.timerRunning ? (st.enabled !== false ? "ยืดเวลาเมื่อมีของขวัญ" : "กำลังนับ") : "พร้อมเริ่ม"}</div></div>`;
      }
      case "pointsboard": {
        const rows = studio(data).pointsUsers || [];
        return rankList(rows, "points");
      }
      case "bot": {
        const rows = (studio(data).botReplies || []).slice(0, 6);
        if (!rows.length && !gallery) return "";
        return infoShell("list", "CHATBOT", infoRows(rows, (row) => `<div class="info-row"><div class="meta"><span class="nick">${esc(row.nick)}</span><span class="gift">${esc(row.text)} → ${esc(row.reply)}</span></div></div>`, "รอคำตอบจากบอท"));
      }
      case "slider":
      case "coinmatch": {
        const pct = goalPct(data);
        const matched = pct >= 100;
        return `<div class="card"><span class="kicker"><i></i>${panel === "slider" ? "INTERACTION" : "COIN MATCH"}</span><div class="hero" style="font-size:56px">${fmt(data.coins)}<span class="sub"> / ${fmt(c.goal || 1000)}</span></div><div class="bar"><span style="width:${pct}%"></span></div><div class="sub">${matched ? "MATCHED ✨" : pct + "%"}</div></div>`;
      }
      case "coinjar": {
        const pct = Math.max(8, goalPct(data));
        return `<div class="jar"><div class="jar-lid"></div><div class="jar-glass"><div class="jar-fill" style="height:${pct}%"></div></div></div>`;
      }
      case "fortune":
      case "actions":
        return `<div style="position:relative"><div class="pointer"></div><div class="wheel" style="transform:rotate(${spin}deg)"><b>${esc((last && last.gift) || (panel === "actions" ? "ACTIONS" : "SPIN"))}</b></div></div>`;
      case "tiny":
        return `<div class="tiny"><div class="dino${Date.now() < hopUntil ? " hop" : ""}">🐵</div><div class="sub stroke">${esc((last && last.nick) || c.streamer || "Monkeyeffect")}</div></div>`;
      case "buddies":
        return "";
      default:
        return "";
    }
  }

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function burst(kind, ev) {
    const x = w * (0.2 + Math.random() * 0.6);
    const y = h * (0.18 + Math.random() * 0.5);
    if (kind === "like" && panel === "likes") {
      for (let i = 0; i < Math.min(18, 8 + (ev.count || 1)); i++) {
        particles.push({ t: "heart", x, y, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 4, a: 1, s: 22 + Math.random() * 22, life: 220 });
      }
    }
    if (kind === "gift" && (panel === "firework" || panel === "cannon" || panel === "drop" || panel === "points")) {
      const n = panel === "firework" ? 42 : 22;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = panel === "cannon" ? 8 + Math.random() * 10 : 2 + Math.random() * 6;
        particles.push({
          t: panel === "drop" ? "coin" : "spark",
          x: panel === "cannon" ? -20 : x,
          y: panel === "cannon" ? h * 0.55 : y,
          vx: panel === "cannon" ? 10 + Math.random() * 8 : Math.cos(ang) * sp,
          vy: panel === "cannon" ? (Math.random() - 0.5) * 6 : Math.sin(ang) * sp,
          a: 1,
          s: 6 + Math.random() * 10,
          life: 80,
          c: panel === "drop" ? "#f5d76e" : ["#fb7185", "#f5d76e", "#fff", "#38bdf8"][i % 4]
        });
      }
    }
    if (panel === "emojify") {
      let emo = "";
      if (kind === "chat") emo = /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(String(ev.text || "")) ? (String(ev.text).match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/) || ["💬"])[0] : "💬";
      else if (kind === "gift") emo = "🎁";
      else if (kind === "like") emo = "❤";
      if (emo) particles.push({ t: "emo", x, y, vx: (Math.random() - 0.5) * 2, vy: -1.4, a: 1, s: 28, life: 100, e: emo });
    }
    if (kind === "gift") {
      hopUntil = Date.now() + 480;
      spin += 360 * (3 + Math.random() * 3) + Math.floor(Math.random() * 8) * 45;
      if (panel === "buddies" && ev.nick) {
        buddies.unshift({ ...ev, bx: 40 + Math.random() * (w - 80), by: 40 + Math.random() * (h - 80) });
        buddies = buddies.slice(0, 8);
      }
    }
  }

  function tickFx() {
    if (panel === "snow" && particles.filter((p) => p.t === "snow").length < 70) {
      particles.push({ t: "snow", x: Math.random() * w, y: -10, vx: (Math.random() - 0.5) * 0.6, vy: 0.7 + Math.random() * 1.4, a: 0.9, s: 2 + Math.random() * 4, life: 500 });
    }
    ctx.clearRect(0, 0, w, h);
    particles = particles.filter((p) => p.life-- > 0 && p.a > 0.04);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.t === "heart" || p.t === "emo") p.vy -= 0.02;
      if (p.t === "spark") p.vy += 0.08;
      if (p.t === "coin" || p.t === "snow") p.vy += 0.05;
      p.a *= 0.985;
      ctx.globalAlpha = Math.max(0, p.a);
      if (p.t === "heart") {
        ctx.fillStyle = "#ff2d6a";
        ctx.font = p.s + "px sans-serif";
        ctx.fillText("❤", p.x, p.y);
      } else if (p.t === "emo") {
        ctx.font = p.s + "px sans-serif";
        ctx.fillText(p.e || "✨", p.x, p.y);
      } else {
        ctx.fillStyle = p.c || "#fff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (panel === "buddies") {
      root.innerHTML = buddies.map((b, i) => {
        const url = String(b.avatar || "").trim();
        const letter = esc(initial(b.nick || b.user));
        const pos = `left:${b.bx | 0}px;top:${b.by | 0}px;animation-delay:${i * 0.2}s`;
        if (url) {
          return `<span class="buddy av-wrap" style="${pos}"><img class="av" alt="" referrerpolicy="no-referrer" src="${esc(url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="av-fallback" style="display:none">${letter}</span></span>`;
        }
        return `<span class="buddy av-fallback" style="${pos}">${letter}</span>`;
      }).join("");
    }
    requestAnimationFrame(tickFx);
  }
  tickFx();
  setInterval(() => { socialIdx++; lastKey = ""; }, 4200);

  let primed = false;
  async function poll() {
    try {
      const res = await fetch("/api/live-stats?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) {
        if ((panel === "welcome" && WELCOME_DEMOS[demo] && !root.innerHTML) || (gallery && !root.innerHTML)) {
          root.innerHTML = render(seedGallery({}));
        }
        return;
      }
      const data = seedGallery(await res.json());
      const evs = data.events || [];
      if (!primed) {
        for (const ev of evs) if (ev.id) seen.add(ev.id);
        primed = true;
      } else {
        for (const ev of evs) {
          const id = ev.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          burst(ev.kind, ev);
        }
      }
      if (seen.size > 240) {
        const keep = [...seen].slice(-80);
        seen.clear();
        keep.forEach((x) => seen.add(x));
      }
      if (panel === "fortune" || panel === "actions") {
        const last = data.lastUser || (data.gifters || [])[0] || null;
        if (!root.querySelector(".wheel")) root.innerHTML = render(data);
        const wheel = root.querySelector(".wheel");
        if (wheel) wheel.style.transform = `rotate(${spin}deg)`;
        const label = root.querySelector(".wheel b");
        if (label) label.textContent = (last && last.gift) || (panel === "actions" ? "ACTIONS" : "SPIN");
        return;
      }
      if (panel === "tiny") {
        if (!root.querySelector(".dino")) root.innerHTML = render(data);
        const dino = root.querySelector(".dino");
        if (dino) dino.classList.toggle("hop", Date.now() < hopUntil);
        const sub = root.querySelector(".tiny .sub");
        const last = data.lastUser || (data.gifters || [])[0] || null;
        if (sub) sub.textContent = (last && last.nick) || cfg(data).streamer || "Monkeyeffect";
        return;
      }
      if (FX_ONLY.has(panel) && panel !== "drop") {
        if (panel === "snow" && !root.innerHTML) root.innerHTML = "";
        return;
      }
      const htmlOut = render(data);
      const wel = welcomeVisible(data);
      const key = data.rev + ":" + spin + ":" + socialIdx + ":" + remain(data) + ":" + (Date.now() < hopUntil ? "1" : "0") + ":" + (wel ? wel.at : "0");
      if (key === lastKey && htmlOut === lastHtml) return;
      lastKey = key;
      lastHtml = htmlOut;
      if (panel !== "buddies") root.innerHTML = htmlOut;
    } catch {
      /* OBS keeps last frame */
    }
  }
  if (panel === "welcome" && WELCOME_DEMOS[demo]) {
    lastHtml = render({});
    root.innerHTML = lastHtml;
  } else if (gallery) {
    lastHtml = render(seedGallery({}));
    root.innerHTML = lastHtml;
    if (panel === "likes") burst("like", { count: 10 });
    if (panel === "firework" || panel === "cannon" || panel === "drop") burst("gift", { nick: "Emma", gift: "Rose", count: 5 });
    if (panel === "emojify") burst("chat", { text: "🔥" });
  }
  poll();
  setInterval(poll, 400);
  window.__overlayDebug = () => ({ panel, primed, seen: seen.size, particles: particles.length, types: particles.map((p) => p.t).slice(0, 12) });
  window.__poll = poll;
})();
