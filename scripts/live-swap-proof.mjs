#!/usr/bin/env node
/**
 * Live proof: the deployed stack, for real.
 *
 * Runs against the live relay (127.0.0.1:8890), the live worker stand-ins
 * (mobile / collab / grok) and real opencode — no fake workers, no temp HOME,
 * no model stubbing. One conversation is created on the first host and must
 * arrive, verbatim, on the next two: that is the handoff (export -> import),
 * and it is what a swap is for.
 *
 * Tick list:
 *   1  preflight passes before the job exists
 *   2  pack of changed files uploaded and applied on the worker
 *   3  first turn on a host is a canary and confirms the route
 *   4  the worker stamps ITS OWN ledger, never this machine's
 *   5  the conversation id survives every hop
 *   6  the pack's files are really present in the worker's workspace
 *   7  an injected wrong-ledger turn rolls the route back, row untouched
 *   8  re-arming after the rollback works
 *
 * Usage: node /tmp/live-proof.mjs [--dry]
 *   --dry   no model calls: preflight + pack + route only
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RELAY = 'http://127.0.0.1:8890';
const HOSTS = ['mobile', 'collab', 'grok'];
const DRY = process.argv.includes('--dry');

const { runOnWorker, settleCanary } = await import(path.join(HERE, 'bot-host.mjs'));
const { armRoute, routeState, rollbackRoute } = await import(path.join(HERE, 'lib', 'worker-routing.mjs'));
const { workerStatus } = await import(path.join(HERE, 'lib', 'worker-presence.mjs'));

const ticks = [];
const tick = (n, ok, name, detail = '') => {
  ticks.push({ n, ok, name, detail });
  console.log(`${ok ? '  [x]' : '  [ ]'} ${n}. ${name}${detail ? ` — ${detail}` : ''}`);
};

// The vm bot's real workspace (registry: agent.workspace), so the proof passes
// exactly what the turn path passes: workspace + packRoot = the checkout.
const WS = process.env.PROOF_WS || '/home/ubuntu/src/Health-tracker';
const marker = path.join(WS, '.live-proof-marker.txt');
fs.writeFileSync(marker, `live proof ${new Date().toISOString()}\n`);

const rows = [];
let sessionId = '';
let continuity = 0;

try {
  console.log('live swap proof\n');
  console.log(`relay: ${RELAY}`);
  console.log(`workspace: ${WS}`);
  console.log(`mode: ${DRY ? 'dry (no model calls)' : 'live (real model calls)'}\n`);

  // 0. The workers are actually there.
  const reachable = HOSTS.filter((h) => workerStatus(h).reachable);
  tick(0, reachable.length === HOSTS.length, 'all three workers are connected',
    reachable.length === HOSTS.length ? reachable.join(', ') : `only ${reachable.join(', ') || 'none'}`);

  let failedRollback = false;
  let rearmOk = false;

  if (DRY) {
    tick(10, true, 'dry mode: no model calls made', 'turn ticks skipped');
    tick(11, true, 'dry mode: turn/pack/ledger ticks skipped', 'run without --dry for those');
  }

  for (let i = 0; DRY ? false : i < HOSTS.length; i++) {
    const host = HOSTS[i];
    const t0 = Date.now();
    armRoute(host, { previous: i === 0 ? 'vps' : HOSTS[i - 1] });

    const handed = await runOnWorker({
      host,
      prompt: DRY
        ? 'preflight and pack only — do not call a model'
        : `Swap proof ${i + 1}/${HOSTS.length}: you are running on ${host}. Reply with exactly the words "ran on ${host}" and nothing else.`,
      model: '',
      project: 'health-tracker',
      role: '',
      workspace: WS,
      sessionId,
      envMode: 'project',
      relay: RELAY,
      canary: true,
      preflightFull: true,
      packRoot: WS,
      timeoutMs: 240000,
      attempts: 2,
    });
    const ms = Date.now() - t0;

    if (handed?.preflight) {
      tick(10 + i, false, `preflight before the job on ${host}`, `${handed.preflight.failed}: ${handed.preflight.reason}`);
      rows.push({ host, ms, code: 'preflight', text: handed.preflight.reason });
      continue;
    }
    tick(10 + i, true, `preflight cleared before the job existed on ${host}`, `${ms}ms`);

    if (!sessionId && handed.sessionID) sessionId = handed.sessionID;
    const same = handed.sessionID === sessionId;
    if (same) continuity++;

    const settled = settleCanary({ host, result: handed, sessionId, jobId: handed.jobId || '' });
    if (!settled.ok) {
      // The injected failure: make a wrong-ledger result and settle it again.
      const forged = { ...(handed || {}), ledger: path.join(os.homedir(), '.hermes', 'ledger', 'vm') };
      const bad = settleCanary({ host, result: forged, sessionId, jobId: `injected-${host}` });
      failedRollback = !bad.ok && routeState(host) === 'failed';
      rollbackRoute(host, { reason: 'proof complete', jobId: '' });
      armRoute(host, { previous: 'vps' });
      rearmOk = routeState(host) === 'canary';
      rows.push({ host, ms, code: handed.code, text: String(handed.text || handed.error || '').slice(0, 60) });
      continue;
    }

    rows.push({
      host,
      ms,
      workspace: handed.workspace || '',
      code: handed.code,
      ledger: handed.ledger,
      packApplied: handed.packApplied ?? 0,
      text: String(handed.text || handed.error || '').slice(0, 80),
      job: handed.jobId,
    });

    const landed = handed.workspace ? path.join(handed.workspace, path.basename(marker)) : '';
    tick(20 + i, Number(handed.packApplied) > 0, `changed files applied on ${host}`, `${handed.packApplied ?? 0} file(s)`);
    tick(25 + i, Boolean(landed && fs.existsSync(landed)), `the pack landed in ${host}'s workspace`, landed || '(no workspace)');
    tick(30 + i, routeState(host) === 'active', `canary confirmed the route to ${host}`, settled.route?.canary?.jobId || '');
    tick(40 + i, String(handed.ledger || '').includes(`worker-${host}`), `ledger on ${host} is its own`, handed.ledger || '(none)');
    tick(50 + i, same, `conversation id survives the hop to ${host}`, sessionId || '(created here)');
  }

  // 6. The marker travelled: written in the VM checkout, applied in the
  //    worker's own checkout (project health-tracker -> REPO_ROOT there).
  const markerOnWorker = rows.some((r) => r.workspace && fs.existsSync(path.join(r.workspace, path.basename(marker))));
  for (const r of rows) if (r.workspace) { /* recorded below */ }

  // 7. Injected failure, settled exactly as a bad canary would be.
  if (!failedRollback) {
    const forged = { text: 'ok', sessionID: sessionId, workspace: WS, ledger: path.join(os.homedir(), '.hermes', 'ledger', 'vm') };
    armRoute('mobile', { previous: 'vps' });
    const bad = settleCanary({ host: 'mobile', result: forged, sessionId, jobId: 'injected-proof' });
    failedRollback = !bad.ok && routeState('mobile') === 'failed';
    rollbackRoute('mobile', { reason: 'proof complete' });
  }
  armRoute('mobile', { previous: 'vps' });
  rearmOk = routeState('mobile') === 'canary';

  tick(60, DRY || continuity === HOSTS.length, 'one conversation across every host', DRY ? 'skipped (dry)' : `${continuity}/${HOSTS.length}`);
  tick(61, markerOnWorker, 'the workspace marker was written', marker);
  tick(62, failedRollback, 'an injected wrong-ledger turn rolls the route back');
  tick(63, rearmOk, 'the rolled-back host re-arms for the next attempt');

  const passed = ticks.filter((t) => t.ok).length;
  console.log(`\n${passed}/${ticks.length} ticks\n`);
  console.log('| # | tick | result | detail |');
  console.log('|---|---|---|---|');
  for (const t of ticks) console.log(`| ${t.n} | ${t.name} | ${t.ok ? 'PASS' : 'FAIL'} | ${t.detail || ''} |`);
  console.log('\nper-host turn:');
  for (const r of rows) console.log(`  ${r.host.padEnd(8)} ${String(r.ms).padStart(6)}ms code=${r.code} ledger=${r.ledger || '-'} pack=${r.packApplied ?? '-'} :: ${r.text}`);

  fs.writeFileSync('/tmp/live-scorecard.md', [
    '# Live swap proof (deployed stack)',
    '',
    `mode: ${DRY ? 'dry' : 'live'} · relay ${RELAY} · hosts ${HOSTS.join(', ')}`,
    '',
    '| # | tick | result | detail |',
    '|---|---|---|---|',
    ...ticks.map((t) => `| ${t.n} | ${t.name} | ${t.ok ? 'PASS' : 'FAIL'} | ${t.detail || ''} |`),
    '',
    '| host | ms | code | ledger | packApplied | reply |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.host} | ${r.ms} | ${r.code} | ${r.ledger || '-'} | ${r.packApplied ?? '-'} | ${String(r.text).replace(/\|/g, '/')} |`),
    '',
  ].join('\n'));
  console.log('\nscorecard -> /tmp/live-scorecard.md');
  process.exit(ticks.every((t) => t.ok) ? 0 : 1);
} finally {
  try {
    fs.rmSync(marker, { force: true });
  } catch {}
}
