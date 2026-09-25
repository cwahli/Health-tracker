/**
 * Per-dispatch outcome ledger for BOT-15.
 *
 * One outcome row per dispatch: ticket, surface, provider/model, defect
 * class, tokens, wall-clock, outcome. The pre-action gate reads it in code,
 * beside the file locks, before the edit — a prompt footer is not the gate.
 *
 * Store is host-local (default ~/.hermes/run-ledger.jsonl, override with
 * RUN_LEDGER) — one JSON object per line, append-only, best-effort.
 * Recording must never break a run: all I/O is wrapped, disable with
 * RUN_LEDGER=0.
 *
 * Signature = sha256(ticket|surface|provider|model|defectClass), 12 hex
 * chars. The second identical signature does not block the run (parallel by
 * design) — it flags `needsLearning`, and that day the repeat must yield
 * one test or rule. Failure outcomes also feed ~/.hermes/bot-failures.jsonl
 * so the Hermes review loop reads them.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordFailure } from './failure-log.mjs';
import { recordError, noteHealthy } from './error-log.mjs';

/** Outcomes that count as failures for the bot-failures reader. */
export const FAILED_OUTCOMES = new Set([
  'tsc-failed',
  'no-changes',
  'push-failed',
  'commit-failed',
  'escalated',
  'unresolved',
]);

export function ledgerPath() {
  if (process.env.RUN_LEDGER === '0') return null;
  return process.env.RUN_LEDGER || path.join(os.homedir(), '.hermes', 'run-ledger.jsonl');
}

/** Build an outcome row. Tokens/wall-clock may be null when unknown. */
export function buildOutcome({
  ticket = '',
  surface = '',
  provider = '',
  model = '',
  defectClass = '',
  tokens = null,
  wallClockMs = null,
  outcome = 'unknown',
  at = null,
} = {}) {
  return {
    at: at || new Date().toISOString(),
    ticket: String(ticket ?? ''),
    surface: String(surface ?? ''),
    provider: String(provider ?? ''),
    model: String(model ?? ''),
    defectClass: String(defectClass ?? ''),
    tokens: tokens === null || tokens === undefined ? null : Number(tokens),
    wallClockMs: wallClockMs === null || wallClockMs === undefined ? null : Number(wallClockMs),
    outcome: String(outcome ?? 'unknown'),
  };
}

/** Stable 12-hex signature of the dispatch identity (not the outcome). */
export function signatureOf(row) {
  const r = buildOutcome(row);
  return crypto
    .createHash('sha256')
    .update([r.ticket, r.surface, r.provider, r.model, r.defectClass].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** Load all rows; corrupt lines are skipped, never fatal. */
export function loadLedger(logPath = ledgerPath()) {
  try {
    if (!logPath || !fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Count prior rows with the same signature. Never throws. */
export function countSignature(signature, logPath = ledgerPath()) {
  try {
    return loadLedger(logPath).filter((r) => signatureOf(r) === signature).length;
  } catch {
    return 0;
  }
}

/**
 * Pre-action gate. Returns { signature, priorCount, duplicate }.
 * duplicate is true on the second (or later) identical signature —
 * the run proceeds, but the repeat must yield one test or rule that day.
 */
export function checkDuplicate(fields, logPath = ledgerPath()) {
  const signature = signatureOf(fields);
  const priorCount = countSignature(signature, logPath);
  return { signature, priorCount, duplicate: priorCount >= 1 };
}

/**
 * Append one outcome row. Returns { written, signature, priorCount }.
 * Failure outcomes also feed bot-failures.jsonl (the Hermes reader).
 * Never throws; returns { written: false } when disabled or on I/O error.
 */
export function recordOutcome(fields, logPath = ledgerPath()) {
  const row = buildOutcome(fields);
  const signature = signatureOf(row);
  let priorCount = 0;
  try {
    if (!logPath) return { written: false, signature, priorCount };
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    priorCount = countSignature(signature, logPath);
    fs.appendFileSync(logPath, JSON.stringify(row) + '\n', 'utf8');
    if (FAILED_OUTCOMES.has(row.outcome)) {
      recordFailure({
        lane: row.provider || null,
        kind: `dispatch:${row.outcome}`,
        hint: `${row.ticket} ${row.defectClass}`.trim().slice(0, 160),
        bot: row.surface || null,
      });
      // BOT-25: terminal dispatch failures open an error-log record; a later
      // success on the lane auto-closes it. Never throws (error-log is wrapped).
      recordError({
        lane: row.provider || row.surface || '',
        bot: row.surface || '',
        kind: `dispatch:${row.outcome}`,
        hint: `${row.ticket} ${row.defectClass}`.trim(),
      });
    } else {
      noteHealthy({ lane: row.provider || row.surface || '', bot: row.surface || '' });
    }
    return { written: true, signature, priorCount };
  } catch {
    return { written: false, signature, priorCount };
  }
}

function printUsage() {
  console.log('usage: run-ledger.mjs <record|check> [options]');
  console.log('  record --ticket=T --surface=S --provider=P --model=M --defect-class=D --outcome=O [--tokens=N] [--wall-clock=MS]');
  console.log('  check  --ticket=T --surface=S --provider=P --model=M --defect-class=D');
  console.log('check exits 2 with duplicate:true on a repeated signature, 0 otherwise.');
}

function optsOf(argv) {
  const opts = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/s);
    if (m) opts[m[1].replace(/-/g, '_')] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2).replace(/-/g, '_')] = '1';
  }
  return opts;
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const o = optsOf(rest);
  const fields = {
    ticket: o.ticket,
    surface: o.surface,
    provider: o.provider,
    model: o.model,
    defectClass: o.defect_class,
    tokens: o.tokens === undefined ? null : Number(o.tokens),
    wallClockMs: o.wall_clock === undefined ? null : Number(o.wall_clock),
    outcome: o.outcome,
  };
  switch (cmd) {
    case 'record': {
      const res = recordOutcome(fields);
      console.log(JSON.stringify(res));
      break;
    }
    case 'check': {
      const res = checkDuplicate(fields);
      console.log(JSON.stringify({ ...res, needsLearning: res.duplicate }));
      process.exitCode = res.duplicate ? 2 : 0;
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`run-ledger: ${err.message}`);
    process.exit(1);
  });
}
