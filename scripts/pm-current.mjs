#!/usr/bin/env node
/**
 * pm-current.mjs — the readable face of the PM sheet.
 *
 * `ongoing_projects` is an append-only log (669 rows for 28 live keys): correct
 * as history, unreadable as a board. This script rebuilds the `fleet` tab (NEVER `current`: that is the human PM board) —
 * one row per live key — from live sources at build time, so every cell is
 * today's truth, not the last sweep's:
 *
 *   - state/blocked/stall live from the fleet projection (packets, tickets,
 *     ledger, heartbeats — the same four sources the sweep uses);
 *   - rung/attempts from the ladder file (the sweep's own counters);
 *   - author: the agent behind the work — the commit `Author:` trailer on
 *     the packet file (specs), the linked PR's body trailer (cards with a
 *     GitHub match), the last curator (cards without one), the last runner
 *     (lanes). Blank where nothing records one, never guessed;
 *   - github: newest open/merged PR whose head branch names the item
 *     (substring match on the item id) — blank where nothing matches;
 *   - tree: the linked ~/dev worktree if it exists on disk (with its branch),
 *     else the heartbeat cwd (see below);
 *   - goal: what the item is trying to do (≤10 words, from the packet goal
 *     or the ticket title);
 *   - todo: what's still to be done (≤10 words, derived from live state);
 *   - agent_branch/agent_note/agent_live from heartbeats (blank until an
 *     agent beats one — dispatches do this automatically).
 *
 * Deliberately NOT part of the sweep: the governed writer is append-only, and
 * this tab is overwrite (clear + update). Run it on the VM after a sweep:
 *   node scripts/pm-current.mjs --id=vm
 *
 * Governed identity only: `loadHostEnv` / `identityFromEnv` / `accessToken`
 * from `./lib/google-store.mjs`. Never convert an OAuth bundle to a /tmp ADC
 * file or read the tab back through a second `gws` client — the writer logs
 * the exact `currentReadRange()` to read, and `--print-markdown` renders the
 * same rows as markdown tables with no Google call at all:
 *   node scripts/pm-current.mjs --id=vm --print-markdown
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

export const CURRENT_TAB = 'fleet';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

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
  'goal',
  'todo',
  'last_activity',
  'built_at',
];

/** 0-based column index → A1 letters (0 → A, 19 → T, 26 → AA). */
export function colLetter(index) {
  let n = Number(index);
  if (!Number.isFinite(n) || n < 0) return 'A';
  n = Math.floor(n);
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Exact A1 range for the `fleet` tab given a row count (header + rows).
 * The tab is always CURRENT_COLUMNS wide, so 20 columns × (rows + 1).
 * Bots must read this range verbatim — never guess `T57` vs `T56`.
 */
export function currentReadRange(rowCount) {
  const rows = Math.max(0, Number(rowCount) || 0);
  const lastCol = colLetter(CURRENT_COLUMNS.length - 1);
  return `${CURRENT_TAB}!A1:${lastCol}${rows + 1}`;
}

/** One markdown cell: no pipes, no newlines — same 240-char cap as the sheet. */
export function escapeMarkdownCell(v) {
  return String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '\\|').slice(0, 240);
}

/**
 * Markdown table (`| a | b |` + separator). The chat renderer — not `text`
 * blocks — so the table skill pastes this output verbatim.
 */
export function markdownTable(headers, rows) {
  const head = (Array.isArray(headers) ? headers : []).map(escapeMarkdownCell);
  const body = (Array.isArray(rows) ? rows : []).map((r) =>
    (Array.isArray(r) ? r : []).map(escapeMarkdownCell),
  );
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((cells) => `| ${cells.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** Fleet at a glance, computed from built rows — never hand-counted. */
export function summarizeFleet(builtRows) {
  const rows = Array.isArray(builtRows) ? builtRows : [];
  const byKind = (kind) => rows.filter((r) => r?.item?.kind === kind);
  const countState = (list, state) => list.filter((r) => String(r?.item?.state) === state).length;
  const packets = byKind('spec');
  const cards = byKind('card');
  const lanes = byKind('lane');
  const live = rows.filter((r) => r?.values?.[CURRENT_COLUMNS.indexOf('agent_live')] === 'live').length;
  const stale = rows.filter((r) => r?.values?.[CURRENT_COLUMNS.indexOf('agent_live')] === 'stale').length;
  const blocked = rows.filter((r) => r?.values?.[CURRENT_COLUMNS.indexOf('blocked')] === 'yes').length;
  return {
    packets: packets.length,
    packetsDraft: countState(packets, 'draft'),
    packetsLocked: countState(packets, 'locked'),
    cards: cards.length,
    cardsNew: countState(cards, 'new'),
    cardsPacked: countState(cards, 'packed'),
    cardsInFix: countState(cards, 'in_fix'),
    cardsDone: countState(cards, 'done'),
    lanes: lanes.length,
    lanesUnresolved: countState(lanes, 'unresolved'),
    total: rows.length,
    live,
    stale,
    blocked,
  };
}

/** First 10 words plus an ellipsis when longer. Summaries stay scannable. */
export function tenWords(text) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= 10) return words.join(' ');
  return `${words.slice(0, 10).join(' ')} …`;
}

/**
 * What the item is trying to do, in ≤10 words. Specs: the `## Goal` section's
 * first line, else the packet title. Cards/lanes: their title. Never invented:
 * no goal section and no title means blank.
 */
export function goalFor(item, { specBody = '' } = {}) {
  if (item?.kind === 'spec' && specBody) {
    const lines = String(specBody).split('\n');
    const at = lines.findIndex((l) => /^##\s*goal\s*$/i.test(l.trim()));
    if (at >= 0) {
      const first = lines.slice(at + 1).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (first) return tenWords(first.replace(/^[*-]\s+/, ''));
    }
    const title = lines.map((l) => l.trim()).find((l) => l.startsWith('# '));
    if (title) return tenWords(title.replace(/^#\s*/, '').replace(/^packets?:?\s*/i, ''));
    return '';
  }
  return tenWords(item?.title || '');
}

/**
 * What's still to be done, in ≤10 words — derived from live state, not prose:
 * blocked cards name their block, stalled items name the ladder's verdict,
 * untouched work says what comes next. A steady lane says so.
 */
export function todoFor(item, { rung = '' } = {}) {
  const state = String(item?.state || '').toLowerCase();
  if (rung === 'escalate' || /escalate/i.test(String(item?.stallReason || ''))) return 'needs operator decision';
  if (item?.blocked) return tenWords(`blocked: ${item.blockedReason || item.stallReason || 'waiting'}`);
  if (rung === 'retry') return 'retry the work';
  if (rung === 'another-way') return 'find another way';
  if (item?.kind === 'card') {
    if (state === 'new') return 'awaiting triage and dispatch';
    if (state === 'in_fix') return 'fix in progress';
    if (state === 'packed') return 'packed, awaiting dispatch';
    if (state === 'done') return 'verify and close';
    return `move state ${state || 'unknown'} forward`;
  }
  if (item?.kind === 'spec') {
    if (state === 'draft') return 'draft packet, not started';
    if (state === 'blocked' || state === 'stalled' || state === 'paused') return 'unblock the packet';
    return 'active contract, in progress';
  }
  if (String(item?.lastOutcome || '') && ['ok', 'committed'].includes(String(item.lastOutcome))) return 'steady state, nothing pending';
  return 'in progress';
}

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

/**
 * Who wrote the packet: the newest commit touching the file that carries an
 * `Author:` (or legacy `Agent:`) trailer — i.e. the agent, not the git
 * identity. Packets from before the trailer rule (2026-09-26) fall back to
 * the git author. Blank when git cannot answer.
 */
export function specAuthor(root, file, { exec = nodeExecFileSync } = {}) {
  try {
    const out = String(exec('git', ['log', '--follow', '--format=COMMIT:%H%nWHO:%an%nWHEN:%as%n%B%x1e', '-n', '20', '--', file], { encoding: 'utf8', timeout: 15000, cwd: root }));
    const blocks = out.split('\x1e').map((b) => b.trim()).filter(Boolean);
    let fallback = '';
    for (const b of blocks) {
      const who = (/^WHO:(.+)$/m.exec(b) || [])[1]?.trim() || '';
      const when = (/^WHEN:(.+)$/m.exec(b) || [])[1]?.trim() || '';
      if (!fallback && who) fallback = when ? `${who} ${when}` : who;
      const trailer = (/^(?:Author|Agent):\s*(.+?)\s*$/m.exec(b) || [])[1]?.trim() || '';
      if (trailer) return when ? `${trailer} ${when}` : trailer;
    }
    return fallback;
  } catch {
    return '';
  }
}

/** The agent behind a PR: the `Author:` trailer in its body (the squash keeps
 * it), else the newest branch commit carrying one. Older PRs predate both —
 * blank, never guessed. */
export function prAuthor(number, { exec = nodeExecFileSync } = {}) {
  const trailerOf = (text) => (/^(?:Author|Agent):\s*(.+?)\s*$/m.exec(String(text || '')) || [])[1]?.trim() || '';
  try {
    const body = String(exec('gh', ['pr', 'view', String(number), '--json', 'body', '-q', '.body'], { encoding: 'utf8', timeout: 30000, cwd: ROOT }));
    const fromBody = trailerOf(body);
    if (fromBody) return fromBody;
  } catch {
    return '';
  }
  try {
    const out = exec('gh', ['api', `repos/cwahli/Health-tracker/pulls/${Number(number)}/commits`, '--paginate', '-q', '.[].commit.message'], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, cwd: ROOT });
    const messages = String(out || '').split('\n');
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const hit = trailerOf(messages[i]);
      if (hit) return hit;
    }
  } catch {
    // a PR whose commits cannot be read stays blank
  }
  return '';
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
    const out = exec('gh', ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,headRefName'], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, cwd: ROOT });
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
  goal = '',
  todo = '',
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
    cell(goal),
    cell(todo),
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
  const printMarkdown = arg('print-markdown', '') || arg('format', '') === 'markdown';
  const home = os.homedir();
  const now = new Date().toISOString();

  const { env } = loadHostEnv(botId);

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
    const gh = matchPr(prs, item.id);
    const prNum = /^#(\d+)\b/.exec(gh)?.[1] || '';
    let author = '';
    let lastActivity = String(item.lastActivityAt || '');
    let specBody = '';
    if (item.kind === 'spec') {
      const file = specFileFor(paths.specsDir, item.id);
      if (file) {
        author = specAuthor(root, path.join('specs', 'active', file));
        lastActivity = mtimeOf(path.join(paths.specsDir, file)) || lastActivity;
        try {
          specBody = fs.readFileSync(path.join(paths.specsDir, file), 'utf8');
        } catch {
          specBody = '';
        }
      }
    } else if (item.kind === 'card') {      const tag = String(item.key).replace(/^card:/, '');
      const row = byTag.get(tag);
      // A committed PR names its agent in the body trailer; otherwise the
      // last curator, otherwise blank.
      author = (prNum && prAuthor(prNum)) || String(row?.last_curation?.actor || '');
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
        github: gh,
        goal: goalFor(item, { specBody }),
        todo: todoFor(item, { rung: att.rung || '' }),
        tree,
        lastActivity,
      }),
    };
  });

  if (printMarkdown) {
    const range = currentReadRange(rows.length);
    const sum = summarizeFleet(rows);
    console.log(`read: ${range}`);
    console.log(`fleet: ${sum.packets} packets (${sum.packetsLocked} locked, ${sum.packetsDraft} draft) · ${sum.cards} cards (${sum.cardsPacked} packed, ${sum.cardsNew} new, ${sum.cardsInFix} in_fix, ${sum.cardsDone} done) · ${sum.lanes} lanes · live: ${sum.live} · stale: ${sum.stale} · blocked: ${sum.blocked} · total: ${sum.total}`);
    for (const kind of ['spec', 'card', 'lane']) {
      const group = rows.filter((r) => r?.item?.kind === kind);
      if (!group.length) continue;
      const headers = ['id', 'state', 'owner', 'author', 'github', 'tree', 'agent_live', 'attempts', 'goal', 'todo'];
      const body = group.map((r) => headers.map((h) => r.values[CURRENT_COLUMNS.indexOf(h)] || ''));
      console.log(`\n## ${kind}s (${group.length})`);
      console.log(markdownTable(headers, body));
    }
    return;
  }

  const who = identityFromEnv(env);
  if (!who.ok) throw new Error(`no Google identity: ${who.reason}`);
  const t = await accessToken(who);
  if (!t.ok) throw new Error(`token grant failed: ${t.error}`);
  const token = t.token;
  const sid = String(env.GOOGLE_PM_SHEET_ID || '').trim().replace(/^["']|["']$/g, '');
  if (!sid) throw new Error('GOOGLE_PM_SHEET_ID is not set');

  const metaRes = await getSheet(sid, token);
  if (!metaRes.ok) throw new Error(`cannot read sheet: ${metaRes.error}`);
  const hasTab = (metaRes.sheet.sheets || []).some((s) => s.properties?.title === CURRENT_TAB);
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
  console.log(`current: ${rows.length} row(s) + header written (${done?.updatedCells ?? '?'} cells). read: ${currentReadRange(rows.length)}`);
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

