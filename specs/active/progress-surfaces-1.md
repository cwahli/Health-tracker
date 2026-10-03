---
id: PROGRESS-SURFACES-1
status: locked
class: L
edit_mode: patch
skill: builder
auto_go: false
allowed_files:
  - scripts/lib/reasoning-compress.mjs
  - scripts/bot-host.mjs
  - scripts/lib/bot-status.mjs
  - scripts/assert-progress-surfaces.test.mjs
  - tests/bot-host.test.ts
  - src/jobs/__tests__/JobSession.contract.test.ts
frozen_files:
  - scripts/lib/worker-jobs.mjs
  - scripts/lib/work-session.mjs
  - scripts/lib/tg-progress.mjs
  - bots/registry.json
  - scripts/lib/registry.mjs
  - AGENTS.md
gate:
  - node scripts/assert-progress-surfaces.test.mjs
  - npx vitest run tests/bot-host.test.ts
  - node scripts/assert-pm-role.test.mjs
  - npx tsc --noEmit
---

# PROGRESS-SURFACES-1 — make the two live surfaces tell one story

## Status: BLOCKED ON A HUMAN PRODUCT DECISION. Do not build until it is answered.

Nodes 1 and 2 below are mechanical and safe. **Node 3 is a product decision and
is deliberately not pre-approved** — see "The decision" at the bottom.

## Why this packet exists

A turn's events fan out at `scripts/bot-host.mjs:3804` to two sinks:

```js
export function fanoutProgressEvent({ renderer, observer, event, context = {} }) {
  try { renderer?.onEvent(event); } catch {}      // Telegram headline
  try { observer?.onEvent(event, context); } catch {}  // tmux pane
}
```

Same event, two recorders, **no shared state and no reconciliation**. Three
defects survive there, all still open after PROGRESS-SURFACES-0 (#524) fixed the
plumbing underneath.

**Shipped and NOT repeated here:** #512 (662bdf71) added the 12s heartbeat,
raised the edit cap 40→120, and added the `lastEventAt` proof-of-life. The
"frozen headline" Tier-2 item from the original analysis is done. Do not redo it.

### Gap A — `compressReasoning` re-derives from each shard in isolation

`scripts/lib/reasoning-compress.mjs:38` takes `sentences[0]` of whatever chunk
it is handed. Providers stream reasoning in fragments, so a chunk arriving
mid-sentence yields a fragment, and the dedupe guard in `onEvent`
(`clean === this.thinking`) then **silently discards** it. Telegram's
`Thinking:` line freezes on an early fragment while the pane scrolls the real
text. #512 made this *sharper*, not fixed: it added a two-word minimum
(`clean.split(/\s+/).length < 2`), so more real thinking is now filtered out.

Upstream makes this worse than a bad algorithm. opencode #26924:
`message.part.delta` can arrive **before** `message.part.updated` for the same
`partID` — `updatePart` publishes fire-and-forget on a separate fiber while
`updatePartDelta` publishes on the caller's. So you cannot accumulate reasoning
by field, and the first delta may precede part registration. vercel's harness
notes opencode publishes **reasoning deltas with `field:"text"`**. Also
opencode #43312: a `reasoning start before end` defect is live — fragments can
fail to close, so **do not require balance**.

### Gap B — two different meanings of "thinking", one word

- `scripts/lib/bot-status.mjs:108` — `thinking: effective.variant`, the
  thinking **level** (low/high/xhigh). `/status` prints `thinking: high`.
- `scripts/bot-host.mjs:1435` — `this.thinking = gist`, the thinking **text**.

`_render()` emits `this.thinkingLevel` in the headline *and* `Thinking: <text>`
as a separate line. Two fields, one concept, no disambiguation.

### Gap C — the pane and the chat are different audiences, and treat thinking the same

tmux/observer is the **engineer** surface: verbatim, full depth, correct.
Telegram is the **user** surface. Node 3 makes them differ deliberately.

## Nodes

### Node 1 — compress the accumulated stream, not the shard (mechanical)

- Key the reducer on `partID` + part **type**, never on `field`.
- Accumulate reasoning per part; compress the **accumulated** text so the gist
  is a summary of the whole phase, not of whichever fragment arrived last.
- Reconstruct from `fullText` where available rather than concatenating deltas,
  which is what tolerates the out-of-order first delta from #26924.
- Tolerate an unclosed reasoning fragment (#43312). Never throw on imbalance.
- Hold a short debounce so a mid-sentence fragment never becomes a headline.

**Sensor (extends the #524 file, new file so #524 stays untouched):**
`scripts/assert-progress-surfaces.test.mjs` asserts an out-of-order
first-delta stream and an interleaved text/reasoning stream both reconstruct
identically to an in-order stream.

### Node 2 — separate the two "thinking" fields (mechanical)

- Rename to `thinkingLevel` (variant) and `thinkingText` (gist). No behaviour
  change beyond naming.
- Render `Thinking:` only when there is actual prose, so a level and a gist
  can never both appear under one word.
- `bot-status.mjs` output stays `thinking:` for `/status` compatibility; the
  headline gains an explicit `level:` where both are shown.

### Node 3 — phase labels instead of prose reasoning (NEEDS A HUMAN DECISION)

**Not pre-approved. Blocked.**

The source check argues against shipping raw or paraphrased CoT to the user
surface:

- Visible CoT mentioned the driving hint only **25%** (Claude 3.7) / **39%**
  (R1), dropping further on harder problems. A user reasoning from it forms a
  mental model the system does not honour.
- Users **argue with the reasoning instead of the answer** — a trace hedged
  "this is sensitive, maybe consult a lawyer" becomes a support ticket about
  the product being "weasel-worded".
- ollama #8528 and open-webui #8706: users actively ask to **hide** thinking.
- 20-second silent gaps are a real problem, but the fix is a truthful status
  line, not the monologue.

**The options, for whoever decides:**

1. **Phase labels from tool lifecycle** (recommended). Telegram shows
   `Reading sources` / `Running gate` / `Writing proof`, driven off real
   tool-start/tool-end events. True by construction, cheap, and it cannot
   contradict the answer. tmux keeps full verbatim reasoning.
2. **Keep the gist, accept the risk.** Status quo. Needs the user's explicit
   yes given the faithfulness numbers.
3. **Hide entirely**, show elapsed time + tool name only.

**Constraint whatever is chosen:** style it so it cannot be mistaken for the
answer (lower contrast, subordinate placement), and do **not** put it in an
accessibility live region — announcing a monologue before the answer is
unusable. Batching on a 50–100ms interval, fixed-height if it is a rolling
line, because thinking arrives in bursts, not smoothly.

## Blast radius

`bot-host.mjs` is a hub file. Per **AGENTS.md L1**, Node 1/2/3 may only land
with `tests/bot-host.test.ts` in the same commit; if the job-session contract
is touched, `src/jobs/__tests__/JobSession.contract.test.ts` is required too and
is listed in `allowed_files` for that reason. **One agent at a time.**

`worker-jobs.mjs` and `work-session.mjs` are **frozen** — #524 owns them.
`tg-progress.mjs` is frozen: it is the single shared headline formatter vendored
into the Grok router (`scripts/sync-router-vendor.mjs`), so a change there
needs the router regenerated in the same commit.

## Known pre-existing failures (do NOT attribute these to this packet)

Verified byte-identical on pristine `origin/main` at the time of writing:

- `assert-worker-relay.test.mjs` — 24 pass / **10 fail**
- `assert-work-session.mjs` — 49 pass / **1 fail** (`/tx vocabulary in help text`)

`assert-health-group.test.mjs` is **untracked and never committed**, and 6 of
its checks fail with "no council model is wired to answer" — a live-LLM
dependency, not a code defect. It cannot gate a merge in that state. Commit or
delete it before anyone cites it.