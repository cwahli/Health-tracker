import { describe, it, expect } from 'vitest';
import {
  formatLedgerDefaultMessage,
  reconcileMessageWithLedger,
  FinalizeLedgerSummary,
} from '../narration';

describe('narration (F-10.4)', () => {
  const summary: FinalizeLedgerSummary = {
    mealName: 'Salmon Bowl with Quinoa',
    weightGrams: 420,
    calories: 560,
    protein: 38,
    carbohydrates: 45,
    totalFat: 24,
    sodium: 680,
    salt: 1.73,
  };

  it('formats clean clinical narration when draft message is empty', () => {
    const msg = formatLedgerDefaultMessage(summary);
    expect(msg).toBe('Logged Salmon Bowl with Quinoa (420g, 560 kcal, 38g protein, 45g carbs, 24g fat).');
  });

  it('formats ledger fallback narration in Indonesian for id profiles', () => {
    const msg = formatLedgerDefaultMessage(summary, 'id');
    expect(msg).toBe('Salmon Bowl with Quinoa dicatat (420g, 560 kcal, 38g protein, 45g karbohidrat, 24g lemak).');
    expect(reconcileMessageWithLedger('', summary, 'id')).toBe(msg);
  });

  it('reconciles empty or whitespace draft message with ledger summary', () => {
    expect(reconcileMessageWithLedger('', summary)).toBe(
      'Logged Salmon Bowl with Quinoa (420g, 560 kcal, 38g protein, 45g carbs, 24g fat).'
    );
    expect(reconcileMessageWithLedger(null, summary)).toBe(
      'Logged Salmon Bowl with Quinoa (420g, 560 kcal, 38g protein, 45g carbs, 24g fat).'
    );
  });

  it('preserves user/agent clinical draft advice when non-empty', () => {
    const custom = 'Great balance of omega-3 fats and slow-digesting carbohydrates.';
    expect(reconcileMessageWithLedger(custom, summary)).toBe(custom);
  });

  it('reconciles cited protein and added sugar metrics with finalized ledger values', () => {
    const draft = 'You got 72.7g of quality protein from the salmon. Sweetened drinks contribute 80g of added sugar to your meal.';
    const updatedSummary: FinalizeLedgerSummary = {
      ...summary,
      protein: 69.7,
      addedSugar: 34,
    };
    const reconciled = reconcileMessageWithLedger(draft, updatedSummary);
    expect(reconciled).toContain('69.7g of quality protein');
    expect(reconciled).toContain('34g of added sugar');
  });
});
