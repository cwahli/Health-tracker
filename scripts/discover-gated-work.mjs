#!/usr/bin/env node
/**
 * Unattended queue: only work that already has a gate.
 * Items without a named test / standing row are NOT eligible — those need a human
 * sentence (and usually a standing row) first.
 *
 *   node scripts/discover-gated-work.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standing = JSON.parse(fs.readFileSync(path.join(root, 'docs/agent/standing.json'), 'utf8'));

function run(label, args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  return { label, status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function parsePacketFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = { id: '', status: '', auto_go: '', who: '', class: '' };
  for (const raw of m[1].split(/\r?\n/)) {
    const kv = raw.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const key = kv[1];
    if (!(key in out)) continue;
    out[key] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function listActivePackets() {
  const dir = path.join(root, 'specs', 'active');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fm = parsePacketFrontmatter(path.join(dir, f));
      if (!fm || fm.status !== 'locked') return null;
      const auto = String(fm.auto_go).toLowerCase() === 'true';
      const id = fm.id || f.replace(/\.md$/, '');
      return {
        id,
        class: fm.class || '',
        why: auto
          ? `locked packet specs/active/${f} — pre-approved go (Grok-only retired)`
          : `locked packet specs/active/${f} — wait for human (auto_go=false)`,
        gate: `node scripts/journey-guard.mjs ${id}`,
        auto_go: auto,
        frozen: ['docs/agent/standing.json', 'scripts/assert-standing.mjs', 'scripts/journey-guard.mjs'],
        spec: `specs/active/${f}`,
      };
    })
    .filter(Boolean);
}

const standingRun = run('standing', [path.join(root, 'scripts/assert-standing.mjs')]);
const eligible = [];
const blocked = [];

if (standingRun.status !== 0) {
  eligible.push({
    id: 'standing-repair',
    class: 'FEATURE_DROP',
    why: 'assert-standing failed — restore or re-wire; do not edit standing.json to pass',
    gate: 'node scripts/journey-guard.mjs standing-repair',
    auto_go: true,
    frozen: ['docs/agent/standing.json', 'scripts/assert-standing.mjs', 'scripts/journey-guard.mjs'],
  });
}

const currentWorkOrder = ['q-4-agent-result-table', 'q-10-dependency-audit', 'R-13'];
const packets = listActivePackets();
packets.sort((a, b) => {
  const ia = currentWorkOrder.indexOf(a.id);
  const ib = currentWorkOrder.indexOf(b.id);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});
for (const pkt of packets) {
  if (pkt.auto_go) eligible.push(pkt);
  else blocked.push({ id: pkt.id, why: pkt.why });
}

for (const j of standing.journeys || []) {
  blocked.push({
    id: `do-not-swap:${j.id}`,
    why: `${j.label} instruction/schema are Frozen on any unattended run that is not explicitly that journey`,
  });
}

console.log('=== unattended-eligible (has a gate) ===');
if (eligible.length === 0) {
  console.log('(none — standing is green and no auto_go packet. Do not invent a night job.)');
} else {
  console.log(JSON.stringify(eligible, null, 2));
}

console.log('\n=== never auto-go ===');
console.log(JSON.stringify([
  { id: 'learn-from-other-journey', why: 'needs human go — sibling freeze' },
  { id: 'App.tsx / JobStore / LogChat', why: 'job-lifecycle; L1 blast radius' },
  { id: 'no-named-gate', why: 'babysitting lives here; promote a standing row or vitest first' },
  { id: 'npm test / POST /loop', why: 'forbidden inner loop' },
  ...blocked,
], null, 2));

process.exit(standingRun.status === 0 ? 0 : 0);
