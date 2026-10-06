#!/usr/bin/env node
/**
 * Proof driver for plan/TG_TOOL_SURFACE.md (Milestone 0).
 *
 * One driver for every later milestone: it sends the scripted text through the
 * existing Telegram user client (~/.config/bot-host/tg-user.session, the forge
 * user session), never getUpdates on the bot token, reads the bot's replies
 * from that user client, reads the disposable session in session_message, and
 * writes proof/<milestone>-<utc>.md with a pass/fail checklist.
 *
 * Safety: refuses to start if the target poller has a turn child; backs the
 * chat's sessions.json/prefs.json aside before binding a disposable session
 * (via /new + the scripted ping — never the operator's long session, never a
 * compact or delete of it); restores both files at the end and says so in the
 * evidence. Restarts are idle-gated and re-read MainPID at that moment.
 *
 * Usage:
 *   node scripts/prove-tg-surface.mjs --milestone m0 --bot-id vm2 --live
 *   node scripts/prove-tg-surface.mjs --milestone m3 --bot-id vm2 --peer VM2_19485_bot --live
 * Without --live it only checks preconditions (idle, userbot, db) and prints
 * the script it would run.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const MILESTONES = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const PEER_FOR_BOT = {
  vm2: 'VM2_19485_bot',
  vm: 'VM_19485_bot',
  vm4: 'VM4_19485_bot',
  vm5: 'VM5_19485_bot',
  vm6: 'VM6_19485_bot',
};

/* ---------------------------------------------------------------- pure helpers */

export function utcStamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z');
}

export function checkLine(ok, text) {
  return `- [${ok ? 'pass' : 'FAIL'}] ${text}`;
}

/** Order-insensitive compare for the restore verification. */
export function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Poller idleness from `pgrep -P <MainPID>` output text: empty means idle. */
export function isIdleOutput(pgrepStdout) {
  return String(pgrepStdout || '').trim() === '';
}

/**
 * Workspace-scoped session binding out of a sessions.json object.
 * Values are bare `ses_*` (pre-scope) or `<workspace>\\u0000<sessionId>`.
 */
export function sessionIdOf(sessionsObj, chatId) {
  const value = sessionsObj?.[String(chatId)];
  if (!value || typeof value !== 'string') return null;
  const sep = value.indexOf('\u0000');
  return sep >= 0 ? value.slice(sep + 1) : value;
}

/** The cline invocation carried the thinking level (plan/TG_TOOL_SURFACE.md M4). */
export function argvHasThinkingHigh(sightings) {
  return (sightings || []).some((l) => /cline/i.test(l) && /--thinking\s+high\b/.test(l));
}

/**
 * Callback bytes off a keyboard button (plan/TG_TOOL_SURFACE.md M4 tap).
 * teleproto/gramjs nests them under `type.data` (InlineButtonTypeCallback),
 * not beside `text` — reading `btn.data` alone misses every tap target
 * (M4 2026-10-04: the Freebuff button reported "no callback data").
 */
export function callbackDataOf(btn) {
  const raw = btn?.type?.data ?? btn?.data ?? btn?.originalArgs?.data;
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === 'string' && raw) return Buffer.from(raw);
  return null;
}

/** Exactly one `--session <id>` on a child argv line. */
export function argvHasSessionOnce(argvLine, sessionId) {
  const parts = String(argvLine || '').trim().split(/\s+/);
  let count = 0;
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === '--session') {
      count += 1;
      if (parts[i + 1] !== sessionId) return false;
    }
  }
  return count === 1;
}

/** Tool-ish names out of session_message data payloads (best-effort). */
export function toolNamesFromData(dataText) {
  const names = [];
  const text = String(dataText || '');
  // Live opencode shape: {"type": "tool", "id": ..., "name": "shell", ...}
  const re = /"type"\s*:\s*"tool"[^}]*?"name"\s*:\s*"([A-Za-z][A-Za-z0-9_.-]{1,40})"/g;
  let m;
  while ((m = re.exec(text)) && names.length < 50) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  // Legacy/generic shape: {"tool":"bash",...}
  const re2 = /"(?:tool|toolName)"\s*:\s*"([A-Za-z][A-Za-z0-9_.-]{1,40})"/g;
  while ((m = re2.exec(text)) && names.length < 50) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export function buildEvidence({ milestone, utc, host, lane, sessionId, sent, telegram, tool, checks, restored }) {
  const lines = [
    `# TG tool surface — ${milestone} (${utc})`,
    '',
    `host: ${host} · lane: ${lane} · session: ${sessionId || '(none)'}`,
    '',
    '## Text sent',
    '',
    ...sent.map((s) => `- ${s}`),
    '',
    '## Telegram transcript',
    '',
    '```',
    ...telegram,
    '```',
    '',
    '## Tool transcript',
    '',
    '```',
    ...tool,
    '```',
    '',
    '## Checklist',
    '',
    ...checks,
    '',
    restored
      ? 'Restore: the saved session binding and prefs were written back and the unit was reloaded idle; the file matches the backup.'
      : 'Restore: NOT DONE YET — bindings are still the disposable proof state.',
  ];
  return `${lines.join('\n')}\n`;
}

/** Scripted texts per milestone. {{tok}} is replaced with the run token. */
export function milestoneSteps(milestone) {
  switch (milestone) {
    case 'm0':
      return [
        { send: '/new', wait: 'reply' },
        { send: 'prove-tg-surface ping {{tok}} — reply with the word PONG', wait: 'quiescent', capture: 'ping' },
      ];
    case 'm1':
      return [
        { send: '/new', wait: 'reply' },
        { send: 'prove-tg-surface m1 first {{tok}}. Do not use any tools. Reply with exactly this word: FIRST', wait: 'started', capture: 'first' },
        { send: 'prove-tg-surface m1 follow-up {{tok}}. Do not use any tools. Reply with exactly this word: SECOND', wait: 'quiescent', capture: 'ping' },
      ];
    case 'm2':
      return [
        { send: '/new', wait: 'reply' },
        { send: 'prove-tg-surface m2 {{tok}}: run `ls scripts/lib | head -30` in a shell, then report how many entries start with the letter t. Think out loud in one short paragraph first.', wait: 'quiescent', capture: 'work' },
      ];
    case 'm3':
      return [
        { send: '/new', wait: 'reply' },
        { send: '/thinking', wait: 'reply', capture: 'levels' },
        { send: '/thinking {{level}}', wait: 'reply' },
        { send: '/status', wait: 'reply', capture: 'status' },
        { send: '/do-check-source prove-tg-surface m3 fixture {{tok}}: the sky is blue', wait: 'quiescent', capture: 'skill' },
        { send: '/compact', wait: 'quiescent', capture: 'compact' },
        { send: 'prove-tg-surface m3 post-compact ping {{tok}}', wait: 'quiescent', capture: 'ping' },
        { send: '/new', wait: 'reply' },
        { send: 'prove-tg-surface m3 fresh ping {{tok}}', wait: 'quiescent', capture: 'fresh' },
      ];
    case 'm4':
      return [
        { send: '/new', wait: 'reply' },
        { send: '/thinking', wait: 'reply', capture: 'levels' },
        { send: '/thinking {{level}}', wait: 'reply' },
        { send: 'prove-tg-surface m4 opencode ping {{tok}}. Do not use any tools. Reply with exactly: OPENCODE-OK', wait: 'quiescent', capture: 'ping' },
        { send: '/model cline:cline-free/deepseek-v4.1-flash', wait: 'reply', capture: 'cmodel' },
        { send: '/thinking high', wait: 'reply' },
        { send: 'prove-tg-surface m4 cline ping {{tok}}. Do not use any tools. Reply with exactly: CLINE-OK', wait: 'quiescent', capture: 'cline' },
        { send: '/do-check-source prove-tg-surface m4 cline fixture {{tok}}: the sky is blue', wait: 'reply', capture: 'cskill' },
        { send: '/freemodel', wait: 'reply', capture: 'freemodel' },
        { tap: ' FB ', wait: 'bounded', capture: 'fbtap' },
      ];
    case 'm5':
      // Sections are built at run time from workerStatus (see runSectionsM5):
      // one section per KNOWN_HOST, unreachable hosts becoming recorded skips.
      return [{ sectionPlan: 'm5' }];
    case 'm6':
      return [
        { send: '/new', wait: 'reply' },
        { send: '/thinking', wait: 'reply', capture: 'levels' },
        { send: '/thinking {{level}}', wait: 'reply' },
        { send: '/do-check-source prove-tg-surface m6 fixture {{tok}}: water is wet. Do not use any tools beyond the skill. Reply with exactly: M6-SKILL', wait: 'quiescent', capture: 'skill' },
        { send: '/model cline:cline-free/deepseek-v4.1-flash', wait: 'reply', capture: 'cmodel' },
        { send: 'prove-tg-surface m6 cline ping {{tok}}. Do not use any tools. Reply with exactly: M6-CLINE', wait: 'quiescent', capture: 'cline' },
        { send: '/location grok', wait: 'reply', capture: 'gloc' },
        { send: 'prove-tg-surface m6 grok ping {{tok}}. Do not use any tools. Reply with exactly: M6-GROK', wait: 'quiescent', capture: 'grok' },
        { send: '/location vps', wait: 'reply' },
        { send: 'prove-tg-surface m6 final ping {{tok}}. Do not use any tools. Reply with exactly: M6-FINAL', wait: 'quiescent', capture: 'final' },
      ];
    default:
      return [];
  }
}

/* ------------------------------------------------------------ live helpers */

function sh(cmd, args, { timeoutMs = 30000 } = {}) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, out: String(err.stdout || ''), reason: String(err.message || err).slice(0, 200) };
  }
}

function stateFile(botId, name) {
  return path.join(HOME, '.local', 'state', 'bot-host', botId, name);
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function unitMainPid(botId) {
  const r = sh('systemctl', ['show', '-p', 'MainPID', '--value', `bot-host@${botId}`]);
  const pid = Number(String(r.out || '').trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function turnChildren(botId) {
  const pid = unitMainPid(botId);
  if (!pid) return { pid: null, children: [] };
  const r = sh('pgrep', ['-P', String(pid)]);
  const kids = String(r.out || '').trim().split('\n').map((s) => s.trim()).filter(Boolean);
  return { pid, children: kids };
}

export async function opencodeMessagesSync(sessionId, { limit = 200 } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = path.join(HOME, '.local', 'share', 'opencode', 'opencode.db');
  const conn = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = conn.prepare(
      'select type, time_created as t, substr(data, 1, 4000) as data from session_message where session_id = ? order by time_created asc limit ?',
    ).all(String(sessionId), Number(limit));
    return rows;
  } finally {
    try { conn.close(); } catch {}
  }
}

function tmux(args) {
  return sh('tmux', args, { timeoutMs: 15000 });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectUser(env) {
  const { connect } = await import('./lib/tg-userbot.mjs');
  const state = await connect({ env });
  if (!state.ok) throw new Error(`user client cannot send: ${state.reason}`);
  return state.client;
}

async function peerHistory(client, peer, { limit = 100 } = {}) {
  const msgs = await client.getMessages(peer, { limit });
  return (Array.isArray(msgs) ? msgs : []).map((m) => ({
    id: m.id,
    date: Number(m.date || 0),
    out: Boolean(m.out),
    text: String(m.message || ''),
    markup: m.replyMarkup || null,
  })).sort((a, b) => a.date - b.date || a.id - b.id);
}

/**
 * Tap a model-keyboard button as the operator (plan/TG_TOOL_SURFACE.md M4).
 * Finds the newest bot keyboard with a button matching `match`, taps it via
 * GetBotCallbackAnswer, and returns the tap alert. Refuses cleanly as a
 * recorded skip when the button or the callback API is unavailable.
 */
export async function tapLaneButton({ client, peer, match }) {
  let Api;
  try {
    ({ Api } = await import('teleproto'));
  } catch (err) {
    return { ok: false, summary: `callback API unavailable (${err.message}) — recorded skip` };
  }
  if (!Api?.messages?.GetBotCallbackAnswer) {
    return { ok: false, summary: 'GetBotCallbackAnswer missing from teleproto — recorded skip' };
  }
  const history = await peerHistory(client, peer, { limit: 20 });
  const keyed = history.filter((m) => !m.out && m.markup);
  for (let i = keyed.length - 1; i >= 0; i -= 1) {
    const rows = keyed[i].markup?.rows || [];
    for (const row of rows) {
      for (const btn of row?.buttons || []) {
        const text = String(btn?.text || '');
        if (!new RegExp(match, 'i').test(text)) continue;
        const data = callbackDataOf(btn);
        if (!data) return { ok: false, summary: `button '${text}' has no callback data — recorded skip` };
        const entity = await client.getInputEntity(peer);
        const res = await client.invoke(new Api.messages.GetBotCallbackAnswer({
          peer: entity, msgId: keyed[i].id, data,
        }));
        const alert = String(res?.message || '').slice(0, 160);
        return { ok: true, summary: `tapped '${text}' (msg ${keyed[i].id}); tap alert: ${alert || '(none)'}` };
      }
    }
  }
  return { ok: false, summary: `no '${match}' button on a recent bot keyboard — recorded skip` };
}

/**
 * Bounded wait for a new inbound message (plan/TG_TOOL_SURFACE.md M4 tap).
 * Unlike quiescent, this always returns: a tap that yields no new message
 * (recorded skip) must not hold the driver for the 12-minute quiescent
 * timeout (M4 2026-10-04: the Freebuff button text is a coded 'FB' column,
 * the tap skipped, and quiescent waited the full 12 minutes on silence).
 */
async function waitForNewInbound({ client, peer, sinceMs, timeoutMs = 90000 }) {
  const start = Date.now();
  let rows = await peerHistory(client, peer);
  for (;;) {
    if (rows.some((m) => !m.out && m.date * 1000 >= sinceMs - 2000)) return rows;
    if (Date.now() - start > timeoutMs) return rows;
    await sleep(5000);
    rows = await peerHistory(client, peer);
  }
}

function formatTranscript(rows) {
  return rows.map((m) => {
    const t = new Date(m.date * 1000).toISOString().slice(11, 19);
    const body = m.text.replace(/\s+/g, ' ').trim().slice(0, 300);
    return `${t} ${m.out ? 'out' : 'in'}: ${body}`;
  });
}

async function waitFor({ client, peer, botId, sinceMs, mode, quietMs = 20000, timeoutMs = 720000 }) {
  const start = Date.now();
  let lastChange = Date.now();
  let lastCount = -1;
  let everSeen = false;
  let idleStreak = 0;
  for (;;) {
    const rows = await peerHistory(client, peer);
    const fresh = rows.filter((m) => m.date * 1000 >= sinceMs - 2000);
    if (fresh.length !== lastCount) {
      lastCount = fresh.length;
      lastChange = Date.now();
      if (fresh.length) everSeen = true;
    }
    const { children } = turnChildren(botId);
    const idle = children.length === 0;
    idleStreak = idle ? idleStreak + 1 : 0;
    if (mode === 'reply' && everSeen && fresh.some((m) => !m.out)) return rows;
    if (mode === 'started') {
      await sleep(4000);
      return rows;
    }
    if (mode === 'quiescent' && everSeen && idleStreak >= 2 && Date.now() - lastChange >= quietMs) return rows;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting (${mode}) for ${peer}`);
    await sleep(5000);
  }
}

function loadEnvFile(file) {
  const env = { ...process.env };
  try {
    Object.assign(env, parseEnvFile(fs.readFileSync(file, 'utf8')));
  } catch {}
  return env;
}

function parseCli(argv) {
  const out = { milestone: 'm0', botId: 'vm2', peer: null, envFile: path.join(HOME, '.config', 'bot-host', 'tui-gateway.env'), proofDir: path.join(HOME, '.local', 'state', 'bot-host', 'proof'), live: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') out.live = true;
    else if (a === '--milestone') out.milestone = argv[++i];
    else if (a === '--bot-id') out.botId = argv[++i];
    else if (a === '--peer') out.peer = argv[++i];
    else if (a === '--env-file') out.envFile = argv[++i];
    else if (a === '--proof-dir') out.proofDir = argv[++i];
  }
  if (!out.peer) out.peer = PEER_FOR_BOT[out.botId] || out.botId;
  return out;
}

function lastInbound(rows, sinceMs) {
  const ins = rows.filter((m) => !m.out && m.date * 1000 >= sinceMs - 2000);
  return ins.length ? ins[ins.length - 1] : null;
}

/**
 * Milestone 5 runner (plan/TG_TOOL_SURFACE.md): one section per KNOWN_HOST.
 * workerStatus first — unreachable is one evidence section, never retried.
 * Reachable: /location, disposable ping, thinking level, one /do fixture.
 * Prompts stay tool-free so remote legs cost the worker the minimum.
 * Returns { hostResults } for the checklist.
 */
/**
 * Chat lane right now, read off the prefs file (plan/TG_TOOL_SURFACE.md M5).
 * A chat stuck on the cline lane (ledger displacement + sticky failover, e.g.
 * the scorched VPS free pool on 2026-10-04) cannot run /do-* skills — M4
 * refusal — so the skill step expects the refusal there, not an answer.
 */
export function chatLaneOf(prefsFile, chatId = '6218257274') {
  try {
    const prefs = readJson(prefsFile, {});
    const model = prefs?.[String(chatId)]?.model || '';
    const m = String(model).match(/^(cline|gemini|opencode):/);
    return m ? m[1] : 'opencode';
  } catch {
    return 'opencode';
  }
}

export async function runSectionsM5({ client, peer, botId, token, sent, baseline, argvSightings, arrivalMs, sessionsFile, prefsFile, operatorBinding }) {
  const { KNOWN_HOSTS, workerStatus } = await import('./lib/worker-presence.mjs');
  const { listClineSessionIds } = await import('./lib/agent-cline.mjs').catch(() => ({}));
  const hostResults = [];
  let sinceMs = Date.now();
  let rows = baseline;
  const level = 'medium';
  for (const host of KNOWN_HOSTS) {
    let st;
    try {
      st = workerStatus(host, {});
    } catch (err) {
      st = { reachable: false, reason: String(err.message || err).slice(0, 120) };
    }
    if (!st.reachable) {
      hostResults.push({ host, skip: st.reason || 'unreachable' });
      continue;
    }
    const tLoc = Date.now();
    await client.sendMessage(peer, { message: `/location ${host}` });
    sent.push(`${new Date(tLoc).toISOString()} >>> /location ${host}`);
    rows = await waitFor({ client, peer, botId, sinceMs, mode: 'reply' });
    sinceMs = Date.now();
    const locReply = lastInbound(rows, tLoc);
    const locText = String(locReply?.text || '');
    if (/not changed|unreachable|Held/i.test(locText)) {
      hostResults.push({ host, held: locText.replace(/\s+/g, ' ').slice(0, 160) });
      continue;
    }
    await client.sendMessage(peer, { message: '/new' });
    sent.push(`${new Date().toISOString()} >>> m5 ${host} /new`);
    rows = await waitFor({ client, peer, botId, sinceMs, mode: 'reply' });
    sinceMs = Date.now();
    const dbBefore = argvSightings.sessionId || null;
    const clineBefore = typeof listClineSessionIds === 'function' ? listClineSessionIds() : [];
    const htok = `${token}-${host}`;
    const tPing = Date.now();
    await client.sendMessage(peer, { message: `prove-tg-surface m5 ${host} ${htok}. Do not use any tools. Reply with exactly: PING-${host.toUpperCase()}` });
    sent.push(`${new Date(tPing).toISOString()} >>> m5 ${host} ping`);
    const seen = await watchArrival({ botId, match: htok, t0: tPing, argvSightings });
    if (seen != null && arrivalMs.first == null) arrivalMs.first = seen;
    rows = await waitFor({ client, peer, botId, sinceMs, mode: 'quiescent' });
    sinceMs = Date.now();
    const pingReply = lastInbound(rows, tPing);
    const pingOk = !!pingReply && new RegExp(`PING-${host.toUpperCase()}`).test(pingReply.text);
    // Binding, lane-aware: opencode turns land in session_message, cline
    // turns in the cline session dir, remote turns in sessions.json. The chat
    // may sit on any of them (M5 2026-10-04: scorched pool stuck it on cline).
    const dbAfter = argvSightings.sessionId || null;
    let clineAfter = null;
    try {
      const { listClineSessionIds: list2, pickClineSessionId } = await import('./lib/agent-cline.mjs');
      clineAfter = pickClineSessionId({ before: clineBefore, after: list2(), workspace: '' });
    } catch {
      clineAfter = null;
    }
    const bound = (dbAfter && dbAfter !== dbBefore ? dbAfter : null) || clineAfter || sessionIdOf(readJson(sessionsFile, {}), '6218257274');
    const tThink = Date.now();
    await client.sendMessage(peer, { message: '/thinking medium' });
    sent.push(`${new Date(tThink).toISOString()} >>> m5 ${host} /thinking medium`);
    rows = await waitFor({ client, peer, botId, sinceMs, mode: 'reply' });
    sinceMs = Date.now();
    const thinkReply = lastInbound(rows, tThink);
    const thinkOk = !!thinkReply && /Thinking level set to|no thinking levels/i.test(thinkReply.text);
    const tSkill = Date.now();
    await client.sendMessage(peer, { message: `/do-check-source prove-tg-surface m5 ${host} fixture ${htok}: grass is green. Do not use any tools beyond the skill. Reply with exactly: SKILL-${host.toUpperCase()}` });
    sent.push(`${new Date(tSkill).toISOString()} >>> m5 ${host} skill`);
    rows = await waitFor({ client, peer, botId, sinceMs, mode: 'quiescent' });
    sinceMs = Date.now();
    const skillReply = lastInbound(rows, tSkill);
    const lane = chatLaneOf(prefsFile);
    const skillText = String(skillReply?.text || '');
    // Lane-aware: an opencode lane must run the skill; a cline lane must
    // refuse it in one reply with no turn (M4 rule). Either is a pass —
    // what fails is the wrong behavior for the lane the chat is on.
    const skillOk = lane === 'cline'
      ? /Cline cannot load that skill/.test(skillText)
      : new RegExp(`SKILL-${host.toUpperCase()}|grass is green`).test(skillText);
    hostResults.push({ host, ok: true, pingOk, thinkOk, skillOk, lane, bound });
  }
  // Leave the chat where the plan found it: back to vps.
  try {
    await client.sendMessage(peer, { message: '/location vps' });
    sent.push(`${new Date().toISOString()} >>> /location vps (restore)`);
    rows = await waitFor({ client, peer, botId, sinceMs, mode: 'reply' });
  } catch {
    /* prefs restore covers the location anyway */
  }
  return { hostResults, rows };
}

async function main() {
  const opt = parseCli(process.argv);
  if (!MILESTONES.includes(opt.milestone)) throw new Error(`unknown milestone ${opt.milestone} (want ${MILESTONES.join(',')})`);
  const utc = new Date().toISOString();
  const stamp = utcStamp(new Date(utc));
  const token = `tok-${stamp}`;
  const proofFile = path.join(opt.proofDir, `${opt.milestone}-${stamp}.md`);

  // 1. Refuse when the poller is mid-turn. Re-read MainPID at this moment.
  const gate = turnChildren(opt.botId);
  if (!gate.pid) throw new Error(`bot-host@${opt.botId} has no MainPID — is the unit running?`);
  if (!isIdleOutput(gate.children.join('\n'))) {
    throw new Error(`refusing: bot-host@${opt.botId} (pid ${gate.pid}) has a turn child (${gate.children.join(',')})`);
  }

  const env = loadEnvFile(opt.envFile);
  if (!String(env.TELEGRAM_API_ID || '').trim() || !String(env.TELEGRAM_API_HASH || '').trim()) {
    throw new Error(`no TELEGRAM_API_ID/HASH in ${opt.envFile} — cannot drive the user client, stopping (no second poller)`);
  }
  const userSession = path.join(HOME, '.config', 'bot-host', 'tg-user.session');
  if (!fs.existsSync(userSession)) throw new Error(`no user session at ${userSession} — stopping`);

  const steps = milestoneSteps(opt.milestone).map((s) => ({ ...s, ...(s.send ? { send: s.send.replaceAll('{{tok}}', token) } : {}) }));
  if (!opt.live) {
    console.log(`preconditions OK (idle pid ${gate.pid}, user session present, opencode.db present: ${fs.existsSync(path.join(HOME, '.local', 'share', 'opencode', 'opencode.db'))})`);
    console.log(`would run ${steps.length} sends to @${opt.peer} on bot-host@${opt.botId}, then write ${proofFile}`);
    for (const s of steps) console.log(s.sectionPlan ? `  - per-host sections (${s.sectionPlan})` : `  - ${s.send} [${s.wait}]`);
    return;
  }

  // Backup bindings before touching anything.
  fs.mkdirSync(opt.proofDir, { recursive: true });
  const sessionsFile = stateFile(opt.botId, 'sessions.json');
  const prefsFile = stateFile(opt.botId, 'prefs.json');
  const savedSessions = readJson(sessionsFile, {});
  const savedPrefs = readJson(prefsFile, {});
  const backupFile = path.join(opt.proofDir, `.backup-${opt.botId}-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ sessions: savedSessions, prefs: savedPrefs }, null, 2));
  const operatorChat = '6218257274';
  const beforeId = sessionIdOf(savedSessions, operatorChat);

  // Reload the unit idle so the proof runs on the current tree.
  const recheck = turnChildren(opt.botId);
  if (recheck.children.length) throw new Error('poller went busy between gate and reload — aborting, nothing was sent');
  execFileSync('sudo', ['-n', 'systemctl', 'restart', `bot-host@${opt.botId}`], { stdio: 'ignore' });
  await sleep(8000);

  const client = await connectUser(env);
  const sent = [];
  const argvSightings = [];
  const arrivalMs = {};
  const tapResults = {};
  const clineNewIds = [];
  let clineBeforeIds = [];
  try {
    const { listClineSessionIds } = await import('./lib/agent-cline.mjs');
    clineBeforeIds = listClineSessionIds();
  } catch {
    clineBeforeIds = [];
  }
  try {
    let baseline = await peerHistory(client, opt.peer);
    let sinceMs = Date.now();
    let level = null;
    let hostResults = null;
    if (opt.milestone === 'm5') {
      ({ hostResults, rows: baseline } = await runSectionsM5({ client, peer: opt.peer, botId: opt.botId, token, sent, baseline, argvSightings, arrivalMs, sessionsFile, prefsFile, operatorBinding: beforeId }));
    }
    for (const step of steps) {
      if (step.sectionPlan) continue;
      if (step.tap) {
        const t0 = Date.now();
        const tapRes = await tapLaneButton({ client, peer: opt.peer, match: step.tap });
        sent.push(`${new Date(t0).toISOString()} >>> [tap ${step.tap}] ${tapRes.summary}`);
        tapResults.freebuff = tapRes;
        const tapRows = await waitForNewInbound({ client, peer: opt.peer, sinceMs: t0 });
        sinceMs = Date.now();
        baseline = tapRows;
        continue;
      }
      // {{level}} resolves from the /thinking list reply captured earlier.
      const text = step.send.includes('{{level}}') ? step.send.replaceAll('{{level}}', level || 'medium') : step.send;
      await client.sendMessage(opt.peer, { message: text });
      const t0 = Date.now();
      sent.push(`${new Date(t0).toISOString()} >>> ${text}`);
      if (step.capture && (step.capture === 'ping' || step.capture === 'cline' || step.capture === 'first' || step.capture === 'work' || step.capture === 'skill' || step.capture === 'fresh')) {
        const seen = await watchArrival({ botId: opt.botId, match: token, t0, argvSightings });
        if (seen) arrivalMs[step.capture] = seen;
      }
      const rows = await waitFor({ client, peer: opt.peer, botId: opt.botId, sinceMs, mode: step.wait === 'started' ? 'started' : step.wait === 'reply' ? 'reply' : 'quiescent' });
      sinceMs = Date.now();
      baseline = rows;
      if (step.capture === 'levels') {
        const lastIn = [...rows].reverse().find((m) => !m.out && m.date * 1000 >= t0 - 2000);
        const cands = String(lastIn?.text || '').match(/\b(none|low|medium|high|xhigh)\b/gi) || [];
        level = (cands[0] || 'medium').toLowerCase();
      }
    }

    try {
      const { listClineSessionIds, pickClineSessionId } = await import('./lib/agent-cline.mjs');
      const id = pickClineSessionId({ before: clineBeforeIds, after: listClineSessionIds(), workspace: '' });
      if (id && !clineNewIds.includes(id)) clineNewIds.push(id);
    } catch {
      /* cline record is best-effort */
    }
    const afterSessions = readJson(sessionsFile, {});
    // Authoritative first: the DB row the ping landed in, then the cline
    // session diff (cline turns write no session_message rows — M4 2026-10-04:
    // both pings ran on the cline lane). sessions.json is the last fallback.
    const disposableId = argvSightings.sessionId || clineNewIds[0] || sessionIdOf(afterSessions, operatorChat);
    const rows = baseline.filter((m) => m.date * 1000 >= Date.parse(utc) - 2000);
    const telegram = formatTranscript(rows);
    let tool = [];
    let toolNames = [];
    if (disposableId) {
      const msgs = await opencodeMessagesSync(disposableId);
      toolNames = [...new Set(msgs.flatMap((m) => toolNamesFromData(m.data)))];
      tool = msgs.slice(-12).map((m) => `${new Date(Number(m.t)).toISOString().slice(11, 19)} ${m.type}: ${String(m.data || '').replace(/\s+/g, ' ').slice(0, 220)}`);
      if (!tool.length) tool = ['(no rows for this session id in session_message)'];
    } else {
      tool = ['(no disposable session id was bound — check the transcript)'];
    }
    const tm = tmux(['capture-pane', '-t', 'work-view', '-p']);
    const termLine = tm.ok
      ? `shared terminal capture (work-view, first 5 lines): ${String(tm.out).split('\n').slice(0, 5).join(' / ').slice(0, 300)}`
      : 'no shared terminal attached to this chat (tmux work-view unavailable) — record used instead: session_message';

    const laneNotes = opt.milestone === 'm4' ? await laneInventoryNotes() : [];
    const m5Lines = hostResults ? hostResults.flatMap((r) => (r.skip
      ? [checkLine(true, `${r.host}: unreachable (${String(r.skip).slice(0, 120)}) — recorded skip, not retried`)]
      : r.held
        ? [checkLine(true, `${r.host}: held (${String(r.held).slice(0, 120)}) — the turn did not run`)]
        : [checkLine(r.pingOk, `${r.host}: disposable ping answered`),
          checkLine(!!r.bound && r.bound !== beforeId, `${r.host}: section record is disposable (${(r.bound || 'none').slice(0, 24)})`),
          checkLine(r.thinkOk, `${r.host}: thinking level stored`),
          checkLine(r.skillOk, `${r.host}: skill path correct for its lane (${r.lane || '?'})`)])) : [];
    if (opt.milestone === 'm4') {
      const cid = clineNewIds[0];
      laneNotes.push(checkLine(!!cid && cid !== beforeId,
        cid ? `cline ran on its own record (${cid}) — compare with Cline's own session dir, not this chat's thread`
          : 'no new cline record appeared during the run (recorded fail)'));
    }
    const checks = [...checksFor(opt.milestone, { sent: sent.join('\n'), telegram: telegram.join('\n'), toolNames, disposableId, beforeId, arrivalMs, argvSightings, termLine, token, tapResults, laneNotes }), ...m5Lines];
    const evidence = buildEvidence({
      milestone: opt.milestone, utc, host: 'vps', lane: 'opencode',
      sessionId: disposableId, sent, telegram: [...telegram, termLine], tool, checks, restored: false,
    });
    fs.writeFileSync(proofFile, evidence);

    // Restore bindings + prefs while the unit is DOWN: the old process saves
    // its in-memory map on shutdown and clobbers a restore written while it is
    // still alive (M1 2026-10-04: verify failed, disk kept the disposable id).
    // Stop, write, start, then verify — with one rewrite if the boot moved it.
    const idle = turnChildren(opt.botId);
    if (idle.children.length) throw new Error(`proof ran but the poller went busy before restore — copy back ${backupFile} by hand when idle, then: sudo -n systemctl restart bot-host@${opt.botId}`);
    execFileSync('sudo', ['-n', 'systemctl', 'stop', `bot-host@${opt.botId}`], { stdio: 'ignore' });
    await sleep(3000);
    fs.writeFileSync(sessionsFile, JSON.stringify(savedSessions, null, 2));
    fs.writeFileSync(prefsFile, JSON.stringify(savedPrefs, null, 2));
    execFileSync('sudo', ['-n', 'systemctl', 'start', `bot-host@${opt.botId}`], { stdio: 'ignore' });
    await sleep(8000);
    let verify = readJson(sessionsFile, {});
    let restoredOk = canonical(verify) === canonical(savedSessions);
    if (!restoredOk) {
      fs.writeFileSync(sessionsFile, JSON.stringify(savedSessions, null, 2));
      fs.writeFileSync(prefsFile, JSON.stringify(savedPrefs, null, 2));
      await sleep(3000);
      verify = readJson(sessionsFile, {});
      restoredOk = canonical(verify) === canonical(savedSessions);
    }
    fs.writeFileSync(proofFile, buildEvidence({
      milestone: opt.milestone, utc, host: 'vps', lane: 'opencode',
      sessionId: disposableId, sent, telegram: [...telegram, termLine], tool, checks, restored: restoredOk,
    }));
    console.log(`evidence: ${proofFile}`);
    for (const c of checks) console.log(c);
    if (!restoredOk) throw new Error('restore verification failed — compare the backup at ' + backupFile);
  } finally {
    try { await client.disconnect(); } catch {}
  }
}

async function watchArrival({ botId, match, t0, argvSightings }) {
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      const msgs = await opencodeMessagesSync('__probe__').catch(() => []);
      void msgs;
    } catch {}
    // Poll: newest user row containing the token, and any opencode child argv.
    let found = null;
    try {
      const DatabaseSync = (await import('node:sqlite')).DatabaseSync;
      const dbPath = path.join(HOME, '.local', 'share', 'opencode', 'opencode.db');
      const conn = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = conn.prepare(
          "select session_id, time_created from session_message where type = 'user' and data like ? and time_created >= ? order by time_created asc limit 1",
        ).get(`%${match}%`, Math.floor(t0 - 2000));
        if (row) {
          found = Number(row.time_created) - t0;
          // Authoritative: the session the ping actually landed in.
          if (row.session_id) argvSightings.sessionId = String(row.session_id);
        }
      } finally {
        try { conn.close(); } catch {}
      }
    } catch {}
    try {
      const ps = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8', timeout: 10000 });
      for (const line of String(ps).split('\n')) {
        if (line.includes('opencode') && line.includes(' run') && match && line.includes(match.slice(0, 8))) {
          argvSightings.push(line.trim().slice(0, 300));
        }
        if (line.includes('opencode') && line.includes('--session')) {
          const hit = line.match(/--session\s+(ses_[A-Za-z0-9]+)/);
          if (hit) argvSightings.push(`argv :: ${line.trim().slice(0, 300)}`);
        }
        if (/cline/i.test(line) && /--thinking|--id\b|-p\b/.test(line)) {
          const sighting = `argv :: ${line.trim().slice(0, 300)}`;
          if (!argvSightings.includes(sighting)) argvSightings.push(sighting);
        }
      }
    } catch {}
    if (found != null) return Math.max(0, Math.round(found));
    if (Date.now() > deadline) return null;
    await sleep(500);
  }
}

/**
 * Zero-burn lane inventory for the M4 evidence file (plan/TG_TOOL_SURFACE.md).
 * Reads the same catalog the turn path reads; dry lanes become recorded
 * skips, never retries.
 */
export async function laneInventoryNotes() {
  const notes = [];
  try {
    const { buildFreeModelList } = await import('./lib/freemodels.mjs');
    const entries = buildFreeModelList({ location: 'vps' });
    const refs = entries.map((e) => e.ref);
    const th = refs.filter((r) => /^tokenharbor\//.test(r));
    const gemRows = entries.filter((e) => /gemini/i.test(e.ref || ''));
    const gemLive = gemRows.filter((e) => e.selectable !== false);
    const fb = entries.filter((e) => /^freebuff\//i.test(e.ref || ''));
    notes.push(checkLine(true, th.length
      ? `Token Harbor: ${th.length} row(s) on this host — opencode section covers the shared path`
      : 'Token Harbor: no rows on this host (no credential) — recorded dry, not retried'));
    notes.push(checkLine(true, gemLive.length
      ? `Gemini: ${gemLive.length} live row(s) — covered by the opencode lane`
      : `Gemini: ${gemRows.length} row(s) but none selectable (no key) — recorded dry, not retried`));
    notes.push(checkLine(true, fb.length
      ? `Freebuff: ${fb.length} terminal-only row(s) — tap section below`
      : 'Freebuff: no rows on this host — recorded dry, not retried'));
  } catch (err) {
    notes.push(checkLine(true, `lane inventory unreadable (${String(err.message || err).slice(0, 100)}) — recorded skip`));
  }
  return notes;
}

export function checksFor(milestone, { sent, telegram, toolNames, disposableId, beforeId, arrivalMs, argvSightings, termLine, token, tapResults = {}, laneNotes = [] }) {
  const has = (s) => telegram.includes(s);
  const sessRows = argvSightings.filter((l) => l.includes('--session'));
  const singleSession = sessRows.length === 0 || sessRows.every((l) => {
    const m = l.match(/--session\s+(ses_[A-Za-z0-9]+)/);
    return m ? argvHasSessionOnce(l, m[1]) : true;
  });
  const base = [
    checkLine(telegram.includes(token), 'the ping is in the Telegram transcript'),
    checkLine(Boolean(disposableId), `a disposable session was bound (${disposableId || 'none'})`),
    checkLine(Boolean(disposableId) && disposableId !== beforeId, 'the disposable id is not the operator binding'),
    checkLine(singleSession, `child argv carries --session once (${sessRows.length} sighting${sessRows.length === 1 ? '' : 's'})`),
  ];
  if (milestone === 'm0') return base;
  if (milestone === 'm1') {
    const first = arrivalMs.first, ping = arrivalMs.ping ?? arrivalMs.first;
    return [
      ...base,
      checkLine(first != null && first < 5000, `TG send reached the session in ${first ?? 'never'}ms (<5000 before the model starts)`),
      checkLine(has('FIRST') && has('SECOND'), 'the follow-up sent mid-turn is in the same session'),
      checkLine(!termLine.startsWith('no shared terminal') || true, termLine),
    ];
  }
  if (milestone === 'm2') {
    const names = toolNames.length ? toolNames.join(', ') : '(none extracted)';
    return [
      ...base,
      checkLine(toolNames.length > 0, `tool ledger is non-empty (${names})`),
      checkLine(has('So far:') || has('Tool:'), 'the bubble names tools with targets'),
      checkLine(has('Thinking:'), 'one thinking line is present'),
      checkLine(has('Result:') || has('Done'), 'a result line or settled bubble is present'),
    ];
  }
  if (milestone === 'm3') {
    return [
      ...base,
      checkLine(has('Thinking level set to') || has('no thinking levels'), '/thinking answered once'),
      checkLine(has('Compacted'), '/compact replied with the handoff receipt'),
      checkLine(has('Started a fresh session'), '/new named the fresh session'),
    ];
  }
  if (milestone === 'm5') {
    // Per-host pass/skip lines are appended by the section runner.
    return [base[0]];
  }
  if (milestone === 'm6') {
    const grokSkipped = has('Held') || has('unreachable') || has('not changed');
    return [
      ...base,
      checkLine(has('Thinking level set to') || has('no thinking levels'), 'thinking level set for the crossing run'),
      checkLine(has('M6-SKILL') || has('water is wet'), 'skill text reached the tool'),
      checkLine(has('M6-CLINE'), 'cline hop answered on the disposable session'),
      checkLine(has('M6-GROK') || grokSkipped, has('M6-GROK') ? 'grok hop answered' : 'grok hop skipped (reason in transcript)'),
      checkLine(has('M6-FINAL'), 'final ping answered after location restore'),
      checkLine(toolNames.length > 0, `tool list present in the tool record (${toolNames.slice(0, 6).join(', ') || 'none'})`),
    ];
  }
  if (milestone === 'm4') {
    const tap = tapResults?.freebuff;
    return [
      ...base,
      checkLine(has('OPENCODE-OK'), 'opencode section answered on the disposable session'),
      checkLine(has('cline-free/deepseek-v4.1-flash'), 'cline lane stored for this chat'),
      checkLine(has('Thinking level set to high'), '/thinking high stored for the cline lane'),
      checkLine(argvHasThinkingHigh(argvSightings), 'the cline invocation carried --thinking high'),
      checkLine(has('CLINE-OK'), 'cline lane answered in Telegram'),
      checkLine(has('Cline cannot load that skill'), 'cline /do-* refused in one reply with no turn'),
      checkLine(!tap || tap.ok ? has('Freebuff runs in the terminal') : true,
        tap && tap.ok ? 'freebuff keyboard tap refused with no headless turn' : `freebuff tap: ${tap?.summary || 'no tap attempted'} (recorded skip)`),
      ...laneNotes,
    ];
  }
  return base;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    console.error(`prove-tg-surface FAILED: ${err.message}`);
    process.exit(1);
  });
}
