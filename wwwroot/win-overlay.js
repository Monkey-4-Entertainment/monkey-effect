(() => {
  const CHANNEL = "tgr-win-overlay";
  const STORAGE_KEY = "tgr_win_overlay_cmd";
  const winHud = document.getElementById("winHud");
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  let audioCtx = null;
  let lastFeedbackAt = 0;

  function playDeltaSound(delta) {
    if (!delta) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const now = audioCtx.currentTime;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      gain.connect(audioCtx.destination);
      const first = audioCtx.createOscillator();
      first.type = delta > 0 ? "sine" : "triangle";
      first.frequency.setValueAtTime(delta > 0 ? 620 : 360, now);
      first.frequency.exponentialRampToValueAtTime(delta > 0 ? 920 : 180, now + 0.28);
      first.connect(gain);
      first.start(now);
      first.stop(now + 0.35);
      if (delta > 0) {
        const sparkle = audioCtx.createOscillator();
        sparkle.type = "sine";
        sparkle.frequency.setValueAtTime(1040, now + 0.08);
        sparkle.connect(gain);
        sparkle.start(now + 0.08);
        sparkle.stop(now + 0.3);
      }
    } catch {
      /* audio may be disabled by the browser source */
    }
  }

  function playDeltaFeedback(delta, at) {
    if (!winHud || !delta) return;
    const stamp = Number(at) || Date.now();
    if (stamp === lastFeedbackAt) return;
    lastFeedbackAt = stamp;
    winHud.classList.remove("score-plus", "score-minus");
    void winHud.offsetWidth;
    winHud.classList.add(delta > 0 ? "score-plus" : "score-minus");
    playDeltaSound(delta);
  }

  function applyWinScore(msg) {
    if (!winHud) return;
    const score = Number(msg?.score);
    const target = Number(msg?.target);
    const visible = msg?.visible !== false;
    const s = Number.isFinite(score) ? score : 0;
    const t = Number.isFinite(target) && target > 0 ? target : 5;
    winHud.textContent = `${s}/${t}`;
    winHud.classList.toggle("negative", s < 0);
    winHud.classList.toggle("hidden", !visible);
    playDeltaFeedback(Number(msg?.delta) || 0, msg?.at);
  }

  function handleMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.type === "win-score" || data.type === "ping") {
      if (data.type === "win-score") applyWinScore(data);
    }
  }

  channel?.addEventListener("message", (ev) => handleMessage(ev.data));

  window.addEventListener("storage", (ev) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      handleMessage(JSON.parse(ev.newValue));
    } catch {
      /* ignore */
    }
  });

  // Ask main UI to push current score
  try {
    localStorage.setItem(
      "tgr_win_overlay_status",
      JSON.stringify({ type: "win-overlay-status", state: "ready", at: Date.now() })
    );
  } catch {
    /* ignore */
  }
  channel?.postMessage({ type: "win-overlay-status", state: "ready", at: Date.now() });

  // Seed from last known config if present
  try {
    const cfg = JSON.parse(localStorage.getItem("tgr_win_config") || "null");
    if (cfg) {
      applyWinScore({
        type: "win-score",
        score: cfg.score,
        target: cfg.target,
        visible: cfg.showOverlay !== false,
      });
    }
  } catch {
    /* ignore */
  }
})();
