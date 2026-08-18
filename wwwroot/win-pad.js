(() => {
  const WIN_KEY = "tgr_win_config";
  const CONTROL = "tgr-win-control";
  const OVERLAY = "tgr-win-overlay";
  const controlCh = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CONTROL) : null;
  const overlayCh = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(OVERLAY) : null;

  const scoreEl = document.getElementById("score");
  const scoreIn = document.getElementById("scoreIn");
  const targetIn = document.getElementById("targetIn");

  function readConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WIN_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return { score: 0, target: 10, showOverlay: true, rules: [] };
      return {
        score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : 0,
        target: Math.max(1, Number(parsed.target) || 10),
        showOverlay: parsed.showOverlay !== false,
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      };
    } catch {
      return { score: 0, target: 10, showOverlay: true, rules: [] };
    }
  }

  function writeConfig(cfg, reason) {
    localStorage.setItem(WIN_KEY, JSON.stringify(cfg));
    const payload = {
      type: "win-control",
      action: reason,
      score: cfg.score,
      target: cfg.target,
      visible: !!cfg.showOverlay,
      at: Date.now(),
    };
    controlCh?.postMessage(payload);
    overlayCh?.postMessage({
      type: "win-score",
      score: cfg.score,
      target: cfg.target,
      visible: cfg.showOverlay !== false,
      at: Date.now(),
    });
    try {
      localStorage.setItem("tgr_win_overlay_cmd", JSON.stringify({
        type: "win-score",
        score: cfg.score,
        target: cfg.target,
        visible: cfg.showOverlay !== false,
        at: Date.now(),
      }));
    } catch {
      /* ignore */
    }
    render(cfg);
  }

  function render(cfg) {
    const c = cfg || readConfig();
    if (scoreEl) {
      scoreEl.textContent = `${c.score}/${c.target}`;
      scoreEl.classList.toggle("neg", c.score < 0);
    }
    if (scoreIn && document.activeElement !== scoreIn) scoreIn.value = String(c.score);
    if (targetIn && document.activeElement !== targetIn) targetIn.value = String(c.target);
  }

  function bump(delta) {
    const cfg = readConfig();
    cfg.score = (Number(cfg.score) || 0) + delta;
    writeConfig(cfg, delta > 0 ? "plus" : "minus");
  }

  function applyNumbers() {
    const cfg = readConfig();
    cfg.score = Number(scoreIn?.value);
    if (!Number.isFinite(cfg.score)) cfg.score = 0;
    cfg.target = Math.max(1, Number(targetIn?.value) || cfg.target || 10);
    writeConfig(cfg, "set");
  }

  document.getElementById("plus")?.addEventListener("click", () => bump(1));
  document.getElementById("minus")?.addEventListener("click", () => bump(-1));
  document.getElementById("apply")?.addEventListener("click", applyNumbers);
  document.getElementById("reset")?.addEventListener("click", () => {
    const cfg = readConfig();
    cfg.score = 0;
    writeConfig(cfg, "reset");
  });

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "+" || e.key === "=" || e.key === "ArrowUp") {
      e.preventDefault();
      bump(1);
    } else if (e.key === "-" || e.key === "ArrowDown") {
      e.preventDefault();
      bump(-1);
    } else if (e.key === "0") {
      e.preventDefault();
      const cfg = readConfig();
      cfg.score = 0;
      writeConfig(cfg, "reset");
    }
  });

  window.addEventListener("storage", (ev) => {
    if (ev.key === WIN_KEY) render();
  });
  overlayCh?.addEventListener("message", (ev) => {
    if (ev.data?.type === "win-score") render({
      score: ev.data.score,
      target: ev.data.target,
      showOverlay: ev.data.visible !== false,
      rules: readConfig().rules,
    });
  });

  render();
})();
