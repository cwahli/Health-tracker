/**
 * seat-tag-write-live.mjs — the one place that writes a custom title to Telegram.
 *
 * Isolated deliberately. Everything else in the seat-tag path is pure or
 * previewable; this file is the only code that can change a member's admin
 * record in a live group, so it is the only place a reviewer has to read to be
 * sure the blast radius is a title and nothing else.
 *
 * THE CARRY-OVER, AND WHY IT IS THE WHOLE TRICK
 * ---------------------------------------------
 * `channels.editAdmin` takes a complete admin record. Sending a minimal one
 * strips whatever the member already had — a "set the tag" script that quietly
 * demotes a moderator is the classic version of this bug. So this reads the
 * member's current rights and re-sends them with only `rank` changed.
 *
 * Promoting a member who is not an admin is refused unless the caller passed the
 * rights explicitly, which `validateRights` in seat-tag-writer.mjs already
 * enforced before this was reached. The one place that could quietly invent them
 * is therefore this one, so it does not have a default.
 */

import { connect } from './tg-userbot.mjs';

/**
 * The admin record for a member, or null when they are not an admin.
 * `adminRights` is the full record Telegram already holds; `rank` is the custom
 * title, which is the only field this file is allowed to change.
 */
async function currentRecord(client, group, username) {
  const dialogs = await client.getDialogs({ limit: 200 });
  const target = dialogs.find((d) => (d.chat?.title || d.name || '') === group);
  if (!target) return { ok: false, reason: `group "${group}" is not in this session's dialogs` };
  for await (const p of client.iterParticipants(target.entity)) {
    if (p.username !== username) continue;
    return {
      ok: true,
      entity: target.entity,
      participant: p,
      rights: p.adminRights || null,
    };
  }
  return { ok: false, reason: `@${username} is not in "${group}"` };
}

/**
 * Write one custom title. Returns `{ ok, reason }`; never throws at the caller.
 *
 * `rights` is the operator's decision, already validated upstream. It is
 * merged onto whatever the member already had — never substituted for it.
 */
export async function writeCustomTitle({ group, username, title, rights = null } = {}) {
  if (!group || !username || !title) return { ok: false, reason: 'group, username and title are all required' };
  if (!rights) return { ok: false, reason: 'no rights — a custom title needs admin rights and choosing them is the operator\'s' };

  const connected = await connect({});
  if (!connected.ok) return { ok: false, reason: connected.reason };
  const { client } = connected;
  try {
    const { Api } = await import('teleproto');
    const record = await currentRecord(client, group, username);
    if (!record.ok) return record;

    const carried = record.rights || {};
    const merged = {
      // Carry over everything the member already had…
      ...carried,
      // …and let the operator's decision set only what it names.
      ...rights,
      // …with the title as the only other thing that changes.
      rank: String(title),
    };
    // An empty record would be an implicit demote; a member with no rights at all
    // is being promoted, which is exactly the case the caller must have asked for.
    const adminRights = Object.keys(merged).length
      ? merged
      : null;

    await client.invoke(new Api.channels.EditAdmin({
      channel: record.entity,
      user: record.participant,
      adminRights,
      rank: String(title),
    }));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err).slice(0, 200) };
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* see tg-userbot sendAsUser */
    }
  }
}
