(() => {
  const player = document.getElementById("player");
  const still = document.getElementById("still");
  const stage = document.getElementById("stage");
  const errLayer = document.getElementById("errLayer");
  const idleHint = document.getElementById("idleHint");
  const errTitle = document.getElementById("errTitle");
  const errMessage = document.getElementById("errMessage");
  const errCode = document.getElementById("errCode");
  const errOkBtn = document.getElementById("errOkBtn");

  let busy = false;
  let dismissResolver = null;
  let lastCmdAt = 0;
  let handleChain = Promise.resolve();
  let pollInFlight = false;
  let playWatchdog = null;
  /** เพิ่มทุกครั้งที่รับคำสั่งใหม่ — ยกเลิกคลิปเก่าทันที กันค้างสูงสุด 60 วิ */
  let playGen = 0;
  let lastPlayToken = null;
  let layoutReady = false;

  function postStatus(state, extra = {}) {
    const payload = {
      type: "interrupt-status",
      state,
      playToken: lastPlayToken,
      ...extra,
      at: Date.now(),
    };
    try {
      localStorage.setItem("tgr_interrupt_status", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    fetch("/api/interrupt-overlay/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  function clearWatchdog() {
    if (playWatchdog) {
      clearTimeout(playWatchdog);
      playWatchdog = null;
    }
  }

  function hideIdleHint() {
    idleHint.classList.add("hide");
  }

  function showBootIdle() {
    errLayer.classList.remove("show");
    if (!stage.classList.contains("show")) {
      idleHint.classList.remove("hide");
    } else {
      hideIdleHint();
    }
  }

  function softIdle(playToken) {
    clearWatchdog();
    busy = false;
    hideIdleHint();
    errLayer.classList.remove("show");
    stage.classList.remove("still-mode");
    if (still) still.removeAttribute("src");
    try {
      player.pause();
    } catch {
      /* ignore */
    }
    if (playToken) lastPlayToken = playToken;
    postStatus("idle", { soft: true, playToken: lastPlayToken });
  }

  function hardResetUi() {
    clearWatchdog();
    busy = false;
    layoutReady = false;
    stage.classList.remove("show", "still-mode");
    errLayer.classList.remove("show");
    idleHint.classList.remove("hide");
    if (still) still.removeAttribute("src");
    try {
      player.pause();
      player.removeAttribute("src");
      player.load();
    } catch {
      /* ignore */
    }
  }

  function waitDismiss() {
    return new Promise((resolve) => {
      dismissResolver = resolve;
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isStillCmd(cmd) {
    if (cmd?.still === true) return true;
    const name = String(cmd?.name || "");
    const id = String(cmd?.id || "");
    return /\.png$/i.test(name) || id.startsWith("intimg_");
  }

  async function playStill(cmd, myGen) {
    const id = cmd.id;
    if (!id) throw new Error("ไม่มีไฟล์ภาพ");
    const startSec = Math.max(0, Number(cmd.startSec) || 0);
    let endSec = cmd.endSec == null || cmd.endSec === "" ? null : Number(cmd.endSec);
    if (endSec != null && (!Number.isFinite(endSec) || endSec <= startSec)) endSec = null;
    const holdMs = Math.max(800, Math.round(((endSec != null ? endSec : startSec + 4) - startSec) * 1000));
    const playToken = cmd.playToken || null;
    lastPlayToken = playToken;
    hideIdleHint();
    errLayer.classList.remove("show");
    if (!cmd.skipLayout || !layoutReady) {
      await setWindowLayout("fullscreen");
      layoutReady = true;
    }
    if (myGen !== playGen) return;
    stage.classList.add("show", "still-mode");
    const src = `/defaults/interrupt/files/${encodeURIComponent(id)}.png?t=${Date.now()}_${playGen}`;
    still.src = src;
    postStatus("playing", {
      kind: "still",
      name: cmd.name || id,
      id,
      playToken,
      startSec,
      endSec,
    });
    await new Promise((resolve) => {
      const finish = () => {
        clearWatchdog();
        if (myGen === playGen) {
          still.removeAttribute("src");
          stage.classList.remove("still-mode");
        }
        resolve();
      };
      playWatchdog = setTimeout(finish, holdMs);
    });
  }

  async function playVideo(cmd, myGen) {
    const id = cmd.id;
    if (!id) throw new Error("ไม่มีไฟล์วิดีโอ");
    const vol = Math.min(1, Math.max(0, Number(cmd.volume ?? 1)));
    const startSec = Math.max(0, Number(cmd.startSec) || 0);
    let endSec = cmd.endSec == null || cmd.endSec === "" ? null : Number(cmd.endSec);
    if (endSec != null && (!Number.isFinite(endSec) || endSec <= startSec)) endSec = null;
    const maxPlayMs = Number(cmd.maxPlayMs);
    const catchUp = Number.isFinite(maxPlayMs) && maxPlayMs > 0;
    if (catchUp) {
      const capped = startSec + maxPlayMs / 1000;
      if (endSec == null || endSec > capped) endSec = capped;
    }
    const rawMs = ((endSec != null ? endSec : startSec + 8) - startSec) * 1000;
    const hardCap = catchUp ? maxPlayMs + 80 : Math.max(rawMs + 800, 2000);
    const clipMs = Math.max(400, Math.min(hardCap, rawMs + (catchUp ? 40 : 800)));
    const playToken = cmd.playToken || null;
    lastPlayToken = playToken;

    hideIdleHint();
    errLayer.classList.remove("show");
    if (!cmd.skipLayout || !layoutReady) {
      await setWindowLayout("fullscreen");
      layoutReady = true;
    }
    if (myGen !== playGen) return;
    stage.classList.add("show");
    player.muted = !!cmd.muted;
    player.volume = vol;
    const wantSrc = `/api/video-file/${encodeURIComponent(id)}`;
    // Always reload for each unit — same-file combo used to resume at endSec and finish instantly.
    player.src = `${wantSrc}?t=${Date.now()}_${playGen}`;
    try {
      player.load();
    } catch {
      /* ignore */
    }
    postStatus("playing", {
      kind: "video",
      name: cmd.name || id,
      id,
      playToken,
      startSec,
      endSec,
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanup();
        try {
          player.pause();
        } catch {
          /* ignore */
        }
        if (myGen !== playGen) {
          resolve();
          return;
        }
        if (err) reject(err);
        else resolve();
      };
      const onEnded = () => finish();
      const onError = () => finish(new Error("เล่นวิดีโอไม่สำเร็จ"));
      const onTime = () => {
        if (myGen !== playGen) {
          finish();
          return;
        }
        if (endSec != null && player.currentTime >= endSec - 0.05) {
          finish();
        }
      };
      const startPlayback = () => {
        if (myGen !== playGen) {
          finish();
          return;
        }
        try {
          // Must rewind every unit (startSec may be 0 — still need reset after prior end).
          if (Math.abs((player.currentTime || 0) - startSec) > 0.04) {
            player.currentTime = startSec;
          }
        } catch {
          /* ignore */
        }
        const p = player.play();
        if (p && typeof p.then === "function") {
          p.catch((err) => finish(err));
        }
      };
      const onMeta = () => {
        if (myGen !== playGen) {
          finish();
          return;
        }
        try {
          if (endSec != null && Number.isFinite(player.duration) && endSec > player.duration) {
            endSec = player.duration;
          }
          const onSeeked = () => {
            player.removeEventListener("seeked", onSeeked);
            startPlayback();
          };
          player.addEventListener("seeked", onSeeked);
          player.currentTime = startSec;
          // กัน seeked ไม่มา
          setTimeout(() => {
            if (!settled && myGen === playGen) startPlayback();
          }, 150);
          return;
        } catch {
          /* ignore */
        }
        startPlayback();
      };
      const cleanup = () => {
        player.removeEventListener("ended", onEnded);
        player.removeEventListener("error", onError);
        player.removeEventListener("timeupdate", onTime);
        player.removeEventListener("loadedmetadata", onMeta);
      };
      player.addEventListener("ended", onEnded);
      player.addEventListener("error", onError);
      player.addEventListener("timeupdate", onTime);
      player.addEventListener("loadedmetadata", onMeta);
      playWatchdog = setTimeout(() => finish(), clipMs);
      if (player.readyState >= 1) onMeta();
      else player.load();
    });
  }

  async function setWindowLayout(mode, size) {
    try {
      const q = new URLSearchParams({ mode: mode === "popup" ? "popup" : "fullscreen" });
      if (size?.w) q.set("w", String(size.w));
      if (size?.h) q.set("h", String(size.h));
      await fetch(`/api/interrupt-overlay/layout?${q}`, { method: "POST" });
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle("popup-mode", mode === "popup");
  }

  async function showError(cmd) {
    hideIdleHint();
    stage.classList.remove("show");
    try {
      player.pause();
    } catch {
      /* ignore */
    }
    await setWindowLayout("popup", { w: 460, h: 220 });
    errTitle.textContent = String(cmd.title || "Windows").slice(0, 80);
    errMessage.textContent = String(
      cmd.message || "An unexpected error has occurred.\nPlease click OK to continue."
    ).slice(0, 800);
    const code = String(cmd.code || "").trim();
    errCode.textContent = code ? code : "";
    errCode.style.display = code ? "block" : "none";
    errLayer.classList.add("show");
    lastPlayToken = cmd.playToken || null;
    postStatus("playing", { kind: "error", title: errTitle.textContent, playToken: lastPlayToken });
    errOkBtn.focus();
    await waitDismiss();
  }

  async function runCommand(cmd) {
    if (cmd.type === "stop" || cmd.type === "dismiss") {
      playGen += 1;
      if (dismissResolver) {
        const r = dismissResolver;
        dismissResolver = null;
        r();
      }
      hardResetUi();
      postStatus("idle", { reason: "stop" });
      return;
    }

    if (cmd.type !== "play" && cmd.type !== "show-error") return;

    // New play only after previous command finished (handleChain).
    // Do NOT bump playGen until we start — avoids cutting a still-playing clip early.
    const myGen = ++playGen;
    clearWatchdog();
    if (dismissResolver) {
      const r = dismissResolver;
      dismissResolver = null;
      r();
    }
    try {
      player.pause();
    } catch {
      /* ignore */
    }
    busy = true;
    try {
      if (cmd.type === "show-error") {
        await showError(cmd);
      } else if (isStillCmd(cmd)) {
        await playStill(cmd, myGen);
      } else {
        await playVideo(cmd, myGen);
      }
      if (myGen === playGen) softIdle(cmd.playToken || lastPlayToken);
    } catch (err) {
      if (myGen !== playGen) return;
      hardResetUi();
      postStatus("error", { error: err?.message || String(err), playToken: cmd.playToken || null });
      postStatus("idle", { reason: "error", playToken: cmd.playToken || null });
    } finally {
      if (myGen === playGen) busy = false;
    }
  }

  function enqueueCommand(raw) {
    let cmd = raw;
    if (typeof raw === "string") {
      try {
        cmd = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!cmd || !cmd.type) return;

    const at = Number(cmd.at) || 0;
    if (at > 0 && at === lastCmdAt) return;
    if (at > 0) lastCmdAt = at;

    handleChain = handleChain.then(() => runCommand(cmd)).catch(() => {});
  }

  errOkBtn.addEventListener("click", () => {
    if (dismissResolver) {
      const r = dismissResolver;
      dismissResolver = null;
      r();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && errLayer.classList.contains("show")) {
      errOkBtn.click();
    }
  });

  async function poll() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const res = await fetch(`/api/interrupt-overlay/poll?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      const cmds = data.commands || [];
      for (const c of cmds) {
        enqueueCommand(c);
      }
    } catch {
      /* ignore */
    } finally {
      pollInFlight = false;
    }
  }

  window.addEventListener("storage", (ev) => {
    if (ev.key !== "tgr_interrupt_cmd" || !ev.newValue) return;
    enqueueCommand(ev.newValue);
  });

  if (/[?&]popup=1\b/i.test(location.search) || document.body.clientWidth < 700) {
    document.documentElement.classList.add("popup-mode");
  }

  showBootIdle();
  postStatus("ready");
  setInterval(poll, 33);
  poll();
})();
