import { describe, it, expect } from 'vitest';
import {
  buildDiscussionResponse,
  buildEvaluationResponse,
  buildNewLogResponse,
  buildModifyNoMealResponse,
  buildModifyResponse,
  buildDegradeResponse,
} from './server_food_responses';

describe('F-8.10 shard 26 — mode response payloads', () => {
  it('shapes discussion and modify-no-meal fallbacks', () => {
    const d = buildDiscussionResponse({ rawParsed: {}, apiCalls: [] });
    expect(d.mode).toBe('discussion');
    expect(d.text).toContain('details on this meal composition');
    expect(d.data).toBeNull();
    const m = buildModifyNoMealResponse({ rawParsed: {}, apiCalls: [] });
    expect(m.message).toContain("couldn't modify");
    expect(m.data).toBeNull();
  });

  it('shapes evaluation payloads with comparison and scout context', () => {
    const e = buildEvaluationResponse({
      rawParsed: { _internalReasoning: 'r', message: 'pick one' },
      scoutInternalReasoning: 's', rawScoutData: null,
      comparisonData: { groups: [] }, comparisonSet: { id: 'c' },
      scoutItems: [], scoutContentType: 'visual', diningEnvironment: 'home_cooked',
      apiCalls: [],
    });
    expect(e.mode).toBe('evaluation');
    expect(e.message).toBe('pick one');
    expect(e.comparisonSet.id).toBe('c');
  });

  it('shapes new_log payloads with fallback narrative and ledger data', () => {
    const n = buildNewLogResponse({
      rawParsed: {}, parsedData: { name: 'Bowl', quantity: '1 serving' },
      pendingFoodLog: null, mealBuild: {}, gate: { savable: true },
      scoutInternalReasoning: null, rawScoutData: null, scoutContentType: 'visual',
      diningEnvironment: 'home_cooked', scoutItems: [], apiCalls: [],
    });
    expect(n.mode).toBe('new_log');
    expect(n.message).toContain('Bowl');
    expect(n.savable).toBe(true);
    expect(n.data.name).toBe('Bowl');
    expect(n.needsPortionClarify).toBeUndefined();
  });

  it('new_log sets the split-turn flag exactly when a clarify payload exists', () => {
    const base = {
      rawParsed: {}, parsedData: { name: 'Bowl', quantity: '1 serving' },
      pendingFoodLog: null, mealBuild: {}, gate: { savable: true },
      scoutInternalReasoning: null, rawScoutData: null, scoutContentType: 'visual',
      diningEnvironment: 'home_cooked', scoutItems: [], apiCalls: [],
    };
    const withClarify = buildNewLogResponse({
      ...base, portionClarify: { promptMessage: 'How much?', items: [{ name: 'Cereal Pack' }] },
    });
    expect(withClarify.portionClarify.items).toHaveLength(1);
    expect(withClarify.needsPortionClarify).toBe(true);
  });

  it('shapes modify payloads with edit flags', () => {
    const m = buildModifyResponse({
      rawParsed: { _internalReasoning: 'r' }, finalMessage: 'done',
      pendingFoodLog: null, activeMeal: { name: 'Lunch' }, mealBuild: {},
      gate: { savable: true }, editApplied: true, scoutItems: [], apiCalls: [],
    });
    expect(m.mode).toBe('modify');
    expect(m.text).toBe('done');
    expect(m.editApplied).toBe(true);
    expect(m.data.name).toBe('Lunch');
  });
});

describe('F-8.10 shard 28 — degrade response', () => {
  it('emits the salvaged meal as succeeded without clinical advice', () => {
    const meal = { name: 'Lunch', degradedStages: ['diet'] };
    const d = buildDegradeResponse({
      payloadData: meal, degradedMeal: meal, visionScoutItems: [],
      scoutContentType: 'visual', apiCalls: [],
    });
    expect(d.mode).toBe('new_log');
    expect(d.message).toContain('core databases');
    expect(d.degradedStages).toEqual(['diet']);
  });

  it('carries the portion-clarify payload so the card question still renders on degrade', () => {
    const meal = { name: 'Lunch', degradedStages: ['diet'] };
    const clarify = { promptMessage: 'How much?', items: [{ name: 'Cereal Pack' }] };
    const d = buildDegradeResponse({
      payloadData: meal, degradedMeal: meal, visionScoutItems: [],
      scoutContentType: 'visual', apiCalls: [], portionClarify: clarify,
    });
    expect(d.portionClarify).toEqual(clarify);
    expect(d.needsPortionClarify).toBe(true);
    const bare = buildDegradeResponse({
      payloadData: meal, degradedMeal: meal, visionScoutItems: [],
      scoutContentType: 'visual', apiCalls: [],
    });
    expect(bare.portionClarify).toBeNull();
    expect(bare.needsPortionClarify).toBeUndefined();
  });
});
