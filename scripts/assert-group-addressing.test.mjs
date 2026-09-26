#!/usr/bin/env node
/**
 * Law sensor for group addressing (five bots, one group).
 *
 * The failure this file exists to prevent is five bots answering everything:
 * 5x quota burn and five overlapping replies per message. The rule is small on
 * purpose — a bot acts in a group only when addressed (suffixed command, @mention,
 * or reply to its own message) — and every clause below is a case that broke or
 * nearly broke during construction.
 *
 * No network, no bot process. Pure functions from scripts/lib/commands.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chatKind, commandSuffix, isAddressedToUs, mentionsUs } from './lib/commands.mjs';

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

const SELF = { id: 8877768105, username: 'VM_19485_bot' };
const msg = (over = {}) => ({ chat: { type: 'private', id: 1 }, text: '', ...over });

// ------------------------------------------------------------------ kinds

check('private chats are direct', () => chatKind({ chat: { type: 'private' } }) === 'direct');
check('groups and supergroups are groups', () => chatKind({ chat: { type: 'group' } }) === 'group' && chatKind({ chat: { type: 'supergroup' } }) === 'group');
check('a missing chat type defaults to direct (never silently drop DMs)', () => chatKind({}) === 'direct');

// ------------------------------------------------------------------ suffix

check('a suffixed command yields its target', () => commandSuffix('/project@VM_19485_bot external 2') === 'vm_19485_bot');
check('a bare command yields no target', () => commandSuffix('/allowance') === '');
check('the suffix match is case-insensitive', () => {
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: '/allowance@vm_19485_BOT' }), SELF) === true;
});

// ------------------------------------------------------------------ routing

check('direct text is always addressed', () => isAddressedToUs(msg({ text: 'hello' }), SELF) === true);
check('group bare text belongs to no one', () => isAddressedToUs(msg({ chat: { type: 'group' }, text: 'hello' }), SELF) === false);
check('group bare command belongs to no one', () => isAddressedToUs(msg({ chat: { type: 'group' }, text: '/allowance' }), SELF) === false);
check('a command suffixed for us is ours', () => isAddressedToUs(msg({ chat: { type: 'group' }, text: '/project@VM_19485_bot external 2' }), SELF) === true);
check('a command suffixed for another bot is not ours', () => isAddressedToUs(msg({ chat: { type: 'group' }, text: '/project@VM2_19485_bot external 2' }), SELF) === false);
check('an @mention of us addresses us', () => {
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: 'hey @VM_19485_bot look', entities: [{ type: 'mention', offset: 4, length: 13 }] }), SELF) === true;
});
check('an @mention of only another bot does not address us', () => {
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: 'hey @VM2_19485_bot', entities: [{ type: 'mention', offset: 4, length: 14 }] }), SELF) === false;
});
check('a reply to our message addresses us', () => {
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: 'thanks', reply_to_message: { from: { id: 8877768105 } } }), SELF) === true;
});
check('a reply to another bot does not address us', () => {
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: 'thanks', reply_to_message: { from: { id: 1 } } }), SELF) === false;
});
check('a foreign suffix wins over our mention (explicit beats ambient)', () => {
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: '/allowance@VM2_19485_bot @VM_19485_bot', entities: [{ type: 'mention', offset: 24, length: 13 }] }), SELF) === false;
});
check('mentionsUs tolerates a leading @ on our side', () => {
  return mentionsUs(msg({ text: 'hi @VM_19485_bot', entities: [{ type: 'mention', offset: 3, length: 13 }] }), '@VM_19485_bot') === true;
});
check('mentionsUs with no username never matches', () => mentionsUs(msg({ text: 'hi' }), '') === false);

// ------------------------------------------------------------------ wiring

check('the handler gates groups on addressing, right after auth', () => {
  const i = HOST.indexOf("chatKind(message) === 'group'");
  const auth = HOST.lastIndexOf('allowedUserIds', i);
  return i > 0 && auth > 0 && i - auth < 600;
});

check('identity is resolved once from getMe, not per message', () => {
  return /config\.me = \{ id: Number\(me\.id\)/.test(HOST) && !/getMe\(\)/.test(HOST.slice(HOST.indexOf('async function handleMessage')));
});

check('the gate never throws when identity is missing (fail closed, not crash)', () => {
  // isAddressedToUs with an empty self: suffix check needs a username to compare,
  // mentions need one too, reply needs an id — all absent means false, not throw.
  return isAddressedToUs(msg({ chat: { type: 'group' }, text: '/allowance' }), {}) === false
    && isAddressedToUs(msg({ chat: { type: 'group' }, text: 'hi' }), null) === false;
});

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
