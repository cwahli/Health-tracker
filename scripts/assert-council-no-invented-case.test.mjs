// R-14.1 card 2 sensor: a failed or empty model call must fail the stage and
// write no output file. The synthesised-dossier path (generateStructuredFallback)
// produced a confident, fully populated document with no model call and no case
// documents, which is the "friendly reply with a wrong side effect" this plan
// exists to stop.
//
// The failure paths run for real in a sandboxed HOME with an invalid
// COUNCIL_MODEL, so nothing is stubbed and no user allowance is spent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GEMINI_MODELS } from './lib/freemodels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'council-runner.mjs');
const BOT_HOST = path.join(HERE, 'bot-host.mjs');
const src = fs.readFileSync(RUNNER, 'utf8');

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

console.log('assert-council-no-invented-case:');

// 1. The synthesised dossier path is gone, with no leftover of its text.
check('generateStructuredFallback is gone', !/generateStructuredFallback/.test(src));
for (const phrase of ['Forensic Audit & Accuracy Review', 'Vulnerability Scores', 'Negotiation Leverage', 'Completed analysis for role']) {
  check(`no fabricated dossier text: ${phrase}`, !src.includes(phrase));
}

// 2. executeRoleTurn fails loudly instead of returning a document.
check('executeRoleTurn throws when the model call throws', /catch \(err\) \{\s*\n\s*throw new Error\(`model call failed/.test(src));
check('executeRoleTurn throws when the model returns no text', /if \(!text\) \{[\s\S]{0,200}throw new Error/.test(src));

// 3. The council model is an id this host can actually run. The old hardcoded
// 'gemini-2.0-flash' was not in GEMINI_MODELS, so every call resolved to
// "Unknown gemini model" and the fallback wrote the document instead.
const modelLine = src.match(/const COUNCIL_MODEL = process\.env\.COUNCIL_MODEL \|\| '([^']+)'/);
check('council model is pinned to a known gemini id', Boolean(modelLine));
check(
  `pinned council model is in GEMINI_MODELS (${modelLine ? modelLine[1] : 'n/a'})`,
  Boolean(modelLine) && GEMINI_MODELS.includes(modelLine[1]),
);
check('COUNCIL_MODEL can be overridden to force a failure', /process\.env\.COUNCIL_MODEL/.test(src));

// 4. The CLI called runCouncilStage with its arguments swapped, so --stage
// threw "Unknown project" before any model call.
check('CLI passes runCouncilStage(stage, projectId)', /runCouncilStage\(stage, projectId, console\.log\)/.test(src));

// 5. End to end in a sandboxed HOME: a failing model call exits non-zero, says
// failed, and leaves no output file behind.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'council-card2-'));
try {
  // seedProjectWorkspace does not create the workspace dir (card 7 covers that),
  // so the sandbox provides it to reach the model call this card is about.
  fs.mkdirSync(path.join(sandbox, 'projects', 'external-2'), { recursive: true });
  const env = { ...process.env, HOME: sandbox, COUNCIL_MODEL: 'gemini/not-a-real-model' };
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [RUNNER, '--project=external-2', '--stage=audit'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    code = err.status ?? 1;
    stdout = String(err.stdout || '');
    stderr = String(err.stderr || '');
  }
  check('a failed stage exits non-zero', code !== 0);
  check('the failure is reported as failed', /failed/i.test(`${stdout}\n${stderr}`));
  check('no success line is printed', !/finished successfully/i.test(stdout));

  const outDir = path.join(sandbox, 'projects', 'external-2', 'output');
  const written = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  check('no output file is written for the failed stage', written.length === 0);

  // seedProjectWorkspace legitimately copies the repo templates into the
  // workspace. What must not exist is invented case content anywhere.
  const invented = execFileSync(
    '/bin/sh',
    ['-c', `grep -rl "Forensic Audit & Accuracy Review\\|Vulnerability Scores\\|Negotiation Leverage" ${sandbox} 2>/dev/null | head -3`],
    { encoding: 'utf8' }
  ).trim();
  check(`no invented case content in the sandbox (${JSON.stringify(invented)})`, invented === '');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

// 6. The chat surface reports the failure and does not claim success.
const botSrc = fs.readFileSync(BOT_HOST, 'utf8');
check('/council reports a failed stage', /Council stage failed/.test(botSrc));
check('/council run reports a failed run', /Council run failed/.test(botSrc));

// 7. The real code path, not the CLI: with the model call unable to run,
// executeRoleTurn must reject. On main it resolved with a dossier full of
// invented claims (Sprint 14, 42 PRs, CLM-01) that no case document supplied.
process.env.COUNCIL_MODEL = 'gemini/not-a-real-model';
const { executeRoleTurn } = await import('./council-runner.mjs');
let rejected = false;
let rejection = '';
let resolvedText = '';
try {
  resolvedText = String(await executeRoleTurn({ projectId: 'external-2', roleId: 'accuracy_review', prompt: 'probe' }));
} catch (err) {
  rejected = true;
  rejection = String(err?.message || err);
}
check('executeRoleTurn rejects when the model call cannot run', rejected);
check('the rejection names the role that failed', /accuracy_review/.test(rejection));
check(
  `nothing is returned to be written (${JSON.stringify(resolvedText.split('\n')[0] || '')})`,
  !/Forensic Audit|CLM-01|42 PRs/.test(resolvedText),
);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
