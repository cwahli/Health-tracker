#!/usr/bin/env node
/**
 * Project-alias parity gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/project external 4` was silently ignored by the Grok TG router because it
 * had no `/project` handler at all. Adding one meant duplicating bot-host's
 * alias grammar (`scripts/lib/project-registry.mjs` -> resolveProjectId) into the
 * standalone router, because the router ships without relative imports into
 * scripts/ and may only use its vendored mirrors.
 *
 * Two copies of a grammar means two places to forget an alias — and the failure
 * is silent, because an unrecognised project just prints "could not read".
 * This gate pins the shared cases so the copies cannot drift apart unnoticed.
 *
 * What it checks: for every alias bot-host resolves, the router must resolve the
 * same input to the same project id. The router is allowed EXTRA aliases (it
 * only needs the shared ones to agree), but it must never disagree.
 *
 * Usage: node scripts/assert-project-registry-parity.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const { resolveProjectId: botHostResolve } = await import(
  path.join(ROOT, 'scripts', 'lib', 'project-registry.mjs')
);
const { resolveProjectId: routerResolve } = await import(
  path.join(ROOT, 'tools', 'telegram-provider-router', 'src', 'project-registry.mjs')
);

// The grammar both must agree on. Anything one side handles and the other does
// not is a drift bug (not a bonus feature) for the shared subset below.
//
// NOTE on external-N (N >= 3): bot-host's resolveProjectId() calls
// initExternalProject() for these, which SEEDS templates into
// <repo>/projects/external-N. That is a filesystem side effect in what looks
// like a pure function, and REPO_ROOT is a module const that cannot be
// redirected, so calling it from a gate would pollute the working tree. Those
// cases are therefore pinned on the router's resolver only (it is pure); see
// ROUTER_ONLY_NUMERIC_CASES. The shared, side-effect-free cases below are the
// ones cross-checked against bot-host.
const SHARED_CASES = [
  // health-tracker
  ['ht', 'health-tracker'],
  ['main', 'health-tracker'],
  ['website', 'health-tracker'],
  ['health-tracker', 'health-tracker'],
  ['1', 'health-tracker'],
  ['project 1', 'health-tracker'],
  // external-2
  ['2', 'external-2'],
  ['project 2', 'external-2'],
  ['external 2', 'external-2'],
  ['pip', 'external-2'],
  ['pip-defense', 'external-2'],
  // external-health (Personal Health Coach)
  ['health', 'external-health'],
  ['health coach', 'external-health'],
  ['personal health', 'external-health'],
  ['external health', 'external-health'],
  ['external-health', 'external-health'],
  ['coach', 'external-health'],
];

// Pinned on the router resolver alone: the reported failure was `/project
// external 4`, and bot-host cannot be asked without seeding the repo.
const ROUTER_ONLY_NUMERIC_CASES = [
  ['3', 'external-3'],
  ['project 3', 'external-3'],
  ['external 3', 'external-3'],
  ['4', 'external-4'],
  ['project 4', 'external-4'],
  ['external 4', 'external-4'],
  ['external-4', 'external-4'],
];

// Inputs that must be REJECTED by both (not silently mapped somewhere).
const REJECT_CASES = ['', '   ', 'banana', 'external', 'project'];

export function parityFailures() {
  const failures = [];
  for (const [input, expected] of SHARED_CASES) {
    const host = botHostResolve(input);
    const router = routerResolve(input);
    if (host !== expected) {
      failures.push({ input, expected, got: host, side: 'bot-host', detail: `bot-host resolved "${input}" to ${host}, expected ${expected}` });
    }
    if (router !== expected) {
      failures.push({ input, expected, got: router, side: 'router', detail: `router resolved "${input}" to ${router}, expected ${expected}` });
    }
  }
  for (const [input, expected] of ROUTER_ONLY_NUMERIC_CASES) {
    const router = routerResolve(input);
    if (router !== expected) {
      failures.push({ input, expected, got: router, side: 'router', detail: `router resolved "${input}" to ${router}, expected ${expected}` });
    }
  }
  for (const input of REJECT_CASES) {
    const host = botHostResolve(input);
    const router = routerResolve(input);
    if (host !== null) failures.push({ input, side: 'bot-host', detail: `bot-host accepted junk "${input}" as ${host}` });
    if (router !== null) failures.push({ input, side: 'router', detail: `router accepted junk "${input}" as ${router}` });
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = parityFailures();
  if (!failures.length) {
    console.log(`project-alias parity OK — ${SHARED_CASES.length} shared aliases cross-checked vs bot-host, ${ROUTER_ONLY_NUMERIC_CASES.length} external-N aliases pinned on the router, ${REJECT_CASES.length} reject cases`);
  } else {
    console.error(`project-alias parity FAILED — ${failures.length} problem(s):\n`);
    for (const f of failures) console.error(`  ${f.detail}`);
  }
  process.exit(failures.length ? 1 : 0);
}
