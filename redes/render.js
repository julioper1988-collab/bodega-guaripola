const {chromium}=require('playwright');const path=require('path');
const F={story:{w:1080,h:1920,v:'--pad:200px;--padb:220px;--gy:330px;--h1:150px;--emo:150px;--emt:0px;--lt:14px;--gap:18px;--rp:20px;--rn:44px;--rpz:58px;--hz:38px'},
         feed:{w:1080,h:1350,v:'--pad:48px;--gy:170px;--h1:112px;--emo:110px;--emt:6px;--lt:16px;--gap:12px;--rp:12px;--rn:36px;--rpz:48px;--hz:28px'}};
(async()=>{const b=await chromium.launch();const mode=process.argv[2];
 for(const k of Object.keys(F)){const f=F[k];if(mode==='video'&&k!=='story')continue;
  const p=await b.newPage({viewport:{width:f.w,height:f.h}});
  await p.goto('file://'+path.resolve('polleria.html'));
  await p.evaluate(v=>{document.body.setAttribute('style','--w:'+innerWidth+'px;--h:'+innerHeight+'px;'+v)},f.v);
  await p.evaluate(()=>document.fonts.ready);
  const seek=t=>p.evaluate(t=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=t}),t);
  if(mode==='video'){for(let i=0;i<300;i++){await seek(i*1000/30);await p.screenshot({path:`fr/${String(i).padStart(4,'0')}.png`});}}
  else{await seek(6200);await p.screenshot({path:`polleria-${k}.png`});}
 }await b.close();})();
