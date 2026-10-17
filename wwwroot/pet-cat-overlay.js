(() => {
  'use strict';
  const $=id=>document.getElementById(id),scene=$('catScene'),g=window.catGifts;
  const names=['ลูกแมวง่วงนอน','เจ้าส้มจอมซน','นักสำรวจ','ผู้พิทักษ์','ราชาแมวส้ม'],thresholds=[0,10,100,1000,5000],atlas=[0,1,2,4,5];
  const defaults={name:'เจ้าส้ม',enabled:true,showName:true,showProgress:true,showGifts:true,catScale:45,catX:53,catY:66,locked:false,showRanks:true,rankScale:43,rankX:3,rankY:3};
  let cfg={...defaults},state=null,cursor=null,epoch=null,shownStage=null,targetStage=0,demoStage=null,demoRanks=false,rankRows=[],actions=[],busy=false,activeAction=null,drag=null,dirty=false,saving=0,saveChain=Promise.resolve(),run=0,bubbleTimer,liveError=false;
  let demoCoins=0,positionRevision=0;
  const stageFor=coins=>Math.max(0,thresholds.findLastIndex(n=>coins>=n));
  const effectiveCoins=()=>Math.min(Number.MAX_SAFE_INTEGER,(state?.coins||0)+demoCoins);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const safeImage=url=>typeof url==='string'&&/^https?:\/\//i.test(url)?url:'';
  function avatar(image,fallback,url,name){const src=safeImage(url);fallback.textContent=String(name||'?').trim().slice(0,1)||'?';image.hidden=!src;fallback.hidden=!!src;if(src&&image.getAttribute('src')!==src)image.src=src;image.onerror=()=>{image.hidden=true;fallback.hidden=false;};}
  function notify(text){$('catSaveStatus').textContent=text;}
  function showBubble(text){clearTimeout(bubbleTimer);$('catBubble').textContent=text;$('catBubble').classList.add('show');bubbleTimer=setTimeout(()=>$('catBubble').classList.remove('show'),2600);}
  function paintStage(stage){
    const index=atlas[stage];$('catSprite').style.backgroundPosition=`${index%3*50}% ${index<3?0:100}%`;$('catSprite').dataset.atlas=index;$('catSprite').setAttribute('aria-label',names[stage]);$('catMotion').dataset.stage=stage;$('catActor').dataset.stage=stage;
    $('catLevel').textContent=`LV ${stage+1}`;$('catStageName').textContent=names[stage];
    const coins=demoStage===null?effectiveCoins():thresholds[stage];const progress=stage===4?100:(coins-thresholds[stage])/(thresholds[stage+1]-thresholds[stage])*100;
    $('catFill').style.width=`${Math.max(0,Math.min(100,progress))}%`;$('catCoins').textContent=`${coins.toLocaleString()}${stage<4?' / '+thresholds[stage+1].toLocaleString():''} Coins`;
    document.querySelectorAll('#catStages button').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===demoStage)));
  }
  function place(element,x,y,width){
    element.style.width=width+'%';const bounds=scene.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
    const caption=element.id==='catActor'?element.querySelector('.cat-caption'):null;
    const minY=caption?Math.max(0,caption.offsetHeight-parseFloat(getComputedStyle(caption).top))/bounds.height*100:0;
    element.style.left=Math.max(0,Math.min(100-element.offsetWidth/bounds.width*100,x))+'%';element.style.top=Math.max(minY,Math.min(100-element.offsetHeight/bounds.height*100,y))+'%';
  }
  function layout(){
    if(drag?.element!==$('catActor'))place($('catActor'),cfg.catX,cfg.catY,cfg.catScale);
    if(drag?.element!==$('catRanks'))place($('catRanks'),cfg.rankX,cfg.rankY,cfg.rankScale);
    const world=scene.getBoundingClientRect();
    [...$('catRankRows').children].forEach((card,i)=>{if(drag?.element===card)return;const key='rank'+(i+1);card.style.translate=`${(cfg[key+'X']||0)*world.width/100}px ${(cfg[key+'Y']||0)*world.height/100}px`;});
    scene.classList.toggle('locked',cfg.locked);$('catName').textContent=cfg.name;$('catName').hidden=!cfg.showName;$('catStats').hidden=!cfg.showProgress;$('catRanks').hidden=!cfg.showRanks;g.setVisible(cfg.showGifts);g.setLocked(cfg.locked);
  }
  function patch(values){
    const revision=positionRevision;
    saving++;notify('กำลังบันทึก…');
    const task=saveChain.then(async()=>{
      const response=await fetch('/api/pets/orange-cat',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(values),signal:AbortSignal.timeout(7000)});
      if(!response.ok)throw new Error('save');const next=await response.json();
      if(revision===positionRevision&&saving===1&&!dirty&&!drag){cfg={...defaults,...next.settings};layout();}notify('บันทึกแล้ว');
    });
    saveChain=task.catch(()=>notify('บันทึกไม่สำเร็จ กดบันทึกเพื่อลองใหม่')).finally(()=>saving--);return task;
  }
  function persistPosition(element,prefix){positionRevision++;cfg[prefix+'X']=parseFloat(element.style.left);cfg[prefix+'Y']=parseFloat(element.style.top);patch({[prefix+'X']:cfg[prefix+'X'],[prefix+'Y']:cfg[prefix+'Y']}).catch(()=>{});}
  window.catDrag.register(e=>{
    const card=e.target.closest('.cat-rank');if(!card||cfg.locked)return null;
    const index=[...$('catRankRows').children].indexOf(card),key='rank'+(index+1),world=scene.getBoundingClientRect(),box=card.getBoundingClientRect();
    const startX=cfg[key+'X']||0,startY=cfg[key+'Y']||0,mouseX=e.clientX,mouseY=e.clientY;
    positionRevision++;drag={element:card};card.classList.add('dragging');
    return {move(point){const dx=Math.max(world.left-box.left,Math.min(world.right-box.right,point.clientX-mouseX)),dy=Math.max(world.top-box.top,Math.min(world.bottom-box.bottom,point.clientY-mouseY));cfg[key+'X']=startX+dx/world.width*100;cfg[key+'Y']=startY+dy/world.height*100;card.style.translate=`${cfg[key+'X']*world.width/100}px ${cfg[key+'Y']*world.height/100}px`;},end(){drag=null;card.classList.remove('dragging');positionRevision++;patch({[key+'X']:cfg[key+'X'],[key+'Y']:cfg[key+'Y']}).catch(()=>{});}};
  });
  for(const [element,prefix] of [[$('catActor'),'cat'],[$('catRanks'),'rank']]){
    window.catDrag.register(e=>{
      if(cfg.locked||!element.contains(e.target))return null;const box=element.getBoundingClientRect(),rect=scene.getBoundingClientRect(),dx=e.clientX-box.left,dy=e.clientY-box.top;
      positionRevision++;drag={element,prefix};element.classList.add('dragging');
      return {move(point){place(element,(point.clientX-rect.left-dx)/rect.width*100,(point.clientY-rect.top-dy)/rect.height*100,cfg[prefix==='cat'?'catScale':'rankScale']);},end(){drag=null;element.classList.remove('dragging');persistPosition(element,prefix);}};
    });
    element.addEventListener('keydown',e=>{if(cfg.locked||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const step=e.shiftKey?3:1;const x=parseFloat(element.style.left)+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y=parseFloat(element.style.top)+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);place(element,x,y,cfg[prefix==='cat'?'catScale':'rankScale']);persistPosition(element,prefix);});
  }
  addEventListener('resize',layout);
  function catPoint(){const box=$('catActor').getBoundingClientRect(),world=scene.getBoundingClientRect();return{x:(box.left-world.left+box.width*.32)/world.width*g.W,y:(box.top-world.top+box.height*.3)/world.height*g.H};}
  function catCenter(){const box=$('catActor').getBoundingClientRect(),world=scene.getBoundingClientRect();return{x:(box.left-world.left+box.width*.5)/world.width*g.W,y:(box.top-world.top+box.height*.45)/world.height*g.H};}
  async function tween(ms,paint,token){const start=performance.now();return new Promise(resolve=>{function step(now){if(token!==run){resolve(false);return;}const p=Math.min(1,(now-start)/ms);paint(p);if(p<1)requestAnimationFrame(step);else resolve(true);}requestAnimationFrame(step);});}
  function cast(on){$('catMotion').classList.toggle('casting',on);$('catMotion').classList.remove('happy');}
  const turnImage=new Image();turnImage.src='/assets/pets/orange-cat-turn.png';
  const turnRows=[0,200,432,665,906,1145];
  const turnSizes=[68,85,92,96,100],smooth=t=>t*t*(3-2*t);
  function turnFrame(a,b,blend,opacity){
    const heightA=turnRows[a[0]+1]-turnRows[a[0]],heightB=turnRows[b[0]+1]-turnRows[b[0]];
    const size=turnSizes[a[0]]+(turnSizes[b[0]]-turnSizes[a[0]])*blend,height=heightA+(heightB-heightA)*blend;
    $('catTurn').setAttribute('viewBox',`${a[1]*229} ${turnRows[a[0]]} 229 ${heightA}`);
    $('catTurnNext').setAttribute('viewBox',`${b[1]*229} ${turnRows[b[0]]} 229 ${heightB}`);
    const style=$('catMotion').style;
    style.setProperty('--turn-size',size+'%');style.setProperty('--turn-height',(size*512*height/229/560)+'%');
    style.setProperty('--turn-a',String((1-blend)*opacity));style.setProperty('--turn-b',String(blend*opacity));style.setProperty('--base-opacity',String(1-opacity));
    $('catActor').style.setProperty('--turn-head',((560*.82-size/100*512*height/229)/650*100-1)+'%');
  }
  async function evolve(next,token){
    cast(true);g.sparkle(catCenter().x,catCenter().y,45);showBubble('ร่ายเวทวิวัฒนาการ…');await sleep(650);if(token!==run)return;
    const old=shownStage;$('evolveName').textContent=names[next];$('catEvolution').hidden=false;
    try{await turnImage.decode();}catch{}
    if(token!==run)return;
    const poses=[[old,0],[old,1],[old,2],[old,3],[next,3],[next,4],[next,5],[next,0]];
    cast(false);turnFrame(poses[0],poses[1],0,0);$('catMotion').classList.add('evolving');$('catActor').classList.add('is-evolving');
    let switched=false;
    await tween(1650,p=>{
      const position=smooth(p)*(poses.length-1),index=Math.min(poses.length-2,Math.floor(position)),blend=smooth(position-index);
      const opacity=smooth(Math.min(1,p/.12,(1-p)/.12));
      turnFrame(poses[index],poses[index+1],blend,opacity);
      if(position>=3.5&&!switched){switched=true;shownStage=next;if(demoStage!==null)demoStage=next;paintStage(next);const c=catCenter();g.sparkle(c.x,c.y,95,true);}
      $('catMotion').style.setProperty('--lift',(-Math.sin(p*Math.PI)*5)+'%');
    },token);
    $('catMotion').classList.remove('evolving');$('catActor').classList.remove('is-evolving');$('catMotion').style.removeProperty('--lift');
    await sleep(300);$('catEvolution').hidden=true;
  }
  async function merge(demo,token){
    const items=g.reserveTen(demo);if(items.length===0)return;const home=catPoint(),to={x:Math.max(90,Math.min(630,home.x-65)),y:Math.max(170,home.y-65)};
    cast(true);showBubble('สิบชิ้น… รวมพลัง! ✦');const starts=items.map(o=>({x:o.x,y:o.y,r:o.r}));g.setBeam(home,to);
    try{
      const ok=await tween(1500,p=>{const ease=1-Math.pow(1-p,3);items.forEach((o,i)=>{const s=starts[i],angle=p*Math.PI*5+i;o.x=s.x+(to.x-s.x)*ease+Math.cos(angle)*35*(1-p);o.y=s.y+(to.y-s.y)*ease+Math.sin(angle)*35*(1-p);o.renderScale=1-p*.45;});if(Math.random()<.3)g.sparkle(to.x,to.y,2);},token);
      if(!ok)return;g.sparkle(to.x,to.y,65,true);g.combine(items,to.x,to.y);await sleep(500);
    }finally{g.setBeam(null,null);for(const item of items)g.release(item);}
  }
  function thanks(job){
    const entry=job.entry,count=job.count;
    $('thanksName').textContent=entry.sender||entry.user||'ผู้ชม';
    $('thanksGift').textContent=`${entry.name} ×${count.toLocaleString()} · ${(entry.coins*count).toLocaleString()} Coins`;
    avatar($('thanksAvatar'),$('thanksInitial'),entry.avatar,entry.sender);
  }
  async function premium(job,token){
    const item=job.item,entry=job.entry;if(!item)return;cast(true);showBubble('เวทดอกไม้ไฟ ขอบคุณน้า!');const to={x:360,y:230},start={x:item.x,y:item.y};g.setBeam(catPoint(),to);
    try{
      await sleep(450);if(token!==run)return;
      if(!await tween(1100,p=>{const t=1-Math.pow(1-p,3);item.x=start.x+(to.x-start.x)*t;item.y=start.y+(to.y-start.y)*t;item.renderScale=1+4*t;},token))return;
      item.opacity=0;g.fireworks(to.x,to.y);
      thanks(job);job.updatedAt=performance.now();$('catThanks').hidden=false;await sleep(650);if(token!==run)return;
      item.opacity=1;g.setBeam(null,null);
      // Keep the latest combo total readable even when it increases during the thank-you.
      while(token===run&&performance.now()-job.updatedAt<2000)await sleep(100);
      if(token!==run)return;
      job.accepting=false;$('catThanks').hidden=true;await tween(500,p=>{item.renderScale=5-4*p;},token);
    }finally{job.accepting=false;$('catThanks').hidden=true;g.setBeam(null,null);g.release(item);}
  }
  async function pump(){
    if(busy||shownStage===null||drag)return;let job;
    if(demoStage===null&&shownStage<targetStage)job={type:'evolve',next:shownStage+1,demo:shownStage+1>(state?.stage||0)};
    else if(actions.length)job=actions.shift();
    else if(g.tinyCount(false)>=10)job={type:'merge',demo:false};
    else if(g.tinyCount(true)>=10)job={type:'merge',demo:true};
    if(!job)return;busy=true;activeAction=job;const token=run;
    try{if(job.type==='evolve')await evolve(job.next,token);else if(job.type==='premium')await premium(job,token);else if(job.type==='merge')await merge(job.demo,token);else{showBubble('ขอบคุณ '+(job.sender||'ทุกคน')+' ♥');$('catMotion').classList.add('happy');await sleep(950);}}
    finally{cast(false);$('catMotion').classList.remove('happy','spinning','evolving');$('catActor').classList.remove('is-evolving');$('catEvolution').hidden=true;g.setBeam(null,null);busy=false;activeAction=null;if(demoStage===null&&shownStage!==null)paintStage(shownStage);}
  }
  setInterval(()=>{pump().catch(()=>notify('แสดงเอฟเฟกต์ไม่สำเร็จ กำลังรับรายการถัดไป'));},120);
  function receive(entry){
    const item=g.add(entry);if(!item)return;
    // Both game tests and in-widget tests exercise the same evolution thresholds.
    // Demo Coins remain local; the host continues to store only real gift progress.
    if(entry.demo){demoCoins=Math.min(Number.MAX_SAFE_INTEGER,demoCoins+entry.coins*entry.count);$('catDemo').hidden=false;}
    demoStage=null;targetStage=stageFor(effectiveCoins());
    $('catDemo').textContent=`ทดสอบ +${demoCoins.toLocaleString()} Coins · Coins จริง ${(state?.coins||0).toLocaleString()}`;
    if(entry.coins>=100){
      const count=Number.isSafeInteger(entry.comboCount)&&entry.comboCount>=entry.count?entry.comboCount:entry.count;
      const matches=job=>job?.type==='premium'&&job.accepting&&entry.comboId&&job.entry.comboId===entry.comboId&&job.entry.user===entry.user&&job.entry.name===entry.name&&job.entry.coins===entry.coins&&job.demo===!!entry.demo;
      const job=matches(activeAction)?activeAction:actions.find(matches);
      if(job){
        job.count=Math.max(job.count,count);job.updatedAt=performance.now();
        g.release(item); // The new physical gifts remain in the pile; only the celebration is shared.
        if(job===activeAction&&!$('catThanks').hidden)thanks(job);
      }else actions.push({type:'premium',entry,item,count,accepting:true,updatedAt:performance.now(),demo:!!entry.demo});
    }else if(!actions.some(j=>j.type==='happy'))actions.push({type:'happy',sender:entry.sender,demo:!!entry.demo});
    if(!busy)paintStage(shownStage);
  }
  function useDemo(){$('catDemo').hidden=false;}
  function endDemo(){
    actions=actions.filter(j=>!j.demo);if(activeAction?.demo)run++;
    g.clearDemo();demoCoins=0;demoStage=null;demoRanks=false;$('catDemo').hidden=true;shownStage=state?.stage??0;targetStage=shownStage;paintStage(shownStage);renderRanks();
  }
  function previewCommand(entry){
    if(entry.command==='reset'){endDemo();return;}
    if(entry.command==='ranks'){useDemo();demoRanks=true;renderRanks();return;}
    const stage=entry.command==='evolve'?(stageFor(effectiveCoins())+1)%5:entry.targetStage;
    if(!Number.isInteger(stage)||stage<0||stage>4)return;
    if(activeAction?.demo)run++;
    demoStage=null;demoCoins=Math.max(0,thresholds[stage]-(state?.coins||0));targetStage=stageFor(effectiveCoins());
    if(shownStage>targetStage)shownStage=targetStage;
    useDemo();paintStage(shownStage);
  }
  function renderRanks(){
    const rows=demoRanks?[{nickname:'ผู้พิทักษ์ส้ม',coins:5000},{nickname:'ทาสแมว',coins:1000},{nickname:'ทีมเจ้าส้ม',coins:100}]:rankRows;
    for(let i=0;i<3;i++){
      let card=$('catRankRows').children[i];if(!card){card=document.createElement('article');card.className='cat-rank';const portrait=document.createElement('div');portrait.className='rank-portrait';const img=document.createElement('img');img.alt='';img.draggable=false;img.referrerPolicy='no-referrer';const initial=document.createElement('span');initial.className='rank-initial';const rank=document.createElement('b');rank.textContent=i+1;const art=document.createElementNS('http://www.w3.org/2000/svg','svg');art.classList.add('rank-art');art.setAttribute('viewBox',['40 0 750 724','780 0 700 724','1460 0 712 724'][i]);art.setAttribute('aria-hidden','true');const ring=document.createElementNS('http://www.w3.org/2000/svg','image');ring.setAttribute('href','/assets/pets/cat-sultan-rings.png');ring.setAttribute('width','2172');ring.setAttribute('height','724');art.append(ring);const orbit=document.createElement('i');orbit.className='rank-orbit';orbit.setAttribute('aria-hidden','true');portrait.append(img,initial,art,orbit,rank);const info=document.createElement('div');info.className='rank-info';info.append(document.createElement('strong'),document.createElement('small'));card.append(portrait,info);$('catRankRows').append(card);}
      const row=rows[i],name=row?.nickname||row?.uniqueId||'รอผู้สนับสนุน';card.querySelector('strong').textContent=name;card.querySelector('small').textContent=`${Number(row?.coins||0).toLocaleString()} Coins`;avatar(card.querySelector('img'),card.querySelector('.rank-initial'),row?.avatar,name);
    }
    layout();
  }
  async function ranksPoll(){try{const response=await fetch('/api/live-stats',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(response.ok){const data=await response.json();rankRows=(Array.isArray(data.topGifters)?data.topGifters:[]).filter(x=>x&&typeof x==='object').sort((a,b)=>Number(b.coins||0)-Number(a.coins||0)).slice(0,3);renderRanks();}}catch{}setTimeout(ranksPoll,2500);}
  async function poll(){
    const revision=positionRevision;
    try{
      const query=cursor===null?'':'?'+new URLSearchParams({after:cursor,epoch});const response=await fetch('/api/pets/orange-cat'+query,{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('pet unavailable');const next=await response.json();
      if(!Number.isInteger(next.stage)||next.stage<0||next.stage>4||!next.settings||!Number.isSafeInteger(next.cursor)||typeof next.epoch!=='string'||!Array.isArray(next.gifts))throw Error('invalid pet data');
      const first=state===null;state=next;if(revision===positionRevision&&!dirty&&!drag&&!saving){cfg={...defaults,...next.settings};layout();}
      targetStage=stageFor(effectiveCoins());
      if(first){shownStage=next.stage;paintStage(shownStage);}else if(demoStage===null&&!busy){if(shownStage>targetStage)shownStage=targetStage;paintStage(shownStage);}
      for(const gift of next.gifts){if(epoch===next.epoch&&cursor!==null&&gift.seq<=cursor)continue;if(gift.command)previewCommand(gift);else receive(gift);}
      cursor=next.cursor;epoch=next.epoch;
      $('catConnection').textContent=next.error||`${next.coins.toLocaleString()} Coins · ระดับ ${next.level}/5${cfg.enabled?' · พร้อมรับของขวัญ':' · หยุดรับของขวัญ'}`;
      if(next.gap)notify('ขาดการเชื่อมต่อบางช่วง ยอด Coins ใช้ข้อมูลที่บันทึกในโปรแกรม');liveError=false;
    }catch{if(!liveError)$('catConnection').textContent='เชื่อมต่อโปรแกรมไม่ได้ กำลังลองใหม่…';liveError=true;}
    setTimeout(poll,500);
  }
  renderRanks();layout();poll();ranksPoll();
  // Read-only diagnostics for local verification; no route can add real Coins.
  window.catWidget={snapshot:()=>({shownStage,targetStage,demoStage,demoCoins,effectiveCoins:effectiveCoins(),busy,action:activeAction?.type,queued:actions.length,cfg:{...cfg}})};
})();
