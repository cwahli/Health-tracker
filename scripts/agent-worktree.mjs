#!/usr/bin/env node
/**
 * node scripts/agent-worktree.mjs new <slug> [--dest path] [--no-fetch]
 * node scripts/agent-worktree.mjs plan [--no-gh]
 * node scripts/agent-worktree.mjs close [--yes] [--no-gh]
 * node scripts/agent-worktree.mjs guard
 *
 * `plan` only prints. `close` removes a worktree only with --yes, and only
 * when plan says close. It never removes main, the primary checkout,
 * ~/dev/status-all, a dirty tree, a named hold, or a branch that is not on
 * main.
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  guardCheckout,
  inspectWorktrees,
  newWorktree,
  pathsToClose,
  git,
} from './lib/agent-worktree.mjs';

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || '';
}

function ghMerged(branch) {
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'list', '--repo', 'cwahli/Health-tracker', '--head', branch, '--state', 'merged', '--json', 'number', '--limit', '1'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const rows = JSON.parse(out || '[]');
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

function printPlan(rows) {
  for (const row of rows) {
    const name = row.branch || (row.detached ? 'detached' : '(no branch)');
    const sha = String(row.head || '').slice(0, 8);
    console.log(`${row.kind}\t${row.action}\t${name}\t${sha}\t${row.path}\t${row.why}`);
  }
}

function cmdPlan(repo, noGh) {
  const rows = inspectWorktrees(repo, { isMerged: noGh ? () => false : ghMerged });
  printPlan(rows);
  return rows;
}

function cmdClose(repo, { yes, noGh }) {
  const rows = cmdPlan(repo, noGh);
  const paths = pathsToClose(rows);
  if (!paths.length) {
    console.log('close: nothing to remove');
    return;
  }
  if (!yes) {
    console.log('close: dry run. Pass --yes to remove the close rows above.');
    return;
  }
  for (const worktreePath of paths) {
    git(repo, ['worktree', 'remove', worktreePath]);
    console.log(`removed\t${worktreePath}`);
  }
}

function cmdNew(repo, argv) {
  const slug = argv.find((a) => !a.startsWith('-') && a !== 'new');
  if (!slug) {
    throw new Error('usage: node scripts/agent-worktree.mjs new <slug> [--dest path] [--no-fetch]');
  }
  const dest = argValue(argv, '--dest') || path.join(os.homedir(), 'dev', slug.replace(/^agent\//, ''));
  const created = newWorktree(repo, slug, dest, { fetch: !argv.includes('--no-fetch') });
  console.log(`created\t${created.branch}\t${created.dest}`);
}

function cmdGuard(cwd) {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(cwd, ['status', '--porcelain']).length > 0;
  const rows = git(cwd, ['worktree', 'list', '--porcelain']);
  const primary = (rows.match(/^worktree (.+)$/m) || [])[1] || '';
  const here = git(cwd, ['rev-parse', '--show-toplevel']);
  const verdict = guardCheckout({
    branch,
    dirty,
    primary: here === primary,
    path: here,
  });
  console.log(verdict.why);
  if (!verdict.ok) process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const repo = argValue(argv, '--repo') || process.cwd();
  if (cmd === 'plan') cmdPlan(repo, argv.includes('--no-gh'));
  else if (cmd === 'close') cmdClose(repo, { yes: argv.includes('--yes'), noGh: argv.includes('--no-gh') });
  else if (cmd === 'new') cmdNew(repo, argv);
  else if (cmd === 'guard') cmdGuard(repo);
  else {
    console.error('usage: node scripts/agent-worktree.mjs <new|plan|close|guard>');
    process.exit(2);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
