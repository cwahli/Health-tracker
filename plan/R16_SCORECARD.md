# R-16 cross-location quota-resilience scorecard — working board

Charter: `plan/ROADMAP.md` §R-16 (QS-1…QS-12). Branch: `agent/r16-scorecard`
(main + `agent/r14-vendor-sync` + `agent/session-key`, then R-16 fixes).
Pass rule per charter: every row green **in the same live pass**; one RED row =
whole scorecard RED. Live quota is never burned for exhaustion: quota-shaped
errors go through the real error path against ledger copies.

Evidence discipline (learned 2026-09-26): several bot versions served one chat
in one evening, so every capture below names the serving tree + commit.
`prod` = `/home/ubuntu/bot-host-r14` (live service), `r16` = this branch.

## Gates (all green 2026-09-26)

| gate | result |
|---|---|
| `check-capability-propagation.mjs` | 26 capabilities, 0 failures (QS-12) |
| `assert-one-allowance-model` | 125/0 (QS-8 parity) |
| `assert-freemodel-tiers` (new) | 10/0 (QS-6/QS-7 render) |
| `assert-r16-failover` (new) | 25/0 (QS-2/QS-4/QS-9/QS-10/QS-11) |
| `assert-model-failover` | 10/0 · `assert-cooldown-and-dead-ends` 47/0 |
| `assert-work-session` 50/0 · `assert-work-view` 13/0 · `assert-session-key` 24/0 on host |
| `assert-worker-relay` 31/0 (32/0 with relay latest) · `assert-swap-guards` 75/0 |
| `assert-swap-pack` 35/0 · `assert-poller-lease` 21/0 |
| `assert-swap-drill` 19/0 (10 swaps + injected rollback + real-tmux repoint) |
| `live-swap-proof.mjs` | 23/23 on the deployed stack |
| vitest `work-session` + `bot-host` | 176/176 |

## Rows

| row | status | evidence |
|---|---|---|
| QS-1 roam 4 locations, ledger per host | GREEN | driver `proof locations` vs branch poller: vps/vm2 answered `ok` locally; mobile/collab/grok answered `ok — host: <h> (canary)` with own `worker-<h>` ledgers; VM ledger mtime unchanged (`2026-09-25 22:19:51` before = after). Unreachable-host hold proven by guard sensor + card-4 pattern. Caveat: workers are VPS-local stand-ins (same disk) — transport is HTTP either way; a phone/Colab proves the same code across the network. |
| QS-2 exhausted lane switches with a line, never raw JSON | GREEN | `assert-r16-failover` INFERENCE_CAP_ERROR specimen: switch line `🔀 *m-dying* failed (free limit hit (…)) — switching to *m-next*…`, no `{` anywhere. Live 2026-09-25 cline-429→opencode-ok precedent in AI_HANDOVER. |
| QS-3 handoff keeps project + role + pack | GREEN | chat 6218257274 `projectId: health-tracker` + role intact across the 5-host roam (state dump); pack landed + applied per host (`live-swap-proof` ticks 20–27, `packApplied: 1`). |
| QS-4 pack paths stated in the reply | GREEN | `resolvePackPath` + `packPathLine` (sensor: 7 checks — disk-pack / lane-summary excluding the just-failed lane / summary-skipped / refusal). Lane-summary branch is spend-gated (packs > 20 KB only) and untriggered live by design. |
| QS-5 per-location lists match probes | GREEN | `probe-free-lanes` zero-burn per location: vps 41 (cline 4), mobile 38 (cline 0 — no CLI there), collab/grok/vm2 41; `/freemodel` + `/allowance` renders match each probe. |
| QS-6 high vs light split | GREEN | live render 2026-09-26 (r16 @ c462b0d, `--inject=/freemodel`): `Coding-capable:` section first, `Light / fallback:` second, from shared `groupForModel` (scorecard AA≥35, curated groups). Same-route-different-score rows (e.g. TH DeepSeek unranked) render Light: unknown evidence = fallback-class, documented. |
| QS-7 benchmark score on selection | GREEN | same capture: `AA48`, `SWE77.8`, `AA~41` scale-tagged per row, `unranked` where no ledger covers the model; buttons carry scores where rated. No invented numbers (sensor resolves every shown digit via `ratingForModel`). |
| QS-8 list equality | GREEN | 125-check parity sensor + live side-by-side (36 listed both surfaces, same depleted + terminal-only rows) + single canonical projection (`canonicalAllowanceLanes`). |
| QS-9 auto-switch on exhaustion | AMBER — logic green, live full-drain pending | `continueTurnOnNextWorker` + `runRemoteTurn` dry-detection + visited-set + prefer-first (sensor: order, naming, no-repeat, all-dry stop). Live full drain needs every VM lane genuinely empty: forbidden to burn quota for it, forbidden to hand-write stamps. Unblock: the next real exhaustion event, or a maintenance window bless. |
| QS-10 tier-first walk, buckets, skips | GREEN | coding → unknown → light against adversarial prefs; `ended`/terminal-only/Freebuff never offered; sibling-bucket joint depletion (stamp one member, both drop) — all in `assert-r16-failover` on temp ledgers. Walk commit `0793479` live in the chain. |
| QS-11 mid-turn exhaustion | GREEN | `defaultIsRetryable` gap closed: partial text + quota signal now stamps, continues, and delivers partial + flag + completion (`midstreamFlagText`); dead-end-on-repeat via existing path. Sensor with stubbed mid-stream death. Live mid-turn untriggered by nature (needs a real mid-answer 429). |
| QS-12 shared components only | GREEN | capability gate 26/0; tiers/scores/failover/chain all consume `free-lanes` + `model-ratings` shared exports; vendor mirror via `sync-router-vendor`. |

## Score: 11 GREEN, 1 AMBER (QS-9 live drain)

The single open cell cannot be closed without either burning real quota or
forging ledger state — both forbidden by the charter itself. It unblocks the
next time a host genuinely empties: the chain, the naming, and the stop
condition are already proven; only the live transcript is missing.
