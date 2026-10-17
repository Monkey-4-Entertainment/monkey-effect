(() => {
  'use strict';
  const W=720,H=1280,canvas=document.getElementById('catGifts'),ctx=canvas.getContext('2d'),fx=document.getElementById('catFx'),fc=fx.getContext('2d');
  const catalog=new Map(),images=new Map(),normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9ก-๙]+/g,'');
  fetch('/gifts/jar/catalog.json').then(r=>r.json()).then(data=>{for(const row of(data.items||data.gifts||[]))catalog.set(normalize(row.name||row.giftName),row);}).catch(()=>{});
  let pile=[],particles=[],enabled=true,locked=false,drag=null,beam=null,uid=0,last=performance.now();
  function imageFor(name){
    const row=catalog.get(normalize(name));if(!row)return null;
    const url=row.url||row.image||row.imageUrl||(row.file?'/gifts/jar/icons/'+row.file:'');
    if(!url||!(/^(https?:\/\/|\/gifts\/)/.test(url)))return null;
    if(!images.has(url)){const image=new Image();image.src=url;images.set(url,image);}return images.get(url);
  }
  // Exact Dragon Hoard size bands and base-radius formula at the same 720×1280 viewport.
  function sizeScale(c){if(c>=10001)return 2.12;if(c>=4501)return 1.86;if(c>=2001)return 1.62;if(c>=1001)return 1.40;if(c>=501)return 1.20;if(c>=300)return 1.02;if(c>=200)return .86;if(c>=101)return .72;if(c>=31)return .60;if(c>=10)return .48;return .36;}
  function radius(c){const margin=Math.max(8,Math.min(W,H)*.018),left=Math.max(margin,W*.08),right=Math.min(W-margin,W*.92);return Math.max(12,Math.min(24,(right-left)/28))*sizeScale(c);}
  function make(entry,units=1){return {id:++uid,name:entry.name,coins:entry.coins,units,x:35+Math.random()*(W-70),y:H*.7-Math.random()*150,vx:(Math.random()-.5)*100,vy:20,r:radius(entry.coins),frozen:false,pinned:false,showcase:false,merged:false,demo:!!entry.demo};}
  function add(entry){
    if(!Number.isSafeInteger(entry.count)||entry.count<1||!Number.isFinite(entry.coins)||entry.coins<1)return null;
    const amount=Math.min(entry.count,80),created=[];
    for(let i=0;i<amount;i++){const units=Math.floor(entry.count/amount)+(i<entry.count%amount?1:0);const item=make(entry,units);pile.push(item);created.push(item);}
    const hero=created[0];if(entry.coins>=100){hero.frozen=true;hero.showcase=true;}
    compact();return hero;
  }
  function compact(){
    // Consolidate matching objects, retaining every unit and every Coin.
    if(pile.length<600)return;
    const seen=new Map();
    pile=pile.filter(o=>{if(o.frozen||o.pinned||o.showcase||o===drag?.item)return true;const key=[o.name,o.coins,o.merged,o.demo].join('|');const old=seen.get(key);if(old){old.units+=o.units;return false;}seen.set(key,o);return true;});
  }
  function tinyCount(demo=false){return pile.reduce((n,o)=>n+(o.coins===1&&!o.frozen&&o.demo===demo?o.units:0),0);}
  function reserveTen(demo=false){
    if(tinyCount(demo)<10)return [];
    let left=10;const selected=[];
    for(const original of [...pile]){
      if(original.coins!==1||original.frozen||original.demo!==demo)continue;
      const n=Math.min(left,original.units);let item=original;
      if(n<original.units){original.units-=n;item={...original,id:++uid,units:n};pile.push(item);}
      item.frozen=true;selected.push(item);left-=n;if(!left)break;
    }
    return selected;
  }
  function combine(items,x,y){
    if(!items.length)return null;const count=items.reduce((n,o)=>n+o.units,0);if(count!==10)throw Error('Invalid merge group');
    pile=pile.filter(o=>!items.includes(o));const merged=make({name:items[0].name,coins:10,demo:items[0].demo});
    Object.assign(merged,{x,y,vx:0,vy:-110,merged:true});pile.push(merged);return merged;
  }
  function release(item){if(!item)return;item.frozen=false;item.showcase=false;item.opacity=1;item.renderScale=1;item.vy=40;item.pinned=false;}
  const fireColors=['#ff537f','#ffb347','#ffea78','#71ffd0','#55cfff','#9a8cff','#f58dff'];
  function emit(x,y,count,large,delay=0,fire=false){
    for(let i=0;i<count;i++){
      const a=i/count*Math.PI*2+(Math.random()-.5)*.12,s=(fire?130:large?100:35)+Math.random()*(fire?210:large?180:110),life=(fire?1.5:1)+Math.random()*.8;
      particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life,max:life,delay,color:fireColors[i%fireColors.length],r:fire?1.2+Math.random():.7+Math.random(),trail:[],fire,seed:Math.random()*10});
    }
    if(particles.length>1000)particles.splice(0,particles.length-1000);
  }
  function sparkle(x,y,count=35,large=false){emit(x,y,count,large);}
  function fireworks(x,y){
    emit(x,y,105,true,0,true);
    emit(x-150,y-45,65,true,.24,true);
    emit(x+150,y-25,65,true,.48,true);
    emit(x-65,y-85,48,true,.82,true);
    emit(x+90,y-65,48,true,1.05,true);
  }
  function pos(event){const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*W/rect.width,y:(event.clientY-rect.top)*H/rect.height};}
  const scene=document.getElementById('catScene');
  window.catDrag.register(e=>{
    if(locked||!enabled)return null;const rect=canvas.getBoundingClientRect(),p=pos(e),pixel=W/rect.width;
    const available=pile.filter(o=>o.coins>=100&&!o.frozen&&!o.showcase);
    const exact=[...available].reverse().find(o=>Math.hypot(o.x-p.x,o.y-p.y)<=o.r+4*pixel);
    const near=e.target.closest('#catActor,#catRanks')?null:available.filter(o=>Math.hypot(o.x-p.x,o.y-p.y)<=Math.max(o.r,24*pixel)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    const item=exact||near;if(!item)return null;const dx=p.x-item.x,dy=p.y-item.y;drag={item};item.frozen=true;item.pinned=false;
    return {move(point){const x=(point.clientX-rect.left)*W/rect.width-dx,y=(point.clientY-rect.top)*H/rect.height-dy;item.x=Math.max(item.r,Math.min(W-item.r,x));item.y=Math.max(item.r,Math.min(H-item.r,y));item.vx=item.vy=0;},end(){item.frozen=false;item.pinned=true;drag=null;}};
  });
  function resize(){const dpr=Math.min(2,devicePixelRatio||1);for(const c of [canvas,fx]){c.width=W*dpr;c.height=H*dpr;c.getContext('2d').setTransform(dpr,0,0,dpr,0,0);}}
  resize();addEventListener('resize',resize);
  function frame(now){
    const dt=Math.min(.035,(now-last)/1000);last=now;ctx.clearRect(0,0,W,H);fc.clearRect(0,0,W,H);
    const ground=H*.97;
    for(const o of pile){
      if(!o.frozen&&!o.pinned){o.vy+=650*dt;o.x+=o.vx*dt;o.y+=o.vy*dt;o.vx*=.99;if(o.x<o.r){o.x=o.r;o.vx=Math.abs(o.vx)*.35;}if(o.x>W-o.r){o.x=W-o.r;o.vx=-Math.abs(o.vx)*.35;}if(o.y>ground-o.r){o.y=ground-o.r;o.vy=Math.abs(o.vy)>25?-Math.abs(o.vy)*.16:0;o.vx*=.8;}}
    }
    // Spatial bins avoid quadratic collision work during gift bursts.
    const bins=new Map();
    for(const o of pile){if(o.frozen||o.pinned)continue;const key=Math.floor(o.x/110)+','+Math.floor(o.y/110);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(o);}
    for(const a of pile){if(a.frozen||a.pinned)continue;const gx=Math.floor(a.x/110),gy=Math.floor(a.y/110);for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(const b of bins.get(x+','+y)||[]){if(a.id>=b.id)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r;if(d<=0||d>=min)continue;const push=(min-d)*.5,nx=dx/d,ny=dy/d;a.x-=nx*push;a.y-=ny*push;b.x+=nx*push;b.y+=ny*push;a.vx*=.7;b.vx*=.7;if(Math.abs(dy)>Math.abs(dx)*.3){const upper=dy>0?a:b;upper.vy=Math.min(upper.vy,12);}}}
    if(enabled)for(const o of pile){
      const image=imageFor(o.name);ctx.save();ctx.translate(o.x,o.y);ctx.scale(o.renderScale||1,o.renderScale||1);ctx.globalAlpha=o.opacity??1;ctx.shadowColor=o.coins>=100?'#ffc570':'#0007';ctx.shadowBlur=o.coins>=100?14:3;
      if(image?.complete&&image.naturalWidth)ctx.drawImage(image,-o.r,-o.r,o.r*2,o.r*2);else{ctx.font=`${o.r*1.8}px Segoe UI Emoji`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🎁',0,0);}
      if(o.merged){ctx.shadowBlur=8;ctx.strokeStyle='#9fffe3';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,o.r+3,0,Math.PI*2);ctx.stroke();}
      if(o.units>1||o.merged){ctx.shadowBlur=0;ctx.font='bold 11px Segoe UI';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#15282f';const text=o.merged?'10'+(o.units>1?' ×'+o.units:''):'×'+o.units;ctx.strokeText(text,0,o.r+3);ctx.fillStyle='#fff4c6';ctx.fillText(text,0,o.r+3);}ctx.restore();
    }
    if(beam){fc.save();fc.strokeStyle='#c6ffe4';fc.lineWidth=2;fc.shadowColor='#ffc780';fc.shadowBlur=16;fc.setLineDash([6,8]);fc.lineDashOffset=-now*.05;fc.beginPath();fc.moveTo(beam.from.x,beam.from.y);fc.quadraticCurveTo((beam.from.x+beam.to.x)/2,Math.min(beam.from.y,beam.to.y)-80,beam.to.x,beam.to.y);fc.stroke();fc.restore();}
    fc.save();fc.globalCompositeOperation='lighter';fc.lineCap='round';
    for(const p of particles){
      if(p.delay>0){p.delay-=dt;continue;}
      p.life-=dt;p.trail.push({x:p.x,y:p.y});if(p.trail.length>9)p.trail.shift();
      p.vx*=Math.exp(-.48*dt);p.vy=p.vy*Math.exp(-.48*dt)+(p.fire?100:55)*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
      const fade=Math.max(0,Math.min(1,p.life/p.max*1.7)),tail=p.trail[0];
      const gradient=fc.createLinearGradient(tail.x,tail.y,p.x+.001,p.y+.001);gradient.addColorStop(0,p.color+'00');gradient.addColorStop(.65,p.color+'b0');gradient.addColorStop(1,'#fff6dc');
      fc.globalAlpha=fade;fc.strokeStyle=gradient;fc.lineWidth=p.r;fc.beginPath();fc.moveTo(tail.x,tail.y);for(const point of p.trail)fc.lineTo(point.x,point.y);fc.lineTo(p.x,p.y);fc.stroke();
      // White-hot cores and intermittent four-point glitter leave the colored tails readable.
      fc.fillStyle='#fff9e7';fc.fillRect(p.x-.65,p.y-.65,1.3,1.3);
      if(Math.sin(now*.018+p.seed)> .88){const r=p.fire?4:2.5;fc.globalAlpha=fade*.85;fc.fillStyle=p.color;fc.beginPath();fc.moveTo(p.x,p.y-r);fc.lineTo(p.x+1,p.y-1);fc.lineTo(p.x+r,p.y);fc.lineTo(p.x+1,p.y+1);fc.lineTo(p.x,p.y+r);fc.lineTo(p.x-1,p.y+1);fc.lineTo(p.x-r,p.y);fc.lineTo(p.x-1,p.y-1);fc.closePath();fc.fill();}
    }
    fc.restore();particles=particles.filter(p=>p.life>0);requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.catGifts={W,H,add,reserveTen,combine,release,sparkle,fireworks,radius,sizeScale,imageFor,tinyCount,
    setBeam(from,to){beam=from&&to?{from,to}:null;},setVisible(value){enabled=value;canvas.hidden=!value;},setLocked(value){locked=value;},
    clearDemo(){pile=pile.filter(o=>!o.demo);},snapshot(){return pile.map(({id,name,coins,units,x,y,r,pinned,frozen,merged,demo})=>({id,name,coins,units,x,y,r,pinned,frozen,merged,demo}));}};
})();
