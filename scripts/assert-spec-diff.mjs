#!/usr/bin/env node
/**
 * Locked-spec diff gate.
 *
 * Usage:
 *   node scripts/assert-spec-diff.mjs <ID>
 *   node scripts/assert-spec-diff.mjs          # exactly one locked spec in specs/active/
 *
 * Compares `git diff --name-only HEAD` (staged + unstaged + untracked)
 * against the YAML frontmatter on specs/active/<ID>.md.
 *
 * Skip: no specs/active/*.md besides .gitkeep → exit 0 (adoption).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const activeDir = path.join(root, 'specs', 'active');

function fail(id, msg) {
  console.error(`FAIL ${id}: ${msg}`);
  process.exitCode = 1;
}
function pass(id, extra = '') {
  console.log(`PASS ${id}${extra ? ` ${extra}` : ''}`);
}

function listActiveSpecs() {
  if (!fs.existsSync(activeDir)) return [];
  return fs
    .readdirSync(activeDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(activeDir, f));
}

function parseFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error(`${file}: missing YAML frontmatter`);
  const lines = m[1].split(/\r?\n/);
  const out = {
    id: '',
    status: '',
    edit_mode: 'patch',
    allowed_files: [],
    frozen_files: [],
    gate: [],
  };
  let listKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const listItem = line.match(/^\s+-\s+(.+?)\s*$/);
    if (listItem && listKey) {
      out[listKey].push(listItem[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }
    listKey = null;
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2];
    if (key === 'allowed_files' || key === 'frozen_files' || key === 'gate') {
      listKey = key;
      if (val && val !== '') out[key].push(val.replace(/^\[|\]$/g, '').trim());
      continue;
    }
    if (key in out && typeof out[key] === 'string') out[key] = val.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function gitChangedFiles() {
  const cmd =
    'git diff --name-only HEAD && git diff --name-only --cached && git ls-files --others --exclude-standard';
  const out = execSync(cmd, { cwd: root, encoding: 'utf8' });
  return [...new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
}

function lineCount(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return 0;
  const t = fs.readFileSync(abs, 'utf8');
  return t.split(/\r?\n/).length;
}

function existsAtHead(rel) {
  try {
    execSync(`git cat-file -e ${JSON.stringify(`HEAD:${rel}`)}`, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function changedLineCount(rel) {
  try {
    const diff = execSync(`git diff HEAD -- ${JSON.stringify(rel)}`, {
      cwd: root,
      encoding: 'utf8',
    });
    let added = 0;
    let removed = 0;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff') || line.startsWith('index')) continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
    return { added, removed };
  } catch {
    return { added: 0, removed: 0 };
  }
}

const specs = listActiveSpecs();
const wantId = process.argv[2] || null;

if (!wantId && specs.length === 0) {
  console.log('SKIP assert-spec-diff: no specs/active/*.md (process not in use this turn)');
  process.exit(0);
}

let specPath;
if (wantId) {
  specPath = path.join(activeDir, `${wantId}.md`);
  if (!fs.existsSync(specPath)) {
    fail('spec_missing', `specs/active/${wantId}.md not found`);
    process.exit(1);
  }
} else if (specs.length === 1) {
  specPath = specs[0];
} else {
  fail(
    'spec_ambiguous',
    `multiple active specs (${specs.map((s) => path.basename(s)).join(', ')}); pass an ID`,
  );
  process.exit(1);
}

let meta;
try {
  meta = parseFrontmatter(specPath);
} catch (e) {
  fail('spec_parse', e.message || String(e));
  process.exit(1);
}

if (meta.status !== 'locked') {
  fail('spec_not_locked', `${path.basename(specPath)} status=${meta.status || '(empty)'} (must be locked before implement)`);
  process.exit(1);
}

function isPacketNoise(norm) {
  return (
    norm === specRel ||
    norm.startsWith('specs/') ||
    norm.startsWith('.agents/') ||
    norm.startsWith('docs/agent/') ||
    norm === 'GEMINI.md' ||
    norm === 'AGENTS.md' ||
    norm === 'AI_HANDOVER.md' ||
    norm === 'playwright.config.ts' ||
    /^scripts\/(assert-|journey-|discover-gated)/.test(norm)
  );
}

function isApplication(norm) {
  return (
    norm.startsWith('src/') ||
    /^server[^/]*\.ts$/.test(norm) ||
    norm.startsWith('agents/') ||
    norm.startsWith('prototype/meallog/') ||
    norm.startsWith('prototype/tests/') ||
    norm.startsWith('supabase/')
  );
}

const specRel = path.relative(root, specPath).split(path.sep).join('/');
const allowed = new Set(meta.allowed_files.filter(Boolean));
const frozen = new Set(meta.frozen_files.filter(Boolean));
const changed = gitChangedFiles();

const extras = [];
const frozenTouched = [];
const rewrites = [];

for (const file of changed) {
  const norm = file.split(path.sep).join('/');
  if (isPacketNoise(norm)) continue;
  if (frozen.has(norm) && isApplication(norm)) frozenTouched.push(norm);
  if (!allowed.has(norm) && isApplication(norm)) extras.push(norm);
  if (allowed.has(norm) && (meta.edit_mode || 'patch') === 'patch') {
    // A path that does not exist at HEAD cannot be a rewrite — its whole body is
    // an addition. Without this, every packet that adds a module (Q-11) fails on
    // its own new files. In-place rewrites of existing files are still caught.
    if (!existsAtHead(norm)) continue;
    const total = lineCount(norm);
    const { added, removed } = changedLineCount(norm);
    const churn = added + removed;
    if (total > 40 && churn / total > 0.3) {
      rewrites.push(`${norm} changed ${Math.round((churn / total) * 100)}% of lines (edit_mode=patch)`);
    }
  }
}

if (extras.length) fail('extra_file', extras.join(', '));
else pass('allowed_files');

if (frozenTouched.length) fail('frozen_touched', frozenTouched.join(', '));
else pass('frozen_files');

if (rewrites.length) fail('rewrite', rewrites.join('; '));
else pass('patch_not_rewrite');

if (process.exitCode) process.exit(process.exitCode);
pass('spec_ok');
process.exit(0);
