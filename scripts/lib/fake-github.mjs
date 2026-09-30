/**
 * fake-github.mjs — the loopback fake GitHub API the merge-path sensors drive.
 *
 * Shared by `assert-auto-merge.test.mjs` and `assert-main-verify.test.mjs` so
 * both exercise one endpoint surface instead of two copies of it. It is not a
 * general mock: it answers exactly the routes `scripts/auto-merge.mjs` uses and
 * *records every write it is asked for*, because the assertions are about what
 * the driver did (merged? dispatched? commented?) and not about what it returned.
 *
 * That recording is the point. A gate that has never been seen to refuse is a
 * gate nobody should trust, and "did it merge anyway" is only answerable by
 * looking at what the API was actually asked to do.
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DRIVER = path.join(ROOT, 'scripts', 'auto-merge.mjs');

/** The PR head SHA the fake reports. */
export const HEAD_SHA = 'a'.repeat(40);
/** The commit a squash merge creates, as the real merge endpoint reports it. */
export const MERGE_SHA = 'b'.repeat(40);
/** The commit `main` currently points at. */
export const MAIN_SHA = 'e'.repeat(40);

/**
 * What a post-merge verification of `main` reports as, live: `main-verify.yml`
 * calls `ci.yml` through `workflow_call`, so GitHub prefixes the check with the
 * calling job.
 */
export const MAIN_VERIFICATION_NAME = 'gates / tsc + named gates';

/** A `main`-verification check run. */
export const mainRun = (conclusion, status = 'completed') => ({
  name: MAIN_VERIFICATION_NAME,
  status,
  conclusion,
});

/** A green verification of `main`, so tests that do not care about it can pass. */
export const MAIN_GREEN = [mainRun('success')];

export const OPEN_PR = {
  number: 7,
  state: 'open',
  draft: false,
  title: 'fix: green head',
  // Carries a `## Left` section on purpose: the driver must pass the PR body
  // through as the squash message (see auto-merge.mjs), and the default E2E
  // below pins that shape — a body without Left would make the pin vacuous.
  body: '## Summary\n\nGreen head.\n\n## Status\n\nDone.\n\n## Left\n\nNothing left.\n',
  base: { ref: 'main' },
  head: { sha: HEAD_SHA },
};

const ROUTES = {
  prList: /^GET \/repos\/[^/]+\/[^/]+\/pulls$/,
  pr: /^GET \/repos\/[^/]+\/[^/]+\/pulls\/\d+$/,
  gitRef: /^GET \/repos\/[^/]+\/[^/]+\/git\/ref\/heads\//,
  checks: /^GET \/repos\/[^/]+\/[^/]+\/commits\/[^/]+\/check-runs$/,
  merge: /^PUT \/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge$/,
  comment: /^POST \/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/,
  deleteRef: /^DELETE \/repos\/[^/]+\/[^/]+\/git\/refs\/heads\//,
  dispatch: /^POST \/repos\/[^/]+\/[^/]+\/dispatches$/,
  // The red-`main` notice (`scripts/lib/red-main-notice.mjs`). The list route is
  // exact and comes first: it is the only one that is not about a numbered issue.
  issueList: /^GET \/repos\/[^/]+\/[^/]+\/issues$/,
  issueCreate: /^POST \/repos\/[^/]+\/[^/]+\/issues$/,
  issuePatch: /^PATCH \/repos\/[^/]+\/[^/]+\/issues\/\d+$/,
};

/**
 * @param {object}   opts
 * @param {object[]} opts.checkPlans  one check-run list per poll; the last repeats
 * @param {object[]} opts.prs         the open-PR list (null → one open, non-draft PR)
 * @param {string}   opts.mergeSha    the commit the merge reports (`null` to omit it)
 * @param {boolean}  opts.merged      what the merge endpoint answers
 * @param {boolean}  opts.dispatchFails  make `POST /dispatches` a 403
 * @param {object[]} opts.mainChecks  the check runs on `main`'s head
 * @param {object[][]} opts.mainCheckPlans  one list per read of `main`'s checks;
 *   the last repeats. Needed because the interesting state of `main` is a
 *   verification that CONCLUDES between two polls — a single static list can
 *   only ever show one moment of it.
 * @param {object[]} opts.openIssues  what `GET /issues` answers (issues AND pull
 *   requests, as the real endpoint does, so the callers' filtering is exercised)
 * @param {boolean}  opts.issueFails  make every issue route a 403, so the
 *   "could not report" path is drivable and not just claimed
 * @param {object}   opts.pullStates  per-number PR overrides for `GET
 *   /pulls/:n` (dependency states), merged over the default open PR
 * @param {object}   opts.pullPlans  per-number state SEQUENCES for
 *   `GET /pulls/:n`: each read shifts one entry (last repeats), so a
 *   dependency can be open on the first poll and merged on the next —
 *   the transition the hold exists for
 */
export function startFakeGitHub({
  checkPlans = [[]],
  prs = null,
  mergeSha = MERGE_SHA,
  merged = true,
  dispatchFails = false,
  mainChecks = MAIN_GREEN,
  mainCheckPlans = null,
  openIssues = [],
  issueFails = false,
  pullStates = {},
  pullPlans = {},
} = {}) {
  const calls = {
    merge: [],
    comments: [],
    deleted: [],
    dispatches: [],
    checkPolls: 0,
    checkQueries: [],
    mainCheckReads: 0,
    prListReads: 0,
    issueListReads: 0,
    issuesCreated: [],
    issueComments: [],
    issuesClosed: [],
  };
  const plans = [...checkPlans];
  const mainPlans = mainCheckPlans ? [...mainCheckPlans] : null;
  // Created issues are appended, so a second create is visible as a second issue
  // rather than silently overwriting the first — the duplicate is the bug.
  const issues = [...openIssues];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const route = `${req.method} ${url.pathname}`;
      const json = () => {
        try {
          return JSON.parse(body || '{}');
        } catch {
          return {};
        }
      };

      if (ROUTES.prList.test(route)) {
        calls.prListReads += 1;
        return send(200, prs === null ? [OPEN_PR] : prs);
      }
      if (ROUTES.pr.test(route)) {
        const n = Number(url.pathname.split('/').pop());
        const base = (prs && prs[0]) || OPEN_PR;
        const plan = pullPlans[n];
        if (plan && plan.length) {
          const state = plan.length > 1 ? plan.shift() : plan[0];
          return send(200, { ...base, number: n, ...state });
        }
        if (Number.isFinite(n) && pullStates[n]) return send(200, { ...base, number: n, ...pullStates[n] });
        return send(200, base);
      }
      if (ROUTES.gitRef.test(route)) return send(200, { object: { sha: MAIN_SHA } });
      if (ROUTES.checks.test(route)) {
        // Main's head is a different commit from the PR head, and the driver reads
        // both: `main-verify`'s result is what decides whether main is safe to
        // land on. Answering the same list for both would hide that.
        const ref = url.pathname.split('/')[5];
        if (ref === MAIN_SHA) {
          calls.mainCheckReads += 1;
          // A sequence, when one is given: `main` is re-read while it is being
          // verified, and the whole point of that re-read is that the answer
          // changes. A fixed list would make the driver's behaviour at the
          // transition — the part that matters — unobservable.
          const plan = mainPlans ? (mainPlans.length > 1 ? mainPlans.shift() : mainPlans[0]) : mainChecks;
          return send(200, { total_count: plan.length, check_runs: plan });
        }
        const plan = plans.length > 1 ? plans.shift() : plans[0];
        calls.checkPolls += 1;
        // Recorded so the `filter=all` requirement is exercised, not trusted: the
        // endpoint's default (`latest`) can collapse a red run of a required name
        // behind a greener one, which is the blindness being fixed.
        calls.checkQueries.push(url.searchParams.get('filter'));
        return send(200, { total_count: plan.length, check_runs: plan });
      }
      if (ROUTES.merge.test(route)) {
        calls.merge.push(json());
        return send(200, {
          merged,
          message: merged ? 'Pull Request successfully merged' : 'Pull Request is not mergeable',
          ...(mergeSha ? { sha: mergeSha } : {}),
        });
      }
      if (ROUTES.comment.test(route)) {
        // One endpoint serves both, so the recording has to tell them apart: a
        // comment on the PR under judgement is what the merge assertions count,
        // and a comment on the standing red-`main` issue is a different fact.
        // Splitting them is what makes "it created ONE issue and did not pile up
        // a second" and "it posted exactly one PR comment" both checkable.
        const number = Number(url.pathname.split('/')[5]);
        const prNumber = prs === null ? OPEN_PR.number : prs[0] && prs[0].number;
        const body = json().body || '';
        if (number === prNumber) calls.comments.push(body);
        else calls.issueComments.push(body);
        return send(201, { id: 1 });
      }
      if (ROUTES.deleteRef.test(route)) {
        calls.deleted.push(url.pathname);
        return send(204, {});
      }
      if (ROUTES.dispatch.test(route)) {
        if (dispatchFails) return send(403, { message: 'Resource not accessible by integration' });
        calls.dispatches.push(json());
        return send(204, {});
      }
      if (ROUTES.issueList.test(route)) {
        calls.issueListReads += 1;
        if (issueFails) return send(403, { message: 'Resource not accessible by integration' });
        return send(200, issues);
      }
      if (ROUTES.issueCreate.test(route)) {
        if (issueFails) return send(403, { message: 'Resource not accessible by integration' });
        const body = json();
        // Numbered off the count SO FAR, so the first issue this fake ever creates
        // is #100 in every test rather than wherever a previous create left it.
        const number = 100 + calls.issuesCreated.length;
        calls.issuesCreated.push(body);
        const created = {
          number,
          state: 'open',
          html_url: `https://example.invalid/issues/${number}`,
          title: body.title,
          body: body.body,
        };
        issues.push(created);
        return send(201, created);
      }
      if (ROUTES.issuePatch.test(route)) {
        const number = Number(url.pathname.split('/').pop());
        if (issueFails) return send(403, { message: 'Resource not accessible by integration' });
        calls.issuesClosed.push(number);
        const found = issues.find((i) => i.number === number);
        if (found) found.state = json().state || 'closed';
        return send(200, found || { number, state: 'closed' });
      }
      return send(404, { message: `no fake route for ${route}` });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        calls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * Run a merge driver as a real child process, pointed at the fake API.
 *
 * `driver` is a parameter because one sensor also runs the driver out of a
 * scratch tree, to prove the startup guards read the workflows they claim to.
 */
export function runDriver(port, extraArgs = [], {
  driver = DRIVER,
  cwd = ROOT,
  env: extraEnv = {},
  token = 'fake-token',
  // `--pr-wait=0`: the fake API answers the PR lookup on the first call, so the
  // 90s auto-pr race window would only make the sensor slow. Overridable because
  // the notice worker (`scripts/notify-main-red.mjs`) is spawned the same way and
  // knows none of these flags.
  defaultArgs = ['--poll=0', '--pr-wait=0'],
} = {}) {
  const env = {
    ...process.env,
    GITHUB_API_URL: `http://127.0.0.1:${port}`,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_REF_NAME: 'agent/x',
    ...extraEnv,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  if (token) env.GH_TOKEN = token;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [driver, ...defaultArgs, ...extraArgs], { env, cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
