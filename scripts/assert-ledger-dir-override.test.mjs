// Card 6's live proof needs the bot to read a COPY of the ledger so the real one
// is untouched. FREE_LANES_DIR is that knob — and it must stay narrow: one
// directory for this process, never a shared default across bots, because cards
// 5 and 6 require one ledger per worker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBotLedgerDir, ensureBotLedger, stampDepleted, usableTurnLanes } from './lib/free-lanes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}

console.log('assert-ledger-dir-override:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-override-'));
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-copy-'));
const oldHome = process.env.HOME;
const oldOverride = process.env.FREE_LANES_DIR;
process.env.HOME = home;

try {
  delete process.env.FREE_LANES_DIR;

  // 1. Default behaviour is exactly as before: one directory per bot.
  const vmDir = resolveBotLedgerDir('vm');
  const vm2Dir = resolveBotLedgerDir('vm2');
  check('a bot gets its own directory', vmDir.endsWith(path.join('bot-host', 'vm', 'free-lanes')));
  check('two bots get two directories', vmDir !== vm2Dir);
  check('the directory is created on demand', fs.existsSync(vmDir));

  // 2. The override names one directory for this process.
  process.env.FREE_LANES_DIR = copy;
  check('the override wins', resolveBotLedgerDir('vm') === copy);
  check('and it is the same for every bot id in this process', resolveBotLedgerDir('vm2') === copy);
  check('the copy directory exists', fs.existsSync(copy));

  // 3. It is a copy: stamping through the override leaves the real ledger alone.
  const realTable = { lanes: [{ provider: 'opencode', model: 'zen/muse', pref: 1, status: 'available', tg: true, bucket: 'zen-free' }] };
  fs.writeFileSync(path.join(vmDir, 'free-lane-table.json'), JSON.stringify(realTable, null, 2));
  const before = fs.readFileSync(path.join(vmDir, 'free-lane-table.json'), 'utf8');
  const beforeMtime = fs.statSync(vmDir).mtimeMs;

  const { dir } = ensureBotLedger('vm');
  check('ensureBotLedger uses the override', dir === copy);
  fs.writeFileSync(path.join(copy, 'free-lane-table.json'), JSON.stringify(realTable, null, 2));
  const now = Date.now();
  stampDepleted({
    stateDir: copy,
    provider: 'opencode',
    model: 'zen/muse',
    errText: '429 Too Many Requests, retry in 6h',
    depletedUntil: now + 6 * 3600 * 1000,
  });
  const session = JSON.parse(fs.readFileSync(path.join(copy, 'session.json'), 'utf8'));
  check('the stamp landed in the copy', Boolean(session.quota?.['opencode/zen/muse'] || session.quota?.['bucket:zen-free']));

  const after = fs.readFileSync(path.join(vmDir, 'free-lane-table.json'), 'utf8');
  check('the real ledger table is byte-identical', after === before);
  check('the real ledger directory mtime is unchanged', fs.statSync(vmDir).mtimeMs === beforeMtime);
  check('no session.json was created in the real ledger', !fs.existsSync(path.join(vmDir, 'session.json')));

  // 4. The copy's own view reflects the stamp, which is what the proof reads.
  const copySession = JSON.parse(fs.readFileSync(path.join(copy, 'session.json'), 'utf8'));
  const view = usableTurnLanes(realTable, copySession, { now });
  check('the copy says the lane is depleted', !view.lanes.some((l) => l.model === 'zen/muse'));
  const realView = usableTurnLanes(realTable, {}, { now });
  check('the real ledger still says it is available', realView.lanes.some((l) => l.model === 'zen/muse'));

  // 5. The knob is narrow: no shared-default shape.
  const src = fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8');
  check('there is no shared-free-lanes default', !/shared-free-lanes/.test(src));
  check('the override is documented as a single directory', /names ONE directory for this process/.test(src));
  check('the bot ids still differ by default', /bot-host", String\(botId \|\| "default"\)/.test(src));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldOverride === undefined) delete process.env.FREE_LANES_DIR; else process.env.FREE_LANES_DIR = oldOverride;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(copy, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
