#!/usr/bin/env node
/**
 * no-undo CLI — thin wrapper over scripts/lib/no-undo.mjs.
 *
 * Usage:
 *   node scripts/no-undo.mjs --range <base>..<head> --landed-ref <ref>
 *     [--body-file <file>] [--repo <dir>] [-v]
 *
 * Exit 0: clean (or nothing changed). Exit 1: undeclared undo, with the
 * owning commit, its trailer, and the two valid moves printed. Exit 2:
 * usage / git failure. An unresolvable range fails rather than passing:
 * judging nothing is the #353 failure mode.
 */

import { readFileSync } from 'node:fs';
import { checkRange, git } from './lib/no-undo.mjs';

const raw = process.argv.slice(2);
const args = new Map();
for (let i = 0; i < raw.length; i += 1) {
  const a = raw[i];
  if (!a.startsWith('-') || a === '-') continue;
  const word = a.startsWith('--') ? a.slice(2) : a.slice(1);
  const eq = word.indexOf('=');
  if (eq === -1) {
    const next = raw[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      args.set(word, next);
      i += 1;
    } else {
      args.set(word, '1');
    }
  } else {
    args.set(word.slice(0, eq), word.slice(eq + 1));
  }
}
const range = args.get('range') || '';
const m = range.match(/^(.+)\.\.(.+)$/);
const repo = args.get('repo') || process.cwd();
const landedRef = args.get('landed-ref') || '';
const verbose = args.has('v') || args.has('verbose');
const window = args.get('window') === undefined ? 150 : Number(args.get('window'));
if (!m || !landedRef || !Number.isFinite(window)) {
  console.error(
    'usage: node scripts/no-undo.mjs --range <base>..<head> --landed-ref <ref> [--body-file <file>] [--repo <dir>] [--window <n>] [-v]',
  );
  process.exit(2);
}
try {
  git(repo, 'rev-parse', '--verify', m[1]);
  git(repo, 'rev-parse', '--verify', m[2]);
  git(repo, 'rev-parse', '--verify', landedRef);
} catch {
  console.error(`no-undo: range or landed-ref does not resolve (${range} / ${landedRef})`);
  process.exit(2);
}
let body = '';
if (args.get('body-file')) {
  try {
    body = readFileSync(args.get('body-file'), 'utf8');
  } catch (err) {
    console.error(`no-undo: cannot read body file: ${err.message}`);
    process.exit(2);
  }
}
const { violations, skipped } = checkRange(repo, m[1], m[2], landedRef, body, { verbose, window });
if (verbose) {
  for (const s of skipped) console.log(`  skip  ${s}`);
}
if (violations.length === 0) {
  console.log('no-undo: 0 undeclared');
  process.exit(0);
}
console.log(`no-undo: ${violations.length} undeclared undo(s) of landed work:`);
for (const v of violations) {
  const what =
    v.kind === 'line'
      ? `${v.file}: deletes a line landed work added: ${v.line}`
      : v.kind === 'file-deleted'
        ? `${v.file}: deletes a file landed work added`
        : `${v.file}: re-adds a file landed work deleted`;
  console.log(`  - ${what}`);
  console.log(`    owned by ${v.owner.slice(0, 8)} "${v.subject}" [${v.trailer}]`);
}
console.log('Fix one of: (1) rebase and keep the line/file, or (2) declare it in');
console.log('the PR body so the squash records it: "Reverts: <sha> — reason" for');
console.log('lines and deleted files, "Resurrects: <path> — reason" for re-added files.');
process.exit(1);
