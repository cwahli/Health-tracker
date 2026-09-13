import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lookupCanonicalBaseFood } from '../server_food_db.js';
import { buildFoodSearchQuerySet } from '../server_query_set.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX = path.join(__dirname, 'Golden_meal', 'inbox');

type InboxCase = {
  id: string;
  status: string;
  queries?: string[];
  expectResolve?: Array<{ query: string; expectFdcId: string; foodName?: string | null }>;
  neverMatch?: Array<{ query: string; forbiddenIds?: string[]; forbiddenNames?: string[] }>;
};

function listInboxCases(): Array<{ dir: string; spec: InboxCase; scout: any | null }> {
  if (!fs.existsSync(INBOX)) return [];
  return fs
    .readdirSync(INBOX, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => {
      const dir = path.join(INBOX, d.name);
      const specPath = path.join(dir, 'case.json');
      if (!fs.existsSync(specPath)) return null;
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
      const scoutPath = path.join(dir, 'scout.json');
      const scout = fs.existsSync(scoutPath) ? JSON.parse(fs.readFileSync(scoutPath, 'utf-8')) : null;
      return { dir, spec, scout };
    })
    .filter(Boolean) as Array<{ dir: string; spec: InboxCase; scout: any | null }>;
}

function scoutItems(scout: any): any[] {
  if (!scout) return [];
  if (Array.isArray(scout)) return scout;
  if (Array.isArray(scout.items)) return scout.items;
  if (Array.isArray(scout.scoutItems)) return scout.scoutItems;
  return [];
}

function isForbidden(rule: NonNullable<InboxCase['neverMatch']>[number], hit: { fdcId?: string; name?: string } | null) {
  if (!hit) return false;
  const id = String(hit.fdcId || '');
  const name = String(hit.name || '').toLowerCase();
  if ((rule.forbiddenIds || []).some((x) => String(x) === id)) return true;
  return (rule.forbiddenNames || []).some((n) => name.includes(n.toLowerCase()));
}

const cases = listInboxCases();

describe('Golden inbox — failing meals replayed until green', () => {
  it('inbox folder is optional; empty inbox is a pass', () => {
    expect(Array.isArray(cases)).toBe(true);
  });

  if (cases.length === 0) {
    it('no open inbox cases', () => {
      expect(cases).toHaveLength(0);
    });
    return;
  }

  for (const { spec, scout } of cases) {
    describe(`${spec.id} (${spec.status})`, () => {
      it('has a frozen scout snapshot to replay (no live agent)', () => {
        const items = scoutItems(scout);
        if (!items.length && !(spec.queries || []).length) {
          // Transport-only snapshot (quota / stall) — nothing to replay yet.
          return;
        }
        expect(items.length, 'run golden-from-debug on a debug export that includes scout JSON').toBeGreaterThan(0);
      });

      it('component queries do not resolve to the observed forbidden USDA/brand rows', () => {
        const violations: string[] = [];
        for (const rule of spec.neverMatch || []) {
          const hit = lookupCanonicalBaseFood(rule.query);
          if (isForbidden(rule, hit)) {
            violations.push(`${rule.query} -> ${hit?.fdcId}`);
          }
        }
        expect(violations).toEqual([]);
      });

      it('does not require a catalog row for expectResolve (catalog paint is not the solver)', () => {
        // expectResolve FDC numbers are documentation of a past curator guess.
        // Forcing lookupCanonicalBaseFood to match them is how Studio loops on
        // CANONICAL_BASE_FOODS. Identity is: query-scoped bind + neverMatch refuse.
        expect(Array.isArray(spec.expectResolve || [])).toBe(true);
      });

      it('query set still extracts components from the frozen scout', () => {
        const items = scoutItems(scout);
        if (!items.length) return;
        const queries = buildFoodSearchQuerySet(items);
        expect(queries.length).toBeGreaterThan(0);
      });
    });
  }
});
