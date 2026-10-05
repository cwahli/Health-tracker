/**
 * tg-peers.mjs — WHO may address WHICH seat, and by what name.
 *
 * WHAT IT IS
 * ----------
 * The identity and policy half of bot-to-bot messaging (Telegram's Bot API
 * 10.0, 8 May 2026). Two questions, answered without a network call:
 *
 *   1. Is this update from a human or from another bot?
 *   2. May that sender address that target, and what `@username` do we send to?
 *
 * WHY THE POLICY IS NOT A BOOLEAN
 * ------------------------------
 * Telegram delivers `from.is_bot=true` updates on the *existing* getUpdates
 * long-poll the moment Bot-to-Bot Communication Mode is on (bot-host.mjs gates
 * every update on `telegram.allowedUserIds`, which is a user-id check, so a bot
 * sender is currently dropped before any agent sees it). A boolean "allow bots"
 * would be one bit standing between a proposal and an unbounded reply chain.
 * Three states, default-deny:
 *
 *   humans-only                    bot senders dropped (today's behaviour)
 *   humans-and-allowlisted-bots    bot senders accepted only via the peers map
 *   open                           REFUSED outside tests, on purpose
 *
 * `open` is refused rather than supported: a fleet-wide open mesh with no
 * depth bound is the exact loop class Telegram's own docs warn about, and
 * 20.6% of confirmed infinite-agentic-loop findings in real projects are
 * multi-agent chat without a turn bound.
 *
 * THE PEERS MAP IS A DIRECTED TREE, NOT A MESH
 * --------------------------------------------
 *   { "<from>": { "<to>": { maxDepth, cooldownMs, ttlMs } } }
 *
 * Symmetry is the trap: if A may address B and B may address A, one
 * misunderstood message has somewhere to escalate. Start one direction
 * (`"vm3": { "pm": {...} }`), earn the return path later.
 *
 * ADDRESSING WITHOUT A SECOND POLLER OR A SECOND TOKEN
 * ---------------------------------------------------
 * A seat may only send to a `@username` it can name without holding that
 * peer's bot token. Each seat writes its own `identity.json` at boot from the
 * `getMe` it already made to connect (`config.me`); this module only *reads*
 * those files. There is no inline `getMe` here on purpose: a cache miss must
 * refuse, because a network call on the message path is a way to hang ingress.
 *
 * Shared by:
 *   - scripts/bot-host.mjs (inbound classifier in Node 3, /tell in Node 4)
 *   - scripts/assert-bot-peer-policy.test.mjs
 *
 * No Telegram and no provider calls happen here: pure logic plus one file
 * read. Safe to import from tests (point the state dir at a throwaway dir).
 */

import fs from 'node:fs';
import path from 'node:path';

export const HUMAN = 'human';
export const BOT = 'bot';

export const POLICY_HUMANS_ONLY = 'humans-only';
export const POLICY_ALLOWLISTED_BOTS = 'humans-and-allowlisted-bots';
export const POLICY_OPEN = 'open';

export const POLICIES = [POLICY_HUMANS_ONLY, POLICY_ALLOWLISTED_BOTS, POLICY_OPEN];

/** Stable refusal codes. Callers surface the code; humans see the reason. */
export const REFUSAL = {
  POLICY_HUMANS_ONLY: 'policy is humans-only',
  POLICY_OPEN_REFUSED: 'policy "open" is refused outside tests',
  POLICY_UNKNOWN: 'unrecognised sender policy',
  SENDER_UNKNOWN: 'sender has no id',
  TARGET_UNKNOWN: 'target has no id',
  SELF_ADDRESS: 'a seat may not address itself',
  PEER_NOT_ALLOWED: 'no peers entry for this sender to target',
  PEER_NO_IDENTITY_CACHE: 'peer has no identity.json on disk',
  PEER_NO_USERNAME: 'peer identity has no username',
};

/**
 * Human or bot? Telegram puts the answer in `from.is_bot`; a bare object with
 * no id is not a sender at all and must never reach a policy check.
 */
export function senderTypeOf(from) {
  if (!from || typeof from !== 'object') return null;
  if (from.id === undefined || from.id === null || from.id === '') return null;
  return from.is_bot === true ? BOT : HUMAN;
}

/**
 * Resolve the configured policy. Unknown values fall back to the safest state
 * rather than throwing: a typo in an env var must not widen access.
 *
 * `open` is honoured only when the caller is a test, so a misconfigured
 * production box cannot open a mesh by accident.
 */
export function resolvePolicy(raw, { isTest = false } = {}) {
  const value = String(raw ?? '').trim();
  if (!value) return POLICY_HUMANS_ONLY;
  if (!POLICIES.includes(value)) return POLICY_HUMANS_ONLY;
  if (value === POLICY_OPEN && !isTest) return POLICY_HUMANS_ONLY;
  return value;
}

/** The directed edge `from -> to`, or null. Edges are never inferred. */
export function peerEdge(peers, from, to) {
  if (!peers || typeof peers !== 'object') return null;
  const outs = peers[String(from)];
  if (!outs || typeof outs !== 'object') return null;
  const edge = outs[String(to)];
  if (!edge || typeof edge !== 'object') return null;
  return {
    maxDepth: Number(edge.maxDepth) > 0 ? Number(edge.maxDepth) : 2,
    cooldownMs: Number(edge.cooldownMs) > 0 ? Number(edge.cooldownMs) : 60_000,
    ttlMs: Number(edge.ttlMs) > 0 ? Number(edge.ttlMs) : 1_800_000,
  };
}

/** Target ids `from` is allowed to address, sorted for a stable refusal message. */
export function listAddressablePeers(peers, from) {
  if (!peers || typeof peers !== 'object') return [];
  const outs = peers[String(from)];
  if (!outs || typeof outs !== 'object') return [];
  return Object.keys(outs).sort();
}

/**
 * May `from` send to `to`? Pure policy, no naming, no network.
 * Returns `{ ok: true, edge }` or `{ ok: false, code, reason, peers? }`.
 */
export function sendVerdict({ policy, peers, from, to, isTest = false }) {
  const resolved = resolvePolicy(policy, { isTest });
  if (resolved === POLICY_HUMANS_ONLY) {
    return { ok: false, code: 'POLICY_HUMANS_ONLY', reason: REFUSAL.POLICY_HUMANS_ONLY };
  }
  const fromId = from === undefined || from === null ? '' : String(from).trim();
  const toId = to === undefined || to === null ? '' : String(to).trim();
  if (!fromId) return { ok: false, code: 'SENDER_UNKNOWN', reason: REFUSAL.SENDER_UNKNOWN };
  if (!toId) return { ok: false, code: 'TARGET_UNKNOWN', reason: REFUSAL.TARGET_UNKNOWN };
  if (fromId === toId) return { ok: false, code: 'SELF_ADDRESS', reason: REFUSAL.SELF_ADDRESS };
  if (resolved === POLICY_OPEN) return { ok: true, edge: { maxDepth: 2, cooldownMs: 0, ttlMs: 0 } };
  const edge = peerEdge(peers, fromId, toId);
  if (!edge) {
    return {
      ok: false,
      code: 'PEER_NOT_ALLOWED',
      reason: REFUSAL.PEER_NOT_ALLOWED,
      peers: listAddressablePeers(peers, fromId),
    };
  }
  return { ok: true, edge };
}

/**
 * Same verdict for the receiving side. Kept as its own function so the ingress
 * classifier and the sender cannot drift into disagreeing about what is allowed.
 */
export function receiveVerdict(args) {
  return sendVerdict(args);
}

/**
 * Resolve a peer id to the `@username` a send needs, from the identity file the
 * peer wrote for itself. A miss refuses; it never calls Telegram. `stateDir` is
 * the bot-host state root (`~/.local/state/bot-host`).
 */
export function resolvePeerUsername(stateDir, id) {
  const botId = String(id ?? '').trim();
  if (!botId) return { ok: false, code: 'TARGET_UNKNOWN', reason: REFUSAL.TARGET_UNKNOWN };
  let raw;
  try {
    raw = fs.readFileSync(path.join(String(stateDir), botId, 'identity.json'), 'utf8');
  } catch {
    return {
      ok: false,
      code: 'PEER_NO_IDENTITY_CACHE',
      reason: REFUSAL.PEER_NO_IDENTITY_CACHE,
      botId,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'PEER_NO_IDENTITY_CACHE', reason: REFUSAL.PEER_NO_IDENTITY_CACHE, botId };
  }
  const username = String(parsed?.username ?? '').trim().replace(/^@/, '');
  if (!username) {
    return { ok: false, code: 'PEER_NO_USERNAME', reason: REFUSAL.PEER_NO_USERNAME, botId };
  }
  return { ok: true, botId, username: `@${username}`, telegramId: Number(parsed?.telegramId) || 0 };
}

/**
 * Reverse lookup: which seat is this `@username`? Telegram tells us the sender's
 * username and numeric id, never the registry id our peers map is keyed by, so
 * the mapping is read from the identity files the seats wrote for themselves.
 * A miss refuses — an unknown bot is not a peer, however well-formed its message.
 */
export function findSeatByUsername(stateDir, username) {
  const want = String(username ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!want) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(String(stateDir), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(String(stateDir), entry.name, 'identity.json'), 'utf8'));
    } catch {
      continue;
    }
    if (String(parsed?.username ?? '').replace(/^@/, '').toLowerCase() === want) {
      return { seat: entry.name, username: `@${want}`, telegramId: Number(parsed?.telegramId) || 0 };
    }
  }
  return null;
}

/**
 * Build the peers map from a flat record, dropping anything malformed. Used by
 * the CLI and tests so a hand-edited state file cannot inject a non-object edge.
 */
export function normalizePeers(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [from, outs] of Object.entries(raw)) {
    if (!outs || typeof outs !== 'object') continue;
    for (const [to, edge] of Object.entries(outs)) {
      if (!edge || typeof edge !== 'object') continue;
      out[String(from)] ??= {};
      out[String(from)][String(to)] = peerEdge({ [String(from)]: { [String(to)]: edge } }, from, to);
    }
  }
  return out;
}