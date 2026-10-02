/**
 * Chiwah LTD tax turns inside a Telegram supergroup.
 *
 * Same two ways in as the health seats, and neither is a slash command:
 *   @accountant <question>   — only the bot that owns that seat answers.
 *   @verifier <question>     — only the checker answers.
 *   <question to the room>   — the desk runs the accountant, then the verifier,
 *                              and posts one message. The other bots stay quiet.
 *
 * The books are not filing-ready. The reply quotes results/*.json and the
 * period table. It does not ask a model to invent a tax figure.
 *
 * Any real question is answered in one reply: the room IS the tax group, so a
 * short question with no keyword still counts. The accountant's facts and the
 * verifier's check are worked into that one answer in a single voice — never
 * one numbered paragraph per seat. Acknowledgements stay quiet.
 *
 * A bot only hears a bare room question when it is an admin in the supergroup
 * (or its privacy mode is off). A seat mention still arrives either way.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const TAX_SEAT_ORDER = [
  { id: 'tax_accountant', name: 'Tax Accountant' },
  { id: 'tax_verifier', name: 'Tax Verifier' },
];

export const TAX_SEAT_IDS = TAX_SEAT_ORDER.map((s) => s.id);

export const TAX_PROJECT_ID = 'chiwah-tax';

const GROUP_FILE = 'telegram-group.json';
const ACK = /^(thanks|thank you|thx|ty|ok|okay|k|hi|hello|hey|yo|yes|yeah|no|nope|cool|nice|great|cheers)[.!\s]*$/i;

export function taxRoleOf(bot) {
  return String(bot?.agent?.taxRole || bot?.taxRole || '').trim();
}

/** Tax seats owned by an enabled bot. The desk adopts any seat not in this list. */
export function dedicatedTaxRoleIds(bots) {
  const ids = [];
  for (const bot of bots || []) {
    if (bot?.enabled === false) continue;
    const role = taxRoleOf(bot);
    if (TAX_SEAT_IDS.includes(role) && !ids.includes(role)) ids.push(role);
  }
  return ids;
}

/**
 * Who posts the room's one answer. The accountant is the desk when that bot
 * is enabled. Until then the registry master (vm) adopts the desk.
 */
export function taxDeskBotId(bots, masterId = 'vm') {
  for (const bot of bots || []) {
    if (bot?.enabled === false) continue;
    if (bot?.id === 'tax_accountant' || taxRoleOf(bot) === 'tax_accountant') return bot.id;
  }
  return masterId;
}

export function isTaxAsk(text) {
  const t = plainQuestion(text);
  if (!t || ACK.test(t)) return false;
  if (t.length < 2 || !/[\p{L}\p{N}]/u.test(t)) return false;
  return true;
}

function plainQuestion(question) {
  return String(question || '')
    .replace(/(^|\s)@[A-Za-z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyTaxGroupTurn({ kind, addr, text, projectId, taxChat, isDesk } = {}) {
  if (kind !== 'group' || !addr?.addressed) return null;
  const question = String(text || '').trim();
  const seat = TAX_SEAT_IDS.includes(addr.roleId) ? addr.roleId : null;
  if (seat && !addr.isBroadcast) {
    if (!isTaxAsk(question)) return { mode: 'skip' };
    return { mode: 'seat', roleId: seat, question };
  }
  const home = Boolean(taxChat) || projectId === TAX_PROJECT_ID;
  if (addr.isBroadcast && home && isDesk) {
    if (!isTaxAsk(question)) return { mode: 'skip' };
    return { mode: 'council', roleId: null, question };
  }
  return null;
}

function groupPath(workspace) {
  return path.join(String(workspace || ''), GROUP_FILE);
}

export function readTaxGroupIds(workspace) {
  try {
    const data = JSON.parse(fs.readFileSync(groupPath(workspace), 'utf8'));
    const ids = Array.isArray(data?.chatIds) ? data.chatIds : [];
    return ids.map((id) => String(id));
  } catch {
    return [];
  }
}

export function isTaxGroupChat(workspace, chatId) {
  if (chatId == null || chatId === '') return false;
  return readTaxGroupIds(workspace).includes(String(chatId));
}

export function rememberTaxGroup(workspace, chatId) {
  if (!workspace || chatId == null || chatId === '') return;
  const id = String(chatId);
  const ids = readTaxGroupIds(workspace);
  if (ids.includes(id)) return;
  const file = groupPath(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ chatIds: [...ids, id] }, null, 2)}\n`);
}

export function forgetTaxGroup(workspace, chatId) {
  if (!workspace || chatId == null) return;
  const id = String(chatId);
  const ids = readTaxGroupIds(workspace).filter((item) => item !== id);
  const file = groupPath(workspace);
  if (!fs.existsSync(file)) return;
  fs.writeFileSync(file, `${JSON.stringify({ chatIds: ids }, null, 2)}\n`);
}

function dec(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function money(value) {
  const n = dec(value);
  if (n == null) return String(value ?? '');
  const sign = n < 0 ? '-' : '';
  return `${sign}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function periodTable(workspace) {
  try {
    const out = execFileSync('python3', ['-c', [
      'import json, sys',
      'sys.path.insert(0, "src")',
      'from chiwah_tax.rates import build_periods',
      'rows = []',
      'for p in build_periods():',
      '    rows.append({"label": p.label, "days": (p.end - p.start).days + 1, "rates": [str(s.rate) for s in p.ct_segments]})',
      'print(json.dumps(rows))',
    ].join('\n')], { cwd: workspace, encoding: 'utf8', timeout: 20000 });
    const rows = JSON.parse(out);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Facts the reply is allowed to quote. Missing files stay missing. */
export function readTaxSnapshot(workspace) {
  const root = String(workspace || '');
  const engine = loadJson(path.join(root, 'results', 'engine_results.json'));
  const postings = loadJson(path.join(root, 'results', 'postings.json'));
  const variance = loadJson(path.join(root, 'results', 'variance.json'));
  if (!engine?.periods) return null;
  const byLabel = new Map(periodTable(root).map((row) => [row.label, row]));
  const periods = engine.periods.map((row) => {
    const meta = byLabel.get(row.period) || {};
    return {
      label: row.period,
      days: meta.days || null,
      rates: meta.rates || [],
      chargeable: row.chargeable,
      tax: row.tax_due,
      rate: row.rate,
    };
  });
  let p2p = 0;
  let suspense = 0;
  let sawPostings = false;
  for (const posting of Array.isArray(postings) ? postings : []) {
    sawPostings = true;
    const amount = dec(posting.amount) || 0;
    if (posting.account === '4020') p2p += amount;
    if (posting.account === '9000') suspense += amount;
  }
  const filed = [];
  for (const row of Array.isArray(variance) ? variance : []) {
    if (!row.filed_tax || row.filed_tax === '?') continue;
    filed.push({
      period: row.period,
      filedTax: row.filed_tax,
      engineTax: row.engine_tax,
      filedTurnover: row.filed_turnover,
      engineChargeable: row.engine_chargeable,
    });
  }
  return {
    periods,
    overlong: periods.filter((row) => row.days && row.days > 366),
    flatYears: periods.filter((row) => row.rates.includes('0.25') || row.rate === '25%').map((row) => row.label),
    p2pIncome: sawPostings ? p2p.toFixed(2) : null,
    suspense: sawPostings ? suspense.toFixed(2) : null,
    filed,
  };
}

function askedLine(question) {
  const t = String(question || '').replace(/\s+/g, ' ').trim();
  return t ? `You asked: ${t.slice(0, 240)}\n\n` : '';
}

function firstRepair(snapshot) {
  const long = snapshot.overlong?.[0];
  if (long) {
    return `The first repair is the ${long.label} accounting period: it is ${long.days} days, and a corporation-tax period cannot be longer than 12 months.`;
  }
  if (snapshot.suspense && Math.abs(Number(snapshot.suspense)) >= 1) {
    return `The first repair is suspense account 9000, which still nets to ${money(snapshot.suspense)}.`;
  }
  return 'The first repair is the open filing decisions (FRS 105 or FRS 102, and the accounts pack). There is no iXBRL file yet.';
}

function accountantText(snapshot, question) {
  const lines = [askedLine(question) + firstRepair(snapshot)];
  const long = snapshot.overlong?.[0];
  if (long) {
    const row = snapshot.periods.find((item) => item.label === long.label);
    lines.push(`Engine chargeable profit for ${long.label} is ${money(row?.chargeable)} at ${row?.rate || 'the rate on that period'}. That period cannot be filed as one CT600.`);
  }
  if (snapshot.flatYears?.length) {
    lines.push(`From ${snapshot.flatYears[0]} the engine applies a flat 25% (${snapshot.flatYears.join(', ')}). The £50,000 small-profits line and marginal relief are not applied.`);
  }
  if (snapshot.p2pIncome != null) {
    lines.push(`P2P interest income (account 4020) is ${money(snapshot.p2pIncome)}. Inflows tagged as P2P interest were credited to the loan, not to income.`);
  }
  lines.push('Numbers are copied from results/*.json. I did not compute a new tax figure in this chat.');
  return lines.join('\n');
}

function verifierText(snapshot, question) {
  const lines = [askedLine(question) + 'I checked the same files and I did not change one. A verifier that edits can hide a miss.'];
  if (snapshot.suspense != null) {
    lines.push(`Suspense 9000 nets to ${money(snapshot.suspense)}. That is not a cleared transfer.`);
  }
  if (snapshot.filed?.length) {
    const row = snapshot.filed[0];
    lines.push(`For ${row.period} the filed tax is ${money(row.filedTax)} and the engine tax in the variance file is ${money(row.engineTax)}. Those are not the same figure, so I will not sign a filing pack.`);
  } else {
    lines.push('No filed-tax comparison is in the variance file, so nothing here is ready for Companies House.');
  }
  lines.push('D8 is still open: FRS 105 or FRS 102 Section 1A. There is no accounts pack to file.');
  return lines.join('\n');
}

function taxAskKind(question) {
  const t = plainQuestion(question);
  if (/\bhow\b|\bsteps\b|\bwhere do i\b|\bwhat do i\b/i.test(t)) return 'how';
  if (/\b(fix|clean|repair|correct|edit)\b/i.test(t)) return 'fix';
  if (/\b(list|every period|all periods|show the periods|what(?:'s| is) open)\b/i.test(t)) return 'list';
  return 'status';
}

function periodListText(snapshot) {
  return snapshot.periods.map((row) => `- ${row.label}: chargeable ${money(row.chargeable)}, tax ${money(row.tax)} at ${row.rate || 'the rate on that period'}`).join('\n');
}

function accountantFacts(snapshot) {
  const lines = [];
  const long = snapshot.overlong?.[0];
  if (long) {
    const row = snapshot.periods.find((item) => item.label === long.label);
    lines.push(`Engine chargeable profit for ${long.label} is ${money(row?.chargeable)} at ${row?.rate || 'the rate on that period'}. That period cannot be filed as one CT600.`);
  }
  if (snapshot.flatYears?.length) {
    lines.push(`From ${snapshot.flatYears[0]} the engine applies a flat 25% (${snapshot.flatYears.join(', ')}). The £50,000 small-profits line and marginal relief are not applied.`);
  }
  if (snapshot.p2pIncome != null) {
    lines.push(`P2P interest income (account 4020) is ${money(snapshot.p2pIncome)}. Inflows tagged as P2P interest were credited to the loan, not to income.`);
  }
  return lines.join('\n');
}

function verifierCheck(snapshot) {
  const lines = ['The verifier re-read the same files and changed none of them — a checker that edits can hide a miss.'];
  if (snapshot.suspense != null) {
    lines.push(`Suspense 9000 nets to ${money(snapshot.suspense)}. That is not a cleared transfer.`);
  }
  if (snapshot.filed?.length) {
    const row = snapshot.filed[0];
    lines.push(`For ${row.period} the filed tax is ${money(row.filedTax)} and the engine tax in the variance file is ${money(row.engineTax)}. Those are not the same figure, so nothing here is signed for filing.`);
  } else {
    lines.push('No filed-tax comparison is in the variance file, so nothing here is ready for Companies House.');
  }
  lines.push('D8 is still open: FRS 105 or FRS 102 Section 1A. There is no accounts pack to file.');
  return lines.join('\n');
}

/**
 * The group reply. Always from the snapshot. `null` snapshot refuses
 * instead of guessing a number. The room gets one joint answer in a single
 * voice: the accountant's facts with the verifier's check worked in, never
 * one numbered paragraph per seat.
 */
export function formatTaxGroupReply({ mode, roleId, question, snapshot } = {}) {
  if (!snapshot?.periods?.length) {
    const asked = askedLine(question);
    return `${asked}I can't see engine results in the tax workspace, so I won't guess a profit, a tax bill, or a filing. Run tools/build.py, then ask again.`;
  }
  if (mode === 'council') {
    const kind = taxAskKind(question);
    const lead = `${askedLine(question)}The Companies House filing is not ready. ${firstRepair(snapshot)} The accountant and the verifier looked at the same results, and this is the only reply.`;
    if (kind === 'list') {
      return ['One answer', '', lead, '', periodListText(snapshot)].join('\n');
    }
    if (kind === 'fix' || kind === 'how') {
      return ['One answer', '', `${lead} Fix it in the books, rebuild, then ask again.`, '', verifierCheck(snapshot)].join('\n');
    }
    const facts = accountantFacts(snapshot);
    return ['One answer', '', lead, '', facts, '', verifierCheck(snapshot), '', 'Numbers are copied from results/*.json. Nothing new was computed in this chat.'].filter((part) => part !== '').join('\n');
  }
  const seat = TAX_SEAT_ORDER.find((item) => item.id === roleId) || TAX_SEAT_ORDER[0];
  const body = seat.id === 'tax_verifier'
    ? verifierText(snapshot, question)
    : accountantText(snapshot, question);
  return [seat.name, '', body].join('\n');
}

export function answerTaxGroup({ mode, roleId, question, workspace, snapshot } = {}) {
  const loaded = snapshot !== undefined ? snapshot : readTaxSnapshot(workspace);
  return {
    answered: true,
    usedModel: false,
    text: formatTaxGroupReply({ mode, roleId, question, snapshot: loaded }),
  };
}
