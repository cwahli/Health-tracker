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
import { usableTurnLanes, stampDepleted, ensureBotLedger, sortFreemodelTierRows, freemodelDisplayTier } from './lib/free-lanes.mjs';
import { selectTurnLanes, routeKeySkipped, stickyModelAfterTurn } from './bot-host.mjs';
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

  // 5d. A depleted stamp on a route with NO table lane row still displaces.
  // Live 2026-10-02: cline:cline-free/deepseek-v4.1-flash was stamped depleted
  // yet every next turn announced it as the starting lane again, because the
  // current-lane check only looked at projected table rows. The ghost lane is
  // deliberately absent from the table below.
  const { dir: dir3 } = ensureBotLedger('route-key-bot');
  fs.writeFileSync(path.join(dir3, 'free-lane-table.json'), JSON.stringify(table, null, 2));
  stampDepleted({
    stateDir: dir3,
    provider: 'cline',
    model: 'cline-free/ghost-model',
    errText: '429 Daily free limit reached, try again in 5h',
    depletedUntil: now + 5 * 3600 * 1000,
    countdownHint: '5h',
  });
  const ghost = selectTurnLanes({ botId: 'route-key-bot', model: 'cline:cline-free/ghost-model', fallback: 'zen/muse' });
  check('a stamped route with no lane row is still displaced', !ghost.models.includes('cline:cline-free/ghost-model'));
  check('and the chat is told why', /depleted/.test(String(ghost.displaced?.why)));
  check('and the turn still has a lane to run on', ghost.models.length > 0);
  const ghostKey = routeKeySkipped({
    model: 'cline:cline-free/ghost-model',
    current: { provider: 'cline', model: 'cline-free/ghost-model' },
    session: JSON.parse(fs.readFileSync(path.join(dir3, 'session.json'), 'utf8')),
    now,
  });
  check('the route-key fallback names the stamp', /depleted/.test(String(ghostKey?.why)));
  // After the reset passes the same lane is selectable again.
  const renewed = selectTurnLanes({ botId: 'route-key-bot', model: 'cline:cline-free/ghost-model', fallback: 'zen/muse', now: now + 6 * 3600 * 1000 });
  check('an expired stamp stops displacing', renewed.displaced === null);
  check('the renewed lane runs first again', renewed.models[0] === 'cline:cline-free/ghost-model');

  // 5e. Sticky failover decision: the chat stays on the lane that answered.
  check('an answered turn sticks to the lane that answered',
    stickyModelAfterTurn({ chatModel: 'cline:cline-free/deepseek-v4.1-flash', answeredModel: 'opencode/muse-spark-1.3-contributor-free', answered: true })
    === 'opencode/muse-spark-1.3-contributor-free');
  check('no stick when the chat model itself answered',
    stickyModelAfterTurn({ chatModel: 'a', answeredModel: 'a', answered: true }) === null);
  check('no stick when nothing was answered',
    stickyModelAfterTurn({ chatModel: 'a', answeredModel: 'b', answered: false }) === null);
  check('no stick on empty refs',
    stickyModelAfterTurn({ chatModel: '', answeredModel: 'b', answered: true }) === null
    && stickyModelAfterTurn({ chatModel: 'a', answeredModel: '', answered: true }) === null);

  // 5f. /freemodel order inside one tier: usable by rating desc, then unusable
  // by earliest reset. Rating is benchmark AA desc (rank breaks ties), so
  // AA48 outranks AA41 outranks AA39.5 even though rank 1 belongs to AA39.5.
  const srows = sortFreemodelTierRows([
    { model: 'tokenharbor/deepseek-v4.1-flash:free', pref: 5, selectable: true },
    { model: 'opencode/mimo-v2.6-flash-free', pref: 3, selectable: true },
    { model: 'opencode/muse-spark-1.3-contributor-free', pref: 1, selectable: true },
    { model: 'opencode/late-reset', pref: 2, selectable: false, depleted: true, resetAt: now + 5 * 3600 * 1000 },
    { model: 'opencode/early-reset', pref: 4, selectable: false, depleted: true, resetAt: now + 1 * 3600 * 1000 },
  ]);
  check('usable rows come first, ordered AA48 > AA41 > AA39.5',
    srows[0].model === 'opencode/muse-spark-1.3-contributor-free'
    && srows[1].model === 'opencode/mimo-v2.6-flash-free'
    && srows[2].model === 'tokenharbor/deepseek-v4.1-flash:free');
  check('unusable rows come last, earliest reset first',
    srows[3].model === 'opencode/early-reset' && srows[4].model === 'opencode/late-reset');
  check('Standard/ Light titles are location-scoped',
    freemodelDisplayTier('high', 'vps') === 'VPS Standard model'
    && freemodelDisplayTier('light', 'vps') === 'VPS Light model');

  // 5g. Same-type failover: a depleted Standard lane walks to the next usable
  // Standard lane, never onto Light — and a Light lane never jumps up.
  const tierTable = {
    lanes: [
      { provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', pref: 1, status: 'available', tg: true },
      { provider: 'opencode', model: 'opencode/mimo-v2.6-flash-free', pref: 2, status: 'available', tg: true },
      { provider: 'opencode', model: 'cloudflare/@cf/qwen/qwen3.8-27b', pref: 3, status: 'available', tg: true },
      { provider: 'opencode', model: 'cloudflare/@cf/zai-org/glm-4.7-flash', pref: 4, status: 'available', tg: true },
    ],
  };
  const { dir: tierDir } = ensureBotLedger('tier-bot');
  fs.writeFileSync(path.join(tierDir, 'free-lane-table.json'), JSON.stringify(tierTable, null, 2));
  stampDepleted({
    stateDir: tierDir,
    provider: 'opencode',
    model: 'opencode/muse-spark-1.3-contributor-free',
    errText: '429 Too Many Requests, try again in 3h',
    depletedUntil: now + 3 * 3600 * 1000,
    countdownHint: '3h',
  });
  const tierChoice = selectTurnLanes({ botId: 'tier-bot', model: 'opencode/muse-spark-1.3-contributor-free', fallback: 'opencode/muse-spark-1.3-contributor-free' });
  check('a depleted Standard lane fails over inside Standard first', tierChoice.models[0] === 'opencode/mimo-v2.6-flash-free');
  check('and every Standard lane comes before any Light lane',
    tierChoice.models.indexOf('opencode/mimo-v2.6-flash-free') !== -1
    && tierChoice.models.indexOf('opencode/mimo-v2.6-flash-free') < tierChoice.models.findIndex((m) => /cloudflare/i.test(m)));
  const lightKeep = selectTurnLanes({ botId: 'tier-bot', model: 'opencode/cloudflare/@cf/qwen/qwen3.8-27b', fallback: 'opencode/muse-spark-1.3-contributor-free' });
  check('a usable Light lane stays first', lightKeep.models[0] === 'opencode/cloudflare/@cf/qwen/qwen3.8-27b');
  check('and Light lanes come before any Standard fallback',
    lightKeep.models.findIndex((m) => /cloudflare.*glm/i.test(m)) < lightKeep.models.findIndex((m) => /mimo/i.test(m)));

  // 6. A host with no ledger keeps the old chain, so a fresh install is unchanged.
  const bare = selectTurnLanes({ botId: 'brand-new-bot', model: 'zen/muse', fallback: 'zen/nemotron' });
  check('a fresh bot still gets a usable chain', bare.models.length > 0);
  check('a fresh bot chain never picks Freebuff', !bare.models.some((m) => /freebuff/.test(m)));
  check('a fresh bot chain never picks an ended lane', !bare.models.some((m) => /old-promo/.test(m)));

  // 7. Wiring: the turn path calls the ledger selection, not failoverModels alone.
  const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('the turn path calls selectTurnLanes', /const laneChoice = selectTurnLanes\(\{/.test(src));
  // The landed refactor (#592) moved this expression into a variable and hands the
  // walk `models: turnLaneModels`, so the old check — which pinned the inline
  // property form — went red on correct code, and stayed red because this gate is
  // not one CI runs. The rule is the WIRING, not the shape: the chain is
  // laneChoice.models (never failoverModels alone) and the walk receives exactly
  // that expression.
  const chainVar = (src.match(/const (\w+) = laneChoice\.models\.length \? laneChoice\.models/) || [])[1] || '';
  check('the chain comes from laneChoice.models', /laneChoice\.models\.length \? laneChoice\.models/.test(src));
  check('and the walk is handed that chain, not failoverModels alone', chainVar
    ? new RegExp(`models: ${chainVar}\\b`).test(src)
    : /models: laneChoice\.models\.length \? laneChoice\.models/.test(src));
  // QS-9: the chain may have run elsewhere first, so the line says nothing
  // FURTHER was run — and names every host tried before giving up.
  check('an exhausted host is told nothing further ran', /Nothing further was run and nothing was spent/.test(src));
  check('and the give-up names every host tried', /cont\.hops\.map\(\(h\) =>/.test(src));
  check('the raw two-entry chain is no longer the only list', !/models: failoverModels\(eff\.model, config\.agent\.model\),/.test(src));
} finally {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  fs.rmSync(home, { recursive: true, force: true });
}

// Same-type first: a depleted Standard lane walks to the next usable Standard
// lane in /freemodel order (rating first), stepping across to Light only when
// its own tier is dry — and Light likewise stays Light-first. The list and the
// walk share the within-tier order.
check('the walk puts the depleted lane\u2019s own tier first',
  /tierOf\(l\) === currentGroup/.test(botWalkSrc) && /freemodelRatingOf/.test(botWalkSrc));
check('a light lane is still reachable as a last resort',
  /degradedToLight/.test(botWalkSrc) && !/codingLeft === 0\) return/.test(botWalkSrc));
// QS-2 wants the switch visible in the chat, not only in the log: the walk
// displaced a depleted lane on 2026-09-26 06:51Z, answered on the next lane, and
// the chat was told nothing.
check('a displaced lane is announced to the chat, not just logged',
  /this turn ran on \\`\$\{chatLaneName\(laneChoice\.chose\)\}\\` instead/.test(botWalkSrc));
check('and that line quotes the compact countdown, never the absolute stamp',
  /is \$\{why\} — this turn ran on/.test(botWalkSrc) && /const why = laneChoice\.displaced\.until/.test(botWalkSrc)
  && /formatResetIn\(laneChoice\.displaced\.until/.test(botWalkSrc) && !/until \$\{stamp\}/.test(botWalkSrc));
check('and the turn is told when it dropped to a light model',
  /no coding lane is free right now/.test(botWalkSrc));
// Sticky failover (2026-10-02: a depleted auto-switch was re-announced as the
// starting lane on every next turn): the current-lane check falls back to the
// route key when the table has no row, and an answered turn persists the lane
// that answered.
check('the current-lane check falls back to the stamped route key',
  /routeKeySkipped\(\{/.test(botWalkSrc));
check('an answered turn sticks to the lane that answered',
  /stickyModelAfterTurn\(\{/.test(botWalkSrc) && /autoSwitchedFrom/.test(botWalkSrc));
check('a displaced headline names the running lane, not the dead one',
  /headlineForLane\(laneChoice\.chose\)/.test(botWalkSrc));
// The tier is the catalog's, so what is asserted here is that the walk reads the
// catalog at all and that the three models this host actually runs resolve the
// way the catalog says. MiMo V2.6 and DeepSeek V4.1 are ranked under a
// coding-capable tool; Muse Spark 1.3 Contributor is rank 2, high.
check('the walk reads the catalog for its tier pin and its rating order', /tierForModel\(l\.model\)/.test(botWalkSrc) && /freemodelRatingOf\(/.test(botWalkSrc));
check('the models this host runs resolve the way the catalog says',
  tierForModel('deepseek-v4.1-flash').tier === 'high'
  && tierForModel('muse-spark-1.3-contributor').tier === 'high'
  && tierForModel('laguna-s-2.1').tier === 'light'
  && catalogRank('deepseek-v4.1-flash').rank === 1
  && catalogRank('deepseek-v4').rank === null);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
