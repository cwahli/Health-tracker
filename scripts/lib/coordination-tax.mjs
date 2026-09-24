/**
 * coordination-tax.mjs — BOT-21 Coordination Tax Logger & Repro Consensus.
 *
 * 1. Log (ticket, agent, tool, args-hash):
 *    Tracks tool invocations across agents and tickets.
 *    The same args-hash twice on one ticket triggers an alert (REPEAT_ARGS_HASH).
 *
 * 2. Repro verdicts consensus:
 *    Two repro verdicts on one card must match or escalate.
 *    Matching verdicts ('confirmed'/'confirmed' or 'failed'/'failed') establish consensus.
 *    Conflicting verdicts trigger escalation: blocked_reason='repro_verdict_conflict'.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Deterministic canonical string representation for hashing. */
export function canonicalString(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    const s = val.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        return canonicalString(JSON.parse(s));
      } catch {}
    }
    return s;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalString).join(',') + ']';
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val).sort();
    return '{' + keys.map((k) => `${k}:${canonicalString(val[k])}`).join(',') + '}';
  }
  return String(val);
}

/** Deterministic 16-character hex hash of normalized args. */
export function argsHash(args) {
  const norm = canonicalString(args);
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/** Default path for coordination tax JSONL log. */
export function coordinationTaxLogPath(home = os.homedir()) {
  if (process.env.COORDINATION_TAX_LOG) return process.env.COORDINATION_TAX_LOG;
  const hermesDir = process.env.HERMES_DIR || path.join(home, '.hermes');
  return path.join(hermesDir, 'coordination_tax.jsonl');
}

/** Normalize ticket identifier (e.g. #12 -> 12, BUG-12 -> 12). */
export function normalizeTicket(raw) {
  let s = String(raw || '').trim().replace(/^#/, '');
  if (/^BUG-/i.test(s)) s = s.replace(/^BUG-/i, '');
  return s || 'unknown';
}

/** Read coordination log entries, optionally filtered by ticket. */
export function readCoordinationLog(opts = {}) {
  const file = opts.logPath || coordinationTaxLogPath();
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const targetTicket = opts.ticket ? normalizeTicket(opts.ticket) : null;
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!targetTicket || normalizeTicket(parsed.ticket) === targetTicket) {
        entries.push(parsed);
      }
    } catch {}
  }
  return entries;
}

/**
 * Record a tool invocation in the coordination tax log.
 * If the same args_hash has already been recorded on this ticket, alert is set to true.
 */
export function recordCoordination(opts = {}) {
  const ticket = normalizeTicket(opts.ticket);
  const agent = String(opts.agent || 'unknown').trim();
  const tool = String(opts.tool || 'unknown').trim();
  const hash = opts.args_hash || opts['args-hash'] || argsHash(opts.args ?? '');
  const logPath = opts.logPath || coordinationTaxLogPath();

  const existing = readCoordinationLog({ ticket, logPath });
  const repeats = existing.filter((e) => e.args_hash === hash);
  const count = repeats.length + 1;
  const alert = count >= 2;
  const alertReason = alert ? 'REPEAT_ARGS_HASH' : undefined;

  const entry = {
    timestamp: opts.at || new Date().toISOString(),
    ticket,
    agent,
    tool,
    args_hash: hash,
    count,
    alert,
  };
  if (alertReason) entry.alert_reason = alertReason;

  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');

  return {
    ok: true,
    entry,
    alert,
    count,
    alertReason,
  };
}

/**
 * Evaluate reproduction verdicts on a card (BOT-21 rule).
 * "Two repro verdicts on one card must match or escalate."
 */
export function evaluateReproVerdicts(verdictsRaw = []) {
  const rawList = Array.isArray(verdictsRaw)
    ? verdictsRaw
    : verdictsRaw?.verdicts || [verdictsRaw?.prev, verdictsRaw?.next].filter(Boolean);

  const verdicts = rawList
    .map((v) => (typeof v === 'string' ? { status: v } : v))
    .filter((v) => v && typeof v.status === 'string');

  // Substantive outcomes: confirmed, failed, ambiguous
  const substantive = verdicts.filter((v) =>
    ['confirmed', 'failed', 'ambiguous'].includes(v.status)
  );

  if (substantive.length === 0) {
    return {
      ok: true,
      match: true,
      escalated: false,
      status: verdicts[0]?.status || 'none',
      count: 0,
      verdicts,
    };
  }

  if (substantive.length === 1) {
    return {
      ok: true,
      match: true,
      escalated: false,
      status: substantive[0].status,
      consensus: substantive[0].status,
      count: 1,
      verdicts: substantive,
    };
  }

  // Two or more substantive verdicts: check consensus
  const firstStatus = substantive[0].status;
  const allMatch = substantive.every((v) => v.status === firstStatus && v.status !== 'ambiguous');

  if (allMatch) {
    return {
      ok: true,
      match: true,
      escalated: false,
      status: firstStatus,
      consensus: firstStatus,
      count: substantive.length,
      verdicts: substantive,
    };
  }

  // Conflict / mismatch / ambiguous -> ESCALATE!
  const statusSummary = substantive.map((v) => `${v.by ? v.by + ':' : ''}${v.status}`).join(' vs ');
  return {
    ok: true,
    match: false,
    escalated: true,
    status: 'ambiguous',
    blocked_reason: 'repro_verdict_conflict',
    escalation_assignee: 'orchestrator',
    reason: `Two repro verdicts on one card conflict (${statusSummary}); escalated with blocked_reason=repro_verdict_conflict`,
    count: substantive.length,
    verdicts: substantive,
  };
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

export async function cli(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`usage: coordination-tax.mjs <record|hash|check|list|repro-verdicts> [options]
  record --ticket=<ID> --agent=<A> --tool=<T> [--args=<STR|JSON>] [--args-hash=<H>]
  hash   --args=<STR|JSON>
  check  --ticket=<ID> [--args-hash=<H>]
  list   [--ticket=<ID>]
  repro-verdicts --verdicts='[{"status":"confirmed"},{"status":"failed"}]'
`);
    return;
  }

  switch (cmd) {
    case 'hash': {
      const h = argsHash(args.args ?? '');
      process.stdout.write(h + '\n');
      process.exitCode = 0;
      break;
    }
    case 'record': {
      const res = recordCoordination(args);
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      process.exitCode = res.alert ? 2 : 0;
      break;
    }
    case 'check': {
      const entries = readCoordinationLog(args);
      const hash = args['args-hash'] || args.args_hash;
      const filtered = hash ? entries.filter((e) => e.args_hash === hash) : entries;
      const count = filtered.length;
      process.stdout.write(
        JSON.stringify(
          {
            ticket: args.ticket,
            count,
            alert: count >= 2,
            entries: filtered,
          },
          null,
          2
        ) + '\n'
      );
      process.exitCode = 0;
      break;
    }
    case 'list': {
      const entries = readCoordinationLog(args);
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      process.exitCode = 0;
      break;
    }
    case 'repro-verdicts': {
      let raw = args.verdicts;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {}
      }
      const res = evaluateReproVerdicts(raw);
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      process.exitCode = res.escalated ? 1 : 0;
      break;
    }
    default:
      console.error(`unknown command: ${cmd}`);
      process.exitCode = 1;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`coordination-tax: ${err.message}`);
    process.exit(1);
  });
}
