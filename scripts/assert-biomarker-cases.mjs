import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
console.log('Running automated baseline gate for Biomarker Fill-Template Cases (C1-C7)...');

const result = spawnSync('npx', ['tsx', 'prototype/biomarkers/runner.ts', '--only', 'all'], {
  cwd: ROOT,
  stdio: 'inherit',
});

if (result.status === 0) {
  console.log('\nAll prototype cases passed successfully (100% green). Baseline regression gate cleared.');
  process.exit(0);
} else {
  console.error(`\nBaseline regression gate FAILED (exit code ${result.status}). Fix the underlying issues before proceeding.`);
  process.exit(result.status || 1);
}
