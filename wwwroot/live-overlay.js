(() => {
  const params = new URLSearchParams(location.search);
  const panel = (params.get("panel") || "gifters").toLowerCase();
  const chroma = params.get("chroma") === "1";
  const html = document.documentElement;
  const root = document.getElementById("root");
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  html.classList.toggle("chroma", chroma);
  const CENTER = new Set(["coins", "points", "viewers", "coinmatch", "coinjar", "slider", "timer", "fortune", "actions", "tiny", "songs", "userinfo", "social"]);
  const FX_ONLY = new Set(["cannon", "likes", "snow", "firework", "emojify", "drop"]);
  if (CENTER.has(panel)) html.classList.add("center");
  if (FX_ONLY.has(panel)) html.classList.add("fx-only");

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
  function av(row) {
    const nick = row.nick || row.user || "?";
    const letter = esc(initial(nick));
    const url = String(row.avatar || "").trim();
    if (!url) return `<span class="av-fallback">${letter}</span>`;
    return `<span class="av-wrap"><img class="av" alt="" referrerpolicy="no-referrer" src="${esc(url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="av-fallback" style="display:none">${letter}</span></span>`;
  }
  function medal(i) {
    return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `<span class="score">${i + 1}</span>`;
  }
  function rankList(rows, field) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return `<div class="card"><span class="kicker"><i></i>รอผู้เล่น</span><div class="sub">ยังไม่มีอันดับ</div></div>`;
    return `<div class="card rank">${list.map((row, i) => {
      const score = field === "likes" ? row.likes : field === "rank" ? (Number(row.coins) || 0) * 10 + (Number(row.likes) || 0) : row.coins;
      return `<div class="rank-row"><div class="medal">${medal(i)}</div>${av(row)}<div class="meta"><span class="nick">${esc(row.nick || row.user || "ผู้ชม")}</span><span class="gift">${field === "likes" ? "♥ " + fmt(row.likes) : "◆ " + fmt(row.coins)}</span></div><div class="score">${fmt(score)}</div></div>`;
    }).join("")}</div>`;
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
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>เพชรไลฟ์นี้</span><div class="hero">${fmt(data.coins)}</div><div class="sub">สะสมจากของขวัญจริง</div></div>`;
      case "points": {
        const flash = last && last.kind === "gift" ? `+${fmt(last.coins || last.count || 1)}` : "";
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>POINTS</span><div class="hero">${fmt(data.coins)}</div><div class="sub">${flash || "สะสมจากของขวัญจริง"}</div></div>`;
      }
      case "viewers":
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>คนดูตอนนี้</span><div class="hero">${data.viewersKnown ? fmt(data.viewers) : "—"}</div><div class="sub">${data.live ? "LIVE" : "รอเชื่อมต่อไลฟ์"}</div></div>`;
      case "gifters":
        if (!giftRows.length) return "";
        return `<div>${giftRows.map((row) => `<div class="row feed-item">${av(row)}<div class="meta"><span class="nick">${esc(row.nick || row.user || "ผู้ชม")}</span><span class="gift">${esc(row.gift || "Gift")} ×${Number(row.count) || 1}</span></div></div>`).join("")}</div>`;
      case "feed":
        if (!giftRows.length) return "";
        return `<div>${giftRows.slice(0, 6).map((row) => `<div class="card feed-item row" style="min-width:0;margin:8px 0">${av(row)}<div class="meta"><span class="nick">${esc(row.nick || "ผู้ชม")}</span><span class="gift">${esc(row.gift)} ×${row.count || 1} · ◆${fmt(row.coins)}</span></div></div>`).join("")}</div>`;
      case "topgifters":
        return rankList(data.topGifters, "coins");
      case "topliker":
        return rankList(data.topLikers, "likes");
      case "ranking":
        return rankList(data.ranking, "rank");
      case "chat":
        if (!(data.chats || []).length) return "";
        return `<div>${(data.chats || []).slice(0, 8).map((row) => `<div class="chat-line row feed-item">${av(row)}<div class="meta"><span class="nick">${esc(row.nick || "ผู้ชม")}</span><span class="gift">${esc(row.text)}</span></div></div>`).join("")}</div>`;
      case "userinfo":
        if (!last) return `<div class="card"><span class="kicker"><i></i>USER INFO</span><div class="sub">รอผู้ชมคนแรก</div></div>`;
        return `<div class="card" style="text-align:center">${av(last)}<div class="hero" style="font-size:42px;margin-top:10px">${esc(last.nick || last.user)}</div><div class="sub">${esc(last.kind === "like" ? "เพิ่งกดไลค์" : last.kind === "follow" ? "เพิ่งฟอลโลว์" : last.gift ? last.gift + " ×" + (last.count || 1) : last.text || "ผู้ชม")}</div><div class="sub">◆ ${fmt(last.coins)} · ♥ ${fmt(last.likes)}</div></div>`;
      case "commands":
        return `<div class="card"><span class="kicker"><i></i>COMMANDS</span>${lines(c.commands).map((x) => `<div class="cmd">${esc(x)}</div>`).join("") || `<div class="sub">ตั้งคำสั่งใน Overlay Gallery</div>`}</div>`;
      case "myactions":
        return `<div class="card"><span class="kicker"><i></i>MY ACTIONS</span>${(data.events || []).slice(0, 6).map((e) => `<div class="row"><div class="meta"><span class="nick">${esc(e.nick)}</span><span class="gift">${esc(e.kind)} ${esc(e.gift || e.text || "")}</span></div></div>`).join("") || `<div class="sub">รออีเวนต์จากไลฟ์</div>`}</div>`;
      case "social": {
        const items = lines(c.socials);
        const item = items[socialIdx % Math.max(1, items.length)] || "เพิ่มโซเชียลใน Overlay Gallery";
        return `<div class="social">${esc(item)}</div>`;
      }
      case "songs":
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>NOW PLAYING</span><div class="hero" style="font-size:clamp(28px,6vw,56px)">${esc(c.song || "ยังไม่มีเพลง")}</div><div class="sub">Song Requests</div></div>`;
      case "timer":
        return `<div class="card" style="text-align:center"><span class="kicker"><i></i>TIMER</span><div class="hero">${clock(remain(data))}</div><div class="sub">${c.timerRunning ? "กำลังนับ" : "พร้อมเริ่ม"}</div></div>`;
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
      if (!res.ok) return;
      const data = await res.json();
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
      const key = data.rev + ":" + spin + ":" + socialIdx + ":" + remain(data) + ":" + (Date.now() < hopUntil ? "1" : "0");
      if (key === lastKey && htmlOut === lastHtml) return;
      lastKey = key;
      lastHtml = htmlOut;
      if (panel !== "buddies") root.innerHTML = htmlOut;
    } catch {
      /* OBS keeps last frame */
    }
  }
  poll();
  setInterval(poll, 400);
  window.__overlayDebug = () => ({ panel, primed, seen: seen.size, particles: particles.length, types: particles.map((p) => p.t).slice(0, 12) });
  window.__poll = poll;
})();
