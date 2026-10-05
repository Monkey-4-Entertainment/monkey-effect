(() => {
  'use strict';
  const KEY = 'me_sultan_layout_v1';
  const DEFAULT = [{ x: 50, y: 0 }, { x: 23.5, y: 55 }, { x: 76.5, y: 55 }];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const normalize = value => DEFAULT.map((fallback, i) => {
    const p = Array.isArray(value) ? value[i] : null;
    return {
      x: typeof p?.x === 'number' && Number.isFinite(p.x) ? clamp(p.x, 0, 100) : fallback.x,
      y: typeof p?.y === 'number' && Number.isFinite(p.y) ? clamp(p.y, 0, 100) : fallback.y,
    };
  });
  function readAll() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { live: normalize(data.live), all: normalize(data.all) };
    } catch { return { live: normalize(), all: normalize() }; }
  }
  function writeAll(data) { localStorage.setItem(KEY, JSON.stringify({ live: normalize(data.live), all: normalize(data.all) })); }
  function create({ root, edit, scope }) {
    let layout = normalize(), saved = normalize(), dirty = false, drag = null;
    function notify(event = 'change') {
      if (edit && window.parent !== window) window.parent.postMessage({ type: 'monkey-sultan-layout', event, scope, layout, dirty }, location.origin);
    }
    function apply() {
      const list = root.querySelector('.sultan-list');
      if (!list) return;
      root.querySelector('.sultan-wrap')?.classList.toggle('is-editable', edit);
      const area = list.getBoundingClientRect();
      if (!area.width || !area.height) return;
      list.querySelectorAll('.sultan-row').forEach((row, i) => {
        const box = row.getBoundingClientRect();
        const half = box.width / area.width * 50;
        const x = clamp(layout[i].x, half, 100 - half);
        const y = clamp(layout[i].y, 0, Math.max(0, 100 - box.height / area.height * 100));
        row.style.left = x + '%';
        row.style.top = y + '%';
        if (edit) {
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.setAttribute('aria-label', `ย้ายอันดับ ${i + 1} ลากรูปหรือใช้ปุ่มลูกศร`);
          row.title = 'ลากเพื่อย้าย หรือใช้ปุ่มลูกศร';
        }
      });
    }
    function move(index, x, y) {
      const list = root.querySelector('.sultan-list');
      const row = list?.querySelector(`[data-rank="${index + 1}"]`);
      if (!row) return;
      const area = list.getBoundingClientRect(), box = row.getBoundingClientRect();
      const half = box.width / area.width * 50;
      layout[index] = {
        x: Math.round(clamp(x, half, 100 - half) * 100) / 100,
        y: Math.round(clamp(y, 0, Math.max(0, 100 - box.height / area.height * 100)) * 100) / 100,
      };
      apply();
    }
    function finish(cancelled) {
      if (!drag) return;
      const pointer = drag.pointer;
      if (cancelled) layout = drag.before;
      root.querySelector('.sultan-row.is-dragging')?.classList.remove('is-dragging');
      drag = null;
      if (root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer);
      dirty = JSON.stringify(layout) !== JSON.stringify(saved);
      apply();
      notify();
    }
    if (edit) {
      root.addEventListener('dragstart', e => e.preventDefault());
      root.addEventListener('pointerdown', e => {
        if (e.button !== 0 || drag) return;
        const row = e.target.closest('.sultan-row');
        const list = root.querySelector('.sultan-list');
        if (!row || !list) return;
        e.preventDefault();
        row.focus({ preventScroll: true });
        const index = Number(row.dataset.rank) - 1;
        const area = list.getBoundingClientRect();
        // Begin from the visible, clamped position after a resize or a longer name.
        const box = row.getBoundingClientRect();
        move(index, (box.left + box.width / 2 - area.left) / area.width * 100, (box.top - area.top) / area.height * 100);
        drag = { index, pointer: e.pointerId, x: e.clientX, y: e.clientY, area, start: { ...layout[index] }, before: normalize(layout) };
        row.classList.add('is-dragging');
        root.setPointerCapture(e.pointerId);
      });
      root.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.pointer) return;
        e.preventDefault();
        move(drag.index, drag.start.x + (e.clientX - drag.x) / drag.area.width * 100, drag.start.y + (e.clientY - drag.y) / drag.area.height * 100);
      });
      root.addEventListener('pointerup', e => { if (e.pointerId === drag?.pointer) finish(false); });
      root.addEventListener('pointercancel', e => { if (e.pointerId === drag?.pointer) finish(true); });
      root.addEventListener('lostpointercapture', () => finish(true));
      root.addEventListener('keydown', e => {
        if (e.key === 'Escape' && drag) { e.preventDefault(); finish(true); return; }
        const row = e.target.closest('.sultan-row');
        const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!row || !dirs[e.key] || drag) return;
        e.preventDefault();
        const i = Number(row.dataset.rank) - 1, step = e.shiftKey ? 5 : 1;
        move(i, layout[i].x + dirs[e.key][0] * step, layout[i].y + dirs[e.key][1] * step);
        dirty = JSON.stringify(layout) !== JSON.stringify(saved);
        notify();
      });
      window.addEventListener('message', e => {
        if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'monkey-sultan-layout-command') return;
        if (drag) finish(true);
        if (e.data.command === 'reset') {
          layout = normalize();
          dirty = JSON.stringify(layout) !== JSON.stringify(saved);
        } else if (e.data.command === 'saved') {
          saved = normalize(e.data.layout);
          dirty = JSON.stringify(layout) !== JSON.stringify(saved);
        } else return;
        apply(); notify(e.data.command === 'saved' ? 'saved' : 'change');
      });
    }
    window.addEventListener('resize', apply);
    return {
      isDragging: () => !!drag,
      sync(value) {
        if (drag || (edit && dirty)) return;
        const next = normalize(value);
        if (JSON.stringify(next) === JSON.stringify(layout)) return;
        layout = next; saved = normalize(next); apply(); notify('ready');
      },
      mount() { apply(); notify('ready'); },
    };
  }
  function configurePreview(modal, url, id) {
    let controls = modal.querySelector('.og-sultan-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'og-sultan-controls';
      controls.innerHTML = '<p>ลากรูปหรือชื่อเพื่อย้ายแต่ละอันดับ แล้วกดบันทึก</p><div><button type="button" class="btn ghost small" data-sultan-reset>คืนตำแหน่งเดิม</button><button type="button" class="btn primary small" data-sultan-save disabled>บันทึกตำแหน่ง</button></div><span role="status" data-sultan-status>กำลังโหลดตำแหน่ง…</span>';
      modal.querySelector('.og-preview-bar').after(controls);
      const frame = modal.querySelector('#ogPreviewFrame');
      const reset = controls.querySelector('[data-sultan-reset]');
      const save = controls.querySelector('[data-sultan-save]');
      const status = controls.querySelector('[data-sultan-status]');
      const command = (cmd, layout) => frame.contentWindow?.postMessage({ type: 'monkey-sultan-layout-command', command: cmd, layout }, location.origin);
      window.addEventListener('message', e => {
        const state = controls._state;
        if (!state || e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== 'monkey-sultan-layout' || e.data.scope !== state.scope) return;
        state.layout = normalize(e.data.layout);
        state.dirty = !!e.data.dirty;
        reset.disabled = !!state.saving;
        save.disabled = !!state.saving || !state.dirty;
        if (!state.saving) status.textContent = state.dirty ? 'มีตำแหน่งที่ยังไม่บันทึก' : e.data.event === 'saved' ? 'บันทึกตำแหน่งแล้ว' : 'พร้อมจัดตำแหน่ง · ใช้ปุ่มลูกศรเลื่อนได้';
      });
      reset.addEventListener('click', () => command('reset'));
      save.addEventListener('click', async () => {
        const state = controls._state;
        if (!state || !state.layout || state.saving) return;
        const submitted = normalize(state.layout);
        state.saving = true; save.disabled = true; reset.disabled = true;
        status.textContent = 'กำลังบันทึก…';
        try {
          await window.saveSultanLayout(state.scope, submitted);
          if (controls._state !== state) return;
          state.saving = false;
          command('saved', submitted);
          status.textContent = 'บันทึกตำแหน่งแล้ว';
        } catch {
          if (controls._state !== state) return;
          state.saving = false;
          status.textContent = 'บันทึกไม่สำเร็จ กดบันทึกอีกครั้ง';
          save.disabled = false; reset.disabled = false;
        }
      });
    }
    const enabled = id === 'topgifters' || id === 'topgifters-all';
    controls.hidden = !enabled;
    controls._state = enabled ? { scope: id === 'topgifters-all' ? 'all' : 'live', dirty: false, saving: false } : null;
    if (!enabled) return url;
    controls.querySelector('[data-sultan-save]').disabled = true;
    controls.querySelector('[data-sultan-reset]').disabled = true;
    controls.querySelector('[data-sultan-status]').textContent = 'กำลังโหลดตำแหน่ง…';
    const next = new URL(url, location.href);
    next.searchParams.set('edit', '1');
    return next.pathname + next.search;
  }
  window.MonkeySultanLayout = { normalize, readAll, writeAll, create, configurePreview };
})();
