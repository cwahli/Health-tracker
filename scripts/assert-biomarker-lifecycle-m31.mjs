/**
 * M31 master gate — P0–P8 complete lifecycle validation.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = 0;
function ok(cond, id, msg) {
  if (cond) {
    console.log(`PASS ${id}`);
  } else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

const home = read('src/components/HomeTab.tsx');
const dict = read('src/components/BiomarkerDictionaryModal.tsx');
const life = read('src/utils/biomarkerLifecycle.ts');
const lifeTest = read('src/utils/biomarkerLifecycle.test.ts');
const bioUtils = read('src/utils/biomarkers.ts');
const sanitizeUtils = read('src/utils/dataSanitize.ts');
const logChat = read('src/components/LogChat.tsx');
const app = read('src/App.tsx');
const server = read('server.ts');

// P0 (A1)
for (const s of [
  'Auto-Fix Historical Scaling',
  'Inspect Card',
  'Review in Medical History',
  'Edit Logs in Medical History',
]) {
  ok(!home.includes(s), 'P0:A1', `Home still contains "${s}"`);
}

// P0 (A2)
for (const s of [
  'Auto-Calibrate',
  'Auto-Fill Defaults',
  'Quick Approve',
  'Approve Selected',
  'Save & Approve',
]) {
  ok(!dict.includes(s), 'P0:A2', `Dictionary still contains "${s}"`);
}

// P0 (A3)
ok(life.includes('export function buildReviewCommandsFromHistory'), 'P0:A3', 'missing buildReviewCommandsFromHistory');
ok(life.includes('export function enrichReviewModificationCommands'), 'P0:A3', 'missing enrichReviewModificationCommands');
ok(logChat.includes('enrichReviewModificationCommands'), 'P0:A3', 'LogChat does not call enrich');
ok(app.includes('enrichReviewModificationCommands'), 'P0:A3', 'App does not call enrich');
ok(server.includes('enrichReviewModificationCommands'), 'P0:A3', 'server.ts does not call enrich');

// P0 (A4)
ok(dict.includes('isPendingCatalogApproval'), 'P0:A4', 'Dictionary does not use isPendingCatalogApproval');

// P0 (A6) — lock convert numbers
for (const n of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
  ok(lifeTest.includes(n), 'P0:A6', `lifecycle test missing locked convert ${n}`);
}

// P1 — Review apply captures observationMeta & populates rawValue
ok(life.includes('observationMeta'), 'P1', 'biomarkerLifecycle.ts missing observationMeta tracking');
ok(lifeTest.includes('observationMeta?.hdl?.rawValue') && lifeTest.includes('older SI rows remain unchanged'), 'P1', 'lifecycle test missing observationMeta capture test');
ok(app.includes('collectCatalogUnitMap'), 'P1', 'App.tsx does not use collectCatalogUnitMap');

// P2 — Catalog Hygiene
ok(life.includes('export function cleanupInventedBiomarkerCatalog'), 'P2', 'missing cleanupInventedBiomarkerCatalog in biomarkerLifecycle.ts');
ok(sanitizeUtils.includes('cleanupInventedBiomarkerCatalog'), 'P2', 'dataSanitize.ts does not call cleanupInventedBiomarkerCatalog');
// P2b — B7.6 Name Deduper leftovers: parallel alias keys fold into the audit
// master (or tombstone) on both load paths, never across different units.
const audit = read('src/utils/biomarkerAuditEngine.ts');
ok(audit.includes('export function mergeParallelAliasGroups'), 'P2', 'missing mergeParallelAliasGroups in biomarkerAuditEngine.ts');
const dedupeSites = (app.match(/mergeParallelAliasGroups\(/g) || []).length;
ok(dedupeSites >= 2, 'P2', `parallel-key fold wired at ${dedupeSites} load paths, want >= 2 (auth load + sync merge)`);
ok(audit.includes('masterUnit !== loserUnit'), 'P2', 'parallel-key fold missing unit-mismatch guard');

// P3 — Destination routing
ok(life.includes('export function resolveAgentDestination'), 'P3', 'missing resolveAgentDestination');
ok(lifeTest.includes('routes data_accuracy to comparison modal payload'), 'P3', 'missing data_accuracy route test');
ok(lifeTest.includes('routes biomarker_review with proposal.range to customRanges proposal'), 'P3', 'missing biomarker_review customRanges route test');
ok(lifeTest.includes('routes name_consolidation to remap proposal'), 'P3', 'missing name_consolidation route test');

// P4 — Calibrator loop
ok(life.includes('export function overlayFingerprint'), 'P4', 'missing overlayFingerprint');
ok(life.includes('export function shouldRunCalibrator'), 'P4', 'missing shouldRunCalibrator');
ok(lifeTest.includes('runs calibrator for 25-yo female'), 'P4', 'missing calibrator rerun lifecycle test');
// P4b — B7.5 Silent Calibrator product path: every full-profile write routes
// through the fingerprint-guarded helper (Header, Dictionary updates,
// front-desk ×3, sync merge, conflict resolve, sanitize apply).
ok(app.includes('maybeRecalibrateDemographicOverlays'), 'P4', 'App does not route profile writes through the silent calibrator');
const recalSites = (app.match(/maybeRecalibrateDemographicOverlays\(profile, /g) || []).length;
ok(recalSites >= 6, 'P4', `silent calibrator covers ${recalSites} product paths, want >= 6`);
ok(!app.includes('profile?.age !== updatedProfile.age'), 'P4', 'raw demographic diff still present (must be fingerprint diff)');

// P5 — Flagged isolation
ok(life.includes('export function filterHistoryForUse'), 'P5', 'missing filterHistoryForUse');
ok(life.includes('export function filterCurrentForUse'), 'P5', 'missing filterCurrentForUse');
ok(life.includes('export function formatBiomarkersForPrompt'), 'P5', 'missing formatBiomarkersForPrompt');
ok(lifeTest.includes('drops 195 cholesterol from dietitian prompt context'), 'P5', 'missing 195 cholesterol isolation test');

// P6 — Units page relabel vs convert
ok(life.includes('export function handleUnitChange'), 'P6', 'missing handleUnitChange');
ok(lifeTest.includes('relabels unit in profile/custom without modifying history values'), 'P6', 'missing relabel unit test');
ok(lifeTest.includes('converts history values with convertViaTable'), 'P6', 'missing convert unit test');

// P7 — Zero-value sanity
ok(bioUtils.includes('isValEmpty'), 'P7', 'missing isValEmpty in biomarkers.ts');
ok(lifeTest.includes('treats 0 and 0.0 as real values'), 'P7', 'missing isValEmpty(0) test in biomarkerLifecycle.test.ts');

// P8 — B7.4 Real Pending store: unknown names route to pendingObservations,
// never needsApproval flags on the customBiomarkers bag. Reads
// (`?.needsApproval === true`) and fixture/test files are exempt — only the
// `: true` stamp literal is forbidden in product extract/apply surfaces.
const insights = read('src/components/InsightsTab.tsx');
for (const [src, id] of [[app, 'App.tsx'], [logChat, 'LogChat.tsx'], [insights, 'InsightsTab.tsx'], [dict, 'BiomarkerDictionaryModal.tsx']]) {
  const stamps = (src.match(/needsApproval:\s*true/g) || []).length;
  ok(stamps === 0, 'P8', `${id} stamps needsApproval:true onto the bag (${stamps}x)`);
}
ok(app.includes('pushPendingObservation') && logChat.includes('pushTransientPending'), 'P8', 'pending push helpers missing');
ok(dict.includes('approvePendingObservation') && dict.includes('dismissPendingObservation'), 'P8', 'Dictionary does not approve/dismiss from the pending store');

if (failed) {
  console.error(`\nM31 assert failed: ${failed} check(s)`);
  process.exit(1);
}
console.log('\nAll M31 P0–P8 assertions PASSED.');
process.exit(0);
