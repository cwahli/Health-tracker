#!/usr/bin/env node
/**
 * scripts/lib/coder-toolchain.mjs
 *
 * Proves the TypeScript compiler in a coder worktree is REAL, before the
 * dispatch gate is allowed to trust its output.
 *
 * ## Why this exists (measured 2026-10-01, card #19)
 *
 * The dispatch build gate ran `npx tsc --noEmit`. `npx` does not fail when a
 * worktree has no local compiler — it resolves the npm package that is
 * literally named `tsc`, which is version 2.0.4, self-described as
 * "A deprecated release of the TypeScript compiler", and whose whole purpose
 * is to print:
 *
 *     This is not the tsc command you are looking for
 *
 * Card #19's worktree had no `node_modules/typescript` until 01:21; the
 * dispatch loop ran 00:18–00:36. So for the entire loop the gate was reading a
 * decoy's banner as a build failure. It reverted a correct attempt, nudged,
 * and re-ran the identical invocation four times with an identical
 * coordination-tax args hash — while the agent's own declared test passed 2/2
 * the moment deps existed.
 *
 * The lesson is not "install deps". It is: **a gate that can fail for an
 * environmental reason must report that reason, or the retry loop will keep
 * retrying the environment.** This module is how the gate tells the two apart.
 *
 * ## Usage
 *
 *   node scripts/lib/coder-toolchain.mjs --dir=/path/to/worktree
 *   node scripts/lib/coder-toolchain.mjs --dir=... --json
 *
 * ## Exit codes
 *
 *   0  a real TypeScript compiler is present and answering  -> gate may run it
 *   3  ENVIRONMENT BROKEN (missing / decoy / broken compiler)
 *      Deliberately distinct from a build failure, so the caller can refuse to
 *      revert, refuse to nudge, and tell a human what to fix.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The npm package that squats the `tsc` bin name. */
export const DECOY_TSC_PACKAGE = 'tsc';
export const DECOY_TSC_VERSION = '2.0.4';
export const DECOY_TSC_BANNER = 'This is not the tsc command you are looking for';

/** Real TypeScript prints `Version 5.6.3` (or `Version 4.9.5`). */
const REAL_VERSION_RE = /^Version\s+(\d+)\.(\d+)\.(\d+)/m;

/** Environment-broken exit code. Never use 1 — that means "the code is bad". */
export const ENV_BROKEN_EXIT = 3;

export const KIND = {
  OK: 'ok',
  MISSING_TYPESCRIPT: 'missing_typescript',
  DECOY_LOCAL: 'decoy_local_tsc',
  BROKEN_LOCAL: 'broken_local_tsc',
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Is a cached copy of the npm `tsc` decoy sitting in this user's npx cache?
 *
 * This is the evidence that makes the diagnosis legible: it proves the gate
 * would have resolved to a real squatting package rather than erroring out.
 *
 * @param {string} [home] home directory to search under
 * @returns {string|null} path to the cached decoy, or null
 */
export function findCachedDecoyTsc(home = process.env.HOME || '') {
  if (!home) return null;
  const npxRoot = path.join(home, '.npm', '_npx');
  let entries;
  try {
    entries = fs.readdirSync(npxRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkg = path.join(npxRoot, entry.name, 'node_modules', DECOY_TSC_PACKAGE, 'package.json');
    const meta = readJson(pkg);
    if (meta && meta.name === DECOY_TSC_PACKAGE && meta.version === DECOY_TSC_VERSION) {
      return pkg;
    }
  }
  return null;
}

/**
 * Resolve the compiler to run INSTEAD of `npx tsc`.
 *
 * Calling the resolved local binary directly is what removes the decoy from the
 * picture entirely: there is no registry fallback to squat.
 *
 * @param {string} dir worktree root
 * @returns {{ command: string, args: string[] }}
 */
export function resolveCompilerCommand(dir) {
  return {
    command: process.execPath,
    args: [path.join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
  };
}

/**
 * Decide whether this worktree's TypeScript compiler can be trusted.
 *
 * @param {{ dir: string, home?: string, run?: (cmd: string, args: string[]) => { status: number|null, stdout: string } }} opts
 * @returns {{ ok: boolean, kind: string, message: string, evidence: object, exitCode: number }}
 */
export function checkCoderToolchain({ dir, home, run } = {}) {
  const runDefault = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000 });
    return { status: res.status, stdout: `${res.stdout || ''}${res.stderr || ''}` };
  };
  const exec = run || runDefault;

  const evidence = { dir: dir || null, typescriptPkg: null, version: null };

  if (!dir || !fs.existsSync(dir)) {
    return {
      ok: false,
      kind: KIND.MISSING_TYPESCRIPT,
      message: `coder worktree does not exist: ${dir}`,
      evidence,
      exitCode: ENV_BROKEN_EXIT,
    };
  }

  const tsPkgPath = path.join(dir, 'node_modules', 'typescript', 'package.json');
  evidence.typescriptPkg = tsPkgPath;

  if (!fs.existsSync(tsPkgPath)) {
    const decoy = findCachedDecoyTsc(home);
    return {
      ok: false,
      kind: KIND.MISSING_TYPESCRIPT,
      message: decoy
        ? `no node_modules/typescript in the coder worktree, and the npm \`${DECOY_TSC_PACKAGE}@${DECOY_TSC_VERSION}\` decoy is cached at ${decoy} — \`npx tsc\` would run the decoy, not the compiler`
        : `no node_modules/typescript in the coder worktree — run \`npm ci\` there before dispatching`,
      evidence: { ...evidence, cachedDecoy: decoy },
      exitCode: ENV_BROKEN_EXIT,
    };
  }

  const tsPkg = readJson(tsPkgPath);
  if (!tsPkg || typeof tsPkg.version !== 'string') {
    return {
      ok: false,
      kind: KIND.BROKEN_LOCAL,
      message: `node_modules/typescript/package.json is unreadable at ${tsPkgPath}`,
      evidence,
      exitCode: ENV_BROKEN_EXIT,
    };
  }
  evidence.version = tsPkg.version;

  // A local install of the squatting package is the same trap, one step closer.
  const decoyBin = path.join(dir, 'node_modules', DECOY_TSC_PACKAGE, 'package.json');
  const decoyMeta = readJson(decoyBin);
  if (decoyMeta && decoyMeta.name === DECOY_TSC_PACKAGE && decoyMeta.version === DECOY_TSC_VERSION) {
    return {
      ok: false,
      kind: KIND.DECOY_LOCAL,
      message: `the coder worktree has the decoy package \`${DECOY_TSC_PACKAGE}@${DECOY_TSC_VERSION}\` installed locally; remove it`,
      evidence: { ...evidence, decoyLocal: decoyBin },
      exitCode: ENV_BROKEN_EXIT,
    };
  }

  // Ask the compiler itself. A real one answers "Version x.y.z"; the decoy
  // answers with its banner and no version.
  const { command, args } = resolveCompilerCommand(dir);
  if (!fs.existsSync(args[0])) {
    return {
      ok: false,
      kind: KIND.BROKEN_LOCAL,
      message: `typescript ${tsPkg.version} is installed but its bin is missing at ${args[0]} — reinstall with \`npm ci\``,
      evidence,
      exitCode: ENV_BROKEN_EXIT,
    };
  }

  const probe = exec(command, [args[0], '--version']);
  const out = String(probe?.stdout || '');
  const match = REAL_VERSION_RE.exec(out);
  if (!match) {
    return {
      ok: false,
      kind: KIND.BROKEN_LOCAL,
      message: `the local tsc did not report a version (got: ${out.trim().slice(0, 120) || `exit ${probe?.status}`}) — reinstall with \`npm ci\``,
      evidence: { ...evidence, probe: out.trim().slice(0, 200) },
      exitCode: ENV_BROKEN_EXIT,
    };
  }

  evidence.probedVersion = match[0].replace(/^Version\s+/, '');
  return {
    ok: true,
    kind: KIND.OK,
    message: `TypeScript ${tsPkg.version} verified in the coder worktree`,
    evidence,
    exitCode: 0,
  };
}

function parseArgs(argv) {
  const out = { dir: '', json: false, home: '' };
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) out.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--home=')) out.home = arg.slice('--home='.length);
    else if (arg === '--json') out.json = true;
  }
  return out;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    process.stderr.write('coder-toolchain: --dir=<worktree> is required\n');
    process.exit(ENV_BROKEN_EXIT);
  }
  const result = checkCoderToolchain({ dir: args.dir, home: args.home || undefined });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`[toolchain] ${result.message}\n`);
  } else {
    process.stderr.write(`[toolchain] ENVIRONMENT BROKEN (${result.kind}): ${result.message}\n`);
  }
  process.exit(result.exitCode);
}