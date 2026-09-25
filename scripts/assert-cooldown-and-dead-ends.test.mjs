// R-14.1 card 6b steps 3 and 4.
//
// Step 3: a transport failure gets ONE retry, then a short cooldown, then the
// walk moves on. A quota answer is final and must not be retried.
// Step 4: the second copy of a signature appends one dead-end line, and the
// next build/investigate turn reads it. The instruction files never change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { isConnectionFailure, stampCooldown, CONNECTION_FAILED_COOLDOWN_MS } from './lib/free-lanes.mjs';
import { runOpencodeWithFailover, failureSignature, turnKindFor, noteDeadEnd, deadEndNotesFor, attemptFailureText } from './bot-host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; } else { console.error(`  FAIL  ${name}`); failed++; }
}

console.log('assert-cooldown-and-dead-ends:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), '6b-'));
const oldHome = process.env.HOME;
process.env.HOME = home;
const sent = [];
const oldLog = process.env.BOT_FAILURE_LOG;
process.env.BOT_FAILURE_LOG = path.join(home, 'bot-failures.jsonl');

function stubFor(outcomes) {
  // outcomes: list of {text, err}; each call shifts one
  return (bin, args, opts) => {
    sent.push({ args, env: opts.env });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', 1);
    queueMicrotask(() => {
      const o = outcomes.shift() || { text: '', err: 'ECONNREFUSED' };
      if (o.err) {
        child.stderr.emit('data', Buffer.from(
          `timestamp=2026-09-25T00:00:00.000Z level=ERROR run=abc message="stream error" providerID=opencode modelID=x error.error="${o.err}"\n`
        ));
      }
      if (o.text) child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'text', part: { text: o.text } })}\n`));
      child.emit('close', o.text ? 0 : 1);
    });
    return child;
  };
}

try {
  // 1. Vocabulary: transport failures are separated from quota answers.
  check('ECONNREFUSED is a connection failure', isConnectionFailure('connect ECONNREFUSED 127.0.0.1:443'));
  check('fetch failed is a connection failure', isConnectionFailure('TypeError: fetch failed'));
  check('socket hang up is a connection failure', isConnectionFailure('socket hang up'));
  // The two strings the live proof actually produced, 2026-09-25.
  check('the Cline wording is a connection failure', isConnectionFailure('Cannot connect to API: Unable to connect. Is the computer able to access the url?: Unable to connect. Is the computer able to access the url? (ConnectionRefused)'));
  check('the OpenCode wording is a connection failure', isConnectionFailure('HttpClientError: Transport error (GET https://models.opencode.ai/api.json)'));
  check('a name-resolution failure counts', isConnectionFailure('getaddrinfo EAI_AGAIN models.opencode.ai'));
  check('a 429 is not a connection failure', !isConnectionFailure('429 Too Many Requests'));
  check('a quota message is not a connection failure', !isConnectionFailure('Try again in 22h 46m'));

  // 2. One retry, then the walk moves on.
  sent.length = 0;
  const conn = await runOpencodeWithFailover({
    api: { sendMessage: async () => ({}) },
    chatId: 1,
    prompt: 'x',
    models: ['m-broken', 'm-good'],
    workspace: '/tmp',
    timeoutMs: 5000,
    spawnImpl: stubFor([
      { text: '', err: 'connect ECONNREFUSED 127.0.0.1:9' },
      { text: '', err: 'connect ECONNREFUSED 127.0.0.1:9' },
      { text: 'ok', err: '' },
    ]),
  });
  check('the connection-failed lane was retried exactly once', sent.filter((s) => s.args.includes('m-broken')).length === 2);
  check('the walk then used the next lane', conn.finalText === 'ok');
  check('the next lane ran once', sent.filter((s) => s.args.includes('m-good')).length === 1);

  // 2b. A surface that does not log with level=ERROR is still recognised.
  const plain = { stderr: 'some noise\nconnect ECONNREFUSED 10.0.0.5:443\n', lastError: '' };
  check('a bare stderr line is still read as the failure', /ECONNREFUSED/.test(attemptFailureText(plain)));
  check('and it counts as a connection failure', isConnectionFailure(attemptFailureText(plain)));
  check('an empty result has no failure text', attemptFailureText({}) === '');

  // 3. A quota answer is not retried on the same lane.
  sent.length = 0;
  const quota = await runOpencodeWithFailover({
    api: { sendMessage: async () => ({}) },
    chatId: 1,
    prompt: 'x',
    models: ['m-quota', 'm-good2'],
    workspace: '/tmp',
    timeoutMs: 5000,
    spawnImpl: stubFor([
      { text: '', err: '429 Too Many Requests. Try again in 22h 46m.' },
      { text: 'ok', err: '' },
    ]),
  });
  check('a quota-hit lane is not retried', sent.filter((s) => s.args.includes('m-quota')).length === 1);
  check('and the walk moved on', quota.finalText === 'ok');

  // 4. The cooldown stamp is short and carries its own kind.
  const { dir } = (await import('./lib/free-lanes.mjs')).ensureBotLedger('vm');
  const now = Date.now();
  const stamped = stampCooldown({ stateDir: dir, provider: 'opencode', model: 'broken', errText: 'ECONNREFUSED', now });
  check('the cooldown stamped', stamped.stamped === true);
  const sess = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  const rec = sess.quota?.['opencode/broken'];
  check('its kind is connection-failed', rec?.kind === 'connection-failed');
  check('it is not the 6h quota default', rec && rec.depletedUntil <= now + CONNECTION_FAILED_COOLDOWN_MS + 1000);
  check('it is not zero-length', rec && rec.depletedUntil > now);

  // 5. Signatures separate the kinds.
  check('quota and connection are different signatures', failureSignature({ lane: 'm', errText: '429 rate limit' }) !== failureSignature({ lane: 'm', errText: 'ECONNREFUSED' }));
  check('the same failure gives the same signature', failureSignature({ lane: 'm', errText: 'ECONNREFUSED 1.2.3.4' }) === failureSignature({ lane: 'm', errText: 'ECONNREFUSED 1.2.3.4' }));
  check('an unknown model is its own kind', /unknown-model/.test(failureSignature({ lane: 'm', errText: 'Unknown gemini model: x' })));

  // 6. Turn gating: only build/investigate read notes.
  check('a build request is a build turn', turnKindFor('please build the chart component') === 'build');
  check('a diagnosis request is an investigate turn', turnKindFor('investigate why the deploy failed') === 'investigate');
  check('small talk is not a build turn', turnKindFor('ok') === '');
  check('small talk gets no notes', deadEndNotesFor('ok', { home }).length === 0);

  // 7. The second sighting writes one line; the first does not.
  const mk = (lane, kind, hint) => ({ lane, kind, hint, at: new Date().toISOString(), bot: 'vm' });
  fs.appendFileSync(process.env.BOT_FAILURE_LOG, JSON.stringify(mk('m-x', 'other', 'ECONNREFUSED 127.0.0.1:9')) + '\n');
  const first = noteDeadEnd({ lane: 'm-x', errText: 'ECONNREFUSED 127.0.0.1:9', botId: 'vm', home });
  check('one sighting writes nothing', first.written === false);
  fs.appendFileSync(process.env.BOT_FAILURE_LOG, JSON.stringify(mk('m-x', 'other', 'ECONNREFUSED 127.0.0.1:9')) + '\n');
  const second = noteDeadEnd({ lane: 'm-x', errText: 'ECONNREFUSED 127.0.0.1:9', botId: 'vm', home });
  check('the second sighting writes one line', second.written === true);
  const again = noteDeadEnd({ lane: 'm-x', errText: 'ECONNREFUSED 127.0.0.1:9', botId: 'vm', home });
  check('a third sighting does not write again', again.written === false);

  // 8. A later build turn reads the line.
  const notes = deadEndNotesFor('please fix the ECONNREFUSED build on m-x', { home });
  check('a build turn reads the note', notes.length >= 1);
  check('the note names the lane', notes.some((n) => n.text.includes('m-x')));
  check('a chat turn still gets nothing', deadEndNotesFor('thanks', { home }).length === 0);

  // 9. A host account's limit is every bot's limit. Cline, Gemini, Token Harbor and
  // Cloudflare are reached with one key for this host, so the cap is the same for
  // vm and vm2 — live on 2026-09-25 vm recorded Cline's real 429 and vm2 went on
  // offering the model. OpenCode's free lanes are per-chat and stay per-bot.
  const { ensureBotLedger, loadFreeLaneLedger, projectLanes, stampDepleted: stamp, isHostAccountRoute } =
    await import('./lib/free-lanes.mjs');
  check('a cline route is the host account\'s', isHostAccountRoute('cline', 'cline-free/x') === true);
  check('a gemini route is too', isHostAccountRoute('gemini', 'gemini-3.8-flash') === true);
  check('tokenharbor and cloudflare are too', isHostAccountRoute('tokenharbor', 'x') === true && isHostAccountRoute('opencode', 'cloudflare/@cf/qwen/x') === true);
  check('an opencode free lane is NOT the host account\'s', isHostAccountRoute('opencode', 'opencode/space-bunny-free') === false);
  check('freebuff is not either', isHostAccountRoute('freebuff', 'deepseek/deepseek-v4.1-flash') === false);

  const seedTable = { version: 3, failover: 'same-family-then-pref', buckets: [], lanes: [
    { pref: 1, provider: 'cline', model: 'cline-free/muse-spark-1.3-contributor', status: 'available', tg: true, label: 'Muse 1.3' },
    { pref: 2, provider: 'opencode', model: 'opencode/space-bunny-free', status: 'available', tg: true, label: 'Space Bunny' },
  ] };
  const dirA = ensureBotLedger('vm').dir;
  const dirB = ensureBotLedger('vm2').dir;
  for (const d of [dirA, dirB]) fs.writeFileSync(path.join(d, 'free-lane-table.json'), JSON.stringify(seedTable, null, 2));

  const clineStamp = stamp({ stateDir: dirA, provider: 'cline', model: 'cline-free/muse-spark-1.3-contributor', errText: 'Error 429: Daily free limit reached. Try again in 13h 50m.', countdownHint: '13h 50m' });
  check('a cline depletion is stamped', clineStamp.stamped === true, JSON.stringify(clineStamp));
  check('and it is written to the shared host-account file too', clineStamp.shared === true);
  const seenByB = loadFreeLaneLedger({ stateDir: dirB });
  const clineRowB = projectLanes(seenByB.table, seenByB.session, { now: Date.now() }).find((r) => r.model === 'cline-free/muse-spark-1.3-contributor');
  check('the other bot sees that cline model as depleted', clineRowB?.depleted === true);
  check('and will not offer it', clineRowB?.selectable === false, JSON.stringify(clineRowB?.reason));

  const ocStamp = stamp({ stateDir: dirA, provider: 'opencode', model: 'opencode/space-bunny-free', errText: 'Rate limit exceeded. Try again in 20m.', countdownHint: '20m' });
  check('an opencode depletion is stamped', ocStamp.stamped === true);
  check('but stays out of the shared file', ocStamp.shared === false);
  const seenByB2 = loadFreeLaneLedger({ stateDir: dirB });
  const ocRowB = projectLanes(seenByB2.table, seenByB2.session, { now: Date.now() }).find((r) => r.model === 'opencode/space-bunny-free');
  check('the other bot still sees its own opencode lane as available', ocRowB?.selectable === true, JSON.stringify(ocRowB?.reason));
  const seenByA = loadFreeLaneLedger({ stateDir: dirA });
  check('while the bot that hit it does not', projectLanes(seenByA.table, seenByA.session, { now: Date.now() }).find((r) => r.model === 'opencode/space-bunny-free')?.selectable === false);

  // 10. The instruction files are not rewritten by any of this.
  const roleFile = path.join(HERE, '..', 'projects', 'external-2', 'roles', 'legal_policy.md');
  check('the role file is still the policy reader', /qualified adviser/.test(fs.readFileSync(roleFile, 'utf8')));
} finally {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldLog === undefined) delete process.env.BOT_FAILURE_LOG; else process.env.BOT_FAILURE_LOG = oldLog;
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
