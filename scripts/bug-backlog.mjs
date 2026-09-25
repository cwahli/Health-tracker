#!/usr/bin/env node
/**
 * bug-backlog.mjs — V-30.5 generated backlog (bug-backlog.md from the store).
 *
 * Sources (in order of preference, selectable with --source=):
 *   api      GET $BUG_API_URL (default http://127.0.0.1:3000) /api/bugs/list
 *            with X-Bug-Api-Token when BUG_API_TOKEN is set (the VPS store).
 *   journal  replay specs/bug-journal/<n>.jsonl from disk — no network, the
 *            CI-safe source (create → … → last state per card).
 *   auto     try api, fall back to journal (default).
 *
 * The hand-compiled evidence file is preserved verbatim as
 * bug-backlog.legacy.md and embedded under "Legacy evidence" — the generator
 * never deletes evidence (§6.2 V-30.5). The BUG-8449 'Issues (7 items)' rows
 * therefore survive regeneration, keeping assert-bug-pack.mjs fixture
 * traceability meaningful (fixture vs the preserved hand-compiled table).
 *
 * Usage:
 *   node scripts/bug-backlog.mjs                 # regenerate bug-backlog.md
 *   node scripts/bug-backlog.mjs --out=path.md    # write elsewhere
 *   node scripts/bug-backlog.mjs --source=journal # force disk source
 *   node scripts/bug-backlog.mjs --check          # verify BUG-8449 parity
 *                                                 # (fixture + legacy) and
 *                                                 # evidence preservation;
 *                                                 # exit 1 on mismatch
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const SOURCE = arg('source', 'auto');
const OUT = arg('out', path.join(ROOT, 'bug-backlog.md'));
const CHECK = argv.includes('--check');

const LEGACY_PATH = path.join(ROOT, 'bug-backlog.legacy.md');
const FIXTURE_PATH = path.join(ROOT, 'scripts/fixtures/bug-8449.json');
const JOURNAL_DIR = path.join(ROOT, 'specs/bug-journal');
const API_BASE = process.env.BUG_API_URL || 'http://127.0.0.1:3000';

function mdCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function journalMeta() {
  const map = new Map();
  if (!fs.existsSync(JOURNAL_DIR)) return map;
  for (const file of fs.readdirSync(JOURNAL_DIR)) {
    if (!/^\d+\.jsonl$/.test(file)) continue;
    const rows = fs
      .readFileSync(path.join(JOURNAL_DIR, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    map.set(Number(file.replace(/\D/g, '')), {
      attempts: rows.filter((r) => r.op === 'attempt').length,
      last: rows.length ? rows[rows.length - 1].at || '' : '',
    });
  }
  return map;
}

async function loadFromApi() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const headers = {};
    if (process.env.BUG_API_TOKEN) headers['X-Bug-Api-Token'] = process.env.BUG_API_TOKEN;
    const res = await fetch(`${API_BASE}/api/bugs/list`, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const rows = body.rows || [];
    const meta = journalMeta();
    return rows.map((r) => {
      const j = meta.get(r.public_n) || {};
      return {
        public_n: r.public_n,
        tag_id: r.tag_id || '',
        title: r.title || '',
        state: r.state || r.status || '',
        flags: r.flags && typeof r.flags === 'object' ? r.flags : {},
        assignee: r.assignee || '',
        attempts: Array.isArray(r.attempts) ? r.attempts.length : j.attempts || 0,
        last: r.updated_at || r.updated || j.last || '',
        source: 'api',
      };
    });
  } finally {
    clearTimeout(t);
  }
}

function loadFromJournal() {
  if (!fs.existsSync(JOURNAL_DIR)) return [];
  const cards = [];
  for (const file of fs.readdirSync(JOURNAL_DIR).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))) {
    if (!/^\d+\.jsonl$/.test(file)) continue;
    const public_n = Number(file.replace(/\D/g, ''));
    const rows = fs
      .readFileSync(path.join(JOURNAL_DIR, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!rows.length) continue;
    const create = rows.find((r) => r.op === 'create') || {};
    const titled = rows.find((r) => r.title);
    const last = rows[rows.length - 1];
    const pack = [...rows].reverse().find((r) => r.op === 'pack');
    const attempts = rows.filter((r) => r.op === 'attempt').length;
    cards.push({
      public_n,
      tag_id: last.tag_id || create.tag_id || '',
      title: create.title || (titled && titled.title) || (pack && pack.defect && pack.defect.component) || `(untitled ${last.tag_id || file})`,
      state: last.state || '',
      flags: last.flags || {},
      assignee: last.assignee || create.assignee || '',
      attempts,
      last: last.at || '',
      source: 'journal',
    });
  }
  return cards.sort((a, b) => a.public_n - b.public_n);
}

async function loadCards() {
  if (SOURCE === 'journal') return { cards: loadFromJournal(), via: 'journal (forced)' };
  if (SOURCE === 'api') return { cards: await loadFromApi(), via: 'store api (forced)' };
  try {
    const cards = await loadFromApi();
    return { cards, via: 'store api' };
  } catch {
    return { cards: loadFromJournal(), via: 'journal replay (api unreachable)' };
  }
}

function flagSummary(flags) {
  const parts = [];
  for (const [k, v] of Object.entries(flags || {})) {
    if (v === false || v == null) continue;
    parts.push(v === true ? k : `${k}: ${v}`);
  }
  return parts.join('; ');
}

function render({ cards, via }, legacyText, generatedAt) {
  const lines = [];
  lines.push('# Bug Backlog — Health-tracker QA');
  lines.push(`**Generated:** ${generatedAt}  ·  **Generator:** \`node scripts/bug-backlog.mjs\``);
  lines.push(`**Store source:** ${via}  ·  **Legacy evidence:** \`bug-backlog.legacy.md\` (preserved, embedded verbatim below)`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## Ticket store (${cards.length} card${cards.length === 1 ? '' : 's'})`);
  lines.push('');
  lines.push('| # | Tag | Title | State | Flags | Assignee | Attempts | Last event |');
  lines.push('|---|-----|-------|-------|-------|----------|----------|------------|');
  for (const c of cards) {
    lines.push(
      `| ${c.public_n} | \`${mdCell(c.tag_id)}\` | ${mdCell(c.title)} | ${mdCell(c.state)} | ${mdCell(flagSummary(c.flags))} | ${mdCell(c.assignee) || '—'} | ${c.attempts} | ${mdCell(c.last)} |`,
    );
  }
  if (!cards.length) lines.push('| — | — | (no cards — store unreachable and no journal rows) | — | — | — | — | — |');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Legacy evidence (preserved hand-compiled — do not edit)');
  lines.push('');
  lines.push(legacyText.replace(/\s+$/, ''));
  lines.push('');
  return lines.join('\n');
}

function extractBug8449Rows(md) {
  const norm = (s) => String(s).replace(/[**`]/g, '').replace(/\s+/g, ' ').trim();
  const tableSec = (md.split('### Issues (7 items)')[1] || '').split('###')[0];
  return tableSec
    .split('\n')
    .map((l) => l.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/))
    .filter(Boolean)
    .map((m) => ({ issue: norm(m[2]), observed: norm(m[3]), expected: norm(m[4] || '') }));
}

function check(md, legacyText) {
  let pass = 0;
  let fail = 0;
  const ck = (name, ok, detail = '') => {
    if (ok) {
      pass++;
      console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
      fail++;
      console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  const norm = (s) => String(s).replace(/[**`]/g, '').replace(/\s+/g, ' ').trim();
  const fixtureRows = fixture.items.map((it) => ({ issue: norm(it.issue), observed: norm(it.observed), expected: norm(it.expected) }));
  const genRows = extractBug8449Rows(md);
  ck('generated backlog reproduces the BUG-8449 fixture (7 rows)', genRows.length === 7 && JSON.stringify(genRows) === JSON.stringify(fixtureRows), `${genRows.length} rows`);
  const legacyRows = extractBug8449Rows(legacyText);
  ck('generated BUG-8449 rows match the hand-compiled legacy table', legacyRows.length === 7 && JSON.stringify(genRows) === JSON.stringify(legacyRows), `${legacyRows.length} legacy rows`);
  ck('BUG-8449 title preserved', md.includes(`**Title** | ${fixture.title}`));
  ck('legacy evidence embedded verbatim (nothing deleted)', md.includes(legacyText.trim()));
  ck('legacy evidence file preserved on disk', fs.existsSync(LEGACY_PATH));
  ck('store section present', /^## Ticket store \(\d+ card/m.test(md));

  console.log(`\n${pass} pass, ${fail} fail`);
  return fail ? 1 : 0;
}

const legacyText = fs.existsSync(LEGACY_PATH) ? fs.readFileSync(LEGACY_PATH, 'utf8') : null;
if (legacyText == null) {
  console.error(`FATAL: ${path.relative(ROOT, LEGACY_PATH)} missing — preserve the hand-compiled bug-backlog.md first (cp bug-backlog.md bug-backlog.legacy.md). No evidence may be deleted.`);
  process.exit(2);
}

const loaded = await loadCards();
// Stable artifact: --check renders with the committed file's own timestamp so
// regeneration is deterministic; a fresh write stamps the real generation time.
const stampMatch = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').match(/\*\*Generated:\*\* (\S+)/) : null;
const generatedAt = CHECK && stampMatch ? stampMatch[1] : new Date().toISOString();
const md = render(loaded, legacyText, generatedAt);

if (CHECK) {
  process.exit(check(md, legacyText));
}

fs.writeFileSync(OUT, md.endsWith('\n') ? md : `${md}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${loaded.cards.length} cards via ${loaded.via}, legacy evidence preserved.`);
