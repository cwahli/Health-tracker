import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWorktree,
  guardCheckout,
  inspectWorktrees,
  pathsToClose,
  slugToBranch,
} from './agent-worktree.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wt-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wt-bare-'));
  const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-wt-hooks-'));
  git(bare, ['init', '--bare', '-b', 'main']);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', hooks]);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, ['add', 'a.txt']);
  git(root, ['commit', '-m', 'init']);
  git(root, ['remote', 'add', 'origin', bare]);
  git(root, ['push', '-u', 'origin', 'main']);
  return root;
}

test('slug and classify', () => {
  assert.equal(slugToBranch('fleet-four'), 'agent/fleet-four');
  assert.throws(() => slugToBranch('Has Space'));
  assert.equal(classifyWorktree({ path: '/wt/status-all', branch: 'main', primary: true }).kind, 'protected');
  assert.equal(classifyWorktree({ path: '/wt/held', branch: 'agent/bunny-two-pools', ancestor: true }).action, 'keep');
  assert.equal(classifyWorktree({ path: '/wt/d', branch: 'agent/d', dirty: true }).kind, 'dirty-leave');
  assert.equal(classifyWorktree({ path: '/wt/g', branch: 'agent/g', upstreamGone: true }).kind, 'gone-not-unfinished');
  assert.equal(classifyWorktree({ path: '/wt/o', branch: 'agent/o' }).kind, 'open');
  assert.equal(classifyWorktree({ path: '/wt/l', branch: 'agent/l', ancestor: true }).action, 'close');
  assert.equal(classifyWorktree({ path: '/wt/s', branch: 'agent/s', mergedSquash: true }).why, 'clean and the PR was squash-merged');
  assert.equal(guardCheckout({ branch: 'main', dirty: true, path: '/src/Health-tracker' }).ok, false);
  assert.equal(guardCheckout({ branch: 'agent/x', dirty: true, path: '/dev/x' }).ok, true);
});

test('plan leaves dirty, gone, and held worktrees and closes only a clean ancestor', () => {
  const root = initRepo();
  const landed = path.join(root, 'landed');
  const gone = path.join(root, 'gone');
  const dirty = path.join(root, 'dirty');
  const held = path.join(root, 'held');
  git(root, ['worktree', 'add', '-b', 'agent/landed', landed, 'HEAD']);
  git(root, ['worktree', 'add', '-b', 'agent/gone', gone, 'HEAD']);
  fs.writeFileSync(path.join(gone, 'b.txt'), 'b\n');
  git(gone, ['add', 'b.txt']);
  git(gone, ['commit', '-m', 'ahead']);
  git(gone, ['push', '-u', 'origin', 'agent/gone']);
  git(root, ['push', 'origin', '--delete', 'agent/gone']);
  git(root, ['worktree', 'add', '-b', 'agent/dirty', dirty, 'HEAD']);
  fs.writeFileSync(path.join(dirty, 'c.txt'), 'c\n');
  git(root, ['worktree', 'add', '-b', 'agent/bunny-two-pools', held, 'HEAD']);

  const rows = inspectWorktrees(root, { isMerged: () => false });
  const byBranch = Object.fromEntries(rows.map((row) => [row.branch || 'detached', row]));
  assert.equal(byBranch.main.kind, 'protected');
  assert.equal(byBranch['agent/landed'].action, 'close');
  assert.equal(byBranch['agent/gone'].kind, 'gone-not-unfinished');
  assert.equal(byBranch['agent/dirty'].kind, 'dirty-leave');
  assert.equal(byBranch['agent/bunny-two-pools'].kind, 'held');
  assert.deepEqual(pathsToClose(rows).map((p) => fs.realpathSync(p)), [fs.realpathSync(landed)]);

  const squash = inspectWorktrees(root, { isMerged: (branch) => branch === 'agent/gone' });
  const goneRow = squash.find((row) => row.branch === 'agent/gone');
  assert.equal(goneRow.action, 'close');
  assert.equal(goneRow.kind, 'landed');

  const plan = execFileSync(process.execPath, [
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'agent-worktree.mjs'),
    'plan', '--repo', root, '--no-gh',
  ], { encoding: 'utf8' });
  assert.match(plan, /landed\tclose\tagent\/landed/);
  assert.match(plan, /gone-not-unfinished\tleave\tagent\/gone/);
  assert.doesNotMatch(plan, /^removed\t/m);

  execFileSync(process.execPath, [
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'agent-worktree.mjs'),
    'close', '--repo', root, '--no-gh', '--yes',
  ], { encoding: 'utf8' });
  assert.equal(fs.existsSync(landed), false);
  assert.equal(fs.existsSync(gone), true);
  assert.equal(fs.existsSync(dirty), true);
  assert.equal(fs.existsSync(held), true);
  assert.equal(fs.existsSync(path.join(root, '.git')), true);

  const dest = path.join(root, 'fresh');
  const created = execFileSync(process.execPath, [
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'agent-worktree.mjs'),
    'new', 'fresh-lane', '--repo', root, '--dest', dest, '--no-fetch',
  ], { encoding: 'utf8' });
  assert.match(created, /created\tagent\/fresh-lane/);
  assert.equal(git(dest, ['rev-parse', 'HEAD']).trim(), git(root, ['rev-parse', 'origin/main']).trim());
});

test('guard exits 2 on main and 0 on a feature worktree', () => {
  const root = initRepo();
  const feature = path.join(root, 'feature');
  git(root, ['worktree', 'add', '-b', 'agent/feature', feature, 'HEAD']);
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'agent-worktree.mjs');
  assert.throws(() => execFileSync(process.execPath, [cli, 'guard', '--repo', root], { encoding: 'utf8' }));
  const ok = execFileSync(process.execPath, [cli, 'guard', '--repo', feature], { encoding: 'utf8' });
  assert.match(ok, /feature worktree/);
});
