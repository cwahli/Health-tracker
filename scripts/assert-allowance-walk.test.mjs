// R-14.1 cards 6 and 6b sensor: the turn walk comes from the ledger.
//
// On 2026-09-25 12:29Z the VM bot was on cline-free/muse-spark-1.3-contributor,
// the provider returned 429 "try again in 22h 46m", and the chat received the
// raw INFERENCE_CAP_ERROR JSON. No stamp, no next lane. The selection list was
// [chat model, bot default] — two fixed entries that never asked the ledger.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usableTurnLanes, stampDepleted, ensureBotLedger } from './lib/free-lanes.mjs';
import { selectTurnLanes } from './bot-host.mjs';
import { tierForModel, catalogRank } from './lib/free-catalogs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const botWalkSrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
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

console.log('assert-allowance-walk:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
const oldHome = process.env.HOME;
process.env.HOME = home;

try {
  const now = Date.now();
  const table = {
    lanes: [
      { provider: 'opencode', model: 'zen/nemotron', pref: 1, status: 'available', tg: true, bucket: 'opencode-zen' },
      { provider: 'opencode', model: 'zen/muse', pref: 2, status: 'available', tg: true, bucket: 'opencode-zen' },
      { provider: 'cline', model: 'cline-free/muse-spark', pref: 3, status: 'available', tg: true },
      { provider: 'tokenharbor', model: 'th/cheap', pref: 4, status: 'available', tg: true },
      { provider: 'freebuff', model: 'freebuff/terminal', pref: 5, status: 'available', tg: false },
      { provider: 'opencode', model: 'zen/old-promo', pref: 6, status: 'ended', tg: true },
    ],
  };

  // 1. With an empty session every TG lane is usable and Freebuff is not one.
  const fresh = usableTurnLanes(table, {}, { now });
  check('all four selectable lanes are usable', fresh.lanes.length === 4);
  check('Freebuff is never selectable', !fresh.lanes.some((l) => l.provider === 'freebuff'));
  check('an ended lane is never offered', !fresh.lanes.some((l) => l.model === 'zen/old-promo'));
  check('the ended lane is reported as skipped', fresh.skipped.some((s) => /never offered again/.test(s.why)));
  check('Freebuff is reported as terminal-only', fresh.skipped.some((s) => /terminal-only/.test(s.why)));

  // 2. A shared bucket: one stamp takes the siblings with it. The stamp works
  // on the host ledger, so the test table is what that ledger holds.
  const { dir } = ensureBotLedger('vm');
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));
  stampDepleted({
    stateDir: dir,
    provider: 'opencode',
    model: 'zen/nemotron',
    errText: '429 Too Many Requests, try again in 22h',
    depletedUntil: now + 22 * 3600 * 1000,
    countdownHint: '22h',
  });
  const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  check('the stamp wrote the route key', Boolean(session.quota?.['opencode/zen/nemotron']));
  check('the stamp wrote the shared bucket key', Boolean(session.quota?.['bucket:opencode-zen']));
  const afterStamp = usableTurnLanes(table, session, { now });
  check('the stamped lane is out', !afterStamp.lanes.some((l) => l.model === 'zen/nemotron'));
  check('its bucket sibling is out too', !afterStamp.lanes.some((l) => l.model === 'zen/muse'));
  check('an unrelated lane is still in', afterStamp.lanes.some((l) => l.model === 'cline-free/muse-spark'));
  const skippedNemotron = afterStamp.skipped.find((s) => s.model === 'zen/nemotron');
  check('the skip carries the vendor reset, not the 6h default', /22h/.test(String(skippedNemotron?.resetLabel || skippedNemotron?.until || '')));

  // 3. The turn selection uses the ledger, not the two fixed entries.
  const choice = selectTurnLanes({ botId: 'vm', model: 'opencode:zen/nemotron', fallback: 'zen/muse' });
  check('the selection came from the ledger', choice.fromLedger === true);
  check('a stamped lane is not selected', !choice.models.includes('opencode/zen/nemotron'));
  check('the chain moved past it', choice.models[0] !== 'opencode/zen/nemotron');
  check('the displaced lane is reported with a reason', Boolean(choice.displaced?.why));
  check('Freebuff is not in the chain', !choice.models.some((m) => /freebuff/.test(m)));
  check('an ended lane is not in the chain', !choice.models.some((m) => /old-promo/.test(m)));

  // 4. A usable current model still goes first.
  const keep = selectTurnLanes({ botId: 'vm', model: 'cline:cline-free/muse-spark', fallback: 'zen/muse' });
  check('a usable chat model stays first', keep.models[0] === 'cline:cline-free/muse-spark');
  check('nothing is displaced when the chat model is fine', keep.displaced === null);

  // 5. Everything stamped means the turn does not run at all.
  const table2 = JSON.parse(JSON.stringify(table));
  for (const lane of table2.lanes) if (lane.tg !== false && lane.status !== 'ended') lane.status = 'depleted';
  const { dir: dir2 } = ensureBotLedger('vm2');
  fs.writeFileSync(path.join(dir2, 'free-lane-table.json'), JSON.stringify(table2, null, 2));
  const empty = selectTurnLanes({ botId: 'vm2', model: 'cline:cline-free/muse-spark', fallback: 'zen/muse' });
  check('an exhausted host selects nothing', empty.models.length === 0);
  check('an exhausted host is reported as exhausted', empty.exhausted === true);

  // 5b. The configured model the ledger has never heard of is still run first.
  // Regression: the first version of this dropped it and ran the ledger's top
  // lane, which broke a live turn on the VM at 18:31Z.
  const unlisted = selectTurnLanes({ botId: 'vm', model: 'opencode/nemotron-3.5-lightning-free', fallback: 'zen/muse' });
  check('an unlisted configured model still runs first', unlisted.models[0] === 'opencode/nemotron-3.5-lightning-free');
  check('it is not displaced', unlisted.displaced === null);
  check('the ledger lanes follow it as fallbacks', unlisted.models.length > 1);
  check('the first fallback is the ledger preference order', !unlisted.models.slice(1).includes('opencode/nemotron-3.5-lightning-free'));

  // 5c. A configured model the ledger says is depleted is dropped, with a reason.
  const depletedChoice = selectTurnLanes({ botId: 'vm', model: 'opencode:zen/nemotron', fallback: 'zen/muse' });
  check('a stamped configured model is dropped', !depletedChoice.models.includes('opencode:zen/nemotron'));
  check('and the chat is told why', /depleted/.test(String(depletedChoice.displaced?.why)));
  check('and it moves to a lane that is open', depletedChoice.models.length > 0);

  // 6. A host with no ledger keeps the old chain, so a fresh install is unchanged.
  const bare = selectTurnLanes({ botId: 'brand-new-bot', model: 'zen/muse', fallback: 'zen/nemotron' });
  check('a fresh bot still gets a usable chain', bare.models.length > 0);
  check('a fresh bot chain never picks Freebuff', !bare.models.some((m) => /freebuff/.test(m)));
  check('a fresh bot chain never picks an ended lane', !bare.models.some((m) => /old-promo/.test(m)));

  // 7. Wiring: the turn path calls the ledger selection, not failoverModels alone.
  const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('the turn path calls selectTurnLanes', /const laneChoice = selectTurnLanes\(\{/.test(src));
  check('the chain comes from laneChoice.models', /models: laneChoice\.models\.length \? laneChoice\.models/.test(src));
  check('an exhausted host is told nothing ran', /Nothing was run and nothing was spent/.test(src));
  check('the raw two-entry chain is no longer the only list', !/models: failoverModels\(eff\.model, config\.agent\.model\),/.test(src));
} finally {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  fs.rmSync(home, { recursive: true, force: true });
}

// Coding lanes before light ones. The bot writes code, so a turn that fails over
// from a coding model must not land on a light model while a coding lane is free —
// pref order alone let a light model with a low pref number take the turn over.
check('the walk orders coding lanes before light ones',
  /rank\(a\) - rank\(b\)/.test(botWalkSrc) && /walkTierRank/.test(botWalkSrc));
check('a light lane is still reachable as a last resort',
  /degradedToLight/.test(botWalkSrc) && !/codingLeft === 0\) return/.test(botWalkSrc));
// QS-2 wants the switch visible in the chat, not only in the log: the walk
// displaced a depleted lane on 2026-09-26 06:51Z, answered on the next lane, and
// the chat was told nothing.
check('a displaced lane is announced to the chat, not just logged',
  /this turn ran on \\`\$\{laneChoice\.chose\}\\` instead/.test(botWalkSrc));
check('and that line quotes the ledger reason, never a raw provider envelope',
  /is \$\{why\} — this turn ran on/.test(botWalkSrc) && /const why = stamp && !reason\.includes\(stamp\)/.test(botWalkSrc));
check('and the turn is told when it dropped to a light model',
  /no coding lane is free right now/.test(botWalkSrc));
// The tier is the catalog's, so what is asserted here is that the walk reads the
// catalog at all and that the three models this host actually runs resolve the
// way the catalog says. MiMo V2.6 and DeepSeek V4.1 are ranked under a
// coding-capable tool; Muse Spark 1.3 Contributor is rank 2, high.
check('the walk reads the catalog for its tier order', /walkTierRank\(l\.model\)/.test(botWalkSrc));
check('the models this host runs resolve the way the catalog says',
  tierForModel('deepseek-v4.1-flash').tier === 'high'
  && tierForModel('muse-spark-1.3-contributor').tier === 'high'
  && tierForModel('laguna-s-2.1').tier === 'light'
  && catalogRank('deepseek-v4.1-flash').rank === 1
  && catalogRank('deepseek-v4').rank === null);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
