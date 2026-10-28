// usage: PORT=8140 node quizcheck.js REPO OUTDIR   -> prints one JSON line {pass, parts, reasons, states}
const path=require('path'),fs=require('fs'),cp=require('child_process');
const repo=process.argv[2],out=process.argv[3];fs.mkdirSync(out,{recursive:true});
const PORT=process.env.PORT||'8140';
const {chromium}=require(path.join(repo,'node_modules/playwright'));
const orig=JSON.parse(fs.readFileSync(path.join(__dirname,'orig.json')));
const reasons=[],parts={};
const fail=(k,m)=>{parts[k]=false;reasons.push(k+': '+m)};
const URL=`http://localhost:${PORT}/ongoing_project/MTD/variant-a/index.html`;
async function open(b,w,h){
  const ctx=await b.newContext({viewport:{width:w,height:h}});const p=await ctx.newPage();
  await p.route('**/page-gate/page-gate.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:''}));
  await p.route('**/*.html',async r=>{const resp=await r.fetch();let t=await resp.text();t=t.replace('<div id="sage-page-gate">','<div id="sage-page-gate" hidden>');t=t.replace(/<style id="sage-page-gate-lock">[\s\S]*?<\/style>/,'');await r.fulfill({response:resp,body:t});});
  await p.addInitScript(()=>{const s=()=>document.documentElement.classList.add('sage-open');s();new MutationObserver(s).observe(document.documentElement,{attributes:true,attributeFilter:['class']});});
  await p.goto(URL,{waitUntil:'load'});
  await p.evaluate(()=>{const l=document.getElementById('sage-page-gate-lock');if(l)l.remove();const g=document.getElementById('sage-page-gate');if(g)g.remove();});
  await p.waitForTimeout(800);
  await p.click('[data-mtd-quiz-trigger]');
  await p.waitForFunction(()=>{const f=document.getElementById('mtd-quiz-modal-frame');try{return /Step\s+1\s+of\s+7/.test(f.contentDocument.body.innerText)}catch(e){return false}},null,{timeout:20000});
  await p.waitForTimeout(1500);
  return p;
}
const PROPS=['backgroundColor','borderTopColor','borderTopWidth','boxShadow','color','opacity','textDecorationLine'];
async function sig(p,loc,state){
  await loc.scrollIntoViewIfNeeded().catch(()=>{});
  await p.mouse.move(2,2);await p.keyboard.press('Shift');await loc.evaluate(e=>e.blur&&e.blur());await p.waitForTimeout(350);
  if(state==='hover')await loc.hover();
  if(state==='pressed'){await loc.hover();await p.mouse.down();}
  if(state==='focus'){await p.keyboard.press('Shift');await loc.focus();}
  await p.waitForTimeout(500);
  const r=await loc.evaluate((e,P)=>{const c=getComputedStyle(e),a=getComputedStyle(e,'::after'),b=getComputedStyle(e,'::before');const o={};P.forEach(k=>o[k]=c[k]);o.after={w:a.width,bg:a.backgroundColor,op:a.opacity,h:a.height,content:a.content};o.before={w:b.width,bg:b.backgroundColor,op:b.opacity,content:b.content};o.fv=e.matches(':focus-visible');return o},PROPS);
  if(state==='pressed'){await p.mouse.move(2,2);await p.mouse.up();}
  return r;
}
const eq=(a,b)=>String(a).replace(/\s/g,'')===String(b).replace(/\s/g,'');
const has=(s,...x)=>x.every(v=>String(s).replace(/\s/g,'').includes(v));
(async()=>{
 // build
 const bld=cp.spawnSync('node',['ongoing_project/MTD/build-variants.js','--check'],{cwd:repo,encoding:'utf8'});
 parts.build=bld.status===0; if(!parts.build)reasons.push('build: build-variants --check exit '+bld.status+' '+(bld.stdout+bld.stderr).slice(0,120));
 const b=await chromium.launch({args:['--no-sandbox']});
 const states={};
 for(const [w,h] of [[1280,720],[1024,540]]){
  const k='fs'+w;
  try{
   const p=await open(b,w,h);const f=p.frameLocator('#mtd-quiz-modal-frame');
   await f.locator('button[class*=StyledButton]').first().click();await p.waitForTimeout(1500);
   await f.locator('button[class*=StyledButton]').nth(1).click();
   await f.locator('.mtd-warning').waitFor({timeout:8000});await p.waitForTimeout(1200);
   // fullscreen geometry before scrolling
   const geo=await p.evaluate(()=>{const vw=innerWidth,vh=innerHeight;const m=document.querySelector('.mtd-quiz-modal');const panel=document.querySelector('.mtd-quiz-modal-panel');
     const mr=m.getBoundingClientRect(),pr=panel.getBoundingClientRect(),cs=getComputedStyle(panel);
     const scrollers=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(s.overflowY)&&e!==document.documentElement&&e!==document.body}).map(e=>{const r=e.getBoundingClientRect();return {t:e.tagName+'.'+String(e.className).slice(0,40),w:r.width,h:r.height}});
     const fr=document.getElementById('mtd-quiz-modal-frame'),d=fr.contentDocument;
     return {vw,vh,modal:[mr.width,mr.height],panelW:pr.width,panelL:pr.left,panelRadius:cs.borderTopLeftRadius,panelBorder:cs.borderTopWidth,panelBorderColor:cs.borderTopColor,panelOverflow:cs.overflowY,panelMaxH:cs.maxHeight,panelPad:cs.paddingTop,gp:(()=>{const e=d.querySelector('main.solution-finder-host [class*=gomnIV]');if(!e)return null;const c=getComputedStyle(e);return {r:c.borderTopLeftRadius,bw:c.borderTopWidth,bc:c.borderTopColor,bg:c.backgroundColor}})(),scrollers,inner:[d.documentElement.scrollHeight,d.documentElement.clientHeight,getComputedStyle(d.documentElement).overflowY,getComputedStyle(d.body).overflowY]}});
   const g=geo;let ok=true;
   if(g.modal[0]<g.vw-1||g.modal[1]<g.vh-1){ok=false;reasons.push(`${k}: overlay not full viewport ${g.modal}`)}
   // REVISED (v2): the panel stays the Figma 3776:6405 box: centred, 40px radius, NO border (removed in Figma), never clipping its content
   const pcx=g.panelL+g.panelW/2;
   if(!(g.panelW<g.vw-1&&g.panelW>=Math.min(1520,g.vw)-60)){ok=false;reasons.push(`${k}: panel is not the centred Figma box (${Math.round(g.panelW)}px wide of ${g.vw})`)}
   if(Math.abs(pcx-g.vw/2)>2){ok=false;reasons.push(`${k}: panel not horizontally centred (centre ${Math.round(pcx)} vs ${g.vw/2})`)}
   if(parseFloat(g.panelRadius)!==40||parseFloat(g.panelBorder)!==0){ok=false;reasons.push(`${k}: panel must have 40px radius and NO border (${g.panelRadius}/${g.panelBorder})`)}
   // Figma 3776:6405: outer quiz body padding 40 (24 under 1200px); inner Gradient panel 1px #5e5e5e border, #1b1b1b fill, 40px radius
   if(parseFloat(g.panelPad)!==(g.vw>=1200?40:24)){ok=false;reasons.push(`${k}: panel padding ${g.panelPad} (want ${g.vw>=1200?40:24}px)`)}
   if(!g.gp||parseFloat(g.gp.r)!==40||parseFloat(g.gp.bw)!==1||g.gp.bc.replace(/\s/g,'')!=='rgb(94,94,94)'||g.gp.bg.replace(/\s/g,'')!=='rgb(27,27,27)'){ok=false;reasons.push(`${k}: gradient panel must be 1px #5e5e5e border, #1b1b1b fill, 40px radius (${JSON.stringify(g.gp)})`)}
   if(g.panelOverflow!=='visible'||g.panelMaxH!=='none'){ok=false;reasons.push(`${k}: panel clips its content (overflow ${g.panelOverflow}, max-height ${g.panelMaxH})`)}
   const bad=g.scrollers.filter(s=>!(s.w>=g.vw*0.98&&s.h>=g.vh*0.98));
   if(bad.length){ok=false;reasons.push(`${k}: inner scroll container ${JSON.stringify(bad[0])}`)}
   if(g.inner[0]>g.inner[1]+1){ok=false;reasons.push(`${k}: quiz iframe scrolls internally`)}
   // scroll to bottom via wheel
   await p.mouse.move(g.vw/2,g.vh/2);for(let i=0;i<8;i++){await p.mouse.wheel(0,2000);await p.waitForTimeout(150)}await p.waitForTimeout(500);
   const vis=await p.evaluate(()=>{const fr=document.getElementById('mtd-quiz-modal-frame'),d=fr.contentDocument,fr0=fr.getBoundingClientRect();
     const r={};for(const [n,sel] of [['banner','.mtd-warning'],['continue','button']]){let el=n==='banner'?d.querySelector(sel):[...d.querySelectorAll('button')].find(x=>/^Continue/.test(x.textContent.trim()));if(!el){r[n]=null;continue}
       const b=el.getBoundingClientRect(),top=fr0.top+b.top,bot=fr0.top+b.bottom,x=fr0.left+b.left+b.width/2;
       const hit=document.elementFromPoint(x,Math.min(innerHeight-1,bot-3));
       r[n]={top,bot,vh:innerHeight,hitFrame:hit===fr};}
     return r});
   for(const n of ['banner','continue']){const v=vis[n];if(!v){ok=false;reasons.push(`${k}: ${n} not found`);continue}
     if(v.top<-0.5||v.bot>v.vh+0.5||!v.hitFrame){ok=false;reasons.push(`${k}: ${n} clipped/off-screen (top ${Math.round(v.top)} bottom ${Math.round(v.bot)} of ${v.vh}, hit=${v.hitFrame})`)}}
   parts[k]=ok;
   await p.screenshot({path:path.join(out,`q2-banner-${w}x${h}.png`)});
   await p.close();
  }catch(e){fail(k,'exception '+String(e).slice(0,160))}
 }
 // states at 1280x800
 try{
  const p=await open(b,1280,800);const f=p.frameLocator('#mtd-quiz-modal-frame');
  const tiles=()=>f.locator('button[class*=StyledButton]');
  const tg={};for(const s of ['default','hover','pressed','focus'])tg[s]=await sig(p,tiles().first(),s);
  states.tile=tg;
  // shared: every tile has the same hover/focus
  const per=[];const n=await tiles().count();
  for(let i=0;i<n;i++){per.push(await sig(p,tiles().nth(i),'hover'))}
  states.tile_hover_all=per.map(x=>x.backgroundColor+'|'+x.borderTopColor);
  const same=per.every(x=>x.backgroundColor===per[0].backgroundColor&&x.borderTopColor===per[0].borderTopColor);
  const o=orig;let tok=true;const R=(m)=>{tok=false;reasons.push('tile: '+m)};
  if(!eq(tg.default.backgroundColor,o['tile-default'].backgroundColor)||!eq(tg.default.borderTopColor,o['tile-default'].borderTopColor))R(`default ${tg.default.backgroundColor}/${tg.default.borderTopColor}`);
  for(const s of ['hover','pressed'])if(!eq(tg[s].backgroundColor,o['tile-'+s].backgroundColor)||!eq(tg[s].borderTopColor,o['tile-'+s].borderTopColor))R(`${s} ${tg[s].backgroundColor}/${tg[s].borderTopColor}`);
  if(!(tg.focus.fv&&has(tg.focus.boxShadow,'rgb(0,0,0)0px0px0px2px','rgb(255,181,0)0px0px0px4px')))R(`focus ring ${tg.focus.boxShadow} fv=${tg.focus.fv}`);
  parts.tiles=tok;parts.shared_tiles=same;if(!same)reasons.push('shared: tile hover differs between tiles');
  // Previous
  await tiles().first().click();await p.waitForTimeout(1800);
  const pv=f.locator('button[class*=StyledBack]'),pg={};
  for(const s of ['default','hover','pressed','focus'])pg[s]=await sig(p,pv,s);
  states.previous=pg;let pok=true;
  const dsig=x=>JSON.stringify([x.color,x.backgroundColor,x.textDecorationLine,x.boxShadow,x.after,x.before]);
  if(!(pg.focus.fv&&has(pg.focus.boxShadow,'rgb(0,0,0)0px0px0px2px','rgb(255,181,0)0px0px0px4px'))){pok=false;reasons.push('previous: focus-visible ring missing '+pg.focus.boxShadow)}
  if(dsig(pg.hover)===dsig(pg.default)){pok=false;reasons.push('previous: hover identical to default')}
  if(dsig(pg.pressed)===dsig(pg.default)||dsig(pg.pressed)===dsig(pg.hover)&&false){pok=false;reasons.push('previous: pressed identical to default')}
  parts.previous=pok;
  // Continue (primary) informational + close X
  await tiles().nth(1).click();await p.waitForTimeout(1800);
  const cont=f.getByRole('button',{name:'Continue'}),cg={};
  for(const s of ['default','hover','pressed','focus'])cg[s]=await sig(p,cont,s);
  states.continue=cg;
  let cok=eq(cg.default.backgroundColor,o['primary-button-default'].backgroundColor);
  cok=cok&&String(cg.hover.before.op)==='1'&&String(cg.pressed.after.op)==='1'&&cg.focus.fv&&has(cg.focus.boxShadow,'rgb(255,181,0)0px0px0px4px');
  parts.primary_info=!!cok;
  const x=p.locator('.mtd-quiz-modal-close'),xg={};
  const xs=async s=>{await p.mouse.move(2,2);await p.keyboard.press('Shift');await x.evaluate(e=>e.blur());await p.waitForTimeout(300);if(s==='hover')await x.hover();if(s==='focus'){await p.keyboard.press('Shift');await x.focus()}await p.waitForTimeout(400);return x.evaluate(e=>{const pa=e.querySelector('svg path');return {fill:pa?getComputedStyle(pa).fill:null,bs:getComputedStyle(e).boxShadow,fv:e.matches(':focus-visible')}})};
  xg.default=await xs('default');xg.hover=await xs('hover');xg.focus=await xs('focus');states.close=xg;
  parts.close=eq(xg.hover.fill,'rgb(0,214,57)')&&xg.focus.fv&&has(xg.focus.bs,'rgb(255,181,0)0px0px0px4px')&&!eq(xg.default.fill,xg.hover.fill);
  if(!parts.close)reasons.push('close: states '+JSON.stringify(xg).slice(0,200));
  await p.screenshot({path:path.join(out,'states-q2-1280x800.png')});
  await p.close();
 }catch(e){reasons.push('states: exception '+String(e).slice(0,200));parts.tiles=parts.tiles??false;parts.previous=parts.previous??false;parts.shared_tiles=parts.shared_tiles??false}
 await b.close();
 const need=['build','fs1280','fs1024','tiles','shared_tiles','previous','close'];
 const pass=need.every(k=>parts[k]===true);
 console.log(JSON.stringify({pass,parts,reasons:reasons.slice(0,12),states}));
})().catch(e=>{console.log(JSON.stringify({pass:false,parts,reasons:['fatal '+String(e).slice(0,200)],states:{}}));process.exit(0)});
