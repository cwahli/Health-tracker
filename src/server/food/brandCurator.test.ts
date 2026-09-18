import { describe, it, expect, vi } from 'vitest';
import {
  calculateTokenJaccard,
  isSupersetComboOrSize,
  isNearDuplicateCandidate,
  evaluateBrandCuratorEligibility,
  validateCuratorAction,
  applyCuratorActions,
  runBrandCuratorStage,
  type BrandMenuItemRow,
  type CuratorActionProposal,
} from './brandCurator.js';

describe('F-11.2: Brand Catalog Curator - Similarity & Superset Guards', () => {
  it('calculateTokenJaccard computes accurate token overlap', () => {
    // Exact or spelling variant
    const j1 = calculateTokenJaccard("Big Mac", "Big Mac Sandwich");
    expect(j1).toBeGreaterThanOrEqual(0.66);

    const jExact = calculateTokenJaccard("McDonald's Big Mac", "McDonald's Big Mac Burger");
    expect(jExact).toBeGreaterThanOrEqual(0.66);

    // Unrelated dishes
    const jDiff = calculateTokenJaccard("Big Mac", "Quarter Pounder with Cheese");
    expect(jDiff).toBeLessThan(0.30);
  });

  it('isSupersetComboOrSize protects combos, meals, and sizes from destructive merge', () => {
    // "Big Mac" vs "Big Mac Meal" -> contains combo keyword "meal"
    expect(isSupersetComboOrSize("Big Mac", "Big Mac Meal")).toBe(true);
    expect(isSupersetComboOrSize("McNuggets 6pc", "McNuggets 20pc Share Box")).toBe(true);
    expect(isSupersetComboOrSize("French Fries", "Large French Fries")).toBe(true);

    // Minor descriptor variant without combo keywords
    expect(isSupersetComboOrSize("Big Mac", "Big Mac Sandwich")).toBe(false);
    expect(isSupersetComboOrSize("Hamburger", "Classic Hamburger")).toBe(false);
  });

  it('isNearDuplicateCandidate enforces Jaccard >= 0.85, kcal within 10%, and combo exclusion', () => {
    const itemA: BrandMenuItemRow = {
      id: 'bm_1',
      country_code: 'GB',
      chain_key: 'mcdonalds',
      dish_name: 'Big Mac',
      dish_name_key: 'big_mac',
      nutrients: { calories: 508 },
      provenance: 'official',
    };

    // Candidate: minor spelling/title variant with 515 kcal (diff: 1.3% <= 10%, Jaccard 1.0)
    const itemNearDup: BrandMenuItemRow = {
      id: 'bm_2',
      country_code: 'GB',
      chain_key: 'mcdonalds',
      dish_name: 'Big Mac',
      dish_name_key: 'big_mac_variant',
      nutrients: { calories: 515 },
      provenance: 'ocr',
    };

    expect(isNearDuplicateCandidate(itemA, itemNearDup)).toBe(true);

    // Candidate: "Big Mac Meal" (+450 kcal combo) -> REJECTED (both combo keyword and kcal diff)
    const itemCombo: BrandMenuItemRow = {
      id: 'bm_3',
      country_code: 'GB',
      chain_key: 'mcdonalds',
      dish_name: 'Big Mac Meal',
      dish_name_key: 'big_mac_meal',
      nutrients: { calories: 958 },
      provenance: 'official',
    };
    expect(isNearDuplicateCandidate(itemA, itemCombo)).toBe(false);

    // Candidate: different chain
    const itemOtherChain: BrandMenuItemRow = {
      ...itemNearDup,
      chain_key: 'burger_king',
    };
    expect(isNearDuplicateCandidate(itemA, itemOtherChain)).toBe(false);

    // Candidate: same name but kcal differs > 10% (508 vs 620 -> 18% diff)
    const itemHighKcal: BrandMenuItemRow = {
      ...itemNearDup,
      nutrients: { calories: 620 },
    };
    expect(isNearDuplicateCandidate(itemA, itemHighKcal)).toBe(false);
  });
});

describe('F-11.2: G0-G4 Eligibility Gate Evaluator', () => {
  const rows: BrandMenuItemRow[] = [
    {
      id: '1',
      country_code: 'GB',
      chain_key: 'greggs',
      dish_name: 'Sausage Roll',
      dish_name_key: 'sausage_roll',
      nutrients: { calories: 328 },
      provenance: 'official',
      basis_type: 'per_dish',
      status: 'active',
    },
    {
      id: '2',
      country_code: 'GB',
      chain_key: 'greggs',
      dish_name: 'Sausage Roll',
      dish_name_key: 'sausage_roll',
      nutrients: { calories: 330 },
      provenance: 'ocr',
      basis_type: 'per_100g', // differing basis -> T3
      status: 'active',
    },
  ];

  it('G0: skips when mode is compare, qa, or weight_only', () => {
    const cases = evaluateBrandCuratorEligibility(
      { mode: 'compare', chainKey: 'greggs', countryCode: 'GB', bindStatus: 'MULTI', dishNameKey: 'sausage_roll' },
      rows
    );
    expect(cases).toHaveLength(0);
  });

  it('G1: skips when bindStatus was SKIPPED', () => {
    const cases = evaluateBrandCuratorEligibility(
      { mode: 'create', chainKey: 'greggs', countryCode: 'GB', bindStatus: 'SKIPPED' },
      rows
    );
    expect(cases).toHaveLength(0);
  });

  it('G3: detects T1 MULTI and T3 BASIS_AMBIGUOUS for active rows', () => {
    const cases = evaluateBrandCuratorEligibility(
      { mode: 'create', chainKey: 'greggs', countryCode: 'GB', bindStatus: 'MULTI', dishNameKey: 'sausage_roll' },
      rows
    );
    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(['T1', 'T3']).toContain(cases[0].trigger);
  });
});

describe('F-11.2: TypeScript Guard Proposal Validation', () => {
  const candidatePool: BrandMenuItemRow[] = [
    {
      id: 'win_1',
      country_code: 'GB',
      chain_key: 'subway',
      dish_name: 'Italian B.M.T.',
      dish_name_key: 'italian_bmt',
      nutrients: { calories: 410 },
      provenance: 'official',
      status: 'active',
    },
    {
      id: 'lose_user',
      country_code: 'GB',
      chain_key: 'subway',
      dish_name: 'Italian BMT Sandwich',
      dish_name_key: 'italian_bmt_user',
      nutrients: { calories: 420 }, // 2.4% diff <= 15%
      provenance: 'user',
      status: 'active',
    },
    {
      id: 'lose_high_kcal',
      country_code: 'GB',
      chain_key: 'subway',
      dish_name: 'Italian BMT Footlong',
      dish_name_key: 'italian_bmt_footlong',
      nutrients: { calories: 820 }, // 50% diff > 15%
      provenance: 'user',
      status: 'active',
    },
    {
      id: 'official_loser',
      country_code: 'GB',
      chain_key: 'subway',
      dish_name: 'Italian BMT Official Twin',
      dish_name_key: 'italian_bmt_official_twin',
      nutrients: { calories: 412 },
      provenance: 'official',
      status: 'active',
    },
    {
      id: 'unofficial_winner',
      country_code: 'GB',
      chain_key: 'subway',
      dish_name: 'Italian BMT Unofficial Winner',
      dish_name_key: 'italian_bmt_unofficial_win',
      nutrients: { calories: 412 },
      provenance: 'user',
      status: 'active',
    },
  ];

  it('approves merge proposal when kcal difference <= 15% and winner is official', () => {
    const action: CuratorActionProposal = {
      type: 'merge_duplicates',
      winnerId: 'win_1',
      loserIds: ['lose_user'],
      reason: 'Standardizing spelling variants',
    };
    const res = validateCuratorAction(action, candidatePool);
    expect(res.valid).toBe(true);
  });

  it('rejects merge proposal when kcal difference exceeds 15%', () => {
    const action: CuratorActionProposal = {
      type: 'merge_duplicates',
      winnerId: 'win_1',
      loserIds: ['lose_high_kcal'], // 410 vs 820 -> 50% diff
      reason: 'Attempted merge of footlong into 6-inch',
    };
    const res = validateCuratorAction(action, candidatePool);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/exceeds 15% limit/i);
  });

  it('rejects merge proposal when loser is official and winner is unofficial', () => {
    const action: CuratorActionProposal = {
      type: 'merge_duplicates',
      winnerId: 'unofficial_winner',
      loserIds: ['official_loser'], // official loser into user winner
      reason: 'Reversed provenance merge',
    };
    const res = validateCuratorAction(action, candidatePool);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/official loser.*cannot be merged into non-official winner/i);
  });

  it('applyCuratorActions performs soft quarantine on loser rows', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null }),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    const actions: CuratorActionProposal[] = [
      {
        type: 'merge_duplicates',
        winnerId: 'win_1',
        loserIds: ['lose_user'],
        reason: 'Clean duplicate',
      },
    ];

    const logs: string[] = [];
    const applyRes = await applyCuratorActions(actions, candidatePool, mockAdmin, (m) => logs.push(m));
    expect(applyRes.applied).toBe(1);
    expect(applyRes.quarantined).toBe(1);
    expect(mockAdmin.from).toHaveBeenCalledWith('brand_menu_items');
  });
});

describe('F-11.2 & F-11.3: runBrandCuratorStage Execution', () => {
  it('executes curator LLM and applies valid proposals with t1/curator wire logging', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: null }),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    const rows: BrandMenuItemRow[] = [
      {
        id: '101',
        country_code: 'GB',
        chain_key: 'costa',
        dish_name: 'Flat White',
        dish_name_key: 'flat_white',
        nutrients: { calories: 120 },
        provenance: 'official',
        status: 'active',
      },
      {
        id: '102',
        country_code: 'GB',
        chain_key: 'costa',
        dish_name: 'Flat White Coffee',
        dish_name_key: 'flat_white_coffee',
        nutrients: { calories: 122 },
        provenance: 'ocr',
        status: 'active',
      },
    ];

    const mockLLMFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        actions: [
          {
            type: 'merge_duplicates',
            winnerId: '101',
            loserIds: ['102'],
            reason: 'Identical beverage with minor word suffix',
          },
        ],
      })
    );

    const logs: string[] = [];
    const result = await runBrandCuratorStage({
      eligibility: {
        mode: 'create',
        chainKey: 'costa',
        countryCode: 'GB',
        bindStatus: 'MULTI',
        dishNameKey: 'flat_white',
      },
      survivingRows: rows,
      callLLMFn: mockLLMFn,
      adminClient: mockAdmin,
      onLog: (m) => logs.push(m),
    });

    expect(result.executed).toBe(true);
    expect(result.actionsProposed).toBe(1);
    expect(result.actionsApplied).toBe(1);
    expect(result.quarantinedCount).toBe(1);
    expect(mockLLMFn).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("agent: 'curator'") && l.includes("t1/curator"))).toBe(true);
  });
});
