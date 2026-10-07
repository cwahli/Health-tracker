/**
 * The free pool, and the check that reads it.
 *
 * Two claims live here, both corrected by the operator on 2026-10-07 after
 * reading the fleet's own free-lane bookkeeping:
 *
 *   1. `opencode-go/space-bunny-free` is NOT a free lane. The Go plan is paid, so
 *      a zero price there means "not metered" — its OpenCode Zen twin is the free
 *      one. A preference-doc row authored off the "-free" suffix had offered it as
 *      a second free Space Bunny pool, and the pool doc must not carry it.
 *   2. Cline's Muse Spark free IS free and working (the operator checked on Cline
 *      while the check skipped Cline outright), so the check pings it — through
 *      the Cline CLI, which is the only runner that can answer for that lane.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { CLINE_FREE_MODELS, FREE_NAME_DENYLIST, listFreeOpenCode } from './freemodels.mjs';
import { probeKindForLane, probeModelForLane, selectBurnTargets } from './free-lane-probe.mjs';

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

  it('carries no Go-plate Space Bunny row in the preference doc the ledger seeds from', () => {
    const rows = prefDoc().lanes || [];
    expect(rows.filter((l) => String(l.model || '') === BUNNY_GO)).toHaveLength(0);
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
