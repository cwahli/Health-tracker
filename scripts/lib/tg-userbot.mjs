/**
 * tg-userbot.mjs — the userbot that drives @BotFather.
 *
 * WHY A USERBOT AT ALL
 * --------------------
 * Telegram mints a bot token in exactly one place: a conversation with
 * @BotFather. BotFather answers *user accounts*, never bots, so a server cannot
 * ask it for a token on its own. Driving it with one phone login is the only way
 * "type a name, get a working bot" can be true without a human tapping through
 * menus every time.
 *
 * WHAT THAT COSTS, STATED PLAINLY
 * -------------------------------
 * The session string this stores is full access to the operator's Telegram
 * account. It lives on the host, mode 600, in `~/.config/bot-host/`, and is
 * never printed, logged, committed or sent anywhere. Automating @BotFather is
 * also a userbot action — Telegram can throttle it — so a refusal is always
 * survivable: the paste path in `scripts/bot-forge.mjs` needs none of this and
 * is what the forge assumes when it works.
 *
 * TESTABILITY
 * -----------
 * The BotFather conversation is `negotiateBotToken()`: it takes a `send`
 * function and returns the token plus the transcript. That is the part with the
 * logic (a taken username must retry, not give up), and it is driven by fixtures
 * in `scripts/assert-bot-forge.test.mjs` with no account and no library. The
 * teleproto client is a thin wrapper around it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describeUserbot, parseBotFatherToken, usernameCandidates } from './bot-forge-core.mjs';

export const USERBOT_HANDLE = 'BotFather';

export function sessionPath(env = process.env) {
  const explicit = String(env.TELEGRAM_USER_SESSION || '').trim();
  if (explicit) return explicit;
  return path.join(os.homedir(), '.config', 'bot-host', 'tg-user.session');
}

export function apiCredentials(env = process.env) {
  return {
    apiId: String(env.TELEGRAM_API_ID || '').trim(),
    apiHash: String(env.TELEGRAM_API_HASH || '').trim(),
  };
}

/**
 * Can the userbot run? Never throws: an unconfigured host is the normal state on
 * a fresh machine, and the answer has to be a sentence the operator can act on
 * plus the commands only they can run.
 */
export async function userbotState(env = process.env) {
  const { apiId, apiHash } = apiCredentials(env);
  const file = sessionPath(env);
  let moduleAvailable = false;
  try {
    await import('teleproto');
    moduleAvailable = true;
  } catch {
    moduleAvailable = false;
  }
  return describeUserbot({ moduleAvailable, apiId, apiHash, sessionFile: file, sessionExists: fs.existsSync(file) });
}

/**
 * Ask BotFather for a new bot and read the token out of its reply.
 *
 * The sequence BotFather expects is fixed and unforgiving: `/newbot`, then a
 * display name, then a username, and the username is globally unique. A taken
 * name is answered with a complaint, not a token, so the caller must walk its
 * candidates instead of stopping at the first collision.
 */
export async function negotiateBotToken({ send, name, candidates = usernameCandidates(name), maxTurns = 12 }) {
  if (typeof send !== 'function') return { ok: false, reason: 'no BotFather transport was provided' };

  const transcript = [];
  const turns = [];
  const step = async (text) => {
    const reply = String((await send(text)) ?? '');
    transcript.push({ sent: text, reply });
    turns.push(reply);
    return reply;
  };

  const first = await step('/newbot');
  if (parseBotFatherToken(first).ok) {
    return { ok: true, token: parseBotFatherToken(first).token, turns: transcript };
  }

  const afterName = await step(name);
  const early = parseBotFatherToken(afterName);
  if (early.ok) return { ok: true, token: early.token, turns: transcript };

  let seen = 0;
  for (const candidate of candidates) {
    if (seen >= maxTurns) break;
    seen += 1;
    const reply = await step(candidate);
    const parsed = parseBotFatherToken(reply);
    if (parsed.ok) return { ok: true, token: parsed.token, username: candidate, turns: transcript };
    if (!parsed.taken) {
      // An unrecognised answer is not a collision. Retrying the next candidate
      // would look like progress while nothing was happening, so stop and hand
      // back what BotFather actually said.
      return { ok: false, reason: `@BotFather answered unexpectedly: ${reply.slice(0, 200)}`, turns: transcript };
    }
  }
  return {
    ok: false,
    reason: `every candidate username was taken (${candidates.join(', ')}) — retry with --username=<something_available_bot>`,
    turns: transcript,
  };
}

/** Load the saved session and build a client. Lazy, so a host without the library still runs. */
async function connect({ env = process.env } = {}) {
  const { apiId, apiHash } = apiCredentials(env);
  const file = sessionPath(env);
  let TelegramClient;
  let StringSession;
  try {
    ({ TelegramClient, StringSession } = await import('teleproto'));
  } catch (err) {
    return { ok: false, reason: `teleproto is not installed (${err.message}) — run: npm install (on the bot host)` };
  }
  if (!apiId || !apiHash) return { ok: false, reason: 'TELEGRAM_API_ID / TELEGRAM_API_HASH are not set' };
  if (!fs.existsSync(file)) return { ok: false, reason: `no userbot session at ${file} — run: node scripts/bot-forge.mjs userbot-login` };

  const session = fs.readFileSync(file, 'utf8').trim();
  const client = new TelegramClient(new StringSession(session), Number(apiId), apiHash, { connectionRetries: 3 });
  await client.connect();
  return { ok: true, client, file };
}

/**
 * A `send` that resolves with BotFather's next message.
 *
 * The reply is matched by waiting for the next inbound message from BotFather
 * rather than by sleeping — a fixed delay is how an automation reports a token
 * it never received.
 */
function replyTransport(client) {
  let waiting = null;
  client.addEventHandler((event) => {
    try {
      const message = event?.message;
      if (!message) return;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(String(message.message || ''));
      }
    } catch {
      /* an unparseable event is not a reply */
    }
  });

  return async (text) => {
    await client.sendMessage(USERBOT_HANDLE, { message: text });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting = null;
        reject(new Error(`@BotFather did not answer "${text.slice(0, 40)}" within 60s`));
      }, 60_000);
      waiting = (reply) => {
        clearTimeout(timer);
        resolve(reply);
      };
    });
  };
}

/** Mint a token through @BotFather. Refuses cleanly when the userbot is not configured. */
export async function createBot({ name, username = '', env = process.env } = {}) {
  const state = await userbotState(env);
  if (!state.configured) return { ok: false, reason: state.reason, hostCommands: state.hostCommands };

  const connected = await connect({ env });
  if (!connected.ok) return { ok: false, reason: connected.reason, hostCommands: state.hostCommands };

  try {
    const candidates = username ? [username, ...usernameCandidates(name)] : usernameCandidates(name);
    const result = await negotiateBotToken({ send: replyTransport(connected.client), name, candidates });
    if (!result.ok) return { ok: false, reason: result.reason, hostCommands: state.hostCommands };
    return { ok: true, token: result.token, username: result.username || '', turns: result.turns };
  } catch (err) {
    return { ok: false, reason: `@BotFather automation failed: ${err.message}`, hostCommands: state.hostCommands };
  } finally {
    try {
      await connected.client.disconnect();
    } catch {
      /* the token is the valuable thing; a failed disconnect is not */
    }
  }
}

/**
 * Send a message as the operator.
 *
 * Part of this module on purpose: it is the same session, and it is how the
 * project-manager role will reach a stalled agent's chat (a message from the
 * operator is what starts that agent's turn). Not used by the forge pipeline.
 */
export async function sendAsUser(chatId, text, { env = process.env } = {}) {
  const connected = await connect({ env });
  if (!connected.ok) return { ok: false, reason: connected.reason };
  try {
    await connected.client.sendMessage(chatId, { message: String(text) });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    try {
      await connected.client.disconnect();
    } catch {
      /* see createBot */
    }
  }
}

/**
 * The one-time login. Interactive by nature: Telegram sends a code to the phone
 * and may then ask for the account's 2FA password. The session is written mode
 * 600 and echoed nowhere.
 */
export async function login({ env = process.env, io = {} } = {}) {
  const ask = io.ask || (async (question) => {
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  });
  const say = io.say || ((line) => console.log(line));

  const { apiId, apiHash } = apiCredentials(env);
  if (!apiId || !apiHash) {
    return {
      ok: false,
      reason: 'TELEGRAM_API_ID / TELEGRAM_API_HASH are not set. Create an app at https://my.telegram.org, then export both.',
    };
  }
  let TelegramClient;
  let StringSession;
  try {
    ({ TelegramClient, StringSession } = await import('teleproto'));
  } catch (err) {
    return { ok: false, reason: `teleproto is not installed (${err.message})` };
  }

  const file = sessionPath(env);
  const client = new TelegramClient(new StringSession(''), Number(apiId), apiHash, { connectionRetries: 3 });
  await client.start({
    phoneNumber: async () => String(await ask('Telegram phone number (international format): ')).trim(),
    phoneCode: async () => String(await ask('login code from Telegram: ')).trim(),
    password: async () => String(await ask('2FA password (blank if none): ')).trim(),
    onError: (err) => say(`login error: ${err.message}`),
  });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, client.session.save(), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  say(`session saved to ${file} (mode 600). This file is full access to your Telegram account — never commit it.`);
  try {
    await client.disconnect();
  } catch {
    /* the session is already on disk */
  }
  return { ok: true, sessionFile: file };
}
