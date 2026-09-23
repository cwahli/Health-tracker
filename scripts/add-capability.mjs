#!/usr/bin/env node
/**
 * Scaffold a new shared capability so it enters the propagation ladder
 * (plan/RELIABILITY.md §14.7 Case H) from step zero.
 *
 * The entry starts with all classes `false` and status `open`, so
 * check-capability-propagation fails until the author declares the real
 * per-class rollout, documents adapters, and builds the core — intake can
 * never silently skip propagation.
 *
 * Usage:
 *   node scripts/add-capability.mjs --id my-feature --test T1 --scope common [--skill] [--expect scripts/lib/x.mjs,...] [--status open]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REG_PATH = path.join(ROOT, 'bots', 'capabilities.json');

function arg(name, def = null) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? def;
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const id = arg('id');
const test = arg('test');
const scope = arg('scope');
const status = arg('status', 'open');
const expects = (arg('expect', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error('need --id like my-feature'); process.exit(2); }
if (!/^T[1-6]$/.test(test || '')) { console.error('need --test T1..T6'); process.exit(2); }
if (!['common', 'transport', 'runtime-adapter', 'bot-specific'].includes(scope)) { console.error('need --scope common|transport|runtime-adapter|bot-specific'); process.exit(2); }
if (!['done', 'partial', 'open'].includes(status)) { console.error('need --status done|partial|open'); process.exit(2); }

const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
if (reg.capabilities.some((c) => c.id === id)) { console.error(`capability "${id}" already registered`); process.exit(1); }

reg.capabilities.push({
  id, test, scope, status,
  prove: 'TODO: one scripted check per affected class',
  expect: expects,
  skills: has('skill') ? [id] : [],
  classes: { hermes: false, vps: false, mobile: false, grok_tg: false, collab: false },
  notes: 'TODO: declare per-class rollout; flip each class to true/adapter with adapter docs, or keep false with reason.',
});

if (has('skill')) {
  const dir = path.join(ROOT, 'scripts', 'skills', 'common', id);
  fs.mkdirSync(dir, { recursive: true });
  const sk = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(sk)) {
    fs.writeFileSync(sk, `---\nname: ${id}\ndescription: TODO: one line — when the agent should use this.\n---\n\n# ${id}\n\nTODO: core behaviour. Per-class adapters go in notes in bots/capabilities.json; class-specific UX in adapters/<class>.md — do not copy this file.\n`);
    console.log(`scaffolded scripts/skills/common/${id}/SKILL.md`);
  }
}

fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2) + '\n');
console.log(`registered "${id}" as ${status} — next: fill core → classes/adapters → prove, then run check-capability-propagation.mjs`);
