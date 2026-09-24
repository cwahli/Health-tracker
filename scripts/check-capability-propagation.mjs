#!/usr/bin/env node
/**
 * Automated propagation check for shared Telegram capabilities.
 *
 * Reads bots/capabilities.json (the single central registry) and verifies,
 * without touching any live host, that every capability CAN propagate:
 *   1. every `expect` core file exists
 *   2. every `skills` entry has SKILL.md with matching frontmatter name
 *   3. schema valid: 5 classes declared, known scope/status/test values
 *   4. no orphans: every common skill dir and every shared TG lib is mapped
 *      to at least one capability (orphans = features BOT-11 doesn't cover)
 *
 * Live per-class smoke tests (one message per affected class, no dual-poller)
 * stay manual per the §14.7 distribute matrix — this script is the gate BEFORE
 * that step: a new capability with undeclared classes/adapters fails here.
 *
 * Usage: node scripts/check-capability-propagation.mjs [--strict]
 *   --strict: also fail on `partial`/`open` capabilities (for release gates).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REG_PATH = path.join(ROOT, 'bots', 'capabilities.json');
const SKILLS_DIR = path.join(ROOT, 'scripts', 'skills', 'common');
const LIB_DIR = path.join(ROOT, 'scripts', 'lib');

// Shared TG libs that must each be mapped to >=1 capability. Deliberately
// excludes collab-session.mjs (collab-runtime glue, §14.7 Case F bot-specific).
const ORPHAN_LIBS = [
  'tg-copy-code.mjs', 'tg-copy-code.test.mjs', 'tg-api.mjs', 'tg-throttle.mjs',
  'inbound-media.mjs', 'agent-opencode.mjs', 'agent-cline.mjs', 'agent-gemini.mjs', 'freemodels.mjs',
  'reasoning-compress.mjs', 'bot-commands.mjs', 'bot-status.mjs', 'commands.mjs',
  'file-locks.mjs', 'registry.mjs', 'failure-log.mjs',
];

const SCOPES = new Set(['common', 'transport', 'runtime-adapter', 'bot-specific']);
const STATUSES = new Set(['done', 'partial', 'open']);
const CLASS_KEYS = ['hermes', 'vps', 'mobile', 'grok_tg', 'collab'];

const strict = process.argv.includes('--strict');
const failures = [];
const warnings = [];
let checked = 0;

function fail(msg) { failures.push(msg); }
function warn(msg) { warnings.push(msg); }

function readSkillFrontmatter(skill) {
  const p = path.join(SKILLS_DIR, skill, 'SKILL.md');
  if (!fs.existsSync(p)) return { ok: false, reason: `missing ${path.relative(ROOT, p)}` };
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/^---\nname: (\S+)\ndescription: ([\s\S]+?)\n---/);
  if (!m) return { ok: false, reason: `bad frontmatter in ${skill}/SKILL.md` };
  if (m[1] !== skill) return { ok: false, reason: `frontmatter name "${m[1]}" != dir "${skill}"` };
  if (!m[2].trim()) return { ok: false, reason: `empty description in ${skill}/SKILL.md` };
  return { ok: true };
}

let reg;
try {
  reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
} catch (e) {
  console.error(`FATAL: cannot load ${path.relative(ROOT, REG_PATH)}: ${e.message}`);
  process.exit(2);
}

if (JSON.stringify(reg.classes) !== JSON.stringify(CLASS_KEYS)) {
  fail(`registry classes must be exactly [${CLASS_KEYS.join(', ')}]`);
}

const skillToCap = new Map();
const libToCap = new Map();

for (const cap of reg.capabilities || []) {
  checked += 1;
  const tag = cap.id || '(missing id)';
  if (!cap.id) { fail('capability without id'); continue; }
  if (!/^T[1-6]$|^meta$/.test(cap.test || '')) fail(`${tag}: unknown test "${cap.test}" (want T1-T6)`);
  if (!SCOPES.has(cap.scope)) fail(`${tag}: unknown scope "${cap.scope}"`);
  if (!STATUSES.has(cap.status)) fail(`${tag}: unknown status "${cap.status}"`);
  if (!cap.prove || !String(cap.prove).trim()) fail(`${tag}: empty prove (how is this verified?)`);
  const keys = Object.keys(cap.classes || {});
  const missing = CLASS_KEYS.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !CLASS_KEYS.includes(k));
  if (missing.length) fail(`${tag}: classes missing [${missing.join(', ')}] — every capability must declare all 5 classes`);
  if (extra.length) fail(`${tag}: unknown classes [${extra.join(', ')}]`);
  for (const [cls, val] of Object.entries(cap.classes || {})) {
    if (![true, false, 'adapter'].includes(val)) fail(`${tag}: class ${cls} must be true/false/"adapter", got ${JSON.stringify(val)}`);
  }
  if ((cap.classes && Object.values(cap.classes).includes('adapter') || Object.values(cap.classes || {}).includes(false)) && !(cap.notes || '').trim()) {
    fail(`${tag}: has adapter/false classes but empty notes (adapters must be documented)`);
  }
  for (const f of cap.expect || []) {
    if (!fs.existsSync(path.join(ROOT, f))) fail(`${tag}: missing core file ${f}`);
    const base = path.basename(f);
    if (ORPHAN_LIBS.includes(base)) {
      if (!libToCap.has(base)) libToCap.set(base, []);
      libToCap.get(base).push(cap.id);
    }
  }
  for (const s of cap.skills || []) {
    const r = readSkillFrontmatter(s);
    if (!r.ok) fail(`${tag}: skill "${s}" — ${r.reason}`);
    if (!skillToCap.has(s)) skillToCap.set(s, []);
    skillToCap.get(s).push(cap.id);
  }
  if (strict && cap.status !== 'done') fail(`${tag}: status "${cap.status}" (strict mode requires done)`);
}

// Orphan scan A: every common skill must be mapped.
for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'))) continue;
  if (!skillToCap.has(entry.name)) fail(`orphan skill "${entry.name}" — no capability lists it (add to bots/capabilities.json)`);
}

// Orphan scan B: every shared TG lib must be mapped.
for (const lib of ORPHAN_LIBS) {
  if (!fs.existsSync(path.join(LIB_DIR, lib))) { warn(`orphan-scope lib missing on disk: scripts/lib/${lib}`); continue; }
  if (!libToCap.has(lib)) fail(`orphan lib "scripts/lib/${lib}" — no capability covers it`);
}

console.log(`capability propagation check: ${checked} capabilities, ${failures.length} failures, ${warnings.length} warnings`);
for (const w of warnings) console.log(`  WARN  ${w}`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (!failures.length) {
  const done = reg.capabilities.filter((c) => c.status === 'done').length;
  const partial = reg.capabilities.filter((c) => c.status === 'partial').length;
  console.log(`  OK  done=${done} partial=${partial} — live per-class smoke still per §14.7 distribute matrix`);
}
process.exit(failures.length ? 1 : 0);
