(() => {
  const CHANNEL = "tgr-jar-overlay";
  const STORAGE_KEY = "tgr_jar_overlay_cmd";
  const STATUS_KEY = "tgr_jar_overlay_status";
  const ICONS = "/gifts/jar/icons/";
  const UNKNOWN = ICONS + "_unknown.svg";
  const JAR_ART_URL = "/gifts/jar/art/mason.png?v=jar50";
  const JAR_ART_W = 293;
  const JAR_ART_H = 384;
  const JAR_ART_ASPECT = JAR_ART_H / JAR_ART_W;
  const JAR_FILL = 500;
  const OVERLAY_CAP = 2000;

  const { Engine, World, Bodies, Body, Composite, Runner, Sleeping, Events } = Matter;
  const CAT_INNER = 0x0001;
  const CAT_OUTER = 0x0002;
  const CAT_GIFT = 0x0004;
  const CAT_GROUND = 0x0008;

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
  const jarArt = new Image();
  jarArt.decoding = "async";
  jarArt.src = JAR_ART_URL;
  jarArt.onload = () => resize();

  const engine = Engine.create({
    enableSleeping: true,
    gravity: { x: 0, y: 1.35, scale: 0.001 },
  });
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  engine.constraintIterations = 2;
  const runner = Runner.create({ delta: 1000 / 60, isFixed: true });
  Runner.run(runner, engine);

  function spillCount() {
    let n = 0;
    for (const b of giftBodies()) if (b.plugin && b.plugin.spilled) n += 1;
    return n;
  }

  function postStatus(state, extra = {}) {
    const gifts = giftBodies();
    const spilled = spillCount();
    const payload = {
      type: "jar-overlay-status",
      state,
      count: gifts.length,
      inJar: gifts.length - spilled,
      spill: spilled,
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
    if (t < 0.06) return lerp(0.328, 0.345, t / 0.06);
    if (t < 0.18) return lerp(0.345, 0.355, (t - 0.06) / 0.12);
    if (t < 0.28) return lerp(0.355, 0.412, smooth((t - 0.18) / 0.1));
    if (t < 0.82) return lerp(0.412, 0.418, (t - 0.28) / 0.54);
    if (t < 0.93) return lerp(0.418, 0.33, smooth((t - 0.82) / 0.11));
    return lerp(0.33, 0.18, smooth(Math.min(1, (t - 0.93) / 0.07)));
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

  function segmentBody(wall, thick, filter, friction) {
    const mx = (wall.ax + wall.bx) / 2;
    const my = (wall.ay + wall.by) / 2;
    const angle = Math.atan2(wall.by - wall.ay, wall.bx - wall.ax);
    return Bodies.rectangle(mx, my, wall.len, thick, {
      isStatic: true,
      angle,
      friction: friction == null ? 0.92 : friction,
      frictionStatic: friction == null ? 1 : Math.min(1, friction + 0.15),
      restitution: 0,
      slop: 0.02,
      chamfer: { radius: Math.min(3, thick * 0.25) },
      collisionFilter: filter,
    });
  }

  function rebuildWalls() {
    if (wallBodies.length) Composite.remove(engine.world, wallBodies);
    wallBodies = [];
    const innerF = { category: CAT_INNER, mask: CAT_GIFT };
    const outerF = { category: CAT_OUTER, mask: CAT_GIFT };
    const groundF = { category: CAT_GROUND, mask: CAT_GIFT };
    const lipSkip = geom.pieceR * 1.05;
    const innerT = Math.max(8, geom.wallT * 0.95);
    const outerT = Math.max(8, geom.wallT * 1.05);
    for (const wall of innerWalls) {
      if (Math.min(wall.ay, wall.by) < geom.mouthY + lipSkip) continue;
      wallBodies.push(segmentBody(wall, innerT, innerF, 0.88));
    }
    for (const wall of outerWalls) {
      if (Math.min(wall.ay, wall.by) < geom.mouthY + lipSkip * 0.55) continue;
      wallBodies.push(segmentBody(wall, outerT, outerF, 0.18));
    }
    const lipR = Math.max(5, geom.wallT * 0.62);
    for (const x of [geom.mouthL, geom.mouthR]) {
      wallBodies.push(
        Bodies.circle(x, geom.mouthY + lipR * 0.15, lipR, {
          isStatic: true,
          friction: 0.2,
          frictionStatic: 0.25,
          restitution: 0,
          collisionFilter: innerF,
        })
      );
    }
    const floorY = geom.innerBottom + geom.wallT * 0.85;
    wallBodies.push(
      Bodies.rectangle(geom.w * 0.5, floorY + 22, geom.w + 240, 44, {
        isStatic: true,
        friction: 0.78,
        frictionStatic: 0.9,
        restitution: 0.02,
        collisionFilter: groundF,
      })
    );
    const wallH = Math.max(80, geom.h);
    wallBodies.push(
      Bodies.rectangle(geom.stageL - 16, geom.h * 0.5, 32, wallH * 2, {
        isStatic: true,
        friction: 0.4,
        restitution: 0,
        collisionFilter: groundF,
      })
    );
    wallBodies.push(
      Bodies.rectangle(geom.stageR + 16, geom.h * 0.5, 32, wallH * 2, {
        isStatic: true,
        friction: 0.4,
        restitution: 0,
        collisionFilter: groundF,
      })
    );
    Composite.add(engine.world, wallBodies);
  }

  function layoutJar(w, h) {
    const margin = 10;
    const dropRoom = Math.max(36, h * 0.07);
    const hudRoom = 56;
    const sideRoom = Math.max(88, Math.min(140, w * 0.2));
    const maxW = Math.max(160, w - margin * 2 - sideRoom * 2);
    const maxH = Math.max(200, h - margin * 2 - dropRoom - hudRoom);
    let jarW = Math.min(maxW, maxH / JAR_ART_ASPECT, 360);
    let jarH = jarW * JAR_ART_ASPECT;
    if (jarH > maxH) {
      jarH = maxH;
      jarW = jarH / JAR_ART_ASPECT;
    }
    const cx = w * 0.5;
    const bottom = h - margin - hudRoom;
    const top = Math.max(margin + dropRoom, bottom - jarH);
    const wallT = Math.max(8, jarW * 0.055);
    const mouthY = top + jarH * 0.055;
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
      artX: cx - jarW / 2,
      artY: top,
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
        collisionFilter: { category: CAT_GIFT, mask: CAT_INNER | CAT_GIFT | CAT_GROUND },
      });
      Body.setVelocity(body, { x: (Math.random() * 2 - 1) * 0.6, y: 1.2 });
      body.plugin = { kind: "gift", img: item.img, giftName: item.giftName, r, spilled: false };
      Composite.add(engine.world, body);
      item.left -= 1;
      budget -= 1;
      if (item.left <= 0) spawnQ.shift();
    }
    spawnWait = queued <= 16 ? 0.08 : queued <= 80 ? 0.04 : 0.02;
  }

  function markSpill(b, dir) {
    if (!b || !b.plugin || b.plugin.spilled) return;
    b.plugin.spilled = true;
    b.collisionFilter.mask = CAT_OUTER | CAT_GIFT | CAT_GROUND;
    b.friction = 0.22;
    b.frictionStatic = 0.28;
    b.frictionAir = 0.01;
    b.sleepThreshold = 22;
    Sleeping.set(b, false);
    const d = dir || (b.position.x < geom.cx ? -1 : 1);
    Body.setVelocity(b, {
      x: d * (2.1 + Math.random() * 1.1),
      y: Math.min(Math.abs(b.velocity.y), 1.8) + 0.35,
    });
  }

  function nudgeOverflow() {
    if (!geom) return;
    const brim = geom.mouthY + geom.pieceR * 2.8;
    const gifts = giftBodies();
    let brimN = 0;
    for (const b of gifts) {
      if (!b.plugin.spilled && b.position.y < brim) brimN += 1;
    }
    const packed = brimN >= 7;
    for (const b of gifts) {
      if (b.plugin.spilled) {
        if (b.position.y > geom.h + 30) {
          const d = b.position.x < geom.cx ? -1 : 1;
          const r = b.circleRadius || 12;
          const x = geom.cx + d * (geom.jarW * 0.5 + geom.wallT * 2 + r * 2);
          Body.setPosition(b, { x, y: geom.innerBottom - r - 2 });
          Body.setVelocity(b, { x: d * 0.8, y: 0 });
        }
        continue;
      }
      if (b.position.y > geom.h + 30) {
        markSpill(b, b.position.x < geom.cx ? -1 : 1);
        continue;
      }
      const r = b.circleRadius || 12;
      const x = b.position.x;
      const y = b.position.y;
      if (y < geom.mouthY - r * 2.4) continue;
      const nearBrim = y < brim;
      if (nearBrim) {
        Sleeping.set(b, false);
        b.sleepThreshold = Infinity;
      }
      if (x < geom.mouthL + r * 0.28) {
        markSpill(b, -1);
        continue;
      }
      if (x > geom.mouthR - r * 0.28) {
        markSpill(b, 1);
        continue;
      }
      if (!packed || !nearBrim) continue;
      const dir = x < geom.cx ? -1 : 1;
      const nearEdge = Math.abs(x - geom.cx) > geom.mouthW * 0.22;
      const aboveLip = y < geom.mouthY + r * 0.7;
      if (nearEdge || aboveLip) {
        Body.applyForce(b, b.position, { x: dir * 0.0042, y: -0.00015 });
        if (aboveLip && nearEdge) markSpill(b, dir);
      }
    }
  }

  Events.on(engine, "beforeUpdate", nudgeOverflow);

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

  function jarArtReady() {
    return !!(jarArt && jarArt.complete && jarArt.naturalWidth);
  }

  function drawJarImage() {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(jarArt, geom.artX, geom.artY, geom.jarW, geom.jarH);
  }

  function drawJarBack() {
    if (!geom || !outerPoly.length || !jarPoly.length) return;
    if (jarArtReady()) {
      drawJarImage();
      return;
    }
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
    if (jarArtReady()) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(outerPoly[0][0], outerPoly[0][1]);
      for (let i = 1; i < outerPoly.length; i++) ctx.lineTo(outerPoly[i][0], outerPoly[i][1]);
      ctx.closePath();
      ctx.moveTo(jarPoly[0][0], jarPoly[0][1]);
      for (let i = 1; i < jarPoly.length; i++) ctx.lineTo(jarPoly[i][0], jarPoly[i][1]);
      ctx.closePath();
      ctx.clip("evenodd");
      drawJarImage();
      ctx.restore();
      return;
    }
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
    const x0 = 0;
    const y0 = 0;
    const w = canvas.width;
    const h = canvas.height;
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
    ctx.putImageData(img, 0, 0);
  }

  function draw() {
    if (!geom) return;
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, geom.w, geom.h);
    drawJarBack();
    const gifts = giftBodies();
    for (const b of gifts) {
      if (b.plugin && b.plugin.spilled) continue;
      if (b.position.y + (b.circleRadius || 12) < geom.mouthY) drawOne(b);
    }
    ctx.save();
    if (jarPoly.length) {
      strokePoly(jarPoly, true);
      ctx.clip();
    }
    for (const b of gifts) {
      if (b.plugin && b.plugin.spilled) continue;
      if (b.position.y + (b.circleRadius || 12) >= geom.mouthY) drawOne(b);
    }
    ctx.restore();
    drawJarFront();
    for (const b of gifts) {
      if (b.plugin && b.plugin.spilled) drawOne(b);
    }
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
    let spilled = 0;
    let yMin = 1e9;
    let yMax = -1e9;
    for (const b of gifts) {
      if (b.isSleeping) sleep += 1;
      if (b.plugin && b.plugin.spilled) spilled += 1;
      if (b.position.y < yMin) yMin = b.position.y;
      if (b.position.y > yMax) yMax = b.position.y;
    }
    return {
      n: gifts.length,
      inJar: gifts.length - spilled,
      spill: spilled,
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
