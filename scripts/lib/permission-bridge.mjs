/**
 * permission-bridge — surface opencode permission prompts in Telegram.
 *
 * Two prompts never reached the chat:
 *
 *   1. A bot turn (`opencode run --format json`, stdin ignored) that hits a
 *      permission (external directory, shell, edit outside the workspace)
 *      just hangs until the 15-minute timeout. `mapOpencodeEvent` has no
 *      permission kind, so the progress renderer never mentions it.
 *   2. A dev TUI in another worktree asking to access an external directory
 *      (the `Allow once / Always allow / Reject` dialog). That dialog lives
 *      in the TUI only; bot-host never sees it.
 *
 * Case 2 cannot be bridged — it is a different process. Case 1 can: the run
 * goes to the same background service the TUI uses, so while the child is
 * alive the bot can poll `session.permission.list` for the session the turn
 * runs in, ask the chat with Allow-once / Always / Reject buttons (the same
 * `reply_markup` + `handleCallback` pattern as the /model picker), and answer
 * with `session.permission.reply`.
 *
 * On a TG wait timeout the request is rejected so the run unblocks: nothing
 * the user did not approve ever executes, and the chat says so.
 */
import { execFile } from 'node:child_process';

import { resolveOpencodeBin } from './agent-opencode.mjs';
import { buildChildEnv } from './child-env.mjs';

/** How long one permission waits for the chat before it is rejected. */
export const PERMISSION_WAIT_MS = 120_000;
/** How often a live run is polled for pending requests. */
export const PERMISSION_POLL_MS = 2_000;
/** Telegram cuts callback_data at 64 bytes — keep token short, never the request id. */
export const PERMISSION_TOKEN_BYTES = 4;

const newToken = () => {
  const bytes = [];
  for (let i = 0; i < PERMISSION_TOKEN_BYTES; i++) {
    bytes.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return bytes.join('');
};

/**
 * Run one `opencode api <operationId>` and return the unwrapped payload.
 * Throws a Telegram-shaped Error (no log prefixes, no stack frames).
 */
export async function callPermissionApi(operationId, { params, data, workspace, env = {}, envMode = 'inherit', opencodeBin, timeoutMs = 30_000, execFileImpl = execFile } = {}) {
  const bin = resolveOpencodeBin(opencodeBin);
  const args = ['api', String(operationId)];
  for (const [name, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    args.push('--param', `${name}=${value}`);
  }
  if (data !== undefined) args.push('--data', JSON.stringify(data));
  const childEnv = buildChildEnv({ extraEnv: env, mode: envMode });
  const { stdout, code, stderr } = await new Promise((resolve) => {
    execFileImpl(bin, args, { cwd: workspace || undefined, env: childEnv, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, out, err) => {
      resolve({ stdout: String(out || ''), stderr: String(err || ''), code: error ? Number(error.code) || 1 : 0 });
    });
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (code !== 0) throw new Error(cleanPermissionError(stderr) || `opencode ${operationId} failed (exit ${code})`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const first = trimmed.split('\n')[0];
    try {
      parsed = JSON.parse(first);
    } catch {
      throw new Error(`opencode ${operationId} returned output that is not JSON`);
    }
  }
  if (parsed && typeof parsed === 'object' && typeof parsed._tag === 'string' && /error$/i.test(parsed._tag)) {
    throw new Error(parsed.message || parsed._tag);
  }
  if (parsed && typeof parsed === 'object' && 'data' in parsed) return parsed.data;
  return parsed;
}

export function cleanPermissionError(stderr) {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !l.startsWith('timestamp='))
    .filter((l) => !/^at\s/.test(l));
  return lines[lines.length - 1] || '';
}

/** Pending requests for one session: [] when none, never throws null. */
export async function listPendingPermissions({ sessionId, ...rest } = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const payload = await callPermissionApi('session.permission.list', { params: { sessionID: sid }, ...rest });
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

/** Answer one request. decision is once | always | reject. Empty reply = done. */
export async function replyPermission({ sessionId, requestId, decision, ...rest } = {}) {
  if (!sessionId || !requestId || !decision) throw new Error('replyPermission needs sessionId, requestId and decision');
  await callPermissionApi('session.permission.reply', {
    params: { sessionID: sessionId, requestID: requestId },
    data: { decision },
    ...rest,
  });
  return decision;
}

/** One request, one short prompt. Truncated — the full paths stay in the TUI. */
export function formatPermissionPrompt(request = {}) {
  const req = request && typeof request === 'object' ? request : {};
  const action = String(req.action || 'unknown action');
  const resources = Array.isArray(req.resources) ? req.resources.filter(Boolean) : [];
  const message = String(req.message || '').trim();
  const lines = [`Needs approval — ${action}`];
  for (const resource of resources.slice(0, 4)) lines.push(`• ${String(resource).slice(0, 160)}`);
  if (resources.length > 4) lines.push(`• … +${resources.length - 4} more`);
  if (message) lines.push('', message.slice(0, 500));
  return lines.join('\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Watch a live run's session for permission requests and ask the chat.
 *
 * Each unseen request posts one message with Allow-once / Always / Reject
 * buttons and waits for the tap (or PERMISSION_WAIT_MS, which rejects so the
 * run unblocks — nothing executes without approval either way). The tap is
 * resolved from bot-host's handleCallback via the `permWait` field on the
 * chat's `running` entry. Stopping with a question open closes it as 'gone'.
 *
 * Returns a state handle; pass it to stopPermissionWatch. The poller never
 * throws and never breaks the run it watches.
 */
export function startPermissionWatch({
  api,
  chatId,
  running,
  getSessionId,
  workspace,
  env = {},
  envMode = 'inherit',
  opencodeBin,
  pollMs = PERMISSION_POLL_MS,
  waitMs = PERMISSION_WAIT_MS,
  sleepImpl = sleep,
  listImpl = listPendingPermissions,
  replyImpl = replyPermission,
  tokenImpl = newToken,
} = {}) {
  const state = { stopped: false, seen: new Set(), waiter: null, createdStub: false, task: null };
  const isActive = () => !state.stopped && Boolean(running?.has(chatId)) && !running.get(chatId)?.aborted;

  const closeWaiter = async (how, note) => {
    const waiter = state.waiter;
    state.waiter = null;
    if (waiter?.timer) clearTimeout(waiter.timer);
    const cur = running?.get(chatId);
    if (cur && 'permWait' in cur) {
      const { permWait: _dropped, ...rest } = cur;
      if (state.createdStub && !rest.child && !rest.jobId) running.delete(chatId);
      else running.set(chatId, rest);
      state.createdStub = false;
    }
    if (waiter?.messageId && note) {
      try {
        await api.editMessageText(chatId, waiter.messageId, note, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // a render hiccup must never break the run
      }
    } else if (!waiter?.messageId && note) {
      try {
        await api.sendMessage(chatId, note);
      } catch {
        // a render hiccup must never break the run
      }
    }
    return how;
  };

  const askChat = (request) => new Promise((resolve) => {
    const token = tokenImpl();
    const finish = async (how) => {
      if (state.waiter?.timer) clearTimeout(state.waiter.timer);
      try {
        await replyImpl({ sessionId: state.sessionId, requestId: request.id, decision: how === 'once' || how === 'always' ? how : 'reject' });
      } catch {
        // the service may be gone with the run — the verdict message still lands
      }
      const verdicts = {
        once: 'Allowed once — continuing.',
        always: 'Always allowed — continuing.',
        reject: 'Rejected — the run continues without it.',
        timeout: 'No answer in 2m — rejected so the run can finish. Nothing ran without approval.',
        gone: 'Run ended — open approval closed as rejected. Nothing ran without approval.',
        'send-failed': 'Approval needed but the prompt could not be posted — rejected so the run can finish.',
      };
      const verdict = verdicts[how] ?? verdicts.gone;
      const full = `${formatPermissionPrompt(request)}\n\n${verdict}`;
      await closeWaiter(how, full);
      resolve(how);
    };
    const waiter = { token, requestId: request.id, resolve: finish, timer: null, messageId: null };
    state.waiter = waiter;
    const cur = running?.get(chatId);
    if (cur) running.set(chatId, { ...cur, permWait: waiter });
    else if (running) {
      running.set(chatId, { child: null, aborted: false, permWait: waiter });
      state.createdStub = true;
    }
    waiter.timer = setTimeout(() => finish('timeout'), waitMs);
    if (waiter.timer?.unref) waiter.timer.unref();
    Promise.resolve()
      .then(() => api.sendMessage(chatId, formatPermissionPrompt(request), { reply_markup: permissionKeyboard(token) }))
      .then((msg) => {
        if (msg?.messageId) waiter.messageId = msg.messageId;
      })
      .catch(() => finish('send-failed'));
  });

  state.task = (async () => {
    await sleepImpl(pollMs);
    while (!state.stopped) {
      try {
        if (!isActive()) break;
        const sid = typeof getSessionId === 'function' ? getSessionId() : getSessionId;
        state.sessionId = sid;
        if (sid) {
          const pending = await listImpl({ sessionId: sid, workspace, env, envMode, opencodeBin }).catch(() => []);
          for (const req of Array.isArray(pending) ? pending : []) {
            if (!req?.id || state.seen.has(req.id)) continue;
            state.seen.add(req.id);
            await askChat(req);
            if (state.stopped || !isActive()) break;
          }
        }
      } catch {
        // polling must never break the run
      }
      await sleepImpl(pollMs);
    }
    if (state.waiter) {
      const resolve = state.waiter.resolve;
      await resolve('gone');
    }
  })();

  return state;
}

/** Stop the watcher; an open question closes as rejected. Never throws. */
export async function stopPermissionWatch(state) {
  if (!state || state.stopped) return;
  state.stopped = true;
  try {
    await state.task;
  } catch {
    // the poller never rejects, this is belt and braces
  }
}

export function permissionKeyboard(token) {
  const t = String(token);
  return {
    inline_keyboard: [[
      { text: '✅ Allow once', callback_data: `perm:once:${t}` },
      { text: 'Always allow', callback_data: `perm:always:${t}` },
      { text: '❌ Reject', callback_data: `perm:reject:${t}` },
    ]],
  };
}

/** `perm:once:<token>` → { decision: 'once', token }. Null when not ours. */
export function parsePermissionCallback(value) {
  const raw = String(value ?? '');
  const match = raw.match(/^(once|always|reject):([0-9a-f]{8})$/);
  if (!match) return null;
  return { decision: match[1], token: match[2] };
}

export function makePermissionToken(tokenImpl = newToken) {
  return tokenImpl();
}
