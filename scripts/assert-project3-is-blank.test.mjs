// R-14.1 card 7 sensor: /project external 3 gets a blank charter, empty
// evidence and the role files. It must not arrive holding the rating case.
// The decisive check is the card's own: a unique string in project 2 must not
// appear anywhere under project 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

console.log('assert-project3-is-blank:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'card7-'));
const newTemplateDir = path.join(REPO, 'projects', 'external-3');
let pid;
let project;

try {
  process.env.HOME = home;
  const reg = await import('./lib/project-registry.mjs');

  // The marker goes into project 2 first, exactly as the card's proof does.
  fs.mkdirSync(path.join(home, 'projects', 'external-2'), { recursive: true });
  fs.writeFileSync(path.join(home, 'projects', 'external-2', 'case.txt'), 'PROJECT2_ONLY 42 PRs merged', 'utf8');

  pid = reg.resolveProjectId('external 3');
  project = reg.KNOWN_PROJECTS[pid];
  check('external 3 resolves to its own id', pid === 'external-3');
  check('it is not project 2', pid !== 'external-2');
  check('project 2 is still project 2', reg.resolveProjectId('2') === 'external-2');
  check('the workspace is ~/projects/external-3', project.workspace === path.join(home, 'projects', 'external-3'));

  reg.seedProjectWorkspace(pid);

  // 1. The decisive check.
  const leaked = execFileSync('/bin/sh', ['-c', `grep -R PROJECT2_ONLY ${path.join(home, 'projects', 'external-3')} 2>/dev/null | wc -l`], { encoding: 'utf8' }).trim();
  check(`project 2 text does not appear under project 3 (${leaked})`, leaked === '0');

  // 2. The role files are there, because the council needs them.
  const roles = fs.readdirSync(path.join(project.templateDir, 'roles'));
  check('the role files are present', roles.length >= 6);
  check('the legal role is present', roles.includes('legal_policy.md'));

  // 3. The charter is blank, not the rating case.
  const charter = fs.readFileSync(path.join(project.templateDir, 'charter.md'), 'utf8');
  check('the charter is not the rating case', !/PIP Defense|Needs Development|Below Expectations/i.test(charter));
  check('the charter states the website boundary', /website repository/i.test(charter));
  check('the charter is marked for the user to write', /TODO/.test(charter));

  const soul = fs.readFileSync(path.join(project.templateDir, 'soul.md'), 'utf8');
  check('the soul is not the PIP soul', !/PIP Defense Council/i.test(soul));

  // 4. The evidence ledger has a header and no invented rows.
  const evidence = fs.readFileSync(path.join(project.workspace, '02_Evidence_and_Metric_Ledger.md'), 'utf8');
  check('the evidence ledger has a header row', evidence.includes('| Claim ID |'));
  check('the evidence ledger has no invented claims', !/CLM-0\d|42 PRs|Sprint 14/.test(evidence));
  const bodyRows = evidence.split('\n').filter((l) => l.startsWith('|') && !/Claim ID|:---/.test(l));
  check(`the evidence ledger has no data rows (${bodyRows.length})`, bodyRows.length === 0);

  const facts = fs.readFileSync(path.join(project.workspace, '01_Case_Facts_and_Timeline.md'), 'utf8');
  check('the timeline has no invented rows', !/YYYY-MM-DD \| Mid-year|Slack thread/.test(facts));
  check('the timeline has a header row', /\| Date \|/.test(facts));

  // 5. The seed is idempotent and survives a missing workspace directory.
  fs.rmSync(project.workspace, { recursive: true, force: true });
  reg.seedProjectWorkspace(pid);
  check('seeding recreates a missing workspace', fs.existsSync(path.join(project.workspace, '02_Evidence_and_Metric_Ledger.md')));
  check('seeding did not overwrite the project', fs.existsSync(path.join(project.workspace, '01_Case_Facts_and_Timeline.md')));

  // 6. Project 2 keeps its own case documents.
  const p2evidence = fs.readFileSync(path.join(REPO, 'projects', 'external-2', 'templates', '02_Evidence_and_Metric_Ledger.md'), 'utf8');
  check('project 2 keeps its filled ledger', /CLM-01/.test(p2evidence));
} finally {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(newTemplateDir, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
