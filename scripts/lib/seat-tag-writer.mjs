/**
 * seat-tag-writer — the in-group tag that says which health chair a bot is in.
 *
 * WHY A SEPARATE FILE AND NOT A LINE IN seat-tags.mjs
 * ---------------------------------------------------
 * Because the write is the dangerous half. Deciding "vm4 is the Health Analyst"
 * is pure (the registry says so); telling Telegram about it means editing a
 * member's admin record in a live group. Keeping them apart means the decision
 * can be tested with no client and no network, and the write can be refused
 * without re-deciding anything.
 *
 * WHY IT REFUSES BY DEFAULT
 * --------------------------
 * A Telegram custom title lives on an *admin* record. Setting a tag on a
 * non-member-of-the-admin-set is impossible, so "tag the seats" can only be
 * carried out by promoting the bots — and promoting is a decision about what
 * those bots may do in that group, not about what they are called. So this
 * writer never invents rights. It is handed them, explicitly, by a caller that
 * shows them first. That is the whole point: the operator chooses the rights;
 * this file only applies the ones it was given.
 *
 * WHY THE RIGHTS ARE CARRIED OVER, NOT REPLACED
 * ----------------------------------------------
 * `channels.editAdmin` takes a *whole* admin record. A call that sent a
 * minimal record would silently revoke whatever the member already had — the
 * classic way a "set the tag" script silently demotes someone. So every write
 * reads the member's current rights first and changes only `rank`.
 *
 * NOTHING HERE TOUCHES A BOT'S NAME
 * ---------------------------------
 * `setMyName` / `setMyUsername` / `setMyDescription` are absent by construction.
 * A bot's name is set once, at creation, or by the operator in BotFather; the
 * seat is a fact about one room and belongs in that room's tag. There was a
 * version that renamed bots so the @ menu would resolve @research, and it made
 * four bots unreadable everywhere outside the health room.
 * scripts/assert-bot-names.mjs fails the build if that ever comes back.
 */

import { clipTag, tagForHealthRole } from './seat-tags.mjs';

/**
 * What a caller must hand over for this writer to do anything at all.
 * Named fields, no defaults: an unstated right is an unheld right.
 */
export const REQUIRED_RIGHTS = Object.freeze([
  'change_info',   // Telegram's own permission for editing a member's title
  'view',          // reading the member list to find current rights
]);

/**
 * Reject a rights object that is not a complete, explicit decision.
 * Returns `{ ok, reason, rights }`; never throws, never guesses a default.
 */
export function validateRights(rights) {
  if (!rights || typeof rights !== 'object') {
    return { ok: false, reason: 'no rights given — a custom title needs admin rights, and choosing them is the operator\'s, not this writer\'s' };
  }
  const missing = REQUIRED_RIGHTS.filter((k) => typeof rights[k] !== 'boolean');
  if (missing.length) {
    return { ok: false, reason: `rights must state every one of: ${REQUIRED_RIGHTS.join(', ')} — missing ${missing.join(', ')}` };
  }
  if (!rights.change_info) {
    return { ok: false, reason: 'change_info is false, and it is the permission Telegram requires to set a custom title' };
  }
  // Everything else is carried over from the member's current record, so a
  // partial object cannot demote anyone: only the fields above are consulted.
  return { ok: true, reason: '', rights: { change_info: true, view: true } };
}

/**
 * What would change, without changing it. This is the review surface: the
 * operator sees the exact admin record and the exact title before granting
 * anything, and a run that only previews touches nothing.
 */
export function planTagWrites({ rows, current = {}, rights = null, title = '' } = {}) {
  const verdict = validateRights(rights);
  const list = Array.isArray(rows) ? rows : [];
  const planned = [];
  for (const row of list) {
    const tag = clipTag(row?.rank ?? row?.tag ?? '');
    const username = String(row?.username || row?.id || '');
    const existing = current[username] || current[String(row?.id)] || null;
    const entry = {
      username,
      userId: row?.userId ?? null,
      title: tag,
      currentTitle: existing?.rank || '',
      isAdmin: Boolean(existing && (existing.adminRights ?? existing.admin)),
      change: null,
      note: '',
    };
    if (!tag) {
      entry.note = 'no tag for this seat — nothing to write';
    } else if (entry.currentTitle === tag) {
      // A title can only exist on an admin, so a matching title IS the answer:
      // checked before the admin question, because asking "is this an admin"
      // about a member who already wears the tag is asking the wrong thing.
      entry.note = 'already correct';
      entry.change = 'none';
    } else if (!verdict.ok) {
      entry.note = `blocked: ${verdict.reason}`;
      entry.change = 'would-promote';
    } else if (!entry.isAdmin) {
      entry.note = 'would promote to admin (a custom title can only exist on an admin)';
      entry.change = 'promote';
    } else {
      entry.note = 'title only; every other right is carried over from the current record';
      entry.change = 'retitle';
    }
    planned.push(entry);
  }
  // `ok` means ACTIONABLE, and it is not: without rights the plan is a
  // description of what a promotion would involve, not a plan anyone can run.
  // (This was `planned.every(p => p.change !== 'blocked')` — a change value
  // this function never produces, so a rights-less plan reported ok: true.)
  const actionable = verdict.ok && planned.every((p) => p.change !== 'blocked' && p.change !== 'would-promote');
  return { ok: actionable, reason: verdict.reason, rights: verdict.rights || null, title, planned };
}

/**
 * Apply a plan through an injected client.
 *
 * `client` is the seam: a fixture in the sensor, the real teleproto client in
 * production. `dryRun` (the default here) returns the plan and calls nothing —
 * so the safe path is the default path, and doing the unsafe thing is the
 * explicit one.
 */
export async function applyTagWrites(plan, { client = null, dryRun = true, apply = null } = {}) {
  if (dryRun || !apply) {
    return {
      ok: true,
      dryRun: true,
      applied: [],
      skipped: plan.planned.filter((p) => p.change === 'none' || !p.title).map((p) => p.username),
      summary: plan.planned.map((p) => `${p.username}: ${p.title || '(no tag)'} — ${p.note}`),
    };
  }
  const results = [];
  for (const entry of plan.planned) {
    if (!entry.title || entry.change === 'none') {
      results.push({ username: entry.username, ok: true, skipped: true, reason: entry.note });
      continue;
    }
    try {
      const res = await apply(entry, plan);
      results.push({ username: entry.username, ok: res?.ok !== false, ...res });
    } catch (err) {
      results.push({ username: entry.username, ok: false, reason: String(err?.message || err).slice(0, 200) });
    }
  }
  return { ok: results.every((r) => r.ok), dryRun: false, applied: results.filter((r) => r.ok && !r.skipped), results };
}

/**
 * The plan for the live fleet: one row per enabled bot with a health seat, plus
 * vm as Coordinator (it has no seat of its own and answers for the room).
 */
export function rowsForRegistry(registry, { coordinatorBotId = 'vm' } = {}) {
  const bots = (registry?.bots || []).filter((b) => b.runtime !== 'hermes' && b.enabled !== false);
  const rows = [];
  for (const bot of bots) {
    const role = String(bot.agent?.healthRole || '').trim();
    const tag = tagForHealthRole(role, { coordinator: bot.id === coordinatorBotId });
    if (!tag) continue;
    rows.push({ botId: bot.id, username: bot.telegram?.username || '', userId: null, rank: tag });
  }
  return rows;
}

/**
 * Read each row's current admin record, so the write can change the title and
 * nothing else. Returns `{ ok, current }` keyed by username.
 */
export async function readCurrentRanks(rows, { getParticipants = null } = {}) {
  if (typeof getParticipants !== 'function') {
    return { ok: false, reason: 'no participant reader was provided', current: {} };
  }
  const current = {};
  let failure = '';
  for (const row of rows) {
    try {
      const member = await getParticipants(row);
      if (!member) continue;
      current[row.username] = { rank: member.rank || '', adminRights: member.adminRights || null, admin: Boolean(member.adminRights) };
    } catch (err) {
      failure = String(err?.message || err).slice(0, 160);
    }
  }
  return { ok: !failure, reason: failure, current };
}
