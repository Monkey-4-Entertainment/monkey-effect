/* Standalone game-effects window — follows selected game from main app */
const GAME_STORAGE_KEY = "tgr_selected_game";
const GAME_CHANNEL = "tgr-selected-game";
const TEMPLE_ID = "temple-escape";

const winTitle = document.getElementById("winTitle");
const winSub = document.getElementById("winSub");
const winGameChip = document.getElementById("winGameChip");
const winTestHint = document.getElementById("winTestHint");
const winMsg = document.getElementById("winMsg");
const defaultsCard = document.getElementById("defaultsCard");
const noDefaultsCard = document.getElementById("noDefaultsCard");
const defaultsTitle = document.getElementById("defaultsTitle");
const defaultsHint = document.getElementById("defaultsHint");
const defaultsStatus = document.getElementById("defaultsStatus");
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
  const gameName = (currentGame.displayName || "").toUpperCase();
  const hasKeymap = currentGame.id === "the-rider" || gameName.includes("THE RIDER");

  defaultsCard?.classList.toggle("hidden", !isTemple);
  noDefaultsCard?.classList.toggle("hidden", isTemple || hasKeymap);
  keymapCard?.classList.toggle("hidden", !hasKeymap);

  if (isTemple) {
    if (defaultsTitle) defaultsTitle.textContent = `ค่าตั้งต้น gift ใน ${name}`;
    if (defaultsHint) {
      defaultsHint.innerHTML =
        `กดปุ่มด้านล่างเพื่อ<b>ทับ</b>ไฟล์เซฟเกมด้วยแพ็กที่มากับ Monkeyeffect · ปิดเกม <b>${name}</b> ก่อนกด · แล้วเปิดเกมใหม่`;
    }
    refreshDefaultsStatus();
  } else if (hasKeymap) {
    loadKeymapUI();
  } else if (noDefaultsHint) {
    noDefaultsHint.textContent = `${name} ยังไม่มีแพ็กค่าตั้งต้นในแอพ — ใช้ Send Test เพื่อยิงของเข้าเกมผ่าน /livemsg ได้ตามปกติ`;
  }
}

async function loadKeymapUI() {
  const tableEl = document.getElementById("keymapTable");
  const statusEl = document.getElementById("keymapStatus");
  if (!tableEl) return;
  try {
    const res = await fetch("/api/keymap");
    const cfg = await res.json();
    const rules = cfg.rules || [];
    if (statusEl) statusEl.textContent = cfg.enabled ? `${rules.length} rules · ON` : "OFF";
    if (rules.length === 0) {
      tableEl.innerHTML = `<p style="opacity:.5">ยังไม่มี mapping — แก้ไขไฟล์ userdata/rider-keymap.json</p>`;
      return;
    }
    let html = `<table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="text-align:left;opacity:.6">
        <th style="padding:4px 8px">Gift</th>
        <th style="padding:4px 8px">Key</th>
        <th style="padding:4px 8px">เอฟเฟกต์</th>
        <th style="padding:4px 8px">Hold</th>
      </tr></thead><tbody>`;
    for (const r of rules) {
      html += `<tr style="border-top:1px solid rgba(255,255,255,.08)">
        <td style="padding:4px 8px;font-weight:600">${esc(r.giftName)}</td>
        <td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,.1);padding:2px 6px;border-radius:4px">${esc(r.key)}</kbd></td>
        <td style="padding:4px 8px">${esc(r.label)}</td>
        <td style="padding:4px 8px">${r.holdMs}ms</td>
      </tr>`;
    }
    html += `</tbody></table>`;
    tableEl.innerHTML = html;
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

async function refreshDefaultsStatus() {
  if (!defaultsStatus || currentGame.id !== TEMPLE_ID) return;
  try {
    const res = await fetch(`/api/temple-escape/defaults/status?t=${Date.now()}`);
    const data = await res.json();
    if (data.matchesPack) defaultsStatus.textContent = "ตรงกับแพ็ก";
    else if (data.hasGameSaves) defaultsStatus.textContent = "ต่างจากแพ็ก — กดทับได้";
    else defaultsStatus.textContent = "ยังไม่มีเซฟเกม";
  } catch {
    defaultsStatus.textContent = "ตรวจสถานะไม่ได้";
  }
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
    if (!res.ok) {
      setMsg(data.gameError || data.error || "Test failed", true);
      return;
    }
    setMsg(`ส่ง ${giftName} x${Number(testCount.value) || 1} → ${currentGame.displayName}`);
  } catch (err) {
    setMsg(err.message || String(err), true);
  } finally {
    testBtn.disabled = false;
  }
}

async function applyDefaults() {
  if (currentGame.id !== TEMPLE_ID) return;
  if (!confirm(`ทับค่า gift ของ ${currentGame.displayName} ตามแพ็กในแอพ?\nปิดเกมก่อนกด`)) return;
  try {
    const res = await fetch("/api/temple-escape/defaults/apply", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "apply failed");
    setMsg("ทับค่า gift แล้ว — เปิดเกมใหม่");
    refreshDefaultsStatus();
  } catch (err) {
    setMsg(err.message || String(err), true);
  }
}

async function exportDefaults() {
  if (currentGame.id !== TEMPLE_ID) return;
  if (!confirm("บันทึกเซฟเกมปัจจุบันเป็นแพ็กในแอพ?")) return;
  try {
    const res = await fetch("/api/temple-escape/defaults/export", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "export failed");
    setMsg("บันทึกเป็นแพ็กแอพแล้ว");
    refreshDefaultsStatus();
  } catch (err) {
    setMsg(err.message || String(err), true);
  }
}

document.querySelectorAll(".chip-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chip-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    testGift.value = btn.dataset.gift || "";
    testType.value = btn.dataset.type || "SendGift";
  });
});
testBtn?.addEventListener("click", sendTest);
document.getElementById("applyDefaultsBtn")?.addEventListener("click", applyDefaults);
document.getElementById("exportDefaultsBtn")?.addEventListener("click", exportDefaults);
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
