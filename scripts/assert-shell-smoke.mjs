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
  // Q-11.12: Header's extracted screens (settings overlay, theme customizer)
  // were moved verbatim with no standing coverage; a move that fails to mount
  // used to pass every gate.
  'prototype/tests/header-chrome.spec.ts',
  // Saved-meal lineage: child tag, click-to-master, propagation, re-review,
  // dead-photo letter tile (THUMB_FALLBACK class).
  'prototype/tests/saved-meal-lineage.spec.ts',
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
