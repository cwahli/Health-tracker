/**
 * Gate: a seat's model is host config, not this repo's opinion.
 *
 * The health seats were pinned to one vendor in three places at once —
 * `COUNCIL_MODEL` defaulted to a Gemini id, the credential gate asked
 * `geminiKeyIn(env)`, and `runGemini` rejected any id outside `GEMINI_MODELS`.
 * The effect on this host: `/health readiness` answered "⛔ No model credential
 * on this host — set GEMINI_API_KEY" while the very same box's Telegram bot
 * answered all day, and `opencode models` listed **72** lanes. The lane refused a
 * host that could run the turn, and named a variable that was never required.
 *
 * Three rules, and the third is the one that keeps this honest:
 *
 *   1. **The chain is the bot's chain** — the calling chat's model, then the
 *      bot's default, via the same `failoverModels` the Telegram bot uses for
 *      every dispatch. A seat is not a separate species of agent: set your chat
 *      to a model and the analyst answers on it.
 *   2. An operator can still pin one lane with COUNCIL_MODEL.
 *   3. With nothing configured, the host catalog is the fallback — and a
 *      *transient* empty catalog must not become a refusal, so a flaky read is
 *      retried rather than believed.
 *
 * Rule 1 is the one that was wrong first. An earlier draft sorted its own chain
 * from the host catalog, free lanes first, which meant a seat could answer on a
 * different model than the bot that asked it — the very complaint that prompted
 * this work. Rule 3's retry exists because of something measured here, not
 * predicted: during development one `opencode models` read came back empty and
 * the next returned 72. A single flaky read would have refused a seat turn,
 * which is the same shape of defect as trusting the npm `tsc` decoy — the
 * environment looks broken and the operator gets blamed.
 *
 * Everything here executes the real module against fixtures. No source is read
 * to decide whether the source is right: a rule that a comment can satisfy is
 * not a rule.
 */
import path from 'node:path';

import { SEAT_MODEL_CHAIN_LIMIT, SEAT_MODEL_ENV, runSeatModel, seatModelChain, seatModelReach } from './lib/health/seat-model.mjs';

/** Records what it was asked, so a probe can assert on the calls, not the result. */
function spyListModels(catalog, { failFirst = 0, emptyFirst = 0 } = {}) {
  const calls = { n: 0 };
  const impl = async () => {
    calls.n += 1;
    if (calls.n <= failFirst) throw new Error('transient: the CLI is not up yet');
    if (calls.n <= failFirst + emptyFirst) return [];
    return catalog;
  };
  return { impl, calls };
}

/** A runOpencode stand-in: answers with `text` for `answerOn`, refuses the rest. */
function spyRun({ answerOn = () => true, text = 'SEAT-OK', lastError = 'lane refused' } = {}) {
  const seen = [];
  const impl = async ({ model }) => {
    seen.push(model);
    if (answerOn(model)) return { finalText: text, lastError: '' };
    return { finalText: '', lastError };
  };
  return { impl, seen };
}

export async function audit() {
  const failures = [];
  const fail = (kind, detail) => failures.push({ kind, detail });

  const catalog = ['paid/model-x', 'vendor/flash-free', 'vendor/pro-free', 'vendor/second-free'];

  // --- 1. the chain IS the bot's chain: chat model, then the bot default ----
  // This is the rule the user asked for and the one my first draft got wrong.
  const fromChat = await seatModelChain({ env: {}, chatModel: 'opencode/glm-5.3', botModel: 'opencode/deepseek-v4-flash' });
  if (JSON.stringify(fromChat) !== JSON.stringify(['opencode/glm-5.3', 'opencode/deepseek-v4-flash'])) {
    fail('chat-model-first', `the chat's own model must lead the chain, got ${JSON.stringify(fromChat)}`);
  }

  // The catalog must NOT get a vote when a chat model exists. A seat that sorts
  // its own chain answers on a different lane than the bot that asked it.
  const withCatalogPresent = await seatModelChain({ env: {}, chatModel: 'opencode/glm-5.3', botModel: '', models: catalog });
  if (JSON.stringify(withCatalogPresent) !== JSON.stringify(['opencode/glm-5.3'])) {
    fail('catalog-outranks-chat', `a configured chat model must exclude the catalog, got ${JSON.stringify(withCatalogPresent)}`);
  }

  // Identical entries collapse, exactly as failoverModels does: a chat on the
  // default model runs once rather than twice.
  const sameModel = await seatModelChain({ env: {}, chatModel: 'opencode/same', botModel: 'opencode/same' });
  if (JSON.stringify(sameModel) !== JSON.stringify(['opencode/same'])) {
    fail('chain-dupes', `a chat on the default must run once, got ${JSON.stringify(sameModel)}`);
  }

  // Nothing configured: the host catalog is the fallback, free lanes first.
  const chain = await seatModelChain({ env: {}, models: catalog });
  if (JSON.stringify(chain) !== JSON.stringify(['vendor/flash-free', 'vendor/pro-free', 'vendor/second-free'])) {
    fail('chain-order', `free lanes must come first and paid last, got ${JSON.stringify(chain)}`);
  }
  if (chain.length !== SEAT_MODEL_CHAIN_LIMIT) fail('chain-limit', `expected ${SEAT_MODEL_CHAIN_LIMIT} lanes, got ${chain.length}`);
  if (chain.includes('paid/model-x')) fail('paid-first', 'a paid lane was placed ahead of a free one');
  if (new Set(chain).size !== chain.length) fail('chain-dupes', 'the chain repeats a lane');

  // --- 2. an explicit override wins, and wins alone -------------------------
  const pinned = await seatModelChain({ env: { [SEAT_MODEL_ENV]: 'someone/else-entirely' }, models: catalog });
  if (JSON.stringify(pinned) !== JSON.stringify(['someone/else-entirely'])) {
    fail('override', `COUNCIL_MODEL must be the whole chain, got ${JSON.stringify(pinned)}`);
  }
  const blankPin = await seatModelChain({ env: { [SEAT_MODEL_ENV]: '   ' }, models: catalog });
  if (blankPin.length !== SEAT_MODEL_CHAIN_LIMIT) fail('blank-override', 'a whitespace-only COUNCIL_MODEL must not empty the chain');

  // --- 3. a transient empty catalog is retried, a real one is not hidden ----
  // First read throws, second answers: the chain must still be usable.
  const flaky = spyListModels(catalog, { failFirst: 1 });
  const afterRetry = await seatModelChain({ env: {}, listModelsImpl: flaky.impl });
  if (afterRetry.length !== SEAT_MODEL_CHAIN_LIMIT) fail('no-retry', `a first failed read must be retried, chain was ${JSON.stringify(afterRetry)}`);
  if (flaky.calls.n < 2) fail('retry-count', `expected a second read, made ${flaky.calls.n}`);

  // The subtler half: a read that *succeeds* and returns nothing. This is the
  // shape actually observed on this host, and it is the one a `try/catch` retry
  // misses — an empty list is not an exception.
  const silent = spyListModels(catalog, { emptyFirst: 1 });
  const afterEmptyRetry = await seatModelChain({ env: {}, listModelsImpl: silent.impl });
  if (afterEmptyRetry.length !== SEAT_MODEL_CHAIN_LIMIT) fail('no-empty-retry', `an empty first read must be retried, chain was ${JSON.stringify(afterEmptyRetry)}`);

  const dead = spyListModels([], { failFirst: 5 });
  const genuinelyEmpty = await seatModelChain({ env: {}, listModelsImpl: dead.impl });
  if (genuinelyEmpty.length !== 0) fail('false-ready', `a host with no lanes must yield an empty chain, got ${JSON.stringify(genuinelyEmpty)}`);
  if (dead.calls.n !== 2) fail('retry-bound', `a genuinely empty host must be read exactly twice, made ${dead.calls.n}`);

  // --- 4. reach reports the real cause --------------------------------------
  const noLanes = await seatModelReach({ env: {}, models: [] });
  if (noLanes.ok) fail('reach-false-positive', 'a host with no lanes and no key must not report ok');

  const withCatalog = await seatModelReach({ env: {}, models: catalog });
  if (!withCatalog.ok || withCatalog.reason !== 'catalog' || withCatalog.models !== 4) {
    fail('reach-catalog', `the catalog alone must be enough, got ${JSON.stringify(withCatalog)}`);
  }

  const geminiOnly = await seatModelReach({ env: {}, models: [], geminiKey: 'a-key' });
  if (!geminiOnly.ok || geminiOnly.reason !== 'gemini-key') {
    fail('reach-gemini-fallback', `a host wired the older way must still be ok, got ${JSON.stringify(geminiOnly)}`);
  }

  // --- 5. a turn walks the chain and reports the lane that answered ----------
  const firstDead = spyRun({ answerOn: (m) => m !== 'vendor/flash-free' });
  const ran = await runSeatModel({
    prompt: 'x',
    env: {},
    models: ['vendor/flash-free', 'vendor/pro-free'],
    runOpencodeImpl: firstDead.impl,
  });
  if (String(ran.finalText).trim() !== 'SEAT-OK') fail('turn-text', `the turn must return text, got ${JSON.stringify(ran.finalText)}`);
  if (firstDead.seen[0] !== 'vendor/flash-free') fail('turn-order', `must try the first lane first, tried ${JSON.stringify(firstDead.seen)}`);
  if (firstDead.seen.length < 2) fail('no-failover', `a refused first lane must fall through, tried ${JSON.stringify(firstDead.seen)}`);

  // The live shape: a chat on model A, bot default B. The turn must answer on A.
  const chatTurn = spyRun({ answerOn: () => true });
  const onChat = await runSeatModel({
    prompt: 'x',
    env: {},
    chatModel: 'opencode/glm-5.3',
    botModel: 'opencode/deepseek-v4-flash',
    models: catalog,
    runOpencodeImpl: chatTurn.impl,
  });
  if (chatTurn.seen[0] !== 'opencode/glm-5.3') fail('turn-not-chat-model', `a turn must answer on the chat's model, tried ${JSON.stringify(chatTurn.seen)}`);
  if (onChat.answeredBy !== 'opencode/glm-5.3') fail('answeredBy', `answeredBy must name the chat's model, got ${onChat.answeredBy}`);

  // Chat lane dead -> the bot's default, which is the whole point of a chain.
  const chatDead = spyRun({ answerOn: (m) => m !== 'opencode/glm-5.3' });
  const fellBack = await runSeatModel({
    prompt: 'x',
    env: {},
    chatModel: 'opencode/glm-5.3',
    botModel: 'opencode/deepseek-v4-flash',
    models: catalog,
    runOpencodeImpl: chatDead.impl,
  });
  if (fellBack.answeredBy !== 'opencode/deepseek-v4-flash') fail('no-bot-fallback', `a dead chat lane must fall to the bot default, got ${fellBack.answeredBy}`);

  const allDead = spyRun({ answerOn: () => false });
  const refused = await runSeatModel({
    prompt: 'x',
    env: {},
    models: ['vendor/a-free', 'vendor/b-free'],
    runOpencodeImpl: allDead.impl,
  });
  if (String(refused.finalText).trim()) fail('dead-lanes-invent', `no lane answered, so no text may exist, got ${JSON.stringify(refused.finalText)}`);
  if (!String(refused.lastError).trim()) fail('dead-lanes-silent', 'a refused turn must carry the reason');

  // --- 6. no models at all is a refusal, not an empty answer ----------------
  const noneAtAll = await runSeatModel({
    prompt: 'x',
    env: {},
    models: [],
    runOpencodeImpl: async () => { throw new Error('must never be called'); },
  });
  if (String(noneAtAll.finalText).trim()) fail('no-lanes-text', `no lanes must yield no text, got ${JSON.stringify(noneAtAll.finalText)}`);
  if (!/no model is available/.test(String(noneAtAll.lastError))) {
    fail('no-lanes-reason', `the refusal must say no model is available, got ${JSON.stringify(noneAtAll.lastError)}`);
  }
  // The refusal must survive the shape an *empty but successful* run produces,
  // because that is what a caller cannot tell apart from a real answer. A lane
  // that returns `{finalText:''}` with no error has to end as a refusal too —
  // otherwise executeRoleTurn's "model returned no text" string is the only
  // thing standing between a dead lane and an empty document.
  const silentLane = await runSeatModel({
    prompt: 'x',
    env: {},
    models: ['vendor/quiet-free'],
    runOpencodeImpl: async () => ({ finalText: '', lastError: '' }),
  });
  if (String(silentLane.finalText).trim()) fail('silent-lane-text', `an empty answer must stay empty, got ${JSON.stringify(silentLane.finalText)}`);
  if (!String(silentLane.lastError || '').trim()) {
    fail('silent-lane-silent', `a lane that answered nothing must still carry a reason, got ${JSON.stringify(silentLane.lastError)}`);
  }

  return { ok: failures.length === 0, failures };
}

export async function run() {
  return audit();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const out = await run();
  if (out.ok) {
    console.log('assert-seat-model: ok');
  } else {
    for (const f of out.failures) console.error(`  FAIL  ${f.kind}: ${f.detail}`);
    console.error(`assert-seat-model: ${out.failures.length} fail`);
    process.exit(1);
  }
}
