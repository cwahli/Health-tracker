#!/usr/bin/env node
/**
 * assert-error-log.mjs — BOT-25 bot error log gate.
 *
 * Proves the lifecycle in code (no Telegram, no network):
 *  1. error-log.mjs exports the record/recover/close/healthy surface.
 *  2. A quota failure opens a record; a repeat bumps count (stable id).
 *  3. A failed recovery parks in recovering; ok closes with auto:<rule>.
 *  4. A clean run auto-closes the lane (auto:clean-run).
 *  5. The CLI lists, checks (exit 1 while open), closes, and reports.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import { execFileSync } from 'node:child_process';
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

console.log('assert-error-log (BOT-25)\n');

const libSrc = fs.readFileSync(path.join(ROOT, 'scripts/lib/error-log.mjs'), 'utf8');
for (const fn of ['errorId', 'classifyErrorKind', 'evaluateRecovery', 'recordError', 'recordRecoveryAttempt', 'closeError', 'noteHealthy', 'listErrors']) {
  check(`error-log exports ${fn}`, libSrc.includes(`export function ${fn}`));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assert_errorlog_'));
const logPath = path.join(tmp, 'bot-error-log.json');
const lib = await import(new URL(`file://${path.join(ROOT, 'scripts/lib/error-log.mjs').replace(/\\/g, '/')}`).href);

const opened = lib.recordError({ lane: 'cline', bot: 'vm', raw: 'Error 429: Daily free limit reached' }, logPath);
check('quota failure opens a record', opened?.status === 'open' && opened?.kind === 'quota');
const bumped = lib.recordError({ lane: 'cline', bot: 'vm', raw: 'Error 429 again' }, logPath);
check('repeat bumps the same id', bumped?.id === opened?.id && bumped?.count === 2 && bumped?.status === 'open');
const recovering = lib.recordRecoveryAttempt(opened.id, { rule: 'failover-to-next-lane', ok: false }, logPath);
check('failed recovery parks in recovering', recovering?.status === 'recovering');
const closed = lib.recordRecoveryAttempt(opened.id, { rule: 'failover-to-next-lane', ok: true }, logPath);
check('ok recovery closes with auto rule', closed?.status === 'closed' && closed?.closedBy === 'auto:failover-to-next-lane');

const reopened = lib.recordError({ lane: 'opencode', bot: 'vm', raw: 'timed out after 9ms' }, logPath);
const healed = lib.noteHealthy({ lane: 'opencode', bot: 'vm' }, logPath);
check('clean run auto-closes the lane',
  healed.length === 1 && healed[0].id === reopened.id && healed[0].closedBy === 'auto:clean-run');
check('nothing left open', lib.listErrors({ status: 'open' }, logPath).length === 0);

const cliEnv = { ...process.env, BOT_ERROR_LOG: logPath };
const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/errorlog.mjs'), ...args], { encoding: 'utf8', env: cliEnv });
    return { status: 0, out: String(out) };
  } catch (e) {
    return { status: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
};

lib.recordError({ lane: 'cline', bot: 'vm', raw: 'spawn nothing ENOENT' }, logPath);
const listed = run(['list']);
check('CLI lists the open record', listed.status === 0 && listed.out.includes('OPEN'));
const checking = run(['check']);
check('CLI check exits 1 while open', checking.status === 1 && checking.out.includes('unresolved'));
const id = lib.listErrors({ status: 'open' }, logPath)[0]?.id;
const closedCli = run(['close', `--id=${id}`]);
check('CLI closes by id', closedCli.status === 0 && closedCli.out.includes('closed'));
check('CLI check exits 0 when clean', run(['check']).status === 0);
const report = run(['report']);
check('CLI report renders the markdown table',
  report.status === 0 && report.out.includes('# Bot error log') && report.out.includes(id));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
