#!/usr/bin/env node
/**
 * assert-r16-failover.test.mjs — QS-2 / QS-9 / QS-10 / QS-11 named gate.
 *
 * Failover across lanes, tiers and hosts, with temp ledgers and stubbed
 * runners: no Telegram, no model calls, no quota burned. A quota-shaped
 * provider error still travels the real path (parser → stamp → walk), because
 * faking the stamp would prove nothing.
 *  QS-9: the auto-continue chain walks reachable hosts in order, never
 *    repeats a host, skips the unreachable, survives a throwing hop, prefers
 *    the requested host, and stops with 'no location has quota' when dry
 *    everywhere — never re-calling a failed lane.
 *  QS-11: a mid-stream quota death (partial text + quota signal) stamps the
 *    lane, continues the chain, and delivers partial + flag + completion; a
 *    total wipeout keeps the partial and says no lane completed.
 *  QS-2: the switch line names from → to and never surfaces raw JSON (the
 *    INFERENCE_CAP_ERROR specimen from 2026-09-25 stays in the ledger).
 *  QS-10: tier-internal order is coding → unknown → light on one host;
 *    ended, terminal-only and Freebuff rows are never offered; stamp one
 *    member of a shared bucket and the sibling goes down with it.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Temp HOME first: ledgers, dead-end notes and presence all resolve from it.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'r16-failover-'));
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

console.log('assert-r16-failover (QS-2/QS-9/QS-10/QS-11)\n');

const host = await import(path.join(__dirname, 'bot-host.mjs'));
const { continueTurnOnNextWorker, runOpencodeWithFailover, midstreamFlagText, selectTurnLanes } = host;
const lanes = await import(path.join(__dirname, 'lib', 'free-lanes.mjs'));
check('the chain is exported', typeof continueTurnOnNextWorker === 'function');
check('the mid-stream flag builder is exported', typeof midstreamFlagText === 'function');

// ---------------------------------------------------------------- QS-9
const DRY = { done: false, dry: true, handed: { text: '', error: 'Error 429: Daily free limit reached', code: 1 } };
const HIT = (h) => ({ done: true, delivered: true, handed: { text: `answer from ${h}`, error: '', code: 0 } });
const HELD = (why) => ({ done: true, held: true, reason: why, handed: null });
// The chain walks KNOWN_HOSTS (mobile/collab/grok on this box); statusOf decides.
const up = new Set(['mobile', 'collab', 'grok']);
{
  const calls = [];
  const out = await continueTurnOnNextWorker({
    fromHost: 'vps',
    tried: ['vps'],
    prefer: 'mobile',
    runTurn: async (h) => { calls.push(h); return h === 'mobile' ? DRY : HIT(h); },
    statusOf: async (h) => ({ reachable: up.has(h) }),
  });
  check('a dry first host walks on and delivers', out.ok === true && out.host === 'collab' && out.handed.text === 'answer from collab');
  check('the requested host goes first', calls[0] === 'mobile' && calls.length === 2, calls.join(','));
  check('every hop is named', out.hops.map((h) => `${h.host}:${h.ok ? 'ok' : 'dry'}`).join(',') === 'mobile:dry,collab:ok');
}
{
  const calls = [];
  const out = await continueTurnOnNextWorker({
    fromHost: 'vps', tried: ['vps'],
    runTurn: async (h) => { calls.push(h); return DRY; },
    statusOf: async (h) => ({ reachable: up.has(h) }),
  });
  check('dry everywhere stops with no-location-has-quota', out.ok === false && out.reason === 'no location has quota');
  check('no host is ever called twice', new Set(calls).size === calls.length && calls.length === 3, calls.join(','));
}
{
  const out = await continueTurnOnNextWorker({
    fromHost: 'vps', tried: ['vps'],
    runTurn: async () => { throw new Error('relay blip'); },
    statusOf: async (h) => ({ reachable: h === 'mobile' }),
  });
  check('the unreachable are skipped, a throwing hop does not end the walk',
    out.ok === false && out.hops.some((h) => h.reason === 'unreachable, skipped')
    && out.hops.some((h) => /relay blip/.test(h.reason || '')));
}
{
  // A held hop (canary failed, preflight failed) is a wall, not a success:
  // the chain must walk past it instead of stopping with no answer.
  const calls = [];
  const out = await continueTurnOnNextWorker({
    fromHost: 'vps', tried: ['vps'],
    runTurn: async (h) => { calls.push(h); return h === 'mobile' ? HELD('canary failed: empty result') : HIT(h); },
    statusOf: async (h) => ({ reachable: up.has(h) }),
  });
  check('a held hop is walked past, not mistaken for delivery',
    out.ok === true && out.host === 'collab' && calls.join(',') === 'mobile,collab'
    && out.hops.map((h) => `${h.host}:${h.ok ? 'ok' : h.reason}`).join(',') === 'mobile:canary failed: empty result,collab:ok');
}

// ---------------------------------------------------------------- QS-11 + QS-2
const SPECIMEN = 'Error: INFERENCE_CAP_ERROR {"code":429,"message":"Daily free limit reached. Try again in 11h 35m."}';
const switchLines = [];
const runStub = (script) => {
  const q = [...script];
  return async () => q.shift() || { finalText: '', lastError: 'out of scripted runs' };
};
{
  const res = await runOpencodeWithFailover({
    api: { sendMessage: async () => ({}) },
    config: { id: 'qs11' },
    chatId: 1,
    prompt: 'x',
    models: ['m-dying', 'm-next'],
    workspace: '/tmp',
    timeoutMs: 5000,
    runModel: runStub([
      { finalText: 'first half of the answer', lastError: SPECIMEN },
      { finalText: 'second half', lastError: '' },
    ]),
    onSwitchNotify: (line) => switchLines.push(line),
  });
  check('a mid-stream death keeps the partial and completes on the next lane',
    res._partialText === 'first half of the answer' && res.finalText === 'second half',
    `partial=${res._partialText} final=${res.finalText}`);
  check('the dead lane is named for the flag line',
    Array.isArray(res._midstreamQuota) && res._midstreamQuota.join(',') === 'm-dying'
    && res._continuedOn === 'm-next');
  check('the switch line names from → to with a short verdict, never raw JSON',
    switchLines.length === 1 && switchLines[0].includes('m-dying') && switchLines[0].includes('m-next')
    && !switchLines[0].includes('{') && /free limit hit/i.test(switchLines[0]), switchLines[0]);
  const flag = midstreamFlagText({ partialText: res._partialText, deadLanes: res._midstreamQuota, continuedOn: res._continuedOn });
  check('the flag delivers the partial first, then names dead lane and continuer',
    flag.startsWith('first half of the answer') && flag.includes('m-dying') && flag.includes('m-next'));
}
{
  const res = await runOpencodeWithFailover({
    api: { sendMessage: async () => ({}) },
    config: { id: 'qs11b' },
    chatId: 1,
    prompt: 'x',
    models: ['m-doomed'],
    workspace: '/tmp',
    timeoutMs: 5000,
    runModel: runStub([{ finalText: 'orphan half', lastError: SPECIMEN }]),
  });
  check('a total wipeout keeps the partial and says no lane completed',
    res._partialText === 'orphan half' && res._continuedOn === ''
    && midstreamFlagText({ partialText: res._partialText, deadLanes: res._midstreamQuota, continuedOn: res._continuedOn }).includes('no lane completed'));
}

// ---------------------------------------------------------------- QS-10
const { ensureBotLedger } = lanes;
const { dir } = ensureBotLedger('qs10');
const lane = (provider, model, pref, extra = {}) => ({
  provider, model, pref, label: model.split('/').pop(), tg: true, status: 'available', ...extra,
});
const table = {
  version: 1,
  updatedAt: new Date().toISOString(),
  buckets: {},
  lanes: [
    lane('opencode', 'opencode/laguna-s-2.1-free', 1),
    lane('opencode', 'opencode/zzz-nope-free', 2),
    lane('opencode', 'opencode/deepseek-v4.1-flash', 3),
    lane('opencode', 'opencode/sb-a-free', 4, { bucket: 'test-shared' }),
    lane('opencode', 'opencode/sb-b-free', 5, { bucket: 'test-shared' }),
    lane('opencode', 'opencode/old-promo-free', 6, { status: 'ended' }),
    lane('freebuff', 'freebuff/deepseek-v4-flash', 7, { tg: false }),
  ],
};
fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));
fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ quota: {} }, null, 2));
{
  const choice = selectTurnLanes({ botId: 'qs10', model: 'opencode/deepseek-v4.1-flash', fallback: 'opencode/deepseek-v4.1-flash' });
  const models = choice.models;
  const deep = models.indexOf('opencode/deepseek-v4.1-flash');
  const zzz = models.indexOf('opencode/zzz-nope-free');
  const lag = models.indexOf('opencode/laguna-s-2.1-free');
  check('tier-internal order is coding → unknown → light against adversarial prefs',
    deep !== -1 && zzz !== -1 && lag !== -1 && deep < zzz && zzz < lag, models.join(','));
  check('ended rows are never offered', !models.some((m) => String(m).includes('old-promo')));
  check('terminal-only and Freebuff rows are never chosen',
    !models.some((m) => String(m).includes('freebuff')) && !choice.exhausted);
}
{
  // QS-10 sibling buckets + QS-2/11 stamping go through the real writer: a
  // quota-shaped error, a temp ledger, no model call, no quota burned.
  const stamped = lanes.stampDepleted({
    stateDir: dir, provider: 'opencode', model: 'opencode/sb-a-free',
    errText: 'Error 429: Daily free limit reached. Try again in 6h.',
  });
  check('the stamp lands on the ledger copy', stamped.stamped === true, (stamped.keys || []).join(','));
  const choice = selectTurnLanes({ botId: 'qs10', model: 'opencode/deepseek-v4.1-flash', fallback: 'opencode/deepseek-v4.1-flash' });
  check('stamping one bucket member depletes the sibling too',
    !choice.models.some((m) => String(m).includes('sb-a-free'))
    && !choice.models.some((m) => String(m).includes('sb-b-free')));
}

// ---------------------------------------------------------------- QS-4
const { resolvePackPath, packPathLine, PACK_SUMMARY_BYTES } = host;
const { buildPack } = await import(path.join(__dirname, 'lib', 'swap-pack.mjs'));
check('pack path helpers are exported', typeof resolvePackPath === 'function' && typeof packPathLine === 'function');
const smallPack = { ok: true, id: 'p1', root: '/tmp', files: [{ path: 'a.md', sha256: 'x', bytes: 100 }], totalBytes: 100 };
{
  const r = await resolvePackPath({ manifest: smallPack });
  check('a small pack ships from disk with no summary call',
    r.path === 'disk-pack' && packPathLine(r).includes('no summary call'), packPathLine(r));
}
const bigPack = { ok: true, id: 'p2', root: '/tmp', files: [{ path: 'big.md', sha256: 'y', bytes: PACK_SUMMARY_BYTES + 1 }], totalBytes: PACK_SUMMARY_BYTES + 1 };
{
  const seen = [];
  const r = await resolvePackPath({
    manifest: bigPack,
    failedLane: 'opencode/m-dead-free',
    lanesFn: async () => ['opencode/m-dead-free', 'opencode/m-good-free'],
    summarizeFn: async ({ model }) => { seen.push(model); return 'ten lines of summary'; },
  });
  check('a long pack earns a lane-written summary, never from the just-failed lane',
    r.path === 'lane-summary' && r.lane === 'opencode/m-good-free' && seen.join(',') === 'opencode/m-good-free'
    && packPathLine(r).includes('wrote the summary'));
}
{
  const r = await resolvePackPath({ manifest: bigPack, failedLane: 'x', lanesFn: async () => [], summarizeFn: async () => 's' });
  check('no other lane means summary skipped, disk pack still sent',
    r.path === 'summary-skipped' && /no other lane/.test(r.reason) && packPathLine(r).includes('disk pack sent'));
}
{
  const r = await resolvePackPath({ manifest: bigPack, lanesFn: async () => ['m'], summarizeFn: null });
  check('no summary writer means summary skipped, not a crash', r.path === 'summary-skipped');
}
{
  const r = await resolvePackPath({
    manifest: bigPack, lanesFn: async () => ['m-good'],
    summarizeFn: async () => { throw new Error('provider 500'); },
  });
  check('a failed summary writer falls back to disk pack, never hangs', r.path === 'summary-skipped' && /provider 500/.test(r.reason));
}
{
  const refused = buildPack('/nonexistent-dir-qs4');
  const r = await resolvePackPath({ manifest: refused });
  check('a refused build is reported, not shipped', r.path === 'summary-skipped' && packPathLine(r).includes('summary skipped'));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
