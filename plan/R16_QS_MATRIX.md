# R-16 scorecard — evidence matrix (QS-1 … QS-12)

> Tracked in `plan/` beside the charter, not in `qa-evidence/`: that directory is
> gitignored, and a board nobody can pull is not a board. Raw captures stay local.

**Charter:** `plan/ROADMAP.md` → "R-16 — cross-location quota-resilience scorecard (QS-1..QS-12)".
**This file is evidence, not a claim.** The charter's pass rule: "the scorecard passes only
when every QS row below is green **in the same live pass**. One RED row = whole scorecard
RED." So R-16 is **RED** today, and the table below says which rows are green, which are not,
and what is missing — no row is rounded up.

**Reorder note.** The charter says "No R-16 row may start while R-14.1 is open" and allows
"an explicit human reorder". The repository owner ordered this work on 2026-09-26
("get the latest version of github and see what you can do to get the scorecard green …
do the work on your own"), which is that reorder. R-14.1 cards 4/5/6/6c/9 remain open
regardless, so this file does not close them.

**Deploy under test:** `/home/ubuntu/bot-host-r14` at `9dd26fc`, branch
`agent/r14-vendor-sync`, services `bot-host@vm`, `bot-host@vm2`, `ht-allowance-watch`.
Secrets are never pasted here; the probe prints credential *presence* only.

---

## Summary

| ID | Row | State | One-line reason |
|---|---|---|---|
| QS-1 | Roam mobile → VM → grok → collab in one project | 🔴 | `mobile` is a physical device; `collab` and `grok` workers are not running in this box. vps half proved. |
| QS-2 | Quota-shaped error never surfaces raw JSON; next lane completes the prompt | 🟢 | Live: switch line names failed → next lane, answer completed, no raw JSON, ledger untouched. |
| QS-3 | Exhausted host hands off project + context | 🔴 | Needs ≥2 connected workers with quota; only one host here. Code exists (`/location`, handoff pack), not proved live. |
| QS-4 | Automated pack-up with three paths | 🔴 | Same blocker as QS-3. |
| QS-5 | Every agent's `/model` + `/freemodel` + `/allowance` match that host's probe | 🟡 | vps host green (probe ↔ rows agree per provider). `collab`/`grok`/`mobile` probes not captured. |
| QS-6 | Free list split high vs light, from the existing catalogs | 🟢 | Tiers read from `FREE_CODING_TOOLS_CATALOG.md`; the ratings table that forked them is deleted. |
| QS-7 | Benchmark score on `/freemodel` from the bakeoff, "unranked" when absent | 🟢 | Button labels are bakeoff counts or "unranked"; no number exists that the ledger has no row for. |
| QS-8 | `/freemodel` list == `/allowance` list | 🟢 | 30 == 30 on both bots, live, after the parity fixes. |
| QS-9 | All agents auto-switch location on exhaustion | 🔴 | Needs multiple connected hosts; single-host walk order is proved (QS-10) instead. |
| QS-10 | Exhaustion walks tier-first, then the next location | 🟡 | Tier-internal order proved (high → unlisted → light, light reachable + announced). The "next location" half needs QS-9. |
| QS-11 | Mid-turn exhaustion detected, stamped, next model resumes | 🟡 | Displacement/stamp/`/allowance` reflection proved live; a **mid-stream** death has not been produced on this host. |
| QS-12 | No custom builds — shared components only | 🟢 | Propagation gate green, vendor mirrors byte-identical, no surface-local lane table. |

**R-16 = RED.** 5 green, 3 partial, 4 red.

---

## Green rows, with the evidence block

### QS-2 — resilience against exhausted quota 🟢

- **UTC:** 2026-09-26T06:58:56Z (first attempt 06:51:27Z, before the switch line existed)
- **Bot and MainPID:** `@VM2_19485_bot`, `bot-host@vm2` MainPID 1162673
- **Command sent:** `/model cline:cline-free/muse-spark-1.3-contributor` then
  `Reply with the single word: ok`
- **Raw reply (msg 5865):**
  `🔀 \`cline:cline-free/muse-spark-1.3-contributor\` is depleted until 2026-09-26T11:59:11Z (from vendor countdown Retry in ~22h 26m.) / Sat 18:59 WIB — this turn ran on \`opencode/muse-spark-1.3-contributor-free\` instead.`
- **Raw reply (msg 5866):** `ok` + `build · ctx 16.8k tokens` — the same prompt completed on the next lane
- **Side effect:** the chat's configured lane was displaced; the log line reads
  `lane cline:cline-free/muse-spark-1.3-contributor not selectable (depleted until …); using opencode/muse-spark-1.3-contributor-free`
- **Negative check:** no `INFERENCE_CAP_ERROR` / raw error JSON in any chat reply (0 matches
  across the before and after `/allowance` captures and the turn). The real ledger was not
  written by a displacement: `~/.local/state/bot-host/vm2/free-lanes/session.json` mtime is
  still `2026-09-25 08:11:06Z`, i.e. a displacement moves no quota. `/allowance` rows 30
  before and 30 after, with the depleted row `❌ Muse 1.3 Cont CL 5h` and its healthy
  OpenCode sibling `✅ Muse 1.3 Cont OC`, plus `Next up: … opencode/muse-spark-1.3-contributor-free`.
- **Why it was red before:** the walk did the right thing at 06:51Z and told the chat nothing.
  Fixed in `89152c9`; the row wanted a *user-visible* switch line, not a log line.

### QS-6 — high vs light follows the existing catalogs 🟢

- Tiers are read from `golden/scorecard/current/FREE_CODING_TOOLS_CATALOG.md` (Ranked picks,
  then Tools × free models) by `scripts/lib/free-catalogs.mjs`. The wave ledger
  `FREE_MODEL_BAKEOFF.md` supplies the score; `FREE_MODEL_TOOL_PICKER.md` is the third
  catalog named by the charter.
- `scripts/lib/model-ratings.mjs` — the "new rating" the charter names — is **deleted**, with
  its router mirror and its 50-check sensor replaced by `assert-free-catalogs` (40 checks).
- Ratchet: no tier exists that the catalog does not carry. `deepseek-v4` is unlisted *because*
  the catalog says `Any DeepSeek V4 — Forbidden`; `glm-5.3-flash` is unlisted because its row
  says `Dead`; `solar-pro4` is unlisted because its only row is a Freebuff (terminal-only) row.
- Walk order is `high → unlisted → light` (`assert-allowance-walk` 42 checks), light lanes stay
  reachable, and a degraded turn is announced.
- The split is **visible**, not just ordered: `/allowance` prints a subheading per group with the
  group's own count (`Coding-agent capable (18)` / `Not in the catalog (1)` /
  `Light · docs/inventory (11)`), and `/freemodel` carries the same word on each button
  (`coding` / `light` / `unranked`) because a keyboard has no subheadings. Both surfaces call one
  `groupRowsByTier()`, so order and membership cannot differ. Live 30 == 30 on both bots.
- **Placement is one rule, in the catalog's "Placement rule" section, and it is the owner's:**
  *a published benchmark of **AA ≥ 35** is the coding pool; anything lower is the
  docs/inventory pool; **a model with no published figure is `light`**; a model with no published
  figure that is **demonstrated** capable is `high`.* 35 sits in a wide gap in the published
  figures (30 at the top of the light pool, 39.5 at the bottom of the coding pool), so any cut
  in between gives the same rows.
- The **demonstrated** exception is one row — Space Bunny, on `plan/ROADMAP.md` +
  `plan/BOT_ROLES.md` making it the fleet fallback plus its answering on this host. On the live
  board 12 rows have no published figure and exactly **one** of them is in the coding pool.
- Locks still outrank the rule: `Any DeepSeek V4 — Forbidden` (a user lock) and Freebuff rows
  (terminal-only on this host) are never offered. A retired *promo* row is **not** a lock — the
  GLM 5.3 Flash lane is live and selectable, so its AA 42 places it in the coding pool.
- The per-model "Capability notes" table is kept as the reasoning behind a placement, and
  decides nothing on its own; `assert-free-catalogs` (59 checks) asserts the rule, the
  one-row exception list, and that a vendor adjective is not evidence.

### QS-7 — benchmark score on `/freemodel`, "unranked" when absent 🟢

- A button carries a bakeoff label (`bakeoff 4 pass · 1 partial`) or the word `unranked`.
  Live: DeepSeek V4.1 Flash and Muse Spark 1.3 Contributor show bakeoff counts; the ~25 models
  the 2026-09-16 ledger has never run show `unranked`.
- No number is rendered that the ledger has no row for: `assert-free-catalogs` checks
  `bakeoffVerdict(m).ranked === false` for `space-bunny-free`, `kimi-k2.5-free`, `big-pickle`,
  `glm-5.3-flash`, and for `deepseek-v4`, which is a prefix of `deepseek-v4.1-flash` and used to
  inherit its four waves.
- Every fact carries the file it came from (`catalogFacts()` → `source`, `tierWhy`).

### QS-8 — `/freemodel` == `/allowance` 🟢

- **Live, 2026-09-26, both bots:** `/allowance` 30 rows, `/freemodel` `Total: 30` — MATCH on
  `VM2_19485_bot` and on `VM_19485_bot`, after the catalog rewiring.
- Reached by construction, not by coincidence: one canonical list (`canonicalAllowanceLanes`)
  with one supersession policy (the catalog's Ranked picks) and one table (the catalog-folded
  one), then the same two exclusions on both surfaces.
- Three real defects were found by measuring, not by reading: superseded models resurrected by
  a re-add loop keyed on the list (49 vs 30), the handler folding a different table than its own
  annotation (46 vs 30), and `pending:*` provider placeholders counted as models (36 vs 30).

### QS-12 — shared components only 🟢

- `node scripts/check-capability-propagation.mjs` → `capability propagation check: 26
  capabilities, 0 failures, 0 warnings`; `OK done=20 partial=6`.
- Vendor mirrors byte-identical after `node scripts/sync-router-vendor.mjs`, including the new
  `free-catalogs.mjs` mirror — the router ships standalone, so `free-lane-table.vendor.mjs`
  could not even be imported without it, and the drift check now covers that mirror and
  `setup-gaps.mjs` (mirrored but never checked).
- Negative check: no surface keeps its own lane table. `scripts/lib/model-ratings.mjs` and
  `tools/telegram-provider-router/src/model-ratings.mjs` are gone, and `assert-free-catalogs`
  fails if either reappears or if any code imports a ratings module.

---

## Partial rows, and exactly what is missing

### QS-5 — per-host probe ↔ rows 🟡

Zero-burn probe, vps host, `node scripts/probe-free-lanes.mjs --bot vm2`:

```
host capability probe (zero burn) — env from: process env, common.env, vm2.env; ledger: live-state + catalog fold (51 lanes)
  OpenCode               binary present  no OPENCODE_API_KEY  37 catalog rows
  Cline                  binary present  auth file present    4 catalog rows, 5 ledger rows
  Token Harbor           remote API      credential set       2 ledger rows
  Cloudflare Workers AI  remote API      credential set       0 ledger rows, 2 @cf lanes
  Gemini via OpenCode    via OpenCode    credential set       3 catalog rows, 0 ledger rows, 3 google lanes
  Freebuff               NO BINARY       no credential        1 ledger rows (terminal-only on this host)
```

This agrees with the live `/allowance` (Cline ✅ rows, TH 2, CF 2, GM 3, Freebuff ❌ terminal
only). **Missing:** the same block for `collab`, `grok` and `mobile`. Those hosts are not
running here, and a probe for a host that does not exist would be exactly the "inferred from
another host" failure the row forbids.

### QS-10 — tier-first walk 🟡

Proved: the walk orders `high → unlisted → light` inside each group by pref; light stays
reachable; a displaced lane and a degraded lane are both announced in the chat
(`assert-allowance-walk` 42 checks, plus the QS-2 live capture).
**Missing:** the second half of the row — "then next location's allowance" — which is QS-9.

### QS-11 — mid-turn exhaustion 🟡

Proved live: displacement is detected from the ledger before the reply, the chat is told, and
`/allowance` reflects the stamp on the next read (`❌ Muse 1.3 Cont CL 5h`).
**Missing:** a model that dies **mid-stream** with a quota signal, the dead-end row on a
repeated signature, and a resume on the next model. Not produced on this host, and it must not
be faked by burning real quota.

---

## Red rows, and the blocker

| ID | Blocker | What would unblock it |
|---|---|---|
| QS-1 | `mobile` is a `device` in the registry — a physical phone, absent from this box. `collab` and `grok` (`tg_provider_router`) are registered `enabled: true` but no unit exists and neither is running. | Start the collab worker and the Grok router here; a phone (or its documented stand-in) for `mobile`. |
| QS-3 | Needs a second connected worker with quota to receive the project + role + handoff pack. | Two live workers. |
| QS-4 | Same as QS-3. The three paths (disk-pack / lane wrote summary / summary skipped) need a failed lane and a surviving one. | Two live workers. |
| QS-9 | "Depleting every selectable lane on the starting host auto-continues on the next connected host" cannot be observed with one host. | Two live workers with separate ledgers. |

**No red row was marked green by a unit test, a table diff, or a single-location check** — the
charter forbids all three as a way to flip a row, and that is why they are listed here.

---

## Reusable harness

`~/proto/tg-user-session/driver.py` (credentials and session outside every repo):

```
driver.py send "/allowance"      # per-bot ledger board
driver.py send "/freemodel"      # the free-lane picker
driver.py send "/model <ref>"    # the setter, can force a depleted lane
driver.py watch [seconds]        # read-only wait for the bot's next message
driver.py proof card6            # cards 6/6b against a ledger COPY (FREE_LANES_DIR)
driver.py proof locations        # cards 4/5/6/6c across vps, vm2, mobile, collab, grok
```

The `locations` sequence is the harness QS-1, QS-3, QS-4 and QS-9 need; it reports which of
those hosts are actually reachable before it tries to prove anything on them.
