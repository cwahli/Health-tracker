#!/usr/bin/env node
/**
 * learner-sweep.mjs — 30-min self-healing learner loop (Learner agent).
 *
 * Read-only by default. Collects:
 *  1. KNOWN DEAD ENDS (model lanes that fail — never retried blindly)
 *  2. Stale/open PR pileup (claim-guard blocks, overlapping PRs)
 *  3. Rejected-cache growth (burned hypotheses — must not be retried)
 *  4. Hygiene dry-run signal (Tier1/2/3 counts)
 *  5. Recent fix/learn commits from git log (last 48h)
 *
 * With --apply the sweep also ACTS, not just reports:
 *  - expires known-dead-ends entries older than DEAD_END_TTL_DAYS (vendors heal;
 *    a lane avoided forever is a slow leak of usable capacity),
 *  - rotates learner-sweep.log to LOG_KEEP_LINES (append-only growth is a disk leak),
 *  - refreshes the registry timestamp so the next run can tell a stall from a stop.
 *
 * Writes one report block to specs/learnings/learner-sweep.log (append-only)
 * and prints it to stdout (cron mails / logger captures it).
 *
 * Usage:
 *   node scripts/learner-sweep.mjs                 # report only
 *   node scripts/learner-sweep.mjs --apply         # also refresh KNOWN_DEAD_ENDS timestamp
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '') || process.cwd();
const APPLY = process.argv.includes('--apply');

const DEAD_ENDS_FILE = path.join(ROOT, 'specs/learnings/learner-known-dead-ends.json');
const SWEEP_LOG = path.join(ROOT, 'specs/learnings/learner-sweep.log');
// A dead lane is evidence, not a verdict forever: vendors heal. After the
// TTL the entry expires so the walk re-probes the lane once instead of
// avoiding usable capacity indefinitely (the allowance-hold lesson).
const DEAD_END_TTL_DAYS = Number(process.env.LEARNER_DEAD_END_TTL_DAYS || 7);
// Append-only log growth is a disk leak; keep the tail only.
const LOG_KEEP_LINES = Number(process.env.LEARNER_SWEEP_LOG_LINES || 500);

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, cwd: ROOT, ...opts }).trim();
  } catch (e) { return `__ERR__ ${String((e && e.message) || e).slice(0, 200)}`; }
}

const now = new Date().toISOString();
const lines = [];
lines.push(`## learner-sweep ${now}`);

// 1. Dead ends (user-supplied + persisted)
let dead = { updated: '', ends: [] };
try { dead = JSON.parse(fs.readFileSync(DEAD_ENDS_FILE, 'utf8')); } catch {}
lines.push(`- dead_ends_tracked: ${dead.ends.length}`);
for (const d of dead.ends.slice(0, 10)) lines.push(`  - ${d.lane}: ${d.signal}`);

// 2. Open PRs (claim-guard pressure)
const prs = sh('gh', ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,headRefName,updatedAt,isDraft']);
let openCount = -1;
try {
  const arr = JSON.parse(prs);
  openCount = arr.length;
  const week = Date.now() - 7 * 864e5;
  const stale = arr.filter((p) => new Date(p.updatedAt).getTime() < week);
  lines.push(`- open_prs: ${openCount} (stale>7d: ${stale.length})`);
  for (const p of stale.slice(0, 8)) lines.push(`  - stale #${p.number} ${p.headRefName} ${p.updatedAt}`);
} catch { lines.push(`- open_prs: ERR ${prs.slice(0, 120)}`); }

// 3. Rejected cache size
let rej = [];
try { rej = fs.readdirSync(path.join(ROOT, 'specs/rejected')).filter((f) => f.endsWith('.json')); } catch {}
lines.push(`- rejected_hypotheses: ${rej.length} files`);

// 4. Learnings count
let learn = [];
try { learn = fs.readdirSync(path.join(ROOT, 'specs/learnings')).filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md'); } catch {}
lines.push(`- learnings: ${learn.length} notes`);

// 5. Hygiene dry run (Tier signal only, capped)
const hyg = sh('node', ['scripts/agent-hygiene.mjs', '--json']);
try {
  const h = JSON.parse(hyg);
  lines.push(`- hygiene: tier1=${(h.tier1 || []).length} tier2=${(h.tier2 || []).length} tier3=${(h.tier3 || []).length} kept=${(h.kept || []).length}`);
} catch { lines.push(`- hygiene: ERR ${hyg.slice(0, 160)}`); }

// 6. Recent fix/learn commits (last 48h)
const log = sh('git', ['log', '--since=48.hours.ago', '--oneline', '--no-decorate']);
const fixLines = log.split('\n').filter(Boolean);
lines.push(`- commits_48h: ${fixLines.length}`);
const repeated = {};
for (const l of fixLines) {
  const m = l.match(/^\S+\s+(fix|docs|feat|chore)\(([^)]+)\)/);
  if (m) repeated[m[2]] = (repeated[m[2]] || 0) + 1;
}
const hot = Object.entries(repeated).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
for (const [area, n] of hot) lines.push(`  - HOT ${area} x${n} (repeat area — candidate for standing row)`);

lines.push('');
const report = lines.join('\n');
console.log(report);
try {
  fs.appendFileSync(path.join(ROOT, 'specs/learnings/learner-sweep.log'), report + '\n');
} catch (e) { console.error(`log append failed: ${e.message}`); }

if (APPLY) {
  dead.updated = now;
  // Optimization 1: expire stale dead ends so healed lanes get re-probed
  // instead of avoided forever. Never expires entries without a valid
  // first_seen (no timestamp = no evidence of age).
  const ttlMs = DEAD_END_TTL_DAYS * 864e5;
  const before = dead.ends.length;
  if (Array.isArray(dead.ends) && Number.isFinite(ttlMs) && ttlMs > 0) {
    const cutoff = Date.now() - ttlMs;
    dead.ends = dead.ends.filter((d) => {
      const t = Date.parse(d?.first_seen || '');
      if (!Number.isFinite(t)) return true;
      if (t > cutoff) return true;
      lines.push(`  - EXPIRED ${d.lane} (first_seen ${d.first_seen} > ${DEAD_END_TTL_DAYS}d — re-probe once)`);
      return false;
    });
  }
  if (dead.ends.length !== before) lines.push(`- dead_ends_expired: ${before - dead.ends.length}`);
  try { fs.writeFileSync(DEAD_ENDS_FILE, JSON.stringify(dead, null, 2) + '\n'); } catch {}
  // Optimization 2: rotate the append-only sweep log to a bounded tail.
  try {
    const raw = fs.readFileSync(SWEEP_LOG, 'utf8').split('\n');
    if (raw.length > LOG_KEEP_LINES + 50) {
      fs.writeFileSync(SWEEP_LOG, raw.slice(-LOG_KEEP_LINES).join('\n'));
      lines.push(`- log_rotated: kept last ${LOG_KEEP_LINES} lines`);
    }
  } catch {}
  console.log(lines.filter((l) => l.startsWith('- dead_ends_expired') || l.startsWith('  - EXPIRED') || l.startsWith('- log_rotated')).join('\n'));
}
