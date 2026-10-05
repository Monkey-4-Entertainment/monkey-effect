(() => {
  const TOKEN_KEY = "me_member_token";

  const authCard = document.getElementById("memberAuthCard");
  const dbCard = document.getElementById("memberDbCard");
  if (!authCard || !dbCard) return;

  const els = {
    username: document.getElementById("memberUsername"),
    password: document.getElementById("memberPassword"),
    display: document.getElementById("memberDisplayName"),
    displayWrap: document.getElementById("memberDisplayWrap"),
    authMsg: document.getElementById("memberAuthMsg"),
    dbMsg: document.getElementById("memberDbMsg"),
    modeChip: document.getElementById("memberAuthModeChip"),
    who: document.getElementById("memberWhoChip"),
    count: document.getElementById("homeLiveViewersCount") || document.getElementById("memberRecCount"),
    table: document.getElementById("memberTable"),
    search: document.getElementById("memberSearch"),
    ownerFilter: document.getElementById("memberOwnerFilter"),
    ownerFilterWrap: document.getElementById("memberOwnerFilterWrap"),
    adminCard: document.getElementById("memberAdminCard"),
    accountsTable: document.getElementById("memberAccountsTable"),
    accountCount: document.getElementById("memberAccountCount"),
    adminUser: document.getElementById("adminAccUsername"),
    adminDisplay: document.getElementById("adminAccDisplay"),
    adminPass: document.getElementById("adminAccPassword"),
    adminEnabled: document.getElementById("adminAccEnabled"),
    adminEditId: document.getElementById("adminAccEditId"),
    adminMsg: document.getElementById("adminAccMsg"),
    adminSaveBtn: document.getElementById("adminAccSaveBtn"),
    selfCard: document.getElementById("memberSelfCard"),
    selfUser: document.getElementById("selfUsername"),
    selfDisplay: document.getElementById("selfDisplay"),
    selfPass: document.getElementById("selfPassword"),
    selfMsg: document.getElementById("selfMsg"),
  };

  let registerMode = false;
  let member = null;
  let viewingMemberId = "all";
  let expandedAccountId = "";
  const accountRecordsCache = new Map();

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setAuthMsg(text, isError) {
    if (!els.authMsg) return;
    els.authMsg.textContent = text || "";
    els.authMsg.style.color = isError ? "#ff8f8f" : "";
  }

  function setDbMsg(text, isError) {
    if (!els.dbMsg) return;
    els.dbMsg.textContent = text || "";
    els.dbMsg.style.color = isError ? "#ff8f8f" : "";
  }

  function isMasterAdmin(m) {
    return !!(m?.isMasterAdmin || m?.role === "masteradmin");
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers["X-Member-Token"] = token;
    const res = await fetch(path, {
      ...opts,
      headers,
      credentials: "same-origin",
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: "ตอบกลับไม่ใช่ JSON" };
    }
    if (data?.token) setToken(data.token);
    return { res, data };
  }

  function showLoggedOut() {
    member = null;
    viewingMemberId = "all";
    authCard.hidden = false;
    dbCard.hidden = true;
    if (els.adminCard) els.adminCard.hidden = true;
    if (els.ownerFilterWrap) els.ownerFilterWrap.hidden = true;
  }

  function showLoggedIn(m) {
    member = m;
    authCard.hidden = true;
    dbCard.hidden = false;
    if (els.who) {
      const role = isMasterAdmin(m) ? " · MasterAdmin" : " · ครีเอเตอร์";
      els.who.textContent = (m?.displayName || m?.username || "สมาชิก") + role;
    }
    if (els.adminCard) els.adminCard.hidden = !isMasterAdmin(m);
    if (els.ownerFilterWrap) els.ownerFilterWrap.hidden = !isMasterAdmin(m);
    if (!isMasterAdmin(m)) viewingMemberId = m?.id || "";
    else if (!viewingMemberId) viewingMemberId = "all";
    if (els.selfCard) els.selfCard.hidden = false;
    if (els.selfUser) els.selfUser.value = m?.username || "";
    if (els.selfDisplay) els.selfDisplay.value = m?.displayName || "";
    if (els.selfPass) els.selfPass.value = "";
  }

  function setMode(isRegister) {
    registerMode = !!isRegister;
    if (els.displayWrap) els.displayWrap.hidden = !registerMode;
    if (els.modeChip) els.modeChip.textContent = registerMode ? "สมัครครีเอเตอร์" : "เข้าสู่ระบบ";
    const toggle = document.getElementById("memberToggleModeBtn");
    if (toggle) {
      toggle.textContent = registerMode ? "มีบัญชีแล้ว? เข้าสู่ระบบ" : "ยังไม่มีบัญชี? สมัครครีเอเตอร์";
    }
  }

  function setSelfMsg(text, isError) {
    if (!els.selfMsg) return;
    els.selfMsg.textContent = text || "";
    els.selfMsg.style.color = isError ? "#ff8f8f" : "";
  }

  function clearForm() {
    /* live list is read-only — no edit form */
  }

  function fillForm() {
    /* live list is read-only */
  }

  function renderTable(records) {
    if (!els.table) return;
    const list = Array.isArray(records) ? records : [];
    if (els.count) els.count.textContent = `${list.length} คน`;
    if (!list.length) {
      els.table.innerHTML = `<div class="hint">ยังไม่มีผู้ชมจากไลฟ์ — ล็อกอินค้างไว้ตอนไลฟ์</div>`;
      return;
    }
    const showOwner = isMasterAdmin(member) && (viewingMemberId === "all" || viewingMemberId === "");
    els.table.innerHTML = `
      <table class="member-table">
        <thead>
          <tr>
            ${showOwner ? "<th>บัญชี</th>" : ""}
            <th>ชื่อ</th>
            <th>TikTok</th>
            <th>เพชร</th>
            <th>ของขวัญ</th>
            <th>ไลค์</th>
            <th>แต้ม</th>
            <th>ล่าสุด</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (r) => `
            <tr data-id="${escapeHtml(r.id)}">
              ${
                showOwner
                  ? `<td>${escapeHtml(r.ownerDisplayName || r.ownerUsername || "—")}</td>`
                  : ""
              }
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.tikTok || "—")}</td>
              <td>${escapeHtml(r.coins ?? 0)}</td>
              <td>${escapeHtml(r.gifts ?? 0)}</td>
              <td>${escapeHtml(r.likes ?? 0)}</td>
              <td>${escapeHtml(r.points ?? 0)}</td>
              <td class="member-note">${escapeHtml(r.lastGift || r.lastChat || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  function setAdminMsg(text, isError) {
    if (!els.adminMsg) return;
    els.adminMsg.textContent = text || "";
    els.adminMsg.style.color = isError ? "#ff8f8f" : "";
  }

  function clearAdminForm() {
    if (els.adminEditId) els.adminEditId.value = "";
    if (els.adminUser) {
      els.adminUser.value = "";
      els.adminUser.disabled = false;
    }
    if (els.adminDisplay) els.adminDisplay.value = "";
    if (els.adminPass) {
      els.adminPass.value = "";
      els.adminPass.placeholder = "อย่างน้อย 4 ตัว";
    }
    if (els.adminEnabled) els.adminEnabled.checked = true;
    if (els.adminSaveBtn) els.adminSaveBtn.textContent = "สร้างครีเอเตอร์";
    setAdminMsg("");
  }

  function fillAdminForm(acc) {
    if (!acc) return clearAdminForm();
    if (els.adminEditId) els.adminEditId.value = acc.id || "";
    if (els.adminUser) {
      els.adminUser.value = acc.username || "";
      els.adminUser.disabled = true;
    }
    if (els.adminDisplay) els.adminDisplay.value = acc.displayName || "";
    if (els.adminPass) {
      els.adminPass.value = "";
      els.adminPass.placeholder = "เว้นว่างถ้าไม่เปลี่ยนรหัส";
    }
    if (els.adminEnabled) els.adminEnabled.checked = acc.enabled !== false;
    if (els.adminSaveBtn) els.adminSaveBtn.textContent = "บันทึกครีเอเตอร์";
    setAdminMsg(`กำลังแก้ไขครีเอเตอร์: ${acc.username}`);
  }

  function renderNestedRecords(records) {
    const list = Array.isArray(records) ? records : [];
    if (!list.length) {
      return `<div class="member-nested-empty">ยังไม่มีรายการผู้ชมในบัญชีนี้</div>`;
    }
    return `
      <table class="member-table member-nested-table">
        <thead>
          <tr>
            <th>ชื่อ</th>
            <th>TikTok</th>
            <th>เพชร</th>
            <th>ของขวัญ</th>
            <th>ไลค์</th>
            <th>แต้ม</th>
            <th>ล่าสุด</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (r) => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.tikTok || "—")}</td>
              <td>${escapeHtml(r.coins ?? 0)}</td>
              <td>${escapeHtml(r.gifts ?? 0)}</td>
              <td>${escapeHtml(r.likes ?? 0)}</td>
              <td>${escapeHtml(r.points ?? 0)}</td>
              <td class="member-note">${escapeHtml(r.lastGift || r.lastChat || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  async function loadAccountRecords(accountId) {
    const { data } = await api(`/api/members/records?as=${encodeURIComponent(accountId)}`);
    if (!data?.ok) throw new Error(data?.error || "โหลดรายการย่อยไม่ได้");
    const records = data.records || [];
    accountRecordsCache.set(accountId, records);
    return records;
  }

  async function openAccountExpand(accountId, { forceReload = false } = {}) {
    if (!accountId) return;
    const detail = els.accountsTable?.querySelector(`.member-acc-detail[data-parent="${accountId}"]`);
    const row = els.accountsTable?.querySelector(`tr.member-acc-row[data-id="${accountId}"]`);
    if (!detail || !row) return;

    els.accountsTable.querySelectorAll(".member-acc-detail").forEach((el) => {
      el.hidden = true;
    });
    els.accountsTable.querySelectorAll("tr.member-acc-row.is-open").forEach((el) => {
      el.classList.remove("is-open");
    });

    expandedAccountId = accountId;
    row.classList.add("is-open");
    detail.hidden = false;
    const body = detail.querySelector(".member-acc-detail-body");
    if (!body) return;
    body.innerHTML = `<div class="hint">กำลังโหลดรายการย่อย...</div>`;
    try {
      if (forceReload) accountRecordsCache.delete(accountId);
      const records = accountRecordsCache.has(accountId)
        ? accountRecordsCache.get(accountId)
        : await loadAccountRecords(accountId);
      body.innerHTML = renderNestedRecords(records);
      viewingMemberId = accountId;
      if (els.ownerFilter) els.ownerFilter.value = accountId;
      loadRecords();
    } catch (err) {
      body.innerHTML = `<div class="hint" style="color:#ff8f8f">${escapeHtml(err?.message || "โหลดไม่ได้")}</div>`;
    }
  }

  async function toggleAccountExpand(accountId) {
    if (!accountId) return;
    if (expandedAccountId === accountId) {
      expandedAccountId = "";
      const detail = els.accountsTable?.querySelector(`.member-acc-detail[data-parent="${accountId}"]`);
      const row = els.accountsTable?.querySelector(`tr.member-acc-row[data-id="${accountId}"]`);
      if (detail) detail.hidden = true;
      if (row) row.classList.remove("is-open");
      return;
    }
    await openAccountExpand(accountId, { forceReload: true });
  }

  function renderAccounts(accounts) {
    if (!els.accountsTable) return;
    const list = Array.isArray(accounts) ? accounts : [];
    if (els.accountCount) els.accountCount.textContent = `${list.length} ครีเอเตอร์`;
    if (!list.length) {
      els.accountsTable.innerHTML = `<div class="hint">ยังไม่มีครีเอเตอร์ — สร้างบัญชีด้านบน</div>`;
      return;
    }
    els.accountsTable.innerHTML = `
      <table class="member-table">
        <thead>
          <tr>
            <th>ผู้ใช้</th>
            <th>ชื่อครีเอเตอร์</th>
            <th>บทบาท</th>
            <th>สถานะ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map((a) => {
              const admin = a.role === "masteradmin";
              const on = a.enabled !== false;
              const open = expandedAccountId === a.id;
              return `
            <tr class="member-acc-row${open ? " is-open" : ""}" data-id="${escapeHtml(a.id)}">
              <td>
                <button type="button" class="member-acc-link" data-id="${escapeHtml(a.id)}" title="ดูรายการย่อย">
                  ${escapeHtml(a.username)}
                </button>
              </td>
              <td>
                <button type="button" class="member-acc-link" data-id="${escapeHtml(a.id)}" title="ดูรายการย่อย">
                  ${escapeHtml(a.displayName || "—")}
                </button>
              </td>
              <td>${admin ? "MasterAdmin" : "ครีเอเตอร์"}</td>
              <td>${on ? "เปิดใช้" : "ปิด"} · ${escapeHtml(a.recordCount ?? 0)} คน</td>
              <td class="member-actions">
                <button type="button" class="btn ghost small member-view-acc" data-id="${escapeHtml(a.id)}">${open ? "ซ่อน" : "ดูรายการ"}</button>
                <button type="button" class="btn ghost small member-edit-acc" data-id="${escapeHtml(a.id)}">แก้ไข</button>
                ${
                  admin
                    ? ""
                    : `<button type="button" class="btn ghost small member-toggle" data-id="${escapeHtml(a.id)}" data-enabled="${on ? "0" : "1"}">${on ? "ปิดใช้" : "เปิดใช้"}</button>
                       <button type="button" class="btn ghost small member-del-acc" data-id="${escapeHtml(a.id)}" data-user="${escapeHtml(a.username)}">ลบ</button>`
                }
              </td>
            </tr>
            <tr class="member-acc-detail" data-parent="${escapeHtml(a.id)}" ${open ? "" : "hidden"}>
              <td colspan="5">
                <div class="member-acc-detail-body">
                  ${
                    open && accountRecordsCache.has(a.id)
                      ? renderNestedRecords(accountRecordsCache.get(a.id))
                      : open
                        ? `<div class="hint">กำลังโหลดรายการย่อย...</div>`
                        : ""
                  }
                </div>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    const openExpand = (id) => toggleAccountExpand(id);

    els.accountsTable.querySelectorAll(".member-acc-link, .member-view-acc").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        openExpand(btn.getAttribute("data-id"));
      });
    });
    els.accountsTable.querySelectorAll(".member-edit-acc").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const acc = list.find((x) => x.id === id);
        fillAdminForm(acc);
      });
    });
    els.accountsTable.querySelectorAll(".member-toggle").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const enabled = btn.getAttribute("data-enabled") === "1";
        const { data } = await api(`/api/members/accounts/${encodeURIComponent(id)}/enabled`, {
          method: "POST",
          body: JSON.stringify({ enabled }),
        });
        if (!data?.ok) {
          setAdminMsg(data?.error || "เปลี่ยนสถานะไม่สำเร็จ", true);
          return;
        }
        setAdminMsg(enabled ? "เปิดใช้ครีเอเตอร์แล้ว" : "ปิดใช้ครีเอเตอร์แล้ว");
        await loadAccounts();
      });
    });
    els.accountsTable.querySelectorAll(".member-del-acc").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const user = btn.getAttribute("data-user") || "";
        if (!id || !confirm(`ลบครีเอเตอร์ "${user}" ออกจากระบบ?`)) return;
        const { data } = await api(`/api/members/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!data?.ok) {
          setAdminMsg(data?.error || "ลบไม่สำเร็จ", true);
          return;
        }
        setAdminMsg(`ลบครีเอเตอร์ ${user} แล้ว`);
        if (expandedAccountId === id) expandedAccountId = "";
        accountRecordsCache.delete(id);
        clearAdminForm();
        await loadAccounts();
      });
    });

    if (expandedAccountId && list.some((a) => a.id === expandedAccountId) && !accountRecordsCache.has(expandedAccountId)) {
      openAccountExpand(expandedAccountId, { forceReload: true }).catch(() => {});
    } else if (expandedAccountId && !list.some((a) => a.id === expandedAccountId)) {
      expandedAccountId = "";
    }
  }

  async function saveAdminAccount() {
    const editId = (els.adminEditId?.value || "").trim();
    const username = (els.adminUser?.value || "").trim();
    const displayName = (els.adminDisplay?.value || "").trim();
    const password = els.adminPass?.value || "";
    const enabled = !!els.adminEnabled?.checked;

    if (editId) {
      const body = { displayName, enabled };
      if (password.trim()) body.password = password;
      setAdminMsg("กำลังบันทึก...");
      const { data } = await api(`/api/members/accounts/${encodeURIComponent(editId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!data?.ok) {
        setAdminMsg(data?.error || "แก้ไขไม่สำเร็จ", true);
        return;
      }
      setAdminMsg("แก้ไขบัญชีแล้ว");
      clearAdminForm();
      await loadAccounts();
      return;
    }

    if (!username || !password) {
      setAdminMsg("ใส่ชื่อผู้ใช้และรหัสผ่าน", true);
      return;
    }
    setAdminMsg("กำลังสร้างบัญชี...");
    const { data } = await api("/api/members/accounts", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName, enabled }),
    });
    if (!data?.ok) {
      setAdminMsg(data?.error || "สร้างไม่สำเร็จ", true);
      return;
    }
    setAdminMsg(`สร้างครีเอเตอร์แล้ว — ล็อกอินด้วยชื่อผู้ใช้ "${data.account?.username || username}" และรหัสที่ตั้งไว้`);
    clearAdminForm();
    await loadAccounts();
  }

  async function saveSelfProfile() {
    const displayName = (els.selfDisplay?.value || "").trim();
    const password = els.selfPass?.value || "";
    setSelfMsg("กำลังบันทึก...");
    const body = { displayName };
    if (password.trim()) body.password = password;
    const { data } = await api("/api/members/me", { method: "PUT", body: JSON.stringify(body) });
    if (!data?.ok) {
      setSelfMsg(data?.error || "บันทึกไม่สำเร็จ", true);
      return;
    }
    if (data.member) showLoggedIn(data.member);
    if (els.selfPass) els.selfPass.value = "";
    setSelfMsg("บันทึกบัญชีแล้ว");
  }

  function fillOwnerFilter(accounts) {
    if (!els.ownerFilter || !isMasterAdmin(member)) return;
    const list = Array.isArray(accounts) ? accounts : [];
    const cur = viewingMemberId || "all";
    const opts = [`<option value="all">ทั้งหมด (MasterAdmin)</option>`].concat(
      list.map((a) => {
        const label = `${a.displayName || a.username} (${a.recordCount ?? 0})`;
        return `<option value="${escapeHtml(a.id)}">${escapeHtml(label)}</option>`;
      })
    );
    els.ownerFilter.innerHTML = opts.join("");
    els.ownerFilter.value = list.some((a) => a.id === cur) || cur === "all" ? cur : "all";
    viewingMemberId = els.ownerFilter.value || "all";
  }

  async function loadAccounts() {
    if (!isMasterAdmin(member)) return;
    const { data } = await api("/api/members/accounts");
    if (!data?.ok) return;
    renderAccounts(data.accounts || []);
    fillOwnerFilter(data.accounts || []);
  }

  async function loadRecords() {
    if (!getToken()) {
      if (els.table) {
        els.table.innerHTML = `<div class="hint">ล็อกอินครีเอเตอร์ที่เมนูฐานข้อมูลสมาชิกก่อน — จะดึงรายการจากไลฟ์มาแสดงที่นี่</div>`;
      }
      if (els.count) els.count.textContent = "0 คน";
      return;
    }
    const q = (els.search?.value || "").trim();
    let url = q ? `/api/members/records?q=${encodeURIComponent(q)}` : "/api/members/records";
    if (isMasterAdmin(member)) {
      const asId = viewingMemberId || "all";
      url += (url.includes("?") ? "&" : "?") + `as=${encodeURIComponent(asId)}`;
    }
    const { res, data } = await api(url);
    if (!data?.ok) {
      setDbMsg(data?.error || "โหลดข้อมูลไม่ได้", true);
      if (res.status === 401) {
        setToken("");
        showLoggedOut();
        if (els.table) {
          els.table.innerHTML = `<div class="hint">ล็อกอินครีเอเตอร์ที่เมนูฐานข้อมูลสมาชิกก่อน</div>`;
        }
      }
      return;
    }
    if (data.member) {
      member = data.member;
      if (!dbCard.hidden) showLoggedIn(data.member);
    }
    if (data.viewingMemberId) viewingMemberId = data.viewingMemberId;
    renderTable(data.records || []);
    const scope =
      isMasterAdmin(member) && data.viewingAs
        ? ` · ดู: ${data.viewingAs}`
        : "";
    setDbMsg(data.count ? `อัปเดตจากไลฟ์ · ${data.count} คน${scope}` : scope ? `ดู: ${data.viewingAs}` : "");
  }

  async function refreshLiveStatus() {
    const el = document.getElementById("memberLiveStatus");
    if (!el || dbCard.hidden) return;
    try {
      const { data } = await api("/api/members/status");
      if (!data?.ok) return;
      const where =
        data.syncLabel === "onedrive"
          ? "OneDrive"
          : data.syncLabel === "custom"
            ? "โฟลเดอร์ที่ตั้งเอง"
            : "เครื่องนี้";
      el.textContent = data.liveCapture
        ? `จับผู้ชมจากไลฟ์อัตโนมัติ (แยกจากรายการครีเอเตอร์) · เก็บที่ ${where}`
        : `ยังไม่จับไลฟ์ · เก็บที่ ${where}`;
    } catch {
      /* ignore */
    }
  }

  async function refreshSession() {
    const { res, data } = await api("/api/members/me");
    if (!data?.ok || res.status === 401) {
      showLoggedOut();
      return;
    }
    showLoggedIn(data.member || data);
    viewingMemberId = isMasterAdmin(data.member || data) ? "all" : data.member?.id || "";
    await loadRecords();
    await loadAccounts();
    await refreshLiveStatus();
  }

  async function submitAuth(isRegister) {
    const username = (els.username?.value || "").trim();
    const password = els.password?.value || "";
    const displayName = (els.display?.value || "").trim();
    if (!username || !password) {
      setAuthMsg("ใส่ชื่อผู้ใช้และรหัสผ่าน", true);
      return;
    }
    const path = isRegister ? "/api/members/register" : "/api/members/login";
    const body = isRegister ? { username, password, displayName } : { username, password };
    setAuthMsg(isRegister ? "กำลังสมัคร..." : "กำลังเข้าสู่ระบบ...");
    const { data } = await api(path, { method: "POST", body: JSON.stringify(body) });
    if (!data?.ok) {
      setAuthMsg(data?.error || "ไม่สำเร็จ", true);
      return;
    }
    if (data.token) setToken(data.token);
    setAuthMsg(isRegister ? "สมัครสำเร็จ" : "เข้าสู่ระบบแล้ว");
    if (els.password) els.password.value = "";
    showLoggedIn(data.member);
    viewingMemberId = isMasterAdmin(data.member) ? "all" : data.member?.id || "";
    await loadRecords();
    await loadAccounts();
    await refreshLiveStatus();
  }

  async function saveRecord() {
    /* removed — live list is read-only on home */
  }

  document.getElementById("memberLoginBtn")?.addEventListener("click", () => submitAuth(false));
  document.getElementById("memberRegisterBtn")?.addEventListener("click", () => {
    setMode(true);
    submitAuth(true);
  });
  document.getElementById("memberToggleModeBtn")?.addEventListener("click", () => setMode(!registerMode));
  document.getElementById("memberLogoutBtn")?.addEventListener("click", async () => {
    await api("/api/members/logout", { method: "POST", body: "{}" });
    setToken("");
    clearForm();
    showLoggedOut();
    setAuthMsg("ออกจากระบบแล้ว");
    await loadRecords();
  });
  document.getElementById("memberRefreshBtn")?.addEventListener("click", async () => {
    await loadRecords();
    await loadAccounts();
    await refreshLiveStatus();
  });
  document.getElementById("adminAccSaveBtn")?.addEventListener("click", () => saveAdminAccount());
  document.getElementById("adminAccClearBtn")?.addEventListener("click", () => clearAdminForm());
  document.getElementById("selfSaveBtn")?.addEventListener("click", () => saveSelfProfile());
  let searchTimer = null;
  els.search?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadRecords(), 250);
  });
  els.ownerFilter?.addEventListener("change", () => {
    viewingMemberId = els.ownerFilter.value || "all";
    loadRecords();
  });
  els.password?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth(registerMode);
  });

  document.querySelector('.nav-btn[data-panel="members"]')?.addEventListener("click", () => {
    refreshSession();
  });
  document.querySelector('.nav-btn[data-panel="connect"]')?.addEventListener("click", () => {
    loadRecords();
  });
  window.addEventListener("tgr-members-focus", () => refreshSession());

  setMode(false);
  refreshSession();
  setInterval(() => {
    if (getToken()) {
      loadRecords();
      refreshLiveStatus();
      if (!dbCard.hidden && isMasterAdmin(member)) loadAccounts();
    }
  }, 8000);
})();
