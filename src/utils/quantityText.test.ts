import { describe, it, expect } from 'vitest';
import { parseStatedQuantity } from './quantityText';

/** S-10 PORTION_FUNNEL boundary matrix: one row per sentence shape. */
describe('parseStatedQuantity', () => {
  it('parses grams + food token (case-2 shape)', () => {
    const out = parseStatedQuantity('I had 100g of kacang', 'en');
    expect(out).toHaveLength(1);
    expect(out[0].grams).toBe(100);
    expect(out[0].itemRefText).toBe('kacang');
    expect(out[0].isQuestion).toBe(false);
    expect(out[0].isPastReference).toBe(false);
  });

  it('parses bare grams with null item ref', () => {
    const out = parseStatedQuantity('100g', 'en');
    expect(out).toHaveLength(1);
    expect(out[0].grams).toBe(100);
    expect(out[0].itemRefText).toBeNull();
  });

  it('parses multiple pairs independently', () => {
    const out = parseStatedQuantity('100g kacang and 1 can of coke', 'en');
    expect(out).toHaveLength(2);
    expect(out[0].grams).toBe(100);
    expect(out[0].itemRefText).toBe('kacang');
    expect(out[1].count).toBe(1);
    expect(out[1].unitNoun).toBe('can');
    expect(out[1].itemRefText).toBe('coke');
  });

  it('parses ml and kg with density-1 normalization', () => {
    expect(parseStatedQuantity('330ml cooltopia', 'en')[0].grams).toBe(330);
    expect(parseStatedQuantity('1.5kg rice', 'en')[0].grams).toBe(1500);
  });

  it('parses fractions en + id', () => {
    const en = parseStatedQuantity('half the kacang', 'en');
    expect(en).toHaveLength(1);
    expect(en[0].fraction).toBe(0.5);
    expect(en[0].itemRefText).toBe('kacang');
    const id = parseStatedQuantity('separuh kacang', 'id');
    expect(id).toHaveLength(1);
    expect(id[0].fraction).toBe(0.5);
    expect(id[0].itemRefText).toBe('kacang');
  });

  it('parses id units and stopwords', () => {
    const out = parseStatedQuantity('saya makan 1 kaleng coke', 'id');
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(1);
    expect(out[0].unitNoun).toBe('can');
    expect(out[0].itemRefText).toBe('coke');
  });

  it('flags questions, never statements', () => {
    const out = parseStatedQuantity('is 100g a lot?', 'en');
    expect(out).toHaveLength(1);
    expect(out[0].grams).toBe(100);
    expect(out[0].isQuestion).toBe(true);
  });

  it('flags past-time references en + id', () => {
    expect(parseStatedQuantity('kacang yesterday 100g', 'en')[0].isPastReference).toBe(true);
    expect(parseStatedQuantity('kacang kemarin 100g', 'id')[0].isPastReference).toBe(true);
    // "tadi" (just-eaten, ambiguous) is deliberately NOT a past filter.
    expect(parseStatedQuantity('makan kacang tadi 100g', 'id')[0].isPastReference).toBe(false);
  });

  it('yields zero candidates for quantity-free text', () => {
    expect(parseStatedQuantity('This is delicious', 'en')).toEqual([]);
    expect(parseStatedQuantity('Analyze this meal photo.', 'en')).toEqual([]);
    expect(parseStatedQuantity('', 'en')).toEqual([]);
  });

  it('ignores counts without known unit nouns', () => {
    expect(parseStatedQuantity('2 day', 'en')).toEqual([]);
  });
});
