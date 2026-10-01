#!/usr/bin/env node
/**
 * tax-runner.mjs — the Chiwah LTD tax project's chat surface.
 *
 *   /tax snapshot|reconcile|losses|deadlines|saving|doc|gaps
 *     thin wrappers over chiwah-tax bot commands (numbers quoted, never computed)
 *   /tax sweep [--lite]   the accountant's sweep (tools/sweep.py)
 *   /tax status            gate verdict + sweep state, no rebuild
 *   /tax verify            verifier handoff note (needs verifier identity, P3)
 *
 * WHY A RUNNER, NOT A COMMAND HANDLER (health-runner.mjs set the shape):
 * the bot-host command stays thin (parse, call, format the reply) and the work
 * lives in scripts runnable by hand — the sweep has to run on a schedule the
 * chat does not drive, and live proof is a by-hand run, not a chat transcript.
 *
 * Every dependency is injectable so the sensor can drive the whole path with
 * fixtures and no subprocess — a runner that can only be tested live is a
 * runner nobody tests.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAX_ROOT = path.resolve(HERE, '..', '..', 'chiwah-tax');

export const TAX_SUBS = [
  'snapshot', 'reconcile', 'losses', 'deadlines',
  'saving', 'doc', 'gaps', 'sweep', 'status', 'verify',
];

/** chiwah-tax repo root (override with TAX_ROOT for tests). */
export function taxRoot({ env = process.env } = {}) {
  const override = String(env.TAX_ROOT || '').trim();
  return override || TAX_ROOT;
}

const PYTHON_BIN = (() => {
  for (const c of ['/usr/bin/python3', '/usr/local/bin/python3', 'python3']) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (r.status === 0) return c;
    } catch {}
  }
  return 'python3';
})();

function runPython({ root, module, args = [], timeoutMs = 600000 }) {
  const env = {
    ...process.env,
    PYTHONPATH: [path.join(root, 'src'), process.env.PYTHONPATH || '']
      .filter(Boolean).join(':'),
  };
  const r = spawnSync(PYTHON_BIN,
    ['-m', module, ...args],
    { cwd: root, env, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.error) return { ok: false, stage: 'spawn', error: String(r.error.message || r.error) };
  if (r.status !== 0) {
    return { ok: false, stage: 'run', error: (r.stderr || r.stdout || `exit ${r.status}`).slice(-800) };
  }
  return { ok: true, text: r.stdout };
}

function readJson(root, rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
}

/** One bot command: quoted engine output, no computation here. */
export function runTaxCommand({ sub = 'snapshot', root = taxRoot() } = {}) {
  const name = String(sub || 'snapshot').toLowerCase();
  if (!['snapshot', 'reconcile', 'losses', 'deadlines', 'saving', 'doc', 'gaps'].includes(name)) {
    return { ok: false, stage: 'args', error: `unknown /tax subcommand '${sub}'` };
  }
  const res = runPython({ root, module: 'chiwah_tax.bot.commands', args: [name] });
  if (!res.ok) return res;
  return { ok: true, text: res.text.trim() };
}

/** The sweep. Lite reuses artefacts; full rebuilds (minutes — the caller shows progress). */
export function runTaxSweep({ lite = true, root = taxRoot() } = {}) {
  const env = { ...process.env };
  const r = spawnSync(PYTHON_BIN, ['tools/sweep.py', ...(lite ? ['--lite'] : [])],
    { cwd: root, env, timeout: 3600000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, stage: 'spawn', error: String(r.error.message || r.error) };
  if (r.status !== 0) return { ok: false, stage: 'sweep', error: (r.stderr || r.stdout || '').slice(-1200) };
  return { ok: true, text: r.stdout.trim().slice(-3000) };
}

/** Gate verdict + sweep state, no rebuild. */
export function runTaxStatus({ root = taxRoot() } = {}) {
  const eng = readJson(root, 'results/engine_results.json');
  const state = readJson(root, 'results/sweep_state.json');
  const gatesExists = fs.existsSync(path.join(root, 'results', 'gates_run.txt'));
  const last = Array.isArray(state?.runs) ? state.runs[state.runs.length - 1] : null;
  const lines = ['*Tax status*'];
  lines.push(`artefacts: ${eng ? `${eng?.stats?.transactions ?? '?'} movements` : 'MISSING — run a sweep'}`);
  lines.push(`last sweep: ${last ? `${last.date} (${last.ok ? 'complete' : 'STOPPED: ' + last.note})` : 'never'}`);
  lines.push(`gates log: ${gatesExists ? 'results/gates_run.txt present' : 'MISSING — run a sweep'}`);
  lines.push('');
  lines.push('Unknowns still open: D8, D7/D12-check, DLA paperwork, D15, P2P records.');
  return { ok: true, text: lines.join('\n') };
}

/** Verifier handoff: refused until the verifier identity is live (P3). */
export function runTaxVerify() {
  return {
    ok: false,
    stage: 'identity',
    error: 'the verifier bot is not live yet (P3: mint TAX_VERIFIER_BOT_TOKEN, prove one reply). '
      + 'Verification procedure: chiwah-tax/.agents/skills/tax-verify/SKILL.md.',
  };
}
