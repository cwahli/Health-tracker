#!/usr/bin/env node
/**
 * assert-bug-pack.mjs — V-30.2 named gate (packer fixtures + bootstrap).
 *
 * Proves the packer gate without a live server / Telegram token:
 *  1. scripts/lib/bug-pack.mjs exists and exports packCheck / split / fingerprint.
 *  2. bugctl pack --check exits 0 on a valid payload, 1 on bundled/missing criteria.
 *  3. Fixture (a): BUG-8449 7-item report → 1 card + split list (never bundled).
 *  4. Fixture (b): vague report → isVagueReport true (needs_repro signal).
 *  5. Fixture (c): duplicate → identical fingerprint (merge key).
 *  6. Skill scripts/skills/common/bug-ticket/SKILL.md present + frontmatter name.
 *  7. sync-hermes-skills excludes orchestrator-dispatcher from bug_ticket.
 *  8. bots/registry.json has hermes_bug_ticket with enabled:false + tokenEnv.
 *  9. capability rows svc-bug-ticket / proc-ticket-state / sess-ticket-resume exist.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 * E2E Telegram reply is deliberately NOT in this gate (P9 token = human step).
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

  // 3. Fixture (a) — BUG-8449
  const bug8449 = {
    title: 'Home dashboard discrepancies vs reference design',
    items: [
      { issue: 'Bottom nav tab 2 label/icon', observed: 'Health (pulse icon)', expected: 'Trends (line graph)' },
      { issue: 'Bottom nav tab 5 label/icon', observed: 'Trends (upward line)', expected: 'Progress (trending arrow)' },
      {
        issue: 'Omega-3 weekly target display',
        observed: '7.700000000000001g (floating-point artifact)',
        expected: '7.7g (clean)',
        component: 'Weekly targets',
        class: 'UI',
        surface: 'home',
      },
      { issue: 'Telemetry Errors banner', observed: 'Visible at top of page', expected: 'Absent' },
      { issue: 'Ready (5) status pill', observed: 'Missing from header', expected: 'Green pill with checkmark' },
      { issue: 'Extra sections present', observed: 'Health status / Clinical Action / Daily Benefits', expected: 'Absent' },
      { issue: "What's up today button", observed: 'Present under Daily Recommendation', expected: 'Absent' },
    ],
  };
  const a = splitMultiItemReport(bug8449);
  check('(a) 7-item report → ok', a.ok === true, a.error || '');
  check('(a) split list has 6', a.split?.length === 6, `got ${a.split?.length}`);
  check('(a) one card (omega-3)', /7\.700000000000001/.test(a.card?.observed || ''));
  check('(a) card itself passes packCheck', a.ok && packCheck(a.card).ok);

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

// 8. registry
try {
  const reg = JSON.parse(read('bots/registry.json'));
  const entry = (reg.bots || []).find((b) => b.id === 'hermes_bug_ticket');
  check('registry hermes_bug_ticket present', !!entry);
  if (entry) {
    check('hermes_bug_ticket enabled:false (E2E/token pending)', entry.enabled === false);
    check('tokenEnv HERMES_BUG_TICKET_TOKEN', entry.telegram?.tokenEnv === 'HERMES_BUG_TICKET_TOKEN');
    check('profile bug_ticket', entry.hermes?.profile === 'bug_ticket');
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

// profile bootstrap (local; missing is warn-level fail so VPS setup is explicit)
const prof = path.join(process.env.HOME || '/home/ubuntu', '.hermes/profiles/bug_ticket');
check('hermes profile bug_ticket/SOUL.md', fs.existsSync(path.join(prof, 'SOUL.md')));
check('hermes profile bug_ticket/config.yaml preloads bug-ticket', (() => {
  try {
    return /bug-ticket/.test(fs.readFileSync(path.join(prof, 'config.yaml'), 'utf8'));
  } catch {
    return false;
  }
})());
check('MEMORY.md within 2200 chars', (() => {
  try {
    return fs.readFileSync(path.join(prof, 'memories/MEMORY.md'), 'utf8').length <= 2200;
  } catch {
    return false;
  }
})());

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
process.exit(0);
