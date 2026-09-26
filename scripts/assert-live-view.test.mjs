// The TG-native live work view: a remote turn used to be a black box that only
// delivered final text (the tmux pane it ran in is host-local, needs a terminal,
// and is invisible from the chat). These tests pin the three pieces that make
// it observable from the phone — the event formatter, the follow-up queue, the
// immediate headline — plus the relay live channel the whole thing rides on
// (event in, event out, /abort flag) and the /web URL handoff.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  formatLiveEvent,
  postLiveFeed,
  fetchRelayEvents,
  postRelayAbort,
  readMiniappUrl,
  watchOn,
  setWatch,
  queueFollowup,
  queuedFollowups,
  shiftFollowup,
  clearFollowups,
  awaitJobWithEventPump,
  MAX_FOLLOWUPS,
  ProgressRenderer,
} from './bot-host.mjs';
import { appendJobEvent, readJobEvents, enqueueJob, completeJob } from './lib/worker-jobs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); passed++; } else { console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('assert-live-view:');

// ---------------------------------------------------------------- formatter
// One tool call -> one short line. A tool argument is the most likely place in
// a whole run to carry a credential or a megabyte of file, so it is collapsed,
// clipped and scrubbed before it can ever reach a chat.
{
  const line = formatLiveEvent({
    kind: 'tool',
    tool: 'bash',
    status: 'running',
    input: '  grep   -rn TOKEN=supersecretvalue\n   .  ',
    output: 'src/x.ts:12\n'.repeat(400),
  });
  check('a tool event names the tool and its status', String(line).includes('🔧 bash (running)'));
  check('a tool event shows the argument', String(line).includes('in: grep -rn'));
  check('a tool argument is scrubbed', !String(line).includes('supersecretvalue'), String(line).split('\n').find((l) => l.includes('in:')));
  check('a huge tool output is clipped', String(line).length <= 1200, `${String(line).length} chars`);
}
check('a tool event with no status still renders', String(formatLiveEvent({ kind: 'tool', tool: 'read' })).includes('🔧 read'));
check('reasoning is shown in full, not the headline gist', formatLiveEvent({ kind: 'reasoning', text: 'considering the tradeoff here' }).startsWith('🧠'));
check('an empty reasoning event posts nothing', formatLiveEvent({ kind: 'reasoning', text: '   ' }) === null);
check('an error event is marked and clipped', formatLiveEvent({ kind: 'error', message: 'x'.repeat(2000) }).startsWith('❌'));
check('a step reports its token spend', formatLiveEvent({ kind: 'step_finish', tokens: 1234 }) === '▫️ step done — 1234 tokens');
check('a step without tokens posts nothing', formatLiveEvent({ kind: 'step_finish' }) === null);
check('a secret in reasoning is scrubbed', !formatLiveEvent({ kind: 'reasoning', text: 'api_key = abc123def456' }).includes('abc123def456'));
// Partial text is deliberately dropped: it accumulates into the final answer,
// which is delivered whole, so streaming it too would double-post every reply.
check('partial text is not posted twice', formatLiveEvent({ kind: 'text', text: 'here is the answer' }) === null);
check('a junk event posts nothing', formatLiveEvent({ kind: 'other', type: 'wat' }) === null && formatLiveEvent(null) === null);

// ------------------------------------------------------------------- feed
{
  const sent = [];
  const api = { sendMessage: async (chatId, text, extra) => { sent.push({ chatId, text, extra }); return { message_id: sent.length }; } };
  await postLiveFeed(api, '42', { kind: 'text', text: 'ignored' });
  check('the feed posts nothing for a partial text', sent.length === 0);
  await postLiveFeed(api, '42', { kind: 'tool', tool: 'edit', status: 'ok' });
  check('the feed posts a tool line to the chat', sent.length === 1 && sent[0].chatId === '42' && sent[0].text.includes('🔧 edit (ok)'));
  // A feed failure must never break the run it is narrating.
  const broken = { sendMessage: async () => { throw new Error('telegram 500'); } };
  let threw = false;
  try { await postLiveFeed(broken, '42', { kind: 'tool', tool: 'bash' }); } catch { threw = true; }
  check('a broken feed is silent, not fatal', !threw);
  // One event is at most one message: the formatter clips, so a runaway tool
  // output can never turn into a chat flood.
  const chunks = [];
  await postLiveFeed({ sendMessage: async (_c, text) => { chunks.push(text); return { message_id: chunks.length }; } }, '42',
    { kind: 'tool', tool: 'bash', status: 'ok', output: 'y'.repeat(3000) });
  check('a runaway tool output stays one clipped message', chunks.length === 1 && chunks[0].length <= 1200, `${chunks.length} message(s), ${chunks[0]?.length} chars`);
}

// ------------------------------------------------------------------- queue
// A message sent mid-run used to be rejected outright; it now queues and runs
// as its own turn. Bounded, so a burst cannot become an unbounded backlog.
{
  const chat = 'queue-chat';
  clearFollowups(chat);
  check('the queue starts empty', queuedFollowups(chat).length === 0);
  for (let i = 0; i < MAX_FOLLOWUPS; i++) check(`follow-up #${i + 1} is accepted`, queueFollowup(chat, `msg ${i + 1}`) === i + 1);
  check('the queue is capped', queueFollowup(chat, 'one too many') === null);
  check('the cap is a small number, not a backlog', MAX_FOLLOWUPS <= 5, `max ${MAX_FOLLOWUPS}`);
  check('the queue is per chat', queueFollowup('other-chat', 'mine') === 1 && queuedFollowups('other-chat').length === 1);
  clearFollowups('other-chat');
  check('the queue drains in order', shiftFollowup(chat) === 'msg 1');
  check('the queue keeps the rest', queuedFollowups(chat).length === MAX_FOLLOWUPS - 1);
  for (let i = 0; i < MAX_FOLLOWUPS - 1; i++) shiftFollowup(chat);
  check('an empty queue yields nothing', shiftFollowup(chat) === null);
  queueFollowup(chat, 'leftover');
  clearFollowups(chat);
  check('/new clears the queue', queuedFollowups(chat).length === 0);
}

// ------------------------------------------------------------------ /watch
{
  const prefs = new Map();
  check('the feed is off by default', watchOn(prefs, 'c1') === false);
  setWatch(prefs, 'c1', true);
  check('/watch on turns the feed on', watchOn(prefs, 'c1') === true);
  check('/watch on is per chat', watchOn(prefs, 'c2') === false);
  prefs.set('c2', { variant: 'high' });
  setWatch(prefs, 'c2', false);
  check('/watch keeps the other prefs of the chat', prefs.get('c2').variant === 'high' && watchOn(prefs, 'c2') === false);
  check('a missing prefs map is tolerated', watchOn(null, 'c3') === false);
}

// ------------------------------------------------------------------- /web
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-'));
  const file = path.join(dir, 'url');
  fs.writeFileSync(file, 'https://example-abc.trycloudflare.com/\n');
  check('/web reads the published tunnel url', readMiniappUrl(file) === 'https://example-abc.trycloudflare.com/');
  fs.writeFileSync(file, 'http://127.0.0.1:8894/\n');
  check('/web refuses a plain-http url', readMiniappUrl(file) === '', 'loopback is not reachable from a phone');
  fs.writeFileSync(file, 'javascript:alert(1)\n');
  check('/web refuses a non-url', readMiniappUrl(file) === '');
  check('a down tunnel reads as empty, not as a broken button', readMiniappUrl(path.join(dir, 'missing')) === '');
  fs.rmSync(dir, { recursive: true, force: true });
}

// --------------------------------------------------------------- headline
// A slow lane can take a minute to emit its first event; until then the chat
// stared at bare typing with no proof the turn started. announce() paints the
// headline immediately, once, and never double-creates it.
{
  const sent = [];
  const api = { sendMessage: async (chatId, text) => { sent.push({ chatId, text }); return { message_id: 777 }; } };
  const throttle = { submit: (fn) => fn() };
  const ids = [];
  const r = new ProgressRenderer({ api, throttle, chatId: '9', mode: 'full', maxChars: 900, maxEdits: 40, onMessageId: (id) => ids.push(id) });
  await r.start();
  r.setHeadline({ providerLabel: 'Anthropic', modelLabel: 'claude-opus-5' });
  await r.announce();
  check('the headline posts before the first model event', sent.length === 1, sent[0]?.text?.split('\n')[0]);
  check('the first paint names the provider and model', String(sent[0]?.text).includes('Anthropic') && String(sent[0]?.text).includes('claude-opus-5'));
  check('the headline message id is published once', r.messageId === 777 && ids.length === 1);
  await r.announce();
  check('announce never posts a second message', sent.length === 1);
  r.stopTyping();
}
{
  // A failed create must not be retried into a burst of messages.
  const sent = [];
  const api = { sendMessage: async () => { sent.push(1); return null; } };
  const r = new ProgressRenderer({ api, throttle: { submit: (fn) => fn() }, chatId: '9', mode: 'full', maxChars: 900, maxEdits: 40 });
  await r.announce();
  await r.announce();
  check('a rate-limited create backs off instead of retrying', sent.length === 1);
  r.stopTyping();
}
{
  // The lazy path still works: no announce(), first event creates the message.
  const sent = [];
  const api = { sendMessage: async (chatId, text) => { sent.push(text); return { message_id: 5 }; } };
  const r = new ProgressRenderer({ api, throttle: { submit: (fn) => fn() }, chatId: '9', mode: 'full', maxChars: 900, maxEdits: 40 });
  await r.start();
  r.onEvent({ kind: 'tool', tool: 'bash', status: 'running' });
  await sleep(50);
  check('without announce the first event still paints the headline', sent.length === 1 && r.messageId === 5);
  r.onEvent({ kind: 'text', text: 'partial answer' });
  await sleep(50);
  check('partial text never enters the headline', sent.length === 1);
  r.stopTyping();
}

// --------------------------------------------------- relay live channel
// The channel the whole live view rides on, against a real relay process: a
// worker posts one sanitized event per model event, the chat polls for what is
// new, and /abort lands as a flag the worker's own poll turns into a SIGKILL.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'liveview-'));
const port = 8980 + Math.floor(Math.random() * 60);
const TOKEN = 'live-view-test-token';
const relay = spawn(process.execPath, [path.join(HERE, 'worker-relay.mjs'), `--port=${port}`, `--relay-token=${TOKEN}`], {
  env: { ...process.env, HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
});
relay.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
const base = `http://127.0.0.1:${port}`;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${base}/health`)).ok; } catch { await sleep(150); }
  }
  check('the relay listens', up);
  if (!up) throw new Error('relay did not start');

  const anon = await fetch(`${base}/jobs/x/events`);
  check('the live channel is behind the relay token', anon.status === 401, `status ${anon.status}`);

  const job = enqueueJob({ host: 'mobile', prompt: 'do the thing', model: 'claude-opus-5' }, { home });
  const authed = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

  const post = await fetch(`${base}/jobs/event`, {
    method: 'POST', headers: authed, body: JSON.stringify({ jobId: job.id, event: { kind: 'tool', tool: 'bash', status: 'running', input: 'ls -la' } }),
  });
  check('a worker can publish a live event', post.ok, `status ${post.status}`);
  const seq = (await post.json()).seq;
  check('the first event is sequence 1', seq === 1, `seq ${seq}`);

  await fetch(`${base}/jobs/event`, {
    method: 'POST', headers: authed, body: JSON.stringify({ jobId: job.id, event: { kind: 'reasoning', text: 'weighing the options' } }),
  });

  const first = await fetchRelayEvents(base, job.id, 0, { token: TOKEN });
  check('the chat reads the events back in order', first.events.length === 2 && first.events[0].tool === 'bash' && first.events[1].kind === 'reasoning');
  check('the cursor advances past what was read', first.nextAfter === 2, `nextAfter ${first.nextAfter}`);

  const second = await fetchRelayEvents(base, job.id, first.nextAfter, { token: TOKEN });
  check('a second poll returns only what is new', second.events.length === 0 && second.nextAfter === 2);
  check('an unfinished job is not done', second.done === false);

  // /abort from TG: the flag, then the worker's own poll kills its child.
  const before = await (await fetch(`${base}/jobs/${job.id}/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  check('a running job is not flagged aborted', before.aborted === false);
  check('the chat can post an abort', await postRelayAbort(base, job.id, { token: TOKEN }) === true);
  const after = await (await fetch(`${base}/jobs/${job.id}/status`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  check('the abort flag is visible to the worker poll', after.aborted === true);

  // A silent worker must not break the feed: no events is a valid answer.
  const empty = await fetchRelayEvents(base, 'no-such-job', 0, { token: TOKEN });
  check('an unknown job reads as no events, not an error', empty.events.length === 0 && empty.nextAfter === 0);
  check('an unreachable relay reads as no events', (await fetchRelayEvents('http://127.0.0.1:1', 'j', 0, { token: TOKEN })).events.length === 0);

  // The store side, on its own: a chatty run cannot grow without bound.
  const big = enqueueJob({ host: 'mobile', prompt: 'chatty' }, { home });
  for (let i = 0; i < 600; i++) appendJobEvent(big.id, { kind: 'tool', tool: `t${i}`, output: 'z'.repeat(4000) }, { home });
  const stored = readJobEvents(big.id, { home });
  check('a runaway event stream is capped', stored.events.length <= 500, `${stored.events.length} kept`);
  check('a stored event field is clipped', stored.events.every((e) => String(e.output || '').length <= 2000));
} finally {
  relay.kill('SIGKILL');
  fs.rmSync(home, { recursive: true, force: true });
}

// ------------------------------------------------------------- the pump
// The half that actually makes a remote turn watchable: while the job is
// unfinished, the bot-host keeps polling the relay and fanning every new
// event out, and only returns once the result lands. Without onEvent the wait
// is byte-for-byte the old one — that is the no-regression half.
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-'));
  const prevHome = process.env.HOME;
  process.env.HOME = home; // getJob() resolves through the test's own store
  let polls = 0;
  let pumpJob = null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.endsWith('/events')) {
      const after = Number(url.searchParams.get('after') || 0);
      polls++;
      const feed = readJobEvents(pumpJob.id, { after, home });
      // The worker finishes between the first and the second poll, the way a
      // real turn does: the last events and the result arrive close together.
      if (polls >= 2) completeJob(pumpJob.id, { text: 'done on the phone', code: 0, model: 'claude-opus-5' }, { home });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, jobId: pumpJob.id, ...readJobEvents(pumpJob.id, { after, home }) }));
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pump = enqueueJob({ host: 'mobile', prompt: 'watch me run' }, { home });
    pumpJob = pump;
    appendJobEvent(pump.id, { kind: 'tool', tool: 'read', status: 'running' }, { home });
    appendJobEvent(pump.id, { kind: 'reasoning', text: 'picking the lane' }, { home });
    const seen = [];
    const done = await awaitJobWithEventPump(pump.id, { timeoutMs: 20000, pollMs: 20, relay: base, onEvent: (ev) => { seen.push(ev.kind); } });
    check('the pump returns the finished job', Boolean(done?.doneAt) && done.result?.text === 'done on the phone');
    check('the pump fanned the events out while waiting', seen.join(',') === 'tool,reasoning', seen.join(','));
    check('the pump polled more than once', polls >= 2, `${polls} polls`);
  } finally {
    // No onEvent = the old plain wait: still correct, no relay traffic.
    const quiet = enqueueJob({ host: 'mobile', prompt: 'quiet' }, { home });
    completeJob(quiet.id, { text: 'no stream', code: 0 }, { home });
    const before = polls;
    const plain = await awaitJobWithEventPump(quiet.id, { timeoutMs: 5000, pollMs: 20, relay: base });
    check('without a stream the wait does not touch the relay', polls === before && plain.result?.text === 'no stream');
    server.close();
    process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
