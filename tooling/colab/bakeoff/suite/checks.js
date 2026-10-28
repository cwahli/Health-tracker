'use strict';
// checks.js tN REPO  -> prints one JSON line {pass, reasons[]}. Objective, no model involvement.
const { execSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const [task, repo] = [process.argv[2], process.argv[3]];
const reasons = [];
const sh = (c, o = {}) => { try { return execSync(c, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, ...o }); } catch (e) { e.out = (e.stdout || '') + (e.stderr || ''); throw e; } };
const run = (args, o = {}) => spawnSync(args[0], args.slice(1), { cwd: repo, encoding: 'utf8', timeout: 300000, ...o });
const tag = 'seed-' + task;
// changed files vs the seed commit (tracked + untracked, excluding gitignored)
const changed = new Set();
sh(`git diff --name-only ${tag}`).split('\n').filter(Boolean).forEach(f => changed.add(f));
sh('git ls-files --others --exclude-standard').split('\n').filter(Boolean).forEach(f => changed.add(f));
const allowed = {
  t1: [/^components\/mtd-pricing\/fallback\.css$/],
  t2: [/^components\/mtd-pricing\/fallback\.css$/],
  t3: [/^tooling\/(add-pair|bot-dispatch|check-contrast)\.js$/, /^tooling\/lib\/args\.js$/],
  t4: [/^tooling\/check-contrast\.js$/],
  t5: [/^components\/mtd-callout\/callout\.css$/],
}[task];
const bad = [...changed].filter(f => !allowed.some(r => r.test(f)));
if (bad.length) reasons.push('unrelated changes: ' + bad.slice(0, 6).join(', '));
const read = f => fs.readFileSync(path.join(repo, f), 'utf8');
const base = f => sh(`git show ${tag}:${f}`, { maxBuffer: 1 << 26 });

function t1() {
  const f = 'components/mtd-pricing/fallback.css';
  const exp = base(f).replace('color: rgba(255, 255, 255, 0.65);', 'color: rgba(255, 255, 255, 0.72);');
  if (read(f) !== exp) reasons.push('fallback.css is not exactly the expected edit');
}
function t2() {
  const r = run(['node', 'tooling/check-interaction-contract.js', '--static-only']);
  if (r.status !== 0) reasons.push('static contract fails: ' + (r.stdout + r.stderr).split('\n').filter(l => /FAIL/.test(l)).slice(0, 2).join(' | '));
  const css = read('components/mtd-pricing/fallback.css');
  for (const need of ['min-height: 48px', 'padding: 0 24px', 'min-height: 44px', ".mtd-pricing-cta.button--secondary", ".button-tertiary {"]) if (!css.replace(/\s+/g, ' ').includes(need.replace(/\s+/g, ' '))) reasons.push('layout rule lost: ' + need);
  for (const need of ["[data-pattern-id='PS01']", 'overflow-x: clip', '.content-spot--footnotes p']) if (!css.includes(need)) reasons.push('original rule lost: ' + need);
}
function t3() {
  const lib = 'tooling/lib/args.js';
  if (!fs.existsSync(path.join(repo, lib))) { reasons.push('tooling/lib/args.js missing'); return; }
  const test = `process.argv=['node','x','--foo','bar','--flag'];const a=require(${JSON.stringify(path.join(repo, lib))});
const ok=Array.isArray(a.argv)&&a.argv.join()==='--foo,bar,--flag'&&a.has('--flag')===true&&a.has('--zzz')===false&&a.val('--foo','d')==='bar'&&a.val('--zzz','d')==='d'&&a.val('--zzz')===undefined;
process.exit(ok?0:1)`;
  const r = run(['node', '-e', test]);
  if (r.status !== 0) reasons.push('lib/args.js exports/behaviour wrong');
  for (const f of ['add-pair', 'bot-dispatch', 'check-contrast']) {
    const p = `tooling/${f}.js`, s = read(p);
    if (/const\s+has\s*=/.test(s) || /const\s+val\s*=/.test(s) || /const\s+argv\s*=\s*process\.argv/.test(s)) reasons.push(f + ' still defines helpers');
    if (!/require\(\s*['"]\.\/lib\/args(\.js)?['"]\s*\)/.test(s)) reasons.push(f + ' does not require ./lib/args');
    if (run(['node', '--check', p]).status !== 0) reasons.push(f + ' fails node --check');
    if (!/\b(has|val)\(/.test(s)) reasons.push(f + ' no longer uses has/val');
  }
  const st = run(['node', 'tooling/check-contrast.js', '--selftest']);
  if (st.status !== 0) reasons.push('check-contrast --selftest fails');
  const us = run(['node', 'tooling/check-contrast.js']);
  if (us.status !== 2) reasons.push('check-contrast usage exit != 2');
}
function t4() {
  const f = 'tooling/check-contrast.js';
  const s = read(f);
  const grab = name => { const i = s.indexOf('function ' + name + '('); if (i < 0) return null; let d = 0, k = s.indexOf('{', i); for (let j = k; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return s.slice(i, j + 1); } return null; };
  const src = ['parseColor', 'luminance', 'ratio'].map(grab);
  if (src.some(x => !x)) { reasons.push('parseColor/luminance/ratio not found as functions'); }
  else {
    const L = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = (r, g, b) => 0.2126 * L(r) + 0.7152 * L(g) + 0.0722 * L(b);
    const ref = (fg, a, bg) => { const e = fg.map((v, i) => v * a + bg[i] * (1 - a)); const x = lum(...e), y = lum(...bg); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    let R; try { R = new Function(src.join('\n') + '\nreturn ratio;')(); } catch (e) { reasons.push('cannot load functions: ' + e.message); }
    if (R) {
      const cases = [['rgba(0, 0, 0, 0.5)', '#ffffff', ref([0, 0, 0], .5, [255, 255, 255])], ['rgba(255,255,255,0.3)', '#000', ref([255, 255, 255], .3, [0, 0, 0])], ['rgba(0, 128, 70, 0.8)', 'rgb(242, 245, 246)', ref([0, 128, 70], .8, [242, 245, 246])], ['#000000', '#ffffff', 21], ['#abc', '#fff', ref([170, 187, 204], 1, [255, 255, 255])]];
      for (const [a, b, e] of cases) { const g = R(a, b); if (g === null || Math.abs(g - e) > 0.02) reasons.push(`ratio(${a},${b})=${g} expected ${e.toFixed(3)}`); }
      if (R('nonsense', '#fff') !== null) reasons.push('null case broken');
    }
  }
  const st = run(['node', f, '--selftest']);
  if (st.status !== 0) reasons.push('selftest fails');
  const cnt = x => (x.match(/\bt\(\s*'/g) || []).length;
  if (cnt(s) <= cnt(base(f))) reasons.push('no regression test added to selftest');
  if (cnt(s) < cnt(base(f))) reasons.push('existing tests removed');
}
function t5() {
  const f = 'components/mtd-callout/callout.css';
  if (!fs.existsSync(path.join(repo, f))) { reasons.push('callout.css missing'); return; }
  const css = read(f);
  if (/:(hover|focus|focus-visible|active)\b/.test(css)) reasons.push('state pseudo-class used in callout.css');
  const st = run(['node', 'tooling/check-interaction-contract.js', '--static-only']);
  if (st.status !== 0) reasons.push('static contract fails');
  const script = `
const { chromium } = require(${JSON.stringify(path.join(repo, 'node_modules/playwright'))});
(async()=>{
 const html='<!doctype html><html><head><meta charset=utf-8><link rel=stylesheet href="file://${path.join(repo, f)}"></head><body style="margin:0"><div style="width:var(--w)" id=c><div class="mtd-callout"><h3 class="mtd-callout__title">Title</h3><p class="mtd-callout__body">Body copy</p><a class="button--secondary mtd-callout__cta" href="#">Go</a></div></div></body></html>';
 fs=require('fs');fs.writeFileSync('/tmp/callout-fixture.html',html);
 const b=await chromium.launch({args:['--no-sandbox']});const out=[];
 for(const [w,cw] of [[1440,1000],[390,390]]){
  const p=await b.newPage({viewport:{width:w,height:900}});
  await p.goto('file:///tmp/callout-fixture.html');
  await p.evaluate(cw=>document.getElementById('c').style.setProperty('--w',cw+'px'),cw);
  const g=await p.evaluate(()=>{const q=(s,pr)=>{const e=document.querySelector(s);const c=getComputedStyle(e);return pr.reduce((o,k)=>(o[k]=c[k],o),{})};
   return {card:q('.mtd-callout',['display','boxSizing','width','maxWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','backgroundColor','borderTopLeftRadius','borderLeftWidth','borderLeftStyle','borderLeftColor','borderTopWidth','borderRightWidth','borderBottomWidth','fontFamily']),
    title:q('.mtd-callout__title',['marginTop','marginBottom','fontSize','lineHeight','fontWeight','color']),
    body:q('.mtd-callout__body',['marginTop','marginBottom','fontSize','lineHeight','fontWeight','color']),
    cta:q('.mtd-callout__cta',['marginTop','display','minHeight','paddingLeft','paddingRight','paddingTop'])}});
  out.push([w,g]);await p.close();}
 await b.close();console.log(JSON.stringify(out));})().catch(e=>{console.error(e.message);process.exit(3)});`;
  fs.writeFileSync('/tmp/callout-check.js', script);
  const r = run(['node', '/tmp/callout-check.js']);
  if (r.status !== 0) { reasons.push('render failed: ' + (r.stderr || '').slice(0, 150)); return; }
  const res = JSON.parse(r.stdout.trim().split('\n').pop());
  const eq = (w, label, got, exp) => { if (String(got) !== String(exp)) reasons.push(`@${w} ${label}: got ${got} expected ${exp}`); };
  for (const [w, g] of res) {
    const mob = w <= 767, c = g.card;
    eq(w, 'display', c.display, 'block'); eq(w, 'box-sizing', c.boxSizing, 'border-box');
    eq(w, 'max-width', c.maxWidth, '560px'); eq(w, 'width', c.width, w === 1440 ? '560px' : '390px');
    eq(w, 'padding-top', c.paddingTop, mob ? '16px' : '24px'); eq(w, 'padding-bottom', c.paddingBottom, mob ? '16px' : '24px');
    eq(w, 'padding-left', c.paddingLeft, mob ? '20px' : '32px'); eq(w, 'padding-right', c.paddingRight, mob ? '20px' : '32px');
    eq(w, 'bg', c.backgroundColor, 'rgb(242, 245, 246)'); eq(w, 'radius', c.borderTopLeftRadius, '16px');
    eq(w, 'border-left-width', c.borderLeftWidth, '4px'); eq(w, 'border-left-style', c.borderLeftStyle, 'solid'); eq(w, 'border-left-color', c.borderLeftColor, 'rgb(0, 214, 57)');
    eq(w, 'other borders', [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth].join(), '0px,0px,0px');
    if (!/Sage UI/.test(c.fontFamily) || !/Arial/.test(c.fontFamily)) reasons.push(`@${w} font-family ${c.fontFamily}`);
    const t = g.title; eq(w, 'title margin', t.marginTop + ' ' + t.marginBottom, '0px 0px'); eq(w, 'title size', t.fontSize, mob ? '18px' : '20px'); eq(w, 'title lh', t.lineHeight, mob ? '24px' : '28px'); eq(w, 'title weight', t.fontWeight, '600'); eq(w, 'title color', t.color, 'rgb(0, 0, 0)');
    const b = g.body; eq(w, 'body margin', b.marginTop + ' ' + b.marginBottom, '8px 0px'); eq(w, 'body size', b.fontSize, '16px'); eq(w, 'body lh', b.lineHeight, '24px'); eq(w, 'body weight', b.fontWeight, '400'); eq(w, 'body color', b.color, 'rgba(0, 0, 0, 0.65)');
    const k = g.cta; eq(w, 'cta margin-top', k.marginTop, '16px'); eq(w, 'cta display', k.display, 'inline-flex'); eq(w, 'cta min-height', k.minHeight, '44px'); eq(w, 'cta padding', k.paddingLeft + ' ' + k.paddingRight, '24px 24px');
  }
}
try { ({ t1, t2, t3, t4, t5 })[task](); } catch (e) { reasons.push('check crashed: ' + String(e.out || e.message).slice(0, 200)); }
console.log(JSON.stringify({ pass: reasons.length === 0, reasons, changed: [...changed] }));
