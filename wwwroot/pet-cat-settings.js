(() => {
  'use strict';const $=id=>document.getElementById(id),api='/api/pets/orange-cat';let cfg={},busy=false,chain=Promise.resolve();
  const flags=['Enabled','Locked','ShowName','ShowProgress','ShowGifts','ShowRanks'];
  const status=text=>$('catSaveStatus').textContent=text;
  function fill(){ $('cfgName').value=cfg.name;for(const name of ['Cat','Rank']){$('cfg'+name+'Scale').value=cfg[name.toLowerCase()+'Scale'];$(name.toLowerCase()+'ScaleValue').textContent=cfg[name.toLowerCase()+'Scale']+'%';}for(const k of flags)$('cfg'+k).checked=cfg[k[0].toLowerCase()+k.slice(1)]; }
  function patch(values){busy=true;status('กำลังบันทึก…');chain=chain.catch(()=>{}).then(async()=>{const r=await fetch(api,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});if(!r.ok)throw Error('save');cfg=(await r.json()).settings;status('บันทึกแล้ว · Overlay เปลี่ยนตามทันที');}).catch(()=>status('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')).finally(()=>busy=false);return chain;}
  $('cfgName').onchange=()=>patch({name:$('cfgName').value});
  for(const name of ['Cat','Rank']){const input=$('cfg'+name+'Scale');input.oninput=()=>{$(name.toLowerCase()+'ScaleValue').textContent=input.value+'%';};input.onchange=()=>patch({[name.toLowerCase()+'Scale']:Number(input.value)});}
  for(const k of flags)$('cfg'+k).onchange=e=>patch({[k[0].toLowerCase()+k.slice(1)]:e.target.checked});
  $('cfgSave').onclick=()=>{const value={name:$('cfgName').value,catScale:Number($('cfgCatScale').value),rankScale:Number($('cfgRankScale').value)};for(const k of flags)value[k[0].toLowerCase()+k.slice(1)]=$('cfg'+k).checked;patch(value);};
  $('cfgResetPosition').onclick=()=>patch({catX:53,catY:66,catScale:45,rankX:3,rankY:3,rankScale:43,rank1X:0,rank1Y:0,rank2X:0,rank2Y:0,rank3X:0,rank3Y:0}).then(fill);
  const url=new URL('/pet-cat-overlay.html',location.origin).href;
  $('openCatWindow').onclick=()=>window.open(url,'monkeyeffect_cat_overlay','width=432,height=768');
  $('copyCatUrl').onclick=()=>navigator.clipboard.writeText(url).then(()=>status('คัดลอกแล้ว')).catch(()=>status(url));
  async function preview(payload){try{const r=await fetch(api+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)throw Error();status('ส่งไปยัง Overlay ที่เปิดอยู่แล้ว');}catch{status('ส่งตัวอย่างไม่สำเร็จ กรุณาลองอีกครั้ง');}}
  [0,10,100,1000,5000].forEach((coins,stage)=>{const b=document.createElement('button');b.textContent=`LV ${stage+1} · ${coins.toLocaleString()}`;b.onclick=()=>preview({action:'stage',stage});$('catStages').append(b);});
  $('testSmall').onclick=()=>preview({action:'gift',name:'Rose',count:10,coins:1});$('testBig').onclick=()=>preview({action:'gift',name:'Confetti',count:1,coins:100});
  for(const [id,action] of [['testEvolution','evolve'],['testRanks','ranks'],['testEnd','reset']])$(id).onclick=()=>preview({action});
  async function poll(){try{const r=await fetch(api,{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();$('catConnection').textContent=`Coins จริง ${data.coins.toLocaleString()} · LV ${data.level}/5`;if(!busy&&!document.activeElement?.matches('input')){cfg=data.settings;fill();}}catch{status('เชื่อมต่อโปรแกรมไม่ได้');}setTimeout(poll,1500);}poll();
})();

