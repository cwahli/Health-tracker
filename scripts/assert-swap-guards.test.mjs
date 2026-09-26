// R-14 guards 4-8 sensor: moving a conversation to another machine is
// preflighted in a fixed order and fails by name, the turn is held rather than
// run silently on this machine's allowance, the first turn on a host is a
// canary that confirms or rolls back the route, and only a transient failure
// is retried — under the same job id, inside one deadline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PREFLIGHT_CHECKS,
  preflightWorkerTurn,
  preflightSummary,
  classifyWorkerFailure,
  retryDelayMs,
  checkWorkspace,
  checkSession,
} from './lib/swap-guards.mjs';
import {
  ROUTE_STATES,
  routeFor,
  routeState,
  armRoute,
  confirmRoute,
  rollbackRoute,
  needsCanary,
  validateCanaryResult,
} from './lib/worker-routing.mjs';
import { enqueueJob, claimJob, completeJob, requeueJob, getJob, DEFAULT_LEASE_MS } from './lib/worker-jobs.mjs';
import { recordWorkerConnected, workerCwd, clearWorker } from './lib/worker-presence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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

console.log('assert-swap-guards:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-guards-'));
const HOST = 'grok';

// fetch stubs: /health always answers healthy, /sessions/<id>/check answers
// with the status the test is exercising.
const relayOk = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
const relayDown = async () => { throw new Error('fetch failed'); };
const sessionAnswer = (status, body = {}) => async (url) => {
  const isHealth = String(url).includes('/health');
  const code = isHealth ? 200 : status;
  return {
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => (isHealth ? { ok: true } : body),
  };
};

try {
  // 1. Preflight order: presence first, stop at the first failure, named.
  const noWorker = await preflightWorkerTurn({ host: HOST, workspace: 'p1', sessionId: '', home, fetchImpl: relayOk });
  check('a host with no worker fails at presence, before anything else', noWorker.ok === false && noWorker.failed === 'presence');
  check('the presence failure stops the checks there', noWorker.checks.length === 1 && noWorker.checks[0].name === 'presence');
  check('the failure carries a reason a message can print', typeof noWorker.reason === 'string' && noWorker.reason.length > 0);
  check('failed is one of the four named checks', PREFLIGHT_CHECKS.includes(noWorker.failed));

  recordWorkerConnected({ host: HOST, pid: process.pid, cwd: '/srv/grok/health-tracker', home });
  const relayFails = await preflightWorkerTurn({ host: HOST, workspace: 'p1', home, fetchImpl: relayDown });
  check('a dead relay fails at relay, after presence passed', relayFails.ok === false && relayFails.failed === 'relay');
  check('checks accumulate in order', relayFails.checks.map((c) => c.name).join(',') === 'presence,relay');

  const noWorkspace = await preflightWorkerTurn({ host: HOST, workspace: '', home, fetchImpl: relayOk });
  check('an unresolved workspace fails at workspace', noWorkspace.ok === false && noWorkspace.failed === 'workspace');
  check('the four checks run in the documented order', noWorkspace.checks.map((c) => c.name).join(',') === 'presence,relay,workspace');

  const resolvable = { workerCwd: '/srv/grok/health-tracker', exists: (p) => p === '/srv/grok/health-tracker' };
  const badSession = await preflightWorkerTurn({ host: HOST, workspace: 'p1', sessionId: 'ses_abc123', home, full: true, ...resolvable, fetchImpl: sessionAnswer(404, { error: 'session not found' }) });
  check('a conversation missing on the host fails at session', badSession.ok === false && badSession.failed === 'session');
  check('a full preflight reports all four checks', badSession.checks.map((c) => c.name).join(',') === 'presence,relay,workspace,session');

  const skipSession = await preflightWorkerTurn({ host: HOST, workspace: 'p1', sessionId: 'ses_abc123', home, full: false, ...resolvable, fetchImpl: sessionAnswer(404, {}) });
  check('full:false skips the session probe but passes the rest', skipSession.ok === true && skipSession.checks.length === 3);

  // 2. The session probe's four answers are distinguished, not collapsed.
  const s404 = await checkSession('ses_abc123', { relay: '', fetchImpl: sessionAnswer(404, {}) });
  const s400 = await checkSession('ses_abc123', { relay: '', fetchImpl: sessionAnswer(400, {}) });
  const s503 = await checkSession('ses_abc123', { relay: '', fetchImpl: sessionAnswer(503, {}) });
  const sok = await checkSession('ses_abc123', { relay: '', fetchImpl: sessionAnswer(200, { bytes: 42 }) });
  check('404 means not on this host', s404.ok === false && /not on this host/.test(s404.detail));
  check('400 means a malformed id', s400.ok === false && /malformed/.test(s400.detail));
  check('503 means opencode cannot tell', s503.ok === false && /opencode is not available/.test(s503.detail));
  check('200 means the conversation is exportable', sok.ok === true && /42 bytes/.test(sok.detail));
  const sMissing = await checkSession('', { relay: '', fetchImpl: relayDown });
  check('a fresh conversation needs no session', sMissing.ok === true && sMissing.skipped === true);

  // 3. Workspace resolution: an id that resolves nowhere here is a named failure.
  const wsNoId = checkWorkspace('', { host: HOST });
  check('no workspace id is a failure, not a default', wsNoId.ok === false && /no workspace id/.test(wsNoId.detail));
  const wsMissing = checkWorkspace('p1', { host: HOST, workerCwd: '/srv/grok/health-tracker', exists: () => false });
  check('an id that resolves nowhere fails by name', wsMissing.ok === false && wsMissing.resolved === null);
  const wsOk = checkWorkspace('p1', { host: HOST, workerCwd: '/srv/grok/health-tracker', exists: (p) => p === '/srv/grok/health-tracker' });
  check('the worker\'s own directory can satisfy the id', wsOk.ok === true && wsOk.resolved === '/srv/grok/health-tracker');

  // 4. Retry policy: only the three transient classes come back retryable.
  const transient = ['worker did not answer in time', 'claim expired', 'socket hang up', 'fetch failed'].map((t) => classifyWorkerFailure(t));
  check('timeouts, expired claims and relay blips are retryable', transient.every((c) => c.retryable && c.code === 'transient'));
  const permanent = ['workspace_unresolved: no directory', 'session not found', 'lane is depleted', 'no worker connected', 'boom, unknown'].map((t) => classifyWorkerFailure(t));
  check('bad workspaces, sessions, lanes, workers and unknown errors are never retried', permanent.every((c) => !c.retryable));
  check('an unrecognised error is named, not silently retried', classifyWorkerFailure('boom, unknown').code === 'permanent');
  const d1 = retryDelayMs(1);
  const d4 = retryDelayMs(4);
  const d9 = retryDelayMs(9);
  check('backoff grows with the attempt', d4 > d1);
  check('backoff is capped', d9 === 15000 && retryDelayMs(99) === 15000);
  check('the summary prints each check for the held message', preflightSummary([{ ok: true, name: 'presence', detail: 'worker connected' }, { ok: false, name: 'workspace', detail: 'gone' }]) === 'ok presence: worker connected; FAIL workspace: gone');

  // 5. Routing: arm -> canary, confirm -> active, rollback -> failed, by name.
  check('a host that has never run a turn has no route', routeState(HOST, { home }) === null && routeFor(HOST, { home }) === null);
  check('the three route states are the only ones', ROUTE_STATES.join(',') === 'canary,active,failed');
  const armed = armRoute(HOST, { previous: 'vps', home });
  check('naming a host arms a canary', armed.state === 'canary' && armed.previous === 'vps');
  check('an armed host needs a canary', needsCanary(HOST, { home }) === true);
  const confirmed = confirmRoute(HOST, { jobId: 'j1', home });
  check('a passing canary makes the route active', confirmed.state === 'active' && confirmed.canary.ok === true);
  check('an active host does not canary again', needsCanary(HOST, { home }) === false);
  const rolled = rollbackRoute(HOST, { jobId: 'j2', reason: 'wrong ledger', home });
  check('a failed canary is recorded with its reason', rolled.state === 'failed' && rolled.canary.ok === false && rolled.canary.reason === 'wrong ledger');
  check('rollback keeps the previous host for the next attempt', rolled.previous === 'vps');
  check('a failed route needs a canary to come back', needsCanary(HOST, { home }) === true);

  // 6. The canary's verdict: what a handoff must come back with.
  const good = { text: 'hi', sessionID: 'ses_abc123', workspace: '/srv/grok/health-tracker', ledger: '/home/u/.hermes/ledger/worker-grok' };
  check('a complete handoff passes', validateCanaryResult({ host: HOST, requestedSessionId: 'ses_abc123', result: good }).ok === true);
  const empty = validateCanaryResult({ host: HOST, requestedSessionId: '', result: { ...good, text: '' } });
  check('an empty answer with no error fails', empty.ok === false && /empty result/.test(empty.reasons.join('; ')));
  const wrongSession = validateCanaryResult({ host: HOST, requestedSessionId: 'ses_other', result: good });
  check('the wrong conversation fails', wrongSession.ok === false && /mismatch/.test(wrongSession.reasons.join('; ')));
  const wrongLedger = validateCanaryResult({ host: HOST, requestedSessionId: 'ses_abc123', result: { ...good, ledger: '/home/u/.hermes/ledger/vm' } });
  check("this machine's ledger fails", wrongLedger.ok === false && /wrong ledger/.test(wrongLedger.reasons.join('; ')));
  const wsNotReported = validateCanaryResult({ host: HOST, requestedSessionId: 'ses_abc123', result: { ...good, workspace: '' } });
  check('a handoff that reports no workspace fails', wsNotReported.ok === false && /no workspace/.test(wsNotReported.reasons.join('; ')));
  const errored = validateCanaryResult({ host: HOST, requestedSessionId: 'ses_abc123', result: { ...good, text: '', error: 'refused', workspace: '', ledger: '' } });
  check('an explicit refusal still fails the canary', errored.ok === false);

  // 7. The job carries the canary flag and can be put back under the same id.
  const job = enqueueJob({ host: HOST, prompt: 'x', workspace: 'p1', canary: true }, { home });
  check('the job records its canary flag', job.canary === true && job.attempts === 0);
  const claimed = claimJob(HOST, { home });
  check('the job is claimed under its id', claimed && claimed.id === job.id && Boolean(claimed.claimedAt));
  const requeued = requeueJob(job.id, { home, reason: 'timeout' });
  check('a transient failure requeues under the same id', requeued && requeued.claimedAt === null && requeued.attempts === 1);
  check('the requeue reason is recorded', requeued.requeueReason === 'timeout');
  const row = getJob(job.id, { home });
  check('the requeued job is claimable again', row.claimedAt === null && !row.doneAt);
  const finished = completeJob(job.id, { text: 'done', code: 0, ledger: '/l/worker-grok' }, { home });
  check('a finished job carries its result', finished && finished.doneAt && finished.result.text === 'done');
  check('a job that already finished is never reopened', requeueJob(job.id, { home }) === null);
  check('the claim lease is long enough to hold a worker turn', DEFAULT_LEASE_MS >= 60000);

  // 8. The worker reports the directory it actually runs in, so the sender can
  // ask whether this project exists there.
  check('presence stores the directory the worker reported', workerCwd(HOST, { home }) === '/srv/grok/health-tracker');

  // 9. Source wiring: the guards are on the paths that matter.
  const bot = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  const agent = fs.readFileSync(path.join(HERE, 'worker-agent.mjs'), 'utf8');
  const relay = fs.readFileSync(path.join(HERE, 'worker-relay.mjs'), 'utf8');
  const jobs = fs.readFileSync(path.join(HERE, 'lib', 'worker-jobs.mjs'), 'utf8');
  const workerFn = bot.slice(bot.indexOf('export async function runOnWorker'), bot.indexOf('/** Where the'));
  check('runOnWorker preflights before it enqueues', workerFn.indexOf('preflightWorkerTurn(') !== -1 && workerFn.indexOf('preflightWorkerTurn(') < workerFn.indexOf('enqueueJob('));
  check('runOnWorker never returns null (no silent local fallback)', !/return null;/.test(workerFn));
  check('runOnWorker may requeue the same job id', /requeueJob\(job\.id/.test(workerFn) && /await new Promise\(\(r\) => setTimeout\(r, retryDelayMs\(attempt\)\)\)/.test(workerFn));
  const turnPath = bot.slice(bot.indexOf('// A location that names another machine'), bot.indexOf('const result = await runOpencodeWithFailover'));
  check('an unreachable host holds the turn instead of running it here', /if \(!remoteStatus\.reachable\)/.test(turnPath) && /setBlockedLocation\(chatId, location/.test(turnPath));
  check('a route left failed holds the turn too', /route === 'failed'/.test(turnPath));
  check('the first turn on a host is a canary', /const wantCanary = route !== 'active'/.test(turnPath));
  check('the canary is settled before the session row changes', turnPath.indexOf('settleCanary(') !== -1 && turnPath.indexOf('settleCanary(') < turnPath.indexOf('sessions.set(chatId, handed.sessionID)'));
  const settleAt = bot.indexOf('export function settleCanary');
  const settleFn = bot.slice(settleAt, settleAt + 1400);
  check('settleCanary validates before it confirms or rolls back', settleAt !== -1 && settleFn.indexOf('validateCanaryResult(') < settleFn.indexOf('confirmRoute('));
  check('a failed canary rolls the route back by name', /rollbackRoute\(/.test(settleFn) && /ok: false/.test(settleFn));
  check('a passed canary confirms the route', /confirmRoute\(/.test(settleFn) && /ok: true/.test(settleFn));
  check('the drill decides with the live turn\u2019s own function', /settleCanary\(/.test(fs.readFileSync(path.join(HERE, 'assert-swap-drill.mjs'), 'utf8')));
  check('/location arms the route it names', /armRoute\(target/.test(bot));
  check('the worker refuses a workspace that resolves nowhere', /workspace_unresolved/.test(agent) && !/workspaceForId\(job\.workspace[^)]*\) \|\| HERE/.test(agent));
  check('the worker reports the directory it runs in', /cwd: process\.cwd\(\)/.test(agent));
  check('the relay exposes the session check the preflight asks for', /\/check/.test(relay) && /function checkSession\(/.test(relay));
  check('the relay stores the worker directory on connect', /cwd: String\(body\.cwd/.test(relay));
  check('the job store can requeue', /export function requeueJob/.test(jobs));

  // 10. Guard 11 (card 6c): the view follows the conversation, on one
  // stable tmux session, and the product — not just the library — says so.
  const workSession = fs.readFileSync(path.join(HERE, 'lib', 'work-session.mjs'), 'utf8');
  check('the product creates the view on the stable session', /ensureTmuxWorkView\([^)]*\{[^}]*sessionName: WORK_VIEW_SESSION/.test(bot));
  check('the product disables and reports the same stable session', /disableTmuxObserver\([^)]*sessionName: WORK_VIEW_SESSION/.test(bot) && /statusForTelegram\([^)]*sessionName: WORK_VIEW_SESSION/.test(bot));
  check('an already-live view is rebound, not returned as-is', /return rebindWorkView\(session/.test(bot) && /repointWorkView\(\{ target: workViewTarget\(/.test(bot));
  check('a turn that ran elsewhere records the thread it ran', /setWorkView\(workSession\.id, \{ opencodeSessionId: handed\.sessionID \}\)/.test(bot));
  check('the view is re-pointed straight after a swapped turn', /setWorkView\(workSession\.id, \{ opencodeSessionId: handed\.sessionID \}\)[\s\S]{0,600}reconcileWorkViewForLane\(/.test(bot));
  check('the status probe can be told which session to look in', /function sessionStatus\(id, \{ tmux = defaultTmuxRunner, sessionName \}/.test(workSession));
  check('the library default stays location-named for its own tests', /sessionName = session \? tmuxSessionFor\(session\.location\) : null/.test(workSession));
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
