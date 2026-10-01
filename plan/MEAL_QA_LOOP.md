# Meal QA loop — operator runbook

The closed loop: **resolve → audit → compare → ticket → dispatch → re-verify → repeat until green.**

Four scripts, each with a named gate. Every one is a read-only adapter over the
existing D1 store and the existing `bugctl` contract — no new state owner, no
second pipeline.

| Phase | Script | Gate | What it does |
|---|---|---|---|
| 1 | `meal-audit-resolve.mjs` | `assert-meal-audit-resolve.mjs` | Saved meal → reproducible evidence |
| 2 | `meal-audit-ticket.mjs` | `assert-meal-audit-ticket.mjs` | `comparison.json` findings → bug cards |
| 3 | `meal-audit-loop.mjs` | `assert-meal-audit-loop.mjs` | Bounded, resumable iteration driver |
| 4 | `meal-audit-cron.sh` | (bash -n + live dry run) | Scheduled sweep, single-flight |
| 2b | `meal-audit-handoff.mjs` | `assert-meal-audit-handoff.mjs` | The hand-off to the meal-audit agent |
| — | `meal-qa-proof.mjs` | (renders PNGs) | L18 live proof, one screenshot per stage |

## The two problems this solves

**1. Most saved meals were unreachable.** `meal-audit-fetch.mjs` could only rebuild
a flow from a debug payload, reached via `debug_url` → `job_<id>`. On the live D1
store only ~11 of 50 recent `food_logs` carry a `debug_url`; the other ~39 never had
one written (they were *not* pruned — retention had nothing to clear). The blocker
was a **missing link, not missing data**: all 39 still carry `image_urls`.

Phase 1 resolves every saved meal onto the best surviving evidence:

| Provenance | Evidence | Replayable | Edit history observable |
|---|---|---|---|
| `debug_payload` | `debug_url` → job id | yes | **yes** |
| `photo_only` | `image_urls` | no | **no** — barred from edit-history findings |
| `unreproducible` | neither | — | fails loud, exit 2 |

Measured: `--latest=10` resolves **10/10** (6 + 4), where the naive path resolved 6/10.

**2. Nothing consumed the audit ledger.** `meal-audit-compare.mjs --ledger` wrote
`issue_ledger.jsonl` and stopped. No script ever called `bugctl` from it, so every
ground-truth divergence died in a JSONL file nobody read. Phase 2 is the bridge.

**3. The loop could not hand a meal to the audit agent.** The loop can resolve,
compare, file and re-verify — but it cannot look at a photo and declare the
dishes, so a meal with no ground truth reported `needs_audit` forever with
**nothing queued for the agent that does the auditing**. A human had to notice
the log line. `meal-audit-handoff.mjs` is the missing step: a durable request
queue with a claim/complete handshake.

```
specs/meal-qa-loop/requests/<mealId>.request.json   what the agent must audit
specs/meal-qa-loop/requests/<mealId>.claimed.json   agent took it
specs/meal-qa-loop/requests/<mealId>.done.json      agent finished; bundle path
```

Under `specs/` (committed) rather than `artifacts/` (gitignored), so a request
survives a deploy instead of silently resetting. Idempotent per meal, a claim
blocks a second agent, an expired claim is reclaimable, and `complete` refuses a
missing bundle — a bad marker would unblock the loop into a compare that cannot
run.

## Daily use

```bash
cd /home/ubuntu/src/Health-tracker      # dev base, never the deploy clone

# What is in the latest 10, and can each be reproduced?
node scripts/meal-audit-resolve.mjs --latest=10 --list

# Plan a full sweep without writing anything or starting a coder
node scripts/meal-audit-loop.mjs --latest=3 --dry-run

# File cards but do not dispatch a coder
node scripts/meal-audit-loop.mjs --latest=3 --no-dispatch

# Live loop
node scripts/meal-audit-loop.mjs --latest=3

node scripts/meal-audit-loop.mjs --status   # attempt counts per card
```

## The three invariants

These are what the gates exist to protect. Each one has a specific, expensive
failure mode behind it.

**Author ≠ verifier.** The fix is authored by a coder in a dispatch worktree; the
re-verify runs here, against the live site, in the QA lane. A loop that verified
its own output would be marking its own homework. `run-coding-dispatch.sh` refuses
to post `verify` for exactly this reason.

**Hard attempt cap (3).** Unattended retry burns free-model quota and leaves a
dirty worktree. The cap is checked *before* another attempt is spent, is **per
card** (one bad card must not freeze the loop), and past the cap the card is
`blocked` for a human with the burned hypotheses in the card — not in scrollback.

**One defect per card (V-29).** A comparison usually shows several drifts. Phase 2
splits them into N cards, most-structural first. The loop dispatches the primary
one only. `bot-pack`'s `looksBundled` would reject a bundle anyway; this makes the
rule structural rather than incidental.

## Why state lives in `specs/`

`artifacts/` is gitignored. Loop state kept there would reset the attempt cap on
every deploy — silently turning the cap into a suggestion. State is therefore
committed at `specs/meal-qa-loop/state.json`.

## Scheduling

**Not installed.** The cron entry must point at a merged checkout, and this code is
on `agent/meal-qa-loop` until merged. Installing it now would fail hourly.

After merge:

```bash
crontab -e
# hourly, off the hour, small selection
7 * * * * /home/ubuntu/src/Health-tracker/scripts/meal-audit-cron.sh >> ~/.hermes/logs/meal-qa-loop.log 2>&1
```

The wrapper is **dry-run by default**:

| Env | Default | Effect |
|---|---|---|
| `MEAL_QA_LATEST` | `3` | meals per sweep |
| `MEAL_QA_ALLOW_DISPATCH` | `0` | `1` permits dispatch + verify |
| `MEAL_QA_REPO` | `/home/ubuntu/src/Health-tracker` | never the deploy clone |

It single-flights with `flock`, skips cleanly when the server is down (rather than
looking green while auditing nothing), and prunes its own JSON logs after 14 days.

**Leave `MEAL_QA_ALLOW_DISPATCH=0` until the audit half has run cleanly for a while
and the ticket bridge has survived a few real fixes.** Only free models are usable
on this box — the Zen balance is depleted and `agy` is geo-blocked — so an
aggressive schedule burns quota without converging.

## Gates

```bash
node scripts/assert-meal-audit-resolve.mjs   # 14 pass
node scripts/assert-meal-audit-ticket.mjs    # 19 pass
node scripts/assert-meal-audit-loop.mjs      # 29 pass
node scripts/assert-meal-audit-assist.mjs    # 14 pass
node scripts/assert-meal-audit-handoff.mjs   # 21 pass
npx vitest run server_audit_food_nutrients.test.ts   # 7 pass
npx tsc --noEmit
```

All offline: no network, no Playwright, no dispatch, no sleeps.

## Live proof (L18)

`scripts/meal-qa-proof.mjs` walks the real chain and writes one PNG per stage to
`qa-evidence/meal-qa-proof/`:

```
stage1-resolve   the saved-meal window and its provenance tiers
stage2-handoff   the request file the audit agent is handed
stage3-audit     the bundle the agent produced, with its energy check
stage4-compare   ground truth vs the live site, verdict and findings
stage5-ticket    the card the bridge filed
stage6-loop      the sweep summary that ties the stages together
```

Every panel is generated from files the run actually wrote, so a screenshot
cannot claim something the chain did not do.

## Current state

The corpus is **2 audited bundles with 1 historical ledger row**, so the loop's
first live finding is expected to be `needs_audit` — the meal-audit agent has not
yet analysed the newly resolvable meals. That is the correct, honest report: it
means the machinery ran and correctly declined to file a bug for a meal nobody had
checked.

To populate the corpus, hand a resolved meal to the meal-audit agent, which fills
`dishes[]` and runs `generate-meal-result.mjs`. Phases 2–4 then take over.
