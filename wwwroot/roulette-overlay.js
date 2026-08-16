(() => {
  const CHANNEL = "tgr-roulette-overlay";
  const STORAGE_KEY = "tgr_roulette_overlay_cmd";
  const STATUS_KEY = "tgr_roulette_overlay_status";

  const root = document.getElementById("root");
  const labelEl = document.getElementById("label");
  const strip = document.getElementById("strip");
  const windowEl = document.getElementById("window");
  const resultEl = document.getElementById("result");
  const sparksEl = document.getElementById("sparks");
  const badgeEl = document.getElementById("badge");
  const badgeSubEl = document.getElementById("badgeSub");
  const comboChipEl = document.getElementById("comboChip");
  const comboBannerEl = document.getElementById("comboBanner");
  const comboBannerNEl = document.getElementById("comboBannerN");
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

  let busy = false;
  let spinToken = "";
  let lastHandledSpinToken = "";
  /** @type {any[]} FIFO — keep several spins if poll drains a burst while busy. */
  const spinQueue = [];
  const SPIN_QUEUE_MAX = 8;
  let audioCtx = null;
  let stopTicks = null;

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function waitMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function beep({ freq = 880, dur = 0.04, type = "square", gain = 0.07, when = 0 }) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(Math.max(0.0001, gain), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.01);
  }

  function playTick(progress) {
    const p = Math.max(0, Math.min(1, progress));
    beep({
      freq: 760 + p * 260,
      dur: 0.028,
      type: "square",
      gain: 0.055 + (1 - p) * 0.03,
    });
  }

  function playWinChime() {
    beep({ freq: 523.25, dur: 0.09, type: "triangle", gain: 0.09, when: 0 });
    beep({ freq: 659.25, dur: 0.11, type: "triangle", gain: 0.08, when: 0.08 });
    beep({ freq: 783.99, dur: 0.18, type: "triangle", gain: 0.07, when: 0.16 });
  }

  function playMultWinChime(mult) {
    const n = Number(mult) || 1;
    beep({ freq: 392, dur: 0.08, type: "sawtooth", gain: 0.05, when: 0 });
    beep({ freq: 523.25, dur: 0.1, type: "triangle", gain: 0.08, when: 0.06 });
    beep({ freq: 659.25, dur: 0.12, type: "triangle", gain: 0.09, when: 0.14 });
    beep({ freq: 880, dur: 0.16, type: "triangle", gain: 0.08, when: 0.24 });
    if (n >= 4) {
      beep({ freq: 1174.66, dur: 0.22, type: "triangle", gain: 0.07, when: 0.34 });
    }
    if (n >= 5) {
      beep({ freq: 1567.98, dur: 0.28, type: "sine", gain: 0.06, when: 0.44 });
    }
  }

  function parseMult(o) {
    const raw = String(o?.giftName || o?.label || "");
    const m = raw.match(/x\s*([1-5])/i) || raw.match(/×\s*([1-5])/);
    return m ? Number(m[1]) : 0;
  }

  function renderItem(o) {
    const label = escapeHtml(o.label || o.giftName || "?");
    const mult = parseMult(o);
    if (mult >= 1) {
      return `<div class="roulette-item" data-mult="${mult}">
      <div class="mult-orb" aria-hidden="true"><span class="mult-orb-n">×${mult}</span></div>
      <div class="roulette-item-caption">${label}</div>
    </div>`;
    }
    const primary = o.imageUrl || "";
    const fallback = o.imageFallback || "";
    const imgHtml = primary || fallback
      ? `<img src="${escapeHtml(primary || fallback)}" alt="${label}" ${
          fallback ? `data-fallback="${escapeHtml(fallback)}"` : ""
        } onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback}else{this.style.display='none'}" />`
      : `<div class="roulette-item-fallback">${escapeHtml((o.label || o.giftName || "?").slice(0, 2))}</div>`;
    return `<div class="roulette-item">
      <div class="roulette-item-frame">
        <div class="roulette-item-frame-inner">${imgHtml}</div>
      </div>
      <div class="roulette-item-caption">${label}</div>
    </div>`;
  }

  function startSpinTicks(durationMs) {
    let cancelled = false;
    const start = performance.now();
    const loop = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const t = elapsed / durationMs;
      if (t >= 1) return;
      playTick(t);
      // ticks slow down as the strip eases out
      const next = 32 + Math.pow(t, 1.55) * 210;
      setTimeout(loop, next);
    };
    loop();
    return () => {
      cancelled = true;
    };
  }

  function postStatus(payload) {
    const msg = { ...payload, at: Date.now() };
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(msg));
    } catch {
      /* ignore */
    }
    channel?.postMessage(msg);
    // Server bus — backend spin waits on this when main UI is minimized.
    fetch("/api/roulette-overlay/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }

  function setComboChip(n, visible) {
    const show = !!visible && Number(n) >= 2;
    const text = `×${Math.max(1, Number(n) || 1)}`;
    if (comboChipEl) {
      comboChipEl.hidden = true;
      comboChipEl.classList.remove("is-on");
    }
    if (comboBannerNEl) comboBannerNEl.textContent = text;
    if (comboBannerEl) comboBannerEl.hidden = !show;
    root?.classList.toggle("combo-reveal", show);
  }

  function pickItemWidth() {
    const w = windowEl?.clientWidth || window.innerWidth || 640;
    return Math.max(100, Math.min(148, Math.round(w / 4.4)));
  }

  function burstSparks(count = 14) {
    if (!sparksEl) return;
    sparksEl.innerHTML = "";
    const n = count;
    for (let i = 0; i < n; i++) {
      const sp = document.createElement("span");
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.35;
      const dist = 36 + Math.random() * 48;
      sp.style.left = "50%";
      sp.style.top = "48%";
      sp.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
      sp.style.setProperty("--dy", `${Math.sin(ang) * dist}px`);
      sp.style.animationDelay = `${Math.random() * 0.12}s`;
      sparksEl.appendChild(sp);
    }
  }

  function enqueueSpin(msg) {
    if (!msg || msg.type !== "roulette-spin") return;
    const token = String(msg.token || "");
    if (token && token === lastHandledSpinToken) return;
    if (token && spinQueue.some((q) => String(q.token || "") === token)) return;
    if (token && token === spinToken && busy) return;
    spinQueue.push(msg);
    while (spinQueue.length > SPIN_QUEUE_MAX) spinQueue.shift();
    kickSpinQueue();
  }

  function kickSpinQueue() {
    if (busy) return;
    const next = spinQueue.shift();
    if (!next) return;
    runSpin(next).catch((err) => {
      console.warn(err);
      if (typeof stopTicks === "function") stopTicks();
      stopTicks = null;
      busy = false;
      postStatus({
        type: "roulette-done",
        token: String(next.token || ""),
        error: String(err?.message || err),
      });
      postStatus({ type: "roulette-overlay-status", state: "ready", token: String(next.token || "") });
      kickSpinQueue();
    });
  }

  async function runSpin(msg) {
    const incomingToken = String(msg.token || "");
    if (!strip || !root) return;
    // Dedupe: same token must not run twice (channel + storage race).
    if (incomingToken && incomingToken === lastHandledSpinToken) {
      kickSpinQueue();
      return;
    }
    if (busy) {
      enqueueSpin(msg);
      return;
    }
    busy = true;
    lastHandledSpinToken = incomingToken || lastHandledSpinToken;
    spinToken = incomingToken;
    const items = Array.isArray(msg.items) ? msg.items : [];
    const targetIndex = Number(msg.targetIndex) || 0;
    const durationMs = Number(msg.durationMs) > 0 ? Number(msg.durationMs) : 3400;
    const winner = msg.winner || {};
    const phase = msg.phase || "gift";
    const isMult = phase === "mult";
    const isLucky = !!(msg.luckyMode || isMult || msg.hasMultiplierSpin);
    const itemW = pickItemWidth();

    document.documentElement.style.setProperty("--item-w", `${itemW}px`);
    const frame = Math.round(itemW * (isMult ? 0.74 : 0.68));
    document.documentElement.style.setProperty("--frame-size", `${frame}px`);

    root.classList.toggle("theme-fate", isLucky);
    root.classList.toggle("phase-mult", isMult);
    root.classList.toggle("phase-gift", !isMult);
    if (badgeEl) badgeEl.textContent = isLucky ? "Lucky Monkey" : "TREASURE VAULT";
    if (badgeSubEl) {
      badgeSubEl.textContent = isMult ? "สุ่มตัวคูณ" : isLucky ? "โหมดนำโชค" : "สุ่มของขวัญ";
    }
    setComboChip(0, false);

    if (labelEl) {
      if (isMult) {
        labelEl.textContent = `${msg.giftLabel || msg.giftName || "ผลสุ่ม"} · กำลังชั่งโชค`;
      } else {
        labelEl.textContent = `${msg.triggerGift || "ของขวัญ"} · จาก ${msg.sender || "ผู้ชม"}`;
      }
    }
    if (resultEl) {
      resultEl.textContent = isMult
        ? "วงล้อนำโชคกำลังหมุน…"
        : isLucky
          ? "กำลังสุ่มของขวัญนำโชค…"
          : "กำลังเปิดหีบสมบัติ…";
    }
    root.classList.remove("win");
    root.classList.remove("combo-reveal");
    root.classList.add("spinning");
    if (sparksEl) sparksEl.innerHTML = "";

    strip.style.transition = "none";
    strip.style.transform = "translateX(0px)";
    strip.innerHTML = items.map(renderItem).join("");
    root.classList.add("show");
    postStatus({ type: "roulette-overlay-status", state: "spinning", token: spinToken });

    ensureAudio();
    if (typeof stopTicks === "function") stopTicks();
    stopTicks = startSpinTicks(durationMs);

    await waitMs(60);
    const windowW = windowEl ? windowEl.clientWidth : 480;
    const centerOffset = windowW / 2 - itemW / 2;
    const targetX = -(targetIndex * itemW) + centerOffset;
    strip.style.transition = `transform ${durationMs / 1000}s cubic-bezier(0.12, 0.78, 0.1, 1)`;
    strip.style.transform = `translateX(${targetX}px)`;

    await waitMs(durationMs + 80);
    if (typeof stopTicks === "function") stopTicks();
    stopTicks = null;
    root.classList.remove("spinning");
    root.classList.add("win");
    const combo = Number(msg.count) || 1;
    const sendCount = Number(msg.sendCount) > 0 ? Number(msg.sendCount) : combo;
    const showCombo = (!isMult && combo >= 2) || (isMult && sendCount >= 2);
    burstSparks(showCombo ? 26 : 14);
    if (isMult) playMultWinChime(parseMult(winner));
    else if (showCombo) playMultWinChime(Math.min(5, combo));
    else if (isLucky) playMultWinChime(1);
    else playWinChime();
    if (!isMult) {
      setComboChip(combo, combo >= 2);
    } else {
      setComboChip(sendCount, sendCount >= 2);
    }
    if (resultEl) {
      const winLabel = winner.label || winner.giftName || "?";
      if (isMult) {
        const gift = msg.giftLabel || msg.giftName || "?";
        resultEl.textContent = sendCount >= 2
          ? `โชค ${winLabel} → ส่งเกม ${gift} ×${sendCount}`
          : `โชค ${winLabel} → ส่งเกม ${gift}`;
      } else if (msg.hasMultiplierSpin) {
        resultEl.textContent = combo >= 2
          ? `ได้ ${winLabel} ×${combo} · ต่อไปสุ่มตัวคูณ`
          : `ได้ ${winLabel} · ต่อไปสุ่มตัวคูณ`;
      } else if (sendCount >= 2) {
        resultEl.textContent = `ได้ ${winLabel} → ส่งเกม ${winner.giftName || "?"} ×${sendCount}`;
      } else {
        resultEl.textContent = `ได้ ${winLabel}`;
      }
    }
    postStatus({ type: "roulette-done", token: spinToken, winner });
    const hold = Number(msg.holdMs) > 0 ? Number(msg.holdMs) : 1000;
    await waitMs(hold + (showCombo ? 900 : 0));
    if (!msg.hasMultiplierSpin) {
      root.classList.remove("show");
      root.classList.remove("phase-mult");
      root.classList.remove("phase-gift");
      root.classList.remove("theme-fate");
      root.classList.remove("combo-reveal");
      setComboChip(0, false);
    }
    root.classList.remove("win");
    busy = false;
    postStatus({ type: "roulette-overlay-status", state: "ready", token: spinToken });
    kickSpinQueue();
  }

  function handleMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.type === "roulette-spin") {
      enqueueSpin(data);
    } else if (data.type === "roulette-hide") {
      root?.classList.remove("show");
    } else if (data.type === "ping") {
      postStatus({ type: "roulette-overlay-status", state: busy ? "spinning" : "ready", token: spinToken });
    }
  }

  // Unlock audio on first interaction with the overlay window.
  ["pointerdown", "keydown"].forEach((ev) => {
    window.addEventListener(
      ev,
      () => {
        ensureAudio();
      },
      { once: true, capture: true }
    );
  });

  channel?.addEventListener("message", (ev) => handleMessage(ev.data));
  window.addEventListener("storage", (ev) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      handleMessage(JSON.parse(ev.newValue));
    } catch {
      /* ignore */
    }
  });

  let pollInFlight = false;
  async function pollServerCommands() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const res = await fetch(`/api/roulette-overlay/poll?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      const cmds = data.commands || [];
      for (const raw of cmds) {
        try {
          const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
          handleMessage(msg);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    } finally {
      pollInFlight = false;
    }
  }

  postStatus({ type: "roulette-overlay-status", state: "ready" });
  setInterval(pollServerCommands, 50);
  pollServerCommands();

  // If main already wrote a spin (race before this listener existed), pick it up.
  try {
    const pending = localStorage.getItem(STORAGE_KEY);
    if (pending) {
      const msg = JSON.parse(pending);
      if (msg && msg.type === "roulette-spin" && Date.now() - (Number(msg.at) || 0) < 8000) {
        handleMessage(msg);
      }
    }
  } catch {
    /* ignore */
  }
})();
