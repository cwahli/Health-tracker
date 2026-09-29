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
  evaluatePrState,
  validateRequiredAgainstWorkflows,
} from './lib/merge-gate.mjs';

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

/** A tiny REST client. `apiBase` is the seam the sensor uses. */
export function makeClient({ token, apiBase, fetchImpl = globalThis.fetch } = {}) {
  const base = String(apiBase || 'https://api.github.com').replace(/\/$/, '');
  return {
    base,
    async call(pathname, { method = 'GET', body } = {}) {
      const res = await fetchImpl(`${base}${pathname}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'health-tracker-auto-merge',
          'x-github-api-version': '2022-11-28',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const detail = json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
        const err = new Error(`${method} ${pathname} -> HTTP ${res.status} ${detail}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return json;
    },
  };
}

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
 * Wait for a decision, asking the gate after each poll.
 *
 * `waitSeconds` bounds the whole wait. Exhausting it is a REFUSE, not a merge:
 * the PR stays open and the comment says which required check never reported.
 */
export async function waitForDecision(client, {
  owner,
  repo,
  head,
  waitSeconds = DEFAULT_WAIT_SECONDS,
  pollSeconds = DEFAULT_POLL_SECONDS,
  log = () => {},
} = {}) {
  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let last = null;
  for (;;) {
    const runs = await listCheckRuns(client, { owner, repo, ref: head });
    last = evaluateChecks({ checkRuns: runs, required: REQUIRED_CHECKS });
    log(`  ${describeDecision(last, { head })}`);
    if (last.decision !== 'wait') return last;
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

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const repoSlug = args.repo || process.env.GITHUB_REPOSITORY || '';
  const branch = String(args.branch || process.env.GITHUB_REF_NAME || '').replace(/^refs\/heads\//, '');
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

  const head = String(pr.head?.sha || '');
  log(`auto-merge: PR #${pr.number} (${branch}) head ${head.slice(0, 7)}`);
  const result = await waitForDecision(client, { owner, repo, head, waitSeconds, pollSeconds, log });

  if (result.decision !== 'merge') {
    const body = [
      describeDecision(result, { head }),
      '',
      'The merge is held until every required check has concluded `success`.',
      `Required: ${REQUIRED_CHECKS.map((c) => `\`${c.name}\``).join(', ')}`,
      result.failed?.length ? `Failed: ${result.failed.map((f) => `\`${f}\``).join(', ')}` : '',
      result.pending?.length ? `Still running: ${result.pending.map((f) => `\`${f}\``).join(', ')}` : '',
      result.missing?.length ? `Never reported: ${result.missing.map((f) => `\`${f}\``).join(', ')}` : '',
      '',
      'Push a fix (or a new commit) and this runs again on that push.',
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
  try {
    const res = await client.call(`/repos/${owner}/${repo}/pulls/${pr.number}/merge`, {
      method: 'PUT',
      body: { merge_method: 'squash' },
    });
    mergeResult = `merged=${res?.merged === true} message=${res?.message || ''}`;
    if (res?.merged) {
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

  log(`  auto-merge on ${head}: ${mergeResult}`);
  await comment(client, {
    owner, repo, number: pr.number,
    body: `${describeDecision(result, { head })}\n\n\`\`\`\n${mergeResult}\n\`\`\``,
  });
  return /merged=true/.test(mergeResult) ? 0 : 1;
}

async function comment(client, { owner, repo, number, body }) {
  try {
    await client.call(`/repos/${owner}/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
  } catch (err) {
    // A comment we cannot post is not a reason to merge or to hide the decision.
    console.error(`auto-merge: could not comment on #${number}: ${err.message}`);
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`auto-merge: ${err?.stack || err}`);
      process.exitCode = 2;
    });
}
