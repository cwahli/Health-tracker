#!/usr/bin/env node
/**
 * assert-proto-first — the proto → dev gate (offline, fails closed).
 *
 * What “proto-first” means (docs/agent/PROTO_FIRST.md):
 *  - User-visible code (src/, server*.ts, app.html, index.html, agents/)
 *    may not merge to main without a ## Proto section in the PR body
 *    naming the proto URL (proto.health-tracker.co.uk/ht/<sha>/), the SHA,
 *    and a proof pointer. The human's `go for dev` flips Status to Approved;
 *    CI only checks that the evidence section exists and is well-formed —
 *    it never approves on the human's behalf.
 *  - Docs/process-only, registry-only, and [queue-sync] PRs are exempt, but
 *    must SAY so in ## Proto (or be the queue-sync marker). Any other
 *    exemption claim fails.
 *  - Hotfix (downtime/data loss) requires the human-typed line
 *    `Hotfix: human skipped proto` — agents must not type it themselves;
 *    the sensor only verifies the line is present when claimed.
 *
 * Offline checks (always, no PR body needed): PROTO_FIRST.md exists with
 * its canaries; AGENTS.md, JOURNEY.md, GITHUB_WORKFLOW.md, README,
 * GEMINI.md, .agents/rules/journey.md, ci.yml, and proto-deploy.mjs point
 * at it so every surface reads the same rule.
 *
 * Usage:
 *   node scripts/assert-proto-first.mjs
 *   PR_BODY="..." node scripts/assert-proto-first.mjs
 *   node scripts/assert-proto-first.mjs --diff-files <file>  # src/ detector
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, msg) => { failed += 1; console.error(`FAIL ${id}: ${msg}`); };
const read = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { fail('missing_file', rel); return ''; }
  return readFileSync(abs, 'utf8');
};

// ---- Offline wiring checks (always) ----
const protoDoc = read('docs/agent/PROTO_FIRST.md');
for (const needle of [
  'proto.health-tracker.co.uk',
  'health-tracker.co.uk',
  'go for dev',
  'Proto: exempt',
  'Hotfix: human skipped proto',
]) {
  if (!protoDoc.includes(needle)) fail('proto_doc_missing', `PROTO_FIRST.md missing: ${needle}`);
  else pass(`proto_doc:${needle.slice(0, 24)}`);
}

for (const [rel, needle] of [
  ['AGENTS.md', 'PROTO_FIRST'],
  ['docs/agent/JOURNEY.md', 'PROTO_FIRST'],
  ['docs/agent/GITHUB_WORKFLOW.md', 'PROTO_FIRST'],
  ['docs/agent/README.md', 'PROTO_FIRST'],
  ['GEMINI.md', 'PROTO_FIRST'],
  ['.agents/rules/journey.md', 'PROTO_FIRST'],
  ['.github/workflows/ci.yml', 'assert-proto-first'],
  ['scripts/proto-deploy.mjs', 'proto.health-tracker.co.uk'],
]) {
  const text = read(rel);
  if (!text.includes(needle)) fail('wiring_missing', `${rel} missing pointer: ${needle}`);
  else pass(`wiring:${rel}`);
}

const standing = JSON.parse(read('docs/agent/standing.json') || '{}');
const protoRow = (standing.features || []).find((f) => f.id === 'proto_first_gate');
if (!protoRow) fail('standing_missing', 'standing.json missing feature proto_first_gate');
else pass('standing:proto_first_gate');

// ---- PR-body check (only when PR_BODY is set) ----
const body = String(process.env.PR_BODY || '');
if (!body.trim()) {
  console.log('assert-proto-first: no PR_BODY (offline run), wiring checks only');
  console.log(failed === 0 ? 'assert-proto-first: PASS' : 'assert-proto-first: FAIL');
  process.exit(failed === 0 ? 0 : 1);
}

if (/^\[queue-sync\]/.test(body.trim())) {
  console.log('assert-proto-first: queue-sync commit, no proto required');
  console.log(failed === 0 ? 'assert-proto-first: PASS' : 'assert-proto-first: FAIL');
  process.exit(failed === 0 ? 0 : 1);
}

const protoSection = (() => {
  const lines = body.split('\n');
  let cur = null; const out = [];
  for (const ln of lines) {
    const h = ln.match(/^##\s*(.+?)\s*$/);
    if (h) { if (cur === 'proto') break; cur = h[1].trim().toLowerCase(); continue; }
    if (cur === 'proto') out.push(ln);
  }
  return out.join('\n');
})();

if (!protoSection) {
  fail('proto_section_missing', 'PR body needs a ## Proto section — see docs/agent/PROTO_FIRST.md §2/§4. ' +
    'User-visible code needs URL + SHA + Proof + Status; docs/process-only writes `Proto: exempt — <reason>`.');
} else {
  const t = protoSection.trim();
  const exempt = /Proto:\s*exempt\s*—/i.test(t);
  const hotfix = /Hotfix:\s*human skipped proto/i.test(t);
  const hasUrl = /https:\/\/proto\.health-tracker\.co\.uk\/ht\/[A-Za-z0-9._-]+\//.test(t);
  const hasSha = /SHA:\s*[0-9a-f]{7,40}(\s|$)/i.test(t);
  const hasProof = /Proof:\s*\S+/.test(t);
  if (exempt) {
    pass('proto:exempt-claim');
  } else if (hotfix) {
    pass('proto:hotfix-claim');
  } else if (hasUrl && hasSha && hasProof) {
    pass('proto:evidence');
  } else {
    fail('proto_evidence_incomplete', [
      '## Proto is present but incomplete.',
      `URL (https://proto.health-tracker.co.uk/ht/<sha>/): ${hasUrl}`,
      `SHA: <7-40 hex>: ${hasSha}`,
      `Proof: <Drive id / path>: ${hasProof}`,
      'Status: awaiting approval (flips to Approved after human `go for dev`). See PROTO_FIRST.md §2.',
    ].join('\n'));
  }
}

// When a diff file list is supplied, a src/ touch without either the proto
// evidence or an explicit exemption/hotfix claim fails. Without a diff
// list we cannot tell whether the PR touches user-visible code, so the
// section check above is the only PR-body gate (fail-closed on missing
// section — a docs-only PR still writes the exempt line).
const args = process.argv.slice(2);
const diffIdx = args.indexOf('--diff-files');
if (diffIdx !== -1 && args[diffIdx + 1]) {
  const diffText = readFileSync(args[diffIdx + 1], 'utf8');
  const touchesUserVisible = /^(src\/|server[^/]*\.ts$|server\/|app\.html$|index\.html$|agents\/)/m.test(diffText);
  const hasEvidence = /https:\/\/proto\.health-tracker\.co\.uk\/ht\//.test(body);
  const saysExempt = /Proto:\s*exempt\s*—|Hotfix:\s*human skipped proto/i.test(body);
  if (touchesUserVisible && !hasEvidence && !saysExempt) {
    fail('proto_diff_mismatch', 'PR touches user-visible code but ## Proto has no proto URL and no exemption/hotfix line.');
  } else {
    pass('proto:diff-consistent');
  }
}

console.log(failed === 0 ? 'assert-proto-first: PASS' : 'assert-proto-first: FAIL');
process.exit(failed === 0 ? 0 : 1);
