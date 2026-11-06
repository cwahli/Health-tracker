#!/usr/bin/env node
/**
 * Fail when a roadmap row marked COMPLETE is still introduced as open work.
 * node scripts/assert-closed-stays-closed.mjs [--repo path]
 */

import fs from 'node:fs';
import path from 'node:path';
import { completeItems, contradictions, currentWorkSection } from './lib/closed-rows.mjs';

export function checkRepo(repo) {
  const roadmapPath = path.join(repo, 'plan', 'ROADMAP.md');
  const roadmap = fs.readFileSync(roadmapPath, 'utf8');
  const files = {};
  for (const item of completeItems(currentWorkSection(roadmap))) {
    for (const rel of item.links) {
      const full = path.join(repo, rel);
      files[rel] = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    }
  }
  return contradictions({ roadmap, files });
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || '';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const repo = argValue(process.argv.slice(2), '--repo') || process.cwd();
  const problems = checkRepo(repo);
  if (problems.length === 0) {
    console.log('assert-closed-stays-closed: 0 fail');
    process.exit(0);
  }
  console.error(`assert-closed-stays-closed: ${problems.length} fail`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
