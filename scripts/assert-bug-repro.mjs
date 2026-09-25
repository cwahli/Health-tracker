#!/usr/bin/env node
/**
 * assert-bug-repro.mjs — V-30.3 named gate (reproducer lane).
 *
 * Proves the repro contract end-to-end without a live server:
 *  1. reproCheck (scripts/lib/bug-pack.mjs) mirrors validateRepro exactly:
 *     same 5-status vocabulary, same artifact fields — no invented states.
 *  2. bugctl wires `repro --check` (validate-only, no HTTP) and runs the check
 *     BEFORE every repro POST.
 *  3. qa-runner --ticket loads the packet, runs the command, writes the §4.6
 *     bundle (repro.txt, run.log, before.png, expected.md, result.json) as R2
 *     keys under bugs/<tag_id>/<ts>-<kind>.<ext>, and posts the verdict through
 *     bugctl repro — while --journey=meal|biomarker|onboarding stays intact.
 *  4. scripts/skills/common/qa-reproduce/SKILL.md exists and encodes both
 *     verdicts, the not_needed ≠ not_reproducible rule, and reproduce-only law.
 *  5. The durable profile path preloads qa-reproduce into qa_meal.
 *  6. bots/capabilities.json carries svc-repro and every expect file exists.
 *  7. V-30.2 closure is durable: registry enabled + @Bug_ticket_bot + E2E artifact.
 *  8. Offline projection walk: both verdicts persist and derive exactly the
 *     flags bugState() defines (confirmed → none, failed → not_reproducible,
 *     needed → needs_repro, not_needed → none, conflict → blocked).
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { reproCheck, REPRO_STATUSES } from './lib/bug-pack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function bugctl(args) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'bugctl.mjs'), ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

console.log('assert-bug-repro (V-30.3)\n');

// ---------------------------------------------------------------------------
// 1. reproCheck vocabulary + artifact fields (pure import)
// ---------------------------------------------------------------------------
console.log('1. reproCheck mirrors validateRepro');
check(
  'REPRO_STATUSES is exactly the validateRepro vocabulary',
  JSON.stringify(REPRO_STATUSES) === JSON.stringify(['not_needed', 'needed', 'confirmed', 'failed', 'ambiguous']),
  REPRO_STATUSES.join(','),
);
const stateSrc = read('src/utils/bugTicketState.ts');
check(
  'validateRepro declares the same 5 statuses',
  /const allowed = \[\s*'not_needed',\s*'needed',\s*'confirmed',\s*'failed',\s*'ambiguous'\s*\]/.test(stateSrc),
);
check(
  'validateRepro still owns the artifact rules (confirmed/failed requirements)',
  /confirmed repro requires command and exit_code/.test(stateSrc) &&
    /repro\.status must be one of/.test(stateSrc),
);

const knownBad = {
  status: 'confirmed',
  command: 'node scripts/qa-runner.mjs --ticket=2 --command="node check.mjs"',
  exit_code: 0,
  run_log: 'bugs/tag_1/1758700000000-run.log',
  before: 'bugs/tag_1/1758700000000-before.png',
};
const knownGood = { status: 'failed', run_log: 'bugs/tag_1/1758700000001-run.log' };

const kb = reproCheck(knownBad);
check('known-bad verdict (confirmed + command + exit_code + run.log + before.png) accepted', kb.ok === true, kb.ok ? '' : kb.error);
const kg = reproCheck(knownGood);
check('known-good verdict (failed + run.log) accepted', kg.ok === true, kg.ok ? '' : kg.error);

check('confirmed without exit_code rejected', reproCheck({ status: 'confirmed', command: 'x' }).ok === false);
check('confirmed without command rejected', reproCheck({ status: 'confirmed', exit_code: 0 }).ok === false);
check('failed without run_log rejected', reproCheck({ status: 'failed' }).ok === false);
check('ambiguous without run_log rejected', reproCheck({ status: 'ambiguous' }).ok === false);
check('not_needed alone accepted (no artifact requirement)', reproCheck({ status: 'not_needed' }).ok === true);
check('needed alone accepted (packer needs_repro post)', reproCheck({ status: 'needed' }).ok === true);
check(
  'invented status not_reproducible rejected (no new state)',
  reproCheck({ status: 'not_reproducible', run_log: 'k' }).ok === false,
);
check('non-numeric exit_code rejected', reproCheck({ ...knownBad, exit_code: 'abc' }).ok === false);

// ---------------------------------------------------------------------------
// 2. bugctl wiring: repro --check before every POST
// ---------------------------------------------------------------------------
console.log('\n2. bugctl repro --check');
try {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'scripts', 'bugctl.mjs')], { stdio: 'pipe' });
  check('bugctl.mjs syntax valid', true);
} catch (e) {
  check('bugctl.mjs syntax valid', false, String(e.stderr || e.message).slice(0, 200));
}
const ctl = read('scripts/bugctl.mjs');
check('bugctl imports reproCheck', /import \{[^}]*reproCheck[^}]*\} from '\.\/lib\/bug-pack\.mjs'/.test(ctl));
check('repro case has a --check branch', /case 'repro': \{[\s\S]*?if \(args\.check\)/.test(ctl));
check('repro POST body is the checked value (chk.value), not raw args', /api\('POST', `\/api\/bugs\/\$\{encodeURIComponent\(id\)\}\/repro`, chk\.value\)/.test(ctl));
check('failed check blocks the POST (exit 1 before api)', /bugctl repro --check failed — fix verdict before POST/.test(ctl));

check('repro --check: confirmed good → exit 0', bugctl(['repro', '--check', '--status', 'confirmed', '--command', 'x', '--exit-code', '0']).status === 0);
check('repro --check: confirmed missing exit_code → exit 1', bugctl(['repro', '--check', '--status', 'confirmed', '--command', 'x']).status === 1);
check('repro --check: failed without run_log → exit 1', bugctl(['repro', '--check', '--status', 'failed']).status === 1);
check('repro --check: failed with run_log → exit 0', bugctl(['repro', '--check', '--status', 'failed', '--run-log', 'bugs/tag_1/x-run.log']).status === 0);
check('repro --check: invented not_reproducible → exit 1', bugctl(['repro', '--check', '--status', 'not_reproducible']).status === 1);
check('repro --check: not_needed → exit 0', bugctl(['repro', '--check', '--status', 'not_needed']).status === 0);

// ---------------------------------------------------------------------------
// 3. qa-runner --ticket contract (journey mode preserved)
// ---------------------------------------------------------------------------
console.log('\n3. qa-runner --ticket');
try {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'scripts', 'qa-runner.mjs')], { stdio: 'pipe' });
  check('qa-runner.mjs syntax valid', true);
} catch (e) {
  check('qa-runner.mjs syntax valid', false, String(e.stderr || e.message).slice(0, 200));
}
const qa = read('scripts/qa-runner.mjs');
check('supports --ticket=', /getArg\('ticket'/.test(qa));
check('loads the packet through bugctl packet', /'packet', '--id'/.test(qa));
check('executes the card command via bash -lc', /spawnSync\('bash', \['-lc', command\]/.test(qa));
check('verdict rule: exit 0 = confirmed, non-zero = failed', /exitCode === 0 \? 'confirmed' : 'failed'/.test(qa));
for (const name of ['repro.txt', 'run.log', 'before.png', 'expected.md', 'result.json']) {
  check(`§4.6 bundle writes ${name}`, qa.includes(`'${name}'`));
}
check('R2 keys under bugs/<tag_id>/<ts>-<kind>', /bugs\/\$\{tagId\}\/\$\{ts\}/.test(qa));
check('host path without R2 = no verdict (exit 3)', /verdict NOT posted/.test(qa) && /process\.exit\(3\)/.test(qa));
check('posts the verdict through bugctl repro', /BUGCTL, 'repro', '--id'/.test(qa));
check('passes --before before.png key when captured', /keys\['before\.png'\]/.test(qa));
check(
  'journey mode preserved (meal/biomarker/onboarding + else run())',
  ['testMealJourney', 'testBiomarkerJourney', 'testOnboardingJourney'].every((f) => qa.includes(f)) &&
    /if \(ticket\) \{[\s\S]*runTicket\(\)[\s\S]*\} else \{\s*run\(\);/.test(qa),
);

// ---------------------------------------------------------------------------
// 4. qa-reproduce skill + durable qa_meal preload
// ---------------------------------------------------------------------------
console.log('\n4. qa-reproduce skill + profile config');
const skillRel = 'scripts/skills/common/qa-reproduce/SKILL.md';
check('skill file exists', fs.existsSync(path.join(ROOT, skillRel)));
if (fs.existsSync(path.join(ROOT, skillRel))) {
  const sk = read(skillRel);
  check('skill frontmatter name qa-reproduce', /^---\nname: qa-reproduce\n/.test(sk));
  check('skill encodes confirmed + failed verdicts', sk.includes('status=confirmed') && sk.includes('status=failed'));
  check('skill states not_needed ≠ not_reproducible', sk.includes('not_needed') && sk.includes('not_reproducible') && /synonym/i.test(sk));
  check('skill requires repro --check before POST', sk.includes('repro --check'));
  check('skill runs the ticket runner', sk.includes('qa-runner.mjs --ticket'));
  check('skill forbids fix/dispatch/verify', /NEVER edit/.test(sk) && /run-coding-dispatch\.sh/.test(sk) && /NEVER post `plan`, `attempt`, or `verify`/.test(sk));
  check('skill forbids host-path evidence', /host-absolute path/.test(sk));
}
const setup = read('scripts/setup-hermes-global-soul.sh');
check(
  'durable path: setup script preloads qa-reproduce into qa_meal',
  /\$\{PROFILES_DIR\}\/qa_meal\/config\.yaml[\s\S]*?preload_skills:\s*\n\s*- qa-meal-journey\s*\n\s*- qa-reproduce/.test(setup),
);
check('sync-hermes-skills symlinks scripts/skills/common into profiles', read('scripts/sync-hermes-skills.sh').includes('SKILLS_SRC="${REPO_DIR}/scripts/skills/common"'));

// ---------------------------------------------------------------------------
// 5. capability row svc-repro
// ---------------------------------------------------------------------------
console.log('\n5. capabilities');
let caps = null;
try {
  caps = JSON.parse(read('bots/capabilities.json'));
} catch (e) {
  check('capabilities.json parses', false, e.message);
}
if (caps) {
  const rows = caps.capabilities || caps.rows || (Array.isArray(caps) ? caps : []);
  const svc = rows.find((r) => r.id === 'svc-repro');
  check('svc-repro row exists', !!svc);
  if (svc) {
    check('svc-repro expects qa-runner + skill + gate', ['scripts/qa-runner.mjs', 'scripts/skills/common/qa-reproduce/SKILL.md', 'scripts/assert-bug-repro.mjs'].every((f) => (svc.expect || []).includes(f)));
    check('svc-repro skill is qa-reproduce', (svc.skills || []).includes('qa-reproduce'));
    check('svc-repro expect files all exist', (svc.expect || []).every((f) => fs.existsSync(path.join(ROOT, f))));
  }
}

// ---------------------------------------------------------------------------
// 6. V-30.2 closure durable (gate pre-req for V-30.3)
// ---------------------------------------------------------------------------
console.log('\n6. V-30.2 closure');
const reg = JSON.parse(read('bots/registry.json'));
const bugBot = (reg.bots || []).find((b) => b.id === 'hermes_bug_ticket');
check('hermes_bug_ticket enabled: true', bugBot?.enabled === true);
check('hermes_bug_ticket username: @Bug_ticket_bot', bugBot?.hermes?.username === '@Bug_ticket_bot');
check('E2E artifact recorded in AI_HANDOVER.md', read('AI_HANDOVER.md').includes('20260924_162828_f191298f'));

// ---------------------------------------------------------------------------
// 7. Offline projection walk: both verdicts + derived flags (pure bugState)
// ---------------------------------------------------------------------------
console.log('\n7. derived-flag walk');
try {
  const tmpTest = path.join(ROOT, 'src/utils/__bug_repro_flags_walk.test.ts');
  fs.writeFileSync(
    tmpTest,
    `
import { describe, expect, it } from 'vitest';
import { emptyWorkItem } from './bugWorkItem';
import { bugState, evaluateReproVerdicts } from './bugTicketState';

const defect = {
  component: 'Home',
  observed: 'weekly omega-3 shows 7.700000000000001g',
  expected: 'weekly omega-3 text equals 7.7g',
  criteria: 'weekly omega-3 text equals 7.7g',
};
const base = () => emptyWorkItem({ public_n: 903, bug: 'repro walk fixture' });

describe('V-30.3 both verdicts persist and derive exactly bugState flags', () => {
  it('known-bad: confirmed + command/exit_code/run.log/before.png → packed, NO not_reproducible', () => {
    const item = {
      ...base(),
      defect,
      class: 'CLONE_UI',
      surface: 'home',
      repro: { status: 'confirmed', command: 'node check.mjs', exit_code: 0, run_log: 'bugs/tag_x/1-run.log', before: 'bugs/tag_x/1-before.png' },
    };
    const s = bugState(item);
    expect(s.state).toBe('packed');
    expect(s.flags.not_reproducible).toBeUndefined();
    expect(s.flags.needs_repro).toBeUndefined();
    expect(s.flags.blocked_reason).toBeUndefined();
    expect(s.queue).toBe('ready');
  });

  it('known-good: failed + run.log → packed + not_reproducible', () => {
    const item = { ...base(), defect, repro: { status: 'failed', run_log: 'bugs/tag_x/2-run.log' } };
    const s = bugState(item);
    expect(s.state).toBe('packed');
    expect(s.flags.not_reproducible).toBe(true);
    expect(s.flags.needs_repro).toBeUndefined();
  });

  it('not_needed is NOT a synonym for not_reproducible', () => {
    const item = { ...base(), defect, repro: { status: 'not_needed' } };
    const s = bugState(item);
    expect(s.state).toBe('packed');
    expect(s.flags.not_reproducible).toBeUndefined();
    expect(s.flags.needs_repro).toBeUndefined();
  });

  it('needed → needs_repro (packer signal)', () => {
    const item = { ...base(), defect, repro: { status: 'needed' } };
    const s = bugState(item);
    expect(s.flags.needs_repro).toBe(true);
    expect(s.flags.not_reproducible).toBeUndefined();
  });

  it('two matching failed verdicts persist + consensus derives not_reproducible', () => {
    const verdicts = [
      { status: 'failed', run_log: 'bugs/tag_x/3-run.log', by: 'qa_meal' },
      { status: 'failed', run_log: 'bugs/tag_x/4-run.log', by: 'qa_meal' },
    ];
    const ev = evaluateReproVerdicts(verdicts);
    expect(ev.match).toBe(true);
    expect(ev.escalated).toBe(false);
    const item = { ...base(), defect, repro: verdicts[1], repro_verdicts: verdicts };
    const s = bugState(item);
    expect(s.flags.not_reproducible).toBe(true);
    expect(s.flags.blocked_reason).toBeUndefined();
    expect(item.repro_verdicts.length).toBe(2);
  });

  it('two matching confirmed verdicts persist with no conflict', () => {
    const verdicts = [
      { status: 'confirmed', command: 'node check.mjs', exit_code: 0, by: 'qa_meal' },
      { status: 'confirmed', command: 'node check.mjs', exit_code: 0, by: 'qa_meal' },
    ];
    const ev = evaluateReproVerdicts(verdicts);
    expect(ev.match).toBe(true);
    expect(ev.escalated).toBe(false);
    const item = { ...base(), defect, repro: verdicts[1], repro_verdicts: verdicts };
    const s = bugState(item);
    expect(s.state).toBe('packed');
    expect(s.flags.not_reproducible).toBeUndefined();
    expect(s.flags.blocked_reason).toBeUndefined();
    expect(s.queue).toBe('ready');
  });

  it('conflicting confirmed vs failed escalates to repro_verdict_conflict (blocked)', () => {
    const verdicts = [
      { status: 'confirmed', command: 'node check.mjs', exit_code: 0, by: 'qa_meal' },
      { status: 'failed', run_log: 'bugs/tag_x/5-run.log', by: 'qa_meal' },
    ];
    const item = { ...base(), defect, repro: verdicts[1], repro_verdicts: verdicts };
    const s = bugState(item);
    expect(s.flags.blocked_reason).toBe('repro_verdict_conflict');
    expect(s.queue).toBe('blocked');
  });
});
`
  );
  try {
    execFileSync('npx', ['vitest', 'run', 'src/utils/__bug_repro_flags_walk.test.ts'], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120000,
    });
    check('offline walk: both verdicts + derived flags (confirmed/failed/not_needed/needed/conflict)', true);
  } finally {
    try {
      fs.unlinkSync(tmpTest);
    } catch { /* ignore */ }
  }
} catch (e) {
  check('offline walk: both verdicts + derived flags (confirmed/failed/not_needed/needed/conflict)', false, String(e.stderr || e.message).slice(0, 300));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
