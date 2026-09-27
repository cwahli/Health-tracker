// The TUI gateway is the only door to a public PTY, so its auth is a sensor,
// not a comment. Every case here is one a real attacker would try.
//
// Run: node scripts/assert-tui-gateway.test.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { validateInitData, issueToken, verifyToken, tokenFor } from './tui-gateway.mjs';

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
};

const TOKEN = '123456:TEST-TOKEN-NOT-REAL';
const SECRET = 'server-secret-for-tests';

/**
 * Build initData the way Telegram does.
 *
 * The wire form is percent-encoded `k=v` joined by `&`. The signed
 * `data_check_string` is the DECODED pairs sorted by key and joined by "\n".
 * Building one from the other by hand is easy to get backwards, and a helper
 * that is wrong makes every "valid" case fail for the wrong reason.
 */
function makeInitData(fields, { secretKey = null, hash = null } = {}) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const wire = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`).join('&');
  const key = secretKey || crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const h = hash || crypto.createHmac('sha256', key).update(dataCheckString).digest('hex');
  return `${wire}&hash=${h}`;
}

const now = Date.now();
const fresh = (extra = {}) => ({
  auth_date: String(Math.floor(now / 1000)),
  query_id: 'AAH_test',
  user: JSON.stringify({ id: 6218257274, first_name: 'Cwah' }),
  ...extra,
});

console.log('assert-tui-gateway:');

// 1. A well-formed initData signed with this bot's token is admitted.
{
  const v = validateInitData(makeInitData(fresh()), TOKEN, { now });
  check('valid initData is admitted', v.ok === true);
  check('the chat is bound from the user', v.chatId === 6218257274);
}

// 2. A different bot's token must not open this bot.
{
  const init = makeInitData(fresh());
  const v = validateInitData(init, '999:OTHER-BOT-TOKEN', { now });
  check('another bot token is refused', v.ok === false);
  check('the refusal says the hash did not match', /hash mismatch/.test(v.reason));
}

// 3. A tampered field invalidates the signature.
{
  const init = makeInitData(fresh());
  const tampered = init.replace('6218257274', '9999999999');
  const v = validateInitData(tampered, TOKEN, { now });
  check('a tampered user id is refused', v.ok === false);
}

// 4. Replay: the same string an hour later is refused.
{
  const init = makeInitData(fresh({ auth_date: String(Math.floor(now / 1000) - 3600) }));
  check('an hour-old initData is refused', validateInitData(init, TOKEN, { now }).ok === false);
}

// 5. Clock skew is allowed forward, refused far forward.
{
  const ahead = makeInitData(fresh({ auth_date: String(Math.floor(now / 1000) + 30) }));
  check('30s of forward skew is allowed', validateInitData(ahead, TOKEN, { now }).ok === true);
  const way = makeInitData(fresh({ auth_date: String(Math.floor(now / 1000) + 600) }));
  check('10 minutes of forward skew is refused', validateInitData(way, TOKEN, { now }).ok === false);
}

// 6. Missing pieces are refused rather than crashing.
{
  check('empty initData is refused', validateInitData('', TOKEN, { now }).ok === false);
  check('a missing token is refused', validateInitData(makeInitData(fresh()), '', { now }).ok === false);
  check('initData with no hash is refused', validateInitData('auth_date=1&user=%7B%7D', TOKEN, { now }).ok === false);
  check('a non-numeric auth_date is refused',
    validateInitData(makeInitData(fresh({ auth_date: 'soon' })), TOKEN, { now }).ok === false);
}

// 7. Session tokens: signature, binding, expiry.
{
  const t = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900, now });
  const v = verifyToken(t, SECRET, { now });
  check('a fresh session token verifies', v.ok === true);
  check('it is bound to the bot', v.botId === 'vm');
  check('it is bound to the chat', v.chatId === '6218257274');
  check('a token signed with another secret is refused',
    verifyToken(t, 'other-secret', { now }).ok === false);
  check('an expired token is refused',
    verifyToken(issueToken({ botId: 'vm', chatId: '1', secret: SECRET, ttlSec: 1, now: now - 5000 }), SECRET, { now }).ok === false);
  check('a tampered token is refused', verifyToken(`${t}x`, SECRET, { now }).ok === false);
  check('garbage is refused, not thrown on', verifyToken('nonsense', SECRET, { now }).ok === false);
  check('an empty token is refused', verifyToken('', SECRET, { now }).ok === false);
}

// 8. A token minted for one chat must not open another. The signature covers
//    the chat, so re-pointing the body breaks it.
{
  const t = issueToken({ botId: 'vm', chatId: '6218257274', secret: SECRET, ttlSec: 900, now });
  const [body, mac] = t.split('.');
  const swapped = Buffer.from('vm|9999999999|' + body.split('|')[2] + '|' + body.split('|')[3]).toString('base64url');
  check('a token re-pointed at another chat is refused',
    verifyToken(`${swapped}.${mac}`, SECRET, { now }).ok === false);
}

// 9. The per-bot token lookup must not fall through to a shared token.
{
  const env = { TUI_BOT_TOKEN_VM: 'vm-token', TUI_BOT_TOKEN: 'shared' };
  check('a per-bot token is preferred', tokenFor('vm', env) === 'vm-token');
  check('an unlisted bot falls back to the shared token', tokenFor('other', env) === 'shared');
  check('a bot id with punctuation still maps', tokenFor('vm2', { TUI_BOT_TOKEN_VM2: 'x' }) === 'x');
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
