---
id: HEALTH-GROUP-5
status: locked
class: MISSION_ITEM_6_LIVE_PROOF
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/agent-gemini.mjs
  - scripts/assert-health-group.test.mjs
  - specs/active/HEALTH-GROUP-5.md
frozen_files:
  - scripts/health-runner.mjs
  - scripts/lib/health/docs.mjs
  - scripts/lib/health-group.mjs
  - bots/registry.json
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-health-group.test.mjs
  - node scripts/assert-command-parity.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-project-registry-parity.mjs
  - npx vitest run tests/bot-host.test.ts
  - npm run test:prepush
  - node scripts/assert-spec-diff.mjs HEALTH-GROUP-5
---

# HEALTH-GROUP-5 — the transcript's own questions, asked live: the lane hops off a dead engine instead of dead-ending the room

## Goal

Mission item 6 was the last open outcome: the transcript's own questions had
never been re-asked through the live health-room path, and the user's complaint
was that these exact answers were canned. The asks were driven on the box
through the same code the live `vm` bot serves from
(`/home/ubuntu/deploy/Health-tracker`, `8c1204f`) — classification, the brief
branch, the real `runGemini` with the box's real key, the reply text, and the
`fallbackReason` the host logs. **Three of the four fell back**, and not from
the code being stale: the default engine was dead.

Measured on the box 2026-10-02, with the room's real 2,834-char prompt:

| engine | first probe | second probe |
| --- | --- | --- |
| `gemini-3.7-flash` (the lane's default) | timed out at 45 s, and again at 120 s | 429, "You exceeded your current quota" |
| `gemini-3.5-flash-lite` | answered in **958 ms** | answered in **920 ms** |

So the room was falling back on a question the lane could answer — because the
lane runs **one** model and has no failover. The live site already owns the
rule for exactly this (`server_gemini_retry.ts` `nextGeminiFallbackEngine`:
"fail the *model*, not the job", one hop, never on a random bug, and its
quota-cooldown text tells the operator the other engine "has a separate
quota"), and this module's header already claims live-site parity — but only
the 404 hop and the 503 retry were implemented. A stall or a quota-dead primary
went straight to the room's fallback line, every time.

## What changes

- **`scripts/lib/agent-gemini.mjs`** — `runGemini` gains the failover half of
  the parity it already documents. When the chosen engine stalls (transport
  timeout), stays unavailable (502/503/504 or an UNAVAILABLE/high-demand
  body), or is out of quota (429 / RESOURCE_EXHAUSTED / "exceeded your current
  quota"), it makes **one** hop to `GEMINI_STALL_FALLBACK_MODEL`
  (`gemini/gemini-3.5-flash-lite`, the live site's own default engine) and asks
  that engine once. Never a second hop, never a hop when the primary already is
  the fallback, and the hop is injectable (`fallbackModel: ''` disables it).
  **Quota is a hop reason, not a retry reason**: a 429 is still never re-asked
  on the same model (it burns the same bucket), but each engine has its own
  bucket, so the hop is what the live site does. The answering engine is
  recorded in `stderr` (`fallback:gemini-3.5-flash-lite`) and the `console.warn`
  names both engines, so the host journal shows which one served the room. The
  404 hop to `gemini-2.5-flash` and the single 503 retry are untouched, and the
  hop composes with both (a stalled primary that then 503s is retried once on
  the lite engine).
- **`scripts/assert-health-group.test.mjs`** — the transcript's own asks become
  classification/answer-contract cases: "how to clean up the data", "can you
  fix the data", "What about accurate data for this project. Can you build that
  out?" are council asks, "Can you work on the brief?" is the brief ask, and
  the typo'd `/heath verify` is pinned **end-to-end** through the host's own
  `--simulate` route (the same `handleCommand` a live command message runs): the
  router answers it with its own line and the real command surface, and it
  never becomes a health turn. Each of the four asks is answered by a plausible
  reply with no fallback reason, so the room's canned paragraph stays reserved
  for a genuine refusal. The lane's new hop is pinned through `runGemini`'s
  `fetchImpl` seam: a stall hops once and the answer is the hop's; a doubly-503
  primary is asked exactly twice and hops once; a 429 is asked once on the
  primary and hops once; an empty `fallbackModel` disables the hop; the
  fallback engine never hops to itself; the default wait stays the site's
  2000 ms.

## Findings (the decisions worth not re-deriving)

- **The fallbacks were real, and the cause was the engine, not the lane's
  code.** The serving tree was current (`8c1204f`), the key authenticated, and
  the same prompt answered on the lite engine in under a second. The room's
  default model was timing out or quota-dead at the moment of the probe.
- **Quota must hop, not retry, and must not be treated as "transient".**
  `isGeminiTransient` deliberately excludes 429 (same-model retry burns the
  bucket). That rule stays. But excluding 429 from the *hop* too is what
  dead-ends the room: the live site's `noteGeminiQuota` cooldown exists so the
  operator switches to the other engine precisely because its quota is
  separate.
- **One hop, not a chain.** The live site's `nextGeminiFallbackEngine` allows
  exactly one hop and never a second; the sensor pins the same bound, so the
  lane cannot become an unbounded model carousel.
- **The typo was already handled, and is now pinned as behavior.** `/heath
  verify` parses as command `heath`, which has no `case`, so the router's
  `default:` answers `Unknown command: /heath` followed by the full help —
  which names `/health`. The gap was coverage, not code: the classification
  sensor had no case for it. The new pin runs the real host binary
  (`--simulate`), so a regression that silently drops unknown commands (a dead
  end) fails the gate.
- **The live Telegram message was not sent.** A one-way `sendMessage` to the
  user's chat cannot be read back (Telegram does not return a bot's own
  outgoing messages via `getUpdates`), so the live proof is the serving tree's
  own turn path plus the host binary's command route, and the real-room re-ask
  remains the user's to make. Nothing was posted to the room.

## Evidence (measured on the box, 2026-10-02)

- **Before the fix, live on the serving tree** (`8c1204f`, real key, real
  workspace): "how to clean up the data" → `usedModel:false`, `fallbackReason:
  model failed: Gemini run timed out after 120s`; "can you fix the data" → the
  same timeout; "What about accurate data…" → `model failed: Gemini provider
  error: code 503` (the single retry did not recover it); "Can you work on the
  brief?" → the real publisher ran (1 invocation, 4 in-place updates) with no
  fallback. That is the user's complaint, reproduced: three canned lines.
- **The engine measurement** that explains it: `gemini-3.7-flash` timed out at
  45 s and at 120 s, then answered 429 twice; `gemini-3.5-flash-lite` answered
  the same prompt in 958 ms / 920 ms.
- **After the fix, live on a scratch copy of the serving tree with only the
  fixed module replaced** (`/home/ubuntu/item6-tree`, real key, real workspace,
  read-only): all three data asks → `usedModel:true`, `fallbackReason:''`, with
  the journal line `"gemini-3.7-flash" answered 429 (out of quota) — one hop to
  "gemini-3.5-flash-lite" (live-site parity)`; the brief ask → publisher run
  once, 4 in-place updates, `fallbackReason:''`; "thanks" → skipped;
  another project's question → not stolen. The user's real workspace hash is
  **`d1fb7ba7f1ed2ae31481eda2fced3bce39469df7`** before and after — 8 files,
  byte-identical, read-only throughout.
- **The typo, end-to-end through the host binary**: `node
  scripts/bot-host.mjs --simulate="/heath verify" --id=vm` → `Unknown command:
  /heath` + the full help naming `/health`. 0.3 s, no model call.
- `node scripts/assert-health-group.test.mjs` → **118 pass, 0 fail** (was 90).
- **Red three times, each restored to 118/0**: the whole hop disabled → **6
  FAIL**; only the quota branch removed from the hop predicate → **3 FAIL**;
  unknown commands dropped silently in the router → **2 FAIL** (the end-to-end
  typo pin).
- Gates: `assert-tax-group` 38/0 (1 skipped host-only), `assert-command-parity`
  OK (28 menu commands), `assert-command-scope` OK (30 canonical), project-alias
  parity OK, `vitest run tests/bot-host.test.ts` 162/162, `npm run test:prepush`
  exit 0.

## Left

- **Deploy this to the two serving trees and restart the units** (SIGTERM;
  `Restart=always`) so the live bots carry the hop: `/home/ubuntu/deploy/Health-tracker`
  and `/home/ubuntu/bot-host-r14`.
- **The real room's re-ask is still the user's**: the next question typed in
  the health room is what exercises this end-to-end in Telegram, and the
  `fell back:` journal line remains the instrument if anything still falls
  through.
- **The user's data gate (H-1…H-8)** is unchanged and stays theirs; the room
  keeps answering from the open repairs and points at `/health triage` and
  `/health dashboard`.

Next: specs/active/HEALTH-GROUP-5.md#left
