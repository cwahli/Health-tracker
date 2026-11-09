#!/usr/bin/env node
/**
 * assert-proto-first — sensor for the proto → dev gate.
 *
 * Executed: each case runs the real binary with PR_BODY env (and, for one
 * case, --diff-files). Offline wiring cases run with no PR_BODY.
 *
 * Run: node scripts/assert-proto-first.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'scripts', 'assert-proto-first.mjs');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const run = (body, extraArgs = []) => {
  const env = { ...process.env };
  if (body === null) delete env.PR_BODY;
  else env.PR_BODY = body;
  try {
    const out = execFileSync('node', [BIN, ...extraArgs], {
      encoding: 'utf8', env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

const TRAILER = 'Author: Test Model 1.0 (high) VM\n';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
const protoGood = [
  '## Summary\n\nDoes the thing.\n\n## Status\n\nDone.\n\n## Left\n\n- x\n\nNext: docs/agent/PROTO_FIRST.md',
  '## Proto\n\nURL: https://proto.health-tracker.co.uk/ht/' + SHA + '/\nSHA: ' + SHA + '\nProof: Drive 1G7dhvqRy7iOmRg7AfN9a6g8cbIhz14yS proto-first-green.png (populated log view on proto)\nStatus: awaiting approval',
  TRAILER,
].join('\n');

console.log('assert-proto-first:');

// 1. Offline wiring (no PR_BODY): docs + pointers + standing live.
{
  const r = run(null);
  check('offline wiring passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 400)}`);
  check('offline names proto doc', /proto_doc:/.test(r.out), r.out.slice(0, 300));
}

// 2. A well-formed proto evidence section passes.
{
  const r = run(protoGood);
  check('proto evidence passes', r.code === 0, `exit ${r.code}: ${r.out.slice(0, 400)}`);
}

// 3. Missing ## Proto section fails and names the section.
{
  const body = '## Summary\n\nx\n\n## Status\n\nDone.\n\n## Left\n\n- y\n\nNext: docs/agent/PROTO_FIRST.md\n\n' + TRAILER;
  const r = run(body);
  check('missing ## Proto fails', r.code === 1, `exit ${r.code}`);
  check('failure names ## Proto', /## Proto/.test(r.out), r.out.slice(0, 300));
}

// 4. Incomplete evidence (URL without SHA/Proof) fails.
{
  const body = protoGood.replace(/Proof:.*\n/, '').replace('SHA: ' + SHA, 'SHA: pending');
  const r = run(body);
  check('incomplete evidence fails', r.code === 1, `exit ${r.code}`);
}

// 5. Exempt + hotfix + queue-sync are the only non-evidence passes.
{
  const exempt = '## Summary\n\nDocs.\n\n## Status\n\nDone.\n\n## Left\n\n- none\n\nNext: docs/agent/PROTO_FIRST.md\n\n## Proto\n\nProto: exempt — docs/process only, no user-visible surface 2026-11-09\n\n' + TRAILER;
  check('exempt claim passes', run(exempt).code === 0);
  const hotfix = '## Summary\n\nHotfix.\n\n## Status\n\nDone.\n\n## Left\n\n- none\n\nNext: docs/agent/PROTO_FIRST.md\n\n## Proto\n\nHotfix: human skipped proto 2026-11-09\n\n' + TRAILER;
  check('hotfix claim passes', run(hotfix).code === 0);
  check('queue-sync passes silently', run('[queue-sync] refresh WORK_QUEUE.md\n').code === 0);
}

// 6. Diff consistency: src/ touch with no URL and no exemption fails; docs
//    touch with an exemption passes.
{
  const tmp = mkdtempSync(join(tmpdir(), 'proto-first-'));
  const srcDiff = join(tmp, 'src.diff');
  writeFileSync(srcDiff, 'src/App.tsx\nserver.ts\n');
  const noProto = '## Summary\n\nx\n\n## Status\n\nDone.\n\n## Left\n\n- y\n\nNext: docs/agent/PROTO_FIRST.md\n\n' + TRAILER;
  const r1 = run(noProto, ['--diff-files', srcDiff]);
  check('src/ touch without proto fails', r1.code === 1, `exit ${r1.code}: ${r1.out.slice(0, 400)}`);
  const docsDiff = join(tmp, 'docs.diff');
  writeFileSync(docsDiff, 'docs/agent/PROTO_FIRST.md\nAGENTS.md\n');
  const exemptBody = noProto.replace(
    '## Summary', '## Proto\n\nProto: exempt — docs/process only 2026-11-09\n\n## Summary');
  const r2 = run(exemptBody, ['--diff-files', docsDiff]);
  check('docs touch with exemption passes', r2.code === 0, `exit ${r2.code}: ${r2.out.slice(0, 400)}`);
}

console.log('');
console.log(failed === 0 ? `assert-proto-first: ${passed} pass, 0 fail` : `assert-proto-first: ${passed} pass, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
