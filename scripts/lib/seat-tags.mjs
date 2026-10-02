/**
 * seat-tags.mjs — which chair each health bot sits in, and the tag that says so
 * inside the group.
 *
 * THE SEAT IS THE TAG, NOT THE NAME
 * ----------------------------------
 * A seated bot keeps its own name. The tag beside it in the Health-coach room
 * says which chair it is, which is where that fact belongs: it is scoped to the
 * room.
 *
 * An earlier version also renamed the bot through `setMyName`, because the
 * Telegram @ menu matches a bot's *name* rather than the in-group tag — so
 * typing @research would find "Research Lead" only if the bot had been renamed
 * to it. That traded a correct name for a convenient one and it was wrong: a
 * bot's name is how the operator identifies that bot everywhere else in
 * Telegram, and it was being overwritten from a health seat nobody else could
 * see. Live 2026-10-02: vm2 read "Data Steward", vm4 "Health Analyst", vm5
 * "Test Planner", vm6 "Research Lead" — four bots indistinguishable from their
 * seats outside the room.
 *
 * Addressing never needed the rename: `resolveGroupAddressing` routes on the
 * seat id from the registry row, not on a display name, and Telegram's @ menu
 * always offered the bot's @username, which the rename did not touch.
 *
 * This module is pure: seat id in, tag text out. The write lives in
 * seat-tag-writer.mjs, which is where the risk is and where the refusal to
 * invent admin rights is.
 */

import { HEALTH_SEAT_ORDER } from './health-group.mjs';

const COORDINATOR_TAG = 'Coordinator';
export const HEALTH_GROUP_TITLE = 'Health-coach';

/**
 * The tag text for a seat id. '' for anything unknown, so an unrecognised role
 * produces no tag rather than a tag reading "undefined" — the seat the bot does
 * not have must not appear in the room.
 */
export function tagForHealthRole(roleId, { coordinator = false } = {}) {
  const id = String(roleId || '').trim();
  if (coordinator && !id) return COORDINATOR_TAG;
  const seat = HEALTH_SEAT_ORDER.find((s) => s.id === id);
  return seat ? seat.name : '';
}

/**
 * A custom title has a hard limit and cannot carry emoji noise. Telegram counts
 * the title in UTF-16-ish units and renders it next to the name; a tag that is
 * too long or full of emoji is a tag nobody reads.
 */
export function clipTag(value, { max = 24 } = {}) {
  const text = String(value || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

export { HEALTH_SEAT_ORDER, COORDINATOR_TAG };
