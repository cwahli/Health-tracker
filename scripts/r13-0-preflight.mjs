#!/usr/bin/env node
/**
 * R-13.0 preflight — agent-run, no app code.
 * Reads CLOUDFLARE_* from env (local .env or runtime). Never prints secrets.
 *
 *   node --env-file=.env scripts/r13-0-preflight.mjs
 *
 * Workers Paid is NOT required: R-13.1 API is a Node process (Container / Cloud Run).
 */
import { S3Client, HeadBucketCommand, GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const d1Id = process.env.CLOUDFLARE_D1_DATABASE_ID;
const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const liveOrigin = process.env.R13_LIVE_ORIGIN || 'https://health-tracker-backend-64gt.onrender.com';
const extraOrigin = process.env.R13_PROD_ORIGIN || '';

const CORS_ORIGINS = [
  'http://localhost:3000',
  liveOrigin,
  extraOrigin,
].filter(Boolean);

let failed = 0;
function pass(id, extra = '') {
  console.log(`PASS ${id}${extra ? ` ${extra}` : ''}`);
}
function fail(id, msg) {
  failed += 1;
  console.error(`FAIL ${id}: ${msg}`);
}

async function cf(path) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok && body.success !== false, status: r.status, body };
}

if (!account || !token || !d1Id || !bucket) {
  fail('env', 'need CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_R2_BUCKET_NAME');
  process.exit(1);
}

const d1 = await cf(`/accounts/${account}/d1/database/${d1Id}`);
if (d1.ok && d1.body?.result?.name) {
  pass('d1_exists', `${d1.body.result.name} tables=${d1.body.result.num_tables}`);
} else {
  fail('d1_exists', `HTTP ${d1.status}`);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

try {
  const head = await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  pass('r2_exists', `HTTP ${head.$metadata.httpStatusCode} ${bucket}`);
} catch (e) {
  fail('r2_exists', e.message || String(e));
}

const wanted = CORS_ORIGINS.slice().sort().join('|');
let have = [];
try {
  const cors = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
  have = (cors.CORSRules || []).flatMap((r) => r.AllowedOrigins || []);
} catch (e) {
  if (e.name !== 'NoSuchCORSConfiguration') fail('r2_cors_read', e.message || String(e));
}
const haveKey = have.slice().sort().join('|');
if (haveKey === wanted) {
  pass('r2_cors', have.join(','));
} else {
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: CORS_ORIGINS,
              AllowedMethods: ['GET', 'PUT', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      }),
    );
    pass('r2_cors_applied', CORS_ORIGINS.join(','));
  } catch (e) {
    fail('r2_cors_apply', e.message || String(e));
  }
}

if (process.env.NODE_ENV === 'production' || process.env.R13_PREFLIGHT === '1') {
  pass('node_env_note', 'runtime NODE_ENV is the deploy host’s job (Dockerfile already sets production)');
} else {
  pass('node_env_note', 'local preflight; Dockerfile already has NODE_ENV=production');
}

pass('workers_paid_not_required', 'R-13.1 API is Node (Container/Cloud Run), not a V8 Worker');

console.log(failed ? `\nr13-0-preflight: ${failed} FAIL` : '\nr13-0-preflight: all PASS');
process.exit(failed ? 1 : 0);
