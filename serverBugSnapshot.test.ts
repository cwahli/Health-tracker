import { describe, it, expect, vi } from 'vitest';

// Bug-50 follow-up: server-side loadJobTape must read the frozen R2 tape via
// the Direct server-side readers. The browser helpers (relative /api/* fetch)
// throw under Node, so without the Direct-first path the R2 half of the tape
// was always empty and reanalyze 409'd "No frozen scout" even though R2 holds
// result.scoutItems + result.pendingFoodLog (job_1786666026077_que4vcxxi).
const FROZEN_SCOUT = [
  { keyword: 'Chocolate Croissants', components: [{ searchQuery: 'butter croissant' }] },
  { keyword: 'Vegetarian wrap', components: [{ searchQuery: 'falafel' }] },
  { keyword: 'Hummus & White Quinoa Salad', components: [{ searchQuery: 'kalamata olives' }, { searchQuery: 'balsamic dressing' }] },
];
const FROZEN_FOODLOG = { itemsBreakdown: [{ canonicalDbName: 'Hummus & White Quinoa Salad' }] };

vi.mock('./server_routes_r2.js', () => ({
  fetchLogsFromR2Direct: async () => '[Food Resolver Fallback] Created category fallback for gap "balsamic dressing"',
  fetchDebugPayloadFromR2Direct: async () => ({ result: { pendingFoodLog: FROZEN_FOODLOG, scoutItems: FROZEN_SCOUT } }),
}));

// Browser helpers fail server-side (relative fetch) — prove the tape loads
// even when they yield nothing.
vi.mock('./src/utils/r2Storage.js', () => ({
  fetchLogsFromR2: async () => null,
  fetchDebugPayloadFromR2: async () => null,
}));

// D1 has no agent_jobs row for the Bug-50 job — prove R2 alone suffices.
vi.mock('./server_db_d1.js', () => ({
  d1GetJob: async () => null,
}));

import { loadJobTape } from './serverBugSnapshot';
import { normalizeScoutItems } from './src/utils/goldenJourney';

describe('Bug-50 tape loader: frozen R2 scout survives server-side load', () => {
  it('loads scout + foodLog + logs from R2 Direct when client helpers and D1 are empty', async () => {
    const tape = await loadJobTape('job_1786666026077_que4vcxxi');
    expect(normalizeScoutItems(tape.scout)).toHaveLength(3);
    expect(tape.foodLog).toEqual(FROZEN_FOODLOG);
    expect(tape.logText).toContain('category fallback');
  });
});
