(() => {
  'use strict';
  const scene=document.getElementById('catScene'),handlers=[];let active=null,pending=null,frame=0;
  function flush(){frame=0;if(active&&pending){const point=pending;pending=null;active.move(point);}}
  function finish(cancel=false){if(!active)return;cancelAnimationFrame(frame);flush();const item=active;active=null;pending=null;scene.classList.remove('is-dragging');try{scene.releasePointerCapture(item.id);}catch{}item.end(cancel);}
  scene.addEventListener('dragstart',e=>e.preventDefault());
  scene.addEventListener('pointerdown',e=>{
    if(active||e.button!==0)return;
    for(const handler of handlers){const job=handler(e);if(!job)continue;active={...job,id:e.pointerId};scene.classList.add('is-dragging');try{scene.setPointerCapture(e.pointerId);}catch{}e.preventDefault();e.stopImmediatePropagation();break;}
  },true);
  window.addEventListener('pointermove',e=>{if(!active||active.id!==e.pointerId)return;if(e.pointerType==='mouse'&&!(e.buttons&1)){finish();return;}pending={clientX:e.clientX,clientY:e.clientY};if(!frame)frame=requestAnimationFrame(flush);e.preventDefault();},true);
  window.addEventListener('pointerup',e=>{if(active?.id!==e.pointerId)return;pending={clientX:e.clientX,clientY:e.clientY};finish();},true);
  window.addEventListener('pointercancel',e=>{if(active?.id===e.pointerId)finish(true);},true);
  // A WebView can release capture while the button is still held. Keep the drag
  // session alive and continue tracking window events instead of requiring a new click.
  scene.addEventListener('lostpointercapture',e=>{if(active?.id===e.pointerId)try{scene.setPointerCapture(e.pointerId);}catch{};});
  window.addEventListener('blur',()=>finish(true));
  window.catDrag={register(handler){handlers.push(handler);},get active(){return !!active;}};
})();
