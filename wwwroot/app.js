const usernameInput = document.getElementById("username");
const gamePortInput = document.getElementById("gamePort");
const gameSelect = document.getElementById("gameSelect");
const customGameFields = document.getElementById("customGameFields");
const customGameProcess = document.getElementById("customGameProcess");
const customGameTitle = document.getElementById("customGameTitle");
const scanGamesBtn = document.getElementById("scanGamesBtn");
const scanGamesPanel = document.getElementById("scanGamesPanel");
const scannedWindowSelect = document.getElementById("scannedWindowSelect");
const useScannedGameBtn = document.getElementById("useScannedGameBtn");
const selectedGameLabel = document.getElementById("selectedGameLabel");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const loginChromeBtn = document.getElementById("loginChromeBtn");
const testBtn = document.getElementById("testBtn");
const testGiftInput = document.getElementById("testGift");
const testCountInput = document.getElementById("testCount");
const clearBtn = document.getElementById("clearBtn");
const logEl = document.getElementById("log");
const errorBanner = document.getElementById("errorBanner");
const tikTokErrorEl = document.getElementById("tikTokError");
const liveBadge = document.getElementById("liveBadge");
const badgeText = liveBadge.querySelector(".badge-text");
const tiktokStatus = document.getElementById("tiktokStatus");
const ycLiveStatus = document.getElementById("ycLiveStatus");
const gameWindowStatus = document.getElementById("gameWindowStatus");
const httpPort = document.getElementById("httpPort");
const connectSpinner = connectBtn.querySelector(".spinner");
const connectLabel = connectBtn.querySelector(".btn-label");

const GAME_STORAGE_KEY = "tgr_selected_game";
const GAME_CHANNEL = "tgr-selected-game";
const TEMPLE_GAME_ID = "temple-escape";
let currentSelectedGame = { id: TEMPLE_GAME_ID, displayName: "Temple Escape (神庙跑跑跑)" };
const gameChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(GAME_CHANNEL) : null;
let gameCatalog = [];
let savingGame = false;

let connecting = false;
let pollTimer = null;
let seenGiftKeys = new Set();
let giftWatchReady = false;
let audioUnlocked = false;

/* ========== Dev Log ========== */
const DEV_LOG_KEY = "tgr_dev_log_ui";
let devLogTimer = null;
let devLogLastRender = "";
let devLogPanelOpen = false;
let _devLogPostAt = 0;
let _devLogDropped = 0;

function isDevLogPanelActive() {
  return !!document.getElementById("panel-devlog")?.classList.contains("active");
}

function devLog(scope, message, data, level = "info") {
  const msg = String(message || "");
  // ข้าม spam ที่ไม่ช่วยไล่บั๊ก
  if (level === "info" && (msg.includes("drain skipped") || msg.includes("enqueue video"))) {
    return;
  }
  const payload = {
    scope: scope || "ui",
    message: msg,
    level,
    data: data === undefined ? null : data,
    at: Date.now(),
  };
  if (level === "warn" || level === "error") {
    try {
      console[level === "error" ? "error" : "warn"](`[${payload.scope}] ${payload.message}`, data ?? "");
    } catch {
      /* ignore */
    }
  }
  // throttle POST — กัน UI/ดิสก์หนักตอนคิวรัว
  const now = Date.now();
  if (level === "info" && now - _devLogPostAt < 40) {
    _devLogDropped += 1;
    return;
  }
  _devLogPostAt = now;
  fetch("/api/dev-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function formatDevLogLine(e) {
  const iso = e.iso || e.Iso || "";
  const level = e.level || e.Level || "info";
  const scope = e.scope || e.Scope || "?";
  const message = e.message || e.Message || "";
  const raw = e.data !== undefined ? e.data : e.Data;
  const data =
    raw == null || raw === ""
      ? ""
      : " " + (typeof raw === "string" ? raw : JSON.stringify(raw));
  return `${iso} [${level}] [${scope}] ${message}${data}`;
}

async function refreshDevLogView() {
  const view = document.getElementById("devLogView");
  const countEl = document.getElementById("devLogCount");
  if (!view) return;
  const scope = document.getElementById("devLogScope")?.value || "";
  try {
    const q = new URLSearchParams({ limit: "250" });
    if (scope) q.set("scope", scope);
    const res = await fetch(`/api/dev-log?${q}&t=${Date.now()}`);
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    const lines = (data.entries || []).map(formatDevLogLine);
    const text = lines.length ? lines.join("\n") : "ยังไม่มี log";
    if (text !== devLogLastRender) {
      const stick = view.scrollTop + view.clientHeight >= view.scrollHeight - 24;
      view.textContent = text;
      devLogLastRender = text;
      if (stick) view.scrollTop = view.scrollHeight;
    }
    if (countEl) countEl.textContent = String(data.count || 0);
  } catch (err) {
    view.textContent = "อ่าน log ไม่ได้: " + (err.message || err);
  }
}

function setDevLogAutoRefresh(on) {
  if (devLogTimer) {
    clearInterval(devLogTimer);
    devLogTimer = null;
  }
  // รีเฟรชเฉพาะตอนเปิดแท็บ Dev Log — ห้าม poll ตอน boot
  if (on && isDevLogPanelActive()) {
    refreshDevLogView();
    devLogTimer = setInterval(refreshDevLogView, 2000);
  }
}

async function runInterruptBurstTest() {
  const btn = document.getElementById("devLogBurstTestBtn");
  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังยิง…";
  }
  const started = Date.now();
  const wasEnabled = !!interruptConfig?.enabled;
  const results = [];
  try {
    await fetch("/api/dev-log/clear", { method: "POST" }).catch(() => {});
    if (interruptConfig) interruptConfig.enabled = true;
    const gifts = (interruptConfig?.rules || [])
      .filter((r) => r.enabled !== false && normalizeInterruptKind(r.kind) === "video" && r.videos?.length)
      .map((r) => r.giftName)
      .filter(Boolean);
    const list = gifts.length ? gifts : ["Rose", "Overreact", "Rosa", "Confetti", "Perfume"];
    const each = 5;
    devLog("interrupt.burst", "START all-gifts rapid test", { gifts: list, each });

    for (const giftName of list) {
      const t0 = Date.now();
      if (btn) btn.textContent = `ยิง ${giftName} x${each}`;
      // Clear prior queue noise between gifts
      while (interruptQueue.length) interruptQueue.shift();
      flushAllInterruptCoalesce();
      handleGiftForInterrupt({
        kind: "gift",
        giftName,
        count: each,
        sender: `Burst_${giftName}`,
        speakGiftName: giftName,
        seq: Date.now() + Math.random(),
      });
      const drain = kickInterruptDrain();
      const maxWait = 60000;
      const tWait = Date.now();
      while ((interruptBusy || interruptQueue.length > 0 || interruptCoalesce.size > 0) && Date.now() - tWait < maxWait) {
        if (btn) btn.textContent = `${giftName} เล่น… เหลือ ${interruptQueue.length}`;
        await new Promise((r) => setTimeout(r, 200));
      }
      try {
        await Promise.race([drain, new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* ignore */
      }
      results.push({ gift: giftName, ms: Date.now() - t0, q: interruptQueue.length });
      devLog("interrupt.burst", `done ${giftName}`, { ms: Date.now() - t0, each });
      await new Promise((r) => setTimeout(r, 300));
    }

    await closeInterruptOverlay();
    setInterruptStatus(
      `เทสรัวๆ เสร็จ ${results.length} ของ ×${each} · ${Date.now() - started} ms — ดู Dev Log`
    );
    refreshDevLogView();
  } catch (err) {
    devLog("interrupt.burst", "FAILED", { error: String(err?.message || err) }, "error");
    try {
      await closeInterruptOverlay();
    } catch {
      /* ignore */
    }
    setInterruptStatus("เทสรัวๆ ไม่สำเร็จ: " + (err?.message || err));
  } finally {
    if (interruptConfig) interruptConfig.enabled = wasEnabled;
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "เทสขัดขวางรัวๆ (ทุกของ x5)";
    }
  }
}

function unlockAudio() {
  try {
    const a = new Audio(
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA"
    );
    a.volume = 0.01;
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audioUnlocked = true;
      }).catch(() => {});
    } else {
      audioUnlocked = true;
    }
  } catch {
    /* ignore */
  }
}

document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);

const savedUser = localStorage.getItem("tgr_username");
if (savedUser) usernameInput.value = savedUser;
if (usernameInput) {
  usernameInput.addEventListener("input", () => {
    // Clear stale connect error as soon as the user edits the name.
    setTikTokError("");
  });
}

/* ========== Nav ========== */
const WORKSPACE_META = {
  connect: { title: "เชื่อมต่อ", sub: "อ่าน Gift / Like / Follow จาก TikTok LIVE แล้วส่งต่อให้เกมที่เลือก" },
  effects: { title: "เอฟเฟกต์เกม", sub: "ทดสอบส่งของเข้าเกม · ดูว่าของขวัญแต่ละชิ้นทำอะไร" },
  roulette: { title: "กล่องสุ่มเอฟเฟกต์", sub: "เปิด–ปิดได้ · ของต้นทางไม่เข้าเกม จนกว่าจะหมุนจบแล้วส่งผลลัพธ์" },
  music: { title: "ฟังก์ชันเพลง", sub: "เมื่อได้ของขวัญตามกฎ โปรแกรมจะเปิดเพลงอัตโนมัติ" },
  video: { title: "วิดีโอใส", sub: "เล่นวิดีโอโปร่งใสทับหน้าจอเกมเมื่อได้ของขวัญ" },
  interrupt: { title: "ขัดขวางจอ", sub: "แสดงภาพ/วิดีโอขัดจอเมื่อได้ของขวัญ Like หรือ Follow" },
  win: { title: "นับ Win", sub: "นับคะแนน Win บน Overlay แยกต่างหาก" },
  stickers: { title: "สติกเกอร์", sub: "ชุดรูปสำหรับเกมวิ่ง Temple — ทั้งแผ่นไม่แยกไอคอน" },
  tts: { title: "อ่านเสียง AI", sub: "อ่านชื่อและของขวัญด้วยเสียงไทยอัตโนมัติ" },
  update: { title: "อัปเดต", sub: "ตรวจและติดตั้งอัปเดตออนไลน์จาก GitHub Monkeyeffect" },
  devlog: { title: "Dev Log", sub: "ดู log ภายในสำหรับไล่บั๊กและจับจังหวะอีเวนต์" },
};

function setWorkspaceMeta(panel) {
  const meta = WORKSPACE_META[panel] || WORKSPACE_META.connect;
  const titleEl = document.getElementById("workspaceTitle");
  const subEl = document.querySelector(".workspace-sub");
  if (titleEl) titleEl.textContent = meta.title;
  if (subEl) subEl.textContent = meta.sub;
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const panel = btn.dataset.panel;
    if (panel !== "music") stopMusicPreview();
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${panel}`)?.classList.add("active");
    setWorkspaceMeta(panel);
    if (panel === "effects") {
      syncEffectsPanelForGame(currentSelectedGame);
      renderGiftActionOverview();
    }
  });
});

/* ========== Helpers ========== */
function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setGameError(message) {
  if (!message) {
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
    return;
  }
  errorBanner.classList.remove("hidden");
  errorBanner.textContent = message;
}

function setTikTokError(message) {
  if (!tikTokErrorEl) return;
  if (!message) {
    tikTokErrorEl.classList.add("hidden");
    tikTokErrorEl.textContent = "";
    return;
  }
  tikTokErrorEl.classList.remove("hidden");
  tikTokErrorEl.textContent = message;
}

function setConnectingUI(isConnecting) {
  connecting = isConnecting;
  connectSpinner.classList.toggle("hidden", !isConnecting);
  connectLabel.textContent = isConnecting ? "Connecting..." : "Connect";
}

function parseGiftFromLog(item) {
  const text = String(item.text || "").trim();
  const kind = item.kind || "gift";
  if (kind === "system" || kind === "error") return null;
  // Approach A: ui = early fan-out; game = interrupt finalize (exact xN)
  const phase = kind === "game" ? "game" : "ui";

  // รองรับฟิลด์จาก API ถ้ามีในอนาคต
  const structuredName = item.nickname || item.userName || item.sender || item.from || "";
  const structuredGift = item.giftName || item.gift || "";
  const structuredMsg = item.message || item.comment || item.content || item.chat || "";

  // Skip markers must not drive interrupt / fan-out (trigger hold or winner already handled).
  if (/^\s*\[GAME-SKIP roulette\]/i.test(text) || /^\s*\[ROULETTE-WIN\]/i.test(text)) {
    return null;
  }
  const cleanText = text
    .replace(/^\s*\[TEST\]\s*/i, "")
    .replace(/^\s*\[GAME-SKIP roulette\]\s*/i, "")
    .replace(/^\s*\[ROULETTE-WIN\]\s*/i, "");
  const fromMatch = cleanText.match(/\s+(?:from|จาก)\s+(.+)$/i);
  const giftMatch = cleanText.match(/^(.+?) x(\d+)/);
  // แชทจาก backend ใหม่: "Chat: สวัสดี from Nick"
  const chatMatch = cleanText.match(/^(?:Chat|chat|ข้อความ)\s*[:：]\s*(.+?)\s+(?:from|จาก)\s+(.+)$/i);
  // [ROULETTE] Baby Hippo x3 :: Rose|Galaxy|Confetti :: from Nick
  const rouletteMatch = cleanText.match(
    /^\[ROULETTE\]\s*(.+?)\s+x(\d+)\s*::\s*(.+?)\s*::\s*(?:from|จาก)\s+(.+)$/i
  );

  let sender = structuredName;
  let giftName = structuredGift;
  let message = structuredMsg;
  let count = Number(item.repeatCount || item.count) || 1;
  let parsedKind = kind === "ui" || kind === "game" ? "gift" : kind;
  let rouletteOutcomes = null;

  if (kind === "roulette" || rouletteMatch) {
    parsedKind = "roulette";
    if (rouletteMatch) {
      giftName = rouletteMatch[1].trim();
      count = Number(rouletteMatch[2]) || 1;
      rouletteOutcomes = rouletteMatch[3]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      sender = rouletteMatch[4].trim();
    }
  } else if (kind === "chat" || chatMatch) {
    parsedKind = "chat";
    if (chatMatch) {
      message = message || chatMatch[1].trim();
      sender = sender || chatMatch[2].trim();
    }
  } else if (giftMatch) {
    giftName = giftName || giftMatch[1].trim();
    count = Number(giftMatch[2]) || count;
    sender = sender || (fromMatch ? fromMatch[1].trim() : "");
  } else if (kind === "follow" || /^Follow\b/i.test(cleanText)) {
    parsedKind = "follow";
    giftName = giftName || "Follow";
    sender = sender || (fromMatch ? fromMatch[1].trim() : cleanText.replace(/^Follow\s*(?:from|จาก)\s*/i, "").trim());
  } else if (kind === "like" || /^Like\b/i.test(cleanText)) {
    parsedKind = "like";
    giftName = giftName || "Like";
    sender = sender || (fromMatch ? fromMatch[1].trim() : cleanText.replace(/^Like\s*(?:x\d+\s*)?(?:from|จาก)\s*/i, "").trim());
  } else if (fromMatch && !sender) {
    sender = fromMatch[1].trim();
  }

  if (parsedKind === "like") giftName = giftName || "Like";
  if (parsedKind === "follow") giftName = giftName || "Follow";
  if (/^like$/i.test(giftName)) parsedKind = "like";
  if (/^follow$/i.test(giftName)) parsedKind = "follow";

  // ของขวัญจริงเท่านั้นที่ใส่ชื่อของขวัญตอนอ่านเสียง
  const speakGiftName = parsedKind === "gift" || parsedKind === "roulette" ? giftName || "" : "";

  if (!sender && !speakGiftName && !message && !giftName) return null;

  const seq = item.seq != null && item.seq !== "" ? Number(item.seq) : null;
  const comboKey = `${parsedKind}|${(sender || "").toLowerCase()}|${(giftName || "").toLowerCase()}`;
  return {
    giftName: giftName || "",
    speakGiftName,
    message: message || "",
    count,
    sender: sender || "ผู้ชม",
    kind: parsedKind,
    phase,
    rouletteOutcomes,
    comboKey,
    seq: Number.isFinite(seq) ? seq : null,
    dedupeKey:
      Number.isFinite(seq)
        ? `seq:${seq}`
        : parsedKind === "like"
          ? `like|${(sender || "").toLowerCase()}|ui`
          : parsedKind === "follow"
            ? `follow|${(sender || "").toLowerCase()}|${item.time || ""}`
            : parsedKind === "chat"
              ? `chat|${(sender || "").toLowerCase()}|${(message || "").slice(0, 80)}`
              : parsedKind === "roulette"
                ? `roulette|${comboKey}`
                : `combo|${comboKey}`,
    key: Number.isFinite(seq) ? `seq:${seq}` : `${item.time || ""}|${text}`,
    rawText: text,
  };
}

function extractEmojis(text) {
  const matches = String(text || "").match(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE0F}]|[\u{200D}]/gu);
  if (!matches) return "";
  return matches.join("");
}

function applyEmojiPreference(text) {
  if (ttsConfig.readEmoji === true) return String(text || "").trim();
  return stripEmojis(text);
}

/** ประกอบข้อความตามติ๊ก: ชื่อผู้ส่ง / ของขวัญ / ข้อความที่พิมพ์ / อิโมจิ */
function buildSpeechFromParts(data) {
  const readName = ttsConfig.readName !== false;
  const readGift = ttsConfig.readGift !== false;
  const readMessage = ttsConfig.readMessage !== false;
  const readEmoji = ttsConfig.readEmoji === true;

  const nameRaw = data.name || data.sender || "";
  const msgRaw = data.message || "";
  // ของขวัญ = ชื่อของขวัญเท่านั้น (ไม่ใช่ Like/Follow)
  const giftRaw =
    data.speakGiftName != null
      ? data.speakGiftName
      : data.gift != null
        ? data.gift
        : data.kind === "like" || data.kind === "follow"
          ? ""
          : data.giftName || "";

  const parts = [];

  if (readName && nameRaw) {
    parts.push(applyEmojiPreference(nameRaw));
  }
  if (readMessage && msgRaw) {
    parts.push(applyEmojiPreference(msgRaw));
  }
  if (readGift && giftRaw) {
    const giftText = applyEmojiPreference(giftRaw);
    if (giftText) parts.push(giftText);
  }

  // เปิดอ่านอิโมจิอย่างเดียว → อ่านเฉพาะอิโมจิที่ส่งมา
  if (readEmoji && !parts.length) {
    const emojiOnly = extractEmojis([nameRaw, msgRaw, giftRaw, data.rawText || ""].join(" "));
    if (emojiOnly) parts.push(emojiOnly);
  }

  return parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}

function stripEmojis(text) {
  return String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/[\u{20E3}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildSpeechText(_template, data) {
  return buildSpeechFromParts(data);
}

/* ========== IndexedDB for audio ========== */
const DB_NAME = "tgr_media";
const DB_STORE = "audio";

let dbOpenPromise = null;
function openDb() {
  if (dbOpenPromise) return dbOpenPromise;
  dbOpenPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbOpenPromise = null;
      reject(req.error);
    };
  });
  return dbOpenPromise;
}

/** Keep decoded song blobs ready so gift→music is not waiting on disk/IDB. */
const audioBlobCache = new Map();

async function getAudioBlobCached(id) {
  if (!id) return null;
  if (audioBlobCache.has(id)) return audioBlobCache.get(id);
  const row = await getAudioBlob(id);
  if (row?.blob) audioBlobCache.set(id, row);
  return row;
}

function prefetchMusicBlobs() {
  const ids = new Set();
  for (const rule of musicConfig.rules || []) {
    if (rule.enabled === false) continue;
    for (const s of rule.songs || []) {
      if (s?.id) ids.add(s.id);
    }
  }
  for (const id of ids) {
    getAudioBlobCached(id).catch(() => {});
  }
}

async function saveAudioBlob(id, blob, name, mime) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({ id, blob, name, mime, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Mirror IDB audio to media-cache so host MediaPlayer can play while minimized. */
async function putAudioCacheToDisk(id, blob, name, mime) {
  if (!id || !blob) return false;
  try {
    await fetch(`/api/audio-cache/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": mime || blob.type || "audio/mpeg",
        "X-File-Name": encodeURIComponent(name || `${id}.mp3`),
      },
      body: blob,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureAudioOnDisk(id) {
  if (!id) return false;
  try {
    const exists = await fetch(`/api/audio-file/${encodeURIComponent(id)}`, { method: "GET" });
    if (exists.ok) return true;
  } catch {
    /* mirror from IDB */
  }
  const row = await getAudioBlobCached(id);
  if (!row?.blob) return false;
  return putAudioCacheToDisk(id, row.blob, row.name || id, row.mime || "audio/mpeg");
}

async function getAudioBlob(id) {
  const db = await openDb();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (row?.blob) return row;

  // Disk fallback: media-cache or bundled defaults/music/files
  try {
    const res = await fetch(`/api/audio-file/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = res.headers.get("content-type") || blob.type || "audio/mpeg";
    const name = id;
    try {
      await saveAudioBlob(id, blob, name, mime);
    } catch {
      /* ignore cache write */
    }
    return { id, blob, name, mime, savedAt: Date.now() };
  } catch {
    return null;
  }
}

async function listAllAudioIds() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** Write current music rules + MP3s into wwwroot/defaults/music for Setup bundling. */
async function exportMusicDefaultsPack() {
  const songs = [];
  const seen = new Set();
  for (const rule of musicConfig.rules || []) {
    for (const s of rule.songs || []) {
      if (!s?.id || seen.has(s.id)) continue;
      seen.add(s.id);
      songs.push(s);
    }
  }
  let exported = 0;
  const missing = [];
  for (const s of songs) {
    const row = await getAudioBlob(s.id);
    if (!row?.blob) {
      missing.push(s.name || s.id);
      continue;
    }
    const buf = await row.blob.arrayBuffer();
    const res = await fetch(`/api/defaults/music/file/${encodeURIComponent(s.id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": row.mime || row.blob.type || "audio/mpeg",
        "X-File-Name": encodeURIComponent(row.name || s.name || `${s.id}.mp3`),
      },
      body: buf,
    });
    if (!res.ok) throw new Error(`export file failed: ${s.id}`);
    exported++;
  }
  const pack = {
    version: 1,
    exportedAt: new Date().toISOString(),
    enabled: musicConfig.enabled !== false,
    volume: typeof musicConfig.volume === "number" ? musicConfig.volume : 0.8,
    rules: (musicConfig.rules || []).map((r) => ({
      id: r.id,
      giftName: r.giftName,
      playMode: r.playMode || "random",
      enabled: r.enabled !== false,
      hookMode: r.hookMode,
      hookSeconds: r.hookSeconds,
      hookStart: r.hookStart,
      songs: (r.songs || []).map((s) => ({
        id: s.id,
        name: s.name,
        hookMode: s.hookMode,
        hookSeconds: s.hookSeconds,
        hookStart: s.hookStart,
        hookEnd: s.hookEnd ?? null,
        duration: s.duration || null,
      })),
    })),
  };
  const cfgRes = await fetch("/api/defaults/music/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pack, null, 2),
  });
  if (!cfgRes.ok) throw new Error("export config failed");
  await fetch("/api/defaults/music/export-flag/clear", { method: "POST" }).catch(() => {});
  return { ok: true, rules: pack.rules.length, files: exported, missing };
}

async function applyDefaultMusicPack({ force = false } = {}) {
  if (!force) {
    try {
      const raw = localStorage.getItem(MUSIC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.rules) && parsed.rules.length > 0) return { ok: false, reason: "exists" };
      }
    } catch {
      /* continue */
    }
    if (localStorage.getItem("tgr_music_defaults_seeded") === "1") {
      return { ok: false, reason: "seeded" };
    }
  }

  const res = await fetch(`/defaults/music/config.json?t=${Date.now()}`);
  if (!res.ok) throw new Error("ไม่พบแพ็กเพลงเริ่มต้นในโปรแกรม");
  const pack = await res.json();
  if (!pack || !Array.isArray(pack.rules) || !pack.rules.length) {
    throw new Error("แพ็กเพลงเริ่มต้นว่าง");
  }

  let imported = 0;
  let missing = 0;
  for (const rule of pack.rules) {
    for (const s of rule.songs || []) {
      if (!s?.id) continue;
      if (!force) {
        const existing = await getAudioBlob(s.id);
        if (existing?.blob) continue;
      }
      let blobRes = await fetch(`/defaults/music/files/${encodeURIComponent(s.id)}.mp3`);
      if (!blobRes.ok) {
        blobRes = await fetch(`/api/audio-file/${encodeURIComponent(s.id)}`);
      }
      if (!blobRes.ok) {
        missing++;
        continue;
      }
      const blob = await blobRes.blob();
      const mime = blobRes.headers.get("content-type") || "audio/mpeg";
      await saveAudioBlob(s.id, blob, s.name || s.id, mime);
      await putAudioCacheToDisk(s.id, blob, s.name || s.id, mime);
      imported++;
    }
  }

  musicConfig = {
    enabled: pack.enabled !== false,
    volume: typeof pack.volume === "number" ? pack.volume : 0.8,
    rules: pack.rules.map((r) => ({
      id: r.id || uid(),
      giftName: r.giftName,
      playMode: r.playMode || "random",
      enabled: r.enabled !== false,
      hookMode: r.hookMode,
      hookSeconds: r.hookSeconds,
      hookStart: r.hookStart,
      songs: (r.songs || []).map((s) => ({
        id: s.id,
        name: s.name,
        hookMode: s.hookMode,
        hookSeconds: s.hookSeconds,
        hookStart: s.hookStart,
        hookEnd: s.hookEnd ?? null,
        duration: s.duration || null,
      })),
    })),
  };
  saveMusicConfig();
  localStorage.setItem("tgr_music_defaults_seeded", "1");
  resetMusicEditor();
  renderMusicUiState();
  return { ok: true, rules: musicConfig.rules.length, imported, missing };
}

async function seedDefaultMusicIfNeeded() {
  try {
    const result = await applyDefaultMusicPack({ force: false });
    if (result.ok) {
      console.info(`[music] seeded ${result.rules} default gift→song rules`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[music] seed defaults failed", err);
    return false;
  }
}

async function restoreDefaultMusicPackFromButton() {
  const btn = document.getElementById("musicRestoreDefaultsBtn");
  const hasRules = (musicConfig.rules || []).length > 0;
  const msg = hasRules
    ? "ใช้การตั้งค่าเริ่มต้นแทนของปัจจุบัน?\nจะแทนที่กฎเพลงทั้งหมดด้วยแพ็กที่มากับโปรแกรม (ของขวัญคู่เพลง + ไฟล์)"
    : "โหลดการตั้งค่าเพลงเริ่มต้นเข้ามาใช้เลยไหม?";
  if (!confirm(msg)) return;

  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังโหลด…";
  }
  try {
    const result = await applyDefaultMusicPack({ force: true });
    alert(
      `ใช้การตั้งค่าเริ่มต้นแล้ว\nกฎ: ${result.rules}` +
        (result.missing ? `\nไฟล์ที่ขาด: ${result.missing}` : "")
    );
  } catch (err) {
    alert("โหลดตั้งค่าเริ่มต้นไม่สำเร็จ: " + (err?.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "ใช้ตั้งค่าเริ่มต้น";
    }
  }
}

async function maybeExportMusicDefaultsFromFlag() {
  try {
    const res = await fetch(`/api/defaults/music/export-flag?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.export) return;
    const result = await exportMusicDefaultsPack();
    console.info("[music] exported defaults pack", result);
    alert(
      `ส่งออกแพ็กเพลงเริ่มต้นแล้ว\nกฎ: ${result.rules}\nไฟล์: ${result.files}` +
        (result.missing?.length ? `\nขาดไฟล์: ${result.missing.join(", ")}` : "")
    );
  } catch (err) {
    console.warn("[music] export defaults failed", err);
    alert("ส่งออกแพ็กเพลงไม่สำเร็จ: " + (err?.message || err));
  }
}

async function deleteAudioBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ========== Music config ========== */
const MUSIC_KEY = "tgr_music_config";
let musicConfig = loadMusicConfig();
let musicPendingSongs = [];
let musicSeqIndex = {};
let currentAudio = null;
let musicQueue = [];

function defaultMusicConfig() {
  return { enabled: true, volume: 0.8, rules: [] };
}

function loadMusicConfig() {
  try {
    const raw = localStorage.getItem(MUSIC_KEY);
    if (!raw) return defaultMusicConfig();
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      volume: typeof parsed.volume === "number" ? parsed.volume : 0.8,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return defaultMusicConfig();
  }
}

function saveMusicConfig() {
  localStorage.setItem(MUSIC_KEY, JSON.stringify(musicConfig));
  renderMusicRules();
  prefetchMusicBlobs();
  renderGiftActionOverview();
}

function renderMusicUiState() {
  const enabledEl = document.getElementById("musicEnabled");
  const volumeEl = document.getElementById("musicVolume");
  const volumeLabel = document.getElementById("musicVolumeLabel");
  if (enabledEl) enabledEl.checked = !!musicConfig.enabled;
  if (volumeEl) volumeEl.value = String(Math.round((musicConfig.volume ?? 0.8) * 100));
  if (volumeLabel) volumeLabel.textContent = String(Math.round((musicConfig.volume ?? 0.8) * 100));
  renderMusicPending();
  renderMusicRules();
}

let musicPreviewAudio = null;
let musicPreviewIndex = -1;
let musicPreviewRaf = 0;

function stopMusicPreview() {
  if (musicPreviewRaf) {
    cancelAnimationFrame(musicPreviewRaf);
    musicPreviewRaf = 0;
  }
  if (musicPreviewAudio) {
    try {
      musicPreviewAudio.pause();
      const blobUrl = musicPreviewAudio._blobUrl;
      musicPreviewAudio.src = "";
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    } catch {
      /* ignore */
    }
    musicPreviewAudio = null;
  }
  musicPreviewIndex = -1;
  document.querySelectorAll("[data-preview-play]").forEach((b) => {
    b.textContent = "▶ ฟัง";
  });
  document.querySelectorAll("[data-preview-hook]").forEach((b) => {
    b.textContent = "🎧 ฟังฮุก";
  });
  document.querySelectorAll("[data-preview-time]").forEach((el) => {
    if (el.dataset.idleText) el.textContent = el.dataset.idleText;
  });
}

function fmtTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function syncPendingSongHook(i) {
  const s = musicPendingSongs[i];
  if (!s) return;
  const start = Math.max(0, Number(s.hookStart) || 0);
  const end = s.hookEnd != null ? Number(s.hookEnd) : null;
  if (end != null && end > start) {
    s.hookMode = "custom";
    s.hookSeconds = Math.max(0.5, +(end - start).toFixed(1));
  }
}

async function ensurePreviewAudio(index) {
  const song = musicPendingSongs[index];
  if (!song) return null;
  if (musicPreviewAudio && musicPreviewIndex === index) return musicPreviewAudio;

  stopMusicPreview();
  const row = await getAudioBlob(song.id);
  if (!row?.blob) throw new Error("ไม่พบไฟล์เสียง");
  const url = URL.createObjectURL(row.blob);
  const audio = new Audio(url);
  audio._blobUrl = url;
  audio.preload = "metadata";
  musicPreviewAudio = audio;
  musicPreviewIndex = index;
  audio.addEventListener(
    "ended",
    () => {
      const btn = document.querySelector(`[data-preview-play="${index}"]`);
      if (btn) btn.textContent = "▶ ฟัง";
    },
    { once: false }
  );
  await new Promise((resolve, reject) => {
    if (audio.readyState >= 1) resolve();
    else {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("โหลดเพลงไม่สำเร็จ")), { once: true });
    }
  });
  if (!song.duration && Number.isFinite(audio.duration)) {
    song.duration = audio.duration;
    refreshTrimUi(index);
  }
  return audio;
}

function songClipBounds(song) {
  const dur = Number(song.duration) || 0;
  const start = Math.max(0, Number(song.hookStart) || 0);
  const hookDur = resolveHookDuration(song);
  let end =
    song.hookEnd != null
      ? Number(song.hookEnd)
      : hookDur != null
        ? start + hookDur
        : dur || start;
  if (dur > 0) end = Math.min(end, dur);
  if (end < start) end = start;
  return { start, end, dur, hookDur };
}

function refreshTrimUi(index, { fromAudio = false } = {}) {
  const song = musicPendingSongs[index];
  if (!song) return;
  const { start, end, dur, hookDur } = songClipBounds(song);
  const max = dur > 0 ? dur : Math.max(end, start + 1, 100);

  const startRange = document.querySelector(`[data-range-start="${index}"]`);
  const endRange = document.querySelector(`[data-range-end="${index}"]`);
  const startNum = document.querySelector(`[data-start-sec="${index}"]`);
  const endNum = document.querySelector(`[data-end-sec="${index}"]`);
  const startLbl = document.querySelector(`[data-start-label="${index}"]`);
  const endLbl = document.querySelector(`[data-end-label="${index}"]`);
  const rangeEl = document.querySelector(`[data-preview-range="${index}"]`);
  const region = document.querySelector(`[data-trim-region="${index}"]`);
  const chip = document.querySelector(`[data-song-card="${index}"] .chip`);
  const seekEl = document.querySelector(`[data-preview-seek="${index}"]`);

  for (const el of [startRange, endRange, seekEl]) {
    if (el) el.max = String(max);
  }
  if (startRange && document.activeElement !== startRange) startRange.value = String(start);
  if (endRange && document.activeElement !== endRange) endRange.value = String(end);
  if (startNum && document.activeElement !== startNum) startNum.value = String(+start.toFixed(1));
  if (endNum && document.activeElement !== endNum) endNum.value = String(+end.toFixed(1));
  if (startLbl) startLbl.textContent = fmtTime(start);
  if (endLbl) endLbl.textContent = fmtTime(end);
  if (rangeEl) {
    rangeEl.textContent =
      hookDur == null && song.hookMode === "full"
        ? `เล่นทั้งเพลง${start > 0 ? ` (เริ่ม ${fmtTime(start)})` : ""}`
        : `ช่วงที่เลือก: ${fmtTime(start)} → ${fmtTime(end)} (${+(end - start).toFixed(1)} วิ)`;
  }
  if (region && max > 0) {
    const left = (start / max) * 100;
    const width = Math.max(0, ((end - start) / max) * 100);
    region.style.left = `${left}%`;
    region.style.width = `${width}%`;
  }
  if (chip) chip.textContent = formatHookLabel(song);

  if (fromAudio && musicPreviewAudio && musicPreviewIndex === index) {
    const cur = musicPreviewAudio.currentTime || 0;
    const timeEl = document.querySelector(`[data-preview-time="${index}"]`);
    if (timeEl) timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur || max)}`;
    if (seekEl && document.activeElement !== seekEl) seekEl.value = String(cur);
  }
}

function applyClipRange(index, startSec, endSec, { rerender = false } = {}) {
  const song = musicPendingSongs[index];
  if (!song) return;
  const dur = Number(song.duration) || 0;
  let start = Math.max(0, Number(startSec) || 0);
  let end = Math.max(0, Number(endSec) || 0);
  if (dur > 0) {
    start = Math.min(start, dur);
    end = Math.min(end, dur);
  }
  if (end <= start) end = +(start + 0.5).toFixed(1);
  song.hookStart = +start.toFixed(1);
  song.hookEnd = +end.toFixed(1);
  song.hookMode = "custom";
  song.hookSeconds = +Math.max(0.5, song.hookEnd - song.hookStart).toFixed(1);
  if (rerender) renderMusicPending();
  else refreshTrimUi(index);
}

function updatePreviewUi(index) {
  const audio = musicPreviewAudio;
  const song = musicPendingSongs[index];
  if (!audio || !song || musicPreviewIndex !== index) return;
  refreshTrimUi(index, { fromAudio: true });

  const cur = audio.currentTime || 0;
  if (audio._hookPreviewEnd != null && cur >= audio._hookPreviewEnd - 0.05) {
    audio.pause();
    audio._hookPreviewEnd = null;
    const btn = document.querySelector(`[data-preview-play="${index}"]`);
    if (btn) btn.textContent = "▶ ฟัง";
    const hbtn = document.querySelector(`[data-preview-hook="${index}"]`);
    if (hbtn) hbtn.textContent = "🎧 ฟังฮุก";
    return;
  }

  if (!audio.paused) {
    musicPreviewRaf = requestAnimationFrame(() => updatePreviewUi(index));
  }
}

async function togglePreviewPlay(index, hookOnly = false) {
  unlockAudio();
  const song = musicPendingSongs[index];
  if (!song) return;
  const audio = await ensurePreviewAudio(index);
  const btn = document.querySelector(`[data-preview-play="${index}"]`);
  const hookBtn = document.querySelector(`[data-preview-hook="${index}"]`);

  if (!hookOnly && musicPreviewIndex === index && !audio.paused && !audio._hookPreviewEnd) {
    audio.pause();
    if (btn) btn.textContent = "▶ ฟัง";
    return;
  }

  // stop other mode buttons visual
  document.querySelectorAll("[data-preview-play]").forEach((b) => {
    b.textContent = "▶ ฟัง";
  });
  document.querySelectorAll("[data-preview-hook]").forEach((b) => {
    b.textContent = "🎧 ฟังฮุก";
  });

  const start = Math.max(0, Number(song.hookStart) || 0);
  const hookDur = resolveHookDuration(song);
  if (hookOnly) {
    audio.currentTime = start;
    audio._hookPreviewEnd = hookDur != null ? start + hookDur : null;
    if (hookBtn) hookBtn.textContent = "⏸ หยุดฮุก";
  } else {
    audio._hookPreviewEnd = null;
    if (btn) btn.textContent = "⏸ หยุด";
  }
  await audio.play();
  updatePreviewUi(index);
}

function markHookStart(index) {
  const song = musicPendingSongs[index];
  const audio = musicPreviewAudio;
  if (!song) return;
  const t = audio && musicPreviewIndex === index ? audio.currentTime : Number(song.hookStart) || 0;
  const { end } = songClipBounds(song);
  applyClipRange(index, t, Math.max(end, t + 0.5));
}

function markHookEnd(index) {
  const song = musicPendingSongs[index];
  const audio = musicPreviewAudio;
  if (!song) return;
  const t = audio && musicPreviewIndex === index ? audio.currentTime : null;
  if (t == null) {
    alert("กดฟังเพลงก่อน แล้วเลื่อนไปจุดจบฮุก");
    return;
  }
  const start = Math.max(0, Number(song.hookStart) || 0);
  if (t <= start) {
    alert("จุดจบต้องอยู่หลังจุดเริ่ม");
    return;
  }
  applyClipRange(index, start, t);
}

function setQuickHookDuration(index, seconds) {
  const song = musicPendingSongs[index];
  if (!song) return;
  const start = Number(song.hookStart) || 0;
  applyClipRange(index, start, start + Number(seconds));
}

function formatHookLabel(songOrRule) {
  const dur = resolveHookDuration(songOrRule);
  const start = Number(songOrRule.hookStart ?? 0) || 0;
  if (dur == null) {
    return start > 0 ? `ทั้งเพลง (เริ่ม ${fmtTime(start)})` : "ทั้งเพลง";
  }
  return start > 0 ? `ฮุก ${dur} วิ · เริ่ม ${fmtTime(start)}` : `ฮุก ${dur} วิ`;
}

function resolveHookDuration(cfg) {
  const mode = cfg.hookMode || "full";
  if (mode === "full") return null;
  if (mode === "custom") {
    const n = Number(cfg.hookSeconds);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }
  const n = Number(mode);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getDefaultHookFromForm() {
  const mode = document.getElementById("musicHookDefault")?.value || "20";
  const custom = Number(document.getElementById("musicHookCustom")?.value) || 20;
  const start = Number(document.getElementById("musicHookStart")?.value) || 0;
  return {
    hookMode: mode,
    hookSeconds: mode === "custom" ? custom : Number(mode) || 20,
    hookStart: Math.max(0, start),
    hookEnd: mode === "full" ? null : start + (mode === "custom" ? custom : Number(mode) || 20),
  };
}

function setHookForm(cfg) {
  const modeEl = document.getElementById("musicHookDefault");
  const customEl = document.getElementById("musicHookCustom");
  const startEl = document.getElementById("musicHookStart");
  if (!modeEl) return;
  const mode = cfg?.hookMode || "20";
  modeEl.value = ["full", "10", "15", "20", "30", "custom"].includes(String(mode)) ? String(mode) : "20";
  if (customEl) customEl.value = String(cfg?.hookSeconds || 20);
  if (startEl) startEl.value = String(cfg?.hookStart ?? 0);
}

function renderMusicPending() {
  const el = document.getElementById("musicPendingList");
  if (!el) return;
  const keepIndex = musicPreviewIndex;
  const wasPlaying = !!(musicPreviewAudio && !musicPreviewAudio.paused);
  const keepTime = musicPreviewAudio ? musicPreviewAudio.currentTime : 0;

  if (!musicPendingSongs.length) {
    stopMusicPreview();
    el.innerHTML = '<div class="empty-hint">ยังไม่มีไฟล์ในรายการนี้ — กดเลือกไฟล์แล้วกด “เพิ่มไฟล์” จากนั้นกดฟังและตัดฮุกได้เลย</div>';
    return;
  }
  el.innerHTML = musicPendingSongs
    .map((s, i) => {
      const mode = s.hookMode || "20";
      const secs = s.hookSeconds || 20;
      const { start, end, dur } = songClipBounds(s);
      const max = dur > 0 ? dur : Math.max(end, 100);
      const leftPct = max > 0 ? (start / max) * 100 : 0;
      const widthPct = max > 0 ? Math.max(0, ((end - start) / max) * 100) : 0;
      const durLabel = s.duration ? fmtTime(s.duration) : "--:--";
      return `
      <div class="song-item song-item-hook" data-song-card="${i}">
        <div class="song-main">
          <span class="song-name">${escapeHtml(s.name)}</span>
          <span class="chip">${escapeHtml(formatHookLabel(s))}</span>
        </div>

        <div class="trimmer">
          <div class="trimmer-row">
            <button type="button" class="btn secondary small" data-preview-play="${i}">▶ ฟัง</button>
            <button type="button" class="btn ghost small" data-preview-hook="${i}">🎧 ฟังฮุก</button>
            <span class="trimmer-time" data-preview-time="${i}" data-idle-text="0:00 / ${durLabel}">0:00 / ${durLabel}</span>
          </div>

          <div class="trim-track-wrap">
            <div class="trim-track" data-trim-track="${i}">
              <div class="trim-region" data-trim-region="${i}" style="left:${leftPct}%;width:${widthPct}%"></div>
            </div>
            <input class="trimmer-seek" type="range" min="0" max="${max}" step="0.1" value="0" data-preview-seek="${i}" title="ตำแหน่งเล่น" />
          </div>

          <div class="clip-pickers">
            <div class="clip-picker">
              <div class="clip-picker-head">
                <span>เริ่มตรง</span>
                <strong data-start-label="${i}">${fmtTime(start)}</strong>
              </div>
              <input class="clip-range start" type="range" min="0" max="${max}" step="0.1" value="${start}" data-range-start="${i}" />
              <label class="clip-sec">วินาที
                <input type="number" min="0" max="3600" step="0.1" value="${(+start).toFixed(1)}" data-start-sec="${i}" />
              </label>
            </div>
            <div class="clip-picker">
              <div class="clip-picker-head">
                <span>จบตรง</span>
                <strong data-end-label="${i}">${fmtTime(end)}</strong>
              </div>
              <input class="clip-range end" type="range" min="0" max="${max}" step="0.1" value="${end}" data-range-end="${i}" />
              <label class="clip-sec">วินาที
                <input type="number" min="0" max="3600" step="0.1" value="${(+end).toFixed(1)}" data-end-sec="${i}" />
              </label>
            </div>
          </div>

          <div class="trimmer-range" data-preview-range="${i}">ช่วงที่เลือก: ${fmtTime(start)} → ${fmtTime(end)} (${mode === "full" ? "ทั้งเพลง" : `${+(end - start).toFixed(1)} วิ`})</div>
          <div class="trimmer-actions">
            <button type="button" class="btn ghost small" data-mark-start="${i}">ใช้ตำแหน่งเล่นเป็นเริ่ม</button>
            <button type="button" class="btn ghost small" data-mark-end="${i}">ใช้ตำแหน่งเล่นเป็นจบ</button>
            <button type="button" class="btn ghost small" data-quick-hook="${i}" data-sec="10">10 วิ</button>
            <button type="button" class="btn ghost small" data-quick-hook="${i}" data-sec="20">20 วิ</button>
            <button type="button" class="btn ghost small" data-quick-hook="${i}" data-sec="30">30 วิ</button>
            <button type="button" class="btn ghost small" data-full-song="${i}">ทั้งเพลง</button>
          </div>
        </div>

        <div class="song-hook-controls">
          <button type="button" class="btn ghost small danger" data-remove-pending="${i}">ลบเพลงนี้</button>
        </div>
      </div>`;
    })
    .join("");

  el.querySelectorAll("[data-remove-pending]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.removePending);
      if (musicPreviewIndex === i) stopMusicPreview();
      musicPendingSongs.splice(i, 1);
      renderMusicPending();
    });
  });
  el.querySelectorAll("[data-preview-play]").forEach((btn) => {
    btn.addEventListener("click", () => {
      togglePreviewPlay(Number(btn.dataset.previewPlay), false).catch((e) => alert(e.message || e));
    });
  });
  el.querySelectorAll("[data-preview-hook]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.previewHook);
      if (musicPreviewAudio && musicPreviewIndex === i && !musicPreviewAudio.paused && musicPreviewAudio._hookPreviewEnd != null) {
        musicPreviewAudio.pause();
        btn.textContent = "🎧 ฟังฮุก";
        return;
      }
      togglePreviewPlay(i, true).catch((e) => alert(e.message || e));
    });
  });
  el.querySelectorAll("[data-mark-start]").forEach((btn) => {
    btn.addEventListener("click", () => markHookStart(Number(btn.dataset.markStart)));
  });
  el.querySelectorAll("[data-mark-end]").forEach((btn) => {
    btn.addEventListener("click", () => markHookEnd(Number(btn.dataset.markEnd)));
  });
  el.querySelectorAll("[data-quick-hook]").forEach((btn) => {
    btn.addEventListener("click", () => setQuickHookDuration(Number(btn.dataset.quickHook), Number(btn.dataset.sec)));
  });
  el.querySelectorAll("[data-full-song]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.fullSong);
      const song = musicPendingSongs[i];
      if (!song) return;
      song.hookMode = "full";
      song.hookStart = 0;
      song.hookEnd = null;
      song.hookSeconds = song.duration || 20;
      refreshTrimUi(i);
    });
  });
  el.querySelectorAll("[data-preview-seek]").forEach((seek) => {
    seek.addEventListener("input", async () => {
      const i = Number(seek.dataset.previewSeek);
      try {
        const audio = await ensurePreviewAudio(i);
        audio.currentTime = Number(seek.value) || 0;
        updatePreviewUi(i);
      } catch (e) {
        alert(e.message || e);
      }
    });
  });
  el.querySelectorAll("[data-range-start]").forEach((range) => {
    const onMove = async () => {
      const i = Number(range.dataset.rangeStart);
      const song = musicPendingSongs[i];
      if (!song) return;
      if (!song.duration) {
        try {
          await ensurePreviewAudio(i);
        } catch {
          /* ignore */
        }
      }
      const { end } = songClipBounds(song);
      let start = Number(range.value) || 0;
      if (start >= end) start = Math.max(0, end - 0.5);
      applyClipRange(i, start, end);
    };
    range.addEventListener("input", onMove);
    range.addEventListener("change", onMove);
  });
  el.querySelectorAll("[data-range-end]").forEach((range) => {
    const onMove = async () => {
      const i = Number(range.dataset.rangeEnd);
      const song = musicPendingSongs[i];
      if (!song) return;
      if (!song.duration) {
        try {
          await ensurePreviewAudio(i);
        } catch {
          /* ignore */
        }
      }
      const { start } = songClipBounds(song);
      let end = Number(range.value) || 0;
      if (end <= start) end = start + 0.5;
      applyClipRange(i, start, end);
    };
    range.addEventListener("input", onMove);
    range.addEventListener("change", onMove);
  });
  el.querySelectorAll("[data-start-sec]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.startSec);
      const { end } = songClipBounds(musicPendingSongs[i] || {});
      applyClipRange(i, Number(inp.value) || 0, end);
    });
  });
  el.querySelectorAll("[data-end-sec]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.endSec);
      const { start } = songClipBounds(musicPendingSongs[i] || {});
      applyClipRange(i, start, Number(inp.value) || 0);
    });
  });

  // restore playback UI state after re-render if same song still previewing
  if (keepIndex >= 0 && keepIndex < musicPendingSongs.length && musicPreviewAudio && wasPlaying) {
    musicPreviewIndex = keepIndex;
    try {
      musicPreviewAudio.currentTime = keepTime;
    } catch {
      /* ignore */
    }
    const btn = document.querySelector(`[data-preview-play="${keepIndex}"]`);
    if (btn && !musicPreviewAudio._hookPreviewEnd) btn.textContent = "⏸ หยุด";
    const hbtn = document.querySelector(`[data-preview-hook="${keepIndex}"]`);
    if (hbtn && musicPreviewAudio._hookPreviewEnd != null) hbtn.textContent = "⏸ หยุดฮุก";
    updatePreviewUi(keepIndex);
  } else if (keepIndex >= 0 && musicPreviewAudio) {
    refreshTrimUi(keepIndex, { fromAudio: true });
  }
}

function renderMusicRules() {
  const list = document.getElementById("musicRulesList");
  const count = document.getElementById("musicRuleCount");
  if (count) count.textContent = `${musicConfig.rules.length} กฎ`;
  if (!list) return;
  if (!musicConfig.rules.length) {
    list.innerHTML = '<div class="empty-hint">ยังไม่มีกฎเพลง — เพิ่มด้านบนได้เลย</div>';
    return;
  }
  list.innerHTML = musicConfig.rules
    .map((rule) => {
      const songs = (rule.songs || [])
        .map((s) => `${escapeHtml(s.name)} (${escapeHtml(formatHookLabel(s))})`)
        .join(", ") || "ไม่มีเพลง";
      const modeLabel =
        rule.playMode === "all" ? "เล่นทุกเพลง" : rule.playMode === "sequence" ? "ตามลำดับ" : "สุ่ม";
      return `
        <div class="rule-card ${rule.enabled === false ? "disabled" : ""}">
          <div class="rule-main">
            <div class="rule-title">
              <strong>${escapeHtml(rule.giftName)}</strong>
              <span class="chip">${modeLabel}</span>
              ${rule.enabled === false ? '<span class="chip warn">ปิดอยู่</span>' : ""}
            </div>
            <div class="rule-meta">${(rule.songs || []).length} เพลง · ${songs}</div>
          </div>
          <div class="rule-actions">
            <button type="button" class="btn ghost small" data-music-toggle="${rule.id}">${rule.enabled === false ? "เปิด" : "ปิด"}</button>
            <button type="button" class="btn secondary small" data-music-test="${rule.id}">ทดสอบ</button>
            <button type="button" class="btn ghost small" data-music-edit="${rule.id}">แก้ไข</button>
            <button type="button" class="btn ghost small danger" data-music-del="${rule.id}">ลบ</button>
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-music-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rule = musicConfig.rules.find((r) => r.id === btn.dataset.musicToggle);
      if (!rule) return;
      rule.enabled = rule.enabled === false;
      saveMusicConfig();
    });
  });
  list.querySelectorAll("[data-music-test]").forEach((btn) => {
    btn.addEventListener("click", () => playMusicForGift(btn.dataset.musicTest, true));
  });
  list.querySelectorAll("[data-music-edit]").forEach((btn) => {
    btn.addEventListener("click", () => startEditMusicRule(btn.dataset.musicEdit));
  });
  list.querySelectorAll("[data-music-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteMusicRule(btn.dataset.musicDel));
  });
}

function resetMusicEditor() {
  stopMusicPreview();
  document.getElementById("musicEditId").value = "";
  document.getElementById("musicGiftName").value = "";
  document.getElementById("musicPlayMode").value = "random";
  document.getElementById("musicFiles").value = "";
  setHookForm({ hookMode: "20", hookSeconds: 20, hookStart: 0 });
  musicPendingSongs = [];
  document.getElementById("musicRuleMode").textContent = "เพิ่มใหม่";
  renderMusicPending();
}

async function startEditMusicRule(id) {
  const rule = musicConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  document.getElementById("musicEditId").value = rule.id;
  document.getElementById("musicGiftName").value = rule.giftName || "";
  document.getElementById("musicPlayMode").value = rule.playMode || "random";
  document.getElementById("musicRuleMode").textContent = "กำลังแก้ไข";
  const first = (rule.songs || [])[0] || rule;
  setHookForm({
    hookMode: first.hookMode || rule.hookMode || "20",
    hookSeconds: first.hookSeconds || rule.hookSeconds || 20,
    hookStart: first.hookStart ?? rule.hookStart ?? 0,
  });
  musicPendingSongs = (rule.songs || []).map((s) => ({
    id: s.id,
    name: s.name,
    existing: true,
    duration: s.duration || null,
    hookMode: s.hookMode || rule.hookMode || "20",
    hookSeconds: s.hookSeconds || rule.hookSeconds || 20,
    hookStart: s.hookStart ?? rule.hookStart ?? 0,
    hookEnd: s.hookEnd ?? null,
  }));
  stopMusicPreview();
  renderMusicPending();
  document.querySelector('.nav-btn[data-panel="music"]')?.click();
}

async function deleteMusicRule(id) {
  const rule = musicConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  if (!confirm(`ลบกฎเพลงของ “${rule.giftName}” ?`)) return;
  for (const s of rule.songs || []) {
    try {
      await deleteAudioBlob(s.id);
    } catch {
      /* ignore */
    }
  }
  musicConfig.rules = musicConfig.rules.filter((r) => r.id !== id);
  saveMusicConfig();
  if (document.getElementById("musicEditId").value === id) resetMusicEditor();
}

async function addSelectedMusicFiles() {
  const input = document.getElementById("musicFiles");
  const files = Array.from(input.files || []);
  if (!files.length) {
    alert("เลือกไฟล์เพลงก่อน");
    return;
  }
  const hook = getDefaultHookFromForm();
  for (const file of files) {
    const id = uid();
    const mime = file.type || "audio/mpeg";
    await saveAudioBlob(id, file, file.name, mime);
    await putAudioCacheToDisk(id, file, file.name, mime);
    let duration = 0;
    try {
      duration = await new Promise((resolve) => {
        const tmp = new Audio(URL.createObjectURL(file));
        tmp.addEventListener("loadedmetadata", () => {
          const d = tmp.duration;
          URL.revokeObjectURL(tmp.src);
          resolve(Number.isFinite(d) ? d : 0);
        });
        tmp.addEventListener("error", () => resolve(0), { once: true });
      });
    } catch {
      duration = 0;
    }
    const start = hook.hookStart;
    const secs = hook.hookSeconds;
    musicPendingSongs.push({
      id,
      name: file.name,
      existing: true,
      duration,
      hookMode: hook.hookMode,
      hookSeconds: secs,
      hookStart: start,
      hookEnd: hook.hookMode === "full" ? null : +(start + secs).toFixed(1),
    });
  }
  input.value = "";
  renderMusicPending();
}

async function saveMusicRule() {
  const giftName = document.getElementById("musicGiftName").value.trim();
  if (!giftName) {
    alert("กรอกชื่อของขวัญ");
    return;
  }
  if (!musicPendingSongs.length) {
    alert("เพิ่มไฟล์เพลงอย่างน้อย 1 ไฟล์");
    return;
  }
  const editId = document.getElementById("musicEditId").value;
  const playMode = document.getElementById("musicPlayMode").value || "random";
  const defaultHook = getDefaultHookFromForm();
  const songs = musicPendingSongs.map((s) => ({
    id: s.id,
    name: s.name,
    hookMode: s.hookMode || defaultHook.hookMode,
    hookSeconds: s.hookSeconds || defaultHook.hookSeconds,
    hookStart: s.hookStart ?? defaultHook.hookStart,
    hookEnd: s.hookEnd ?? null,
    duration: s.duration || null,
  }));

  if (editId) {
    const rule = musicConfig.rules.find((r) => r.id === editId);
    if (rule) {
      const keep = new Set(songs.map((s) => s.id));
      for (const old of rule.songs || []) {
        if (!keep.has(old.id)) {
          try {
            await deleteAudioBlob(old.id);
          } catch {
            /* ignore */
          }
        }
      }
      rule.giftName = giftName;
      rule.playMode = playMode;
      rule.songs = songs;
      rule.hookMode = defaultHook.hookMode;
      rule.hookSeconds = defaultHook.hookSeconds;
      rule.hookStart = defaultHook.hookStart;
      rule.enabled = rule.enabled !== false;
    }
  } else {
    musicConfig.rules.push({
      id: uid(),
      giftName,
      playMode,
      enabled: true,
      songs,
      hookMode: defaultHook.hookMode,
      hookSeconds: defaultHook.hookSeconds,
      hookStart: defaultHook.hookStart,
    });
  }
  saveMusicConfig();
  resetMusicEditor();
}

function setNowPlaying(text) {
  const el = document.getElementById("musicNowPlaying");
  if (el) el.textContent = text || "—";
}

let musicHookTimer = null;
/** Bumps on every stop/replace — cancels in-flight drains so songs never overlap. */
let musicPlayGen = 0;
let musicActiveGiftKey = "";
const musicLiveAudios = new Set();

function clearMusicHookTimer() {
  if (musicHookTimer) {
    clearTimeout(musicHookTimer);
    musicHookTimer = null;
  }
}

function hardStopAudio(audio) {
  if (!audio) return;
  try {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    const blobUrl = audio._blobUrl;
    audio.removeAttribute("src");
    audio.src = "";
    audio.load();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  } catch {
    /* ignore */
  }
  musicLiveAudios.delete(audio);
}

function stopMusic(opts = {}) {
  musicPlayGen += 1;
  musicQueue = [];
  if (!opts.keepGiftKey) musicActiveGiftKey = "";
  clearMusicHookTimer();
  // Stop host-side player (minimized-safe path).
  // Skip when about to play — PlayAsync already kills; a late stop races and cancels the new song.
  if (!opts.skipHostStop) {
    fetch("/api/media/stop", { method: "POST" }).catch(() => {});
  }
  for (const audio of [...musicLiveAudios]) {
    hardStopAudio(audio);
  }
  if (currentAudio) {
    hardStopAudio(currentAudio);
    currentAudio = null;
  }
  if (!opts.silentUi) setNowPlaying("—");
}

async function playSongViaHost(song, token) {
  if (token !== musicPlayGen) return false;
  await ensureAudioOnDisk(song.id);
  if (token !== musicPlayGen) return true;
  const startSec = Math.max(0, Number(song.hookStart) || 0);
  const hookDur = resolveHookDuration(song);
  const volume = musicConfig.volume ?? 0.8;
  const hookText = formatHookLabel(song);
  setNowPlaying(`${song.name} · ${hookText}`);
  try {
    const res = await fetch("/api/media/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: song.id,
        startSec,
        durationSec: hookDur != null && hookDur > 0 ? hookDur : undefined,
        volume,
      }),
    });
    // Stale generation: do NOT call /api/media/stop — a newer song may already be playing.
    if (token !== musicPlayGen) return true;
    const data = await res.json().catch(() => ({}));
    // Cancelled while still current → race/failure, not success (allow Web Audio fallback).
    if (data?.cancelled || data?.error === "cancelled") return false;
    return !!(res.ok && data.ok !== false && data.played !== false);
  } catch {
    return false;
  }
}

async function playSongById(song, token) {
  if (token !== musicPlayGen) return;
  // Prefer host MediaPlayer — keeps playing while main window is minimized.
  const hostOk = await playSongViaHost(song, token);
  if (hostOk || token !== musicPlayGen) return;
  // Fallback: in-page Audio (foreground only).
  const row = await getAudioBlobCached(song.id);
  if (token !== musicPlayGen) return;
  if (!row?.blob) throw new Error(`ไม่พบไฟล์ ${song.name}`);
  const url = URL.createObjectURL(row.blob);
  const startSec = Math.max(0, Number(song.hookStart) || 0);
  const hookDur = resolveHookDuration(song);

  return new Promise((resolve, reject) => {
    if (token !== musicPlayGen) {
      URL.revokeObjectURL(url);
      resolve();
      return;
    }
    clearMusicHookTimer();
    for (const live of [...musicLiveAudios]) {
      hardStopAudio(live);
    }
    currentAudio = null;

    const audio = new Audio();
    audio.preload = "auto";
    audio._blobUrl = url;
    audio.src = url;
    musicLiveAudios.add(audio);
    currentAudio = audio;
    audio.volume = musicConfig.volume ?? 0.8;
    const hookText = formatHookLabel(song);
    setNowPlaying(`${song.name} · ${hookText}`);

    let settled = false;
    const finish = (ok = true, err = null) => {
      if (settled) return;
      settled = true;
      clearMusicHookTimer();
      hardStopAudio(audio);
      if (currentAudio === audio) currentAudio = null;
      if (ok) resolve();
      else reject(err || new Error(`เล่นไม่ได้: ${song.name}`));
    };

    audio.onended = () => finish(true);
    audio.onerror = () => finish(false, new Error(`เล่นไม่ได้: ${song.name}`));

    const armHookTimer = () => {
      if (token !== musicPlayGen) {
        finish(true);
        return;
      }
      if (hookDur != null && hookDur > 0) {
        clearMusicHookTimer();
        musicHookTimer = setTimeout(() => {
          try {
            audio.pause();
          } catch {
            /* ignore */
          }
          finish(true);
        }, hookDur * 1000);
      }
    };

    const applyStartThenPlay = () => {
      if (token !== musicPlayGen) {
        finish(true);
        return;
      }
      const run = () => {
        if (token !== musicPlayGen) {
          finish(true);
          return;
        }
        try {
          if (startSec > 0 && Number.isFinite(audio.duration) && startSec < audio.duration) {
            audio.currentTime = startSec;
          }
        } catch {
          /* ignore */
        }
        audio
          .play()
          .then(() => {
            if (token !== musicPlayGen) {
              finish(true);
              return;
            }
            armHookTimer();
          })
          .catch((err) => {
            if (token !== musicPlayGen) finish(true);
            else finish(false, err);
          });
      };

      if (startSec <= 0) run();
      else if (audio.readyState >= 1) run();
      else audio.addEventListener("loadedmetadata", run, { once: true });
    };

    applyStartThenPlay();
  });
}

async function drainMusicQueue(token) {
  while (musicQueue.length && token === musicPlayGen) {
    const song = musicQueue.shift();
    try {
      await playSongById(song, token);
    } catch (err) {
      if (token !== musicPlayGen) return;
      console.warn(err);
      setNowPlaying(err.message || "เล่นไม่สำเร็จ");
    }
  }
  if (token === musicPlayGen && !musicQueue.length && !currentAudio) {
    musicActiveGiftKey = "";
  }
}

async function playMusicForGift(ruleIdOrGiftName, byId = false) {
  if (!musicConfig.enabled && !byId) return;
  const rule = byId
    ? musicConfig.rules.find((r) => r.id === ruleIdOrGiftName)
    : musicConfig.rules.find(
        (r) =>
          r.enabled !== false &&
          r.giftName.toLowerCase() === String(ruleIdOrGiftName).toLowerCase()
      );
  if (!rule || !rule.songs?.length) return;
  if (rule.enabled === false && !byId) return;

  const giftKey = String(rule.giftName || ruleIdOrGiftName).toLowerCase();
  // ของชิ้นเดิมกำลังโหลด/เล่นอยู่แล้ว — ห้าม stop+โหลดใหม่ (เคยทำให้เพลงมาช้า ~10วิตอนคอมโบ)
  if (!byId && musicActiveGiftKey === giftKey) {
    devLog("music", "skip-same-active", { gift: giftKey });
    return;
  }

  let songs = [];
  if (rule.playMode === "all") {
    songs = [...rule.songs];
  } else if (rule.playMode === "sequence") {
    const idx = musicSeqIndex[rule.id] || 0;
    songs = [rule.songs[idx % rule.songs.length]];
    musicSeqIndex[rule.id] = idx + 1;
  } else {
    songs = [rule.songs[Math.floor(Math.random() * rule.songs.length)]];
  }

  // จอง gift key ก่อน await — กัน gift รัวยิงซ้ำระหว่างโหลดไฟล์
  musicActiveGiftKey = giftKey;
  stopMusic({ keepGiftKey: true, silentUi: true, skipHostStop: true });
  const token = musicPlayGen;
  musicQueue = songs;
  // เริ่มดึงไฟล์ล่วงหน้าทันที
  for (const s of songs) {
    if (s?.id) getAudioBlobCached(s.id).catch(() => {});
  }
  await drainMusicQueue(token);
}

function handleGiftForMusic(parsed) {
  if (!musicConfig.enabled) return;
  if (parsed.kind !== "gift" && parsed.kind !== "like" && parsed.kind !== "follow") return;
  if (!parsed.giftName) return;
  const key = String(parsed.giftName).toLowerCase();
  if (musicActiveGiftKey === key) {
    devLog("music", "skip-same-active", { gift: parsed.giftName, count: parsed.count });
    return;
  }
  devLog("music", "trigger", { gift: parsed.giftName, kind: parsed.kind, count: parsed.count });
  playMusicForGift(parsed.giftName, false);
}

/* ========== Video effects (transparent overlay) ========== */
const VIDEO_KEY = "tgr_video_config";
const VIDEO_CHANNEL = "tgr-video-overlay";
let videoConfig = loadVideoConfig();
let videoPendingClips = [];
let videoSeqIndex = {};
let videoOverlayWin = null;
let videoQueue = [];
let videoPlaying = false;
let videoCompanionAudio = null;
const videoChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(VIDEO_CHANNEL) : null;

function stopVideoCompanionAudio() {
  if (!videoCompanionAudio) return;
  try {
    videoCompanionAudio.pause();
    const u = videoCompanionAudio._blobUrl;
    videoCompanionAudio.src = "";
    if (u) URL.revokeObjectURL(u);
  } catch {
    /* ignore */
  }
  videoCompanionAudio = null;
}

async function playVideoCompanionAudio(id, volume) {
  stopVideoCompanionAudio();
  unlockAudio();
  let blob = null;
  try {
    const row = await getAudioBlob(id);
    if (row?.blob) blob = row.blob;
  } catch {
    /* ignore */
  }
  if (!blob) {
    try {
      const res = await fetch(`/api/video-file/${encodeURIComponent(id)}?t=${Date.now()}`);
      if (res.ok) blob = await res.blob();
    } catch {
      /* ignore */
    }
  }
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio._blobUrl = url;
  audio.volume = typeof volume === "number" ? Math.min(1, Math.max(0, volume)) : 1;
  audio.muted = false;
  videoCompanionAudio = audio;
  audio.onended = () => {
    if (videoCompanionAudio === audio) stopVideoCompanionAudio();
  };
  try {
    await audio.play();
  } catch (err) {
    console.warn("video companion audio", err);
  }
}

function defaultVideoConfig() {
  return { enabled: true, volume: 1, followGame: false, overlayMode: "chroma", fullscreen: false, clickThrough: false, rules: [] };
}

function loadVideoConfig() {
  try {
    const raw = localStorage.getItem(VIDEO_KEY);
    if (!raw) return defaultVideoConfig();
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      volume: typeof parsed.volume === "number" ? parsed.volume : 1,
      followGame: !!parsed.followGame,
      overlayMode: parsed.overlayMode === "clear" ? "clear" : "chroma",
      fullscreen: !!parsed.fullscreen,
      clickThrough: !!parsed.clickThrough,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return defaultVideoConfig();
  }
}

function saveVideoConfig() {
  localStorage.setItem(VIDEO_KEY, JSON.stringify(videoConfig));
  renderVideoRules();
  renderGiftActionOverview();
}

function setVideoStatus(msg) {
  const el = document.getElementById("videoNowPlaying");
  if (el) el.textContent = msg || "—";
}

function postOverlayCommand(cmd) {
  const payload = { ...cmd, at: Date.now() };
  try {
    localStorage.setItem("tgr_video_overlay_cmd", JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  videoChannel?.postMessage(payload);
  // Reliable path across separate WebView windows
  fetch("/api/video-overlay/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

const videoOnDiskOk = new Set();

async function ensureVideoOnDisk(id) {
  if (!id) return false;
  if (videoOnDiskOk.has(id)) return true;
  try {
    const still = await fetch(`/defaults/interrupt/files/${encodeURIComponent(id)}.png`, { method: "HEAD" });
    if (still.ok) {
      videoOnDiskOk.add(id);
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    // ขอแค่ไบต์แรก — ห้าม GET ทั้งไฟล์ (เคยทำให้แอปหน่วงหนักก่อนขัดขวาง)
    const head = await fetch(`/api/video-file/${encodeURIComponent(id)}`, {
      headers: { Range: "bytes=0-0" },
    });
    if (head.ok || head.status === 206) {
      try {
        await head.body?.cancel?.();
      } catch {
        /* ignore */
      }
      videoOnDiskOk.add(id);
      return true;
    }
  } catch {
    /* ignore */
  }
  const row = await getAudioBlob(id);
  if (!row?.blob) return false;
  const buf = await row.blob.arrayBuffer();
  const res = await fetch(`/api/video-cache/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": row.mime || row.blob.type || "video/mp4",
      "X-File-Name": encodeURIComponent(row.name || id),
    },
    body: buf,
  });
  if (res.ok) videoOnDiskOk.add(id);
  return res.ok;
}

async function waitOverlayReady(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`/api/video-overlay/status?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.open) {
          let st = null;
          try {
            st = data.lastStatus ? JSON.parse(data.lastStatus) : null;
          } catch {
            st = null;
          }
          if (!st || st.state === "ready" || st.state === "idle" || st.state === "playing" || st.state === "error") {
            return true;
          }
        }
      }
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function openVideoOverlay() {
  const follow = !!document.getElementById("videoFollowGame")?.checked;
  const fullscreen = !!document.getElementById("videoFullscreen")?.checked;
  const clickThrough = !!document.getElementById("videoClickThrough")?.checked;
  const mode = document.getElementById("videoOverlayMode")?.value || videoConfig.overlayMode || "chroma";
  videoConfig.followGame = follow;
  videoConfig.fullscreen = fullscreen;
  videoConfig.clickThrough = clickThrough;
  videoConfig.overlayMode = mode === "clear" ? "clear" : "chroma";
  saveVideoConfig();

  let openedNative = false;
  try {
    const q = new URLSearchParams();
    if (follow) q.set("followGame", "1");
    if (fullscreen) q.set("fullscreen", "1");
    if (clickThrough) q.set("clickThrough", "1");
    q.set("mode", videoConfig.overlayMode);
    const res = await fetch(`/api/video-overlay/open?${q.toString()}`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      openedNative = !!data.open || data.ok;
    }
  } catch {
    openedNative = false;
  }

  if (!openedNative) {
    const url = `/overlay.html?mode=${encodeURIComponent(videoConfig.overlayMode)}&v=chroma4`;
    if (!videoOverlayWin || videoOverlayWin.closed) {
      videoOverlayWin = window.open(url, "monkeyeffect_video_overlay", "popup=yes,width=405,height=720");
    } else {
      videoOverlayWin.focus();
    }
  }

  setTimeout(() => postOverlayCommand({ type: "ping" }), 500);
  setVideoStatus(
    openedNative
      ? "เปิดหน้าต่างวิดีโอแล้ว — ลากแถบหัว / ย่อ / ขยายได้"
      : "เปิดแบบ popup แล้ว"
  );
}

async function closeVideoOverlay() {
  postOverlayCommand({ type: "stop" });
  stopVideoCompanionAudio();
  try {
    await fetch("/api/video-overlay/close", { method: "POST" });
  } catch {
    /* ignore */
  }
  if (videoOverlayWin && !videoOverlayWin.closed) {
    try {
      videoOverlayWin.close();
    } catch {
      /* ignore */
    }
  }
  videoOverlayWin = null;
  videoQueue = [];
  videoPlaying = false;
  setVideoStatus("ปิดหน้าต่างแล้ว");
}

function stopVideoEffect() {
  videoQueue = [];
  videoPlaying = false;
  stopVideoCompanionAudio();
  postOverlayCommand({ type: "stop" });
  setVideoStatus("หยุดวิดีโอแล้ว — หน้าต่างพร้อม");
}

function renderVideoUiState() {
  const enabledEl = document.getElementById("videoEnabled");
  const volumeEl = document.getElementById("videoVolume");
  const volumeLabel = document.getElementById("videoVolumeLabel");
  const followEl = document.getElementById("videoFollowGame");
  const modeEl = document.getElementById("videoOverlayMode");
  const fullEl = document.getElementById("videoFullscreen");
  const clickEl = document.getElementById("videoClickThrough");
  if (enabledEl) enabledEl.checked = !!videoConfig.enabled;
  if (volumeEl) volumeEl.value = String(Math.round((videoConfig.volume ?? 1) * 100));
  if (volumeLabel) volumeLabel.textContent = String(Math.round((videoConfig.volume ?? 1) * 100));
  if (followEl) followEl.checked = !!videoConfig.followGame;
  if (modeEl) modeEl.value = videoConfig.overlayMode === "clear" ? "clear" : "chroma";
  if (fullEl) fullEl.checked = !!videoConfig.fullscreen;
  if (clickEl) clickEl.checked = !!videoConfig.clickThrough;
  renderVideoPending();
  renderVideoRules();
}

function renderVideoPending() {
  const el = document.getElementById("videoPendingList");
  if (!el) return;
  if (!videoPendingClips.length) {
    el.innerHTML = '<div class="empty-hint">ยังไม่มีคลิป — เลือกไฟล์แล้วกด “เพิ่มไฟล์”</div>';
    return;
  }
  el.innerHTML = videoPendingClips
    .map(
      (c, i) => `
      <div class="song-item">
        <div class="song-main">
          <span class="song-name">${escapeHtml(c.name)}</span>
          <span class="chip">วิดีโอ</span>
        </div>
        <div class="rule-actions">
          <button type="button" class="btn ghost small" data-video-preview="${i}">▶ ดูตัวอย่าง</button>
          <button type="button" class="btn ghost small danger" data-remove-video-pending="${i}">ลบ</button>
        </div>
      </div>`
    )
    .join("");
  el.querySelectorAll("[data-remove-video-pending]").forEach((btn) => {
    btn.addEventListener("click", () => {
      videoPendingClips.splice(Number(btn.dataset.removeVideoPending), 1);
      renderVideoPending();
    });
  });
  el.querySelectorAll("[data-video-preview]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const clip = videoPendingClips[Number(btn.dataset.videoPreview)];
      if (!clip) return;
      openVideoOverlay()
        .then(async () => {
          await waitOverlayReady(8000);
          await ensureVideoOnDisk(clip.id);
          const vol = videoConfig.volume ?? 1;
          playVideoCompanionAudio(clip.id, vol).catch(() => {});
          postOverlayCommand({ type: "play", id: clip.id, volume: 0, muted: true });
          setVideoStatus(`ตัวอย่าง: ${clip.name}`);
        })
        .catch((e) => alert(e.message || e));
    });
  });
}

function renderVideoRules() {
  const list = document.getElementById("videoRulesList");
  const count = document.getElementById("videoRuleCount");
  if (count) count.textContent = `${videoConfig.rules.length} กฎ`;
  if (!list) return;
  if (!videoConfig.rules.length) {
    list.innerHTML = '<div class="empty-hint">ยังไม่มีกฎวิดีโอ — เพิ่มด้านบนได้เลย</div>';
    return;
  }
  list.innerHTML = videoConfig.rules
    .map((rule) => {
      const clips = (rule.videos || []).map((v) => escapeHtml(v.name)).join(", ") || "ไม่มีคลิป";
      const modeLabel =
        rule.playMode === "all" ? "เล่นทุกคลิป" : rule.playMode === "sequence" ? "ตามลำดับ" : "สุ่ม";
      return `
        <div class="rule-card ${rule.enabled === false ? "disabled" : ""}">
          <div class="rule-main">
            <div class="rule-title">
              <strong>${escapeHtml(rule.giftName)}</strong>
              <span class="chip">${modeLabel}</span>
              ${rule.enabled === false ? '<span class="chip warn">ปิดอยู่</span>' : ""}
            </div>
            <div class="rule-meta">${(rule.videos || []).length} คลิป · ${clips}</div>
          </div>
          <div class="rule-actions">
            <button type="button" class="btn ghost small" data-video-toggle="${rule.id}">${rule.enabled === false ? "เปิด" : "ปิด"}</button>
            <button type="button" class="btn secondary small" data-video-test="${rule.id}">ทดสอบ</button>
            <button type="button" class="btn ghost small" data-video-edit="${rule.id}">แก้ไข</button>
            <button type="button" class="btn ghost small danger" data-video-del="${rule.id}">ลบ</button>
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-video-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rule = videoConfig.rules.find((r) => r.id === btn.dataset.videoToggle);
      if (!rule) return;
      rule.enabled = rule.enabled === false;
      saveVideoConfig();
    });
  });
  list.querySelectorAll("[data-video-test]").forEach((btn) => {
    btn.addEventListener("click", () => playVideoForGift(btn.dataset.videoTest, true));
  });
  list.querySelectorAll("[data-video-edit]").forEach((btn) => {
    btn.addEventListener("click", () => editVideoRule(btn.dataset.videoEdit));
  });
  list.querySelectorAll("[data-video-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteVideoRule(btn.dataset.videoDel));
  });
}

function resetVideoEditor() {
  document.getElementById("videoEditId").value = "";
  document.getElementById("videoGiftName").value = "";
  document.getElementById("videoPlayMode").value = "random";
  document.getElementById("videoFiles").value = "";
  videoPendingClips = [];
  document.getElementById("videoRuleMode").textContent = "เพิ่มใหม่";
  renderVideoPending();
}

function editVideoRule(id) {
  const rule = videoConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  document.getElementById("videoEditId").value = rule.id;
  document.getElementById("videoGiftName").value = rule.giftName || "";
  document.getElementById("videoPlayMode").value = rule.playMode || "random";
  document.getElementById("videoRuleMode").textContent = "กำลังแก้ไข";
  videoPendingClips = (rule.videos || []).map((v) => ({
    id: v.id,
    name: v.name,
    existing: true,
  }));
  renderVideoPending();
  document.querySelector('.nav-btn[data-panel="video"]')?.click();
}

async function deleteVideoRule(id) {
  const rule = videoConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  if (!confirm(`ลบกฎวิดีโอของ “${rule.giftName}” ?`)) return;
  for (const v of rule.videos || []) {
    try {
      await deleteAudioBlob(v.id);
    } catch {
      /* ignore */
    }
    try {
      await fetch(`/api/video-cache/${encodeURIComponent(v.id)}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }
  videoConfig.rules = videoConfig.rules.filter((r) => r.id !== id);
  saveVideoConfig();
  if (document.getElementById("videoEditId").value === id) resetVideoEditor();
}

async function addSelectedVideoFiles() {
  const input = document.getElementById("videoFiles");
  const files = Array.from(input.files || []);
  if (!files.length) {
    alert("เลือกไฟล์วิดีโอก่อน");
    return;
  }
  for (const file of files) {
    const id = uid();
    await saveAudioBlob(id, file, file.name, file.type || "video/mp4");
    // mirror to disk so overlay window (native) can fetch even if IndexedDB profile differs
    try {
      await cacheVideoToDisk(id, file);
    } catch (err) {
      console.warn("cacheVideoToDisk", err);
    }
    videoPendingClips.push({ id, name: file.name, existing: true });
  }
  input.value = "";
  renderVideoPending();
}

async function cacheVideoToDisk(id, file) {
  const buf = await file.arrayBuffer();
  const res = await fetch(`/api/video-cache/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || id),
    },
    body: buf,
  });
  if (!res.ok) throw new Error("บันทึกแคชวิดีโอไม่สำเร็จ");
  videoOnDiskOk.add(id);
}

async function saveVideoRule() {
  const giftName = document.getElementById("videoGiftName").value.trim();
  if (!giftName) {
    alert("ใส่ชื่อของขวัญก่อน");
    return;
  }
  if (!videoPendingClips.length) {
    alert("เพิ่มไฟล์วิดีโออย่างน้อย 1 คลิป");
    return;
  }
  const playMode = document.getElementById("videoPlayMode").value || "random";
  const videos = videoPendingClips.map((v) => ({ id: v.id, name: v.name }));
  const editId = document.getElementById("videoEditId").value;
  if (editId) {
    const rule = videoConfig.rules.find((r) => r.id === editId);
    if (!rule) return;
    rule.giftName = giftName;
    rule.playMode = playMode;
    rule.videos = videos;
  } else {
    videoConfig.rules.push({
      id: uid(),
      giftName,
      playMode,
      enabled: true,
      videos,
    });
  }
  saveVideoConfig();
  resetVideoEditor();
}

async function drainVideoQueue() {
  if (videoPlaying) return;
  videoPlaying = true;
  while (videoQueue.length) {
    const clip = videoQueue.shift();
    try {
      const ok = await ensureVideoOnDisk(clip.id);
      if (!ok) {
        setVideoStatus(`ไม่พบไฟล์: ${clip.name} — เพิ่มไฟล์ใหม่`);
        continue;
      }
    } catch (e) {
      console.warn(e);
    }
    setVideoStatus(`กำลังแสดง: ${clip.name}`);
    const vol = videoConfig.volume ?? 1;
    // ภาพที่หน้าต่างเขียว (เงียบ) + เสียงจากโปรแกรมหลัก (ได้ยิน/จับเสียงไลฟ์ได้)
    playVideoCompanionAudio(clip.id, vol).catch(() => {});
    postOverlayCommand({ type: "play", id: clip.id, volume: 0, muted: true });
    await waitOverlayIdle(120000);
    stopVideoCompanionAudio();
  }
  videoPlaying = false;
  setVideoStatus("พร้อม — รอของขวัญ");
}

function waitOverlayIdle(timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let sawPlaying = false;
    const finish = () => {
      if (done) return;
      done = true;
      videoChannel?.removeEventListener("message", onMsg);
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/video-overlay/status?t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        let st = null;
        try {
          st = data.lastStatus ? JSON.parse(data.lastStatus) : null;
        } catch {
          st = null;
        }
        if (!st) return;
        if (st.state === "playing") sawPlaying = true;
        if (sawPlaying && (st.state === "idle" || st.state === "error" || st.state === "closed")) finish();
        if (st.state === "error") {
          setVideoStatus(`ผิดพลาด: ${st.error || ""}`);
          finish();
        }
      } catch {
        /* ignore */
      }
    };
    const onMsg = (ev) => {
      const d = ev.data;
      if (d?.type !== "overlay-status") return;
      if (d.state === "playing") sawPlaying = true;
      if (sawPlaying && (d.state === "idle" || d.state === "error" || d.state === "closed")) finish();
    };
    videoChannel?.addEventListener("message", onMsg);
    const poll = setInterval(checkStatus, 300);
    const timer = setTimeout(finish, timeoutMs);
    checkStatus();
  });
}

async function playVideoForGift(ruleIdOrGiftName, byId = false) {
  if (!videoConfig.enabled && !byId) return;
  const rule = byId
    ? videoConfig.rules.find((r) => r.id === ruleIdOrGiftName)
    : videoConfig.rules.find(
        (r) =>
          r.enabled !== false &&
          r.giftName.toLowerCase() === String(ruleIdOrGiftName).toLowerCase()
      );
  if (!rule || !rule.videos?.length) return;
  if (rule.enabled === false && !byId) return;

  let clips = [];
  if (rule.playMode === "all") {
    clips = [...rule.videos];
  } else if (rule.playMode === "sequence") {
    const idx = videoSeqIndex[rule.id] || 0;
    clips = [rule.videos[idx % rule.videos.length]];
    videoSeqIndex[rule.id] = idx + 1;
  } else {
    clips = [rule.videos[Math.floor(Math.random() * rule.videos.length)]];
  }

  setVideoStatus("กำลังเปิดหน้าต่างวิดีโอ...");
  await openVideoOverlay();
  await waitOverlayReady(10000);

  for (const clip of clips) {
    try {
      await ensureVideoOnDisk(clip.id);
    } catch {
      /* ignore */
    }
  }

  videoQueue = clips;
  videoPlaying = false;
  postOverlayCommand({ type: "stop" });
  await new Promise((r) => setTimeout(r, 400));
  await drainVideoQueue();
}

function handleGiftForVideo(parsed) {
  if (!videoConfig.enabled) return;
  if (parsed.kind !== "gift" && parsed.kind !== "like" && parsed.kind !== "follow") return;
  if (!parsed.giftName) return;
  devLog("video", "trigger", { gift: parsed.giftName, kind: parsed.kind, count: parsed.count });
  playVideoForGift(parsed.giftName, false);
}

videoChannel?.addEventListener("message", (ev) => {
  const d = ev.data;
  if (d?.type !== "overlay-status") return;
  if (d.state === "ready") setVideoStatus("หน้าต่างใสพร้อม (ว่าง)");
  if (d.state === "playing") setVideoStatus(`กำลังแสดง: ${d.name || "วิดีโอ"}`);
  if (d.state === "idle") setVideoStatus("พร้อม — รอของขวัญ");
  if (d.state === "closed") setVideoStatus("หน้าต่างใสถูกปิด");
  if (d.state === "error") setVideoStatus(`ผิดพลาด: ${d.error || ""}`);
});

/* ========== Screen interrupt (fullscreen video / fake error) ========== */
const INTERRUPT_KEY = "tgr_interrupt_config";
let interruptConfig = loadInterruptConfig();
let interruptPendingClips = [];
let interruptSeqIndex = {};
let interruptBusy = false;
let interruptQueue = [];
/** @type {Record<string, number>} กันเหตุการณ์ของขวัญซ้ำจากล็อกคู่ (CDP+WS) */
let interruptEventDedupeAt = {};
/** กันเฉพาะเฟรมซ้ำจริง — ใช้ seq จากล็อกเป็นหลัก */
const INTERRUPT_EVENT_DEDUPE_MS = 250;
/** Soft cap — never drop units; xN enqueue = N plays (exact) */
const INTERRUPT_QUEUE_SOFT = 500;
let interruptPlaySeq = 0;
/** นับยอดยิงจริงเพื่อเทียบกับของที่รับ */
let interruptReceivedTotal = 0;
let interruptEnqueuedTotal = 0;

/**
 * Solo / no backlog → null (play full trim start–end).
 * Combo / queue backlog → shorten so every unit still plays (exact, no drop, no extra).
 */
function interruptCatchUpMaxMs(remainingAfterThis, { isCombo = false, trimMs = 0 } = {}) {
  // User wants sequential full clips (one after another) — never shorten / overlap.
  return null;
}

function estimateInterruptQueuePlays() {
  let n = 0;
  for (const j of interruptQueue) {
    n += Number(j?.expectedPlays) || Math.max(1, (j?.clips?.length || 1) * (j?.repeats || 1));
  }
  return n;
}

function interruptJobPlayTotal(job) {
  if (!job) return 1;
  if (Number(job.expectedPlays) > 0) return Number(job.expectedPlays);
  return Math.max(1, (job.clips?.length || 1) * (job.repeats || 1));
}

/** Job currently draining — same-gift units append here so rapid x1s become one combo. */
let interruptActiveJob = null;

/** Coalesce rapid game-finalize lines for the same rule (TikTok often sends x1+x1… not xN). */
const interruptCoalesce = new Map();
const INTERRUPT_COALESCE_MS = 800;

/** Normalize gift names so "little Hippo" matches "Baby Hippo", etc. */
function normalizeInterruptGiftKey(name) {
  let s = String(name || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases = {
    "baby hippo": "hippo",
    "little hippo": "hippo",
    "hippo": "hippo",
    rose: "rose",
    "กุหลาบ": "rose",
    rosa: "rosa",
  };
  return aliases[s] || s;
}

function interruptGiftMatches(ruleGiftName, parsedGiftName) {
  const a = normalizeInterruptGiftKey(ruleGiftName);
  const b = normalizeInterruptGiftKey(parsedGiftName);
  return !!a && !!b && a === b;
}

function defaultInterruptConfig() {
  return {
    enabled: false,
    volume: 1,
    screen: "auto",
    underLiveStudio: true,
    avoidLiveStudio: false,
    rules: [],
  };
}

function loadInterruptConfig() {
  try {
    const raw = localStorage.getItem(INTERRUPT_KEY);
    if (!raw) return defaultInterruptConfig();
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      volume: Math.min(1, Math.max(0, Number(parsed.volume ?? 1))),
      screen: parsed.screen === undefined || parsed.screen === null ? "auto" : parsed.screen,
      underLiveStudio: parsed.underLiveStudio !== false,
      // default off for single-monitor; only use when user has 2 displays
      avoidLiveStudio: !!parsed.avoidLiveStudio,
      rules: Array.isArray(parsed.rules)
        ? parsed.rules.map((r) => {
            const trigger = ["like", "follow"].includes(String(r?.trigger || "").toLowerCase())
              ? String(r.trigger).toLowerCase()
              : "gift";
            let giftName = String(r?.giftName || "").trim();
            if (trigger === "like") giftName = "Like";
            if (trigger === "follow") giftName = "Follow";
            return {
              ...r,
              trigger,
              giftName,
            };
          })
        : [],
    };
  } catch {
    return defaultInterruptConfig();
  }
}

function saveInterruptConfig() {
  localStorage.setItem(INTERRUPT_KEY, JSON.stringify(interruptConfig));
  renderInterruptRules();
  syncInterruptUi();
  renderGiftActionOverview();
}

const INTERRUPT_DEFAULTS_PACK_KEY = "tgr_interrupt_defaults_pack_version";

async function applyDefaultInterruptPack({ force = false } = {}) {
  if (!force) {
    try {
      const raw = localStorage.getItem(INTERRUPT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.rules) && parsed.rules.length > 0) {
          return { ok: false, reason: "exists" };
        }
      }
    } catch {
      /* continue */
    }
    if (localStorage.getItem("tgr_interrupt_defaults_seeded") === "1") {
      return { ok: false, reason: "seeded" };
    }
  }

  const res = await fetch(`/defaults/interrupt/config.json?t=${Date.now()}`);
  if (!res.ok) throw new Error("ไม่พบแพ็กขัดขวางเริ่มต้นในโปรแกรม");
  const pack = await res.json();
  if (!pack || !Array.isArray(pack.rules) || !pack.rules.length) {
    throw new Error("แพ็กขัดขวางเริ่มต้นว่าง");
  }

  let imported = 0;
  let missing = 0;
  for (const rule of pack.rules) {
    for (const v of rule.videos || []) {
      if (!v?.id) continue;
      if (!force) {
        const existing = await getAudioBlob(v.id);
        if (existing?.blob) continue;
      }
      let blobRes = await fetch(`/defaults/interrupt/files/${encodeURIComponent(v.id)}.png`);
      if (!blobRes.ok) {
        blobRes = await fetch(`/defaults/interrupt/files/${encodeURIComponent(v.id)}.mp4`);
      }
      if (!blobRes.ok) {
        blobRes = await fetch(`/defaults/interrupt/files/${encodeURIComponent(v.id)}.qt`);
      }
      if (!blobRes.ok) {
        blobRes = await fetch(`/defaults/interrupt/files/${encodeURIComponent(v.id)}.webm`);
      }
      if (!blobRes.ok) {
        blobRes = await fetch(`/api/video-file/${encodeURIComponent(v.id)}`);
      }
      if (!blobRes.ok) {
        missing++;
        continue;
      }
      const blob = await blobRes.blob();
      const mime = blobRes.headers.get("content-type") || "video/mp4";
      const file = new File([blob], v.name || `${v.id}.mp4`, { type: mime });
      await saveAudioBlob(v.id, file, file.name, mime);
      try {
        await cacheVideoToDisk(v.id, file);
      } catch (err) {
        console.warn("cacheVideoToDisk defaults", err);
      }
      imported++;
    }
  }

  interruptConfig = {
    enabled: pack.enabled !== false,
    volume: typeof pack.volume === "number" ? pack.volume : 1,
    screen: pack.screen === undefined || pack.screen === null ? "auto" : pack.screen,
    underLiveStudio: pack.underLiveStudio !== false,
    avoidLiveStudio: !!pack.avoidLiveStudio,
    rules: pack.rules.map((r) => normalizeInterruptRule(r)),
  };
  saveInterruptConfig();
  localStorage.setItem("tgr_interrupt_defaults_seeded", "1");
  const packVer = String(pack.packVersion || pack.exportedAt || "");
  if (packVer) localStorage.setItem(INTERRUPT_DEFAULTS_PACK_KEY, packVer);
  resetInterruptEditor();
  return { ok: true, rules: interruptConfig.rules.length, imported, missing, packVersion: packVer };
}

function normalizeInterruptTrigger(value) {
  const t = String(value || "gift").toLowerCase();
  if (t === "like" || t === "follow") return t;
  return "gift";
}

function normalizeInterruptKind(value) {
  const k = String(value || "video").toLowerCase();
  if (k === "error" || k === "close-game") return k;
  return "video";
}

function normalizeInterruptRule(r) {
  const trigger = normalizeInterruptTrigger(r?.trigger);
  let giftName = String(r?.giftName || "").trim();
  if (trigger === "like") giftName = "Like";
  if (trigger === "follow") giftName = "Follow";
  return {
    id: r?.id || uid(),
    trigger,
    giftName,
    kind: normalizeInterruptKind(r?.kind),
    enabled: r?.enabled !== false,
    playMode: r?.playMode || "sequence",
    videos: (r?.videos || []).map((v) => ({
      id: v.id,
      name: v.name,
      duration: Number(v.duration) || 0,
      startSec: Number(v.startSec) || 0,
      endSec: v.endSec == null ? null : Number(v.endSec),
    })),
    errorTitle: r?.errorTitle || "Windows",
    errorMessage:
      r?.errorMessage || "An unexpected error has occurred.\nPlease click OK to continue.",
    errorCode: r?.errorCode || "",
  };
}

/** Write current interrupt rules + clips into wwwroot/defaults/interrupt for Setup bundling. */
async function exportInterruptDefaultsPack() {
  const videos = [];
  const seen = new Set();
  for (const rule of interruptConfig.rules || []) {
    for (const v of rule.videos || []) {
      if (!v?.id || seen.has(v.id)) continue;
      seen.add(v.id);
      videos.push(v);
    }
  }
  let exported = 0;
  const missing = [];
  for (const v of videos) {
    const row = await getAudioBlob(v.id);
    if (!row?.blob) {
      missing.push(v.name || v.id);
      continue;
    }
    const buf = await row.blob.arrayBuffer();
    const res = await fetch(`/api/defaults/interrupt/file/${encodeURIComponent(v.id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": row.mime || row.blob.type || "video/mp4",
        "X-File-Name": encodeURIComponent(row.name || v.name || `${v.id}.mp4`),
      },
      body: buf,
    });
    if (!res.ok) throw new Error(`export interrupt file failed: ${v.id}`);
    exported++;
  }
  const pack = {
    version: 1,
    packVersion: "1.0.5.2",
    replaceOnUpdate: true,
    exportedAt: new Date().toISOString(),
    enabled: interruptConfig.enabled !== false,
    volume: typeof interruptConfig.volume === "number" ? interruptConfig.volume : 1,
    screen: interruptConfig.screen === undefined || interruptConfig.screen === null ? "auto" : interruptConfig.screen,
    underLiveStudio: interruptConfig.underLiveStudio !== false,
    avoidLiveStudio: !!interruptConfig.avoidLiveStudio,
    rules: (interruptConfig.rules || []).map((r) => normalizeInterruptRule(r)),
  };
  const cfgRes = await fetch("/api/defaults/interrupt/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pack, null, 2),
  });
  if (!cfgRes.ok) throw new Error("export interrupt config failed");
  await fetch("/api/defaults/interrupt/export-flag/clear", { method: "POST" }).catch(() => {});
  return { ok: true, rules: pack.rules.length, files: exported, missing };
}

async function saveInterruptDefaultsFromButton() {
  const btn = document.getElementById("interruptSaveDefaultsBtn");
  if (!(interruptConfig.rules || []).length) {
    alert("ยังไม่มีกฎขัดขวางให้บันทึก — เพิ่มกฎก่อน");
    return;
  }
  if (
    !confirm(
      "บันทึกกฎขัดขวาง + คลิปที่ตัดไว้ตอนนี้ เป็นค่าตั้งต้นในโปรแกรม?\nเครื่องใหม่ / ติดตั้งใหม่ / กด «ใช้ตั้งค่าเริ่มต้น» จะได้ค่าชุดนี้"
    )
  ) {
    return;
  }
  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังบันทึก…";
  }
  try {
    const result = await exportInterruptDefaultsPack();
    alert(
      `บันทึกเป็นค่าตั้งต้นแล้ว\nกฎ: ${result.rules}\nไฟล์: ${result.files}` +
        (result.missing?.length ? `\nขาดไฟล์: ${result.missing.join(", ")}` : "")
    );
  } catch (err) {
    alert("บันทึกค่าตั้งต้นไม่สำเร็จ: " + (err?.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "บันทึกเป็นค่าตั้งต้น";
    }
  }
}

async function maybeExportInterruptDefaultsFromFlag() {
  try {
    const res = await fetch(`/api/defaults/interrupt/export-flag?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.export) return;
    const result = await exportInterruptDefaultsPack();
    console.info("[interrupt] exported defaults pack", result);
    alert(
      `ส่งออกแพ็กขัดขวางเริ่มต้นแล้ว\nกฎ: ${result.rules}\nไฟล์: ${result.files}` +
        (result.missing?.length ? `\nขาดไฟล์: ${result.missing.join(", ")}` : "")
    );
  } catch (err) {
    console.warn("[interrupt] export defaults failed", err);
    alert("ส่งออกแพ็กขัดขวางไม่สำเร็จ: " + (err?.message || err));
  }
}

function toggleInterruptTriggerFields() {
  const trigger = normalizeInterruptTrigger(document.getElementById("interruptTrigger")?.value);
  const wrap = document.getElementById("interruptGiftNameWrap");
  const nameEl = document.getElementById("interruptGiftName");
  if (wrap) wrap.classList.toggle("hidden", trigger !== "gift");
  if (nameEl && trigger === "like") nameEl.value = "Like";
  if (nameEl && trigger === "follow") nameEl.value = "Follow";
}

function interruptTriggerLabel(trigger) {
  if (trigger === "like") return "Like";
  if (trigger === "follow") return "ติดตาม";
  return "ของขวัญ";
}

function refreshInterruptProgressStatus() {
  if (!interruptConfig.enabled) return;
  if (interruptBusy) return;
  setInterruptStatus("พร้อม — รอของขวัญ / Like / ติดตาม");
}

async function seedDefaultInterruptIfNeeded() {
  try {
    // แพ็กจากอัปเดตที่ตั้ง replaceOnUpdate → ทับค่าเครื่องเก่าทั้งก้อน
    try {
      const peek = await fetch(`/defaults/interrupt/config.json?t=${Date.now()}`);
      if (peek.ok) {
        const pack = await peek.json();
        const packVer = String(pack?.packVersion || "");
        const applied = localStorage.getItem(INTERRUPT_DEFAULTS_PACK_KEY) || "";
        if (pack?.replaceOnUpdate && packVer && packVer !== applied) {
          const forced = await applyDefaultInterruptPack({ force: true });
          if (forced.ok) {
            console.info(
              `[interrupt] replaced with pack ${packVer} (${forced.rules} rules, ${forced.imported} files)`
            );
            return true;
          }
        }
      }
    } catch (err) {
      console.warn("[interrupt] replaceOnUpdate peek failed", err);
    }

    const result = await applyDefaultInterruptPack({ force: false });
    if (result.ok) {
      console.info(`[interrupt] seeded ${result.rules} default gift→interrupt rules`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[interrupt] seed defaults failed", err);
    return false;
  }
}

async function restoreDefaultInterruptPackFromButton() {
  const btn = document.getElementById("interruptRestoreDefaultsBtn");
  const hasRules = (interruptConfig.rules || []).length > 0;
  const msg = hasRules
    ? "ใช้การตั้งค่าเริ่มต้นแทนของปัจจุบัน?\nจะแทนที่กฎขัดขวางทั้งหมดด้วยแพ็กที่มากับโปรแกรม (ชื่อของขวัญ + คลิปที่ตัดไว้)"
    : "โหลดการตั้งค่าขัดขวางเริ่มต้นเข้ามาใช้เลยไหม?";
  if (!confirm(msg)) return;

  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังโหลด…";
  }
  try {
    const result = await applyDefaultInterruptPack({ force: true });
    alert(
      `โหลดแพ็กขัดขวางเริ่มต้นแล้ว\nกฎ: ${result.rules}\nไฟล์: ${result.imported}` +
        (result.missing ? `\nขาดไฟล์: ${result.missing}` : "")
    );
  } catch (err) {
    alert("โหลดแพ็กเริ่มต้นไม่สำเร็จ: " + (err?.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "ใช้ตั้งค่าเริ่มต้น";
    }
  }
}

function setInterruptStatus(text) {
  const el = document.getElementById("interruptNowPlaying");
  if (el) el.textContent = text;
}

function syncInterruptUi() {
  const enabledEl = document.getElementById("interruptEnabled");
  const volumeEl = document.getElementById("interruptVolume");
  const volumeLabel = document.getElementById("interruptVolumeLabel");
  const screenEl = document.getElementById("interruptScreen");
  const avoidEl = document.getElementById("interruptAvoidStudio");
  const underEl = document.getElementById("interruptUnderStudio");
  if (enabledEl) enabledEl.checked = !!interruptConfig.enabled;
  if (volumeEl) volumeEl.value = String(Math.round((interruptConfig.volume ?? 1) * 100));
  if (volumeLabel) volumeLabel.textContent = String(Math.round((interruptConfig.volume ?? 1) * 100));
  if (underEl) underEl.checked = interruptConfig.underLiveStudio !== false;
  if (avoidEl) avoidEl.checked = !!interruptConfig.avoidLiveStudio;
  if (screenEl) {
    const want = String(interruptConfig.screen ?? "auto");
    if ([...screenEl.options].some((o) => o.value === want)) screenEl.value = want;
    else screenEl.value = "auto";
  }
  if (interruptConfig.enabled) refreshInterruptProgressStatus();
  else setInterruptStatus("ยังไม่เปิดใช้");
}

async function refreshInterruptScreens() {
  const sel = document.getElementById("interruptScreen");
  const hint = document.getElementById("interruptScreenHint");
  try {
    const res = await fetch(`/api/interrupt-overlay/screens?t=${Date.now()}`);
    const data = await res.json();
    if (!sel) return;
    const current = String(interruptConfig.screen ?? "auto");
    sel.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "อัตโนมัติ — หลีกเลี่ยงจอ LIVE Studio";
    sel.appendChild(auto);
    for (const s of data.screens || []) {
      const opt = document.createElement("option");
      opt.value = String(s.index);
      opt.textContent = s.label || `จอ ${s.index + 1}`;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    else sel.value = "auto";

    if (hint) {
      if (data.liveStudioFound) {
        hint.textContent =
          (data.count || 0) <= 1
            ? "พบ LIVE Studio (จอเดียว) · ติ๊ก “อยู่ชั้นต่ำกว่า Studio” แล้วอ่านแชทได้ขณะขัดขวาง"
            : "พบ LIVE Studio · จอเดียวใช้ชั้นต่ำกว่า Studio / สองจอใช้หลีกเลี่ยงจอ Studio";
      } else if ((data.count || 0) <= 1) {
        hint.textContent =
          "จอเดียว — เปิด TikTok LIVE Studio ไว้ก่อนทดสอบ · ขัดขวางจะอยู่ใต้ Studio อัตโนมัติ";
      } else {
        hint.textContent = `พบ ${data.count} จอ · เปิด LIVE Studio แล้วกดรีเฟรช`;
      }
    }
  } catch {
    if (hint) hint.textContent = "อ่านรายการจอไม่สำเร็จ";
  }
}

async function postInterruptCommand(payload) {
  // ส่งเข้าคิว API แล้วรอให้เข้า bus ก่อน — กัน wait idle เร็วเกินไป
  const body = { ...payload, at: Date.now() };
  devLog("interrupt.cmd", payload?.type || "cmd", {
    type: payload?.type,
    name: payload?.name,
    id: payload?.id,
  });
  try {
    await fetch("/api/interrupt-overlay/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignore */
  }
}

async function openInterruptOverlay({ popup = false, recreate = false } = {}) {
  const t0 = Date.now();
  const q = new URLSearchParams();
  const screen = interruptConfig.screen;
  if (screen !== "auto" && screen !== "" && screen != null && Number(screen) >= 0) {
    q.set("screen", String(Number(screen)));
  }
  q.set("avoidLiveStudio", interruptConfig.avoidLiveStudio ? "true" : "false");
  // popup error ไม่ต้องเจาะช่อง LIVE Studio
  q.set("underLiveStudio", popup ? "false" : interruptConfig.underLiveStudio !== false ? "true" : "false");
  if (popup) q.set("mode", "popup");
  if (recreate) q.set("recreate", "true");

  // ใช้หน้าต่างเดิมถ้าเปิดอยู่แล้วโหมดเดียวกัน — ลดดีเลย์ตอนคิวยิงหลายรอบ
  if (!recreate) {
    try {
      const stRes = await fetch(`/api/interrupt-overlay/status?t=${Date.now()}`);
      if (stRes.ok) {
        const st = await stRes.json();
        if (st.open) {
          // บังคับ layout ให้ตรงโหมด
          await fetch(
            `/api/interrupt-overlay/layout?mode=${popup ? "popup" : "fullscreen"}`,
            { method: "POST" }
          ).catch(() => {});
          devLog("interrupt.overlay", "reuse open window", { popup, ms: Date.now() - t0 });
          return;
        }
      }
    } catch {
      /* open ใหม่ด้านล่าง */
    }
  }

  devLog("interrupt.overlay", "open new", { popup, recreate });
  const res = await fetch(`/api/interrupt-overlay/open?${q.toString()}`, { method: "POST" });
  if (!res.ok) throw new Error("เปิดหน้าต่างขัดขวางไม่สำเร็จ");
  await waitInterruptReady(8000);
  devLog("interrupt.overlay", "ready", { popup, recreate, ms: Date.now() - t0 });
}

async function closeInterruptOverlay() {
  postInterruptCommand({ type: "stop" });
  try {
    await fetch("/api/interrupt-overlay/close", { method: "POST" });
  } catch {
    /* ignore */
  }
  interruptBusy = false;
  interruptQueue = [];
  interruptDrainPromise = null;
  setInterruptStatus("ปิดจอขัดขวางแล้ว");
}

function waitInterruptReady(timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };
    const check = async () => {
      try {
        const res = await fetch(`/api/interrupt-overlay/status?t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.open) return;
        let st = null;
        try {
          st = data.lastStatus ? JSON.parse(data.lastStatus) : null;
        } catch {
          st = null;
        }
        if (st && (st.state === "ready" || st.state === "idle" || st.state === "playing")) finish();
        if (data.open && !st) finish();
      } catch {
        /* ignore */
      }
    };
    const poll = setInterval(check, 80);
    const timer = setTimeout(finish, timeoutMs);
    check();
  });
}

function waitInterruptIdle(timeoutMs, { playId = null, playToken = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let sawPlaying = false;
    const started = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    };
    const matchesPlay = (st) => {
      if (!st) return false;
      if (playToken) return st.playToken === playToken;
      if (playId) return !st.id || st.id === playId;
      return true;
    };
    const check = async () => {
      try {
        const res = await fetch(`/api/interrupt-overlay/status?t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        // Overlay closed mid-play → stop waiting (do NOT treat as success early for next clip).
        if (!data.open) {
          if (sawPlaying || Date.now() - started > 1500) finish();
          return;
        }
        let st = null;
        try {
          st = data.lastStatus ? JSON.parse(data.lastStatus) : null;
        } catch {
          st = null;
        }
        if (!st) return;
        if (st.state === "playing" && matchesPlay(st)) sawPlaying = true;
        // Only finish when THIS token goes idle — never borrow idle from a previous clip.
        if (sawPlaying && (st.state === "idle" || st.state === "error")) {
          if (!playToken || st.playToken === playToken || st.state === "error") finish();
        }
        if (st.state === "error" && matchesPlay(st)) finish();
        // Give overlay time to report playing (file load) before skip.
        const playWait = Math.min(20000, Math.max(5000, Number(timeoutMs) || 10000) * 0.5);
        if (!sawPlaying && Date.now() - started > playWait) {
          devLog(
            "interrupt.play",
            "no playing in time — skip",
            { state: st.state, playId, playToken },
            "warn"
          );
          finish();
        }
      } catch {
        /* ignore */
      }
    };
    const poll = setInterval(check, 80);
    const timer = setTimeout(finish, timeoutMs);
    check();
  });
}

function toggleInterruptKindFields() {
  const kind = normalizeInterruptKind(document.getElementById("interruptKind")?.value);
  const videoFields = document.getElementById("interruptVideoFields");
  const errorFields = document.getElementById("interruptErrorFields");
  const closeFields = document.getElementById("interruptCloseGameFields");
  if (videoFields) videoFields.classList.toggle("hidden", kind !== "video");
  if (errorFields) errorFields.classList.toggle("hidden", kind !== "error");
  if (closeFields) closeFields.classList.toggle("hidden", kind !== "close-game");
}

function interruptClipBounds(clip) {
  const dur = Number(clip?.duration) || 0;
  let start = Math.max(0, Number(clip?.startSec) || 0);
  let end = clip?.endSec == null || clip?.endSec === "" ? (dur > 0 ? dur : start + 1) : Number(clip.endSec);
  if (!Number.isFinite(end)) end = dur > 0 ? dur : start + 1;
  if (dur > 0) {
    start = Math.min(start, dur);
    end = Math.min(Math.max(end, start + 0.1), dur);
  }
  if (end <= start) end = +(start + 0.5).toFixed(1);
  return { start: +start.toFixed(1), end: +end.toFixed(1), dur };
}

function applyInterruptClipRange(index, startSec, endSec, { rerender = false, seekPreview = true } = {}) {
  const clip = interruptPendingClips[index];
  if (!clip) return;
  const dur = Number(clip.duration) || 0;
  let start = Math.max(0, Number(startSec) || 0);
  let end = Math.max(0, Number(endSec) || 0);
  if (dur > 0) {
    start = Math.min(start, dur);
    end = Math.min(end, dur);
  }
  if (end <= start) end = +(start + 0.5).toFixed(1);
  clip.startSec = +start.toFixed(1);
  clip.endSec = +end.toFixed(1);
  interruptPreviewEnd = clip.endSec;
  if (seekPreview && interruptPreviewIndex === index) {
    const { player, label } = interruptPreviewEls();
    if (player && player.src) {
      try {
        player.currentTime = clip.startSec;
      } catch {
        /* ignore */
      }
      if (label) {
        label.textContent = `พรีวิว: ${clip.name} · ${fmtTime(clip.startSec)} → ${fmtTime(clip.endSec)}`;
      }
    }
  }
  if (rerender) renderInterruptPending();
  else refreshInterruptTrimUi(index);
}

function refreshInterruptTrimUi(index) {
  const clip = interruptPendingClips[index];
  if (!clip) return;
  const { start, end, dur } = interruptClipBounds(clip);
  const max = dur > 0 ? dur : Math.max(end, 1);
  const startLabel = document.querySelector(`[data-iv-start-label="${index}"]`);
  const endLabel = document.querySelector(`[data-iv-end-label="${index}"]`);
  const rangeLabel = document.querySelector(`[data-iv-range="${index}"]`);
  const region = document.querySelector(`[data-iv-region="${index}"]`);
  const startRange = document.querySelector(`[data-iv-range-start="${index}"]`);
  const endRange = document.querySelector(`[data-iv-range-end="${index}"]`);
  const startInp = document.querySelector(`[data-iv-start-sec="${index}"]`);
  const endInp = document.querySelector(`[data-iv-end-sec="${index}"]`);
  if (startLabel) startLabel.textContent = fmtTime(start);
  if (endLabel) endLabel.textContent = fmtTime(end);
  if (rangeLabel) {
    rangeLabel.textContent = `ช่วงที่จะเล่น: ${fmtTime(start)} → ${fmtTime(end)} (${+(end - start).toFixed(1)} วิ${
      dur > 0 ? ` / ทั้งคลิป ${fmtTime(dur)}` : ""
    })`;
  }
  if (region && max > 0) {
    region.style.left = `${(start / max) * 100}%`;
    region.style.width = `${Math.max(0, ((end - start) / max) * 100)}%`;
  }
  if (startRange) {
    startRange.max = String(max);
    if (document.activeElement !== startRange) startRange.value = String(start);
  }
  if (endRange) {
    endRange.max = String(max);
    if (document.activeElement !== endRange) endRange.value = String(end);
  }
  if (startInp && document.activeElement !== startInp) startInp.value = start.toFixed(1);
  if (endInp && document.activeElement !== endInp) endInp.value = end.toFixed(1);
}

async function probeInterruptVideoDuration(id) {
  const fromUrl = (src) =>
    new Promise((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = src;
      const done = (sec) => {
        try {
          v.removeAttribute("src");
          v.load();
        } catch {
          /* ignore */
        }
        resolve(sec);
      };
      v.addEventListener("loadedmetadata", () => {
        const d = Number(v.duration);
        done(Number.isFinite(d) && d > 0 ? d : 0);
      });
      v.addEventListener("error", () => done(0));
      setTimeout(() => done(0), 8000);
    });

  let sec = await fromUrl(`/api/video-file/${encodeURIComponent(id)}?t=${Date.now()}`);
  if (sec > 0) return sec;
  try {
    await ensureVideoOnDisk(id);
    sec = await fromUrl(`/api/video-file/${encodeURIComponent(id)}?t=${Date.now()}`);
    if (sec > 0) return sec;
    const row = await getAudioBlob(id);
    if (row?.blob) {
      const url = URL.createObjectURL(row.blob);
      try {
        return await fromUrl(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* ignore */
  }
  return 0;
}

let interruptPreviewIndex = -1;
let interruptPreviewEnd = null;
let interruptPreviewTimeHandler = null;

function interruptPreviewEls() {
  return {
    box: document.getElementById("interruptPreviewBox"),
    player: document.getElementById("interruptPreviewPlayer"),
    label: document.getElementById("interruptPreviewLabel"),
  };
}

function stopInterruptPreview({ hide = false } = {}) {
  const { box, player } = interruptPreviewEls();
  if (player) {
    try {
      if (interruptPreviewTimeHandler) {
        player.removeEventListener("timeupdate", interruptPreviewTimeHandler);
      }
      player.pause();
      if (hide) {
        player.removeAttribute("src");
        player.load();
      }
    } catch {
      /* ignore */
    }
  }
  interruptPreviewTimeHandler = null;
  interruptPreviewEnd = null;
  interruptPreviewIndex = -1;
  document.querySelectorAll("[data-iv-preview]").forEach((b) => {
    b.textContent = "▶ ดูช่วงที่ตัด";
  });
  if (hide && box) box.classList.add("hidden");
}

async function toggleInterruptPreview(index) {
  const clip = interruptPendingClips[index];
  if (!clip) return;
  const { box, player, label } = interruptPreviewEls();
  if (!player || !box) return;

  if (interruptPreviewIndex === index && !player.paused) {
    player.pause();
    const btn = document.querySelector(`[data-iv-preview="${index}"]`);
    if (btn) btn.textContent = "▶ ดูช่วงที่ตัด";
    return;
  }

  unlockAudio();
  const { start, end } = interruptClipBounds(clip);
  box.classList.remove("hidden");
  if (label) {
    label.textContent = `พรีวิว: ${clip.name} · ${fmtTime(start)} → ${fmtTime(end)}`;
  }

  // โหลดใหม่ถ้าเปลี่ยนคลิป
  const needLoad =
    interruptPreviewIndex !== index ||
    !player.src ||
    !player.src.includes(encodeURIComponent(clip.id));
  if (needLoad) {
    stopInterruptPreview({ hide: false });
    player.src = `/api/video-file/${encodeURIComponent(clip.id)}?t=${Date.now()}`;
    await new Promise((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error("เปิดวิดีโอตัวอย่างไม่สำเร็จ"));
      };
      const cleanup = () => {
        player.removeEventListener("loadedmetadata", ok);
        player.removeEventListener("error", bad);
      };
      player.addEventListener("loadedmetadata", ok);
      player.addEventListener("error", bad);
    });
  }

  interruptPreviewIndex = index;
  interruptPreviewEnd = end;
  if (interruptPreviewTimeHandler) {
    player.removeEventListener("timeupdate", interruptPreviewTimeHandler);
  }
  interruptPreviewTimeHandler = () => {
    if (interruptPreviewEnd != null && player.currentTime >= interruptPreviewEnd - 0.05) {
      player.pause();
      document.querySelectorAll("[data-iv-preview]").forEach((b) => {
        b.textContent = "▶ ดูช่วงที่ตัด";
      });
    }
  };
  player.addEventListener("timeupdate", interruptPreviewTimeHandler);

  try {
    player.currentTime = start;
  } catch {
    /* ignore */
  }
  document.querySelectorAll("[data-iv-preview]").forEach((b) => {
    b.textContent = Number(b.dataset.ivPreview) === index ? "⏸ หยุด" : "▶ ดูช่วงที่ตัด";
  });
  await player.play();
}

function renderInterruptPending() {
  const list = document.getElementById("interruptPendingList");
  if (!list) return;
  if (!interruptPendingClips.length) {
    stopInterruptPreview();
    list.innerHTML = '<div class="empty-hint">ยังไม่มีคลิป — เลือกไฟล์แล้วกดเพิ่มไฟล์ จากนั้นตัดความยาวได้เลย</div>';
    return;
  }
  list.innerHTML = interruptPendingClips
    .map((c, i) => {
      const { start, end, dur } = interruptClipBounds(c);
      const max = dur > 0 ? dur : Math.max(end, 1);
      const leftPct = max > 0 ? (start / max) * 100 : 0;
      const widthPct = max > 0 ? Math.max(0, ((end - start) / max) * 100) : 100;
      const durLabel = dur > 0 ? fmtTime(dur) : "กำลังอ่านความยาว…";
      return `
      <div class="song-item song-item-hook">
        <div class="song-main">
          <span class="song-name">${i + 1}. ${escapeHtml(c.name)}</span>
          <span class="chip">${durLabel}</span>
        </div>
        <div class="trimmer">
          <div class="trimmer-row">
            <button type="button" class="btn secondary small" data-iv-preview="${i}">▶ ดูช่วงที่ตัด</button>
            <span class="trimmer-time">${fmtTime(start)} → ${fmtTime(end)}</span>
          </div>
          <div class="trim-track-wrap">
            <div class="trim-track">
              <div class="trim-region" data-iv-region="${i}" style="left:${leftPct}%;width:${widthPct}%"></div>
            </div>
          </div>
          <div class="clip-pickers">
            <div class="clip-picker">
              <div class="clip-picker-head">
                <span>เริ่มตรง</span>
                <strong data-iv-start-label="${i}">${fmtTime(start)}</strong>
              </div>
              <input class="clip-range start" type="range" min="0" max="${max}" step="0.1" value="${start}" data-iv-range-start="${i}" />
              <label class="clip-sec">วินาที
                <input type="number" min="0" max="3600" step="0.1" value="${start.toFixed(1)}" data-iv-start-sec="${i}" />
              </label>
            </div>
            <div class="clip-picker">
              <div class="clip-picker-head">
                <span>จบตรง</span>
                <strong data-iv-end-label="${i}">${fmtTime(end)}</strong>
              </div>
              <input class="clip-range end" type="range" min="0" max="${max}" step="0.1" value="${end}" data-iv-range-end="${i}" />
              <label class="clip-sec">วินาที
                <input type="number" min="0" max="3600" step="0.1" value="${end.toFixed(1)}" data-iv-end-sec="${i}" />
              </label>
            </div>
          </div>
          <div class="trimmer-range" data-iv-range="${i}">ช่วงที่จะเล่น: ${fmtTime(start)} → ${fmtTime(end)} (${+(end - start).toFixed(1)} วิ)</div>
          <div class="trimmer-actions">
            <button type="button" class="btn ghost small" data-iv-quick="${i}" data-sec="5">5 วิ</button>
            <button type="button" class="btn ghost small" data-iv-quick="${i}" data-sec="10">10 วิ</button>
            <button type="button" class="btn ghost small" data-iv-quick="${i}" data-sec="15">15 วิ</button>
            <button type="button" class="btn ghost small" data-iv-full="${i}">ทั้งคลิป</button>
            <button type="button" class="btn ghost small danger" data-interrupt-pending-remove="${i}">ลบคลิป</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-interrupt-pending-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.interruptPendingRemove);
      if (interruptPreviewIndex === i) stopInterruptPreview();
      interruptPendingClips.splice(i, 1);
      renderInterruptPending();
    });
  });
  list.querySelectorAll("[data-iv-preview]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleInterruptPreview(Number(btn.dataset.ivPreview)).catch((e) => alert(e.message || e));
    });
  });
  list.querySelectorAll("[data-iv-range-start]").forEach((range) => {
    const move = () => {
      const i = Number(range.dataset.ivRangeStart);
      const { end } = interruptClipBounds(interruptPendingClips[i] || {});
      let start = Number(range.value) || 0;
      if (start >= end) start = Math.max(0, end - 0.5);
      applyInterruptClipRange(i, start, end);
    };
    range.addEventListener("input", move);
    range.addEventListener("change", move);
  });
  list.querySelectorAll("[data-iv-range-end]").forEach((range) => {
    const move = () => {
      const i = Number(range.dataset.ivRangeEnd);
      const { start } = interruptClipBounds(interruptPendingClips[i] || {});
      let end = Number(range.value) || 0;
      if (end <= start) end = start + 0.5;
      applyInterruptClipRange(i, start, end);
    };
    range.addEventListener("input", move);
    range.addEventListener("change", move);
  });
  list.querySelectorAll("[data-iv-start-sec]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.ivStartSec);
      const { end } = interruptClipBounds(interruptPendingClips[i] || {});
      applyInterruptClipRange(i, Number(inp.value) || 0, end);
    });
  });
  list.querySelectorAll("[data-iv-end-sec]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.ivEndSec);
      const { start } = interruptClipBounds(interruptPendingClips[i] || {});
      applyInterruptClipRange(i, start, Number(inp.value) || 0);
    });
  });
  list.querySelectorAll("[data-iv-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.ivQuick);
      const clip = interruptPendingClips[i];
      if (!clip) return;
      const { start, dur } = interruptClipBounds(clip);
      const sec = Number(btn.dataset.sec) || 10;
      const end = dur > 0 ? Math.min(dur, start + sec) : start + sec;
      applyInterruptClipRange(i, start, end);
    });
  });
  list.querySelectorAll("[data-iv-full]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.ivFull);
      const clip = interruptPendingClips[i];
      if (!clip) return;
      const dur = Number(clip.duration) || 0;
      applyInterruptClipRange(i, 0, dur > 0 ? dur : Math.max(Number(clip.endSec) || 1, 1));
    });
  });
}

function renderInterruptRules() {
  const list = document.getElementById("interruptRulesList");
  const count = document.getElementById("interruptRuleCount");
  if (count) count.textContent = `${interruptConfig.rules.length} กฎ`;
  if (!list) return;
  if (!interruptConfig.rules.length) {
    list.innerHTML = '<div class="empty-hint">ยังไม่มีกฎขัดขวาง — เพิ่มด้านบนได้เลย</div>';
    return;
  }
  list.innerHTML = interruptConfig.rules
    .map((r) => {
      const trigger = normalizeInterruptTrigger(r.trigger);
      const title =
        trigger === "gift" ? r.giftName || "ของขวัญ" : interruptTriggerLabel(trigger);
      const kind = normalizeInterruptKind(r.kind);
      let kindLabel =
        kind === "error"
          ? "Error / OK"
          : kind === "close-game"
            ? "ปิดทุกเกม"
            : `วิดีโอ (${r.videos?.length || 0} คลิป)`;
      if (kind === "video" && r.videos?.length) {
        const parts = r.videos.map((v) => {
          const s = Number(v.startSec) || 0;
          const e = v.endSec == null ? null : Number(v.endSec);
          if (e != null && e > s) return `${+(e - s).toFixed(1)}วิ`;
          return "เต็ม";
        });
        kindLabel = `วิดีโอ · ${parts.join(", ")}`;
      }
      return `
      <div class="rule-item ${r.enabled === false ? "disabled" : ""}">
        <div class="rule-main">
          <strong>${escapeHtml(title)}</strong>
          <span class="chip">${interruptTriggerLabel(trigger)}</span>
          <span class="chip">${kindLabel}</span>
        </div>
        <div class="rule-actions">
          <button type="button" class="btn ghost small" data-interrupt-toggle="${r.id}">${
            r.enabled === false ? "เปิด" : "ปิด"
          }</button>
          <button type="button" class="btn secondary small" data-interrupt-test="${r.id}">ทดสอบ</button>
          <button type="button" class="btn ghost small" data-interrupt-edit="${r.id}">แก้</button>
          <button type="button" class="btn ghost small" data-interrupt-del="${r.id}">ลบ</button>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-interrupt-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rule = interruptConfig.rules.find((r) => r.id === btn.dataset.interruptToggle);
      if (!rule) return;
      rule.enabled = rule.enabled === false ? true : false;
      saveInterruptConfig();
    });
  });
  list.querySelectorAll("[data-interrupt-test]").forEach((btn) => {
    btn.addEventListener("click", () => triggerInterruptRule(btn.dataset.interruptTest, true));
  });
  list.querySelectorAll("[data-interrupt-edit]").forEach((btn) => {
    btn.addEventListener("click", () => editInterruptRule(btn.dataset.interruptEdit));
  });
  list.querySelectorAll("[data-interrupt-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteInterruptRule(btn.dataset.interruptDel));
  });
}

function resetInterruptEditor() {
  document.getElementById("interruptEditId").value = "";
  document.getElementById("interruptTrigger").value = "gift";
  document.getElementById("interruptGiftName").value = "";
  document.getElementById("interruptKind").value = "video";
  document.getElementById("interruptPlayMode").value = "random";
  document.getElementById("interruptErrTitle").value = "Windows";
  document.getElementById("interruptErrMessage").value =
    "An unexpected error has occurred.\nPlease click OK to continue.";
  document.getElementById("interruptErrCode").value = "";
  interruptPendingClips = [];
  const mode = document.getElementById("interruptRuleMode");
  if (mode) mode.textContent = "เพิ่มใหม่";
  renderInterruptPending();
  toggleInterruptKindFields();
  toggleInterruptTriggerFields();
}

function editInterruptRule(id) {
  const rule = interruptConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  document.getElementById("interruptEditId").value = rule.id;
  document.getElementById("interruptTrigger").value = normalizeInterruptTrigger(rule.trigger);
  document.getElementById("interruptGiftName").value = rule.giftName || "";
  document.getElementById("interruptKind").value = normalizeInterruptKind(rule.kind);
  document.getElementById("interruptPlayMode").value = rule.playMode || "random";
  document.getElementById("interruptErrTitle").value = rule.errorTitle || "Windows";
  document.getElementById("interruptErrMessage").value =
    rule.errorMessage || "An unexpected error has occurred.\nPlease click OK to continue.";
  document.getElementById("interruptErrCode").value = rule.errorCode || "";
  interruptPendingClips = (rule.videos || []).map((v) => ({
    id: v.id,
    name: v.name,
    existing: true,
    duration: Number(v.duration) || 0,
    startSec: Number(v.startSec) || 0,
    endSec: v.endSec == null ? null : Number(v.endSec),
  }));
  const mode = document.getElementById("interruptRuleMode");
  if (mode) mode.textContent = "กำลังแก้ไข";
  renderInterruptPending();
  toggleInterruptKindFields();
  toggleInterruptTriggerFields();
  Promise.all(
    interruptPendingClips.map(async (clip) => {
      if (clip.duration > 0) return;
      const dur = await probeInterruptVideoDuration(clip.id);
      if (dur > 0) {
        clip.duration = +dur.toFixed(1);
        if (clip.endSec == null || clip.endSec <= 0 || clip.endSec > clip.duration) {
          clip.endSec = clip.duration;
        }
      }
    })
  ).then(() => renderInterruptPending());
}

function deleteInterruptRule(id) {
  const rule = interruptConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  const label =
    normalizeInterruptTrigger(rule.trigger) === "gift"
      ? rule.giftName
      : interruptTriggerLabel(rule.trigger);
  if (!confirm(`ลบกฎขัดขวางของ “${label}” ?`)) return;
  interruptConfig.rules = interruptConfig.rules.filter((r) => r.id !== id);
  saveInterruptConfig();
  if (document.getElementById("interruptEditId").value === id) resetInterruptEditor();
  refreshInterruptProgressStatus();
}

async function addSelectedInterruptFiles() {
  const input = document.getElementById("interruptFiles");
  const files = Array.from(input.files || []);
  if (!files.length) {
    alert("เลือกไฟล์วิดีโอก่อน");
    return;
  }
  for (const file of files) {
    const id = uid();
    await saveAudioBlob(id, file, file.name, file.type || "video/mp4");
    try {
      await cacheVideoToDisk(id, file);
    } catch (err) {
      console.warn("cacheVideoToDisk", err);
      alert(`บันทึกวิดีโอขึ้นดิสก์ไม่สำเร็จ: ${file.name}\n${err.message || err}`);
    }
    const dur = await probeInterruptVideoDuration(id);
    if (!(dur > 0)) {
      alert(`อ่านความยาวคลิปไม่ได้: ${file.name}\nลองไฟล์ mp4 อื่น หรือรีสตาร์ทแอปแล้วเพิ่มใหม่`);
    }
    interruptPendingClips.push({
      id,
      name: file.name,
      existing: true,
      duration: dur > 0 ? +dur.toFixed(1) : 0,
      startSec: 0,
      endSec: dur > 0 ? +dur.toFixed(1) : null,
    });
  }
  input.value = "";
  renderInterruptPending();
}

async function saveInterruptRule() {
  const trigger = normalizeInterruptTrigger(document.getElementById("interruptTrigger")?.value);
  let giftName = document.getElementById("interruptGiftName").value.trim();
  if (trigger === "like") giftName = "Like";
  else if (trigger === "follow") giftName = "Follow";
  if (trigger === "gift" && !giftName) {
    alert("ใส่ชื่อของขวัญก่อน");
    return;
  }
  const kind = normalizeInterruptKind(document.getElementById("interruptKind")?.value);
  if (kind === "video" && !interruptPendingClips.length) {
    alert("เพิ่มไฟล์วิดีโออย่างน้อย 1 คลิป");
    return;
  }
  const payload = {
    trigger,
    giftName,
    kind,
    enabled: true,
    playMode: document.getElementById("interruptPlayMode").value || "random",
    videos:
      kind === "video"
        ? interruptPendingClips.map((v) => {
            const { start, end, dur } = interruptClipBounds(v);
            return {
              id: v.id,
              name: v.name,
              duration: dur || Number(v.duration) || 0,
              startSec: start,
              endSec: end,
            };
          })
        : [],
    errorTitle: document.getElementById("interruptErrTitle").value.trim() || "Windows",
    errorMessage:
      document.getElementById("interruptErrMessage").value.trim() ||
      "An unexpected error has occurred.\nPlease click OK to continue.",
    errorCode: document.getElementById("interruptErrCode").value.trim(),
  };
  const editId = document.getElementById("interruptEditId").value;
  if (editId) {
    const rule = interruptConfig.rules.find((r) => r.id === editId);
    if (!rule) return;
    Object.assign(rule, payload);
    delete rule.every;
  } else {
    interruptConfig.rules.push({ id: uid(), ...payload });
  }
  saveInterruptConfig();
  resetInterruptEditor();
  refreshInterruptProgressStatus();
}

let interruptDrainPromise = null;

function kickInterruptDrain() {
  if (interruptDrainPromise) return interruptDrainPromise;
  interruptDrainPromise = (async () => {
    try {
      await runInterruptDrainLoop();
    } finally {
      interruptDrainPromise = null;
      // Re-kick only for ready jobs — coalesce timers call kick after they flush.
      if (interruptQueue.length) kickInterruptDrain();
    }
  })();
  return interruptDrainPromise;
}

async function drainInterruptQueue() {
  return kickInterruptDrain();
}

function pushInterruptJob(job) {
  if (!job) return false;
  // Merge into the job being played (same rule) — keeps exact unit count, enables catch-up.
  if (
    job.kind === "video" &&
    job.ruleId &&
    interruptActiveJob &&
    interruptActiveJob.kind === "video" &&
    interruptActiveJob.ruleId === job.ruleId
  ) {
    interruptActiveJob.clips.push(...(job.clips || []));
    interruptActiveJob.expectedPlays =
      (Number(interruptActiveJob.expectedPlays) || 0) + (Number(job.expectedPlays) || 0);
    interruptActiveJob.combo = true;
    return true;
  }
  // Merge into last queued job for the same rule.
  if (job.kind === "video" && job.ruleId && interruptQueue.length) {
    const last = interruptQueue[interruptQueue.length - 1];
    if (last.kind === "video" && last.ruleId === job.ruleId) {
      last.clips = [...(last.clips || []), ...(job.clips || [])];
      last.expectedPlays = (Number(last.expectedPlays) || 0) + (Number(job.expectedPlays) || 0);
      last.combo = true;
      return true;
    }
  }
  if (interruptQueue.length >= INTERRUPT_QUEUE_SOFT) {
    devLog(
      "interrupt.queue",
      "queue long (keeping all)",
      { q: interruptQueue.length + 1, soft: INTERRUPT_QUEUE_SOFT },
      "warn"
    );
  }
  interruptQueue.push(job);
  return true;
}

function flushInterruptCoalesce(ruleId) {
  const entry = interruptCoalesce.get(ruleId);
  if (!entry) return;
  interruptCoalesce.delete(ruleId);
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  const n = Math.max(1, Number(entry.count) || 1);
  const job = buildInterruptJobForRule(entry.rule, n);
  if (!job) return;
  pushInterruptJob(job);
  kickInterruptDrain();
}

function flushAllInterruptCoalesce() {
  for (const id of [...interruptCoalesce.keys()]) {
    flushInterruptCoalesce(id);
  }
}

function enqueueInterruptForRule(rule, fired) {
  const times = Math.max(1, Number(fired) || 1);
  const id = rule?.id || `gift:${String(rule?.giftName || "").toLowerCase()}`;
  const sameActive =
    interruptActiveJob &&
    interruptActiveJob.kind === "video" &&
    interruptActiveJob.ruleId === id;
  const lastQ = interruptQueue.length ? interruptQueue[interruptQueue.length - 1] : null;
  const sameQueued = lastQ && lastQ.kind === "video" && lastQ.ruleId === id;

  // Already playing / queued same gift → append units now (no 450ms wait).
  // True xN from backend → flush immediately so drain sees full count.
  if (sameActive || sameQueued || times > 1) {
    let pending = times;
    const entry = interruptCoalesce.get(id);
    if (entry) {
      pending += Math.max(0, Number(entry.count) || 0);
      if (entry.timer) clearTimeout(entry.timer);
      interruptCoalesce.delete(id);
    }
    const job = buildInterruptJobForRule(rule, pending);
    if (job) pushInterruptJob(job);
    kickInterruptDrain();
    return;
  }

  let entry = interruptCoalesce.get(id);
  if (!entry) {
    entry = { rule, count: 0, timer: null };
    interruptCoalesce.set(id, entry);
  }
  entry.rule = rule;
  entry.count += times;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushInterruptCoalesce(id), INTERRUPT_COALESCE_MS);
}

async function runInterruptDrainLoop() {
  if (interruptBusy) return;
  interruptBusy = true;
  const drainStarted = Date.now();
  let playIndex = 0;
  let overlayOpen = false;
  let overlayPopup = null;
  devLog("interrupt.queue", "drain start", { q: interruptQueue.length });
  try {
    while (interruptQueue.length || interruptCoalesce.size) {
      if (!interruptQueue.length && interruptCoalesce.size) {
        // Keep ~800ms merge window — do not flush early; timers push jobs + kick.
        break;
      }
      const job = interruptQueue.shift();
      if (!job) break;
      const jobStarted = Date.now();
      try {
        if (job.kind === "close-game") {
          setInterruptStatus("กำลังปิดทุกเกมที่เปิดอยู่…");
          try {
            const res = await fetch("/api/games/close", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (data?.ok) {
              setInterruptStatus(`ปิดเกมแล้ว ${data.killed || 0} โปรเซส`);
              devLog("interrupt.close-game", "closed all", {
                killed: data.killed,
                detail: data.detail,
                ms: Date.now() - jobStarted,
              });
            } else {
              setInterruptStatus(`ปิดเกมไม่สำเร็จ — ไม่พบเกมที่กำลังเปิด`);
              devLog(
                "interrupt.close-game",
                "not found",
                { ms: Date.now() - jobStarted },
                "warn"
              );
            }
          } catch (err) {
            setInterruptStatus(`ปิดเกมผิดพลาด: ${err.message || err}`);
            devLog("interrupt.close-game", "error", { error: String(err?.message || err) }, "error");
          }
          await new Promise((r) => setTimeout(r, 80));
          continue;
        }

        const wantPopup = job.kind === "error";
        const needRecreate = overlayOpen && overlayPopup !== wantPopup;
        if (!overlayOpen || needRecreate) {
          await openInterruptOverlay({
            popup: wantPopup,
            recreate: needRecreate,
          });
          overlayOpen = true;
          overlayPopup = wantPopup;
        }
        if (job.kind === "error") {
          const errTimes = Math.max(1, Number(job.repeats) || 1);
          for (let er = 0; er < errTimes; er++) {
            setInterruptStatus(
              errTimes > 1
                ? `Error: ${job.title || "Windows"} (${er + 1}/${errTimes}) — รอ กด OK`
                : `Error: ${job.title || "Windows"} — รอ กด OK`
            );
            interruptPlaySeq += 1;
            const playToken = `e${interruptPlaySeq}`;
            await postInterruptCommand({
              type: "show-error",
              title: job.title,
              message: job.message,
              code: job.code,
              playToken,
              closeWhenDone: false,
            });
            await waitInterruptIdle(10 * 60 * 1000, { playToken });
          }
          devLog("interrupt.play", "error job done", {
            ms: Date.now() - jobStarted,
            times: errTimes,
            qLeft: interruptQueue.length,
          });
        } else {
          // Allow clips[] to grow while playing (same-gift units merge into active job).
          job.clips = job.clips || [];
          job.repeats = 1;
          interruptActiveJob = job;
          const pref = new Set();
          const ensureClip = async (c) => {
            if (!c?.id || pref.has(c.id)) return;
            pref.add(c.id);
            try {
              const ok = await ensureVideoOnDisk(c.id);
              if (!ok) {
                setInterruptStatus(`ไม่พบไฟล์วิดีโอ: ${c.name || c.id} — เพิ่มไฟล์ใหม่`);
                devLog("interrupt.play", "missing video on disk", { id: c.id, name: c.name }, "error");
              }
            } catch (err) {
              devLog("interrupt.play", "ensureVideoOnDisk failed", { id: c.id, error: String(err?.message || err) }, "error");
            }
          };
          for (const c of job.clips) await ensureClip(c);

          let i = 0;
          while (i < job.clips.length) {
            const clip = job.clips[i];
            i += 1;
            if (!clip?.id) continue;
            await ensureClip(clip);
            const clipStarted = Date.now();
            playIndex += 1;
            interruptPlaySeq += 1;
            const playToken = `t${interruptPlaySeq}_${clip.id || "x"}`;
            const bounds = interruptClipBounds(clip);
            let { start, end } = bounds;
            const trimMs = Math.max(200, (end - start) * 1000);
            const leftInJob = Math.max(0, job.clips.length - i);
            const queuePlays = estimateInterruptQueuePlays();
            const remainingAfter = leftInJob + queuePlays;
            const jobTotal = Math.max(interruptJobPlayTotal(job), job.clips.length);
            const isCombo = jobTotal > 1 || remainingAfter > 0 || !!job.combo;
            job.combo = isCombo;
            job.expectedPlays = Math.max(Number(job.expectedPlays) || 0, job.clips.length);
            const catchMs = null; // sequential full trim — never overlap / shorten
            setInterruptStatus(
              isCombo
                ? `กำลังขัดขวาง: ${clip.name} · ${i}/${job.clips.length}`
                : `กำลังขัดขวาง: ${clip.name} (${fmtTime(start)}–${fmtTime(end)})`
            );
            devLog("interrupt.play", "play start", {
              n: playIndex,
              name: clip.name,
              id: clip.id,
              playToken,
              start,
              end,
              trimMs,
              isCombo,
              jobTotal: job.clips.length,
              leftPlays: remainingAfter,
              qLeft: interruptQueue.length,
              sinceDrainMs: Date.now() - drainStarted,
            });
            await postInterruptCommand({
              type: "play",
              id: clip.id,
              name: clip.name,
              still: /\.png$/i.test(String(clip.name || "")) || String(clip.id || "").startsWith("intimg_"),
              volume: interruptConfig.volume ?? 1,
              muted: false,
              startSec: start,
              endSec: end,
              skipLayout: overlayOpen === true,
              playToken,
              closeWhenDone: false,
            });
            // Wait until THIS clip ends — then start the next (no overlap).
            const waitMs = Math.min(120000, Math.max(1500, trimMs + 2500));
            await waitInterruptIdle(waitMs, { playId: clip.id, playToken });
            await new Promise((r) => setTimeout(r, 120));
            devLog("interrupt.play", "play done", {
              n: playIndex,
              name: clip.name,
              playToken,
              playMs: Date.now() - clipStarted,
              qLeft: interruptQueue.length,
              clipsNow: job.clips.length,
            });
          }
          interruptActiveJob = null;
        }
      } catch (err) {
        console.warn(err);
        interruptActiveJob = null;
        devLog("interrupt.queue", "job error", { error: String(err?.message || err) }, "error");
        setInterruptStatus(`ผิดพลาด: ${err.message || err}`);
        overlayOpen = false;
        overlayPopup = null;
        try {
          await fetch("/api/interrupt-overlay/close", { method: "POST" });
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    interruptActiveJob = null;
    // Drain finished — flush any late coalesce; if jobs remain, keep overlay and re-kick.
    flushAllInterruptCoalesce();
    if (interruptQueue.length) {
      interruptBusy = false;
      kickInterruptDrain();
      return;
    }
    // Combo / burst finished → close interrupt screen immediately.
    if (overlayOpen) {
      try {
        await postInterruptCommand({ type: "stop" });
      } catch {
        /* ignore */
      }
      try {
        await fetch("/api/interrupt-overlay/close", { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    interruptBusy = false;
    devLog("interrupt.queue", "drain end", {
      plays: playIndex,
      totalMs: Date.now() - drainStarted,
      closed: overlayOpen,
    });
    if (interruptConfig.enabled) refreshInterruptProgressStatus();
    else setInterruptStatus("ยังไม่เปิดใช้");
  }
}

function buildInterruptJobForRule(rule, repeats = 1) {
  if (!rule) return null;
  const kind = normalizeInterruptKind(rule.kind);
  const times = Math.max(1, Number(repeats) || 1);
  const combo = times > 1;
  const ruleId = rule.id || `gift:${String(rule.giftName || "").toLowerCase()}`;
  if (kind === "close-game") {
    return { kind: "close-game", ruleId, expectedPlays: 1, combo: false };
  }
  if (kind === "error") {
    return {
      kind: "error",
      ruleId,
      title: rule.errorTitle || "Windows",
      message: rule.errorMessage || "An unexpected error has occurred.",
      code: rule.errorCode || "",
      repeats: times,
      expectedPlays: times,
      combo,
    };
  }
  if (!rule.videos?.length) return null;
  let clips = [];
  if (rule.playMode === "all") {
    // xN = เล่นทั้งชุด N รอบ — expand clips so drain loop (clips-only) plays N full sets.
    clips = [];
    for (let r = 0; r < times; r++) clips.push(...rule.videos);
    return {
      kind: "video",
      ruleId,
      clips,
      repeats: 1,
      expectedPlays: clips.length,
      combo,
    };
  }
  if (rule.playMode === "sequence") {
    clips = [];
    for (let i = 0; i < times; i++) {
      const idx = interruptSeqIndex[rule.id] || 0;
      clips.push(rule.videos[idx % rule.videos.length]);
      interruptSeqIndex[rule.id] = idx + 1;
    }
    return { kind: "video", ruleId, clips, repeats: 1, expectedPlays: clips.length, combo };
  }
  if (times > 1) {
    clips = [];
    for (let i = 0; i < times; i++) {
      clips.push(rule.videos[Math.floor(Math.random() * rule.videos.length)]);
    }
    return { kind: "video", ruleId, clips, repeats: 1, expectedPlays: clips.length, combo: true };
  }
  clips = [rule.videos[Math.floor(Math.random() * rule.videos.length)]];
  return { kind: "video", ruleId, clips, repeats: 1, expectedPlays: 1, combo: false };
}

async function triggerInterruptRule(ruleIdOrGiftName, byId = false) {
  const rule = byId
    ? interruptConfig.rules.find((r) => r.id === ruleIdOrGiftName)
    : interruptConfig.rules.find((r) => {
        if (r.enabled === false) return false;
        const trigger = normalizeInterruptTrigger(r.trigger);
        const name = String(ruleIdOrGiftName || "").toLowerCase();
        if (trigger === "like") return name === "like";
        if (trigger === "follow") return name === "follow";
        return interruptGiftMatches(r.giftName, ruleIdOrGiftName);
      });
  if (!rule) {
    devLog("interrupt.trigger", "no rule", { ruleIdOrGiftName, byId }, "warn");
    return;
  }
  if (rule.enabled === false && !byId) return;

  const job = buildInterruptJobForRule(rule);
  if (!job) {
    devLog("interrupt.trigger", "skip (no videos)", { ruleId: rule.id }, "warn");
    return;
  }
  pushInterruptJob(job);
  await kickInterruptDrain();
}

function handleGiftForInterrupt(parsed) {
  if (!interruptConfig.enabled) return;
  if (!parsed) return;
  if (parsed.kind !== "gift" && parsed.kind !== "like" && parsed.kind !== "follow") return;

  const now = Date.now();
  const count = Math.max(1, Number(parsed.count) || 1);
  // seq จาก backend = หนึ่งอีเวนต์หนึ่งคีย์ — ไม่กลืนของชิ้นที่ข้อความซ้ำในวินาทีเดียวกัน
  const eventKey =
    parsed.seq != null && parsed.seq !== ""
      ? `seq:${parsed.seq}`
      : parsed.dedupeKey ||
        parsed.key ||
        [
          parsed.kind,
          String(parsed.giftName || "").toLowerCase(),
          String(parsed.sender || "").toLowerCase(),
          String(count),
          String(now),
          String(Math.random()),
        ].join("|");
  const lastEvt = interruptEventDedupeAt[eventKey] || 0;
  if (now - lastEvt < INTERRUPT_EVENT_DEDUPE_MS) {
    return;
  }
  interruptEventDedupeAt[eventKey] = now;
  if (Object.keys(interruptEventDedupeAt).length > 400) {
    for (const k of Object.keys(interruptEventDedupeAt)) {
      if (now - interruptEventDedupeAt[k] > 30000) delete interruptEventDedupeAt[k];
    }
  }

  let totalFire = 0;
  for (const rule of interruptConfig.rules || []) {
    if (rule.enabled === false) continue;
    const trigger = normalizeInterruptTrigger(rule.trigger);
    if (trigger === "like") {
      if (parsed.kind !== "like") continue;
    } else if (trigger === "follow") {
      if (parsed.kind !== "follow") continue;
    } else {
      if (parsed.kind !== "gift") continue;
      if (!interruptGiftMatches(rule.giftName, parsed.giftName)) {
        continue;
      }
    }

    // Exact units: combo xN → N plays. close-game / follow = 1.
    // Coalesce rapid x1 finalize lines so every gift behaves like Rose combo.
    const kind = normalizeInterruptKind(rule.kind);
    const fired = kind === "close-game" || trigger === "follow" ? 1 : count;
    interruptReceivedTotal += fired;
    if (kind === "close-game" || kind === "error" || trigger === "follow") {
      const job = buildInterruptJobForRule(rule, fired);
      if (job && pushInterruptJob(job)) {
        totalFire += fired;
        interruptEnqueuedTotal += Number(job.expectedPlays) || fired;
      }
    } else {
      enqueueInterruptForRule(rule, fired);
      totalFire += fired;
      interruptEnqueuedTotal += fired;
    }
  }

  if (!totalFire) return;

  devLog("interrupt.gift", "matched", {
    kind: parsed.kind,
    gift: parsed.giftName,
    count,
    fire: totalFire,
    phase: parsed.phase || "ui",
    note: "exact-xN-from-finalize",
    seq: parsed.seq,
    q: interruptQueue.length,
    receivedTotal: interruptReceivedTotal,
    enqueuedPlays: interruptEnqueuedTotal,
  });
  refreshInterruptProgressStatus();
  kickInterruptDrain();
}

/* ========== Win counter ========== */
const WIN_KEY = "tgr_win_config";
const WIN_DEFAULTS_PACK_KEY = "tgr_win_defaults_pack_version";
const WIN_CHANNEL = "tgr-win-overlay";
const winChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(WIN_CHANNEL) : null;
let winOverlayWin = null;
let winConfig = loadWinConfig();

function defaultWinConfig() {
  return { score: 0, target: 10, showOverlay: true, rules: [] };
}

function normalizeWinRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r && r.gift)
    .map((r) => ({
      id: r.id || uid(),
      gift: String(r.gift).trim(),
      delta: Number.isFinite(Number(r.delta)) ? Number(r.delta) : 1,
    }));
}

function loadWinConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WIN_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return defaultWinConfig();
    return {
      score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : 0,
      target: Math.max(1, Number(parsed.target) || 10),
      showOverlay: parsed.showOverlay !== false,
      rules: normalizeWinRules(parsed.rules),
    };
  } catch {
    return defaultWinConfig();
  }
}

async function applyDefaultWinPack({ force = false } = {}) {
  if (!force) {
    try {
      const raw = localStorage.getItem(WIN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.rules) && parsed.rules.length > 0) {
          return { ok: false, reason: "exists" };
        }
      }
    } catch {
      /* continue */
    }
    if (localStorage.getItem("tgr_win_defaults_seeded") === "1") {
      return { ok: false, reason: "seeded" };
    }
  }
  const res = await fetch(`/defaults/win/config.json?t=${Date.now()}`);
  if (!res.ok) throw new Error("ไม่พบแพ็กนับ Win เริ่มต้น");
  const pack = await res.json();
  const rules = normalizeWinRules(pack?.rules);
  if (!rules.length) throw new Error("แพ็กนับ Win ว่าง");
  winConfig = {
    score: Number.isFinite(Number(pack.score)) ? Number(pack.score) : 0,
    target: Math.max(1, Number(pack.target) || 10),
    showOverlay: pack.showOverlay !== false,
    rules,
  };
  saveWinConfig();
  localStorage.setItem("tgr_win_defaults_seeded", "1");
  const packVer = String(pack.packVersion || pack.exportedAt || "");
  if (packVer) localStorage.setItem(WIN_DEFAULTS_PACK_KEY, packVer);
  return { ok: true, rules: rules.length, packVersion: packVer };
}

async function seedDefaultWinIfNeeded() {
  try {
    try {
      const peek = await fetch(`/defaults/win/config.json?t=${Date.now()}`);
      if (peek.ok) {
        const pack = await peek.json();
        const packVer = String(pack?.packVersion || "");
        const applied = localStorage.getItem(WIN_DEFAULTS_PACK_KEY) || "";
        if (pack?.replaceOnUpdate && packVer && packVer !== applied) {
          const forced = await applyDefaultWinPack({ force: true });
          if (forced.ok) {
            console.info(`[win] replaced with pack ${packVer} (${forced.rules} rules)`);
            return true;
          }
        }
      }
    } catch (err) {
      console.warn("[win] replaceOnUpdate peek failed", err);
    }
    const result = await applyDefaultWinPack({ force: false });
    if (result.ok) console.info(`[win] seeded ${result.rules} default gift→win rules`);
  } catch (err) {
    console.warn("[win] seed defaults failed", err);
  }
}

function saveWinConfig() {
  localStorage.setItem(WIN_KEY, JSON.stringify(winConfig));
  renderWinUiState();
  syncWinScoreToOverlay();
  renderGiftActionOverview();
}

function formatWinScore() {
  return `${winConfig.score}/${winConfig.target}`;
}

function postWinOverlayCommand(cmd) {
  const payload = { ...cmd, at: Date.now() };
  try {
    localStorage.setItem("tgr_win_overlay_cmd", JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  winChannel?.postMessage(payload);
}

function syncWinScoreToOverlay() {
  postWinOverlayCommand({
    type: "win-score",
    score: winConfig.score,
    target: winConfig.target,
    visible: !!winConfig.showOverlay,
  });
}

async function openWinOverlay() {
  let openedNative = false;
  try {
    const res = await fetch("/api/win-overlay/open", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      openedNative = !!data.open || data.ok;
    }
  } catch {
    openedNative = false;
  }

  if (!openedNative) {
    const url = "/win-overlay.html?v=1";
    if (!winOverlayWin || winOverlayWin.closed) {
      winOverlayWin = window.open(url, "monkeyeffect_win_overlay", "popup=yes,width=640,height=360");
    } else {
      winOverlayWin.focus();
    }
  }

  setTimeout(() => syncWinScoreToOverlay(), 400);
  setTimeout(() => syncWinScoreToOverlay(), 1000);
}

async function closeWinOverlay() {
  try {
    await fetch("/api/win-overlay/close", { method: "POST" });
  } catch {
    /* ignore */
  }
  if (winOverlayWin && !winOverlayWin.closed) {
    try {
      winOverlayWin.close();
    } catch {
      /* ignore */
    }
  }
  winOverlayWin = null;
}

winChannel?.addEventListener("message", (ev) => {
  if (ev.data?.type === "win-overlay-status" && ev.data.state === "ready") {
    syncWinScoreToOverlay();
  }
});

window.addEventListener("storage", (ev) => {
  if (ev.key !== "tgr_win_overlay_status" || !ev.newValue) return;
  try {
    const d = JSON.parse(ev.newValue);
    if (d?.type === "win-overlay-status" && d.state === "ready") syncWinScoreToOverlay();
  } catch {
    /* ignore */
  }
});

function adjustWinScore(delta, reason) {
  const d = Number(delta) || 0;
  if (!d) return;
  winConfig.score = (Number(winConfig.score) || 0) + d;
  saveWinConfig();
  const el = document.getElementById("log");
  if (el && reason) {
    // light feedback via existing poll log is enough; optional console
    console.info(`[win] ${reason}: ${d > 0 ? "+" : ""}${d} → ${formatWinScore()}`);
  }
}

function setWinScoreAbsolute(score, target) {
  winConfig.score = Number.isFinite(Number(score)) ? Number(score) : 0;
  winConfig.target = Math.max(1, Number(target) || winConfig.target || 5);
  saveWinConfig();
}

function renderWinUiState() {
  const display = document.getElementById("winScoreDisplay");
  const scoreIn = document.getElementById("winScoreInput");
  const targetIn = document.getElementById("winTargetInput");
  const showEl = document.getElementById("winShowOverlay");
  const countEl = document.getElementById("winRuleCount");
  const listEl = document.getElementById("winRulesList");
  if (display) {
    display.textContent = formatWinScore();
    display.style.color = winConfig.score < 0 ? "#f87171" : "";
  }
  if (scoreIn && document.activeElement !== scoreIn) scoreIn.value = String(winConfig.score);
  if (targetIn && document.activeElement !== targetIn) targetIn.value = String(winConfig.target);
  if (showEl) showEl.checked = !!winConfig.showOverlay;
  if (countEl) countEl.textContent = `${winConfig.rules.length} กฎ`;
  if (!listEl) return;
  if (!winConfig.rules.length) {
    listEl.innerHTML = '<div class="hint">ยังไม่มีกฎ — เช่น Galaxy = -1, Rose = +1</div>';
    return;
  }
  listEl.innerHTML = winConfig.rules
    .map((r) => {
      const sign = r.delta > 0 ? `+${r.delta}` : String(r.delta);
      return `<div class="rule-card" data-id="${r.id}">
        <div class="rule-main">
          <strong>${escapeHtml(r.gift)}</strong>
          <span class="chip">${sign} win</span>
        </div>
        <div class="rule-actions">
          <button type="button" class="btn ghost small" data-act="edit">แก้ไข</button>
          <button type="button" class="btn ghost small" data-act="del">ลบ</button>
        </div>
      </div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clearWinRuleForm() {
  const idEl = document.getElementById("winEditId");
  const giftEl = document.getElementById("winGiftName");
  const deltaEl = document.getElementById("winGiftDelta");
  const modeEl = document.getElementById("winRuleMode");
  if (idEl) idEl.value = "";
  if (giftEl) giftEl.value = "";
  if (deltaEl) deltaEl.value = "1";
  if (modeEl) modeEl.textContent = "เพิ่มใหม่";
}

function handleGiftForWin(parsed) {
  if (!parsed || parsed.kind !== "gift") return;
  if (!parsed.giftName) return;
  const name = String(parsed.giftName).trim().toLowerCase();
  const rule = winConfig.rules.find((r) => String(r.gift).trim().toLowerCase() === name);
  if (!rule || !rule.delta) return;
  adjustWinScore(rule.delta, `gift ${parsed.giftName}`);
}

/* ========== TTS config (built-in AI voice via app proxy) ========== */
const TTS_KEY = "tgr_tts_config";
const TTS_API = "/api/tts";
const TTS_API_FALLBACK = "http://127.0.0.1:3848";
const BUILTIN_TTS_VOICES = [
  { id: "th-google", name: "ไทย AI (ในโปรแกรม)" },
  { id: "th-TH-PremwadeeNeural", name: "Premwadee (หญิง · Neural)" },
  { id: "th-TH-NiwatNeural", name: "Niwat (ชาย · Neural)" },
  { id: "th-TH-AcharaNeural", name: "Achara (หญิง · Neural)" },
];
let ttsConfig = loadTtsConfig();
let ttsAudio = null;
let ttsReady = false;
let ttsSpeakQueue = [];
let ttsSpeaking = false;
let ttsSpokenDedupe = new Map(); // dedupeKey -> timestamp

async function ttsFetch(path, options = {}) {
  try {
    const res = await fetch(`${TTS_API}${path}`, { ...options, cache: "no-store" });
    return res;
  } catch {
    return fetch(`${TTS_API_FALLBACK}${path}`, { ...options, cache: "no-store" });
  }
}
function setTtsActivity(msg) {
  const el = document.getElementById("ttsActivity");
  if (el) el.textContent = msg || "รออีเวนต์จากไลฟ์...";
}

function defaultTtsConfig() {
  return {
    enabled: false,
    voiceURI: "th-google",
    rate: 1,
    readName: true,
    readGift: true,
    readMessage: true,
    readEmoji: false,
  };
}

function loadTtsConfig() {
  try {
    const raw = localStorage.getItem(TTS_KEY);
    if (!raw) return defaultTtsConfig();
    const parsed = JSON.parse(raw);
    let voiceURI = parsed.voiceURI || "th-google";
    // ย้ายจากเสียง Windows เก่า → เสียงในโปรแกรม
    if (!BUILTIN_TTS_VOICES.some((v) => v.id === voiceURI)) {
      voiceURI = "th-google";
    }
    return {
      enabled: !!parsed.enabled,
      voiceURI,
      rate: typeof parsed.rate === "number" ? parsed.rate : 1,
      readName: parsed.readName !== false,
      readGift: parsed.readGift !== false,
      readMessage: parsed.readMessage !== false,
      readEmoji: !!parsed.readEmoji,
    };
  } catch {
    return defaultTtsConfig();
  }
}

function saveTtsConfig() {
  localStorage.setItem(TTS_KEY, JSON.stringify(ttsConfig));
}

function fillTtsVoices() {
  const select = document.getElementById("ttsVoice");
  if (!select) return;
  const current = ttsConfig.voiceURI;
  select.innerHTML = BUILTIN_TTS_VOICES.map(
    (v) =>
      `<option value="${v.id}" ${v.id === current ? "selected" : ""}>${escapeHtml(v.name)}</option>`
  ).join("");
  if (!BUILTIN_TTS_VOICES.some((v) => v.id === ttsConfig.voiceURI)) {
    ttsConfig.voiceURI = BUILTIN_TTS_VOICES[0].id;
    select.value = ttsConfig.voiceURI;
    saveTtsConfig();
  }
}

async function refreshTtsStatus() {
  const hint = document.getElementById("ttsVoiceHint");
  try {
    const res = await ttsFetch("/health");
    const data = await res.json();
    ttsReady = !!data.ok;
    if (hint) {
      hint.textContent = ttsReady
        ? "สถานะเสียง AI: พร้อมใช้งาน (ในโปรแกรม · ไม่ใช้เสียง Windows)"
        : "สถานะเสียง AI: ยังไม่พร้อม — รอสักครู่แล้วลองใหม่";
    }
  } catch {
    ttsReady = false;
    if (hint) {
      hint.textContent =
        "สถานะเสียง AI: ยังไม่พร้อม — ปิดแล้วเปิด Monkeyeffect ใหม่ (หรือเปิดจากไอคอนทางลัด)";
    }
  }
}

function renderTtsUiState() {
  const enabledEl = document.getElementById("ttsEnabled");
  const rateEl = document.getElementById("ttsRate");
  const rateLabel = document.getElementById("ttsRateLabel");
  const readNameEl = document.getElementById("ttsReadName");
  const readGiftEl = document.getElementById("ttsReadGift");
  const readMessageEl = document.getElementById("ttsReadMessage");
  const readEmojiEl = document.getElementById("ttsReadEmoji");
  if (enabledEl) enabledEl.checked = !!ttsConfig.enabled;
  if (rateEl) rateEl.value = String(Math.round((ttsConfig.rate || 1) * 10));
  if (rateLabel) rateLabel.textContent = (ttsConfig.rate || 1).toFixed(1);
  if (readNameEl) readNameEl.checked = ttsConfig.readName !== false;
  if (readGiftEl) readGiftEl.checked = ttsConfig.readGift !== false;
  if (readMessageEl) readMessageEl.checked = ttsConfig.readMessage !== false;
  if (readEmojiEl) readEmojiEl.checked = !!ttsConfig.readEmoji;
  fillTtsVoices();
  refreshTtsStatus();
}

function stopTtsAudio() {
  ttsSpeakQueue = [];
  ttsSpeaking = false;
  if (ttsAudio) {
    try {
      ttsAudio.pause();
      ttsAudio.src = "";
    } catch {
      /* ignore */
    }
    ttsAudio = null;
  }
}

async function duckHostMusic(factor) {
  try {
    await fetch("/api/media/duck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factor }),
    });
  } catch {
    /* ignore */
  }
}

async function speakThaiNow(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;

  unlockAudio();
  if (!ttsReady) await refreshTtsStatus();
  if (!ttsReady) {
    // one more kick — backend starts TTS lazily
    await new Promise((r) => setTimeout(r, 800));
    await refreshTtsStatus();
  }
  if (!ttsReady) {
    setTtsActivity("ยังไม่พบเสียง AI — ปิดแล้วเปิดโปรแกรมใหม่");
    return;
  }

  setTtsActivity(`กำลังอ่าน: ${cleaned}`);
  await duckHostMusic(0.16);

  const body = JSON.stringify({
    text: cleaned,
    voice: ttsConfig.voiceURI || "th-google",
    rate: ttsConfig.rate || 1,
  });

  try {
  // Prefer server-side play so minimized / folded window still speaks.
  try {
    const playRes = await ttsFetch("/speak-play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (playRes.ok) {
      const data = await playRes.json().catch(() => ({}));
      if (data?.ok || data?.played) return;
    }
  } catch (err) {
    console.warn("tts speak-play failed, fallback to browser audio", err);
  }

  const res = await ttsFetch("/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    let msg = "อ่านเสียงไม่สำเร็จ";
    try {
      const err = await res.json();
      if (err.error) msg = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  if (!blob || blob.size < 64) {
    throw new Error("ได้ไฟล์เสียงว่าง");
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  ttsAudio = audio;
  audio.volume = 1;
  audio.playbackRate = Math.min(2, Math.max(0.5, ttsConfig.rate || 1));

  await new Promise((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (ttsAudio === audio) ttsAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (ttsAudio === audio) ttsAudio = null;
      reject(new Error("เล่นเสียงไม่สำเร็จ"));
    };
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((err) => {
        reject(new Error(err?.message || "เบราว์เซอร์บล็อกเสียง — กดทดสอบอีกครั้ง"));
      });
    }
  });
  } finally {
    await duckHostMusic(1);
  }
}

async function drainTtsQueue() {
  if (ttsSpeaking) return;
  ttsSpeaking = true;
  while (ttsSpeakQueue.length) {
    const text = ttsSpeakQueue.shift();
    try {
      await speakThaiNow(text);
    } catch (err) {
      console.warn(err);
      setTtsActivity(`ผิดพลาด: ${err.message || err}`);
    }
  }
  ttsSpeaking = false;
  if (ttsConfig.enabled) setTtsActivity("รออีเวนต์จากไลฟ์...");
}

function speakThai(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return Promise.resolve();
  ttsSpeakQueue.push(cleaned);
  // จำกัดคิว ไม่ให้นานเกินไป
  if (ttsSpeakQueue.length > 8) ttsSpeakQueue = ttsSpeakQueue.slice(-8);
  return drainTtsQueue();
}

function speakTemplate(_template, data) {
  const text = buildSpeechFromParts(data);
  if (!text) {
    const missing = [];
    if (ttsConfig.readName !== false) missing.push("ชื่อ");
    if (ttsConfig.readGift !== false) missing.push("ของขวัญ");
    if (ttsConfig.readMessage !== false) missing.push("ข้อความ");
    setTtsActivity(
      `ข้าม: ไม่มีข้อมูลตามติ๊ก (${missing.join("/") || "ไม่ได้ติ๊กอะไร"}) · อีเวนต์=${data.kind || "?"}`
    );
    return;
  }
  speakThai(text).catch((err) => {
    console.warn(err);
    setTtsActivity(`สถานะเสียง AI: ${err.message || "ผิดพลาด"}`);
  });
}

function shouldSpeakEvent(parsed) {
  const key = parsed.dedupeKey || parsed.key;
  const now = Date.now();
  const last = ttsSpokenDedupe.get(key) || 0;
  // ไลค์จากคนเดิม: อ่านซ้ำได้หลัง 45 วิ
  const gap = parsed.kind === "like" ? 45000 : parsed.kind === "follow" ? 20000 : 1500;
  if (now - last < gap) return false;
  ttsSpokenDedupe.set(key, now);
  // เก็บแม็ปไม่ให้โตเกิน
  if (ttsSpokenDedupe.size > 200) {
    const first = ttsSpokenDedupe.keys().next().value;
    ttsSpokenDedupe.delete(first);
  }
  return true;
}

function handleGiftForTts(parsed) {
  if (!ttsConfig.enabled) {
    setTtsActivity("ยังไม่เปิดใช้ — ติ๊ก “เปิดใช้” ด้านบน");
    return;
  }
  if (!["gift", "like", "follow", "chat"].includes(parsed.kind)) {
    if (!parsed.message) return;
  }
  if (!shouldSpeakEvent(parsed)) {
    setTtsActivity(`ข้ามซ้ำ: ${parsed.kind} จาก ${parsed.sender}`);
    return;
  }
  devLog("tts", "speak", { kind: parsed.kind, sender: parsed.sender, gift: parsed.speakGiftName || parsed.giftName });
  speakTemplate(null, {
    name: parsed.sender,
    gift: parsed.speakGiftName || "",
    speakGiftName: parsed.speakGiftName || "",
    message: parsed.message || "",
    rawText: parsed.rawText || "",
    kind: parsed.kind,
    count: parsed.count,
  });
}

function renderGiftActionOverview() {
  const box = document.getElementById("giftActionOverview");
  const countEl = document.getElementById("giftActionOverviewCount");
  if (!box) return;
  const map = new Map();
  const add = (name, action, preferName) => {
    const raw = String(name || "").trim();
    if (!raw) return;
    const key = normalizeInterruptGiftKey(raw) || raw.toLowerCase();
    if (key === "doughnut" || key === "donut") return;
    if (!map.has(key)) map.set(key, { displayName: raw, actions: new Set() });
    const rec = map.get(key);
    rec.actions.add(action);
    if (preferName) rec.displayName = raw;
  };
  for (const r of musicConfig?.rules || []) {
    if (r?.enabled === false) continue;
    add(r.giftName, "เพลง");
  }
  for (const r of videoConfig?.rules || []) {
    if (r?.enabled === false) continue;
    add(r.giftName, "วิดีโอ");
  }
  for (const r of interruptConfig?.rules || []) {
    if (r?.enabled === false) continue;
    add(r.giftName || (r.trigger === "like" ? "Like" : r.trigger === "follow" ? "Follow" : ""), "ขัดจอ");
  }
  for (const r of rouletteConfig?.rules || []) {
    if (r?.enabled === false) continue;
    add(r.triggerGift, r.mode === "multiply" ? "กล่องสุ่ม+คูณ" : "กล่องสุ่ม", true);
  }
  for (const r of winConfig?.rules || []) {
    add(r.gift, "นับ Win");
  }
  const rows = [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "th"));
  if (countEl) countEl.textContent = `${rows.length} ของขวัญ`;
  if (!rows.length) {
    box.innerHTML = '<p class="hint">ยังไม่มีกฎพิเศษ — ของขวัญทุกชิ้นเข้าเกมตามจำนวนที่รับมา</p>';
    return;
  }
  box.innerHTML = rows
    .map((rec) => {
      const actions = [...rec.actions];
      const roulette = actions.some((a) => a.startsWith("กล่องสุ่ม"));
      const chips = (roulette ? [] : ["เข้าเกม"]).concat(actions).map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join(" ");
      return `<div class="rule-row"><div><strong>${escapeHtml(rec.displayName)}</strong></div><div>${chips}</div></div>`;
    })
    .join("");
}

/* ========== Roulette (กล่องสุ่มเอฟเฟกต์เกม) ========== */
const ROULETTE_KEY = "tgr_roulette_config";
const ROULETTE_ITEM_W = 128;
const ROULETTE_OVERLAY_CHANNEL = "tgr-roulette-overlay";
const ROULETTE_OVERLAY_CMD_KEY = "tgr_roulette_overlay_cmd";
const ROULETTE_OVERLAY_STATUS_KEY = "tgr_roulette_overlay_status";
let rouletteConfig = { enabled: true, rules: [] };
let rouletteBusy = false;
let rouletteQueue = [];
let rouletteDraftOutcomes = [];
let rouletteOverlayWin = null;
let rouletteOverlayReady = false;
const rouletteImageUrlCache = new Map();
const rouletteChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(ROULETTE_OVERLAY_CHANNEL) : null;

function shuffleRouletteList(list) {
  const a = [...(list || [])];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function buildShuffledSpinStrip(outcomes, winner, cycles = 8) {
  const pool = (outcomes || []).map(normalizeRouletteOutcome).filter(Boolean);
  const items = [];
  let targetIndex = 0;
  const landingCycle = Math.max(2, cycles - 2);
  for (let c = 0; c < cycles; c++) {
    const order = shuffleRouletteList(pool);
    if (c === landingCycle) {
      const idx = order.findIndex(
        (n) => String(n.giftName || "").toLowerCase() === String(winner.giftName || "").toLowerCase()
      );
      targetIndex = items.length + (idx >= 0 ? idx : 0);
    }
    items.push(...order);
  }
  items.push(...shuffleRouletteList(pool));
  return { items, targetIndex };
}

function postRouletteOverlayCommand(cmd) {
  const payload = { ...cmd, at: Date.now() };
  // Always persist — overlay may miss an early BroadcastChannel message while WebView loads.
  // Overlay dedupes by spin token so BC + storage won't double-run.
  try {
    localStorage.setItem(ROULETTE_OVERLAY_CMD_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  rouletteChannel?.postMessage(payload);
}

function waitForRouletteOverlayReady(timeoutMs = 8000) {
  if (rouletteOverlayReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(ok);
    };
    const onMsg = (ev) => {
      const d = ev?.data || ev;
      if (d?.type === "roulette-overlay-status" && (d.state === "ready" || d.state === "spinning")) {
        rouletteOverlayReady = true;
        finish(true);
      }
    };
    const onStorage = (ev) => {
      if (ev.key !== ROULETTE_OVERLAY_STATUS_KEY || !ev.newValue) return;
      try {
        onMsg({ data: JSON.parse(ev.newValue) });
      } catch {
        /* ignore */
      }
    };
    const cleanup = () => {
      rouletteChannel?.removeEventListener("message", onMsg);
      window.removeEventListener("storage", onStorage);
      clearTimeout(timer);
      clearInterval(poll);
    };
    rouletteChannel?.addEventListener("message", onMsg);
    window.addEventListener("storage", onStorage);
    const poll = setInterval(() => {
      if (rouletteOverlayReady) finish(true);
    }, 200);
    const timer = setTimeout(() => finish(false), timeoutMs);
    postRouletteOverlayCommand({ type: "ping" });
  });
}

function waitForRouletteOverlayDone(token, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(payload || { ok: true });
    };
    const onMsg = (ev) => {
      const d = ev?.data || ev;
      if (!d || d.type !== "roulette-done") return;
      if (token && d.token && d.token !== token) return;
      finish(d);
    };
    const onStorage = (ev) => {
      if (ev.key !== ROULETTE_OVERLAY_STATUS_KEY || !ev.newValue) return;
      try {
        onMsg({ data: JSON.parse(ev.newValue) });
      } catch {
        /* ignore */
      }
    };
    const cleanup = () => {
      rouletteChannel?.removeEventListener("message", onMsg);
      window.removeEventListener("storage", onStorage);
      clearTimeout(timer);
    };
    rouletteChannel?.addEventListener("message", onMsg);
    window.addEventListener("storage", onStorage);
    const timer = setTimeout(() => finish({ ok: false, timeout: true }), timeoutMs);
  });
}

async function isRouletteOverlayOpen() {
  try {
    const res = await fetch(`/api/roulette-overlay/status?t=${Date.now()}`);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.open;
  } catch {
    return !!(rouletteOverlayWin && !rouletteOverlayWin.closed);
  }
}

async function openRouletteOverlay() {
  const alreadyOpen = await isRouletteOverlayOpen();
  if (!alreadyOpen) {
    rouletteOverlayReady = false;
    try {
      localStorage.removeItem(ROULETTE_OVERLAY_CMD_KEY);
    } catch {
      /* ignore */
    }
  }
  let openedNative = alreadyOpen;
  if (!alreadyOpen) {
    try {
      const res = await fetch("/api/roulette-overlay/open", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        openedNative = !!data.open || data.ok;
      }
    } catch {
      openedNative = false;
    }
  }
  if (!openedNative) {
    const url = "/roulette-overlay.html?mode=chroma&v=15";
    if (!rouletteOverlayWin || rouletteOverlayWin.closed) {
      rouletteOverlayWin = window.open(url, "monkeyeffect_roulette_overlay", "popup=yes,width=720,height=400");
    }
  }
  const ready = await waitForRouletteOverlayReady(alreadyOpen ? 2500 : 8000);
  rouletteOverlayReady = ready || rouletteOverlayReady;
  return true;
}

async function closeRouletteOverlay() {
  try {
    await fetch("/api/roulette-overlay/close", { method: "POST" });
  } catch {
    /* ignore */
  }
  if (rouletteOverlayWin && !rouletteOverlayWin.closed) {
    try {
      rouletteOverlayWin.close();
    } catch {
      /* ignore */
    }
  }
  rouletteOverlayWin = null;
  rouletteOverlayReady = false;
}

rouletteChannel?.addEventListener("message", (ev) => {
  const d = ev?.data;
  if (d?.type === "roulette-overlay-status" && d.state === "ready") {
    rouletteOverlayReady = true;
  }
});
window.addEventListener("storage", (ev) => {
  if (ev.key !== ROULETTE_OVERLAY_STATUS_KEY || !ev.newValue) return;
  try {
    const d = JSON.parse(ev.newValue);
    if (d?.type === "roulette-overlay-status" && d.state === "ready") {
      rouletteOverlayReady = true;
    }
  } catch {
    /* ignore */
  }
});

function defaultRouletteConfig() {
  return { enabled: true, rules: [] };
}

function normalizeRouletteOutcome(raw) {
  if (typeof raw === "string") {
    const giftName = raw.trim();
    if (!giftName) return null;
    return { giftName, label: giftName, imageId: "" };
  }
  if (!raw || typeof raw !== "object") return null;
  const giftName = String(raw.giftName || raw.name || "").trim();
  if (!giftName) return null;
  const label = String(raw.label || giftName).trim() || giftName;
  const imageId = String(raw.imageId || "").trim();
  return { giftName, label, imageId };
}

function normalizeRouletteRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((r) => {
      if (!r) return null;
      const outcomes = (r.outcomes || []).map(normalizeRouletteOutcome).filter(Boolean);
      const seen = new Set();
      const unique = [];
      for (const o of outcomes) {
        const key = o.giftName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(o);
      }
      if (!r.triggerGift || !unique.length) return null;
      const mode = String(r.mode || "gift").toLowerCase() === "multiply" ? "multiply" : "gift";
      return {
        id: r.id || `rl_${Date.now().toString(36)}`,
        triggerGift: String(r.triggerGift).trim(),
        enabled: r.enabled !== false,
        mode,
        outcomes: unique,
      };
    })
    .filter(Boolean);
}

function loadRouletteConfigLocal() {
  try {
    const raw = localStorage.getItem(ROULETTE_KEY);
    if (!raw) return defaultRouletteConfig();
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      rules: normalizeRouletteRules(parsed.rules),
    };
  } catch {
    return defaultRouletteConfig();
  }
}

async function syncRouletteConfigFromServer() {
  try {
    const res = await fetch("/api/roulette/config");
    const data = await res.json();
    if (data?.ok && data.config) {
      rouletteConfig = {
        enabled: data.config.enabled !== false,
        rules: normalizeRouletteRules(data.config.rules),
      };
      localStorage.setItem(ROULETTE_KEY, JSON.stringify(rouletteConfig));
      if (!rouletteDraftOutcomes.length) resetRouletteDraftOutcomes();
      renderRouletteUi();
      return;
    }
  } catch {
    /* offline / old build */
  }
  rouletteConfig = loadRouletteConfigLocal();
  if (!rouletteDraftOutcomes.length) resetRouletteDraftOutcomes();
  renderRouletteUi();
  saveRouletteConfigToServer().catch(() => {});
}

async function saveRouletteConfigToServer() {
  rouletteConfig.rules = normalizeRouletteRules(rouletteConfig.rules);
  localStorage.setItem(ROULETTE_KEY, JSON.stringify(rouletteConfig));
  const res = await fetch("/api/roulette/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rouletteConfig),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "บันทึกกล่องสุ่มไม่สำเร็จ");
  }
  if (data.config) {
    rouletteConfig = {
      enabled: data.config.enabled !== false,
      rules: normalizeRouletteRules(data.config.rules),
    };
    localStorage.setItem(ROULETTE_KEY, JSON.stringify(rouletteConfig));
  }
  renderRouletteUi();
  renderGiftActionOverview();
}

function rouletteDefaultImageUrl(imageId) {
  if (!imageId) return "";
  return `/defaults/roulette/files/${encodeURIComponent(imageId)}.png`;
}

async function resolveRouletteImageUrl(imageId) {
  if (!imageId) return "";
  if (rouletteImageUrlCache.has(imageId)) return rouletteImageUrlCache.get(imageId);
  try {
    const row = await getAudioBlobCached(imageId);
    if (row?.blob) {
      const url = URL.createObjectURL(row.blob);
      rouletteImageUrlCache.set(imageId, url);
      return url;
    }
  } catch {
    /* ignore */
  }
  // Prefer disk cache, then bundled defaults pack (ships with the app).
  const candidates = [
    `/api/audio-file/${encodeURIComponent(imageId)}`,
    rouletteDefaultImageUrl(imageId),
  ];
  for (const url of candidates) {
    try {
      const head = await fetch(url, { method: "GET", cache: "force-cache" });
      if (head.ok) {
        rouletteImageUrlCache.set(imageId, url);
        return url;
      }
    } catch {
      /* try next */
    }
  }
  const fallback = candidates[0];
  rouletteImageUrlCache.set(imageId, fallback);
  return fallback;
}

async function ensureRouletteDefaultImages(pack) {
  const outcomes = (pack?.rules || []).flatMap((r) => r.outcomes || []);
  for (const o of outcomes) {
    const id = String(o.imageId || "").trim();
    if (!id) continue;
    try {
      const exists = await fetch(`/api/audio-file/${encodeURIComponent(id)}`, { method: "GET" });
      if (exists.ok) continue;
    } catch {
      /* copy from pack */
    }
    try {
      const res = await fetch(rouletteDefaultImageUrl(id));
      if (!res.ok) continue;
      const blob = await res.blob();
      await saveAudioBlob(id, blob, `${id}.png`, blob.type || "image/png");
      await fetch(`/api/audio-cache/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": blob.type || "image/png",
          "X-File-Name": encodeURIComponent(`${id}.png`),
        },
        body: blob,
      });
    } catch (err) {
      console.warn("[roulette] seed image failed", id, err);
    }
  }
}

async function applyRouletteDefaultsPack(force = false) {
  const res = await fetch(`/defaults/roulette/config.json?t=${Date.now()}`);
  if (!res.ok) throw new Error("ไม่พบแพ็กกล่องสุ่มเริ่มต้น");
  const pack = await res.json();
  await ensureRouletteDefaultImages(pack);
  const next = {
    enabled: pack.enabled !== false,
    rules: normalizeRouletteRules(pack.rules),
  };
  if (!force && rouletteConfig.rules.length) {
    localStorage.setItem("tgr_roulette_defaults_pack_version", String(pack.packVersion || "1"));
    return { applied: false, reason: "already-has-rules", pack };
  }
  rouletteConfig = next;
  await saveRouletteConfigToServer();
  localStorage.setItem("tgr_roulette_defaults_pack_version", String(pack.packVersion || "1"));
  return { applied: true, pack };
}

async function seedRouletteDefaultsIfNeeded() {
  try {
    await syncRouletteConfigFromServer();
    if (rouletteConfig.rules.length) {
      // Still hydrate bundled images so Overlay can load them on any PC.
      const peek = await fetch(`/defaults/roulette/config.json?t=${Date.now()}`);
      if (peek.ok) await ensureRouletteDefaultImages(await peek.json());
      return;
    }
    const result = await applyRouletteDefaultsPack(true);
    if (result.applied) console.info("[roulette] seeded little hippo defaults");
  } catch (err) {
    console.warn("[roulette] seed defaults failed", err);
  }
}

async function uploadRouletteImage(file) {
  const id = `rlimg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const mime = file.type || "image/png";
  await saveAudioBlob(id, file, file.name, mime);
  try {
    await fetch(`/api/audio-cache/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": mime,
        "X-File-Name": encodeURIComponent(file.name || `${id}.png`),
      },
      body: file,
    });
  } catch {
    /* disk mirror optional */
  }
  const url = URL.createObjectURL(file);
  rouletteImageUrlCache.set(id, url);
  return id;
}

function resetRouletteDraftOutcomes() {
  rouletteDraftOutcomes = [
    { giftName: "", label: "", imageId: "" },
    { giftName: "", label: "", imageId: "" },
  ];
}

function renderRouletteOutcomeEditor() {
  const host = document.getElementById("rouletteOutcomeEditor");
  if (!host) return;
  if (!rouletteDraftOutcomes.length) resetRouletteDraftOutcomes();
  host.innerHTML = rouletteDraftOutcomes
    .map((o, i) => {
      const thumb = o.imageId
        ? `<img class="roulette-outcome-thumb" data-roulette-thumb="${i}" alt="" />`
        : `<div class="roulette-outcome-thumb placeholder">ไม่มีรูป</div>`;
      return `<div class="roulette-outcome-card" data-roulette-card="${i}">
        ${thumb}
        <div class="roulette-outcome-fields">
          <input class="field" data-roulette-gift="${i}" type="text" placeholder="ชื่อส่งเข้าเกม เช่น Rose" value="${escapeHtml(o.giftName || "")}" />
          <input class="field" data-roulette-label="${i}" type="text" placeholder="ชื่อกำกับที่โชว์ตอนหมุน" value="${escapeHtml(o.label || "")}" />
          <input class="field" data-roulette-file="${i}" type="file" accept="image/*" />
        </div>
        <div class="roulette-outcome-actions">
          <button type="button" class="btn ghost small danger" data-roulette-remove="${i}">ลบ</button>
        </div>
      </div>`;
    })
    .join("");

  host.querySelectorAll("[data-roulette-gift]").forEach((el) => {
    el.addEventListener("input", () => {
      const i = Number(el.dataset.rouletteGift);
      if (!rouletteDraftOutcomes[i]) return;
      rouletteDraftOutcomes[i].giftName = el.value;
      if (!rouletteDraftOutcomes[i].label) {
        const labelEl = host.querySelector(`[data-roulette-label="${i}"]`);
        if (labelEl && !labelEl.value) {
          /* keep empty until user types */
        }
      }
    });
  });
  host.querySelectorAll("[data-roulette-label]").forEach((el) => {
    el.addEventListener("input", () => {
      const i = Number(el.dataset.rouletteLabel);
      if (rouletteDraftOutcomes[i]) rouletteDraftOutcomes[i].label = el.value;
    });
  });
  host.querySelectorAll("[data-roulette-file]").forEach((el) => {
    el.addEventListener("change", async () => {
      const i = Number(el.dataset.rouletteFile);
      const file = el.files && el.files[0];
      if (!file || !rouletteDraftOutcomes[i]) return;
      try {
        const imageId = await uploadRouletteImage(file);
        rouletteDraftOutcomes[i].imageId = imageId;
        renderRouletteOutcomeEditor();
      } catch (err) {
        alert(err.message || "อัปโหลดรูปไม่สำเร็จ");
      }
    });
  });
  host.querySelectorAll("[data-roulette-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.rouletteRemove);
      rouletteDraftOutcomes.splice(i, 1);
      if (rouletteDraftOutcomes.length < 2) resetRouletteDraftOutcomes();
      renderRouletteOutcomeEditor();
    });
  });

  rouletteDraftOutcomes.forEach(async (o, i) => {
    if (!o.imageId) return;
    const img = host.querySelector(`[data-roulette-thumb="${i}"]`);
    if (!img) return;
    img.src = await resolveRouletteImageUrl(o.imageId);
  });
}

function renderRouletteUi() {
  const enabledEl = document.getElementById("rouletteEnabled");
  const countEl = document.getElementById("rouletteRuleCount");
  const list = document.getElementById("rouletteRulesList");
  if (enabledEl) enabledEl.checked = rouletteConfig.enabled !== false;
  if (countEl) countEl.textContent = `${rouletteConfig.rules.length} กฎ`;
  renderRouletteOutcomeEditor();
  if (!list) return;
  if (!rouletteConfig.rules.length) {
    list.innerHTML = '<p class="hint">ยังไม่มีกฎ — เพิ่มของต้นทาง + เอฟเฟกต์พร้อมรูป/ชื่อกำกับ</p>';
    return;
  }
  list.innerHTML = rouletteConfig.rules
    .map((r) => {
      const thumbs = (r.outcomes || [])
        .map((o, idx) =>
          o.imageId
            ? `<img data-rule-thumb="${escapeHtml(r.id)}:${idx}" alt="" />`
            : `<span class="thumb-fallback">${escapeHtml((o.label || o.giftName || "?").slice(0, 2))}</span>`
        )
        .join("");
      return `<div class="rule-row${r.mode === "multiply" ? " is-fate" : ""}">
        <div>
          <strong>${escapeHtml(r.triggerGift || "")}</strong>
          <div class="roulette-rule-thumbs">${thumbs}</div>
        </div>
        <div class="rule-actions">
          <button type="button" class="btn ghost small" data-roulette-edit="${escapeHtml(r.id)}">แก้ไข</button>
          <input class="test-combo-input" type="number" min="1" max="99" value="1" data-roulette-test-count="${escapeHtml(r.id)}" title="คอมโบทดสอบ" aria-label="คอมโบทดสอบ" />
          <button type="button" class="btn ghost small" data-roulette-test="${escapeHtml(r.id)}">ทดสอบ</button>
          <button type="button" class="btn ghost small danger" data-roulette-del="${escapeHtml(r.id)}">ลบ</button>
        </div>
      </div>`;
    })
    .join("");
  list.querySelectorAll("[data-roulette-edit]").forEach((btn) => {
    btn.addEventListener("click", () => editRouletteRule(btn.dataset.rouletteEdit));
  });
  list.querySelectorAll("[data-roulette-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteRouletteRule(btn.dataset.rouletteDel));
  });
  list.querySelectorAll("[data-roulette-test]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rule = rouletteConfig.rules.find((r) => r.id === btn.dataset.rouletteTest);
      if (!rule) return;
      const countEl = list.querySelector(`[data-roulette-test-count="${CSS.escape(rule.id)}"]`);
      runRouletteSpin(
        rule.triggerGift,
        rule.outcomes,
        readTestComboCount(countEl),
        "ทดสอบ",
        rule.mode === "multiply"
      );
    });
  });
  rouletteConfig.rules.forEach((r) => {
    (r.outcomes || []).forEach(async (o, idx) => {
      if (!o.imageId) return;
      const img = list.querySelector(`[data-rule-thumb="${r.id}:${idx}"]`);
      if (!img) return;
      img.src = await resolveRouletteImageUrl(o.imageId);
    });
  });
}

function editRouletteRule(id) {
  const rule = rouletteConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  document.getElementById("rouletteEditId").value = rule.id;
  document.getElementById("rouletteTriggerGift").value = rule.triggerGift || "";
  setRouletteRuleMode(rule.mode === "multiply" ? "multiply" : "gift");
  rouletteDraftOutcomes = (rule.outcomes || []).map((o) => ({ ...o }));
  if (rouletteDraftOutcomes.length < 2) {
    while (rouletteDraftOutcomes.length < 2) {
      rouletteDraftOutcomes.push({ giftName: "", label: "", imageId: "" });
    }
  }
  renderRouletteOutcomeEditor();
}

function clearRouletteEditor() {
  document.getElementById("rouletteEditId").value = "";
  document.getElementById("rouletteTriggerGift").value = "";
  setRouletteRuleMode("gift");
  resetRouletteDraftOutcomes();
  renderRouletteOutcomeEditor();
}

function collectDraftOutcomes() {
  return rouletteDraftOutcomes
    .map((o) => normalizeRouletteOutcome(o))
    .filter(Boolean);
}

function setRouletteRuleMode(mode) {
  const next = mode === "multiply" ? "multiply" : "gift";
  const hidden = document.getElementById("rouletteRuleMode");
  if (hidden) hidden.value = next;
  document.querySelectorAll("#rouletteModePicks .roulette-mode-card").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.mode === next);
  });
}

function bindRouletteModePicks() {
  document.querySelectorAll("#rouletteModePicks .roulette-mode-card").forEach((btn) => {
    btn.addEventListener("click", () => setRouletteRuleMode(btn.dataset.mode));
  });
}

async function saveRouletteRuleFromForm() {
  const editId = document.getElementById("rouletteEditId").value.trim();
  const triggerGift = document.getElementById("rouletteTriggerGift").value.trim();
  const mode = document.getElementById("rouletteRuleMode")?.value === "multiply" ? "multiply" : "gift";
  const outcomes = collectDraftOutcomes();
  if (!triggerGift) {
    alert("ใส่ชื่อของขวัญต้นทาง");
    return;
  }
  if (outcomes.length < 2) {
    alert("ต้องมีเอฟเฟกต์อย่างน้อย 2 รายการ (ใส่ชื่อส่งเข้าเกม)");
    return;
  }
  if (editId) {
    const rule = rouletteConfig.rules.find((r) => r.id === editId);
    if (rule) {
      rule.triggerGift = triggerGift;
      rule.outcomes = outcomes;
      rule.enabled = true;
      rule.mode = mode;
    }
  } else {
    rouletteConfig.rules.push({
      id: `rl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      triggerGift,
      enabled: true,
      mode,
      outcomes,
    });
  }
  await saveRouletteConfigToServer();
  clearRouletteEditor();
}

async function deleteRouletteRule(id) {
  if (!confirm("ลบกฎกล่องสุ่มนี้?")) return;
  rouletteConfig.rules = rouletteConfig.rules.filter((r) => r.id !== id);
  await saveRouletteConfigToServer();
  clearRouletteEditor();
}

function pickRouletteWinner(outcomes) {
  const list = (outcomes || []).map(normalizeRouletteOutcome).filter(Boolean);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

const rouletteDeliveredTokens = new Set();

async function deliverRouletteWinner(giftName, count, sender, token, imageId) {
  // One spin → exactly one gift to the game (never multiply by trigger combo xN).
  const spinToken = String(token || "").trim();
  if (spinToken) {
    if (rouletteDeliveredTokens.has(spinToken)) {
      devLog("roulette", "deliver skip (token)", { token: spinToken, giftName });
      return { ok: true, deduped: true };
    }
    rouletteDeliveredTokens.add(spinToken);
    if (rouletteDeliveredTokens.size > 100) {
      const first = rouletteDeliveredTokens.values().next().value;
      rouletteDeliveredTokens.delete(first);
    }
  }
  const nick = String(sender || "").trim() || "ผู้ชม";
  const userName =
    "u_" +
    nick
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .slice(0, 48);
  const res = await fetch("/api/roulette/deliver", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      giftName,
      repeatCount: 1,
      messageType: "SendGift",
      nickname: nick,
      userName: userName || "viewer",
      source: "roulette",
      token: spinToken || undefined,
      imageId: imageId || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    if (spinToken) rouletteDeliveredTokens.delete(spinToken);
    throw new Error(data.error || data.tikTokError || "ส่งเอฟเฟกต์เข้าเกมไม่สำเร็จ");
  }
  return data;
}

function enrichOutcomesFromConfig(triggerGift, outcomes) {
  const normalized = (outcomes || []).map(normalizeRouletteOutcome).filter(Boolean);
  if (normalized.some((o) => o.imageId || (o.label && o.label !== o.giftName))) {
    return normalized;
  }
  const rule = rouletteConfig.rules.find(
    (r) =>
      r.enabled !== false &&
      String(r.triggerGift || "").toLowerCase() === String(triggerGift || "").toLowerCase()
  );
  if (!rule) return normalized;
  const byName = new Map(
    (rule.outcomes || []).map((o) => [String(o.giftName || "").toLowerCase(), o])
  );
  return normalized.map((o) => {
    const hit = byName.get(o.giftName.toLowerCase());
    return hit ? { ...o, label: hit.label || o.label, imageId: hit.imageId || o.imageId } : o;
  });
}

function readTestComboCount(el) {
  const n = Number(el?.value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, Math.round(n));
}

async function runRouletteSpin(triggerGift, outcomes, count = 1, sender = "ผู้ชม", multiply = false) {
  const cleanOutcomes = enrichOutcomesFromConfig(triggerGift, outcomes);
  if (cleanOutcomes.length < 1) return;
  // Server owns spin/overlay/deliver (works while minimized).
  const res = await fetch("/api/roulette/spin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      triggerGift,
      count: count || 1,
      sender: sender || "ผู้ชม",
      outcomes: cleanOutcomes,
      multiply: !!multiply,
      mode: multiply ? "multiply" : "gift",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "สุ่มเอฟเฟกต์ไม่สำเร็จ");
  }
}

async function kickRouletteQueue() {
  if (rouletteBusy) return;
  rouletteBusy = true;
  while (rouletteQueue.length) {
    const job = rouletteQueue.shift();
    try {
      await playRouletteAnimationAndDeliver(job);
    } catch (err) {
      console.warn(err);
      setTikTokError(err.message || String(err));
    }
  }
  rouletteBusy = false;
}

function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rouletteSpinImageUrl(imageId) {
  if (!imageId) return "";
  // Overlay WebView can load bundled defaults even before media-cache is filled.
  return `/api/audio-file/${encodeURIComponent(imageId)}`;
}

function prepareRouletteSpinPayload(job, winner) {
  const { items, targetIndex } = buildShuffledSpinStrip(job.outcomes, winner, 8);
  const fixed = items.map((src) => ({
    giftName: src.giftName,
    label: src.label || src.giftName,
    imageUrl: src.imageId
      ? rouletteSpinImageUrl(src.imageId)
      : "",
    imageFallback: src.imageId ? rouletteDefaultImageUrl(src.imageId) : "",
  }));
  return {
    items: fixed,
    targetIndex,
    winner: {
      giftName: winner.giftName,
      label: winner.label || winner.giftName,
      imageUrl: winner.imageId ? rouletteSpinImageUrl(winner.imageId) : "",
      imageFallback: winner.imageId ? rouletteDefaultImageUrl(winner.imageId) : "",
    },
  };
}

async function playRouletteAnimationAndDeliver(job) {
  const winner = pickRouletteWinner(job.outcomes);
  if (!winner) return;

  await openRouletteOverlay();
  const token = `rl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const payload = prepareRouletteSpinPayload(job, winner);
  const durationMs = 3400;
  postRouletteOverlayCommand({
    type: "roulette-spin",
    token,
    triggerGift: job.triggerGift,
    count: job.count,
    sender: job.sender,
    items: payload.items,
    targetIndex: payload.targetIndex,
    winner: payload.winner,
    itemWidth: ROULETTE_ITEM_W,
    durationMs,
    holdMs: 1000,
  });
  await waitForRouletteOverlayDone(token, durationMs + 2500);
  // Always x1 — one finished spin delivers one winner gift (sender kept).
  await deliverRouletteWinner(winner.giftName, 1, job.sender, token, winner.imageId);
  await waitMs(200);
}

const rouletteHandledEventIds = new Set();

function handleGiftForRoulette(parsed) {
  // Spin+deliver runs on the server (RouletteSpinService) so it keeps working
  // while the main window is minimized. UI only fans out music/video/win/tts.
  devLog("roulette", "server-owned spin", {
    trigger: parsed.giftName,
    count: parsed.count,
  });
}

function giftLogItemKey(item, indexInBatch = 0) {
  if (item?.seq != null && item.seq !== "") return `seq:${item.seq}`;
  // fallback: time+text+ตำแหน่งในล็อก — กันของซ้ำข้อความวินาทีเดียวกันถูกรวม
  return `${item?.time || ""}|${item?.text || ""}|#${indexInBatch}`;
}

/** Per-function combo dedupe so ui announce fires each feature once per combo. */
const uiFeatureDedupeAt = new Map();
const UI_FEATURE_DEDUPE_MS = 2500;

function claimUiFeature(feature, parsed) {
  // Per-event only — backend already emits one ui/roulette announce per combo.
  // Do NOT key by comboKey alone (would suppress a real second gift within 2.5s).
  const eventId = Number.isFinite(parsed.seq)
    ? `seq:${parsed.seq}`
    : (parsed.key || parsed.dedupeKey || parsed.comboKey || "anon");
  const key = `${feature}|${eventId}`;
  const now = Date.now();
  const last = uiFeatureDedupeAt.get(key) || 0;
  if (now - last < UI_FEATURE_DEDUPE_MS) return false;
  uiFeatureDedupeAt.set(key, now);
  if (uiFeatureDedupeAt.size > 500) {
    for (const [k, t] of uiFeatureDedupeAt) {
      if (now - t > 30000) uiFeatureDedupeAt.delete(k);
    }
  }
  return true;
}

function fanOutUiFunctions(parsed) {
  // Interrupt = exact xN from FINAL game line only (no early ui → no under/over stack).
  if (parsed.phase === "game") {
    if (claimUiFeature("interrupt", parsed)) handleGiftForInterrupt(parsed);
    return;
  }
  if (parsed.kind === "roulette") {
    const triggerParsed = { ...parsed, kind: "gift" };
    if (claimUiFeature("music", triggerParsed)) handleGiftForMusic(triggerParsed);
    if (claimUiFeature("video", triggerParsed)) handleGiftForVideo(triggerParsed);
    if (claimUiFeature("win", triggerParsed)) handleGiftForWin(triggerParsed);
    if (claimUiFeature("tts", triggerParsed)) handleGiftForTts(triggerParsed);
    if (claimUiFeature("roulette", parsed)) handleGiftForRoulette(parsed);
    return;
  }
  // Early ui: realtime for everything except interrupt
  if (claimUiFeature("music", parsed)) handleGiftForMusic(parsed);
  if (claimUiFeature("video", parsed)) handleGiftForVideo(parsed);
  if (claimUiFeature("win", parsed)) handleGiftForWin(parsed);
  if (claimUiFeature("tts", parsed)) handleGiftForTts(parsed);
}

function processNewGifts(items) {
  if (!Array.isArray(items)) return;
  const keyed = items.map((item, i) => ({ item, key: giftLogItemKey(item, i) }));
  if (!giftWatchReady) {
    seenGiftKeys = new Set(keyed.map((k) => k.key));
    giftWatchReady = true;
    return;
  }
  const fresh = [];
  for (const row of keyed) {
    if (!seenGiftKeys.has(row.key)) fresh.push(row.item);
    seenGiftKeys.add(row.key);
  }
  // เก็บคีย์สะสม — อย่าเหลือแค่หน้าต่างล็อกล่าสุด (เคยทำให้ของเก่าหลุดแล้วเข้าใหม่ซ้ำ)
  if (seenGiftKeys.size > 800) {
    const keep = keyed.map((k) => k.key);
    const next = new Set(keep);
    // เก็บของใหม่ในล็อก + เผื่อคีย์ล่าสุดที่เพิ่งประมวลผล
    for (const k of [...seenGiftKeys].slice(-200)) next.add(k);
    seenGiftKeys = next;
  }
  // ล็อก API เรียงใหม่→เก่า — ประมวลผลเก่า→ใหม่ให้คอมโบตามลำดับเวลา
  for (const item of fresh.reverse()) {
    const parsed = parseGiftFromLog(item);
    if (!parsed) continue;
    fanOutUiFunctions(parsed);
  }
}

/* ========== Status / connect (existing) ========== */
function renderLog(items) {
  logEl.innerHTML = "";

  if (!items.length) {
    logEl.innerHTML = '<div class="log-item system">ยังไม่มี gift</div>';
    return;
  }

  for (const item of items) {
    const div = document.createElement("div");
    const kind = item.kind || "system";
    const displayKind =
      kind === "ui" ? "gift" : kind === "game" ? "system" : kind;
    div.className = `log-item ${displayKind}`;
    const phaseTag =
      kind === "ui" ? " · UI" : kind === "game" ? " · GAME" : "";
    const sent =
      item.sent != null
        ? ` · ส่งแล้ว ${item.sent}${item.windowSent ? " (/livemsg)" : ""}`
        : "";
    const text = item.text || "";
    const fromMatch = text.match(/\s+(?:from|จาก)\s+(.+)$/i);
    const giftMatch = text
      .replace(/^\s*\[TEST\]\s*/i, "")
      .replace(/^\s*\[GAME-SKIP roulette\]\s*/i, "")
      .replace(/^\s*\[ROULETTE-WIN\]\s*/i, "")
      .match(/^(.+?) x(\d+)/);
    let body;
    if ((kind === "gift" || kind === "like" || kind === "follow" || kind === "ui" || kind === "game") && giftMatch) {
      const who = fromMatch ? ` <span class="from-name">จาก ${escapeHtml(fromMatch[1])}</span>` : "";
      const testTag = /^\[TEST\]/i.test(text) ? ' <span class="test-tag">(ทดสอบ)</span>' : "";
      body = `<span class="gift-name">${escapeHtml(giftMatch[1])}</span> x${giftMatch[2]}${who}${testTag}`;
    } else if (kind === "chat") {
      const chatMatch = text.match(/^(?:Chat|chat|ข้อความ)\s*[:：]\s*(.+?)\s+(?:from|จาก)\s+(.+)$/i);
      if (chatMatch) {
        body = `<span class="gift-name">แชท</span> ${escapeHtml(chatMatch[1])} <span class="from-name">จาก ${escapeHtml(chatMatch[2])}</span>`;
      } else {
        body = escapeHtml(text);
      }
    } else if (fromMatch && (kind === "follow" || kind === "like" || kind === "ui")) {
      body = `${escapeHtml(text.slice(0, fromMatch.index))} <span class="from-name">จาก ${escapeHtml(fromMatch[1])}</span>`;
    } else {
      body = escapeHtml(text);
    }
    div.innerHTML = `
      <div class="meta">${item.time || ""}${phaseTag}${sent}</div>
      <div>${body}</div>
    `;
    logEl.appendChild(div);
  }
}

function updateStatus(data) {
  const tikTokConnecting = data.tikTokConnecting ?? data.tiktokConnecting;
  const tikTokReconnecting = data.tikTokReconnecting ?? data.tiktokReconnecting;
  const tikTokConnected = data.tikTokConnected ?? data.tiktokConnected;
  const tikTokLive = data.tikTokLive ?? data.tiktokLive;
  const tikTokUsername = data.tikTokUsername ?? data.tiktokUsername ?? "";

  const isConnecting = connecting || tikTokConnecting;
  const live = tikTokConnected && tikTokLive && !tikTokReconnecting;

  if (isConnecting) {
    liveBadge.className = "badge connecting";
    badgeText.textContent = "CONNECTING";
  } else if (tikTokReconnecting && tikTokConnected) {
    liveBadge.className = "badge connecting";
    badgeText.textContent = "RECONNECTING";
  } else if (live) {
    liveBadge.className = "badge live";
    badgeText.textContent = "LIVE";
  } else {
    liveBadge.className = "badge offline";
    badgeText.textContent = "OFFLINE";
  }

  if (isConnecting) {
    tiktokStatus.textContent = "กำลังเชื่อมต่อ...";
  } else if (tikTokReconnecting && tikTokConnected) {
    tiktokStatus.textContent = tikTokUsername ? `@${tikTokUsername} · ต่อใหม่` : "กำลังต่อใหม่...";
  } else if (tikTokConnected) {
    tiktokStatus.textContent = live ? `@${tikTokUsername}` : "Connected (not live)";
  } else {
    tiktokStatus.textContent = "Disconnected";
  }

  if (ycLiveStatus) {
    if (data.directLiveReady) {
      ycLiveStatus.textContent = data.gamePolledLive ? "direct ✓ เกม poll" : "direct /livemsg";
      ycLiveStatus.classList.add("accent");
    } else if (data.ycLiveReady) {
      ycLiveStatus.textContent = "ycLive UIA";
      ycLiveStatus.classList.add("accent");
    } else {
      ycLiveStatus.textContent = "ไม่พร้อม";
      ycLiveStatus.classList.remove("accent");
    }
  }

  if (gameWindowStatus) {
    gameWindowStatus.textContent = data.gameWindowFound
      ? data.gameWindowTitle || data.selectedGameName || "พบแล้ว"
      : "ไม่พบ";
    gameWindowStatus.classList.toggle("accent", !!data.gameWindowFound);
  }
  if (selectedGameLabel && data.selectedGameName) {
    selectedGameLabel.textContent = data.selectedGameName;
  }
  if (httpPort) httpPort.textContent = String(data.gameHttpPort ?? 12922);

  connectBtn.disabled = isConnecting || tikTokConnected;
  disconnectBtn.disabled = isConnecting || !tikTokConnected;
  usernameInput.disabled = isConnecting || tikTokConnected;

  if (Array.isArray(data.giftLog)) {
    processNewGifts(data.giftLog);
    renderLog(data.giftLog);
  }

  if (!connecting) {
    const gameErr = data.gameError || data.ycLiveError || "";
    setGameError(gameErr);
    setTikTokError(data.tikTokError || "");
  }
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    updateStatus(data);
  } catch {
    // ignore transient poll errors
  }
}

async function openLoginChrome() {
  setTikTokError("");
  if (loginChromeBtn) loginChromeBtn.disabled = true;
  try {
    const res = await fetch("/api/tiktok-login-chrome", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "เปิด Chrome ไม่สำเร็จ");
    setTikTokError("ล็อกอินใน Chrome ที่เปิดขึ้นมาให้เสร็จ แล้วกด Connect");
    await fetchStatus();
  } catch (err) {
    setTikTokError(err.message);
  } finally {
    if (loginChromeBtn) loginChromeBtn.disabled = false;
  }
}

async function connect() {
  // TikTok uniqueId is case-sensitive (almost always lowercase).
  const username = usernameInput.value.trim().replace(/^@+/, "").toLowerCase();
  if (!username) {
    setTikTokError("กรุณากรอก TikTok username");
    return;
  }
  usernameInput.value = username;

  localStorage.setItem("tgr_username", username);

  setTikTokError("");
  setConnectingUI(true);
  updateStatus({ tikTokConnecting: true, tikTokConnected: false });

  try {
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        gameWsPort: Number(gamePortInput.value) || 15500,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.tikTokError || data.error || "Connect failed");
    setTikTokError("");
    updateStatus(data.status);
  } catch (err) {
    setTikTokError(err.message);
    await fetchStatus();
  } finally {
    setConnectingUI(false);
    await fetchStatus();
  }
}

async function disconnect() {
  connectBtn.disabled = true;
  try {
    const res = await fetch("/api/disconnect", { method: "POST" });
    const data = await res.json();
    updateStatus(data.status);
  } finally {
    connectBtn.disabled = false;
  }
}

async function sendTestGift() {
  const giftName = testGiftInput.value.trim() || "Rose";
  const messageType = document.getElementById("testType")?.value || "SendGift";
  testBtn.disabled = true;

  try {
    const res = await fetch("/api/test-gift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        giftName,
        repeatCount: Number(testCountInput.value) || 1,
        messageType,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setGameError(data.gameError || data.error || "Test failed");
      return;
    }

    if (data.ycLiveSent || data.sent > 0) {
      setGameError("");
    } else if (data.status?.gameError || data.status?.ycLiveError) {
      setGameError(data.status.gameError || data.status.ycLiveError);
    }

    await fetchStatus();
  } finally {
    testBtn.disabled = false;
  }
}

/* ========== Wire events ========== */
connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
if (loginChromeBtn) loginChromeBtn.addEventListener("click", openLoginChrome);
testBtn.addEventListener("click", sendTestGift);
clearBtn.addEventListener("click", () => {
  renderLog([]);
  seenGiftKeys = new Set();
  giftWatchReady = false;
});

function toggleCustomGameFields() {
  if (!customGameFields || !gameSelect) return;
  customGameFields.classList.toggle("hidden", gameSelect.value !== "custom");
}

function getSelectedGameSnapshot(extra = {}) {
  const id = extra.id || gameSelect?.value || TEMPLE_GAME_ID;
  const opt = gameSelect?.selectedOptions?.[0];
  return {
    id,
    displayName: extra.displayName || opt?.textContent || id,
    customProcess: extra.customProcess ?? (customGameProcess?.value?.trim() || null),
    customTitle: extra.customTitle ?? (customGameTitle?.value?.trim() || null),
  };
}

function broadcastSelectedGame(game) {
  const payload = {
    type: "selected-game",
    game: {
      id: game.id,
      displayName: game.displayName || game.id,
    },
    at: Date.now(),
  };
  try {
    localStorage.setItem("tgr_selected_game_event", JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  try {
    gameChannel?.postMessage(payload);
  } catch {
    /* ignore */
  }
}

function syncEffectsPanelForGame(game) {
  if (!game?.id) return;
  currentSelectedGame = {
    id: game.id,
    displayName: game.displayName || game.id,
  };
  const name = currentSelectedGame.displayName;
  const chip = document.getElementById("effectsGameChip");
  const testHint = document.getElementById("effectsTestHint");
  const defaultsCard = document.getElementById("effectsDefaultsCard");
  const noDefaultsCard = document.getElementById("effectsNoDefaultsCard");
  const defaultsTitle = document.getElementById("effectsDefaultsTitle");
  const defaultsHint = document.getElementById("effectsDefaultsHint");
  const noDefaultsHint = document.getElementById("effectsNoDefaultsHint");

  if (chip) chip.textContent = name;
  if (testHint) {
    testHint.textContent = `ส่งของทดสอบเข้า ${name} — เข้ารหัส AES-GCM แล้วเสิร์ฟ GET /livemsg :12922`;
  }

  WORKSPACE_META.effects = {
    title: `เอฟเฟกต์เกม · ${name}`,
    sub: `ทดสอบส่งของเข้า ${name} และตั้งค่า gift (ถ้ามีแพ็ก)`,
  };
  if (document.getElementById("panel-effects")?.classList.contains("active")) {
    setWorkspaceMeta("effects");
  }

  const isTemple = currentSelectedGame.id === TEMPLE_GAME_ID;
  defaultsCard?.classList.toggle("hidden", !isTemple);
  noDefaultsCard?.classList.toggle("hidden", isTemple);
  if (isTemple) {
    if (defaultsTitle) defaultsTitle.textContent = `ค่าตั้งต้น gift ใน ${name}`;
    if (defaultsHint) {
      defaultsHint.innerHTML =
        `กดปุ่มด้านล่างเพื่อ<b>ทับ</b>ไฟล์เซฟเกมด้วยแพ็กที่มากับ Monkeyeffect · ปิดเกม <b>${name}</b> ก่อนกด · แล้วเปิดเกมใหม่`;
    }
  } else if (noDefaultsHint) {
    noDefaultsHint.textContent = `${name} ยังไม่มีแพ็กค่าตั้งต้นในแอพ — ใช้ Send Test เพื่อยิงของเข้าเกมผ่าน /livemsg ได้ตามปกติ`;
  }
}

async function saveSelectedGame(extra = {}) {
  if (!gameSelect || savingGame) return;
  savingGame = true;
  try {
    const payload = {
      id: gameSelect.value || "temple-escape",
      customProcess: customGameProcess?.value?.trim() || null,
      customTitle: customGameTitle?.value?.trim() || null,
      displayName: extra.displayName || null,
      ...extra,
    };
    if (!payload.displayName) {
      const opt = gameSelect.selectedOptions?.[0];
      payload.displayName = opt?.textContent || payload.id;
    }
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(payload));
    const res = await fetch("/api/games/selected", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data?.selected?.displayName && selectedGameLabel) {
      selectedGameLabel.textContent = data.selected.displayName;
    }
    const snap = {
      id: payload.id,
      displayName: data?.selected?.displayName || payload.displayName || payload.id,
    };
    syncEffectsPanelForGame(snap);
    broadcastSelectedGame(snap);
    await fetchStatus();
  } catch {
    /* ignore */
  } finally {
    savingGame = false;
  }
}

async function loadGames() {
  if (!gameSelect) return;
  try {
    const res = await fetch("/api/games");
    const data = await res.json();
    gameCatalog = Array.isArray(data.games) ? data.games : [];
    gameSelect.innerHTML = "";
    for (const g of gameCatalog) {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      gameSelect.appendChild(opt);
    }
    let selected = data.selected;
    try {
      const cached = JSON.parse(localStorage.getItem(GAME_STORAGE_KEY) || "null");
      if (cached?.id) selected = cached;
    } catch {
      /* ignore */
    }
    if (selected?.id) {
      gameSelect.value = selected.id;
      if (customGameProcess) customGameProcess.value = selected.customProcess || "";
      if (customGameTitle) customGameTitle.value = selected.customTitle || "";
      if (selectedGameLabel) {
        selectedGameLabel.textContent = selected.displayName || selected.id;
      }
    }
    toggleCustomGameFields();
    // sync server with UI (including localStorage preference)
    await saveSelectedGame({
      displayName: selected?.displayName || gameSelect.selectedOptions?.[0]?.textContent,
    });
    syncEffectsPanelForGame(getSelectedGameSnapshot({
      displayName: selected?.displayName || gameSelect.selectedOptions?.[0]?.textContent,
    }));
  } catch {
    gameSelect.innerHTML = '<option value="temple-escape">Temple Escape (神庙跑跑跑)</option>';
    syncEffectsPanelForGame({ id: TEMPLE_GAME_ID, displayName: "Temple Escape (神庙跑跑跑)" });
  }
}

async function scanRunningWindows() {
  if (!scanGamesPanel || !scannedWindowSelect) return;
  scanGamesPanel.classList.remove("hidden");
  scannedWindowSelect.innerHTML = '<option value="">กำลังสแกน...</option>';
  try {
    const res = await fetch("/api/games/windows");
    const data = await res.json();
    const windows = Array.isArray(data.windows) ? data.windows : [];
    scannedWindowSelect.innerHTML = "";
    if (!windows.length) {
      scannedWindowSelect.innerHTML = '<option value="">ไม่พบหน้าต่างเกม</option>';
      return;
    }
    for (const w of windows) {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({
        processName: w.processName,
        windowTitle: w.windowTitle,
      });
      opt.textContent = `${w.windowTitle}  (${w.processName})`;
      scannedWindowSelect.appendChild(opt);
    }
  } catch {
    scannedWindowSelect.innerHTML = '<option value="">สแกนไม่สำเร็จ</option>';
  }
}

async function useScannedWindow() {
  if (!scannedWindowSelect?.value) return;
  try {
    const picked = JSON.parse(scannedWindowSelect.value);
    if (gameSelect) gameSelect.value = "custom";
    if (customGameProcess) customGameProcess.value = picked.processName || "";
    if (customGameTitle) customGameTitle.value = picked.windowTitle || "";
    toggleCustomGameFields();
    await saveSelectedGame({
      id: "custom",
      customProcess: picked.processName,
      customTitle: picked.windowTitle,
      displayName: picked.windowTitle || picked.processName,
    });
    if (scanGamesPanel) scanGamesPanel.classList.add("hidden");
  } catch {
    /* ignore */
  }
}

gameSelect?.addEventListener("change", async () => {
  toggleCustomGameFields();
  await saveSelectedGame();
});
customGameProcess?.addEventListener("change", () => saveSelectedGame());
customGameTitle?.addEventListener("change", () => saveSelectedGame());
scanGamesBtn?.addEventListener("click", scanRunningWindows);
useScannedGameBtn?.addEventListener("click", useScannedWindow);

document.querySelectorAll(".chip-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    testGiftInput.value = btn.dataset.gift || "";
    const typeInput = document.getElementById("testType");
    if (typeInput) typeInput.value = btn.dataset.type || "SendGift";
    document.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.getElementById("musicEnabled")?.addEventListener("change", (e) => {
  musicConfig.enabled = e.target.checked;
  saveMusicConfig();
  if (!musicConfig.enabled) stopMusic();
});
document.getElementById("musicVolume")?.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  musicConfig.volume = v;
  document.getElementById("musicVolumeLabel").textContent = String(e.target.value);
  if (currentAudio) currentAudio.volume = v;
  saveMusicConfig();
});
document.getElementById("musicAddFilesBtn")?.addEventListener("click", () => {
  addSelectedMusicFiles().catch((err) => alert(err.message || String(err)));
});
document.getElementById("musicSaveRuleBtn")?.addEventListener("click", () => {
  saveMusicRule().catch((err) => alert(err.message || String(err)));
});
document.getElementById("musicCancelEditBtn")?.addEventListener("click", resetMusicEditor);
document.getElementById("musicStopBtn")?.addEventListener("click", stopMusic);
document.getElementById("musicRestoreDefaultsBtn")?.addEventListener("click", () => {
  restoreDefaultMusicPackFromButton();
});

document.getElementById("videoEnabled")?.addEventListener("change", (e) => {
  videoConfig.enabled = e.target.checked;
  saveVideoConfig();
  if (!videoConfig.enabled) stopVideoEffect();
});
document.getElementById("videoVolume")?.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  videoConfig.volume = v;
  document.getElementById("videoVolumeLabel").textContent = String(e.target.value);
  postOverlayCommand({ type: "set-volume", volume: v });
  if (videoCompanionAudio) videoCompanionAudio.volume = v;
  saveVideoConfig();
});
document.getElementById("videoFollowGame")?.addEventListener("change", (e) => {
  videoConfig.followGame = e.target.checked;
  saveVideoConfig();
});
document.getElementById("videoFullscreen")?.addEventListener("change", (e) => {
  videoConfig.fullscreen = e.target.checked;
  saveVideoConfig();
});
document.getElementById("videoClickThrough")?.addEventListener("change", (e) => {
  videoConfig.clickThrough = e.target.checked;
  saveVideoConfig();
});
document.getElementById("videoOverlayMode")?.addEventListener("change", (e) => {
  videoConfig.overlayMode = e.target.value === "clear" ? "clear" : "chroma";
  saveVideoConfig();
});
document.getElementById("videoOpenOverlayBtn")?.addEventListener("click", () => {
  openVideoOverlay().catch((err) => alert(err.message || String(err)));
});
document.getElementById("videoCloseOverlayBtn")?.addEventListener("click", () => {
  closeVideoOverlay().catch((err) => alert(err.message || String(err)));
});
document.getElementById("videoStopBtn")?.addEventListener("click", stopVideoEffect);
document.getElementById("videoAddFilesBtn")?.addEventListener("click", () => {
  addSelectedVideoFiles().catch((err) => alert(err.message || String(err)));
});
document.getElementById("videoSaveRuleBtn")?.addEventListener("click", () => {
  saveVideoRule().catch((err) => alert(err.message || String(err)));
});
document.getElementById("videoCancelEditBtn")?.addEventListener("click", resetVideoEditor);

document.getElementById("interruptEnabled")?.addEventListener("change", (e) => {
  interruptConfig.enabled = e.target.checked;
  saveInterruptConfig();
  if (!interruptConfig.enabled) {
    closeInterruptOverlay().catch(() => {});
    setInterruptStatus("ปิดการขัดขวางแล้ว");
  } else {
    setInterruptStatus("พร้อม — รอของขวัญ");
    refreshInterruptScreens();
  }
});
document.getElementById("interruptVolume")?.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  interruptConfig.volume = v;
  const label = document.getElementById("interruptVolumeLabel");
  if (label) label.textContent = String(Math.round(v * 100));
  saveInterruptConfig();
});
document.getElementById("interruptScreen")?.addEventListener("change", (e) => {
  interruptConfig.screen = e.target.value === "auto" ? "auto" : Number(e.target.value);
  saveInterruptConfig();
});
document.getElementById("interruptUnderStudio")?.addEventListener("change", (e) => {
  interruptConfig.underLiveStudio = e.target.checked;
  saveInterruptConfig();
});
document.getElementById("interruptAvoidStudio")?.addEventListener("change", (e) => {
  interruptConfig.avoidLiveStudio = e.target.checked;
  saveInterruptConfig();
});
document.getElementById("interruptRefreshScreensBtn")?.addEventListener("click", () => {
  refreshInterruptScreens();
});
document.getElementById("interruptKind")?.addEventListener("change", toggleInterruptKindFields);
document.getElementById("interruptTrigger")?.addEventListener("change", toggleInterruptTriggerFields);
document.getElementById("interruptAddFilesBtn")?.addEventListener("click", () => {
  addSelectedInterruptFiles().catch((err) => alert(err.message || String(err)));
});
document.getElementById("interruptSaveRuleBtn")?.addEventListener("click", () => {
  saveInterruptRule().catch((err) => alert(err.message || String(err)));
});
document.getElementById("interruptCancelEditBtn")?.addEventListener("click", () => {
  stopInterruptPreview({ hide: true });
  resetInterruptEditor();
});
document.getElementById("interruptPreviewCloseBtn")?.addEventListener("click", () => {
  stopInterruptPreview({ hide: true });
});
document.getElementById("interruptStopBtn")?.addEventListener("click", () => {
  closeInterruptOverlay().catch((err) => alert(err.message || String(err)));
});
document.getElementById("interruptRestoreDefaultsBtn")?.addEventListener("click", () => {
  restoreDefaultInterruptPackFromButton().catch((err) => alert(err.message || String(err)));
});
document.getElementById("interruptSaveDefaultsBtn")?.addEventListener("click", () => {
  saveInterruptDefaultsFromButton().catch((err) => alert(err.message || String(err)));
});
document.getElementById("interruptTestBtn")?.addEventListener("click", () => {
  const editId = document.getElementById("interruptEditId")?.value;
  const id =
    editId ||
    interruptConfig.rules.filter((r) => r.enabled !== false).slice(-1)[0]?.id;
  if (!id) {
    alert("ยังไม่มีกฎให้ทดสอบ — บันทึกกฎก่อน");
    return;
  }
  const prev = interruptConfig.enabled;
  interruptConfig.enabled = true;
  triggerInterruptRule(id, true)
    .catch((err) => alert(err.message || String(err)))
    .finally(() => {
      interruptConfig.enabled = prev;
    });
});

syncInterruptUi();
renderInterruptRules();
renderInterruptPending();
toggleInterruptKindFields();
toggleInterruptTriggerFields();
refreshInterruptScreens();
document.querySelector('.nav-btn[data-panel="interrupt"]')?.addEventListener("click", () => {
  refreshInterruptScreens();
});

document.getElementById("rouletteEnabled")?.addEventListener("change", async (e) => {
  rouletteConfig.enabled = !!e.target.checked;
  try {
    await saveRouletteConfigToServer();
  } catch (err) {
    alert(err.message || String(err));
  }
});
document.getElementById("rouletteOpenOverlayBtn")?.addEventListener("click", () => {
  openRouletteOverlay().catch((err) => alert(err.message || String(err)));
});
document.getElementById("rouletteCloseOverlayBtn")?.addEventListener("click", () => {
  closeRouletteOverlay().catch(() => {});
});
document.getElementById("rouletteRestoreDefaultsBtn")?.addEventListener("click", async () => {
  if (!confirm("ใช้กฎเริ่มต้น little hippo (14 ช่อง) แทนกฎปัจจุบัน?\nจะทับกฎกล่องสุ่มในแอพ")) return;
  try {
    await applyRouletteDefaultsPack(true);
    alert("ใส่กฎเริ่มต้น little hippo แล้ว");
  } catch (err) {
    alert(err.message || String(err));
  }
});
document.getElementById("rouletteAddOutcomeBtn")?.addEventListener("click", () => {
  rouletteDraftOutcomes.push({ giftName: "", label: "", imageId: "" });
  renderRouletteOutcomeEditor();
});
document.getElementById("rouletteSaveRuleBtn")?.addEventListener("click", () => {
  saveRouletteRuleFromForm().catch((err) => alert(err.message || String(err)));
});
document.getElementById("rouletteCancelEditBtn")?.addEventListener("click", clearRouletteEditor);
document.getElementById("rouletteTestBtn")?.addEventListener("click", () => {
  const triggerGift = document.getElementById("rouletteTriggerGift").value.trim() || "Baby Hippo";
  const outcomes = collectDraftOutcomes();
  if (outcomes.length < 2) {
    alert("ใส่เอฟเฟกต์อย่างน้อย 2 รายการก่อนทดสอบ");
    return;
  }
  runRouletteSpin(
    triggerGift,
    outcomes,
    readTestComboCount(document.getElementById("rouletteTestCount")),
    "ทดสอบ",
    document.getElementById("rouletteRuleMode")?.value === "multiply"
  );
});
resetRouletteDraftOutcomes();
bindRouletteModePicks();
setRouletteRuleMode("gift");

document.getElementById("gotoRouletteBtn")?.addEventListener("click", () => {
  document.querySelector('.nav-btn[data-panel="roulette"]')?.click();
});
document.getElementById("gotoVideoBtn")?.addEventListener("click", () => {
  document.querySelector('.nav-btn[data-panel="video"]')?.click();
});
document.getElementById("gotoMusicBtn")?.addEventListener("click", () => {
  document.querySelector('.nav-btn[data-panel="music"]')?.click();
});

/* ========== Dev Log panel ========== */
document.getElementById("devLogRefreshBtn")?.addEventListener("click", () => refreshDevLogView());
document.getElementById("devLogClearBtn")?.addEventListener("click", async () => {
  try {
    await fetch("/api/dev-log/clear", { method: "POST" });
    devLogLastRender = "";
    await refreshDevLogView();
  } catch (err) {
    alert("ล้าง log ไม่สำเร็จ: " + (err?.message || err));
  }
});
document.getElementById("devLogCopyBtn")?.addEventListener("click", async () => {
  const text = document.getElementById("devLogView")?.textContent || "";
  try {
    await navigator.clipboard.writeText(text);
    setInterruptStatus?.("คัดลอก Dev Log แล้ว");
  } catch {
    alert("คัดลอกไม่ได้ — เลือกข้อความเอง");
  }
});
document.getElementById("devLogBurstTestBtn")?.addEventListener("click", () => runInterruptBurstTest());
document.getElementById("devLogScope")?.addEventListener("change", () => refreshDevLogView());
document.getElementById("devLogAutoRefresh")?.addEventListener("change", (e) => {
  setDevLogAutoRefresh(!!e.target.checked);
  try {
    localStorage.setItem(DEV_LOG_KEY, JSON.stringify({ auto: !!e.target.checked }));
  } catch {
    /* ignore */
  }
});
document.querySelector('.nav-btn[data-panel="devlog"]')?.addEventListener("click", () => {
  devLogPanelOpen = true;
  refreshDevLogView();
  const auto = document.getElementById("devLogAutoRefresh");
  if (auto?.checked) setDevLogAutoRefresh(true);
});
document.querySelectorAll(".nav-btn[data-panel]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.panel !== "devlog") {
      devLogPanelOpen = false;
      setDevLogAutoRefresh(false);
    }
  });
});
try {
  const saved = JSON.parse(localStorage.getItem(DEV_LOG_KEY) || "null");
  const autoEl = document.getElementById("devLogAutoRefresh");
  if (autoEl && saved && typeof saved.auto === "boolean") autoEl.checked = saved.auto;
  // ไม่ auto-refresh ตอน boot — รอเปิดแท็บ Dev Log
} catch {
  /* ignore */
}

document.getElementById("ttsEnabled")?.addEventListener("change", (e) => {
  ttsConfig.enabled = e.target.checked;
  saveTtsConfig();
  if (!ttsConfig.enabled) {
    stopTtsAudio();
    setTtsActivity("ปิดการอ่านเสียงแล้ว");
  } else {
    setTtsActivity("เปิดใช้แล้ว — รอของขวัญ/ไลค์/ข้อความใหม่จากไลฟ์");
    refreshTtsStatus();
  }
});
document.getElementById("ttsReadName")?.addEventListener("change", (e) => {
  ttsConfig.readName = e.target.checked;
  saveTtsConfig();
});
document.getElementById("ttsReadGift")?.addEventListener("change", (e) => {
  ttsConfig.readGift = e.target.checked;
  saveTtsConfig();
});
document.getElementById("ttsReadMessage")?.addEventListener("change", (e) => {
  ttsConfig.readMessage = e.target.checked;
  saveTtsConfig();
});
document.getElementById("ttsReadEmoji")?.addEventListener("change", (e) => {
  ttsConfig.readEmoji = e.target.checked;
  saveTtsConfig();
});
document.getElementById("ttsRate")?.addEventListener("input", (e) => {
  const rate = Number(e.target.value) / 10;
  ttsConfig.rate = rate;
  document.getElementById("ttsRateLabel").textContent = rate.toFixed(1);
  if (ttsAudio) ttsAudio.playbackRate = Math.min(2, Math.max(0.5, rate));
  saveTtsConfig();
});
document.getElementById("ttsVoice")?.addEventListener("change", (e) => {
  ttsConfig.voiceURI = e.target.value;
  saveTtsConfig();
});
document.getElementById("ttsStopBtn")?.addEventListener("click", stopTtsAudio);
document.getElementById("ttsTestBtn")?.addEventListener("click", () => {
  unlockAudio();
  // ทดสอบตามติ๊ก: ชื่อผู้ส่ง / ข้อความที่พิมพ์ / ของขวัญ / อิโมจิ
  // ปุ่มทดสอบอ่านได้แม้ยังไม่ติ๊ก “เปิดใช้”
  const prevEnabled = ttsConfig.enabled;
  ttsConfig.enabled = true;
  speakTemplate(null, {
    name: "ผู้ทดสอบ",
    message: "สวัสดีครับ",
    gift: "กุหลาบ",
    speakGiftName: "กุหลาบ",
    kind: "gift",
    rawText: "ผู้ทดสอบ สวัสดีครับ กุหลาบ",
  });
  ttsConfig.enabled = prevEnabled;
});

document.querySelector('.nav-btn[data-panel="tts"]')?.addEventListener("click", () => {
  unlockAudio();
  refreshTtsStatus();
});

renderMusicUiState();
prefetchMusicBlobs();
renderVideoUiState();
renderWinUiState();
syncWinScoreToOverlay();
renderTtsUiState();
seedRouletteDefaultsIfNeeded();
seedDefaultWinIfNeeded();
setInterval(refreshTtsStatus, 5000);
setInterval(syncWinScoreToOverlay, 3000);

pollTimer = setInterval(fetchStatus, 1500);
loadGames().finally(() => fetchStatus());

/** Host (MainForm) calls this while minimized so gift→interrupt/music keep moving. */
window.__tgrKeepAlive = function tgrKeepAlive() {
  try {
    fetchStatus();
  } catch {
    /* ignore */
  }
  try {
    if (typeof kickInterruptDrain === "function") kickInterruptDrain();
  } catch {
    /* ignore */
  }
  // Do NOT flush coalesce here — would shrink the 800ms merge window while minimized.
};

function applyStatusPollInterval() {
  const hidden = typeof document !== "undefined" && document.hidden;
  const ms = hidden ? 500 : 1500;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchStatus, ms);
  if (hidden) {
    fetchStatus();
    try {
      kickInterruptDrain();
    } catch {
      /* ignore */
    }
  }
}
document.addEventListener("visibilitychange", applyStatusPollInterval);

seedDefaultMusicIfNeeded()
  .then((seeded) => {
    if (seeded) renderMusicUiState();
    prefetchMusicBlobs();
  })
  .finally(() => maybeExportMusicDefaultsFromFlag());

seedDefaultInterruptIfNeeded()
  .then((seeded) => {
    if (seeded) {
      renderInterruptRules();
      syncInterruptUi();
    }
  })
  .finally(() => maybeExportInterruptDefaultsFromFlag());

document.getElementById("winWinBtn")?.addEventListener("click", () => adjustWinScore(1, "manual win"));
document.getElementById("winLoseBtn")?.addEventListener("click", () => adjustWinScore(-1, "manual lose"));
document.getElementById("winResetBtn")?.addEventListener("click", () => setWinScoreAbsolute(0, winConfig.target));
document.getElementById("winApplyNumbersBtn")?.addEventListener("click", () => {
  const score = Number(document.getElementById("winScoreInput")?.value);
  const target = Number(document.getElementById("winTargetInput")?.value);
  setWinScoreAbsolute(score, target);
});
document.getElementById("winShowOverlay")?.addEventListener("change", (e) => {
  winConfig.showOverlay = !!e.target.checked;
  saveWinConfig();
  if (winConfig.showOverlay) openWinOverlay();
});
document.getElementById("winOpenOverlayBtn")?.addEventListener("click", () => openWinOverlay());
document.getElementById("winCloseOverlayBtn")?.addEventListener("click", () => closeWinOverlay());
document.getElementById("winSaveRuleBtn")?.addEventListener("click", () => {
  const gift = (document.getElementById("winGiftName")?.value || "").trim();
  const delta = Number(document.getElementById("winGiftDelta")?.value);
  const editId = document.getElementById("winEditId")?.value || "";
  if (!gift) {
    alert("ใส่ชื่อของขวัญก่อน");
    return;
  }
  if (!Number.isFinite(delta) || delta === 0) {
    alert("ใส่จำนวน win ที่ไม่ใช่ 0 เช่น 1 หรือ -1");
    return;
  }
  if (editId) {
    const idx = winConfig.rules.findIndex((r) => r.id === editId);
    if (idx >= 0) winConfig.rules[idx] = { id: editId, gift, delta };
  } else {
    winConfig.rules.push({ id: uid(), gift, delta });
  }
  saveWinConfig();
  clearWinRuleForm();
});
document.getElementById("winCancelEditBtn")?.addEventListener("click", clearWinRuleForm);
document.getElementById("winRulesList")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  const card = e.target.closest(".rule-card");
  if (!btn || !card) return;
  const id = card.dataset.id;
  const rule = winConfig.rules.find((r) => r.id === id);
  if (!rule) return;
  if (btn.dataset.act === "del") {
    winConfig.rules = winConfig.rules.filter((r) => r.id !== id);
    saveWinConfig();
    return;
  }
  if (btn.dataset.act === "edit") {
    document.getElementById("winEditId").value = rule.id;
    document.getElementById("winGiftName").value = rule.gift;
    document.getElementById("winGiftDelta").value = String(rule.delta);
    document.getElementById("winRuleMode").textContent = "แก้ไข";
  }
});

function setTempleDefaultsStatusText(text) {
  const el = document.getElementById("templeDefaultsStatus");
  if (el) el.textContent = text;
}

async function refreshTempleDefaultsStatus() {
  try {
    const res = await fetch(`/api/temple-escape/defaults/status?t=${Date.now()}`);
    if (!res.ok) throw new Error("status failed");
    const data = await res.json();
    if (!data.ready) {
      setTempleDefaultsStatusText("ไม่มีแพ็กในโปรแกรม");
      return;
    }
    if (data.applied) {
      setTempleDefaultsStatusText(data.gameRunning ? "ตรงแพ็ก · เกมเปิดอยู่" : "ตรงกับแพ็กในแอพ");
      return;
    }
    if (data.installedAny) {
      setTempleDefaultsStatusText(data.gameRunning ? "ต่างจากแพ็ก · เกมเปิดอยู่" : "ต่างจากแพ็ก — กดทับได้");
      return;
    }
    setTempleDefaultsStatusText("ยังไม่ใส่ในเกม");
  } catch {
    setTempleDefaultsStatusText("ตรวจไม่ได้");
  }
}

async function applyTempleEscapeDefaultsFromButton() {
  let status = null;
  try {
    const st = await fetch(`/api/temple-escape/defaults/status?t=${Date.now()}`);
    status = await st.json();
  } catch {
    /* ignore */
  }
  const warnRun = status?.gameRunning
    ? "\n\n⚠ เกม Temple Escape ยังเปิดอยู่ — ควรปิดก่อน ไม่งั้นเกมอาจเขียนทับกลับ"
    : "";
  if (
    !confirm(
      "ทับค่า gift ในเกม Temple Escape ด้วยแพ็กที่มากับ Monkeyeffect?\n" +
        "(จะเขียนทับ CusFucSetting / PHBSave / MuztoMod)\n" +
        "แนะนำให้ปิดเกมก่อน แล้วเปิดเกมใหม่หลังใส่ค่า" +
        warnRun
    )
  ) {
    return;
  }
  const btns = [...document.querySelectorAll("[data-temple-apply]")];
  const prev = btns.map((b) => b.textContent);
  btns.forEach((b) => {
    b.disabled = true;
    b.textContent = "กำลังทับ…";
  });
  try {
    const res = await fetch("/api/temple-escape/defaults/apply", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "apply failed");
    const runNote = data.gameRunning
      ? "\n\nเกมยังเปิดอยู่ — ปิดแล้วเปิดใหม่เพื่อให้โหลดค่า"
      : "\nเปิดเกมใหม่แล้วตรวจเมนู 礼物事件配置";
    alert(`ทับค่า gift ตามแพ็กในแอพแล้ว (${data.copied} ไฟล์)${runNote}`);
    refreshTempleDefaultsStatus();
  } catch (err) {
    alert("ทับค่าไม่สำเร็จ: " + (err?.message || err));
  } finally {
    btns.forEach((b, i) => {
      b.disabled = false;
      b.textContent = prev[i] || "ทับค่า gift ตามแพ็กในแอพ";
    });
  }
}

async function exportTempleEscapeDefaultsFromButton() {
  if (!confirm("คัดลอกเซฟจากเกมเครื่องนี้ เข้าแพ็กในโปรแกรม?\n(ใช้ตอนจะอัปเดตค่าตั้งต้นในแอพ/Setup)")) return;
  const btns = [...document.querySelectorAll("[data-temple-export]")];
  const prev = btns.map((b) => b.textContent);
  btns.forEach((b) => {
    b.disabled = true;
    b.textContent = "กำลังคัดลอก…";
  });
  try {
    const res = await fetch("/api/temple-escape/defaults/export", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "export failed");
    alert(
      `อัปเดตแพ็กแล้ว (${data.copied} ไฟล์)` +
        (data.missing?.length ? `\nขาด: ${data.missing.join(", ")}` : "")
    );
    refreshTempleDefaultsStatus();
  } catch (err) {
    alert("อัปเดตแพ็กไม่สำเร็จ: " + (err?.message || err));
  } finally {
    btns.forEach((b, i) => {
      b.disabled = false;
      b.textContent = prev[i] || "บันทึกเซฟเกมนี้เป็นแพ็กแอพ";
    });
  }
}

async function seedTempleEscapeDefaultsIfNeeded() {
  try {
    const res = await fetch(`/api/temple-escape/defaults/status?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ready || data.applied) return;
    // Only auto-apply when CusFucSetting is missing (fresh machine) — never auto-overwrite.
    const gift = (data.files || []).find((f) => f.file === "CusFucSetting.sav");
    if (gift?.installed) return;
    await fetch("/api/temple-escape/defaults/apply", { method: "POST" });
    console.info("[temple-escape] seeded gift-event defaults");
  } catch (err) {
    console.warn("[temple-escape] seed failed", err);
  }
}

document.querySelectorAll("[data-temple-apply]").forEach((btn) => {
  btn.addEventListener("click", () => applyTempleEscapeDefaultsFromButton());
});
document.querySelectorAll("[data-temple-export]").forEach((btn) => {
  btn.addEventListener("click", () => exportTempleEscapeDefaultsFromButton());
});
refreshTempleDefaultsStatus();
seedTempleEscapeDefaultsIfNeeded().then(() => refreshTempleDefaultsStatus());

/* ========== Online update ========== */
let updateLatest = null;
let updateBusy = false;

function setUpdateMessage(text) {
  const el = document.getElementById("updateMessage");
  if (el) el.textContent = text || "—";
}

function setVersionUpdateBadge(hasUpdate, latestVersion) {
  const label = document.getElementById("appVersionLabel");
  const chip = document.getElementById("updateStatusChip");
  const applyBtn = document.getElementById("updateApplyBtn");
  if (label) {
    label.classList.toggle("has-update", !!hasUpdate);
    if (hasUpdate && latestVersion) {
      label.title = `มีอัปเดต v${latestVersion} — กดเพื่อติดตั้ง`;
      label.setAttribute("aria-label", `มีอัปเดตเวอร์ชัน ${latestVersion} กดเพื่อติดตั้ง`);
    } else {
      label.title = "เวอร์ชันโปรแกรม";
      label.setAttribute("aria-label", "เวอร์ชันโปรแกรม");
    }
  }
  if (chip) {
    const current = (document.getElementById("appVersionLabel")?.textContent || "v?").replace(/^v/i, "");
    chip.textContent = hasUpdate && latestVersion ? `มีใหม่ v${latestVersion}` : `v${current}`;
  }
  if (applyBtn) applyBtn.disabled = !hasUpdate;
}

const DEFAULT_UPDATE_FEED =
  "https://raw.githubusercontent.com/Monkey-4-Entertainment/monkey-effect/main/update/latest.json";

function ensureUpdateFeedInput() {
  const feed = document.getElementById("updateFeedUrl");
  if (!feed) return "";
  let url = (feed.value || "").trim();
  if (!url) {
    url = DEFAULT_UPDATE_FEED;
    feed.value = url;
  }
  return url;
}

async function loadUpdateUi() {
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    const ver = data.version || "1.0.4.1";
    const label = document.getElementById("appVersionLabel");
    const chip = document.getElementById("updateStatusChip");
    if (label) label.textContent = `v${ver}`;
    if (chip) chip.textContent = `v${ver}`;
    const feed = document.getElementById("updateFeedUrl");
    if (feed) {
      const fromApi = typeof data.feedUrl === "string" ? data.feedUrl.trim() : "";
      feed.value = fromApi || DEFAULT_UPDATE_FEED;
    }
    setVersionUpdateBadge(false);
  } catch {
    ensureUpdateFeedInput();
  }
}

async function saveUpdateFeedUrl({ silent = false } = {}) {
  const feed = document.getElementById("updateFeedUrl");
  const url = ensureUpdateFeedInput();
  try {
    const res = await fetch("/api/update/feed", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl: url, autoCheck: true }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "save failed");
    if (feed && data.feedUrl) feed.value = data.feedUrl;
    if (!silent) setUpdateMessage("บันทึก URL แล้ว");
    return true;
  } catch (err) {
    if (!silent) setUpdateMessage("บันทึก URL ไม่สำเร็จ: " + (err?.message || err));
    return false;
  }
}

async function checkForUpdate({ silent = false } = {}) {
  const btn = document.getElementById("updateCheckBtn");
  const prev = btn?.textContent;
  updateLatest = null;
  setVersionUpdateBadge(false);
  if (!silent && btn) {
    btn.disabled = true;
    btn.textContent = "กำลังตรวจ…";
  }
  try {
    ensureUpdateFeedInput();
    await saveUpdateFeedUrl({ silent: true });
    const feed = ensureUpdateFeedInput();
    if (!feed) {
      if (!silent) setUpdateMessage("ยังไม่ได้ตั้ง URL ของ latest.json");
      return false;
    }
    const res = await fetch("/api/update/check", { method: "POST" });
    const data = await res.json();
    if (!silent) setUpdateMessage(data.message || "—");
    if (data.hasUpdate && data.latest) {
      updateLatest = data.latest;
      setVersionUpdateBadge(true, data.latest.version);
      if (silent) setUpdateMessage(`มีอัปเดต v${data.latest.version} — กดที่เวอร์ชันมุมบนเพื่อติดตั้ง`);
      return true;
    }
    return false;
  } catch (err) {
    if (!silent) setUpdateMessage("ตรวจอัปเดตไม่สำเร็จ: " + (err?.message || err));
    return false;
  } finally {
    if (!silent && btn) {
      btn.disabled = false;
      btn.textContent = prev || "ตรวจอัปเดต";
    }
  }
}

async function applyUpdateNow({ skipConfirm = false } = {}) {
  if (updateBusy) return;
  if (!updateLatest) {
    setUpdateMessage("ยังไม่มีอัปเดต — กำลังตรวจอีกครั้ง…");
    const ok = await checkForUpdate({ silent: false });
    if (!ok || !updateLatest) return;
  }
  if (
    !skipConfirm &&
    !confirm(`ดาวน์โหลดและติดตั้ง v${updateLatest.version}?\nโปรแกรมจะปิดแล้วเปิดใหม่`)
  ) {
    return;
  }
  updateBusy = true;
  const btn = document.getElementById("updateApplyBtn");
  const label = document.getElementById("appVersionLabel");
  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "กำลังอัปเดต…";
  }
  if (label) label.style.pointerEvents = "none";
  setUpdateMessage("กำลังดาวน์โหลดแพ็กอัปเดต…");
  try {
    const res = await fetch("/api/update/apply", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || data.message || "apply failed");
    setUpdateMessage(data.message || "กำลังรีสตาร์ท…");
  } catch (err) {
    setUpdateMessage("อัปเดตไม่สำเร็จ: " + (err?.message || err));
    updateBusy = false;
    if (btn) {
      btn.disabled = !updateLatest;
      btn.textContent = prev || "ดาวน์โหลดแล้วติดตั้ง";
    }
    if (label) label.style.pointerEvents = "";
  }
}

async function onVersionBadgeActivate() {
  if (updateBusy) return;
  document.querySelector('.nav-btn[data-panel="update"]')?.click();
  if (updateLatest) {
    await applyUpdateNow();
    return;
  }
  const feed = document.getElementById("updateFeedUrl")?.value?.trim();
  if (!feed) {
    document.getElementById("updateFeedUrl")?.focus();
    setUpdateMessage("ใส่ URL ของ latest.json ก่อน แล้วกดบันทึก");
    return;
  }
  setUpdateMessage("กำลังตรวจอัปเดต…");
  const has = await checkForUpdate({ silent: false });
  if (has && updateLatest) {
    await applyUpdateNow();
  }
}

document.getElementById("updateSaveFeedBtn")?.addEventListener("click", () => saveUpdateFeedUrl());
document.getElementById("updateCheckBtn")?.addEventListener("click", () => checkForUpdate());
document.getElementById("updateApplyBtn")?.addEventListener("click", () => applyUpdateNow());
document.getElementById("appVersionLabel")?.addEventListener("click", () => onVersionBadgeActivate());
document.getElementById("appVersionLabel")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onVersionBadgeActivate();
  }
});

loadUpdateUi().then(async () => {
  const feed = document.getElementById("updateFeedUrl")?.value?.trim();
  if (feed) {
    await checkForUpdate({ silent: true });
  }
  // re-check every 30 minutes while app stays open
  setInterval(() => {
    const f = document.getElementById("updateFeedUrl")?.value?.trim();
    if (f && !updateBusy) checkForUpdate({ silent: true });
  }, 30 * 60 * 1000);
});
