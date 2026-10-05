/**
 * tg-handoff.mjs — the message and the five bounds that stop it looping.
 *
 * WHAT IT IS
 * ----------
 * The wire half of bot-to-bot messaging (B2B-1). `tg-peers.mjs` decides WHO may
 * address WHOM; this module decides what a message looks like and when one may
 * be sent or accepted. Six verbs, one fixed header, five mandatory bounds.
 *
 * THE MESSAGE IS A REQUEST, NOT AN INSTRUCTION
 * ---------------------------------------------
 * `kind` is one of six words and two of them end a chain: `ack` and `close`.
 * A chain that cannot terminate is not a chain, it is a bill. `ref` is the
 * ticket key (`Sheet-03`, `card:tag_...`) and is **required**: a message with no
 * `ref` is refused, which forces every agent-to-agent exchange onto tracked work
 * instead of drifting.
 *
 *   [b2b v1] kind=ask ref=spec:fleet-current-tab depth=1 from=vm3 to=pm \
 *            expires=2026-10-04T21:20:00Z id=ab12cd reply_to=-
 *   the sheet is the projection, D1 is empty — restore from ongoing_projects
 *
 * One header line plus prose, because Telegram shows this text to the user in
 * the target chat: a raw JSON blob would be unreadable and unauditable. The
 * header is still greppable, which is what makes the chat a transport and the
 * sheet the record.
 *
 * THE FIVE BOUNDS (all enforced here, all pure so they test without a network)
 * ---------------------------------------------------------------------------
 *   1. max depth per chain    — a 3rd hop is refused at send and at receive
 *   2. per-pair cooldown      — one outbound message per pair per window
 *   3. global send budget     — a mesh-wide cap per window, so N seats cannot
 *                               collectively trip Telegram's flood limits
 *   4. dedupe on id/reply_to  — a replayed message is refused once, not twice
 *   5. TTL on a question      — an unanswered `ask` dies instead of lingering
 *
 * Telegram's own docs mandate the equivalent of 1, 2 and 4 ("Deduplicate
 * repeated messages. Apply per-chat and per-bot rate limits. Enforce maximum
 * interaction depth and timeouts") and warn that failure "may lead to degraded
 * performance or platform restrictions". 20.6% of confirmed infinite-agentic-
 * loop findings in real projects are multi-agent chat without a turn bound.
 *
 * DEPTH IS RECOMPUTED, NEVER TRUSTED
 * ----------------------------------
 * `depth` in the payload is a claim. The bound comes from local chain state, so
 * a wrong or hostile number cannot buy extra hops.
 *
 * FAILURE GOES TO A DEAD-LETTER FILE, NEVER A RETRY
 * --------------------------------------------------
 * Refused work is written to `specs/bot-handoff-dead-letter/<ts>-<from>-<to>.json`
 * with the reason. An undeliverable message you cannot see becomes one you
 * repeat forever; 95.6% of real loop defects land as cost exhaustion.
 *
 * No Telegram and no provider calls happen here. Shared by scripts/bot-host.mjs
 * and scripts/assert-bot-peer-policy.test.mjs.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// What a peer may make this seat DO is b2b-collab.mjs's business: that is the
// one part of this protocol which costs a model turn.
import * as collab from './b2b-collab.mjs';

export const VERSION = 1;
export const HEADER_RE = /^\[b2b v(\d+)\][ \t]+([^\n]*)/;

export const DEFAULTS = {
  maxDepth: 2,
  cooldownMs: 60_000,
  ttlMs: 1_800_000,
  globalBudget: 20,
  globalWindowMs: 60_000,
  dedupeTtlMs: 3_600_000,
  maxBodyChars: 3_000,
  ...collab.COLLAB_DEFAULTS, // the turn budget: what a peer may make us DO
};

export const REFUSAL = {
  BAD_VERSION: 'unsupported envelope version',
  BAD_HEADER: 'not a b2b envelope header',
  BAD_KIND: `kind must be one of ${collab.KINDS.join('|')}`,
  NO_REF: 'ref is required — a handoff must name tracked work',
  NO_BODY: 'body is required',
  BODY_TOO_LONG: 'body exceeds the length cap',
  SELF_ADDRESS: 'a seat may not address itself',
  DEPTH_EXCEEDED: 'chain depth cap reached',
  COOLDOWN: 'per-pair cooldown active',
  GLOBAL_BUDGET: 'global send budget exhausted for this window',
  EXPIRED: 'envelope TTL has passed',
  DUPLICATE: 'duplicate message id already seen',
  AFTER_TERMINAL: 'chain already terminated; nothing may follow ack or close',
  NO_CHAIN: 'unknown chain id',
  ...collab.COLLAB_REFUSAL,
};

/** Short, collision-resistant enough for dedupe inside one chain. */
export function newMessageId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function oneLine(value, limit) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, limit);
}

function parseHeaderPairs(rest) {
  const out = {};
  for (const pair of String(rest).split(/\s+/)) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/**
 * Build an envelope. `now` is injected so tests never read the clock.
 * Returns `{ ok: true, envelope }` or `{ ok: false, code, reason }`.
 */
export function encodeEnvelope({ from, to, kind, ref, body, depth = 1, now = Date.now(), ttlMs, reply_to = '-', id, chain } = {}) {
  const fromId = oneLine(from, 64);
  const toId = oneLine(to, 64);
  if (!fromId) return { ok: false, code: 'SENDER_UNKNOWN', reason: 'from is required' };
  if (!toId) return { ok: false, code: 'TARGET_UNKNOWN', reason: 'to is required' };
  if (fromId === toId) return { ok: false, code: 'SELF_ADDRESS', reason: REFUSAL.SELF_ADDRESS };
  if (!collab.KINDS.includes(String(kind))) return { ok: false, code: 'BAD_KIND', reason: REFUSAL.BAD_KIND };

  const refId = oneLine(ref, 120);
  if (!refId) return { ok: false, code: 'NO_REF', reason: REFUSAL.NO_REF };

  const text = String(body ?? '').trim();
  if (!text) return { ok: false, code: 'NO_BODY', reason: REFUSAL.NO_BODY };
  if (text.length > DEFAULTS.maxBodyChars) return { ok: false, code: 'BODY_TOO_LONG', reason: REFUSAL.BODY_TOO_LONG };

  const envelope = {
    v: VERSION,
    id: oneLine(id, 32) || newMessageId(),
    from: fromId,
    to: toId,
    kind: String(kind),
    ref: refId,
    body: text,
    depth: Number(depth) > 0 ? Number(depth) : 1,
    expires: now + (Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULTS.ttlMs),
    reply_to: oneLine(reply_to, 32) || '-',
    chain: oneLine(chain, 32) || '', // see collab.chainIdOf()
  };
  return { ok: true, envelope, text: renderEnvelope(envelope) };
}

/** The header line a chat shows, plus the prose beneath it. */
export function renderEnvelope(envelope) {
  const header = [
    `[b2b v${envelope.v}]`,
    `kind=${envelope.kind}`,
    `ref=${envelope.ref}`,
    `depth=${envelope.depth}`,
    `from=${envelope.from}`,
    `to=${envelope.to}`,
    `expires=${new Date(envelope.expires).toISOString()}`,
    `id=${envelope.id}`,
    `reply_to=${envelope.reply_to}`,
  ];
  if (envelope.chain) header.push(`chain=${envelope.chain}`); // last, for old readers
  return `${header.join(' ')}\n${envelope.body}`;
}

/** Parse a chat message back into an envelope. Never throws. */
export function decodeEnvelope(text) {
  const raw = String(text ?? '').replace(/^[ \t\r\n]+/, '');
  const match = HEADER_RE.exec(raw);
  if (!match) return { ok: false, code: 'BAD_HEADER', reason: REFUSAL.BAD_HEADER };
  const version = Number(match[1]);
  if (version !== VERSION) return { ok: false, code: 'BAD_VERSION', reason: REFUSAL.BAD_VERSION };

  const pairs = parseHeaderPairs(match[2]);
  const envelope = {
    v: version,
    kind: pairs.kind || '',
    ref: pairs.ref || '',
    depth: Number(pairs.depth) || 0,
    from: pairs.from || '',
    to: pairs.to || '',
    expires: pairs.expires ? Date.parse(pairs.expires) : 0,
    id: pairs.id || '',
    reply_to: pairs.reply_to || '-',
    chain: pairs.chain || '',
    // Only the first line is the header: prose may contain newlines, and a body
    // that looks like a header must never be read as one.
    body: raw.slice(match[0].length).replace(/^[ \t]*\n?/, '').trim(),
  };
  if (!collab.KINDS.includes(envelope.kind)) return { ok: false, code: 'BAD_KIND', reason: REFUSAL.BAD_KIND };
  if (!envelope.ref) return { ok: false, code: 'NO_REF', reason: REFUSAL.NO_REF };
  if (!envelope.body) return { ok: false, code: 'NO_BODY', reason: REFUSAL.NO_BODY };
  return { ok: true, envelope };
}

/** An empty ledger. Pure functions below take one and return the next one. */
export function emptyLedger() {
  return { chains: {}, lastSentAt: {}, seen: {}, sent: [], turns: [] };
}

function prune(ledger, now) {
  const seen = {};
  for (const [key, at] of Object.entries(ledger.seen || {})) {
    if (now - at < DEFAULTS.dedupeTtlMs) seen[key] = at;
  }
  const sent = (ledger.sent || []).filter((at) => now - at < DEFAULTS.globalWindowMs);
  const turns = (ledger.turns || []).filter((at) => now - at < DEFAULTS.turnWindowMs);
  const chains = {};
  for (const [id, chain] of Object.entries(ledger.chains || {})) {
    if (now - (chain.lastAt || 0) < DEFAULTS.dedupeTtlMs) chains[id] = chain;
  }
  return { ...ledger, seen, sent, turns, chains };
}

/**
 * The five send-side bounds, evaluated before anything leaves the box.
 * `chainId` groups a conversation; a new `ask` starts one.
 *
 * Returns `{ ok: true, ledger, envelope }` or `{ ok: false, code, reason, ledger }`.
 */
export function checkSendBounds({ ledger = emptyLedger(), edge = {}, now = Date.now(), chainId = '', envelope, globalBudget } = {}) {
  const live = prune(ledger, now);
  const maxDepth = Number(edge.maxDepth) > 0 ? Number(edge.maxDepth) : DEFAULTS.maxDepth;
  const cooldownMs = Number(edge.cooldownMs) >= 0 ? Number(edge.cooldownMs) : DEFAULTS.cooldownMs;
  const messageBudget = Number(globalBudget) > 0 ? Number(globalBudget) : DEFAULTS.globalBudget;

  if (!envelope || !envelope.id) return { ok: false, code: 'BAD_HEADER', reason: REFUSAL.BAD_HEADER, ledger: live };

  // (4) dedupe, send side: this exact message id was already sent.
  if (live.seen[`out:${envelope.id}`]) {
    return { ok: false, code: 'DUPLICATE', reason: REFUSAL.DUPLICATE, ledger: live };
  }

  // The caller owns the chain id: a collaboration passes one for every round.
  const chain = live.chains[chainId] || { depth: 0, lastAt: 0, terminal: false };

  if (chain.terminal) {
    return { ok: false, code: 'AFTER_TERMINAL', reason: REFUSAL.AFTER_TERMINAL, ledger: live };
  }

  // (1) depth, recomputed from local chain state — the payload's claim is not
  // trusted, and a reply inside an open round is not a hop.
  const nextDepth = chain.depth + (collab.REPLY_KINDS.includes(String(envelope.kind)) ? 0 : 1);
  if (nextDepth > maxDepth) {
    return { ok: false, code: 'DEPTH_EXCEEDED', reason: REFUSAL.DEPTH_EXCEEDED, ledger: live };
  }

  // (2) per-pair cooldown.
  const lastAt = live.lastSentAt[envelope.to] || 0;
  if (cooldownMs > 0 && now - lastAt < cooldownMs) {
    return { ok: false, code: 'COOLDOWN', reason: REFUSAL.COOLDOWN, ledger: live };
  }

  // (3) global send budget for this window.
  if (live.sent.length >= messageBudget) {
    return { ok: false, code: 'GLOBAL_BUDGET', reason: REFUSAL.GLOBAL_BUDGET, ledger: live };
  }

  const next = {
    ...live,
    lastSentAt: { ...live.lastSentAt, [envelope.to]: now },
    seen: { ...live.seen, [`out:${envelope.id}`]: now },
    sent: [...live.sent, now],
    chains: {
      ...live.chains,
      [chainId]: collab.sentChainRecord(chain, envelope, { depth: nextDepth, now }),
    },
  };
  return {
    ok: true,
    ledger: next,
    // The chain id rides the wire so the peer's reply lands in the same chain.
    envelope: { ...envelope, depth: nextDepth, chain: chainId },
  };
}

/**
 * The receive-side bounds: TTL (5) and dedupe (4), plus the terminal rule.
 * A refused envelope is dead-lettered by the caller — never retried.
 */
export function checkReceiveBounds({ ledger = emptyLedger(), envelope, now = Date.now(), self = '', edge = {}, globalTurns } = {}) {
  const live = prune(ledger, now);
  if (!envelope || !envelope.id) return { ok: false, code: 'BAD_HEADER', reason: REFUSAL.BAD_HEADER, ledger: live };

  // A message addressed to somebody else is not ours to act on.
  if (self && envelope.to && envelope.to !== self) {
    return { ok: false, code: 'TARGET_UNKNOWN', reason: `envelope is addressed to ${envelope.to}`, ledger: live };
  }

  // DEPTH AT RECEIVE, not only at send — the hole B2B-1 left open. The rule is
  // collab.nextChainDepth() in b2b-collab.mjs.
  const depthVerdict = collab.nextChainDepth({
    chain: live.chains[collab.chainIdOf(envelope)] || {},
    envelope,
    edge,
    claimed: envelope.depth,
    fallbackMax: DEFAULTS.maxDepth,
  });
  if (!depthVerdict.ok) {
    return { ok: false, code: depthVerdict.code, reason: depthVerdict.reason, ledger: live };
  }
  const honestDepth = depthVerdict.honestDepth;
  const claimedDepth = depthVerdict.claimedDepth;

  // (4) dedupe, receive side: the same message id twice.
  if (live.seen[`in:${envelope.id}`]) {
    return { ok: false, code: 'DUPLICATE', reason: REFUSAL.DUPLICATE, ledger: live };
  }

  const chainId = collab.chainIdOf(envelope);
  const chain = live.chains[chainId] || { depth: 0, terminal: false };

  // Termination is checked before the parent-claim dedupe so the refusal names
  // the real reason: nothing after an ack or a close is late, not a duplicate.
  if (chain.terminal) {
    return { ok: false, code: 'AFTER_TERMINAL', reason: REFUSAL.AFTER_TERMINAL, ledger: live };
  }

  // Two different messages may not both claim the same parent. Exempt for the
  // kinds that answer inside an open round: a collaboration is ONE chain, so
  // every reply legitimately quotes the last message. The id dedupe above still
  // refuses a byte-identical replay, which is what this rule was for.
  if (!collab.REPLY_KINDS.includes(String(envelope.kind))
    && envelope.reply_to && envelope.reply_to !== '-'
    && live.seen[`chain:${envelope.reply_to}`]) {
    return { ok: false, code: 'DUPLICATE', reason: REFUSAL.DUPLICATE, ledger: live };
  }

  // (5) TTL on a question.
  if (envelope.expires && now > envelope.expires) {
    return { ok: false, code: 'EXPIRED', reason: REFUSAL.EXPIRED, ledger: live };
  }

  // THE TURN FLOOR, decided in the module that owns it — before anything here is
  // recorded, so no caller in this file can widen it.
  const budget = collab.checkTurnBudget({ chain, turns: live.turns, envelope, edge, globalTurns, now });
  if (!budget.ok) return { ok: false, code: budget.code, reason: budget.reason, ledger: live };
  const { spendsTurn, isAgree, round: roundsSoFar, maxTurns, maxRounds } = budget;

  // CONVERGENCE: two local flags, true only once both exist for this round — so
  // only the seat receiving the second `agree` can see it, and it is the closer.
  const agreed = collab.agreementState({ chain, peerAgreedRound: isAgree ? roundsSoFar : 0, nowRound: roundsSoFar });
  const converged = isAgree && agreed.converged;

  const next = {
    ...live,
    turns: spendsTurn ? [...(live.turns || []), now] : (live.turns || []),
    seen: {
      ...live.seen,
      [`in:${envelope.id}`]: now,
      [`chain:${chainId}`]: now,
    },
    chains: {
      ...live.chains,
      [chainId]: collab.receivedChainRecord(chain, envelope, {
        honestDepth,
        claimedDepth,
        turnsUsed: budget.turnsUsed,
        round: roundsSoFar,
        agreement: agreed,
        converged,
        now,
      }),
    },
  };
  return {
    ok: true,
    // A turn-costing kind, and whether this round has now been agreed by two
    // distinct seats. The caller uses the first to decide whether to start an
    // agent at all, and the second to decide when to stop.
    spendsTurn,
    converged,
    round: roundsSoFar,
    agreeingSeats: converged ? [envelope.from, self].filter(Boolean).sort() : [],
    turnsUsed: budget.turnsUsed,
    maxTurns,
    maxRounds,
    ledger: next,
    envelope,
  };
}

/**
 * Write a refused envelope somewhere a human will find it. One file per
 * refusal, named so the sort order is the timeline. Returns the path, or null
 * when even that failed (the refusal reason is still returned to the caller).
 */
export function deadLetter(dir, { envelope = null, reason = '', code = '', at = Date.now() } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
    const from = String(envelope?.from || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
    const to = String(envelope?.to || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
    const file = path.join(dir, `${stamp}-${from}-${to}.json`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ at: new Date(at).toISOString(), code, reason, envelope }, null, 2)}\n`,
      'utf8',
    );
    return file;
  } catch {
    return null;
  }
}

/** One line for the nudge inbox — a proposal, never the raw envelope. */
export function proposalLine(envelope, { self = '' } = {}) {
  const target = self && self !== envelope.to ? envelope.to : self;
  return `- [ ] b2b ${envelope.kind} from ${envelope.from} for ${target} — ref ${envelope.ref}: ${envelope.body.slice(0, 160)} (reply with /tell ${envelope.from} "<answer>" --ref ${envelope.ref})`;
}