#!/usr/bin/env node
/**
 * work-queue — one visible list of what is left, generated from live state.
 *
 * Sources (all mechanical, no hand curation):
 *  - open `agent/**` PRs: number, title, branch, owner trailer, Next:/Depends-On:
 *  - recently merged PRs: their Next: pointers become carry-over candidates
 *  - local git: how far each branch sits behind origin/main
 *
 * Sections: Ready to merge (no open dependency, in dependency order) /
 * In flight (owner + blocker + Next + staleness) / Unowned carry-over
 * (a merged PR named follow-up work nobody owns yet) / Dangling pointers.
 *
 * Reassignment is automatic: closing a PR unmerged returns its row to
 * Unowned (the claim dies with the PR); merging deletes the branch, which
 * resolves agent/<area> pointers. The 48h nudge (--nudge) asks stale owners
 * to push, rebase, or close — the queue never needs a human triager.
 *
 * Freshness: --check diffs a regeneration against the committed file.
 * .github/workflows/work-queue.yml regenerates on schedule and commits the
 * result ([queue-sync], WORK_QUEUE.md only), so no agent has to remember.
 *
 * Usage:
 *   node scripts/work-queue.mjs --write [--out <file>]
 *   node scripts/work-queue.mjs --check [--out <file>]
 *   node scripts/work-queue.mjs --nudge [--post] [--stale-hours <n>]
 *   Common: [--prs-json <file>] [--merged-json <file>] [--now <iso>]
 *           [--repo <dir>] [--token-env <VAR>]
 *
 * --prs-json/--merged-json inject the PR lists (gh shape) for offline runs
 * and sensors; without them the script calls `gh` itself. --now freezes
 * "stale" for deterministic tests.
 *
 * Exit 0: written / fresh / nudged. Exit 1: stale (--check), or a nudge
 * failed to post. Exit 2: usage / git / gh failure.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDependsOn } from './lib/merge-gate.mjs';

export const STALE_HOURS_DEFAULT = 48;
export const MERGED_WINDOW = 15;

export function parseArgs(argv) {
  const raw = argv.slice(2);
  const args = new Map();
  for (let i = 0; i < raw.length; i += 1) {
    const a = raw[i];
    if (!a.startsWith('-') || a === '-') continue;
    const word = a.startsWith('--') ? a.slice(2) : a.slice(1);
    const eq = word.indexOf('=');
    if (eq === -1) {
      const next = raw[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        args.set(word, next);
        i += 1;
      } else {
        args.set(word, '1');
      }
    } else {
      args.set(word.slice(0, eq), word.slice(eq + 1));
    }
  }
  return args;
}

export function trailerOf(body) {
  const line = String(body || '')
    .split('\n')
    .find((l) => /^(Author|Agent): /.test(l.trim()));
  return line ? line.trim().replace(/^(Author|Agent): /, '') : '(no trailer)';
}

export function nextOf(body) {
  const m = String(body || '').match(/^Next:[ \t]*(\S+)/m);
  return m ? m[1].trim() : '';
}

/** Classify a Next: pointer: branch, pr, file, or unknown. */
export function classifyNext(next) {
  if (!next) return { kind: 'none' };
  if (/^agent\//.test(next)) return { kind: 'branch', ref: next };
  let m = next.match(/^#(\d+)$/);
  if (m) return { kind: 'pr', ref: Number(m[1]) };
  m = next.match(/^([^#\s]+\.md)(?:#(.+))?$/);
  if (m) return { kind: 'file', ref: m[1], section: m[2] || '' };
  return { kind: 'unknown', ref: next };
}

function sh(repo, ...argv) {
  return execFileSync('git', argv, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ghJson(extra) {
  const out = execFileSync('gh', extra, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return out ? JSON.parse(out) : [];
}

export function loadPRs(args) {
  if (args.get('prs-json')) {
    return JSON.parse(readFileSync(args.get('prs-json'), 'utf8'));
  }
  return ghJson([
    'pr', 'list', '--state', 'open', '--limit', '100', '--json',
    'number,title,headRefName,body,updatedAt,author',
  ]);
}

export function loadMerged(args) {
  if (args.get('merged-json')) {
    return JSON.parse(readFileSync(args.get('merged-json'), 'utf8'));
  }
  return ghJson([
    'pr', 'list', '--state', 'merged', '--limit', String(MERGED_WINDOW), '--json',
    'number,title,headRefName,body,mergedAt,author',
  ]);
}

export function behindMain(repo, branch) {
  try {
    return Number(sh(repo, 'rev-list', '--count', `origin/${branch}..origin/main`));
  } catch {
    return null;
  }
}

export function branchGone(repo, branch) {
  try {
    sh(repo, 'rev-parse', '--verify', `origin/${branch}`);
    return false;
  } catch {
    return true;
  }
}

export function isStale(updatedAt, nowMs, staleHours) {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleHours * 3600 * 1000;
}

export function nudgeComment(pr, owner) {
  return [
    `Still owned? This PR has had no updates for over ${STALE_HOURS_DEFAULT}h.`,
    '',
    `Owner (from trailer): ${owner}. One of: push progress, rebase past main, or close it —`,
    'closing releases the claim-guard lock and returns the work to Unowned automatically.',
    'No reply needed if it is moving; this nudge fires once per stale period from the queue sync.',
  ].join('\n');
}

/**
 * Pure build: { prs, merged } + git probes -> markdown + nudge list.
 * `gitProbe` is injected ({ behind(branch), gone(branch) }) so the sensor
 * runs offline.
 */
export function buildQueue({ prs, merged, gitProbe, nowMs, staleHours }) {
  const open = new Map(prs.map((p) => [p.number, p]));
  const openBranches = new Set(prs.map((p) => p.headRefName));
  const mergedNumbers = new Set(merged.map((p) => p.number));
  const lines = [];
  const stamp = new Date(nowMs).toISOString().replace(/\.\d+Z$/, 'Z');
  lines.push(`# Work queue (generated ${stamp} by scripts/work-queue.mjs — do not hand-edit; rerun --write)`);
  lines.push('');

  // Ready: open, no open dependency. Blocked ones fall to In flight.
  const ready = [];
  const blocked = [];
  for (const p of prs) {
    const deps = parseDependsOn(p.body).filter((n) => open.has(n) && !mergedNumbers.has(n) && n !== p.number);
    // A dependency that is neither open nor merged is dangling — it blocks
    // nothing (unknown never merges, but here "unknown" means typo'd; the
    // merge driver itself holds on it, the queue only reports it).
    if (deps.length === 0) ready.push(p);
    else blocked.push({ pr: p, deps });
  }
  ready.sort((a, b) => a.number - b.number);
  lines.push(`## Ready to merge (${ready.length})`);
  lines.push('');
  if (ready.length === 0) lines.push('_Empty._');
  for (const p of ready) {
    const behind = gitProbe.behind(p.headRefName);
    lines.push(
      `- #${p.number} \`${p.headRefName}\` — ${p.title} (owner: ${trailerOf(p.body)}; behind main: ${behind === null ? '?' : behind})`,
    );
  }
  lines.push('');

  lines.push(`## In flight (${prs.length - ready.length})`);
  lines.push('');
  if (blocked.length === 0 && prs.length === ready.length) lines.push('_Empty — everything open is unblocked._');
  for (const { pr: p, deps } of blocked) {
    const stale = isStale(p.updatedAt, nowMs, staleHours) ? ' STALE' : '';
    lines.push(
      `- #${p.number} \`${p.headRefName}\` — ${p.title} (owner: ${trailerOf(p.body)}; held behind ${deps.map((n) => `#${n}`).join(', ')}; Next: ${nextOf(p.body) || '—'}${stale})`,
    );
  }
  // Open but unblocked PRs are Ready; still show stale ones here for the nudge?
  // No — one home per row. Stale-but-ready rows carry their age in Ready.
  lines.push('');

  // Unowned carry-over: merged PRs' Next: pointers nobody picked up.
  const carry = [];
  const dangling = [];
  for (const m of merged) {
    const next = nextOf(m.body);
    if (!next) continue;
    const c = classifyNext(next);
    if (c.kind === 'branch') {
      if (openBranches.has(c.ref)) continue; // owned, shown in flight
      if (!gitProbe.gone(c.ref)) {
        carry.push({ source: `#${m.number}`, pointer: next, note: `branch exists, no open PR` });
      } else {
        carry.push({ source: `#${m.number}`, pointer: next, note: `branch gone, no follow-up` });
      }
    } else if (c.kind === 'pr') {
      if (open.has(c.ref) || mergedNumbers.has(c.ref)) continue;
      dangling.push({ source: `#${m.number}`, pointer: next });
    } else if (c.kind === 'file') {
      carry.push({ source: `#${m.number}`, pointer: next, note: 'live notes' });
    } else {
      dangling.push({ source: `#${m.number}`, pointer: next });
    }
  }
  lines.push(`## Unowned carry-over (${carry.length})`);
  lines.push('');
  if (carry.length === 0) lines.push('_Empty — every named follow-up has an owner._');
  for (const c of carry) lines.push(`- ${c.pointer} (named by merged ${c.source}; ${c.note})`);
  lines.push('');
  lines.push(`## Dangling pointers (${dangling.length})`);
  lines.push('');
  if (dangling.length === 0) lines.push('_None._');
  for (const d of dangling) lines.push(`- ${d.pointer} (named by merged ${d.source}; resolves to nothing)`);
  lines.push('');

  const nudges = prs
    .filter((p) => isStale(p.updatedAt, nowMs, staleHours))
    .map((p) => ({ number: p.number, owner: trailerOf(p.body), body: nudgeComment(p, trailerOf(p.body)) }));
  return { markdown: `${lines.join('\n')}\n`, nudges };
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.get('repo') ? resolve(args.get('repo')) : process.cwd();
  const out = args.get('out') ? resolve(args.get('out')) : resolve(repo, 'WORK_QUEUE.md');
  const nowMs = args.get('now') ? Date.parse(args.get('now')) : Date.now();
  const staleHours = Number(args.get('stale-hours') || STALE_HOURS_DEFAULT);
  if (Number.isNaN(nowMs) || !Number.isFinite(staleHours)) {
    console.error('usage: node scripts/work-queue.mjs (--write|--check|--nudge) [options]');
    process.exit(2);
  }
  const mode = args.has('write') ? 'write' : args.has('check') ? 'check' : args.has('nudge') ? 'nudge' : '';
  if (!mode) {
    console.error('usage: node scripts/work-queue.mjs (--write|--check|--nudge) [options]');
    process.exit(2);
  }

  let prs;
  let merged;
  try {
    prs = loadPRs(args);
    merged = mode === 'nudge' ? [] : loadMerged(args);
  } catch (err) {
    console.error(`work-queue: cannot load PR state: ${err.message}`);
    process.exit(2);
  }
  const gitProbe = {
    behind: (b) => behindMain(repo, b),
    gone: (b) => branchGone(repo, b),
  };
  const { markdown, nudges } = buildQueue({ prs, merged, gitProbe, nowMs, staleHours });

  if (mode === 'nudge') {
    const post = args.has('post');
    for (const n of nudges) {
      if (!post) {
        console.log(`would nudge #${n.number} (owner: ${n.owner})`);
        continue;
      }
      try {
        execFileSync('gh', ['pr', 'comment', String(n.number), '--body', n.body], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.log(`nudged #${n.number}`);
      } catch (err) {
        console.error(`work-queue: nudge #${n.number} failed: ${err.message}`);
        process.exit(1);
      }
    }
    console.log(post ? `work-queue: ${nudges.length} nudge(s) posted` : `work-queue: ${nudges.length} stale PR(s) (dry run)`);
    return;
  }

  if (mode === 'write') {
    mkdirSync(dirname(out), { recursive: true });
    // The stamp moves every run; the schedule commits only on content
    // change, so a stamp-only diff must not count as a change (same reason
    // bug-backlog --check renders with the committed file's own timestamp).
    const blank = (s) => String(s || '').replace(/^# Work queue \(generated .*\)$/m, '# Work queue (generated STAMP)');
    let current = null;
    try {
      current = readFileSync(out, 'utf8');
    } catch {
      current = null;
    }
    if (current !== null && blank(current) === blank(markdown)) {
      console.log(`work-queue: unchanged ${out}`);
      return;
    }
    writeFileSync(out, markdown);
    console.log(`work-queue: wrote ${out}`);
    return;
  }

  // --check: fresh iff regeneration is byte-identical.
  let current = null;
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    current = null;
  }
  // Timestamps differ every run; compare with the stamp line blanked.
  const blank = (s) => String(s || '').replace(/^# Work queue \(generated .*\)$/m, '# Work queue (generated STAMP)');
  if (blank(current) === blank(markdown)) {
    console.log('work-queue: fresh');
  } else {
    console.error('work-queue: STALE — rerun `node scripts/work-queue.mjs --write` (the schedule syncs it daily regardless).');
    process.exit(1);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('work-queue.mjs');
if (isMain) main();
