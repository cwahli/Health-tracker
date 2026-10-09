#!/usr/bin/env node
/**
 * Short card for the machine the agent is actually on.
 * node scripts/startup-card.mjs [--repo path]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closedRowsFromRoadmap } from './lib/closed-rows.mjs';

export function buildStartupCard({ hostname, location, commits, closedRows } = {}) {
  const onVm = location === 'vps-france' || location === 'vm';
  const lines = [
    `You are on this machine: ${hostname || 'unknown'}.`,
    location ? `Location file: ${location}.` : 'Location file: (none).',
    onVm
      ? 'You are already on the VM. Do not ask for another login to read this repo.'
      : 'The VM is ubuntu@health-tracker.co.uk. A VM session is only needed to sit inside a live OpenCode process.',
    'First action of a VM session: python3 ~/.agents/skills.py sync',
    'Then run: node scripts/startup-card.mjs',
    'Sheet writes only: ruby ~/.agents/skills/do-github-sync/scripts/sheet_row.rb',
    'Agents never set sheet Status to Done. The same key archives the old row to archive_done. Do not call sheet_row.rb on a timer.',
    'Uncommitted work with no sheet row: node scripts/sheet-watcher.mjs (print-only; --write once, after 20 minutes on the same fingerprint).',
    'Code in a new worktree: node scripts/agent-worktree.mjs new <slug>',
    'Hub files, one agent at a time: scripts/bot-host.mjs, scripts/lib/free-lanes.mjs, scripts/lib/work-session.mjs',
  ];
  if (closedRows?.length) {
    lines.push('Closed on the roadmap. Do not reopen these. A plan header, a card procedure, or an AI_HANDOVER bullet that still says one of them is open is history:');
    for (const row of closedRows) lines.push(`- ${row} COMPLETE`);
  }
  if (commits?.length) {
    lines.push('Last commits on origin/main:');
    for (const commit of commits) lines.push(`- ${commit}`);
  } else {
    lines.push('Last commits on origin/main: (none read).');
  }
  return lines.join('\n');
}

function readLocation() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.agents', 'location'), 'utf8').trim().split(/\s+/)[0];
  } catch {
    return '';
  }
}

function readClosedRows(repo) {
  try {
    const text = fs.readFileSync(path.join(repo, 'plan', 'ROADMAP.md'), 'utf8');
    return closedRowsFromRoadmap(text);
  } catch {
    return [];
  }
}

function readCommits(repo) {
  try {
    const out = execFileSync('git', ['-C', repo, 'log', '-8', '--oneline', 'origin/main'], { encoding: 'utf8' });
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || '';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const repo = argValue(process.argv.slice(2), '--repo') || process.cwd();
  console.log(buildStartupCard({
    hostname: os.hostname(),
    location: readLocation(),
    commits: readCommits(repo),
    closedRows: readClosedRows(repo),
  }));
}
