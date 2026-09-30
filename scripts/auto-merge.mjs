#!/usr/bin/env node
/**
 * auto-merge.mjs — the driver behind `.github/workflows/auto-merge.yml`.
 *
 * The workflow used to do this inline in `actions/github-script`, where the
 * decision was unauditable and untestable — and wrong (see `lib/merge-gate.mjs`
 * for the two PRs it merged red). The decision now lives in that module as a
 * pure function; this file is only the I/O around it:
 *
 *   find the PR  →  read the head SHA's check runs  →  ask the gate
 *                                                        │
 *                          merge ◄───────────────────────┤
 *                          wait  → sleep, ask again      │
 *                          refuse → comment, exit non-zero
 *
 * A refusal scoped to `main` is also REPORTED, not only enforced: the gate that
 * refuses while `main` is red used to be the quietest thing in the repository —
 * the queue stalled and nothing said why. That is what `lib/red-main-notice.mjs`
 * is for, and it runs before the refusal, so a broken notifier cannot become a
 * merge that was not refused.
 *
 * A merge is not the end of it. The squash commit it lands is written by
 * `GITHUB_TOKEN`, whose pushes do not trigger workflows — so `main` would never
 * be verified after the merge and the composition of two separately-green PRs
 * would go unchecked. The driver therefore dispatches the post-merge
 * verification explicitly (`repository_dispatch`, one of the two suppression-
 * exempt events) and a merge whose verification cannot be dispatched is not
 * reported as a success. See `lib/main-verify.mjs`.
 *
 * FAIL CLOSED, INCLUDING ON ITS OWN ERRORS. Every failure path here (no token,
 * API error, no PR, timeout, a gateway 500) ends in "did not merge" and a
 * non-zero exit. There is no branch that merges because something was unknown —
 * that inversion is the whole bug this replaces.
 *
 * Exit codes: 0 merged (or, with --evaluate, "would merge"), 1 not merged,
 * 2 the driver itself failed.
 *
 * Usage:
 *   node scripts/auto-merge.mjs                     # in Actions: push to agent/**
 *   node scripts/auto-merge.mjs --pr=346            # judge one PR
 *   node scripts/auto-merge.mjs --pr=346 --evaluate # decide and print; write nothing
 *   node scripts/auto-merge.mjs --pr=346 --allow-red-main  # operator override; see below
 *
 * A red `main` blocks the next merge, which would also block the PR that fixes
 * it. `--allow-red-main` (or `ALLOW_RED_MAIN=1`) is the deliberate way out: an
 * operator says so explicitly, the run log and the PR both record it, and it is
 * never reached by a timeout.
 *
 * Env: GH_TOKEN (or GITHUB_TOKEN), GITHUB_API_URL, GITHUB_REPOSITORY,
 *      GITHUB_REF_NAME. All four are set for us by Actions; the API base is read
 *      from GITHUB_API_URL rather than hardcoded so the sensor can point this at
 *      a loopback fake.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_CHECKS,
  describeDecision,
  evaluateChecks,
  evaluateMainHealth,
  evaluatePrState,
  parseDependsOn,
  validateRequiredAgainstWorkflows,
} from './lib/merge-gate.mjs';
import {
  buildDispatch,
  describeDispatch,
  dispatchEndpoint,
  validateMainVerifyWiring,
} from './lib/main-verify.mjs';
import { makeClient } from './lib/github-rest.mjs';
import { describeNotice, syncRedMainNotice } from './lib/red-main-notice.mjs';
import { checkRange, git } from './lib/no-undo.mjs';
import {
  PREMERGE_DECISIONS,
  decideBranchUndo,
  describePremergeRefusal,
  describePremergeUnknown,
} from './lib/premerge-undo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Long enough for `ci` (~1.5–3 min) with room for a queued runner. */
export const DEFAULT_WAIT_SECONDS = 900;
export const DEFAULT_POLL_SECONDS = 15;
/** How long to wait for auto-pr.yml to have created the PR. */
export const DEFAULT_PR_WAIT_SECONDS = 90;

export function parseArgs(argv = []) {
  const args = { evaluate: false, json: false };
  for (const raw of argv) {
    const arg = String(raw);
    if (arg === '--evaluate' || arg === '--dry-run') args.evaluate = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--allow-red-main') args.allowRedMain = true;
    else if (arg.startsWith('--pr=')) args.pr = Number(arg.slice(5));
    else if (arg.startsWith('--branch=')) args.branch = arg.slice(9);
    else if (arg.startsWith('--repo=')) args.repo = arg.slice(7);
    else if (arg.startsWith('--wait=')) args.wait = Number(arg.slice(7));
    else if (arg.startsWith('--poll=')) args.poll = Number(arg.slice(7));
    else if (arg.startsWith('--pr-wait=')) args.prWait = Number(arg.slice(10));
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every check run GitHub reports for a commit, paginated.
 *
 * `filter=all` is deliberate. The endpoint defaults to `filter=latest`, and this
 * gate's whole judgement is "worst run of a required name wins" — a filter that
 * could collapse a red run behind a greener one of the same name would hand back
 * exactly the blindness being fixed (PR #346 really had two `tsc + named gates`
 * runs, and both were red). Ask for all of them and decide from all of them.
 */
export async function listCheckRuns(client, { owner, repo, ref }) {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await client.call(
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs?filter=all&per_page=100&page=${page}`,
    );
    const runs = Array.isArray(body?.check_runs) ? body.check_runs : [];
    out.push(...runs);
    if (runs.length < 100) break;
  }
  return out;
}

export async function findOpenPr(client, { owner, repo, branch, waitSeconds = DEFAULT_PR_WAIT_SECONDS, pollSeconds = 3 }) {
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  for (;;) {
    const list = await client.call(
      `/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${branch}&per_page=100`,
    );
    if (Array.isArray(list) && list.length) return list[0];
    if (Date.now() >= deadline) return null;
    await sleep(pollSeconds * 1000);
  }
}

/**
 * Read whether `main` itself is currently verified.
 *
 * A read that fails is UNKNOWN, not red: a transient API error must not stop
 * every merge, and the next verification re-covers the tree either way. Only a
 * concluded `failure` blocks.
 */
export async function readMainHealth(client, { owner, repo, branch = 'main', log = () => {} } = {}) {
  let sha = '';
  try {
    const ref = await client.call(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    sha = String(ref?.object?.sha || '');
  } catch (err) {
    return { health: 'unknown', blocked: false, waiting: false, runs: 0, reason: `could not read ${branch}: ${err.message}` };
  }
  if (!sha) return { health: 'unknown', blocked: false, waiting: false, runs: 0, reason: `${branch} reported no commit` };
  try {
    const runs = await listCheckRuns(client, { owner, repo, ref: sha });
    return { ...evaluateMainHealth({ checkRuns: runs, mainSha: sha }), sha };
  } catch (err) {
    return { health: 'unknown', blocked: false, waiting: false, runs: 0, sha, reason: `could not read ${branch}'s checks: ${err.message}` };
  }
}

/**
 * Wait for a decision, asking the gate after each poll.
 *
 * `waitSeconds` bounds the whole wait. Exhausting it is a REFUSE, not a merge:
 * the PR stays open and the comment says which required check never reported.
 *
 * `main` is consulted only once the PR's own checks are green — the PR has to be
 * mergeable before the state of the branch it lands on matters, and a red PR
 * already refuses without a second read.
 *
 * A green PR is not yet a decision, because `main` has three states rather than
 * two. A KNOWN-BROKEN `main` refuses; a `main` whose post-merge verification is
 * STILL RUNNING is HELD, and the loop polls again — that is the in-progress
 * window, and it is the normal state rather than a rare one, since the
 * verification of the previous merge is usually mid-flight when the next PR's
 * checks conclude. Holding costs a poll; merging through it forfeits the check.
 * The hold is bounded by the same budget as everything else, so a verification
 * that never concludes ends in a refusal rather than a merge.
 *
 * `notice` is called once, on the red path only, and its outcome is carried onto
 * the refusal so the PR comment can say where the report went. It is deliberately
 * not called for a hold or for `unknown`: neither is `main` being broken, and an
 * alarm on those would be an alarm nobody could act on.
 */
export async function waitForDecision(client, {
  owner,
  repo,
  head,
  baseBranch = 'main',
  allowRedMain = false,
  waitSeconds = DEFAULT_WAIT_SECONDS,
  pollSeconds = DEFAULT_POLL_SECONDS,
  log = () => {},
  notice = async () => null,
  depNumbers = [],
  prNumber = null,
} = {}) {
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let last = null;
  let mainNotice = null;
  // Sequencing before gating: a PR held behind another PR must not burn its
  // budget racing checks, and must say so on the PR (the wait path below
  // comments via describeDecision). Unknown dep state holds, never merges —
  // a typo'd number ends in a refusal that names the number, not a merge.
  const readDeps = async () => {
    const open = [];
    const unreadable = [];
    for (const n of depNumbers) {
      if (prNumber !== null && n === prNumber) {
        return { selfRef: true, open, unreadable };
      }
      try {
        const dep = await client.call(`/repos/${owner}/${repo}/pulls/${n}`);
        if (dep && String(dep.state || 'open') === 'open' && !dep.merged_at) open.push(n);
      } catch (err) {
        unreadable.push(n);
      }
    }
    return { selfRef: false, open, unreadable };
  };
  for (;;) {
    const deps = depNumbers.length ? await readDeps() : { selfRef: false, open: [], unreadable: [] };
    if (deps.selfRef) {
      return {
        decision: 'refuse',
        scope: 'deps',
        reason: `Depends-On names this PR itself (#${prNumber}) — fix the line, it can never clear`,
        deps: depNumbers,
      };
    }
    if (deps.open.length || deps.unreadable.length) {
      const why = [
        ...deps.open.map((n) => `#${n} still open`),
        ...deps.unreadable.map((n) => `#${n} unreadable`),
      ].join(', ');
      last = {
        decision: 'wait',
        scope: 'deps',
        reason: `held behind ${why} — merges when it lands; nothing about this PR needs to change`,
        deps: depNumbers,
      };
      log(`  ${describeDecision(last, { head })}`);
      if (Date.now() >= deadline) {
        return { ...last, decision: 'refuse', timedOut: true };
      }
      await sleep(pollSeconds * 1000);
      continue;
    }
    const runs = await listCheckRuns(client, { owner, repo, ref: head });
    last = evaluateChecks({ checkRuns: runs, required: REQUIRED_CHECKS });
    log(`  ${describeDecision(last, { head })}`);
    if (last.decision === 'refuse') return last;

    if (last.decision === 'merge') {
      const main = await readMainHealth(client, { owner, repo, branch: baseBranch });
      log(`  ${baseBranch}: ${main.health} — ${main.reason}`);
      if (main.blocked) {
        // The one refusal whose cause is not in this PR, and historically the
        // quietest thing here: the merge stopped, the queue stalled, and nothing
        // anywhere said so. Report it BEFORE acting on it, and report it on the
        // override path too — landing on a known-broken tree is the loudest
        // version of the same fact, not an exception to it.
        mainNotice = await notice({ state: 'red', main, head });
        if (mainNotice) log(`  ${describeNotice(mainNotice)}`);
      }
      if (main.blocked && allowRedMain) {
        // The operator's explicit override. Without it a red main is a deadlock:
        // the only way to fix main is to merge a fix, and that merge is refused
        // too. It is opt-in, it is named in the run log and on the PR, and it is
        // the operator's call — not a timeout the driver takes on its own.
        log(`  ⚠️  OVERRIDING a red ${baseBranch} (--allow-red-main): ${main.reason}`);
        return { ...last, baseBranch, mainHealth: 'red', mainOverridden: true, mainReason: main.reason, notice: mainNotice };
      }
      if (main.blocked) {
        return {
          decision: 'refuse',
          scope: 'main',
          mainWaiting: false,
          reason: main.reason,
          failed: main.failed,
          missing: [],
          pending: [],
          mainHealth: main.health,
          notice: mainNotice,
          counts: { runs: runs.length, missing: 0, pending: 0, failed: (main.failed || []).length },
        };
      }
      if (main.waiting) {
        // `main` is mid-verification — the window a break slips through. Hold the
        // merge and ask again after the poll: a verification that concludes green
        // is merged on its result, and one that concludes red is refused by the
        // `blocked` branch above on the next pass. The hold shares the wait
        // budget, so a run that never concludes ends in a refusal and never in a
        // merge through the check it was waiting for.
        if (Date.now() >= deadline) {
          return {
            ...last,
            decision: 'refuse',
            scope: 'main',
            mainWaiting: true,
            reason: `timed out after ${waitSeconds}s while ${baseBranch} finished its post-merge verification — ${main.reason}`,
            timedOut: true,
            mainHealth: main.health,
            mainReason: main.reason,
            failed: [],
            missing: [],
            pending: main.pending || [],
            counts: { runs: runs.length, missing: 0, pending: (main.pending || []).length, failed: 0 },
          };
        }
        log(`  holding: ${main.reason}`);
        await sleep(pollSeconds * 1000);
        continue;
      }
      return { ...last, baseBranch, mainHealth: main.health, mainReason: main.reason, mainWaiting: false };
    }

    if (Date.now() >= deadline) {
      return {
        ...last,
        decision: 'refuse',
        reason: `timed out after ${waitSeconds}s — ${last.reason}`,
        timedOut: true,
      };
    }
    await sleep(pollSeconds * 1000);
  }
}

/**
 * Judge this branch's own diff against what has landed, using the PR body as
 * the declaration source.
 *
 * The judgement is `checkRange`'s — the same pure code the CI step and the
 * post-merge verification run — so the rule has exactly one implementation and
 * three call sites rather than one implementation and three opinions. `base` is
 * passed as `origin/<branch>`: `checkRange` resolves the fork point itself, and
 * judging the branch side (not a two-tree diff against moving main) is what
 * keeps another agent's later commits from reading as this branch's deletions.
 */
export function judgeBranchAgainstLandedWork({ pr, baseBranch = 'main', repo = process.cwd() } = {}) {
  // `origin/<base>` is the ref in CI, where the job checks out a pushed branch.
  // A local clone (or the sensor's scratch repo) has no remote, and judging
  // against the local branch is the same comparison — falling back beats
  // degrading to `unknown` for want of a remote that is not the point.
  let landedRef = `origin/${baseBranch}`;
  try {
    git(repo, 'rev-parse', '--verify', '--quiet', landedRef);
  } catch {
    landedRef = baseBranch;
  }
  const head = String(pr?.head?.sha || '');
  if (!head) return decideBranchUndo({ error: 'the PR has no head SHA to judge', baseBranch });
  try {
    const { violations = [], error = '' } = checkRange(repo, landedRef, head, landedRef, String(pr?.body || ''));
    return decideBranchUndo({ violations, error, baseBranch });
  } catch (err) {
    return decideBranchUndo({ error: err?.message || String(err), baseBranch });
  }
}

function readWorkflow(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function usage() {
  console.log('usage: auto-merge.mjs [--pr=N] [--branch=name] [--repo=owner/name]');
  console.log('                       [--wait=SECONDS] [--poll=SECONDS] [--pr-wait=SECONDS]');
  console.log('                       [--evaluate] [--json]');
  console.log('');
  console.log('Merges an agent/** PR only when every required check has concluded');
  console.log(`success: ${REQUIRED_CHECKS.map((c) => c.name).join(', ')}`);
  console.log('--evaluate decides and prints; it writes nothing (no comment, no merge).');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return 0;
  }

  // A required check no workflow emits is a permanent stall. Refuse to run
  // rather than wait 15 minutes for a name that cannot arrive.
  const validation = validateRequiredAgainstWorkflows({ required: REQUIRED_CHECKS, readWorkflow });
  if (!validation.ok) {
    console.error('auto-merge: the required set no longer matches the workflows:');
    for (const p of validation.problems) console.error(`  - ${p}`);
    return 2;
  }

  // A dispatch with nobody listening is a silent no-op: the merge would succeed,
  // this driver would report success, and `main` would be unverified — the exact
  // state this change exists to end. So a broken safety net stops the merge
  // rather than riding along with it.
  const wiring = validateMainVerifyWiring({ readWorkflow });
  if (!wiring.ok) {
    console.error('auto-merge: the post-merge verification of main has nowhere to run:');
    for (const p of wiring.problems) console.error(`  - ${p}`);
    return 2;
  }

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const repoSlug = args.repo || process.env.GITHUB_REPOSITORY || '';
  const branch = String(args.branch || process.env.GITHUB_REF_NAME || '').replace(/^refs\/heads\//, '');
  const allowRedMain = args.allowRedMain === true || process.env.ALLOW_RED_MAIN === '1';
  const waitSeconds = Number.isFinite(args.wait) ? args.wait : Number(process.env.MERGE_WAIT_SECONDS || DEFAULT_WAIT_SECONDS);
  const pollSeconds = Number.isFinite(args.poll) ? args.poll : DEFAULT_POLL_SECONDS;
  // Separate from the check wait: auto-pr.yml races us to create the PR, so the
  // PR has its own short window and it must be settable (the sensor runs it at 0).
  const prWaitSeconds = Number.isFinite(args.prWait)
    ? args.prWait
    : Number(process.env.MERGE_PR_WAIT_SECONDS || DEFAULT_PR_WAIT_SECONDS);

  if (!repoSlug.includes('/')) {
    console.error('auto-merge: GITHUB_REPOSITORY (or --repo=owner/name) is required');
    return 2;
  }
  if (!token) {
    console.error('auto-merge: GH_TOKEN is not set; refusing to guess at permissions');
    return 2;
  }
  if (!branch && !Number.isFinite(args.pr)) {
    console.error('auto-merge: GITHUB_REF_NAME (or --branch=) is required');
    return 2;
  }

  const [owner, repo] = repoSlug.split('/');
  const client = makeClient({ token, apiBase });
  const log = (line) => console.log(line);

  const pr = Number.isFinite(args.pr)
    ? await client.call(`/repos/${owner}/${repo}/pulls/${args.pr}`)
    : await findOpenPr(client, { owner, repo, branch, waitSeconds: prWaitSeconds });
  if (!pr) {
    log(`auto-merge: no open PR for ${branch}; nothing to do.`);
    return 0;
  }

  const prState = evaluatePrState(pr);
  if (prState.decision !== 'merge') {
    log(`  ${describeDecision(prState, { head: pr.head?.sha })}`);
    if (!args.evaluate) await comment(client, { owner, repo, number: pr.number, body: describeDecision(prState, { head: pr.head?.sha }) });
    return 1;
  }

  // Judge this branch against landed work BEFORE waiting on the checks. The
  // landed-work rule has never had a pre-merge home for this repo's PRs: push
  // `ci` deliberately skips it (no PR body in the event) and auto-pr's
  // token-opened PRs run zero jobs, so the rule was only ever judged after the
  // merge — which is how `d18568f6` turned `main` red and stalled the queue.
  // See scripts/lib/premerge-undo.mjs. An early, precise comment on the PR is
  // worth more than one that arrives after the merge was already attempted.
  const undoBase = String(pr.base?.ref || 'main');
  const undoVerdict = judgeBranchAgainstLandedWork({ pr, baseBranch: undoBase });
  if (undoVerdict.decision === PREMERGE_DECISIONS.REFUSE) {
    log(`  🛑 ${undoVerdict.reason}`);
    if (!args.evaluate) {
      await comment(client, { owner, repo, number: pr.number, body: describePremergeRefusal({ ...undoVerdict, baseBranch: undoBase }) });
    }
    return 1;
  }
  if (undoVerdict.decision === PREMERGE_DECISIONS.UNKNOWN) {
    // Logged, never commented. A degradation signal that shares a channel with
    // the refusal is a signal people learn to skip; the run log is where a
    // broken environment is diagnosed. See scripts/lib/premerge-undo.mjs.
    log(`  ${describePremergeUnknown({ reason: undoVerdict.reason, baseBranch: undoBase })}`);
  }

  const head = String(pr.head?.sha || '');
  const baseBranch = String(pr.base?.ref || 'main');
  log(`auto-merge: PR #${pr.number} (${branch}) head ${head.slice(0, 7)} onto ${baseBranch}`);
  // `--evaluate` writes nothing, and "write nothing" includes not filing an
  // issue: a dry run that raised an alarm would be worse than no dry run.
  const notice = args.evaluate
    ? async () => null
    : ({ state, main }) =>
        syncRedMainNotice({
          call: client.call,
          owner,
          repo,
          state,
          details: {
            mainSha: main.sha || head,
            mainReason: main.reason,
            conclusion: 'failure',
            failed: main.failed || [],
            blockedBy: `PR #${pr.number} (\`${branch}\`)`,
            overridden: allowRedMain,
          },
        });
  const result = await waitForDecision(client, {
    owner, repo, head, baseBranch, allowRedMain, waitSeconds, pollSeconds, log, notice,
    depNumbers: parseDependsOn(pr.body), prNumber: pr.number,
  });

  if (result.decision !== 'merge') {
    const body = [
      describeDecision(result, { head }),
      '',
      result.scope === 'main'
        ? result.mainWaiting
          ? `The merge was held while \`${baseBranch}\` finished its post-merge verification, and the wait budget ran out first. This PR passed its own gates — it is held only until that verification concludes, because merging past an unfinished check is exactly the window a break slips through.`
          : `The merge is held until \`${baseBranch}\` verifies green again. This PR passed its own gates — landing it on a known-broken \`${baseBranch}\` would add a second change to a tree that is already failing, and make the failure harder to attribute.`
        : 'The merge is held until every required check has concluded `success`.',
      result.scope === 'main' ? '' : `Required: ${REQUIRED_CHECKS.map((c) => `\`${c.name}\``).join(', ')}`,
      result.failed?.length ? `Failed: ${result.failed.map((f) => `\`${f}\``).join(', ')}` : '',
      result.pending?.length ? `Still running: ${result.pending.map((f) => `\`${f}\``).join(', ')}` : '',
      result.missing?.length ? `Never reported: ${result.missing.map((f) => `\`${f}\``).join(', ')}` : '',
      // The report has a home, and the person reading this stalled PR should not
      // have to go looking for it.
      result.notice ? `Notice: ${describeNotice(result.notice)}` : '',
      '',
      result.scope === 'main'
        ? result.mainWaiting
          ? `A green verification of \`${baseBranch}\` unblocks this; nothing about this PR needs to change.`
          : `Fix \`${baseBranch}\` first; this PR does not need a new commit.`
        : 'Push a fix (or a new commit) and this runs again on that push.',
    ].filter((l) => l !== '').join('\n');
    if (args.evaluate) log(`[evaluate] would comment on #${pr.number} and NOT merge`);
    else await comment(client, { owner, repo, number: pr.number, body });
    if (args.json) console.log(JSON.stringify(result));
    return 1;
  }

  if (args.evaluate) {
    log(`[evaluate] would merge PR #${pr.number} (${result.reason})`);
    return 0;
  }

  let mergeResult = '';
  let mergeSha = null;
  try {
    // The squash commit is the durable record: `git log` is what the next agent
    // reads, and GitHub mints the squash body from the branch's commit list
    // unless told otherwise — which dropped the PR body's `## Left` on every
    // merge (measured 2026-09-30: 0 of 16 squash commits preserved it). Passing
    // the PR title+body as the squash message keeps Done and Left in history.
    // `commit_message` is omitted when the body is empty so auto-PR bodies with
    // only a trailer do not mint blank squash bodies.
    const mergeBody = { merge_method: 'squash' };
    if (pr.title) mergeBody.commit_title = String(pr.title);
    if (pr.body && String(pr.body).trim()) mergeBody.commit_message = String(pr.body);
    const res = await client.call(`/repos/${owner}/${repo}/pulls/${pr.number}/merge`, {
      method: 'PUT',
      body: mergeBody,
    });
    const merged = res?.merged === true;
    // The merge response carries the commit it created. That is the commit to
    // verify, so it is stated in the dispatch rather than left implicit.
    if (merged) mergeSha = res?.sha ? String(res.sha) : null;
    mergeResult = `merged=${merged} sha=${mergeSha || 'not reported'} message=${res?.message || ''}`;
    if (merged) {
      try {
        await client.call(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' });
        mergeResult += ' | branch deleted';
      } catch (err) {
        mergeResult += ` | branch delete failed: ${err.message}`;
      }
    }
  } catch (err) {
    mergeResult = `merge failed: ${err.message}`;
  }

  const merged = /merged=true/.test(mergeResult);
  const dispatch = merged
    ? await dispatchMainVerify(client, { owner, repo, sha: mergeSha })
    : { ok: false, sha: null, detail: 'the PR did not merge' };
  const dispatchLine = describeDispatch(dispatch);

  log(`  auto-merge on ${head}: ${mergeResult}`);
  log(`  ${baseBranch} at merge time: ${result.mainHealth || 'unknown'}${result.mainReason ? ` (${result.mainReason})` : ''}`);
  log(`  ${dispatchLine}`);
  const overrideNote = result.mainOverridden
    ? `\n\n⚠️ **Merged over a red \`${baseBranch}\`** on the operator's explicit instruction (\`--allow-red-main\`): ${result.mainReason}`
    : '';
  await comment(client, {
    owner, repo, number: pr.number,
    body: `${describeDecision(result, { head })}\n\n\`\`\`\n${mergeResult}\n\`\`\`\n\n${dispatchLine}${overrideNote}`,
  });
  return merged && dispatch.ok ? 0 : 1;
}

/**
 * Ask for the post-merge verification of `main`.
 *
 * Returns an outcome instead of throwing: the merge has already happened by the
 * time this runs, so a failure here cannot be undone — it can only be reported,
 * and it must not be reported as success.
 */
export async function dispatchMainVerify(client, { owner, repo, sha }) {
  const body = buildDispatch(sha);
  const stated = body.client_payload.sha || null;
  try {
    await client.call(dispatchEndpoint(owner, repo), { method: 'POST', body });
    return { ok: true, sha: stated, detail: 'dispatched' };
  } catch (err) {
    return { ok: false, sha: stated, detail: err.message };
  }
}

async function comment(client, { owner, repo, number, body }) {
  try {
    await client.call(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
  } catch (err) {
    // A comment we cannot post is not a reason to merge or to hide the decision.
    console.error(`auto-merge: could not comment on #${number}: ${err.message}`);
  }
}

/**
 * True when this file is the program being run, compared through `realpath`.
 *
 * The usual `argv[1] === import.meta.url` comparison is wrong here, and wrong
 * silently: Node resolves a module's URL to its real path, so any symlinked
 * component (`/var` and `/tmp` on macOS, a checkout symlinked into place) makes
 * the two sides differ, `main()` never runs, and the process exits **0** — which
 * this driver's own exit contract reads as "a merge happened". A driver that
 * reports success without merging is the same fail-open class the rest of this
 * change exists to remove, so it is compared the robust way and the sensor runs
 * the driver through a symlink to keep it that way.
 */
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(entry) === fs.realpathSync(self);
  } catch {
    return path.resolve(entry) === self;
  }
}

if (invokedDirectly()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`auto-merge: ${err?.stack || err}`);
      process.exitCode = 2;
    });
}
