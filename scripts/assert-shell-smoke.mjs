#!/usr/bin/env node
/**
 * Guard budget 2 — display / missing chrome / extra chrome / failed load.
 * No live Gemini. QUALITY.md pyramid row 2.
 *
 *   node scripts/assert-shell-smoke.mjs
 */
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const specs = [
  'prototype/tests/key-journeys.spec.ts',
  'prototype/tests/r3-smoke.spec.ts',
  'prototype/tests/dialog-inventory.spec.ts',
  // Q-11: a shell that renders but cannot sign in / sign out is still broken.
  'prototype/tests/auth-session.spec.ts',
];

console.log('── shell-smoke (Playwright stubs, no Gemini) ──');
const r = spawnSync(
  'npx',
  ['playwright', 'test', ...specs],
  { cwd: root, stdio: 'inherit', env: { ...process.env } },
);
if (r.status !== 0) {
  console.error('FAIL shell-smoke: a tab, composer, card, or pageerror broke. Do not COMPLETE.');
  process.exit(r.status ?? 1);
}
console.log('PASS shell-smoke');
process.exit(0);
