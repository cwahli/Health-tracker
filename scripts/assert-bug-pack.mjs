#!/usr/bin/env node
/**
 * assert-bug-pack.mjs — V-30.2 named gate (packer fixtures + bootstrap).
 *
 * Proves the packer gate without a live server / Telegram token:
 *  1. scripts/lib/bug-pack.mjs exists and exports packCheck / split / fingerprint.
 *  2. bugctl pack --check exits 0 on a valid payload, 1 on bundled/missing criteria.
 *  3. Fixture (a): the committed BUG-8449 fixture (scripts/fixtures/bug-8449.json,
 *     derived from bug-backlog.md's Issues table — traceability checked here) →
 *     1 card + split list via BOTH the helper and the real CLI intake path
 *     (bugctl pack --split + bugctl pack --check).
 *  4. Fixture (b): vague report → isVagueReport true (needs_repro signal).
 *  5. Fixture (c): duplicate → identical fingerprint (merge key).
 *  6. Skill scripts/skills/common/bug-ticket/SKILL.md present + frontmatter name.
 *  7. sync-hermes-skills excludes orchestrator-dispatcher from bug_ticket.
 *  8. bots/registry.json has hermes_bug_ticket enabled:true + @BotFather handle
 *     (V-30.2 closed: P9 token + one live E2E recorded in AI_HANDOVER.md).
 *  9. capability rows svc-bug-ticket / proc-ticket-state / sess-ticket-resume exist.
 * 10. Packer-only boundary (documented §6.2 audit follow-up): the server's
 *     validateDefect enforces required fields; single-defect + fingerprint stay
 *     packer-side at `bugctl pack --check` — wiring + tests asserted here.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 * E2E Telegram reply itself is not re-run here (P9 = human step, recorded in git/docs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

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

console.log('assert-bug-pack (V-30.2)\n');

const packPath = path.join(ROOT, 'scripts/lib/bug-pack.mjs');
check('bug-pack.mjs exists', fs.existsSync(packPath));
if (fs.existsSync(packPath)) {
  const src = read('scripts/lib/bug-pack.mjs');
  for (const fn of ['export function packCheck', 'export function splitMultiItemReport', 'export function fingerprint', 'export function isVagueReport']) {
    check(`exports ${fn.replace('export function ', '')}`, src.includes(fn));
  }

  const { packCheck, splitMultiItemReport, isVagueReport, fingerprint } = await import(
    new URL(`file://${path.join(ROOT, 'scripts/lib/bug-pack.mjs').replace(/\\/g, '/')}`).href
  );

  // 2. bugctl pack --check
  const ctl = path.join(ROOT, 'scripts/bugctl.mjs');
  check('bugctl has pack --check', /case 'pack'/.test(read('scripts/bugctl.mjs')) && read('scripts/bugctl.mjs').includes('args.check'));
  try {
    execFileSync(
      'node',
      [
        ctl,
        'pack',
        '--check',
        '--component',
        'Weekly targets',
        '--observed',
        'Omega-3 shows 7.700000000000001g',
        '--expected',
        '7.7g',
        '--criteria',
        'Weekly targets pill shows 7.7g after load',
        '--class',
        'UI',
        '--surface',
        'home',
        '--json',
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: 'pipe' }
    );
    check('pack --check accepts valid single defect', true);
  } catch (e) {
    check('pack --check accepts valid single defect', false, String(e.stderr || e.message).slice(0, 200));
  }
  try {
    execFileSync(
      'node',
      [ctl, 'pack', '--check', '--component', 'Home', '--observed', '1. a\n2. b\n3. c', '--expected', '1. x\n2. y\n3. z', '--criteria', 'ok', '--json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: 'pipe' }
    );
    check('pack --check rejects bundled report', false, 'expected non-zero exit');
  } catch {
    check('pack --check rejects bundled report', true);
  }

  // 3. Fixture (a) — BUG-8449: committed normalized fixture derived from bug-backlog.md
  const fixturePath = path.join(ROOT, 'scripts/fixtures/bug-8449.json');
  check('(a) committed fixture scripts/fixtures/bug-8449.json exists', fs.existsSync(fixturePath));
  const bug8449 = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  check('(a) fixture has 7 items', Array.isArray(bug8449.items) && bug8449.items.length === 7, `got ${bug8449.items?.length}`);

  // Traceability: fixture rows must match bug-backlog.md's Issues (7 items) table.
  const backlog = read('bug-backlog.md');
  const norm = (s) => String(s).replace(/[**`]/g, '').replace(/\s+/g, ' ').trim();
  const tableSec = (backlog.split('### Issues (7 items)')[1] || '').split('###')[0];
  const backlogRows = tableSec
    .split('\n')
    .map((l) => l.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/))
    .filter(Boolean)
    .map((m) => ({ issue: norm(m[2]), observed: norm(m[3]), expected: norm(m[4] || '') }));
  const fixtureRows = bug8449.items.map((it) => ({ issue: norm(it.issue), observed: norm(it.observed), expected: norm(it.expected) }));
  check(
    '(a) fixture is traceable to bug-backlog.md (7 rows match normalized source)',
    backlogRows.length === 7 && JSON.stringify(backlogRows) === JSON.stringify(fixtureRows),
    `${backlogRows.length} source rows`,
  );
  check('(a) fixture source field names bug-backlog.md', /bug-backlog\.md/.test(bug8449.source || ''));
  check('(a) fixture title matches backlog title', backlog.includes(`**Title** | ${bug8449.title}`));

  const a = splitMultiItemReport(bug8449);
  check('(a) helper: 7-item report → ok', a.ok === true, a.error || '');
  check('(a) helper: split list has 6', a.split?.length === 6, `got ${a.split?.length}`);
  check('(a) helper: one card (omega-3)', /7\.700000000000001/.test(a.card?.observed || ''));
  check('(a) helper: card itself passes packCheck', a.ok && packCheck(a.card).ok);

  // Real intake path (CLI, not the helper): bugctl pack --split then pack --check.
  try {
    const splitOut = JSON.parse(
      execFileSync('node', [ctl, 'pack', '--split', 'scripts/fixtures/bug-8449.json', '--json'], {
        cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: 'pipe',
      })
    );
    check('(a) CLI: bugctl pack --split → ok + 6 split', splitOut.ok === true && splitOut.split?.length === 6, splitOut.error || `split=${splitOut.split?.length}`);
    const c = splitOut.card || {};
    try {
      execFileSync('node', [
        ctl, 'pack', '--check',
        '--component', String(c.component || ''),
        '--observed', String(c.observed || ''),
        '--expected', String(c.expected || ''),
        '--criteria', String(c.criteria || ''),
        '--class', String(c.class || 'UI'),
        '--surface', String(c.surface || 'home'),
        '--json',
      ], { cwd: ROOT, encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
      check('(a) CLI: split card passes pack --check', true);
    } catch (e) {
      check('(a) CLI: split card passes pack --check', false, String(e.stderr || e.message).slice(0, 200));
    }
  } catch (e) {
    check('(a) CLI: bugctl pack --split → ok + 6 split', false, String(e.stderr || e.message).slice(0, 200));
    check('(a) CLI: split card passes pack --check', false, 'split step failed');
  }

  // 4. Fixture (b)
  check('(b) vague "it looks wrong" → needs_repro signal', isVagueReport('it looks wrong') === true);
  check('(b) empty → needs_repro signal', isVagueReport('') === true);
  check('(b) concrete report is not vague', isVagueReport('On /home the omega-3 weekly target pill renders 7.700000000000001g while the reference shows 7.7g.') === false);

  // 5. Fixture (c)
  const at = '2026-09-22T12:00:00Z';
  const c1 = fingerprint('UI', 'omega-3 weekly target shows 7.700000000000001g', at);
  const c2 = fingerprint('UI', 'Omega-3 weekly target shows 7.700000000000001g', at);
  check('(c) duplicate fingerprint merge key', c1 === c2 && c1.split('|')[0] === 'UI', c1);
}

// 6. skill
const skillPath = path.join(ROOT, 'scripts/skills/common/bug-ticket/SKILL.md');
check('bug-ticket SKILL.md exists', fs.existsSync(skillPath));
if (fs.existsSync(skillPath)) {
  const text = read('scripts/skills/common/bug-ticket/SKILL.md');
  check('skill frontmatter name: bug-ticket', /^---\nname: bug-ticket\n/.test(text));
  check('skill forbids dispatch', /orchestrator-dispatcher/.test(text) && /never/i.test(text));
  check('skill encodes three laws', /If it is not on a card/.test(text));
}

// 7. sync filter
const sync = read('scripts/sync-hermes-skills.sh');
check('sync excludes orchestrator-dispatcher from bug_ticket', /bug_ticket/.test(sync) && /orchestrator-dispatcher/.test(sync));

// 8. registry — V-30.2 closed: enabled after one live E2E reply + BotFather handle
try {
  const reg = JSON.parse(read('bots/registry.json'));
  const entry = (reg.bots || []).find((b) => b.id === 'hermes_bug_ticket');
  check('registry hermes_bug_ticket present', !!entry);
  if (entry) {
    check('hermes_bug_ticket enabled:true (E2E closed)', entry.enabled === true);
    check('hermes.username is the BotFather handle', typeof entry.hermes?.username === 'string' && /^@[A-Za-z0-9_]+$/.test(entry.hermes.username), entry.hermes?.username);
    check('tokenEnv HERMES_BUG_TICKET_TOKEN', entry.telegram?.tokenEnv === 'HERMES_BUG_TICKET_TOKEN');
    check('profile bug_ticket', entry.hermes?.profile === 'bug_ticket');
    check('E2E session artifact recorded in AI_HANDOVER.md', read('AI_HANDOVER.md').includes('20260924_162828_f191298f'));
  }
} catch (e) {
  check('registry.json parses', false, e.message);
}

// 9. capability rows
try {
  const caps = JSON.parse(read('bots/capabilities.json'));
  const ids = new Set((caps.capabilities || []).map((c) => c.id));
  for (const id of ['svc-bug-ticket', 'proc-ticket-state', 'sess-ticket-resume']) {
    check(`capability ${id}`, ids.has(id));
  }
} catch (e) {
  check('capabilities.json parses', false, e.message);
}

// profile bootstrap — V-30.5 CI-safe host-profile check. On a host that has
// ~/.hermes at all, the bug_ticket profile must exist and pass exactly as
// before (strength unchanged). A clean runner without ~/.hermes uses the
// committed fixture profile (scripts/fixtures/hermes-profiles/bug_ticket) so
// the same three assertions still exercise real content — no repository
// assertion is skipped. BUGTICKET_PROFILE_HOME forces a specific profile dir.
const homeDir = process.env.HOME || '/home/ubuntu';
const forcedProfile = process.env.BUGTICKET_PROFILE_HOME;
const hostHasHermes = fs.existsSync(path.join(homeDir, '.hermes'));
const useFixtureProfile = !forcedProfile && !hostHasHermes;
const prof = forcedProfile || (useFixtureProfile ? path.join(ROOT, 'scripts/fixtures/hermes-profiles/bug_ticket') : path.join(homeDir, '.hermes/profiles/bug_ticket'));
const profNote = useFixtureProfile ? ' (fixture HOME — clean runner)' : '';
check(`hermes profile bug_ticket/SOUL.md${profNote}`, fs.existsSync(path.join(prof, 'SOUL.md')));
check(`hermes profile bug_ticket/config.yaml preloads bug-ticket${profNote}`, (() => {
  try {
    return /bug-ticket/.test(fs.readFileSync(path.join(prof, 'config.yaml'), 'utf8'));
  } catch {
    return false;
  }
})());
check(`MEMORY.md within 2200 chars${profNote}`, (() => {
  try {
    return fs.readFileSync(path.join(prof, 'memories/MEMORY.md'), 'utf8').length <= 2200;
  } catch {
    return false;
  }
})());

// 10. Packer-only boundary (§6.2 audit follow-up): server validates required
// fields through validateDefect (tested in bugTicketState.test.ts); the
// single-defect + fingerprint rules live ONLY at bugctl pack --check (proven
// by fixture (a) above). Documented in plan/BUG_TICKET_PIPELINE.md §5.2.
const serverSrc = read('serverBugSnapshot.ts');
check('boundary: server defect route validates via validateDefect', /app\.post\('\/api\/bugs\/:tagId\/defect',\s*bugWriteGuard/.test(serverSrc) && /const v = validateDefect\(req\.body/.test(serverSrc));
check('boundary: validateDefect required-fields unit-tested', /validateDefect\(/.test(read('src/utils/bugTicketState.test.ts')));
check('boundary: single-defect rule not duplicated server-side (packer-only)', !/looksBundled|splitMultiItemReport/.test(serverSrc));
const pipelineDoc = read('plan/BUG_TICKET_PIPELINE.md');
const sec52 = (pipelineDoc.split('### 5.2')[1] || '').split('\n### ')[0] || '';
check('boundary documented in BUG_TICKET_PIPELINE §5.2', /packer-only boundary/i.test(sec52) && /does \*\*not\*\* duplicate `looksBundled`/.test(sec52));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
process.exit(0);
