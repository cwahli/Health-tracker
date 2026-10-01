#!/usr/bin/env node
/**
 * install-bugctl-shim — put `bugctl` on PATH so the store is reachable from any
 * working directory.
 *
 * The bug-ticket steward lost a whole answer to a relative path. It ran
 * `node scripts/bugctl.mjs` with the gateway's cwd, got exit 1, and answered
 * from its own history instead of reporting the failure — showing the user a
 * #2 that no longer exists and calling it "all of them".
 *
 * This installs the shim next to the other user tools. Re-run it after the
 * checkout moves; `--check` reports drift without writing, which is what a gate
 * or a heartbeat should call.
 *
 * Usage:
 *   node scripts/install-bugctl-shim.mjs            # install or repair
 *   node scripts/install-bugctl-shim.mjs --check    # report only, exit 1 on drift
 *   node scripts/install-bugctl-shim.mjs --target <dir>
 *
 * Exit 0: installed, or already correct under --check.
 * Exit 1: --check found drift.
 * Exit 2: could not install (no bin dir, not writable, shim template missing).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'bugctl');
const TARGET_SCRIPT = path.join(REPO_ROOT, 'scripts', 'bugctl.mjs');

const args = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const checkOnly = args.has('--check');
const targetIdx = process.argv.indexOf('--target');
const BIN_DIR = targetIdx !== -1 && process.argv[targetIdx + 1]
  ? path.resolve(process.argv[targetIdx + 1])
  : path.join(os.homedir(), '.local', 'bin');
const SHIM = path.join(BIN_DIR, 'bugctl');

const fail = (msg, code = 2) => {
  console.error(`install-bugctl-shim: ${msg}`);
  process.exit(code);
};

if (!fs.existsSync(TEMPLATE)) fail(`shim template missing: ${TEMPLATE}`);
if (!fs.existsSync(TARGET_SCRIPT)) fail(`store script missing: ${TARGET_SCRIPT}`);

const wanted = fs.readFileSync(TEMPLATE, 'utf8').replace('@@BUGCTL_SCRIPT@@', TARGET_SCRIPT);

let current = null;
try {
  current = fs.readFileSync(SHIM, 'utf8');
} catch {
  /* not installed */
}

const installed = current === wanted;
if (installed) {
  const mode = (fs.statSync(SHIM).mode & 0o111) !== 0;
  if (mode) {
    console.log(`install-bugctl-shim: already correct at ${SHIM}`);
    process.exit(0);
  }
}

if (checkOnly) {
  console.error(
    `install-bugctl-shim: DRIFT — ${SHIM} is ${current === null ? 'missing' : 'stale'}` +
      `${current !== null && (fs.statSync(SHIM).mode & 0o111) === 0 ? ' or not executable' : ''}.` +
      ` Run: node ${path.join(__dirname, 'install-bugctl-shim.mjs')}`,
  );
  process.exit(1);
}

try {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(SHIM, wanted, { mode: 0o755 });
  fs.chmodSync(SHIM, 0o755);
} catch (err) {
  fail(`cannot write ${SHIM}: ${err.message}`);
}

console.log(`install-bugctl-shim: installed ${SHIM} -> ${TARGET_SCRIPT}`);
if (!((process.env.PATH || '').split(':').includes(BIN_DIR))) {
  console.warn(
    `install-bugctl-shim: WARNING — ${BIN_DIR} is not on this shell's PATH, so \`bugctl\` ` +
      'will not resolve here. The hermes gateway already has it.',
  );
}
