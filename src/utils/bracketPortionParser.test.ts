import { describe, it, expect } from 'vitest';
import {
  parseScalingString,
  parseBracketItems,
  formatBracketItem,
  updateOrAddBracketItem,
  removeBracketItem
} from './bracketPortionParser';

describe('bracketPortionParser', () => {
  it('parses various scaling strings', () => {
    expect(parseScalingString('150g')).toEqual({ raw: '150g', value: 150, unit: 'g' });
    expect(parseScalingString('200 g')).toEqual({ raw: '200 g', value: 200, unit: 'g' });
    expect(parseScalingString('1.5x')).toEqual({ raw: '1.5x', value: 1.5, unit: 'x' });
    expect(parseScalingString('2X')).toEqual({ raw: '2X', value: 2, unit: 'x' });
    expect(parseScalingString('2 servings')).toEqual({ raw: '2 servings', value: 2, unit: 'serving' });
    expect(parseScalingString('1 serving')).toEqual({ raw: '1 serving', value: 1, unit: 'serving' });
    expect(parseScalingString('75')).toEqual({ raw: '75g', value: 75, unit: 'g' });
  });

  it('parses separate bracket syntax [Dish Name] [150g]', () => {
    const text = 'I had [Pret A Manger - Egg Salad Sandwich] [150g] and [Starbucks Latte] [1.5x] for lunch';
    const items = parseBracketItems(text);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('Pret A Manger - Egg Salad Sandwich');
    expect(items[0].scaling).toEqual({ raw: '150g', value: 150, unit: 'g' });
    expect(items[1].name).toBe('Starbucks Latte');
    expect(items[1].scaling).toEqual({ raw: '1.5x', value: 1.5, unit: 'x' });
  });

  it('parses combined bracket syntax [Dish Name 150g]', () => {
    const text = '[Sainsbury Whole Oats 60g] with some milk';
    const items = parseBracketItems(text);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Sainsbury Whole Oats');
    expect(items[0].scaling).toEqual({ raw: '60g', value: 60, unit: 'g' });
  });

  it('formats bracket items properly', () => {
    expect(formatBracketItem('Pret Egg Sandwich', { raw: '150g', value: 150, unit: 'g' })).toBe(
      '[Pret Egg Sandwich] [150g]'
    );
    expect(formatBracketItem('Starbucks Latte', '1.5x')).toBe('[Starbucks Latte] [1.5x]');
    expect(formatBracketItem('Apple', 120)).toBe('[Apple] [120g]');
    expect(formatBracketItem('Water')).toBe('[Water]');
  });

  it('updates existing bracket items without clobbering other text', () => {
    const initial = 'Eating [Pret Egg Sandwich] [100g] today';
    const updated = updateOrAddBracketItem(initial, 'Pret Egg Sandwich', '180g');
    expect(updated).toBe('Eating [Pret Egg Sandwich] [180g] today');
  });

  it('appends bracket items when not already present', () => {
    const initial = '[Coffee] [1 serving]';
    const updated = updateOrAddBracketItem(initial, 'Pret Egg Sandwich', '150g');
    expect(updated).toBe('[Coffee] [1 serving] [Pret Egg Sandwich] [150g]');
  });

  it('removes bracket item cleanly', () => {
    const text = 'I had [Pret Egg Sandwich] [150g] and [Coffee] [1 serving]';
    const removed = removeBracketItem(text, 'Pret Egg Sandwich');
    expect(removed).toBe('I had and [Coffee] [1 serving]');
  });
});
