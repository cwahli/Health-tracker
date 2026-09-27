// The recovery ledger: a lane switch must leave a trace.
// Run: node scripts/assert-recovery-ledger.test.mjs
//
// Before this sensor, the failover walk moved the turn but the error log only
// ever showed open→closed — a recovery nobody could audit. noteLaneSwitch
// parks the row in `recovering` naming the evaluated rule, and the next clean
// run closes it. Every case below runs against an isolated HOME so the real
// ledger is never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { noteLaneSwitch } from './bot-host.mjs';
import { getErrors, noteHealthy } from './lib/error-log.mjs';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

console.log('assert-recovery-ledger:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-ledger-'));
const oldHome = process.env.HOME;
process.env.HOME = home;

try {
  // 1. A quota-shaped switch parks the row in recovering with the rule named.
  const rec = noteLaneSwitch({
    from: 'cline:cline-free/muse-spark',
    to: 'opencode/space-bunny-free',
    reason: 'INFERENCE_CAP_ERROR 429 Try again in 22h 46m',
    botId: 'vm',
  });
  check('a switch returns the record', !!rec && !!rec.id);
  check('the row parks in recovering, not closed', rec?.status === 'recovering');
  check('the rule is the evaluated one for quota', rec?.recovery?.rule === 'failover-to-next-lane');
  check('the note names the next lane', String(rec?.recovery?.note || '').includes('opencode/space-bunny-free'));
  check('nothing claims it closed', rec?.closedBy === null || rec?.closedBy === undefined);

  const stored = getErrors()[rec.id];
  check('the row is really on disk', !!stored && stored.status === 'recovering');

  // 2. The next clean run closes it — the full open→recovering→closed lifecycle.
  const closed = noteHealthy({ lane: 'cline:cline-free/muse-spark', bot: 'vm' });
  check('a clean run closes the recovering row', closed.length === 1 && closed[0].status === 'closed');
  check('the closure names the clean run, not the switch', closed[0].closedBy === 'auto:clean-run');

  // 3. A repeat of the same signature reopens with history kept, still recovering.
  const again = noteLaneSwitch({
    from: 'cline:cline-free/muse-spark',
    to: 'opencode/space-bunny-free',
    reason: 'INFERENCE_CAP_ERROR 429 Try again in 22h 46m',
    botId: 'vm',
  });
  check('a repeat parks recovering again', again?.status === 'recovering');
  check('the repeat keeps its history', Number(again?.count) >= 2);

  // 4. The rule name follows the kind table, not a hardcoded string.
  const fivexx = noteLaneSwitch({
    from: 'opencode/nemotron',
    to: 'opencode/space-bunny-free',
    reason: 'provider 503 Service Unavailable',
    botId: 'vm',
  });
  check('a 5xx switch names failover-to-next-lane', fivexx?.recovery?.rule === 'failover-to-next-lane');
  const timeout = noteLaneSwitch({
    from: 'opencode/nemotron',
    to: 'opencode/space-bunny-free',
    reason: 'request timed out after 30000ms',
    botId: 'vm',
  });
  check('a timeout switch names the retry rule, not failover',
    timeout?.recovery?.rule === 'retry-with-smaller-ask');

  // 5. Bookkeeping can never break failover: logging off returns null, no throw.
  process.env.BOT_ERROR_LOG = '0';
  const off = noteLaneSwitch({ from: 'a', to: 'b', reason: '429', botId: 'vm' });
  check('BOT_ERROR_LOG=0 returns null instead of throwing', off === null);
  delete process.env.BOT_ERROR_LOG;
} finally {
  process.env.HOME = oldHome;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
