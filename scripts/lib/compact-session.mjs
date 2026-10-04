/**
 * `/compact` for a Telegram chat, done the way the tool does it.
 *
 * The old implementation asked the model to "summarize this session for
 * handoff", stored the prose in prefs, then deleted the chat's session row.
 * That is a prompt, not a compaction: the transcript kept every message, so
 * the context grew by the length of the summary and the next turn paid for
 * both. Measured on a live chat session, /compact took the context from 4
 * messages to 7.
 *
 * This calls `session.compact` on the session the chat is actually on. The
 * tool collapses the transcript into one `type:"compaction"` entry carrying a
 * real `summary`, and the session id never changes — the chat stays on it.
 *
 * Every number in the receipt below is read back off the API rather than
 * guessed: message counts from `session.context` on both sides of the call,
 * and the tokens from the compaction message the tool itself emitted.
 */
import { formatTokens } from './commands.mjs';
import { opencodeApi } from './opencode-api.mjs';

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 180_000;
/** Telegram's own limit is 4096; leave room for the receipt and the footer. */
const SUMMARY_MAX_CHARS = 2_600;

/** `idle` entries are turn markers, not conversation. They are not messages. */
export function countContextEntries(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter((entry) => entry && entry.type !== 'idle').length;
}

export function latestCompaction(entries, id) {
  if (!Array.isArray(entries)) return null;
  const compactions = entries.filter((entry) => entry?.type === 'compaction');
  if (id) {
    const match = compactions.find((entry) => entry.id === id);
    if (match) return match;
  }
  return compactions.length ? compactions[compactions.length - 1] : null;
}

/**
 * Tokens the compaction actually moved, split so the receipt can say what was
 * read and what was spent. `cache.read` is the transcript it folded up;
 * input+output+reasoning is what generating the summary cost.
 */
export function summarizeCompactionTokens(tokens) {
  const read = Number(tokens?.cache?.read) || 0;
  const spent =
    (Number(tokens?.input) || 0) +
    (Number(tokens?.output) || 0) +
    (Number(tokens?.reasoning) || 0) +
    (Number(tokens?.cache?.write) || 0);
  return { read, spent };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function compactionError(entry) {
  return entry?.error?.message || entry?.error?.type || 'the tool reported no reason';
}

/**
 * Compact a session in place.
 *
 * Resolves `{ ok: false, reason }` rather than throwing for the expected
 * outcomes (nothing to compact, the tool refused, the run timed out) so the
 * command can render them; only a genuinely broken transport throws.
 */
export async function compactSession({
  sessionId,
  workspace,
  env = {},
  envMode = 'inherit',
  opencodeBin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
  api = opencodeApi,
  sleepImpl = sleep,
  now = () => Date.now(),
} = {}) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, reason: 'no session' };

  const contextOf = () => api('session.context', { params: { sessionID: sid }, workspace, env, envMode, opencodeBin });

  const before = countContextEntries(await contextOf());
  // One user turn and nothing to fold up: compacting would burn a model call
  // to summarise a single line.
  if (before === 0) return { ok: false, reason: 'empty' };

  // The POST answers immediately with an inbox stub, because compaction is
  // delivered asynchronously. The summary only exists once the tool has
  // finished writing the `compaction` entry, so wait for that.
  const started = await api('session.compact', {
    params: { sessionID: sid },
    data: {},
    workspace,
    env,
    envMode,
    opencodeBin,
  });

  const deadline = now() + timeoutMs;
  let entry = null;
  while (now() < deadline) {
    entry = latestCompaction(await contextOf(), started?.id);
    if (entry?.status === 'completed' || entry?.status === 'failed') break;
    entry = null;
    await sleepImpl(pollIntervalMs);
  }

  if (!entry) return { ok: false, reason: 'timeout' };
  if (entry.status === 'failed') return { ok: false, reason: compactionError(entry) };

  const after = countContextEntries(await contextOf());
  return {
    ok: true,
    sessionId: sid,
    messagesBefore: before,
    messagesAfter: after,
    summary: String(entry.summary || '').trim(),
    ...summarizeCompactionTokens(entry.tokens),
  };
}

export function truncateSummary(summary, maxChars = SUMMARY_MAX_CHARS) {
  const text = String(summary || '').trim();
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars).trimEnd()}\n… (summary cut, ${text.length} chars total)`, truncated: true };
}

/**
 * The receipt. One message that says what happened, what it cost, and what the
 * chat is still attached to — the three things the old two-line reply left out.
 */
export function formatCompactReceipt({
  sessionId,
  messagesBefore,
  messagesAfter = 1,
  read = 0,
  spent = 0,
  summary = '',
  maxSummaryChars = SUMMARY_MAX_CHARS,
} = {}) {
  const facts = [`${messagesBefore} message${messagesBefore === 1 ? '' : 's'} → ${messagesAfter}`];
  if (read > 0) facts.push(`read ${formatTokens(read)} tokens`);
  if (spent > 0) facts.push(`spent ${formatTokens(spent)} to summarise`);

  const short = sessionId ? `${sessionId.slice(0, 12)}…` : 'unknown';
  const lines = [`Compacted · ${facts.join(' · ')}`, `Session ${short} unchanged — this chat stays on it.`];

  const { text, truncated } = truncateSummary(summary, maxSummaryChars);
  if (text) lines.push('', text);
  else lines.push('', 'The tool compacted the session but wrote no summary.');
  if (truncated) lines.push('', 'Full summary: /export in the TUI, or read the session on the host.');
  return lines.join('\n');
}

/** Failure copy that says the one thing that matters: nothing was lost. */
export function formatCompactFailure({ sessionId, reason } = {}) {
  const short = sessionId ? `${sessionId.slice(0, 12)}…` : 'unknown';
  return [
    `Compact failed · ${reason}`,
    `Session ${short} unchanged — nothing was compacted and nothing was lost.`,
  ].join('\n');
}

export function formatCompactEmpty() {
  return 'Nothing to compact — this chat has no session with messages yet.';
}