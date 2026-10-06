#!/usr/bin/env node
/**
 * assert-google-reroute.mjs — raw `google/` ids never reach the OpenCode CLI.
 *
 * The OpenCode `google/` provider is unwired on hosts without an OpenCode
 * google credential (live vm3: every `google/gemini-*` attempt ends
 * `Model unavailable`), while GEMINI_API_KEY answers directly (pinged PONG).
 * Execution refs rewrite `google/<id>` to the direct `gemini:` runner;
 * every other surface passes through untouched.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

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

console.log('assert-google-reroute (google/ never burns a turn)\n');

const host = await import(
  new URL(`file://${path.join(ROOT, 'scripts/bot-host.mjs').replace(/\\/g, '/')}`).href
);
check('bot-host exports execModelRef', typeof host.execModelRef === 'function');

check('google/ rewrites to the direct runner',
  host.execModelRef('google/gemini-3.5-flash-lite') === 'gemini:gemini/gemini-3.5-flash-lite');
check('bare gemini surface rewrites too',
  host.execModelRef('gemini/gemini-3.5-flash-lite') === 'gemini:gemini/gemini-3.5-flash-lite');
check('already-direct refs are idempotent',
  host.execModelRef('gemini:gemini/gemini-3.5-flash-lite') === 'gemini:gemini/gemini-3.5-flash-lite');
check('opencode refs untouched',
  host.execModelRef('opencode-go/longcat-2.5-preview-free') === 'opencode-go/longcat-2.5-preview-free');
check('cloudflare refs untouched (vendor-side, separate decision)',
  host.execModelRef('cloudflare/@cf/qwen/qwen3.8-27b') === 'cloudflare/@cf/qwen/qwen3.8-27b');
check('empty stays empty', host.execModelRef('') === '');

const src = fs.readFileSync(path.join(ROOT, 'scripts/bot-host.mjs'), 'utf8');
check('ledger first entry executes via execModelRef',
  src.includes('models.push(execModelRef(model))'));
check('ping pair executes via execModelRef',
  src.includes('pingOnlyModels({ isPingTurn, model: execModelRef(eff.model), fallback: execModelRef(config.agent.model) })'));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
