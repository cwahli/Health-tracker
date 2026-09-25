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
 *   5. no vendor drift: the Grok TG router's vendored framework mirrors must
 *      be byte-identical to their canonical source (change once, everywhere)
 *
 * Live per-class smoke tests (one message per affected class, no dual-poller)
 * stay manual per the §14.7 distribute matrix — this script is the gate BEFORE
 * that step: a new capability with undeclared classes/adapters fails here.
 *
 * Usage: node scripts/check-capability-propagation.mjs [--strict] [--ids=a,b,c]
 *   --strict: also fail on `partial`/`open` capabilities (for release gates).
 *   --ids:    scope the --strict status rule to these capability ids (the
 *             ticket rows). Structural checks (schema, orphans, vendor drift,
 *             core files) still run over EVERY row either way — --ids only
 *             narrows which statuses must be `done` (V-30.5 ticket-scoped
 *             strict; the 5 pre-existing foreign partials stay owned by their
 *             owning work and are never marked done here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REG_PATH = path.join(ROOT, 'bots', 'capabilities.json');
const MATRIX_PATH = path.join(ROOT, 'public', 'capability-matrix.html');
const SKILLS_DIR = path.join(ROOT, 'scripts', 'skills', 'common');
const LIB_DIR = path.join(ROOT, 'scripts', 'lib');

// Shared TG libs that must each be mapped to >=1 capability. Deliberately
// excludes collab-session.mjs (collab-runtime glue, §14.7 Case F bot-specific).
const ORPHAN_LIBS = [
  'tg-copy-code.mjs', 'tg-copy-code.test.mjs', 'tg-api.mjs', 'tg-throttle.mjs',
  'inbound-media.mjs', 'agent-opencode.mjs', 'agent-cline.mjs', 'agent-gemini.mjs', 'freemodels.mjs',
  'reasoning-compress.mjs', 'bot-commands.mjs', 'bot-status.mjs', 'commands.mjs',
  'file-locks.mjs', 'registry.mjs', 'failure-log.mjs', 'free-lanes.mjs',
];

const SCOPES = new Set(['common', 'transport', 'runtime-adapter', 'bot-specific']);
const STATUSES = new Set(['done', 'partial', 'open']);
const CLASS_KEYS = ['hermes', 'vps', 'mobile', 'grok_tg', 'collab'];

// Single-source frameworks vendored into standalone runtimes. Each entry:
// [canonical source, vendored mirror, marker line]. The mirror must equal
// marker + canonical byte-for-byte; run scripts/sync-router-vendor.mjs after
// editing the canonical file.
const VENDOR_MIRRORS = [
  [
    'scripts/lib/tg-progress.mjs',
    'tools/telegram-provider-router/src/tg-progress.vendor.mjs',
    '// === VENDORED FROM scripts/lib/tg-progress.mjs — DO NOT EDIT ===',
  ],
  [
    'scripts/lib/free-lanes.mjs',
    'tools/telegram-provider-router/src/free-lane-table.vendor.mjs',
    '// === VENDORED FROM scripts/lib/free-lanes.mjs — DO NOT EDIT ===',
  ],
  [
    'scripts/lib/inbound-media.mjs',
    'tools/telegram-provider-router/src/inbound-media.vendor.mjs',
    '// === VENDORED FROM scripts/lib/inbound-media.mjs — DO NOT EDIT ===',
  ],
];

const strict = process.argv.includes('--strict');
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const strictIds = idsArg ? new Set(idsArg.slice(6).split(',').map((s) => s.trim()).filter(Boolean)) : null;
if (strict && idsArg && !strictIds.size) {
  console.error('FATAL: --ids= given but empty');
  process.exit(2);
}
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

if (!fs.existsSync(MATRIX_PATH)) {
  fail(`missing capability matrix: ${path.relative(ROOT, MATRIX_PATH)}`);
} else {
  const matrix = fs.readFileSync(MATRIX_PATH, 'utf8');
  const matrixClasses = [...matrix.matchAll(/data-capability-class="([^"]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(matrixClasses) !== JSON.stringify(CLASS_KEYS)) {
    fail(`capability matrix classes must be exactly [${CLASS_KEYS.join(', ')}]`);
  }
  if (/<th[^>]*>\s*(?:OpenCode|Android|Chat)\s*<\/th>/i.test(matrix)) {
    fail('capability matrix contains legacy class headers');
  }
  if (!matrix.includes('bots/capabilities.json')) fail('capability matrix must name bots/capabilities.json as its source');
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
  if (strict && (!strictIds || strictIds.has(cap.id)) && cap.status !== 'done') {
    fail(`${tag}: status "${cap.status}" (strict mode${strictIds ? ` for --ids=${[...strictIds].join(',')}` : ''} requires done)`);
  }
  if (strictIds) strictIds.delete(cap.id);
}

// A scoped --strict must not silently pass on typo'd ids.
if (strictIds && strictIds.size) {
  for (const missing of strictIds) fail(`--ids="${missing}" matches no capability`);
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

// Vendor drift scan: standalone runtimes must mirror the canonical framework.
for (const [src, mirror, marker] of VENDOR_MIRRORS) {
  const srcPath = path.join(ROOT, src);
  const mirrorPath = path.join(ROOT, mirror);
  if (!fs.existsSync(srcPath)) { fail(`vendor source missing: ${src}`); continue; }
  if (!fs.existsSync(mirrorPath)) { fail(`vendor mirror missing: ${mirror} (run scripts/sync-router-vendor.mjs)`); continue; }
  const want = fs.readFileSync(srcPath, 'utf8');
  const got = fs.readFileSync(mirrorPath, 'utf8');
  if (!got.includes(marker) || !got.endsWith(want)) {
    fail(`vendor drift: ${mirror} != ${src} (edit the canonical file, then run scripts/sync-router-vendor.mjs)`);
  }
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
