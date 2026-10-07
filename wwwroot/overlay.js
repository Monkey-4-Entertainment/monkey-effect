(() => {
  const CHANNEL = "tgr-video-overlay";
  const params = new URLSearchParams(location.search);
  const mode = (params.get("mode") || "chroma").toLowerCase();
  const clearMode = mode === "clear";
  document.documentElement.classList.add(clearMode ? "mode-clear" : "mode-chroma");
  document.body.classList.add(clearMode ? "mode-clear" : "mode-chroma");

  const player = document.getElementById("player");
  const view = document.getElementById("view");
  let playToken = 0;
  let activeCommand = null;
  let playbackState = "ready";
  let statusExtra = {};
  const seenCommands = new Map();
  let polling = false;
  let lastStopCommand = null;

  function olderThan(command, reference) {
    if (!reference || !command.at || !reference.at) return false;
    if (command.at !== reference.at) return command.at < reference.at;
    const a = String(command.commandId || "").split(":"), b = String(reference.commandId || "").split(":");
    return a.length === 2 && b.length === 2 && a[0] === b[0] && Number(a[1]) < Number(b[1]);
  }
  let raf = 0;
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  const compositor = createCompositor(view, clearMode);

  function stopDraw() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    compositor.clear();
    view.classList.remove("show");
  }

  function drawFrame() {
    if (!player || player.paused || player.ended) return;
    compositor.draw(player);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    drawFrame();
  }

  function startDraw() {
    view.classList.add("show");
    compositor.resize();
    if (!raf) loop();
  }

  function stopVideo() {
    playToken++;
    try {
      player.pause();
      player.removeAttribute("src");
      player.load();
    } catch {
      /* ignore */
    }
    player.classList.remove("show");
    document.body.classList.remove("playing");
    stopDraw();
    postStatus("idle");
  }

  async function playVideo(msg) {
    const id = msg?.id;
    if (!id) return;
    activeCommand = msg;
    postStatus("loading");
    const token = ++playToken;
    try {
      player.pause();
    } catch {
      /* ignore */
    }

    const src = `/api/video-file/${encodeURIComponent(id)}?t=${Date.now()}`;
    player.muted = msg.muted === true;
    player.defaultMuted = msg.muted === true;
    player.volume =
      msg.muted === true
        ? 0
        : typeof msg.volume === "number"
          ? Math.min(1, Math.max(0, msg.volume))
          : 1;
    player.src = src;
    player.classList.add("show");
    document.body.classList.add("playing");
    startDraw();

    try {
      await player.play();
      if (token !== playToken) return;
      postStatus("playing", { id, name: id, muted: !!player.muted, volume: player.volume });
    } catch (err) {
      if (token !== playToken) return;
      try {
        player.muted = true;
        player.volume = 0;
        await player.play();
        if (token !== playToken) return;
        postStatus("playing", { id, name: id, muted: true });
      } catch (err2) {
        if (token !== playToken) return;
        stopDraw();
        postStatus("error", { error: err2.message || String(err2) });
        player.classList.remove("show");
        document.body.classList.remove("playing");
      }
    }
  }

  function postStatus(state, extra = {}) {
    playbackState = state;
    statusExtra = extra;
    const payload = { type: "overlay-status", state, commandId: activeCommand?.commandId || null,
      id: activeCommand?.id || null, ...extra, at: Date.now() };
    try {
      localStorage.setItem("tgr_video_overlay_status", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    channel?.postMessage(payload);
    fetch("/api/video-overlay/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  function handleMessage(data) {
    if (!data || typeof data !== "object") return;
    // One command arrives through BroadcastChannel, storage and HTTP polling.
    // The clip id cannot be used here: genuine repeat gifts reuse the same clip.
    const key = data.commandId || (data.at ? `${data.type}|${data.id || ""}|${data.at}` : null);
    if (key) {
      if (seenCommands.has(key)) return;
      seenCommands.set(key, true);
      if (seenCommands.size > 4096) seenCommands.delete(seenCommands.keys().next().value);
    }
    if (data.type === "play") {
      if (olderThan(data, lastStopCommand) || olderThan(data, activeCommand)) return;
      playVideo(data).catch((e) => postStatus("error", { error: e.message || String(e) }));
    } else if (data.type === "stop") {
      if (data.targetCommandId && data.targetCommandId !== activeCommand?.commandId) return;
      if (olderThan(data, activeCommand)) return;
      lastStopCommand = data;
      stopVideo();
    } else if (data.type === "ping") {
      postStatus(playbackState, statusExtra);
    } else if (data.type === "set-volume") {
      if (!player.muted) {
        player.volume = Math.min(1, Math.max(0, Number(data.volume) || 0));
      }
    }
  }

  channel?.addEventListener("message", (ev) => handleMessage(ev.data));

  window.addEventListener("storage", (ev) => {
    if (ev.key !== "tgr_video_overlay_cmd" || !ev.newValue) return;
    try {
      handleMessage(JSON.parse(ev.newValue));
    } catch {
      /* ignore */
    }
  });

  async function pollCommands() {
    if (polling) return;
    polling = true;
    try {
      const res = await fetch(`/api/video-overlay/poll?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.commands) ? data.commands : [];
      for (const raw of list) {
        try {
          handleMessage(typeof raw === "string" ? JSON.parse(raw) : raw);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    } finally {
      polling = false;
    }
  }

  player.addEventListener("ended", () => {
    player.classList.remove("show");
    document.body.classList.remove("playing");
    stopDraw();
    postStatus("idle");
  });
  player.addEventListener("error", () => {
    postStatus("error", { error: "เล่นวิดีโอไม่สำเร็จ" });
    player.classList.remove("show");
    document.body.classList.remove("playing");
    stopDraw();
  });
  player.addEventListener("loadeddata", () => compositor.resize());
  window.addEventListener("resize", () => compositor.resize());
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    try { window.chrome?.webview?.postMessage("drag"); } catch { /* ignore */ }
  });

  setInterval(pollCommands, 500);
  pollCommands().finally(() => { if (!activeCommand) postStatus("ready"); });
  // Repeat the terminal result too, so a very short clip is not lost between polls.
  setInterval(() => postStatus(playbackState, statusExtra), 1000);
  window.addEventListener("beforeunload", () => postStatus("closed"));
})();

function containRect(cw, ch, vw, vh) {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

function createCompositor(canvas, clearMode) {
  const gl = canvas.getContext("webgl", {
    alpha: !!clearMode,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  if (gl) {
    const gpu = createGlCompositor(gl, canvas, clearMode);
    if (gpu) return gpu;
  }
  return createCanvas2dCompositor(canvas, clearMode);
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createGlCompositor(gl, canvas, clearMode) {
  const vs = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `
  );
  const fs = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform vec2 u_texel;
    uniform float u_clear;
    void main() {
      vec4 c0 = texture2D(u_tex, v_uv);
      vec4 cx = texture2D(u_tex, v_uv + vec2(u_texel.x, 0.0));
      vec4 cy = texture2D(u_tex, v_uv + vec2(0.0, u_texel.y));
      vec4 cnx = texture2D(u_tex, v_uv - vec2(u_texel.x, 0.0));
      vec4 cny = texture2D(u_tex, v_uv - vec2(0.0, u_texel.y));

      float spill = max(0.0, c0.g - max(c0.r, c0.b));
      float key = smoothstep(0.05, 0.18, spill);
      float a = c0.a * (1.0 - key);
      float aN = min(min(cx.a, cnx.a), min(cy.a, cny.a));
      a = min(a, mix(a, aN, 0.65));
      a = smoothstep(0.16, 0.52, a);

      vec3 rgb = vec3(c0.r, c0.g - spill * 0.9, c0.b);
      if (u_clear > 0.5) {
        gl_FragColor = vec4(rgb, a);
      } else {
        vec3 chroma = vec3(0.0, 1.0, 0.0);
        gl_FragColor = vec4(mix(chroma, rgb, a), 1.0);
      }
    }
  `
  );
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const buf = gl.createBuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const aPos = gl.getAttribLocation(prog, "a_pos");
  const aUv = gl.getAttribLocation(prog, "a_uv");
  const uTexel = gl.getUniformLocation(prog, "u_texel");
  const uClear = gl.getUniformLocation(prog, "u_clear");

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor((canvas.clientWidth || window.innerWidth || 2) * dpr));
    const h = Math.max(2, Math.floor((canvas.clientHeight || window.innerHeight || 2) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function clear() {
    resize();
    if (clearMode) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function draw(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    resize();
    const cw = canvas.width;
    const ch = canvas.height;
    const dest = containRect(cw, ch, vw, vh);
    const x0 = (dest.x / cw) * 2 - 1;
    const x1 = ((dest.x + dest.w) / cw) * 2 - 1;
    const y0 = 1 - (dest.y / ch) * 2;
    const y1 = 1 - ((dest.y + dest.h) / ch) * 2;
    const verts = new Float32Array([
      x0, y0, 0, 1, x1, y0, 1, 1, x0, y1, 0, 0, x0, y1, 0, 0, x1, y0, 1, 1, x1, y1, 1, 0,
    ]);

    if (clearMode) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return;
    }
    gl.uniform2f(uTexel, 1 / vw, 1 / vh);
    gl.uniform1f(uClear, clearMode ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return { resize, clear, draw };
}

function createCanvas2dCompositor(canvas, clearMode) {
  const ctx = canvas.getContext("2d", { alpha: !!clearMode });
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor((canvas.clientWidth || window.innerWidth || 2) * dpr));
    const h = Math.max(2, Math.floor((canvas.clientHeight || window.innerHeight || 2) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  function fillBg() {
    if (clearMode) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  function clear() {
    resize();
    fillBg();
  }
  function draw(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    resize();
    fillBg();
    const dest = containRect(canvas.width, canvas.height, vw, vh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, dest.x, dest.y, dest.w, dest.h);
    const x = Math.max(0, dest.x | 0);
    const y = Math.max(0, dest.y | 0);
    const dw = Math.min(canvas.width - x, Math.ceil(dest.w));
    const dh = Math.min(canvas.height - y, Math.ceil(dest.h));
    if (dw < 2 || dh < 2) return;
    const img = ctx.getImageData(x, y, dw, dh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const spill = Math.max(0, g - Math.max(r, b));
      const key = spill <= 12 ? 0 : Math.min(1, (spill - 12) / 40);
      let a = (d[i + 3] / 255) * (1 - key);
      a = a <= 0.16 ? 0 : a >= 0.52 ? 1 : (a - 0.16) / 0.36;
      if (a <= 0) {
        if (clearMode) {
          d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
        } else {
          d[i] = 0;
          d[i + 1] = 255;
          d[i + 2] = 0;
          d[i + 3] = 255;
        }
        continue;
      }
      const ng = Math.max(0, g - spill * 0.9);
      if (clearMode) {
        d[i] = r;
        d[i + 1] = ng;
        d[i + 2] = b;
        d[i + 3] = Math.round(a * 255);
      } else {
        d[i] = Math.round(r * a);
        d[i + 1] = Math.round(255 + (ng - 255) * a);
        d[i + 2] = Math.round(b * a);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, x, y);
  }
  return { resize, clear, draw };
}
