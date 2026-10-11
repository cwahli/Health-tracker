import { describe, it, expect } from 'vitest';
import { detectLedgerImbalances, extractLedgerBooks, compileGoldenMeal } from './goldenLedger';

const TAPE = `
[backend] [Foundation] item="Crispy chicken wrap" kcal=724.8
[backend] [Reconcile] item="Crispy chicken wrap" action=scale foundation=724.8 budget=520 final=520 factor=0.717
[backend] [Foundation] item="Grilled Chicken & Avocado Salad" kcal=1089.08
[backend] [Reconcile] item="Grilled Chicken & Avocado Salad" action=reject_scale foundation=1089.08 budget=410 final=1089.08 factor=1.000
[backend] [ReceiptInvariant] REPAIRED rows→item soft factor=2.000
[backend] [Foundation] item="Cinnamon roll" kcal=837.26
[backend] [Reconcile] item="Cinnamon roll" action=reject_scale foundation=837.26 budget=380 final=837.26 factor=1.000
[backend] [Foundation] item="2 Butter Croissants" kcal=593.7
[backend] [Reconcile] item="2 Butter Croissants" action=keep foundation=593.7 budget=460 final=593.7 factor=1.000
macroTotals={"calories":2621.4,"protein":126.2}
[backend] [Scout Reconcile] Adding omitted Vision Scout item "2 Butter Croissants"
The user logged a meal. Total calories are 2621 kcal, which significantly exceeds
`;

describe('meal trial balance', () => {
  it('reads dietitian payload 2621 vs a 4106 saved table as DISH_DROP', () => {
    const imbalances = detectLedgerImbalances({
      logText: TAPE,
      foodLog: {
        nutrients: { calories: 4106 },
        itemsBreakdown: [
          { name: 'wrap', calories: 520 },
          { name: 'salad', calories: 1089 },
          { name: 'cinnamon', calories: 837 },
          { name: 'cinnamon2', calories: 1066 },
          { name: 'croissants', calories: 594 },
        ],
      },
    });
    expect(imbalances.some((i) => i.id === 'ledger_dietitian_payload_vs_saved_table')).toBe(true);
    expect(imbalances.some((i) => i.classHint === 'DISH_DROP')).toBe(true);
    expect(imbalances.some((i) => i.id === 'ledger_receipt_repaired' && i.signal === 'backend')).toBe(true);
    expect(imbalances.some((i) => i.id === 'ledger_reconcile_scale' && i.signal === 'backend')).toBe(true);
  });

  it('treats a dietitian nutrient rewrite as an imbalance, not a fix', () => {
    const imbalances = detectLedgerImbalances({
      logText: '[Dietitian Reality Check] Sodium for "Cinnamon roll" was unrealistically high. Reality check adjusted sodium from 936mg to 440mg.',
      foodLog: { nutrients: { calories: 400 } },
    });
    const hit = imbalances.find((i) => i.id === 'ledger_dietitian_rewrite');
    expect(hit?.signal).toBe('dietitian');
    expect(hit?.classHint).toBe('SILENT_REPAIR');
  });

  it('extracts opening vs payload books from the croissant tape', () => {
    const books = extractLedgerBooks({ logText: TAPE, foodLog: { nutrients: { calories: 4106 } } });
    const payload = books.find((b) => b.id === 'dietitian_payload');
    const table = books.find((b) => b.id === 'saved_table');
    expect(payload?.kcal).toBe(2621.4);
    expect(table?.kcal).toBe(4106);
  });

  it('refused silent scale keeps foundation, not the scaled final=', () => {
    const books = extractLedgerBooks({
      logText: `
[backend] [Foundation] item="Croissant" kcal=617.31
[backend] [Reconcile] item="Croissant" action=scale foundation=617.31 budget=460 final=460 factor=0.745
[backend] [Reconcile] refused silent scale for "Croissant" — keep foundation=617.31
[backend] [Foundation] item="Fruit Salad" kcal=365
[backend] [Reconcile] item="Fruit Salad" action=keep foundation=365 budget=120 final=365 factor=1.000
macroTotals={"calories":982}
`,
      foodLog: { nutrients: { calories: 982 } },
    });
    expect(books.find((b) => b.id === 'foundation')?.kcal).toBe(982.3);
    expect(books.find((b) => b.id === 'reconcile')?.kcal).toBe(982.3);
    expect(books.find((b) => b.id === 'dietitian_payload')?.kcal).toBe(982);
  });

  it('flags scout opening vs saved table as a trial-balance miss', () => {
    const imbalances = detectLedgerImbalances({
      scout: [{ estimatedCalories: 2280 }],
      foodLog: { nutrients: { calories: 2836 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_scout_est_vs_saved_table')).toBe(true);
  });

  it('uses printed label calories for scout opening when rawNutritionLabel is present', () => {
    const books = extractLedgerBooks({
      scout: [
        { estimatedCalories: 453, rawNutritionLabel: { calories: '997 kcal' } },
        { estimatedCalories: 68, rawNutritionLabel: { calories: '39 kcal' } },
      ],
      foodLog: { nutrients: { calories: 1036 } },
    });
    const scout = books.find((b) => b.id === 'scout_est');
    expect(scout?.kcal).toBe(1036);
  });

  it('detects no foundation vs reconcile drift when hard label calories match reconcile', () => {
    const imbalances = detectLedgerImbalances({
      logText: '[Foundation] item="Sweet Chilli Chicken Wrap" kcal=997.0\n[Reconcile] item="Sweet Chilli Chicken Wrap" action=keep foundation=997.0 budget=997.0 final=997.0 factor=1.000',
      foodLog: { nutrients: { calories: 997 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_foundation_vs_reconcile')).toBe(false);
  });

  it('detects no receipt repaired imbalance when component rows match item total', () => {
    const imbalances = detectLedgerImbalances({
      logText: '[ReceiptInvariant] OK item="Sweet Chilli Chicken Wrap" rowSum=997 itemCal=997',
      foodLog: { nutrients: { calories: 997 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_receipt_repaired')).toBe(false);
  });

  it('detects no ledger density override imbalance when component row sum matches composite target', () => {
    const imbalances = detectLedgerImbalances({
      logText: '[LedgerInvariant] composite "Sweet Chilli Chicken Wrap": using row-sum totals, reality-check mutations ignored',
      foodLog: { nutrients: { calories: 997 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_density_override')).toBe(false);
  });

  it('detects no dietitian rewrite imbalance when label items skip reality check', () => {
    const imbalances = detectLedgerImbalances({
      logText: '[Dietitian Reality Check] Heuristic checks skipped for "Sweet Chilli Chicken Wrap" — dbSource is "label_partial" (printed label/screen/menu is ground truth).',
      foodLog: { nutrients: { calories: 997 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_dietitian_rewrite')).toBe(false);
  });

  it('compiler refuses promote when books disagree or replay is catalog', () => {
    const unbalanced = compileGoldenMeal({
      logText: TAPE,
      foodLog: { nutrients: { calories: 4106 } },
    });
    expect(unbalanced.mayPromote).toBe(false);
    expect(unbalanced.compiler).toBe('unbalanced');
    expect(compileGoldenMeal({ replayMode: 'catalog', foodLog: { nutrients: { calories: 100 } } }).mayPromote).toBe(
      false
    );
  });

  it('prefers post-foundation scout nutrients over a stale estimatedCalories guess (miso ramen)', () => {
    // Class: a computed meal copies foundation nutrients back onto the scout
    // (mergeFinalScoutItems), leaving estimatedCalories superseded. The trial
    // balance must read the current math, not the stale guess: NEW food, not
    // this card's dishes, no FDC numbers.
    const scout = [
      { keyword: 'Miso ramen', estimatedCalories: 200, nutrients: { calories: 500 }, preCalcNutrients: { calories: 500 } },
      { keyword: 'Seaweed side', estimatedCalories: 50, nutrients: { calories: 90 } },
    ];
    const books = extractLedgerBooks({
      scout,
      foodLog: { nutrients: { calories: 590 } },
    });
    expect(books.find((b) => b.id === 'scout_est')?.kcal).toBe(590);
    const imbalances = detectLedgerImbalances({
      scout,
      foodLog: { nutrients: { calories: 590 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_scout_est_vs_saved_table')).toBe(false);
  });

  it('still flags a pre-foundation scout guess with no nutrients (miso ramen control)', () => {
    const scout = [
      { keyword: 'Miso ramen', estimatedCalories: 200 },
      { keyword: 'Seaweed side', estimatedCalories: 50 },
    ];
    const imbalances = detectLedgerImbalances({
      scout,
      foodLog: { nutrients: { calories: 590 } },
    });
    expect(imbalances.some((i) => i.id === 'ledger_scout_est_vs_saved_table')).toBe(true);
  });
});
