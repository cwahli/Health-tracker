#!/usr/bin/env node
/**
 * assert-dispatch-quiet.mjs — the sensor for "a test must not post to the
 * operator's chat".
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/utils/bugPackFixtures.test.ts` shells out to the REAL dispatcher,
 * `scripts/run-coding-dispatch.sh`, three times: once with a deliberately vague
 * `--task` to prove packCheck rejects it, twice with `--print-plan` to prove the
 * plan it builds. The dispatcher is a chat citizen — its refusals, its refusals-
 * to-refuse, its parallel-claim warnings and its typing pings all go out as
 * `[Orchestrator]` Telegram messages.
 *
 * So every run of that one test file put real messages in the operator's chat:
 *
 *   ❌ [Orchestrator] Dispatch rejected for `BUG-TEST`: payload failed packCheck
 *   🚫 [Orchestrator] Dispatch refused for `#19`: card is already done
 *
 * BUG-TEST is not a card and never was; it is the `--bug-id` that fixture passes.
 * The chat was reporting a test failure as an orchestrator incident, which is
 * worse than no message at all: it looks like the pipeline is broken.
 *
 * WHAT IS PINNED, AND HOW
 * -----------------------
 * Two halves, because either alone is weak:
 *
 *  1. **Behaviour, measured.** A stub `telegram-send.sh` stands in for the real
 *     one, the dispatcher is run twice against a payload it must refuse, and the
 *     number of messages that reached the stub is compared. Without `--no-notify`
 *     it speaks; with it, it is silent. The refusal itself still happens either
 *     way — exit code 1 — because a quiet dispatcher must not become a permissive
 *     one.
 *  2. **The callers.** Every `execFileSync('bash', [dispatchScript, …])` in the
 *     fixture test must pass `--no-notify`. This half is what stops the next
 *     person adding a fourth invocation without the flag, which the behavioural
 *     half would not notice until the next CI run reached the operator's chat.
 *
 * `TELEGRAM_SCRIPT_OVERRIDE` is the seam: the dispatcher already reads its sender
 * from one variable, so a sensor can point that at a stub without touching the
 * network or the operator's credentials.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DISPATCH = path.join(ROOT, 'scripts', 'run-coding-dispatch.sh');
const FIXTURE = path.join(ROOT, 'src', 'utils', 'bugPackFixtures.test.ts');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-quiet-'));
// The stub records what it was asked to send, one line per message. It never
// talks to Telegram — the point is to count, not to deliver.
const sender = path.join(tmp, 'telegram-send.sh');
const log = path.join(tmp, 'sent.log');
fs.writeFileSync(sender, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`, { mode: 0o755 });

function runDispatcher(args) {
  try {
    execFileSync('bash', [DISPATCH, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env, TELEGRAM_SCRIPT_OVERRIDE: sender, HOME: tmp },
    });
    return { code: 0 };
  } catch (e) {
    return { code: typeof e?.status === 'number' ? e.status : -1, stderr: String(e?.stderr || '') };
  }
}

function sentCount() {
  try {
    return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

console.log('assert-dispatch-quiet:');

// 1. The dispatcher still refuses the vague payload — with and without the flag.
//    Silence must not turn into permissiveness.
const loud = runDispatcher(['--task=Fix X', '--bug-id=BUG-TEST']);
check('a vague payload is still refused with exit 1 (notifying run)', loud.code === 1, `got ${loud.code}`);
check('the refusal names the cause', /failed packCheck/.test(loud.stderr || ''), (loud.stderr || '').slice(0, 120));
check('the notifying run really did post to the chat', sentCount() > 0, `${sentCount()} message(s)`);

fs.rmSync(log, { force: true });
const quiet = runDispatcher(['--task=Fix X', '--bug-id=BUG-TEST', '--no-notify']);
check('the same payload is still refused with exit 1 (quiet run)', quiet.code === 1, `got ${quiet.code}`);
check('--no-notify posts nothing to the chat', sentCount() === 0, `${sentCount()} message(s) reached the sender`);

// 2. The env seam is honoured too, so a caller that cannot pass a flag (a cron
//    wrapper, a batch replay) still has a way to be quiet.
fs.rmSync(log, { force: true });
const viaEnv = (() => {
  try {
    execFileSync('bash', [DISPATCH, '--task=Fix X', '--bug-id=BUG-TEST'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env, TELEGRAM_SCRIPT_OVERRIDE: sender, HOME: tmp, DISPATCH_NOTIFY: '0' },
    });
  } catch {
    /* refused, as it must be */
  }
  return sentCount();
})();
check('DISPATCH_NOTIFY=0 is honoured as well', viaEnv === 0, `${viaEnv} message(s)`);

// 3. Every telegram-send.sh call in the dispatcher passes the switch. One
//    unguarded call left behind reopens the hole on a path this sensor never
//    executes — and there are three legal shapes, not one:
//
//      a. inside tg_send()                     — the shared helper
//      b. `[ "${DISPATCH_NOTIFY:-1}" = "1" ] && bash "$TELEGRAM_SCRIPT" …`
//         — the two typing loops, which cannot use the helper because
//           scripts/assert-dispatch-lifecycle.sh extracts start_heartbeat by
//           name and sources it alone; a helper it does not extract is a
//           command it cannot find, and a typing loop that silently stops
//           typing is the exact leak that sensor exists to catch.
//
//    The `:?1` default is load-bearing too: the script runs `set -u`, so a bare
//    "$DISPATCH_NOTIFY" is an unbound-variable error wherever line 35 has not run.
const dispatchSrc = fs.readFileSync(DISPATCH, 'utf8');
const code = dispatchSrc.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
// Line-scoped, not file-scoped: a boolean `inHelper` over the whole file made
// EVERY call site exempt, so ungating a typing loop passed this sensor. The
// helper's own line range is computed and only those lines are exempt.
const allLines = code.split('\n');
const helperStart = allLines.findIndex((l) => /^tg_send\(\) \{/.test(l));
const helperEnd = helperStart === -1 ? -1 : (() => {
  for (let i = helperStart + 1; i < allLines.length; i += 1) if (/^\}/.test(allLines[i])) return i;
  return -1;
})();
const inHelperRange = (i) => helperStart !== -1 && i > helperStart && i < helperEnd;
check('tg_send is the shared, guarded helper', helperStart !== -1
  && /\[ "\$\{DISPATCH_NOTIFY:-1\}" = "1" \] \|\| return 0/.test(allLines[helperStart + 1] || '')
  && allLines.slice(helperStart, helperEnd).some((l) => l.includes('bash "$TELEGRAM_SCRIPT"')));
const guarded = (l) => /\[ "\$\{DISPATCH_NOTIFY:-1\}" = "1" \] &&/.test(l);
const unguarded = allLines
  .map((l, i) => ({ l, i }))
  .filter(({ l, i }) => l.includes('bash "$TELEGRAM_SCRIPT"') && !guarded(l) && !inHelperRange(i))
  .map(({ l }) => l.trim().slice(0, 70));
check('every telegram-send.sh call passes the switch', unguarded.length === 0, unguarded.join(' | '));
check('no bare $DISPATCH_NOTIFY anywhere (the script runs set -u)',
  !/[^:]"\$DISPATCH_NOTIFY"/.test(code), 'use ${DISPATCH_NOTIFY:-1}');
check('--no-notify is a real flag, not just an env var', /--no-notify\)\s+DISPATCH_NOTIFY=0/.test(code));

// 4. The callers. This is what catches the NEXT invocation added without the flag.
const fixture = fs.readFileSync(FIXTURE, 'utf8');
const invocations = [...fixture.matchAll(/dispatchScript,/g)].length;
check('the fixture test drives the dispatcher', invocations >= 3, `${invocations} invocation(s) found`);
// The whitespace matters: two of the three invocations put `dispatchScript,` on
// its own line, so a `[dispatchScript,` pattern silently matched only the
// inline one — the sensor reported three calls checked while checking one.
const argvBlocks = [...fixture.matchAll(/\[\s*dispatchScript,([\s\S]*?)\]/g)].map((m) => m[1]);
check('every fixture invocation is seen by this sensor', argvBlocks.length >= 3, `${argvBlocks.length} argv block(s) parsed of ${invocations} call(s)`);
check('every fixture invocation passes --no-notify',
  argvBlocks.length > 0 && argvBlocks.every((b) => b.includes('--no-notify')),
  `${argvBlocks.filter((b) => b.includes('--no-notify')).length}/${argvBlocks.length} carry the flag`);
check('the fixture explains why it is quiet', fixture.includes('--no-notify` on every invocation'));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
