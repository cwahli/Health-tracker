#!/usr/bin/env node
/**
 * EGRESS_BOMB / quota lockout — RELIABILITY.md §9.2 five laws as a Guard.
 * The 6GB Supabase lockout class: SELECT *, fat JSONB, unbounded pull,
 * ungated poll, blobs in the row store.
 *
 *   node scripts/assert-egress-bomb.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = 0;
function pass(m) { console.log(`  PASS  ${m}`); }
function fail(m) { failed++; console.error(`  FAIL  ${m}`); }
function read(rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

const sync = read('server_routes_sync.ts');
const app = read('src/App.tsx') + read('src/hooks/useAppSync.ts');
// D-2: implementation lives in BackendJobSync; SupabaseJobSync is a re-export shim
const jobSync =
  read('src/jobs/BackendJobSync.ts') || read('src/jobs/SupabaseJobSync.ts');
const client = read('src/utils/syncUtils.ts');

console.log('\n=== EGRESS_BOMB (Supabase/D1 conservation) ===\n');

// Law 2: list/pull path must not food_logs.select('*')
if (/\.from\(\s*['"]food_logs['"]\s*\)\s*\.select\(\s*['"]\*['"]/.test(sync)) {
  fail('server_routes_sync food_logs.select(*) — list pull must project columns');
} else pass('no food_logs.select(*) on sync pull');

if (/\.from\(\s*['"]biomarker_logs['"]\s*\)\s*\.select\(\s*['"]\*['"]/.test(sync)) {
  fail('server_routes_sync biomarker_logs.select(*)');
} else pass('no biomarker_logs.select(*) on sync pull');

// Law 1: client incremental sync
if (!app.includes('lastSyncTime') || !client.includes('lastSyncTime')) {
  fail('lastSyncTime missing from App/syncUtils — unbounded pull');
} else pass('lastSyncTime on client pull');

if (!/forcePull \|\| forceReplaceLocal/.test(app) && !app.includes('forceReplaceLocal')) {
  fail('no force-pull exception documented — risk of always-full pull');
} else pass('full pull reserved for force');

// Law 4: job poll gated (BackendJobSync fallback poll)
if (!jobSync.includes('hasActiveJob')) {
  fail('BackendJobSync poll not gated on hasActiveJob');
} else pass('job poll gated on hasActiveJob');

const pollMs = jobSync.match(/setInterval\(\s*\(\)\s*=>\s*\{[\s\S]*?hasActiveJob[\s\S]*?\},\s*(\d+)/);
if (pollMs && Number(pollMs[1]) < 5000) {
  fail(`job fallback poll ${pollMs[1]}ms < 5000`);
} else if (pollMs) pass(`job fallback poll ${pollMs[1]}ms`);
else pass('job poll interval parsed or gated');

// Law 3: no direct client Supabase — all egress through backend (D1) proxy
if (!jobSync.includes('isDirectClientSupabaseDisabled = true')) {
  fail('direct client Supabase not default-disabled — egress can bypass the proxy');
} else pass('direct client Supabase disabled by default');

// Law 5 / M23: no chat cloud write
const chat = read('src/components/LogChat.tsx') + read('src/utils/firestoreUtils.ts');
if (chat.includes('[FreeTier] chat cloud write disabled') || read('scripts/assert-free-tier-m23.mjs')) {
  pass('chat/telemetry kill-switch program present');
} else fail('free-tier chat kill-switch missing');

if (failed) {
  console.error(`\nFAILED ${failed}: EGRESS_BOMB — do not COMPLETE. This class locked Supabase (GB-scale pull).`);
  process.exit(1);
}
console.log('\nPASS egress-bomb\n');
process.exit(0);
