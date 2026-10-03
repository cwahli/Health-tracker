/**
 * seat-model.mjs — how a seat picks the model it runs on.
 *
 * The Telegram bot already answers from whatever model the host has configured:
 * `getModels()` asks the OpenCode CLI for the catalog the host can actually
 * reach, sorts free lanes first, and walks that list with
 * `runWithModelFailover`. Nothing about that is Gemini-specific.
 *
 * The health seats were not on that path. Three places pinned them to one
 * vendor:
 *
 *   1. `COUNCIL_MODEL` defaulted to `gemini/gemini-3.7-flash`;
 *   2. the credential gate asked `geminiKeyIn(env)`, so it reported "no model
 *      credential on this host" on a box whose bot answers fine all day;
 *   3. `runGemini` validated the id against `GEMINI_MODELS` and refused
 *      anything else — so even setting COUNCIL_MODEL to a model this host can
 *      run produced "Unknown gemini model".
 *
 * Measured on this host, 2026-10-02: `opencode models` returns **72** models
 * and a turn through the first one answered, while `GEMINI_API_KEY` is unset and
 * `geminiKeyIn` returns "". So the lane refused a host that could run the turn,
 * and the refusal named a variable that was never required.
 *
 * The model is therefore **decided by host config, not by this module**. This
 * file only answers two questions:
 *
 *   - can this host run a model at all? (`seatModelReach`) — used by the
 *     readiness self-check, so the blocker names the real cause.
 *   - give me the chain, in order. (`seatModelChain`) — the host's own catalog,
 *     free lanes first, with an explicit override honoured.
 *
 * Deliberately *not* here: a Gemini fallback. This box proved a Gemini-keyed
 * lane adds nothing the catalog does not already carry, and keeping one would
 * re-introduce the vendor pin this removes. The Gemini lane stays available to
 * callers that already use it (bot-host's `/freemodel`, the tax lane); it is
 * simply no longer a *precondition* for a seat turn.
 *
 * Read-only, except for the model calls a caller explicitly asks for.
 */
import { geminiKeyIn } from '../agent-gemini.mjs';
import { failoverModels, listModels, runOpencode, runWithModelFailover } from '../agent-opencode.mjs';
import { sortModelsFreeFirst } from '../commands.mjs';

/**
 * The env var that pins the chain. One lane, not a list, because a chain
 * configured by env would defeat the point: the bot's own resolution is the
 * source of truth and this is the operator's override when they want one
 * specific model.
 */
export const SEAT_MODEL_ENV = 'COUNCIL_MODEL';

/**
 * How many lanes to try. The bot walks its whole catalog; a seat turn is
 * single-shot with a fixed budget, so it tries a few and then reports the last
 * error. Three is enough to clear a dead lane and a quota hit without turning
 * one refused turn into a minute of retries.
 */
export const SEAT_MODEL_CHAIN_LIMIT = 3;

const trimmed = (v) => String(v ?? '').trim();

/**
 * Ask the host what models it has, retrying once on an empty answer.
 *
 * The retry is not paranoia about the network: `opencode models` is a child
 * process against a gateway, and one reading during development came back empty
 * while the very next call returned 72. An empty catalog means `seatModelChain`
 * returns `[]`, which means the seat **refuses** — so a single flaky read would
 * refuse a turn on a host that is perfectly able to run it. That is the same
 * shape of bug as reading `tsc` output from the npm decoy: the environment
 * looks broken and the operator is blamed for it. One retry, no more — a host
 * that is genuinely out of lanes fails twice and is reported as such.
 *
 * `models` short-circuits the whole thing, so fixtures never spawn anything.
 */
async function loadCatalog({ models, listModelsImpl }) {
  if (models) return models;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const catalog = await listModelsImpl({ timeoutMs: 60000 });
      if (catalog && catalog.length) return catalog;
    } catch {
      // fall through to the retry, then to the honest empty answer
    }
  }
  return [];
}

/**
 * The model chain for a seat turn.
 *
 * **This is the bot's chain, not a second opinion about models.** In order:
 *
 *   1. `COUNCIL_MODEL`, when the operator pinned one.
 *   2. The **calling chat's** model — the same one that bot would use to answer
 *      a normal message in that chat (`/model`, then the registry default).
 *      A seat is not a separate species of agent: if you set your chat to
 *      `opencode/glm-5.3`, the analyst reasons on `opencode/glm-5.3`.
 *   3. The **bot's** configured default.
 *
 * That is `failoverModels(chatModel, botDefault)` — the function the Telegram
 * bot already uses for every dispatch — not a catalog sorted here. An earlier
 * draft of this file invented its own ordering (host catalog, free lanes first),
 * which would have meant a seat answering on a different model than the bot that
 * asked it. That is the bug the user reported, not the fix.
 *
 * Returns `[]` only when nothing at all is configured, which the caller must
 * treat as a refusal, never as an empty answer.
 */
export async function seatModelChain({
  env = process.env,
  chatModel = '',
  botModel = '',
  models = null,
  listModelsImpl = listModels,
} = {}) {
  const override = trimmed(env?.[SEAT_MODEL_ENV]);
  if (override) return [override];

  // Same rule as the bot: chat model first, then the bot's default, deduped.
  const chain = failoverModels(trimmed(chatModel), trimmed(botModel));
  if (chain.length) return chain.slice(0, SEAT_MODEL_CHAIN_LIMIT);

  // Nothing configured. Rather than invent a model, ask the host what it can
  // run — so a fresh install still works instead of refusing on missing config.
  const catalog = await loadCatalog({ models, listModelsImpl });
  const free = sortModelsFreeFirst([...new Set((catalog || []).map(trimmed).filter(Boolean))]);
  return free.slice(0, SEAT_MODEL_CHAIN_LIMIT);
}

/**
 * Can this host run a model at all?
 *
 * Two independent signals, because either alone lies:
 *
 *   - `models`     — the OpenCode CLI catalog. Non-empty means the host has a
 *                    lane it believes it can run. It does **not** prove one
 *                    answers (a catalog can list a lane with no funds), which is
 *                    exactly why this is a reach check and not a health check.
 *   - `geminiKey`  — a Gemini credential, for hosts wired the older way.
 *
 * Reported as a reason so the readiness line can name the cause rather than
 * inventing one. Note what this deliberately does not do: it does not run a
 * turn. A reach check that answered a prompt would cost a model call on every
 * `/health readiness`, and the caller that actually needs an answer is the turn
 * itself, which reports its own failure.
 */
export async function seatModelReach({
  env = process.env,
  models = null,
  listModelsImpl = listModels,
  geminiKey = null,
} = {}) {
  const catalog = await loadCatalog({ models, listModelsImpl });
  const count = (catalog || []).filter(Boolean).length;
  const key = geminiKey !== null ? trimmed(geminiKey) : geminiKeyIn(env);
  if (count) {
    return { ok: true, reason: 'catalog', models: count, sample: trimmed(catalog[0]) };
  }
  if (key) {
    return { ok: true, reason: 'gemini-key', models: 0, sample: '' };
  }
  return { ok: false, reason: 'none', models: 0, sample: '' };
}

/**
 * Run one seat turn on the bot's chain, failing over like the bot does.
 *
 * `chatModel` / `botModel` are the values the Telegram bot already resolved for
 * the chat asking (`effective()` then `failoverModels()`), so a seat answers on
 * the same lane the user picked for that chat.
 *
 * Returns the same shape the callers already consume (`{ finalText, lastError }`)
 * so `executeRoleTurn` and the health runners need no shape change. Never throws
 * for a model failure: a refusal is the answer, so the caller can write the same
 * refusal text whether the lane was missing, quota'd, or empty.
 */
export async function runSeatModel({
  prompt,
  env = process.env,
  chatModel = '',
  botModel = '',
  models = null,
  listModelsImpl = listModels,
  runOpencodeImpl = runOpencode,
  timeoutMs = 120000,
  workspace = undefined,
  thinking = false,
  limit = SEAT_MODEL_CHAIN_LIMIT,
} = {}) {
  const chain = await seatModelChain({ env, chatModel, botModel, models, listModelsImpl });
  if (!chain.length) {
    return {
      finalText: '',
      lastError: 'no model is available on this host — `opencode models` returned nothing and no Gemini credential is set',
      answeredBy: '',
      attempts: [],
    };
  }
  const { result, attempts } = await runWithModelFailover({
    models: chain,
    makeRun: (model) =>
      runOpencodeImpl({ prompt, model, timeoutMs, workspace, thinking }),
  });
  const text = String(result?.finalText || '');
  // A lane that returns no text and no error is the shape a caller cannot tell
  // from an answer. `defaultIsRetryable` calls it success (there is no error to
  // retry on), so the chain stops on it — and the caller would see an empty
  // document rather than a refusal. Name it here, where the lane is known.
  const silent = !text.trim() && !String(result?.lastError || '').trim();
  // `attempts[i]` is `{ model, lastError, ok }` while `chain` is a plain string
  // list, so index the chain directly. Asking `chain[n].model` silently yields
  // undefined and falls back to chain[0] — which reports the chat's lane as the
  // answer even after failover moved to the bot's default.
  const answeredBy = text.trim() ? chain[attempts.length - 1] || chain[0] || '' : '';
  return {
    finalText: text,
    lastError: silent
      ? `model ${answeredBy || chain[chain.length - 1] || ''} returned no text and no error`.trim()
      : String(result?.lastError || ''),
    answeredBy,
    attempts,
    // The winning lane's measured usage. The group-council path has no coder
    // turn, so without this the seat's per-chat Usage stays — forever: the
    // runner already measures it (runOpencode resolves `usage`), it was just
    // dropped on the floor here.
    usage: result?.usage ?? null,
  };
}
