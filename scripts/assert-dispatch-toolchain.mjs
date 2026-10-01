#!/usr/bin/env node
/**
 * scripts/assert-dispatch-toolchain.mjs
 *
 * Sensor for the coder-worktree toolchain gate.
 *
 * ## The defect this locks shut (measured 2026-10-01, card #19)
 *
 * `check_git_and_tsc` ran `npx tsc --noEmit`. `npx` does not fail when a
 * worktree has no local compiler — it resolves the npm package named `tsc`
 * (2.0.4, "A deprecated release of the TypeScript compiler"), whose only job
 * is to print "This is not the tsc command you are looking for". The gate read
 * that banner as a build failure and blamed the attempt.
 *
 * Card #19's worktree had no `node_modules/typescript` until 01:21. The
 * dispatch loop ran 00:18–00:36, so every gate in it was fooled. Result: four
 * runs on one coordination-tax args hash, the correct attempt reverted, and the
 * agent's own declared test passing 2/2 the moment deps existed.
 *
 * ## What is asserted here
 *
 * Every case EXECUTES the real module against a real fixture tree. Nothing is
 * asserted by grepping the source. The fixtures stand in for worktrees:
 *
 *   ok             real typescript, real bin        -> ok, and the resolved
 *                                                    command runs it
 *   no-deps        no node_modules at all          -> ENVIRONMENT BROKEN (3)
 *   decoy-banner   typescript present, bin is the decoy -> BROKEN LOCAL (3)
 *   decoy-local    the decoy installed as a dep    -> DECOY LOCAL (3)
 *
 * Plus the trap itself: a directory where a bare `tsc` on PATH prints the
 * banner. That is the exact shape card #19 hit, and the prover must refuse it
 * where the old gate was fooled.
 *
 * Exit 0 = pass.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkCoderToolchain,
  findCachedDecoyTsc,
  resolveCompilerCommand,
  ENV_BROKEN_EXIT,
  KIND,
  DECOY_TSC_VERSION,
  DECOY_TSC_BANNER,
} from './lib/coder-toolchain.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } else {
    fail += 1;
    process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-toolchain-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

/** A worktree fixture whose `tsc` behaves like `body`. */
function makeWorktree(name, body) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'node_modules', 'typescript', 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'typescript', 'package.json'),
    JSON.stringify({ name: 'typescript', version: '5.6.3' }),
  );
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'),
    `#!/usr/bin/env node\n${body}\n`,
  );
  fs.chmodSync(path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), 0o755);
  return dir;
}

function makeEmptyWorktree(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fake HOME containing a cached copy of the squatting npm package. */
function makeHomeWithCachedDecoy(name) {
  const home = path.join(tmp, name);
  const pkgDir = path.join(home, '.npm', '_npx', 'abc123', 'node_modules', 'tsc');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: 'tsc',
      version: DECOY_TSC_VERSION,
      description: 'A deprecated release of the TypeScript compiler',
    }),
  );
  return home;
}

process.stdout.write('assert-dispatch-toolchain: the coder build gate cannot be fooled by the npm `tsc` decoy\n');

// ── 1. a real compiler is accepted, and the resolved command actually runs it ──
{
  const dir = makeWorktree(
    'ok',
    `if (process.argv[2] === '--version') { console.log('Version 5.6.3'); process.exit(0); }`,
  );
  const result = checkCoderToolchain({ dir, home: path.join(tmp, 'no-home') });
  check('a real typescript is accepted', result.ok === true, `got ${result.kind}: ${result.message}`);
  check('its probed version is reported', result.evidence?.probedVersion === '5.6.3');

  // The command the gate is told to run must be the compiler, not a resolver.
  const { command, args } = resolveCompilerCommand(dir);
  check('resolveCompilerCommand never shells to npx', !command.includes('npx') && !args.some((a) => a.includes('npx')));
  check('resolveCompilerCommand targets the worktree typescript bin', args[0] === path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'));

  const ran = spawnSync(command, [args[0], '--version'], { encoding: 'utf8' });
  check('the resolved command really executes that compiler', /Version 5\.6\.3/.test(`${ran.stdout}${ran.stderr}`));
}

// ── 2. no node_modules: ENVIRONMENT BROKEN, exit 3, and the decoy is named ──
{
  const dir = makeEmptyWorktree('no-deps');
  const home = makeHomeWithCachedDecoy('home-cached-decoy');

  const result = checkCoderToolchain({ dir, home });
  check('a worktree with no node_modules is NOT ok', result.ok === false);
  check('it is classified missing_typescript', result.kind === KIND.MISSING_TYPESCRIPT, `got ${result.kind}`);
  check('it exits 3, distinct from a build failure', result.exitCode === ENV_BROKEN_EXIT && ENV_BROKEN_EXIT !== 1);
  check('the message names the decoy when one is cached', result.message.includes('tsc@2.0.4') || result.message.includes('decoy'), result.message);
  check('findCachedDecoyTsc locates the squatter', (findCachedDecoyTsc(home) || '').endsWith(path.join('tsc', 'package.json')));

  // The CLI is the exact contract the dispatcher depends on: exit code + text.
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts/lib/coder-toolchain.mjs'), `--dir=${dir}`], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  check('the CLI exits 3 for a deps-less worktree', cli.status === ENV_BROKEN_EXIT, `got ${cli.status}`);
  check('the CLI says ENVIRONMENT BROKEN on stderr', /ENVIRONMENT BROKEN/.test(cli.stderr), cli.stderr.slice(0, 160));
}

// ── 3. typescript present but the bin is the decoy: BROKEN LOCAL ──
{
  const dir = makeWorktree(
    'decoy-banner',
    `console.log(${JSON.stringify(DECOY_TSC_BANNER)}); process.exit(1);`,
  );
  const result = checkCoderToolchain({ dir, home: path.join(tmp, 'no-home') });
  check('a bin that prints the decoy banner is NOT ok', result.ok === false);
  check('it is classified broken_local_tsc', result.kind === KIND.BROKEN_LOCAL, `got ${result.kind}`);
  check('it still exits 3', result.exitCode === ENV_BROKEN_EXIT);
  check('the banner is quoted back as evidence', String(result.evidence?.probe || '').includes(DECOY_TSC_BANNER));
}

// ── 4. the decoy installed as a dependency: DECOY LOCAL ──
{
  const dir = makeWorktree('decoy-local', `console.log('Version 5.6.3');`);
  fs.mkdirSync(path.join(dir, 'node_modules', 'tsc'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'tsc', 'package.json'),
    JSON.stringify({ name: 'tsc', version: DECOY_TSC_VERSION }),
  );
  const result = checkCoderToolchain({ dir, home: path.join(tmp, 'no-home') });
  check('a locally installed decoy is NOT ok', result.ok === false);
  check('it is classified decoy_local_tsc', result.kind === KIND.DECOY_LOCAL, `got ${result.kind}`);
}

// ── 5. the trap itself: bare `tsc` on PATH is the banner, and we refuse it ──
{
  // This is card #19's shape: no local compiler, and whatever `tsc` resolves to
  // prints the banner. Prove the old gate would have been fooled...
  const dir = makeEmptyWorktree('trap');
  const binDir = path.join(dir, 'shim');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'tsc'),
    `#!/usr/bin/env node\nconsole.log(${JSON.stringify(DECOY_TSC_BANNER)}); process.exit(1);\n`,
  );
  fs.chmodSync(path.join(binDir, 'tsc'), 0o755);

  const naive = spawnSync(path.join(binDir, 'tsc'), ['--noEmit'], { encoding: 'utf8' });
  check(
    'the trap is real: a bare tsc answers with the banner and no version',
    naive.status !== 0 && `${naive.stdout}${naive.stderr}`.includes(DECOY_TSC_BANNER),
  );

  // ...and prove the prover refuses the very same directory.
  const result = checkCoderToolchain({ dir, home: path.join(tmp, 'no-home') });
  check('the prover refuses the trapped worktree', result.ok === false);
  check('the refusal is environmental, not a build verdict', result.exitCode === ENV_BROKEN_EXIT);
}

// ── 6. a compiler whose bin has vanished: BROKEN LOCAL, not a silent pass ──
{
  const dir = makeWorktree('no-bin', `console.log('Version 5.6.3');`);
  fs.rmSync(path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'));
  const result = checkCoderToolchain({ dir, home: path.join(tmp, 'no-home') });
  check('a vanished bin is NOT ok', result.ok === false);
  check('it is classified broken_local_tsc', result.kind === KIND.BROKEN_LOCAL, `got ${result.kind}`);
  check('the message tells the operator to reinstall', /npm ci/.test(result.message), result.message);
}

// ── 7. a path that does not exist at all is refused, never assumed clean ──
{
  const result = checkCoderToolchain({ dir: path.join(tmp, 'nope'), home: path.join(tmp, 'no-home') });
  check('a missing worktree is refused', result.ok === false);
  check('it exits 3', result.exitCode === ENV_BROKEN_EXIT);
}

// The change-detection sensor is a bash script because the logic under test is
// bash inside run-coding-dispatch.sh. It is run from here rather than from a new
// ci.yml step so the gate list does not grow another contested-file edit.
{
  const sensor = path.join(HERE, 'assert-dispatch-change-detection.sh');
  const r = spawnSync('bash', [sensor], { encoding: 'utf8', cwd: ROOT });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  check('the dispatcher sees an edit to an already-dirty file (card-19 regression)',
    r.status === 0, out.trim().split('\n').filter(Boolean).slice(-4).join(' | '));
}

process.stdout.write(`assert-dispatch-toolchain: ${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);