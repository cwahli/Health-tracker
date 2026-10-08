const DECISION_HINTS = [
  /\bi'?ll\b/i,
  /\bi will\b/i,
  /\bneed to\b/i,
  /\bshould\b/i,
  /\bbecause\b/i,
  /\bso that\b/i,
  /\bfirst\b/i,
  /\bnext\b/i,
  /\bthen\b/i,
  /\blet me\b/i,
  /\bcheck\b/i,
  /\bfix\b/i,
  /\bthe (bug|issue|problem|error)\b/i,
  /\broot cause\b/i,
  /\bplan\b/i,
];

export function cleanReasoning(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[#*_>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSentences(text) {
  return cleanReasoning(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function compressReasoning(text, { maxChars = 220 } = {}) {
  const sentences = splitSentences(text);
  if (!sentences.length) return '';
  const picked = [sentences[0]];
  for (const sentence of sentences.slice(1)) {
    if (picked.join(' ').length >= maxChars) break;
    if (DECISION_HINTS.some((re) => re.test(sentence))) picked.push(sentence);
  }
  let out = picked.join(' ');
  if (out.length > maxChars) {
    const room = Math.max(0, maxChars - 3);
    out = `${out.slice(0, room).replace(/\s+\S*$/, '')}...`;
  }
  return out;
}

/**
 * A reasoning stream reducer, keyed by part id.
 *
 * WHY THIS EXISTS
 * ---------------
 * `compressReasoning` used to be handed each arriving fragment on its own and
 * asked for a gist of *that fragment*. Providers stream reasoning in pieces,
 * so a fragment that arrived mid-sentence produced a fragment, and the caller's
 * `gist === previousGist` guard then dropped it silently. The `Thinking:` line
 * froze on whatever landed first while the real thinking moved on.
 *
 * Compressing the ACCUMULATED stream instead fixes that: the gist summarises
 * the phase so far, so it advances as the phase does.
 *
 * Three upstream facts shape the design, and none of them are hypothetical:
 *
 * 1. `message.part.delta` can arrive BEFORE `message.part.updated` for the
 *    same partID (opencode #26924 — `updatePart` publishes fire-and-forget on
 *    a separate fiber, `updatePartDelta` on the caller's). So a delta for an
 *    unknown part must be BUFFERED, never dropped and never guessed at.
 * 2. opencode publishes reasoning deltas with `field:"text"` (vercel's harness
 *    notes it explicitly). So `field` cannot tell reasoning from prose — only
 *    the part's declared `type` can.
 * 3. A `reasoning start before end` defect is live (opencode #43312), so an
 *    open fragment may never close. Nothing here waits for balance.
 *
 * Reconstructing from `fullText` when the producer sends it is what makes the
 * result order-independent where that actually matters: a late snapshot
 * overwrites whatever was accumulated from deltas and converges on the same
 * text. Deltas themselves stay in arrival order, because a delta is *defined*
 * as an append — replaying them backwards is meaningless, not a bug.
 */
export function createReasoningReducer({ maxChars = 220, minWords = 2 } = {}) {
  /** @type {Map<string, { text: string, open: boolean }>} */
  const parts = new Map();

  const keyFor = (partID, index) => String(partID ?? `__anon_${index}`);

  return {
    /**
     * Feed one event. `part` is `{ id?, type?, text? }` when the producer sent
     * a part snapshot; `text` is the delta when it sent one.
     * Returns the current gist, or '' when there is nothing worth saying.
     */
    push(part, { text = '' } = {}) {
      const key = keyFor(part?.id, this._n);
      let slot = parts.get(key);
      if (!slot) {
        slot = { text: '', open: true };
        parts.set(key, slot);
      }

      // A full snapshot is authoritative and order-independent. A delta for a
      // part we have never seen is buffered under its own id rather than
      // attributed to whatever happened to arrive last.
      if (typeof part?.text === 'string' && part.text.length >= slot.text.length) {
        slot.text = part.text;
      } else if (text) {
        slot.text += text;
      }

      if (part?.type === 'reasoning') slot.open = true;
      if (part?.time?.end != null) slot.open = false;

      const accumulated = [...parts.values()].map((p) => p.text).join(' ').trim();
      if (!accumulated) return '';
      const gist = compressReasoning(accumulated, { maxChars });
      const clean = gist.trim();
      // A one-word "gist" is a fragment that slipped through, not a summary.
      // Suppressing it is what #512 already does per-fragment; doing it on the
      // accumulated text is the same guard with far fewer false positives.
      if (!clean || clean.split(/\s+/).length < minWords) return '';
      return clean;
    },

    /** True when any part is still open (a fragment that may yet be closed). */
    get open() {
      return [...parts.values()].some((p) => p.open);
    },

    /** The accumulated raw text, for the pane and for tests. */
    get text() {
      return [...parts.values()].map((p) => p.text).join(' ').trim();
    },

    parts() {
      return [...parts.entries()].map(([id, p]) => ({ id, text: p.text, open: p.open }));
    },

    reset() {
      parts.clear();
      this._n = 0;
    },
    _n: 0,
  };
}
