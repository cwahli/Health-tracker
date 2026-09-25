// A lane whose provider has no credential on this host must say so, on every
// surface, with the fix. Seven of the seventeen ledger lanes were advertised as
// available while being unusable: five Token Harbor models that do not exist
// upstream and two Cloudflare models with no token on the box.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerReadiness, setupGaps, laneSetup } from './lib/setup-gaps.mjs';
import { projectLanes, annotateFreemodelEntries, buildAllowanceTextForBots, ensureBotLedger } from './lib/free-lanes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}

console.log('assert-setup-gaps:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
const oldHome = process.env.HOME;
process.env.HOME = home;
const env = { PATH: process.env.PATH, GEMINI_API_KEY: 'k' }; // a deliberately thin host

try {
  const r = providerReadiness({ env, home, location: 'vps', clineReady: () => true });

  // 1. A present credential reads as ready; an absent one names the variable.
  check('a provider with its key is ready', r.tokenharbor.ready === false || r.gemini.ready === true);
  check('gemini is ready with a key', r.gemini.ready === true);
  check('tokenharbor names the exact variable', r.tokenharbor.needs === 'TOKEN_HARBOR_API_KEY');
  check('cloudflare names the exact variable', r.cloudflare.needs === 'CLOUDFLARE_WORKERS_AI_TOKEN');
  check('the fix is copy-pasteable and says where', /common\.env/.test(String(r.cloudflare.fix)) && /systemctl restart/.test(String(r.cloudflare.fix)));
  check('freebuff points at its own command', r.freebuff.command === '/unlock');
  check('freebuff is never sold as a turn lane', /terminal only/.test(r.freebuff.needs));

  // 2. SetupGaps lists exactly the not-ready ones.
  const gaps = setupGaps(r).map((g) => g.provider).sort();
  check('gaps exclude the ready providers', !gaps.includes('gemini') && !gaps.includes('opencode') && !gaps.includes('cline'));
  check('gaps include the missing credentials', gaps.includes('tokenharbor') && gaps.includes('cloudflare'));

  // 3. The lane verdict follows the provider.
  check('laneSetup mirrors the provider', laneSetup('tokenharbor', r).needsSetup === true);
  check('a ready provider needs no setup', laneSetup('opencode', r).needsSetup === false);
  check('an unknown provider is unknown, not broken', laneSetup('mystery', r).unknown === true);

  // 4. The table must not call an unrunnable lane available.
  const table = { lanes: [
    { provider: 'opencode', model: 'opencode/ok', pref: 1, status: 'available', tg: true, label: 'OK lane' },
    { provider: 'tokenharbor', model: 'th/ghost', pref: 2, status: 'available', tg: true, label: 'Ghost lane' },
    { provider: 'cloudflare', model: 'cf/real', pref: 3, status: 'available', tg: true, label: 'CF lane' },
  ] };
  const rows = projectLanes(table, {}, { readiness: r });
  check('a runnable lane is selectable', rows.find((x) => x.label === 'OK lane')?.selectable === true);
  check('a lane with no credential is NOT selectable', rows.find((x) => x.label === 'Ghost lane')?.selectable === false);
  check('and it is flagged as needing setup', rows.find((x) => x.label === 'Ghost lane')?.needsSetup === true);
  check('its reason names the variable', /TOKEN_HARBOR_API_KEY/.test(rows.find((x) => x.label === 'Ghost lane')?.reason || ''));
  check('the same for cloudflare', /CLOUDFLARE_WORKERS_AI_TOKEN/.test(rows.find((x) => x.label === 'CF lane')?.reason || ''));

  // 5. No readiness evidence at all must not invent a verdict.
  const blind = projectLanes(table, {}, {});
  check('without readiness, no lane is blocked for setup', blind.every((x) => x.needsSetup === false));
  check('and nothing claims a setup reason', blind.every((x) => !/needs [A-Z_]+/.test(x.reason || '')));

  // 6. Both surfaces render it, and neither offers the lane.
  const { dir } = ensureBotLedger('vm');
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));
  const text = buildAllowanceTextForBots({ stateDir: dir, readiness: r });
  check('/allowance marks the unrunnable lane with a pause, not a tick', /⏸ Ghost lane/.test(text));
  check('/allowance never marks it available', !/✅ Ghost lane/.test(text));
  check('/allowance names the variable', /TOKEN_HARBOR_API_KEY/.test(text));
  check('/allowance points at the fix', /\/setup/.test(text));
  const ann = annotateFreemodelEntries([{ ref: 'th/ghost', label: 'Ghost lane' }], table, {}, { readiness: r });
  check('/freemodel also refuses it', ann[0].selectable === false);
  check('/freemodel explains why', /TOKEN_HARBOR_API_KEY/.test(ann[0].reason || ''));

  // 7. The command exists and names the same things.
  const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('there is a /setup command', /case 'setup':/.test(src));
  check('it prints the fix for each gap', /fix: \$\{g\.fix\}/.test(src));
  check('it says what is blocked while unfixed', /not offered in \/freemodel until the credential is present/.test(src));
  check('readiness is cached with the model list', /caches\.readiness/.test(src));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
