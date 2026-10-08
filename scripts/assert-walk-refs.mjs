#!/usr/bin/env node
/**
 * assert-walk-refs.mjs — every model a failover walk offers must be routable.
 *
 * A walk that hands the OpenCode CLI a bare model slug cannot ever succeed: the
 * CLI answers `Invalid model reference` BEFORE it routes, so the turn burns a
 * spawn, a round trip and a user-visible "switching to" line on every one —
 * nine of them, inside a fourteen-hop walk for the prompt "hi" (live VM4
 * 2026-10-06). The ref builders are the only place that decides the shape, and
 * they are mirrored across two files, so this gate holds both copies to one
 * table.
 *
 * The input that broke it is the point of the sensor. `withCatalogLanes`
 * strips a lane's own `opencode/` prefix for quota-key hygiene, so the walk
 * sees `{provider:'opencode', model:'big-pickle'}` — while the existing
 * `assert-r16-failover` fixture writes `model:'opencode/laguna-s-2.1-free'`
 * WITH its prefix, which the old `opencode` carve-out passed through happily.
 * Two storage conventions, one of them never tested. This gate drives the real
 * `selectTurnLanes` against a ledger folded from the catalog, i.e. the stripped
 * shape, and then asserts on what the walk would actually dispatch.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Temp HOME first: the ledger resolves from it, and a fixture host has no
// credentials and no prior stamps to make lanes selectively invisible.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-refs-'));
process.env.HOME = HOME;

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

console.log('assert-walk-refs (routable failover walk)\n');

const { toModelRef } = await import(path.join(ROOT, 'scripts', 'lib', 'freemodels.mjs'));
const lanesMod = await import(path.join(ROOT, 'scripts', 'lib', 'free-lanes.mjs'));
const { laneWalkRef, withCatalogLanes } = lanesMod;

/** A ref the CLI can route: it names a provider, or carries a surface prefix. */
const routable = (ref) => {
  const s = String(ref ?? '');
  return s.includes('/') || s.includes(':');
};

// [surface, id, expected] — every shape the ledger and the catalog produce.
// `opencode/big-pickle` is the regression: the old carve-out returned the bare
// `big-pickle`.
const CASES = [
  ['opencode', 'big-pickle', 'opencode/big-pickle'],
  ['opencode', 'nemotron-3.5-lightning-free', 'opencode/nemotron-3.5-lightning-free'],
  ['opencode', 'opencode/big-pickle', 'opencode/big-pickle'],
  ['opencode', 'tokenharbor/deepseek-v4.1-flash:free', 'tokenharbor/deepseek-v4.1-flash:free'],
  ['opencode', 'google/gemini-3.7-flash', 'google/gemini-3.7-flash'],
  ['', 'legacy-bare', 'opencode/legacy-bare'],
  ['tokenharbor', 'mimo-v2.6-flash:free', 'tokenharbor/mimo-v2.6-flash:free'],
  ['cloudflare', 'qwen3.8-flash:free', 'cloudflare/qwen3.8-flash:free'],
  ['opencode-go', 'space-bunny-free', 'opencode-go/space-bunny-free'],
  ['google', 'gemini-3.8-flash', 'gemini:gemini/gemini-3.8-flash'],
  ['gemini', 'gemini/gemini-3.1-pro', 'gemini:gemini/gemini-3.1-pro'],
  ['cline', 'cline-free/kat-coder-pro', 'cline:cline-free/kat-coder-pro'],
  ['freebuff', 'freebuff-x', 'freebuff/freebuff-x'],
];

// 1. The two mirrored builders agree, case for case.
{
  const drift = CASES.filter(([s, i]) => toModelRef(s, i) !== laneWalkRef(s, i));
  check('freemodels.toModelRef and free-lanes.laneWalkRef agree on every shape',
    drift.length === 0,
    drift.map(([s, i]) => `${s || '(none)'}:${i}`).join(', '));
}

// 2. Each shape resolves to its expected ref — an already-pathed id must come
//    back byte-identical (the whole of the old behaviour), a bare id must gain
//    its surface.
{
  const wrong = CASES.filter(([s, i, want]) => toModelRef(s, i) !== want)
    .map(([s, i, want]) => `${s || '(none)'}/${i} -> ${toModelRef(s, i)} (want ${want})`);
  check('every ref shape resolves to its routable form', wrong.length === 0, wrong.join(' | '));
}

// 3. Nothing in the table is a bare slug.
{
  const bare = CASES.filter(([s, i]) => !routable(toModelRef(s, i)))
    .map(([s, i]) => `${s || '(none)'}/${i}`);
  check('no ref builder emits a bare model slug', bare.length === 0, bare.join(', '));
}

// 4. The real storage shape: fold a catalog entry into an empty ledger and
//    confirm the prefix really is stripped — the input the old carve-out never
//    saw.
const folded = withCatalogLanes(
  { version: 1, updatedAt: new Date().toISOString(), buckets: {}, lanes: [] },
  ['opencode/big-pickle', 'opencode-go/space-bunny-free', 'tokenharbor/deepseek-v4.1-flash:free'],
).table;
{
  const stripped = (folded.lanes || []).find((l) => l.provider === 'opencode' && l.model === 'big-pickle');
  check('withCatalogLanes stores the lane with its opencode/ prefix stripped',
    Boolean(stripped), (folded.lanes || []).map((l) => `${l.provider}/${l.model}`).join(', '));
}

// 5. Drive the real walk against that ledger and read what it would dispatch.
const host = await import(path.join(__dirname, 'bot-host.mjs'));
const { selectTurnLanes } = host;
{
  const { ensureBotLedger } = lanesMod;
  const { dir } = ensureBotLedger('walkrefs');
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(folded, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }, null, 2));

  const choice = selectTurnLanes({
    botId: 'walkrefs',
    model: 'opencode/longcat-2.5-preview-free',
    fallback: 'opencode/longcat-2.5-preview-free',
  });
  const walked = choice.models || [];
  const bareWalk = walked.filter((m) => !routable(m));
  check('the walk dispatches only routable refs', walked.length > 0 && bareWalk.length === 0,
    `walk=[${walked.join(', ')}]`);

  check('the stripped opencode lane reaches the walk as opencode/big-pickle',
    walked.includes('opencode/big-pickle'), walked.join(', '));

  check('a lane the catalog folded in is never walked as a bare slug',
    !walked.includes('big-pickle'), walked.join(', '));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
