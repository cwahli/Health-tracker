/**
 * Bot error log (BOT-25) — the stateful layer over bot-failures.jsonl.
 *
 * bot-failures.jsonl is append-only evidence with no lifecycle; this module
 * owns the lifecycle: every runtime error opens (or bumps) a record keyed by
 * a stable signature, and the record closes when a recovery rule succeeds or
 * the lane runs clean again. Statuses: open → recovering → closed.
 *
 * Store is host-local (default ~/.hermes/bot-error-log.json, override with
 * BOT_ERROR_LOG) — one JSON object { errors: { id: record } }, best-effort.
 * All I/O is wrapped and never throws; disable with BOT_ERROR_LOG=0.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ERROR_STATUSES = ['open', 'recovering', 'closed'];

export function errorLogPath() {
  if (process.env.BOT_ERROR_LOG === '0') return null;
  return process.env.BOT_ERROR_LOG || path.join(os.homedir(), '.hermes', 'bot-error-log.json');
}

/** Stable 12-hex id for kind|lane|bot (mirrors run-ledger signatures). */
export function errorId({ kind = 'unknown', lane = '', bot = '' } = {}) {
  return crypto
    .createHash('sha256')
    .update([String(kind), String(lane ?? ''), String(bot ?? '')].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Short machine kind for a raw error text. Vocabulary is deliberately small
 * so signatures stay stable across vendors; detail lives in hint/raw.
 */
export function classifyErrorKind(text) {
  const s = String(text || '');
  if (/quota|rate.?limit|\b429\b|\b402\b|insufficient|out of credits|no credits|usage limit|free.?limit|exhausted|freebuck|free.?usage|payment required|exceeded|throttl|capacity|limit reached|daily.?cap|credit.?balance|too many requests/i.test(s)) return 'quota';
  if (/timed out after|deadline exceeded|timedout/i.test(s)) return 'timeout';
  if (/aborted|^Abort/i.test(s)) return 'aborted';
  if (/unauthoriz|invalid api key|authentication|forbidden|401\b/i.test(s)) return 'auth';
  if (/ENOENT|spawn .* ENOENT|not found|not installed|no such file/i.test(s)) return 'missing-tool';
  if (/\b50[023]\b|bad gateway|service unavailable|gateway timeout|internal error/i.test(s)) return 'provider-5xx';
  if (/409\b|conflict|another poller/i.test(s)) return 'poller-conflict';
  if (!s.trim()) return 'unknown';
  return 'run-failed';
}

/**
 * Recovery rules: kind → what fixes it and whether the bot may do it alone.
 * `auto` rules are safe to attempt without a human (failover, lease sweep,
 * loud single-poller exit); the rest need an operator and stay open with the
 * action named.
 */
export const RECOVERY_RULES = {
  quota: { action: 'failover-to-next-lane', auto: true },
  'poller-conflict': { action: 'single-poller-exit', auto: true },
  timeout: { action: 'retry-with-smaller-ask', auto: false },
  auth: { action: 're-auth-host', auto: false },
  'missing-tool': { action: 'install-or-select-other-tool', auto: false },
  'provider-5xx': { action: 'failover-to-next-lane', auto: true },
  'run-failed': { action: 'failover-to-next-lane', auto: false },
  aborted: { action: 'none-user-abort', auto: false },
  unknown: { action: 'inspect-observer-log', auto: false },
};

export function evaluateRecovery(record) {
  const rule = RECOVERY_RULES[record?.kind] || RECOVERY_RULES.unknown;
  return { kind: record?.kind || 'unknown', ...rule };
}

function loadStore(logPath = errorLogPath()) {
  try {
    if (!logPath || !fs.existsSync(logPath)) return { errors: {} };
    const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.errors) return { errors: {} };
    return parsed;
  } catch {
    return { errors: {} };
  }
}

function saveStore(store, logPath = errorLogPath()) {
  if (!logPath) return false;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `${JSON.stringify(store, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

export function getErrors(logPath = errorLogPath()) {
  return loadStore(logPath).errors || {};
}

export function listErrors({ status = 'all' } = {}, logPath = errorLogPath()) {
  const all = Object.values(getErrors(logPath));
  const wanted = String(status || 'all').toLowerCase();
  const out = wanted === 'all' ? all : all.filter((e) => e.status === wanted);
  return out.sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
}

/**
 * Open (or bump) an error record. Reopening a closed signature starts a new
 * open episode with the history kept in count. Never throws.
 */
export function recordError({ kind = null, lane = '', bot = '', hint = '', raw = '' } = {}, logPath = errorLogPath()) {
  try {
    if (!logPath) return null;
    const resolvedKind = kind || classifyErrorKind(raw || hint);
    const id = errorId({ kind: resolvedKind, lane, bot });
    const store = loadStore(logPath);
    const now = new Date().toISOString();
    const prev = store.errors[id];
    store.errors[id] = {
      id,
      kind: resolvedKind,
      lane: String(lane ?? ''),
      bot: bot == null ? '' : String(bot),
      hint: String(hint || raw || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      status: 'open',
      count: Number(prev?.count || 0) + 1,
      first: prev?.first || now,
      last: now,
      closedBy: null,
      recovery: prev?.recovery || null,
    };
    saveStore(store, logPath);
    return store.errors[id];
  } catch {
    return null;
  }
}

/**
 * Mark a recovery attempt. ok=true closes with by=`auto:<rule>`;
 * ok=false parks the record in recovering with the rule named.
 */
export function recordRecoveryAttempt(id, { rule = '', ok = false, note = '' } = {}, logPath = errorLogPath()) {
  try {
    if (!logPath) return null;
    const store = loadStore(logPath);
    const cur = store.errors[String(id)];
    if (!cur) return null;
    const now = new Date().toISOString();
    cur.recovery = { rule: String(rule || ''), at: now, ok: Boolean(ok), note: String(note || '').slice(0, 200) };
    if (ok) {
      cur.status = 'closed';
      cur.closedBy = `auto:${cur.recovery.rule || 'recovery'}`;
      cur.last = now;
    } else {
      cur.status = 'recovering';
      cur.last = now;
    }
    saveStore(store, logPath);
    return cur;
  } catch {
    return null;
  }
}

/** Manually close a record (operator verdict). */
export function closeError(id, { by = 'manual' } = {}, logPath = errorLogPath()) {
  try {
    if (!logPath) return null;
    const store = loadStore(logPath);
    const cur = store.errors[String(id)];
    if (!cur) return null;
    cur.status = 'closed';
    cur.closedBy = String(by || 'manual');
    cur.last = new Date().toISOString();
    saveStore(store, logPath);
    return cur;
  } catch {
    return null;
  }
}

/**
 * A clean run on a lane closes its open/recovering errors with
 * by=`auto:clean-run`. Pass kind to close one signature, or omit it to close
 * every open record for the lane+bot. Returns the closed records.
 */
export function noteHealthy({ lane = '', bot = '', kind = null } = {}, logPath = errorLogPath()) {
  try {
    if (!logPath) return [];
    const store = loadStore(logPath);
    const now = new Date().toISOString();
    const closed = [];
    for (const rec of Object.values(store.errors)) {
      if (rec.status === 'closed') continue;
      if (String(rec.lane ?? '') !== String(lane ?? '')) continue;
      if (String(rec.bot ?? '') !== String(bot ?? '')) continue;
      if (kind && rec.kind !== kind) continue;
      rec.status = 'closed';
      rec.closedBy = 'auto:clean-run';
      rec.last = now;
      closed.push(rec);
    }
    if (closed.length) saveStore(store, logPath);
    return closed;
  } catch {
    return [];
  }
}
