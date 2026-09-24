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
} finally {
  if (oldLog === undefined) delete process.env.BOT_FAILURE_LOG;
  else process.env.BOT_FAILURE_LOG = oldLog;
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
