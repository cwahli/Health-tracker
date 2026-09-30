#!/usr/bin/env node
/**
 * pm-current.mjs — the readable face of the PM sheet.
 *
 * `ongoing_projects` is an append-only log (669 rows for 28 live keys): correct
 * as history, unreadable as a board. This script rebuilds the `current` tab —
 * one row per live key — from live sources at build time, so every cell is
 * today's truth, not the last sweep's:
 *
 *   - state/blocked/stall live from the fleet projection (packets, tickets,
 *     ledger, heartbeats — the same four sources the sweep uses);
 *   - rung/attempts from the ladder file (the sweep's own counters);
 *   - author: the packet file's git author (specs), the last curator (cards),
 *     the last runner provider/model (lanes) — blank where no source records
 *     one, never guessed;
 *   - github: newest open/merged PR whose head branch names the item
 *     (substring match on the item id) — blank where nothing matches;
 *   - tree: the linked ~/dev worktree if it exists on disk (with its branch),
 *     else the heartbeat cwd (see below);
 *   - agent_branch/agent_note/agent_live from heartbeats (blank until an
 *     agent beats one — dispatches do this automatically).
 *
 * Deliberately NOT part of the sweep: the governed writer is append-only, and
 * this tab is overwrite (clear + update). Run it on the VM after a sweep:
 *   node scripts/pm-current.mjs --id=vm
 */

import { execFileSync as nodeExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  pmPaths,
  projectFleet,
  readFleetSources,
  readTickets,
} from './lib/pm-fleet.mjs';
import { attemptFor, ladderFile, readLadder } from './lib/pm-ladder.mjs';
import { USER_AGENT } from './lib/google-store.mjs';

export const CURRENT_TAB = 'current';

export const CURRENT_COLUMNS = [
  'key',
  'id',
  'kind',
  'state',
  'blocked',
  'stall_reason',
  'rung',
  'attempts',
  'owner',
  'source',
  'agent_branch',
  'agent_note',
  'tree',
  'agent_live',
  'author',
  'github',
  'last_activity',
  'built_at',
];

/**
 * Newest PR (open or merged) whose head branch names the item id.
 * Text ids match by substring, case-insensitive (`journey/bug-board-parity`
 * names `bug-board-parity`). Pure numbers match on segment boundaries only
 * (`dispatch-8`, `card9-`, `#13`) — a bare substring would link card #1 to
 * every `r14-…` branch and card #13 to `handover-f13-live`. No match means
 * blank, never a guessed link.
 */
export function matchPr(prs, id) {
  const needle = String(id || '').trim().toLowerCase().replace(/^#/, '');
  if (!needle) return '';
  const numeric = /^\d+$/.test(needle);
  // A glued `card9` / `dispatch8` still names the card; anything else needs a
  // real separator on the left (dots don't count — `v-30.1` is a version, not
  // card #1) and a non-digit on the right.
  const boundary = new RegExp(`(^|[^a-z0-9.]|card|dispatch)${needle}([^0-9]|$)`);
  const hits = (Array.isArray(prs) ? prs : []).filter((p) => {
    const head = String(p?.headRefName || '').toLowerCase();
    return numeric ? boundary.test(head) : head.includes(needle);
  });
  if (!hits.length) return '';
  hits.sort((a, b) => Number(b?.number || 0) - Number(a?.number || 0));
  const top = hits[0];
  return `#${top.number} ${String(top.state || '').toLowerCase()} ${top.headRefName}`;
}

/**
 * Where the work lives on disk, if anywhere.
 * Cards: the dispatch worktree (`~/dev/dispatch-<N>` for card #N). Specs: the
 * area worktree (`~/dev/<lowercase-id>`). Returns `path (branch)` when the
 * directory exists, else ''. `exists`/`branchOf` injectable for tests.
 */
export function treeCandidates(kind, id, home = os.homedir()) {
  const cands = [];
  if (kind === 'card') {
    const n = String(id || '').replace(/^#/, '');
    if (/^\d+$/.test(n)) cands.push(path.join(home, 'dev', `dispatch-${n}`));
  } else if (kind === 'spec') {
    const slug = String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug) cands.push(path.join(home, 'dev', slug));
  }
  return cands;
}

export function linkedTree(kind, id, {
  home = os.homedir(),
  exists = (p) => { try { return fs.existsSync(p); } catch { return false; } },
  branchOf = (dir, exec = nodeExecFileSync) => {
    try {
      return String(exec('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 15000 })).trim();
    } catch {
      return '';
    }
  },
} = {}) {
  for (const dir of treeCandidates(kind, id, home)) {
    if (!exists(dir)) continue;
    const br = branchOf(dir);
    return br && br !== 'HEAD' ? `${dir} (${br})` : dir;
  }
  return '';
}

/** Packet file's git author — the only recorded authorship specs have. */
export function specAuthor(root, file, { exec = nodeExecFileSync } = {}) {
  try {
    const out = String(exec('git', ['log', '-1', '--format=%an %as', '--', file], { encoding: 'utf8', timeout: 15000, cwd: root })).trim();
    return out || '';
  } catch {
    return '';
  }
}

/** specs/active/<file> by packet id, via frontmatter `id:` (first match wins). */
export function specFileFor(specsDir, id, { read = (f) => fs.readFileSync(f, 'utf8'), list = (d) => fs.readdirSync(d) } = {}) {
  let names = [];
  try {
    names = list(specsDir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
  } catch {
    return '';
  }
  for (const name of names) {
    try {
      const head = read(path.join(specsDir, name)).split('\n').slice(0, 12).join('\n');
      const m = head.match(/^id:\s*(.+?)\s*$/m);
      if (m && m[1].trim() === String(id).trim()) return name;
    } catch {
      // unreadable packet is not a fact
    }
  }
  return '';
}

/** Open + merged PRs, best-effort: a failed list means blank github cells. */
export function listPrs({ exec = nodeExecFileSync } = {}) {
  try {
    const out = exec('gh', ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,headRefName'], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const rows = JSON.parse(String(out || '[]'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** One fleet item + live lookups → one `current` row, in column order. */
export function currentRow(item, {
  at = new Date().toISOString(),
  rung = '',
  attempts = 0,
  author = '',
  github = '',
  tree = '',
  lastActivity = '',
} = {}) {
  const cell = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
  return [
    cell(item.key),
    cell(item.id),
    cell(item.kind),
    cell(item.state),
    item.blocked ? 'yes' : 'no',
    cell(item.stallReason),
    cell(rung),
    String(Number(attempts) || 0),
    cell(item.owner),
    cell(item.source),
    cell(item.branch),
    cell(item.note),
    cell(tree || item.worktree),
    item.live === true ? 'live' : item.live === false ? 'stale' : '',
    cell(author),
    cell(github),
    cell(lastActivity),
    cell(at),
  ];
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return '';
  }
}

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq < 0 ? '1' : hit.slice(eq + 1);
}

async function main() {
  const { loadHostEnv, identityFromEnv, accessToken, getSheet } = await import('./lib/google-store.mjs');
  const botId = arg('id', 'vm');
  const home = os.homedir();
  const now = new Date().toISOString();

  const { env } = loadHostEnv(botId);
  const who = identityFromEnv(env);
  if (!who.ok) throw new Error(`no Google identity: ${who.reason}`);
  const t = await accessToken(who);
  if (!t.ok) throw new Error(`token grant failed: ${t.error}`);
  const token = t.token;
  const sid = String(env.GOOGLE_PM_SHEET_ID || '').trim().replace(/^["']|["']$/g, '');
  if (!sid) throw new Error('GOOGLE_PM_SHEET_ID is not set');

  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const paths = pmPaths(env, { root, home });
  const raw = readFleetSources({ paths, env });
  const fleet = projectFleet({ specs: raw.specs, bugs: raw.bugs, lanes: raw.lanes, beats: raw.beats, now: Date.now() });
  const ladder = readLadder(ladderFile(botId, { home }));
  const tickets = readTickets({ env });
  const byTag = new Map((tickets.rows || []).map((r) => [String(r?.tag_id || ''), r]));
  const prs = listPrs();

  const rows = fleet.items.map((item) => {
    const att = attemptFor(ladder, item.key);
    let author = '';
    let lastActivity = String(item.lastActivityAt || '');
    if (item.kind === 'spec') {
      const file = specFileFor(paths.specsDir, item.id);
      if (file) {
        author = specAuthor(root, path.join('specs', 'active', file));
        lastActivity = mtimeOf(path.join(paths.specsDir, file)) || lastActivity;
      }
    } else if (item.kind === 'card') {
      const tag = String(item.key).replace(/^card:/, '');
      const row = byTag.get(tag);
      author = String(row?.last_curation?.actor || '');
      lastActivity = String(row?.updated_at || '') || lastActivity;
    } else if (item.kind === 'lane') {
      author = item.lastOutcome && item.owner ? `${item.owner} via ${item.lastOutcome}` : String(item.owner || '');
    }
    const tree = linkedTree(item.kind, item.id, { home });
    return {
      item,
      values: currentRow(item, {
        at: now,
        rung: att.rung || '',
        attempts: att.attempts || 0,
        author,
        github: matchPr(prs, item.id),
        tree,
        lastActivity,
      }),
    };
  });

  const meta = await getSheet(sid, token);
  if (!meta.ok) throw new Error(`cannot read sheet: ${meta.error}`);
  const hasTab = (meta.sheet.sheets || []).some((s) => s.properties?.title === CURRENT_TAB);
  const api = 'https://sheets.googleapis.com/v4/spreadsheets';
  const headers = { 'User-Agent': USER_AGENT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (!hasTab) {
    const mk = await fetch(`${api}/${sid}:batchUpdate`, {
      method: 'POST', headers, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CURRENT_TAB } } }] }),
    });
    if (!mk.ok) throw new Error(`cannot create ${CURRENT_TAB}: ${(await mk.text()).slice(0, 200)}`);
  }
  const clear = await fetch(`${api}/${sid}/values/${encodeURIComponent(`${CURRENT_TAB}!A1:Z5000`)}:clear`, { method: 'POST', headers });
  if (!clear.ok) throw new Error(`cannot clear ${CURRENT_TAB}: ${(await clear.text()).slice(0, 200)}`);
  const put = await fetch(`${api}/${sid}/values/${encodeURIComponent(`${CURRENT_TAB}!A1`)}?valueInputOption=RAW`, {
    method: 'PUT', headers, body: JSON.stringify({ values: [CURRENT_COLUMNS, ...rows.map((r) => r.values)] }),
  });
  if (!put.ok) throw new Error(`cannot write ${CURRENT_TAB}: ${(await put.text()).slice(0, 200)}`);
  const done = await put.json().catch(() => ({}));
  console.log(`current: ${rows.length} row(s) + header written (${done?.updatedCells ?? '?'} cells).`);
  for (const r of rows) {
    console.log(`• ${r.item.id} [${r.item.kind}/${r.item.state}] author=${r.values[CURRENT_COLUMNS.indexOf('author')] || '-'} github=${r.values[CURRENT_COLUMNS.indexOf('github')] || '-'} tree=${r.values[CURRENT_COLUMNS.indexOf('tree')] || '-'}`);
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error(`pm-current: ${err.message}`);
    process.exit(1);
  });
}

