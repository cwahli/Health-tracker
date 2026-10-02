import { describe, it, expect } from 'vitest';
import type { GoldenOutcome } from './goldenScoreboard';
import {
  parseKnownFails,
  parseTensions,
  extractMealLines,
  extractCapturedMealProblems,
  isStaleCapturedStallSymptom,
  stripStaleStallLines,
  evaluateLogOutcomes,
  evaluateMealLines,
  buildScoreboard,
  scoreGoldenRun,
  retainGoldenOutcomes,
  deriveGoldenTitle,
  goldenSlug,
  statsFromJourney,
  splitExtraIssueText,
  effectiveAllGreen,
} from './goldenScoreboard';

const picnicLog = `
[backend] [Brand Menu Match] Matched stored brand item for "granola" -> "Co-op Blueberry Granola Yogurt Pot" (co_op)
[backend] [ResolveClass] HIT_UNIQUE for "mixed berries" -> Beverages, POWERADE, Zero, Mixed Berry
[backend] [Food Resolver Fallback] Created category fallback for gap "plain yogurt"
[backend] [Reconcile] item="Vegetarian wrap" action=scale foundation=778.7 budget=450 final=450 factor=0.578
[backend] [ReceiptInvariant] FAIL item="Croissants" rowSum=441.6 itemCal=492
[backend] [ReceiptInvariant] REPAIRED rows→softBudget factor=1.114 itemCal=492
[backend] [MatchPriority] Bound direct Curator query match id=2710321 ("Popsicle, no sugar added") for component "sugar"
`;

describe('goldenScoreboard parser', () => {
  it('scoreGoldenRun scores expected meal lines against a new pipeline foodLog', () => {
    const { meal, summary } = scoreGoldenRun({
      logText: '[backend] [Reconcile] item="Ham" action=hard_lock foundation=102 budget=102 final=102 factor=1.000',
      expectedMeal: [
        {
          name: 'Ham',
          weightGrams: 100,
          calories: 102,
          protein: 16,
          carbohydrates: null,
          totalFat: null,
          sodium: null,
          scored: true,
        },
      ],
      foodLog: { itemsBreakdown: [{ originalName: 'Ham', weightGrams: 100, calories: 102, nutrients: { protein: 16 } }] },
    });
    expect(meal.pass).toBe(true);
    expect(summary.failCount).toBe(0);
  });

  it('does not keep leftover category-fallback as a fail when identity ended on labels', () => {
    const log = `
[backend] [Food Resolver Fallback] Created category fallback for gap "cooked pasta"
[backend] [Reconcile] item="Prawn Layered Pasta Salad" action=hard_lock foundation=374 budget=374 final=374 factor=1.000
[backend] [Truth Direct Injection] "Prawn Layered Pasta Salad": Using direct nutrients (374 kcal) from label
`;
    const scout = {
      items: [{ originalName: 'Prawn Layered Pasta Salad', components: [{ searchQuery: 'cooked pasta' }] }],
    };
    const board = buildScoreboard({ logText: log, scout });
    expect(board.journey?.[0].phase).toBe('label_truth');
    expect(board.outcomes.some((o) => o.id === 'log_category_fallback')).toBe(false);
  });

  it('captures declared never-match and log events', () => {
    const rows = parseKnownFails(picnicLog);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('never_powerade');
    expect(ids).toContain('never_popsicle');
    expect(ids).toContain('never_coop_granola');
    expect(ids).toContain('log_category_fallback');
    expect(ids).toContain('log_receipt_repair');
    expect(ids).toContain('log_scout_scale');
  });

  it('surfaces scale / receipt tensions for investigation', () => {
    const t = parseTensions(picnicLog);
    expect(t.some((x) => x.note.includes('scaled'))).toBe(true);
    expect(t.some((x) => x.note.includes('Line sum'))).toBe(true);
  });

  it('treats a scored dish with no kcal as presence-only and does not match generic Ham to Serrano', () => {
    const r = evaluateMealLines(
      [
        { name: 'Ham', weightGrams: null, calories: null, protein: null, carbohydrates: null, totalFat: null, sodium: null, scored: true },
        { name: 'Salad', weightGrams: 340, calories: 374, protein: null, carbohydrates: null, totalFat: null, sodium: null, scored: true },
      ],
      [
        { name: 'Prawn Layered Pasta Salad', weightGrams: 340, calories: 374, protein: 14, carbohydrates: null, totalFat: null, sodium: null, scored: false },
        { name: 'Gran Reserva Serrano Ham', weightGrams: 100, calories: 102, protein: 16, carbohydrates: null, totalFat: null, sodium: null, scored: false },
      ]
    );
    expect(r.pass).toBe(false);
    expect(r.misses.some((m) => /missing item "Ham"/i.test(m) && /presence only/i.test(m))).toBe(true);
    expect(r.misses.some((m) => /Salad/.test(m))).toBe(false);
  });

  it('presence-only Ham matches Reformed Ham label, not Serrano', () => {
    const r = evaluateMealLines(
      [{ name: 'Ham', weightGrams: null, calories: null, protein: null, carbohydrates: null, totalFat: null, sodium: null, scored: true }],
      [
        { name: 'Gran Reserva Serrano Ham 50% Duroc Breed', weightGrams: 100, calories: 246, protein: null, carbohydrates: null, totalFat: null, sodium: null, scored: false },
        { name: 'Reformed Ham Nutrition Facts Label', weightGrams: 100, calories: 102, protein: null, carbohydrates: null, totalFat: null, sodium: null, scored: false },
      ]
    );
    expect(r.pass).toBe(true);
    expect(r.misses).toEqual([]);
  });

  it('does not pass meal totals when one line is under and another over', () => {
    const expected = [
      { name: 'Wrap', weightGrams: 250, calories: 480, protein: 15, carbohydrates: 40, totalFat: 26, sodium: 700, scored: true },
      { name: 'Salad', weightGrams: 350, calories: 490, protein: 50, carbohydrates: 11, totalFat: 26, sodium: 180, scored: true },
    ];
    const actual = [
      { name: 'Wrap', weightGrams: 250, calories: 400, protein: 15, carbohydrates: 40, totalFat: 26, sodium: 700, scored: true },
      { name: 'Salad', weightGrams: 350, calories: 570, protein: 50, carbohydrates: 11, totalFat: 26, sodium: 180, scored: true },
    ];
    const r = evaluateMealLines(expected, actual);
    expect(r.pass).toBe(false);
    expect(r.misses.some((m) => /Wrap calories/.test(m))).toBe(true);
  });

  it('log replay flips never-match to pass when signature is gone', () => {
    const drafted = parseKnownFails(picnicLog);
    const cleaned = evaluateLogOutcomes(drafted, 'happy path, no forbidden binds');
    expect(cleaned.every((o) => o.pass === true)).toBe(true);
  });

  it('does not collapse four labeled dishes into the meal title', () => {
    const lines = extractMealLines({
      name: 'Prawn Pasta Salad with Cured Meats and Doughnut',
      calories: 972,
      itemsBreakdown: [
        { originalName: 'Prawn Layered Pasta Salad', weightGrams: 340, calories: 374 },
        { originalName: 'Serrano Ham Gran Reserva', weightGrams: 100, calories: 246 },
        { originalName: 'Pink Iced Ring Doughnut', weightGrams: 75, calories: 250 },
        { originalName: 'Reformed Ham', weightGrams: 100, calories: 102 },
      ],
    });
    expect(lines.map((l) => l.name)).toEqual([
      'Prawn Layered Pasta Salad',
      'Serrano Ham Gran Reserva',
      'Pink Iced Ring Doughnut',
      'Reformed Ham',
    ]);
    expect(lines[0].calories).toBe(374);
  });

  it('extracts meal lines from itemsBreakdown', () => {
    const lines = extractMealLines({
      itemsBreakdown: [{ canonicalDbName: 'Ham', weightGrams: 120, calories: 145, nutrients: { protein: 25 } }],
    });
    expect(lines[0].name).toBe('Ham');
    expect(lines[0].calories).toBe(145);
    expect(lines[0].protein).toBe(25);
  });

  it('counts label-locked journey rows when the log has no Component Resolution Diagnostic', () => {
    const stats = statsFromJourney([
      { id: 'a', dish: 'Salad', query: 'pasta', scoutIndex: 0, componentIndex: 0, phase: 'label_truth', source: 'label', matchId: null, matchName: null, identityPass: true, blockers: [] },
      { id: 'b', dish: 'Donut', query: 'icing', scoutIndex: 1, componentIndex: 1, phase: 'catalog', source: 'internal_catalog', matchId: '169652', matchName: 'icing', identityPass: true, blockers: [] },
    ]);
    expect(stats.sampled).toBe(2);
    expect(stats.curator).toBe(1);
    expect(stats.catalog).toBe(1);
    expect(stats.usda).toBe(0);
  });

  it('names a golden from the dishes, not the job id', () => {
    const title = deriveGoldenTitle({
      foodLog: {
        itemsBreakdown: [
          { originalName: 'Prawn Layered Pasta Salad', calories: 374 },
          { originalName: 'Serrano Ham Gran Reserva 50% Duroc Breed', calories: 246 },
          { originalName: 'Pink Iced Ring Doughnut', calories: 250 },
          { originalName: 'Reformed Ham, Cured and Cooked', calories: 102 },
        ],
      },
      jobId: 'job_1786646310665_zszmh95lj',
      fallback: 'Golden job_1786646310665_zszmh95lj',
    });
    expect(title).toBe('Prawn Layered Pasta Salad + Serrano Ham Gran Reserva + 2 more');
    expect(title).not.toMatch(/job_178664/);
    expect(goldenSlug(title, 'job_1786646310665_zszmh95lj')).toMatch(/prawn-layered-pasta-salad/);
  });

  it('keeps a previously red check as passed instead of deleting it', () => {
    const prev = [
      {
        id: 'res_truth_merge_db_mismatch',
        kind: 'log_event' as const,
        label: 'DB match 150 vs OCR 102',
        expected: 'x',
        actual: 'y',
        pass: false,
        source: 'parser' as const,
        enabled: true,
        signature: '[Truth Merge] Database match calories',
      },
    ];
    const kept = retainGoldenOutcomes(prev, [], 'no merge line in this tape');
    expect(kept).toHaveLength(1);
    expect(kept[0].pass).toBe(true);
    expect(String(kept[0].actual)).toMatch(/cleared|resolved|absent/i);
  });

  it('user extra issues land as custom outcomes', () => {
    const board = buildScoreboard({ logText: '', extraIssues: ['falafel bound to wrap'] });
    expect(board.outcomes.some((o) => o.source === 'user' && /falafel/.test(o.label))).toBe(true);
  });

  it('splits a mashed Gemini blob and does not keep weight/compare/brand extras on top of the auto overwrite', () => {
    const mashed =
      'Portion Weight Parsing Bug: The explicit 500ml weight anchor for the Mango Lassi was mistakenly overridden by the 1 L anchor, doubling its calculated nutrition values. Empty Nutrition UI Render: Comparison mode set foodData to null, causing the single-meal nutrition table in the UI to render completely blank. Brand Guard Search Fallback: The query filter misidentified the generic token "sugar" as a brand name, blocking external database lookup matches.';
    expect(splitExtraIssueText(mashed)).toHaveLength(3);
    const board = buildScoreboard({
      logText:
        '[User Explicit Weight Anchor] User text specified 500g/ml for "mango lassi yogurt drink". Updating estimatedWeightGrams from 400g to 500g.\n' +
        '[User Explicit Weight Anchor] User text specified 1000g/ml for "mango lassi yogurt drink". Updating estimatedWeightGrams from 500g to 1000g.',
      foodLog: {
        itemsBreakdown: [
          { originalName: 'Mango Lassi Yogurt Drink', calories: 335, estimatedWeightGrams: 1000 },
          { originalName: 'Low Fat Yogurt Drink', calories: 350, estimatedWeightGrams: 1000 },
        ],
      },
      extraIssues: [mashed],
    });
    const pending = board.outcomes.filter((o) => o.enabled && o.pass === false);
    expect(pending.some((o) => /overwrote the first/.test(o.label))).toBe(true);
    expect(pending.some((o) => /Portion Weight|Empty Nutrition|Brand Guard/i.test(o.label))).toBe(false);
  });

  it('treats the auto-filled stall block as leftover draft, not a user note', () => {
    expect(
      isStaleCapturedStallSymptom(
        `[Captured Meal Processing Issues]
[Job Error] Stream stalled: No response from analysis engine within 90s.
[Result Error] Stream stalled: No response from analysis engine within 90s.`
      )
    ).toBe(true);
    expect(isStaleCapturedStallSymptom('wrap was scaled to scout guess')).toBe(false);
    expect(
      stripStaleStallLines(
        `[Captured Meal Processing Issues]
[Job Error] Stream stalled: No response from analysis engine within 90s.
wrap was scaled to scout guess`
      )
    ).toBe('wrap was scaled to scout guess');
  });

  it('does not prefill stall when the meal finished, even if error fields still say stalled', () => {
    const problems = extractCapturedMealProblems({
      status: 'succeeded',
      error: { message: 'Stream stalled: No response from analysis engine within 90s.' },
      result: {
        error: 'Stream stalled: No response from analysis engine within 90s.',
        pendingFoodLog: { name: 'Prawn Layered Pasta Salad', calories: 374 },
      },
    });
    expect(problems.join('\n')).not.toMatch(/Stream stalled/i);
  });

  it('does not surface leftover stall on a succeeded job whose log never stalled', () => {
    const problems = extractCapturedMealProblems({
      status: 'succeeded',
      error: { message: 'Stream stalled: No response from analysis engine within 90s.' },
      result: {
        error: 'Stream stalled: No response from analysis engine within 90s.',
        backendLogs: `[backend] [Reconcile] item="Prawn Layered Pasta Salad" action=hard_lock foundation=374 budget=374 final=374 factor=1.000
[backend] [Truth Direct Injection] "Prawn Layered Pasta Salad": Using direct nutrients (374 kcal) from label`,
      },
    });
    expect(problems.join('\n')).not.toMatch(/Stream stalled/i);
  });

  it('keeps stall when the job actually failed with a stall in the log', () => {
    const problems = extractCapturedMealProblems({
      status: 'failed',
      error: { message: 'Stream stalled: No response from analysis engine within 90s.' },
      result: {
        backendLogs: '[backend] [Error] Stream stalled: No response from analysis engine within 90s.',
      },
    });
    expect(problems.join('\n')).toMatch(/Stream stalled/i);
  });
});

/**
 * A case row can carry an enabled outcome with pass=false while the cached
 * all_green column still says true. That happened on a live row: case 329881c4
 * held outcome `user_0_Sainsbury_oat_is_about_3` with pass=false and reported
 * all_green=true / fail_count=0, so a user-reported complaint sat recorded as
 * FAILING on a case every reader believed was GREEN. The scores were last
 * computed 2026-08-14; the outcome was last touched 2026-09-29.
 *
 * all_green is a cached column written only by create/replay/analyze and never
 * recomputed on read, so it is stale by construction once an outcome changes
 * without a replay. The reader has to reconcile.
 */
describe('effectiveAllGreen — a cached green cannot outrank a failing outcome', () => {
  const outcome = (o: Partial<GoldenOutcome>): GoldenOutcome =>
    ({ id: 'o', label: '', pass: true, source: 'user', ...o }) as GoldenOutcome;

  it('refuses green when an enabled outcome is failing (the live case, field for field)', () => {
    const r = effectiveAllGreen(true, [
      outcome({ id: 'user_0_Sainsbury_oat_is_about_3', pass: false, enabled: true, source: 'user' }),
    ]);
    expect(r.allGreen).toBe(false);
    expect(r.contradictedCache).toBe(true);
  });

  it('refuses green for a numeric 1 as well as a boolean true', () => {
    // D1 hands back 0/1 integers, so a truthiness-only guard would miss this.
    expect(effectiveAllGreen(1, [outcome({ pass: false })])).toEqual({
      allGreen: false,
      contradictedCache: true,
    });
  });

  it('keeps green when every outcome passes', () => {
    const r = effectiveAllGreen(true, [outcome({ pass: true }), outcome({ id: 'b', pass: true })]);
    expect(r.allGreen).toBe(true);
    expect(r.contradictedCache).toBe(false);
  });

  it('keeps green when there are no outcomes at all', () => {
    // Deliberately NOT the converse rule: a case whose outcomes were never
    // evaluated keeps its cached state rather than being flipped blind.
    expect(effectiveAllGreen(true, []).allGreen).toBe(true);
    expect(effectiveAllGreen(true, null).allGreen).toBe(true);
    expect(effectiveAllGreen(true, undefined).allGreen).toBe(true);
  });

  it('ignores a disabled failing outcome', () => {
    // Disabled means "not being asserted", which is different from "asserted and
    // failing". Failing it here would make every intentionally-parked case red.
    const r = effectiveAllGreen(true, [outcome({ pass: false, enabled: false })]);
    expect(r.allGreen).toBe(true);
    expect(r.contradictedCache).toBe(false);
  });

  it('cannot grant green that was never cached', () => {
    // It may only take green away. Otherwise a case could be promoted by the
    // reader, which is the promotion path's job and not this function's.
    for (const cached of [false, 0, null, undefined]) {
      expect(effectiveAllGreen(cached, []).allGreen).toBe(false);
      expect(effectiveAllGreen(cached, []).contradictedCache).toBe(false);
    }
  });

  it('stays red when the cache is already red, without claiming a contradiction', () => {
    const r = effectiveAllGreen(false, [outcome({ pass: false })]);
    expect(r.allGreen).toBe(false);
    expect(r.contradictedCache).toBe(false);
  });

  it('tolerates a malformed outcomes array rather than throwing to the caller', () => {
    // A reader must not 500 because one row is dirty; that would turn a reporting
    // bug into an outage and hide every other case on the board.
    const dirty = [null, undefined, outcome({ pass: false })] as unknown as GoldenOutcome[];
    expect(effectiveAllGreen(true, dirty).allGreen).toBe(false);
  });
});
