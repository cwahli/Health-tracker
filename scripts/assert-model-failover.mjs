#!/usr/bin/env node
/**
 * assert-model-failover.mjs — BOT-9 live failover wiring gate.
 *
 * Proves the lane switch happens in code on the live bot path:
 *  1. agent-opencode.mjs exports failoverModels + runWithModelFailover.
 *  2. bot-host.mjs routes its main message-path OpenCode call through
 *     runOpencodeWithFailover (not a bare runOpencode).
 *  3. The switch posts a user-visible line naming from → to.
 *  4. Fallback models come from registry/prefs (no invented models).
 *  5. A fail-then-succeed run switches lanes; a single-model run behaves
 *     like a direct call with no switch line (stubbed CLI, no network).
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

console.log('assert-model-failover (BOT-9)\n');

const agentSrc = read('scripts/lib/agent-opencode.mjs');
check('agent-opencode exports failoverModels', agentSrc.includes('export function failoverModels'));
check('agent-opencode exports runWithModelFailover', agentSrc.includes('export async function runWithModelFailover'));

const hostSrc = read('scripts/bot-host.mjs');
check('bot-host imports runWithModelFailover', hostSrc.includes('runWithModelFailover,'));
check('bot-host defines runOpencodeWithFailover', hostSrc.includes('export async function runOpencodeWithFailover'));
check('message path uses the failover wrapper', hostSrc.includes('await runOpencodeWithFailover({'));
check('fallback is registry/prefs-derived, not invented',
  hostSrc.includes('failoverModels(eff.model, config.agent.model)'));
check('switch posts a user-visible from → to line', hostSrc.includes('switching to'));

const oldLog = process.env.BOT_FAILURE_LOG;
process.env.BOT_FAILURE_LOG = `${os.tmpdir()}/failover_gate_${Date.now()}.jsonl`;
try {
  const { failoverModels } = await import(
    new URL(`file://${path.join(ROOT, 'scripts/lib/agent-opencode.mjs').replace(/\\/g, '/')}`).href
  );
  check('single model collapses to one candidate',
    JSON.stringify(failoverModels('m', 'm')) === JSON.stringify(['m']));

  const { runOpencodeWithFailover } = await import(
    new URL(`file://${path.join(ROOT, 'scripts/bot-host.mjs').replace(/\\/g, '/')}`).href
  );
  const stubSpawn = (bin, args) => {
    const model = String(args[args.indexOf('-m') + 1]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.emit('close', 1); };
    queueMicrotask(() => {
      if (model === 'm1') {
        child.stderr.emit('data', Buffer.from('level=ERROR msg="x" error.error="rate limit exceeded"\n'));
      } else {
        child.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"ok"}}\n'));
      }
      child.emit('close', model === 'm1' ? 1 : 0);
    });
    return child;
  };
  const sent = [];
  const api = { sendMessage: async (chatId, text) => { sent.push(text); return {}; } };
  const res = await runOpencodeWithFailover({
    api, chatId: 1, prompt: 'x', models: ['m1', 'm2'],
    workspace: '/tmp', timeoutMs: 5000, spawnImpl: stubSpawn,
  });
  check('fail-then-succeed delivers the second result', res.finalText === 'ok');
  check('switch line names from → to', sent.length === 1 && /m1.*switching to.*m2/.test(sent[0]));

  // 5b. A timeout on the first candidate must still advance the chain.
  // This drives the real timeout timer (m1 emits nothing and never closes on
  // its own) rather than string-matching a timeout error, so it reproduces the
  // exact production failure of 2026-10-05: `defaultIsRetryable` used to treat
  // `timed out after Nms` as terminal, so a dead primary lane held the turn for
  // the whole budget and returned empty while the healthy fallback sat unused.
  const stubSpawnTimeout = (bin, args) => {
    const model = String(args[args.indexOf('-m') + 1]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.emit('close', 1); };
    if (model !== 'm1') {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"ok"}}\n'));
        child.emit('close', 0);
      });
    }
    return child;
  };
  const sent2 = [];
  const api2 = { sendMessage: async (chatId, text) => { sent2.push(text); return {}; } };
  const seen2 = [];
  const res2 = await runOpencodeWithFailover({
    api: api2, chatId: 1, prompt: 'x', models: ['m1', 'm2'],
    workspace: '/tmp', timeoutMs: 120, spawnImpl: stubSpawnTimeout,
    onAttemptStart: ({ model }) => { seen2.push(model); },
  });
  check('a timed-out candidate still fails over to the next one', res2.finalText === 'ok');
  check('the timeout switch line names from → to',
    sent2.length === 1 && /m1.*switching to.*m2/.test(sent2[0]));
  check('the chain stopped after the healthy candidate (no third attempt)',
    seen2.length === 2 && seen2[0] === 'm1' && seen2[1] === 'm2');

  // A deliberate cancel must NOT burn the rest of the chain.
  const stubSpawnAbort = (bin, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.emit('close', 1); };
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from('level=ERROR msg="x" error.error="aborted"\n'));
      child.emit('close', 1);
    });
    return child;
  };
  const seen3 = [];
  const res3 = await runOpencodeWithFailover({
    api, chatId: 1, prompt: 'x', models: ['m1', 'm2'],
    workspace: '/tmp', timeoutMs: 5000, spawnImpl: stubSpawnAbort,
    onAttemptStart: ({ model }) => { seen3.push(model); },
  });
  check('a user cancel is not retried on another model',
    seen3.length === 1 && seen3[0] === 'm1');

  // 6. The run's argv must only contain flags the installed opencode CLI
  //    accepts. CLI 2.0.18 answers an unknown flag or a bad enum value by
  //    printing help and exiting 1 with NO stdout, so the bot can only report
  //    "Done (exit 1), but the model returned no text output" — which is what
  //    every turn did on 2026-09-28 (`--variant` is gone; the variant belongs
  //    in the model string, and --log-level is lowercase). Asserted here as
  //    well as in the vitest file so the guard runs in a worktree with no
  //    node_modules, which is where it was originally missed.
  const { buildOpencodeArgs } = await import('./lib/agent-opencode.mjs');
  const args = buildOpencodeArgs({
    prompt: 'hi',
    model: 'opencode/space-bunny-free',
    variant: 'xhigh',
    thinking: true,
    sessionId: 'ses_1',
    extraArgs: ['--agent', 'build'],
  });
  check('the run never passes a bare --variant flag', !args.includes('--variant'));
  check('the variant rides in the model string',
    args[args.indexOf('-m') + 1] === 'opencode/space-bunny-free#xhigh');
  check('--log-level is lowercase (the CLI enum is)',
    args[args.indexOf('--log-level') + 1] === 'error');
  check('the prompt is still the last argument', args[args.length - 1] === 'hi');
  const noVariant = buildOpencodeArgs({ prompt: 'hi', model: 'opencode/mimo', thinking: false });
  check('a run without a variant is left alone',
    noVariant[noVariant.indexOf('-m') + 1] === 'opencode/mimo');
} finally {
  if (oldLog === undefined) delete process.env.BOT_FAILURE_LOG;
  else process.env.BOT_FAILURE_LOG = oldLog;
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
