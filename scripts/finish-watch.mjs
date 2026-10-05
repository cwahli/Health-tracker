#!/usr/bin/env node
/**
 * finish-watch — forward answers the bot did not produce.
 *
 * When a run finishes in a session bound to a Telegram chat but the bot did
 * not start that run (typed in the opencode web UI, the TUI, anywhere else),
 * the chat hears about it here: one delivery of the run's final assistant
 * text, then the thread continues on either surface (same opencode session).
 *
 * Echo safety (the whole design):
 * - a run the bot started is never forwarded: `leases.json` marks chats with
 *   a live bot turn, and while marked the watermark is CONSUMED (advanced
 *   past the bot's messages) rather than delivered;
 * - each session carries a watermark (last delivered message id): a message
 *   is delivered at most once, and a restart or first sighting consumes
 *   without delivering, so history is never dumped into chat;
 * - only completed assistant messages with real text travel; streaming
 *   fragments (no `completed` stamp) wait for the next poll.
 *
 * Scope: this host's serve (localhost) only — phone-hosted bots resolve
 * nothing here. Per-chat opt-out via the `notify: false` chat pref
 * (`/notify off`); default is on.
 *
 * Run: `node scripts/finish-watch.mjs` (systemd `finish-watch.service`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TelegramApi, chunkText } from './lib/tg-api.mjs';

export const POLL_MS = Number(process.env.FINISH_WATCH_POLL_MS) || 15000;
export const SERVE_URL = (process.env.OPENCODE_WEB_UPSTREAM || 'http://127.0.0.1:4096').replace(/\/+$/, '');
export const STATE_ROOT = process.env.FINISH_WATCH_STATE || path.join(os.homedir(), '.local', 'state', 'bot-host');
export const BOT_ENV_DIR = process.env.FINISH_WATCH_ENV_DIR || path.join(os.homedir(), '.config', 'bot-host');
export const SERVE_ENV_FILE = process.env.FINISH_WATCH_SERVE_ENV
  || path.join(os.homedir(), '.config', 'opencode-web', 'serve.env');
export const WATERMARK_FILE = path.join(STATE_ROOT, 'finish-watch.json');

/** Serve password from the 600 env file (same file opencode-web.service uses). */
export function servePassword(envFile = SERVE_ENV_FILE) {
  try {
    const line = fs.readFileSync(envFile, 'utf8').split('\n')
      .map((l) => l.trim()).find((l) => l.startsWith('OPENCODE_SERVER_PASSWORD='));
    return line ? line.slice('OPENCODE_SERVER_PASSWORD='.length).trim() : '';
  } catch {
    return '';
  }
}

export function serveAuthHeader(envFile = SERVE_ENV_FILE) {
  const pw = servePassword(envFile);
  return pw ? `Basic ${Buffer.from(`opencode:${pw}`).toString('base64')}` : '';
}

async function serveGet(pathname, { auth } = {}) {
  const res = await fetch(`${SERVE_URL}${pathname}`, {
    headers: auth ? { authorization: auth } : {},
  });
  if (!res.ok) throw new Error(`serve ${pathname} -> ${res.status}`);
  return res.json();
}

/** Plain-text body of one message record, or '' when there is none to send. */
export function assistantTextOf(msg) {
  if (!msg || msg.type !== 'assistant') return '';
  if (!msg.time?.completed) return ''; // still streaming — next poll
  const parts = Array.isArray(msg.content) ? msg.content : [];
  const text = parts.filter((p) => p?.type === 'text' && String(p.text || '').trim())
    .map((p) => String(p.text).trim()).join('\n\n').trim();
  return text;
}

export const GRACE_MS = Number(process.env.FINISH_WATCH_GRACE_MS) || 60000;

/**
 * Which assistant messages to deliver. `messages` is the API list (newest
 * first); `watermarkId` is the last id already delivered-or-consumed.
 * Unknown watermark (first sighting, restart gap) consumes without
 * delivering — history must never dump into chat.
 */
export function splitNewMessages(messages, watermarkId) {
  const ordered = [...(messages || [])].reverse(); // oldest first
  if (!watermarkId) {
    const last = ordered.filter((m) => m?.id).at(-1);
    return { forward: [], consumeTo: last?.id || null };
  }
  const idx = ordered.findIndex((m) => m?.id === watermarkId);
  const fresh = idx === -1 ? ordered : ordered.slice(idx + 1);
  const forward = fresh.filter((m) => assistantTextOf(m));
  const last = ordered.filter((m) => m?.id).at(-1);
  return { forward, consumeTo: last?.id || watermarkId };
}

/** Newest message id in a list, or null. */
export function newestId(messages) {
  return [...(messages || [])].reverse().find((m) => m?.id)?.id || null;
}

/** Session ids currently running a bot turn, derived from leases + sessions. */
export function leaseBusySessions(leases, sessionsByChat) {
  const busy = new Set();
  for (const chatId of Object.keys(leases || {})) {
    const sid = sessionsByChat?.[String(chatId)];
    if (sid) busy.add(sid);
  }
  return busy;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function listBotDirs() {
  try {
    return fs.readdirSync(STATE_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !/^(test-lease|test-sweep|shared-free-lanes|agent-heartbeat)/.test(e.name))
      .map((e) => e.name)
      .filter((n) => fs.existsSync(path.join(STATE_ROOT, n, 'sessions.json')));
  } catch {
    return [];
  }
}

/** chatId -> sessionId across every workspace row in sessions.json. */
export function sessionsByChat(botId) {
  const raw = readJson(path.join(STATE_ROOT, botId, 'sessions.json'), {});
  const out = {};
  for (const [chatId, row] of Object.entries(raw || {})) {
    const cut = String(row || '').indexOf('\0');
    const sid = cut === -1 ? String(row || '').trim() : String(row).slice(cut + 1).trim();
    if (/^ses_/.test(sid)) out[String(chatId)] = sid;
  }
  return out;
}

export function chatPrefs(botId) {
  return readJson(path.join(STATE_ROOT, botId, 'prefs.json'), {});
}

export function botToken(botId) {
  try {
    const line = fs.readFileSync(path.join(BOT_ENV_DIR, `${botId}.env`), 'utf8').split('\n')
      .map((l) => l.trim()).find((l) => l && !l.startsWith('#') && l.includes('='));
    return line ? line.split('=').slice(1).join('=').trim() : '';
  } catch {
    return '';
  }
}

export function loadWatermarks() {
  return readJson(WATERMARK_FILE, { v: 1, byBot: {} });
}

export function saveWatermarks(doc) {
  try {
    fs.mkdirSync(path.dirname(WATERMARK_FILE), { recursive: true });
    fs.writeFileSync(WATERMARK_FILE, `${JSON.stringify(doc)}\n`, 'utf8');
  } catch {
    // watermark loss only re-consumes; delivery stays at-most-once per round
  }
}

/**
 * One poll round. `io` is injectable (serve getter, Telegram sender) so the
 * sensor drives the whole decision without network.
 */
export async function pollOnce({
  bots = null,
  getMessages = null,
  getTitle = null,
  send = null,
  watermarks = null,
  persist = true,
} = {}) {
  const auth = serveAuthHeader();
  const get = getMessages || (async (sessionId) => {
    const j = await serveGet(`/api/session/${encodeURIComponent(sessionId)}/message?limit=20`, { auth });
    return j?.data || j || [];
  });
  const titleOf = getTitle || (async (sessionId) => {
    try {
      const j = await serveGet(`/api/session/${encodeURIComponent(sessionId)}`, { auth });
      return (j?.data || j)?.title || '';
    } catch {
      return '';
    }
  });
  const deliver = send || (async (botId, chatId, text) => {
    const token = botToken(botId);
    if (!token) return;
    const api = new TelegramApi(token);
    for (const chunk of chunkText(text)) await api.sendMessage(chatId, chunk);
  });
  const marks = watermarks || loadWatermarks();
  marks.byBot = marks.byBot || {};
  const delivered = [];

  for (const botId of bots || listBotDirs()) {
    const sessions = sessionsByChat(botId);
    if (!Object.keys(sessions).length) continue;
    const leases = readJson(path.join(STATE_ROOT, botId, 'leases.json'), {});
    const busy = leaseBusySessions(leases, sessions);
    const prefs = chatPrefs(botId);
    marks.byBot[botId] = marks.byBot[botId] || {};
    for (const [chatId, sessionId] of Object.entries(sessions)) {
      if (prefs?.[String(chatId)]?.notify === false) continue;
      let messages = [];
      try {
        messages = await get(sessionId);
      } catch {
        continue; // serve hiccup: watermark untouched, next round retries
      }
      // Marks are {id, busyAt}; a bare string is a pre-grace file — keep it.
      const rawMark = marks.byBot[botId][sessionId] || null;
      const markId = typeof rawMark === 'string' ? rawMark : rawMark?.id || null;
      const busyAt = typeof rawMark === 'object' ? Number(rawMark?.busyAt || 0) : 0;
      const setMark = (id, at) => { marks.byBot[botId][sessionId] = { id, busyAt: at || 0 }; };
      if (busy.has(sessionId)) {
        // Bot turn in flight: consume (including streaming tails) so its
        // answer can never be forwarded as someone else's.
        setMark(newestId(messages) || markId, Date.now());
        continue;
      }
      if (busyAt && Date.now() - busyAt < GRACE_MS) {
        // Settle window after a bot turn: the store may commit the bot's
        // answer after the lease is already gone (separate processes). A
        // poll landing in that gap would read the bot's answer as new and
        // echo it — consume instead. A web answer in the same window is
        // missed, never duplicated: the safe direction.
        setMark(newestId(messages) || markId, busyAt);
        continue;
      }
      const { forward, consumeTo } = splitNewMessages(messages, markId);
      setMark(consumeTo || markId, 0);
      if (!forward.length) continue;
      const title = await titleOf(sessionId);
      const head = title ? `*${title}* finished` : 'A run finished';
      for (const m of forward) {
        const text = assistantTextOf(m);
        if (!text) continue;
        await deliver(botId, chatId, `🌐 ${head}:\n\n${text}`);
        setMark(m.id, 0);
        delivered.push({ botId, chatId, sessionId, messageId: m.id });
      }
    }
  }
  if (persist) saveWatermarks(marks);
  return { delivered, watermarks: marks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!servePassword()) {
    console.error('[finish-watch] no serve password; refusing to poll anonymously');
    process.exit(1);
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { delivered } = await pollOnce();
      if (delivered.length) console.log(`[finish-watch] forwarded ${delivered.length} answer(s)`);
    } catch (err) {
      console.error(`[finish-watch] round failed: ${String(err?.message || err).slice(0, 160)}`);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, POLL_MS);
}
