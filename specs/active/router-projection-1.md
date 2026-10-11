---
id: router-projection-1
status: draft
# BOT-24 packet 2, router half: DOMAIN_REGRESSION_MAP.md row 137
# (Grok router sessions) is this file's own domain row.
skill: bot-lane-surface
edit_mode: patch
allowed_files:
  - tools/telegram-provider-router/src/index.js
  # sensors that pin the router surfaces this refactor touches
  - tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs
  - tools/telegram-provider-router/scripts/test-sticky-failover.mjs
  - tools/telegram-provider-router/scripts/test-allowance-table.mjs
  - tools/telegram-provider-router/scripts/test-quota-parse.mjs
  - plan/ROADMAP.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - .github/workflows/ci.yml
  # bot-host side already consumes the canonical projection (bot-host.mjs
  # :2927-2951 picker, :4772-4773 /allowance, :5020-5023 walk) and is owned
  # live by another open PR — this unit never touches it.
  - scripts/bot-host.mjs
  # canonical lib is correct as-is; the router imports it through the vendor
  # mirror. Never edit the vendor by hand (free-lanes.mjs L1-7 law).
  - scripts/lib/free-lanes.mjs
  - tools/telegram-provider-router/src/free-lane-table.vendor.mjs
gate:
  - node scripts/check-capability-propagation.mjs
  - npm test --prefix tools/telegram-provider-router
  - node tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs
  - node tools/telegram-provider-router/scripts/test-sticky-failover.mjs
  - node tools/telegram-provider-router/scripts/test-allowance-table.mjs
  - node tools/telegram-provider-router/scripts/test-quota-parse.mjs
  - node scripts/assert-freemodel-tiers.test.mjs
  - node scripts/assert-allowance-walk.test.mjs
  - node scripts/assert-one-allowance-model.test.mjs
  - npx tsc --noEmit
---

# Packet: router consumes the canonical lane projection

Agent fills this. Human replies: go | stop | one comment.

## Journey

Destination journey: bot lane surface (TG command + lane-choice wiring), not food_log / food_compare / biomarkers — no sibling instruction or schema is at risk, so no Frozen journey swap applies. "Better" means the router's `/freemodel`, pool pickers, `/allowance`, failover, and callback tokens all read the ONE canonical host-aware projection (`canonicalAllowanceLanes` / `projectLanes` / `poolRows` in `scripts/lib/free-lanes.mjs`, already mirrored byte-identical to the router) instead of the router's parallel `freemodelReply` + `markDepleted`/`isDepleted`/`nextFailoverRoutes` stack. Same rows, same keys, same bucket semantics on both surfaces; the fork that lets one surface offer what the other cannot stamp disappears.

Standing features that stay in the plan: `allowance_hold_needs_evidence` (every depletion write carries its evidence and expiry; uncertain probes write nothing — the router's `freeModelDepletion` overlay keeps that rule), `runtime_unit_is_versioned_and_checked` (router units serve the repo copy; no per-box fork).

Sensitive transitions as (Condition, Action, Pitfall) triplets:
- (Failover helper changes, keep tier-internal order + shared-bucket depletion, never re-split high/light or re-offer Freebuff/`ended` rows.)
- (Callback token format changes, old `fm` tokens fail closed with "tap the lane again", never resolve to a wrong lane.)
- (Stamping path changes, per-bot/session ledger isolation preserved — projection is pure over its inputs; callers pass the router's own state paths.)

## Findings (do not redo)

- Packet 1 file-level is DONE: `projectLanes` (free-lanes.mjs:446), `canonicalAllowanceLanes` (:1946), `poolRows` (:1875), `pickNextUsableLane` (:1425), `nextUsableLane` (:1437), `stampDepleted` (:2601) all exported; vendor mirror byte-identical (`diff` exit 0); `check-capability-propagation` 27/0.
- BOT-26 pools already live in the router: `poolPickerReply` (index.js:3947-3964), three pool commands (:3966-3979), `/freemodel` handled-but-hidden pointer (:3981-3993).
- Bot-host side already consumes canonical (bot-host.mjs:2927-2951, :4772-4773, :5020-5023) — frozen for this unit.
- Router today does NOT: imports only render/format helpers (index.js:15-34, zero hits for `projectLanes|canonicalAllowanceLanes|poolRows|usableTurnLanes`); `freemodelReply` (buildFreemodelReply :3341-3394) reads live probes + `freeModelDepletion` overlay (:2724-2750) instead of the projection; `markDepleted` (:1058-1122) / `isDepleted` (:1124-1136) / `nextFailoverRoutes` (:457-480) fork the stamping logic with its own `state/quota` + `FREE_ALLOWANCE_BUCKETS` (:762-819); callback tokens are ephemeral in-memory `fm<base36>` (:3116-3130, 500-cap, lost on restart, decoded :4104-4138).
- Burned approaches (specs/rejected/): none on this domain. Never-repeat list from the charter: no dual-poller token, no hand-edited vendor, no label-as-location probes, never burn live quota for proof (ledger-copy + quota-shaped error only, R-14.1 card 6 pattern).
- `usableLanesFor` (free-lanes.mjs:1398) is private and `selectTurnLanes` lives only in bot-host.mjs:5008 — the router cannot share the walk until the projection (not the walk) is its input. This packet wires the projection, not the walk.

## Plan

1. `/freemodel` + pool pickers render from the canonical projection. `freemodelReply`/`buildFreemodelReply` take `canonicalAllowanceLanes({ table, session, readiness })` rows (router's own state paths as inputs) instead of probe lists + depletion overlay; pool filter stays `poolOfLane`. Done when: `test-freemodel-buttons` green + a fixture test shows the keyboard's route-key set equals the projection's usable set (QS-8 shape, static).
2. Failover + stamping through the shared helpers. Replace `markDepleted`/`isDepleted`/`nextFailoverRoutes` call sites with `stampDepleted` + `pickNextUsableLane`/`nextUsableLane` over the same projection; keep `FREE_ALLOWANCE_BUCKETS` shared-vs-per-model semantics and `quotaRecordKey` identity. Done when: `test-sticky-failover` + `test-quota-parse` + `test-allowance-table` green and propagation green.
3. Stable callback tokens from route identity. Token encodes the stable execution route (not a Map index); restart + unknown/old token fails closed with a re-tap line; the 500-cap Map is deleted. Done when: new unit test (restart-safe round-trip + stale-token refusal) green inside `npm test --prefix tools/telegram-provider-router`.
4. Docs + checkpoint. `node scripts/sync-router-vendor.mjs` (no-op expected — lib frozen) + `node scripts/journey-checkpoint.mjs save router-projection-1 builder`. Done when: mirror still byte-identical, guard green.

## Test plan

```text
node scripts/check-capability-propagation.mjs
npm test --prefix tools/telegram-provider-router
node tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs
node tools/telegram-provider-router/scripts/test-sticky-failover.mjs
node tools/telegram-provider-router/scripts/test-allowance-table.mjs
node tools/telegram-provider-router/scripts/test-quota-parse.mjs
node scripts/assert-freemodel-tiers.test.mjs
node scripts/assert-allowance-walk.test.mjs
node scripts/assert-one-allowance-model.test.mjs
npx tsc --noEmit
node scripts/journey-guard.mjs router-projection-1
```

## Audit plan

1. Scope vs ROADMAP (BOT-24 packet 2 router-half only; no packet-4 live claims, no QS rows flipped — live proof stays with real devices).
2. One frozen example: side-by-side `/freemodel` + `/allowance` before/after on the same ledger fixture — same rows, same keys, depleted rows show reset in both.
3. Honest residual named, not painted (e.g. router state files vs bot-host ledger paths stay distinct files — same projection, distinct state — plus any genuinely untestable branch).

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: bot-host.mjs (live PR owns it), free-lanes.mjs (already correct), vendor hand-edits, pool semantics, bucket semantics, any live-device proof, any quota burn.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
