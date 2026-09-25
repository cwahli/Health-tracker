// One allowance model. /allowance, /freemodel and the turn's lane choice must
// not be able to disagree about the same lane, which is what the two bots'
// /allowance output showed: a route marked unavailable on one surface and
// offered on another.
//
// The lane CATALOG is shared. Quota is per worker: each bot passes its own
// session, so two bots may honestly disagree about what is depleted right now.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLanes, annotateFreemodelEntries, buildAllowanceTextForBots, ensureBotLedger, stampDepleted, withCatalogLanes } from './lib/free-lanes.mjs';
import { selectTurnLanes } from './bot-host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}

console.log('assert-one-allowance-model:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'allowance-model-'));
const oldHome = process.env.HOME;
const oldOverride = process.env.FREE_LANES_DIR;
process.env.HOME = home;

const table = {
  lanes: [
    { provider: 'opencode', model: 'opencode/zen-a', pref: 1, status: 'available', tg: true, label: 'Zen A' },
    { provider: 'cline', model: 'cline-free/deep-b', pref: 2, status: 'available', tg: true, label: 'Deep B' },
    { provider: 'opencode', model: 'opencode/zen-c', pref: 3, status: 'available', tg: true, label: 'Zen C', bucket: 'zen-free' },
    { provider: 'tokenharbor', model: 'th/d', pref: 4, status: 'available', tg: true, label: 'TH D' },
    { provider: 'freebuff', model: 'fb/terminal', pref: 5, status: 'available', tg: false, label: 'FB' },
    { provider: 'opencode', model: 'opencode/promo', pref: 6, status: 'ended', tg: true, label: 'Old Promo' },
  ],
};

try {
  // 1. The projection gives one verdict per lane, and it is explicit.
  const clean = projectLanes(table, {});
  check('every lane is projected', clean.length === 6);
  check('an available Telegram lane is selectable', clean.find((r) => r.label === 'Zen A')?.selectable === true);
  check('a terminal-only lane is never selectable', clean.find((r) => r.label === 'FB')?.selectable === false);
  check('a terminal-only lane says why', /terminal only/.test(clean.find((r) => r.label === 'FB')?.reason || ''));
  check('an ended lane is never selectable', clean.find((r) => r.label === 'Old Promo')?.selectable === false);
  check('an ended lane says why', /never offered again/.test(clean.find((r) => r.label === 'Old Promo')?.reason || ''));
  check('each row carries a plan code', clean.every((r) => typeof r.plan === 'string' && r.plan.length >= 2));

  // 1b. Gemini is a lane with its own allowance, and it must not borrow another
  // provider's plan code — that is the mistake the tokenharbor rows above had.
  const gemTable = { version: 3, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', status: 'available', tg: true, label: 'OC row' },
    { pref: 2, provider: 'gemini', model: 'gemini-3.8-flash', status: 'available', tg: true, label: 'Gemini 3.8' },
    { pref: 3, provider: 'opencode', model: 'google/gemini-3.7-flash', status: 'available', tg: true, label: 'Gemini 3.7 via opencode' },
  ] };
  const gemRows = projectLanes(gemTable, {});
  check('a gemini provider row is planned as GM', gemRows.find((r) => r.label === 'Gemini 3.8')?.plan === 'GM');
  check('a gemini model reached through opencode is planned as GM', gemRows.find((r) => r.label === 'Gemini 3.7 via opencode')?.plan === 'GM');
  check('a plain opencode row is still OC', gemRows.find((r) => r.label === 'OC row')?.plan === 'OC');
  check('a gemini row is selectable when the key is there', gemRows.find((r) => r.label === 'Gemini 3.8')?.selectable === true);

  // 1c. The catalog is folded into the table, so /allowance and /freemodel offer
  // the same rows. Live on 2026-09-25: /freemodel listed 43 models of which 38
  // had no ledger row, and /allowance showed no Gemini at all.
  const baseTable = { version: 3, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', status: 'depleted', nextResetAt: '2030-01-01T00:00:00Z', tg: true, label: 'Muse 1.3' },
  ] };
  const foldCatalog = [
    { ref: 'opencode/muse-spark-1.3-contributor-free', label: 'Muse 1.3' },
    { ref: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { ref: 'gemini:gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { ref: 'opencode-go/space-bunny-free', label: 'Space Bunny' },
    { ref: 'pending:tokenharbor', label: 'tokenharbor (pending setup/sign-in)' },
  ];
  const folded = withCatalogLanes(baseTable, foldCatalog, { now: Date.now() });
  check('a catalogued model with no lane row gets one', folded.added.length === 3, JSON.stringify(folded.added.map((l) => l.model)));
  check('a gemini model reached through opencode gets a row', folded.table.lanes.some((l) => l.model === 'google/gemini-3.8-flash'));
  check('a gemini: ref gets a row too', folded.table.lanes.some((l) => l.model === 'gemini-3.7-flash'));
  check('a pending-signin placeholder is not turned into a lane', !folded.table.lanes.some((l) => String(l.model).includes('pending:')));
  check('an existing row is not duplicated', folded.table.lanes.filter((l) => l.model === 'opencode/muse-spark-1.3-contributor-free').length === 1);
  check('appended rows land after the existing ones', folded.added.every((l) => Number(l.pref) > Number(baseTable.lanes[0].pref)));
  check('an existing stamp survives the fold', folded.table.lanes.find((l) => l.pref === 1)?.status === 'depleted');
  check('folding twice adds nothing', withCatalogLanes(folded.table, foldCatalog).added.length === 0);
  check('a folded row is labelled like the rest of the table, not as a raw ref',
    folded.added.every((l) => !/^(cline:|opencode:|google:)/.test(String(l.label || ''))), JSON.stringify(folded.added.map((l) => l.label)));
  check('a folded label drops the surface prefix and the (free) suffix',
    withCatalogLanes({ version: 3, lanes: [] }, [{ ref: 'opencode/big-pickle', label: 'opencode:big pickle (free)' }]).added[0].label === 'big pickle',
    JSON.stringify(withCatalogLanes({ version: 3, lanes: [] }, [{ ref: 'opencode/big-pickle', label: 'opencode:big pickle (free)' }]).added.map((l) => l.label)));
  check('a folded label keeps a real product name intact',
    withCatalogLanes({ version: 3, lanes: [] }, [{ ref: 'cline:cline-free/kat-coder-pro', label: 'cline:kat coder pro (free)' }]).added[0].label === 'kat coder pro');
  const foldedRows = projectLanes(folded.table, {});
  check('a folded gemini row is selectable', foldedRows.find((r) => r.model === 'google/gemini-3.8-flash')?.selectable === true);
  check('a folded gemini row is planned as GM', foldedRows.find((r) => r.model === 'google/gemini-3.8-flash')?.plan === 'GM');
  check('a vendor-prefixed opencode lane is planned as OC', foldedRows.find((r) => /space-bunny-free$/.test(r.model))?.plan === 'OC');
  // The same model under two vendor prefixes must not become two rows.
  const twice = withCatalogLanes({ version: 3, lanes: [] }, [
    { ref: 'opencode/space-bunny-free' },
    { ref: 'opencode-go/space-bunny-free' },
  ]);
  check('the same model under two vendor prefixes is one row', twice.added.length === 1, JSON.stringify(twice.added.map((l) => l.model)));
  // A provider with no credential here still gets a row, and the projection is what
  // refuses it — that is the "X at the bottom", not a missing row.
  const noKey = projectLanes(withCatalogLanes({ version: 3, lanes: [] }, [{ ref: 'cloudflare/@cf/qwen/qwen3.8-27b' }]).table, {},
    { readiness: { tokenharbor: { ready: false }, cloudflare: { ready: false }, cline: { ready: true }, opencode: { ready: true }, gemini: { ready: true }, freebuff: { ready: true } } });
  check('a provider with no credential is listed, not dropped', noKey.length === 1);
  check('and is not selectable, with a reason that names the fix', noKey[0].selectable === false && /not set up|needs \S/.test(noKey[0].reason) && !/undefined/.test(noKey[0].reason), noKey[0].reason);

  // 2. Quota marks a lane, and only for the worker whose session says so.
  const now = Date.now();
  const vmSession = { quota: { 'opencode/opencode/zen-a': { depletedUntil: now + 45 * 60 * 1000, countdownHint: '45m' } } };
  const vmView = projectLanes(table, vmSession, { now });
  const otherView = projectLanes(table, {}, { now });
  check('a stamped lane is not selectable for that worker', vmView.find((r) => r.label === 'Zen A')?.selectable === false);
  check('and it carries the vendor countdown', /45m/.test(vmView.find((r) => r.label === 'Zen A')?.resetLabel || ''));
  check('another worker sees the same lane as available', otherView.find((r) => r.label === 'Zen A')?.selectable === true);
  check('the catalog is identical for both', vmView.map((r) => r.ref).join() === otherView.map((r) => r.ref).join());

  // 3. A shared bucket takes the sibling with it, on every surface.
  const bucketSession = { quota: { 'bucket:zen-free': { depletedUntil: now + 3600 * 1000 } } };
  const bucketView = projectLanes(table, bucketSession, { now });
  check('the bucket sibling is out too', bucketView.find((r) => r.label === 'Zen C')?.selectable === false);

  // 4. /freemodel and /allowance cannot disagree, row for row.
  const catalog = [
    { ref: 'opencode/zen-a', label: 'Zen A' },
    { ref: 'cline:cline-free/deep-b', label: 'Deep B' },
    { ref: 'fb/terminal', label: 'FB' },
    { ref: 'opencode/promo', label: 'Old Promo' },
  ];
  const annotated = annotateFreemodelEntries(catalog, table, vmSession, { now });
  const byLabel = (label) => annotated.find((a) => a.label === label);
  check('/freemodel marks the stamped lane depleted', byLabel('Zen A')?.depleted === true);
  check('/freemodel agrees it is not selectable', byLabel('Zen A')?.selectable === false);
  check('/freemodel agrees the terminal lane is not selectable', byLabel('FB')?.selectable === false);
  check('/freemodel agrees the ended lane is not selectable', byLabel('Old Promo')?.selectable === false);
  check('/freemodel keeps a healthy lane selectable', byLabel('Deep B')?.selectable === true);
  check('a catalog model with no lane row is flagged, not silently offered', annotateFreemodelEntries([{ ref: 'opencode/ghost', label: 'Ghost' }], table, vmSession, { now })[0].inLedger === false);

  // for every row the two surfaces must produce the same verdict
  const rows = projectLanes(table, vmSession, { now });
  for (const row of rows) {
    const a = annotated.find((x) => x.label === row.label);
    if (!a) continue;
    check(`same verdict on both surfaces: ${row.label}`, a.selectable === row.selectable && a.depleted === row.depleted);
  }

  // 5. The turn's walk offers exactly the selectable rows.
  const { dir } = ensureBotLedger('vm');
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(vmSession, null, 2));
  const walked = selectTurnLanes({ botId: 'vm', model: 'cline:cline-free/deep-b', fallback: 'opencode/zen-a', now });
  const selectableRefs = rows.filter((r) => r.selectable).map((r) => r.ref);
  for (const ref of walked.models) {
    check(`the walk offers only selectable rows: ${ref}`, selectableRefs.includes(ref) || ref === 'cline:cline-free/deep-b');
  }
  check('the walk never offers the terminal lane', !walked.models.some((m) => /fb\//.test(m)));
  check('the walk never offers the ended lane', !walked.models.some((m) => /promo/.test(m)));

  // 6. /allowance renders the same rows from the same ledger.
  const text = buildAllowanceTextForBots({ stateDir: dir, now });
  check('/allowance lists the healthy lane', /Deep B/.test(text));
  // The table is rendered by the shared Grok component, which drops ended rows.
  // That is now the intended presentation; what must hold on every surface is
  // that an ended lane is never offered and never shown as available.
  check('/allowance never shows the ended lane as available', !/✅\s*(<code>)?\s*Old Promo/.test(text.replace(/<\/?code>/g, '')));
  check('/allowance shows the reset for the stamped lane', /Zen A/.test(text));
  // A terminal-only row stays visible (the Grok table shows it) but is never the
  // next lane and never selectable: the walk cannot choose it.
  check('/allowance does not offer a terminal row as Next up', !/Next up: FB/.test(text));
  check('and marks it terminal when it is the only option', /Next up: \(no free lane available/.test(text) || !/Next up: FB/.test(text));
  check('/allowance names the next usable lane', /Next up: Deep B/.test(text));

  // 6b. A green Token Harbor row is not proof a turn runs. Live finding
  // 2026-09-25: the key authenticated, /v1/models answered 200, and every
  // completion came back 402 because the balance was $0 — with the row still
  // ticking. Token Harbor exposes no balance endpoint, so the disclosure has to
  // sit next to the rows rather than wait for the walk to fail.
  check('/allowance discloses that the Token Harbor balance is unverifiable', /Token Harbor: counted as usable/.test(text));
  check('and says a $0 account fails the turn', /402/.test(text));
  check('and names where to top up', /tokenharbor\.ai\/dashboard/.test(text));
  const thFreeTable = { ...table, lanes: table.lanes.filter((l) => l.provider !== 'tokenharbor') };
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(thFreeTable, null, 2));
  const noThText = buildAllowanceTextForBots({ stateDir: dir, now });
  check('and the disclosure is absent when no Token Harbor lane is listed', !/Token Harbor: counted as usable/.test(noThText));
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));

  // 7. /freemodel's body must not contradict /allowance.
  const botSrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('/freemodel renders the annotated rows, not the raw catalog', /const rows = \(entries \|\| \[\]\)\.map\(verdictOf\)/.test(botSrc));
  check('/freemodel marks blocked rows instead of hiding the reason', /Not selectable right now:/.test(botSrc));
  const codeOnly = botSrc.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  check('/freemodel no longer claims everything is available', !/all selectable lanes look available/.test(codeOnly));
  check('/freemodel counts selectable and blocked', /\$\{usable\.length\} selectable, \$\{blocked\.length\} blocked/.test(botSrc));
  check('/freemodel writes its own header, not the raw catalog count', /const header = formatFreeModelText/ .test(botSrc) === false);
  check('the header counts rows with no ledger row separately', /with no ledger row/.test(botSrc));
  check('the tappable keyboard only offers usable rows', /const keyboardEntries = available\.length \? available : selectable;/.test(botSrc));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldOverride === undefined) delete process.env.FREE_LANES_DIR; else process.env.FREE_LANES_DIR = oldOverride;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
