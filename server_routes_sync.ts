import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { verifyFirebaseIdToken } from './server_auth.js';
import { uploadBase64ToR2 } from './server_routes_r2.js';
import { isD1Configured, d1Query } from './server_d1.js';
import {
  d1PullSync,
  d1UpsertFoods,
  d1DeleteFoods,
  d1UpsertBiomarkers,
  d1DeleteBiomarkers,
  d1GetProfile,
  d1UpsertProfile,
  d1GetFoodDetail
} from './server_db_d1.js';

export const syncRouter = Router();

const SYNC_DIR = path.join(process.cwd(), "data", "sync");
if (!fs.existsSync(SYNC_DIR)) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
}

function getAdmin() {
  try {
    return getAdminAuth();
  } catch (err) {
    return null;
  }
}

function sanitizeDeleteMap(m: any): Record<string, number> {
  if (!m || typeof m !== 'object') return {};
  const out: Record<string, number> = {};
  if (Array.isArray(m)) {
    for (const item of m) {
      if (typeof item === 'string') {
        const k = item.trim();
        if (k && k !== 'null' && k !== 'undefined') out[k] = Date.now();
      } else if (item && typeof item === 'object') {
        const k = String((item as any).id || (item as any).key || '').trim();
        const ts = Number((item as any).ts ?? (item as any).updated_at ?? (item as any).deleted_at) || Date.now();
        if (k && k !== 'null' && k !== 'undefined') out[k] = Math.max(out[k] || 0, ts);
      }
    }
  } else {
    for (const [k, v] of Object.entries(m)) {
      const cleanK = String(k ?? '').trim();
      if (!cleanK || cleanK === 'null' || cleanK === 'undefined') continue;
      if (/^\d+$/.test(cleanK) && typeof v === 'string') {
        const valK = v.trim();
        if (valK && valK !== 'null' && valK !== 'undefined') {
          out[valK] = Math.max(out[valK] || 0, Date.now());
        }
        continue;
      }
      const num = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(num) || num <= 0) continue;
      out[cleanK] = Math.max(out[cleanK] || 0, num);
    }
  }
  return out;
}

// Sync endpoints
syncRouter.post("/api/sync/save", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    const adminAuth = getAdmin();
    if (adminAuth) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const decodedToken = decoded;
        const userRecord = await adminAuth.getUser(decodedToken.uid);
        if (!userRecord.customClaims?.role || userRecord.customClaims.role !== 'authenticated') {
          await adminAuth.setCustomUserClaims(decodedToken.uid, { ...userRecord.customClaims, role: 'authenticated' });
        }
        if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden: email mismatch' });
        }
      } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
      }
    }
    const { email, data } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[Sync Save] Saved data for email: ${email}`);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[Sync Save] Error:", error);
    res.status(500).json({ error: "Failed to sync save data to server database" });
  }
});

syncRouter.post("/api/sync/load", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    const adminAuth = getAdmin();
    if (adminAuth) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden: email mismatch' });
        }
      } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
      }
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      console.log(`[Sync Load] Loaded data for email: ${email}`);
      return res.json({ success: true, data: JSON.parse(content) });
    }
    
    console.log(`[Sync Load] No existing cloud record for email: ${email}`);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error("[Sync Load] Error:", error);
    res.status(500).json({ error: "Failed to retrieve sync data from server database" });
  }
});

syncRouter.get("/api/debug/supabase-pull-check", async (req, res) => {
  try {
    const uid = String(req.query.uid || 'hiJun2hTdDTk2igwerun2LKvwb42');
    const email = String(req.query.email || 'cwah.liu@gmail.com');
    const possibleUids = Array.from(new Set([
      uid,
      email,
      'admin_' + email.toLowerCase().trim().replace(/[^a-z0-9]/gi, '_'),
      'hiJun2hTdDTk2igwerun2LKvwb42',
      'cwah.liu@gmail.com',
      'chiwah.liu@gmail.com',
      'admin_cwah_liu_gmail_com',
      'admin_chiwah_liu_gmail_com'
    ].filter(Boolean) as string[]));

    const inList = possibleUids.map(() => '?').join(',');
    const [foodRes, bioRes, profileRes] = await Promise.all([
      d1Query<any>(`SELECT id, firebase_uid, date, name, updated_at FROM food_logs WHERE firebase_uid IN (${inList}) LIMIT 5`, possibleUids),
      d1Query<any>(`SELECT id, firebase_uid, date, biomarkers, updated_at FROM biomarker_logs WHERE firebase_uid IN (${inList}) ORDER BY updated_at DESC LIMIT 50`, possibleUids),
      d1Query<any>(`SELECT firebase_uid, data, updated_at FROM profiles WHERE firebase_uid IN (${inList}) LIMIT 5`, possibleUids),
    ]);

    const [foodCountRes, bioCountRes] = await Promise.all([
      d1Query<any>(`SELECT COUNT(*) AS count FROM food_logs WHERE firebase_uid IN (${inList})`, possibleUids),
      d1Query<any>(`SELECT COUNT(*) AS count FROM biomarker_logs WHERE firebase_uid IN (${inList})`, possibleUids),
    ]);

    const parseProfileData = (raw: any) => {
      try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; }
    };

    res.json({
      queriedUid: uid,
      queriedEmail: email,
      possibleUids,
      food: {
        error: foodRes.error || null,
        sampleRows: foodRes.results || [],
        totalCount: Number(foodCountRes.results?.[0]?.count ?? 0),
        totalCountError: foodCountRes.error || null
      },
      biomarker: {
        error: bioRes.error || null,
        sampleRows: bioRes.results || [],
        totalCount: Number(bioCountRes.results?.[0]?.count ?? 0),
        totalCountError: bioCountRes.error || null
      },
      profile: {
        error: profileRes.error || null,
        sampleRows: (profileRes.results || []).map((row: any) => {
          const data = parseProfileData(row.data);
          return {
            firebase_uid: row.firebase_uid,
            updated_at: row.updated_at,
            deletedBiomarkerLogIds: data.profile?.deletedBiomarkerLogIds || data.deletedBiomarkerLogIds || {}
          };
        })
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error), stack: error.stack });
  }
});

// ONE-TIME CLEANUP TOOL — safe, conflict-aware duplicate merge for biomarker_logs.
// Dry run by default. Add ?apply=true to actually write changes.
// Never merges/deletes rows that disagree on any shared field.
syncRouter.get("/api/admin/dedupe-biomarkers", async (req, res) => {
  try {
    const uid = String(req.query.uid || '');
    const apply = String(req.query.apply || '') === 'true';
    if (!uid) {
      return res.status(400).json({ error: "uid query param is required" });
    }

    const { getMappedBiomarkerKey } = await import('./src/utils/biomarkers.js');

    const { data: rows, error: fetchErr } = await (async () => {
      const r = await d1Query<any>(
        `SELECT id, date, biomarkers, updated_at FROM biomarker_logs WHERE firebase_uid = ?`,
        [uid],
      );
      return { data: r.results || [], error: r.error || null };
    })();

    if (fetchErr) {
      return res.status(500).json({ error: fetchErr });
    }

    const byDate = new Map<string, any[]>();
    for (const row of rows || []) {
      const d = String(row.date || '');
      if (typeof row.biomarkers === 'string') {
        try { row.biomarkers = JSON.parse(row.biomarkers || '{}'); } catch { row.biomarkers = {}; }
      }
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(row);
    }

    type Cluster = { rows: any[]; merged: Record<string, any> };
    const report: any[] = [];
    const rowsToUpsert: { id: string; biomarkers: Record<string, any> }[] = [];
    const idsToDelete: string[] = [];

    for (const [date, group] of byDate.entries()) {
      if (group.length < 2) continue;

      const clusters: Cluster[] = [];

      for (const row of group) {
        const canon: Record<string, any> = {};
        Object.entries(row.biomarkers || {}).forEach(([k, v]) => {
          canon[getMappedBiomarkerKey(k)] = v;
        });

        let placed = false;
        for (const cluster of clusters) {
          let conflict = false;
          for (const [k, v] of Object.entries(canon)) {
            if (Object.prototype.hasOwnProperty.call(cluster.merged, k) && cluster.merged[k] !== v) {
              conflict = true;
              break;
            }
          }
          if (!conflict) {
            cluster.rows.push(row);
            cluster.merged = { ...cluster.merged, ...canon };
            placed = true;
            break;
          }
        }
        if (!placed) {
          clusters.push({ rows: [row], merged: canon });
        }
      }

      for (const cluster of clusters) {
        if (cluster.rows.length < 2) continue; // nothing to merge, leave as-is

        // Keep the row with the most original fields as the survivor id;
        // tie-break by earliest updated_at (oldest = likely original, not the duplicate).
        const survivor = [...cluster.rows].sort((a, b) => {
          const aLen = Object.keys(a.biomarkers || {}).length;
          const bLen = Object.keys(b.biomarkers || {}).length;
          if (bLen !== aLen) return bLen - aLen;
          return String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
        })[0];

        const toDelete = cluster.rows.filter(r => r.id !== survivor.id).map(r => r.id);

        report.push({
          date,
          survivorId: survivor.id,
          deletedIds: toDelete,
          mergedFieldCount: Object.keys(cluster.merged).length
        });

        rowsToUpsert.push({ id: survivor.id, biomarkers: cluster.merged });
        idsToDelete.push(...toDelete);
      }
    }

    if (!apply) {
      return res.json({
        dryRun: true,
        totalRowsScanned: (rows || []).length,
        duplicateClustersFound: report.length,
        wouldDeleteCount: idsToDelete.length,
        details: report
      });
    }

    // Apply: merge first, delete second — never the other way around.
    for (const u of rowsToUpsert) {
      const upRes = await d1Query(
        `UPDATE biomarker_logs SET biomarkers = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(u.biomarkers || {}), new Date().toISOString(), u.id],
      );
      if (!upRes.success) {
        return res.status(500).json({ error: `Failed merging into ${u.id}: ${upRes.error}`, partialReport: report });
      }
    }

    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => '?').join(',');
      const delRes = await d1Query(
        `DELETE FROM biomarker_logs WHERE id IN (${placeholders})`,
        idsToDelete,
      );
      if (!delRes.success) {
        return res.status(500).json({ error: `Merged rows written, but delete failed: ${delRes.error}`, partialReport: report });
      }
    }

    res.json({
      dryRun: false,
      totalRowsScanned: (rows || []).length,
      duplicateClustersFound: report.length,
      deletedCount: idsToDelete.length,
      details: report
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error), stack: error.stack });
  }
});

syncRouter.post("/api/sync/supabase-pull", async (req, res) => {
  try {
    const auth = await verifyFirebaseIdToken(req).catch(() => null);
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { uid, email, lastSyncTime, listOnly = true, pageSize = 15, offset, cursor } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "uid is required" });
    }
    
    console.log('[FreeTier] projected food pull');
    console.log('[FreeTier] keyset pagination');

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

    let rawFoods: any[] = [];
    let rawBiomarkers: any[] = [];
    let profiles: any[] = [];
    let totalFoodsCount: number | undefined;
    let totalBiomarkersCount: number | undefined;

    if (isD1Configured()) {
      const d1Res = await d1PullSync({ possibleUids, listOnly, pageSize, offset, cursor, lastSyncTime });
      rawFoods = d1Res.foods;
      rawBiomarkers = d1Res.biomarkers;
      profiles = d1Res.profiles;
      totalFoodsCount = d1Res.totalFoodsCount;
      totalBiomarkersCount = d1Res.totalBiomarkersCount;
    }

    // Deduplicate foods by ID (keeping newest updated_at)
    const foodMap = new Map<string, any>();
    rawFoods.forEach((f: any) => {
      if (!f || !f.id) return;
      const existing = foodMap.get(f.id);
      if (!existing) {
        foodMap.set(f.id, f);
      } else {
        const existingTs = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
        const fTs = f.updated_at ? new Date(f.updated_at).getTime() : 0;
        if (fTs > existingTs) {
          foodMap.set(f.id, f);
        }
      }
    });
    const foods = Array.from(foodMap.values());

    // Deduplicate biomarkers by ID and consolidate by Date (keeping newest updated_at)
    const bioMap = new Map<string, any>();
    rawBiomarkers.forEach((b: any) => {
      if (!b || !b.id) return;
      const existing = bioMap.get(b.id);
      if (!existing) {
        bioMap.set(b.id, b);
      } else {
        const existingTs = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
        const bTs = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        if (bTs > existingTs) {
          bioMap.set(b.id, b);
        }
      }
    });

    const bioByDate = new Map<string, any[]>();
    bioMap.forEach((b: any) => {
      const d = b.date ? String(b.date).trim() : 'unknown';
      if (!bioByDate.has(d)) bioByDate.set(d, []);
      bioByDate.get(d)!.push(b);
    });

    const biomarkers: any[] = [];
    const obsoleteDuplicateBioIds: string[] = [];

    bioByDate.forEach(group => {
      if (group.length === 1) {
        biomarkers.push(group[0]);
        return;
      }
      const sorted = [...group].sort((a, b) => {
        const aTs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTs = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTs - aTs;
      });
      const survivor = { ...sorted[0] };
      const topTs = survivor.updated_at ? new Date(survivor.updated_at).getTime() : 0;
      const secondTs = sorted[1]?.updated_at ? new Date(sorted[1].updated_at).getTime() : 0;

      if (topTs === secondTs) {
        const mergedBios: Record<string, any> = {};
        for (let i = sorted.length - 1; i >= 0; i--) {
          Object.assign(mergedBios, sorted[i].biomarkers || {});
        }
        survivor.biomarkers = mergedBios;
      } else {
        survivor.biomarkers = { ...(survivor.biomarkers || {}) };
      }
      biomarkers.push(survivor);

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]?.id && sorted[i].id !== survivor.id) {
          obsoleteDuplicateBioIds.push(sorted[i].id);
        }
      }
    });

    if (obsoleteDuplicateBioIds.length > 0) {
      if (isD1Configured()) {
        void d1DeleteBiomarkers(obsoleteDuplicateBioIds).then((r) => {
          if (!r.success) console.warn('[D1 Pull] Obsolete duplicate biomarker cleanup error:', r.error);
          else console.log(`[D1 Pull] Cleaned up ${obsoleteDuplicateBioIds.length} obsolete duplicate biomarker rows from DB`);
        }).catch((e: any) => console.warn('[D1 Pull] Obsolete duplicate biomarker cleanup exception:', e));
      }
    }

    let profileData: any = null;
    if (profiles.length > 0) {
      profiles.sort((a: any, b: any) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
      profileData = profiles[0]?.data || null;
    }

    const pullDelBioIds = sanitizeDeleteMap(profileData?.profile?.deletedBiomarkerLogIds || profileData?.deletedBiomarkerLogIds);
    const pullDelFoodIds = sanitizeDeleteMap(profileData?.profile?.deletedFoodLogIds || profileData?.deletedFoodLogIds);

    if (profileData?.profile) {
      profileData.profile.deletedBiomarkerLogIds = pullDelBioIds;
      profileData.profile.deletedFoodLogIds = pullDelFoodIds;
    } else if (profileData) {
      profileData.deletedBiomarkerLogIds = pullDelBioIds;
      profileData.deletedFoodLogIds = pullDelFoodIds;
    }

    const activeBiomarkers = biomarkers.filter((b: any) => {
      const tombstoneTs = pullDelBioIds[b.id];
      if (!tombstoneTs) return true;
      const bTs = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bTs > tombstoneTs;
    });

    const activeFoods = foods.filter((f: any) => {
      const tombstoneTs = pullDelFoodIds[f.id];
      if (!tombstoneTs) return true;
      const fTs = f.updated_at ? new Date(f.updated_at).getTime() : 0;
      return fTs > tombstoneTs;
    });

    console.log(`[D1 Pull] uid=${uid}, possibleUids=${possibleUids.join(',')}, foods=${activeFoods.length}/${foods.length}, biomarkers=${activeBiomarkers.length}/${biomarkers.length}, hasProfileData=${!!profileData}`);

    res.json({
      success: true,
      foods: activeFoods,
      biomarkers: activeBiomarkers,
      profileData,
      totalFoodsCount: totalFoodsCount !== undefined ? totalFoodsCount : undefined,
      totalBiomarkersCount: totalBiomarkersCount !== undefined ? totalBiomarkersCount : undefined,
      meta: {
        foodCount: activeFoods.length,
        totalFoodsCount: totalFoodsCount !== undefined ? totalFoodsCount : undefined,
        biomarkerCount: activeBiomarkers.length,
        totalBiomarkersCount: totalBiomarkersCount !== undefined ? totalBiomarkersCount : undefined,
        hasProfileData: !!profileData,
        queriedUids: possibleUids
      }
    });
  } catch (error: any) {
    console.error("[D1 Pull] Error:", error);
    res.status(500).json({ error: error.message || "Failed to pull from database" });
  }
});

// Lazy detail endpoint: fetch only the heavy blob columns for a single food log
syncRouter.post("/api/sync/food-log-detail", async (req, res) => {
  try {
    const auth = await verifyFirebaseIdToken(req).catch(() => null);
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { uid, email, logId } = req.body;
    if (!logId) {
      return res.status(400).json({ error: "logId is required" });
    }

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

    let data: any = null;
    if (isD1Configured()) {
      data = await d1GetFoodDetail(logId, possibleUids);
      if (!data) {
        return res.status(404).json({ error: 'Log not found or access denied' });
      }
    } else {
      return res.status(404).json({ error: 'Log not found (database not configured)' });
    }

    res.json({ success: true, detail: data });
  } catch (error: any) {
    console.error('[FoodLogDetail] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch food log detail' });
  }
});

function deepMergeFieldValue(existingVal: any, incomingVal: any): any {
  if (incomingVal === undefined) return existingVal;
  if (existingVal === undefined || existingVal === null) return incomingVal;

  if (Array.isArray(incomingVal)) {
    if (!Array.isArray(existingVal)) return incomingVal;
    const idOf = (item: any) => (item && typeof item === 'object')
      ? (item.id ?? item.key ?? item.category ?? item.title ?? item.name)
      : undefined;
    const allObjects = incomingVal.every((i: any) => i && typeof i === 'object')
      && existingVal.every((i: any) => i && typeof i === 'object');
    const allHaveIdentity = allObjects
      && [...incomingVal, ...existingVal].every((item: any) => idOf(item) !== undefined);
    if (allHaveIdentity) {
      const map = new Map<any, any>();
      existingVal.forEach((item: any) => map.set(idOf(item), item));
      incomingVal.forEach((item: any) => {
        const k = idOf(item);
        map.set(k, { ...(map.get(k) || {}), ...item });
      });
      return Array.from(map.values());
    }
    return incomingVal;
  }

  if (typeof incomingVal === 'object' && typeof existingVal === 'object' && !Array.isArray(existingVal)) {
    const merged: any = { ...existingVal };
    for (const k of Object.keys(incomingVal)) {
      merged[k] = deepMergeFieldValue(existingVal[k], incomingVal[k]);
    }
    return merged;
  }

  return incomingVal;
}

function deepMergeObjectShallow(existingObj: any, incomingObj: any, excludeKeys: string[]): any {
  const result: any = { ...(existingObj || {}) };
  const excludeSet = new Set(excludeKeys);
  Object.keys(incomingObj || {}).forEach((k) => {
    if (excludeSet.has(k)) return;
    result[k] = deepMergeFieldValue(existingObj ? existingObj[k] : undefined, incomingObj[k]);
  });
  return result;
}

function mergeActions(cloudActions = [], localActions = []) {
  const map = new Map();
  (localActions || []).forEach(act => {
    if (!act) return;
    const key = act.id || act.title || act.action || act.recommendation;
    if (key) {
      map.set(key, { ...act, id: act.id || key });
    }
  });
  (cloudActions || []).forEach(cloudAct => {
    if (!cloudAct) return;
    const key = cloudAct.id || cloudAct.title || cloudAct.action || cloudAct.recommendation;
    if (key) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...cloudAct, id: cloudAct.id || key });
      } else {
        const localTime = existing.updated_at || existing.createdAt || 0;
        const cloudTime = cloudAct.updated_at || cloudAct.createdAt || 0;
        const isCompleted = existing.completed || cloudAct.completed;
        if (localTime > cloudTime) {
          map.set(key, { ...cloudAct, ...existing, completed: isCompleted, id: existing.id || key });
        } else {
          map.set(key, { ...existing, ...cloudAct, completed: isCompleted, id: cloudAct.id || key });
        }
      }
    }
  });
  return Array.from(map.values());
}

function mergeBenefits(cloudBenefits = [], localBenefits = []) {
  const map = new Map();
  (localBenefits || []).forEach(ben => {
    if (!ben) return;
    const key = ben.id || ben.title || ben.benefit;
    if (key) {
      map.set(key, { ...ben, id: ben.id || key });
    }
  });
  (cloudBenefits || []).forEach(cloudBen => {
    if (!cloudBen) return;
    const key = cloudBen.id || cloudBen.title || cloudBen.benefit;
    if (key) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...cloudBen, id: cloudBen.id || key });
      } else {
        const localTime = existing.updated_at || 0;
        const cloudTime = cloudBen.updated_at || 0;
        const isCompleted = existing.completed || cloudBen.completed;
        if (localTime > cloudTime) {
          map.set(key, { ...cloudBen, ...existing, completed: isCompleted, id: existing.id || key });
        } else {
          map.set(key, { ...existing, ...cloudBen, completed: isCompleted, id: cloudBen.id || key });
        }
      }
    }
  });
  return Array.from(map.values());
}

syncRouter.post("/api/sync/supabase-push", async (req, res) => {
  try {
    const authData = await verifyFirebaseIdToken(req);
    console.log('[FreeTier] requireAuth supabase-push');
    const { uid, email, foods, biomarkers, profile, actions, dailyBenefits, report, forceOverwrite } = req.body;
    const isCwah = (authData.email && (authData.email.toLowerCase().includes('cwah.liu') || authData.email.toLowerCase().includes('chiwah.liu'))) || 
                   (authData.uid && (authData.uid.includes('cwah_liu') || authData.uid.includes('chiwah_liu') || authData.uid === 'hiJun2hTdDTk2igwerun2LKvwb42')) ||
                   (email && (String(email).toLowerCase().includes('cwah.liu') || String(email).toLowerCase().includes('chiwah.liu'))) ||
                   (uid && (String(uid).includes('cwah_liu') || String(uid).includes('chiwah_liu') || uid === 'hiJun2hTdDTk2igwerun2LKvwb42'));
    const canonicalUid = isCwah 
      ? 'hiJun2hTdDTk2igwerun2LKvwb42' 
      : (authData.uid || uid || email);

    let foodCount = 0;
    let bioCount = 0;
    const pushErrors: { table: string; op: string; message: string }[] = [];

    const normalizeToISOYMD = (dateStr: any): string => {
      if (!dateStr) return new Date().toISOString().split('T')[0];
      const trimmed = String(dateStr).trim();
      if (!trimmed) return new Date().toISOString().split('T')[0];

      const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (yyyymmddMatch) {
        const year = yyyymmddMatch[1];
        const month = yyyymmddMatch[2].padStart(2, '0');
        const day = yyyymmddMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
      if (ddmmyyyyMatch) {
        const day = ddmmyyyyMatch[1].padStart(2, '0');
        const month = ddmmyyyyMatch[2].padStart(2, '0');
        const year = ddmmyyyyMatch[3];
        return `${year}-${month}-${day}`;
      }

      try {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          return d.toISOString().split('T')[0];
        }
      } catch {}

      return new Date().toISOString().split('T')[0];
    };

    const mapFoodRow = (food: any, targetUid: string) => ({
      id: food.id,
      firebase_uid: targetUid,
      date: normalizeToISOYMD(food.date),
      name: food.name || '',
      composition: food.composition || '',
      weight_grams: food.weightGrams || 0,
      quantity: food.quantity || '',
      consumed_amount: food.consumedAmount ?? 1,
      benefits: food.benefits || '',
      risks: food.risks || '',
      health_impact: food.healthImpact || '',
      recommendation: food.recommendation || null,
      verdict: typeof food.verdict === 'object' && food.verdict !== null ? JSON.stringify(food.verdict) : (food.verdict || null),
      description: food.description || '',
      message: food.message || '',
      debug_url: food.debugUrl || '',
      chat_transcript: food.chatTranscript || [],
      calories: food.calories || food.nutrients?.calories || 0,
      saturated_fat: food.saturatedFat || food.nutrients?.saturatedFat || 0,
      sodium: food.sodium || food.nutrients?.sodium || 0,
      added_sugar: food.addedSugar || food.nutrients?.addedSugar || 0,
      nutrients: food.nutrients || {},
      items_breakdown: food.itemsBreakdown || [],
      scout_items: food.scoutItems || [],
      image_urls: food.imageUrls || (food.imageUrl ? [food.imageUrl] : []),
      source_meal_id: (food as any).sourceMealId || (food as any).source_meal_id || '',
      updated_at: food.updated_at ? new Date(food.updated_at).toISOString() : new Date().toISOString()
    });

    const mapBioRow = (bio: any, targetUid: string) => ({
      id: bio.id,
      firebase_uid: targetUid,
      date: normalizeToISOYMD(bio.date),
      biomarkers: bio.biomarkers || {},
      note: bio.note || '',
      summary: bio.summary || '',
      tests: bio.tests || [],
      updated_at: bio.updated_at ? new Date(bio.updated_at).toISOString() : new Date().toISOString()
    });

    const extractTombstoneIds = (mapOrArr: any): string[] => {
      if (!mapOrArr) return [];
      if (Array.isArray(mapOrArr)) {
        return mapOrArr.map((x: any) => String(x ?? '').trim()).filter((s: string) => s && s !== 'null' && s !== 'undefined' && !/^\d+$/.test(s));
      }
      if (typeof mapOrArr === 'object') {
        const ids: string[] = [];
        for (const [k, v] of Object.entries(mapOrArr)) {
          const cleanK = String(k ?? '').trim();
          if (/^\d+$/.test(cleanK)) {
            if (typeof v === 'string') ids.push(v.trim());
          } else {
            ids.push(cleanK);
          }
        }
        return ids.filter((s: string) => s && s !== 'null' && s !== 'undefined' && !/^\d+$/.test(s));
      }
      return [];
    };

    const foodsToDeleteIds = Array.from(new Set([
      ...(Array.isArray(foods) ? foods.filter((f: any) => f.sync_state === 'delete').map((f: any) => f.id) : []),
      ...extractTombstoneIds(profile?.deletedFoodLogIds),
      ...extractTombstoneIds(req.body?.deletedFoodLogIds)
    ].filter(id => id && typeof id === 'string' && !/^\d+$/.test(id) && id !== 'null' && id !== 'undefined')));

    if (Array.isArray(foods) && foods.length > 0) {
      const foodsToUpsert = foods
        .filter((f: any) => f.sync_state !== 'delete')
        .map((f: any) => mapFoodRow(f, canonicalUid));

      if (foodsToUpsert.length > 0) {
        for (const food of foodsToUpsert) {
          if (Array.isArray(food.image_urls) && food.image_urls.length > 0) {
            const updatedUrls = [];
            for (let i = 0; i < food.image_urls.length; i++) {
              const url = food.image_urls[i];
              if (url && typeof url === 'string' && url.startsWith('data:image/')) {
                console.log(`[R2 Auto-upload] Uploading push-sync base64 image for food log ${food.id} (index ${i}) to R2...`);
                try {
                  const uploadedUrl = await uploadBase64ToR2(food.id, url, i);
                  if (uploadedUrl && (uploadedUrl.startsWith('http') || uploadedUrl.startsWith('/photos/'))) {
                    updatedUrls.push(uploadedUrl);
                  } else {
                    updatedUrls.push(url);
                  }
                } catch (e: any) {
                  console.error(`[R2 Auto-upload] Failed for food log ${food.id}:`, e?.message || e);
                  updatedUrls.push(url);
                }
              } else {
                updatedUrls.push(url);
              }
            }
            food.image_urls = updatedUrls;
          }
        }

        if (isD1Configured()) {
          const d1Res = await d1UpsertFoods(foodsToUpsert);
          if (!d1Res.success) {
            console.error('[D1 Push] Food upsert error:', d1Res.error);
            pushErrors.push({ table: 'food_logs', op: 'upsert', message: d1Res.error || 'D1 food upsert failed' });
          } else {
            foodCount += foodsToUpsert.length;
            // Asynchronously enforce 10-meal debug log retention policy
            try {
              const { pruneUserDebugLogs } = await import('./src/server/debugLogRetention.js');
              void pruneUserDebugLogs(canonicalUid, { maxRetention: 10 }).catch((e: any) =>
                console.warn('[SyncPush] Debug log prune:', e?.message || e)
              );
            } catch {}
          }
        }
      }
    }

    if (foodsToDeleteIds.length > 0) {
      if (isD1Configured()) {
        const d1DelRes = await d1DeleteFoods(foodsToDeleteIds);
        if (!d1DelRes.success) {
          console.error('[D1 Push] Food delete error:', d1DelRes.error);
          pushErrors.push({ table: 'food_logs', op: 'delete', message: d1DelRes.error || 'D1 food delete failed' });
        }
      }
    }

    const biosToDeleteIds = Array.from(new Set([
      ...(Array.isArray(biomarkers) ? biomarkers.filter((b: any) => b.sync_state === 'delete').map((b: any) => b.id) : []),
      ...extractTombstoneIds(profile?.deletedBiomarkerLogIds),
      ...extractTombstoneIds(req.body?.deletedBiomarkerLogIds)
    ].filter(id => id && typeof id === 'string' && !/^\d+$/.test(id) && id !== 'null' && id !== 'undefined')));

    if (Array.isArray(biomarkers) && biomarkers.length > 0) {
      const biosToUpsert = biomarkers
        .filter((b: any) => b.sync_state !== 'delete')
        .map((b: any) => mapBioRow(b, canonicalUid));

      if (biosToUpsert.length > 0) {
        if (isD1Configured()) {
          const d1BioRes = await d1UpsertBiomarkers(biosToUpsert);
          if (!d1BioRes.success) {
            console.error('[D1 Push] Biomarker upsert error:', d1BioRes.error);
            pushErrors.push({ table: 'biomarker_logs', op: 'upsert', message: d1BioRes.error || 'D1 bio upsert failed' });
          } else {
            bioCount += biosToUpsert.length;
          }
        }
      }
    }

    if (biosToDeleteIds.length > 0) {
      if (isD1Configured()) {
        const d1BioDelRes = await d1DeleteBiomarkers(biosToDeleteIds);
        if (!d1BioDelRes.success) {
          console.error('[D1 Push] Biomarker delete error:', d1BioDelRes.error);
          pushErrors.push({ table: 'biomarker_logs', op: 'delete', message: d1BioDelRes.error || 'D1 bio delete failed' });
        }
      }
    }

    if (profile || (Array.isArray(actions) && actions.length > 0) || (Array.isArray(dailyBenefits) && dailyBenefits.length > 0) || report) {
      try {
        let existingData: any = {};
        if (isD1Configured()) {
          const profRow = await d1GetProfile(canonicalUid);
          existingData = profRow?.data || {};
        }

        const mergedDeletedCustomBiomarkerKeys: Record<string, number> = {
          ...(existingData.profile?.deletedCustomBiomarkerKeys || {})
        };
        for (const [dk, dv] of Object.entries(profile?.deletedCustomBiomarkerKeys || {})) {
          mergedDeletedCustomBiomarkerKeys[dk] = Math.max(
            mergedDeletedCustomBiomarkerKeys[dk] || 0,
            dv as number
          );
        }

        const existingCustomBiomarkers = existingData.profile?.customBiomarkers || {};
        const incomingCustomBiomarkers = profile?.customBiomarkers || {};
        const unionCustomBiomarkers: any = { ...existingCustomBiomarkers };
        for (const [k, def] of Object.entries(incomingCustomBiomarkers)) {
          const incomingTime = (def as any)?.updatedAt || 0;
          const existingTime = (existingCustomBiomarkers[k] as any)?.updatedAt || 0;
          const incomingWins = incomingTime > 0 || existingTime > 0
            ? incomingTime >= existingTime
            : true;
          unionCustomBiomarkers[k] = incomingWins
            ? { ...(unionCustomBiomarkers[k] || {}), ...(def as any) }
            : { ...(def as any), ...(unionCustomBiomarkers[k] || {}) };
        }
        Object.keys(mergedDeletedCustomBiomarkerKeys).forEach((dk) => {
          if (mergedDeletedCustomBiomarkerKeys[dk] > 0) {
            const incomingKeyDef = profile?.customBiomarkers?.[dk] as any;
            const incomingKeyTime = incomingKeyDef?.updatedAt || 0;
            const reAdd = !!incomingKeyDef && incomingKeyTime > (mergedDeletedCustomBiomarkerKeys[dk] || 0);
            if (reAdd) {
              delete mergedDeletedCustomBiomarkerKeys[dk];
            } else {
              delete unionCustomBiomarkers[dk];
            }
          }
        });

        const mergedDeletedNotUsedBiomarkerKeys: Record<string, number> = {
          ...(existingData.profile?.deletedNotUsedBiomarkerKeys || {})
        };
        for (const [dk, dv] of Object.entries(profile?.deletedNotUsedBiomarkerKeys || {})) {
          mergedDeletedNotUsedBiomarkerKeys[dk] = Math.max(
            mergedDeletedNotUsedBiomarkerKeys[dk] || 0,
            dv as number
          );
        }
        const existingNotUsed = existingData.profile?.notUsedBiomarkers || {};
        const incomingNotUsed = profile?.notUsedBiomarkers || {};
        const notUsedKeysServer = new Set([...Object.keys(existingNotUsed), ...Object.keys(incomingNotUsed)]);
        const unionNotUsedBiomarkers: Record<string, { flaggedAt: number }> = {};
        notUsedKeysServer.forEach((k) => {
          const flaggedAt = Math.max(existingNotUsed[k]?.flaggedAt || 0, incomingNotUsed[k]?.flaggedAt || 0);
          const tombstone = mergedDeletedNotUsedBiomarkerKeys[k] || 0;
          if (tombstone > 0 && tombstone >= flaggedAt) return;
          if (flaggedAt > 0) unionNotUsedBiomarkers[k] = { flaggedAt };
        });

        // B7.4: Pending store merges explicitly — union by id, dedup on
        // printedName + date + rawValue (same triple as the client push).
        // Approve splice wins over a concurrent re-add of the same id.
        const existingPending = Array.isArray(existingData.profile?.pendingObservations)
          ? existingData.profile.pendingObservations : [];
        const incomingPending = Array.isArray(profile?.pendingObservations) ? profile.pendingObservations : [];
        const unionPendingObservations: any[] = [...existingPending];
        for (const item of incomingPending) {
          const id = (item as any)?.id;
          if (id && unionPendingObservations.some((p: any) => p?.id === id)) continue;
          const dup = unionPendingObservations.some((p: any) =>
            String(p?.printedName || '').toLowerCase() === String((item as any)?.printedName || '').toLowerCase() &&
            String(p?.date || '') === String((item as any)?.date || '') &&
            String(p?.rawValue ?? '') === String((item as any)?.rawValue ?? ''));
          if (!dup) unionPendingObservations.push(item);
        }

        const mergedDeletedBiomarkerLogIds = {
          ...sanitizeDeleteMap(existingData.profile?.deletedBiomarkerLogIds),
          ...sanitizeDeleteMap(profile?.deletedBiomarkerLogIds)
        };
        const mergedDeletedFoodLogIds = {
          ...sanitizeDeleteMap(existingData.profile?.deletedFoodLogIds),
          ...sanitizeDeleteMap(profile?.deletedFoodLogIds)
        };

        const mergedProfile = profile
          ? {
              ...deepMergeObjectShallow(existingData.profile, profile, [
                'customBiomarkers', 'deletedCustomBiomarkerKeys', 'notUsedBiomarkers', 'deletedNotUsedBiomarkerKeys',
                'deletedFoodLogIds', 'deletedBiomarkerLogIds', 'targets', 'generalNutrientTargets', 'weeklyTargets',
                'weeklyNutrientTargets', 'topWeeklyNutrientTargets', 'customGroupings', 'groupingDescriptions', 'categoryDescriptions',
                'pendingObservations'
              ]),
              customBiomarkers: unionCustomBiomarkers,
              pendingObservations: unionPendingObservations,
              deletedCustomBiomarkerKeys: mergedDeletedCustomBiomarkerKeys,
              notUsedBiomarkers: unionNotUsedBiomarkers,
              deletedNotUsedBiomarkerKeys: mergedDeletedNotUsedBiomarkerKeys,
              deletedFoodLogIds: mergedDeletedFoodLogIds,
              deletedBiomarkerLogIds: mergedDeletedBiomarkerLogIds,
              targets: {
                ...(existingData.profile?.targets || {}),
                ...(profile.targets || {})
              },
              generalNutrientTargets: {
                ...(existingData.profile?.generalNutrientTargets || {}),
                ...(profile.generalNutrientTargets || {})
              },
              weeklyTargets: {
                ...(existingData.profile?.weeklyTargets || {}),
                ...(profile.weeklyTargets || {})
              },
              weeklyNutrientTargets: {
                ...(existingData.profile?.weeklyNutrientTargets || {}),
                ...(profile.weeklyNutrientTargets || {})
              },
              topWeeklyNutrientTargets: {
                ...(existingData.profile?.topWeeklyNutrientTargets || {}),
                ...(profile.topWeeklyNutrientTargets || {})
              },
              customGroupings: {
                ...(existingData.profile?.customGroupings || {}),
                ...(profile.customGroupings || {})
              },
              groupingDescriptions: {
                ...(existingData.profile?.groupingDescriptions || {}),
                ...(profile.groupingDescriptions || {})
              },
              categoryDescriptions: {
                ...(existingData.profile?.categoryDescriptions || {}),
                ...(profile.categoryDescriptions || {})
              }
            }
          : existingData.profile;

        const existingReportForMerge = existingData.report || {};
        const healthBaselineCategoryMap = new Map<string, any>();
        [...(existingReportForMerge.healthBaselineCategories || []), ...((existingReportForMerge as any).biomarkerCategories || [])].forEach((c: any) => {
          const key = c?.category || c?.title || c?.name;
          if (key) healthBaselineCategoryMap.set(key, { ...c });
        });
        [...((report as any)?.healthBaselineCategories || []), ...((report as any)?.biomarkerCategories || [])].forEach((c: any) => {
          const key = c?.category || c?.title || c?.name;
          if (key) {
            const existing = healthBaselineCategoryMap.get(key);
            healthBaselineCategoryMap.set(key, { ...(existing || {}), ...c });
          }
        });
        const mergedHealthBaselineCategories = Array.from(healthBaselineCategoryMap.values());

        const mergedReport = report ? {
          ...deepMergeObjectShallow(existingData.report, report, [
            'dailyNutrientTargets', 'weeklyNutrientTargets', 'topWeeklyNutrientTargets', 'generalNutrientTargets', 'healthBaselineCategories'
          ]),
          dailyNutrientTargets: {
            ...(existingData.report?.dailyNutrientTargets || {}),
            ...(report.dailyNutrientTargets || {})
          },
          weeklyNutrientTargets: {
            ...(existingData.report?.weeklyNutrientTargets || {}),
            ...(report.weeklyNutrientTargets || {})
          },
          topWeeklyNutrientTargets: {
            ...(existingData.report?.topWeeklyNutrientTargets || {}),
            ...(report.topWeeklyNutrientTargets || {})
          },
          generalNutrientTargets: {
            ...(existingData.report?.generalNutrientTargets || {}),
            ...(report.generalNutrientTargets || {})
          },
          healthBaselineCategories: mergedHealthBaselineCategories.length > 0
            ? mergedHealthBaselineCategories
            : (report.healthBaselineCategories || existingData.report?.healthBaselineCategories || [])
        } : (existingData.report || null);

        const finalProfile = forceOverwrite && profile ? profile : mergedProfile;
        const finalReport = forceOverwrite && report ? report : mergedReport;

        if (isCwah && finalProfile) {
          finalProfile.email = 'cwah.liu@gmail.com';
          if (!finalProfile.nickname || finalProfile.nickname.toLowerCase().includes('john doe')) {
            finalProfile.nickname = 'C. Liu';
          }
          finalProfile.userType = 'Admin';
        }

        const mergedData = {
          ...existingData,
          profile: finalProfile,
          actions: forceOverwrite && Array.isArray(actions) ? actions : mergeActions(existingData.actions || [], Array.isArray(actions) ? actions : []),
          dailyBenefits: forceOverwrite && Array.isArray(dailyBenefits) ? dailyBenefits : mergeBenefits(existingData.dailyBenefits || [], Array.isArray(dailyBenefits) ? dailyBenefits : []),
          report: finalReport
        };

        if (isD1Configured()) {
          const profRes = await d1UpsertProfile(canonicalUid, mergedData);
          if (!profRes.success) {
            console.error('[D1 Push] Profile upsert error:', profRes.error);
            pushErrors.push({ table: 'profiles', op: 'upsert', message: profRes.error || 'D1 profile upsert failed' });
          } else {
            console.log(`[D1 Push] Successfully upserted profile data for ${canonicalUid}`);
          }
        }
      } catch (e: any) {
        console.error('[D1 Push] Exception upserting profile:', e.message);
      }
    }

    console.log(`[D1 Push] Uploaded ${foodCount} foods, ${bioCount} biomarkers for canonicalUid=${canonicalUid}`);

    res.json({ success: pushErrors.length === 0, foodCount, bioCount, canonicalUid, errors: pushErrors });
  } catch (error: any) {
    console.error("[D1 Push] Error:", error);
    res.status(500).json({ error: error.message || "Failed to push to database" });
  }
});
