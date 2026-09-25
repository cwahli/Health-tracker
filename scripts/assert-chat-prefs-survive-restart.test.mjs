// Found during the card 1 live proof, not part of R-14.1: a chat's stored model
// was ignored after every service restart, because JSON keys are strings and
// the lookup used the numeric chat id. The chat silently ran the bot default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}

console.log('assert-chat-prefs-survive-restart:');

const CHAT = 6218257274;

// The shape that broke it: a map rebuilt from a JSON file, keyed by strings.
const fromDisk = new Map(Object.entries({ [String(CHAT)]: { model: 'cline:cline-free/deepseek-v4.1-flash' } }));
check('the old lookup misses after a restart', fromDisk.get(CHAT) === undefined);

const src = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
check('a numeric-or-string lookup helper exists', /function prefFor\(prefs, chatId\)[\s\S]{0,200}prefs\.get\(String\(chatId\)\)/.test(src));
check('effective() uses the helper', /const p = prefFor\(prefs, chatId\)/.test(src));
check('no raw prefs.get(chatId) call sites remain', (src.match(/prefs\.get\(chatId\)/g) || []).length === 1);
check('setters go through one helper', /function setPref\(prefs, chatId, patch\)/.test(src));
check('the setter removes the duplicate key', /String\(key\) === String\(chatId\)\) prefs\.delete\(key\)/.test(src));
const setters = (src.match(/prefs\.set\(chatId,/g) || []).length;
check(`only the helper writes a chat row (${setters} site)`, setters === 1);

// Behaviour, using the same helper shape the file now has.
const prefFor = (prefs, chatId) => (prefs.get(chatId) || prefs.get(String(chatId)) || {});
const setPref = (prefs, chatId, patch) => {
  const next = { ...prefFor(prefs, chatId), ...patch };
  for (const key of [...prefs.keys()]) if (String(key) === String(chatId)) prefs.delete(key);
  prefs.set(chatId, next);
  return next;
};
const m = new Map(Object.entries({ [String(CHAT)]: { model: 'cline:cline-free/deepseek-v4.1-flash' } }));
check('the helper finds the stored model after a restart', prefFor(m, CHAT).model === 'cline:cline-free/deepseek-v4.1-flash');
setPref(m, CHAT, { variant: 'max' });
check('a write does not fork the row into two keys', m.size === 1);
check('the write merges instead of replacing', prefFor(m, CHAT).model === 'cline:cline-free/deepseek-v4.1-flash' && prefFor(m, CHAT).variant === 'max');
const roundTrip = new Map(Object.entries(Object.fromEntries(m)));
check('and it still reads back after the next restart', prefFor(roundTrip, CHAT).variant === 'max');

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
