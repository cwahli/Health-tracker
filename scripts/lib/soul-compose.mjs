/**
 * Composed soul for BOT-16.
 *
 * One shared base (bots/soul.md: the three bot-work laws) + one soul line
 * per capability (bots/soul-capabilities.json) + one per-profile override
 * (bots/soul.<profile>.md). The composer enforces line budgets at the
 * Hermes gateway level, because a Telegram turn never loads AGENTS.md.
 *
 * Budgets (locked by scripts/assert-soul-compose.mjs, do not raise here):
 *   base 12 lines · capability lines 4 per profile · override 16 · total 34.
 *
 * Profiles: default (the global ~/.hermes/SOUL.md), bug_ticket, meal_audit,
 * qa_meal, orchestrator, qa_biomarker, qa_onboarding.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(HERE, '..', '..', 'bots');

export const PROFILES = [
  'default',
  'bug_ticket',
  'meal_audit',
  'qa_meal',
  'orchestrator',
  'qa_biomarker',
  'qa_onboarding',
];

export const BUDGETS = { base: 12, capabilities: 4, override: 16, total: 34 };

export function lineCount(text) {
  return String(text ?? '').trimEnd().split('\n').length;
}

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function loadBase(dir = DEFAULT_DIR) {
  const text = readFile(path.join(dir, 'soul.md'));
  if (text === null) throw new Error(`soul-compose: missing ${path.join(dir, 'soul.md')}`);
  return text.trimEnd();
}

export function loadOverride(profile, dir = DEFAULT_DIR) {
  if (!PROFILES.includes(profile)) throw new Error(`soul-compose: unknown profile "${profile}"`);
  const text = readFile(path.join(dir, `soul.${profile}.md`));
  if (text === null) throw new Error(`soul-compose: missing soul.${profile}.md`);
  return text.trimEnd();
}

export function loadCapabilityLines(profile, dir = DEFAULT_DIR) {
  if (!PROFILES.includes(profile)) throw new Error(`soul-compose: unknown profile "${profile}"`);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, 'soul-capabilities.json'), 'utf8'));
  } catch {
    throw new Error('soul-compose: soul-capabilities.json missing or invalid');
  }
  const lines = parsed?.profiles?.[profile];
  if (!Array.isArray(lines)) throw new Error(`soul-compose: no capability lines for "${profile}"`);
  for (const line of lines) {
    if (typeof line !== 'string' || !line.trim() || line.includes('\n')) {
      throw new Error(`soul-compose: capability lines must be single non-empty lines ("${profile}")`);
    }
  }
  return lines;
}

/**
 * Compose base + capability lines + override. Throws listing every budget
 * violation instead of writing an over-budget soul.
 */
export function composeSoul(profile, { dir = DEFAULT_DIR } = {}) {
  const base = loadBase(dir);
  const caps = loadCapabilityLines(profile, dir);
  const override = loadOverride(profile, dir);
  const violations = [];
  if (lineCount(base) > BUDGETS.base) {
    violations.push(`base ${lineCount(base)} lines exceeds ${BUDGETS.base}`);
  }
  if (caps.length > BUDGETS.capabilities) {
    violations.push(`capability lines ${caps.length} exceeds ${BUDGETS.capabilities} ("${profile}")`);
  }
  if (lineCount(override) > BUDGETS.override) {
    violations.push(`override ${lineCount(override)} lines exceeds ${BUDGETS.override} ("${profile}")`);
  }
  const layers = caps.length ? [base, caps.join('\n'), override] : [base, override];
  const composed = layers.join('\n\n');
  if (lineCount(composed) > BUDGETS.total) {
    violations.push(`composed ${lineCount(composed)} lines exceeds ${BUDGETS.total} ("${profile}")`);
  }
  if (violations.length) {
    throw new Error(`soul-compose: budget violated — ${violations.join('; ')}`);
  }
  return `${composed}\n`;
}

/** Check one profile (or all when omitted). Returns { ok, violations }. */
export function checkSoul(profile = null, { dir = DEFAULT_DIR } = {}) {
  const targets = profile ? [profile] : PROFILES;
  const violations = [];
  for (const p of targets) {
    try {
      composeSoul(p, { dir });
    } catch (err) {
      violations.push(`${p}: ${err.message}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export function soulTarget(profile, home = os.homedir()) {
  const hermes = path.join(home, '.hermes');
  if (profile === 'default') return path.join(hermes, 'SOUL.md');
  return path.join(hermes, 'profiles', profile, 'SOUL.md');
}

/** Write every composed soul. Returns the written paths. */
export function writeSouls({ home = os.homedir(), dir = DEFAULT_DIR } = {}) {
  const { ok, violations } = checkSoul(null, { dir });
  if (!ok) throw new Error(`soul-compose: refusing to write — ${violations.join('; ')}`);
  const written = [];
  for (const p of PROFILES) {
    const target = soulTarget(p, home);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, composeSoul(p, { dir }), 'utf8');
    written.push(target);
  }
  return written;
}

/**
 * Verify live souls against composed output (VPS-safe, read-only).
 * Returns { ok, drift } where drift lists profiles whose on-disk soul
 * differs from what the composer produces. Never writes.
 */
export function verifySouls({ home = os.homedir(), dir = DEFAULT_DIR } = {}) {
  const drift = [];
  for (const p of PROFILES) {
    const target = soulTarget(p, home);
    let live = null;
    try {
      live = fs.readFileSync(target, 'utf8');
    } catch {
      drift.push({ profile: p, target, reason: 'missing' });
      continue;
    }
    let expected = null;
    try {
      expected = composeSoul(p, { dir });
    } catch (err) {
      drift.push({ profile: p, target, reason: `compose failed: ${err.message}` });
      continue;
    }
    if (live !== expected) drift.push({ profile: p, target, reason: 'differs from composed output' });
  }
  return { ok: drift.length === 0, drift };
}

function printUsage() {
  console.log('usage: soul-compose.mjs <compose|check|write|verify> [--profile=X] [--dir=PATH] [--home=PATH]');
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (const a of rest) {
    const m = a.match(/^--([^=]+)=(.*)$/s);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = '1';
  }
  const dir = opts.dir || DEFAULT_DIR;
  switch (cmd) {
    case 'compose': {
      if (!opts.profile) throw new Error('compose needs --profile=X');
      process.stdout.write(composeSoul(opts.profile, { dir }));
      break;
    }
    case 'check': {
      const { ok, violations } = checkSoul(opts.profile || null, { dir });
      console.log(JSON.stringify({ ok, violations }, null, 2));
      process.exitCode = ok ? 0 : 1;
      break;
    }
    case 'write': {
      const written = writeSouls({ home: opts.home || os.homedir(), dir });
      console.log(JSON.stringify({ written }, null, 2));
      break;
    }
    case 'verify': {
      const { ok, drift } = verifySouls({ home: opts.home || os.homedir(), dir });
      console.log(JSON.stringify({ ok, drift }, null, 2));
      process.exitCode = ok ? 0 : 1;
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`soul-compose: ${err.message}`);
    process.exit(1);
  });
}
