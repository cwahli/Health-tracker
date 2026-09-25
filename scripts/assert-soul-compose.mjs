#!/usr/bin/env node
/**
 * assert-soul-compose.mjs — BOT-16 named gate.
 *
 * Proves the composed soul contract without touching live ~/.hermes state:
 *  1. bots/soul.md + bots/soul-capabilities.json + every bots/soul.<id>.md
 *     exist and parse.
 *  2. Locked line budgets hold: base 12 · capabilities 4 · override 16 ·
 *     composed total 34.
 *  3. Every composed soul carries the three bot-work laws and its role header.
 *  4. setup-hermes-global-soul.sh writes souls only through the composer
 *     (no inline soul heredocs left to drift).
 *  5. The composer round-trips into a temp home byte-identical to composeSoul.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOTS = path.join(ROOT, 'bots');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('assert-soul-compose (BOT-16)\n');

const {
  PROFILES,
  BUDGETS,
  composeSoul,
  checkSoul,
  writeSouls,
  verifySouls,
} = await import(new URL(`file://${path.join(ROOT, 'scripts/lib/soul-compose.mjs').replace(/\\/g, '/')}`).href);// 1. Sources exist and parse.
check('bots/soul.md exists', fs.existsSync(path.join(BOTS, 'soul.md')));
let caps = null;
try {
  caps = JSON.parse(read('bots/soul-capabilities.json'));
  check('bots/soul-capabilities.json parses', true);
} catch (err) {
  check('bots/soul-capabilities.json parses', false, err.message);
}
for (const p of PROFILES) {
  check(`bots/soul.${p}.md exists`, fs.existsSync(path.join(BOTS, `soul.${p}.md`)));
}

// 2. Locked budgets.
check('budgets locked at 12/4/16/34',
  BUDGETS.base === 12 && BUDGETS.capabilities === 4 &&
  BUDGETS.override === 16 && BUDGETS.total === 34);
const all = checkSoul(null, { dir: BOTS });
check('every profile composes within budget', all.ok, all.violations.join('; '));

// 3. Content: three laws + role header in every composed soul.
const LAWS = [
  'One defect per card',
  'Only scripts/run-coding-dispatch.sh starts a coder',
  'named_test green',
];
for (const p of PROFILES) {
  let text = '';
  try {
    text = composeSoul(p, { dir: BOTS });
  } catch (err) {
    check(`compose ${p}`, false, err.message);
    continue;
  }
  check(`compose ${p}`, true);
  for (const law of LAWS) {
    check(`${p} carries law "${law.slice(0, 28)}…"`, text.includes(law));
  }
  const header = text.split('\n').find((l) => l.startsWith('# '));
  check(`${p} keeps a role header`, Boolean(header));
}

// 4. Setup script has no inline soul heredocs; it calls the composer.
const setupSrc = read('scripts/setup-hermes-global-soul.sh');
check('setup calls soul-compose.mjs write', setupSrc.includes('soul-compose.mjs" write'));
for (const marker of ['SOUL_EOF', 'QA_MEAL_EOF', 'ORCH_SOUL_EOF', 'BUG_TICKET_MEM_EOF']) {
  if (marker === 'BUG_TICKET_MEM_EOF') continue; // memory heredoc, not a soul
  check(`setup has no ${marker} soul heredoc`, !setupSrc.includes(marker));
}

// 5. Write round-trip into a temp home.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soul_gate_'));
try {
  const written = writeSouls({ home: tmpHome, dir: BOTS });
  check('writeSouls writes 7 souls', written.length === 7, `${written.length}`);
  let identical = true;
  for (const p of PROFILES) {
    const target = p === 'default'
      ? path.join(tmpHome, '.hermes', 'SOUL.md')
      : path.join(tmpHome, '.hermes', 'profiles', p, 'SOUL.md');
    if (fs.readFileSync(target, 'utf8') !== composeSoul(p, { dir: BOTS })) identical = false;
  }
  check('written souls byte-identical to composeSoul', identical);
} finally {
  fs.rmSync(path.join(tmpHome, '.hermes'), { recursive: true, force: true });
}

// 6. verifySouls detects drift read-only (the VPS live check).
const tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'soul_verify_'));
try {
  writeSouls({ home: tmpHome2, dir: BOTS });
  const clean = verifySouls({ home: tmpHome2, dir: BOTS });
  check('verify passes on fresh souls', clean.ok === true && clean.drift.length === 0);
  fs.writeFileSync(path.join(tmpHome2, '.hermes', 'SOUL.md'), '# drifted\n');
  const dirty = verifySouls({ home: tmpHome2, dir: BOTS });
  check('verify flags a drifted soul', dirty.ok === false && dirty.drift.some((d) => d.profile === 'default'));
  const missing = verifySouls({ home: path.join(tmpHome2, 'nowhere'), dir: BOTS });
  check('verify flags missing souls', missing.ok === false && missing.drift.length === PROFILES.length);
} finally {
  fs.rmSync(tmpHome2, { recursive: true, force: true });
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
