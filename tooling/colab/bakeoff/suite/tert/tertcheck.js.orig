// usage: PORT=8142 node tertcheck.js REPO OUTDIR  -> prints one JSON line {pass, parts, reasons, states}
// T-TERTIARY: quiz Previous = shared tertiary, close = shared secondary icon, Continue = shared primary, root states fixed, gates green.
const path=require('path'),fs=require('fs'),cp=require('child_process');
const repo=process.argv[2],out=process.argv[3];fs.mkdirSync(out,{recursive:true});
const PORT=process.env.PORT||'8142';
const {chromium}=require(path.join(repo,'node_modules/playwright'));
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline.json')));
const reasons=[],parts={};
const run=(c,t=600000)=>cp.spawnSync('bash',['-c','export PATH=/tools/node/bin:$PATH; '+c],{cwd:repo,encoding:'utf8',timeout:t});
const URL=`http://localhost:${PORT}/ongoing_project/MTD/variant-a/index.html`;
const MTD='ongoing_project/MTD';
const rd=(f)=>{try{return fs.readFileSync(path.join(repo,f),'utf8')}catch(e){return ''}};
const porcelain=()=>run('git status --porcelain=v1 -uall').stdout.split('\n').filter(Boolean);
const eq=(a,b)=>String(a).replace(/\s/g,'')===String(b).replace(/\s/g,'');
const has=(s,...x)=>x.every(v=>String(s).replace(/\s/g,'').includes(v));

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
const PROPS=['color','backgroundColor','borderTopColor','borderTopWidth','boxShadow','textDecorationLine','outlineStyle','outlineWidth','outlineColor'];
async function sig(p,loc,state){
  await loc.scrollIntoViewIfNeeded().catch(()=>{});
  await p.mouse.move(2,2);await p.keyboard.press('Shift');await loc.evaluate(e=>e.blur&&e.blur());await p.waitForTimeout(350);
  if(state==='hover')await loc.hover();
  if(state==='pressed'){await loc.hover();await p.mouse.down();}
  if(state==='focus'){await p.keyboard.press('Shift');await loc.focus();}
  await p.waitForTimeout(600);
  const r=await loc.evaluate((e,P)=>{const c=getComputedStyle(e),a=getComputedStyle(e,'::after'),b=getComputedStyle(e,'::before');const o={};P.forEach(k=>o[k]=c[k]);
    o.after={tr:a.transform,bg:a.backgroundColor,w:a.width,op:a.opacity};o.before={bg:b.backgroundColor,op:b.opacity};
    o.bl=!!e.querySelector(':scope > span.bottom-line');o.cls=e.className;o.fv=e.matches(':focus-visible');return o},PROPS);
  if(state==='pressed'){await p.mouse.move(2,2);await p.mouse.up();}
  return r;
}
const STATES=['default','hover','pressed','focus'];
const SK=(x,skipBorder)=>JSON.stringify([x.color,x.backgroundColor,skipBorder?'':x.borderTopColor,skipBorder?'':x.borderTopWidth,x.boxShadow,x.textDecorationLine,x.outlineStyle,x.outlineWidth,x.after,x.before]).replace(/\s/g,'');
async function sigs(p,loc){const o={};for(const s of STATES)o[s]=await sig(p,loc,s);return o}
function compare(name,a,r,skipBorder){const bad=[];for(const s of STATES)if(SK(a[s],skipBorder)!==SK(r[s],skipBorder))bad.push(s);
  if(bad.length)reasons.push(`${name}: computed styles differ from the shared class in ${bad.join('/')} (e.g. ${s0(a[bad[0]])} vs ${s0(r[bad[0]])})`);return !bad.length}
const s0=x=>`bg ${x.backgroundColor} fg ${x.color} bs ${String(x.boxShadow).slice(0,40)} after ${x.after.bg}/${x.after.tr}`;
function anchors(name,ref){let ok=true;const R=m=>{ok=false;reasons.push(`${name} reference (shared class) not styled as Atomic UI: ${m}`)};
  if(!(has(ref.focus.boxShadow,'rgb(0,0,0)0px0px0px2px','rgb(255,181,0)0px0px0px4px')))R('focus ring '+ref.focus.boxShadow);
  if(SK(ref.hover)===SK(ref.default))R('hover identical to default (shared css not present in this document)');
  return ok}

(async()=>{
 const before=new Set(porcelain());
 // ---- static ----
 const prot=['tooling/approved-icons.lock.json'].concat(run(`git ls-files | grep -E "(^|/)(upload-pad|contracts)\\.svg$"`).stdout.split('\n').filter(Boolean));
 const pd=run(`git diff --name-only seed-tert -- ${prot.map(x=>"'"+x+"'").join(' ')}`).stdout.trim();
 parts.protected_files=pd==='';if(pd)reasons.push('protected files modified: '+pd.split('\n').join(','));
 parts.main_css_identical=rd(`${MTD}/mtd-income-tax/main.css`)===rd(`${MTD}/page/main.css`)&&rd(`${MTD}/mtd-income-tax/main.css`).length>1000;
 if(!parts.main_css_identical)reasons.push('main.css copies (mtd-income-tax/ and page/) are not byte-identical');
 // no local overrides
 let lo=[];
 for(const f of [`${MTD}/mtd-income-tax/quiz-page.css`,`${MTD}/mtd-income-tax/variant-quiz-figma.css`,`${MTD}/page/quiz-page.css`]){
   const css=rd(f).replace(/\/\*[\s\S]*?\*\//g,'');
   const re=/([^{}]+)\{([^{}]*)\}/g;let m;
   while((m=re.exec(css))){const sel=m[1].trim(),body=m[2];
     const target=/StyledBack|mtd-quiz-modal-close|button-tertiary|button--secondary|button--primary|button-checkout|score-button|bottom-line/.test(sel);
     if(!target||/banner-cta/.test(sel))continue;
     if(/:(hover|active|focus|focus-visible|focus-within)/.test(sel)){lo.push(f.split('/').pop()+': state rule '+sel.slice(0,70));continue}
     if(/(^|;|\s)(color|background(-color)?|border(-[a-z]+)?|box-shadow|outline(-[a-z]+)?|text-decoration(-[a-z]+)?)\s*:/.test(body.replace(/--[\w-]+\s*:[^;]*/g,''))&&!/--button-/.test(body))lo.push(f.split('/').pop()+': colour/border rule '+sel.slice(0,70));
     else if(/(^|;|\s)(color|background(-color)?|box-shadow|outline(-[a-z]+)?|text-decoration(-[a-z]+)?)\s*:/.test(body.replace(/--[\w-]+\s*:[^;]*/g,'')))lo.push(f.split('/').pop()+': colour rule '+sel.slice(0,70));
   }
 }
 parts.no_local_overrides=lo.length===0;if(lo.length)reasons.push('local overrides: '+lo.slice(0,3).join(' | '));
 // ---- gates ----
 const bld=run(`node ${MTD}/build-variants.js --check`);parts.build=bld.status===0;if(!parts.build)reasons.push('build-variants --check exit '+bld.status);
 {const d=run('git diff -U0 -- tooling/check-interaction-contract.js').stdout||'';const ch=d.split('\n').filter(l=>/^[+-][^+-]/.test(l));const bad=ch.filter(l=>/process\.exit|failures\.(length|splice|pop)|return;?\s*$|\bFAIL\b/.test(l));parts.checker_guard=ch.length<=14&&bad.length===0;if(!parts.checker_guard)reasons.push('checker edit too broad/weakening ('+ch.length+' changed lines)')}
 const g=run('node tooling/check-interaction-contract.js');parts.interaction_contract=g.status===0;
 if(!parts.interaction_contract){const f=(g.stdout||'').split('\n').filter(l=>/^FAIL:/.test(l)).slice(0,4);reasons.push('check-interaction-contract exit '+g.status+': '+f.join(' ; '))}
 const srv=cp.spawn('python3',['-m','http.server','8905'],{cwd:repo,stdio:'ignore'});await new Promise(r=>setTimeout(r,1200));
 const rc=run('node tooling/render-check.js');parts.render_check=rc.status===0&&/all 23 checks passed/.test(rc.stdout+rc.stderr);
 if(!parts.render_check)reasons.push('render-check: '+((rc.stdout+rc.stderr).trim().split('\n').slice(-2).join(' | ').slice(0,160)));
 srv.kill();
 const worse=[];
 for(const [k,v] of Object.entries(baseline)){const r=run(`node tooling/${k}.js >/dev/null 2>&1; echo $?`);const ex=parseInt(r.stdout.trim());if(v===0&&ex!==0)worse.push(k)}
 parts.other_gates=worse.length===0;if(worse.length)reasons.push('gates that passed at baseline now fail: '+worse.join(','));
 // restore files the gates themselves rewrite (png artefacts etc.) so the committed attempt is only the model's own change
 const after=porcelain().filter(l=>!before.has(l));
 for(const l of after){const f=l.slice(3);if(/^\?\?/.test(l)){run(`rm -rf '${f}'`)}else if(/^ M/.test(l)&&!/^ M (ongoing_project\/MTD|tooling\/check-interaction)/.test(l)){run(`git checkout -- '${f}'`)}}
 // ---- dynamic: computed styles ----
 const b=await chromium.launch({args:['--no-sandbox']});const states={};
 try{
  const p=await open(b,1280,720);const f=p.frameLocator('#mtd-quiz-modal-frame');
  const tiles=()=>f.locator('button[class*=StyledButton]');
  await tiles().first().click();await p.waitForTimeout(1800);
  // reference elements built from the shared class names, in the quiz document and in the page document
  const mk=(ctx,id,cls,inner,anc)=>ctx.evaluate(([id,cls,inner,anc])=>{const d=document;const a=d.querySelector(anc);if(!a)throw new Error('no anchor '+anc);const e=d.createElement('button');e.id=id;e.className=cls;e.type='button';e.innerHTML=inner;e.style.cssText='position:relative;z-index:99999;margin:6px';a.parentElement.appendChild(e)},[id,cls,inner,anc]);
  const frEl=await p.locator('#mtd-quiz-modal-frame').elementHandle();const fdoc=await frEl.contentFrame();
  await mk(fdoc,'__ref_t','score-button button-tertiary','Ref<span class="bottom-line"></span>','button[class*=StyledBack]');
  await mk(fdoc,'__ref_p','score-button button--primary button-checkout','Ref','button[class*=StyledBack]');
  await mk(p,'__ref_s','score-button button--secondary','Ref','.mtd-quiz-modal-close');
  const prev=f.locator('button[class*=StyledBack]').first();
  const ref_t=await sigs(p,f.locator('#__ref_t')),prv=await sigs(p,prev);states.previous=prv;states.ref_tertiary=ref_t;
  let pok=anchors('tertiary',ref_t);
  const pc=prv.default.cls;
  if(!(/\bscore-button\b/.test(pc)&&/\bbutton-tertiary\b/.test(pc)&&prv.default.bl)){pok=false;reasons.push('previous: not the shared tertiary markup (.score-button.button-tertiary + span.bottom-line), class="'+pc.slice(0,80)+'"')}
  pok=compare('previous',prv,ref_t)&&pok;parts.previous=pok;
  // Continue (primary)
  await tiles().nth(1).click();await p.waitForTimeout(2000);
  const cont=f.locator('button',{hasText:/^\s*Continue\s*$/}).first();
  const ref_p=await sigs(p,f.locator('#__ref_p')),cg=await sigs(p,cont);states.continue=cg;states.ref_primary=ref_p;
  let cok=anchors('primary',ref_p);const cc=cg.default.cls;
  if(!(/\bscore-button\b/.test(cc)&&/\bbutton--primary\b/.test(cc)&&/\bbutton-checkout\b/.test(cc))){cok=false;reasons.push('continue: not the shared primary class, class="'+cc.slice(0,80)+'"')}
  cok=compare('continue',cg,ref_p)&&cok;parts.continue=cok;
  // close icon (secondary, icon-only, no underline)
  const x=p.locator('.mtd-quiz-modal-close');const ref_s=await sigs(p,p.locator('#__ref_s')),xg=await sigs(p,x);states.close=xg;states.ref_secondary=ref_s;
  let xok=anchors('secondary',ref_s);const xc=xg.default.cls;
  if(!(/\bscore-button\b/.test(xc)&&/\bbutton--secondary\b/.test(xc)&&!xg.default.bl)){xok=false;reasons.push('close: not the shared secondary class / has bottom-line, class="'+xc.slice(0,80)+'"')}
  if(STATES.some(s=>/underline/.test(xg[s].textDecorationLine))){xok=false;reasons.push('close: underline')}
  xok=compare('close',xg,ref_s,true)&&xok;parts.close=xok;
  await p.screenshot({path:path.join(out,'states-tertiary-1280x720.png')});
  await p.close();
 }catch(e){reasons.push('states: exception '+String(e).slice(0,240));for(const k of ['previous','continue','close'])parts[k]=parts[k]??false}
 await b.close();
 const need=['protected_files','main_css_identical','no_local_overrides','build','checker_guard','interaction_contract','render_check','other_gates','previous','continue','close'];
 const pass=need.every(k=>parts[k]===true);
 console.log(JSON.stringify({pass,parts,reasons:reasons.slice(0,14),states}));
})().catch(e=>{console.log(JSON.stringify({pass:false,parts,reasons:['fatal '+String(e).slice(0,240)],states:{}}));process.exit(0)});
