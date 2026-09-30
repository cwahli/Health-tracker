#!/usr/bin/env node
/**
 * assert-pr-summary — sensor for the PR body contract.
 *
 * The contract (scripts/assert-pr-summary.mjs): trailer + non-empty
 * ## Summary/Status/Left + a `Next:` continuation pointer in ## Left.
 * Executed: each case runs the real binary with a PR_BODY env value.
 *
 * Run: node scripts/assert-pr-summary.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'scripts', 'assert-pr-summary.mjs');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const run = (body) => {
  try {
    const out = execFileSync('node', [BIN], {
      encoding: 'utf8',
      env: { ...process.env, PR_BODY: body },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

const TRAILER = 'Author: Test Model 1.0 (high) VM\n';
const good = (left) =>
  `## Summary\n\nDoes the thing.\n\n## Status\n\nDone.\n\n## Left\n\n${left}\n\n${TRAILER}`;

console.log('assert-pr-summary:');

// 1. Full contract with each accepted pointer shape.
for (const next of [
  'Next: TUI_TG_AUTH_TRAIL.md#live-state-left-for-you',
  'Next: plan/ROADMAP.md#current-work-one-sequence-2026-09-26',
  'Next: agent/tui-lifecycle',
  'Next: #369',
]) {
  const r = run(good(`- remaining bit\n\n${next}`));
  check(`pointer shape passes: ${next}`, r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
}

// 2. Left without a pointer fails, and says what to write.
{
  const r = run(good('- remaining bit, somewhere'));
  check('Left without Next: fails', r.code === 1, `exit ${r.code}`);
  check('the failure shows the format', /Next: <trail-file/.test(r.out), r.out.slice(0, 300));
}

// 3. A bare `Next:` with no target fails (whitespace-normalised check would
//    otherwise accept the skeleton unfilled).
{
  const r = run(good('Next:'));
  check('bare Next: fails', r.code === 1, `exit ${r.code}`);
}

// 4. Auto-PR body (managed block + trailer, no sections) still fails.
{
  const r = run(`<!-- auto-pr:start -->\n- fix: a thing\n<!-- auto-pr:end -->\n\n${TRAILER}`);
  check('section-less auto-PR body fails', r.code === 1, `exit ${r.code}`);
}

// 5. Legacy prefix and n/a level still rejected (prior rule, pinned).
{
  const badPrefix = good('- x\n\nNext: #1').replace(/^Author: /m, 'Agent: ');
  check('Agent: prefix rejected', run(badPrefix).code === 1);
  const badLevel = good('- x\n\nNext: #1').replace('(high)', '(n/a)');
  check('n/a level rejected', run(badLevel).code === 1);
}

// 6. Pointer resolvability: roadmap anchors and files must exist.
{
  const anchor = 'plan/ROADMAP.md#current-work-one-sequence-2026-09-26';
  const r = run(good(`- x\n\nNext: ${anchor}`));
  check('real roadmap anchor passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
  const bad = run(good('- x\n\nNext: plan/ROADMAP.md#no-such-row'));
  check('missing anchor fails', bad.code === 1, `exit ${bad.code}`);
  check('missing anchor names candidates', /no such section/.test(bad.out), bad.out.slice(0, 300));
  const nofile = run(good('- x\n\nNext: docs/no-such-file.md'));
  check('missing file fails', nofile.code === 1, `exit ${nofile.code}`);
  const barefile = run(good('- x\n\nNext: TUI_TG_AUTH_TRAIL.md'));
  check('existing file without section passes', barefile.code === 0, `exit ${barefile.code}: ${barefile.out.slice(0, 200)}`);
}

console.log('');
console.log(failed === 0 ? `assert-pr-summary: ${passed} pass, 0 fail` : `assert-pr-summary: ${passed} pass, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
