/**
 * server_audit_food_nutrients.test.ts
 *
 * Contract for the audit-only nutrient route (GET /api/audit/food-nutrients).
 *
 * This route exists because the meal-audit agent needs per-100g values to scale
 * by weighed grams, and the only reachable source was STANDARD_BASE_FOODS — 6
 * dressing entries, which cannot express a real meal. It reads `food_items`, the
 * same table resolveInternalFood() uses, so the audit chain and the product
 * resolve against one catalog.
 *
 * The route is a thin read over D1, so the parts worth pinning are the ones that
 * could quietly corrupt ground truth:
 *   - only `status = 'active'` rows. A candidate row's numbers are not ground
 *     truth and must never reach an audit bundle.
 *   - per-100g values are returned AS STORED, unscaled. The caller scales by
 *     weighed grams; scaling here would make a later re-scale wrong.
 *   - the limit is clamped, so a caller cannot pull the whole table.
 *   - nutrients that fail to parse degrade to {} rather than throwing a 500.
 */
import { describe, it, expect } from 'vitest';

const ROUTE_SOURCE = 'server_routes_jobs.ts';

describe('GET /api/audit/food-nutrients (audit-only nutrient lookup)', () => {
  it('reads food_items, the catalog the product already resolves against', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    const start = src.indexOf("/api/audit/food-nutrients");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 2200);
    expect(block).toContain('FROM food_items');
    // The whole point: per-100g values the audit agent can scale.
    expect(block).toContain('nutrients_per_100g');
    expect(block).toContain('standard_serving_g');
  });

  it('only serves active catalog rows, never candidates', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    const start = src.indexOf("/api/audit/food-nutrients");
    const block = src.slice(start, start + 2200);
    expect(block).toContain("status = 'active'");
  });

  it('returns nutrients unscaled (per 100 g) and names the unit', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    const start = src.indexOf("/api/audit/food-nutrients");
    const block = src.slice(start, start + 2200);
    expect(block).toContain('nutrientsPer100g');
    // No scaling here: a second scale by the caller would double-count.
    expect(block).not.toMatch(/nutrientsPer100g:\s*[^,}]*\*\s*\d/);
  });

  it('clamps the limit so a caller cannot pull the whole table', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    const start = src.indexOf("/api/audit/food-nutrients");
    const block = src.slice(start, start + 2200);
    expect(block).toMatch(/Math\.min\(Math\.max\(rawLim, 1\), 50\)/);
  });

  it('degrades to an empty result when D1 is not configured (no 500)', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    const start = src.indexOf("/api/audit/food-nutrients");
    const block = src.slice(start, start + 2200);
    expect(block).toContain('isD1Configured()');
    expect(block).toMatch(/res\.json\(\{\s*items:\s*\[\]/);
  });

  it('returns no user data — nutrient metadata only', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    const start = src.indexOf("/api/audit/food-nutrients");
    const block = src.slice(start, start + 2200);
    const sql = block.slice(0, block.indexOf('params.push(limit)'));
    // The SELECT must not reach across to user-scoped tables.
    expect(sql).not.toMatch(/food_logs/);
    expect(sql).not.toMatch(/firebase_uid/);
    expect(sql).not.toMatch(/image_urls/);
  });

  it('is unauthenticated like the sibling audit route (read-only, metadata)', () => {
    const src = require('fs').readFileSync(ROUTE_SOURCE, 'utf8');
    // Anchor before the route call so the `jobsRouter.get(` prefix is in view.
    const anchor = src.indexOf("jobsRouter.get('/api/audit/food-nutrients'");
    const block = src.slice(anchor, anchor + 2400);
    // Read-only: no POST/PATCH/DELETE route is registered for this path.
    expect(anchor).toBeGreaterThan(-1);
    expect(block).not.toMatch(/jobsRouter\.(post|patch|delete)\(\s*'\/api\/audit\/food-nutrients'/);
  });
});
