#!/usr/bin/env node
/**
 * assert-domain-canonical — every location, every /do-github-sync.
 *
 * The canonical public domain is https://health-tracker.co.uk (apex, www,
 * and the tui/web/omb/tgtg subdomains). The legacy host
 * `health-tracking.duckdns.org` (and the dead Render origin
 * `health-tracker-backend-64gt.onrender.com`) must not be the answer to
 * "where is the live site" anywhere an agent or bot reads it from.
 *
 * What it checks on THIS box (missing paths are skipped silently, so the
 * same command runs on vps-france, mac, grok-vps, collab, and mobile):
 *
 *  1. Repo defaults — the files below must not name the old hosts. A hit
 *     here is a repo fix (edit on main), not a local fix.
 *  2. Bot env files (~/.config/bot-host/*.env) — TUI_GATEWAY_URL,
 *     OPENCODE_WEB_URL, OPENCODE_WEB_HOST must be co.uk or unset (unset
 *     falls back to the repo defaults, which are co.uk since #579/#581).
 *     A hit here is a local fix: set the co.uk value, restart the unit.
 *  3. Agent memories (~/.hermes/.env + profile MEMORY.md seeds) — same rule.
 *  4. Caddy (vps only) — duckdns blocks still present is INFO, not failure:
 *     retirement follows the log-soak gate in docs/infra/COUK_MIGRATION.md.
 *
 * Exit 0: canonical. Exit 1: drift, with the exact fix printed per hit.
 * `--fix` applies the local (env/memory) fixes in place; it never touches
 * the repo or Caddy — those go through a PR and the migration runbook.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANONICAL = 'health-tracker.co.uk';
const OLD = [/health-tracking\.duckdns\.org/gi, /health-tracker-backend-64gt\.onrender\.com/gi, /health-tracker\.is-a\.dev/gi];

// Files whose checked-in content is the fleet-wide default: any old-host
// mention is drift. Frozen history (dated entries, specs/checkpoints, golden
// past/current/result_summary, qa-evidence, dist) is evidence, not
// configuration — deliberately excluded.
const REPO_MUST_BE_CLEAN = [
  'scripts/tui-gateway.mjs',
  'scripts/bot-host.mjs',
  'scripts/assert-tui-gateway.test.mjs',
  'scripts/assert-tui-gateway-live.sh',
  'scripts/assert-memory-stores.mjs',
  'tests/memory-stores.test.ts',
  'src/utils/bugSnapshot.ts',
  'src/utils/bugSnapshot.test.ts',
  'scripts/qa-runner.mjs',
  'scripts/qa-auto-loop.mjs',
  'scripts/phone-screenshot.mjs',
  'scripts/r13-0-preflight.mjs',
  'scripts/setup-hermes-global-soul.sh',
  'scripts/mobile/start-vm-relay-tunnel.sh',
  'scripts/mobile/start-phone-shot-tunnel.sh',
  'scripts/telegram-smoke-test.sh',
  'scripts/skills/common/telegram-testing/SKILL.md',
  'scripts/skills/common/telegram-matrix/SKILL.md',
  'scripts/fixtures/hermes-profiles/bug_ticket/memories/MEMORY.md',
  'bots/soul.default.md',
  'TERMS.md',
  'PRIVACY.md',
  'plan/BOT_ROLES.md',
  'plan/RELIABILITY.md',
  'plan/TUI_IMPLEMENTATION.md',
  'plan/WEBUI_MIGRATION.md',
  'docs/agent/standing.json',
  'golden/scorecard/instruction/MASTER_SCORECARD.md',
  'golden/scorecard/instruction/README.md',
  'golden/scorecard/instruction/WORKFLOW.md',
  'golden/scorecard/instruction/inventories/structure.json',
  '.agents/skills/scorecard/SKILL.md',
];

// Records that legitimately name the old host (dated history rows, migration
// notes, worked examples). Reported, never failed: the agent verifies no line
// is an actionable address, then moves on.
const REPO_MAY_MENTION = [
  'specs/active/R-13.md',
  'docs/infra/COUK_MIGRATION.md',
  'plan/ROADMAP.md',
  'plan/VPS2_MOBILE_DEV.md',
  'plan/DIRECT_RELAY_ROUTE.md',
  'plan/R16_MERGE_HANDOFF.md',
  'plan/TG_TOOL_SURFACE.md',
  'plan/archive/GCP_FREE_TIER_MIGRATION.md',
  'TG_Tui_Proposal1.md',
  'tasks/AGENT_HANDOFF.md',
  'AI_HANDOVER.md',
  'docs/infra/DOMAINS.md',
  'docs/infra/DUAL_SERVE_RUNBOOK.md',
  'docs/infra/DUCKDNS_AUDIT.md',
  'docs/infra/FALLBACK.md',
];

const ENV_KEYS = ['TUI_GATEWAY_URL', 'OPENCODE_WEB_URL', 'OPENCODE_WEB_HOST', 'PLAYWRIGHT_TEST_BASE_URL', 'SHOT_SSH_HOST'];
const ENV_FIX = {
  TUI_GATEWAY_URL: 'https://tui.health-tracker.co.uk',
  OPENCODE_WEB_URL: 'https://web.health-tracker.co.uk',
  OPENCODE_WEB_HOST: 'web.health-tracker.co.uk',
  PLAYWRIGHT_TEST_BASE_URL: 'https://health-tracker.co.uk',
  SHOT_SSH_HOST: 'health-tracker.co.uk',
};

const args = new Set(process.argv.slice(2));
const doFix = args.has('--fix');
const home = os.homedir();
const failures = [];
const infos = [];
let checks = 0;

const hits = (text) => {
  const found = new Set();
  for (const re of OLD) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[0].toLowerCase());
  }
  return [...found];
};

// 1. Repo defaults — locate the checkout by walking up from cwd.
let root = process.cwd();
while (root !== '/' && !fs.existsSync(path.join(root, '.git'))) root = path.dirname(root);
if (fs.existsSync(path.join(root, '.git'))) {
  for (const rel of REPO_MUST_BE_CLEAN) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    checks += 1;
    // ROADMAP / migration-doc / runbook history rows are records, not config:
    // only the live-canonical lines are judged. The allowlist is per-file.
    let text = fs.readFileSync(p, 'utf8');
    failures.push(...hits(text).map((h) => `repo ${rel}: names ${h} (fix on main, PR it)`));
  }
  for (const rel of REPO_MAY_MENTION) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    checks += 1;
    const found = hits(fs.readFileSync(p, 'utf8'));
    if (found.length) infos.push(`repo ${rel}: mentions ${found.join(', ')} (record tier — verify none is an actionable address)`);
  }
} else {
  infos.push('no git checkout above cwd — repo check skipped');
}

// 2 + 3. Local env files and memory seeds.
const localFiles = [];
const botHostDir = path.join(home, '.config', 'bot-host');
if (fs.existsSync(botHostDir)) {
  for (const f of fs.readdirSync(botHostDir)) {
    if (f.endsWith('.env')) localFiles.push(path.join(botHostDir, f));
  }
}
const hermesEnv = path.join(home, '.hermes', '.env');
if (fs.existsSync(hermesEnv)) localFiles.push(hermesEnv);
const profilesDir = path.join(home, '.hermes', 'profiles');
if (fs.existsSync(profilesDir)) {
  for (const prof of fs.readdirSync(profilesDir)) {
    const mem = path.join(profilesDir, prof, 'memories', 'MEMORY.md');
    if (fs.existsSync(mem)) localFiles.push(mem);
  }
}
for (const p of localFiles) {
  const text = fs.readFileSync(p, 'utf8');
  const found = hits(text);
  if (!found.length) {
    checks += 1;
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const lh = hits(line);
    if (!lh.length) return;
    checks += 1;
    const key = (line.match(/^\s*([A-Z_]+)=/) || [])[1];
    if (doFix && key && ENV_FIX[key] && p.endsWith('.env')) {
      lines[i] = `${key}=${ENV_FIX[key]}`;
      failures.push(`fixed ${p}:${i + 1} ${key} -> ${ENV_FIX[key]} (restart the unit)`);
    } else if (doFix && p.endsWith('MEMORY.md')) {
      let nl = line;
      for (const re of OLD) {
        re.lastIndex = 0;
        nl = nl.replace(re, CANONICAL);
      }
      lines[i] = nl;
      failures.push(`fixed ${p}:${i + 1} -> canonical host`);
    } else {
      failures.push(`local ${p}:${i + 1}: names ${lh.join(', ')}` +
        (key && ENV_FIX[key] ? ` (fix: ${key}=${ENV_FIX[key]}, then restart the unit)` : ' (fix: re-seed with the co.uk host)'));
    }
  });
  if (doFix) fs.writeFileSync(p, lines.join('\n'));
}

// 4. Caddy retirement state — informational only.
const caddyfile = '/etc/caddy/Caddyfile';
if (fs.existsSync(caddyfile)) {
  const text = fs.readFileSync(caddyfile, 'utf8');
  const blocks = (text.match(/^[A-Za-z0-9.*_, \-]+\{/gm) || []).map((s) => s.trim());
  const old = blocks.filter((b) => b.includes('duckdns'));
  const canon = blocks.filter((b) => b.includes('health-tracker.co.uk'));
  infos.push(`caddy blocks: co.uk=[${canon.join(' | ')}]${old.length ? ` legacy-still-serving=[${old.join(' | ')}] (retire per COUK_MIGRATION.md step 8, log-soak gate)` : ' legacy fully retired'}`);
}

console.log(`assert-domain-canonical: ${checks} checks`);
for (const i of infos) console.log(`  INFO  ${i}`);
if (failures.length === 0) {
  console.log('assert-domain-canonical: 0 drift — canonical');
  process.exit(0);
}
console.log(`assert-domain-canonical: ${failures.length} drift:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
