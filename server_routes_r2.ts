import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export const r2Router = Router();

// Load firebaseConfig for client migrations
let firebaseConfig: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  }
} catch (e) {}

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
export const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
export const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev').replace(/\/$/, '');
const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

const s3Endpoint = `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
let s3Client: any = null;
export function getS3Client() {
  if (!s3Client && CLOUDFLARE_R2_ACCESS_KEY_ID && CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export async function uploadBase64ToR2(id: string, base64Data: string, _index: number = 0): Promise<string> {
  const client = getS3Client();

  // D-9: empty/invalid input yields no key at all. Callers treat '' as skip
  // (falsy) and keep their previous value — never mint a job-keyed phantom URL.
  if (!base64Data || typeof base64Data !== 'string') {
    return '';
  }

  // If already a valid URL or photo path, return without re-uploading
  if (base64Data.startsWith('http://') || base64Data.startsWith('https://') || base64Data.startsWith('/photos/')) {
    return base64Data;
  }

  let body: Buffer;
  let contentType = 'image/jpeg';

  try {
    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        body = Buffer.from(match[2], 'base64');
      } else {
        body = Buffer.from(base64Data);
      }
    } else {
      body = Buffer.from(base64Data, 'base64');
    }
  } catch (err) {
    console.error('[R2 uploadBase64ToR2] Failed decoding image buffer:', err);
    return '';
  }

  // SHA-256 Content-Addressable Storage (CAS) to guarantee zero duplicate image storage (Track D / D-9)
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const casKey = `photos/sha256_${hash}.jpg`;
  const casPublicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${casKey}`;
  const casProxyUrl = `/photos/sha256_${hash}.jpg`;

  if (!client) {
    // D-9: client unconfigured — return the CAS proxy URL (computable without
    // a PUT) instead of a job-keyed phantom. Next configured boot head-checks it.
    console.warn('[R2 uploadBase64ToR2] S3 Client not configured, returning casProxyUrl');
    return casProxyUrl;
  }

  try {
    // Check if identical photo already exists in R2 bucket
    try {
      const headCmd = new HeadObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: casKey,
      });
      await client.send(headCmd);
      // Already present in R2: reuse existing CAS object without re-uploading
      console.log(`[R2 CAS] deduplicated=true key=${casKey} bytes=${body.length}`);
      return casPublicUrl;
    } catch (headErr: any) {
      // Object not found yet in R2, proceed with write
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: casKey,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);
    console.log(`[R2 CAS] deduplicated=false key=${casKey} bytes=${body.length}`);
    return casPublicUrl;
  } catch (err) {
    console.error('[R2 uploadBase64ToR2] Failed uploading to R2:', err);
    return casProxyUrl;
  }
}

export async function uploadPhotosToR2Direct(jobId: string, images: (string | any)[]): Promise<string[]> {
  if (!images || !Array.isArray(images) || images.length === 0) return [];
  return Promise.all(
    images.map(async (img, idx) => {
      if (typeof img === 'string' && img.startsWith('data:image/')) {
        return uploadBase64ToR2(jobId, img, idx);
      }
      return typeof img === 'string' ? img : '';
    })
  );
}

export async function uploadDebugPayloadToR2Direct(jobId: string, payload: any, userId?: string): Promise<string> {
  const { stripHeavyImages, coldDebugR2Key, COLD_DEBUG_LOG } = await import('./src/utils/debugPayload.js');
  const key = coldDebugR2Key(String(jobId || 'unknown'), userId || payload?.userId || 'anonymous');
  const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${key}`;
  const client = getS3Client();
  if (!client) {
    return publicUrl;
  }
  try {
    const stripped = stripHeavyImages(payload || {});
    const body = Buffer.from(JSON.stringify(stripped, null, 2));
    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    console.log(`${COLD_DEBUG_LOG} direct ok key=${key} bytes=${body.length}`);
    return publicUrl;
  } catch (err) {
    console.error('Failed to upload direct debug to R2:', err);
    return publicUrl;
  }
}

export async function uploadLogsToR2Direct(jobId: string, logsText: string): Promise<string> {
  const safeId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const objectKey = `logs/${safeId}.txt`;
  const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${objectKey}`;
  const client = getS3Client();
  if (!client) {
    return publicUrl;
  }
  try {
    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
      Body: Buffer.from(logsText || '', 'utf-8'),
      ContentType: 'text/plain; charset=utf-8',
    });
    await client.send(command);
    return publicUrl;
  } catch (err) {
    console.error('[R2 uploadLogsToR2Direct] Failed uploading logs to R2:', err);
    return publicUrl;
  }
}

export async function fetchLogsFromR2Direct(jobId: string): Promise<string | null> {
  const client = getS3Client();
  if (!client) return null;
  const safeId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const key = `logs/${safeId}.txt`;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const cmd = new GetObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
    });
    const res = await client.send(cmd);
    if (res.Body) {
      return await (res.Body as any).transformToString();
    }
  } catch (err: any) {}
  return null;
}

export async function fetchDebugPayloadFromR2Direct(jobId: string, userId?: string): Promise<any> {
  const client = getS3Client();
  if (!client) return null;
  const safeId = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const { coldDebugR2Key } = await import('./src/utils/debugPayload.js');
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  // The cold debug object is stored under the submitting user's id. When the
  // caller omits userId (or passes a different one) the exact key misses and the
  // export silently falls back to the thin DB row — which is how the multi-turn
  // debugmeal1 export lost its photos, edit turn, and dispatches. Try the exact
  // key first, then the anonymous key.
  const candidates: string[] = [];
  if (userId) candidates.push(coldDebugR2Key(safeId, userId));
  candidates.push(coldDebugR2Key(safeId, 'anonymous'));

  for (const key of candidates) {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: CLOUDFLARE_R2_BUCKET_NAME, Key: key }));
      if (res.Body) {
        const str = await (res.Body as any).transformToString();
        return JSON.parse(str);
      }
    } catch {
      // NotFound / AccessDenied on a guessed key is expected — try the next.
    }
  }

  // Legacy fallback: cold debug is namespaced by user id, which a reader that
  // only holds the jobId cannot know. List `debug/` and pick the object whose
  // basename is `<safeId>.json`.
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Prefix: 'debug/',
      MaxKeys: 1000,
    }));
    const match = (listed.Contents || []).find((o: any) => String(o.Key || '').endsWith(`/${safeId}.json`));
    if (match?.Key) {
      const res = await client.send(new GetObjectCommand({ Bucket: CLOUDFLARE_R2_BUCKET_NAME, Key: match.Key }));
      if (res.Body) {
        const str = await (res.Body as any).transformToString();
        return JSON.parse(str);
      }
    }
  } catch {
    // Bucket may forbid list; the exact-key attempts above remain the primary path.
  }
  return null;
}

/** Stream meal photo from R2 (works when bucket is private). B11d. */
export async function streamR2Photo(res: any, rawKey: string) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = getS3Client();
  if (!client) {
    res.status(404).send('R2 client not configured');
    return;
  }
  let filename = String(rawKey || '')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .slice(0, 200);
  if (!filename) {
    res.status(400).send('key required');
    return;
  }
  if (!filename.includes('.')) filename = `${filename}.jpg`;
  const key = filename.startsWith('photos/') ? filename : `photos/${filename}`;

  const tryKeys = [key];
  // legacy without extension
  if (key.endsWith('.jpg')) tryKeys.push(key.replace(/\.jpg$/i, ''));

  let lastErr: any = null;
  for (const k of tryKeys) {
    try {
      const command = new GetObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: k,
      });
      const s3Res = await client.send(command);
      if (s3Res.ContentType) res.setHeader('Content-Type', s3Res.ContentType);
      else res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Photo-Key', k);
      const stream = s3Res.Body as any;
      if (stream && typeof stream.pipe === 'function') {
        stream.pipe(res);
        return;
      }
      if (stream && typeof stream.transformToByteArray === 'function') {
        const bytes = await stream.transformToByteArray();
        res.send(Buffer.from(bytes));
        return;
      }
    } catch (err: any) {
      lastErr = err;
    }
  }
  res.status(404).send(lastErr?.message || 'Photo not found');
}

r2Router.get(['/debug/:key(*)', '/api/r2/debug/:key(*)'], async (req, res) => {
  try {
    const rawKey = req.params.key || req.path.replace(/^\/(api\/r2\/)?debug\//, '');
    const cleanKey = rawKey.startsWith('debug/') ? rawKey : `debug/${rawKey}`;
    const jobIdMatch = cleanKey.match(/([a-zA-Z0-9_\-]+)\.json$/);
    const jobId = jobIdMatch ? jobIdMatch[1] : cleanKey;

    return res.redirect(`/api/jobs/debug?jobId=${encodeURIComponent(jobId)}&format=markdown`);
  } catch (err: any) {
    console.error('[API] /debug proxy error:', err);
    res.status(500).json({ error: 'Failed to retrieve debug file' });
  }
});

r2Router.post(['/api/r2/upload-photo', '/api/upload'], async (req, res) => {
  try {
    const jobId = req.body.jobId || req.body.filename?.replace(/\.jpg$/i, '') || req.body.id || `photo_${Date.now()}`;
    const payload = req.body.payload || req.body.data || req.body.photoData;
    if (!payload || typeof payload !== 'string') {
      return res.status(400).json({ error: 'Missing image payload' });
    }

    let body: Buffer;
    let contentType = 'image/jpeg';

    try {
      if (payload.startsWith('data:')) {
        const match = payload.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          contentType = match[1];
          body = Buffer.from(match[2], 'base64');
        } else {
          body = Buffer.from(payload);
        }
      } else {
        body = Buffer.from(payload);
      }
    } catch (decodeErr) {
      return res.status(400).json({ error: 'Undecodable image payload' });
    }

    // SHA-256 Content-Addressable Storage (CAS) to guarantee zero duplicate image storage
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const casKey = `photos/sha256_${hash}.jpg`;
    const casProxyUrl = `/photos/sha256_${hash}.jpg`;
    const casPublicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${casKey}`;

    // D-9: decode+hash happen before the client check so the no-client path
    // returns the CAS URL, never a job-keyed phantom key.
    const client = getS3Client();
    if (!client) {
      return res.json({ url: casProxyUrl, proxyUrl: casProxyUrl, publicUrl: casPublicUrl, key: casKey, deduplicated: false, clientUnconfigured: true });
    }

    // Check if identical photo already exists in R2 bucket
    try {
      const headCmd = new HeadObjectCommand({
        Bucket: CLOUDFLARE_R2_BUCKET_NAME,
        Key: casKey,
      });
      await client.send(headCmd);
      // Already present in R2! Skip re-upload and return existing deduplicated URL
      console.log(`[R2 CAS] deduplicated=true key=${casKey} bytes=${body.length}`);
      return res.json({
        url: casProxyUrl,
        proxyUrl: casProxyUrl,
        publicUrl: casPublicUrl,
        key: casKey,
        deduplicated: true
      });
    } catch (headErr: any) {
      // Object not found in R2 yet, proceed with write
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: casKey,
      Body: body,
      ContentType: contentType,
    });
    await client.send(command);
    console.log(`[R2 CAS] deduplicated=false key=${casKey} bytes=${body.length}`);

    res.json({
      url: casProxyUrl,
      proxyUrl: casProxyUrl,
      publicUrl: casPublicUrl,
      key: casKey,
      deduplicated: false
    });
  } catch (err) {
    console.error('Failed to upload photo to R2:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

r2Router.post('/api/r2/migrate-firestore-images', async (req, res) => {
  try {
    console.log('[Firestore API Migrate] Fetching food logs from Supabase to match existing images...');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');
    const { data: foodLogs, error: supabaseErr } = await supabaseAdmin
      .from('food_logs')
      .select('id, image_urls, firebase_uid');

    if (supabaseErr) {
      console.error('[Firestore API Migrate] Error: Failed to fetch food logs from Supabase:', supabaseErr.message);
      return res.status(500).json({ error: 'Failed to fetch food logs from Supabase', details: supabaseErr.message });
    }

    if (!foodLogs || foodLogs.length === 0) {
      return res.json({ success: true, message: 'No food logs found in Supabase.', stats: { inspected: 0, skipped: 0, matched: 0, migrated: 0, updated: 0 } });
    }

    const { initializeApp: initializeClientApp } = await import('firebase/app');
    const { initializeFirestore: initializeClientFirestore, doc: clientDoc, getDoc: clientGetDoc, updateDoc: clientUpdateDoc } = await import('firebase/firestore');

    const clientApp = initializeClientApp(firebaseConfig);
    const clientDb = firebaseConfig?.firestoreDatabaseId
      ? initializeClientFirestore(clientApp, {}, firebaseConfig.firestoreDatabaseId)
      : initializeClientFirestore(clientApp, {});

    let migratedCount = 0;
    let matchedCount = 0;
    let docsUpdatedCount = 0;
    let skippedCount = 0;

    for (const log of foodLogs) {
      const docId = log.id;
      const userId = log.firebase_uid;

      if (!userId) {
        skippedCount++;
        continue;
      }

      const docRef = clientDoc(clientDb, 'users', userId, 'foodImages', docId);
      let docSnapShot;
      try {
        docSnapShot = await clientGetDoc(docRef);
      } catch (docErr: any) {
        console.warn(`[Firestore API Migrate] Failed to fetch doc users/${userId}/foodImages/${docId}:`, docErr.message || docErr);
        continue;
      }

      if (!docSnapShot.exists()) {
        skippedCount++;
        continue;
      }

      const data = docSnapShot.data();
      matchedCount++;

      let hasNewR2Urls = false;
      const newUrls: string[] = [];

      if (data.imageUrl && data.imageUrl.startsWith('data:')) {
        try {
          const r2Url = await uploadBase64ToR2(docId, data.imageUrl, 0);
          newUrls.push(r2Url);
          hasNewR2Urls = true;
        } catch (uploadErr) {
          console.error(`[Firestore API Migrate] Failed to upload main image for doc ${docId}:`, uploadErr);
        }
      }

      if (Array.isArray(data.imageUrls)) {
        for (let i = 0; i < data.imageUrls.length; i++) {
          const url = data.imageUrls[i];
          if (url && url.startsWith('data:')) {
            try {
              const r2Url = await uploadBase64ToR2(docId, url, i);
              if (!newUrls.includes(r2Url)) newUrls.push(r2Url);
              hasNewR2Urls = true;
            } catch (uploadErr) {
              console.error(`[Firestore API Migrate] Failed to upload multi-image ${i} for doc ${docId}:`, uploadErr);
            }
          }
        }
      }

      if (hasNewR2Urls && newUrls.length > 0) {
        const mergedUrls = Array.from(new Set([...(log.image_urls || []), ...newUrls]));
        const { error: updateSbErr } = await supabaseAdmin
          .from('food_logs')
          .update({ image_urls: mergedUrls })
          .eq('id', docId);

        if (updateSbErr) {
          console.error(`[Firestore API Migrate] Failed to update Supabase food_logs for doc ${docId}:`, updateSbErr.message);
        } else {
          migratedCount++;
        }

        try {
          await clientUpdateDoc(docRef, {
            migratedToR2: true,
            imageUrl: newUrls[0] || data.imageUrl,
            imageUrls: newUrls.length > 0 ? newUrls : data.imageUrls,
            migratedAt: new Date().toISOString()
          });
          docsUpdatedCount++;
        } catch (updateDocErr: any) {
          console.warn(`[Firestore API Migrate] Warning: failed to mark migratedToR2 on doc users/${userId}/foodImages/${docId}:`, updateDocErr.message || updateDocErr);
        }
      }
    }

    console.log(`[Firestore API Migrate] Migration completed. Matched: ${matchedCount}, Migrated: ${migratedCount}, Docs Updated: ${docsUpdatedCount}, Skipped: ${skippedCount}`);
    res.json({
      success: true,
      stats: {
        inspected: foodLogs.length,
        skipped: skippedCount,
        matched: matchedCount,
        migrated: migratedCount,
        docsUpdated: docsUpdatedCount
      }
    });
  } catch (err: any) {
    console.error('Failed to run Firestore migration via API:', err);
    res.status(500).json({ error: 'Firestore migration failed', details: err?.message || String(err) });
  }
});

r2Router.post('/api/r2/upload-logs', async (req, res) => {
  try {
    const { jobId, logsText, key, data } = req.body || {};
    const finalJobId = jobId || key;
    const finalLogs = logsText !== undefined ? logsText : (typeof data === 'string' ? data : JSON.stringify(data));
    if (!finalJobId || finalLogs === undefined) {
      return res.status(400).json({ error: 'jobId and logsText are required' });
    }
    const url = await uploadLogsToR2Direct(String(finalJobId), String(finalLogs));
    return res.json({ success: true, url });
  } catch (err: any) {
    console.error('[API] /api/r2/upload-logs failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to upload logs' });
  }
});

r2Router.post('/api/r2/migrate-backend-logs', async (req, res) => {
  try {
    console.log('[MigrateLogs] Starting migration of backend logs from Supabase & Firestore to R2...');
    const { supabaseAdmin } = await import('./supabaseAdmin.js');

    let supabaseInspected = 0;
    let supabaseMigrated = 0;
    let totalBytesSaved = 0;

    const { data: jobs, error: sbErr } = await supabaseAdmin
      .from('agent_jobs')
      .select('id, clean_result, status_message');

    if (sbErr) {
      console.error('[MigrateLogs] Supabase query failed:', sbErr.message);
    } else if (jobs && jobs.length > 0) {
      supabaseInspected = jobs.length;
      for (const job of jobs) {
        let cleanRes = job.clean_result;
        if (!cleanRes || typeof cleanRes !== 'object') continue;

        const rawLogs = cleanRes.backendLogs || cleanRes.agentResult?.backendLogs || '';
        if (!rawLogs || typeof rawLogs !== 'string' || rawLogs.startsWith('[Logs stored in R2') || rawLogs.startsWith('http')) {
          continue;
        }

        const logLength = rawLogs.length;
        if (logLength < 10) continue;

        const logsUrl = await uploadLogsToR2Direct(job.id, rawLogs);
        if (!logsUrl) {
          console.warn(`[MigrateLogs] Failed to upload logs to R2 for job ${job.id}`);
          continue;
        }

        const updatedCleanRes = { ...cleanRes };
        updatedCleanRes.backendLogsUrl = logsUrl;
        updatedCleanRes.backendLogs = `[Logs stored in R2: ${logsUrl}]`;
        if (updatedCleanRes.agentResult) {
          updatedCleanRes.agentResult = {
            ...updatedCleanRes.agentResult,
            backendLogsUrl: logsUrl,
            backendLogs: `[Logs stored in R2: ${logsUrl}]`,
          };
        }

        const { error: updateErr } = await supabaseAdmin
          .from('agent_jobs')
          .update({ clean_result: updatedCleanRes })
          .eq('id', job.id);

        if (!updateErr) {
          supabaseMigrated++;
          totalBytesSaved += logLength;
        } else {
          console.error(`[MigrateLogs] Failed updating job ${job.id} in Supabase:`, updateErr.message);
        }
      }
    }

    let firestoreInspected = 0;
    let firestoreMigrated = 0;
    try {
      const { initializeApp: initializeClientApp } = await import('firebase/app');
      const { initializeFirestore: initializeClientFirestore, collectionGroup, getDocs, updateDoc } = await import('firebase/firestore');

      if (firebaseConfig && firebaseConfig.apiKey) {
        const clientApp = initializeClientApp(firebaseConfig);
        const clientDb = firebaseConfig.firestoreDatabaseId
          ? initializeClientFirestore(clientApp, {}, firebaseConfig.firestoreDatabaseId)
          : initializeClientFirestore(clientApp, {});

        const snapshot = await getDocs(collectionGroup(clientDb, 'agentAnalyses'));
        firestoreInspected = snapshot.size;

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          const rawLogs = data.backendLogs || data.globalLiveLogs || data.agentResult?.backendLogs || '';
          if (!rawLogs || typeof rawLogs !== 'string' || rawLogs.startsWith('[Logs stored in R2') || rawLogs.startsWith('http')) {
            continue;
          }

          const logsUrl = await uploadLogsToR2Direct(docSnap.id, rawLogs);
          if (logsUrl) {
            await updateDoc(docSnap.ref, {
              backendLogsUrl: logsUrl,
              backendLogs: `[Logs stored in R2: ${logsUrl}]`,
              globalLiveLogs: `[Logs stored in R2: ${logsUrl}]`
            });
            firestoreMigrated++;
            totalBytesSaved += rawLogs.length;
          }
        }
      }
    } catch (fsErr: any) {
      console.warn('[MigrateLogs] Firestore log migration skipped/failed:', fsErr.message || fsErr);
    }

    return res.json({
      success: true,
      message: 'Backend logs migration completed',
      stats: {
        supabaseInspected,
        supabaseMigrated,
        firestoreInspected,
        firestoreMigrated,
        totalBytesSavedKB: Math.round(totalBytesSaved / 1024)
      }
    });
  } catch (err: any) {
    console.error('[MigrateLogs] Migration endpoint failed:', err);
    return res.status(500).json({ error: 'Migration failed', details: err?.message || String(err) });
  }
});

r2Router.get(['/photos/:key', '/api/r2/photos/:key'], async (req, res) => {
  try {
    await streamR2Photo(res, req.params.key);
  } catch (err: any) {
    res.status(404).send('Photo not found');
  }
});

r2Router.get('/api/r2/photo-url', async (req, res) => {
  try {
    let key = String(req.query.key || '').replace(/^\/+/, '');
    const rawUrl = String(req.query.url || '');
    if (!key && rawUrl) {
      const m = rawUrl.match(/\/photos\/([^?#]+)/i);
      if (m) key = m[1];
    }
    if (!key) return res.status(400).json({ error: 'key or url required' });
    if (!key.includes('.')) key = `${key}.jpg`;
    key = key.replace(/\.\./g, '').slice(0, 200);

    const proxyUrl = `/photos/${key}`;
    const objectKey = key.startsWith('photos/') ? key : `photos/${key}`;
    const wantSigned = String(req.query.signed || '') === '1' || String(req.query.signed || '') === 'true';

    let signedUrl: string | null = null;
    if (wantSigned) {
      const client = getS3Client();
      if (client) {
        try {
          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
          const cmd = new GetObjectCommand({
            Bucket: CLOUDFLARE_R2_BUCKET_NAME,
            Key: objectKey,
          });
          signedUrl = await getSignedUrl(client as any, cmd, { expiresIn: 3600 });
        } catch (e: any) {
          console.warn('[B11d] signed URL failed, using proxy:', e?.message || e);
        }
      }
    }

    res.json({
      key: objectKey,
      proxyUrl,
      url: signedUrl || proxyUrl,
      signed: !!signedUrl,
      expiresIn: signedUrl ? 3600 : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'photo-url failed' });
  }
});

r2Router.get('/api/r2/log-proxy', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    const jobId = String(req.query.jobId || '');
    const { fetchLogsFromR2 } = await import('./src/utils/r2Storage.js');

    let targetJobId = jobId;
    if (!targetJobId && rawUrl) {
      const match = rawUrl.match(/\/logs\/([^/?#]+)\.log/i) || rawUrl.match(/job_\d+_[a-z0-9]+/i);
      if (match) {
        targetJobId = match[1] || match[0];
      }
    }

    if (targetJobId) {
      try {
        const logs = await fetchLogsFromR2(targetJobId);
        if (logs) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.send(logs);
        }
      } catch (r2Err) {
        console.warn('[API] R2 fetch error in proxy, trying memory fallback:', r2Err);
      }
      const { getInMemoryServerJob } = await import('./serverJobs.js');
      const memJob = getInMemoryServerJob(targetJobId);
      if (memJob) {
        const memLogs = (Array.isArray(memJob.accumulatedLogs) && memJob.accumulatedLogs.length > 0)
          ? memJob.accumulatedLogs.join('\n')
          : (Array.isArray(memJob.turn1Logs) && memJob.turn1Logs.length > 0 ? memJob.turn1Logs.join('\n') : (memJob.clean_result?.backendLogs || ''));
        if (memLogs) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.send(memLogs);
        }
      }
    }

    if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
      const r2Res = await fetch(rawUrl);
      if (r2Res.ok) {
        const text = await r2Res.text();
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(text);
      }
    }

    return res.status(404).send('Log file not found');
  } catch (err: any) {
    console.error('[API] /api/r2/log-proxy error:', err);
    return res.status(500).send(err?.message || 'Failed to fetch R2 log');
  }
});

r2Router.post(['/api/r2/upload-debug', '/api/debug/upload'], async (req, res) => {
  try {
    const { jobId, payload, userId } = req.body;
    const url = await uploadDebugPayloadToR2Direct(jobId, payload, userId);
    res.json({ url, debugUrl: url });
  } catch (err) {
    console.error('Failed to upload debug to R2:', err);
    res.status(500).json({ error: 'Failed to upload debug' });
  }
});

r2Router.post('/api/r2/upload-job-result', async (req, res) => {
  try {
    const { jobId, payload } = req.body;
    if (!jobId || !payload) {
      return res.status(400).json({ error: 'Missing jobId or payload' });
    }
    const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/jobs/${jobId}_result.json`;
    const client = getS3Client();
    if (!client) {
      return res.json({ url: publicUrl });
    }

    const body = Buffer.from(JSON.stringify(payload, null, 2));

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: `jobs/${jobId}_result.json`,
      Body: body,
      ContentType: 'application/json',
    });
    await client.send(command);
    console.log(`[JobResult R2 API] Uploaded ok key=jobs/${jobId}_result.json bytes=${body.length}`);

    res.json({ url: publicUrl });
  } catch (err: any) {
    console.error('Failed to upload job result to R2:', err);
    res.status(500).json({ error: err.message || 'Failed to upload job result' });
  }
});

r2Router.post('/api/r2/delete-debug', async (req, res) => {
  try {
    const { key, jobId, userId } = req.body || {};
    const { deleteR2ObjectByKey, deleteDebugPayloadFromR2 } = await import('./src/utils/r2Storage.js');
    if (key) {
      const ok = await deleteR2ObjectByKey(String(key));
      return res.json({ success: ok });
    }
    if (jobId) {
      const ok = await deleteDebugPayloadFromR2(String(jobId), userId ? String(userId) : undefined);
      return res.json({ success: ok });
    }
    return res.status(400).json({ error: 'Either key or jobId is required' });
  } catch (err: any) {
    console.error('[API] /api/r2/delete-debug error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete R2 debug object' });
  }
});

r2Router.get(['/api/debug/load', '/api/r2/debug/load'], async (req, res) => {
  try {
    const jobId = String(req.query.jobId || req.query.id || '');
    const userId = req.query.userId ? String(req.query.userId) : undefined;
    if (!jobId) return res.status(400).json({ error: 'jobId required' });
    const payload = await fetchDebugPayloadFromR2Direct(jobId, userId);
    if (!payload) return res.status(404).json({ error: 'Debug payload not found' });
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load debug payload' });
  }
});

r2Router.get(['/api/r2/logs', '/api/logs'], async (req, res) => {
  try {
    const key = String(req.query.key || req.query.jobId || '');
    if (!key) return res.status(400).json({ error: 'key required' });
    const logs = await fetchLogsFromR2Direct(key);
    if (!logs) return res.status(404).json({ error: 'Logs not found' });
    return res.type('text/plain').send(logs);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to fetch logs' });
  }
});

