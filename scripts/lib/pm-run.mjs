/**
 * pm-run.mjs — the PM role's one entry point.
 *
 * The three responsibilities each own one file (`pm-fleet.mjs` the projection,
 * `pm-ladder.mjs` the rungs and their counters, `pm-sheet.mjs` the sheet). This
 * file is the only place that composes them, and it is the only thing
 * `scripts/bot-host.mjs` calls, so `/role pm` cannot grow a second opinion about
 * what a cycle does.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER
 * -----------------------------------
 *   1. project   — read the four existing sources; write nothing.
 *   2. decide    — for every stalled item, take the next rung and persist it
 *                  BEFORE anything is delivered, so a crash mid-cycle loses a
 *                  message, never a step.
 *   3. nudge     — one real message from the operator's own session, through
 *                  `sendAsUser` in `tg-userbot.mjs`. No second message bus.
 *   4. record    — spool this cycle's rows and flush them through the governed
 *                  writer.
 *
 * WHY A RUNG IS RECORDED EVEN WHEN IT CANNOT BE DELIVERED
 * -------------------------------------------------------
 * A rung is a decision about the work ("retry it", "try something else", "ask
 * the human"), and the stall it responds to is a fleet fact that a restart does
 * not erase. Delivery is a separate fact and is reported separately: every
 * decision carries `delivered`, the chat text says `not delivered`, and the sheet
 * has its own column. Advancing the ladder and *saying the message did not go out*
 * is honest; refusing to advance would mean a host without a userbot session
 * cannot escalate anything and the operator never hears about the stall at all —
 * which is the silent failure the ladder exists to prevent.
 *
 * WHAT NEEDS THE OPERATOR
 * -----------------------
 * There is no userbot session and no Google consent on a fresh host. Both are
 * the operator's to grant, so both are printed as exact commands rather than
 * attempted or faked.
 */

import os from 'node:os';

import {
  mdSafe,
  pmPaths,
  projectFleet,
  readFleetSources,
  renderFleet,
} from './pm-fleet.mjs';
import { attemptFor, forgetCounters, ladderFile, readLadder, recordAttempts, rungMessage } from './pm-ladder.mjs';
import { flushSheet, renderFlush, spoolFleetRows } from './pm-sheet.mjs';
import { sendAsUser, userbotState } from './tg-userbot.mjs';

/** The subcommands `/role pm …` answers to. */
export const PM_SUBCOMMANDS = ['', 'status', 'run', 'sheet', 'help', 'reset'];

/**
 * Deliver one nudge as the operator, through the session the forge already
 * manages.
 *
 * There is deliberately no "is the userbot configured?" gate in front of this.
 * `sendAsUser` already answers that question from the host it is running on, in
 * one sentence, before it opens a socket — and a gate here would be a second
 * copy of that answer, which is exactly the kind of copy that goes stale on the
 * host that matters. So the cycle attempts and reports. Injected `send` is for
 * tests; production goes through `sendAsUser`.
 */
export async function deliverNudge({ chatId, text, env = process.env, send = null }) {
  if (!chatId) return { ok: false, reason: 'no operator chat is configured for this bot' };
  const doSend = send || ((to, body) => sendAsUser(to, body, { env }));
  try {
    const res = await doSend(chatId, text);
    if (!res || res.ok === false) return { ok: false, reason: (res && res.reason) || 'empty nudge result' };
    return { ok: true, reason: '' };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err).slice(0, 200) };
  }
}

/** The one message a cycle sends back to the chat that asked for it. */
export function renderCycle(cycle) {
  const { fleet, decisions, spool, flush, nudgeState } = cycle;
  const lines = [];
  lines.push(`🧭 *PM cycle — ${fleet.counts.total} item(s), ${decisions.length} stalled*`);
  if (cycle.operatorChatWarning) {
    lines.push('*No operator chat is configured for this bot — every nudge below reports not delivered.*');
  }
  if (!decisions.length) {
    lines.push('Nothing is stalled, so the ladder stayed put.');
  } else {
    for (const d of decisions) {
      const where = d.delivered ? 'delivered' : `not delivered (${mdSafe(d.deliveryReason || 'unknown')})`;
      lines.push(`• \`${mdSafe(d.item.id)}\` → rung ${d.attempt}/${d.total} *${mdSafe(d.label)}* — ${where}`);
    }
  }
  lines.push('');
  lines.push(renderFlush(flush));
  if (spool?.header) lines.push('• the sheet header was seeded this cycle.');
  if (!decisions.length && !flush.ok) lines.push(`• queued rows: ${spool?.spooled ?? 0}`);
  if (nudgeState && !nudgeState.configured) {
    lines.push('');
    lines.push('*Nudges need the operator\'s session (not configured here):*');
    for (const cmd of nudgeState.hostCommands || []) lines.push(`• \`${cmd}\``);
  }
  return lines.join('\n');
}

/**
 * One PM cycle: project, decide, nudge, record.
 *
 * Every dependency that touches the outside world is injectable (`reader`,
 * `send`, `execFileSync`, `writer`, `recipient`), so the sensor drives the real
 * code against a fixture fleet instead of a mock of it.
 */
export async function runCycle({
  botId = 'vm',
  chatId = '',
  operatorChatId = '',
  env = process.env,
  home = os.homedir(),
  now = Date.now(),
  paths = null,
  sources = null,
  reader = null,
  send = null,
  writer = null,
  recipient = null,
  ladderFileOverride = '',
} = {}) {
  const p = paths || pmPaths(env, { home });
  const read = reader || readFleetSources;
  const raw = sources || read({ paths: p, env });
  const fleet = projectFleet({ specs: raw.specs, bugs: raw.bugs, lanes: raw.lanes, beats: raw.beats, now });

  const ladder = ladderFileOverride || ladderFile(botId, { home });
  const at = new Date(now).toISOString();
  const recorded = recordAttempts(
    ladder,
    fleet.stalled.map((item) => ({ key: item.key, at, note: item.stallReason })),
  );
  // Prune counters for work that recovered: the file tracks live stalls only,
  // so it cannot grow forever, and a re-stall correctly restarts at retry.
  forgetCounters(ladder, fleet.stalled.map((item) => item.key));

  const nudgeState = await userbotState(env);
  const decisions = [];
  for (const rec of recorded) {
    const item = fleet.stalled.find((it) => it.key === rec.key) || { id: rec.key };
    const text = rungMessage(rec.rung, item);
    const sent = await deliverNudge({ chatId: operatorChatId, text, env, send });
    const delivered = sent.ok === true;
    const deliveryReason = delivered ? '' : (sent.reason || nudgeState.reason || 'the send was refused');
    decisions.push({
      item,
      key: rec.key,
      rung: rec.rung,
      label: rec.label,
      attempt: rec.attempts,
      total: 3,
      escalated: rec.escalated,
      text,
      delivered,
      deliveryReason,
    });
  }

  const ladderNow = readLadder(ladder);
  const spool = spoolFleetRows(botId, fleet, {
    home,
    at: now,
    ladderOf: (item) => attemptFor(ladderNow, item.key),
  });
  const flush = await flushSheet(botId, { env, home, writer, recipient });

  return { fleet, sources: raw.sources, decisions, spool, flush, nudgeState, ladderFile: ladder, at, requestChatId: chatId, operatorChatWarning: !operatorChatId };
}

/** Status only: the projection, with no writes and no sends. */
export async function runStatus({ env = process.env, home = os.homedir(), now = Date.now(), paths = null, sources = null, reader = null } = {}) {
  const p = paths || pmPaths(env, { home });
  const raw = sources || (reader || readFleetSources)({ paths: p, env });
  const fleet = projectFleet({ specs: raw.specs, bugs: raw.bugs, lanes: raw.lanes, beats: raw.beats, now });
  return { fleet, sources: raw.sources };
}

/**
 * `/role pm [sub]` — the bot-host surface's entry point.
 *
 * Returns the text to send plus whether the caller should reset the chat's role.
 * It never sends to the requester itself: bot-host owns the reply, exactly as it
 * does for every other `/role` branch. It never throws either: a disk-full
 * spool or ladder write surfaces here as honest text, so a cycle failure can
 * never escape into the poller.
 */
export async function runPmCommand({
  sub = '',
  botId = 'vm',
  chatId = '',
  operatorChatId = '',
  env = process.env,
  home = os.homedir(),
  now = Date.now(),
  send = null,
  reader = null,
  writer = null,
  recipient = null,
} = {}) {
  try {
    return await runPmCommandInner({ sub, botId, chatId, operatorChatId, env, home, now, send, reader, writer, recipient });
  } catch (err) {
    return { ok: false, text: `PM cycle failed before it could report honestly: ${String(err?.message || err).slice(0, 200)}`, resetRole: false };
  }
}

async function runPmCommandInner({
  sub = '',
  botId = 'vm',
  chatId = '',
  operatorChatId = '',
  env = process.env,
  home = os.homedir(),
  now = Date.now(),
  send = null,
  reader = null,
  writer = null,
  recipient = null,
} = {}) {
  const verb = String(sub || '').trim().toLowerCase();
  if (verb && !PM_SUBCOMMANDS.includes(verb)) {
    return { ok: false, text: `Unknown PM subcommand \`${mdSafe(verb)}\` — try ${PM_SUBCOMMANDS.filter(Boolean).map((s) => `\`/role pm ${s}\``).join(', ')}.`, resetRole: false };
  }
  if (verb === 'reset') {
    return { ok: true, text: 'Role reset. Back to general collaborative mode — the PM ladder and its counters stay on disk.', resetRole: true };
  }
  if (verb === 'help') {
    return { ok: true, text: pmHelpText(), resetRole: false };
  }
  if (verb === 'status') {
    const { fleet, sources } = await runStatus({ env, home, now, reader });
    return { ok: true, text: `🎭 *Role: Project Manager*\n\n${renderFleet(fleet, { sources })}`, resetRole: false };
  }
  if (verb === 'sheet') {
    const { fleet, sources } = await runStatus({ env, home, now, reader });
    const spool = spoolFleetRows(botId, fleet, { home, at: now, ladderOf: (item) => attemptFor(readLadder(ladderFile(botId, { home })), item.key) });
    const flush = await flushSheet(botId, { env, home, writer, recipient });
    return {
      ok: true,
      text: [`📊 *Ongoing-projects sheet*`, `• ${spool.spooled} row(s) spooled${spool.header ? ' (+ header)' : ''}`, renderFlush(flush)].join('\n'),
      resetRole: false,
    };
  }
  if (verb === 'run') {
    const cycle = await runCycle({ botId, chatId, operatorChatId, env, home, now, send, reader, writer, recipient });
    return { ok: true, text: renderCycle(cycle), resetRole: false };
  }
  // Bare `/role pm`: the standing answer, plus what `/role pm run` would do.
  const { fleet, sources } = await runStatus({ env, home, now, reader });
  const tail = fleet.stalled.length
    ? `\n\nRun the ladder with \`/role pm run\` (${fleet.stalled.length} stalled).`
    : '\n\nNothing needs the ladder right now.';
  return { ok: true, text: `🎭 *Role: Project Manager*\n\n${renderFleet(fleet, { sources })}${tail}`, resetRole: false };
}

export function pmHelpText() {
  return [
    '🎭 *Project Manager role*',
    '• `/role pm` — fleet status (packets, tickets, ledger, heartbeats)',
    '• `/role pm run` — one cycle: project, climb the ladder, nudge, record',
    '• `/role pm sheet` — spool and flush the ongoing-projects sheet',
    '• `/role pm status` — the projection only (no writes)',
    '• `/role pm reset` — leave the role (counters are kept)',
  ].join('\n');
}
