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
import { fr } from './translations/fr';
import { zh } from './translations/zh';
import { localePacks, translations } from './translations';

/** Baseline recorded when the packs were split out (both packs held 1,980 keys). */
const BASELINE_TOTAL_KEYS = 3960;
/**
 * sha256 of the sorted `[key, value]` pairs, first 16 hex chars.
 *
 * Re-recorded for `phone-bug-intake`, which added three keys per pack
 * (`openBugSnapshotCapture`, `bugReportScreenshot`, `bugReportShotUploadFailed`)
 * so the widened capture button and the report thumbnails are not hardcoded
 * English. No existing copy value was changed. Justified in
 * `specs/active/phone-bug-intake.md` ("Deliberate ratchet move"); the same
 * deliberate-act rule `scripts/assert-parity.mjs` documents. Growth is what
 * this file already permits — parity and the `>=` count floor below exist so
 * the pack can grow without anyone editing existing copy in silence.
 *
 * Re-recorded again for the bug board's card dispositions (PR #392), which
 * added eight keys per pack: the six row-badge words plus the declined KPI
 * tile and its filter. Those words were previously hardcoded English inside
 * BugBoard.tsx, and `dispositionLabel()`'s second argument exists so they stop
 * being. Still growth only — no existing copy value was edited, which is the
 * rule this digest is for.
 *
 * Re-recorded for L-5 (2026-10-12, owner-directed fr/zh fill): two new entries
 * below. The fr/zh packs were empty fallback shells before; their digests pin
 * the reviewed translations (FR reviewer + ZH reviewer, placeholder-verified).
 */
const FROZEN_DIGESTS = { en: 'e382604d4ed04cd6', id: '39a1785088c34a73', fr: '72ed500f4099cdc5', zh: '3b37e3101fbd21d1' } as const;

const stablePairs = (pack: Record<string, unknown>) =>
  JSON.stringify(Object.keys(pack).sort().map((key) => [key, pack[key]]));

const digestOf = (pack: Record<string, unknown>) =>
  createHash('sha256').update(stablePairs(pack)).digest('hex').slice(0, 16);

describe('translations split (Q-11.8)', () => {
  it('keeps every complete pack keyed identically to en', () => {
    const enKeys = Object.keys(en).sort();
    for (const [locale, pack] of Object.entries({ id, fr, zh })) {
      expect(Object.keys(pack).sort(), `${locale} key drift vs en`).toEqual(enKeys);
    }
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it('never drops keys below the pre-split baseline', () => {
    const total = Object.keys(en).length + Object.keys(id).length;
    expect(total).toBeGreaterThanOrEqual(BASELINE_TOTAL_KEYS);
  });

  it('has a string value for every key in every complete pack', () => {
    for (const [locale, pack] of Object.entries({ en, id, fr, zh }) as [string, Record<string, unknown>][]) {
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
    expect({
      en: digestOf(en as unknown as Record<string, unknown>),
      id: digestOf(id as unknown as Record<string, unknown>),
      fr: digestOf(fr as unknown as Record<string, unknown>),
      zh: digestOf(zh as unknown as Record<string, unknown>),
    }).toEqual(
      FROZEN_DIGESTS,
    );
  });

  it('still exposes the same import surface via localePacks', () => {
    expect(Object.keys(localePacks)).toEqual(['en', 'id', 'fr', 'zh']);
    expect(localePacks.en).toBe(en);
    expect(localePacks.id).toBe(id);
  });

  it('serves translated fr/zh copy, falling back to English only for unknown keys', () => {
    expect((translations.fr as Record<string, string>).sendToAdmin).toBe(fr.sendToAdmin);
    expect((translations.zh as Record<string, string>).sendToAdmin).toBe(zh.sendToAdmin);
    expect(fr.sendToAdmin).not.toBe(en.sendToAdmin);
    expect(zh.sendToAdmin).not.toBe(en.sendToAdmin);
    // Unknown keys keep returning the key itself (previous behaviour).
    expect((translations.fr as Record<string, string>).__notAKey__).toBe('__notAKey__');
    expect((translations.zh as Record<string, string>).__notAKey__).toBe('__notAKey__');
  });
});
