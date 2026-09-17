import { Router } from 'express';
import { lookupCanonicalBaseFood } from './server_food_db.js';
import { buildFoodSearchQuerySet } from './server_query_set.js';

export const foodRouter = Router();

foodRouter.get('/api/food/health', (req, res) => {
  res.json({ status: 'ok', domain: 'food', timestamp: new Date().toISOString() });
});

foodRouter.get('/api/food/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json({ results: [] });
  try {
    const { searchBrandMenuItems } = await import('./serverBrandMenu.js');
    const brandMatches = await searchBrandMenuItems(query);
    const results = brandMatches.slice(0, 10).map((m: any) => ({
      food_id: m.dish_key || m.id || m.name,
      dish_name: m.dish_name || m.name,
      chain_name: m.chain_name || m.chainName || m.brandOwner,
      display_name: m.dish_name || m.name,
      imageUrl: m.imageUrl || m.image_url || undefined,
      type: 'brand'
    }));
    res.json({ results });
  } catch (err) {
    console.error('[Search Error]', err);
    res.status(500).json({ results: [] });
  }
});

foodRouter.post('/api/food/query-set', (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }
  const querySet = buildFoodSearchQuerySet([{ originalName: query }]);
  const canonical = lookupCanonicalBaseFood(query);
  return res.json({ query, querySet, canonical });
});
