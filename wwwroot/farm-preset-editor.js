/* FARM preset editor v10. Combo counts require backend v10; split animals game v9+. */
(() => {
  "use strict";
  const effects = [
    [2, "เรียกหมู"], [3, "สุ่มแมงป่อง / แมงมุม"], [4, "เรียกแรด"],
    [5, "เรียกคุนเผิง"], [6, "สุ่มไดโนเสาร์"], [7, "สุ่มอากาศรุนแรง"],
    [8, "สุ่มวัว / ม้า"], [9, "เรียกรถไถ"], [11, "เรียกสิงโต"], [12, "เรียกช้างราชา"],
    [10, "สุ่มสิงโต / ช้างราชา (คำสั่งเดิม)"],
  ];
  const defaultOrigin = "http://127.0.0.1:18908";
  const isFarm = () => {
    const game = currentEffectsGame();
    return /farm/i.test(`${game.id} ${game.displayName}`);
  };
  const effectId = url => {
    try {
      const path = new URL(url).pathname.replace(/\/$/, "");
      if (path === "/spawn/lion") return 11;
      if (path === "/spawn/elephant") return 12;
      return Number(path.match(/^\/game_trigger_(\d+)$/)?.[1]) || 0;
    }
    catch { return 0; }
  };
  function effectUrl(oldUrl, id) {
    // Only reuse a known FARM relay origin; never reuse a remote/custom webhook host.
    let origin = defaultOrigin;
    try {
      const u = new URL(oldUrl);
      if (effectId(oldUrl) && ["127.0.0.1", "localhost"].includes(u.hostname) && u.port === "18908") origin = u.origin;
    } catch {}
    return `${origin}${id === 11 ? "/spawn/lion" : id === 12 ? "/spawn/elephant" : `/game_trigger_${id}`}`;
  }
  function uniqueLabel(label, row) {
    const used = new Set(readKeymapRowsFromDom().filter((_, i) => i !== row).map(r => r.label.trim().toLowerCase()));
    let value = label, n = 2;
    while (used.has(value.toLowerCase())) value = `${label} (${n++})`;
    return value;
  }
  function refreshEventActions(oldLabel, newLabel, rulesBefore) {
    const events = readEventsFromDom();
    // The backend identifies an action by label. Keep references attached to this row.
    const unambiguous = rulesBefore.filter(r => r.label.toLowerCase() === oldLabel.toLowerCase()).length === 1;
    if (oldLabel && unambiguous) for (const e of events) {
      if (e.action.toLowerCase() === oldLabel.toLowerCase()) e.action = newLabel;
    }
    keymapDraftEvents = events;
    document.querySelectorAll("#effectsEventsTable [data-f=action]").forEach((select, index) => {
      select.innerHTML = actionOptionsHtml(events[index]?.action || "");
    });
  }

  const originalRules = renderEffectsKeymapTable;
  renderEffectsKeymapTable = function(rules, enabled) {
    originalRules(rules, enabled);
    if (!isFarm()) return;
    const table = document.getElementById("effectsKeymapTable");
    if (table) table.style.overflowX = "auto";
    table?.querySelectorAll("tr[data-keymap-row]").forEach((tr, row) => {
      const label = tr.querySelector("[data-f=label]");
      const webhook = tr.querySelector("[data-f=webhook]");
      const key = tr.querySelector("[data-f=key]");
      if (!label || !webhook) return;
      const currentId = effectId(webhook.value);
      const select = document.createElement("select");
      select.dataset.f = "farm-effect";
      select.setAttribute("aria-label", "เลือกเอฟเฟกต์ FARM");
      select.style.cssText = "width:14rem;display:block;margin-bottom:4px";
      select.innerHTML = `<option value="">— เลือกเอฟเฟกต์ —</option>` + effects.map(([id, name]) =>
        `<option value="${id}">${escapeHtml(name)}</option>`).join("");
      select.value = effects.some(([id]) => id === currentId) ? String(currentId) : "";
      label.before(select);
      label.title = "ชื่อ Action สำหรับผูก Events (ชื่อไม่ซ้ำกัน)";
      label.style.width = "14rem";
      let oldLabel = label.value.trim();
      const path = document.createElement("div");
      path.dataset.f = "farm-path";
      path.style.cssText = "font-size:.72rem;max-width:15rem;overflow-wrap:anywhere;color:#a7f3d0;margin-top:4px";
      webhook.after(path);
      const showPath = () => {
        path.textContent = webhook.value || "ยังไม่ได้เลือกเอฟเฟกต์";
        if (key && effectId(webhook.value)) { key.readOnly = true; key.placeholder = "HTTP"; key.title = webhook.value; }
      };
      key?.addEventListener("keydown", event => {
        if (effectId(webhook.value) && event.key !== "Tab") { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      showPath();
      select.addEventListener("change", () => {
        const effect = effects.find(([id]) => id === Number(select.value));
        if (!effect) { select.value = String(effectId(webhook.value) || ""); return; }
        const before = readKeymapRowsFromDom();
        const previous = label.value.trim();
        label.value = uniqueLabel(effect[1], row);
        webhook.value = effectUrl(webhook.value, effect[0]);
        if (key) key.value = "";
        showPath();
        keymapDraftRules = readKeymapRowsFromDom();
        refreshEventActions(previous, label.value, before);
        oldLabel = label.value;
        setKeymapMsg(`เลือก ${effect[1]} → /game_trigger_${effect[0]} แล้ว — กดบันทึก`);
      });
      label.addEventListener("change", () => {
        if (label.value.trim() === oldLabel) return;
        const before = readKeymapRowsFromDom();
        before[row].label = oldLabel;
        label.value = uniqueLabel(label.value.trim() || oldLabel || "Action", row);
        refreshEventActions(oldLabel, label.value, before);
        oldLabel = label.value;
        keymapDraftRules = readKeymapRowsFromDom();
      });
    });
  };

  const originalEvents = renderEffectsEventsTable;
  renderEffectsEventsTable = function(events) {
    // Normalize imported aliases so a share event never silently becomes a gift event.
    events = (events || []).map(e => ({ ...e, trigger: ({ shares: "share", likes: "like", follower: "follow", comment: "chat" })[e.trigger] || e.trigger }));
    originalEvents(events);
    const table = document.getElementById("effectsEventsTable");
    table?.querySelectorAll("[data-f=trigger]").forEach((select, i) => {
      const option = document.createElement("option");
      option.value = "share"; option.textContent = "แชร์";
      select.append(option);
      select.value = events[i]?.trigger || "gift";
    });
    if (!table || !isFarm()) return;
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0";
    for (const [trigger, name] of [["like", "ไลค์"], ["share", "แชร์"]]) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "btn secondary";
      button.textContent = `+ ${name}`; button.dataset.farmAddEvent = trigger;
      button.addEventListener("click", () => {
        const next = readEventsFromDom();
        const existing = next.findIndex(e => e.trigger === trigger);
        if (existing >= 0) {
          table.querySelector(`tr[data-event-row="${existing}"] [data-f=action]`)?.focus();
          setEventsMsg(`มี Event ${name} แล้ว — เลือก Action ในแถวนั้นได้เลย`);
          return;
        }
        next.push({ trigger, giftName: "", action: "", minCount: 1, enabled: true });
        renderEffectsEventsTable(next);
        table.querySelector("tr[data-event-row]:last-child [data-f=action]")?.focus();
      });
      bar.append(button);
    }
    const hint = document.createElement("span");
    hint.style.cssText = "font-size:.8rem;opacity:.8";
    hint.textContent = "เลือกทริกเกอร์ → ครบกี่ครั้ง → Action ที่ให้ออก → บันทึก";
    bar.append(hint); table.prepend(bar);
  };

  // Tests must use the on-screen draft, not an older saved event or stale URL.
  playEventRow = async function(index) {
    const ev = readEventsFromDom()[index];
    const msg = document.getElementById("effectsEventsMsg");
    const tell = text => { if (msg) msg.textContent = text; };
    if (!ev?.enabled || !ev.action) { tell("เปิด Event และเลือก Action ก่อนทดสอบ"); return; }
    const rules = readKeymapRowsFromDom();
    if (!rules.some(r => r.enabled && r.label === ev.action && (r.webhookUrl || r.key || r.vk))) {
      tell("Action นี้ปิดอยู่หรือยังไม่มีคำสั่ง — เลือกเอฟเฟกต์ก่อน"); return;
    }
    try {
      const saved = await fetch("/api/keymap", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, rules, events: readEventsFromDom() }) });
      if (!saved.ok) throw new Error(`บันทึกไม่สำเร็จ (${saved.status})`);
      const kind = { like: ["SendLike", "Like"], share: ["SendShare", "Share"], follow: ["SendFollow", "Follow"], chat: ["SendChat", ev.chatCmd || ev.giftName], gift: ["SendGift", ev.giftName] }[ev.trigger];
      if (!kind?.[1]) throw new Error("กรอกของขวัญหรือข้อความก่อนทดสอบ");
      const combo = Math.max(1, Math.min(200, Number(document.getElementById("testCount")?.value) || 1));
      tell(`บันทึกแล้ว กำลังทดสอบ ${ev.trigger} → ${ev.action}…`);
      const response = await fetch("/api/test-gift", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giftName: kind[1], repeatCount: Math.min(99999, combo * ev.minCount), messageType: kind[0], nickname: "Test User" }) });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || `ส่งไม่สำเร็จ (${response.status})`);
      tell(`ส่งทดสอบ ${ev.trigger} → ${ev.action} แล้ว (บันทึกพรีเซ็ตแล้ว)`);
    } catch (error) { tell(error.message || "ทดสอบไม่สำเร็จ"); }
  };

  const originalExport = exportEffectsKeymap;
  exportEffectsKeymap = async function() {
    if (isFarm()) {
      try {
        const preset = { kind: "monkeyeffect-keymap-v1", game: "farming", displayName: "FARM DEFENSE LOCAL v10", enabled: true,
          rules: readKeymapRowsFromDom(), events: readEventsFromDom() };
        const response = await fetch("/api/keymap", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preset) });
        if (!response.ok) throw new Error(`บันทึกไม่สำเร็จ (${response.status})`);
        const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "FARM-DEFENSE-Monkeyeffect-v10.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setImportMsg("ส่งออกพรีเซ็ต FARM v10 พร้อมค่าที่แก้ไขแล้ว");
        return;
      } catch (error) { setImportMsg(error.message, true); return; }
    }
    return originalExport();
  };
  const exportButton = document.getElementById("effectsExportBtn");
  exportButton?.removeEventListener("click", originalExport);
  exportButton?.addEventListener("click", exportEffectsKeymap);
  // Existing Add handlers use draft arrays; sync edits before they run.
  document.getElementById("effectsKeymapAddBtn")?.addEventListener("click", () => {
    keymapDraftRules = readKeymapRowsFromDom();
  }, true);
  document.getElementById("effectsEventAddBtn")?.addEventListener("click", () => {
    keymapDraftEvents = readEventsFromDom();
  }, true);
})();
