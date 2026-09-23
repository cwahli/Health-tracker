// bot-status.mjs — shared /status + /compact core for every Telegram bot runner.
//
// This is the reusable "telegram management" module: platform-agnostic status
// snapshots and formatters that any runner (opencode-bot, collab-bot, and
// future cline/hermes runners) can adopt with a ~20-line adapter.
//
// ADAPTER CONTRACT for a new platform runner:
//   import {
//     buildStatusSnapshot, formatStatusPlain,
//     compactUnsupported, COMPACT_SUMMARY_PROMPT,
//   } from './lib/bot-status.mjs';
//
//   const snap = buildStatusSnapshot({
//     bot: { id, name },                    // from bots/registry.json
//     platform: 'opencode' | 'collab' | 'cline' | 'hermes',
//     capabilities: { compact, costTracking, backends },  // booleans
//     effective: { model, agent, variant },  // after per-chat overrides
//     session: { id } | null,
//     handoff: false,                       // a compacted brief awaits carryover
//     usage: { tokens, cost, contextLimit, agent } | null,  // last run, raw numbers
//     totals: { runs, tokens, cost } | null,                // persisted chat totals
//     runtime: { bootedAt, taskState, lock }, // taskState: 'idle' | 'running'
//     health: { okAt, errAt, err } | null,   // poll health; null when N/A
//     extras: [],                            // platform-specific lines, appended verbatim
//   });
//   await api.sendMessage(chatId, formatStatusPlain(snap));
//
// A runner that cannot compact (e.g. collab: sessions are GPU/backend tunnels,
// not LLM context) advertises `capabilities: { compact: false }` and answers
// /compact with `compactUnsupported(platform, reason)` so the command exists
// uniformly on every bot.

import { formatUsage, formatTokens, isFreeModel } from './commands.mjs';

export const COMPACT_SUMMARY_PROMPT =
  'Summarize this session for handoff in at most 10 short plain-text lines: ' +
  'goal, key decisions and facts, current state, immediate next step. No fluff, no code blocks.';

export function compactUnsupported(platform, reason) {
  return (
    `\/compact isn't available on the ${platform} bot` +
    (reason ? ` (${reason})` : '') +
    '. Use /new to start a fresh session.'
  );
}

export function formatAgo(ts, now = Date.now()) {
  const t = Number(ts) || 0;
  if (t <= 0) return 'never';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? `${m % 60}m` : ''} ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatUptime(bootedAt, now = Date.now()) {
  const ms = Math.max(0, now - Number(bootedAt || now));
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just started';
  if (m < 60) return `up ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `up ${h}h${m % 60 ? `${m % 60}m` : ''}`;
  return `up ${Math.floor(h / 24)}d`;
}

export function shortSession(id) {
  const s = String(id ?? '');
  if (!s) return '(none)';
  return s.length > 14 ? `${s.slice(0, 12)}…` : s;
}

function formatCost(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  return `$${v.toFixed(v < 0.01 ? 5 : 4)}`;
}

export function buildStatusSnapshot({
  bot = {},
  platform = 'unknown',
  capabilities = {},
  effective = {},
  session = null,
  handoff = false,
  usage = null,
  totals = null,
  runtime = {},
  health = null,
  extras = [],
} = {}) {
  const model = effective.model || null;
  const lastRun =
    usage && (Number(usage?.tokens?.total) > 0 || Number(usage?.cost) > 0)
      ? formatUsage(usage)
      : '';
  const runs = Number(totals?.runs) || 0;
  const totalTokens = Number(totals?.tokens) || 0;
  const totalCost = Number(totals?.cost) || 0;
  return {
    title: `${bot.name || bot.id || 'bot'}${bot.id ? ` (${bot.id})` : ''} · ${platform}`,
    model,
    modelFree: isFreeModel(model),
    agent: effective.agent || null,
    thinking: effective.variant || null,
    session: shortSession(session?.id),
    handoff: Boolean(handoff),
    lastRun,
    totals: runs > 0 || totalTokens > 0 || totalCost > 0 ? { runs, tokens: totalTokens, cost: totalCost } : null,
    compact: capabilities.compact ? 'session compaction ready — /compact to summarize + start fresh' : null,
    uptime: runtime.bootedAt ? formatUptime(runtime.bootedAt) : '',
    taskState: runtime.taskState || 'idle',
    lock: runtime.lock || null,
    poll: health
      ? Number(health.errAt) > Number(health.okAt)
        ? `FAILING since ${formatAgo(health.errAt)} (${String(health.err || 'error').slice(0, 80)})`
        : `ok ${formatAgo(health.okAt)}`
      : '',
    extras: Array.isArray(extras) ? extras.filter(Boolean).map(String) : [],
  };
}

export function formatStatusPlain(snap) {
  const lines = [snap.title];
  if (snap.model) lines.push(`model: ${snap.modelFree ? `✓ ${snap.model} (free)` : snap.model}`);
  const mode = [snap.agent ? `agent: ${snap.agent}` : '', snap.thinking ? `thinking: ${snap.thinking}` : '']
    .filter(Boolean)
    .join(' · ');
  if (mode) lines.push(mode);
  lines.push(`session: ${snap.session}${snap.handoff ? ' · handoff saved' : ''}`);
  if (snap.lastRun) lines.push(`last run: ${snap.lastRun}`);
  if (snap.totals) {
    const cost = formatCost(snap.totals.cost);
    lines.push(
      `chat total: ${snap.totals.runs} run${snap.totals.runs === 1 ? '' : 's'} · ${formatTokens(snap.totals.tokens)} tokens${cost ? ` · ${cost}` : ''}`,
    );
  }
  if (snap.compact) lines.push(`compact: ${snap.compact}`);
  const ops = [
    snap.uptime,
    `task: ${snap.taskState}`,
    snap.lock ? `repo lock: ${snap.lock.bug} (pid ${snap.lock.pid})` : '',
    snap.poll ? `poll: ${snap.poll}` : '',
  ].filter(Boolean);
  if (ops.length) lines.push(ops.join(' · '));
  for (const extra of snap.extras) lines.push(extra);
  return lines.join('\n');
}
