(() => {
  'use strict';
  const $=id=>document.getElementById(id), names=['ลูกแมว','จอมซน','นักสำรวจ','อ้วนฟู','ผู้พิทักษ์','ราชาแมวส้ม'], coins=[0,10,100,1000,5000,10000];
  let initialized=false, selected=null;
  const status=text=>$('petStatus').textContent=text;
  const send=data=>$('petPreview').contentWindow?.postMessage(data,location.origin);
  const select=stage=>{selected=stage;send({type:'pet-stage',stage});document.querySelectorAll('.pet-stage').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===stage)));};
  for(let i=0;i<6;i++){
    const button=document.createElement('button');button.type='button';button.className='pet-stage';button.setAttribute('aria-pressed','false');
    const art=document.createElement('div');art.className='pet-stage-art';art.style.backgroundPosition=`${(i%3)*50}% ${i<3?0:100}%`;
    art.dataset.stage=i;
    const name=document.createElement('span');name.className='pet-stage-name';name.textContent=names[i];const lv=document.createElement('small');lv.textContent=`${coins[i].toLocaleString()} Coins`;
    button.append(art,name,lv);button.onclick=()=>select(i);$('petStages').append(button);
  }
  $('petPreview').addEventListener('load',()=>select(selected));
  const url=new URL('/pet-cat-overlay.html',location.origin).href;$('petUrl').value=url;
  $('petActual').onclick=()=>select(null);
  $('petReact').onclick=()=>send({type:'pet-react'});
  $('petPremiumTest').onclick=()=>send({type:'pet-premium'});
  $('petOpen').onclick=()=>window.open(url,'_blank','width=480,height=600');
  $('petCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url);status('คัดลอกลิงก์แล้ว');}catch{$('petUrl').select();status('เลือกลิงก์ไว้แล้ว กด Ctrl+C เพื่อคัดลอก');}};
  function show(data){
    $('petCurrent').textContent=`${data.settings.name} · LV ${data.level.toLocaleString('th-TH')}`;
    $('petProgressText').textContent=`สะสม ${data.coins.toLocaleString('th-TH')} Coins · ${names[data.stage]}${data.nextStageCoins?` · โตช่วงถัดไป ${data.nextStageCoins.toLocaleString()} Coins`:' · โตเต็มวัยแล้ว ยังสะสม Coins ต่อได้'}`;
    if(data.error) status(data.error);
    if(!initialized){$('petName').value=data.settings.name;$('petEnabled').checked=data.settings.enabled;$('petShowName').checked=data.settings.showName;$('petShowProgress').checked=data.settings.showProgress;$('petShowGifts').checked=data.settings.showGifts;initialized=true;}
  }
  $('petSave').onclick=async()=>{
    const name=$('petName').value.trim();
    if(!name||name.length>30){status('ใส่ชื่อแมว 1–30 ตัวอักษร');return;}
    $('petSave').disabled=true;
    try{const r=await fetch('/api/pets/orange-cat',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,enabled:$('petEnabled').checked,showName:$('petShowName').checked,showProgress:$('petShowProgress').checked,showGifts:$('petShowGifts').checked}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('save');show(await r.json());status('บันทึกแล้ว · Coins เดิมยังอยู่');}catch{status('บันทึกไม่สำเร็จ กรุณาตรวจว่า Monkeyeffect ยังเปิดอยู่ แล้วลองอีกครั้ง');}finally{$('petSave').disabled=false;}
  };
  async function poll(){try{if(!initialized||$('panel-pet').classList.contains('active')){const r=await fetch('/api/pets/orange-cat',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('load');show(await r.json());}}catch{status('เชื่อมต่อข้อมูลแมวไม่ได้ กำลังลองใหม่…');}setTimeout(poll,2000);}
  poll();
})();
