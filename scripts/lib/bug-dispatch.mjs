import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * bug-dispatch.mjs — V-30.4 pure helpers for packet-driven dispatch
 * (run-coding-dispatch.sh --ticket=#n). No HTTP: callers hand in the packet
 * JSON that `bugctl packet` already fetched (audit note §6.2 option B — every
 * ticket consumer reads `bugctl packet`, the legacy builders in
 * src/utils/bugWorkItem.ts are untouched).
 *
 * dispatchGuard: refuse a second dispatch for a card that is not packed
 *   (in_fix / verifying / done / blocked / not_reproducible / duplicate),
 *   with the same-run lock-pid exception.
 * planFromPacket: plan artifact fields (hypothesis/files/gates) from packet
 *   + the specify role's locked spec (specs/active/card-<n>.md).
 * specPathFor / parseSpec: locate + read the locked spec's frontmatter.
 * categoryFor: packet surface → dispatch category.
 *
 * CLI (thin, for bash): guard | category | spec-path | plan-args
 */

export function dispatchGuard(packet, opts = {}) {
  // Same-run exception: this process IS the live per-bug lock holder.
  if (opts.lockPid && opts.selfPid && String(opts.lockPid) === String(opts.selfPid)) {
    return { ok: true, reason: 'same run (lock pid matches)' };
  }
  const flags = packet?.flags || {};
  if (flags.blocked_reason) return { ok: false, reason: `blocked_reason=${flags.blocked_reason}` };
  if (flags.duplicate_of) return { ok: false, reason: `duplicate_of=${flags.duplicate_of}` };
  if (flags.not_reproducible) return { ok: false, reason: 'not_reproducible (repro lane closed this card)' };
  if (!packet?.defect) return { ok: false, reason: 'card has no defect pack (run the packer first)' };
  const state = String(packet?.state || 'new');
  if (state !== 'packed') {
    const why = {
      new: 'card is not packed yet',
      in_fix: 'card is already in_fix — a dispatch is in flight (idempotency guard)',
      verifying: 'card is awaiting a verifier — the fix is already pushed',
      done: 'card is already done',
    }[state];
    return { ok: false, reason: why || `state=${state}` };
  }
  return { ok: true, reason: 'packed' };
}

export function categoryFor(surface) {
  const s = String(surface || '').toLowerCase();
  if (['meal', 'food', 'home', 'trends', 'nutrition'].includes(s)) return 'meal';
  if (['biomarker', 'health', 'labs'].includes(s)) return 'biomarker';
  if (['onboarding', 'profile'].includes(s)) return 'onboarding';
  if (s === 'meal_audit') return 'meal_audit';
  return 'general';
}

/** Locate the specify role's locked spec for a card: card-<n>.md, then <tag_id>.md. */
export function specPathFor(dir, n, tagId) {
  const candidates = [];
  if (n !== undefined && n !== null && String(n).trim() !== '') candidates.push(`card-${String(n).trim()}.md`);
  if (tagId) candidates.push(`${String(tagId).trim()}.md`);
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

/** Minimal frontmatter parse of specs/TEMPLATE.md (scalar + list keys) + Goal line. */
export function parseSpec(md) {
  const out = { id: '', status: '', class: '', allowed_files: [], frozen_files: [], gate: [], goal: '' };
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(md || ''));
  if (fm) {
    let listKey = null;
    for (const line of fm[1].split(/\r?\n/)) {
      const li = /^\s+-\s+(.*)$/.exec(line);
      if (li && listKey) {
        out[listKey].push(li[1].trim());
        continue;
      }
      const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const raw = kv[2].trim();
      if (raw === '') {
        listKey = out[kv[1]] !== undefined && Array.isArray(out[kv[1]]) ? kv[1] : null;
      } else {
        listKey = null;
        if (out[kv[1]] !== undefined && typeof out[kv[1]] === 'string') out[kv[1]] = raw;
      }
    }
  }
  const goal = /^##\s+Goal\s*\r?\n+([^\n]+)/im.exec(String(md || ''));
  if (goal) out.goal = goal[1].trim();
  return out;
}

export const DEFAULT_GATE = 'npx vitest run src/utils/bug*.test.ts';

/** Plan artifact fields from the packet + locked spec (specify role wins). */
export function planFromPacket(packet, spec) {
  const hypothesis =
    (spec && spec.goal) ||
    packet?.defect?.criteria ||
    packet?.title ||
    packet?.bug ||
    'fix the packed defect';
  const files = spec && spec.allowed_files.length ? spec.allowed_files.slice() : [];
  const gates = spec && spec.gate.length ? spec.gate.slice() : [DEFAULT_GATE];
  if (!files.length) {
    return {
      ok: false,
      hypothesis,
      files,
      gates,
      reason: 'no allowed_files — specify role: write specs/active/card-<n>.md from specs/TEMPLATE.md first',
    };
  }
  return { ok: true, hypothesis, files, gates };
}

function parseFlags(argv) {
  const flags = {};
  for (const a of argv) {
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 2) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
  }
  return flags;
}

function cli(argv) {
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  switch (cmd) {
    case 'guard': {
      const file = flags['packet-file'];
      if (!file) throw new Error('guard requires --packet-file=<path>');
      const packet = JSON.parse(fs.readFileSync(file, 'utf8'));
      const res = dispatchGuard(packet, {
        lockPid: flags['lock-pid'],
        selfPid: flags['self-pid'],
      });
      process.stdout.write((res.ok ? 'ok' : `refused: ${res.reason}`) + '\n');
      process.exitCode = res.ok ? 0 : 1;
      return;
    }
    case 'category': {
      process.stdout.write(categoryFor(flags.surface || '') + '\n');
      return;
    }
    case 'spec-path': {
      const dir = flags.dir;
      if (!dir) throw new Error('spec-path requires --dir=<path>');
      process.stdout.write(specPathFor(dir, flags.n, flags.tag) + '\n');
      return;
    }
    case 'plan-args': {
      const file = flags['packet-file'];
      if (!file) throw new Error('plan-args requires --packet-file=<path>');
      const packet = JSON.parse(fs.readFileSync(file, 'utf8'));
      const specFile = flags.spec && fs.existsSync(String(flags.spec)) ? String(flags.spec) : '';
      const spec = specFile ? parseSpec(fs.readFileSync(specFile, 'utf8')) : null;
      process.stdout.write(JSON.stringify(planFromPacket(packet, spec)) + '\n');
      return;
    }
    default:
      console.error(`bug-dispatch: unknown command: ${cmd || '(none)'}`);
      process.exitCode = 1;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2));
  } catch (err) {
    console.error(`bug-dispatch: ${err.message}`);
    process.exit(1);
  }
}
