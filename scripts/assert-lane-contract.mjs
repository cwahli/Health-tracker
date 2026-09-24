#!/usr/bin/env node
/**
 * assert-lane-contract.mjs — BOT-17 named gate.
 *
 * Proves the agnostic lane contract in code, not prose:
 *  1. scripts/lib/lane-contract.mjs declares every dispatch backend
 *     (opencode/cline/grok/agy/gemini/human) with tools/session/degraded.
 *  2. Cline is marked degraded for resume; Gemini is API-only with no
 *     tools and no session.
 *  3. Every backend may fill specify/implement/verify.
 *  4. The real bots/registry.json has no agent/model/process id and no
 *     non-surface runtime — the dev process is never a registry row.
 *  5. CLI check-registry passes on the real registry.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

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

console.log('assert-lane-contract (BOT-17)\n');

const {
  LANES,
  laneFor,
  isDegraded,
  canFill,
  checkBotRow,
  checkRegistry,
  GRANDFATHERED_IDS,
} = await import(new URL(`file://${path.join(ROOT, 'scripts/lib/lane-contract.mjs').replace(/\\/g, '/')}`).href);

// 1. Every dispatch backend declared.
for (const backend of ['opencode', 'cline', 'grok', 'agy', 'gemini', 'freebuff', 'human']) {
  let lane = null;
  try {
    lane = laneFor(backend);
  } catch {}
  check(`lane declared: ${backend}`, Boolean(lane));
}

// 2. Degraded markings.
check('cline degraded for resume', isDegraded('cline', 'resume'));
check('cline still has tools', laneFor('cline').tools === true);
check('gemini is API-only', laneFor('gemini').apiOnly === true);
check('gemini declares no tools', laneFor('gemini').tools === false);
check('gemini declares no session', laneFor('gemini').session === false);
check('gemini degraded for resume/tools/plan',
  isDegraded('gemini', 'resume') && isDegraded('gemini', 'tools') && isDegraded('gemini', 'plan'));
check('freebuff is API-only', laneFor('freebuff').apiOnly === true);
check('freebuff declares no tools', laneFor('freebuff').tools === false);
check('freebuff declares no session', laneFor('freebuff').session === false);
check('freebuff degraded for resume/tools/plan',
  isDegraded('freebuff', 'resume') && isDegraded('freebuff', 'tools') && isDegraded('freebuff', 'plan'));
check('opencode not degraded', laneFor('opencode').degraded.length === 0);

// 3. Any backend may fill any role.
for (const backend of ['opencode', 'cline', 'grok', 'agy', 'gemini', 'freebuff', 'human']) {
  check(`${backend} may specify/implement/verify`,
    canFill(backend, 'specify') && canFill(backend, 'implement') && canFill(backend, 'verify'));
}

// 4. Real registry honors the contract.
const { loadRegistry, resolveRegistryPath } = await import(
  new URL(`file://${path.join(ROOT, 'scripts/lib/registry.mjs').replace(/\\/g, '/')}`).href
);
const registry = loadRegistry(resolveRegistryPath(null, ROOT));
const violations = checkRegistry(registry);
check('registry has no agent/model/process id or non-surface runtime',
  violations.length === 0, violations.join('; '));
check('registry bot "opencode" is a place row, not a backend claim',
  checkBotRow({ id: 'opencode', runtime: 'bot-host' }).length === 0);
check('grandfather list never grows past the VPS door',
  JSON.stringify(GRANDFATHERED_IDS) === JSON.stringify(['opencode']));
check('a "dev" row would be rejected',
  checkBotRow({ id: 'dev', runtime: 'bot-host' }).length > 0);
check('a "cline" row would be rejected',
  checkBotRow({ id: 'cline', runtime: 'bot-host' }).length > 0);
check('a "freebuff" row would be rejected',
  checkBotRow({ id: 'freebuff', runtime: 'bot-host' }).length > 0);

// 5. CLI passes on the real registry.
try {
  const out = execFileSync(process.execPath,
    [path.join(ROOT, 'scripts/lib/lane-contract.mjs'), 'check-registry'],
    { encoding: 'utf8' });
  check('CLI check-registry exits 0', JSON.parse(out).ok === true);
} catch (err) {
  check('CLI check-registry exits 0', false, err.message);
}

// 6. bot-host enforces the contract at startup (fail loud, never boot bad).
{
  const hostSrc = read('scripts/bot-host.mjs');
  check('bot-host imports checkRegistry', hostSrc.includes('checkRegistry'));
  check('bot-host refuses to start on violations', hostSrc.includes('Refusing to start.'));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
