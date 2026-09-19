import { Router } from 'express';
import { lookupCanonicalBaseFood } from './server_food_db.js';
import { buildFoodSearchQuerySet } from './server_query_set.js';
import { mapPreviousMealRow, collectRefPhotoIds, substituteRefPhotos } from './server_food_previous_meal.js';

export const foodRouter = Router();

/**
 * Resolve `ref:<id>` duplicate photo pointers to the primary record's real
 * photos, scoped to the caller's uids. Best-effort: a dangling pointer
 * degrades to the letter tile instead of failing the search.
 */
async function resolveRefPhotos(rows: any[], possibleUids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let ids: string[] = [];
  try {
    ids = collectRefPhotoIds(rows);
  } catch {
    return out;
  }
  if (ids.length === 0) return out;
  try {
    const { isD1Configured, d1GetFoodLogImageUrls } = await import('./server_db_d1.js');
    if (isD1Configured()) return d1GetFoodLogImageUrls(ids, possibleUids);
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('food_logs').select('id,image_urls').in('id', ids).in('firebase_uid', possibleUids);
      for (const r of data || []) {
        let raw: unknown = (r as any)?.image_urls;
        if (typeof raw === 'string') {
          try {
            raw = JSON.parse(raw);
          } catch {
            /* keep raw string */
          }
        }
        const list = (Array.isArray(raw) ? raw : [raw]).filter((u: unknown) => typeof u === 'string' && (u as string).trim());
        if ((r as any)?.id && list.length > 0) out.set(String((r as any).id), list as string[]);
      }
    }
  } catch {
    /* best-effort */
  }
  return out;
}

foodRouter.get('/api/food/health', (req, res) => {
  res.json({ status: 'ok', domain: 'food', timestamp: new Date().toISOString() });
});

foodRouter.get('/api/food/search', async (req, res) => {
  const query = (req.query.q as string || '').trim();
  const uid = (req.query.uid as string || '').trim();
  const email = (req.query.email as string || '').trim();
  if (!query) return res.json({ results: [] });
  try {
    let userFoodMatches: any[] = [];
    if (uid || email) {
      const normalizedEmailUid = email ? 'admin_' + email.toLowerCase().trim().replace(/[^a-z0-9]/gi, '_') : null;
      const isCwah = (email && (email.toLowerCase().includes('cwah.liu') || email.toLowerCase().includes('chiwah.liu'))) || 
                     (uid && (uid.includes('cwah_liu') || uid.includes('chiwah_liu') || uid === 'hiJun2hTdDTk2igwerun2LKvwb42'));
      const possibleUids = Array.from(new Set([
        uid,
        email,
        normalizedEmailUid,
        isCwah ? 'hiJun2hTdDTk2igwerun2LKvwb42' : null,
        isCwah ? 'cwah.liu@gmail.com' : null,
        isCwah ? 'chiwah.liu@gmail.com' : null,
        isCwah ? 'admin_cwah_liu_gmail_com' : null,
        isCwah ? 'admin_chiwah_liu_gmail_com' : null
      ].filter(Boolean) as string[]));

      if (possibleUids.length > 0) {
        const { isD1Configured, d1SearchUserFoodLogs } = await import('./server_db_d1.js');
        if (isD1Configured()) {
          const rawPast = await d1SearchUserFoodLogs({ possibleUids, query, limit: 5 });
          const refPhotos = await resolveRefPhotos(rawPast, possibleUids);
          userFoodMatches = substituteRefPhotos(rawPast, refPhotos).map(mapPreviousMealRow);
        } else {
          const { supabaseAdmin } = await import('./supabaseAdmin.js');
          if (supabaseAdmin) {
            const { data: supaPast } = await supabaseAdmin
              .from('food_logs')
              .select('id, name, calories, nutrients, items_breakdown, image_urls, date, weight_grams, consumed_amount')
              .in('firebase_uid', possibleUids)
              .ilike('name', `%${query}%`)
              .order('updated_at', { ascending: false })
              .limit(5);
            if (Array.isArray(supaPast)) {
              const refPhotos = await resolveRefPhotos(supaPast, possibleUids);
              userFoodMatches = substituteRefPhotos(supaPast, refPhotos).map(mapPreviousMealRow);
            }
          }
        }
      }
    }

    const { searchBrandMenuItems } = await import('./serverBrandMenu.js');
    const brandMatches = await searchBrandMenuItems(query);
    const brandResults = brandMatches.slice(0, 10).map((m: any) => ({
      food_id: m.dish_key || m.id || m.name,
      dish_name: m.dish_name || m.name,
      chain_name: m.chain_name || m.chainName || m.brandOwner,
      display_name: m.dish_name || m.name,
      imageUrl: m.imageUrl || m.image_url || undefined,
      serving_grams: m.serving_grams,
      nutrients: m.nutrients,
      type: 'brand'
    }));

    // Deduplicate: avoid duplicate names between past logs and brand
    const seen = new Set<string>();
    const results: any[] = [];
    for (const item of [...userFoodMatches, ...brandResults]) {
      const key = `${item.type}:${(item.dish_name || item.name || '').toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }

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
