#!/usr/bin/env node
/**
 * assert-bugctl-is-reachable — the steward must not be able to lose the store.
 *
 * Measured 2026-09-30. The user asked the bug-ticket bot "what are the bugs" and
 * got four cards: #1, #4, #7, and a #2 that does not exist, followed by "That's
 * all of them." The store held fifteen.
 *
 * Nothing was wrong with the store. The skill said:
 *
 *   node scripts/bugctl.mjs list --json
 *
 * a RELATIVE path, and the hermes gateway's cwd is /home/ubuntu, not the repo.
 * So node failed with "Cannot find module" and exit 1 — and the steward, rather
 * than reporting the failed read, rebuilt the list from its own conversation
 * history. The user could not tell that from a real answer, which is why it
 * stood.
 *
 * The fix is structural, not documentary: `bugctl` on PATH, which works from any
 * directory, and a shim that fails LOUDLY with a repair hint if the checkout
 * moves. The same trap had already been written into the bot's MEMORY.md and it
 * did not hold — a memory note is not a mechanism.
 *
 * EXECUTED, not grepped: the shim is installed into a temp bin, put on PATH,
 * and run from three different working directories — including one that has no
 * `scripts/` at all, which is the case that failed in production.
 *
 * Run: node scripts/assert-bugctl-is-reachable.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'scripts', 'skills', 'common', 'bug-ticket', 'SKILL.md');
const dirs = [];

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const run = (cmd, args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

console.log('assert-bugctl-is-reachable:');

const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'bugctl-reach-'));
  dirs.push(d);
  return d;
};

// ---------------------------------------------------------------------------
// 1. The shim reaches the store from directories that have no repo in them.
//    `list` must not need the network to be proven reachable, so a syntax-only
//    invocation is used: it resolves the script and runs, which is the whole
//    failure being guarded.
// ---------------------------------------------------------------------------

const binDir = tmp();
{
  const r = run('node', [join(ROOT, 'scripts', 'install-bugctl-shim.mjs'), '--target', binDir]);
  check('the installer runs', r.code === 0, r.out.slice(0, 300));

  const shim = join(binDir, 'bugctl');
  check('the shim is installed', existsSync(shim));
  check('the shim is executable', existsSync(shim) && (readFileSync(shim, 'utf8').startsWith('#!')));
  check('the installed shim points at the real store',
    existsSync(shim) && readFileSync(shim, 'utf8').includes(join(ROOT, 'scripts', 'bugctl.mjs')));
  check('no unresolved placeholder is left in the shim',
    existsSync(shim) && !readFileSync(shim, 'utf8').includes('@@BUGCTL_SCRIPT@@'));

  // The exact production shape: a cwd with no `scripts/` directory at all.
  const foreign = tmp();
  const help = run(shim, ['help'], { cwd: foreign, env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } });
  check('the shim runs from a directory that has no scripts/ at all',
    help.code === 0, `exit ${help.code}: ${help.out.slice(0, 200)}`);
  check('and it really reached bugctl (not a shell error)',
    /bugctl|create|list|packet/i.test(help.out), help.out.slice(0, 200));

  // ...and from the repo root, which is what used to be the only way.
  const fromRepo = run(shim, ['help'], { cwd: ROOT, env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } });
  check('the shim also works from the repo root', fromRepo.code === 0, `exit ${fromRepo.code}`);

  // ...and from the gateway's own cwd, which is what broke in production.
  const fromHome = run(shim, ['help'], { cwd: process.env.HOME || '/home/ubuntu', env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } });
  check("the shim works from the gateway's cwd", fromHome.code === 0, `exit ${fromHome.code}`);
}

// ---------------------------------------------------------------------------
// 2. A moved checkout must fail loudly and point at the repair — never look
//    like an empty or stale answer.
// ---------------------------------------------------------------------------
{
  const gone = tmp();
  const brokenShim = join(gone, 'bugctl');
  writeFileSync(
    brokenShim,
    readFileSync(join(binDir, 'bugctl'), 'utf8').replace(join(ROOT, 'scripts', 'bugctl.mjs'), join(gone, 'scripts', 'bugctl.mjs')),
  );
  chmodSync(brokenShim, 0o755);
  const r = run(brokenShim, ['list', '--json'], { cwd: gone });
  check('a moved checkout exits non-zero', r.code !== 0, `exit ${r.code}`);
  check('and says the tool failed, not that the list is empty',
    /TOOL failure|does not exist/i.test(r.out), r.out.slice(0, 200));
  check('and prints the repair command', /install-bugctl-shim/.test(r.out), r.out.slice(0, 300));
  check('and never prints a JSON list', !/"rows"\s*:/.test(r.out), r.out.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 3. The skill must not reintroduce a cwd-dependent command.
// ---------------------------------------------------------------------------
{
  const text = readFileSync(SKILL, 'utf8');
  check('SKILL.md exists', existsSync(SKILL));
  check('the skill has no relative bugctl path left', !/node scripts\/bugctl\.mjs/.test(text),
    (text.match(/node scripts\/bugctl\.mjs[^\n]*/) || [])[0] || '');
  check('the skill uses the PATH command', /\bbugctl list --json/.test(text));
  check('the skill forbids answering from history on a failed read',
    /never rebuild a list from history/i.test(text));
  check('the skill forbids "that is all of them" without a live count',
    /all of them/i.test(text) && /generated_at/.test(text));
  check('the skill tells the agent not to cd to the repo to read', /not to `cd`|Do not `cd`/i.test(text));
}

// ---------------------------------------------------------------------------
// 4. The store read is not a relative path in the other bug tooling either.
// ---------------------------------------------------------------------------
{
  // assert-bug-retro-audit builds this string into its answer key. If it stays
  // relative it teaches an agent the failing form.
  const audit = readFileSync(join(ROOT, 'scripts', 'assert-bug-retro-audit.mjs'), 'utf8');
  check('the retro-audit answer key does not teach the relative path',
    !/node scripts\/bugctl\.mjs packet/.test(audit),
    (audit.match(/node scripts\/bugctl\.mjs[^\n`]*/) || [])[0] || '');
  check('the installer is referenced by something runnable',
    existsSync(join(ROOT, 'scripts', 'install-bugctl-shim.mjs')));
}

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log('');
console.log(
  failed === 0
    ? `assert-bugctl-is-reachable: ${passed} pass, 0 fail`
    : `assert-bugctl-is-reachable: ${passed} pass, ${failed} FAIL`,
);
process.exit(failed === 0 ? 0 : 1);
