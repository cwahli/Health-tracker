/**
 * store-spool.mjs — the write queue between a chat turn and Google.
 *
 * The rule this file exists to enforce: **a turn never waits on Google.** A Drive
 * upload can take a second and, from this host, occasionally minutes while Google's
 * front door serves a bot-challenge page. Neither belongs in the path between a
 * message arriving and its answer being delivered.
 *
 * So every write is appended to a local JSONL file first and flushed afterwards.
 * The shape is deliberately dull, because durability is the whole point:
 *
 *   - **append-only** JSONL, one file per UTC day, under the bot's own state dir
 *   - a **cursor** file per day recording how many lines have been flushed
 *   - the cursor only advances after Google has confirmed the write
 *
 * That combination is what makes a crash safe. Re-running after a crash re-sends at
 * most the rows that were in flight, and because every artefact carries a
 * content-addressed name, a re-send is idempotent rather than a duplicate.
 *
 * Nothing here imports the Google client: this file is the durability boundary and
 * stays testable without a network.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = (at) => new Date(at || Date.now()).toISOString().slice(0, 10);

export function spoolDir(botId, { home = os.homedir() } = {}) {
  return path.join(home, '.local', 'state', 'bot-host', botId, 'google-spool');
}

const spoolFile = (dir, day) => path.join(dir, `${day}.jsonl`);
const cursorFile = (dir, day) => path.join(dir, `${day}.cursor`);

/** Append one item. Returns the line number (1-based) it landed on. */
export function spoolItem(botId, item, { home = os.homedir(), at = Date.now() } = {}) {
  const dir = spoolDir(botId, { home });
  fs.mkdirSync(dir, { recursive: true });
  const day = DAY(at);
  const file = spoolFile(dir, day);
  const line = `${JSON.stringify({ ...item, at: item.at || new Date(at).toISOString() })}\n`;
  // Append mode is atomic enough for lines under PIPE_BUF on a local fs, and a
  // torn tail is caught by the JSON.parse guard in readItems.
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
  return { day, line: countLines(file), file };
}

function countLines(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    let n = 0;
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') n += 1;
    return n;
  } catch {
    return 0;
  }
}

export function readItems(botId, { home = os.homedir() } = {}) {
  const dir = spoolDir(botId, { home });
  let days = [];
  try {
    days = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const day of days) {
    const text = fs.readFileSync(path.join(dir, day), 'utf8');
    const cursor = readCursor(botId, day, { home });
    text.split('\n').forEach((raw, i) => {
      if (!raw.trim()) return;
      if (i < cursor) return; // already flushed
      try {
        out.push({ ...JSON.parse(raw), _day: day, _line: i + 1 });
      } catch {
        // A torn tail from a crash mid-append: skip it rather than refusing to
        // flush everything behind it. The next successful flush rewrites the file.
      }
    });
  }
  return out;
}

export function readCursor(botId, day, { home = os.homedir() } = {}) {
  try {
    return Number(fs.readFileSync(cursorFile(spoolDir(botId, { home }), day), 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

/** Advance the cursor for a day. Called only after Google confirmed the write. */
export function advanceCursor(botId, day, line, { home = os.homedir() } = {}) {
  const dir = spoolDir(botId, { home });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cursorFile(dir, day), String(line), { mode: 0o600 });
}

/** Drop a day whose lines are all flushed. Keeps the state dir from growing forever. */
export function pruneFlushed(botId, { home = os.homedir(), keepDays = 7, now = Date.now() } = {}) {
  const dir = spoolDir(botId, { home });
  let removed = 0;
  let days = [];
  try {
    days = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const cutoff = DAY(now - keepDays * 86400000);
  for (const f of days) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (!m) continue;
    const day = m[1];
    if (day >= cutoff) continue;
    const total = countLines(path.join(dir, f));
    if (readCursor(botId, day, { home }) >= total) {
      try {
        fs.rmSync(path.join(dir, f));
        fs.rmSync(cursorFile(dir, day), { force: true });
        removed += 1;
      } catch { /* a locked file is retried on the next prune */ }
    }
  }
  return removed;
}

/**
 * Flush pending items through `send`, one at a time, advancing the cursor after
 * each success. Stops at the first failure on purpose: keeping the remaining items
 * in order means a transient Google failure cannot reorder the turn log.
 */
export async function flushSpool(botId, send, { home = os.homedir(), limit = 50 } = {}) {
  const items = readItems(botId, { home });
  const report = { attempted: 0, sent: 0, failed: 0, errors: [], firstError: '', remaining: items.length };
  for (const item of items.slice(0, limit)) {
    report.attempted += 1;
    try {
      const res = await send(item);
      if (res && res.ok === false) throw new Error(res.error || 'send refused');
      report.sent += 1;
      advanceCursor(botId, item._day, item._line, { home });
    } catch (err) {
      report.failed += 1;
      const msg = String(err && err.message ? err.message : err).slice(0, 200);
      if (!report.firstError) report.firstError = msg;
      report.errors.push(`${item.kind || 'row'}: ${msg}`);
      break; // keep ordering; the next tick resumes from here
    }
  }
  report.remaining = Math.max(0, readItems(botId, { home }).length);
  return report;
}
