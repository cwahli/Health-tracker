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
 * Re-recorded for profile-surface i18n completion (Indonesian-persona QA):
 * four new keys per pack (`adminControlNav`, `adminMode`, `adminControlDesc`,
 * `openAdminControl` — previously hardcoded English in ProfileModal.tsx) plus
 * 27 `id` values translated from English copies (editProfile, save,
 * weight, bloodType, signOut, …). This is the deliberate exception the digest
 * exists to force into the open: `id` values changed on purpose so Edit
 * Profile is no longer ~50% English. No `en` value was edited.
 *
 * Re-recorded again for auth-surface completion (same QA): six `id` values
 * translated (bypassVerification, checkInbox, emailVerifiedButton,
 * resendVerificationLink, signOutTryAnother, verificationLinkSent) plus 25
 * fr and 25 zh entries for the AuthScreen keys. Only `id` values changed;
 * `en` untouched.
 *
 * Re-recorded for Wave 1 bulk (home/food/health surfaces): 283 `id` values
 * translated from English copies (review-flagged dev tokens intentionally
 * left in English). Deliberate, reviewed per-value; `en` untouched.
 *
 * Re-recorded for Wave 1 remainder: 4 more `id` values (`title`, `label`,
 * `name`, `priority` — proven rendered in HomeTab/BugSnapshot/HealthPlanning,
 * previously English) translated. `en` untouched.
 *
 * Re-recorded for Wave 2 (chat/settings/errors): 310 `id` values translated
 * (72 review-flagged dev tokens left in English). Deliberate, per-value
 * reviewed; `en` untouched.
 *
 * Re-recorded for Wave 3 (final bulk): 563 more `id` values translated
 * (200 consensus dev tokens intentionally left in English). One repair:
 * `compilerMultipleMatch` overwritten correctly (naive regex broke on the
 * original's escaped quotes — structural check added to the author's
 * pipeline, not the suite). `en` untouched.
 *
 * Re-recorded for Wave 3 stragglers: `timeRoll` id + zh, `targetLabel` fr
 * (was the awkward "Étiquette d'objectif"). `en` untouched.
 *
 * Re-recorded for Wave 4 key creation (localisation audit): 238 previously
 * hardcoded JSX strings become dictionary keys (en + id English-copy).
 * Values untranslated by design at this step; Wave 4 fills id/fr/zh.
 */
const FROZEN_DIGESTS = { en: '51d2de8cd8479894', id: '0aa3cb2d10cbfef1' } as const;

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
    // First en key still absent from the fr/zh packs (they are partially
    // translated since the persona-QA waves; missing keys must still fall back).
    const missingFr = (Object.keys(en) as (keyof typeof en)[]).find((k) => !(k in localePacks.fr) && (en[k] as string).trim() !== '');
    const missingZh = (Object.keys(en) as (keyof typeof en)[]).find((k) => !(k in localePacks.zh) && (en[k] as string).trim() !== '');
    expect(missingFr).toBeDefined();
    expect(missingZh).toBeDefined();
    expect((translations.fr as Record<string, string>)[missingFr as string]).toBe(en[missingFr as keyof typeof en]);
    expect((translations.zh as Record<string, string>)[missingZh as string]).toBe(en[missingZh as keyof typeof en]);
    // Unknown keys keep returning the key itself (previous behaviour).
    expect((translations.fr as Record<string, string>).__notAKey__).toBe('__notAKey__');
  });
});
