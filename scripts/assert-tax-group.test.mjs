#!/usr/bin/env node
/**
 * The two supergroup scenarios for the tax seats. Same rule as the health
 * seats: no slash command.
 *
 * 1. "@accountant …" is answered by the bot that owns that seat. The desk
 *    adopts the seat when no enabled bot owns it. Everyone else stays quiet.
 * 2. "is there anything I need to improve?" in the tax supergroup is the
 *    desk's turn. The reply is one message, accountant then verifier.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractRoleMention, resolveGroupAddressing } from './lib/commands.mjs';
import { classifyHealthGroupTurn } from './lib/health-group.mjs';
import { loadRegistry, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  TAX_SEAT_IDS,
  answerTaxGroup,
  classifyTaxGroupTurn,
  dedicatedTaxRoleIds,
  forgetTaxGroup,
  formatTaxGroupReply,
  isTaxAsk,
  isTaxGroupChat,
  readTaxSnapshot,
  rememberTaxGroup,
  taxDeskBotId,
} from './lib/tax-group.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const group = (text) => ({ chat: { type: 'supergroup', id: -100999 }, text });
const accountantQuery = '@accountant is the 2015-16 period too long to file at companies house?';
const roomQuery = 'is there anything I need to improve?';

const reg = loadRegistry(resolveRegistryPath(null, path.resolve(HERE, '..')));
const dedicated = [
  ...reg.bots.filter((b) => b.enabled !== false && b.agent?.healthRole).map((b) => b.agent.healthRole),
  ...dedicatedTaxRoleIds(reg.bots),
];
const vm = reg.bots.find((b) => b.id === 'vm');
const planner = reg.bots.find((b) => b.agent?.healthRole === 'test_planner');
const seatOpts = (bot, extra = {}) => ({
  role: bot.agent?.taxRole || bot.agent?.healthRole || '',
  roles: [bot.agent?.healthRole, bot.agent?.taxRole].filter(Boolean),
  name: bot.name,
  isMaster: bot.id === reg.master || bot.id === 'tax_accountant',
  allowGroupBroadcast: true,
  hasDedicatedRoleBots: dedicated.length > 0,
  dedicatedRoleIds: dedicated,
  ...extra,
});

check('the tax seats are accountant then verifier', TAX_SEAT_IDS.join(',') === 'tax_accountant,tax_verifier');
check('the disabled tax bots are not dedicated seats yet', dedicatedTaxRoleIds(reg.bots).length === 0);
check('while those bots are off, vm is the desk', taxDeskBotId(reg.bots) === 'vm');

const mentioned = extractRoleMention(accountantQuery);
check('scenario 1 reads @accountant as the tax accountant', mentioned?.roleId === 'tax_accountant');
check('scenario 1 drops the mention from the question', mentioned?.cleanText.startsWith('is the 2015-16 period'));

const accountantMsg = group(accountantQuery);
const forVm = resolveGroupAddressing(accountantMsg, { id: 10, username: 'VM_19485_bot' }, seatOpts(vm));
const forPlanner = resolveGroupAddressing(accountantMsg, { id: 11, username: 'opencode_bot' }, seatOpts(planner));
check('scenario 1: the desk adopts @accountant when nobody owns it', forVm.addressed === true && forVm.roleId === 'tax_accountant');
check('scenario 1: the test planner stays quiet', forPlanner.addressed === false);

const owned = reg.bots.map((b) => (
  b.id === 'tax_accountant' || b.id === 'tax_verifier' ? { ...b, enabled: true } : b
));
const ownedIds = [
  ...owned.filter((b) => b.enabled !== false && b.agent?.healthRole).map((b) => b.agent.healthRole),
  ...dedicatedTaxRoleIds(owned),
];
const accountant = owned.find((b) => b.id === 'tax_accountant');
const ownedOpts = { ...seatOpts(vm), dedicatedRoleIds: ownedIds, hasDedicatedRoleBots: true, isMaster: true };
const ownedAccountant = resolveGroupAddressing(
  accountantMsg,
  { id: 21, username: 'tax_accountant_bot' },
  { ...seatOpts(accountant), isMaster: true, dedicatedRoleIds: ownedIds },
);
const ownedVm = resolveGroupAddressing(accountantMsg, { id: 10, username: 'VM_19485_bot' }, ownedOpts);
check('an enabled accountant bot takes @accountant', ownedAccountant.addressed === true && ownedAccountant.roleId === 'tax_accountant');
check('the coordinator stays quiet once the accountant owns the seat', ownedVm.addressed === false);

const verifierQuery = group('@verifier do the filed accounts match the engine?');
const forVerifier = resolveGroupAddressing(
  verifierQuery,
  { id: 22, username: 'tax_verifier_bot' },
  { role: 'tax_verifier', name: 'Tax Verifier', isMaster: false, dedicatedRoleIds: ownedIds, allowGroupBroadcast: true },
);
const verifierForAccountant = resolveGroupAddressing(
  verifierQuery,
  { id: 21, username: 'tax_accountant_bot' },
  { ...seatOpts(accountant), isMaster: true, dedicatedRoleIds: ownedIds },
);
check('scenario 1: @verifier addresses the checker only', forVerifier.addressed === true && forVerifier.roleId === 'tax_verifier');
check('scenario 1: the accountant stays quiet for @verifier', verifierForAccountant.addressed === false);
const onlyMaker = reg.bots.map((b) => (b.id === 'tax_accountant' ? { ...b, enabled: true } : b));
const onlyMakerIds = [
  ...onlyMaker.filter((b) => b.enabled !== false && b.agent?.healthRole).map((b) => b.agent.healthRole),
  ...dedicatedTaxRoleIds(onlyMaker),
];
const adoptedVerifier = resolveGroupAddressing(
  verifierQuery,
  { id: 21, username: 'tax_accountant_bot' },
  { role: 'tax_accountant', name: 'Tax Accountant', isMaster: true, dedicatedRoleIds: onlyMakerIds, allowGroupBroadcast: true },
);
check('the desk adopts @verifier when that bot is not enabled', adoptedVerifier.addressed === true && adoptedVerifier.roleId === 'tax_verifier');

const room = group(roomQuery);
const roomVm = resolveGroupAddressing(room, { id: 10, username: 'VM_19485_bot' }, seatOpts(vm));
const roomPlanner = resolveGroupAddressing(room, { id: 11, username: 'opencode_bot' }, seatOpts(planner));
check('scenario 2 addresses the desk', roomVm.addressed === true && roomVm.isBroadcast === true);
check('scenario 2 leaves the planner quiet', roomPlanner.addressed === false);

const council = classifyTaxGroupTurn({
  kind: 'group', addr: roomVm, text: roomQuery, projectId: 'chiwah-tax', isDesk: true,
});
const notTax = classifyTaxGroupTurn({
  kind: 'group', addr: roomVm, text: roomQuery, projectId: 'health-tracker', isDesk: true,
});
const seat = classifyTaxGroupTurn({
  kind: 'group', addr: forVm, text: forVm.cleanText, projectId: 'health-tracker', isDesk: true,
});
const thanks = classifyTaxGroupTurn({
  kind: 'group', addr: roomVm, text: 'thanks', projectId: 'chiwah-tax', isDesk: true,
});
check('a bare question on the tax project is a council turn', council?.mode === 'council');
check('a bare question on the health project is not stolen', notTax == null);
check('a named seat is a seat turn in any project', seat?.mode === 'seat' && seat.roleId === 'tax_accountant');
check('thanks in the tax room is skipped', thanks?.mode === 'skip');
const seatThanks = classifyTaxGroupTurn({
  kind: 'group', addr: forVm, text: 'thanks', projectId: 'chiwah-tax', isDesk: true,
});
check('thanks to a named seat is skipped', seatThanks?.mode === 'skip');

const healthOnTaxChat = classifyHealthGroupTurn({
  kind: 'group', addr: roomVm, text: roomQuery, projectId: 'health-tracker', taxChat: true,
});
check('a tax supergroup does not also get the health council', healthOnTaxChat == null);

const snapshot = {
  periods: [
    { label: '2015-16', days: 370, chargeable: '59518.56', tax: '11903.71', rate: '20%', rates: ['0.20'] },
    { label: '2023-24', days: 366, chargeable: '-735.22', tax: '0', rate: '25%', rates: ['0.25'] },
  ],
  overlong: [{ label: '2015-16', days: 370 }],
  flatYears: ['2023-24'],
  p2pIncome: '0.00',
  suspense: '-1000.00',
  filed: [{ period: '2022-23', filedTax: '8636', engineTax: '8938.33' }],
};
const councilReply = formatTaxGroupReply({ mode: 'council', question: roomQuery, snapshot });
check('the council answer leads with one answer', councilReply.startsWith('One answer'), councilReply.slice(0, 180));
check('the council answer names the 370-day period', /2015-16 accounting period: it is 370 days/.test(councilReply));
check('the council answer is one voice, not one paragraph per seat', !/Seats, in order|^1\. Tax Accountant|^2\. Tax Verifier/m.test(councilReply));
check('the council answer carries both the facts and the check', /chargeable profit/.test(councilReply) && /re-read the same files/.test(councilReply));
check('the council answer does not invent a model', !/I recommend you pay|you should file £/.test(councilReply));
const listReply = formatTaxGroupReply({ mode: 'council', question: 'list every period', snapshot });
check('a list question lists the periods', /2015-16: chargeable/.test(listReply) && /2023-24: chargeable/.test(listReply));
const howReply = formatTaxGroupReply({ mode: 'council', question: 'how do I fix this', snapshot });
check('a how question says where to fix', /Fix it in the books/.test(howReply));
check('any short question is a tax ask in the tax room', isTaxAsk('status') === true && isTaxAsk('what next') === true && isTaxAsk(roomQuery) === true);
check('thanks is not a tax ask', isTaxAsk('thanks') === false);

const seatReply = formatTaxGroupReply({
  mode: 'seat', roleId: 'tax_accountant', question: forVm.cleanText, snapshot,
});
check('the accountant answers the period question from the snapshot', seatReply.startsWith('Tax Accountant') && /370 days/.test(seatReply));
check('a missing snapshot refuses', /won't guess/.test(formatTaxGroupReply({ mode: 'seat', roleId: 'tax_accountant', question: 'tax?', snapshot: null })));

const closed = answerTaxGroup({ mode: 'council', question: roomQuery, snapshot });
check('the tax reply does not call a model', closed.usedModel === false && closed.text.startsWith('One answer'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tax-group-'));
rememberTaxGroup(tmp, -100999);
check('a tax supergroup is remembered', isTaxGroupChat(tmp, '-100999'));
forgetTaxGroup(tmp, -100999);
check('a health seat mention drops the tax binding', !isTaxGroupChat(tmp, '-100999'));
fs.rmSync(tmp, { recursive: true, force: true });

const live = readTaxSnapshot(path.join(os.homedir(), 'chiwah-tax'));
check('the live books show 2015-16 as longer than 12 months', live?.overlong?.some((row) => row.label === '2015-16' && row.days > 366));

const normalized = normalizeConfig(reg.bots.find((b) => b.id === 'tax_accountant'));
check('normalizeConfig keeps the tax seat and its home project', normalized.agent.taxRole === 'tax_accountant' && normalized.agent.homeProject === 'chiwah-tax');

check('the handler classifies a tax turn', HOST.includes('classifyTaxGroupTurn'));
check('the handler answers with answerTaxGroup', HOST.includes('answerTaxGroup'));
check('the handler passes both seat lists', HOST.includes('dedicatedTaxRoleIds'));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
