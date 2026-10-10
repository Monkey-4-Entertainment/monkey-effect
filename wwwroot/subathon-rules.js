(() => {
  'use strict';
  const key = value => String(value || '').normalize('NFKC').trim().toLowerCase();
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.floor(Number(value)))) : fallback;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  function normalize(s = {}) {
    return {...s, enabled: !!s.enabled,
      secPerCoin: number(s.secPerCoin, 1, 0, 3600), secPerGift: number(s.secPerGift, 0, 0, 3600),
      secPerLike: number(s.secPerLike, 0, 0, 60),
      // Subathon accumulates time without a ceiling, including existing four-hour configurations.
      maxSeconds: 0,
      startSeconds: number(s.startSeconds ?? 300, 300, 1, 86400),
      giftRules: (Array.isArray(s.giftRules) ? s.giftRules : []).filter(r => r && key(r.giftName)).map(r => ({
        ...r, id: String(r.id || uid()), giftName: String(r.giftName).trim(), effect: r.effect === 'sub' ? 'sub' : 'add',
        seconds: number(r.seconds, 30, 0, 86400), enabled: r.enabled !== false,
      })),
    };
  }
  function delta(s, event, count, coinsFor) {
    if (!s.enabled) return 0;
    if (event.kind === 'like') return s.secPerLike * count;
    if (event.kind !== 'gift' && event.kind !== 'roulette') return 0;
    const rule = s.giftRules.find(r => r.enabled && key(r.giftName) === key(event.giftName));
    if (rule) return (rule.effect === 'sub' ? -1 : 1) * rule.seconds * count;
    return (s.secPerGift + s.secPerCoin * Math.max(0, Number(coinsFor(event.giftName)) || 0)) * count;
  }
  function create({getState, save, coinsFor, onTimerChanged}) {
    const el = id => document.getElementById(id);
    const activity = text => { if (el('subathonActivity')) el('subathonActivity').textContent = text; };
    const state = () => {const s = getState(); Object.assign(s, normalize(s)); return s;};
    let editing = null, eventQueue = Promise.resolve();
    const seen = new Map(), credits = new Map();
    let saveBusy = false;
    async function persist(message) {
      try {
        const expected = JSON.stringify(state().giftRules);
        const result = await save();
        if (!result) throw new Error('เซิร์ฟเวอร์ในเครื่องไม่ตอบกลับ');
        const stored = JSON.parse(result.config?.studioJson || '{}').subathon;
        if (!stored || JSON.stringify(stored.giftRules) !== expected) throw new Error('ยังยืนยันการบันทึกกฎไม่ได้');
        activity(message || 'บันทึกกฎแล้ว');
        return true;
      } catch (e) { activity(`เก็บในเครื่องแล้ว แต่ส่งให้ตัวจับเวลาไม่สำเร็จ: ${e.message} — กดบันทึกกฎเพื่อลองใหม่`); return false; }
    }
    async function timerRequest(body) {
      const res = await fetch('/api/live-stats/settings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
      if (!res.ok) throw new Error(`บันทึกเวลาไม่สำเร็จ (${res.status})`);
      return res.json();
    }
    function chooseEffect(effect) {
      const host = el('subathonGiftEffect'); if (!host) return;
      host.dataset.effect = effect === 'sub' ? 'sub' : 'add';
      host.querySelectorAll('[data-effect]').forEach(button => {const active = button.dataset.effect === host.dataset.effect;button.classList.toggle('is-on', active);button.setAttribute('aria-pressed', String(active));});
    }
    function resetEditor() {
      editing = null;
      if(el('subathonGiftName'))el('subathonGiftName').value = '';
      for (const [id,value] of [['subathonGiftHours',0],['subathonGiftMinutes',0],['subathonGiftSecs',30]]) if(el(id))el(id).value = value;
      chooseEffect('add');
      if(el('subathonGiftAddBtn'))el('subathonGiftAddBtn').textContent = 'เพิ่มกฎ';
    }
    function format(seconds) {return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
    function renderRules() {
      const host = el('subathonGiftRulesList'); if(!host)return;
      host.innerHTML = state().giftRules.map(r => `<article class="subathon-rule ${r.enabled?'':'is-disabled'}"><div><strong>${escape(r.giftName)}</strong><span class="subathon-rule-time ${r.effect}">${r.effect==='sub'?'−':'+'}${format(r.seconds)} / ชิ้น</span><small>${r.enabled?'เปิดใช้งาน':'ปิดใช้งาน'}</small></div><div class="subathon-rule-actions">${[['test','ทดสอบ'],['edit','แก้ไข'],['toggle',r.enabled?'ปิด':'เปิด'],['delete','ลบ']].map(([a,label])=>`<button type="button" class="btn ${a==='test'?'secondary':'ghost'} small" data-sub-action="${a}" data-rule-id="${escape(r.id)}">${label}</button>`).join('')}</div></article>`).join('') || '<p class="hint">ยังไม่มีกฎรายชิ้น — ของขวัญจะใช้ค่าวินาทีต่อเพชรด้านบน</p>';
    }
    function paint() {
      const s = state();
      if(el('subathonEnabled'))el('subathonEnabled').checked = s.enabled;
      for(const [id,field] of fields)if(el(id))el(id).value = s[field];
      renderRules();chooseEffect(el('subathonGiftEffect')?.dataset.effect);
    }
    const fields = [['subathonSecPerCoin','secPerCoin'],['subathonSecPerGift','secPerGift'],['subathonSecPerLike','secPerLike'],['subathonStartSeconds','startSeconds']];
    function readSettings() {
      const s = getState();
      if(el('subathonEnabled'))s.enabled = el('subathonEnabled').checked;
      for(const [id,field] of fields)if(el(id))s[field] = Number(el(id).value);
      Object.assign(s, normalize(s));
    }
    function units(event) {
      const count = number(event.count ?? 1, 1, 1, 2147483647);
      const eventId = Number.isFinite(event.seq) ? `seq:${event.seq}` : event.key;
      if(eventId) {if(seen.has(eventId))return 0;seen.set(eventId,true);if(seen.size>4096)seen.delete(seen.keys().next().value);}
      const now = Date.now();
      for(const [k,v] of credits)if(now-v.at>120000)credits.delete(k);
      const k = event.comboKey || `${event.kind}|${key(event.sender)}|${key(event.giftName)}`;
      const before = credits.get(k)?.count || 0;
      if(event.phase === 'game') {
        const rest = Math.max(0,before-count);
        if(rest)credits.set(k,{count:rest,at:now});else credits.delete(k);
        return Math.max(0,count-before);
      }
      // Manual tests have no phase, so they must not consume real gift credits.
      if(event.phase === 'ui')credits.set(k,{count:before+count,at:now});
      return count;
    }
    function handleEvent(event) {
      if(!event || !['gift','roulette','like'].includes(event.kind))return Promise.resolve();
      // Count even while disabled: enabling midway through a combo must not replay the UI unit.
      const count = units(event), s = state();
      const amount = delta(s,event,count,coinsFor);
      if(!amount)return Promise.resolve();
      eventQueue = eventQueue.then(async()=>{
        const result = await timerRequest({addSeconds:Math.min(2147483647,Math.max(-2147483647,amount))});
        const c = result.config || {};
        activity(c.timerRunning && c.timerEndsAt > Date.now()
          ? `${amount>0?'+':''}${amount.toLocaleString()} วินาที · ${event.giftName || 'Like'} ×${count}`
          : 'ยังไม่เริ่มหรือหมดเวลาแล้ว — กดเริ่มจับเวลาก่อนทดสอบ');
        onTimerChanged();
      }).catch(e=>activity(`ปรับเวลาไม่สำเร็จ: ${e.message} — ตรวจการเชื่อมต่อโปรแกรม`));
      return eventQueue;
    }
    el('subathonGiftEffect')?.addEventListener('click', e=>{const b=e.target.closest('[data-effect]');if(b)chooseEffect(b.dataset.effect);});
    el('subathonGiftAddBtn')?.addEventListener('click',async()=>{
      if(saveBusy)return;
      const name=el('subathonGiftName')?.value.trim();
      const inputs=['subathonGiftHours','subathonGiftMinutes','subathonGiftSecs'].map(id=>el(id));
      if(!name){activity('กรุณาใส่ชื่อของขวัญ');el('subathonGiftName')?.focus();return;}
      if(inputs.some(i=>!i || !i.checkValidity() || !Number.isInteger(Number(i.value)))){activity('กรุณาใส่เวลาเป็นจำนวนเต็มตามช่วงที่กำหนด');return;}
      const [h,m,sec]=inputs.map(i=>Number(i.value)), seconds=h*3600+m*60+sec;
      if(seconds<=0 || seconds>86400){activity('เวลาต่อชิ้นต้องมากกว่า 0 และไม่เกิน 24 ชั่วโมง');return;}
      const s=state(), existing=s.giftRules.find(r=>key(r.giftName)===key(name));
      if(existing && editing && existing.id!==editing){activity('มีชื่อของขวัญนี้แล้ว กรุณาแก้ไขกฎเดิม');return;}
      const index=s.giftRules.findIndex(r=>r.id===(editing || existing?.id));
      const rule={id:index>=0?s.giftRules[index].id:uid(),giftName:name,effect:el('subathonGiftEffect')?.dataset.effect==='sub'?'sub':'add',seconds,enabled:index>=0?s.giftRules[index].enabled:true};
      if(index>=0)s.giftRules[index]=rule;else s.giftRules.push(rule);
      saveBusy=true;
      try{renderRules();resetEditor();await persist(`${index>=0?'อัปเดต':'เพิ่ม'}กฎ ${name} แล้ว`);}finally{saveBusy=false;}
    });
    el('subathonGiftRulesList')?.addEventListener('click',async e=>{
      const b=e.target.closest('[data-sub-action]');if(!b)return;
      const s=state(),r=s.giftRules.find(r=>r.id===b.dataset.ruleId);if(!r)return;
      if(b.dataset.subAction==='edit'){
        editing=r.id;el('subathonGiftName').value=r.giftName;el('subathonGiftHours').value=Math.floor(r.seconds/3600);el('subathonGiftMinutes').value=Math.floor(r.seconds/60)%60;el('subathonGiftSecs').value=r.seconds%60;chooseEffect(r.effect);el('subathonGiftAddBtn').textContent='บันทึกการแก้ไข';el('subathonGiftName').focus();return;
      }
      if(b.dataset.subAction==='test'){
        if(!s.enabled || !r.enabled){activity('เปิดใช้ Subathon และกฎนี้ก่อนทดสอบ');return;}
        b.disabled=true;try{if(await persist())await handleEvent({kind:'gift',giftName:r.giftName,count:1,sender:'ทดสอบ'});}finally{b.disabled=false;}return;
      }
      if(b.dataset.subAction==='toggle')r.enabled=!r.enabled;
      if(b.dataset.subAction==='delete'){s.giftRules=s.giftRules.filter(v=>v.id!==r.id);if(editing===r.id)resetEditor();}
      renderRules();await persist('บันทึกรายการกฎแล้ว');
    });
    for(const id of ['subathonEnabled',...fields.map(([id])=>id)])el(id)?.addEventListener('change',()=>{readSettings();paint();persist();});
    el('subathonSaveBtn')?.addEventListener('click',async()=>{readSettings();paint();await persist('บันทึกกฎและการตั้งค่าแล้ว');});
    el('subathonStartBtn')?.addEventListener('click',async()=>{
      try{readSettings();if(!await persist())return;const s=state();await timerRequest({timerSeconds:s.startSeconds,timer:'start'});activity('เริ่มจับเวลาแล้ว');onTimerChanged();}catch(e){activity(e.message);}
    });
    el('subathonStopBtn')?.addEventListener('click',async()=>{try{await timerRequest({timer:'stop'});activity('หยุดจับเวลาแล้ว');onTimerChanged();}catch(e){activity(e.message);}});
    return {paint,handleEvent};
  }
  window.MonkeySubathon = {normalize,delta,create};
})();
