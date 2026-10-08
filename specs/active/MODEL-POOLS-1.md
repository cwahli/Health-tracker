---
id: model-pools-1
status: locked
# the TG command + lane-choice surface: DOMAIN_REGRESSION_MAP.md rows 135-136
# (Bot work sessions / Live bot wiring) and 147 (Bot-host model failover)
skill: bot-lane-surface
edit_mode: patch
allowed_files:
  - scripts/lib/free-lanes.mjs
  - scripts/lib/commands.mjs
  - scripts/bot-host.mjs
  - bots/capabilities.json
  # user-visible copy that names the old command (a stale name here is a lie the
  # reader acts on): the two agent error texts, the allowance-missing text, the
  # phone TUI hint, and the router's own docs
  - scripts/lib/agent-opencode.mjs
  - scripts/lib/agent-gemini.mjs
  - scripts/mobile/tui-attach.sh
  - tools/telegram-provider-router/README.md
  - tools/telegram-provider-router/bin/HT-SCRIPTS.md
  - tools/telegram-provider-router/src/index.js
  - tools/telegram-provider-router/src/free-lane-table.vendor.mjs
  # sensors, each of which pins an expression or a string the refactor touches
  - scripts/assert-freemodel-tiers.test.mjs
  - scripts/assert-one-allowance-model.test.mjs
  - scripts/assert-allowance-walk.test.mjs
  - scripts/assert-setup-gaps.test.mjs
  - scripts/assert-turn-store.test.mjs
  # discovered by CI on the first push: this sensor pins the DECLARED ALIAS SET
  # exactly (`['think']`) plus an order-sensitive compare of handled-but-unpublished
  # against it. `/freemodel` joining `aliases` (the router still handles the old
  # name; it answers a pointer) moves both pins with the mechanism they pin.
  - scripts/assert-command-scope.test.mjs
  - tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs
  - tools/telegram-provider-router/scripts/test-sticky-failover.mjs
  - scripts/prove-tg-surface.mjs
  - tests/bot-host.test.ts
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
gate:
  - node scripts/assert-command-parity.mjs
  - node scripts/assert-command-scope.mjs
  - node scripts/check-capability-propagation.mjs
  - node scripts/assert-free-catalogs.test.mjs
  - node scripts/assert-freemodel-tiers.test.mjs
  - node scripts/assert-one-allowance-model.test.mjs
  - node scripts/assert-allowance-walk.test.mjs
  - node scripts/assert-walk-refs.mjs
  # the two rows the regression map names for this file's own domain
  - node scripts/assert-lane-contract.mjs
  - node scripts/assert-model-failover.mjs
  - node tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs
  - npx vitest run tests/bot-host.test.ts
  - npx tsc --noEmit
---

# Packet: model pools — three pickers replace `/freemodel`

**Closed 2026-10-09.** The code is on main. L18 is cleared. The Cloudflare lane stays off. Do not execute this packet.

## Journey

One picker becomes three, each named for what it holds, and each picker becomes a
*constraint* on the quota walk rather than a one-shot menu:

| Command | Pool | Movement when quota runs out |
|---|---|---|
| `/model_light_free` | light models | to the next **light** lane only — never across |
| `/model_free` | coding-capable models (rating ≥ 35) | to the next **coding** lane only — never across |
| `/model_go` | every lane on the **Go plan** (paid) | **none** — a paid lane does not move on its own |

`/freemodel` is removed. "Better" means: a reader can say which pool their chat is
in, the kick-out after a quota hit stays inside the pool they chose, and no lane
disappears in the rename — the three lists together are exactly the one list
`/freemodel` shows today.

## Findings (do not redo)

Measured on pristine `origin/main` (`398389f3`), this clone, before any edit:

- **The rating cut already exists and is already pinned.** `HIGH_TIER_MIN_AA = 35`
  (`scripts/lib/free-catalogs.mjs:273`) and `tierForModel(ref)`
  (`:375`) place every model in `high` ≥ 35 / `light` < 35, with
  `OWNER_PLACEMENT` (`:342`, three Zen/Qwen rows, `since: 2026-10-07`) between the
  locks and the figures, and `demonstratedModels()` (Space Bunny only) as the one
  no-figure exception. `scripts/assert-free-catalogs.test.mjs:110-113` already
  asserts "AA ≥ 35 is the coding pool / AA < 35 is the light pool". **The 35 cut is
  not new work and `assert-free-catalogs` must not need a new check for it.**
- **`tierForModel` returns `high` | `light` | `null`** — `null` means locked
  ("Forbidden") or terminal-only (Freebuff). So the existing third group in
  `groupRowsByTier` (`scripts/lib/free-lanes.mjs:1773`, `TIER_GROUPS`) is
  `unlisted` = rows `tierForModel` refuses to place, and none of those are
  selectable. There is no fourth pool hiding in the data.
- **Same-pool-first already exists in the walk; the ask is a tightening, not new
  machinery.** `selectTurnLanes` (`scripts/bot-host.mjs:4803`) computes
  `currentGroup = tierForModel(current model).tier`, sorts its own group with
  `bySameTier` and the other groups with `byTierThenRating`, and concatenates
  (`:4857-4860`). Today's rule is "own pool first, cross only when it is dry". The
  ask deletes the cross-tier half for the two free pools and deletes *all*
  movement for Go.
- **The projection is already the one list.** `projectLanes` →
  `canonicalAllowanceLanes` (`free-lanes.mjs:446`, `:1855`) is what `/allowance`,
  `/freemodel`'s keyboard and the walk all read; `formatFreemodelWithDepletion`
  (`bot-host.mjs:1278`) groups it with `groupRowsByTier` and orders each group with
  `sortFreemodelTierRows`. Pools must filter *that* list — a second list is the
  `QS-8` failure.
- **The Go plan is a plan code, not a tier.** `planCodeForLane` (`free-lanes.mjs:845`)
  returns `OG` for `provider === 'opencode-go' || model.startsWith('opencode-go/')`,
  and the comment above it says why the code exists: the Go pool is separate quota
  and must never dedupe onto the Zen free row. `FREE_NAME_DENYLIST`
  (`scripts/lib/freemodels.mjs:191`) refuses to source `opencode-go/space-bunny-free`
  into the free inventory — "paid Go plan: not a free lane there". So pool and tier
  are **orthogonal axes**: a Go lane also has a tier. Pools must be defined as
  `light = light ∧ ¬go`, `coding = high ∧ ¬go`, `go = go`, or the three lists do not
  partition the canonical list and the rename silently drops rows.
- **Surfaces that must all move together** (grabbed by `grep -rli freemodel`, live
  tree only): `scripts/lib/commands.mjs` (`BOT_COMMANDS:20`, `HELP_USAGE:89`,
  `COMMAND_ALIASES:167` `freemodels: 'freemodel'`), `scripts/bot-host.mjs`
  (`case 'freemodel':` `:3081`, `case 'allowance':` `:3120`, `fm:`/`fmp:`/
  `fm:`-position decode in `handleCallback` `:4455`+, `formatFreemodelWithDepletion`
  `:1278`, `selectTurnLanes` `:4803`), `bots/capabilities.json` (`ui-commands`
  row, `"freemodel": true` `:185`),  the router (`src/index.js` `bot.command("freemodel")`
  `:3850`, its own `BOT_COMMANDS` copy `:4297`, `freemodelReply` `:3300`,
  `buildFreemodelReply` `:3262`, `fm_cancel`), the router vendor mirror
  `src/free-lane-table.vendor.mjs` (generated by `scripts/sync-router-vendor.mjs`),
  the router's own sensor `scripts/test-freemodel-buttons.mjs`, `tests/bot-host.test.ts`
  (`:1033`, `:3388`), `scripts/assert-turn-store.test.mjs` (`:233` — it *slices*
  source on the literal `case 'freemodel':`, so this is a hard build break), the
  QS gate `scripts/assert-freemodel-tiers.test.mjs` (asserts the body is exactly
  `FREEMODEL_EMPTY_BODY` and the heading text `freemodelDisplayTier(tier,'vps')`),
  `scripts/assert-one-allowance-model.test.mjs` (`:338-341` pins
  `canonical: canonicalAllowanceLanes(` inside the `/freemodel` case),
  `scripts/assert-allowance-walk.test.mjs` (`:207-229` tier-walk cases),
  `scripts/prove-tg-surface.mjs:209` (`{ send: '/freemodel' … }`),
  `plan/ROADMAP.md` (lines 85, 104, 106, 116-119, 123, 134, 136, 144, 146, 150, 154,
  156, 161-162 all name `/freemodel` as the picker surface), plus prose-only references
  in `plan/R1*`/`TUI_TG_AUTH_TRAIL.md`/`docs/agents/bot_work.md:37` and the two
  Hermes skills `scripts/skills/common/telegram-allowance{,-watch}/SKILL.md`.
- **Gates green on `origin/main` today** (so every red below is ours):
  `assert-command-parity` 32 menu + 4 skill / 2 hidden / exit 0 ·
  `assert-command-scope` 35 canonical, router 13 (2 router-only) / exit 0 ·
  `check-capability-propagation` done=21 partial=6 / exit 0 ·
  `assert-free-catalogs` 65/0 · `assert-freemodel-tiers` 10/0 ·
  `assert-one-allowance-model` 151/0 · `assert-turn-store` 33/0.
  **`assert-allowance-walk` is already 63/1 red on pristine main**, the one failure
  being `and the walk is handed that chain, not failoverModels alone` — pre-existing,
  owned by the unmerged `planeChoice.models` repair (#587). This packet must not
  claim it green and must not "fix" it by weakening the check.
- **Copy and sensors that name `/freemodel` verbatim, not just in comments.** These
  are not history and they are not cosmetic — each one either lies to a reader or
  reds a gate if the rename lands around it:

  | Where | What it is | Why it moves |
  |---|---|---|
  | `scripts/bot-host.mjs` `:3550`-area and the `fm:` tap | `'Expired, run /freemodel again'` | a reader is told to run a command that answers a pointer |
  | `scripts/bot-host.mjs` `/setup` copy | `…are not offered in /freemodel until the credential is present.` | **pinned by a sensor** — `assert-setup-gaps.test.mjs:175` matches `not offered in \/freemodel until the credential is present` |
  | `scripts/lib/free-lanes.mjs:2205` | `Allowance: … Use /freemodel to list free models.` | allowance's own answer points at the picker |
  | `scripts/lib/agent-opencode.mjs:225` | `…pick again from /freemodel.` | model-not-found answer |
  | `scripts/lib/agent-gemini.mjs:173, 206, 211` | three answers (`pick again from /freemodel`, `The /freemodel picker works without it`, `Use /freemodel to pick from the list`) | gemini lane answers |
  | `scripts/mobile/tui-attach.sh:345` | `Move the chat to a lane with a real terminal with /freemodel, or use…` | phone-side hint |
  | `tools/telegram-provider-router/README.md:35`, `bin/HT-SCRIPTS.md:38` | the router's published command list / helper docs | the router stops publishing the name |
  | `plan/TG_TOOL_SURFACE.md:196` | the Mini-App refusal copy spec | only if the refusal is still live; journal otherwise |

  Two more pins make the bot-host refactor tighter than it looks, and both are
  cheap to satisfy if they are known up front:
  `assert-one-allowance-model.test.mjs:474` matches the literal
  `/freemodelDisplayTier\(g\.tier, location \|\| 'vps')/` in `bot-host.mjs`, and
  `:519` matches the literal `/const \{ entries, annotated, table: fmTable, session: fmSession/`.
  The shared pool branch must keep those two expressions as they are, or move the
  sensors in the same commit (never both-and, and never silently).
  `tools/telegram-provider-router/scripts/test-sticky-failover.mjs:182` drives the
  router's `/freemodel` line formatter, and `tests/bot-host.test.ts` names the
  command at `:733`, `:1022`, `:1027`, `:1131`, `:1485`, `:2237`, `:3550`, `:4499`.
- **Two gate traps in the rename, measured rather than predicted.** Unpublishing
  `freemodel` in `commands.mjs` while the alias stays reds
  `assert-command-parity` with **exactly three** failures —
  `[dangling-alias] /freemodels routes to /freemodel, which is not a published command`,
  `[alias-target-missing-from-help]`, and
  `[handled-not-declared] /freemodel is handled but neither published nor in HIDDEN_COMMANDS`
  — and green again the moment the file is restored. Driving
  `assert-command-scope`'s own exported `audit()` with a three-pool fixture shows the
  router side of the same coin: with `aliases: ['think']` a kept-but-unpublished
  `freemodel` handler fails `handled-not-published` ("Publish it, or declare it in
  ui-commands.commands.aliases"), and with `aliases: ['think','freemodel']` that
  failure is gone. Both are handled in Design §4.
- **Command law** (`docs/agents/bot_work.md:37`): every new `/command` needs a
  handler, a popup entry, a `/help` line and a `ui-commands` verdict.
  `assert-command-parity.mjs` additionally fails on a `HELP_USAGE` line missing, a
  dangling `COMMAND_ALIASES` target, and any handled command that is neither
  published nor in `HIDDEN_COMMANDS`; `assert-command-scope.mjs` fails on a
  canonical command with no boolean `grok_tg` verdict, and on a router command that
  is published but unhandled.
- **Rollout hazard already identified in this repo:** the box runs bot-host units at
  several locations from separate trees and the reset-on-push deploy clone, so the
  fleet is *briefly mixed* during a roll. Anything the old build must still answer
  during that window has to survive the change (see Rollout).

## Design

### 1. Pools live in the canonical lane lib, derived from what is already there

`scripts/lib/free-lanes.mjs` gains exactly one new exported surface — no new file,
no new rating table, no change to `free-catalogs.mjs` (which keeps the 35 cut and
its 65-check sensor untouched):

```js
export const MODEL_POOLS = {
  light:  { id: 'light',  command: 'model_light_free' },
  coding: { id: 'coding', command: 'model_free' },
  go:     { id: 'go',     command: 'model_go' },
};
export function poolOfLane(lane)   // 'go' | 'light' | 'coding' | null
export function poolOfRef(ref)     // same, for a bare model ref
export function poolRows(rows, poolId)   // the canonical rows of one pool, order untouched
export function poolDisplayName(poolId, location)  // "VPS Light pool" / "VPS Coding pool" / "VPS Go plan"
```

`poolOfLane` is ordered **go → tier**, because go wins:

```
planCodeForLane(lane) === 'OG'   → 'go'
tierForModel(ref).tier === 'high' → 'coding'
tierForModel(ref).tier === 'light'→ 'light'
otherwise (null: locked / terminal-only) → null   // shown nowhere selectable
```

It goes in `free-lanes.mjs` rather than `free-catalogs.mjs` for one
load-bearing reason: `planCodeForLane` lives in `free-lanes.mjs`, and
`free-lanes.mjs` already imports `free-catalogs.mjs` — putting `poolOf*` in
`free-catalogs.mjs` would need the reverse import and make a cycle. The
`free-lanes.mjs` → `free-lane-table.vendor.mjs` mirror already exists, so the router
gets the pools by running `node scripts/sync-router-vendor.mjs` and **no new
mirror entry is required**.

### 2. Three commands are three *filters of one list*, never three lists

`formatFreemodelWithDepletion` gains an optional `pool` input; when it is set,
`canonical` is filtered with `poolRows` **before** `groupRowsByTier`, and:

- the body stops being the invisible `FREEMODEL_EMPTY_BODY` and becomes one honest
  line, because with one pool the keyboard usually has a single group and a
  keyboard cannot show a heading when there is one group — the reader has to be told
  which list this is and what happens when it runs dry:
  `Light pool · 7 lanes on VPS · 5 usable — a quota hit moves inside this pool only. /model clears it.`
- the count, the ❌ marking, the 408px button shape, the ordering and the
  `canonicalAllowanceLanes` source are untouched, so `QS-8` (same rows, same keys as
  `/allowance`) still holds for the subset.
- **an empty pool is answered as empty.** No fallback that renders another pool's
  rows under a light heading, and no "showing everything instead" — that is the
  silent-substitution failure this repo treats as the worst kind. The empty body
  names the pool, the host, and the soonest reset inside that pool.

`/model_free` = `poolId: 'coding'`; `/model_light_free` = `'light'`; `/model_go` = `'go'`.
Tier groups for go: `['high','light']` only.

### 3. The pool is a chat preference, and the walk reads it

The load-bearing change:

- `prefs` gains `pool` (`'light' | 'coding' | 'go' | null`), written through the
  existing `setPref(prefs, chatId, patch)` (`bot-host.mjs:395`) +
  `savePrefs(config.id, prefs)`; `effective()` (`:534`) returns it alongside
  `model`/`agent`/`variant`.
- **Running one of the three commands sets `pool` to that command's pool**, even
  before a tap — otherwise a chat whose current model is `high` could run
  `/model_light_free`, see light lanes, and then spend a coding lane on the next
  quota hit. Tapping a lane sets `model` **and** re-derives `pool` from the tapped
  lane (`poolOfRef`), so the constraint always follows the last explicit action and
  a stale keyboard cannot leave the two disagreeing.
- `/model` (the setter) and `/models` clear `pool: null`, restoring today's
  behaviour exactly: the walk infers the group from the chat's own model. `/model`
  stays the unconstrained setter (ROADMAP line 106), so this is strictly additive
  intent, not a new way to fork lane choice.
- `selectTurnLanes({ …, pool })`:
  - `pool` unset → **the current code path, byte-preserved** (own group first, cross
    when dry). Every existing `/model` user and every existing sensor keeps passing.
  - `pool: 'light' | 'coding'` → candidate lanes = projection rows whose `poolOfLane`
    equals it, sorted `bySameTier` (i.e. `freemodelRatingOf` desc AA, rank asc, pref
    asc — the list's own order, so the keyboard and the walk still agree). The
    cross-tier concat is **removed**. Empty → `{ exhausted: true, soonest }` where
    `soonest` is computed **inside the pool only**, so the reply names when *light*
    comes back rather than offering a coding lane.
  - `pool: 'go'` → `models: [execModelRef(model)]` and nothing else. No failover of
    any kind. Depleted → `exhausted` with that lane's reset. The reply says the Go
    plan is paid and does not move on its own.
- `degradedToLight` can no longer become true under a set pool; keep the flag for
  the unset path and for its existing sensors.
- Both call sites (`bot-host.mjs:6731`, `:6767`) already go through
  `selectTurnLanes`; they pass the chat's `pool` beside `model`/`fallback`. **No
  second walk is added.**

### 4. `/freemodel` is removed without becoming a prompt

`isKnownCommand` drives the fall-through rule: an unknown `/word` is forwarded to
the tool as a prompt. So deleting the name outright would turn a typed
`/freemodel` into a model prompt — the exact opposite of helpful. Instead:

- `BOT_COMMANDS`: `freemodel` entry removed; `model_light_free`, `model_free`,
  `model_go` added (all valid `[a-z0-9_]{1,32}`; the shared `model_` prefix also
  makes them appear when a reader types `/model`).
- `HIDDEN_COMMANDS` gains
  `freemodel: 'moved: the one free list became /model_light_free, /model_free and /model_go'`
  with `case 'freemodel':` answering **one line naming the three new commands**. No
  list, no tap, nothing billed.
- `COMMAND_ALIASES` **loses** `freemodels`: `assert-command-parity`'s
  `dangling-alias` check requires an alias target to be a *published* command, so
  leaving `freemodels: 'freemodel'` behind after unpublishing `freemodel` is a red
  gate, not a nicety. Both spellings move to `HIDDEN_COMMANDS` and share one
  `case 'freemodel': case 'freemodels':` branch. (`COMMAND_ALIASES` then becomes
  `{}`; the gate tolerates an empty map.)
- `HELP_USAGE`: three new lines; the `freemodel` line is deleted with the menu entry.
- The router: `bot.command("freemodel")` becomes the same pointer answer; the three
  new `bot.command(...)` handlers register; the router's own `BOT_COMMANDS` copy
  gains the three and drops `freemodel`; `fm_cancel` (its cancel row) is reused by
  all three. The router keeps *handling* `freemodel` while no longer publishing it,
  which trips `assert-command-scope`'s `handled-not-published` unless the name is
  declared — so `ui-commands.commands.aliases` (today `['think']`) gains
  `freemodel`; `routerOnly` (today `['switch','unlock']`) is **not** the right list,
  because those are published.
- `bots/capabilities.json` `ui-commands.commands`: `freemodel` key removed (extra
  keys are tolerated by the gate, but leaving it claims a surface that is gone),
  `model_light_free: true`, `model_free: true`, `model_go: true` (the router serves
  all three from its own probe, so `grok_tg: true`).

## Plan

1. **Pools in the canonical lib.** `MODEL_POOLS`, `poolOfLane`, `poolOfRef`,
   `poolRows`, `poolDisplayName` in `scripts/lib/free-lanes.mjs`; run
   `node scripts/sync-router-vendor.mjs`.
   *Done when:* `poolRows(canonicalRows,'light'|'coding'|'go')` partitions the
   canonical list — the three lengths sum to the old total and every row lands in
   exactly one pool, so the rename loses nothing and duplicates nothing. (Depleted
   rows stay in the keyboard inside their pool, exactly as `/freemodel` keeps them
   today so a tap can answer with the next usable lane.)
2. **The walk takes the pool.** `selectTurnLanes({ …, pool })` with the three
   behaviours above; the unset path untouched.
   *Done when:* a light-pool chat whose light lanes are all depleted returns
   `exhausted: true` and names a light reset, and its `models` contains no coding
   lane; a go-pool chat's `models` is exactly one entry.
3. **Bot-host handlers.** `case 'model_light_free' | 'model_free' | 'model_go'`
   (one shared branch, parameterised by pool — not three copies of the
   `/freemodel` body), the hidden `freemodel` pointer, `prefs.pool` in
   `effective()`/`setPref`, and the `fm:` tap re-deriving the pool from the tapped
   lane.
   *Done when:* the three commands render the three filters of one list on a real
   host and `/freemodel` answers the pointer with no keyboard.
4. **Command surface + registry.** `commands.mjs`, `bots/capabilities.json`, the
   router pair (handlers + its `BOT_COMMANDS`), `sync-router-vendor` re-run.
   *Done when:* `assert-command-parity`, `assert-command-scope` and
   `check-capability-propagation` are all exit 0 with the three names in the popup,
   the `/help` text and the matrix, and `freemodel` reachable but unpublished.
5. **Router `/freemodel` parity.** `freemodelReply` takes a pool and filters its own
   probe results with `poolOfLane` from the vendor mirror; `state.pool` persists per
   chat beside `state.models[p]`; the router's walk-equivalent respects it.
   *Done when:* `tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs`
   covers three pools and the Go no-move rule.
6. **Sensors move with the change** (see Test plan) and
   `plan/ROADMAP.md` is corrected: lines 104/106/116-119/123/136/146/150/154/156/161-162
   name `/freemodel` as *the* picker and one new row `BOT-26 — model pools` records
   this ID (the tier law text keeps its meaning, with the three names in place of one).
   *Done when:* `grep -rn "freemodel" plan/ROADMAP.md` shows only the history rows and
   the hidden-name note.
7. **Live proof per location (L18). CLEARED 2026-10-09.** Do not run the VM
   or phone pass. The Cloudflare lane stays off. The code steps above are the
   close.
8. **Rollout order** (see Rollout) and the handover bullet.

## Test plan

```text
node scripts/assert-free-catalogs.test.mjs        # unchanged, 65/0 — the 35 cut is not re-pinned
node scripts/assert-freemodel-tiers.test.mjs      # grows: pool body + one heading per pool
node scripts/assert-one-allowance-model.test.mjs  # /freemodel case → the three pool cases
node scripts/assert-allowance-walk.test.mjs       # grows 2 cases: light never crosses; go never moves
node scripts/assert-walk-refs.mjs                 # unchanged
node scripts/assert-command-parity.mjs            # 34 menu commands (+3 -1), 4 hidden (freemodel, freemodels, store, setup)
node scripts/assert-command-scope.mjs             # 37 matrix verdicts, router 15 published (2 router-only) / 16 handled
                                                  # — freemodel declared in commands.aliases, not routerOnly
node scripts/check-capability-propagation.mjs     # vendor mirror in step
node tools/telegram-provider-router/scripts/test-freemodel-buttons.mjs
npx vitest run tests/bot-host.test.ts
npx tsc --noEmit
```

New checks this packet must add (they are the ratchet, not decoration):

- **The partition.** the three pool lengths sum to the canonical list and every row
  is in exactly one pool — the check that proves nothing was lost in the rename.
  Home: `assert-freemodel-tiers.test.mjs`.
- **Go wins over tier.** an `opencode-go/*` lane with a coding figure is `go` and
  not `coding`; it appears in exactly one of the three keyboards.
  Home: `assert-freemodel-tiers.test.mjs`.
- **Light never crosses.** a light-pool chat with every light lane depleted returns
  `exhausted`/a light reset and no coding lane in `models`; the mirrored case for
  coding. Home: `assert-allowance-walk.test.mjs`.
- **Go never moves.** a go-pool chat returns exactly one model even with every free
  lane healthy. Home: `assert-allowance-walk.test.mjs`.
- **The pointer.** `/freemodel` is handled, is not in `BOT_COMMANDS`, is in
  `HIDDEN_COMMANDS`, and its handler body contains no keyboard. Home:
  `assert-command-parity.mjs`'s own audit already covers publication/hidden; the
  body check goes in `tests/bot-host.test.ts`.
- **An empty pool is empty.** the pool body for a host with no light lane names the
  pool and does not render another pool's rows. Home: `assert-freemodel-tiers.test.mjs`.

`assert-allowance-walk.test.mjs` stays **63 pass / 1 pre-existing fail** unless the
`planeChoice.models` repair (#587) lands first; that failure must be reported as
pre-existing, never re-pinned or deleted.

## Audit plan

1. Scope vs ROADMAP: one new ID (`BOT-26`), no other ID touched, no job-lifecycle or
   food/biomarker file in the diff.
2. One-list invariant driven through the real functions: `canonicalAllowanceLanes` →
   `poolRows` → `groupRowsByTier` → `sortFreemodelTierRows` → keyboard, and the same
   pool predicate through `selectTurnLanes`.
3. Honest residual named: the pre-existing `assert-allowance-walk` failure, and every
   location where a pool is empty on that host (a finding, not a hole to fill).

## Blast radius

Allowed / Frozen are the YAML lists above.
Out of scope: changing the 35 cut, adding a rating table, changing
`FREE_MODEL_BAKEOFF.md` numbers, `/allowance`'s own render, `/location`, the
job-lifecycle files, `docs/agent/**`, `.github/workflows/ci.yml` (a new gate step is
a separate PR — one file, one owner).
Prose-only references (`plan/R16_*`, `plan/TG_TOOL_SURFACE.md`, `TUI_TG_AUTH_TRAIL.md`,
`docs/agents/bot_work.md:37`) are history: correct the ROADMAP, leave the journals.

## Rollout (why the mixed-fleet window is safe)

The box serves bots from several locations out of separate trees, so during a roll
some hosts run the old build while others run the new one. Three properties make the
window safe by construction, and none of them may be dropped to save a line:

1. **The callback kind is unchanged.** Taps stay `fm:<route>` / `fm:#<n>`
   (`modelKeyboard({ kind: 'fm' })`), so a keyboard rendered by the old build stays
   tappable under the new one and vice versa. A new kind per pool would make every
   already-sent keyboard dead the moment one host was restarted.
2. **The old name never becomes a prompt.** `freemodel` stays a *handled* command
   (hidden), so an old muscle-memory `/freemodel` reaches the pointer on every build
   order — before, during and after the roll.
3. **A missing host credential is a finding, not a fallback.** `/model_go` on a host
   with no Go credential shows the empty pool and says so; it must not quietly offer
   free lanes under the paid heading.

Order: land the one PR (the canonical lib + bot-host + router are one contract, and
`assert-command-scope` cross-checks the router, so splitting it red-mains CI), then
restart the bot-host units one at a time with a status read between each (the
`AI_HANDOVER` 2026-10-06 procedure — the system unit
`/etc/systemd/system/bot-host@.service` from `/home/ubuntu/bot-host-r14` is the live
one; the `--user` twin is stale and will lie), then the router. Prove live per
location before marking done.

## Build notes (2026-10-07 — what landed, and where it differs from the plan)

**One amendment to Design §1.** That section puts a tier-`null` row (a locked or
terminal-only lane — Freebuff) in NO pool, while the Plan's own Done-when requires
the three pools to *partition* the canonical list. Both cannot hold, and the
partition is the load-bearing one: it is what makes "no lane disappears in the
rename" checkable, and today's single keyboard does render those rows (in the
unlisted group, marked ❌). So a row's pool is:

```
planCodeForLane(lane) === 'OG'          → 'go'      (a plan, so it is tested FIRST)
tierForModel(model).tier === 'high'     → 'coding'  (the catalog's own cut)
everything else                         → 'light'
```

A locked/terminal-only row is still selectable nowhere; it is shown, marked ❌, on
exactly one keyboard instead of vanishing. The partition, the go-wins rule, each
pool rendering only its own rows, and the empty pool are all pinned in
`assert-freemodel-tiers` (15/0).

**Two smaller deviations, both deliberate:**

- `/model` (the setter) and `/model reset` clear the pool, and `/model`'s own
  keyboard tap sets `pool: null` — but `/models` (the list) does NOT. A command
  that only lists things must not silently drop the reader's constraint; the
  stale-keyboard case the plan worried about is covered by `/model` clearing it.
  A pool tap (`fm:`) still re-derives the pool from the lane it picked.
- The router stores ONE pool per process (`state.pool`), beside its
  `state.models[p]`, not per chat: that process's model choice is already
  one-per-provider, so a per-chat pool would be a claim its state shape cannot
  keep. Recorded in the code comment rather than faked.
- `scripts/prove-tg-surface.mjs` sends `/model_light_free` rather than
  `/model_free`: the step immediately after it taps the Freebuff button, which is
  a tier-`null` row and therefore renders on the light keyboard only.

**L18 was cleared on 2026-10-09.** Do not run it. The Cloudflare lane stays off.
Pre-existing reds, measured on pristine `398389f3` and neither re-pinned nor
deleted: `assert-allowance-walk` 63/1 (the `planeChoice.models` wiring repair
owned by #587) and `assert-setup-gaps` 57/6 (this box has no `/home/ubuntu`
freebuff credential). Step 6's ROADMAP correction was applied to the law text and
the QS rows that name the picker as a proof target, plus a new `BOT-26` row; the
BOT-24 board's own prose keeps the old spelling because it is a record of a past
scope, and the `BOT-26` row carries a naming note for it. (`BOT-25` was already
taken by the bot error log — `scripts/lib/error-log.mjs`, in progress since
2026-09-25 — so this ID is the next free one, not a reuse of that row.)

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini
requested · the plan needs a fourth pool, or a pool name the user did not ask for.

---

## Open decisions (recommended answers, human may overrule)

**D1 — What exactly is `/model_go`?**
*Recommended:* `planCodeForLane(lane) === 'OG'` only — the OpenCode Go plan, which is
what `FREE_NAME_DENYLIST` calls "paid Go plan". `GM` (Gemini, keyed) and `CL`/`OC`/`TH`/`CF`
free lanes are **not** the Go plan and stay in their tier pool; a "keyed fallback" row
(`GM`) is the user's own key, which is a different bargain from a paid subscription
and should keep today's last-resort position. *Alternative:* "every paid lane",
which would sweep `GM` in too.

**D2 — Does running the command set the constraint, or does only a tap?**
*Recommended:* the command sets the pool immediately and says so in the body; a tap
sets the model and re-derives the pool from that model. `/model` clears it. This is
the only version where "when quota is used for light it should only move between
light" is actually true for a chat that ran `/model_light_free` and then sent a
message. *Cost:* a reader who only wanted to look has constrained their chat until
they run `/model` — mitigated by the body line naming the exit.

**D3 — What does an exhausted pool do to the turn?**
*Recommended:* refuse that turn and name the pool's own soonest reset plus the command
to leave the pool. *Alternative:* answer on the other pool and label it — rejected,
because that is exactly the across-pool movement the ask removes.

**D4 — Keep `/freemodel` as a pointer, or let it fall through?**
*Recommended:* keep it handled-but-hidden, answering one line with the three names.
*Alternative:* delete it outright — rejected: `isKnownCommand` would return false and
a typed `/freemodel` would be forwarded to the model as a prompt.
