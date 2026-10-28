const {chromium}=require('playwright');
const URL='http://localhost:'+(process.env.PORT||8140)+'/ongoing_project/MTD/variant-a/index.html';
async function open(browser,w,h,url=URL){
  const ctx=await browser.newContext({viewport:{width:w,height:h}});
  const p=await ctx.newPage();
  await p.route('**/page-gate/page-gate.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:''}));
  await p.route('**/*.html',async r=>{const resp=await r.fetch();let t=await resp.text();t=t.replace('<div id="sage-page-gate">','<div id="sage-page-gate" hidden>');t=t.replace(/<style id="sage-page-gate-lock">[\s\S]*?<\/style>/,'');await r.fulfill({response:resp,body:t});});
  await p.addInitScript(()=>{const s=()=>document.documentElement.classList.add('sage-open');s();new MutationObserver(s).observe(document.documentElement,{attributes:true,attributeFilter:['class']});});
  await p.goto(url,{waitUntil:'load'});
  await p.evaluate(()=>{const l=document.getElementById('sage-page-gate-lock');if(l)l.remove();const g=document.getElementById('sage-page-gate');if(g)g.remove();});
  await p.waitForTimeout(800);
  return p;
}
async function openQuiz(p){
  await p.click('[data-mtd-quiz-trigger]');
  await p.waitForFunction(()=>{const f=document.getElementById('mtd-quiz-modal-frame');try{return /Step\s+1\s+of\s+7/.test(f.contentDocument.body.innerText)}catch(e){return false}},null,{timeout:20000});
  await p.waitForTimeout(1500);
}
module.exports={chromium,open,openQuiz,URL};
