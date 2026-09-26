(() => {
  const params = new URLSearchParams(location.search);

  const CHANNEL = "tgr-jar-overlay";
  const STORAGE_KEY = "tgr_jar_overlay_cmd";
  const STATUS_KEY = "tgr_jar_overlay_status";
  const EVENTS_KEY = "tgr_jar_overlay_events_v1";
  const BOAT_POS_KEY = "tgr_jar_boat_position_v1";
  const SULTAN_POS_KEY = "tgr_jar_sultan_position_v1";
  const ICONS = "/gifts/jar/icons/";
  const ICON_REVISION = "gift-identity14";
  const UNKNOWN = ICONS + "_unknown.svg?v=" + ICON_REVISION;
  const JAR_FILL = 500;
  const OVERLAY_CAP = 5000;
  const BOAT_WATER_CAPACITY = 1000;
  // Per-gift coin value controls one of eleven gradually increasing sizes.
  const MAX_GIFT_SCALE = 2.12;

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
  let glassJarScale = Math.max(0.5, Math.min(1.5, (Number(params.get("jarScale")) || 100) / 100));
  const JAR_STYLE_IDS = ["classic", "round", "tall", "wide", "original", "duck-pirate", "duck-cruise", "monkey-pirate"];
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
  const widgetMode = params.get("widget") === "pirate" ? "pirate" : params.get("widget") === "glass" ? "glass" : "";
  document.documentElement.classList.toggle("pirate-widget", widgetMode === "pirate");
  let jarStyle = widgetMode === "pirate"
    ? (["duck-pirate", "duck-cruise", "monkey-pirate"].includes(parseJarStyle(params.get("style"))) ? parseJarStyle(params.get("style")) : "duck-pirate")
    : widgetMode === "glass"
      ? (["classic", "original"].includes(parseJarStyle(params.get("style") || params.get("jarStyle"))) ? parseJarStyle(params.get("style") || params.get("jarStyle")) : "classic")
      : parseJarStyle(params.get("style") || params.get("jarStyle"));
  const isDuckBoat = () => jarStyle === "duck-pirate" || jarStyle === "duck-cruise" || jarStyle === "monkey-pirate";
  // Ships default to green-screen; glass jars keep their transparent background.
  const chroma = params.has("chroma") ? params.get("chroma") === "1" : isDuckBoat();
  document.documentElement.classList.toggle("chroma", chroma);
  document.body.classList.toggle("chroma", chroma);
  const GLASS_BODY_URL = "/gifts/jar/art/glass-body.png?v=jar59";
  const GLASS_BASE_URL = "/gifts/jar/art/glass-base.png?v=jar59";
  const GLASS_RIM_URL = "/gifts/jar/art/glass-rim.png?v=jar59";
  const glassBody = new Image();
  const glassBase = new Image();
  const glassRim = new Image();
  const duckPirateArt = new Image();
  const duckCruiseArt = new Image();
  const monkeyPirateArt = new Image();
  const bambooRaftArt = new Image();
  const woodenLongboatArt = new Image();
  const monkeyRepairCrewArt = new Image();
  glassBody.decoding = "async";
  glassBase.decoding = "async";
  glassRim.decoding = "async";
  glassBody.src = GLASS_BODY_URL;
  glassBase.src = GLASS_BASE_URL;
  glassRim.src = GLASS_RIM_URL;
  duckPirateArt.decoding = "async";
  duckCruiseArt.decoding = "async";
  monkeyPirateArt.decoding = "async";
  bambooRaftArt.decoding = "async";
  woodenLongboatArt.decoding = "async";
  monkeyRepairCrewArt.decoding = "async";
  duckPirateArt.src = "/gifts/jar/art/duck-pirate-3d.png?v=duckboat2";
  duckCruiseArt.src = "/gifts/jar/art/duck-cruise-3d.png?v=duckboat2";
  monkeyPirateArt.src = "/gifts/jar/art/monkey-pirate-3d.png?v=duckboat3";
  bambooRaftArt.src = "/gifts/jar/art/bamboo-raft-3d.png?v=boatart2";
  woodenLongboatArt.src = "/gifts/jar/art/wooden-longboat-3d.png?v=boatart1";
  monkeyRepairCrewArt.src = "/gifts/jar/art/monkey-repair-crew-3d.png?v=repairfx4";
  function onGlassArtLoad() {
    resize();
  }
  glassBody.onload = onGlassArtLoad;
  glassBase.onload = onGlassArtLoad;
  glassRim.onload = onGlassArtLoad;
  duckPirateArt.onload = onGlassArtLoad;
  duckCruiseArt.onload = onGlassArtLoad;
  monkeyPirateArt.onload = onGlassArtLoad;
  bambooRaftArt.onload = onGlassArtLoad;
  woodenLongboatArt.onload = onGlassArtLoad;
  monkeyRepairCrewArt.onload = onGlassArtLoad;

  const { Engine, World, Bodies, Body, Composite, Runner, Sleeping, Events } = Matter;
  const CAT_INNER = 0x0001;
  const CAT_OUTER = 0x0002;
  const CAT_GIFT = 0x0004;
  const CAT_GROUND = 0x0008;
  const CAT_OVERFLOW = 0x0010;

  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d", { alpha: !chroma });
  const hudCount = document.getElementById("hudCount");
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  let showSultanBalloons = params.get("sultan") !== "0";
  let boatScale = Math.max(0.1, Math.min(1.8, (Number(params.get("boatScale")) || 20) / 100));
  let seaLevel = Math.max(0.15, Math.min(0.5, (Number(params.get("seaLevel")) || 25) / 100));
  let sultanScale = Math.max(0.3, Math.min(1.8, (Number(params.get("sultanScale")) || 100) / 100));
  let sultanRows = [];
  const sultanAvatarCache = new Map();
  const galleryMode = params.get("gallery") === "1";
  const gallerySultans = [
    { nick: "สุลต่านหนึ่ง", coins: 12500 },
    { nick: "ดาวเด่น", coins: 8200 },
    { nick: "สายเปย์", coins: 6100 },
    { nick: "แฟนคลับ", coins: 3900 },
    { nick: "ผู้สนับสนุน", coins: 2400 },
  ];
  if (galleryMode && showSultanBalloons) sultanRows = gallerySultans;

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
  let totalLiveCoins = 0;
  let pirateNetFx = null;
  let pirateNetCooldownUntil = 0;
  let pirateAutoBoatX = 0;
  let pirateDeliveryMove = null;
  let displayedBoatLevel = 1;
  let boatUpgradeFx = null;
  let pirateCannon = null;
  let repairAudioCtx = null;

  function playRepairSound(kind = "hammer") {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!repairAudioCtx) repairAudioCtx = new AudioCtx();
      if (repairAudioCtx.state === "suspended") repairAudioCtx.resume().catch(() => {});
      const ac = repairAudioCtx;
      const now = ac.currentTime;
      const gain = ac.createGain();
      gain.connect(ac.destination);
      if (kind === "hammer") {
        const osc = ac.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(190, now);
        osc.frequency.exponentialRampToValueAtTime(72, now + .095);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(.12, now + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .13);
        osc.connect(gain); osc.start(now); osc.stop(now + .14);
      } else if (kind === "saw") {
        const osc = ac.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(145, now);
        osc.frequency.linearRampToValueAtTime(230, now + .18);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.linearRampToValueAtTime(.035, now + .025);
        gain.gain.linearRampToValueAtTime(.0001, now + .22);
        osc.connect(gain); osc.start(now); osc.stop(now + .23);
      } else {
        const osc = ac.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(650, now);
        osc.frequency.exponentialRampToValueAtTime(1550, now + .24);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(.08, now + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .34);
        osc.connect(gain); osc.start(now); osc.stop(now + .35);
      }
    } catch (_) {}
  }
  let boatPosition = { x: 0, y: 0 };
  let sultanPositions = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: 0 },
    3: { x: 0, y: 0 },
  };
  let sultanHitBounds = [];
  try {
    const savedBoatPosition = JSON.parse(localStorage.getItem(BOAT_POS_KEY) || "null");
    if (savedBoatPosition && Number.isFinite(savedBoatPosition.x) && Number.isFinite(savedBoatPosition.y)) {
      boatPosition = {
        x: Math.max(-0.42, Math.min(0.42, savedBoatPosition.x)),
        y: Math.max(-0.38, Math.min(0.38, savedBoatPosition.y)),
      };
    }
  } catch {
    /* use centered default */
  }
  try {
    const savedSultanPosition = JSON.parse(localStorage.getItem(SULTAN_POS_KEY) || "null");
    if (savedSultanPosition) {
      const legacy = Number.isFinite(savedSultanPosition.x) && Number.isFinite(savedSultanPosition.y)
        ? savedSultanPosition : null;
      for (const rank of [1, 2, 3]) {
        const saved = savedSultanPosition[rank] || legacy;
        if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) continue;
        sultanPositions[rank] = {
          x: Math.max(-1.2, Math.min(1.2, saved.x)),
          y: Math.max(-0.44, Math.min(0.44, saved.y)),
        };
      }
    }
  } catch {
    /* use centered default */
  }

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
    let n = pirateCannon?.reserved || 0;
    for (const item of spawnQ) n += item.left;
    return n;
  }

  function roomLeft() {
    return Math.max(0, OVERLAY_CAP - giftBodies().length - queuedCount());
  }

  function normKey(name) {
    return String(name || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
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

  function giftSizeScale(giftName, suppliedCoins = 0) {
    const coins = Math.max(1, Number(suppliedCoins) || catalogByKey.get(normKey(giftName))?.coins || 1);
    // Eleven price tiers shared by the jar and boat overlays. Level one keeps
    // the current smallest size; every following level grows only slightly.
    if (coins >= 10001) return 2.12;
    if (coins >= 4501) return 1.86;
    if (coins >= 2001) return 1.62;
    if (coins >= 1001) return 1.40;
    if (coins >= 501) return 1.20;
    if (coins >= 300) return 1.02;
    if (coins >= 200) return 0.86;
    if (coins >= 101) return 0.72;
    if (coins >= 31) return 0.60;
    if (coins >= 10) return 0.48;
    return 0.36;
  }

  function giftCoins(giftName, suppliedCoins = 0) {
    return Math.max(1, Number(suppliedCoins) || catalogByKey.get(normKey(giftName))?.coins || 1);
  }

  function giftRadius(giftName, suppliedCoins = 0) {
    const lipR = Math.max(5, geom.wallT * 0.62);
    const maxR = Math.max(4, (geom.mouthW / 2 - lipR - 4) * 0.82);
    // Scale the whole range down for narrow jars so even the largest gift fits.
    const baseR = Math.min(geom.pieceR, maxR / MAX_GIFT_SCALE);
    return baseR * giftSizeScale(giftName, suppliedCoins);
  }

  function safeGiftPicture(picture) {
    const value = String(picture || "").trim();
    // Accept only image locations, never executable/data/file URLs.
    if (/^https?:\/\//i.test(value) || /^\/gifts\/jar\/icons\/[a-z0-9_.%-]+(?:\?[^#]*)?$/i.test(value)) return value;
    return "";
  }

  function iconUrl(giftName, picture = "") {
    const rec = catalogByKey.get(normKey(giftName));
    // A known gift keeps its own artwork even if an upstream cached picture
    // belongs to the preceding gift. Unknown names use their own event image.
    return rec?.file
      ? ICONS + encodeURIComponent(rec.file) + "?v=" + ICON_REVISION
      : safeGiftPicture(picture) || UNKNOWN;
  }

  function loadImage(giftName, picture = "") {
    const url = iconUrl(giftName, picture);
    const key = normKey(giftName) + "|" + url;
    const cached = imgCache.get(key);
    if (cached) return cached;
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => {
      img.onerror = null;
      if (url !== UNKNOWN) img.src = UNKNOWN;
    };
    img.src = url;
    imgCache.set(key, img);
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
    const groundF = { category: CAT_GROUND, mask: CAT_GIFT | CAT_OVERFLOW };
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
    // Gifts after the first 1,000 land on the water surface and form their own
    // physical pile above it. This keeps the underwater capacity predictable
    // while preserving gravity, collisions, and natural random settling.
    if (isDuckBoat()) {
      wallBodies.push(Bodies.rectangle(
        geom.cx,
        geom.waterTop + 8,
        geom.jarW,
        16,
        {
          isStatic: true,
          friction: 0.72,
          frictionStatic: 0.86,
          restitution: 0.02,
          collisionFilter: { category: CAT_OVERFLOW, mask: CAT_OVERFLOW },
        }
      ));
    }
    Composite.add(engine.world, wallBodies);
  }

  function layoutJar(w, h) {
    if (isDuckBoat()) {
      layoutDuckBoat(w, h);
      return;
    }
    const margin = 10;
    const dropRoom = Math.max(36, h * 0.07);
    const hudRoom = 56;
    const sideRoom = Math.max(88, Math.min(140, w * 0.2));
    const maxW = Math.max(160, w - margin * 2 - sideRoom * 2);
    const maxH = Math.max(200, h - margin * 2 - dropRoom - hudRoom);
    const aspect = shapeAspect();
    const sizeScale = widgetMode === "glass" ? glassJarScale : 1;
    let jarW = Math.min(maxW, maxH / aspect, (jarStyle === "wide" ? 400 : jarStyle === "original" ? 420 : 360) * sizeScale);
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

  function layoutDuckBoat(w, h) {
    const margin = Math.max(8, Math.min(w, h) * .018);
    const waterTop = h * (1 - seaLevel);
    const waterBottom = h * .98;
    const left = Math.max(margin, w * .08);
    const right = Math.min(w - margin, w * .92);
    const floor = waterBottom;
    const inner = [[left, waterTop], [left, floor], [right, floor], [right, waterTop]];
    const waterW = right - left;
    const pieceR = Math.max(12, Math.min(24, waterW / 28));
    geom = {
      w, h, cx: w * .5, top: h * .08, bottom: floor,
      jarW: waterW, jarH: waterBottom - waterTop,
      artX: left, artY: waterTop, mouthY: waterTop,
      mouthL: left, mouthR: right, mouthW: waterW,
      pieceR, innerBottom: floor, innerArea: waterW * (floor - waterTop),
      jarLeft: left, jarRight: right, wallT: Math.max(8, pieceR * .7),
      stageL: margin, stageR: w - margin, stageT: margin, stageB: h - margin,
      waterTop, waterBottom, boatY: waterTop - h * .035,
    };
    innerWalls.length = 0;
    addWall(innerWalls, left, waterTop, left, floor, true);
    addWall(innerWalls, left, floor, right, floor, true);
    addWall(innerWalls, right, floor, right, waterTop, true);
    innerOpen = inner;
    jarPoly = [[left, waterTop], [left, floor], [right, floor], [right, waterTop], [left, waterTop]];
    outerWalls.length = 0;
    outerOpen = [];
    outerPoly = [];
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
      const r = giftRadius(body.plugin.giftName, body.plugin.coins) * (body.plugin.sizeJitter || 1);
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

  function enqueueDrop(giftName, count, suppliedCoins = 0, countCoins = true, picture = "", sender = null) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (!n || !giftName) return;
    const take = Math.min(n, roomLeft());
    if (!take) return;
    const coins = giftCoins(giftName, suppliedCoins);
    if (countCoins) totalLiveCoins += coins * take;
    spawnQ.push({
      giftName: String(giftName),
      picture: safeGiftPicture(picture),
      sender,
      cannonEligible: !!sender,
      coins,
      left: take,
      img: null,
    });
  }

  function boatWaterIsFull() {
    if (!geom || !isDuckBoat()) return false;
    const submerged = giftBodies().filter((b) => !b.plugin?.premium && !b.plugin?.waterOverflow);
    if (submerged.length < BOAT_WATER_CAPACITY) return false;
    const giftArea = submerged.reduce((sum, b) => {
      const r = b.circleRadius || b.plugin?.r || 0;
      return sum + Math.PI * r * r;
    }, 0);
    // Randomly packed circles occupy about 70–80% of a container. Area alone
    // is insufficient because a mound can leave an empty strip at the water
    // line. Require a settled pile to reach most sections of the surface too.
    if (giftArea < geom.innerArea * 0.72) return false;
    const bins = 20;
    const reached = new Set();
    const surfaceBand = Math.max(18, geom.pieceR * 1.8);
    for (const b of submerged) {
      const r = b.circleRadius || b.plugin?.r || 0;
      if (b.position.y < geom.waterTop || b.position.y - r > geom.waterTop + surfaceBand) continue;
      if (Math.abs(b.velocity.x) + Math.abs(b.velocity.y) > 1.2) continue;
      const first = Math.max(0, Math.floor((b.position.x - r - geom.jarLeft) / geom.jarW * bins));
      const last = Math.min(bins - 1, Math.floor((b.position.x + r - geom.jarLeft) / geom.jarW * bins));
      for (let i = first; i <= last; i++) reached.add(i);
    }
    return reached.size >= Math.ceil(bins * 0.8);
  }

  const recentDrops = [];
  const seenDropIds = new Set();
  const seenSourceIds = new Set();
  const seenJournalIds = new Set();
  let lastDirectDropAt = 0;
  function acceptDrop(giftName, count, eventId = "", sourceEventId = "", suppliedCoins = 0, picture = "", sender = null) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const name = String(giftName || "").trim();
    if (!name || !n) return;
    const stableId = String(eventId || "").trim();
    const sourceId = String(sourceEventId || "").trim();
    if (stableId) {
      if (seenDropIds.has(stableId)) return;
      seenDropIds.add(stableId);
      if (seenDropIds.size > 1200) {
        const keep = [...seenDropIds].slice(-400);
        seenDropIds.clear();
        for (const id of keep) seenDropIds.add(id);
      }
    }
    if (sourceId) {
      if (seenSourceIds.has(sourceId)) return;
      seenSourceIds.add(sourceId);
      if (seenSourceIds.size > 1200) {
        const keep = [...seenSourceIds].slice(-400);
        seenSourceIds.clear();
        for (const id of keep) seenSourceIds.add(id);
      }
    }
    const t = Date.now();
    const key = name + "|" + n;
    if (!stableId && recentDrops.some((d) => d.key === key && t - d.t < 120)) return;
    recentDrops.push({ key, t });
    if (recentDrops.length > 48) recentDrops.shift();
    enqueueDrop(name, n, suppliedCoins, true, picture, sender || { name: "ผู้ส่งของขวัญ", avatar: "" });
  }

  function cannonGift(item) {
    return !!pirateCannon && isDuckBoat() && item.cannonEligible && item.coins >= 1000;
  }

  function pendingCannonGift() {
    return spawnQ.some(cannonGift);
  }

  function updatePirateCannon(nowMs) {
    if (!pirateCannon || !catalogReady || !geom) return;
    pirateCannon.update(nowMs);
    if (!isDuckBoat() || pirateCannon.busy || pirateNetFx || pirateDeliveryMove || boatUpgradeFx) return;
    const index = spawnQ.findIndex(cannonGift);
    if (index < 0) return;
    if (pirateCannon.play(spawnQ[index], nowMs)) spawnQ.splice(index, 1);
  }

  function giftSender(data) {
    return {
      name: String(data.nick || data.nickname || (typeof data.sender === "string" ? data.sender : "") || data.user || data.userName || "ผู้ส่งของขวัญ"),
      avatar: String(data.avatar || data.avatarUrl || ""),
    };
  }

  function resetJar() {
    pirateCannon?.reset();
    spawnQ.length = 0;
    pileFull = false;
    pileAreaRatio = 0;
    fullSince = 0;
    lastPileCheck = -Infinity;
    spawnWait = 0;
    totalLiveCoins = 0;
    displayedBoatLevel = 1;
    boatUpgradeFx = null;
    pirateNetFx = null;
    pirateNetCooldownUntil = 0;
    pirateAutoBoatX = 0;
    pirateDeliveryMove = null;
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
    let budget = isDuckBoat()
      ? 5
      : (queued > 400 ? 3 : queued > 120 ? 2 : 1);
    while (budget > 0 && spawnQ.length && giftBodies().length < OVERLAY_CAP) {
      // Premium gifts use a separate priority lane. A large/blocked water
      // queue must never delay gifts that should float above the boat.
      let itemIndex = spawnQ.findIndex(q => !cannonGift(q));
      if (itemIndex < 0) break;
      if (isDuckBoat()) {
        const premiumIndex = spawnQ.findIndex((q) => !cannonGift(q) && giftCoins(q.giftName, q.coins) > 100);
        if (premiumIndex >= 0) itemIndex = premiumIndex;
      }
      const item = spawnQ[itemIndex];
      if (!item.img) item.img = loadImage(item.giftName, item.picture);
      // A little size variation prevents equal circles from settling into a
      // mechanical honeycomb while keeping every low-tier sticker small.
      const baseGiftR = giftRadius(item.giftName, item.coins);
      // Keep all eleven price tiers deterministic across Glass Jar, Dragon,
      // and Pirate Ship. Equal coin values must always render at one tier size.
      const sizeJitter = 1;
      const r = baseGiftR * sizeJitter;
      const premium = isDuckBoat() && giftCoins(item.giftName, item.coins) > 100;
      if (isDuckBoat() && !premium && !item.fromBoat && !ensurePirateReleasePosition(performance.now())) return;
      const lipR = Math.max(5, geom.wallT * 0.62);
      const spread = Math.max(0, Math.min(geom.mouthW * 0.28, geom.mouthW / 2 - lipR - r - 4));
      const waterOverflow = isDuckBoat() && !premium && boatWaterIsFull();
      let y = premium
        ? Math.max(r + 4, geom.top + r + Math.random() * Math.max(8, geom.h * .12))
        : Math.max(r + 2, isDuckBoat()
          ? geom.waterTop - r - Math.random() * Math.max(12, geom.h * .04)
          : geom.mouthY - r * 3 - Math.random() * 10);
      // Do not create overlapping bodies in combo bursts: that used to eject
      // gifts sideways even into an empty jar.
      const existing = giftBodies();
      let x = geom.cx, free = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = isDuckBoat()
          ? geom.jarLeft + r + Math.random() * Math.max(1, geom.jarRight - geom.jarLeft - r * 2)
          : geom.cx + (Math.random() * 2 - 1) * spread;
        free = !existing.some(b => Math.hypot(b.position.x - x, b.position.y - y) < r + b.circleRadius + 2);
        if (free) break;
      }
      if (isDuckBoat()) {
        const bounds = duckBoatBounds();
        const deckSpread = bounds ? Math.min(bounds.w * .18, Math.max(3, geom.jarW * .035)) : 3;
        x = (bounds ? bounds.cx : geom.cx) + (Math.random() * 2 - 1) * deckSpread;
        y = bounds ? bounds.boatY - Math.max(r * 1.35, bounds.h * .22) : geom.waterTop - r * 2;
        free = true;
      }
      if (item.fromCannon && isDuckBoat()) {
        x = geom.w * item.fromCannon.x;
        y = geom.h * item.fromCannon.y;
        free = true;
      }
      if (!free && !premium && !isDuckBoat()) break;
      const body = Bodies.circle(x, y, r, {
        restitution: 0.04,
        friction: 0.32,
        frictionStatic: 0.45,
        frictionAir: 0.012,
        density: 0.0018,
        slop: 0.04,
        sleepThreshold: 18,
        angle: (Math.random() - 0.5) * 0.4,
        collisionFilter: premium
          ? { category: CAT_GIFT, mask: 0 }
          : waterOverflow
            ? { category: CAT_OVERFLOW, mask: CAT_OVERFLOW | CAT_GROUND }
            : { category: CAT_GIFT, mask: CAT_INNER | CAT_GIFT | CAT_GROUND },
      });
      Body.setVelocity(body, isDuckBoat() && !premium
        ? { x: (Math.random() * 2 - 1) * 1.5, y: 2.1 }
        : { x: (Math.random() * 2 - 1) * 0.6, y: premium ? 0 : 1.2 });
      const launchAt = performance.now();
      body.plugin = {
        kind: "gift", img: item.img, giftName: item.giftName, r, spilled: false,
        giftPicture: item.picture,
        premium, waterOverflow, sizeJitter, coins: item.coins,
        tetherSlot: premium ? giftBodies().filter((b) => b.plugin?.premium).length : -1,
        bobSeed: Math.random() * Math.PI * 2,
        launchAt: premium ? launchAt : 0,
        launchDuration: premium ? (item.fromCannon?.duration || 1700) : 0,
        cannonReturn: !!item.fromCannon,
        launchStartX: x,
        launchStartY: y,
      };
      Composite.add(engine.world, body);
      if (isDuckBoat() && !premium && pirateDeliveryMove?.phase === "hold") {
        // Keep the boat at the selected free zone while the whole burst is
        // released. Each new deck drop extends the short settle window; the
        // boat returns only after the burst has stopped, not after every gift.
        pirateDeliveryMove.returnAt = performance.now() + 320;
      }
      item.left -= 1;
      budget -= 1;
      if (item.left <= 0) spawnQ.splice(itemIndex, 1);
    }
    // Five deck drops every quarter second gives a stable 20 gifts/second:
    // a 100-piece combo clears in about five seconds without one huge physics spike.
    spawnWait = isDuckBoat()
      ? 0.25
      : (queued <= 16 ? 0.08 : queued <= 80 ? 0.04 : 0.02);
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

  function currentDuckArt() {
    return jarStyle === "duck-cruise"
      ? duckCruiseArt
      : jarStyle === "monkey-pirate"
        ? monkeyPirateArt
        : duckPirateArt;
  }

  function currentBoatArt() {
    const level = boatLevel();
    if (level === 1) return bambooRaftArt;
    if (level === 2) return woodenLongboatArt;
    return currentDuckArt();
  }

  function targetBoatLevel() {
    if (totalLiveCoins >= 5000) return 3;
    if (totalLiveCoins >= 1000) return 2;
    return 1;
  }

  function boatLevel() {
    return displayedBoatLevel;
  }

  function updateBoatUpgradeFx(nowMs) {
    // Complete a repair already in progress; otherwise the new salute goes first.
    if (!boatUpgradeFx && (pirateCannon?.busy || pendingCannonGift())) return;
    const target = targetBoatLevel();
    if (target < displayedBoatLevel) {
      displayedBoatLevel = target;
      boatUpgradeFx = null;
      return;
    }
    if (!boatUpgradeFx && target > displayedBoatLevel) {
      boatUpgradeFx = {
        from: displayedBoatLevel,
        to: displayedBoatLevel + 1,
        startedAt: nowMs,
        swapped: false,
        nextSoundAt: nowMs + 350,
        soundStep: 0,
        seeds: Array.from({ length: 132 }, (_, i) => ({
          a: halton(i + 1, 2) * Math.PI * 2,
          d: .18 + halton(i + 1, 3) * .82,
          s: .65 + halton(i + 1, 5) * 1.35,
          r: .45 + halton(i + 1, 7) * 1.15,
        })),
      };
    }
    if (!boatUpgradeFx) return;
    const elapsed = (nowMs - boatUpgradeFx.startedAt) / 1000;
    if (nowMs >= boatUpgradeFx.nextSoundAt && elapsed < 8.8) {
      playRepairSound(boatUpgradeFx.soundStep % 3 === 1 ? "saw" : "hammer");
      boatUpgradeFx.soundStep++;
      boatUpgradeFx.nextSoundAt = nowMs + (boatUpgradeFx.soundStep % 3 === 1 ? 430 : 610);
    }
    if (!boatUpgradeFx.swapped && elapsed >= 5) {
      displayedBoatLevel = boatUpgradeFx.to;
      boatUpgradeFx.swapped = true;
      playRepairSound("spark");
    }
    if (elapsed >= 10) boatUpgradeFx = null;
  }

  function duckBoatBounds() {
    if (!geom) return null;
    const art = currentBoatArt();
    const maxW = geom.jarW * .96 * boatScale;
    const maxH = geom.h * .72 * boatScale;
    const ratio = art.naturalWidth && art.naturalHeight ? art.naturalWidth / art.naturalHeight : 1.55;
    let aw = maxW;
    let ah = aw / ratio;
    if (ah > maxH) { ah = maxH; aw = ah * ratio; }
    const cx = geom.cx + (boatPosition.x + pirateAutoBoatX) * geom.w;
    const boatY = geom.boatY + boatPosition.y * geom.h;
    const ax = cx - aw / 2;
    const ay = boatY - ah * .76;
    return { art, x: ax, y: ay, w: aw, h: ah, cx, boatY };
  }

  function netEase(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  function seaReleaseTarget() {
    if (!geom || !isDuckBoat()) return null;
    const bins = 9;
    const scores = Array(bins).fill(0);
    const bodies = giftBodies().filter((b) => !b.plugin?.premium && !b.plugin?.netCaptured);
    for (const body of bodies) {
      const index = Math.max(0, Math.min(bins - 1, Math.floor((body.position.x - geom.jarLeft) / Math.max(1, geom.jarW) * bins)));
      const r = body.circleRadius || body.plugin?.r || geom.pieceR;
      scores[index] += Math.max(.5, (r / Math.max(1, geom.pieceR)) ** 2);
    }
    const bounds = duckBoatBounds();
    if (!bounds) return null;
    const current = Math.max(0, Math.min(bins - 1, Math.floor((bounds.cx - geom.jarLeft) / Math.max(1, geom.jarW) * bins)));
    if (scores[current] < 8) return null;
    let best = 0;
    for (let i = 1; i < bins; i++) {
      if (scores[i] < scores[best] - .01 || (Math.abs(scores[i] - scores[best]) < .01 && Math.abs(i - current) < Math.abs(best - current))) best = i;
    }
    if (best === current || scores[best] >= scores[current] - 2) return null;
    return geom.jarLeft + (best + .5) / bins * geom.jarW;
  }

  function ensurePirateReleasePosition(nowMs) {
    if (!isDuckBoat() || pirateNetFx) return !pirateNetFx;
    if (pirateCannon?.busy) return true;
    if (pirateDeliveryMove) return pirateDeliveryMove.phase === "hold";
    const targetX = seaReleaseTarget();
    if (!Number.isFinite(targetX)) return true;
    const targetOffset = Math.max(-.3, Math.min(.3, (targetX - geom.cx) / geom.w - boatPosition.x));
    if (Math.abs(targetOffset - pirateAutoBoatX) < .025) return true;
    pirateDeliveryMove = {
      phase: "out",
      startedAt: nowMs,
      duration: 850,
      fromOffset: pirateAutoBoatX,
      targetOffset,
      direction: Math.sign(targetOffset - pirateAutoBoatX || 1),
    };
    return false;
  }

  function updatePirateDelivery(nowMs) {
    const move = pirateDeliveryMove;
    if (!move || pirateNetFx) return;
    if (nowMs < move.startedAt) return;
    const q = netEase(Math.max(0, Math.min(1, (nowMs - move.startedAt) / move.duration)));
    if (move.phase === "out") {
      pirateAutoBoatX = move.fromOffset + (move.targetOffset - move.fromOffset) * q;
      if (q >= 1) {
        move.phase = "hold";
        move.returnAt = nowMs + 320;
      }
      return;
    }
    if (move.phase === "hold") {
      if (nowMs < (move.returnAt || 0)) return;
      move.phase = "return";
      move.startedAt = nowMs;
      move.fromOffset = pirateAutoBoatX;
      return;
    }
    if (move.phase === "return") {
      pirateAutoBoatX = move.fromOffset * (1 - q);
      if (q >= 1) {
        pirateAutoBoatX = 0;
        pirateDeliveryMove = null;
      }
    }
  }

  function drawPirateDeliveryWake() {
    const move = pirateDeliveryMove;
    if (!move || move.phase === "hold" || !geom) return;
    const bounds = duckBoatBounds();
    if (!bounds) return;
    const dir = move.phase === "out" ? move.direction : -move.direction;
    ctx.save();
    ctx.strokeStyle = "rgba(196,242,255,.68)";
    ctx.lineWidth = Math.max(1.2, geom.w * .0025);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const d = 12 + i * 11;
      ctx.beginPath();
      ctx.moveTo(bounds.cx - dir * d * .2, bounds.boatY + i * 3);
      ctx.quadraticCurveTo(bounds.cx - dir * d, bounds.boatY + 8 + i * 4, bounds.cx - dir * d * 1.55, bounds.boatY + 3 + i * 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function pirateNetProfile(level = boatLevel()) {
    if (level <= 1) {
      return {
        level: 1, name: "อวนเชือกแพไม้", radius: .12, depth: .38,
        meshX: 2, meshY: 1, duration: 7000,
        rope: "rgba(214,187,126,.92)", net: "rgba(223,199,145,.86)", fill: "rgba(174,143,82,.08)", line: .0022, floats: 0,
      };
    }
    if (level === 2) {
      return {
        level: 2, name: "อวนลากเรือไม้", radius: .16, depth: .45,
        meshX: 3, meshY: 2, duration: 6500,
        rope: "rgba(229,207,151,.94)", net: "rgba(235,216,165,.90)", fill: "rgba(192,163,101,.10)", line: .0027, floats: 4,
      };
    }
    return {
      level: 3, name: "อวนเสริมขอบโจรสลัด", radius: .20, depth: .52,
      meshX: 5, meshY: 3, duration: 6000,
      rope: "rgba(255,220,129,.96)", net: "rgba(242,226,181,.94)", fill: "rgba(218,174,70,.12)", line: .0032, floats: 7,
    };
  }

  function startPirateNet(nowMs) {
    if (!isDuckBoat() || pirateNetFx || pirateDeliveryMove || pirateCannon?.busy || pendingCannonGift() || nowMs < pirateNetCooldownUntil || boatUpgradeFx) return;
    const targets = giftBodies().filter((b) => !b.plugin?.premium && Number(b.plugin?.coins) === 1 && !b.plugin?.netCaptured).slice(0, 10);
    if (targets.length < 10) return;
    const bounds = duckBoatBounds();
    if (!bounds) return;
    const profile = pirateNetProfile(boatLevel());
    const giftCenterX = targets.reduce((sum, body) => sum + body.position.x, 0) / targets.length;
    const targetX = Math.max(geom.jarLeft + geom.jarW * .16, Math.min(geom.jarRight - geom.jarW * .16, giftCenterX));
    const boatTargetOffset = Math.max(-.30, Math.min(.30, (targetX - geom.cx) / geom.w - boatPosition.x));
    const targetY = geom.waterTop + Math.max(28, (geom.waterBottom - geom.waterTop) * profile.depth);
    pirateNetFx = {
      startedAt: nowMs,
      duration: profile.duration,
      profile,
      anchorX: bounds.cx,
      anchorY: bounds.boatY - bounds.h * .08,
      targetX,
      targetY,
      boatStartOffset: pirateAutoBoatX,
      boatTargetOffset,
      x: bounds.cx,
      y: bounds.boatY,
      radius: 4,
      targets: targets.map((body, i) => ({
        body,
        startX: body.position.x,
        startY: body.position.y,
        angle: -Math.PI * .85 + i / 9 * Math.PI * 1.7,
        ring: .42 + (i % 3) * .18,
      })),
    };
    for (const item of pirateNetFx.targets) {
      item.body.plugin.netCaptured = true;
      item.body.collisionFilter.mask = 0;
      Body.setVelocity(item.body, { x: 0, y: 0 });
      Body.setAngularVelocity(item.body, 0);
      Sleeping.set(item.body, false);
    }
  }

  function finishPirateNet(nowMs) {
    if (!pirateNetFx) return;
    const combinedName = pirateNetFx.targets[0]?.body?.plugin?.giftName || "Rose";
    const combinedPicture = pirateNetFx.targets[0]?.body?.plugin?.giftPicture || "";
    for (const item of pirateNetFx.targets) Composite.remove(engine.world, item.body);
    spawnQ.push({
      giftName: combinedName,
      picture: combinedPicture,
      coins: 10,
      left: 1,
      img: null,
      fromBoat: true,
    });
    pirateNetFx = null;
    pirateAutoBoatX = 0;
    pirateNetCooldownUntil = nowMs + 1300;
  }

  function updatePirateNet(nowMs) {
    if (!isDuckBoat()) { pirateNetFx = null; return; }
    if (!pirateNetFx) startPirateNet(nowMs);
    const fx = pirateNetFx;
    if (!fx) return;
    const p = Math.max(0, Math.min(1, (nowMs - fx.startedAt) / fx.duration));
    if (p < .22) {
      pirateAutoBoatX = fx.boatStartOffset + (fx.boatTargetOffset - fx.boatStartOffset) * netEase(p / .22);
    } else if (p < .84) {
      pirateAutoBoatX = fx.boatTargetOffset;
    } else {
      pirateAutoBoatX = fx.boatTargetOffset * (1 - netEase((p - .84) / .16));
    }
    const liveBounds = duckBoatBounds();
    const anchorX = liveBounds?.cx ?? fx.anchorX;
    const anchorY = liveBounds ? liveBounds.boatY - liveBounds.h * .08 : fx.anchorY;
    const spread = fx.profile?.radius || .16;
    let cx = fx.targetX, cy = fx.targetY, radius = geom.jarW * spread;
    if (p < .22) {
      cx = anchorX;
      cy = anchorY;
      radius = 3;
    } else if (p < .43) {
      const q = netEase((p - .22) / .21);
      cx = anchorX + (fx.targetX - anchorX) * q;
      cy = anchorY + (fx.targetY - anchorY) * q;
      radius = Math.max(4, geom.jarW * spread * q);
    } else if (p < .65) {
      const q = netEase((p - .43) / .22);
      radius = geom.jarW * (spread - spread * .2 * q);
    } else if (p < .84) {
      const q = netEase((p - .65) / .19);
      cx = fx.targetX + (anchorX - fx.targetX) * q;
      cy = fx.targetY + (anchorY - fx.targetY) * q;
      radius = geom.jarW * (spread * .8 * (1 - q) + .025);
    } else {
      cx = anchorX;
      cy = anchorY;
      radius = 3;
    }
    fx.anchorX = anchorX; fx.anchorY = anchorY;
    fx.x = cx; fx.y = cy; fx.radius = radius; fx.progress = p;
    for (const item of fx.targets) {
      const gather = netEase(Math.max(0, Math.min(1, (p - .38) / .27)));
      const tx = cx + Math.cos(item.angle) * radius * item.ring;
      const ty = cy + Math.sin(item.angle) * radius * item.ring * .62;
      Body.setPosition(item.body, {
        x: item.startX + (tx - item.startX) * gather,
        y: item.startY + (ty - item.startY) * gather,
      });
      Body.setVelocity(item.body, { x: 0, y: 0 });
      Body.setAngularVelocity(item.body, 0);
      Body.setAngle(item.body, Math.sin(nowMs * .004 + item.angle) * .08);
    }
    if (p >= 1) finishPirateNet(nowMs);
  }

  function drawPirateNet() {
    const fx = pirateNetFx;
    if (!fx || !geom) return;
    const profile = fx.profile || pirateNetProfile(1);
    const r = Math.max(4, fx.radius);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = profile.rope;
    ctx.lineWidth = Math.max(1.3, geom.w * profile.line);
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(fx.anchorX, fx.anchorY);
    ctx.quadraticCurveTo((fx.anchorX + fx.x) * .5 + Math.sin(fx.progress * Math.PI) * 16, (fx.anchorY + fx.y) * .5, fx.x, fx.y - r * .42);
    ctx.stroke();
    if (fx.progress < .22 || fx.progress > .84) {
      const outward = fx.progress < .22 ? Math.sign(fx.boatTargetOffset - fx.boatStartOffset || 1) : -Math.sign(fx.boatTargetOffset || 1);
      ctx.strokeStyle = "rgba(190,240,255,.72)";
      ctx.lineWidth = Math.max(1.2, geom.w * .0025);
      for (let i = 0; i < 3; i++) {
        const wake = 10 + i * 11;
        ctx.beginPath();
        ctx.moveTo(fx.anchorX - outward * wake * .25, fx.anchorY + i * 3);
        ctx.quadraticCurveTo(fx.anchorX - outward * wake, fx.anchorY + 8 + i * 5, fx.anchorX - outward * wake * 1.55, fx.anchorY + 2 + i * 8);
        ctx.stroke();
      }
    }
    ctx.translate(fx.x, fx.y);
    ctx.strokeStyle = profile.net;
    ctx.fillStyle = profile.fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * .62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = .72;
    for (let i = -profile.meshX; i <= profile.meshX; i++) {
      const t = i / Math.max(1, profile.meshX);
      ctx.beginPath();
      ctx.moveTo(t * r, -Math.sqrt(Math.max(0, 1 - t * t)) * r * .62);
      ctx.lineTo(t * r * .72, Math.sqrt(Math.max(0, 1 - t * t)) * r * .62);
      ctx.stroke();
    }
    for (let i = -profile.meshY; i <= profile.meshY; i++) {
      const y = i / Math.max(1, profile.meshY) * r * .45;
      const half = Math.sqrt(Math.max(0, 1 - (y / (r * .62)) ** 2)) * r;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
    }
    if (profile.floats) {
      for (let i = 0; i < profile.floats; i++) {
        const a = Math.PI + (i / Math.max(1, profile.floats - 1)) * Math.PI;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r * .62;
        ctx.fillStyle = profile.level >= 3 ? "#f6b83f" : "#d9b66b";
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.2, r * .035), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function duckRopeAttachPoint() {
    // Match the rendered artwork bounds, then place the knot at the very top
    // of the main mast. All premium-gift ropes radiate from this one point.
    const bounds = duckBoatBounds();
    if (!bounds) return { x: geom?.cx || 0, y: geom?.top || 0 };
    if (boatLevel() === 1) return { x: bounds.x + bounds.w * .52, y: bounds.y + bounds.h * .055 };
    if (boatLevel() === 2) return { x: bounds.x + bounds.w * .47, y: bounds.y + bounds.h * .04 };
    return { x: bounds.x + bounds.w * .505, y: bounds.y + bounds.h * .075 };
  }

  function halton(index, base) {
    let f = 1;
    let result = 0;
    while (index > 0) {
      f /= base;
      result += f * (index % base);
      index = Math.floor(index / base);
    }
    return result;
  }

  function updateDuckBoatGifts() {
    if (!geom || !isDuckBoat()) return;
    const now = engine.timing.timestamp * .001;
    const premiums = giftBodies().filter((b) => b.plugin?.premium);
    const maxR = Math.max(18, ...premiums.map((b) => b.circleRadius || b.plugin?.r || 18));
    const attach = duckRopeAttachPoint();
    // Use a low-discrepancy scatter instead of rows. It fills the available
    // sky naturally, avoids a tight clump, and gives every rope its own length.
    const cloudLeft = geom.jarLeft + maxR * .75;
    const cloudRight = geom.jarLeft + geom.jarW - maxR * .75;
    const cloudTop = geom.top + maxR * .42;
    // Allow some balloons to sit a little below the mast tip while remaining
    // above the vessel. This creates visibly different rope lengths.
    const cloudBottom = Math.max(cloudTop, attach.y + maxR * .62);
    const cloudWidth = Math.max(1, cloudRight - cloudLeft);
    const cloudHeight = Math.max(1, cloudBottom - cloudTop);
    premiums.forEach((b, i) => {
      const order = i + 1;
      const seed = Number(b.plugin.bobSeed) || order * 1.37;
      const u = (halton(order, 2) + Math.abs(Math.sin(seed * 2.17)) * .17) % 1;
      const v = (halton(order, 3) + Math.abs(Math.cos(seed * 1.73)) * .13) % 1;
      const driftX = Math.sin(now * .38 + seed) * Math.min(12, maxR * .22);
      const manual = Number.isFinite(b.plugin?.manualX) && Number.isFinite(b.plugin?.manualY);
      const bodyR = b.circleRadius || b.plugin?.r || maxR;
      const minX = manual ? geom.stageL + bodyR : cloudLeft;
      const maxX = manual ? geom.stageR - bodyR : cloudRight;
      const minY = manual ? geom.top + bodyR : cloudTop;
      const maxY = manual ? geom.waterTop - bodyR : cloudBottom;
      let x = Math.max(minX, Math.min(maxX,
        (manual ? b.plugin.manualX : cloudLeft + u * cloudWidth) + driftX));
      const baseY = manual ? b.plugin.manualY : cloudTop + v * cloudHeight;
      let y = Math.max(minY, Math.min(maxY,
        baseY + Math.sin(now * 1.15 + seed) * Math.min(9, maxR * .18)));
      const launchDuration = Math.max(1, Number(b.plugin.launchDuration) || 1);
      const launchProgress = b.plugin.launchAt ? Math.max(0, Math.min(1, (performance.now() - b.plugin.launchAt) / launchDuration)) : 1;
      if (!manual && launchProgress < 1) {
        const q = 1 - Math.pow(1 - launchProgress, 3);
        const sway = Math.sin(launchProgress * Math.PI * 2 + seed) * Math.min(10, bodyR * .2) * launchProgress;
        x = b.plugin.launchStartX + (x - b.plugin.launchStartX) * q + sway;
        y = b.plugin.launchStartY + (y - b.plugin.launchStartY) * q - Math.sin(launchProgress * Math.PI) * bodyR * .35;
      }
      Body.setPosition(b, { x, y });
      Body.setVelocity(b, { x: 0, y: 0 });
      Body.setAngularVelocity(b, 0);
      Body.setAngle(b, Math.sin(now * 1.2 + b.plugin.bobSeed) * .06);
      Sleeping.set(b, false);
    });
    // Ordinary and overflow gifts remain under Matter.js physics. They fall,
    // bounce lightly, rotate, collide and settle instead of being pinned to a
    // generated grid. Repair only bodies that escaped during a slow frame.
    for (const b of giftBodies().filter((body) => !body.plugin?.premium)) {
      const r = b.circleRadius || b.plugin.r;
      let x = b.position.x;
      let y = b.position.y;
      const left = b.plugin?.waterOverflow ? geom.stageL : geom.jarLeft;
      const right = b.plugin?.waterOverflow ? geom.stageR : geom.jarRight;
      const bottom = b.plugin?.waterOverflow ? geom.h - r : geom.waterBottom - r;
      x = Math.max(left + r, Math.min(right - r, x));
      y = Math.min(bottom, y);
      if (x !== b.position.x || y !== b.position.y) {
        Body.setPosition(b, { x, y });
        Body.setVelocity(b, { x: x === b.position.x ? b.velocity.x : 0, y: Math.min(0, b.velocity.y) });
        Sleeping.set(b, false);
      }
    }
  }

  Events.on(engine, "afterUpdate", () => {
    if (isDuckBoat()) updateDuckBoatGifts();
    else { containGifts(); updatePileState(); }
  });

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

  function drawDuckWater(back) {
    if (!geom || !isDuckBoat()) return;
    const { jarLeft: l, jarRight: r, waterTop: t, waterBottom: b } = geom;
    const now = performance.now() * .001;
    ctx.save();
    if (back) {
      const grad = ctx.createLinearGradient(0, t, 0, b);
      grad.addColorStop(0, "rgba(170,245,255,.38)");
      grad.addColorStop(.35, "rgba(55,205,238,.34)");
      grad.addColorStop(1, "rgba(6,126,204,.52)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(l, t);
      for (let x = l; x <= r + 4; x += 8) {
        const y = t + Math.sin(x * .032 + now * 2.2) * 5 + Math.sin(x * .071 - now * 1.4) * 2;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(r, b);
      ctx.lineTo(l, b);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.lineCap = "round";
      for (let band = 0; band < 3; band++) {
        const y0 = t + 7 + band * (b - t) * .19;
        ctx.beginPath();
        for (let x = l; x <= r; x += 7) {
          const y = y0 + Math.sin(x * .042 + now * (2 + band * .3) + band) * (4 - band * .7);
          if (x === l) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = band === 0 ? "rgba(235,255,255,.9)" : "rgba(195,249,255,.52)";
        ctx.lineWidth = band === 0 ? 4 : 2.2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawEvolvingBoat(back, bounds) {
    const level = boatLevel();
    if (level >= 3 || !bounds) return false;
    const art = currentBoatArt();
    if (art.complete && art.naturalWidth) {
      if (!back) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(art, bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.restore();
      }
      return true;
    }
    const { cx, boatY, w, h } = bounds;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (level === 1) {
      const rw = w * .66;
      const rh = Math.max(28, h * .13);
      const x = cx - rw * .5;
      const y = boatY - rh * .48;
      if (back) {
        ctx.strokeStyle = "#765028";
        ctx.lineWidth = Math.max(5, w * .009);
        ctx.beginPath(); ctx.moveTo(cx, y + rh * .1); ctx.lineTo(cx, y - h * .25); ctx.stroke();
        ctx.fillStyle = "#f0d477";
        ctx.strokeStyle = "#80562b";
        ctx.lineWidth = Math.max(2, w * .004);
        ctx.beginPath();
        ctx.moveTo(cx + 3, y - h * .23); ctx.lineTo(cx + rw * .18, y - h * .08); ctx.lineTo(cx + 3, y - h * .04); ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else {
        for (let i = 0; i < 8; i++) {
          const by = y + i * rh / 8;
          const grad = ctx.createLinearGradient(x, by, x + rw, by);
          grad.addColorStop(0, "#9a5a20"); grad.addColorStop(.5, "#e4aa43"); grad.addColorStop(1, "#8a4b19");
          ctx.fillStyle = grad; ctx.strokeStyle = "#5e3517"; ctx.lineWidth = Math.max(1.5, w * .0025);
          ctx.beginPath(); ctx.roundRect(x, by, rw, rh / 6.5, rh / 12); ctx.fill(); ctx.stroke();
        }
        ctx.strokeStyle = "#e8c36b"; ctx.lineWidth = Math.max(3, w * .006);
        for (const sx of [x + rw * .13, x + rw * .87]) { ctx.beginPath(); ctx.moveTo(sx, y - 3); ctx.lineTo(sx, y + rh + 3); ctx.stroke(); }
      }
      ctx.restore();
      return true;
    }
    const bw = w * .78;
    const bh = Math.max(65, h * .25);
    const x = cx - bw * .5;
    const y = boatY - bh * .72;
    if (back) {
      ctx.strokeStyle = "#603416"; ctx.lineWidth = Math.max(6, w * .01);
      ctx.beginPath(); ctx.moveTo(cx, y + bh * .45); ctx.lineTo(cx, y - h * .26); ctx.stroke();
      ctx.fillStyle = "#ead9a7"; ctx.strokeStyle = "#8b541f"; ctx.lineWidth = Math.max(3, w * .005);
      ctx.beginPath(); ctx.moveTo(cx + 3, y - h * .23); ctx.lineTo(cx + bw * .25, y + bh * .1); ctx.lineTo(cx + 3, y + bh * .02); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      const hull = ctx.createLinearGradient(0, y, 0, y + bh);
      hull.addColorStop(0, "#b56a28"); hull.addColorStop(.5, "#74401e"); hull.addColorStop(1, "#3f2518");
      ctx.fillStyle = hull; ctx.strokeStyle = "#d7993c"; ctx.lineWidth = Math.max(4, w * .007);
      ctx.beginPath(); ctx.moveTo(x, y + bh * .2); ctx.quadraticCurveTo(cx, y + bh * .5, x + bw, y + bh * .12); ctx.lineTo(x + bw * .86, y + bh); ctx.quadraticCurveTo(cx, y + bh * 1.18, x + bw * .12, y + bh * .88); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(245,190,89,.75)"; ctx.lineWidth = Math.max(2, w * .003);
      for (let i = 1; i <= 3; i++) { const ly=y+bh*(.28+i*.16); ctx.beginPath(); ctx.moveTo(x+bw*.12,ly); ctx.lineTo(x+bw*.88,ly-bh*.06); ctx.stroke(); }
      ctx.fillStyle = "#dfaa4a";
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + bw * (.3 + i * .14), y + bh * .56, Math.max(4, w * .009), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    return true;
  }

  function drawDuckBoat(back) {
    if (!geom || !isDuckBoat()) return;
    const bounds = duckBoatBounds();
    if (drawEvolvingBoat(back, bounds)) return;
    const { cx, boatY } = bounds || { cx: geom.cx, boatY: geom.boatY };
    const jarW = geom.jarW;
    const art = currentDuckArt();
    if (art.complete && art.naturalWidth) {
      if (back) return;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(art, bounds.x, bounds.y, bounds.w, bounds.h);
      ctx.restore();
      return;
    }
    const scale = Math.min(1.25, jarW / 620);
    const bw = Math.min(jarW * .78, 610 * scale);
    const bh = Math.max(100, bw * .34);
    const x = cx - bw / 2;
    const y = boatY - bh * .68;
    const cruise = jarStyle === "duck-cruise";
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (back) {
      // Mast / upper decks sit behind gifts and ropes.
      if (cruise) {
        ctx.fillStyle = "#fffdf5";
        ctx.strokeStyle = "#c99728";
        ctx.lineWidth = Math.max(3, bw * .007);
        ctx.beginPath();
        ctx.roundRect(x + bw * .28, y + bh * .12, bw * .53, bh * .42, 18 * scale);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#36bde7";
        for (let i = 0; i < 5; i++) {
          ctx.beginPath(); ctx.roundRect(x + bw * (.34 + i * .085), y + bh * .23, bw * .055, bh * .1, 5); ctx.fill();
        }
        ctx.strokeStyle = "#d6a832"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + bw * .12, y + bh * .13); ctx.lineTo(cx + bw * .12, y - bh * .16); ctx.stroke();
        const colors = ["#ff5b69", "#ffd84d", "#45d7c0", "#6e78ff"];
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = colors[i % colors.length];
          const fx = cx - bw * .16 + i * bw * .052;
          ctx.beginPath(); ctx.moveTo(fx, y - bh * .08); ctx.lineTo(fx + bw * .035, y - bh * .01); ctx.lineTo(fx, y + bh * .035); ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.strokeStyle = "#6b381d"; ctx.lineWidth = Math.max(5, bw * .009);
        ctx.beginPath(); ctx.moveTo(cx, y + bh * .42); ctx.lineTo(cx, y - bh * .28); ctx.stroke();
        ctx.fillStyle = "#6b151b"; ctx.strokeStyle = "#e8b63e"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + 2, y - bh * .22); ctx.lineTo(cx + bw * .24, y + bh * .13); ctx.lineTo(cx + 2, y + bh * .08); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#17151a";
        ctx.fillRect(cx - bw * .14, y - bh * .18, bw * .13, bh * .18);
        ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.max(14, bh * .11)}px Segoe UI Symbol`; ctx.textAlign = "center";
        ctx.fillText("☠", cx - bw * .075, y - bh * .045);
      }
    } else {
      // Duck hull and head.
      const hull = cruise ? "#fffdf6" : "#754122";
      const edge = cruise ? "#d6a42d" : "#e4ad38";
      ctx.fillStyle = hull; ctx.strokeStyle = edge; ctx.lineWidth = Math.max(4, bw * .009);
      ctx.beginPath();
      ctx.moveTo(x + bw * .13, y + bh * .47);
      ctx.quadraticCurveTo(x + bw * .5, y + bh * .66, x + bw * .92, y + bh * .42);
      ctx.lineTo(x + bw * .84, y + bh * .75);
      ctx.quadraticCurveTo(x + bw * .48, y + bh * .98, x + bw * .16, y + bh * .72);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (!cruise) {
        ctx.strokeStyle = "rgba(255,210,100,.65)"; ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) { const yy = y + bh * (.57 + i * .055); ctx.beginPath(); ctx.moveTo(x + bw * .23, yy); ctx.lineTo(x + bw * .79, yy + bh * .025); ctx.stroke(); }
      }
      ctx.fillStyle = "#ffd83f"; ctx.strokeStyle = "#e7a724"; ctx.lineWidth = Math.max(4, bw * .008);
      ctx.beginPath(); ctx.arc(x + bw * .12, y + bh * .38, bh * .24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + bw * .025, y + bh * .44, bh * .16, bh * .075, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#ff932f"; ctx.fill(); ctx.strokeStyle = "#dc6d1d"; ctx.stroke();
      ctx.fillStyle = "#161616"; ctx.beginPath(); ctx.arc(x + bw * .16, y + bh * .33, bh * .025, 0, Math.PI * 2); ctx.fill();
      if (cruise) {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#24518d"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x + bw * .1, y + bh * .2, bh * .15, Math.PI, Math.PI * 2); ctx.lineTo(x + bw * .25, y + bh * .2); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = "#17151a"; ctx.beginPath(); ctx.arc(x + bw * .12, y + bh * .19, bh * .18, Math.PI, Math.PI * 2); ctx.fill();
        ctx.fillRect(x + bw * .005, y + bh * .17, bw * .23, bh * .055);
      }
      ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.lineWidth = Math.max(3, bw * .006);
      ctx.beginPath(); ctx.moveTo(x + bw * .22, y + bh * .66); ctx.quadraticCurveTo(cx, y + bh * .8, x + bw * .82, y + bh * .6); ctx.stroke();
    }
    ctx.restore();
  }

  function drawDuckRopes(gifts) {
    if (!geom || !isDuckBoat()) return;
    const premium = gifts.filter((b) => b.plugin?.premium);
    if (!premium.length) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = Math.max(0.65, geom.w * .0007);
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(190,240,255,.72)";
    ctx.shadowBlur = Math.max(3, geom.w * .0035);
    // Every rope starts at the top of the mast and fans freely through the sky.
    const attach = duckRopeAttachPoint();
    const attachX = attach.x;
    const attachY = attach.y;
    for (let i = 0; i < premium.length; i++) {
      const b = premium[i];
      ctx.globalAlpha = b.plugin?.cannonReturn
        ? netEase((performance.now() - b.plugin.launchAt) / 550) : 1;
      ctx.beginPath();
      ctx.moveTo(attachX, attachY);
      ctx.quadraticCurveTo(
        attachX + (b.position.x - attachX) * .34 + Math.sin(i * 2.1) * 7,
        (attachY + b.position.y) / 2,
        b.position.x,
        b.position.y + b.circleRadius * .78
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.98)";
    ctx.strokeStyle = "rgba(210,248,255,1)";
    ctx.lineWidth = Math.max(1.5, geom.w * .002);
    ctx.beginPath();
    ctx.arc(attachX, attachY, Math.max(5, geom.w * .006), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function sultanAvatar(url) {
    const key = String(url || "").trim();
    if (!key) return null;
    if (sultanAvatarCache.has(key)) return sultanAvatarCache.get(key);
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.src = key;
    sultanAvatarCache.set(key, img);
    return img;
  }

  function shortCoins(value) {
    const n = Math.max(0, Number(value) || 0);
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
    return String(Math.round(n));
  }

  function drawBoatUpgradeFx(nowMs) {
    if (!boatUpgradeFx || !geom || !isDuckBoat()) return;
    const bounds = duckBoatBounds();
    if (!bounds) return;
    const t = Math.max(0, (nowMs - boatUpgradeFx.startedAt) / 1000);
    ctx.save();
    if (monkeyRepairCrewArt.complete && monkeyRepairCrewArt.naturalWidth) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const iw = monkeyRepairCrewArt.naturalWidth;
      const ih = monkeyRepairCrewArt.naturalHeight;
      const sprites = [
        { crop:[0,0,.2,1], x:-.36, y:-.02, w:.22, phase:.1, job:"plank" },
        { crop:[.2,0,.2,1], x:-.18, y:-.22, w:.20, phase:1.6, job:"hammer" },
        { crop:[.4,0,.2,1], x:0, y:-.02, w:.22, phase:3.1, job:"saw" },
        { crop:[.6,0,.2,1], x:.19, y:-.19, w:.21, phase:4.4, job:"rope" },
        { crop:[.8,0,.2,1], x:.37, y:-.02, w:.21, phase:5.7, job:"paint" },
      ];
      sprites.forEach((m, i) => {
        const localEnter = Math.max(0, Math.min(1, (t - i * .14) / .72));
        const localLeave = Math.max(0, Math.min(1, (t - (8.55 + i * .09)) / .82));
        const easeIn = 1 - Math.pow(1 - localEnter, 3);
        const easeOut = localLeave * localLeave;
        const alpha = Math.max(0, easeIn * (1 - easeOut));
        if (alpha <= 0) return;
        const [nx, ny, nw, nh] = m.crop;
        const sw = iw * nw, sh = ih * nh;
        const dw = bounds.w * m.w;
        const dh = dw * sh / sw;
        const work = t > .7 && t < 9 ? 1 : 0;
        const bob = Math.abs(Math.sin(t * (m.job === "saw" ? 10 : 8) + m.phase)) * bounds.h * .025 * work;
        const actionX = m.job === "saw" ? Math.sin(t * 15) * bounds.w * .018 * work
          : m.job === "rope" ? Math.sin(t * 6 + m.phase) * bounds.w * .01 * work : 0;
        const actionRot = m.job === "hammer" ? Math.sin(t * 11 + m.phase) * .09 * work
          : m.job === "rope" ? -.08 + Math.sin(t * 5) * .025 : Math.sin(t * 7 + m.phase) * .018;
        const arrivalX = (1 - easeIn) * (i < 2 ? -1 : 1) * bounds.w * .45;
        const exitX = easeOut * (i < 3 ? -1 : 1) * bounds.w * .48;
        const x = bounds.cx + bounds.w * m.x + arrivalX + exitX + actionX;
        const y = bounds.boatY - bounds.h * .1 + bounds.h * m.y - dh * .54 - bob;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y + dh * .5);
        ctx.rotate(actionRot);
        ctx.drawImage(monkeyRepairCrewArt, iw*nx, ih*ny, sw, sh, -dw*.5, -dh*.5, dw, dh);
        ctx.restore();
      });
    }
    const sceneAlpha = Math.min(1, t / .45) * (1 - Math.max(0, Math.min(1, (t - 9.1) / .9)));
    const impact = Math.exp(-Math.pow((t - 5) / .68, 2));
    const dustPower = sceneAlpha * Math.min(1, .38 + impact * .9 + Math.abs(Math.sin(t * 4.2)) * .18);
    // Layered white cartoon smoke clouds, inspired by classic repair/fight puffs.
    const drawPuff = (x, y, size, life, flip) => {
      if (life <= 0) return;
      const puff = Math.sin(Math.min(1, life) * Math.PI * .5);
      const fade = 1 - Math.max(0, (life - .62) / .38);
      const s = size * (.45 + puff * .65);
      const lobes = [
        [0,0,.34],[-.3,.06,.24],[.3,.04,.27],[-.16,-.25,.25],[.13,-.3,.29],
        [-.39,-.15,.18],[.42,-.18,.19],[-.07,.27,.23],[.22,.23,.18]
      ];
      ctx.save();
      ctx.translate(x + flip * life * size * .18, y - life * size * .22);
      ctx.globalAlpha = sceneAlpha * fade * .9;
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1.5, s * .035);
      ctx.strokeStyle = "rgba(150,165,173,.88)";
      for (let j = 0; j < lobes.length; j++) {
        const l = lobes[j];
        ctx.fillStyle = j % 4 === 0 ? "#dce5e9" : "#ffffff";
        ctx.beginPath();
        ctx.arc(l[0]*s, l[1]*s, l[2]*s, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
      }
      // Curved speed tails make the cloud feel hand drawn and directional.
      ctx.globalAlpha = sceneAlpha * fade * .72;
      ctx.strokeStyle = "#eef5f7";
      ctx.lineWidth = Math.max(2, s*.055);
      for (let j=0; j<3; j++) {
        ctx.beginPath();
        ctx.moveTo(-flip*s*(.35+j*.12), s*(.05+j*.13));
        ctx.quadraticCurveTo(-flip*s*(.62+j*.14), s*(.12+j*.16), -flip*s*(.88+j*.12), s*(.08+j*.18));
        ctx.stroke();
      }
      ctx.restore();
    };
    for (let i=0; i<7; i++) {
      const cycle = (t*.72 + i*.19) % 1;
      const side = i%2 ? 1 : -1;
      const x = bounds.cx + bounds.w * (-.36 + i*.12) + Math.sin(i*3.1)*bounds.w*.025;
      const y = bounds.boatY - bounds.h*(.02 + (i%3)*.08);
      drawPuff(x, y, bounds.w*(.10 + (i%3)*.018)*(1+impact*.32), cycle, side);
    }
    // A larger burst masks the exact model swap without hiding the whole boat.
    drawPuff(bounds.cx-bounds.w*.23, bounds.boatY-bounds.h*.06, bounds.w*.17, Math.min(1, impact*1.35), -1);
    drawPuff(bounds.cx+bounds.w*.22, bounds.boatY-bounds.h*.08, bounds.w*.18, Math.min(1, impact*1.35), 1);
    for (let i = 0; i < boatUpgradeFx.seeds.length; i++) {
      const p = boatUpgradeFx.seeds[i];
      const cycle = (t * (.42 + p.s * .11) + p.d * 2.7) % 1;
      const spread = bounds.w * (.08 + p.d * .43) * (1 + impact * .3);
      const x = bounds.cx + Math.cos(p.a) * spread + Math.sin(t * 2 + p.a) * bounds.w * .018;
      const y = bounds.boatY + bounds.h * .02 + Math.sin(p.a) * bounds.h * .2 - cycle * bounds.h * .34;
      const radius = Math.max(1.5, bounds.w * .0065 * p.r) * (.45 + cycle * .8);
      ctx.globalAlpha = dustPower * (1-cycle) * (.24 + p.d * .46);
      ctx.fillStyle = i % 7 === 0 ? "#b9c7cd" : i % 3 === 0 ? "#dce5e9" : "#ffffff";
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = sceneAlpha * Math.min(1, .18 + impact);
    ctx.strokeStyle = "#f7fcff";
    ctx.lineWidth = Math.max(2, bounds.w * .004);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + t * .7;
      const r1 = bounds.w * (.11 + (i%3)*.025);
      const r2 = r1 + bounds.w * (.055 + (i%4)*.009);
      ctx.beginPath();
      ctx.moveTo(bounds.cx + Math.cos(a) * r1, bounds.boatY - bounds.h * .13 + Math.sin(a) * r1 * .35);
      ctx.lineTo(bounds.cx + Math.cos(a) * r2, bounds.boatY - bounds.h * .13 + Math.sin(a) * r2 * .35);
      ctx.stroke();
    }
    for (let i = 0; i < 22; i++) {
      const a = i * 2.399 + t * 1.3;
      const r = bounds.w * (.12 + (i%7)*.035) * (.7 + impact*.45);
      const x = bounds.cx + Math.cos(a)*r;
      const y = bounds.boatY - bounds.h*.08 + Math.sin(a)*r*.32;
      ctx.save(); ctx.translate(x,y); ctx.rotate(a+t*4);
      ctx.globalAlpha = sceneAlpha * (.28 + impact*.5);
      ctx.fillStyle = i%2 ? "#9a5527" : "#efb64a";
      ctx.fillRect(-bounds.w*.009,-bounds.w*.002,bounds.w*.018,bounds.w*.004);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSultanBalloons() {
    if (!showSultanBalloons || !geom || !isDuckBoat() || !sultanRows.length) {
      sultanHitBounds = [];
      return;
    }
    sultanHitBounds = [];
    const now = performance.now() * .001;
    const ranked = sultanRows.slice(0, 3).map((row, i) => ({ row, rank: i + 1 }));
    // Podium order: silver on the left, gold high in the centre, bronze right.
    const balloons = ranked.length >= 3
      ? [ranked[1], ranked[0], ranked[2]]
      : ranked.length === 2 ? [ranked[1], ranked[0]] : ranked;
    const colors = [
      ["#fff2a3", "#d99500"], // gold
      ["#ffffff", "#8fa6b8"], // silver
      ["#ffd0a0", "#a94f20"], // bronze
    ];
    const span = Math.min(geom.jarW * .82, Math.min(geom.jarW * .62, geom.w * .58) * sultanScale);
    const step = balloons.length > 1 ? span / (balloons.length - 1) : 0;
    const startX = geom.cx - span * .5;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < balloons.length; i++) {
      const { row = {}, rank = i + 1 } = balloons[i];
      const position = sultanPositions[rank] || sultanPositions[1];
      const color = colors[rank - 1];
      const rankScale = rank === 1 ? 1.14 : 1;
      const rx = Math.max(29, Math.min(52, geom.w * .038)) * rankScale * sultanScale;
      const ry = rx;
      const baseX = balloons.length >= 3
        ? startX + step * i
        : rank === 1 ? geom.cx : geom.cx - span * .5;
      const x = baseX + position.x * geom.w + Math.sin(now * .55 + i * 1.7) * 6;
      const sideY = geom.top + ry + Math.max(24, geom.h * .045);
      const y = sideY + position.y * geom.h - (rank === 1 ? Math.max(25, ry * .52) : 0) + Math.sin(now * .8 + rank * 1.25) * 5;
      const tailY = y + ry + Math.max(14, geom.h * .025);
      const grad = ctx.createRadialGradient(x - rx * .32, y - ry * .35, rx * .08, x, y, ry * 1.12);
      grad.addColorStop(0, "rgba(255,255,255,.98)");
      grad.addColorStop(.2, color[0]);
      grad.addColorStop(1, color[1]);
      ctx.shadowColor = color[0];
      ctx.shadowBlur = Math.max(7, rx * .3);
      ctx.fillStyle = grad;
      ctx.strokeStyle = "rgba(255,255,255,.94)";
      ctx.lineWidth = Math.max(3, rx * .10);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.sin(now * .35 + i) * .035, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      const avatarR = rx * .82;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y - ry * .08, avatarR, 0, Math.PI * 2);
      ctx.clip();
      const avatar = sultanAvatar(row.avatar);
      if (avatar?.complete && avatar.naturalWidth) {
        ctx.drawImage(avatar, x - avatarR, y - ry * .08 - avatarR, avatarR * 2, avatarR * 2);
      } else {
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.fillRect(x - avatarR, y - ry * .08 - avatarR, avatarR * 2, avatarR * 2);
      }
      ctx.restore();
      ctx.strokeStyle = color[0];
      ctx.lineWidth = Math.max(2, rx * .065);
      ctx.beginPath(); ctx.arc(x, y - ry * .08, avatarR, 0, Math.PI * 2); ctx.stroke();
      const name = String(row.nick || row.user || "ผู้ชม");
      const clipped = name.length > 9 ? `${name.slice(0, 8)}…` : name;
      ctx.fillStyle = "rgba(0,0,0,.58)";
      ctx.beginPath();
      ctx.roundRect(x - rx * .76, y + ry * .29, rx * 1.52, ry * .47, Math.max(4, rx * .09));
      ctx.fill();
      ctx.shadowColor = "rgba(0,0,0,.9)";
      ctx.shadowBlur = 3;
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 ${Math.max(10, rx * .23)}px system-ui, sans-serif`;
      ctx.fillText(`#${rank}  ◆ ${shortCoins(row.coins)}`, x, y + ry * .41, rx * 1.42);
      ctx.font = `800 ${Math.max(10, rx * .25)}px system-ui, sans-serif`;
      ctx.fillText(clipped, x, y + ry * .64, rx * 1.42);
      ctx.shadowBlur = 0;
      ctx.fillStyle = color[1];
      ctx.beginPath();
      ctx.moveTo(x - 6, y + ry - 1); ctx.lineTo(x + 6, y + ry - 1); ctx.lineTo(x, y + ry + 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.78)";
      ctx.lineWidth = Math.max(.65, geom.w * .00065);
      ctx.shadowColor = "rgba(190,240,255,.62)";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + ry + 8);
      ctx.quadraticCurveTo(x + Math.sin(i * 2.4) * 10, (y + ry + tailY) * .5, x + Math.sin(i) * 5, tailY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      sultanHitBounds.push({
        rank,
        baseX,
        radiusX: rx,
        x: x - rx * 1.08,
        y: y - ry * 1.12,
        w: rx * 2.16,
        h: ry * 2.45,
      });
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
    if (isDuckBoat()) { drawDuckWater(true); drawDuckBoat(true); return; }
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
    if (isDuckBoat()) { drawDuckBoat(false); drawDuckWater(false); return; }
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
    // Keep ship artwork, sea effects and gift colors intact. Only the backdrop
    // is green; do not recolor their pixels or scan the full canvas each frame.
    if (!chroma || isDuckBoat()) return;
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
    const nowMs = performance.now();
    updateBoatUpgradeFx(nowMs);
    if (chroma) {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(0, 0, geom.w, geom.h);
    } else {
      ctx.clearRect(0, 0, geom.w, geom.h);
    }
    drawJarBack();
    drawSultanBalloons();
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
    if (isDuckBoat()) {
      drawPirateDeliveryWake();
      drawPirateNet();
      // Keep the fan visible as it leaves the bow. Redraw the floating gifts
      // over their rope ends so each cord still looks tied behind its icon.
      drawDuckRopes(gifts);
      for (const b of gifts) if (b.plugin?.premium && !b.plugin?.spilled) drawOne(b);
      drawBoatUpgradeFx(nowMs);
    }
    for (const b of gifts) {
      if (b.plugin && b.plugin.spilled) drawOne(b);
    }
    pirateCannon?.draw(ctx);
    snapChroma();
    const visibleAndQueued = gifts.length + queuedCount();
    if (visibleAndQueued !== lastHud && hudCount) {
      lastHud = visibleAndQueued;
      hudCount.textContent = String(visibleAndQueued);
    }
  }

  let lastTs = 0;
  function frame(ts) {
    const dt = Math.min(0.032, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    updatePirateDelivery(ts);
    updatePirateCannon(ts);
    spawnFromQueue(dt);
    updatePirateNet(ts);
    draw();
    requestAnimationFrame(frame);
  }

  function handleMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.type === "jar-drop") {
      lastDirectDropAt = Date.now();
      acceptDrop(
        data.giftName,
        data.count,
        data.deliveryId || (data.at ? `cmd:${data.at}` : ""),
        data.sourceEventId || data.eventId || "",
        data.coins,
        data.giftPicture || data.giftPictureUrl || "",
        giftSender(data)
      );
      if (Number.isFinite(Number(data.totalCoins))) {
        totalLiveCoins = Math.max(totalLiveCoins, Math.max(0, Number(data.totalCoins)));
      }
      return;
    }
    if (data.at && data.at <= lastCmdAt) return;
    if (data.at) lastCmdAt = data.at;
    if (data.type === "jar-reset") {
      resetJar();
      return;
    }
    if (data.type === "jar-sync") {
      if (giftBodies().length || spawnQ.length) return;
      const pieces = Array.isArray(data.pieces) ? data.pieces : [];
      totalLiveCoins = 0;
      for (const p of pieces) enqueueDrop(p.giftName || p.name, p.count, p.coins, true, p.giftPicture || p.giftPictureUrl || "");
      if (Number.isFinite(Number(data.totalCoins))) totalLiveCoins = Math.max(0, Number(data.totalCoins));
      return;
    }
    if (data.type === "jar-style") {
      if (data.color) setJarColor(data.color);
      if (widgetMode === "glass" && Number.isFinite(Number(data.jarScale))) {
        const nextScale = Math.max(0.5, Math.min(1.5, Number(data.jarScale) / 100));
        if (nextScale !== glassJarScale) {
          glassJarScale = nextScale;
          resize();
        }
      }
      if (widgetMode === "pirate") setJarStyle(["duck-pirate", "duck-cruise", "monkey-pirate"].includes(parseJarStyle(data.pirateStyle)) ? data.pirateStyle : "duck-pirate");
      else if (widgetMode === "glass") setJarStyle(["classic", "original"].includes(parseJarStyle(data.style)) ? data.style : "classic");
      else if (data.style) setJarStyle(data.style);
      if (typeof data.sultanBalloons === "boolean") {
        showSultanBalloons = data.sultanBalloons;
        if (!showSultanBalloons) sultanRows = [];
      }
      if (Number.isFinite(Number(data.boatScale))) {
        boatScale = Math.max(0.1, Math.min(1.8, Number(data.boatScale) / 100));
      }
      if (widgetMode === "pirate" && Number.isFinite(Number(data.seaLevel))) {
        const nextSeaLevel = Math.max(0.15, Math.min(0.5, Number(data.seaLevel) / 100));
        if (nextSeaLevel !== seaLevel) {
          seaLevel = nextSeaLevel;
          resize();
        }
      }
      if (Number.isFinite(Number(data.sultanScale))) {
        sultanScale = Math.max(0.3, Math.min(1.8, Number(data.sultanScale) / 100));
      }
    }
  }

  channel?.addEventListener("message", (ev) => handleMessage(ev.data));
  window.addEventListener("storage", (ev) => {
    if (ev.key === EVENTS_KEY) {
      drainEventJournal();
      return;
    }
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      handleMessage(JSON.parse(ev.newValue));
    } catch {
      /* ignore */
    }
  });

  function readEventJournal() {
    try {
      const rows = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function primeEventJournal() {
    for (const row of readEventJournal()) {
      const id = String(row?.deliveryId || (row?.at ? `cmd:${row.at}` : ""));
      if (id) seenJournalIds.add(id);
    }
  }

  function drainEventJournal() {
    for (const row of readEventJournal()) {
      const id = String(row?.deliveryId || (row?.at ? `cmd:${row.at}` : ""));
      if (!id || seenJournalIds.has(id)) continue;
      seenJournalIds.add(id);
      handleMessage(row);
    }
    if (seenJournalIds.size > 2600) {
      const keep = [...seenJournalIds].slice(-1400);
      seenJournalIds.clear();
      for (const id of keep) seenJournalIds.add(id);
    }
  }
  window.addEventListener("resize", resize);
  let boatDrag = null;
  let sultanDrag = null;
  let giftDrag = null;
  function sultanBalloonAt(x, y) {
    for (let i = sultanHitBounds.length - 1; i >= 0; i--) {
      const b = sultanHitBounds[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }
  function floatingGiftAt(x, y) {
    const premium = giftBodies().filter((b) => b.plugin?.premium && !b.plugin?.spilled);
    for (let i = premium.length - 1; i >= 0; i--) {
      const b = premium[i];
      const r = (b.circleRadius || b.plugin?.r || 18) * 1.12;
      if (Math.hypot(x - b.position.x, y - b.position.y) <= r) return b;
    }
    return null;
  }
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const pickedGift = isDuckBoat() ? floatingGiftAt(e.clientX, e.clientY) : null;
    if (pickedGift) {
      giftDrag = pickedGift;
      pickedGift.plugin.manualX = pickedGift.position.x;
      pickedGift.plugin.manualY = pickedGift.position.y;
      canvas.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const pickedSultan = showSultanBalloons ? sultanBalloonAt(e.clientX, e.clientY) : null;
    if (pickedSultan) {
      const position = sultanPositions[pickedSultan.rank];
      sultanDrag = {
        rank: pickedSultan.rank,
        startX: e.clientX,
        startY: e.clientY,
        originX: position.x,
        originY: position.y,
        minX: (pickedSultan.radiusX - pickedSultan.baseX) / Math.max(1, geom.w),
        maxX: ((canvas.clientWidth || geom.w) - pickedSultan.radiusX - pickedSultan.baseX) / Math.max(1, geom.w),
      };
      canvas.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isDuckBoat()) {
      const b = duckBoatBounds();
      if (b && e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) {
        boatDrag = {
          startX: e.clientX,
          startY: e.clientY,
          originX: boatPosition.x,
          originY: boatPosition.y,
        };
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (!window.chrome?.webview) return;
    try { window.chrome.webview.postMessage("drag"); } catch { /* ignore */ }
  });
  document.addEventListener("mousemove", (e) => {
    if (giftDrag && geom) {
      const r = giftDrag.circleRadius || giftDrag.plugin?.r || 18;
      giftDrag.plugin.manualX = Math.max(geom.stageL + r, Math.min(geom.stageR - r, e.clientX));
      giftDrag.plugin.manualY = Math.max(geom.top + r, Math.min(geom.waterTop - r, e.clientY));
      Body.setPosition(giftDrag, { x: giftDrag.plugin.manualX, y: giftDrag.plugin.manualY });
      Body.setVelocity(giftDrag, { x: 0, y: 0 });
      e.preventDefault();
      return;
    }
    if (sultanDrag && geom) {
      const position = sultanPositions[sultanDrag.rank];
      position.x = Math.max(sultanDrag.minX, Math.min(sultanDrag.maxX,
        sultanDrag.originX + (e.clientX - sultanDrag.startX) / Math.max(1, geom.w)));
      position.y = Math.max(-0.44, Math.min(0.44,
        sultanDrag.originY + (e.clientY - sultanDrag.startY) / Math.max(1, geom.h)));
      e.preventDefault();
      return;
    }
    if (boatDrag && geom) {
      boatPosition.x = Math.max(-0.42, Math.min(0.42,
        boatDrag.originX + (e.clientX - boatDrag.startX) / Math.max(1, geom.w)));
      boatPosition.y = Math.max(-0.38, Math.min(0.38,
        boatDrag.originY + (e.clientY - boatDrag.startY) / Math.max(1, geom.h)));
      e.preventDefault();
      return;
    }
    if (!isDuckBoat()) { canvas.style.cursor = "default"; return; }
    const overGift = isDuckBoat() && !!floatingGiftAt(e.clientX, e.clientY);
    const overSultan = showSultanBalloons && !!sultanBalloonAt(e.clientX, e.clientY);
    const b = duckBoatBounds();
    const overBoat = b && e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h;
    canvas.style.cursor = overGift || overSultan || overBoat ? "grab" : "default";
  });
  document.addEventListener("mouseup", () => {
    if (giftDrag) {
      giftDrag = null;
      canvas.style.cursor = "grab";
    }
    if (sultanDrag) {
      sultanDrag = null;
      canvas.style.cursor = "grab";
      try { localStorage.setItem(SULTAN_POS_KEY, JSON.stringify(sultanPositions)); } catch { /* ignore */ }
    }
    if (!boatDrag) return;
    boatDrag = null;
    canvas.style.cursor = "grab";
    try { localStorage.setItem(BOAT_POS_KEY, JSON.stringify(boatPosition)); } catch { /* ignore */ }
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
      premium: gifts.filter((b) => b.plugin?.premium).length,
      submerged: gifts.filter((b) => !b.plugin?.premium).length,
      gifts: gifts.map((b) => ({
        name: b.plugin?.giftName,
        image: b.plugin?.img?.src || "",
        coins: b.plugin?.coins || giftCoins(b.plugin?.giftName),
        premium: !!b.plugin?.premium,
        y: Math.round(b.position.y),
      })),
      engine: "matter",
      cannon: pirateCannon?.snapshot() || null,
      cannonQueued: spawnQ.filter(cannonGift).length,
      boatLevel: displayedBoatLevel,
      totalCoins: totalLiveCoins,
    };
  };

  if (window.PirateCannon && isDuckBoat()) {
    pirateCannon = window.PirateCannon.create({
      getBounds: duckBoatBounds,
      getViewport: () => ({ w: geom?.w || window.innerWidth, h: geom?.h || window.innerHeight }),
      loadGiftImage: loadImage,
      getGiftSize: item => giftRadius(item.giftName, item.coins) * 2,
      onReturn: (item, fromCannon) => {
        // Return the original gifts exactly once. Firework copies are decorative.
        spawnQ.unshift({ ...item, cannonEligible: false, fromCannon });
        spawnWait = 0;
      },
    });
  }

  primeEventJournal();
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
    // Direct BroadcastChannel delivery is fastest. If the main page is stale,
    // disconnected, or only sent a one-off test command, resume API polling.
    if (Date.now() - lastDirectDropAt < 3000) return;
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
        if (ev.kind === "gift" && ev.gift) {
          const count = Math.max(1, Math.floor(Number(ev.count) || 1));
          // Live-stats coins is the whole combo value, not the unit price.
          const perGiftCoins = Math.max(0, Number(ev.coins) || 0) / count;
          acceptDrop(ev.gift, count, `poll:${ev.id}`, `gift:${ev.id}`, perGiftCoins, ev.giftPicture || ev.giftPictureUrl || "", giftSender(ev));
        }
      }
      if (jarSeen.size > 240) jarSeen = new Set([...jarSeen].slice(-80));
    } catch {
      /* OBS keeps last frame */
    }
  }
  pollLiveGifts();
  setInterval(pollLiveGifts, 1200);
  async function pollSultanRank() {
    if (!showSultanBalloons || !isDuckBoat()) {
      sultanRows = [];
      return;
    }
    try {
      const res = await fetch("/api/live-stats?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) {
        if (galleryMode) sultanRows = gallerySultans;
        return;
      }
      const data = await res.json();
      sultanRows = (Array.isArray(data.topGifters) ? data.topGifters : [])
        .slice()
        .sort((a, b) => (Number(b?.coins) || 0) - (Number(a?.coins) || 0))
        .slice(0, 3);
      for (const row of sultanRows) sultanAvatar(row?.avatar);
    } catch {
      /* keep the last known ranking on screen */
    }
  }
  pollSultanRank();
  setInterval(pollSultanRank, 1500);
  setInterval(drainEventJournal, 400);
})();
