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
  // 1b. A present Token Harbor key is not a promise that a turn runs. Found live
  // on 2026-09-25: the key was correct and authenticating, the account had $0, and
  // every completion came back 402 while /setup said "ready". Token Harbor exposes
  // no balance endpoint (all /v1 billing paths 404), so the note has to say so —
  // the walk records the 402, but /setup must not promise a working lane.
  const thKeyed = providerReadiness({ env: { PATH: process.env.PATH, GEMINI_API_KEY: 'k', TOKEN_HARBOR_API_KEY: 'thk_live_test' }, home, location: 'vps', clineReady: () => true });
  check('a keyed tokenharbor reads ready', thKeyed.tokenharbor.ready === true);
  check('but is not reported as a gap', !setupGaps(thKeyed).some((g) => g.provider === 'tokenharbor'));
  check('its note says the balance is not API-visible', /balance is not API-visible/.test(String(thKeyed.tokenharbor.note || '')));
  check('and points at the dashboard to top up', /tokenharbor\.ai\/dashboard/.test(String(thKeyed.tokenharbor.note || '')));
  check('cloudflare names the exact variable', r.cloudflare.needs === 'CLOUDFLARE_WORKERS_AI_TOKEN');
  check('the fix is copy-pasteable and says where', /common\.env/.test(String(r.cloudflare.fix)) && /systemctl restart/.test(String(r.cloudflare.fix)));
  check('freebuff points at its own command', r.freebuff.command === '/unlock');
  check('freebuff is never sold as a turn lane', r.freebuff.terminalOnly === true);
  // Freebuff is checked, not assumed. This host has the CLI and a signed-in
  // credentials file, and the old hardcoded "not signed in" was wrong; the
  // router's own copy was pinned to another machine's home directory.
  const { findFreebuffCredentials } = await import('./lib/setup-gaps.mjs');
  const signedIn = findFreebuffCredentials({ env: {}, home: '/home/ubuntu' });
  check('a signed-in freebuff file is detected', signedIn.ok === true);
  check('and the path it read is this host\'s', signedIn.path === '/home/ubuntu/.config/manicode/credentials.json');
  check('the searched paths are reported for the fix text', signedIn.searched.length >= 1 && signedIn.searched.every((f) => typeof f === 'string'));
  check('an unsigned-in host reads as not ready', findFreebuffCredentials({ env: {}, home: '/tmp/definitely-not-here' }).ok === false);
  const realHost = providerReadiness({ env: { PATH: process.env.PATH, GEMINI_API_KEY: 'k' }, home: '/home/ubuntu', clineReady: () => true });
  check('so this host is NOT reported as missing freebuff', realHost.freebuff.ready === true);
  check('and it stays terminal-only', realHost.freebuff.terminalOnly === true);
  check('the ready note says signed in', /signed in/.test(String(realHost.freebuff.note || '')));
  const routerSrc = fs.readFileSync(path.join(HERE, '..', 'tools', 'telegram-provider-router', 'src', 'index.js'), 'utf8');
  check('the router no longer pins freebuff creds to another home', !/\/home\/box\/\.config\/manicode/.test(routerSrc));
  check('the router resolves the path per host', /FREEBUFF_CREDS[\s\S]{0,120}homedir\(\)/.test(routerSrc));

  // 2. SetupGaps lists exactly the not-ready ones.
  const gaps = setupGaps(r).map((g) => g.provider).sort();
  check('gaps exclude the ready providers', !gaps.includes('gemini') && !gaps.includes('opencode') && !gaps.includes('cline'));
  check('a signed-in terminal provider is not a gap either', !gaps.includes('freebuff') || r.freebuff.ready !== true);
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
  // The unrunnable lanes leave the table entirely: they are not counted, they
  // are listed underneath with the variable each one needs. That also keeps the
  // table's columns aligned — the mixed-width marks were the misalignment.
  check('the unrunnable lane is out of the table', !/Ghost lane/.test(text.split('Not counted')[0]));
  check('it is listed as not counted', /Not counted on this host/.test(text));
  check('outside the table it carries the pause mark', /⏸ Ghost lane/.test(text));
  check('and names the variable', /TOKEN_HARBOR_API_KEY/.test(text));
  check('and points at the fix', /\/setup/.test(text));
  check('the missing variables are summarised once', /Missing: .*TOKEN_HARBOR_API_KEY/.test(text));

  // Ranking: the chat's own lane leads, and Next up agrees with row one. Its
  // own fixture: the table above has no Cline lane to promote.
  const rankDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-'));
  try {
    fs.writeFileSync(path.join(rankDir, 'free-lane-table.json'), JSON.stringify({ lanes: [
      { provider: 'opencode', model: 'opencode/zen-a', pref: 1, status: 'available', tg: true, label: 'Zen A' },
      { provider: 'cline', model: 'cline-free/deep-b', pref: 2, status: 'available', tg: true, label: 'Deep B' },
    ] }, null, 2));
    const ranked = buildAllowanceTextForBots({ stateDir: rankDir, provider: 'cline', model: 'cline-free/deep-b', readiness: r });
    const rowsInOrder = ranked.split('\n').filter((l) => /^(✅|❌)/.test(l)).map((l) => l.replace(/^(✅|❌)\s*/, '').trim().split(/\s{2,}/)[0]);
    check('the current lane is the first row, not the top preference', /Deep B/.test(rowsInOrder[0] || '') && rowsInOrder.length === 2);
    check('Next up names that same lane', /Next up: Deep B/.test(ranked));
    const dataRows = ranked.split('\n').filter((l) => /^(✅|❌)/.test(l));
    const offsets = dataRows.map((l) => l.search(/(?:^|\s)(OC|CL|TH|CF|FB)(?:\s|$)/));
    check('every row aligns its Plan column', offsets.length > 1 && new Set(offsets).size === 1);
    check('and the header aligns with them', /Model\s+Plan\s+Reset in/.test(ranked.replace(/<\/?code>/g, '')));
  } finally {
    fs.rmSync(rankDir, { recursive: true, force: true });
  }
  const ann = annotateFreemodelEntries([{ ref: 'th/ghost', label: 'Ghost lane' }], table, {}, { readiness: r });
  check('/freemodel also refuses it', ann[0].selectable === false);
  check('/freemodel explains why', /TOKEN_HARBOR_API_KEY/.test(ann[0].reason || ''));

  // 6b. A lane reached THROUGH opencode belongs to the provider in its path.
  const through = { lanes: [
    { provider: 'opencode', model: 'opencode/tokenharbor/deepseek-v4.1-flash:free', pref: 1, status: 'available', tg: true, label: 'TH via opencode' },
    { provider: 'opencode', model: 'cloudflare/@cf/qwen/qwen3.8-27b', pref: 2, status: 'available', tg: true, label: 'CF via opencode' },
    { provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', pref: 3, status: 'available', tg: true, label: 'Real opencode lane' },
  ] };
  const tp = projectLanes(through, {}, { readiness: r });
  check('a tokenharbor lane behind opencode is blocked by the missing key', tp.find((x) => x.label === 'TH via opencode')?.needsSetup === true);
  check('and its plan code is TH, from the shared component', tp.find((x) => x.label === 'TH via opencode')?.plan === 'TH');
  check('a cloudflare lane behind opencode is blocked too', tp.find((x) => x.label === 'CF via opencode')?.needsSetup === true);
  check('and its plan code is CF', tp.find((x) => x.label === 'CF via opencode')?.plan === 'CF');
  check('a genuine opencode lane is unaffected', tp.find((x) => x.label === 'Real opencode lane')?.selectable === true);
  check('and keeps the OC code', tp.find((x) => x.label === 'Real opencode lane')?.plan === 'OC');

  // 7. The command exists and names the same things.
  const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('there is a /setup command', /case 'setup':/.test(src));
  check('it prints the fix for each gap', /fix: \$\{g\.fix\}/.test(src));
  check('it says what is blocked while unfixed', /not offered in \/freemodel until the credential is present/.test(src));
  check('readiness is cached with the model list', /caches\.readiness/.test(src));
  check('the fix names the service of the bot asking', /setServiceUnit\(botId\)/.test(src));
  check('/setup re-reads readiness for its own bot', /caches\.readiness = null;\s*\n\s*const readiness = hostReadiness\(caches, config\.id\)/.test(src));

  // and the hint really follows the bot
  const { setServiceUnit } = await import('./lib/setup-gaps.mjs');
  setServiceUnit('vm2');
  const r2 = providerReadiness({ env, home, location: 'vps', clineReady: () => true });
  check('a vm2 gap says restart bot-host@vm2', /bot-host@vm2/.test(String(r2.cloudflare.fix)));
  setServiceUnit('vm');
  const vmFix = String(providerReadiness({ env, home, location: 'vps', clineReady: () => true }).cloudflare.fix);
  check('a vm gap says restart bot-host@vm and not vm2', /bot-host@vm(?!2)/.test(vmFix) && !vmFix.includes('vm2'));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
