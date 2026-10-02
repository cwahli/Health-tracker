---
id: HEALTH-GROUP-4
status: locked
class: MODEL_LANE_RETRY
edit_mode: patch
skill: debug-contract
auto_go: false
allowed_files:
  - scripts/lib/agent-gemini.mjs
  - scripts/assert-health-group.test.mjs
  - specs/active/HEALTH-GROUP-4.md
frozen_files:
  - scripts/health-runner.mjs
  - scripts/lib/health/docs.mjs
  - bots/registry.json
  - .github/workflows/ci.yml
gate:
  - node scripts/assert-health-group.test.mjs
  - node scripts/assert-command-parity.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/assert-project-registry-parity.mjs
  - npx vitest run tests/bot-host.test.ts
  - npm run test:prepush
  - node scripts/assert-spec-diff.mjs HEALTH-GROUP-4
---

# HEALTH-GROUP-4 — the room's model lane retries a transient 503 once, like the live site does

## Goal

Mission step 2 was "find and fix why the live bots never model-answer". Both
serving problems were real and are now visible: vm2 served the pre-merge tree
(`/home/ubuntu/bot-host-r14` at `c8cccce`, before #467/#469/#470) and vm's tree
was current but its process predated today's merges. After the redeploy and
restart, a synthetic live turn on the box — the real workspace, the real key,
the same `answerHealthGroup` the bots call — returned the reason the room kept
falling back: **`model failed: Gemini provider error: code 503 "This model is
currently experiencing high demand"`**. The credential is valid (`AQ.`-style
key, 53 chars, a direct `runGemini` call answered "ok") and `COUNCIL_MODEL` is
unset, so the lane uses its documented default `gemini/gemini-3.7-flash`. The
same long health prompt drew 503 twice in a row across two models, while the
same prompt on `gemini-3.5-flash-lite` answered on the first try and on
`gemini-3.7-flash` answered on a second try after ~2.5 s. The live site already
carries exactly this rule (`server_gemini_retry.ts` `withGeminiRetry`: "503: at
most one extra try after a short wait"; a 429 is never retried), and the bot
lane's own header claims that parity — but it only ever implemented the 404
hop. So a single transient 503 fell straight through to the room's fallback
line, every time.

## What changes

- **`scripts/lib/agent-gemini.mjs`** — `runGemini` gains the retry half of the
  live-site parity it already documents: a 502/503/504, or any body matching
  `unavailable|high demand`, is retried **once** on the same model after
  `GEMINI_RETRY_DELAY_MS` (2000, the site's number); a second failure keeps the
  provider's own mapped error. **A 429 is never retried** (quota beats the text
  match, matching `withGeminiRetry`'s precedence). The wait is injectable
  (`retryDelayMs`) so the sensor does not sleep. A `console.warn` names the
  model and status so the host journal shows the retry. Transport timeouts stay
  un-retried: this lane's timeout is two minutes, and doubling it is worse for
  the room than falling back with a named reason. The 404 hop to
  `gemini-2.5-flash` is untouched.
- **`scripts/assert-health-group.test.mjs`** — the room's sensor now pins the
  lane's retry contract through `runGemini`'s `fetchImpl` seam: one 503 then a
  200 answers with the retry's text and exactly two calls on the same model; a
  second 503 is not retried a third time and keeps a reason matching
  `unavailable|high demand|provider error`; a 429 is one call and names quota;
  the 404 hop still lands on `gemini-2.5-flash`; the default wait stays the
  site's 2000 ms.

## Findings (the decisions worth not re-deriving)

- **The live fallback was not a credential, a missing model, or a too-strict
  checker.** `GEMINI_API_KEY` is present in both units' environments (and in
  the running processes) and authenticates; `COUNCIL_MODEL` is simply unset, so
  the default applies; and when the model does answer, `acceptHealthReply`
  accepts it — the live probe's answers were `usedModel: true` and named real
  repair items (H-1, 178 vs 163 cm), never a refusal.
- **The 503 is prompt-correlated, not random.** The same key/model answered a
  short "ok" prompt while the health prompt (3,724 chars) drew 503 twice; the
  issue is the free-tier endpoint's capacity for that request class, which is
  exactly why one retry — the site's rule — is the fix, not a key rotation.
- **The retry lives in `agent-gemini.mjs`, not the health module.** The
  module's header already promises `server_gemini_retry.ts` parity; the missing
  retry is a bug against its own contract, and the council lane and readiness
  checks that share the module get the same resilience the site has.
- **The sensor runs in CI already.** `scripts/assert-health-group.test.mjs` is
  wired into the `ci` workflow's "Group seats gate", so the new checks are a
  gate the moment this lands — no `ci.yml` edit (frozen) and no new file.
- **One shared-tree red is not this change.** While this pass ran, another
  lane's uncommitted `/fleet` work sat in the shared checkout; it makes
  `assert-command-scope` red locally (`/fleet is canonical but has no grok_tg
  verdict`). It is absent from this commit, so the branch's CI run is the
  clean-tree evidence; the local red is recorded here rather than hidden.

## Evidence (measured on this box, 2026-10-02)

- `node scripts/assert-health-group.test.mjs` → **90 pass, 0 fail** (was 84).
- **Red twice, each restored to 90/0**: the retry call site put back to a plain
  `post()` → **3 FAIL** (the one-retry answer, the two-call shape, and the
  second-503 bound; 87 pass); `GEMINI_RETRY_DELAY_MS` set to 200 → **1 FAIL**
  (the default-wait pin; 89 pass).
- Live on the VPS: `runGemini` from the serving tree — short prompt → `ok`
  (105 tokens); health prompt, first try → `503 UNAVAILABLE`; health prompt with
  one ~2.5 s retry → **answered** (`usedModel: true`, "To start cleaning up the
  data, begin with the first open repair, H-1 … at /health triage"); the same
  prompt on `gemini-3.5-flash-lite` → answered first try.
- Gates: `assert-tax-group` 38/0 (1 skipped host-only), `assert-chat-scope` ok,
  `assert-project-registry-parity` OK (23 aliases), `assert-command-parity` OK
  (28 menu commands), `vitest run tests/bot-host.test.ts` 162/162,
  `npm run test:prepush` exit 0 (receptionist + bio + food + external-health +
  bugctl + `tsc --noEmit`).
- `assert-command-scope` locally red on the concurrent lane's `/fleet` (not in
  this commit; CI on the branch is the authority).

## Left

- **Deploy this to the two serving trees and re-prove live**: pull `main` into
  `/home/ubuntu/deploy/Health-tracker` and `/home/ubuntu/bot-host-r14`, restart
  the units (SIGTERM; `Restart=always`), then re-run the synthetic health turn
  to watch the retry convert the live 503 into a model answer.
- **The real room's next ask is the live proof.** No Telegram message was sent
  from this box (the probe is side-effect-free by construction); the next real
  question in the health room is what exercises the retry end-to-end, and the
  `fell back:` log line stays the instrument if it ever falls through again.
- **The rest of the approved mission**: the monthly renewal runner + timer, the
  live re-ask of the transcript's questions, and the user's data gate
  (H-1…H-8) — still theirs to close in the app, no bypass.

Next: specs/active/HEALTH-GROUP-4.md#left
