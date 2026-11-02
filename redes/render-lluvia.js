const {chromium}=require('playwright');const path=require('path');
const F={story:{w:1080,h:1920,v:'--pad:190px;--padb:220px;--wy:620px;--cl:120px;--h1:150px;--sz:40px;--mo:130px;--mt:6px;--lt:14px;--gap:14px;--rp:18px;--rn:42px;--gt:18px;--hz:38px'},
         feed:{w:1080,h:1350,v:'--pad:44px;--wy:340px;--cl:90px;--h1:118px;--sz:33px;--mo:96px;--mt:4px;--lt:14px;--gap:12px;--rp:14px;--rn:36px;--gt:12px;--hz:28px'}};
(async()=>{const b=await chromium.launch();const mode=process.argv[2];
 for(const k of Object.keys(F)){const f=F[k];if(mode==='video'&&k!=='story')continue;
  const p=await b.newPage({viewport:{width:f.w,height:f.h}});
  await p.goto('file://'+path.resolve('lluvia.html'));
  await p.evaluate(v=>{document.body.setAttribute('style','--w:'+innerWidth+'px;--h:'+innerHeight+'px;'+v)},f.v);
  await p.evaluate(()=>document.fonts.ready);
  const seek=t=>p.evaluate(t=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=t}),t);
  if(mode==='video'){for(let i=0;i<300;i++){await seek(i*1000/30);await p.screenshot({path:`fr/${String(i).padStart(4,'0')}.png`});}}
  else{await seek(6200);await p.screenshot({path:`lluvia-${k}.png`});}
 }await b.close();})();
