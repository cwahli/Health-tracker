#!/usr/bin/env node
/**
 * assert-no-undo — the sensor for the landed-work preservation rule.
 *
 * The rule (scripts/lib/no-undo.mjs, CLI scripts/no-undo.mjs): a merge range
 * may not delete lines, delete files, or resurrect files owned by LANDED
 * commits unless the judged body declares `Reverts: <sha>` / `Resurrects:
 * <path>`. EXECUTED against fixture repos, not grepped: every behavioral
 * case below runs the real CLI binary and asserts on exit code + output.
 *
 * Run: node scripts/assert-no-undo.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeclarations } from './lib/no-undo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'scripts', 'no-undo.mjs');
const CI_WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const git = (cwd, ...argv) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const runCLI = (dir, ...argv) => {
  try {
    const out = execFileSync('node', [CLI, '--repo', dir, ...argv], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

const dirs = [];
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'no-undo-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'undo test');
  git(dir, 'config', 'user.email', 'undo@test');
  return dir;
}

const commit = (dir, files, message) => {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
};

const bodyFile = (dir, name, text) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

/** Landed commit with one distinctive line; returns { base, owner, file }. */
function landedLineRepo() {
  const dir = scratchRepo();
  commit(dir, { 'a.txt': 'keep this\n' }, 'base');
  const owner = commit(
    dir,
    { 'feat.txt': 'alpha one\nTHE DISTINCTIVE LANDED LINE 42\nomega nine\n' },
    'land a feature\n\nAuthor: Test Model 1.0 (high) VM\n',
  );
  return { dir, base: owner, owner };
}

console.log('assert-no-undo:');

// 1. Add-only change: nothing deleted, nothing to own.
{
  const { dir, base } = landedLineRepo();
  commit(dir, { 'new.txt': 'brand new\n' }, 'add a file');
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main');
  check('add-only change passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
}

// 2. Deleting a landed line without declaration fails and names the owner.
{
  const { dir, base, owner } = landedLineRepo();
  commit(dir, { 'feat.txt': 'alpha one\nomega nine\n' }, 'drop the line');
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main');
  check('undeclared line delete fails', r.code === 1, `exit ${r.code}`);
  check('the failure names the file and owning commit',
    r.out.includes('feat.txt') && r.out.includes(owner.slice(0, 8)), r.out.slice(0, 300));
  check('the failure names the owner trailer', r.out.includes('Test Model 1.0'), r.out.slice(0, 300));
  check('the failure states the two valid moves',
    /rebase and keep/.test(r.out) && /Reverts:/.test(r.out), r.out.slice(0, 300));
}

// 3. Declared revert passes.
{
  const { dir, base, owner } = landedLineRepo();
  commit(dir, { 'feat.txt': 'alpha one\nomega nine\n' }, 'drop the line');
  const head = git(dir, 'rev-parse', 'HEAD');
  const bf = bodyFile(dir, 'body.txt', `## Left\n\nNothing.\n\nReverts: ${owner.slice(0, 8)} — superseded\n`);
  const r = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main', '--body-file', bf);
  check('declared revert passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
}

// 4. Deleting a landed file fails; declared passes.
{
  const dir = scratchRepo();
  commit(dir, { 'a.txt': 'keep\n' }, 'base');
  const owner = commit(dir, { 'gone.txt': 'landed content here\n' }, 'land a file');
  git(dir, 'rm', '-q', 'gone.txt');
  git(dir, 'commit', '-q', '-m', 'delete the file');
  const head = git(dir, 'rev-parse', 'HEAD');
  const bad = runCLI(dir, '--range', `${owner}..${head}`, '--landed-ref', 'main');
  check('undeclared file delete fails', bad.code === 1, `exit ${bad.code}`);
  const bf = bodyFile(dir, 'body.txt', `Reverts: ${owner} — removing the feature\n`);
  const good = runCLI(dir, '--range', `${owner}..${head}`, '--landed-ref', 'main', '--body-file', bf);
  check('declared file delete passes', good.code === 0, `exit ${good.code}: ${good.out.slice(0, 200)}`);
}

// 5. Resurrecting a file main deleted fails; declared passes.
{
  const dir = scratchRepo();
  commit(dir, { 'a.txt': 'keep\n', 'old.txt': 'original\n' }, 'base');
  git(dir, 'rm', '-q', 'old.txt');
  git(dir, 'commit', '-q', '-m', 'remove old file');
  const base = git(dir, 'rev-parse', 'HEAD');
  commit(dir, { 'old.txt': 'it is back\n' }, 're-add old file');
  const head = git(dir, 'rev-parse', 'HEAD');
  const bad = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main');
  check('undeclared resurrection fails', bad.code === 1, `exit ${bad.code}: ${bad.out.slice(0, 200)}`);
  const bf = bodyFile(dir, 'body.txt', 'Resurrects: old.txt — needed again\n');
  const good = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main', '--body-file', bf);
  check('declared resurrection passes', good.code === 0, `exit ${good.code}: ${good.out.slice(0, 200)}`);
}

// 6. Own churn (add then delete inside the range) is not an undo.
{
  const dir = scratchRepo();
  const base = commit(dir, { 'a.txt': 'keep\n' }, 'base');
  commit(dir, { 'tmp.txt': 'MY OWN DISTINCTIVE CHURN LINE 7\n' }, 'add tmp');
  git(dir, 'rm', '-q', 'tmp.txt');
  git(dir, 'commit', '-q', '-m', 'drop tmp');
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main');
  check('own add-then-delete passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
}

// 7. A line dozens of commits touched is ambiguous — skipped, not failed.
{
  const dir = scratchRepo();
  commit(dir, { 'code.js': 'function zero() {\n}\n' }, 'base');
  // One file, many brace-touching commits: `-S'}' -- f1.js` then has more
  // hits than the ambiguity cap, which is exactly the real-world shape (a
  // long-lived file where `}` belongs to nobody in particular).
  let body = '';
  for (let i = 1; i <= 9; i += 1) {
    body += `function f${i}() {\n  return ${i};\n}\n`;
    commit(dir, { 'f1.js': body }, `land function ${i}`);
  }
  const landed = git(dir, 'rev-parse', 'HEAD');
  commit(dir, { 'f1.js': body.replace('  return 1;\n}\n', '  return 1;\n') }, 'drop a brace');
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = runCLI(dir, '--range', `${landed}..${head}`, '--landed-ref', 'main', '-v');
  check('over-touched line is skipped, range passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
  check('the skip is reported as ambiguous', /ambiguous/.test(r.out), r.out.slice(0, 300));
}

// 8. Blank lines are never judged.
{
  const { dir, base } = landedLineRepo();
  commit(dir, { 'feat.txt': 'alpha one\n\n\nTHE DISTINCTIVE LANDED LINE 42\nomega nine\n' }, 'add blanks');
  commit(dir, { 'feat.txt': 'alpha one\nTHE DISTINCTIVE LANDED LINE 42\nomega nine\n' }, 'drop blanks');
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = runCLI(dir, '--range', `${base}..${head}`, '--landed-ref', 'main');
  check('blank-line churn passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 200)}`);
}

// 9. An unresolvable range fails (exit 2), never passes silently.
{
  const { dir } = landedLineRepo();
  const r = runCLI(dir, '--range', 'deadbeef..HEAD', '--landed-ref', 'main');
  check('bad range exits 2', r.code === 2, `exit ${r.code}`);
}

// 10. Declaration parsing: units.
{
  const d = parseDeclarations('Reverts: abc1234 — reason\nRESURRECTS: ignored\nResurrects: ./docs/x.md\nReverts: 9f8e7d6c5b4a\n');
  check('parses both declaration kinds',
    d.reverts.length === 2 && d.resurrects.length === 1
    && d.reverts[0] === 'abc1234' && d.resurrects[0] === 'docs/x.md',
    JSON.stringify(d));
}

// 11. CI wiring: the range check runs in ci.yml (presence pin; behavior is
//     executed above, not grepped).
{
  const ci = existsSync(CI_WORKFLOW) ? readFileSync(CI_WORKFLOW, 'utf8') : '';
  check('ci runs scripts/no-undo.mjs', ci.includes('scripts/no-undo.mjs'));
  check('ci passes --landed-ref', ci.includes('--landed-ref'));
  check('ci runs the sensor', ci.includes('assert-no-undo.test.mjs'));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log('');
console.log(failed === 0 ? `assert-no-undo: ${passed} pass, 0 fail` : `assert-no-undo: ${passed} pass, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
