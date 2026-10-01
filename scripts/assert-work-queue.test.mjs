#!/usr/bin/env node
/**
 * assert-work-queue — sensor for the generated work list.
 *
 * scripts/work-queue.mjs builds WORK_QUEUE.md from live PR state so GitHub
 * shows what is ready, in flight, and unowned. EXECUTED with fixture PR
 * JSON (no `gh`, no network): sections, ordering, staleness, carry-over,
 * and the check/write roundtrip are all driven through the real binary.
 *
 * Run: node scripts/assert-work-queue.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyNext, nudgeComment, trailerOf } from './work-queue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'scripts', 'work-queue.mjs');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const NOW = '2026-09-30T12:00:00Z';
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3600 * 1000).toISOString();
const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'work-queue-'));
  dirs.push(d);
  return d;
};

const pr = (n, branch, body, updatedAgoH = 1, extra = {}) => ({
  number: n,
  title: `work ${n}`,
  headRefName: branch,
  body,
  updatedAt: hoursAgo(updatedAgoH),
  author: { login: 'x' },
  ...extra,
});

const run = (dir, args) => {
  try {
    const out = execFileSync('node', [BIN, '--now', NOW, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

const writeRun = (prs, merged) => {
  const dir = tmp();
  const pj = join(dir, 'prs.json');
  const mj = join(dir, 'merged.json');
  writeFileSync(pj, JSON.stringify(prs));
  writeFileSync(mj, JSON.stringify(merged));
  const out = join(dir, 'WORK_QUEUE.md');
  // Offline: tmp is not a repo, so behind() is unknown and every branch reads
  // as gone — the counts asserted below do not depend on git state.
  const r = run(dir, [
    '--write', '--out', out, '--prs-json', pj, '--merged-json', mj, '--repo', dir,
  ]);
  return { dir, out, r };
};

console.log('assert-work-queue:');

// 1. Ready vs blocked split, dependency order.
{
  const open = pr(7, 'agent/a', '## Left\n\nNext: agent/b\n');
  const blocked = pr(8, 'agent/b', '## Left\n\nNext: agent/c\n\nDepends-On: #7\n');
  const { out, r } = writeRun([open, blocked], []);
  const md = readFileSync(out, 'utf8');
  check('write exits 0', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
  check('unblocked PR is Ready', /## Ready to merge \(1\)[\s\S]*#7/.test(md), md.slice(0, 400));
  check('blocked PR is In flight with its blocker', /## In flight \(1\)[\s\S]*#8[\s\S]*#7/.test(md), md.slice(0, 600));
}

// 2. A dependency that already merged satisfies silently.
{
  const open = pr(8, 'agent/b', '## Left\n\nNext: agent/c\n\nDepends-On: #7\n');
  const { out } = writeRun([open], [pr(7, 'agent/a', '## Left\n\nNext: agent/b\n')]);
  const md = readFileSync(out, 'utf8');
  check('merged dep leaves PR Ready', /## Ready to merge \(1\)[\s\S]*#8/.test(md), md.slice(0, 400));
}

// 3. Owner comes from the trailer; missing trailer is explicit.
{
  check('trailer parsed', trailerOf('x\nAuthor: Test Model 1.0 (high) VM\n') === 'Test Model 1.0 (high) VM');
  check('missing trailer explicit', trailerOf('no trailer here') === '(no trailer)');
}

// 4. Carry-over: merged Next: with no owner, resolved three ways.
{
  // (a) open PR on the branch owns it — not carried.
  const owned = writeRun(
    [pr(10, 'agent/owned', '## Left\n\nNext: agent/next\n')],
    [pr(9, 'agent/z', '## Left\n\nNext: agent/owned\n')],
  );
  const mdOwned = readFileSync(owned.out, 'utf8');
  check('owned branch is not carry-over', /## Unowned carry-over \(0\)/.test(mdOwned), mdOwned.slice(0, 500));
  // (b) nothing owns it — carried.
  const bare = writeRun([], [pr(9, 'agent/z', '## Left\n\nNext: agent/orphan\n')]);
  const mdBare = readFileSync(bare.out, 'utf8');
  check('orphan branch is carry-over', /## Unowned carry-over \(1\)[\s\S]*agent\/orphan/.test(mdBare), mdBare.slice(0, 500));
}

// 5. Dangling #pointer resolves to nothing.
{
  const { out } = writeRun([], [pr(9, 'agent/z', '## Left\n\nNext: #999\n')]);
  const md = readFileSync(out, 'utf8');
  check('unresolvable PR pointer is dangling', /## Dangling pointers \(1\)[\s\S]*#999/.test(md), md.slice(0, 500));
}

// 6. Staleness boundary + nudge text.
{
  const fresh = pr(11, 'agent/fresh', '## Left\n\nNext: agent/x\n', 47);
  const stale = pr(12, 'agent/stale', '## Left\n\nNext: agent/y\n\nAuthor: Test Model 1.0 (high) VM\n', 49);
  const dir = tmp();
  const pj = join(dir, 'prs.json');
  const mj = join(dir, 'merged.json');
  writeFileSync(pj, JSON.stringify([fresh, stale]));
  writeFileSync(mj, JSON.stringify([]));
  const r = run(dir, ['--nudge', '--prs-json', pj, '--merged-json', mj]);
  check('47h is not stale, 49h is', r.code === 0 && /#12/.test(r.out) && !/#11/.test(r.out), r.out.slice(0, 300));
  const note = nudgeComment(stale, trailerOf(stale.body));
  check('nudge names the owner and the release', /Test Model 1\.0/.test(note) && /releases the claim/.test(note), note.slice(0, 200));
}

// 7. --check roundtrip: fresh passes, edited file fails.
{
  const dir = tmp();
  const pj = join(dir, 'prs.json');
  const mj = join(dir, 'merged.json');
  writeFileSync(pj, JSON.stringify([pr(7, 'agent/a', '## Left\n\nNext: agent/b\n')]));
  writeFileSync(mj, JSON.stringify([]));
  const out = join(dir, 'WORK_QUEUE.md');
  const w = run(dir, ['--write', '--out', out, '--prs-json', pj, '--merged-json', mj, '--repo', dir]);
  check('write exits 0', w.code === 0, w.out.slice(0, 200));
  const fresh = run(dir, ['--check', '--out', out, '--prs-json', pj, '--merged-json', mj, '--repo', dir]);
  check('fresh check passes', fresh.code === 0, `exit ${fresh.code}: ${fresh.out.slice(0, 200)}`);
  writeFileSync(out, readFileSync(out, 'utf8').replace('Ready to merge', 'Ready-ish'));
  const stale = run(dir, ['--check', '--out', out, '--prs-json', pj, '--merged-json', mj, '--repo', dir]);
  check('edited file fails check', stale.code === 1, `exit ${stale.code}`);
}

// 8. Pointer classification shapes.
{
  check('branch', classifyNext('agent/x').kind === 'branch');
  check('pr', classifyNext('#12').kind === 'pr');
  check('file+section', classifyNext('TUI_TG_AUTH_TRAIL.md#current').kind === 'file');
  check('bare file', classifyNext('plan/ROADMAP.md').kind === 'file');
  check('empty', classifyNext('').kind === 'none');
  check('garbage', classifyNext('someday').kind === 'unknown');
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log('');
console.log(failed === 0 ? `assert-work-queue: ${passed} pass, 0 fail` : `assert-work-queue: ${passed} pass, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
