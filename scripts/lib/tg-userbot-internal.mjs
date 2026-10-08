/**
 * tg-userbot-internal.mjs — the connect seam, exported.
 *
 * `lib/tg-userbot.mjs` keeps `connect()` private because its other callers want
 * one shape (a client plus a disconnect they must remember). This module is the
 * same door with a narrower promise, for the one caller that has to reason about
 * dialogs and participants itself: the seat tag CLI.
 *
 * It is a re-export, not a second login path, so there is exactly one place in
 * the tree that knows how a session is opened and one place that knows the
 * teleproto import shape.
 */

export { connect } from './tg-userbot.mjs';
