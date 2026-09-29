// R-14.1 card 6c follow-up sensor: a failed canary must tell the user WHY it
// failed. Regression: `rollbackRoute` stores the reason at
// `row.canary.reason`, but the held-message reader checked `row.failedReason`
// (never written), so every failed route reported "(unknown reason)".
// Runs against an isolated HOME — the real ~/.hermes ledger is untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  armRoute,
  confirmRoute,
  rollbackRoute,
  routeFor,
  routeState,
  failedRouteReason,
  validateCanaryResult,
} from './lib/worker-routing.mjs';

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

console.log('assert-worker-routing:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-routing-'));
const opts = () => ({ home });

// 1. Arm puts the host in canary; no failure reason yet.
armRoute('mobile', { previous: 'vps', ...opts() });
check('arm sets state canary', routeState('mobile', opts()) === 'canary');
check(
  'armed route reports unknown reason (nothing failed yet)',
  failedRouteReason(routeFor('mobile', opts())) === 'unknown reason'
);

// 2. A failed canary persists its reason where the reader looks.
const reason = 'wrong ledger: expected one ending in worker-mobile, got worker-vps';
rollbackRoute('mobile', { jobId: 'j1', reason, ...opts() });
const row = routeFor('mobile', opts());
check('rollback sets state failed', routeState('mobile', opts()) === 'failed');
check('reason stored at canary.reason', row?.canary?.reason === reason);
check('canary marked not-ok', row?.canary?.ok === false);
check('reader surfaces the stored reason', failedRouteReason(row) === reason);
check('held message would not say unknown', failedRouteReason(row) !== 'unknown reason');

// 3. Re-arming (the `/location <host>` retry path) clears the failure.
armRoute('mobile', { previous: 'vps', ...opts() });
check('re-arm returns state to canary', routeState('mobile', opts()) === 'canary');

// 4. A passed canary confirms the route.
rollbackRoute('mobile', { jobId: 'j2', reason, ...opts() });
confirmRoute('mobile', { jobId: 'j3', ...opts() });
const confirmed = routeFor('mobile', opts());
check('confirm sets state active', routeState('mobile', opts()) === 'active');
check('confirm records an ok canary', confirmed?.canary?.ok === true);

// 5. Legacy rows carrying a top-level failedReason still read.
check(
  'legacy failedReason fallback honored',
  failedRouteReason({ state: 'failed', failedReason: 'old stamp' }) === 'old stamp'
);
check('null row stays unknown', failedRouteReason(null) === 'unknown reason');

// 6. The validator produces the reason strings the reader now surfaces.
const bad = validateCanaryResult({ host: 'mobile', requestedSessionId: 's1', result: {} });
check('empty canary result is not ok', bad.ok === false);
check('validator yields reasons to store', bad.reasons.length > 0);
check(
  'stored join is non-empty (the call-site join pattern)',
  bad.reasons.join('; ').length > 0
);
const good = validateCanaryResult({
  host: 'mobile',
  requestedSessionId: 's1',
  result: { text: 'ok', sessionID: 's1', workspace: '/tmp/w', ledger: 'x/worker-mobile/free-lanes' },
});
check('complete canary result is ok', good.ok === true && good.reasons.length === 0);

fs.rmSync(home, { recursive: true, force: true });

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
