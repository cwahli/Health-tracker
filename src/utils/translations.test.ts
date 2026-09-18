/**
 * Q-11.8 (milestone 8 of Q-11) — the i18n dictionaries moved out of
 * `src/utils/translations.ts` into `src/utils/translations/<lang>.ts`.
 *
 * A data move is only safe if someone can prove nothing was dropped, so these
 * tests pin the dictionary itself rather than trusting the diff:
 *   1. key parity between `en` and `id` (the two complete packs),
 *   2. the total key count can only go up, never down,
 *   3. every value is a non-empty string,
 *   4. the frozen digest of both packs, so a silent copy edit fails here,
 *   5. the `fr`/`zh` per-key English fallback the aggregator still provides.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { en } from './translations/en';
import { id } from './translations/id';
import { localePacks, translations } from './translations';

/** Baseline recorded when the packs were split out (both packs held 1,980 keys). */
const BASELINE_TOTAL_KEYS = 3960;
/** sha256 of the sorted `[key, value]` pairs, first 16 hex chars. */
const FROZEN_DIGESTS = { en: 'a893ce7398967cbd', id: '81c809577cb90492' } as const;

const stablePairs = (pack: Record<string, unknown>) =>
  JSON.stringify(Object.keys(pack).sort().map((key) => [key, pack[key]]));

const digestOf = (pack: Record<string, unknown>) =>
  createHash('sha256').update(stablePairs(pack)).digest('hex').slice(0, 16);

describe('translations split (Q-11.8)', () => {
  it('keeps en and id key sets identical', () => {
    const enKeys = Object.keys(en).sort();
    const idKeys = Object.keys(id).sort();
    expect(idKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it('never drops keys below the pre-split baseline', () => {
    const total = Object.keys(en).length + Object.keys(id).length;
    expect(total).toBeGreaterThanOrEqual(BASELINE_TOTAL_KEYS);
  });

  it('has a string value for every key in every complete pack', () => {
    for (const [locale, pack] of Object.entries({ en, id }) as [string, Record<string, unknown>][]) {
      const notStrings = Object.entries(pack).filter(([, value]) => typeof value !== 'string');
      expect(notStrings, `${locale} has non-string values`).toEqual([]);
      // `adviceNeutral` is intentionally blank in both packs (the agent fills it in at
      // runtime). Any *other* blank value is dropped copy, so it fails here.
      const blanks = Object.entries(pack)
        .filter(([, value]) => (value as string).trim() === '')
        .map(([key]) => key);
      expect(blanks).toEqual(['adviceNeutral']);
    }
  });

  it('has not silently changed any copy since the split', () => {
    expect({ en: digestOf(en as unknown as Record<string, unknown>), id: digestOf(id as unknown as Record<string, unknown>) }).toEqual(
      FROZEN_DIGESTS,
    );
  });

  it('still exposes the same import surface via localePacks', () => {
    expect(Object.keys(localePacks)).toEqual(['en', 'id', 'fr', 'zh']);
    expect(localePacks.en).toBe(en);
    expect(localePacks.id).toBe(id);
  });

  it('falls back to English per key for packs that are not translated yet', () => {
    const sampleKey = Object.keys(en)[0] as keyof typeof en;
    expect((translations.fr as Record<string, string>)[sampleKey]).toBe(en[sampleKey]);
    expect((translations.zh as Record<string, string>)[sampleKey]).toBe(en[sampleKey]);
    // Unknown keys keep returning the key itself (previous behaviour).
    expect((translations.fr as Record<string, string>).__notAKey__).toBe('__notAKey__');
  });
});
