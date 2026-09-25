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

  // 4b. The lane CATALOGUE is the HOST's; only the quota session is a worker's.
  // Each bot used to read its own private copy of free-lane-table.json, and those
  // copies drift: live on 2026-09-25 vm's had decayed to a 7-lane stub with no
  // updatedAt while vm2's still had 17, so one command answered 43 rows on one bot
  // and 50 on the other. The table now comes from the router's state, the session
  // from the directory the caller named.
  const { loadFreeLaneLedger: loadLedger, candidateRouterStateDirs } = await import('./lib/free-lanes.mjs');
  const hostDir = candidateRouterStateDirs(dir).find((d) => d !== dir);
  const loaded = loadLedger({ stateDir: dir });
  if (hostDir && fs.existsSync(path.join(hostDir, 'free-lane-table.json'))) {
    check('the lane table comes from the host, not a private copy', loaded.tablePath === path.join(hostDir, 'free-lane-table.json'), loaded.tablePath);
  } else {
    check('no host table on this host, so a private copy is the only table (a proof host)', true);
  }
  check('the quota session is still the caller\'s own directory', loaded.sessionPath === path.join(dir, 'session.json'), loaded.sessionPath);

  // 5. The knob is narrow: no shared-default shape.
  //
  // Changed 2026-09-25, deliberately. This used to assert that the string
  // "shared-free-lanes" appeared nowhere in the file, which was a proxy for "no
  // shared default ledger" — the rule from the pre-card1 work that was never
  // landed. A host-account quota store was added since: Cline, Gemini, Token
  // Harbor and Cloudflare are reached with ONE key for this host, so their daily
  // caps are the same for vm and vm2, and vm was showing a lane as spent while vm2
  // offered it. The store holds host-account routes only.
  //
  // So the invariant is now stated directly instead of by substring: the per-bot
  // ledger is still the default and still per-bot, and the shared store cannot
  // carry an opencode lane — that is what would turn it into a shared ledger.
  const src = fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8');
  check('the per-bot ledger is still the default, one dir per bot id', /bot-host", String\(botId \|\| "default"\)/.test(src));
  check('the override is documented as a single directory', /names ONE directory for this process/.test(src));
  const shared = (src.match(/HOST_ACCOUNT_PROVIDERS = new Set\(\[([^\]]*)\]\)/) || [])[1] || '';
  check('the host-account set is cline, gemini, tokenharbor and cloudflare',
    /cline/.test(shared) && /gemini/.test(shared) && /tokenharbor/.test(shared) && /cloudflare/.test(shared) && !/opencode/.test(shared), shared);
  check('opencode is excluded from the shared store by an explicit test', /HOST_ACCOUNT_PROVIDERS\.has\(p\)/.test(src) && /return false;/.test(src));
  check('a shared stamp is only written for a host-account route', /if \(isHostAccountRoute\(provider, model\)\)/.test(src));
  check('the shared dir is overridable so a proof cannot touch real state', /FREE_LANES_SHARED_DIR/.test(src));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldOverride === undefined) delete process.env.FREE_LANES_DIR; else process.env.FREE_LANES_DIR = oldOverride;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(copy, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
