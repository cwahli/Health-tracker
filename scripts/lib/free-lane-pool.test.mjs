/**
 * The free pool, and the check that reads it.
 *
 * Two claims live here, both corrected by the operator on 2026-10-07 after
 * reading the fleet's own free-lane bookkeeping:
 *
 *   1. `opencode-go/space-bunny-free` is NOT a free lane. The Go plan is paid, so
 *      a zero price there means "not metered" — its OpenCode Zen twin is the free
 *      one. The preference doc carries the Go row on its own family so /model_go
 *      can show it. Family is not `space-bunny` and the pref is last, so an empty
 *      Zen pool does not hop onto the paid plan. The free inventory still drops it.
 *   2. Cline's Muse Spark free IS free and working (the operator checked on Cline
 *      while the check skipped Cline outright), so the check pings it — through
 *      the Cline CLI, which is the only runner that can answer for that lane.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { CLINE_FREE_MODELS, FREE_NAME_DENYLIST, GO_SPACE_BUNNY_REF, buildFreeModelList, listFreeOpenCode, listGoOpenCode } from './freemodels.mjs';
import { canonicalAllowanceLanes, clearHoldInPlace, clearLaneHold, nextAvailableRoutes, poolOfLane, poolRows, tableFromPreferenceDoc, withCatalogLanes } from './free-lanes.mjs';
import { holdEvidence, holdStampFromError, probeKindForLane, probeModelForLane, recheckTargets, selectBurnTargets } from './free-lane-probe.mjs';

const PREF_DOC = fileURLToPath(
  new URL('../../tools/telegram-provider-router/docs/free-lane-preference.json', import.meta.url),
);
const prefDoc = () => JSON.parse(readFileSync(PREF_DOC, 'utf8'));

const MUSE_CLINE = 'cline-free/muse-spark-1.3-contributor';
const BUNNY_ZEN = 'opencode/space-bunny-free';
const BUNNY_GO = 'opencode-go/space-bunny-free';

/** A host whose catalog lists the same bunny under the free and the paid surface. */
function cacheWithBothBunnies() {
  const models = { 'space-bunny-free': { cost: { input: 0, output: 0 } } };
  return {
    modelsPath: '/cache/models.json',
    authPath: '/cache/auth.json',
    readJson: (file) => (String(file).endsWith('auth.json')
      ? { opencode: { key: 'x' }, 'opencode-go': { key: 'x' } }
      : { opencode: { models }, 'opencode-go': { models } }),
  };
}

describe('the free pool', () => {
  it('keeps the Zen Space Bunny and drops the paid Go one, from one catalog', () => {
    const refs = listFreeOpenCode(cacheWithBothBunnies());
    expect(refs).toContain(BUNNY_ZEN);
    // The name says free on both surfaces; only the surface decides.
    expect(refs).not.toContain(BUNNY_GO);
  });

  it('qualifies the deny by surface, so a future entry cannot take a whole model down', () => {
    for (const ref of Object.keys(FREE_NAME_DENYLIST)) {
      expect(ref).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    }
    expect(FREE_NAME_DENYLIST[BUNNY_GO]).toBeTruthy();
    expect(FREE_NAME_DENYLIST[BUNNY_ZEN]).toBeUndefined();
  });

  it('carries the Go Space Bunny on its own family so /model_go can show it', () => {
    const rows = prefDoc().lanes || [];
    const row = rows.find((l) => String(l.model || '') === BUNNY_GO);
    expect(row).toBeTruthy();
    expect(row.provider).toBe('opencode-go');
    expect(row.family).toBe('go-space-bunny');
    expect(row.family).not.toBe('space-bunny');
    expect(row.bucket).toBe('opencode-go-per-model');
    expect(row.pref).toBe(18);
    expect(row.tg).not.toBe(false);
    expect(poolOfLane(row)).toBe('go');
    const zen = rows.find((l) => String(l.model || '') === BUNNY_ZEN);
    expect(zen.family).toBe('space-bunny');
    expect(zen.pref).toBeLessThan(row.pref);
    const table = tableFromPreferenceDoc(prefDoc());
    const canon = canonicalAllowanceLanes({ table });
    expect(poolRows(canon, 'go').some((r) => String(r.model).includes('space-bunny-free') && r.plan === 'OG')).toBe(true);
    expect(poolRows(canon, 'coding').some((r) => poolOfLane(r.lane || r) === 'go')).toBe(false);
    expect(poolRows(canon, 'light').some((r) => poolOfLane(r.lane || r) === 'go')).toBe(false);
    const next = nextAvailableRoutes(table, {}, { fromProvider: 'opencode', fromModel: BUNNY_ZEN });
    expect(next[0] && next[0].model).not.toBe(BUNNY_GO);
    expect(next.some((r) => r.family === 'space-bunny' && String(r.model).includes('opencode-go'))).toBe(false);
  });

  it('folds the Go Space Bunny into the catalog when OpenCode is up, and never calls it free', () => {
    const list = buildFreeModelList({
      opencodeBin: process.execPath,
      location: 'vps',
      home: '/tmp/no-such-home-go-bunny',
      env: { PATH: '/usr/bin:/bin', HOME: '/tmp/no-such-home-go-bunny' },
      readJson: () => null,
    });
    const go = list.find((e) => e && e.ref === GO_SPACE_BUNNY_REF);
    expect(go).toBeTruthy();
    expect(go.provider).toBe('opencode-go');
    expect(go.label).toBe('Go Space Bunny');
    expect(String(go.label)).not.toMatch(/\(free\)/i);
    expect(listFreeOpenCode(cacheWithBothBunnies())).not.toContain(BUNNY_GO);
  });

  it('lists every paid Go model on /model_go and none of them in the free inventory', () => {
    const readJson = (file) => (String(file).endsWith('auth.json')
      ? { opencode: { key: 'x' }, 'opencode-go': { key: 'x' } }
      : {
          opencode: { models: { 'space-bunny-free': { name: 'Space Bunny', cost: { input: 0, output: 0 } } } },
          'opencode-go': {
            models: {
              'space-bunny-free': { name: 'Space Bunny Free', cost: { input: 0, output: 0 } },
              'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', cost: { input: 1, output: 2 } },
              'grok-4.7': { name: 'Grok 4.7', cost: { input: 3, output: 4 } },
            },
          },
        });
    const go = listGoOpenCode({ readJson });
    expect(go.map((r) => r.ref).sort()).toEqual([
      'opencode-go/deepseek-v4-pro',
      'opencode-go/grok-4.7',
      'opencode-go/space-bunny-free',
    ]);
    expect(go.every((r) => !/\(free\)/i.test(r.label))).toBe(true);
    const free = listFreeOpenCode({ readJson });
    expect(free.some((ref) => String(ref).startsWith('opencode-go/'))).toBe(false);
    expect(free).toContain(BUNNY_ZEN);
    const list = buildFreeModelList({
      opencodeBin: process.execPath,
      location: 'vps',
      home: '/tmp/no-such-home-go-catalog',
      env: { PATH: '/usr/bin:/bin', HOME: '/tmp/no-such-home-go-catalog' },
      readJson,
    });
    const goEntries = list.filter((e) => e && e.provider === 'opencode-go');
    expect(goEntries.map((e) => e.ref).sort()).toEqual(go.map((r) => r.ref).sort());
    expect(goEntries.every((e) => !/\(free\)/i.test(e.label))).toBe(true);
    const folded = withCatalogLanes(tableFromPreferenceDoc(prefDoc()), list).table;
    const canon = canonicalAllowanceLanes({ table: folded });
    const goRows = poolRows(canon, 'go');
    expect(goRows.some((r) => String(r.model).includes('deepseek-v4-pro') && r.plan === 'OG')).toBe(true);
    expect(goRows.some((r) => String(r.model).includes('grok-4.7') && r.plan === 'OG')).toBe(true);
    expect(poolRows(canon, 'coding').some((r) => poolOfLane(r.lane || r) === 'go')).toBe(false);
    expect(poolRows(canon, 'light').some((r) => poolOfLane(r.lane || r) === 'go')).toBe(false);
  });

  it('keeps Cline Muse Spark free in the free list, with a preference row the check can reach', () => {
    expect(CLINE_FREE_MODELS).toContain(MUSE_CLINE);
    const row = (prefDoc().lanes || []).find((l) => String(l.model || '') === MUSE_CLINE);
    expect(row).toBeTruthy();
    expect(row.provider).toBe('cline');
    // `tg: false` would hide it from every chat-facing walk and from
    // --first-available, which is the "not in the check" state this pins shut.
    expect(row.tg).not.toBe(false);
  });
});

describe('the lane check', () => {
  const clineLane = { pref: 2, provider: 'cline', model: MUSE_CLINE, bucket: 'cline-per-model', tg: true, status: 'available' };

  it('pings a Cline lane with the Cline CLI, not through OpenCode', () => {
    expect(probeKindForLane(clineLane)).toBe('cline');
    // The regression: `${provider}/${model}` produced `cline/cline-free/…`, which
    // OpenCode answers "model not found" — a working lane reported as broken.
    expect(probeModelForLane(clineLane)).toBe(MUSE_CLINE);
    expect(probeModelForLane(clineLane).startsWith('cline/')).toBe(false);
  });

  it('pings an OpenCode lane as provider/model, and never doubles its own prefix', () => {
    expect(probeKindForLane({ provider: 'opencode', model: 'space-bunny-free' })).toBe('opencode');
    expect(probeModelForLane({ provider: 'opencode', model: 'space-bunny-free' })).toBe(BUNNY_ZEN);
    expect(probeModelForLane({ provider: 'opencode', model: BUNNY_ZEN })).toBe(BUNNY_ZEN);
  });

  it('has no chat burn path for a terminal-only lane', () => {
    expect(probeKindForLane({ provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash' })).toBe('skip');
  });

  it('reaches the Cline lane in --first-available instead of stopping at it', () => {
    const lanes = [
      { pref: 1, provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', tg: true, status: 'depleted', nextResetAt: '2999-01-01T00:00:00.000Z' },
      clineLane,
    ];
    expect(selectBurnTargets(lanes, { first: true }).targets.map((l) => l.model)).toEqual([MUSE_CLINE]);
    // The cap protection is a flag now, and it is the only thing that holds it out.
    expect(selectBurnTargets(lanes, { first: true, skipCline: true }).targets).toEqual([]);
  });

  it('includes Cline in --all-burn by default, and drops it only under the cap protection', () => {
    const lanes = [clineLane, { pref: 4, provider: 'opencode', model: BUNNY_ZEN, tg: true }];
    expect(selectBurnTargets(lanes, { all: true }).targets).toHaveLength(2);
    expect(selectBurnTargets(lanes, { all: true, skipCline: true }).targets).toHaveLength(1);
  });

  it('still skips terminal-only and live-depleted lanes', () => {
    const lanes = [
      { pref: 1, provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash', tg: false },
      { pref: 2, provider: 'opencode', model: BUNNY_ZEN, tg: true },
    ];
    expect(selectBurnTargets(lanes, { all: true }).targets.map((l) => l.model)).toEqual([BUNNY_ZEN]);
    expect(selectBurnTargets(lanes, { first: true, isDepleted: (l) => l.model === BUNNY_ZEN }).targets).toEqual([]);
  });

  it('honours an explicitly named lane as named, so the caller says why it is held out', () => {
    expect(selectBurnTargets([clineLane], { lane: '2', skipCline: true }).targets).toEqual([clineLane]);
    expect(selectBurnTargets([clineLane], { lane: '99' })).toEqual({ targets: [], error: 'no pref lane 99' });
  });
});

describe('an empty lane, and whether it is really empty', () => {
  const ZEN = 'opencode-zen-free';
  const museZen = { pref: 1, provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', bucket: ZEN, tg: true };
  const mimoZen = { pref: 3, provider: 'opencode', model: 'opencode/mimo-v2.6-flash-free', bucket: ZEN, tg: true };
  // What a blanket "free limit hit" with no countdown writes: the 6h default TTL on
  // the shared bar, with the lane that tripped it recorded as `hitBy`.
  const DEFAULT_STAMP = {
    depletedUntil: Date.now() + 6 * 3600 * 1000,
    countdownParsed: false,
    kind: 'limit-unknown',
    lastError: 'free limit hit',
    hitBy: 'opencode/muse-spark-1.3-contributor-free',
  };
  const sessionWith = (rec, key = `bucket:${ZEN}`) => ({ quota: { [key]: rec } });

  it('reads a vendor countdown as proof, and a default-TTL stamp as a guess', () => {
    const proven = holdEvidence(museZen, sessionWith({ ...DEFAULT_STAMP, countdownParsed: true, kind: 'allowance-empty' }), {});
    expect(proven.proven).toBe(true);
    expect(proven.held).toBe(true);

    const guess = holdEvidence(museZen, sessionWith(DEFAULT_STAMP), {});
    expect(guess.proven).toBe(false);
    expect(guess.kind).toBe('limit-unknown');

    // A 429 is measured, so it is proof even with no countdown.
    expect(holdEvidence(museZen, sessionWith({ ...DEFAULT_STAMP, kind: 'rate-limit' }), {}).proven).toBe(true);
    // And a lane with no live record at all is simply not held.
    expect(holdEvidence(museZen, { quota: {} }, {})).toBe(null);
  });

  it('names the shared bar as the holder — why MiMo goes dark with Muse', () => {
    const ev = holdEvidence(mimoZen, sessionWith(DEFAULT_STAMP), {});
    expect(ev.shared).toBe(true);
    expect(ev.bucket).toBe(ZEN);
    expect(ev.heldBy).toBe('opencode/muse-spark-1.3-contributor-free');
    expect(ev.key).toBe(`bucket:${ZEN}`);
  });

  it('offers only the unproven holds for re-pinging, in preference order', () => {
    const clineLane = { pref: 15, provider: 'cline', model: 'cline-free/glm-5.3-flash', bucket: 'cline-per-model', tg: true };
    const session = {
      quota: {
        [`bucket:${ZEN}`]: { ...DEFAULT_STAMP },
        'cline/cline-free/glm-5.3-flash': { depletedUntil: Date.now() + 3600e3, countdownParsed: true, kind: 'allowance-empty' },
      },
    };
    const lanes = [mimoZen, clineLane];
    expect(recheckTargets(lanes, session, {}).map((h) => h.lane.pref)).toEqual([3]);
    expect(recheckTargets(lanes, session, { includeProven: true }).map((h) => h.lane.pref)).toEqual([3, 15]);
  });

  it('clears the shared bar and its siblings when one lane answers, and nothing else', () => {
    const clineLane = { pref: 15, provider: 'cline', model: 'cline-free/glm-5.3-flash', bucket: 'cline-per-model', tg: true, status: 'depleted', nextResetAt: '2999-01-01T00:00:00.000Z' };
    const table = {
      buckets: { [ZEN]: { resetRule: 'rolling / rate-limit', nextResetAt: '2999-01-01T00:00:00.000Z', nextResetLabel: 'x' } },
      lanes: [museZen, mimoZen, clineLane],
    };
    const session = {
      quota: {
        [`bucket:${ZEN}`]: { ...DEFAULT_STAMP },
        // Key spelling matches the writer: `${provider}/${model}`, and a
        // pref-doc row's model carries its own vendor dir, so it doubles.
        'opencode/opencode/muse-spark-1.3-contributor-free': { ...DEFAULT_STAMP },
        'opencode/opencode/mimo-v2.6-flash-free': { ...DEFAULT_STAMP },
        'cline/cline-free/glm-5.3-flash': { depletedUntil: Date.now() + 3600e3, countdownParsed: true, kind: 'allowance-empty' },
      },
    };
    const info = clearHoldInPlace({ table, session, lane: mimoZen, source: 'test' });
    expect(info.clearedKeys).toContain(`bucket:${ZEN}`);
    expect(info.clearedKeys).toContain('opencode/opencode/mimo-v2.6-flash-free');
    expect(info.resetLanes.map((r) => r.pref).sort()).toEqual([1, 3]);
    expect(museZen.status).toBe('available');
    expect(museZen.nextResetAt).toBe(null);
    expect(table.buckets[ZEN].nextResetAt).toBe(null);
    // A different bar's hold is not this lane's business.
    expect(clineLane.status).toBe('depleted');
    expect(session.quota['cline/cline-free/glm-5.3-flash']).toBeTruthy();
  });

  it('survives the file round trip: session first, then the table it is truth for', async () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'free-lane-pool-'));
    const tablePath = pathJoin(dir, 'free-lane-table.json');
    const sessionPath = pathJoin(dir, 'session.json');
    writeFileSync(tablePath, JSON.stringify({ version: 3, buckets: { [ZEN]: { resetRule: 'rolling', nextResetAt: '2999-01-01T00:00:00.000Z' } }, lanes: [mimoZen, museZen] }, null, 2));
    writeFileSync(sessionPath, JSON.stringify({ quota: { [`bucket:${ZEN}`]: { ...DEFAULT_STAMP } } }, null, 2));
    const info = clearLaneHold({ tablePath, sessionPath, lane: mimoZen, source: 'test' });
    expect(info.cleared).toBe(true);
    const afterSession = JSON.parse(readFileSync(sessionPath, 'utf8'));
    const afterTable = JSON.parse(readFileSync(tablePath, 'utf8'));
    expect(afterSession.quota[`bucket:${ZEN}`]).toBeUndefined();
    expect(afterTable.lanes.every((l) => l.status === 'available' && l.nextResetAt === null)).toBe(true);
    // And the projection agrees: nothing is held any more.
    expect(holdEvidence(afterTable.lanes[0], afterSession, {})).toBe(null);
  });
});

describe('the lanes the operator verified working on 2026-10-07', () => {
  it('Cline Muse Spark and OpenCode MiMo 2.6 are both pool members the check can ping', () => {
    const rows = prefDoc().lanes || [];
    const wanted = [
      { model: MUSE_CLINE, provider: 'cline', kind: 'cline' },
      { model: 'opencode/mimo-v2.6-flash-free', provider: 'opencode', kind: 'opencode' },
    ];
    for (const w of wanted) {
      const row = rows.find((l) => String(l.model || '') === w.model);
      expect(row, w.model).toBeTruthy();
      expect(row.provider).toBe(w.provider);
      // `tg: false` would hide the lane from every chat-facing walk and from
      // --first-available, which is the "not in the check" state this pins shut.
      expect(row.tg).not.toBe(false);
      const lane = { ...row, tg: true };
      expect(probeKindForLane(lane)).toBe(w.kind);
      expect(probeModelForLane(lane)).toBe(w.model);
      expect(selectBurnTargets([lane], { all: true }).targets).toHaveLength(1);
    }
  });
});

describe('what a refusal proves before it is written down', () => {
  const lane = { pref: 2, provider: 'cline', model: 'cline-free/muse-spark-1.3-contributor', bucket: 'cline-per-model', tg: true };
  const sessionWith = (rec) => ({ quota: { 'cline/cline-free/muse-spark-1.3-contributor': rec } });
  const HOUR = 3600 * 1000;
  // Cline's own words when its daily free unit is spent.
  const CLINE_CAP = 'Daily free model limit reached. Try again in 23h 15m';

  it('keeps the vendor countdown instead of filing it as a guess', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const stamp = holdStampFromError(CLINE_CAP, { now });
    expect(stamp.kind).toBe('allowance-empty');
    expect(stamp.countdownParsed).toBe(true);
    // 23h15m, NOT the 6h default: on the default the lane reads `available` ~17h
    // before the vendor will answer again, which is the false yes this whole
    // column exists to prevent.
    expect(stamp.until - now).toBe(23 * HOUR + 15 * 60 * 1000);
    expect(stamp.ttlMs).toBe(stamp.until - now);
  });

  it('takes an ISO reset stamp the same way', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const stamp = holdStampFromError('quota exceeded; resets at 2026-10-08T00:00:00Z', { now });
    expect(stamp.countdownParsed).toBe(true);
    expect(stamp.until).toBe(Date.parse('2026-10-08T00:00:00Z'));
  });

  it('calls a bare 429 a measured burst, on the short TTL, not a guess', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const stamp = holdStampFromError('429 Too Many Requests', { now });
    expect(stamp.kind).toBe('rate-limit');
    expect(stamp.countdownParsed).toBe(false);
    expect(stamp.until - now).toBe(45 * 60 * 1000);
  });

  it('still files a shapeless quota error as the guess it is', () => {
    const stamp = holdStampFromError('free limit hit');
    expect(stamp.kind).toBe('limit-unknown');
    expect(stamp.countdownParsed).toBe(false);
    expect(stamp.ttlMs).toBe(6 * HOUR);
    expect(holdStampFromError('').kind).toBe('limit-unknown');
  });

  it('so a measured dead lane is not re-pinged, and a guess is', () => {
    const observed = (errText) => {
      const stamp = holdStampFromError(errText);
      return { quota: { 'cline/cline-free/muse-spark-1.3-contributor': {
        depletedUntil: stamp.until,
        countdownParsed: stamp.countdownParsed,
        kind: stamp.kind,
      } } };
    };
    const capped = recheckTargets([lane], observed(CLINE_CAP));
    expect(capped).toHaveLength(0);
    expect(holdEvidence(lane, observed(CLINE_CAP), {}).proven).toBe(true);

    const guess = recheckTargets([lane], observed('free limit hit'));
    expect(guess).toHaveLength(1);
    expect(guess[0].evidence.proven).toBe(false);
  });
});
