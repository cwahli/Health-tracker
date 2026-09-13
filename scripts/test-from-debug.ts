#!/usr/bin/env npx tsx
/**
 * Inner loop for one captured debug.md.
 * Classify the dump, then run named vitest for those classes.
 * Usage: npx tsx scripts/test-from-debug.ts [path/to/debug.md]
 * Default: tests/captures/job_1788538012316_m9wm9cs9a.md
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { parseDebugMarkdown, classifyDump, formatOracleFails } from '../src/utils/dumpContract.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const defaultCapture = path.join(root, 'tests/captures/job_1788538012316_m9wm9cs9a.md');
const capturePath = path.resolve(process.argv[2] || defaultCapture);

if (!fs.existsSync(capturePath)) {
  console.error(`test-from-debug: missing ${capturePath}`);
  process.exit(2);
}

const raw = fs.readFileSync(capturePath, 'utf8');
let facts: any;
let classified: any;

if (capturePath.endsWith('.json') || raw.trim().startsWith('{')) {
  try {
    const json = JSON.parse(raw);
    if (json && typeof json === 'object' && ('contract' in json || 'pack' in json)) {
      classified = classifyDump(json);
      facts = {
        jobId: json.jobId,
        status: json.status,
        hasFinalizedLedger: Boolean(json.pendingFoodLog) || /\[Budget\]\s*Finalized ledger/i.test(json.backendLogs || ''),
        dietFailedPermanently: /Dietitian Failed Permanently|Diet failed permanently/i.test(json.backendLogs || ''),
      };
    }
  } catch {}
}

if (!facts) {
  facts = parseDebugMarkdown(raw);
  classified = classifyDump(facts);
}

console.log(`capture: ${path.relative(root, capturePath)}`);
console.log(`job: ${facts.jobId || '?'}  status=${facts.status || '?'}  ledger=${facts.hasFinalizedLedger}  dietFail=${facts.dietFailedPermanently}`);
console.log('');
console.log('classified (this dump — historical red is expected until a new live confirm):');
console.log(formatOracleFails(classified) || '(none)');
console.log('');
console.log('inner loop (code probes — these must be green without you clicking Log Meal again):');

const vitest = spawnSync(
  'npx',
  ['vitest', 'run', 'src/utils/dumpContract.test.ts', 'server_sse_json.test.ts', 'server_gemini_retry.test.ts'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
);

process.exit(vitest.status === 0 ? 0 : vitest.status || 1);
