/**
 * Sensor for the job_1791044439374_4x4srekyi class: a vague "this is incorrect,
 * check again" must never become a destructive edit, and an edit must never
 * empty a meal.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyEditIntent,
  partitionDestructiveCommands,
} from './server_food_edit_intent';

const BEER = [{ name: 'Desperados Original Beer', keyword: 'desperados original beer', weightGrams: 440 }];
const TWO_ITEM = [
  { name: 'Desperados Original Beer', keyword: 'desperados original beer', weightGrams: 440 },
  { name: 'Roast Chicken Drumsticks', keyword: 'roast chicken drumsticks', weightGrams: 450 },
];

describe('classifyEditIntent', () => {
  it('live failure: "This is incorrect check again" is a RECHECK, not a targeted edit', () => {
    const r = classifyEditIntent({ userMessage: 'This is incorrect check again', items: BEER });
    expect(r.kind).toBe('recheck');
    expect(r.namesTarget).toBe(false);
  });

  it('recheck phrasings', () => {
    for (const m of [
      'this is wrong',
      'check again',
      'recheck please',
      'you got it wrong',
      'that is not right',
      'you missed the rice',
      're-analyze this',
      'redo the analysis',
      'doesnt look right',
      'the numbers are incorrect',
    ]) {
      expect(classifyEditIntent({ userMessage: m, items: TWO_ITEM }).kind, m).toBe('recheck');
    }
  });

  it('an explicit removal stays targeted even when it also says "incorrect"', () => {
    const r = classifyEditIntent({ userMessage: 'this is incorrect, remove the beer', items: BEER });
    expect(r.kind).toBe('targeted');
    expect(r.namesTarget).toBe(true);
  });

  it('explicit mutations are never rerouted to recheck', () => {
    const cases = [
      'remove the beer',
      'delete the chicken',
      'i only had the rice',
      "didn't eat the sauce",
      'replace the beer with sparkling water',
      'add a side salad',
      'make it 300g',
      'that was 2 servings',
    ];
    for (const m of cases) {
      expect(classifyEditIntent({ userMessage: m, items: TWO_ITEM }).kind, m).toBe('targeted');
    }
  });

  it('plain questions and Q&A stay non-destructive', () => {
    for (const m of ['how much protein did I get?', 'is this healthy?', 'what did I drink?']) {
      expect(classifyEditIntent({ userMessage: m, items: TWO_ITEM }).kind, m).not.toBe('recheck');
    }
    expect(classifyEditIntent({ userMessage: '', items: BEER }).kind).toBe('none');
  });
});

describe('partitionDestructiveCommands', () => {
  it('separates a hallucinated delete from a legitimate weight correction', () => {
    const cmds = [
      { action: 'delete', itemName: 'Desperados Original Beer', replacesDish: 'Desperados Original Beer' },
      { action: 'set_weight', itemName: 'Desperados Original Beer', newWeightGrams: 330 },
    ];
    const { safe, destructive } = partitionDestructiveCommands(cmds);
    expect(destructive.map((c) => c.action)).toEqual(['delete']);
    expect(safe.map((c) => c.action)).toEqual(['set_weight']);
  });

  it('leaves partial edits alone', () => {
    const { safe, destructive } = partitionDestructiveCommands([
      { action: 'remove_component', itemName: 'Pizza', componentName: 'olives' },
      { action: 'split_item', itemName: 'Pizza', into: [{ name: 'Pizza margherita', grams: 200 }] },
      { action: 'replace_identity', itemName: 'Pizza', newItemName: 'Pizza margherita' },
    ]);
    expect(destructive).toEqual([]);
    expect(safe.map((c) => c.action)).toEqual(['remove_component', 'split_item', 'replace_identity']);
  });
});
