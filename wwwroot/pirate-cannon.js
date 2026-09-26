(() => {
  "use strict";
  const SHOT_AT = 1150, BURST_AT = 2450, FADE_AT = 4500, RETURN_AT = 4800, END_AT = 6600;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const ease = n => { const p = clamp(n, 0, 1); return p * p * (3 - 2 * p); };
  const mix = (a, b, p) => a + (b - a) * p;
  const safeAvatar = raw => {
    const url = String(raw || "").trim();
    return /^https?:\/\//i.test(url) || /^\/(?:api\/avatar(?:\?|\/)|avatar-cache\/|avatars\/|media-cache\/)/i.test(url) ? url : "";
  };

  function create({ getBounds, getViewport, loadGiftImage, getGiftSize, onReturn }) {
    let active = null;
    const card = document.createElement("section");
    card.className = "pirate-salute";
    card.hidden = true;
    card.setAttribute("aria-live", "polite");
    // Only fixed markup is inserted. All sender/gift content uses textContent.
    card.innerHTML = '<p class="pirate-salute__heading">ขอบคุณสำหรับของขวัญ</p><div class="pirate-salute__portrait"><span class="pirate-salute__initial"></span><img class="pirate-salute__avatar" alt="รูปผู้ส่ง" hidden></div><h2 class="pirate-salute__name"></h2><p class="pirate-salute__gift"><img alt=""><span></span></p>';
    document.body.appendChild(card);
    const nameEl = card.querySelector(".pirate-salute__name");
    const initial = card.querySelector(".pirate-salute__initial");
    const avatar = card.querySelector(".pirate-salute__avatar");
    const giftIcon = card.querySelector(".pirate-salute__gift img");
    const giftLabel = card.querySelector(".pirate-salute__gift span");

    function play(item, now) {
      if (active || !getBounds()) return false;
      const name = String(item.sender?.name || "ผู้ส่งของขวัญ").trim().slice(0, 100);
      nameEl.textContent = name;
      initial.textContent = Array.from(name)[0] || "★";
      avatar.hidden = true;
      avatar.onload = null; avatar.onerror = null;
      avatar.removeAttribute("src");
      const avatarUrl = safeAvatar(item.sender?.avatar);
      if (avatarUrl) {
        avatar.onload = () => { avatar.hidden = false; };
        avatar.onerror = () => { avatar.hidden = true; };
        avatar.src = avatarUrl;
      }
      const img = loadGiftImage(item.giftName, item.picture);
      giftIcon.hidden = false;
      giftIcon.onerror = () => { giftIcon.hidden = true; };
      giftIcon.src = img.src;
      giftLabel.textContent = item.giftName + (item.left > 1 ? ` ×${item.left}` : "");
      card.classList.remove("is-visible");
      card.hidden = true;
      active = { item, img, startedAt: now, elapsed: 0, fired: false, revealed: false, returned: false, origin: null };
      return true;
    }

    function cannonPose(t) {
      const b = getBounds();
      if (!b) return null;
      const { w, h } = getViewport();
      const size = clamp(b.w * .38, Math.min(28, w * .07), Math.min(106, w * .19));
      const lift = ease(t / 700) * (1 - ease((t - FADE_AT) / 550));
      const x = b.cx + b.w * .14;
      const y = b.boatY - b.h * .21 - size * .20 * lift;
      const targetAngle = Math.atan2(h * .36 - y, w * .5 - x);
      const angle = mix(-.18, targetAngle, ease((t - 300) / 700));
      const recoil = t >= SHOT_AT ? Math.exp(-(t - SHOT_AT) / 130) * size * .19 : 0;
      const length = size * .96 - recoil;
      return { x, y, size, lift, angle, length, muzzleX: x + Math.cos(angle) * length, muzzleY: y + Math.sin(angle) * length };
    }

    function update(now) {
      if (!active) return;
      const t = active.elapsed = Math.max(0, now - active.startedAt);
      if (!active.fired && t >= SHOT_AT) {
        const p = cannonPose(SHOT_AT), v = getViewport();
        if (p) active.origin = { x: p.muzzleX / v.w, y: p.muzzleY / v.h };
        active.fired = true;
      }
      if (!active.revealed && t >= BURST_AT) {
        card.hidden = false;
        // Flush initial style so the reveal is an actual transition.
        void card.offsetWidth;
        card.classList.add("is-visible");
        active.revealed = true;
      }
      if (t >= FADE_AT) card.classList.remove("is-visible");
      if (!active.returned && t >= RETURN_AT) {
        // Hand the same image to one real balloon per received gift, at the
        // exact position/size used by the re-forming center-screen gift.
        active.returned = true;
        card.hidden = true;
        onReturn(active.item, { x: .5, y: .36, duration: END_AT - RETURN_AT });
      }
      if (t >= END_AT) {
        active = null;
        card.hidden = true;
      }
    }

    function circle(ctx, x, y, r, fill) {
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, Math.max(.01, r), 0, Math.PI * 2); ctx.fill();
    }

    function drawCannon(ctx, p, t) {
      if (!p || p.lift <= 0) return;
      const { x, y, size: s, angle, length } = p;
      ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= p.lift;
      ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = s * .12;
      ctx.fillStyle = "#694631"; ctx.beginPath(); ctx.roundRect(-s * .38, 0, s * .76, s * .26, s * .06); ctx.fill();
      ctx.strokeStyle = "#c59145"; ctx.lineWidth = 2; ctx.stroke();
      for (const wheelX of [-.27, .27]) {
        circle(ctx, s * wheelX, s * .24, s * .13, "#142835");
        circle(ctx, s * wheelX, s * .24, s * .085, "#c79c54");
        circle(ctx, s * wheelX, s * .24, s * .036, "#354f5a");
      }
      ctx.rotate(angle);
      const steel = ctx.createLinearGradient(0, -s * .16, 0, s * .16);
      steel.addColorStop(0, "#182935"); steel.addColorStop(.3, "#8298a4");
      steel.addColorStop(.49, "#d4dedf"); steel.addColorStop(.58, "#49616d"); steel.addColorStop(1, "#11212c");
      ctx.fillStyle = steel; ctx.beginPath(); ctx.roundRect(-s * .22, -s * .15, length + s * .22, s * .30, s * .11); ctx.fill();
      ctx.strokeStyle = "#d3ad63"; ctx.lineWidth = s * .055;
      for (const at of [.15, .70]) { ctx.beginPath(); ctx.moveTo(length * at, -s * .15); ctx.lineTo(length * at, s * .15); ctx.stroke(); }
      ctx.fillStyle = "#eacb89"; ctx.beginPath(); ctx.ellipse(length, 0, s * .065, s * .185, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#071117"; ctx.beginPath(); ctx.ellipse(length + s * .012, 0, s * .039, s * .125, 0, 0, Math.PI * 2); ctx.fill();
      const blast = (t - SHOT_AT) / 340;
      if (blast >= 0 && blast < 1) {
        ctx.globalAlpha *= 1 - blast;
        ctx.fillStyle = "#ffe9af"; ctx.shadowColor = "#ffad40"; ctx.shadowBlur = s * .55;
        ctx.beginPath(); ctx.moveTo(length, -s * .10); ctx.lineTo(length + s * (1.6 - blast), -s * .26);
        ctx.lineTo(length + s * 1.15, 0); ctx.lineTo(length + s * 1.5, s * .29); ctx.lineTo(length, s * .10); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      const smokeT = (t - SHOT_AT) / 1100;
      if (smokeT >= 0 && smokeT < 1) {
        for (let i = 0; i < 7; i++) {
          circle(ctx, p.muzzleX + Math.sin(i * 2.4) * s * smokeT * .6,
            p.muzzleY - smokeT * s * (1 + i * .14), s * (.09 + smokeT * .22), `rgba(210,224,230,${(1 - smokeT) * .14})`);
        }
      }
    }

    function projectile(p) {
      const v = getViewport(), start = active.origin || { x: .5, y: .7 };
      // A continuous curved path starts exactly at the raised muzzle.
      const x0 = start.x * v.w, y0 = start.y * v.h;
      const x1 = mix(x0, v.w * .5, .25), y1 = mix(y0, v.h * .36, .7);
      return { x: (1-p)**2*x0 + 2*(1-p)*p*x1 + p*p*v.w*.5,
        y: (1-p)**2*y0 + 2*(1-p)*p*y1 + p*p*v.h*.36 };
    }

    function drawFirework(ctx, t) {
      const { w, h } = getViewport(), cx = w * .5, cy = h * .36;
      const age = (t - BURST_AT) / 1000;
      if (age < 0 || age > 3.65) return;
      const radius = Math.min(w * .38, h * .20);
      const colors = ["#ffe4a2", "#ffc66c", "#80e8ec", "#ffffff", "#fc91b3"];
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      if (age < .45) {
        const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * .72);
        glow.addColorStop(0, `rgba(255,240,202,${(1 - age / .45) * .7})`);
        glow.addColorStop(.3, `rgba(255,183,92,${(1 - age / .45) * .22})`);
        glow.addColorStop(1, "rgba(255,183,92,0)");
        circle(ctx, cx, cy, radius * .72, glow);
        ctx.strokeStyle = `rgba(255,229,171,${1 - age / .45})`; ctx.lineWidth = Math.max(1, 6 * (1 - age / .45));
        ctx.beginPath(); ctx.arc(cx, cy, radius * age * 1.8 + 4, 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < 112; i++) {
        const delay = i % 4 * .055, a = age - delay;
        if (a < 0 || a > 2.7) continue;
        const theta = i * 2.39996323;
        const speed = radius * (.50 + (i % 9) / 13);
        const dist = speed * (1 - Math.exp(-a * 1.75));
        const x = cx + Math.cos(theta) * dist, y = cy + Math.sin(theta) * dist + a*a*radius*.13;
        const alpha = (1 - a / 2.7) * (.6 + Math.sin(i + a * 16) ** 2 * .4);
        ctx.globalAlpha = alpha; ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = clamp(w * .003, 1, 2.3);
        const previous = Math.max(0, a - .12);
        const previousDist = speed * (1 - Math.exp(-previous * 1.75));
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(theta) * previousDist,
          cy + Math.sin(theta) * previousDist + previous*previous*radius*.13); ctx.lineTo(x, y); ctx.stroke();
        circle(ctx, x, y, clamp(w * .002, .7, 1.5), "#fff5d6");
      }
      ctx.restore();
      // Decorative copies do not become physics bodies or count as gifts.
      if (active.img.complete && active.img.naturalWidth) {
        ctx.save();
        for (let i = 0; i < 20; i++) {
          const a = age - i % 3 * .08;
          if (a < 0 || a > 2.55) continue;
          const theta = i * Math.PI * 2 / 20;
          const distance = radius * (.42 + i % 4 * .11) * (1 - Math.exp(-a * 2));
          const size = clamp(w * .047, 13, 36) * (1 - a * .15);
          ctx.save(); ctx.globalAlpha = Math.min(1, a * 8) * Math.max(0, 1 - a / 2.55);
          ctx.translate(cx + Math.cos(theta) * distance, cy + Math.sin(theta) * distance + a*a*radius*.095);
          ctx.rotate(Math.sin(i * 3) * a); ctx.drawImage(active.img, -size/2, -size/2, size, size); ctx.restore();
        }
        ctx.restore();
      }
    }

    function draw(ctx) {
      if (!active) return;
      const t = active.elapsed;
      drawCannon(ctx, cannonPose(t), t);
      if (t >= SHOT_AT && t < BURST_AT) {
        const p = clamp((t - SHOT_AT) / (BURST_AT - SHOT_AT), 0, 1);
        const v = getViewport(), point = projectile(p);
        ctx.save();
        for (let i = 14; i > 0; i--) {
          const tail = projectile(Math.max(0, p - i * .011));
          circle(ctx, tail.x, tail.y, (15 - i) * Math.min(1.1, v.w / 600), `rgba(255,203,110,${(15-i)/36})`);
        }
        ctx.translate(point.x, point.y); ctx.rotate(Math.sin(p * Math.PI * 2) * .15);
        const size = clamp(v.w * .095, 30, 78) * (.65 + p * .35);
        ctx.shadowColor = "#ffd280"; ctx.shadowBlur = 20;
        if (active.img.complete && active.img.naturalWidth) ctx.drawImage(active.img, -size/2, -size/2, size, size);
        else circle(ctx, 0, 0, size * .35, "#ffdf90");
        ctx.restore();
      }
      drawFirework(ctx, t);
      const reformAt = BURST_AT + 1200;
      if (t >= reformAt && !active.returned) {
        const v = getViewport();
        const p = ease((t - reformAt) / (RETURN_AT - reformAt));
        const finalSize = Math.max(8, Math.round(getGiftSize(active.item)));
        const size = mix(clamp(v.w * .095, 30, 78), finalSize, p);
        ctx.save(); ctx.globalAlpha = ease((t - reformAt) / 350);
        ctx.shadowColor = "#ffe3a3"; ctx.shadowBlur = 18 * (1 - p);
        if (active.img.complete && active.img.naturalWidth) ctx.drawImage(active.img, v.w*.5-size/2, v.h*.36-size/2, size, size);
        else circle(ctx, v.w*.5, v.h*.36, size*.35, "#ffdf90");
        ctx.restore();
      }
    }

    function reset() {
      active = null; card.hidden = true; card.classList.remove("is-visible");
      avatar.onload = null; avatar.onerror = null; avatar.removeAttribute("src");
    }

    return { play, update, draw, reset,
      get busy() { return !!active; },
      get reserved() { return active && !active.returned ? active.item.left : 0; },
      snapshot() { return active ? { gift: active.item.giftName, sender: active.item.sender?.name || "", elapsed: active.elapsed,
        phase: active.elapsed < SHOT_AT ? "raise" : active.elapsed < BURST_AT ? "flight" : active.elapsed < RETURN_AT ? "fireworks" : "return" } : null; },
    };
  }
  window.PirateCannon = { create };
})();
