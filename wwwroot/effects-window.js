/* Standalone game-effects window — follows selected game from main app */
const GAME_STORAGE_KEY = "tgr_selected_game";
const GAME_CHANNEL = "tgr-selected-game";
const TEMPLE_ID = "temple-escape";

const winTitle = document.getElementById("winTitle");
const winSub = document.getElementById("winSub");
const winGameChip = document.getElementById("winGameChip");
const winTestHint = document.getElementById("winTestHint");
const winMsg = document.getElementById("winMsg");
const noDefaultsCard = document.getElementById("noDefaultsCard");
const noDefaultsHint = document.getElementById("noDefaultsHint");
const testGift = document.getElementById("testGift");
const testCount = document.getElementById("testCount");
const testType = document.getElementById("testType");
const testBtn = document.getElementById("testBtn");

let currentGame = { id: TEMPLE_ID, displayName: "Temple Escape (神庙跑跑跑)" };

function setMsg(text, isErr = false) {
  if (!winMsg) return;
  winMsg.textContent = text || "";
  winMsg.classList.toggle("err", !!isErr);
}

function readStoredGame() {
  try {
    const cached = JSON.parse(localStorage.getItem(GAME_STORAGE_KEY) || "null");
    if (cached?.id) {
      return {
        id: cached.id,
        displayName: cached.displayName || cached.id,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function applyGame(game) {
  if (!game?.id) return;
  currentGame = {
    id: game.id,
    displayName: game.displayName || game.name || game.id,
  };
  const name = currentGame.displayName;
  document.title = `เอฟเฟกต์ · ${name}`;
  if (winTitle) winTitle.textContent = `เอฟเฟกต์เกม · ${name}`;
  if (winSub) winSub.textContent = `ทดสอบส่ง Gift / Like / Follow เข้า ${name}`;
  if (winGameChip) winGameChip.textContent = name;
  if (winTestHint) {
    winTestHint.textContent = `ส่งของทดสอบเข้า ${name} — เข้ารหัส AES-GCM แล้วเสิร์ฟ GET /livemsg :12922`;
  }

  const isTemple = currentGame.id === TEMPLE_ID;
  const keymapCard = document.getElementById("keymapCard");
  const hasKeymap = isRiderKeymapGame(currentGame);
  syncGiftChipsForGame(hasKeymap || isTemple);

  noDefaultsCard?.classList.toggle("hidden", isTemple || hasKeymap);
  keymapCard?.classList.toggle("hidden", !(hasKeymap || isTemple));

  if (isTemple || hasKeymap) {
    loadKeymapUI();
  } else if (noDefaultsHint) {
    noDefaultsHint.textContent = `${name} ยังไม่มีแพ็กค่าตั้งต้นในแอพ — ใช้ Send Test เพื่อยิงของเข้าเกมผ่าน /livemsg ได้ตามปกติ`;
  }
}

function isRiderKeymapGame(game) {
  const id = (game?.id || "").toLowerCase();
  if (id === "the-rider" || id === "zero-hour" || id === "roblox" || id === "minecraft" || id === TEMPLE_ID) return true;
  if (id !== "custom" && id !== "auto") return false;
  const blob = `${game?.displayName || ""} ${game?.customProcess || ""} ${game?.customTitle || ""}`.toUpperCase();
  return blob.includes("RIDER") || blob.includes("ZERO-HOUR") || blob.includes("ZERO HOUR") ||
    blob.includes("ROBLOX") || blob.includes("JOJO");
}

const TEMPLE_GIFT_CHIPS = [
  { gift: "Rose", type: "SendGift", label: "Rose" },
  { gift: "TikTok", type: "SendGift", label: "TikTok" },
  { gift: "GG", type: "SendGift", label: "GG" },
  { gift: "Like", type: "SendLike", label: "Like" },
  { gift: "Follow", type: "SendFollow", label: "Follow" },
];

const RIDER_GIFT_CHIPS = [
  { gift: "Rose", type: "SendGift", label: "Rose · หมา" },
  { gift: "Perfume", type: "SendGift", label: "Perfume · ยายสปีด" },
  { gift: "Flower Garland", type: "SendGift", label: "Flower Garland · ควาย" },
  { gift: "The Lucky 9", type: "SendGift", label: "The Lucky 9 · ไนตรัส" },
  { gift: "GG", type: "SendGift", label: "GG · +เงิน" },
  { gift: "Ice Cream Cone", type: "SendGift", label: "Ice Cream · -เงิน" },
  { gift: "Friendship Necklace", type: "SendGift", label: "Necklace · ผีซ้อนท้าย" },
  { gift: "Baby Hippo", type: "SendGift", label: "Baby Hippo · อมตะ" },
  { gift: "Doughnut", type: "SendGift", label: "Doughnut · พายุ" },
  { gift: "Lots of Bread", type: "SendGift", label: "Lots of Bread · -1" },
  { gift: "Rosa", type: "SendGift", label: "Rosa · สุ่ม" },
  { gift: "Night Star", type: "SendGift", label: "Night Star · สุ่ม" },
  { gift: "Heart Me", type: "SendGift", label: "Heart Me · +1" },
  { gift: "Like", type: "SendLike", label: "Like" },
  { gift: "Follow", type: "SendFollow", label: "Follow" },
];

function syncGiftChipsForGame(hasKeymap) {
  const host = document.getElementById("giftChips");
  if (!host) return;
  const chips = hasKeymap ? RIDER_GIFT_CHIPS : TEMPLE_GIFT_CHIPS;
  const signature = chips.map((c) => c.gift).join("|");
  if (host.dataset.chipSet === signature) return;
  host.dataset.chipSet = signature;
  host.innerHTML = chips.map((c, i) =>
    `<button type="button" class="chip-btn${i === 0 ? " active" : ""}" data-gift="${c.gift}" data-type="${c.type}">${c.label}</button>`
  ).join("");
  if (testGift) testGift.value = chips[0].gift;
  if (testType) testType.value = chips[0].type;
}

let keymapSnapshot = { enabled: true, rules: [], events: [] };

function readPopupRows() {
  return [...document.querySelectorAll("#keymapTable [data-keymap-row]")].map((row) => ({
    giftName: row.querySelector("[data-f=gift]")?.value?.trim() || "",
    key: (row.querySelector("[data-f=key]")?.value || "").trim(),
    vk: 0,
    label: row.querySelector("[data-f=label]")?.value?.trim() || "",
    holdMs: Number(row.querySelector("[data-f=hold]")?.value) || 80,
    times: Number(row.querySelector("[data-f=times]")?.value) || 1,
    webhookUrl: row.querySelector("[data-f=webhook]")?.value || "",
    enabled: !!row.querySelector("[data-f=on]")?.checked,
  }));
}

function renderKeymapRows() {
  const tableEl = document.getElementById("keymapTable");
  const statusEl = document.getElementById("keymapStatus");
  const rules = keymapSnapshot.rules || [];
  if (statusEl) statusEl.textContent = keymapSnapshot.enabled === false ? "OFF" : `${rules.length} รายการ`;
  if (!rules.length) {
    tableEl.innerHTML = `<p class="preset-empty">ยังไม่มีพรีเซ็ต — เพิ่มจากหน้าหลัก หรือนำเข้าไฟล์</p>`;
    return;
  }
  tableEl.innerHTML = `<div class="preset-list">${rules.map((r, i) => `
    <article class="preset-row${r.enabled === false ? " is-off" : ""}" data-keymap-row="${i}">
      <div class="preset-row-fields">
        <label>แอคชัน<input data-f="label" value="${esc(r.label)}" placeholder="ชื่อแอคชัน" /></label>
        <label>ของขวัญ<input data-f="gift" value="${esc(r.giftName)}" placeholder="Rose" /></label>
        <label>คีย์<input data-f="key" value="${esc(r.key)}" placeholder="ว่าง" maxlength="12" style="text-align:center;font-weight:700" /></label>
        <label>ครั้ง<input data-f="times" type="number" min="1" max="20" value="${Number(r.times) > 0 ? Number(r.times) : 1}" /></label>
        <label>ms<input data-f="hold" type="number" min="20" max="2000" value="${r.holdMs || 80}" /></label>
        <label class="preset-on">เปิด<input data-f="on" type="checkbox" ${r.enabled !== false ? "checked" : ""} /></label>
        <input data-f="webhook" type="hidden" value="${esc(r.webhookUrl || "")}" />
      </div>
      <div class="preset-row-actions">
        <button type="button" class="btn ghost small danger" data-popup-del="${i}">ลบ</button>
      </div>
    </article>`).join("")}</div>`;
  tableEl.querySelectorAll("[data-popup-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = readPopupRows();
      next.splice(Number(btn.getAttribute("data-popup-del")), 1);
      keymapSnapshot.rules = next;
      renderKeymapRows();
      await savePopupKeymap();
    });
  });
}

async function savePopupKeymap() {
  const rows = document.querySelectorAll("#keymapTable [data-keymap-row]");
  if (rows.length || (keymapSnapshot.rules || []).length === 0) keymapSnapshot.rules = readPopupRows();
  const res = await fetch("/api/keymap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: keymapSnapshot.enabled !== false,
      rules: keymapSnapshot.rules,
      events: keymapSnapshot.events || [],
    }),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || "บันทึกไม่สำเร็จ");
  setMsg(`บันทึกแล้ว ${keymapSnapshot.rules.length} รายการ`);
}

async function loadKeymapUI() {
  const tableEl = document.getElementById("keymapTable");
  if (!tableEl) return;
  try {
    const res = await fetch("/api/keymap");
    const cfg = await res.json();
    keymapSnapshot = {
      enabled: cfg.enabled !== false,
      rules: cfg.rules || [],
      events: cfg.events || [],
    };
    renderKeymapRows();
  } catch (e) {
    tableEl.innerHTML = `<p style="color:#f87171">โหลด keymap ไม่สำเร็จ: ${e.message}</p>`;
  }
}
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

async function loadGameFromApi() {
  try {
    const res = await fetch("/api/games");
    const data = await res.json();
    const sel = data.selected;
    if (sel?.id) {
      applyGame({
        id: sel.id,
        displayName: sel.displayName || data.games?.find((g) => g.id === sel.id)?.name || sel.id,
      });
      return;
    }
  } catch {
    /* ignore */
  }
  applyGame(readStoredGame() || currentGame);
}


async function sendTest() {
  const giftName = testGift.value.trim() || "Rose";
  const messageType = testType.value || "SendGift";
  testBtn.disabled = true;
  setMsg("กำลังส่ง…");
  try {
    const res = await fetch("/api/test-gift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        giftName,
        repeatCount: Number(testCount.value) || 1,
        messageType,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      setMsg(data.gameError || data.error || data.channel || "Test failed", true);
      return;
    }
    setMsg(`ส่ง ${giftName} x${Number(testCount.value) || 1} → ${currentGame.displayName}`);
  } catch (err) {
    setMsg(err.message || String(err), true);
  } finally {
    testBtn.disabled = false;
  }
}



document.getElementById("giftChips")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip-btn");
  if (!btn) return;
  document.getElementById("giftChips")?.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  testGift.value = btn.dataset.gift || "";
  testType.value = btn.dataset.type || "SendGift";
});
testBtn?.addEventListener("click", sendTest);
document.getElementById("keymapSaveBtn")?.addEventListener("click", async () => {
  try { await savePopupKeymap(); } catch (e) { setMsg(e.message || "บันทึกไม่สำเร็จ", true); }
});
document.getElementById("keymapReloadBtn")?.addEventListener("click", async () => {
  try {
    await fetch("/api/keymap/reload", { method: "POST" });
    loadKeymapUI();
    setMsg("โหลด Mapping ใหม่แล้ว");
  } catch (e) {
    setMsg("โหลดไม่สำเร็จ: " + e.message, true);
  }
});

window.addEventListener("storage", (ev) => {
  if (ev.key !== GAME_STORAGE_KEY || !ev.newValue) return;
  try {
    applyGame(JSON.parse(ev.newValue));
  } catch {
    /* ignore */
  }
});

try {
  const ch = new BroadcastChannel(GAME_CHANNEL);
  ch.addEventListener("message", (ev) => {
    if (ev.data?.type === "selected-game" && ev.data.game) {
      applyGame(ev.data.game);
    }
  });
} catch {
  /* ignore */
}

const boot = readStoredGame();
if (boot) applyGame(boot);
loadGameFromApi();
