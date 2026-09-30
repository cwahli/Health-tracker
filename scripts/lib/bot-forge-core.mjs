/**
 * bot-forge-core.mjs — the pure half of the one-click bot forge.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Creating a bot touches the registry, the master token file, the per-runtime
 * env files, a systemd unit and the Telegram API. That is five surfaces, and a
 * half-finished creation is worse than none: a registry row with no token boots
 * nothing, a token with no unit never runs, and either one looks successful.
 *
 * So the whole thing is one ordered pipeline with a receipt, and everything that
 * can be decided without touching the world is decided here: is the name legal,
 * is the token shaped like a token, is the id free, is the token already in use.
 * `scripts/bot-forge.mjs` performs the steps; this file decides them. That split
 * is what lets the refusals be tested with fixtures instead of a live account.
 *
 * Nothing here reads the environment, the filesystem or the network.
 */

/** The two ways a token can arrive. `paste` is the path that always works. */
export const TOKEN_SOURCES = ['paste', 'userbot'];

/**
 * The two ways a bot reaches the fleet.
 *
 * `create` writes a new registry row. `attach` finishes a row that is already
 * there but has no token — a hand-written or scaffolded row (`pm`) whose only
 * missing surface is the token. It is the same pipeline with the registry step
 * turned off, not a second creation path.
 */
export const FORGE_MODES = ['create', 'attach'];

/**
 * The pipeline, in order. `hostOnly` marks the steps that need a live Telegram
 * account or the VPS — the ones the forge must be able to describe and refuse
 * rather than pretend to have done.
 */
export const PIPELINE_STEPS = [
  { id: 'plan', title: 'Validate the name, the id and the token' },
  { id: 'token', title: 'Obtain the bot token (paste, or the userbot)' },
  { id: 'registry', title: 'Write the thin registry row (inherits the master)' },
  { id: 'master-token', title: 'Add the token line to the master token file' },
  { id: 'sync', title: 'Sync the token to the runtime env files' },
  { id: 'supervision', title: 'Generate the user-scope unit and check its wiring' },
  { id: 'publish', title: 'Prove the token (getMe) and publish the command menu' },
  { id: 'enable', title: 'Enable the bot in the registry' },
];

export const STEP_IDS = PIPELINE_STEPS.map((s) => s.id);

/** Telegram bot tokens: <bot id>:<secret>. Shape check, not a validity check. */
const TOKEN_RE = /^(\d{5,12}):([A-Za-z0-9_-]{30,50})$/;

/** BotFather usernames: 5-32 chars, alphanumeric + underscore, ending in "bot". */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,29}bot$/;

/** A registry id is a place: lowercase, short, stable (scripts/add-bot.mjs). */
const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

export function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    // "VM3 Bot" names a bot, not a thing called bot; drop the trailing word.
    .replace(/_?bot$/, '')
    .slice(0, 30);
}

/**
 * A display name is what the chat shows. Telegram allows a lot, but a name that
 * is empty or is only punctuation cannot become an id, so it is refused here
 * where the message can say why.
 */
export function validateBotName(name) {
  const raw = String(name ?? '');
  if (!raw.trim()) return 'a bot name is required (what the chat shows, e.g. "VM3 Bot")';
  if (raw.length > 64) return 'the name must be 64 characters or fewer';
  if (!/[\p{L}\p{N}]/u.test(raw)) return 'the name needs at least one letter or digit';
  if (!ID_RE.test(slugifyName(raw))) {
    return `"${raw}" has no usable id — the name must contain letters or digits (it becomes the bot's place name)`;
  }
  return '';
}

export function validateId(id) {
  if (!ID_RE.test(String(id || ''))) return `"${id}" must match ${ID_RE} (a lowercase place name, e.g. vm3)`;
  return '';
}

/**
 * BotFather's username rules, as candidates rather than one guess.
 *
 * Usernames are globally unique, and the first guess is often taken by a bot
 * that has nothing to do with this fleet. A forge that stops on the first
 * collision is not one-click, so the caller walks this list and only gives up
 * when it is exhausted.
 */
export function usernameCandidates(name, { limit = 5, seed = '' } = {}) {
  const base = slugifyName(name).slice(0, 24) || 'bot';
  const out = [];
  const push = (candidate) => {
    const value = candidate.slice(0, 32);
    if (USERNAME_RE.test(value) && !out.includes(value)) out.push(value);
  };
  push(`${base}_bot`);
  push(`ht_${base}_bot`);
  const digits = String(seed).replace(/\D/g, '');
  if (digits) push(`${base}_${digits.slice(-4)}_bot`);
  for (let i = 2; out.length < limit && i <= limit + 2; i += 1) push(`${base}_${i}_bot`);
  return out;
}

export function validateUsername(username) {
  const value = String(username || '');
  if (!USERNAME_RE.test(value)) {
    return `"${value}" is not a Telegram bot username (5-32 chars, letters/digits/underscore, must end in "bot")`;
  }
  return '';
}

/** Shape-check a token and report which bot id it claims to belong to. */
export function validateToken(token) {
  const value = String(token || '').trim();
  if (!value) return { ok: false, reason: 'a bot token is required' };
  const m = value.match(TOKEN_RE);
  if (!m) {
    return {
      ok: false,
      reason:
        'that does not look like a bot token. @BotFather gives one line shaped like 123456789:AA…; ' +
        'the bot name, a truncated paste and a username all fail this check on purpose',
    };
  }
  return { ok: true, token: value, botId: Number(m[1]) };
}

/** The env var a bot reads, by the fleet convention (shared with add-bot.mjs). */
export function tokenEnvFor(id) {
  return `${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_BOT_TOKEN`;
}

/**
 * Is the userbot usable?
 *
 * Three separate things have to be true, and a refusal that does not say which
 * one is missing sends the operator to the wrong fix: the library must be
 * installed, the api_id/api_hash must be present, and one phone login must have
 * produced a session file.
 *
 * The `hostCommands` are the steps only the operator can run. They are printed,
 * never assumed.
 */
export function describeUserbot({ moduleAvailable = false, apiId = '', apiHash = '', sessionFile = '', sessionExists = false } = {}) {
  const hostCommands = [
    'cd /home/ubuntu/bot-host && npm install teleproto        # the MTProto client (already in package.json)',
    'node scripts/bot-forge.mjs userbot-login                 # api_id/api_hash + phone code + 2FA, once',
  ];
  if (!moduleAvailable) {
    return {
      configured: false,
      reason: 'the teleproto module is not installed on this host, so @BotFather cannot be driven automatically',
      hostCommands,
    };
  }
  if (!apiId || !apiHash) {
    return {
      configured: false,
      reason: 'TELEGRAM_API_ID / TELEGRAM_API_HASH are not set (create an app at my.telegram.org)',
      hostCommands,
    };
  }
  if (!sessionExists) {
    return {
      configured: false,
      reason: `no userbot session at ${sessionFile || '(unset)'} — the one phone login has not been done`,
      hostCommands,
    };
  }
  return { configured: true, reason: '', hostCommands: [] };
}

/**
 * Pull the token out of a BotFather reply.
 *
 * BotFather answers `/newbot` with a message containing the token, and it
 * answers a taken username with a complaint. Reading the token out of the reply
 * is the whole automation, so it is a pure function with fixtures rather than a
 * regex in the middle of a network call.
 */
export function parseBotFatherToken(text) {
  const value = String(text || '');
  const m = value.match(/\b(\d{5,12}:[A-Za-z0-9_-]{30,50})\b/);
  if (!m) {
    return { ok: false, reason: 'this reply carries no token', taken: /taken|already|sorry/i.test(value) };
  }
  return { ok: true, token: m[1], botId: Number(m[1].split(':')[0]) };
}

/**
 * Decide a run before anything is written.
 *
 * `mode: 'create'` decides a bot that is not there yet; `mode: 'attach'` decides
 * the token for a row that already is, borrowing that row's own name and tokenEnv
 * so the operator does not retype what the registry knows. Both answer in the
 * same shape, because both drive the same pipeline.
 *
 * Everything here is a fact about the current registry plus the request, which
 * is why it can be proven with fixtures. The engine's own refusals
 * (`scripts/add-bot.mjs`) still run at write time — this is the early, cheap
 * one that can explain itself in the browser.
 */
export function planForge({ registry = {}, name = '', id = '', token = '', tokenEnv = '', tokenSource = 'paste', mode = 'create' } = {}) {
  if (!FORGE_MODES.includes(mode)) {
    return { ok: false, step: 'plan', reason: `unknown mode "${mode}" (expected ${FORGE_MODES.join(' or ')})` };
  }
  if (!TOKEN_SOURCES.includes(tokenSource)) {
    return { ok: false, step: 'plan', reason: `unknown token source "${tokenSource}" (expected ${TOKEN_SOURCES.join(' or ')})` };
  }

  const bots = Array.isArray(registry.bots) ? registry.bots : [];

  // attach — the row is already there and is the one thing NOT to rewrite. Its
  // own name and tokenEnv come from the registry, so the operator does not retype
  // what the fleet already knows, and no name is needed for the common case.
  if (mode === 'attach') {
    const botId = String(id || '').trim() || slugifyName(name);
    const idProblem = validateId(botId);
    if (idProblem) return { ok: false, step: 'plan', reason: idProblem };
    const row = bots.find((b) => b.id === botId) || null;
    if (!row) {
      return {
        ok: false,
        step: 'plan',
        reason: `"${botId}" is not in the registry, so there is no row for a token to finish — create it instead of attaching`,
      };
    }
    // @BotFather mints one token per bot, at creation. An existing bot's token
    // can only be pasted, so the userbot route is refused here rather than
    // reported as a later "token" failure.
    if (tokenSource !== 'paste') {
      return {
        ok: false,
        step: 'plan',
        reason: `attaching needs the token you already have — @BotFather cannot mint a second one for a bot that exists (paste "${row.telegram?.tokenEnv || tokenEnvFor(botId)}")`,
      };
    }
    const displayName = String(name || row.name || botId).trim();
    const nameProblem = validateBotName(displayName);
    if (nameProblem) {
      return { ok: false, step: 'plan', reason: `the registry row for "${botId}" has no usable name (${nameProblem})` };
    }
    const shape = validateToken(token);
    if (!shape.ok) return { ok: false, step: 'plan', reason: shape.reason };
    const env = tokenEnv || row.telegram?.tokenEnv || tokenEnvFor(botId);
    for (const bot of bots) {
      if (bot.id !== botId && bot.telegram?.tokenEnv === env) {
        return { ok: false, step: 'plan', reason: `tokenEnv "${env}" is already used by "${bot.id}"` };
      }
    }
    // A token under another bot's row is a second poller. The row's own env key
    // is exempt: re-attaching to it is how a token gets rotated.
    if (bots.some((b) => b.id !== botId && b.telegram?.token === shape.token)) {
      return { ok: false, step: 'plan', reason: 'that token is already registered to another bot — one token is one poller' };
    }
    return {
      ok: true,
      step: 'plan',
      plan: {
        mode,
        id: botId,
        name: displayName,
        tokenEnv: env,
        token: shape.token,
        telegramBotId: String(shape.botId),
        tokenSource,
        masterId: registry.master || bots[0]?.id || '',
        attached: true,
        wasEnabled: row.enabled !== false,
        runtime: row.runtime || 'bot-host',
      },
    };
  }

  const nameProblem = validateBotName(name);
  if (nameProblem) return { ok: false, step: 'plan', reason: nameProblem };

  const botId = id ? String(id).trim() : slugifyName(name);
  const idProblem = validateId(botId);
  if (idProblem) return { ok: false, step: 'plan', reason: idProblem };

  if (bots.some((b) => b.id === botId)) {
    return { ok: false, step: 'plan', reason: `bot "${botId}" is already in the registry — pick another name, or attach a token to it with --attach=${botId}` };
  }

  const env = tokenEnv || tokenEnvFor(botId);
  const masterId = registry.master || bots[0]?.id || '';

  // The userbot path has no token yet; that is the point of the step after this.
  if (tokenSource === 'paste') {
    const shape = validateToken(token);
    if (!shape.ok) return { ok: false, step: 'plan', reason: shape.reason };
    const claimed = String(shape.botId);
    // Two bots cannot share one poller. Compare against the registry's tokens
    // AND against the raw token values the caller knows about (the master file),
    // because a token can be present in the master file for a bot that is not
    // registered here.
    for (const bot of bots) {
      if (bot.telegram?.tokenEnv === env) {
        return { ok: false, step: 'plan', reason: `tokenEnv "${env}" is already used by "${bot.id}"` };
      }
    }
    if (bots.some((b) => b.telegram?.token === shape.token)) {
      return { ok: false, step: 'plan', reason: 'that token is already registered to another bot — one token is one poller' };
    }
    return {
      ok: true,
      step: 'plan',
      plan: { mode: 'create', id: botId, name: String(name).trim(), tokenEnv: env, token: shape.token, telegramBotId: claimed, tokenSource, masterId },
    };
  }

  return {
    ok: true,
    step: 'plan',
    plan: { mode: 'create', id: botId, name: String(name).trim(), tokenEnv: env, token: '', telegramBotId: null, tokenSource, masterId },
  };
}

/**
 * Refuse a token that is already the value of another key in the master file.
 * A second bot polling one token is the failure BOT-5 exists to prevent, and the
 * registry check alone would not catch a stale line.
 */
export function tokenOwnershipConflict(masterTokens = {}, { token = '', tokenEnv = '' } = {}) {
  for (const [key, value] of Object.entries(masterTokens || {})) {
    if (!value) continue;
    if (key === tokenEnv) continue;
    if (token && value === token) return `the token is already the value of ${key} in the master token file`;
  }
  return '';
}

/** Roll the step receipts into one answer the caller can act on. */
export function summarizeRun(steps = []) {
  const completed = steps.filter((s) => s.status === 'done').map((s) => s.id);
  const failed = steps.filter((s) => s.status === 'failed');
  const remaining = PIPELINE_STEPS.filter((s) => !steps.some((r) => r.id === s.id && r.status === 'done')).map((s) => s.id);
  return {
    ok: failed.length === 0 && remaining.length === 0,
    completed,
    remaining,
    failed: failed.map((s) => ({ id: s.id, reason: s.detail || '' })),
  };
}
