#!/usr/bin/env node
/**
 * notify-main-red.mjs — report a red `main` from the workflow that found it.
 *
 * This is the entry point `.github/workflows/main-verify.yml` runs as its own
 * `notice` job, beside the gate instead of inside it. That separation is
 * deliberate: a notification bug must be able to fail loudly on its own without
 * turning a green verification of `main` red, and it must be able to run when
 * the gate failed — which is precisely the case it exists for.
 *
 * It takes the gate's own JOB RESULT rather than a verdict of its own, and
 * `lib/red-main-notice.mjs` decides what that result means. `success` clears the
 * notice; `failure` raises it; `cancelled` and `skipped` are ignored, because a
 * superseded verification is not a broken `main` (see that file's header). The
 * driver `scripts/auto-merge.mjs` shares the same module, so the two paths can
 * disagree about when to speak but not about what to say.
 *
 * Usage (in Actions):
 *   node scripts/notify-main-red.mjs --result="$GATE_RESULT" --sha="$GITHUB_SHA"
 *
 * Env: GH_TOKEN (or GITHUB_TOKEN), GITHUB_API_URL, GITHUB_REPOSITORY.
 *
 * Exit codes: 0 reported, or nothing to report; 1 could not report;
 * 2 the entry point itself refused to run.
 *
 * The wiring is checked before anything else, for the reason the rest of this
 * merge path checks its own: a notifier that cannot notify is the silent no-op
 * being removed, so it refuses rather than reporting "nothing to report" while
 * `main` is red.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { makeClient } from './lib/github-rest.mjs';
import {
  NOTICE_ACTIONS,
  describeNotice,
  resultToState,
  syncRedMainNotice,
  validateNoticeWiring,
} from './lib/red-main-notice.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export function parseArgs(argv = []) {
  const args = { result: '', sha: '', repo: '' };
  for (const raw of argv) {
    const arg = String(raw);
    if (arg.startsWith('--result=')) args.result = arg.slice(9);
    else if (arg.startsWith('--sha=')) args.sha = arg.slice(6);
    else if (arg.startsWith('--repo=')) args.repo = arg.slice(7);
  }
  return args;
}

function readWorkflow(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function usage() {
  console.log('usage: notify-main-red.mjs --result=<job result> [--sha=<commit>] [--repo=owner/name]');
  console.log('');
  console.log("Reports `main`'s post-merge verification: raises the standing issue when the gate");
  console.log('failed, closes it when the gate passed, and does nothing for cancelled/skipped.');
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return 0;
  }
  const args = parseArgs(argv);

  const wiring = validateNoticeWiring({ readWorkflow });
  if (!wiring.ok) {
    console.error('notify-main-red: the notice has nowhere to land or nothing to file it with:');
    for (const problem of wiring.problems) console.error(`  - ${problem}`);
    return 2;
  }

  const state = resultToState(args.result);
  if (state === 'ignore') {
    console.log(
      `main's verification result was "${args.result || '(empty)'}" — not red and not green, so nothing is reported`,
    );
    return 0;
  }

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const repoSlug = args.repo || process.env.GITHUB_REPOSITORY || '';
  if (!repoSlug.includes('/')) {
    console.error('notify-main-red: GITHUB_REPOSITORY (or --repo=owner/name) is required');
    return 2;
  }
  if (!token) {
    console.error('notify-main-red: GH_TOKEN is not set; refusing to guess at permissions');
    return 2;
  }

  const [owner, repo] = repoSlug.split('/');
  const client = makeClient({ token, apiBase });
  const outcome = await syncRedMainNotice({
    call: client.call,
    owner,
    repo,
    state,
    details: {
      mainSha: args.sha,
      mainReason:
        state === 'red'
          ? `the post-merge verification of ${String(args.sha || 'main').slice(0, 7)} concluded failure`
          : '',
      conclusion: state === 'red' ? 'failure' : 'success',
    },
  });

  if (!NOTICE_ACTIONS.includes(outcome.action)) {
    console.error(`notify-main-red: ${describeNotice(outcome)}`);
    return 2;
  }
  return outcome.action === 'failed' ? 1 : 0;
}

/**
 * True when this file is the program being run, compared through `realpath`.
 *
 * The `argv[1] === import.meta.url` comparison is wrong on any symlinked path
 * component (`/var` and `/tmp` on macOS, a symlinked checkout — how the VPS lays
 * out worktrees): the sides differ, `main()` never runs, and the process exits
 * **0**. For a notifier that is the worst possible answer, because this file's
 * exit code is read as "the report was made". The sibling script carries the
 * same guard for the same reason.
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
      console.error(`notify-main-red: ${err?.stack || err}`);
      process.exitCode = 2;
    });
}
