(() => {
  const params = new URLSearchParams(location.search);
  const chroma = params.get("chroma") === "1";
  document.documentElement.classList.toggle("chroma", chroma);
  document.body.classList.toggle("chroma", chroma);

  const CHANNEL = "tgr-jar-overlay";
  const STORAGE_KEY = "tgr_jar_overlay_cmd";
  const STATUS_KEY = "tgr_jar_overlay_status";
  const ICONS = "/gifts/jar/icons/";
  const UNKNOWN = ICONS + "_unknown.svg";
  const JAR_FILL = 500;
  const OVERLAY_CAP = 2000;
  // Per-gift coin value controls diameter, never the number in a combo.
  const MAX_GIFT_SCALE = 3;

  function parseHexColor(raw, fallback = "#7ec8e3") {
    const s = String(raw || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
    return fallback;
  }

  function hexToRgb(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  function mixHex(hex, towardHex, t) {
    const a = hexToRgb(hex);
    const b = hexToRgb(towardHex);
    const m = (x, y) => Math.round(x + (y - x) * t);
    const to = (n) => n.toString(16).padStart(2, "0");
    return `#${to(m(a.r, b.r))}${to(m(a.g, b.g))}${to(m(a.b, b.b))}`;
  }

  let jarColor = parseHexColor(params.get("color") || params.get("jarColor"), "#e8f4ff");
  const JAR_STYLE_IDS = ["classic", "round", "tall", "wide", "original"];
  const JAR_STYLE_ALIASES = {
    crystal: "round",
    neon: "tall",
    luxe: "wide",
    bulb: "round",
    potion: "tall",
    bowl: "wide",
    legacy: "original",
    old: "original",
    mason: "original",
    tikfinity: "original",
    coinjar: "original",
    glass: "original",
  };
  function parseJarStyle(raw) {
    let s = String(raw || "").toLowerCase().trim();
    if (JAR_STYLE_ALIASES[s]) s = JAR_STYLE_ALIASES[s];
    return JAR_STYLE_IDS.includes(s) ? s : "classic";
  }
  let jarStyle = parseJarStyle(params.get("style") || params.get("jarStyle"));
  const GLASS_BODY_URL = "/gifts/jar/art/glass-body.png?v=jar59";
  const GLASS_BASE_URL = "/gifts/jar/art/glass-base.png?v=jar59";
  const GLASS_RIM_URL = "/gifts/jar/art/glass-rim.png?v=jar59";
  const glassBody = new Image();
  const glassBase = new Image();
  const glassRim = new Image();
  glassBody.decoding = "async";
  glassBase.decoding = "async";
  glassRim.decoding = "async";
  glassBody.src = GLASS_BODY_URL;
  glassBase.src = GLASS_BASE_URL;
  glassRim.src = GLASS_RIM_URL;
  function onGlassArtLoad() {
    resize();
  }
  glassBody.onload = onGlassArtLoad;
  glassBase.onload = onGlassArtLoad;
  glassRim.onload = onGlassArtLoad;

  const { Engine, World, Bodies, Body, Composite, Runner, Sleeping, Events } = Matter;
  const CAT_INNER = 0x0001;
  const CAT_OUTER = 0x0002;
  const CAT_GIFT = 0x0004;
  const CAT_GROUND = 0x0008;

  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d", { alpha: !chroma });
  const hudCount = document.getElementById("hudCount");
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

  const catalogByKey = new Map();
  let catalogReady = false;
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
  let pileFull = false;
  let pileAreaRatio = 0;
  let fullSince = 0;
  let lastPileCheck = -Infinity;

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
        const coins = Number(g.coins);
        const rec = {
          name: g.name, file: g.file, key: g.key,
          coins: Number.isFinite(coins) && coins > 0 ? coins : 1,
        };
        catalogByKey.set(normKey(g.key), rec);
        catalogByKey.set(normKey(g.name), rec);
      }
      for (const [alias, target] of Object.entries(pack.aliases || {})) {
        const hit = catalogByKey.get(normKey(target));
        // An alias must not replace a real gift (e.g. Rosa costs more than Rose).
        if (hit && !catalogByKey.has(normKey(alias))) catalogByKey.set(normKey(alias), hit);
      }
    } catch {
      /* ignore */
    } finally {
      clearTimeout(timer);
      catalogReady = true;
    }
  }

  function giftSizeScale(giftName) {
    const coins = catalogByKey.get(normKey(giftName))?.coins || 1;
    // 1 / 10 / 100 / 1,000 / 10,000+ coins -> 1 / 1.5 / 2 / 2.5 / 3x.
    return Math.min(MAX_GIFT_SCALE, 1 + Math.log10(Math.max(1, coins)) * 0.5);
  }

  function giftRadius(giftName) {
    const lipR = Math.max(5, geom.wallT * 0.62);
    const maxR = Math.max(4, (geom.mouthW / 2 - lipR - 4) * 0.82);
    // Scale the whole range down for narrow jars so even the largest gift fits.
    const baseR = Math.min(geom.pieceR, maxR / MAX_GIFT_SCALE);
    return baseR * giftSizeScale(giftName);
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

  /** Reference mason profile inside glass-body.png (fraction of jarW). */
  function classicHalf(t) {
    // Inner edge measured against the existing 500x500 glass PNG.
    // t=0 is its mouth (y=65); t=1 is the inside floor (y=430).
    const profile = [[0, .238], [.15, .230], [.205, .228], [.26, .258],
      [.315, .268], [.835, .264], [.89, .250], [.945, .234], [.986, .196], [1, .170]];
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < profile.length; i++) {
      if (t <= profile[i][0]) {
        const a = profile[i - 1], b = profile[i];
        return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
      }
    }
    return profile[profile.length - 1][1];
  }

  /** Half-width profile 0..1 along jar height (mouth → base). Each style = different silhouette. */
  function shapeHalf(t) {
    const s = jarStyle;
    if (s === "round") {
      if (t < 0.1) return lerp(0.22, 0.28, t / 0.1);
      if (t < 0.32) return lerp(0.28, 0.5, smooth((t - 0.1) / 0.22));
      if (t < 0.72) return lerp(0.5, 0.52, (t - 0.32) / 0.4);
      if (t < 0.9) return lerp(0.52, 0.4, smooth((t - 0.72) / 0.18));
      return lerp(0.4, 0.22, smooth(Math.min(1, (t - 0.9) / 0.1)));
    }
    if (s === "tall") {
      if (t < 0.08) return lerp(0.16, 0.17, t / 0.08);
      if (t < 0.38) return lerp(0.17, 0.19, (t - 0.08) / 0.3);
      if (t < 0.52) return lerp(0.19, 0.38, smooth((t - 0.38) / 0.14));
      if (t < 0.82) return lerp(0.38, 0.4, (t - 0.52) / 0.3);
      if (t < 0.93) return lerp(0.4, 0.28, smooth((t - 0.82) / 0.11));
      return lerp(0.28, 0.16, smooth(Math.min(1, (t - 0.93) / 0.07)));
    }
    if (s === "wide") {
      if (t < 0.08) return lerp(0.4, 0.44, t / 0.08);
      if (t < 0.2) return lerp(0.44, 0.48, smooth((t - 0.08) / 0.12));
      if (t < 0.78) return lerp(0.48, 0.5, (t - 0.2) / 0.58);
      if (t < 0.92) return lerp(0.5, 0.38, smooth((t - 0.78) / 0.14));
      return lerp(0.38, 0.2, smooth(Math.min(1, (t - 0.92) / 0.08)));
    }
    return classicHalf(t);
  }

  function shapeAspect() {
    if (jarStyle === "original") return 1;
    if (jarStyle === "round") return 1.12;
    if (jarStyle === "tall") return 1.58;
    if (jarStyle === "wide") return 1.02;
    return 384 / 293;
  }

  function shapeCornerR(jarW) {
    if (jarStyle === "round") return Math.max(22, jarW * 0.2);
    if (jarStyle === "tall") return Math.max(12, jarW * 0.09);
    if (jarStyle === "wide") return Math.max(18, jarW * 0.16);
    return Math.max(15, jarW * 0.11);
  }

  function sampleJar(cx, top, jarW, jarH, mouthY, pad) {
    const bottom = top + jarH * 0.86;
    const sideSteps = 64;
    const pts = [];
    for (let i = 0; i <= sideSteps; i++) {
      const t = i / sideSteps;
      const y = lerp(mouthY, bottom, t);
      const hw = shapeHalf(t) * jarW + pad;
      pts.push([cx - hw, y]);
    }
    for (let i = sideSteps; i >= 0; i--) {
      const t = i / sideSteps;
      const y = lerp(mouthY, bottom, t);
      const hw = shapeHalf(t) * jarW + pad;
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
    // Put the wall outside the usable interior, not across its centerline.
    const mx = (wall.ax + wall.bx) / 2 - wall.nx * thick / 2;
    const my = (wall.ay + wall.by) / 2 - wall.ny * thick / 2;
    const angle = Math.atan2(wall.by - wall.ay, wall.bx - wall.ax);
    return Bodies.rectangle(mx, my, wall.len + 3, thick, {
      isStatic: true,
      angle,
      friction: friction == null ? 0.92 : friction,
      frictionStatic: friction == null ? 1 : Math.min(1, friction + 0.15),
      restitution: 0,
      slop: 0.02,
      collisionFilter: filter,
    });
  }

  function rebuildWalls() {
    if (wallBodies.length) Composite.remove(engine.world, wallBodies);
    wallBodies = [];
    const innerF = { category: CAT_INNER, mask: CAT_GIFT };
    const groundF = { category: CAT_GROUND, mask: CAT_GIFT };
    const innerT = Math.max(8, geom.wallT * 0.95);
    for (const wall of innerWalls) {
      wallBodies.push(segmentBody(wall, innerT, innerF, 0.35));
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
    const floorY = geom.bottom + geom.wallT * 0.4;
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
    const aspect = shapeAspect();
    let jarW = Math.min(maxW, maxH / aspect, jarStyle === "wide" ? 400 : jarStyle === "original" ? 420 : 360);
    let jarH = jarW * aspect;
    if (jarH > maxH) {
      jarH = maxH;
      jarW = jarH / aspect;
    }
    const cx = w * 0.5;
    const bottom = h - margin - hudRoom;
    const top = Math.max(margin + dropRoom, bottom - jarH);
    const wallT = Math.max(8, jarW * 0.055);
    const mouthPad = jarH * 0.13;
    const mouthY = top + mouthPad;
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
    let innerArea = 0;
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i], b = inner[(i + 1) % inner.length];
      innerArea += a[0] * b[1] - b[0] * a[1];
    }
    innerArea = Math.abs(innerArea) / 2;
    const pieceR = Math.max(11, Math.min(14.5, Math.sqrt((bowlW * bowlH * 1.35) / (JAR_FILL * Math.PI))));

    const neckSpan =
      jarStyle === "original"
        ? [0.1, 0.2]
        : jarStyle === "tall"
          ? [0.02, 0.34]
          : jarStyle === "round"
            ? [0.03, 0.12]
            : jarStyle === "wide"
              ? [0.02, 0.1]
              : [0.05, 0.135];

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
      innerArea,
      jarLeft: minX,
      jarRight: maxX,
      wallT,
      neckY0: top + jarH * neckSpan[0],
      neckY1: top + jarH * neckSpan[1],
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
    const previousGeom = geom;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    layoutJar(w, h);
    pileFull = false;
    pileAreaRatio = 0;
    fullSince = 0;
    lastPileCheck = -Infinity;
    for (const body of giftBodies()) {
      const r = giftRadius(body.plugin.giftName);
      const ratio = r / (body.circleRadius || body.plugin.r);
      Body.scale(body, ratio, ratio);
      body.plugin.r = r;
      if (previousGeom) {
        const heightRatio = (geom.innerBottom - geom.mouthY) /
          Math.max(1, previousGeom.innerBottom - previousGeom.mouthY);
        Body.setPosition(body, {
          x: geom.cx + (body.position.x - previousGeom.cx) * geom.jarW / previousGeom.jarW,
          y: geom.mouthY + (body.position.y - previousGeom.mouthY) * heightRatio,
        });
      }
      Sleeping.set(body, false);
    }
  }

  function enqueueDrop(giftName, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n || !giftName) return;
    const take = Math.min(n, roomLeft());
    if (!take) return;
    spawnQ.push({ giftName: String(giftName), left: take, img: null });
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
    pileFull = false;
    pileAreaRatio = 0;
    fullSince = 0;
    lastPileCheck = -Infinity;
    spawnWait = 0;
    Composite.clear(engine.world, false, true);
    wallBodies = [];
    if (geom) rebuildWalls();
    postStatus("ready");
  }

  function spawnFromQueue(dt) {
    if (!geom || !catalogReady || !spawnQ.length) return;
    spawnWait -= dt;
    if (spawnWait > 0) return;
    const queued = queuedCount();
    let budget = queued > 400 ? 3 : queued > 120 ? 2 : 1;
    while (budget > 0 && spawnQ.length && giftBodies().length < OVERLAY_CAP) {
      const item = spawnQ[0];
      if (!item.img) item.img = loadImage(item.giftName);
      const r = giftRadius(item.giftName);
      const lipR = Math.max(5, geom.wallT * 0.62);
      const spread = Math.max(0, Math.min(geom.mouthW * 0.28, geom.mouthW / 2 - lipR - r - 4));
      const y = Math.max(r + 2, geom.mouthY - r * 3 - Math.random() * 10);
      // Do not create overlapping bodies in combo bursts: that used to eject
      // gifts sideways even into an empty jar.
      const existing = giftBodies();
      let x = geom.cx, free = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = geom.cx + (Math.random() * 2 - 1) * spread;
        free = !existing.some(b => Math.hypot(b.position.x - x, b.position.y - y) < r + b.circleRadius + 2);
        if (free) break;
      }
      if (!free) break;
      const body = Bodies.circle(x, y, r, {
        restitution: 0.04,
        friction: 0.32,
        frictionStatic: 0.45,
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
    // The same solid glass walls apply inside AND outside. Never disable them
    // just because a gift is wider than the neck or touches the side of the bowl.
    b.collisionFilter.mask = CAT_INNER | CAT_GIFT | CAT_GROUND;
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
    const lipR = Math.max(5, geom.wallT * 0.62);
    for (const b of giftBodies()) {
      if (b.plugin.spilled) continue;
      const r = b.circleRadius || 12;
      const x = b.position.x;
      const y = b.position.y;
      if (!b.plugin.overflowing && pileFull &&
          y + r >= geom.mouthY - geom.pieceR && y < geom.mouthY + r * .55) {
        b.plugin.overflowing = true;
        b.plugin.exitDir = x < geom.cx ? -1 : 1;
      }
      if (!b.plugin.overflowing) continue;
      Sleeping.set(b, false);
      const dir = b.plugin.exitDir;
      const clearY = geom.mouthY - lipR - r - 3;
      // Lift through the opening first; move sideways only ABOVE the rim.
      if (y > clearY) {
        Body.setVelocity(b, { x: b.velocity.x * .8, y: Math.min(b.velocity.y, -.8) });
        Body.applyForce(b, b.position, { x: (geom.cx - x) * b.mass * .000012, y: -b.mass * .0028 });
      } else {
        Body.setVelocity(b, { x: dir * Math.max(1.7, Math.abs(b.velocity.x)), y: 0 });
        Body.applyForce(b, b.position, { x: dir * b.mass * .00045, y: -b.mass * .00135 });
        if ((dir < 0 && x < geom.mouthL - lipR - r) ||
            (dir > 0 && x > geom.mouthR + lipR + r)) markSpill(b, dir);
      }
    }
  }

  Events.on(engine, "beforeUpdate", nudgeOverflow);

  function halfAtY(y) {
    const t = Math.max(0, Math.min(1, (y - geom.mouthY) / (geom.innerBottom - geom.mouthY)));
    return shapeHalf(t) * geom.jarW;
  }

  function containGifts() {
    if (!geom) return;
    for (const b of giftBodies()) {
      if (b.plugin.spilled) continue;
      const r = b.circleRadius;
      let { x, y } = b.position;
      if (y < geom.mouthY) continue;
      // Collision-solver safety net for large combos / slow frames. A body that
      // penetrates glass must go back inside, not become a side-wall "spill".
      // Leave ordinary contact/slop to Matter; only repair a real penetration.
      // Clamping every resting circle would break its floor contacts/sleeping.
      if (y + r * .5 > geom.innerBottom) y = geom.innerBottom - r - .5;
      const half = halfAtY(y);
      if (Math.abs(x - geom.cx) > half - r * .4) {
        const safeHalf = Math.max(0, half - r - .5);
        x = Math.max(geom.cx - safeHalf, Math.min(geom.cx + safeHalf, x));
      }
      if (Math.abs(x - b.position.x) > .05 || Math.abs(y - b.position.y) > .05) {
        const vx = x === b.position.x ? b.velocity.x : 0;
        const vy = y === b.position.y ? b.velocity.y : Math.min(0, b.velocity.y);
        Body.setPosition(b, { x, y });
        Body.setVelocity(b, { x: vx, y: vy });
        Sleeping.set(b, false);
      }
    }
  }

  function updatePileState() {
    if (!geom) return;
    const now = engine.timing.timestamp;
    if (now - lastPileCheck < 100) return;
    lastPileCheck = now;
    const gifts = giftBodies().filter(b => !b.plugin.spilled && !b.plugin.overflowing &&
      b.position.y + b.circleRadius >= geom.mouthY);
    const byId = new Map(gifts.map(b => [b.id, b]));
    const contacts = new Map(gifts.map(b => [b.id, []]));
    for (const pair of engine.pairs.list) {
      if (!pair.isActive) continue;
      const a = pair.bodyA.id, b = pair.bodyB.id;
      if (byId.has(a) && byId.has(b)) { contacts.get(a).push(b); contacts.get(b).push(a); }
    }
    // Sleeping pairs may be absent from Matter's active list. Reconnect touching
    // neighbours spatially so a settled pile still counts as supported.
    const cellSize = Math.max(8, ...gifts.map(b => b.circleRadius * 2 + 3));
    const grid = new Map();
    for (const b of gifts) {
      const gx = Math.floor(b.position.x / cellSize), gy = Math.floor(b.position.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${gx + dx},${gy + dy}`) || []) {
          if (Math.hypot(b.position.x - other.position.x, b.position.y - other.position.y) <=
              b.circleRadius + other.circleRadius + 1.5) {
            contacts.get(b.id).push(other.id); contacts.get(other.id).push(b.id);
          }
        }
      }
      const key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(b);
    }
    // Only a pile connected to the bottom counts. Incoming gifts passing the
    // mouth (even a large combo) cannot make an empty jar "full".
    const supported = new Set();
    const queue = gifts.filter(b => b.position.y + b.circleRadius >= geom.innerBottom - geom.pieceR * 2).map(b => b.id);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (supported.has(id)) continue;
      supported.add(id);
      for (const other of contacts.get(id)) if (!supported.has(other)) queue.push(other);
    }
    let area = 0, reachesMouth = false;
    for (const id of supported) {
      const b = byId.get(id), r = b.circleRadius;
      area += Math.PI * r * r;
      if (b.position.y - r <= geom.mouthY + geom.pieceR * 1.5 && b.speed < 1.2) reachesMouth = true;
    }
    pileAreaRatio = area / Math.max(1, geom.innerArea);
    const packed = pileAreaRatio >= .52 && reachesMouth;
    if (packed) {
      if (!fullSince) fullSince = now;
      if (now - fullSince >= 300) pileFull = true;
    } else {
      fullSince = 0;
      pileFull = false;
    }
  }

  Events.on(engine, "afterUpdate", () => { containGifts(); updatePileState(); });

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

  function setJarColor(raw) {
    jarColor = parseHexColor(raw, jarColor || "#e8f4ff");
  }

  function setJarStyle(raw) {
    const next = parseJarStyle(raw);
    if (next === jarStyle) return;
    jarStyle = next;
    resize();
  }

  function palette() {
    const base = jarColor;
    return {
      base,
      deep: mixHex(base, "#0a1620", 0.42),
      mid: mixHex(base, "#ffffff", 0.18),
      soft: mixHex(base, "#ffffff", 0.55),
      rim: mixHex(base, "#ffffff", 0.78),
      glow: mixHex(base, "#ffffff", 0.92),
      ink: mixHex(base, "#05080c", 0.62),
    };
  }

  function glassArtReady() {
    return !!(
      glassBody.complete &&
      glassBody.naturalWidth &&
      glassBase.complete &&
      glassBase.naturalWidth &&
      glassRim.complete &&
      glassRim.naturalWidth
    );
  }

  let tintBuf = null;
  function drawTintedImage(img, x, y, w, h) {
    if (!img || !img.naturalWidth) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const nearWhite = /^#(e|f)[0-9a-f]{5}$/i.test(jarColor);
    if (nearWhite) {
      ctx.drawImage(img, x, y, w, h);
      return;
    }
    const bw = Math.max(1, Math.round(w));
    const bh = Math.max(1, Math.round(h));
    if (!tintBuf || tintBuf.width !== bw || tintBuf.height !== bh) {
      tintBuf = document.createElement("canvas");
      tintBuf.width = bw;
      tintBuf.height = bh;
    }
    const g = tintBuf.getContext("2d");
    g.clearRect(0, 0, bw, bh);
    g.drawImage(img, 0, 0, bw, bh);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = rgba(jarColor, 0.35);
    g.fillRect(0, 0, bw, bh);
    g.globalCompositeOperation = "source-over";
    ctx.drawImage(tintBuf, x, y);
  }

  /** Warp glass-body.png bands to the active shape silhouette. */
  function drawMorphedGlassBody() {
    if (!geom || !glassBody.complete || !glassBody.naturalWidth) return;
    const { cx, artY, jarW, jarH, mouthY, innerBottom } = geom;
    const srcW = glassBody.naturalWidth;
    const srcH = glassBody.naturalHeight;
    const bands = 96;
    const span = Math.max(1, innerBottom - mouthY);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const nearWhite = /^#(e|f)[0-9a-f]{5}$/i.test(jarColor);
    let bandBuf = null;
    let bandCtx = null;
    if (!nearWhite) {
      bandBuf = document.createElement("canvas");
      bandCtx = bandBuf.getContext("2d");
    }

    for (let i = 0; i < bands; i++) {
      const t0 = i / bands;
      const t1 = (i + 1) / bands;
      const tm = (t0 + t1) * 0.5;
      const sy = t0 * srcH;
      const sh = Math.max(1, (t1 - t0) * srcH + 0.6);
      const dy = artY + t0 * jarH;
      const dh = Math.max(1, (t1 - t0) * jarH + 0.6);
      const dyMid = dy + dh * 0.5;
      const physT = Math.max(0, Math.min(1, (dyMid - mouthY) / span));

      const srcT = Math.max(0, Math.min(1, (tm - .13) / .73));
      const ratio = shapeHalf(physT) / classicHalf(srcT);
      const sx = 0, sw = srcW;
      const dw = jarW * ratio;
      const dx = cx - dw / 2;

      if (nearWhite) {
        ctx.drawImage(glassBody, sx, sy, sw, sh, dx, dy, dw, dh);
      } else {
        const bw = Math.max(1, Math.round(dw));
        const bh = Math.max(1, Math.round(dh));
        if (bandBuf.width !== bw || bandBuf.height !== bh) {
          bandBuf.width = bw;
          bandBuf.height = bh;
        }
        bandCtx.clearRect(0, 0, bw, bh);
        bandCtx.drawImage(glassBody, sx, sy, sw, sh, 0, 0, bw, bh);
        bandCtx.globalCompositeOperation = "source-atop";
        bandCtx.fillStyle = rgba(jarColor, 0.35);
        bandCtx.fillRect(0, 0, bw, bh);
        bandCtx.globalCompositeOperation = "source-over";
        ctx.drawImage(bandBuf, dx, dy);
      }
    }
    ctx.restore();
  }

  function drawShapedGlassBack() {
    if (!geom || !glassArtReady()) return;
    const { cx, artY, jarW, jarH, mouthY } = geom;
    const scaleRef = jarW / 500;
    const mouthScale = shapeHalf(0) / classicHalf(0);
    const baseScale = shapeHalf(.934) / classicHalf(.934);

    const rimW = 256 * scaleRef * mouthScale;
    const rimH = 34 * jarH / 500;
    const rimX = cx - rimW / 2;
    const rimY = mouthY - rimH * 0.55;
    drawTintedImage(glassRim, rimX, rimY, rimW, rimH);

    const baseW = 233 * scaleRef * baseScale;
    const baseH = 62 * jarH / 500;
    const baseX = cx - baseW / 2;
    const baseY = artY + jarH * .75;
    drawTintedImage(glassBase, baseX, baseY, baseW, baseH);
  }

  /** Style 5 — Coin Jar glass exact (unwarped) */
  function drawGlassJarBack() {
    if (!geom || !glassArtReady()) return;
    const { artX, artY, jarW, jarH } = geom;
    const s = jarW / 500;
    const rimW = 256 * s;
    const rimH = 34 * s;
    const rimX = artX + (jarW - rimW) / 2;
    const rimY = artY + 45 * s;
    drawTintedImage(glassRim, rimX, rimY, rimW, rimH);
    const baseW = 233 * s;
    const baseH = 62 * s;
    const baseX = artX + (jarW - baseW) / 2;
    const baseY = artY + jarH - 63 * s - baseH;
    drawTintedImage(glassBase, baseX, baseY, baseW, baseH);
  }

  function drawGlassJarFront() {
    if (!geom || !glassArtReady()) return;
    const { artX, artY, jarW, jarH } = geom;
    drawTintedImage(glassBody, artX, artY, jarW, jarH);
  }

  function drawVectorGlassFallback() {
    if (!geom || !outerPoly.length || !jarPoly.length) return;
    const p = palette();
    const { cx, jarW, top, innerBottom, wallT } = geom;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(outerPoly[0][0], outerPoly[0][1]);
    for (let i = 1; i < outerPoly.length; i++) ctx.lineTo(outerPoly[i][0], outerPoly[i][1]);
    ctx.closePath();
    ctx.moveTo(jarPoly[0][0], jarPoly[0][1]);
    for (let i = 1; i < jarPoly.length; i++) ctx.lineTo(jarPoly[i][0], jarPoly[i][1]);
    ctx.closePath();
    const glass = ctx.createLinearGradient(cx - jarW * 0.55, top, cx + jarW * 0.55, top);
    glass.addColorStop(0, rgba(p.deep, 0.45));
    glass.addColorStop(0.5, rgba(p.soft, 0.16));
    glass.addColorStop(1, rgba(p.deep, 0.42));
    ctx.fillStyle = glass;
    ctx.fill("evenodd");

    strokePoly(outerOpen, false);
    ctx.strokeStyle = rgba(p.deep, 0.9);
    ctx.lineWidth = Math.max(5, wallT * 0.65);
    ctx.stroke();
    ctx.strokeStyle = rgba(p.rim, 0.98);
    ctx.lineWidth = Math.max(2.2, wallT * 0.28);
    ctx.stroke();
    strokePoly(innerOpen, false);
    ctx.strokeStyle = rgba(p.glow, 0.65);
    ctx.lineWidth = Math.max(1.3, wallT * 0.16);
    ctx.stroke();

    ctx.strokeStyle = rgba("#ffffff", 0.88);
    ctx.lineWidth = Math.max(2.4, jarW * 0.025);
    ctx.beginPath();
    ctx.moveTo(cx - jarW * 0.32, top + (innerBottom - top) * 0.2);
    ctx.quadraticCurveTo(
      cx - jarW * 0.38,
      top + (innerBottom - top) * 0.48,
      cx - jarW * 0.3,
      top + (innerBottom - top) * 0.72
    );
    ctx.stroke();
    ctx.restore();
  }

  function drawJarBack() {
    if (!geom || !outerPoly.length || !jarPoly.length) return;
    if (jarStyle === "original") {
      drawGlassJarBack();
      return;
    }
    if (glassArtReady()) {
      drawShapedGlassBack();
      return;
    }
    drawVectorGlassFallback();
  }

  function drawJarFront() {
    if (!geom || !outerPoly.length || !jarPoly.length) return;
    if (jarStyle === "original") {
      drawGlassJarFront();
      return;
    }
    if (glassArtReady()) {
      drawMorphedGlassBody();
      return;
    }
    const p = palette();
    const { wallT } = geom;
    ctx.save();
    strokePoly(outerOpen, false);
    ctx.strokeStyle = rgba(p.rim, 0.95);
    ctx.lineWidth = Math.max(2.2, wallT * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function snapChroma() {
    if (!chroma) return;
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
    if (chroma) {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(0, 0, geom.w, geom.h);
    } else {
      ctx.clearRect(0, 0, geom.w, geom.h);
    }
    drawJarBack();
    const gifts = giftBodies();
    ctx.save();
    if (jarPoly.length) {
      strokePoly(jarPoly, true);
      // The open mouth and the jar interior are one visible region: no slicing
      // a gift in half as it enters or rises over the lip.
      ctx.rect(0, 0, geom.w, geom.mouthY);
      ctx.clip();
    }
    for (const b of gifts) {
      if (b.plugin && b.plugin.spilled) continue;
      drawOne(b);
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
      return;
    }
    if (data.type === "jar-style") {
      if (data.color) setJarColor(data.color);
      if (data.style) setJarStyle(data.style);
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
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (!window.chrome?.webview) return;
    try { window.chrome.webview.postMessage("drag"); } catch { /* ignore */ }
  });

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
      floorY: geom && geom.innerBottom,
      full: pileFull,
      pileAreaRatio,
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
  setInterval(pollLiveGifts, 1200);
})();
