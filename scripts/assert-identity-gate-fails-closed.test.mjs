#!/usr/bin/env node
/**
 * The author-identity gate must fail closed, and must actually judge a merge.
 *
 * Two defects this exists to prevent, both found on 2026-09-29:
 *
 * 1. `main-verify` (#349) dispatches a `repository_dispatch` after every merge,
 *    because GitHub suppresses workflows for token-driven pushes. That event has
 *    no `before`, so ci.yml's fallback resolved to `origin/main` == HEAD, the
 *    range came out EMPTY, and check-agent-identity printed "no new commits"
 *    and exited 0. Every squash landing on main was therefore unverified for
 *    author identity — the one thing that gate exists for. A trailer-less
 *    squash (76104b4) sat on main through it.
 * 2. An empty range passed unconditionally, so a caller that could not tell
 *    "nothing new" from "I looked at the wrong range" got 0 for both.
 *
 * The fix has two halves, and each half is useless without the other: ci.yml
 * derives `before` from the merge's own parent, and the script refuses an empty
 * range unless the caller passes --allow-empty (which only the PR path does,
 * where an empty range really does mean "nothing to do").
 *
 * Run: node scripts/assert-identity-gate-fails-closed.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'check-agent-identity.sh');
const CI_WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const git = (cwd, ...argv) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const runGate = (cwd, ...argv) => {
  try {
    execFileSync('sh', [SCRIPT, ...argv], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: '' };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout || '') + String(err.stderr || '') };
  }
};

const dirs = [];
/** A repo with a compliant base, a trailer-less commit, and a good one. */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'identity-gate-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'gate test');
  git(dir, 'config', 'user.email', 'gate@test');
  writeFileSync(join(dir, 'file.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const commit = (dir, file, text, message) => {
  writeFileSync(join(dir, file), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
};

console.log('assert-identity-gate-fails-closed:');

// 1. The headline: an empty range is refused, because "already on the base" and
//    "the range was wrong" must not share an answer.
{
  const dir = scratchRepo();
  const base = git(dir, 'rev-parse', 'HEAD');
  const r = runGate(dir, '--range', `${base}..HEAD`);
  check('an empty range is refused by default', r.code === 1, `exit ${r.code}`);
  check('the refusal explains both causes', /already on the base/.test(r.out) && /resolved to nothing/.test(r.out), r.out);
  check('the refusal names the flag', /--allow-empty/.test(r.out), r.out);
}

// 2. With the flag, it passes — the PR path's legitimate case.
{
  const dir = scratchRepo();
  const base = git(dir, 'rev-parse', 'HEAD');
  const r = runGate(dir, '--range', `${base}..HEAD`, '--allow-empty');
  check('an empty range passes with --allow-empty', r.code === 0, `exit ${r.code}`);
}

// 3. A non-empty range is judged either way: a compliant commit passes, and a
//    trailer-less one fails. Guards against "allow-empty" being used to excuse
//    a range that was never empty.
{
  const dir = scratchRepo();
  const base = git(dir, 'rev-parse', 'HEAD');
  commit(dir, 'file.txt', 'b\n', 'fix: something\n\nAuthor: Grok 4.7 (High) VM\n');
  const good = runGate(dir, '--range', `${base}..HEAD`);
  check('a compliant commit in a real range passes', good.code === 0, good.out);

  // A separate repo: reusing the compliant range would prove nothing, since
  // the good commit would be the only thing judged.
  const dir2 = scratchRepo();
  const base2 = git(dir2, 'rev-parse', 'HEAD');
  commit(dir2, 'file.txt', 'b\n', 'fix: something with no identity\n');
  const bad = runGate(dir2, '--range', `${base2}..HEAD`, '--allow-empty');
  check('--allow-empty does not excuse a bad commit in a real range', bad.code === 1, `exit ${bad.code}`);
}

// 4. The actual 2026-09-29 shape: a trailer-less SQUASH on main. Judged with
//    the merge's own parent as `before` — what the fixed ci.yml derives from
//    client_payload.sha — it must fail, where the empty-range bug passed it.
{
  const dir = scratchRepo();
  const parent = git(dir, 'rev-parse', 'HEAD');
  const sha = commit(dir, 'file.txt', 'c\n', 'fix(r14.1): surface canary failure reason instead of "(unknown reason)" (#346)\n');
  const r = runGate(dir, '--range', `${parent}..${sha}`);
  check('a trailer-less squash is rejected when judged', r.code === 1, `exit ${r.code}`);
  check('the rejection names the required line', /Author: <model and version>/.test(r.out), r.out);
}

// 5. The workflow half. This is a shell-script bug, so a unit test alone proves
//    nothing: the defect lived in ci.yml's event handling, where no unit test
//    reached. These are tripwires on the wiring, in the same style as the rest
//    of the repo's workflow sensors.
{
  const ci = readFileSync(CI_WORKFLOW, 'utf8');

  check('ci.yml handles repository_dispatch', /github\.event_name.*=.*repository_dispatch|repository_dispatch/.test(ci));
  check('ci.yml reads the dispatched sha', /client_payload\.sha/.test(ci));
  check('ci.yml derives before from the landed commit parent', /rev-parse "\$landed\^"/.test(ci));
  check('ci.yml never falls back silently on a dispatch', /no client_payload\.sha/.test(ci) && /::warning::/.test(ci));

  // The PR path may pass --allow-empty; the push and post-merge paths must not.
  // Read each invocation as a whole backslash-continued command, not a single
  // line: a regex that stops at `--range` misses the flags that follow, which
  // is exactly the flag under test.
  const calls = [];
  const lines = ci.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i];
    if (!start.includes('check-agent-identity.sh')) continue;
    // Walk forward by index. Matching on the line's TEXT would jump back to
    // an identical earlier line, which is exactly the case here: the two call
    // sites start with the same string.
    const block = [start];
    let j = i;
    while (lines[j].trimEnd().endsWith('\\') && j + 1 < lines.length) {
      j += 1;
      block.push(lines[j]);
    }
    calls.push(block.join('\n'));
  }
  const rangeCalls = calls.filter((c) => c.includes('--range'));
  const withFlag = rangeCalls.filter((c) => c.includes('--allow-empty'));
  const withoutFlag = rangeCalls.filter((c) => !c.includes('--allow-empty'));
  check('ci.yml has two --range identity-gate call sites', rangeCalls.length === 2, `found ${rangeCalls.length}`);
  check('exactly one call site allows an empty range', withFlag.length === 1, `${withFlag.length} allow it`);
  check('the allow-empty call site is the PR one (it uses --not)', withFlag[0]?.includes('--not'), withFlag[0]);
  check('the other call site allows nothing', withoutFlag.length === 1 && !/--allow-empty/.test(withoutFlag[0]));
}

// 6. The `Author:` rename is a gate, not a suggestion. The old regex accepted
//    either prefix, so nothing stopped an agent writing `Agent:` forever.
{
  const dir = scratchRepo();
  const base = git(dir, 'rev-parse', 'HEAD');
  const now = commit(dir, 'file.txt', 'b\n', 'fix: x\n\nAgent: Grok 4.7 (High) VM\n');
  // Force the author date past PREFIX_SINCE so the new-commit rule applies.
  const recent = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  execFileSync('git', ['commit', '--amend', '--no-edit', '--date', recent], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_COMMITTER_DATE: recent },
  });
  const r = runGate(dir, '--range', `${base}..HEAD`);
  check('a new commit with the legacy Agent: prefix is rejected', r.code === 1, `exit ${r.code}`);
  check('the rejection names the rename and the cutoff', /legacy 'Agent:'/.test(r.out) && /#325/.test(r.out), r.out);
  check('the rejection says how to fix it', /amend/i.test(r.out), r.out);
}

// 7. The same trailer, authored BEFORE the cutoff, still lands. Otherwise the
//    rename would strand every branch already in flight.
{
  const dir = scratchRepo();
  const base = git(dir, 'rev-parse', 'HEAD');
  commit(dir, 'file.txt', 'b\n', 'fix: x\n\nAgent: Grok 4.7 (High) VM\n');
  const old = '2026-09-20T10:00:00Z';
  execFileSync('git', ['commit', '--amend', '--no-edit', '--date', old], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_COMMITTER_DATE: old },
  });
  const r = runGate(dir, '--range', `${base}..HEAD`);
  check('the same trailer is accepted when authored before the cutoff', r.code === 0, r.out || `exit ${r.code}`);
}

// 8. A thinking level must be a word. `n/a` reads as "nobody looked", which is
//    the failure the field exists to prevent; `none` is an honest word.
{
  const cases = [
    ['Author: Space Bunny Free (n/a) VM', false, 'n/a is not a thinking level'],
    ['Author: Space Bunny Free (none) VM', true, null],
    ['Author: Space Bunny Free (max) VM', true, null],
    ['Author: Grok 4.7 (High) Mac', true, null],
    ['Author: Muse Spark 1.3 Contributor (xhigh) VM', true, null],
    ['Author: DeepSeek 4.1 flash (high) VM', true, null],
  ];
  for (const [trailer, wantPass, why] of cases) {
    const body = `## Summary\n\nx\n\n## Status\n\nx\n\n## Left\n\nx\n\n${trailer}\n`;
    const file = join(mkdtempSync(join(tmpdir(), 'identity-body-')), 'body.md');
    writeFileSync(file, body);
    let code = 0;
    try {
      execFileSync('sh', [SCRIPT, '--message', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) { code = err.status ?? 1; }
    dirs.push(join(file, '..'));
    check(why || `accepts ${trailer}`, (code === 0) === wantPass, `exit ${code}`);
  }
}

// 9. A PR body is written now, so it gets the strict shape: Author:, a real
//    level, and a location. The legacy prefix and the no-location shape are both
//    commit-level grace, never body-level.
{
  const cases = [
    ['Agent: Grok 4.7 (High) VM', false, 'a PR body must use Author:'],
    ['Author: Grok 4.7 (High)', false, 'a PR body must name a location'],
    ['Author: Grok 4.7 (n/a) VM', false, 'a PR body must not say n/a'],
    ['Author: Grok 4.7 (High) VM', true, null],
  ];
  for (const [trailer, wantPass, why] of cases) {
    const body = `## Summary\n\nx\n\n## Status\n\nx\n\n## Left\n\nx\n\n${trailer}\n`;
    const file = join(mkdtempSync(join(tmpdir(), 'identity-body2-')), 'body.md');
    writeFileSync(file, body);
    let code = 0;
    try {
      execFileSync('sh', [SCRIPT, '--message', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) { code = err.status ?? 1; }
    dirs.push(join(file, '..'));
    check(why || `accepts body ${trailer}`, (code === 0) === wantPass, `exit ${code}`);
  }
}

// 10. Sibling producers. A rule that only the regex knows about is a rule the
//     tools that commit for an agent will break on, and the breakage lands in a
//     dispatch nobody is watching.
{
  const dispatch = readFileSync(join(ROOT, 'scripts', 'run-coding-dispatch.sh'), 'utf8');
  const collab = readFileSync(join(ROOT, 'scripts', 'collab-bot.mjs'), 'utf8');
  check('run-coding-dispatch commits an Author: trailer', dispatch.includes('-m "Author: $AGENT_IDENTITY"'));
  check('run-coding-dispatch no longer commits an Agent: trailer', !dispatch.includes('-m "Agent: $AGENT_IDENTITY"'));
  // The gate's own pattern, not a shell case: a case matched `n/a` (it checks
  // shape, not that the level is a word) and passed a commit the gate would
  // then reject. Pinned so the two cannot drift.
  const GATE_SHAPE = '^Author: [^ ].+ \\([A-Za-z][A-Za-z0-9._-]*\\) [A-Za-z0-9][A-Za-z0-9._-]*$';
  check('run-coding-dispatch validates with the gate pattern', dispatch.includes(`grep -Eq '${GATE_SHAPE}'`));
  // The identity text carries NO prefix — the commit adds it. Grepping the raw
  // value against a prefix-anchored pattern rejects everything, which a
  // source-text check cannot see: only running it does.
  check('run-coding-dispatch validates the line the commit will carry',
    dispatch.includes(`printf 'Author: %s\\n' "$AGENT_IDENTITY"`));
  check('run-coding-dispatch explains n/a is not accepted', dispatch.includes("'n/a' is not accepted"));
  check('collab-bot commits an Author: trailer', collab.includes('\\n\\nAuthor: ${identity}'));
  check('collab-bot no longer commits an Agent: trailer', !collab.includes('\\n\\nAgent: ${identity}'));
  check('collab-bot validates the strict shape', collab.includes('^.+ \\([A-Za-z][A-Za-z0-9._-]*\\) [A-Za-z0-9][A-Za-z0-9._-]*$'));
  check('collab-bot explains n/a is not accepted', collab.includes("'n/a' is not accepted"));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
