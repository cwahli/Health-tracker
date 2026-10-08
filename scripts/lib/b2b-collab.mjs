/**
 * b2b-collab.mjs — the one place a peer message is allowed to cost a model turn.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * `tg-handoff.mjs` is the message protocol, and its whole safety story is that a
 * bot-to-bot message is free: it files a line in an inbox and spends no tokens.
 * That is why it could not have two agents actually work together.
 *
 * Collaboration is a different concern with a different cost profile, so it is
 * factored out rather than appended. A message is bounded by bytes, hops and
 * timestamps. A TURN runs a model, may call tools, and — the mechanism that
 * makes an agent loop expensive — can answer back. So the bounds here count
 * turns, rounds and agreements, and they are deliberately much tighter than the
 * message budget: twenty messages in a minute is chatter, twenty turns in a
 * minute is a bill.
 *
 * THE DIVISION OF LABOUR, WHICH IS THE ACTUAL SAFETY PROPERTY
 * -----------------------------------------------------------
 * The model never touches the wire. It is handed a prompt and it writes text.
 * This module and its caller decide what kind of envelope that text becomes,
 * under bounds the model cannot see or widen. A model that ignores its
 * instructions therefore costs exactly one turn and the chain stops — it cannot
 * address a peer, forge a depth, spend a second turn, or declare agreement on
 * the peer's behalf.
 *
 * CONVERGENCE IS TWO FLAGS, NOT A VOTE
 * -----------------------------------
 * An `agree` on the wire means the SENDER is done. A seat records the peer's
 * agreement when one arrives and its own when it sends one; the chain has
 * converged when both exist for the same round. Neither seat can close a chain
 * the other is not in, and one seat agreeing with itself converges nothing.
 *
 * The round is part of the key on purpose. Two seats that agreed in round 1 have
 * not agreed about round 2, and a chain that carried that agreement forward
 * would stop at the first stale consensus instead of the current disagreement.
 */

export const VERSION = 1;

/**
 * The full kind vocabulary. The first six are the original protocol and cost
 * nothing; the last three are collaboration and are governed from here.
 */
export const KINDS = [
  'ask', 'answer', 'blocked', 'handoff-request', 'ack', 'close',
  'delegate', 'feedback', 'agree',
];
/** Kinds that terminate a chain; nothing may follow them. */
export const TERMINAL_KINDS = ['ack', 'close', 'agree'];

/** The only kinds permitted to start an agent turn. */
export const TURNS_KINDS = ['delegate', 'feedback'];
/** A `delegate` opens a round; a `feedback` stays inside the open one. */
export const ROUND_KINDS = ['delegate'];
/**
 * Kinds that answer inside the open round instead of adding a hop.
 *
 * DEPTH, RE-DEFINED PRECISELY BECAUSE THE LOOP NEEDED IT
 * -----------------------------------------------------
 * Depth used to mean "hops on the wire", counted by following `reply_to`. That
 * is the right bound for ask/answer and the wrong one for collaboration: two
 * agents iterating on a letter must trade replies, and every reply bumped depth,
 * so a 3-deep cap allowed one round and a half.
 *
 * So depth counts *re-delegations* — the times work is handed to another seat —
 * and a reply inside an open round does not move it. That is still a real
 * anti-loop bound, and a stricter one where it counts: every round costs a turn
 * and a round slot, and both are capped. It is deliberately NOT relaxed for the
 * old kinds: `ask`, `answer`, `blocked`, `handoff-request`, `ack` and `close`
 * all still increment exactly as before.
 */
export const REPLY_KINDS = ['feedback', 'agree'];

export const COLLAB_DEFAULTS = {
  // Per chain, across the whole negotiation.
  maxTurns: 6,
  // Mesh-wide per seat per window, so N seats cannot collectively out-spend one.
  globalTurns: 8,
  turnWindowMs: 900_000,
  // Two reviewers who agree should be able to say so; two who do not get three
  // chances to move, then the chain is closed with whatever stands.
  maxRounds: 3,
  // Distinct seats that must agree. One is not a consensus.
  minAgreement: 2,
};

export const COLLAB_REFUSAL = {
  TURN_BUDGET: 'chain turn budget exhausted — this chain may not start more agent turns',
  TURN_WINDOW: 'mesh turn budget exhausted for this window',
  ROUNDS_EXHAUSTED: 'collaboration rounds exhausted; no further delegate may open a round',
  DELEGATE_OFF: 'peer delegation is disabled on this seat',
};

/**
 * The chain an envelope belongs to. An explicit `chain=` wins; otherwise the old
 * derived-from-`reply_to` rule, so an envelope written before collaboration still
 * lands in the chain its sender meant.
 *
 * The explicit field exists because the derived rule cannot hold a negotiation
 * together: A->B (reply_to=-) then B->A (reply_to=A's id) keys the second
 * message to a DIFFERENT chain, so round, turn count and the terminal flag would
 * reset on every hop and the chain could neither converge nor refuse.
 */
export function chainIdOf(envelope) {
  const explicit = String(envelope?.chain || '').trim();
  if (explicit) return explicit;
  const reply = String(envelope?.reply_to || '').trim();
  return reply && reply !== '-' ? reply : String(envelope?.id || '');
}

/**
 * How deep is this chain, and may it go one hop further?
 *
 * Two counts are compared and the larger wins. `claimed` is the number on the
 * wire, which a sender can lie about. `honest` is the receiver's own count of
 * what this chain has already cost, which it cannot. Using only the claim is the
 * hole B2B-1 left open: `/tell` recomputes depth, so a well-behaved sender never
 * exceeded the cap, and the receiver therefore trusted the declared number — but
 * a hand-built envelope, a future lane, or a compromised seat would have claimed
 * `depth=1` forever.
 *
 * A reply inside an open round does not add a hop, which is what makes depth a
 * per-round budget rather than a per-message one. See REPLY_KINDS.
 */
export function nextChainDepth({ chain = {}, envelope, edge = {}, claimed = 0, fallbackMax = 2 } = {}) {
  const maxDepth = Number(edge.maxDepth) > 0 ? Number(edge.maxDepth) : fallbackMax;
  const claimedDepth = Number(claimed) > 0 ? Number(claimed) : 1;
  const spent = Number(chain.depth) || 0;
  const honest = spent + (REPLY_KINDS.includes(String(envelope?.kind || '')) ? 0 : 1);
  const worst = Math.max(claimedDepth, honest);
  return {
    ok: worst <= maxDepth,
    code: 'DEPTH_EXCEEDED',
    reason: `chain depth cap reached (declared ${claimedDepth}, chain has ${spent} hop(s), cap ${maxDepth})`,
    claimedDepth,
    honestDepth: honest,
    maxDepth,
    spent,
  };
}

/**
 * The turn floor, as a pure function so it can be tested without a network or a
 * live seat. Called by the receive bounds before anything is recorded.
 *
 * Returns `{ ok: false, code, reason }` to refuse, or the facts the caller needs
 * to decide: whether this envelope may spend a turn, and which round it is in.
 */
export function checkTurnBudget({ chain = {}, turns = [], envelope, edge = {}, globalTurns, now = Date.now(), windowMs = COLLAB_DEFAULTS.turnWindowMs } = {}) {
  const kind = String(envelope?.kind || '');
  const spendsTurn = TURNS_KINDS.includes(kind);
  const isAgree = kind === 'agree';
  const maxTurns = Number(edge.maxTurns) > 0 ? Number(edge.maxTurns) : COLLAB_DEFAULTS.maxTurns;
  const meshTurns = Number(globalTurns) > 0 ? Number(globalTurns) : COLLAB_DEFAULTS.globalTurns;
  const maxRounds = Number(edge.maxRounds) > 0 ? Number(edge.maxRounds) : COLLAB_DEFAULTS.maxRounds;
  // Round 0 means no round has opened yet, so the first delegate is round 1.
  const roundsSoFar = ROUND_KINDS.includes(kind)
    ? (chain.round || 0) + 1
    : Math.max(1, chain.round || 1);
  const liveTurns = (turns || []).filter((at) => now - at < windowMs);

  // The round cap covers `agree` as well as the turn kinds. An `agree` costs no
  // turn, so without this a chain could be told "yes" past its round budget —
  // and since `agree` is terminal on convergence, that would close a chain the
  // bounds had already stopped caring about.
  if ((spendsTurn || isAgree) && roundsSoFar > maxRounds) {
    return {
      ok: false,
      code: 'ROUNDS_EXHAUSTED',
      reason: COLLAB_REFUSAL.ROUNDS_EXHAUSTED,
      spendsTurn,
      round: roundsSoFar,
      maxRounds,
    };
  }

  if (spendsTurn) {
    const used = chain.turns || 0;
    if (used >= maxTurns) {
      return {
        ok: false,
        code: 'TURN_BUDGET',
        reason: `${COLLAB_REFUSAL.TURN_BUDGET} (${used} of ${maxTurns} used)`,
        spendsTurn,
        round: roundsSoFar,
        maxTurns,
        turnsUsed: used,
      };
    }
    if (liveTurns.length >= meshTurns) {
      return {
        ok: false,
        code: 'TURN_WINDOW',
        reason: `${COLLAB_REFUSAL.TURN_WINDOW} (${liveTurns.length} of ${meshTurns})`,
        spendsTurn,
        round: roundsSoFar,
        maxTurns,
      };
    }
  }

  return {
    ok: true,
    spendsTurn,
    isAgree,
    round: roundsSoFar,
    maxTurns,
    maxRounds,
    turnsUsed: (chain.turns || 0) + (spendsTurn ? 1 : 0),
    chainDepth: (chain.depth || 0) + (REPLY_KINDS.includes(kind) ? 0 : 1),
    liveTurns,
  };
}

/**
 * Has this round collected both halves of an agreement?
 *
 * Two flags, both local. Nothing is shared between seats except the envelopes
 * themselves, so the seat that receives the second `agree` is the only one that
 * can see both — and it is therefore the one that closes.
 */
export function agreementState({ chain = {}, peerAgreedRound = 0, nowRound = 1 } = {}) {
  const peerAgree = Number(peerAgreedRound) || Number(chain.peerAgree) || 0;
  const ourAgree = Number(chain.ourAgree) || 0;
  const agreedRound = Math.max(peerAgree, ourAgree) || nowRound;
  const need = Math.max(2, COLLAB_DEFAULTS.minAgreement);
  return {
    peerAgree,
    ourAgree,
    agreedRound,
    converged: peerAgree === agreedRound && ourAgree === agreedRound && need <= 2 && agreedRound > 0,
  };
}

/**
 * The chain record a SEND leaves behind.
 *
 * Pure, because the send side needs two facts only this module knows: that a
 * `delegate` opens a round, and that an `agree` sent now is this seat's half of
 * a convergence. The half matters — the seat that receives the peer's `agree`
 * can only see both halves if this seat recorded its own when it sent.
 */
export function sentChainRecord(chain = {}, envelope, { depth = 1, now = Date.now() } = {}) {
  const kind = String(envelope?.kind || '');
  const isAgree = kind === 'agree';
  const round = ROUND_KINDS.includes(kind) ? (chain.round || 0) + 1 : Math.max(1, chain.round || 1);
  return {
    depth,
    round,
    ourAgree: isAgree ? round : (chain.ourAgree || 0),
    lastAt: now,
    terminal: TERMINAL_KINDS.includes(kind),
  };
}

/**
 * The chain record a RECEIVE leaves behind.
 *
 * The receiver keeps its OWN depth count rather than the sender's declared one,
 * for the same reason it refuses on the honest count: a well-behaved sender
 * quotes the same low depth on every reply, so `Math.max(chain.depth, depth)`
 * would let a chain sit at hop 1 indefinitely. Taking the max of both is what
 * makes the cap mean something at the receiving end.
 *
 * `terminal` is deliberately false for a first `agree`: see agreementState().
 */
export function receivedChainRecord(chain = {}, envelope, {
  honestDepth = 0,
  claimedDepth = 0,
  turnsUsed = 0,
  round = 1,
  agreement = {},
  converged = false,
  now = Date.now(),
} = {}) {
  const kind = String(envelope?.kind || '');
  const isAgree = kind === 'agree';
  return {
    depth: Math.max(Number(chain.depth) || 0, honestDepth, claimedDepth),
    turns: turnsUsed,
    round,
    peerAgree: agreement.peerAgree || 0,
    ourAgree: agreement.ourAgree || 0,
    lastAt: now,
    // An `agree` ends the chain only on CONVERGENCE. Terminal on the first one
    // would refuse the second as AFTER_TERMINAL, and no chain could converge.
    terminal: TERMINAL_KINDS.includes(kind) && !(isAgree && !converged),
  };
}

/** The agent's verdict line. Matched case-insensitively, on a line of its own. */
export const AGREEMENT_RE = /^\s*(?:\*\*)?verdict\s*:\s*agree(?:\*\*)?\s*$/im;

/**
 * Whether a turn's text is an agreement, and the letter to keep if it is.
 *
 * The marker is stripped from the letter: the human receives a letter, not a
 * protocol trace. A turn with no marker is not an agreement — the default has to
 * be "keep working", because the failure mode of guessing yes is a chain that
 * stops early and the failure mode of guessing no is a chain that runs into its
 * budget. Only one of those wastes money.
 *
 * The word "agree" in prose does not count. A marker has to be its own line, or
 * two agents discussing the word would close their chain on the discussion.
 */
export function readAgreement(text) {
  const raw = String(text ?? '');
  const agreed = AGREEMENT_RE.test(raw);
  const letter = agreed
    ? raw.replace(AGREEMENT_RE, '').replace(/\n{3,}/g, '\n\n').trim()
    : raw.trim();
  return { agreed, letter };
}

/**
 * The prompt for a delegated turn.
 *
 * `source` is the material the operators want reviewed — the host reads it once
 * and hands the same text to both seats, so the two reviewers cannot end up
 * arguing about different copies of the facts. Injecting the material beats
 * handing over a link: a seat with no working Google credential would otherwise
 * fail open into a confident letter about a document it never read.
 *
 * It is also the only place a model is told anything about the protocol, and it
 * is one instruction long on purpose. A model that ignores it costs one turn and
 * the chain stops; it cannot loop.
 */
export function delegationPrompt(envelope, {
  self = '',
  round = 1,
  turnsLeft = 0,
  maxRounds = COLLAB_DEFAULTS.maxRounds,
  source = '',
} = {}) {
  const peer = envelope.from;
  const verb = envelope.kind === 'feedback' ? 'reviewed' : 'asked you to work on';
  const lines = [
    '[b2b delegation — this is NOT from the human]',
    '',
    `Peer seat \`${peer}\` ${verb} tracked work \`${envelope.ref}\` and you are seat \`${self}\`.`,
    'The human is not in this conversation and did not type this. Do not ask them',
    'anything and do not guess at what they want beyond the material below.',
    '',
    `--- WHAT ${String(peer).toUpperCase()} SENT (round ${round}) ---`,
    envelope.body,
  ];
  if (source) lines.push('', '--- SOURCE MATERIAL, read by the host for both of you ---', source);
  lines.push(
    '',
    '--- YOUR JOB ---',
    `Work the request above as ${self}. Produce the finished deliverable as your`,
    'final message: no preamble about being an AI, no restating these instructions,',
    `no questions back. Your final message is sent to ${peer} automatically by the`,
    'host — you cannot send it yourself and you must not try.',
    '',
    `This is round ${round} of at most ${maxRounds}, and ${turnsLeft} turn(s) remain in`,
    `this chain. If ${peer}'s version is already right, say so and keep it rather than`,
    'rewriting it for the sake of it.',
    '',
    '--- ENDING THE CHAIN ---',
    'When you are satisfied this round is finished, put this as the LAST line of',
    'your message, on a line of its own:',
    '',
    'Verdict: agree',
    '',
    'Omit that line if you still want changes. Two seats must both print it in the',
    'same round before the chain closes; neither seat can close it alone.',
  );
  return lines.join('\n');
}
