#!/usr/bin/env node
/**
 * A COMPLETE roadmap row must not still read as the open pickup.
 * Run: node scripts/assert-closed-stays-closed.test.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepo } from './assert-closed-stays-closed.mjs';
import { closedRowsFromRoadmap, contradictions } from './lib/closed-rows.mjs';
import { buildStartupCard } from './startup-card.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const roadmap = [
  '## Current work — one sequence',
  '',
  '1. **R-14.1 COMPLETE (2026-10-06).** Cards in [R14_1_AGENT_PLAN.md](./R14_1_AGENT_PLAN.md).',
  '2. **R-16 stays the live board.** Not complete.',
  '',
  '## Later',
  '',
  '**R-99 COMPLETE** is outside Current work and must not count.',
].join('\n');

const openPlan = [
  '# Plan',
  '',
  'Any agent can pick up the next open card.',
  '**Card 9 is the only open card.**',
  '**Roadmap row R-14.1 is OPEN.** Do not mark R-14.1 done.',
  '',
  '## Rules',
  '',
  '### Card 9 — Live matrix, then stop',
].join('\n');

const closedPlan = [
  '# Plan',
  '',
  '**R-14.1 is CLOSED (2026-10-06).** Do not pick up a card from this file.',
  '',
  '## Rules',
  '',
  '### Card 9 — CLOSED 2026-10-06. Do not run this pass.',
].join('\n');

console.log('assert-closed-stays-closed:');

{
  const rows = closedRowsFromRoadmap(roadmap);
  check('current work lists only its COMPLETE rows', rows.length === 1 && rows[0] === 'R-14.1', rows.join(','));
}

{
  const problems = contradictions({
    roadmap,
    files: { 'plan/R14_1_AGENT_PLAN.md': openPlan },
  });
  check('an open header fails', problems.length >= 3, problems.join(' | '));
  check('the failure names the open card', problems.some((line) => line.includes('only open card')));
  check('the failure names the Card 9 heading', problems.some((line) => line.includes('Live matrix')));
}

{
  const problems = contradictions({
    roadmap,
    files: { 'plan/R14_1_AGENT_PLAN.md': closedPlan },
  });
  check('a closed header passes', problems.length === 0, problems.join(' | '));
}

{
  const card = buildStartupCard({
    hostname: 'box',
    location: 'mac',
    commits: [],
    closedRows: ['R-14.1', 'TUI steps 1–4'],
  });
  check('the startup card prints a closed row', card.includes('- R-14.1 COMPLETE'));
  check('the startup card says not to reopen it', /Do not reopen/.test(card));
  const plain = buildStartupCard({ hostname: 'box', location: 'mac', commits: [] });
  check('a card with no roadmap read does not invent a close', !plain.includes('Do not reopen'));
}

{
  const problems = checkRepo(ROOT);
  check('this checkout has no open pickup for a COMPLETE row', problems.length === 0, problems.join(' | '));
}

console.log(failed === 0
  ? `assert-closed-stays-closed: ${passed} pass, 0 fail`
  : `assert-closed-stays-closed: ${passed} pass, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
