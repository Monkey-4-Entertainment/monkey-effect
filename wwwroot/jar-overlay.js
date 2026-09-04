(() => {
  const CHANNEL = "tgr-jar-overlay";
  const STORAGE_KEY = "tgr_jar_overlay_cmd";
  const STATUS_KEY = "tgr_jar_overlay_status";
  const ICONS = "/gifts/jar/icons/";
  const UNKNOWN = ICONS + "_unknown.svg";
  const JAR_FILL = 500;
  const OVERLAY_CAP = 2000;

  const { Engine, World, Bodies, Body, Composite, Runner } = Matter;

  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d", { alpha: false });
  const hudCount = document.getElementById("hudCount");
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

  const catalogByKey = new Map();
  const imgCache = new Map();
  const spawnQ = [];
  const innerWalls = [];
  const outerWalls = [];
  let jarPoly = [];
  let outerPoly = [];
  let innerOpen = [];
  let outerOpen = [];
  let geom = null;
  let spawnWait = 0;
  let lastCmdAt = 0;
  let lastHud = -1;
  let wallBodies = [];

  const engine = Engine.create({
    enableSleeping: true,
    gravity: { x: 0, y: 1.35, scale: 0.001 },
  });
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  engine.constraintIterations = 2;
  const runner = Runner.create({ delta: 1000 / 60, isFixed: true });
  Runner.run(runner, engine);

  function postStatus(state, extra = {}) {
    const gifts = giftBodies();
    const payload = {
      type: "jar-overlay-status",
      state,
      count: gifts.length,
      inJar: gifts.length,
      spill: 0,
      queued: queuedCount(),
      ...extra,
      at: Date.now(),
    };
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    channel?.postMessage(payload);
  }

  function giftBodies() {
    return Composite.allBodies(engine.world).filter((b) => !b.isStatic && b.plugin && b.plugin.kind === "gift");
  }

  function queuedCount() {
    let n = 0;
    for (const item of spawnQ) n += item.left;
    return n;
  }

  function roomLeft() {
    return Math.max(0, OVERLAY_CAP - giftBodies().length - queuedCount());
  }

  function normKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function loadCatalog() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`/gifts/jar/catalog.json?t=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) return;
      const pack = await res.json();
      for (const g of pack.gifts || []) {
        const rec = { name: g.name, file: g.file, key: g.key };
        catalogByKey.set(normKey(g.key), rec);
        catalogByKey.set(normKey(g.name), rec);
      }
      for (const [alias, target] of Object.entries(pack.aliases || {})) {
        const hit = catalogByKey.get(normKey(target));
        if (hit) catalogByKey.set(normKey(alias), hit);
      }
    } catch {
      /* ignore */
    } finally {
      clearTimeout(timer);
    }
  }

  function iconUrl(giftName) {
    const rec = catalogByKey.get(normKey(giftName));
    return rec?.file ? ICONS + rec.file : UNKNOWN;
  }

  function loadImage(giftName) {
    const url = iconUrl(giftName);
    const cached = imgCache.get(url);
    if (cached) return cached;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    img.onerror = () => {
      if (url !== UNKNOWN) img.src = UNKNOWN;
    };
    imgCache.set(url, img);
    return img;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function masonHalf(t) {
    if (t < 0.045) return 0.485;
    if (t < 0.12) return lerp(0.485, 0.5, smooth((t - 0.045) / 0.075));
    return 0.5;
  }

  function sampleJar(cx, top, jarW, jarH, mouthY, pad) {
    const bottom = top + jarH;
    const cornerR = Math.max(15, jarW * 0.11);
    const sideSteps = 28;
    const arcSteps = 8;
    const pts = [];
    for (let i = 0; i <= sideSteps; i++) {
      const t = i / sideSteps;
      const y = lerp(mouthY, bottom - cornerR, t);
      const hw = masonHalf(t) * jarW + pad;
      pts.push([cx - hw, y]);
    }
    const bodyHw = masonHalf(1) * jarW + pad;
    const cy = bottom - cornerR;
    for (let i = 1; i <= arcSteps; i++) {
      const a = Math.PI + (Math.PI / 2) * (i / arcSteps);
      pts.push([cx - bodyHw + cornerR + Math.cos(a) * cornerR, cy - Math.sin(a) * cornerR]);
    }
    for (let i = arcSteps - 1; i >= 0; i--) {
      const a = 0 - (Math.PI / 2) * (i / arcSteps);
      pts.push([cx + bodyHw - cornerR + Math.cos(a) * cornerR, cy - Math.sin(a) * cornerR]);
    }
    for (let i = sideSteps; i >= 0; i--) {
      const t = i / sideSteps;
      const y = lerp(mouthY, bottom - cornerR, t);
      const hw = masonHalf(t) * jarW + pad;
      pts.push([cx + hw, y]);
    }
    return pts;
  }

  function addWall(list, ax, ay, bx, by, inward) {
    const tx = bx - ax;
    const ty = by - ay;
    const len = Math.hypot(tx, ty);
    if (len < 0.4) return;
    const nx = ty / len;
    const ny = -tx / len;
    list.push({
      ax,
      ay,
      bx,
      by,
      nx: inward ? nx : -nx,
      ny: inward ? ny : -ny,
      len,
    });
  }

  function segmentBody(wall, thick) {
    const mx = (wall.ax + wall.bx) / 2;
    const my = (wall.ay + wall.by) / 2;
    const angle = Math.atan2(wall.by - wall.ay, wall.bx - wall.ax);
    return Bodies.rectangle(mx, my, wall.len, thick, {
      isStatic: true,
      angle,
      friction: 0.92,
      frictionStatic: 1,
      restitution: 0,
      slop: 0.02,
      chamfer: { radius: Math.min(3, thick * 0.25) },
    });
  }

  function rebuildWalls() {
    if (wallBodies.length) Composite.remove(engine.world, wallBodies);
    wallBodies = [];
    const thick = Math.max(10, geom.wallT * 1.15);
    for (const wall of innerWalls) wallBodies.push(segmentBody(wall, thick));
    Composite.add(engine.world, wallBodies);
  }

  function layoutJar(w, h) {
    const margin = 10;
    const dropRoom = Math.max(40, h * 0.09);
    const sideRoom = Math.max(96, Math.min(150, w * 0.22));
    const jarW = Math.max(140, Math.min(w - margin * 2 - sideRoom * 2, (h * 0.7) / 1.7, 300));
    const jarH = Math.max(220, Math.min(h - margin * 2 - dropRoom, jarW * 1.7, 540));
    const cx = w * 0.5;
    const bottom = h - margin - 56;
    const top = Math.max(margin + dropRoom, bottom - jarH);
    const wallT = Math.max(7, jarW * 0.052);
    const mouthY = top;
    const inner = sampleJar(cx, top, jarW, jarH, mouthY, 0);
    const outer = sampleJar(cx, top, jarW, jarH, mouthY, wallT);
    outer[0][0] -= wallT * 0.22;
    outer[outer.length - 1][0] += wallT * 0.22;

    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of inner) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const mouthL = inner[0][0];
    const mouthR = inner[inner.length - 1][0];
    const mouthW = mouthR - mouthL;
    const bowlH = Math.max(40, maxY - mouthY);
    const bowlW = Math.max(40, maxX - minX);
    const pieceR = Math.max(11, Math.min(14.5, Math.sqrt((bowlW * bowlH * 1.35) / (JAR_FILL * Math.PI))));

    geom = {
      w,
      h,
      jarW,
      jarH,
      cx,
      top,
      bottom,
      mouthY,
      mouthL,
      mouthR,
      mouthW,
      pieceR,
      innerBottom: maxY,
      jarLeft: minX,
      jarRight: maxX,
      wallT,
      neckY0: top + jarH * 0.05,
      neckY1: top + jarH * 0.135,
      stageL: margin,
      stageR: w - margin,
      stageT: margin,
      stageB: h - margin,
    };

    innerWalls.length = 0;
    for (let i = 0; i < inner.length - 1; i++) {
      addWall(innerWalls, inner[i][0], inner[i][1], inner[i + 1][0], inner[i + 1][1], true);
    }
    innerOpen = inner;
    jarPoly = inner.concat([inner[0]]);

    outerWalls.length = 0;
    for (let i = 0; i < outer.length - 1; i++) {
      addWall(outerWalls, outer[i][0], outer[i][1], outer[i + 1][0], outer[i + 1][1], false);
    }
    outerOpen = outer;
    outerPoly = outer.concat([outer[0]]);
    rebuildWalls();
  }

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    layoutJar(w, h);
  }

  function enqueueDrop(giftName, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n || !giftName) return;
    const take = Math.min(n, roomLeft());
    if (!take) return;
    const img = loadImage(giftName);
    spawnQ.push({ giftName: String(giftName), left: take, img });
  }

  const recentDrops = [];
  function acceptDrop(giftName, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const name = String(giftName || "").trim();
    if (!name || !n) return;
    const t = Date.now();
    const key = name + "|" + n;
    if (recentDrops.some((d) => d.key === key && t - d.t < 400)) return;
    recentDrops.push({ key, t });
    if (recentDrops.length > 48) recentDrops.shift();
    enqueueDrop(name, n);
  }

  function resetJar() {
    spawnQ.length = 0;
    Composite.clear(engine.world, false, true);
    wallBodies = [];
    if (geom) rebuildWalls();
    postStatus("ready");
  }

  function spawnFromQueue(dt) {
    if (!geom || !spawnQ.length) return;
    spawnWait -= dt;
    if (spawnWait > 0) return;
    const queued = queuedCount();
    let budget = queued > 400 ? 3 : queued > 120 ? 2 : 1;
    while (budget > 0 && spawnQ.length && giftBodies().length < OVERLAY_CAP) {
      const item = spawnQ[0];
      const r = geom.pieceR * (0.94 + Math.random() * 0.1);
      const x = geom.cx + (Math.random() * 2 - 1) * geom.mouthW * 0.28;
      const y = Math.max(18, geom.mouthY - r * 3 - Math.random() * 10);
      const body = Bodies.circle(x, y, r, {
        restitution: 0.04,
        friction: 0.85,
        frictionStatic: 1,
        frictionAir: 0.012,
        density: 0.0018,
        slop: 0.04,
        sleepThreshold: 18,
        angle: (Math.random() - 0.5) * 0.4,
      });
      Body.setVelocity(body, { x: (Math.random() * 2 - 1) * 0.6, y: 1.2 });
      body.plugin = { kind: "gift", img: item.img, giftName: item.giftName, r };
      Composite.add(engine.world, body);
      item.left -= 1;
      budget -= 1;
      if (item.left <= 0) spawnQ.shift();
    }
    spawnWait = queued <= 16 ? 0.08 : queued <= 80 ? 0.04 : 0.02;
  }

  function strokePoly(poly, close) {
    if (!poly.length) return;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    if (close) ctx.closePath();
  }

  function drawOne(body) {
    const img = body.plugin && body.plugin.img;
    const r = body.circleRadius || (body.plugin && body.plugin.r) || 12;
    const size = Math.max(8, Math.round(r * 2));
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.imageSmoothingEnabled = true;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = "#e2b13a";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawJarBack() {
    if (!geom || !outerPoly.length || !jarPoly.length) return;
    const { cx, jarW, jarH, top, wallT, mouthY, mouthL, mouthR, neckY0, neckY1 } = geom;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    strokePoly(jarPoly, true);
    const innerFill = ctx.createLinearGradient(cx - jarW * 0.5, top, cx + jarW * 0.5, top);
    innerFill.addColorStop(0, "#d9f0fb");
    innerFill.addColorStop(0.5, "#eef9ff");
    innerFill.addColorStop(1, "#d3ebf8");
    ctx.fillStyle = innerFill;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(outerPoly[0][0], outerPoly[0][1]);
    for (let i = 1; i < outerPoly.length; i++) ctx.lineTo(outerPoly[i][0], outerPoly[i][1]);
    ctx.closePath();
    ctx.moveTo(jarPoly[0][0], jarPoly[0][1]);
    for (let i = 1; i < jarPoly.length; i++) ctx.lineTo(jarPoly[i][0], jarPoly[i][1]);
    ctx.closePath();
    const glass = ctx.createLinearGradient(cx - jarW * 0.55, top, cx + jarW * 0.55, top);
    glass.addColorStop(0, "#8ec4de");
    glass.addColorStop(0.22, "#c5e6f6");
    glass.addColorStop(0.5, "#dff3fc");
    glass.addColorStop(0.78, "#b7dcf0");
    glass.addColorStop(1, "#7fb6d2");
    ctx.fillStyle = glass;
    ctx.fill("evenodd");

    ctx.fillStyle = "#9fcfe6";
    const lipH = Math.max(6, wallT * 0.95);
    const lipW = wallT * 1.15;
    ctx.fillRect(mouthL - wallT * 0.15, mouthY - lipH * 0.12, lipW, lipH);
    ctx.fillRect(mouthR - wallT, mouthY - lipH * 0.12, lipW, lipH);

    ctx.strokeStyle = "#6aa4c2";
    ctx.lineWidth = Math.max(2.2, wallT * 0.32);
    const threadN = 3;
    for (let i = 0; i < threadN; i++) {
      const y = lerp(neckY0, neckY1, i / (threadN - 1));
      const t = Math.max(0, Math.min(1, (y - mouthY) / Math.max(1, jarH - jarW * 0.11)));
      const hw = masonHalf(t) * jarW;
      ctx.beginPath();
      ctx.moveTo(cx - hw - wallT * 0.15, y);
      ctx.lineTo(cx - hw + wallT * 0.92, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + hw + wallT * 0.15, y);
      ctx.lineTo(cx + hw - wallT * 0.92, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawJarFront() {
    if (!geom || !outerPoly.length || !jarPoly.length) return;
    const { cx, jarW, jarH, top, wallT } = geom;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    strokePoly(outerOpen, false);
    ctx.strokeStyle = "#3d7fa3";
    ctx.lineWidth = Math.max(6, wallT * 0.72);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2.6, wallT * 0.34);
    ctx.stroke();

    strokePoly(innerOpen, false);
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(1.6, wallT * 0.22);
    ctx.stroke();
    ctx.strokeStyle = "#5b97b6";
    ctx.lineWidth = Math.max(1.2, wallT * 0.16);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(2.8, jarW * 0.03);
    ctx.beginPath();
    ctx.moveTo(cx - jarW * 0.32, top + jarH * 0.22);
    ctx.quadraticCurveTo(cx - jarW * 0.38, top + jarH * 0.48, cx - jarW * 0.3, top + jarH * 0.74);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.3, jarW * 0.012);
    ctx.beginPath();
    ctx.moveTo(cx - jarW * 0.2, top + jarH * 0.28);
    ctx.lineTo(cx - jarW * 0.22, top + jarH * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function snapChroma() {
    const padX = Math.max(24, geom.jarW * 0.55);
    const x0 = Math.max(0, (geom.cx - geom.jarW * 0.5 - padX) | 0);
    const y0 = Math.max(0, (geom.stageT - 4) | 0);
    const x1 = Math.min(canvas.width, (geom.cx + geom.jarW * 0.5 + padX) | 0);
    const y1 = Math.min(canvas.height, (geom.stageB + 4) | 0);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 || h < 2) return;
    const img = ctx.getImageData(x0, y0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (g >= 165 && g >= r + 36 && g >= b + 36 && r < 130 && b < 130) {
        d[i] = 0;
        d[i + 1] = 255;
        d[i + 2] = 0;
      }
    }
    ctx.putImageData(img, x0, y0);
  }

  function draw() {
    if (!geom) return;
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, geom.w, geom.h);
    drawJarBack();
    const gifts = giftBodies();
    for (const b of gifts) {
      if (b.position.y + (b.circleRadius || 12) < geom.mouthY) drawOne(b);
    }
    ctx.save();
    if (jarPoly.length) {
      strokePoly(jarPoly, true);
      ctx.clip();
    }
    for (const b of gifts) {
      if (b.position.y + (b.circleRadius || 12) >= geom.mouthY) drawOne(b);
    }
    ctx.restore();
    drawJarFront();
    snapChroma();
    if (gifts.length !== lastHud && hudCount) {
      lastHud = gifts.length;
      hudCount.textContent = String(gifts.length);
    }
  }

  let lastTs = 0;
  function frame(ts) {
    const dt = Math.min(0.032, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    spawnFromQueue(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function handleMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.at && data.at <= lastCmdAt) return;
    if (data.at) lastCmdAt = data.at;
    if (data.type === "jar-drop") {
      acceptDrop(data.giftName, data.count);
      return;
    }
    if (data.type === "jar-reset") {
      resetJar();
      return;
    }
    if (data.type === "jar-sync") {
      if (giftBodies().length || spawnQ.length) return;
      const pieces = Array.isArray(data.pieces) ? data.pieces : [];
      for (const p of pieces) enqueueDrop(p.giftName || p.name, p.count);
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
  window.addEventListener("resize", resize);

  window.__jarStats = () => {
    const gifts = giftBodies();
    let sleep = 0;
    let yMin = 1e9;
    let yMax = -1e9;
    for (const b of gifts) {
      if (b.isSleeping) sleep += 1;
      if (b.position.y < yMin) yMin = b.position.y;
      if (b.position.y > yMax) yMax = b.position.y;
    }
    return {
      n: gifts.length,
      inJar: gifts.length,
      spill: 0,
      sleep,
      q: queuedCount(),
      r: geom && geom.pieceR,
      yMin,
      yMax,
      mouthY: geom && geom.mouthY,
      engine: "matter",
    };
  };

  resize();
  requestAnimationFrame(frame);

  loadCatalog().finally(() => {
    postStatus("ready");
    const demo = new URLSearchParams(location.search).get("demo");
    if (demo) {
      const [name, count] = demo.split(",");
      enqueueDrop(name || "Rose", Number(count) || 1);
    }
  });

  let jarSeen = new Set();
  let jarPrimed = false;
  async function pollLiveGifts() {
    try {
      const res = await fetch("/api/live-stats?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const evs = data.events || [];
      if (!jarPrimed) {
        for (const ev of evs) if (ev.id) jarSeen.add(ev.id);
        jarPrimed = true;
        return;
      }
      for (const ev of evs) {
        if (!ev.id || jarSeen.has(ev.id)) continue;
        jarSeen.add(ev.id);
        if (ev.kind === "gift" && ev.gift) acceptDrop(ev.gift, ev.count || 1);
      }
      if (jarSeen.size > 240) jarSeen = new Set([...jarSeen].slice(-80));
    } catch {
      /* OBS keeps last frame */
    }
  }
  pollLiveGifts();
  setInterval(pollLiveGifts, 400);
})();
