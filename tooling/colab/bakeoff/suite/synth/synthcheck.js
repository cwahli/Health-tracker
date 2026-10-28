// usage: node synthcheck.js <6|7> REPO   -> prints one JSON line {pass, parts, reasons}
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const task = process.argv[2], repo = path.resolve(process.argv[3]);
const parts = {}, reasons = [];
const sh = (c, o = {}) => spawnSync('bash', ['-c', c], { cwd: repo, encoding: 'utf8', timeout: 120000, ...o });
const ok = (k, v, why) => { parts[k] = !!v; if (!v) reasons.push(why || k); };
const changed = () => {
  const a = sh(`git diff --name-only seed-t${task}`).stdout.split('\n').filter(Boolean);
  const b = sh('git ls-files --others --exclude-standard').stdout.split('\n').filter(Boolean);
  return [...new Set([...a, ...b])];
};
const files = changed();
const read = p => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return ''; } };
const fresh = p => { delete require.cache[require.resolve(path.join(repo, p))]; return require(path.join(repo, p)); };

if (task === '6') {
  const allowed = f => ['tooling/lib/fold-chars.js', 'tooling/lib/copy-norm.js', 'tooling/check-component-contracts.js'].includes(f);
  const extra = files.filter(f => !allowed(f));
  ok('scope', files.length && !extra.length, 'files outside the fault area changed: ' + extra.join(','));
  const st = sh('node tooling/check-component-contracts.js --selftest');
  ok('selftest', st.status === 0 && /SELFTEST PASS/.test(st.stdout), 'selftest still failing: ' + (st.stdout || '').trim().split('\n')[0]);
  const src = read('tooling/check-component-contracts.js');
  const m = /SELFTEST PASS \((\d+) proofs\)/.exec(st.stdout || '');
  ok('regression_test_added', m && +m[1] >= 5, 'no regression test added (proof count ' + (m ? m[1] : '?') + ' < 5)');
  ok('selftest_not_weakened', ["'dual-source fires'", "'paint escape fires'", "'norm strips wip/new prefixes and suffixes'", "'normCopy folds typography'",
    "normCopy('Move from \\u201ccrunching\\u201d \\u2026 done') === normCopy('Move from \"crunching\" ... done')"].every(s => src.includes(s)), 'an existing selftest proof was removed or edited');
  let hid = true, why = '';
  try {
    const { normCopy, norm } = fresh('tooling/lib/copy-norm.js');
    const T = [['a\u201cb\u201d', 'a"b"'], ['it\u2018s\u2019', "it's'"], ['x\u2026', 'x...'], ['a\u00a0b', 'a b'], ['trail   \n', 'trail'], ['\u201cquoted\u201d \u2013', '"quoted" \u2013'], ['a \u2019 b', "a ' b"], ['  two   spaces ', 'two spaces']];
    for (const [i, o] of T) if (normCopy(i) !== o) { hid = false; why += ` normCopy(${JSON.stringify(i)})=${JSON.stringify(normCopy(i))}`; }
    if (norm('WIP NEW-2 - Foo (6 spots)') !== norm('NEW-2 - Foo')) { hid = false; why += ' norm broke'; }
  } catch (e) { hid = false; why = 'copy-norm.js load: ' + e.message.slice(0, 80); }
  ok('hidden_asserts', hid, 'hidden assertions: ' + why);
  const full = sh('node tooling/check-component-contracts.js');
  ok('full_gate', full.status === 0, 'full contracts gate exit ' + full.status);
  const dbg = sh(`git diff -U0 seed-t6 | grep -E '^\\+.*(console\\.(log|debug)\\(.*(DEBUG|XXX|here)|debugger|TODO)' || true`).stdout.trim();
  ok('no_debug', !dbg, 'debug leftovers: ' + dbg.slice(0, 80));
} else if (task === '7') {
  const allowed = f => /^tooling\/lib\/[^/]+\.js$/.test(f) || ['tooling/check-contrast.js', 'tooling/check-theme.js'].includes(f);
  const extra = files.filter(f => !allowed(f));
  ok('scope', files.length && !extra.length, 'files outside scope changed: ' + extra.join(','));
  const newLib = files.filter(f => /^tooling\/lib\/[^/]+\.js$/.test(f) && sh(`git cat-file -e seed-t7:${f} 2>/dev/null; echo $?`).stdout.trim() !== '0');
  ok('shared_module', newLib.length >= 1, 'no new tooling/lib module');
  const cc = read('tooling/check-contrast.js'), ct = read('tooling/check-theme.js');
  ok('both_require_lib', /require\(\s*['"]\.\/lib\/[^'"]+['"]\s*\)/.test(cc) && /require\(\s*['"]\.\/lib\/[^'"]+['"]\s*\)/.test(ct), 'both scripts must require the shared lib');
  const pow = (cc.match(/Math\.pow\(/g) || []).length + (ct.match(/Math\.pow\(/g) || []).length;
  ok('single_source', !/0\.03928/.test(cc) && !/function luminance|const luminance/.test(cc) && !/function luminance/.test(ct) && pow <= 1,
    `duplicate colour maths remains (Math.pow x${pow}, 0.03928 ${/0\.03928/.test(cc)})`);
  // selftests: same verdict and same output as the seed
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b7-'));
  sh(`mkdir -p ${base}/tooling && git show seed-t7:tooling/check-contrast.js > ${base}/tooling/check-contrast.js && git show seed-t7:tooling/check-theme.js > ${base}/tooling/check-theme.js`);
  for (const f of ['check-contrast', 'check-theme']) {
    const a = spawnSync('node', [path.join(base, 'tooling', f + '.js'), '--selftest'], { encoding: 'utf8', cwd: base });
    const b = sh(`node tooling/${f}.js --selftest`);
    ok('selftest_' + f, b.status === 0 && b.stdout === a.stdout, `${f} --selftest differs from seed (exit ${b.status})`);
  }
  // numeric differential on the exported check-theme maths
  try {
    const B = require(path.join(base, 'tooling/check-theme.js')), N = fresh('tooling/check-theme.js');
    const cols = ['#000', '#fff', '#008146', '#F2F5F6', '#00D639', 'rgb(10,11,12)', 'rgba(0,0,0,0.9)', 'rgb(1 2 3 / 0.5)', 'rgba(255,181,0,0.3)', 'nonsense', '#12', ''];
    let bad = '';
    for (const x of cols) {
      if (JSON.stringify(B.parseColor(x)) !== JSON.stringify(N.parseColor(x))) bad += ` parse(${x})`;
      for (const y of cols) {
        const bx = B.parseColor(x), by = B.parseColor(y), nx = N.parseColor(x), ny = N.parseColor(y);
        if (!bx || !by) continue;
        if (Math.abs(B.ratio(bx, by) - N.ratio(nx, ny)) > 1e-9) bad += ` ratio(${x},${y})`;
        if (JSON.stringify(B.over(bx, by)) !== JSON.stringify(N.over(nx, ny))) bad += ` over(${x},${y})`;
      }
    }
    for (const [p, w] of [[24, 400], [18.66, 700], [18.66, 400], [14, 700]]) if (B.bar(p, w) !== N.bar(p, w)) bad += ` bar(${p},${w})`;
    ok('theme_equivalence', !bad, 'check-theme maths changed:' + bad.slice(0, 120));
  } catch (e) { ok('theme_equivalence', false, 'check-theme load: ' + e.message.slice(0, 80)); }
  // probe check-contrast pure core (strip the CLI dispatch, expose ratio)
  const probe = (dir) => {
    const src = fs.readFileSync(path.join(dir, 'tooling/check-contrast.js'), 'utf8');
    const k = src.search(/^if \(has\('--selftest'\)\)/m);
    if (k < 0) return null;
    const p = path.join(dir, 'tooling', '_probe_cc.js');
    fs.writeFileSync(p, src.slice(0, k) + '\nmodule.exports={ratio};\n');
    try { const r = require(p).ratio; fs.unlinkSync(p); return r; } catch (e) { try { fs.unlinkSync(p); } catch {} return null; }
  };
  const rb = probe(base), rn = probe(repo);
  if (rb && rn) {
    const cols = ['#000', '#ffffff', 'white', 'black', '#008146', '#F2F5F6', 'rgba(0, 0, 0, 0.9)', 'rgb(242, 245, 246)', '#abc', 'nonsense', 'rgba(0,214,57,0.3)'];
    let bad = '';
    for (const x of cols) for (const y of cols) {
      const a = rb(x, y), b = rn(x, y);
      if ((a === null) !== (b === null) || (a !== null && Math.abs(a - b) > 1e-9)) bad += ` ratio(${x},${y})`;
    }
    ok('contrast_equivalence', !bad, 'check-contrast ratio() changed:' + bad.slice(0, 120));
  } else ok('contrast_equivalence', false, 'check-contrast pure core not loadable/ratio() missing');
  fs.rmSync(base, { recursive: true, force: true });
}
const pass = Object.values(parts).every(Boolean);
console.log(JSON.stringify({ pass, parts, reasons, changed: files.length }));
