#!/usr/bin/env node
/**
 * assert-bug-retro-audit.mjs — V-30.5 / §4.10 amnesia gate.
 *
 * Re-opens BUG-20260921-8449 from the generated backlog and answers the six
 * §4.10 questions from **disk alone** (journal + backlog + fixture + docs) —
 * no chat log, no API, no network. If any answer would need chat scrollback,
 * the gate fails; that is the whole point (amnesia is gone).
 *
 * Inputs (all committed):
 *   specs/bug-journal/<n>.jsonl   the re-opened BUG-8449 record (create+pack+plan)
 *   bug-backlog.md                generated store view (legacy embedded)
 *   bug-backlog.legacy.md         preserved hand-compiled evidence
 *   scripts/fixtures/bug-8449.json the 7-item fixture
 *   docs/agent/BUG_PIPELINE.md    roles/gates the answers reference
 *
 * Prints Q1..Q6 answers (the V-30.5 recorded transcript) then exits 0/1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
const answers = {};

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('assert-bug-retro-audit (V-30.5, §4.10 — answers from disk alone)\n');

// --- locate the re-opened BUG-8449 record in the journal (disk) -----------
const journalDir = path.join(ROOT, 'specs/bug-journal');
let card = null;
const journalRows = [];
if (fs.existsSync(journalDir)) {
  for (const file of fs.readdirSync(journalDir).sort()) {
    if (!/^\d+\.jsonl$/.test(file)) continue;
    const rows = fs
      .readFileSync(path.join(journalDir, file), 'utf8')
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
    journalRows.push({ file, rows });
    const create = rows.find((r) => r.op === 'create' && /BUG-20260921-8449/.test(r.title || ''));
    if (create && !card) card = { public_n: file.replace(/\D/g, ''), tag_id: create.tag_id, rows };
  }
}
check('re-opened BUG-8449 card exists in specs/bug-journal (disk record)', !!card, card ? `card #${card.public_n} (${card.tag_id})` : 'no create row titled BUG-20260921-8449');

let legacy = '';
let backlog = '';
let fixture = null;
try {
  legacy = read('bug-backlog.legacy.md');
  check('preserved legacy evidence file present', true);
} catch {
  check('preserved legacy evidence file present', false, 'bug-backlog.legacy.md missing');
}
try {
  backlog = read('bug-backlog.md');
  check('generated backlog present', true);
} catch {
  check('generated backlog present', false, 'bug-backlog.md missing');
}
try {
  fixture = JSON.parse(read('scripts/fixtures/bug-8449.json'));
  check('BUG-8449 fixture present', Array.isArray(fixture.items) && fixture.items.length === 7);
} catch {
  check('BUG-8449 fixture present', false);
}
let roles = '';
try {
  roles = read('docs/agent/BUG_PIPELINE.md');
  check('BUG_PIPELINE roles/gates doc present', /Who moves what/.test(roles));
} catch {
  check('BUG_PIPELINE roles/gates doc present', false);
}

if (card) {
  const rows = card.rows;
  const pack = [...rows].reverse().find((r) => r.op === 'pack');
  const plan = [...rows].reverse().find((r) => r.op === 'plan');
  const last = rows[rows.length - 1];

  // Q1 — What am I working on?
  const q1ok = !!pack?.defect?.component && !!pack?.defect?.observed && backlog.includes(`| ${card.public_n} |`);
  check('Q1 answerable from disk (card row + defect)', q1ok);
  answers['Q1 (what am I working on?)'] = card
    ? `#${card.public_n} "${rows.find((r) => r.op === 'create')?.title}" — defect: ${pack?.defect?.component}: ${pack?.defect?.observed} (state ${last?.state || 'new'}, from journal ${card.public_n}.jsonl + generated bug-backlog.md row)`
    : '(card missing)';

  // Q2 — What has already been tried and burned?
  const burned = plan?.plan?.hypothesis || '';
  const legacyBurns = /Dispatch attempts/.test(legacy) && /FAILED_PRECONDITION|all agents failed|no code changes/.test(legacy);
  const q2ok = burned.length > 40 && legacyBurns;
  check('Q2 answerable from disk (plan row burned ledger + legacy dispatch evidence)', q2ok, `${burned.length}-char plan hypothesis`);
  answers['Q2 (tried and burned?)'] = burned || '(missing)';

  // Q3 — What is the exact next command?
  const q3 = `node scripts/bugctl.mjs packet --id=#${card.public_n} --format=text`;
  const q3ok = /bugctl packet|packet --id/.test(roles) && plan?.plan?.gates?.length > 0;
  check('Q3 answerable from disk (packet command in BUG_PIPELINE + plan gates posted)', q3ok, q3);
  answers['Q3 (exact next command)'] = q3;

  // Q4 — Where is the evidence?
  const evi = [];
  if (/qa-evidence\//.test(legacy)) evi.push(...(legacy.match(/\/[\w./-]*qa-evidence\/[\w.-]+/g) || []).slice(0, 3));
  if (/dispatch_BUG-20260921-8449\.log/.test(legacy)) evi.push('~/.hermes/logs/dispatch_BUG-20260921-8449.log');
  if (fixture?.source) evi.push(`scripts/fixtures/bug-8449.json (source: ${String(fixture.source).slice(0, 60)}…)`);
  evi.push(`specs/bug-journal/${card.public_n}.jsonl`);
  const q4ok = evi.length >= 3 && /qa-evidence\//.test(legacy);
  check('Q4 answerable from disk (evidence paths in legacy backlog + journal + fixture)', q4ok, `${evi.length} pointers`);
  answers['Q4 (where is the evidence?)'] = evi.join(' | ');

  // Q5 — What closes this ticket?
  const gate = (plan?.plan?.gates || [])[0] || '';
  const q5ok = !!gate && /named_test/.test(roles) && /author\s*≠\s*verifier|non-author verifier/i.test(roles) && !!pack?.defect?.criteria;
  check('Q5 answerable from disk (plan gate + verify contract + defect criteria)', q5ok, gate || '(no gate)');
  answers['Q5 (what closes this ticket?)'] = `verify --result green --command "${gate}" by a non-author verifier (criteria: ${pack?.defect?.criteria || 'n/a'})`;

  // Q6 — Who is waiting on whom?
  const q6ok = /Who moves what/.test(roles) && /Verifier/.test(roles) && /never/i.test(roles);
  const chain = 'steward packs (done) → qa_meal repro → orchestrator plan/dispatch (plan posted) → builder fix → non-author verifier posts named_test verify; human owns the needs-human list';
  check('Q6 answerable from disk (role chain in BUG_PIPELINE from card state)', q6ok, `state=${last?.state}`);
  answers['Q6 (who is waiting on whom?)'] = chain;
}

// Generated backlog must surface the record (the "re-open from the generated
// backlog" step): the store section lists the re-opened card.
if (card && backlog) {
  check('generated backlog lists the re-opened card (store section)', new RegExp(`\\| ${card.public_n} \\|`).test(backlog));
}

console.log('\n§4.10 answers (recorded transcript — no chat used):');
for (const [q, a] of Object.entries(answers)) {
  console.log(`  ${q}: ${a}`);
}
const answered = Object.keys(answers).length;
console.log(`\n${pass} pass, ${fail} fail (${answered}/6 questions answered from disk)`);
process.exit(fail || answered !== 6 ? 1 : 0);
