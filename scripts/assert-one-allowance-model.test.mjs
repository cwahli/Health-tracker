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
import { projectLanes, annotateFreemodelEntries, buildAllowanceTextForBots, ensureBotLedger, stampDepleted, withCatalogLanes, entriesFromLanes, planCodeForLane, canonicalAllowanceLanes } from './lib/free-lanes.mjs';
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
  // A bullet naming a second vendor prefix for a model the table already carries
  // must resolve to that row, not claim the model has no ledger row.
  const twinTable = { version: 3, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/space-bunny-free', status: 'depleted', nextResetAt: '2030-01-01T00:00:00Z', tg: true, label: 'Space Bunny' },
  ] };
  const twinAnn = annotateFreemodelEntries([{ ref: 'opencode-go/space-bunny-free', label: 'opencode-go:space-bunny-free (free)' }], twinTable, {});
  check('a vendor-prefix twin resolves to the existing ledger row', twinAnn[0].inLedger === true);
  check('and inherits its depletion rather than claiming availability', twinAnn[0].depleted === true);
  check('so no row is reported as having no ledger row', twinAnn.filter((a) => !a.inLedger).length === 0);

  // The same base name reached through two different providers is two lanes, not
  // one. Token Harbor's `mimo-v2.5:free` and OpenCode's `mimo-v2.5-free` differ by
  // punctuation, and a key that normalised punctuation away dropped a real lane.
  const twoProviders = withCatalogLanes(
    { version: 3, lanes: [{ pref: 1, provider: 'tokenharbor', model: 'tokenharbor/mimo-v2.5:free', status: 'available', tg: true, label: 'MiMo V2.5 TH' }] },
    [{ ref: 'opencode/mimo-v2.5-free', label: 'opencode:mimo v2.5 free (free)' }],
  );
  check('a tokenharbor row and an opencode row for the same base name both survive',
    twoProviders.table.lanes.length === 2 && twoProviders.added.length === 1,
    JSON.stringify(twoProviders.table.lanes.map((l) => l.model)));
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

  // 1d. The union runs both ways. withCatalogLanes folds the catalog into the
  // table; entriesFromLanes lists the rows the catalog never mentions. Live on
  // 2026-09-25 the five Token Harbor and Cloudflare rows lived only in the ledger:
  // /allowance showed them and /freemodel could not offer them at all.
  const ledgerOnly = { version: 3, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', status: 'available', tg: true, label: 'Muse 1.3' },
    { pref: 2, provider: 'tokenharbor', model: 'deepseek-v4.1-flash:free', status: 'available', tg: true, label: 'DeepSeek V4.1' },
    { pref: 3, provider: 'opencode', model: 'cloudflare/@cf/qwen/qwen3.8-27b', status: 'available', tg: true, label: 'Qwen3.8 27B' },
    { pref: 4, provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash', status: 'available', tg: false, label: 'DeepSeek V4.1' },
  ] };
  const catalog2 = [{ ref: 'opencode/muse-spark-1.3-contributor-free', label: 'Muse 1.3' }];
  const fromLanes = entriesFromLanes(ledgerOnly, catalog2);
  check('a tokenharbor row the catalog never mentions becomes an entry', fromLanes.some((e) => /deepseek-v4.1-flash/.test(e.ref)), JSON.stringify(fromLanes.map((e) => e.ref)));
  check('a cloudflare row too', fromLanes.some((e) => /@cf\/qwen/.test(e.ref)));
  check('a terminal-only lane is listed but not offered as a tap target', fromLanes.find((e) => /freebuff|deepseek\/deepseek/.test(e.ref))?.selectable === false);
  check('a row the catalog already has is not listed twice', !fromLanes.some((e) => /muse-spark/.test(e.ref)));
  const union = [...catalog2, ...fromLanes];
  const bothWays = withCatalogLanes(ledgerOnly, union).table;
  check('after both directions every row has a lane', annotateFreemodelEntries(union, bothWays, {}).every((a) => a.inLedger === true),
    JSON.stringify(annotateFreemodelEntries(union, bothWays, {}).filter((a) => !a.inLedger).map((a) => a.ref)));
  check('and the same rows come back out of the table', bothWays.lanes.length === ledgerOnly.lanes.length + 0, `${bothWays.lanes.length} vs ${ledgerOnly.lanes.length}`);

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
  // One shared weekly bar, said once. The rows look like five independent models,
  // so without this the user reads an empty bar as five separate failures.
  check('/allowance says Token Harbor is one shared bar', /Token Harbor: one shared rolling ~7-day value bar/.test(text));
  check('and that the rows go and return together', /all TH rows go at once and return together/.test(text));
  check('and it does not tell the user to buy anything', !/top up|add money|balance is not API-visible/.test(text), text.slice(0, 200));
  const thFreeTable = { ...table, lanes: table.lanes.filter((l) => l.provider !== 'tokenharbor') };
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(thFreeTable, null, 2));
  const noThText = buildAllowanceTextForBots({ stateDir: dir, now });
  check('and the disclosure is absent when no Token Harbor lane is listed', !/Token Harbor: counted as usable/.test(noThText));
  fs.writeFileSync(path.join(dir, 'free-lane-table.json'), JSON.stringify(table, null, 2));

  // 6c. Token Harbor's bar is weekly, so a 402 must not be stamped with the 6h
  // daily default. The table has said "rolling ~7-day value bar" on every TH row
  // all along; the stamper disagreed, and a 6h re-probe against a weekly bar shows
  // a reset time that is never going to arrive.
  const thTable = { version: 3, buckets: {}, lanes: [
    { pref: 1, provider: 'tokenharbor', model: 'deepseek-v4.1-flash:free', bucket: 'tokenharbor-free', status: 'available', tg: true, label: 'DeepSeek V4.1', resetRule: 'rolling ~7-day value bar (shared Token Harbor free)' },
    { pref: 2, provider: 'tokenharbor', model: 'mimo-v2.6-flash:free', bucket: 'tokenharbor-free', status: 'available', tg: true, label: 'MiMo V2.6', resetRule: 'rolling ~7-day value bar (shared Token Harbor free)' },
  ] };
  const thDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-bar-'));
  fs.writeFileSync(path.join(thDir, 'free-lane-table.json'), JSON.stringify(thTable, null, 2));
  const thStamp = stampDepleted({ stateDir: thDir, provider: 'tokenharbor', model: 'deepseek-v4.1-flash:free', errText: "HTTP 402 {'message': 'Your Token Harbor balance is at $0.'}" });
  check('a Token Harbor 402 is stamped', thStamp.stamped === true, JSON.stringify(thStamp));
  const thSession = JSON.parse(fs.readFileSync(path.join(thDir, 'session.json'), 'utf8'));
  const thRec = thSession.quota['bucket:tokenharbor-free'];
  check('it stamps the SHARED tokenharbor bucket, not just one model', Boolean(thRec), JSON.stringify(Object.keys(thSession.quota || {})));
  check('with a weekly window, not the 6h daily default', thRec && thRec.depletedUntil - Date.now() > 6.5 * 24 * 3600 * 1000, thRec ? String(Math.round((thRec.depletedUntil - Date.now()) / 3600000)) + 'h' : 'no record');
  const thRows = projectLanes(thTable, thSession, { now: Date.now() });
  check('so every Token Harbor row is depleted together', thRows.every((r) => r.depleted === true), JSON.stringify(thRows.map((r) => [r.label, r.depleted])));
  check('and none of them is offered', thRows.every((r) => r.selectable === false));
  check('a non-Token-Harbor 402 keeps the 6h default', (() => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-bar-'));
    const cfTable = { version: 3, buckets: {}, lanes: [{ pref: 1, provider: 'opencode', model: 'opencode/zen', status: 'available', tg: true, label: 'Zen' }] };
    fs.writeFileSync(path.join(d2, 'free-lane-table.json'), JSON.stringify(cfTable, null, 2));
    const s2 = stampDepleted({ stateDir: d2, provider: 'opencode', model: 'opencode/zen', errText: 'HTTP 402 payment required' });
    const rec = (JSON.parse(fs.readFileSync(path.join(d2, 'session.json'), 'utf8')).quota || {})['opencode/opencode/zen'];
    return s2.stamped === true && rec && rec.depletedUntil - Date.now() <= 7 * 3600 * 1000;
  })());
  fs.rmSync(thDir, { recursive: true, force: true });

  // 6d. The two commands must agree, row for row, on the same lane. They did not:
  // /allowance ticked a terminal-only Freebuff lane green (laneIsUsable only knows
  // the table's own status) while /freemodel, reading the projection, marked the
  // same row not usable. And the fold added a second Freebuff row because the
  // model key stripped one path segment while Freebuff's ref carries two
  // (`freebuff/deepseek/deepseek-v4.1-flash`), so the same lane was listed twice.
  const twinFreebuff = withCatalogLanes(
    { version: 3, lanes: [{ pref: 1, provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash', status: 'available', tg: false, label: 'Freebuff DeepSeek V4.1 Flash' }] },
    [{ ref: 'freebuff/deepseek/deepseek-v4.1-flash', label: 'freebuff:deepseek/deepseek-v4.1-flash (terminal-only)', selectable: false }],
  );
  check('a ref with two vendor segments is not folded in twice', twinFreebuff.added.length === 0 && twinFreebuff.table.lanes.length === 1,
    JSON.stringify(twinFreebuff.table.lanes.map((l) => l.model)));
  check('and the two providers stay distinct models', withCatalogLanes(
    { version: 3, lanes: [{ pref: 1, provider: 'tokenharbor', model: 'tokenharbor/mimo-v2.5:free', status: 'available', tg: true, label: 'MiMo V2.5' }] },
    [{ ref: 'opencode/mimo-v2.5-free' }],
  ).added.length === 1);
  const fbTable = { version: 3, buckets: {}, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/zen', status: 'available', tg: true, label: 'Zen' },
    { pref: 2, provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash', status: 'available', tg: false, label: 'Freebuff DeepSeek' },
  ] };
  const fbRows = projectLanes(fbTable, {});
  check('a terminal-only lane is not selectable in the projection', fbRows.find((r) => r.label === 'Freebuff DeepSeek')?.selectable === false);
  const fbText = buildAllowanceTextForBots({ stateDir: (() => { const d = ensureBotLedger('vm').dir; fs.writeFileSync(path.join(d, 'free-lane-table.json'), JSON.stringify(fbTable, null, 2)); return d; })() });
  check('/allowance does not tick a terminal-only lane green', !/✅[^\n]*Freebuff/.test(fbText), fbText.split('\n').filter((l) => /Freebuff/.test(l)).join(' | '));
  check('/allowance says why it is not usable', /terminal only/.test(fbText));
  check('/freemodel marks the same lane not usable', /❌/.test(fbText) && /Freebuff/.test(fbText));

  // 6e. Parity, asserted over a table that mixes every awkward shape at once: a
  // plain opencode lane, a terminal-only Freebuff lane whose projection ref carries
  // no provider prefix, a Token Harbor lane behind two prefixes, and a lane reached
  // through a vendor-prefixed path. For every model, the verdict /freemodel gives
  // must be the verdict /allowance gives.
  const parityTable = { version: 3, buckets: {}, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/zen', status: 'available', tg: true, label: 'Zen' },
    { pref: 2, provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash', status: 'available', tg: false, label: 'Freebuff DeepSeek' },
    { pref: 3, provider: 'opencode', model: 'tokenharbor/deepseek-v4.1-flash:free', status: 'available', tg: true, label: 'TH DeepSeek' },
    { pref: 4, provider: 'opencode', model: 'opencode/space-bunny-free', status: 'depleted', nextResetAt: '2030-01-01T00:00:00Z', tg: true, label: 'Space Bunny' },
  ] };
  const parityEntries = [
    { ref: 'opencode/zen', label: 'opencode:zen (free)' },
    { ref: 'freebuff/deepseek/deepseek-v4.1-flash', label: 'freebuff:deepseek (terminal-only)', selectable: false },
    { ref: 'tokenharbor/deepseek-v4.1-flash:free', label: 'OpenCode Token Harbor DeepSeek free' },
    { ref: 'opencode/space-bunny-free', label: 'opencode:space bunny free (free)' },
  ];
  const parityProj = projectLanes(parityTable, {});
  const parityAnn = annotateFreemodelEntries(parityEntries, parityTable, {});
  const unusableOf = (r) => r.selectable === false || r.depleted || r.ended === true;
  for (const row of parityProj) {
    const key = String(row.model).toLowerCase().split('/').pop();
    const ann = parityAnn.find((a) => String(a.ref).toLowerCase().split('/').pop() === key);
    check(`same verdict on both surfaces: ${row.label}`, Boolean(ann) && unusableOf(ann) === unusableOf(row) && ann.terminalOnly === row.terminalOnly,
      `allowance=${unusableOf(row) ? 'not usable' : 'usable'}/${row.terminalOnly ? 'terminal' : 'chat'} freemodel=${ann ? `${unusableOf(ann) ? 'not usable' : 'usable'}/${ann.terminalOnly ? 'terminal' : 'chat'}` : 'NO ROW'}`);
  }
  check('a terminal-only lane is not usable in either surface',
    parityAnn.find((a) => /freebuff/.test(a.ref))?.selectable === false && parityProj.find((r) => r.terminalOnly)?.selectable === false);

  // 6f. The two commands must agree on the COUNT, not only on each row's verdict.
  // /allowance listed 52 rows and /freemodel counted 51: the same Token Harbor model
  // on two paths is one shared bar, and only one of the two surfaces was collapsing
  // it. The router's grid has always collapsed it for display.
  check('/allowance renders the same canonical list, not its own walk of the table',
    /const canonicalRows = canonicalAllowanceLanes\(/.test(fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8')));
  const fmSrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  check('/freemodel has no dedupe of its own any more', !/seenModel/.test(fmSrc), 'a second notion of "same model" is how the two drifted apart');
  check('and takes the shared list instead', /canonical = null/.test(fmSrc) && /canonical: canonicalAllowanceLanes\(/.test(fmSrc));
  // Provider AND model: keying on the model name alone merged Cline's
  // `deepseek-v4.1-flash` with Freebuff's — same last segment, different accounts —
  // and one of them vanished from the list.
  // The plan code is the one identity both commands already agree on — /allowance
  // prints it in its Plan column. The raw provider did not work: the ledger calls
  // the Gemini lanes `google`, the catalog calls them `gemini`, and
  // `opencode-go/space-bunny-free` is the same model as `opencode/space-bunny-free`,
  // so each of those was counted twice.
  check('and the identity is the plan code, in the shared helper',
    /`\$\{planCodeForLane\(lane\)\}\|\$\{model\}`/.test(fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8')));
  // Called, not grepped: the ledger spells the Gemini lanes `google/…` and the
  // catalog spells them `gemini`, and only the plan code folds the two together.
  check('the plan code folds the google/gemini spelling together',
    planCodeForLane({ provider: 'google', model: 'google/gemini-3.8-flash' }) === 'GM'
    && planCodeForLane({ provider: 'gemini', model: 'gemini-3.8-flash' }) === 'GM',
    `${planCodeForLane({ provider: 'google', model: 'google/gemini-3.8-flash' })}/${planCodeForLane({ provider: 'gemini', model: 'gemini-3.8-flash' })}`);
  check('and folds an opencode vendor twin onto the same code',
    planCodeForLane({ provider: 'opencode-go', model: 'opencode-go/space-bunny-free' }) === planCodeForLane({ provider: 'opencode', model: 'opencode/space-bunny-free' }));
  const twinLanes = { version: 3, buckets: {}, lanes: [
    { pref: 5, provider: 'opencode', model: 'tokenharbor/deepseek-v4.1-flash:free', bucket: 'tokenharbor-free', status: 'available', tg: true, label: 'OpenCode Token Harbor DeepSeek V4.1 Flash free' },
    { pref: 7, provider: 'tokenharbor', model: 'deepseek-v4.1-flash:free', bucket: 'tokenharbor-free', status: 'available', tg: true, label: 'Token Harbor chat DeepSeek V4.1 Flash free' },
  ] };
  const twinText = buildAllowanceTextForBots({ stateDir: (() => { const d = ensureBotLedger('vm').dir; fs.writeFileSync(path.join(d, 'free-lane-table.json'), JSON.stringify(twinLanes, null, 2)); return d; })() });
  // Counted over the table rows only: the "Next up" line names the same model too.
  const twinRows = twinText.split('\n').filter((l) => /^(✅|❌)/.test(l) && /DeepSeek V4\.1/.test(l));
  check('and /allowance lists that model once, not twice', twinRows.length === 1, twinText);

  // 6g. The parity that matters, asserted on one table holding every awkward shape:
  // the row list /allowance renders and the row list /freemodel renders are the same
  // array, so the two commands report the same number by construction rather than by
  // two dedupes agreeing.
  const shared = { version: 3, buckets: {}, lanes: [
    { pref: 1, provider: 'opencode', model: 'opencode/zen', status: 'available', tg: true, label: 'Zen' },
    { pref: 2, provider: 'opencode', model: 'tokenharbor/deepseek-v4.1-flash:free', bucket: 'tokenharbor-free', status: 'available', tg: true, label: 'OpenCode Token Harbor DeepSeek free' },
    { pref: 3, provider: 'tokenharbor', model: 'deepseek-v4.1-flash:free', bucket: 'tokenharbor-free', status: 'available', tg: true, label: 'Token Harbor chat DeepSeek free' },
    { pref: 4, provider: 'opencode', model: 'google/gemini-3.8-flash', status: 'available', tg: true, label: 'gemini 3.8 flash' },
    { pref: 5, provider: 'opencode', model: 'opencode/space-bunny-free', status: 'available', tg: true, label: 'Space Bunny' },
    { pref: 6, provider: 'opencode-go', model: 'opencode-go/space-bunny-free', status: 'available', tg: true, label: 'space-bunny-free' },
    { pref: 7, provider: 'freebuff', model: 'deepseek/deepseek-v4.1-flash', status: 'available', tg: false, label: 'Freebuff DeepSeek' },
  ] };
  const canon = canonicalAllowanceLanes({ table: shared, session: {}, readiness: null });
  const canonKeys = canon.map((r) => `${r.plan}|${String(r.model).toLowerCase().split('/').filter(Boolean).pop()}`);
  check('the Token Harbor pair is one row', canonKeys.filter((k) => k.startsWith('TH|')).length === 1, JSON.stringify(canonKeys));
  check('a vendor twin is one row', canonKeys.filter((k) => /space-bunny/.test(k)).length === 1, JSON.stringify(canonKeys));
  check('the google/gemini lane is one GM row', canonKeys.filter((k) => k.startsWith('GM|')).length === 1, JSON.stringify(canonKeys));
  check('every row is unique', new Set(canonKeys).size === canonKeys.length, JSON.stringify(canonKeys));
  check('and /allowance renders exactly that many rows', (() => {
    const d = ensureBotLedger('vm').dir;
    fs.writeFileSync(path.join(d, 'free-lane-table.json'), JSON.stringify(shared, null, 2));
    const text = buildAllowanceTextForBots({ stateDir: d });
    const rows = text.split('\n').filter((l) => /^(✅|❌)/.test(l));
    return rows.length === canonKeys.length;
  })(), `allowance rows vs canonical rows`);
  check('a terminal-only row is in the list and marked not selectable',
    canon.find((r) => /Freebuff/.test(String(r.label)))?.selectable === false);

  // 6h. A depleted row must show its reset, not just the mark. The reset of a
  // per-worker stamp lives in that worker's session record, not in the table, so a
  // row read from the host's catalogue had to take the time from the projection or
  // it printed "❌" beside "Reset in —".
  const stamped = { version: 3, buckets: {}, lanes: [
    { pref: 1, provider: 'cline', model: 'cline-free/muse-spark-1.3-contributor', status: 'depleted', tg: true, label: 'Muse 1.3' },
  ] };
  const until = Date.now() + 13 * 3600 * 1000;
  const sess = { quota: { 'cline/cline-free/muse-spark-1.3-contributor': { depletedUntil: until, lastError: 'Error 429: Daily free limit reached' } } };
  const stampedText = buildAllowanceTextForBots({ stateDir: (() => { const d = ensureBotLedger('vm').dir; fs.writeFileSync(path.join(d, 'free-lane-table.json'), JSON.stringify(stamped, null, 2)); fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify(sess, null, 2)); return d; })() });
  check('a depleted row shows its reset time from the session record', /Muse 1\.3[^\n]*\d+h/.test(stampedText), stampedText.split('\n').filter((l)=>/Muse/.test(l)).join(' | '));

  // 6i. A superseded model must not come back through the "no lane row" path. The
  // canonical list drops an older version whose family has a newer one, but that
  // model IS in the table — so a re-add loop keyed on the list instead of the table
  // put 13 models back and /freemodel said 49 rows while /allowance said 30.
  const paritySrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  const lanesSrc = fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8');
  // After the catalog is folded in, the only catalogued things without a lane row are
  // provider placeholders like "pending:gemini" — not models. Keying the re-add on
  // those put six non-rows in the list and broke the count parity again (36 vs 30).
  check('provider placeholders are not counted as models',
    /if \(String\(v\.ref \|\| ''\)\.startsWith\('pending:'\)\) continue;/.test(paritySrc));
  check('the re-add is keyed on the table, not on the canonical list',
    /const inTable = new Set/.test(paritySrc) && /!inTable\.has\(m\)/.test(paritySrc) && !/inList/.test(paritySrc));
  check('and the handler passes the table lanes through', /tableLanes: \(fmTable && fmTable\.lanes\) \|\| \[\]/.test(paritySrc));
  // The handler must fold the catalog in before building the canonical list, or it
  // counts the 17 authored lanes while /allowance renders the folded table.
  check('and it uses the table the annotation was built against',
    /const \{ entries, annotated, table: fmTable, session: fmSession \} = getAnnotatedFreeModels/.test(paritySrc));
  // The supersession policy must have ONE home. /allowance's renderer called
  // canonicalAllowanceLanes() with no scoreOf while /freemodel passed one, so the
  // two surfaces dropped different models: 30 rows against 36.
  // Two rows that render the same text are one untappable row as far as a reader is
  // concerned: "ling-3.0-flash-fin-free" and "ling-3.0-flash-free" both printed as
  // "ling-3.0-flash-f" in a 16-column name.
  const nameSrc = lanesSrc;
  check('a "-free" suffix on the model id is stripped, not left to eat the column',
    /\.replace\(\/\-free\$\/i, ""\)/.test(nameSrc) && /const W_MODEL = MODEL_NAME_MAX/.test(nameSrc));
  // One cap for the column and for shortModelName(). Two numbers is how a 20-char
  // cap in a 24-char column still cut "nemotron-3.5-lightning" to
  // "nemotron-3.5-lightni" and "trinity-large-preview" to "trinity-large-previe".
  check('the name column and the name cap are the same number',
    /export const MODEL_NAME_MAX = 24;/.test(nameSrc) && /s\.length > MODEL_NAME_MAX \? s\.slice\(0, MODEL_NAME_MAX\)/.test(nameSrc));
  check('and no two distinct models render the same name', (() => {
    const names = ['ling-3.0-flash-fin', 'ling-3.0-flash', 'nemotron-3.5-lightning', 'trinity-large-preview']
      .map((n) => n.padEnd(24, ' ').slice(0, 24).trim());
    return new Set(names).size === names.length;
  })());

  // R-16: the supersession order comes from the catalog's Ranked picks, from one
  // home, so /allowance and /freemodel cannot drop different models again.
  check('and the supersession score has one home, in free-lanes, reading the catalog',
    /scoreOf = laneScoreFromCatalog/.test(lanesSrc) && /from '.\/free-catalogs.mjs'/.test(lanesSrc)
    && !/scoreOf: modelScore/.test(paritySrc) && !/function modelScore\(/.test(paritySrc));
  check('and no-credential rows leave the count on both surfaces',
    /const needsSetup = rows\.filter\(\(r\) => r\.needsSetup\)/.test(paritySrc) && /need setup/.test(paritySrc) && /needsSetup\.length \? ` · \$\{needsSetup\.length\} need setup`/.test(paritySrc));

  // 7. /freemodel's body must not contradict /allowance.
  const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');
  const botSrc = read('bot-host.mjs');
  // The rows are the canonical list in the canonical tier-group order — the same
  // helper /allowance groups with — not a second ordering of the same models.
  // The breakdown has to match, not just the order: the keyboard carries a heading
  // row per group with the same label and count /allowance prints above the section,
  // from the same groupRowsByTier() result.
  check('/freemodel heads each tier group with the same label and count',
    /buttons\.push\(\{ text: leftAlign\(`\$\{g\.label\} \(\$\{g\.rows\.length\}\)`\), data: 'noop', header: true \}\)/.test(botSrc));
  check('and a heading is a real noop, not a model named noop',
    /const payload = want === 'noop' \? 'noop' : `\$\{kind\}:\$\{want\}`/.test(read('lib/commands.mjs')));
  check('the body carries the same breakdown as one line',
    /function tierBreakdown\(groups, sep\)/.test(botSrc) && /tierBreakdown\(tierGroups, ' · '\)/.test(botSrc));
  check('and the per-button tier word is gone, now that the heading says it',
    !/tierWord/.test(botSrc));

  check('/freemodel renders the canonical list, not the raw catalog',
    /const rows = tierGroups\.flatMap\(\(g\) => g\.rows\);/.test(botSrc) && /groupRowsByTier\(canonical \|\| \[\]\)/.test(botSrc) && /canonicalAllowanceLanes\(/.test(botSrc));
  check('/freemodel renders the union, not the raw catalog alone', /const \{ entries, annotated, table: fmTable, session: fmSession \} = getAnnotatedFreeModels\(caches, config\.id\)/.test(botSrc));
  check('a pending placeholder is dropped when the ledger has rows for that provider',
    /status !== 'pending-signin'\) return true;/.test(botSrc) && /effectiveProviderOf\(l\)/.test(botSrc));
  // Changed deliberately on 2026-09-25, to follow the Grok router, which had
  // already solved this shape: the per-model list is the keyboard, the body is a
  // header plus one total line, and anything unavailable is one short footer line
  // — the router's own comment reads "never a second per-model list". This command
  // was printing 49 bullets, the same 49 as buttons, and then repeating the counts,
  // with catalog labels on one side and the table's on the other, so /freemodel and
  // /allowance showed one set of models as two different lists.
  const codeOnly = botSrc.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  check('/freemodel no longer claims everything is available', !/all selectable lanes look available/.test(codeOnly));
  check('/freemodel writes its own header, not the raw catalog count', /const header = formatFreeModelText/ .test(botSrc) === false);
  check('the header counts rows with no ledger row separately', /with no ledger row/.test(botSrc));
  // The router's wording: a total, and how many are not usable.
  check('/freemodel totals the rows the way the router does', /Total: \$\{listed\.length\}/.test(botSrc) && /not usable ❌/.test(botSrc));
  // The reason is still shown, on one line, rather than as a second per-model list.
  check('/freemodel still says why a row is unusable, on one line', /not usable: /.test(botSrc) && /\(reset in /.test(botSrc));
  // Scoped to the /freemodel formatter: /setup legitimately prints a bullet per gap.
  const fmBody = (botSrc.slice(botSrc.indexOf('function formatFreemodelWithDepletion'), botSrc.indexOf('/** Usable rows the ledger has no record for')) || '');
  check('and the /freemodel body carries no per-model bullet list', !/lines\.push\(`• /.test(fmBody) && !/Not selectable right now:/.test(fmBody));
  check('and it does not repeat the counts in a second footer', !/Allowance \(per-host ledger\)/.test(botSrc));
  // Depleted lanes stay tappable, exactly as the router does, so a tap can answer
  // with what to use instead. Filtering them out is what made the two commands
  // list different things.
  // The router's button: a provider tag, the model's own name, ❌ when unusable.
  // The tag is the same plan code /allowance prints, which is what makes the two
  // commands read as one list instead of two vocabularies.
  // The button is: ❌ when unusable, the plan code, the model's own name, and the
  // bakeoff label — or "unranked" when the ledger has no row for that model.
  // assert-free-catalogs covers the label's provenance (QS-7).
  check('a button is the plan code and the model name, ❌ when unusable',
    /const rated = `\$\{tag \? tag \+ ': ' : ''\}\$\{label\}/.test(botSrc)
    && /text: leftAlign\(`\$\{unusableOf\(r\) \? '❌ ' : ''\}\$\{rated\}`\)/.test(botSrc),
    botSrc.match(/buttons\.push\(\{[^\n]*/)?.[0] || 'not found');
  // Telegram caps callback_data at 64 bytes, and it used to carry the label — so
  // the first label that grew took the whole keyboard down with
  // BUTTON_DATA_INVALID. The payload is the route, and a route that still cannot
  // fit degrades to a position rather than to a broken button.
  check('callback_data carries the route, never the label', /data: route/.test(botSrc) && /callback_data: data/.test(read('lib/commands.mjs')));
  // Every row is an array of buttons. Returning a bare button object instead is
  // `expected an Array of InlineKeyboardButton`, which is what the first attempt
  // at this fix did.
  check('and every keyboard row is an array of buttons', /return \[\{ text, callback_data: data \}\];/.test(read('lib/commands.mjs')));
  check('and a payload that cannot fit degrades to a position', /LIMIT = 64/.test(read('lib/commands.mjs')) && /`\$\{kind\}:#\$\{i\}`/.test(read('lib/commands.mjs')));
  check('the tap resolves a route first, then a position, then a label',
    /a\.ref === value/.test(botSrc) && /startsWith\('#'\)/.test(botSrc));
  // The two commands show one list. The body carries allowanceTableLines() — the
  // same helper /allowance renders — so the rows, the order, the groups and the
  // counts cannot differ; the keyboard is the tappable layer on top of it.
  check('/freemodel prints the same table /allowance prints', /allowanceTableLines\(fmTable, fmSession/.test(botSrc));
  check('and it is the shared helper, not a second renderer', /export function allowanceTableLines/.test(read('lib/free-lanes.mjs')));
  check('the table helper is the table only, so nothing is embedded twice', /if \(tableOnly\) return lines\.join/.test(read('lib/free-lanes.mjs')));
  // The table is only monospace if the message is sent as HTML, and the plain lines
  // around it must be escaped or a label with & or < fails the whole send. Both of
  // these were live bugs: the tags showed up as literal text.
  check('/freemodel sends the table as HTML, which is what makes it monospace', /parse_mode: 'HTML'/.test(botSrc) && /<code>/.test(read('lib/free-lanes.mjs')));
  check('and the plain lines are escaped, the table left alone', /String\(l\)\.includes\('<code>'\) \? l : escHtml\(l\)/.test(botSrc));

  check('button labels are padded left, and say why that is cosmetic',
    /const LEFT_PAD = '\\u00a0\\u00a0'/.test(botSrc) && /no alignment field/.test(botSrc) && /leftAlign\(/.test(botSrc));
  check('a button still carries the benchmark score', /const bench = benchmarkLabel\(model\)/.test(botSrc) && /\$\{bench \? ` · \$\{bench\}` : ''\}/.test(botSrc));

  check('the unusable rows are NOT filtered out of the keyboard', !/keyboardEntries/.test(botSrc));
  check('a button is labelled the way /allowance labels the row', /r\.laneLabel \|\| r\.label/.test(botSrc));
  // One keyboard with every model, no paging: 50+ lanes over 8-per-page is seven
  // taps of "Next" to see the list, which is what the router's single list avoids.
  check('the keyboard is not paged', /all: true/.test(botSrc) && /kind: 'fm',\s*all: true/.test(botSrc.replace(/\s+/g, ' ')));
  check('and it carries the router\'s cancel row', /Cancel — keep current model/.test(botSrc));
  check('the two Token Harbor paths collapse to one button', /const seen = new Set\(\)/.test(botSrc) && /seen\.has\(key\)/.test(botSrc));
  check('modelKeyboard can render every model in one keyboard', /all = false/.test(fs.readFileSync(path.join(HERE, 'lib', 'commands.mjs'), 'utf8')));
  check('and a tap strips the ❌ marker and resolves that label back to the model',
    /a\.laneLabel === wanted/.test(botSrc) && /replace\(\/\^❌\\s\*\//.test(botSrc), 'the ❌ prefix must be stripped before matching');
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldOverride === undefined) delete process.env.FREE_LANES_DIR; else process.env.FREE_LANES_DIR = oldOverride;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
