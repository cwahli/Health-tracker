/**
 * scripts/lib/bug-intake.mjs
 *
 * Replayable-queue logic, shared by scripts/bugctl-drain.mjs and its tests.
 *
 * WHY THIS EXISTS
 * `bugctl` queues a write to `.bugctl-queue.jsonl` when the API is unreachable
 * (scripts/bugctl.mjs:157-168), and `bugctl flush` replays it — but nothing in
 * the repo ever called `flush`. The skill even told agents to "wait for
 * `bugctl flush`", an instruction pointing at a command with no drainer, so a
 * write queued while the API was down sat there indefinitely. This is the piece
 * that can be called by a cron, a bot turn, or a human.
 *
 * The op -> route table below is a *mirror* of the one in bugctl's own `flush`.
 * bugctl owns it; this file must not become a second source of truth, so
 * `assertOpTableMatches` compares the two and fails loudly if they drift.
 */
import fs from 'node:fs';

/** Queue row -> (method, path template, body). Mirrors scripts/bugctl.mjs flush. */
export const OP_ROUTES = {
  create: () => ['POST', '/api/bugs', null],
  pack: (r) => ['POST', `/api/bugs/${enc(r.id)}/defect`, r],
  defect: (r) => ['POST', `/api/bugs/${enc(r.id)}/defect`, r],
  repro: (r) => ['POST', `/api/bugs/${enc(r.id)}/repro`, r],
  plan: (r) => ['POST', `/api/bugs/${enc(r.id)}/plan`, r],
  attempt: (r) => ['POST', `/api/bugs/${enc(r.id)}/attempts`, r],
  verify: (r) => ['POST', `/api/bugs/${enc(r.id)}/verify`, r],
  close: (r) => ['POST', `/api/bugs/${enc(r.id)}/verify`, r],
  claim: (r) => ['PATCH', `/api/bugs/${enc(r.id)}`, { assignee: r.assignee }],
  duplicate: (r) => ['PATCH', `/api/bugs/${enc(r.id)}`, { duplicate_of: r.of }],
  unblock: (r) => ['PATCH', `/api/bugs/${enc(r.id)}`, { blocked_reason: null }],
  block: (r) => ['PATCH', `/api/bugs/${enc(r.id)}`, { blocked_reason: r.reason, queue: 'blocked' }],
  evidence: (r) => ['POST', `/api/bugs/${enc(r.id)}/attach`, r],
  curate: (r) => ['POST', `/api/bugs/${enc(r.id)}/curation`, r.payload || r],
  handoff: (r) => ['POST', `/api/bugs/${enc(r.id)}/curation`, r.payload || r],
};

function enc(v) {
  return encodeURIComponent(String(v ?? ''));
}

/** Strip the bookkeeping fields bugctl adds so the body matches a live call. */
export function queueBody(row) {
  const { op, queued_at, ...rest } = row || {};
  return rest;
}

/**
 * Plan one queue file for replay without performing any I/O.
 * Returns { send: [{ index, line, op, method, path, body }], keep: [line], corrupt: n }.
 *
 * A row that cannot be parsed, or whose op has no route, is `keep` — never
 * dropped. A drainer that deletes what it did not send is the bug class
 * `assert-bug-repro` guards against for evidence bundles, and it would silently
 * eat a filed bug report.
 */
export function planDrain(lines) {
  const send = [];
  const keep = [];
  let corrupt = 0;
  lines.forEach((line, index) => {
    const text = String(line || '').trim();
    if (!text) return;
    let row;
    try {
      row = JSON.parse(text);
    } catch {
      corrupt++;
      keep.push(text);
      return;
    }
    const route = OP_ROUTES[row?.op];
    if (!route) {
      keep.push(text);
      return;
    }
    const [method, path, override] = route(row);
    send.push({ index, line: text, op: row.op, method, path, body: override || queueBody(row) });
  });
  return { send, keep, corrupt };
}

/** Read a queue file into lines; a missing file is an empty queue, not an error. */
export function readQueueLines(queuePath) {
  if (!fs.existsSync(queuePath)) return [];
  return fs.readFileSync(queuePath, 'utf8').split('\n').filter((l) => l.trim());
}

/**
 * Write back only the rows that still need to go. Written atomically via a
 * temp file + rename so a crash mid-write cannot truncate the queue.
 */
export function writeQueueLines(queuePath, lines) {
  if (!lines.length) {
    if (fs.existsSync(queuePath)) fs.rmSync(queuePath);
    return;
  }
  const tmp = `${queuePath}.tmp`;
  fs.writeFileSync(tmp, `${lines.map((l) => `${l}\n`).join('')}`);
  fs.renameSync(tmp, queuePath);
}

/**
 * Fail loudly if bugctl's own flush table and this mirror have drifted.
 * Two sources of truth for the same routing is how a queued write ends up
 * replayed to the wrong route, or never replayed at all.
 */
export function assertOpTableMatches(bugctlSource) {
  const src = String(bugctlSource || '');
  const missing = [];
  for (const op of Object.keys(OP_ROUTES)) {
    if (!new RegExp(`op === ['"]${op}['"]`).test(src)) missing.push(op);
  }
  if (missing.length) {
    throw new Error(
      `bug-intake: OP_ROUTES has ops bugctl's flush no longer handles: ${missing.join(', ')}. ` +
        'Update this mirror or drop the drainer — do not let them drift.'
    );
  }
  return true;
}
