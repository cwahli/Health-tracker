#!/usr/bin/env node
// finish-watch sensor: a run the bot did not start is forwarded once; a run
// the bot did is never forwarded, even across the lease-removal race.
//
// Run: node scripts/assert-finish-forward.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FINISH_WATCH_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-watch-'));
process.on('exit', () => {
  try { fs.rmSync(process.env.FINISH_WATCH_STATE, { recursive: true, force: true }); } catch {}
});

const mod = await import('./finish-watch.mjs');
const { pollOnce, assistantTextOf, splitNewMessages, leaseBusySessions } = mod;

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const A = (id, text, completed = true) => ({
  id, type: 'assistant',
  time: completed ? { created: 1, completed: 2 } : { created: 1 },
  content: [{ type: 'text', text }],
});
const U = (id) => ({ id, type: 'user', time: { created: 1 }, content: [] });

// Pure units.
check('streaming fragments wait (no completed stamp)',
  assistantTextOf(A('a', 'hi', false)) === '');
check('tool-only assistant messages carry nothing',
  assistantTextOf({ id: 't', type: 'assistant', time: { completed: 1 }, content: [{ type: 'tool', output: 'x' }] }) === '');
check('non-assistant messages carry nothing', assistantTextOf(U('u')) === '');
check('first sighting consumes history without delivering', (() => {
  const r = splitNewMessages([A('m2', 'two'), A('m1', 'one')], null);
  return r.forward.length === 0 && r.consumeTo === 'm2';
})());
check('only messages after the watermark deliver', (() => {
  const r = splitNewMessages([A('m3', 'three'), A('m2', 'two'), A('m1', 'one')], 'm1');
  return r.forward.map((m) => m.id).join(',') === 'm2,m3' && r.consumeTo === 'm3';
})());
check('busy sessions derive from leases via the chat map', (() => {
  const busy = leaseBusySessions({ 7: {} }, { 7: 'ses_x', 8: 'ses_y' });
  return busy.has('ses_x') && !busy.has('ses_y');
})());

// Full rounds against fixtures on disk (sessions/prefs/leases), stub transport.
const botDir = path.join(process.env.FINISH_WATCH_STATE, 'vm9');
fs.mkdirSync(botDir, { recursive: true });
const writeState = (sessions, prefs, leases) => {
  fs.writeFileSync(path.join(botDir, 'sessions.json'), JSON.stringify(sessions));
  fs.writeFileSync(path.join(botDir, 'prefs.json'), JSON.stringify(prefs));
  fs.writeFileSync(path.join(botDir, 'leases.json'), JSON.stringify(leases));
};
const sent = [];
const store = { v: 1, byBot: {} };
const msgs = { ses_web: [A('w2', 'web answer'), A('w1', 'old')], ses_bot: [A('b1', 'bot answer')] };
const run = (extra = {}) => pollOnce({
  bots: ['vm9'],
  getMessages: async (sid) => {
    if (store.failServe) throw new Error('serve down');
    return msgs[sid] || [];
  },
  getTitle: async () => 'T',
  send: async (botId, chatId, text) => { sent.push({ botId, chatId, text }); },
  watermarks: store,
  persist: false,
  ...extra,
});

// 1. Web answer on an idle chat delivers once, then never again.
writeState({ 1: 'ws\0ses_web' }, {}, {});
sent.length = 0;
await run(); // first sighting: consume history, deliver nothing
check('first sighting delivers nothing', sent.length === 0);
msgs.ses_web = [A('w3', 'web answer new'), A('w2', 'web answer'), A('w1', 'old')];
await run();
check('a foreign answer delivers', sent.length === 1 && sent[0].text.includes('web answer new'));
await run();
check('the same answer never delivers twice', sent.length === 1);

// 2. A bot-busy chat consumes instead of delivering (ses_web watermark
// carries over from case 1; ses_bot is busy with a fresh bot answer).
writeState({ 1: 'ws\0ses_web', 2: 'ws\0ses_bot' }, {}, { 2: { chatId: 2 } });
sent.length = 0;
await run();
check('a bot-busy session is consumed, not delivered', sent.length === 0);

// 3. The lease-removal race: lease just gone, bot answer freshly committed.
store.byBot = { vm9: { ses_bot: { id: null, busyAt: Date.now() } } };
writeState({ 2: 'ws\0ses_bot' }, {}, {});
sent.length = 0;
msgs.ses_bot = [A('b1', 'bot answer')];
await run();
check('a bot answer in the settle window is consumed, not echoed', sent.length === 0);

// 4. Opt-out is honored.
writeState({ 1: 'ws\0ses_web' }, { 1: { notify: false } }, {});
sent.length = 0;
store.byBot = {};
await run();
check('/notify off silences the chat', sent.length === 0);

// 5. Serve hiccup leaves the watermark alone.
writeState({ 1: 'ws\0ses_web' }, {}, {});
store.byBot = {};
store.failServe = true;
sent.length = 0;
await run();
check('a serve failure delivers nothing and keeps no watermark',
  sent.length === 0 && !store.byBot.vm9?.ses_web);
delete store.failServe;

// 6. Settle: a session still talking holds delivery but baselines; when
// quiet it delivers the latest only, collapsing rapid-fire chatter to one.
const nowish = Date.now();
const R = (id, text, at) => ({ id, type: 'assistant', time: { created: at, completed: at }, content: [{ type: 'text', text }] });
writeState({ 1: 'ws\0ses_web' }, {}, {});
store.byBot = {};
msgs.ses_web = [R('r2', 'second', nowish), R('r1', 'first', nowish - 1000)];
sent.length = 0;
await run();
check('an unsettled session delivers nothing yet', sent.length === 0);
msgs.ses_web = [R('r3', 'third', nowish - 200000), R('r2', 'second', nowish - 201000), R('r1', 'first', nowish - 202000)];
await run();
check('a settled session delivers the latest only',
  sent.length === 1 && sent[0].text.includes('third') && !sent[0].text.includes('second'));
await run();
check('the collapsed delivery never repeats', sent.length === 1);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
