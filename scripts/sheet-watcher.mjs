#!/usr/bin/env node
/**
 * Print-only by default. --write is the only path that runs sheet_row.rb,
 * and only after the same dirty fingerprint has sat for 20 minutes and has
 * not already been written. A repeated key is refused because sheet_row.rb
 * archives the previous row.
 *
 * node scripts/sheet-watcher.mjs [--repo path] [--spool path] [--now ms]
 *   [--porcelain-file path] [--write] [--ref Topic-NN] [--sheet-bin ruby]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyDecision, decideWatch, emptySpool, fingerprintOf } from './lib/sheet-watch.mjs';

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || '';
}

function readSpool(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return emptySpool();
  }
}

function porcelainFrom(argv) {
  const file = argValue(argv, '--porcelain-file');
  if (file) return fs.readFileSync(file, 'utf8');
  const repo = argValue(argv, '--repo') || process.cwd();
  return execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
}

function locationWord() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.agents', 'location'), 'utf8').trim().split(/\s+/)[0];
  } catch {
    return '';
  }
}

function main() {
  const argv = process.argv.slice(2);
  const now = argValue(argv, '--now') ? Number(argValue(argv, '--now')) : Date.now();
  const spoolPath = argValue(argv, '--spool') || path.join(os.homedir(), '.hermes', 'sheet-watch.json');
  const spool = readSpool(spoolPath);
  const fingerprint = fingerprintOf(porcelainFrom(argv));
  const owner = process.env.SHEET_WATCH_OWNER || `watcher @ ${locationWord() || 'unknown'}`;
  const sheetScript = argValue(argv, '--sheet-script')
    || path.join(os.homedir(), '.agents', 'skills', 'do-github-sync', 'scripts', 'sheet_row.rb');
  const decision = decideWatch({
    now,
    spool,
    fingerprint,
    write: argv.includes('--write'),
    ref: argValue(argv, '--ref') || '',
    owner,
    sheetBin: argValue(argv, '--sheet-bin') || 'ruby',
    sheetScript,
  });
  if (decision.action === 'write') {
    const run = spawnSync(decision.argv[0], decision.argv.slice(1), { encoding: 'utf8' });
    if (run.status !== 0) {
      const detail = (run.stderr || run.stdout || 'sheet_row failed').slice(0, 400);
      console.error(detail);
      process.exit(1);
    }
  }
  const next = applyDecision(spool, fingerprint, decision, now);
  fs.mkdirSync(path.dirname(spoolPath), { recursive: true });
  fs.writeFileSync(spoolPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(decision.message);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
