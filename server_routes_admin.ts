import { Router } from 'express';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { supabaseAdmin } from './supabaseAdmin.js';
import { isD1Configured } from './server_d1.js';
import {
  d1GetFoodCatalogItems,
  d1UpdateFoodServing,
  d1UpdateItemStatus,
  d1GetCatalogMetrics
} from './server_db_d1.js';
import { pushTranslationsToSheets, pullTranslationsFromSheets } from './server_translations.js';
import { getCatalogSyncStatus, mergeFoodCatalogItems, quarantineAtwaterFailures } from './server_food_catalog.js';
import { selfCleanBrandDatabase } from './serverBrandMenu.js';
import { getS3Client, CLOUDFLARE_R2_BUCKET_NAME, CLOUDFLARE_R2_PUBLIC_URL } from './server_routes_r2.js';

export const adminRouter = Router();

const ADMIN_EMAILS = ["cwah.liu@gmail.com", "chiwah.liu@gmail.com"];

function getAdmin() {
  try {
    return getAdminAuth();
  } catch (err) {
    return null;
  }
}

async function requireAdmin(req: any, res: any): Promise<string | null> {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    res.status(401).json({ error: 'Unauthorized: missing token' });
    return null;
  }
  const adminAuth = getAdmin();
  if (!adminAuth) {
    res.status(500).json({ error: 'Admin auth not available' });
    return null;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = decoded.email?.toLowerCase().trim() || '';
    if (!ADMIN_EMAILS.includes(email)) {
      res.status(403).json({ error: 'Forbidden: admin access only' });
      return null;
    }
    return email;
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized: invalid token' });
    return null;
  }
}

// List all registered Firebase Auth users
adminRouter.get("/api/admin/users", async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;
    const adminAuth = getAdmin();
    if (!adminAuth) return res.status(500).json({ error: "Admin Auth not initialized" });

    const allUsers: any[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const result: any = await adminAuth.listUsers(1000, pageToken);
      result.users.forEach((u: any) => {
        allUsers.push({
          uid: u.uid,
          email: u.email || '',
          emailVerified: !!u.emailVerified,
          disabled: !!u.disabled,
          createdAt: u.metadata?.creationTime || null,
          lastSignInAt: u.metadata?.lastSignInTime || null,
          providers: (u.providerData || []).map((p: any) => p.providerId)
        });
      });
      pageToken = result.pageToken;
    } while (pageToken);

    console.log(`[Admin] ${adminEmail} listed ${allUsers.length} users`);
    res.json({ success: true, users: allUsers });
  } catch (error: any) {
    console.error("[Admin] Failed to list users:", error);
    res.status(500).json({ error: error.message || "Failed to list users" });
  }
});

// Delete Auth user
adminRouter.delete("/api/admin/user/auth", async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;
    const adminAuth = getAdmin();
    if (!adminAuth) return res.status(500).json({ error: "Admin Auth not initialized" });

    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    await adminAuth.deleteUser(uid);
    console.log(`[Admin] ${adminEmail} deleted Auth user ${uid}`);
    res.json({ success: true, message: `Auth user ${uid} deleted` });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete Auth user" });
  }
});

// Delete Firestore User Data
adminRouter.delete("/api/admin/user/data", async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    
    const db = getFirestore();
    await db.collection("users").doc(uid).delete();
    console.log(`[Admin] ${adminEmail} deleted Firestore user data ${uid}`);
    res.json({ success: true, message: `User data for ${uid} deleted` });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete user data" });
  }
});

// Resend Verification Email Link
adminRouter.post("/api/admin/user/resend-verification", async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;
    const adminAuth = getAdmin();
    if (!adminAuth) return res.status(500).json({ error: "Admin Auth not initialized" });

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });
    const link = await adminAuth.generateEmailVerificationLink(email);
    console.log(`[Admin] Generated verification link for ${email}`);
    res.json({ success: true, link });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to generate verification link" });
  }
});

// Generate Password Reset Link
adminRouter.post("/api/admin/user/send-password-reset", async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;
    const adminAuth = getAdmin();
    if (!adminAuth) return res.status(500).json({ error: "Admin Auth not initialized" });

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });
    const link = await adminAuth.generatePasswordResetLink(email);
    console.log(`[Admin] Generated password reset link for ${email}`);
    res.json({ success: true, link });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to generate password reset link" });
  }
});

adminRouter.post('/api/admin/user/reset-email', async (req, res) => {
  res.json({ success: true, message: "Email sent" });
});

adminRouter.post('/api/admin/user/reset-password', async (req, res) => {
  res.json({ success: true, message: "Password reset sent" });
});

// Translation Sync Endpoints
adminRouter.post('/api/admin/translations/push', async (req, res) => {
  await pushTranslationsToSheets(req.body?.keys || {});
  res.json({ success: true });
});

adminRouter.post('/api/admin/translations/pull', async (req, res) => {
  const data = await pullTranslationsFromSheets();
  res.json({ success: true, data });
});

// Food Catalog Admin Endpoints
adminRouter.get('/api/admin/food-catalog', async (req, res) => {
  try {
    const itemType = ((req.query.type as string) || 'food') as 'food' | 'dish';
    const statusFilter = (req.query.status as string) || 'all';
    const searchQuery = ((req.query.search as string) || '').toLowerCase().trim();

    // 1. Try D1 if configured
    if (isD1Configured()) {
      try {
        const d1Items = await d1GetFoodCatalogItems(itemType, statusFilter, searchQuery);
        if (d1Items && d1Items.length > 0) {
          return res.json({ items: d1Items });
        }
      } catch (d1Err) {
        console.warn('[api/admin/food-catalog] D1 fetch error:', d1Err);
      }
    }

    // 2. Try Supabase if available
    if (supabaseAdmin) {
      try {
        const tableName = itemType === 'dish' ? 'dish_cache' : 'food_items';
        let query = supabaseAdmin.from(tableName).select('*');
        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }
        if (searchQuery) {
          query = query.ilike('display_name', `%${searchQuery}%`);
        }
        const { data, error } = await query.order('updated_at', { ascending: false }).limit(100);
        if (!error && data && data.length > 0) {
          return res.json({ items: data });
        }
      } catch (sbErr) {
        console.warn('[api/admin/food-catalog] Supabase fetch error:', sbErr);
      }
    }

    // 3. Fallback: If requesting base food items and no results yet, return from CANONICAL_BASE_FOODS
    if (itemType !== 'dish') {
      const { CANONICAL_BASE_FOODS } = await import('./server_food_db.js');
      let fallbackItems = Object.entries(CANONICAL_BASE_FOODS).map(([key, val]: [string, any]) => {
        const displayName = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return {
          food_id: 'canonical_' + key,
          food_key: key,
          display_name: displayName,
          scientific_name: null,
          category: val.foodType || 'whole_food',
          standard_serving_g: val.serving_grams || 100,
          density_g_ml: val.density_g_ml || null,
          status: 'active',
          source: 'canonical',
          core_nutrients: {
            calories: val.calories || 0,
            protein: val.protein || 0,
            carbs: val.carbohydrates || 0,
            fat: val.totalFat || 0
          },
          nutrients_per_100g: {
            calories: val.calories || 0,
            protein: val.protein || 0,
            carbs: val.carbohydrates || 0,
            fat: val.totalFat || 0,
            saturated_fat: val.saturatedFat || 0,
            fiber: val.totalFibre || 0,
            sugar: val.sugar || 0,
            sodium: val.sodium || 0,
            potassium: val.potassium || 0,
          },
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

      if (statusFilter !== 'all' && statusFilter !== 'active') {
        fallbackItems = [];
      } else if (searchQuery) {
        fallbackItems = fallbackItems.filter(i => i.display_name.toLowerCase().includes(searchQuery));
      }
      return res.json({ items: fallbackItems.slice(0, 100) });
    }

    return res.json({ items: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

adminRouter.post('/api/admin/food-catalog/ensure-schema', async (req, res) => {
  try {
    const { resetFoodCatalogSchemaEnsure, ensureFoodCatalogSchema } = await import('./server_food_catalog_schema.js');
    resetFoodCatalogSchemaEnsure();
    const result = await ensureFoodCatalogSchema();
    if (!result.ok) return res.status(503).json({ success: false, ...result });
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

adminRouter.post('/api/admin/food-catalog/promote', async (req, res) => {
  try {
    const { itemType, key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing item key' });

    if (isD1Configured()) {
      await d1UpdateItemStatus(itemType === 'dish' ? 'dish' : 'food', key, 'active');
    }

    if (supabaseAdmin) {
      try {
        const table = itemType === 'dish' ? 'dish_cache' : 'food_items';
        const keyCol = itemType === 'dish' ? 'dish_key' : 'food_key';
        const { data: existing } = await supabaseAdmin.from(table).select('version').eq(keyCol, key).maybeSingle();
        const currentVer = existing?.version || 1;
        await supabaseAdmin.from(table).update({
          status: 'active',
          version: currentVer + 1,
          updated_at: new Date().toISOString()
        }).eq(keyCol, key);
      } catch (sbErr) {
        console.warn('[food-catalog/promote] Supabase update failed:', sbErr);
      }
    }

    return res.json({ success: true, message: `Promoted ${itemType || 'item'} ${key} to active` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

adminRouter.post('/api/admin/food-catalog/quarantine', async (req, res) => {
  try {
    const { itemType, key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing item key' });

    if (isD1Configured()) {
      await d1UpdateItemStatus(itemType === 'dish' ? 'dish' : 'food', key, 'quarantine');
    }

    if (supabaseAdmin) {
      try {
        const targetTable = itemType === 'dish' ? 'dish_cache' : 'food_items';
        const targetKeyCol = itemType === 'dish' ? 'dish_key' : 'food_key';
        await supabaseAdmin.from(targetTable).update({
          status: 'quarantine',
          updated_at: new Date().toISOString()
        }).eq(targetKeyCol, key);
      } catch (sbErr) {
        console.warn('[food-catalog/quarantine] Supabase update failed:', sbErr);
      }
    }

    return res.json({ success: true, message: `Quarantined ${key}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

adminRouter.post('/api/admin/food-catalog/update-serving', async (req, res) => {
  try {
    const { itemType, key, basisType, servingGrams } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing item key' });

    const numServing = servingGrams === '' || servingGrams == null ? 0 : Number(servingGrams);

    if (isD1Configured()) {
      await d1UpdateFoodServing(itemType === 'dish' ? 'dish' : 'food', key, basisType || 'per_serving', numServing);
    }

    if (supabaseAdmin) {
      try {
        const targetTable = itemType === 'dish' ? 'dish_cache' : 'food_items';
        const targetKeyCol = itemType === 'dish' ? 'dish_key' : 'food_key';
        await supabaseAdmin.from(targetTable).update({
          basis_type: basisType || null,
          serving_grams: numServing || null,
          updated_at: new Date().toISOString()
        }).eq(targetKeyCol, key);
      } catch (sbErr) {
        console.warn('[food-catalog/update-serving] Supabase update failed:', sbErr);
      }
    }

    return res.json({ success: true, message: `Updated serving size of ${key}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

adminRouter.get('/api/admin/food-catalog-sync-status', async (req, res) => {
  try {
    if (isD1Configured()) {
      const d1Metrics = await d1GetCatalogMetrics();
      return res.json({ ...d1Metrics, backend: 'd1' });
    }
    const result = await getCatalogSyncStatus();
    if (!result.success) return res.status(200).json({ ...result, success: true, unavailable: true });
    res.json(result);
  } catch (err: any) {
    res.status(200).json({ success: true, unavailable: true, error: err?.message || String(err) });
  }
});

adminRouter.post('/api/admin/food-catalog/merge', async (req, res) => {
  const { sourceKey, targetKey } = req.body || {};
  if (!sourceKey || !targetKey) {
    return res.status(400).json({ error: 'sourceKey and targetKey required' });
  }
  const result = await mergeFoodCatalogItems(sourceKey, targetKey);
  if (!result.success) return res.status(500).json(result);
  res.json(result);
});

adminRouter.post('/api/admin/food-catalog/quarantine-check', async (req, res) => {
  const result = await quarantineAtwaterFailures();
  if (!result.success) return res.status(500).json(result);
  res.json(result);
});

adminRouter.post('/api/admin/db-clean', async (req, res) => {
  try {
    const countryCode = req.body?.countryCode || 'GB';
    const cleanRes = await selfCleanBrandDatabase(supabaseAdmin, countryCode, console.log);
    return res.json({
      success: true,
      chainStats: {
        updatedChainsCount: cleanRes.updatedChainsCount,
        deletedDuplicatesCount: cleanRes.deletedDuplicatesCount,
        purgedUnofficialCount: cleanRes.removedUnofficialCount,
        details: cleanRes.details
      },
      catalogStats: {
        purgedBrandedCount: cleanRes.removedUnofficialCount
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

adminRouter.post('/api/admin/brand-menu/cleanup', async (req, res) => {
  try {
    const countryCode = req.body?.countryCode || 'GB';
    const cleanRes = await selfCleanBrandDatabase(supabaseAdmin, countryCode, console.log);
    return res.json({
      success: true,
      countryCode,
      deletedDuplicatesCount: cleanRes.deletedDuplicatesCount,
      removedUnofficialCount: cleanRes.removedUnofficialCount,
      updatedChainsCount: cleanRes.updatedChainsCount,
      details: cleanRes.details
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

adminRouter.get('/api/admin/food-catalog/metrics', async (req, res) => {
  try {
    const status = await getCatalogSyncStatus();
    res.json({
      success: true,
      metrics: {
        resolver_call_count: status.resolver_call_count ?? 0,
        active_items_count: status.food_items?.active,
        candidate_items_count: status.food_items?.candidate,
        deferred_gaps_count: status.open_deferred_gaps,
        sync_failures_count: status.sync_failures
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// R2 orphaned photo audit + delete
//
// Every food-photo upload path in the app (job submission, sync push,
// edit-mode re-upload) writes to R2 under photos/{id}.jpg but nothing ever
// deletes the object when a meal is deleted, a job fails, or a photo is
// replaced during edit/re-analysis. This surfaces what's actually orphaned
// so it can be reviewed and cleaned up deliberately, rather than guessed at.
//
// "Referenced" (kept) means the photo's public URL appears in EITHER:
//   - a food log's image_urls (Supabase, all users, current data)
//   - a job's photo_url (Cloudflare D1 agent_jobs table, any status)
// A job's own photo_url covers "linked to a debug file" in practice, since
// every job record IS the durable record a debug export is built from -
// we don't additionally parse the contents of debug/*.json blobs in R2 for
// this pass (would mean fetching and parsing every debug payload on every
// audit run); if that turns out to miss real cases, it's worth adding.
// ---------------------------------------------------------------------------

async function listAllR2PhotoKeys(): Promise<Array<{ key: string; size: number; lastModified: string | null }>> {
  const client = getS3Client();
  if (!client) return [];
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const out: Array<{ key: string; size: number; lastModified: string | null }> = [];
  let continuationToken: string | undefined;
  do {
    const page: any = await client.send(new ListObjectsV2Command({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Prefix: 'photos/',
      ContinuationToken: continuationToken,
    }));
    for (const obj of (page.Contents || [])) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        size: obj.Size || 0,
        lastModified: obj.LastModified ? new Date(obj.LastModified).toISOString() : null,
      });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return out;
}

function extractR2KeyFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const idx = url.indexOf('/photos/');
  if (idx === -1) return null;
  return url.slice(idx + 1); // "photos/xxx.jpg"
}

async function getReferencedPhotoKeys(): Promise<Set<string>> {
  const referenced = new Set<string>();

  // Food logs across every user - image_urls is a JSON array column.
  try {
    const { data: rows } = await supabaseAdmin.from('food_logs').select('image_urls').limit(5000);
    for (const row of (rows || [])) {
      let urls: any = row.image_urls;
      if (typeof urls === 'string') {
        try { urls = JSON.parse(urls); } catch { urls = []; }
      }
      if (Array.isArray(urls)) {
        for (const u of urls) {
          const key = extractR2KeyFromUrl(u);
          if (key) referenced.add(key);
        }
      }
    }
  } catch (err) {
    console.warn('[r2-photo-audit] Supabase food_logs lookup failed:', err);
  }

  // Every job record, any status - a job's photo_url is the durable link a
  // debug export is built from, so this is also the "linked to a debug
  // file" check.
  try {
    const { d1ListJobs } = await import('./server_db_d1.js');
    const jobs = await d1ListJobs({ isFull: true, limit: 5000 });
    for (const job of jobs) {
      const key = extractR2KeyFromUrl(job.photo_url);
      if (key) referenced.add(key);
    }
  } catch (err) {
    console.warn('[r2-photo-audit] D1 jobs lookup failed:', err);
  }

  return referenced;
}

// GET - report mode only. Never deletes anything.
adminRouter.get('/api/admin/r2-photo-audit', async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;

    const client = getS3Client();
    if (!client) {
      return res.status(503).json({ success: false, error: 'R2 not configured on this server' });
    }

    const [allKeys, referenced] = await Promise.all([
      listAllR2PhotoKeys(),
      getReferencedPhotoKeys(),
    ]);

    const orphans = allKeys.filter(o => !referenced.has(o.key));
    const totalOrphanBytes = orphans.reduce((sum, o) => sum + (o.size || 0), 0);

    res.json({
      success: true,
      totalPhotos: allKeys.length,
      referencedCount: referenced.size,
      orphanCount: orphans.length,
      totalOrphanBytes,
      orphans: orphans
        .sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''))
        .map(o => ({ key: o.key, size: o.size, lastModified: o.lastModified, publicUrl: `${CLOUDFLARE_R2_PUBLIC_URL}/${o.key}` })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// POST - actually deletes. Re-verifies each key is still an orphan right
// before deleting (defends against a meal being created between the report
// and this call), and reports per-key success/failure.
adminRouter.post('/api/admin/r2-photo-delete', async (req, res) => {
  try {
    const adminEmail = await requireAdmin(req, res);
    if (!adminEmail) return;

    const keys: string[] = Array.isArray(req.body?.keys) ? req.body.keys : [];
    if (keys.length === 0) {
      return res.status(400).json({ success: false, error: 'No keys provided' });
    }
    // Safety: only ever allow deleting objects under photos/, never anything
    // else in the bucket, no matter what the caller sends.
    const safeKeys = keys.filter(k => typeof k === 'string' && k.startsWith('photos/'));

    const client = getS3Client();
    if (!client) {
      return res.status(503).json({ success: false, error: 'R2 not configured on this server' });
    }

    const referenced = await getReferencedPhotoKeys();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

    const results = await Promise.all(safeKeys.map(async (key) => {
      if (referenced.has(key)) {
        return { key, deleted: false, reason: 'no_longer_orphaned' };
      }
      try {
        await client.send(new DeleteObjectCommand({ Bucket: CLOUDFLARE_R2_BUCKET_NAME, Key: key }));
        return { key, deleted: true };
      } catch (err: any) {
        return { key, deleted: false, reason: err?.message || String(err) };
      }
    }));

    res.json({
      success: true,
      deletedCount: results.filter(r => r.deleted).length,
      skippedCount: results.filter(r => !r.deleted).length,
      results,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});
