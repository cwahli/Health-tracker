import { describe, it, expect } from 'vitest';
import {
  d1GetChainMenuSources,
  d1GetBrandMenuItems,
  d1GetFoodCatalogItems,
  d1GetCatalogMetrics
} from '../../server_db_d1';
import { getCatalogSyncStatus } from '../../server_food_catalog';

describe('Nutrition & Food Catalog D1 and Resilience Contract', () => {
  it('d1GetCatalogMetrics returns structured catalog metrics with non-negative counts', async () => {
    const metrics = await d1GetCatalogMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.success).toBe(true);
    expect(metrics.food_items).toBeDefined();
    expect(metrics.food_items.total).toBeGreaterThanOrEqual(0);
    expect(metrics.dish_cache).toBeDefined();
    expect(typeof metrics.open_deferred_gaps).toBe('number');
  });

  it('d1GetFoodCatalogItems returns parsed nutrient records', async () => {
    const items = await d1GetFoodCatalogItems('food', 'all', '', 5);
    expect(Array.isArray(items)).toBe(true);
    if (items.length > 0) {
      const first = items[0];
      expect(first).toHaveProperty('food_key');
      expect(typeof first.nutrients_per_100g).toBe('object');
    }
  });

  it('d1GetChainMenuSources returns array of chain sources with enabled boolean', async () => {
    const chains = await d1GetChainMenuSources('GB');
    expect(Array.isArray(chains)).toBe(true);
    if (chains.length > 0) {
      const first = chains[0];
      expect(first).toHaveProperty('chain_key');
      expect(typeof first.enabled).toBe('boolean');
    }
  });

  it('d1GetBrandMenuItems returns array of brand items with parsed nutrients', async () => {
    const items = await d1GetBrandMenuItems(undefined, 'GB');
    expect(Array.isArray(items)).toBe(true);
    if (items.length > 0) {
      const first = items[0];
      expect(first).toHaveProperty('chain_key');
      expect(typeof first.nutrients).toBe('object');
    }
  });

  it('getCatalogSyncStatus delegates cleanly to D1 metrics without crashing when Supabase is null or exhausted', async () => {
    const status = await getCatalogSyncStatus();
    expect(status).toBeDefined();
    expect(status.success).toBe(true);
  });
});
