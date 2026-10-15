import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Forward guardrails: every future copy change must propagate to all locales.
 * - fr/zh missing-key sets can only SHRINK (translations landing). Any newly
 *   added en key without fr/zh translations fails here — unless it is listed
 *   in i18nBacklog.json as experimental English-only (then it passes here but
 *   stays pickable; stale entries fail the hygiene test below).
 * - New UI must still use t.* keys: hardcoded JSX text nodes can only SHRINK.
 *   The backlog does NOT excuse hardcoded chrome.
 * Baselines live in i18nMissing.{fr,zh}.json and i18nHardcoded.allowlist.json.
 * When a wave legitimately changes them, shrink the baselines in the same commit.
 * When a wave lands backlogged translations, drop those entries in the same commit.
 */
const root = path.join(fileURLToPath(import.meta.url), '..');
const SRC = path.join(root, '..');

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e === '__tests__') continue;
      walkTsx(p, out);
    } else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('i18n forward propagation', () => {
  function loadBacklogKeys(): Set<string> {
    try {
      const raw = readFileSync(path.join(root, 'i18nBacklog.json'), 'utf8');
      const data = JSON.parse(raw) as { experimental?: Array<string | { key: string }> };
      const list = Array.isArray(data.experimental) ? data.experimental : [];
      return new Set(list.map((e) => (typeof e === 'string' ? e : e.key)));
    } catch {
      return new Set();
    }
  }

  it('fr/zh missing-key sets never grow beyond baseline (except backlogged experimental)', () => {
    const packs: Record<string, Record<string, string>> = {};
    for (const loc of ['en', 'fr', 'zh']) {
      const src = readFileSync(path.join(root, 'translations', `${loc}.ts`), 'utf8');
      const d: Record<string, string> = {};
      for (const m of src.matchAll(/"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g)) d[m[1]] = m[2];
      packs[loc] = d;
    }
    const backlog = loadBacklogKeys();
    for (const loc of ['fr', 'zh'] as const) {
      const baseline: string[] = JSON.parse(
        readFileSync(path.join(root, `i18nMissing.${loc}.json`), 'utf8'),
      );
      const missing = Object.keys(packs.en).filter((k) => !(k in packs[loc]));
      const grew = missing.filter((k) => !baseline.includes(k));
      const unbacklogged = grew.filter((k) => !backlog.has(k));
      expect(unbacklogged, `${loc} has newly untranslated keys (translate them or list them in i18nBacklog.json as experimental): ${unbacklogged.slice(0, 10).join(', ')}`).toEqual([]);
    }
  });

  it('hardcoded JSX text nodes never grow beyond baseline', () => {
    const allow: string[] = JSON.parse(
      readFileSync(path.join(root, 'i18nHardcoded.allowlist.json'), 'utf8'),
    );
    const found = new Set<string>();
    for (const f of walkTsx(path.join(SRC))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/>([A-Z][A-Za-z0-9 ,.'’/()&%$-]{3,})</g)) found.add(m[1]);
    }
    const grown = [...found].filter((s) => !allow.includes(s));
    expect(grown, `new hardcoded UI strings (use t.* + dictionary keys instead): ${grown.slice(0, 10).join(' | ')}`).toEqual([]);
  });

  it('experimental backlog stays pickable (shaped entries, no stale keys)', () => {
    const raw = readFileSync(path.join(root, 'i18nBacklog.json'), 'utf8');
    const data = JSON.parse(raw) as {
      experimental?: Array<string | { key: string; reason?: string; added?: string }>;
    };
    const list = Array.isArray(data.experimental) ? data.experimental : [];
    // Shape: every entry needs a key + reason + added date so it can be picked up.
    const malformed = list.filter(
      (e) => typeof e === 'string' || !e.key || !e.reason || !e.added,
    );
    expect(malformed, 'backlog entries need {key, reason, added} (string entries are not pickable)').toEqual([]);
    // Stale: a backlogged key that is now translated in both fr and zh is done — drop it.
    const frSrc = readFileSync(path.join(root, 'translations', 'fr.ts'), 'utf8');
    const zhSrc = readFileSync(path.join(root, 'translations', 'zh.ts'), 'utf8');
    const stale = (list as Array<{ key: string }>).filter(
      (e) => frSrc.includes(`"${e.key}"`) && zhSrc.includes(`"${e.key}"`),
    ).map((e) => e.key);
    expect(stale, 'backlog keys already translated in fr+zh — remove them in the same commit').toEqual([]);
  });
});
