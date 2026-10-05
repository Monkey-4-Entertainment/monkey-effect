(() => {
  const styles = Object.freeze([
    { id: "classic", name: "Classic", description: "โล่หรู · พื้นหลังใส" },
    { id: "aurora", name: "Aurora", description: "แสงไล่สี · นุ่มละมุน" },
    { id: "orbit", name: "Orbit", description: "วงโคจร · ล้ำสมัย" },
    { id: "minimal", name: "Minimal", description: "เส้นบาง · เรียบหรู" },
  ]);
  const tiers = Object.freeze([
    { id: "silver", name: "เงิน", range: "LV 20–29", detail: "ประกายเงิน", mark: "✧" },
    { id: "gold", name: "ทอง", range: "LV 30–39", detail: "มงกุฎทอง", mark: "♛" },
    { id: "platinum", name: "แพลตินัม", range: "LV 40–49", detail: "คริสตัลน้ำแข็ง", mark: "✦" },
    { id: "diamond", name: "เพชร", range: "LV 50+", detail: "อัญมณีออโรรา", mark: "◇" },
  ]);
  function tierPicker(kind = "demo") {
    const attr = kind === "test" ? "data-welcome-test" : "data-welcome-demo";
    return `<div class="welcome-tier-picks" role="group" aria-label="ตัวอย่างตามระดับ">${tiers.map((tier) =>
      `<button type="button" class="welcome-tier-card" ${attr}="${tier.id}" aria-pressed="false">
        <span class="welcome-tier-symbol" aria-hidden="true">${tier.mark}</span>
        <span>ตัวอย่าง${tier.name}</span><strong>${tier.range}</strong><small>${tier.detail}</small>
      </button>`).join("")}</div>`;
  }
  function paintTier(value, scope = document) {
    const selected = tiers.some((tier) => tier.id === value) ? value : "silver";
    scope.querySelectorAll(".welcome-style-picks").forEach((picker) => { picker.dataset.welcomeTier = selected; });
    scope.querySelectorAll("[data-welcome-test], [data-welcome-demo]").forEach((button) => {
      const on = (button.dataset.welcomeTest || button.dataset.welcomeDemo) === selected;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }
  function ornament(tier) {
    const art = {
      silver: '<path d="M17 16v8m-4-4h8M83 73v8m-4-4h8"/><path d="M38 6q12-4 24 0M38 94q12 4 24 0" opacity=".6"/>',
      gold: '<path d="M40 10 38 2 45 6 50 0 55 6 62 2 60 10Z" fill="currentColor" stroke="none"/><path d="M39 13h22M20 74q6 14 19 17M80 74q-6 14-19 17"/><path d="m25 83-7-2 3 6m9 2-6 1 5 4m46-11 7-2-3 6m-9 2 6 1-5 4"/>',
      platinum: '<path d="m50 0 4 8-4 8-4-8Zm-8 8h16M5 35 0 50l5 15M95 35l5 15-5 15M9 40 5 50l4 10M91 40l4 10-4 10"/><path d="M44 94h12M47 97h6"/>',
      diamond: '<path d="m50 0 7 7-7 9-7-9Zm-7 7h14m-7-7-3 7 3 9 3-9Z"/><path d="m5 43 4 7-4 7-4-7Zm90 0 4 7-4 7-4-7ZM50 88l5 6-5 6-5-6Z" fill="currentColor" stroke="none"/><path d="M18 16v8m-4-4h8m60 56v8m-4-4h8"/>',
      fan: '<path d="M50 12c-14-8-9-16 0-10 9-6 14 2 0 10Z" fill="currentColor" stroke="none"/>',
    };
    return `<svg class="welcome-tier-ornament" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art[tier] || art.silver}</svg>`;
  }
  function normalize(value) {
    return styles.some((style) => style.id === value) ? value : "classic";
  }
  function picker(value) {
    const selected = normalize(value);
    return `<div class="welcome-style-picks" data-welcome-tier="silver" role="group" aria-label="รูปแบบกรอบต้อนรับ">${styles.map((style) =>
      `<button type="button" class="welcome-style-option" data-welcome-style="${style.id}" aria-pressed="${style.id === selected}">
        <span class="welcome-style-swatch welcome-swatch-${style.id}" aria-hidden="true"><i></i></span>
        <strong>${style.name}</strong><span>${style.description}</span>
        <span class="welcome-style-check" aria-hidden="true">✓</span>
      </button>`).join("")}</div>`;
  }
  function paint(value) {
    document.querySelectorAll("[data-welcome-style-picker]").forEach((host) => {
      // Keep the focused button in place when changing a style with the keyboard.
      if (!host.querySelector("[data-welcome-style]")) host.innerHTML = picker(value);
      host.querySelectorAll("[data-welcome-style]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.welcomeStyle === normalize(value)));
      });
    });
  }
  window.MonkeyWelcomeDesigns = Object.freeze({ styles, tiers, normalize, picker, paint, tierPicker, paintTier, ornament });
})();
