# R-16 merge handoff — `agent/r16-scorecard` WIP

**State:** merge of `origin/main` (`b24a4d9`) into `agent/r16-scorecard` (`0df0ca3`) is
**resolved but not green**. Conflict markers are gone, both sides' features are present, and
`tsc --noEmit` exits 0. Six sensor checks still fail because `main` and R-16 each rewrote the
reader spec and their `assert-*` files demand mutually exclusive source shapes.

Nothing is deployed from this commit. Production still runs `/home/ubuntu/bot-host-r14`.

---

## 1. What this merge contains

Both sides, kept:

**From R-16 (`agent/r16-scorecard`)**
- `continueTurnOnNextWorker`, `runRemoteTurn`, `midstreamFlagText` (QS-2 / QS-11)
- `resolvePackPath` / `packPathLine`, catalog-only tiers and scores
- depleted-button failover
- stale-session repair, policy 1b: `isStaleSessionPreflight()`, one retry with
  `sessionOverride: ''`, user-visible notice naming the lost thread, fail-closed on
  malformed IDs and OpenCode outages
- relay bearer auth: `worker-relay.mjs`, `worker-agent.mjs`, `lib/swap-guards.mjs`,
  `bot-host.mjs`
- reader spec constants and helpers: `MODEL_NAME_MAX = 30`, `W_PLAN = 2`, `W_EXPIRY = 15`,
  `W_SCORE = 7`, `MARK_CHARS = 2`, `MARK_CELLS = 3`, `fitCopy`, `fitCells`, `rowCopy`,
  `colsCopy`, `headingCopy`
- evidence: `plan/R16_LIVE_EVIDENCE.md`, `plan/R16_QS_MATRIX.md`, `plan/DIRECT_RELAY_ROUTE.md`

**From `main`**
- the `/allowance` ↔ `/freemodel` single-list work, vendor sync, and the buttons-carry-the-row-copy
  refactor that R-16's alignment spec then widened

**Reader spec now in force** (`scripts/lib/free-lanes.mjs`)
```
mark(2 chars / 3 cells) + ' ' + name(30) + 2 + plan(2) + 3 + reset(15) + 2 + score(7) = 72
```
- `fitCopy` finishes by **character** count (Telegram button unit), ASCII spaces only
- `fitCells` finishes by **display cell** count (monospace `<code>` table unit)
- buttons use `fitCopy(rowCopy(...))`; the table uses `fitCells(rowCopy(...))`
- group headings and the cancel row use `headingCopy()` (two-space indent, 72 chars, dash last)

---

## 2. Test status at this commit

Green:
```
scripts/assert-button-alignment.test.mjs    25 pass, 0 fail
scripts/assert-r16-failover.test.mjs        33 pass, 0 fail
scripts/assert-swap-guards.test.mjs         81 pass, 0 fail
scripts/assert-relay-auth.test.mjs          12 pass, 0 fail
scripts/assert-worker-relay.test.mjs        34 pass, 0 fail
scripts/assert-allowance-walk.test.mjs      43 pass, 0 fail
scripts/assert-free-catalogs.test.mjs       60 pass, 0 fail
npx tsc --noEmit                           exit 0
```

Red — **6 checks, all source-shape, all `main` vs R-16 sensor drift**:

| File | Line | Wants | In force |
|---|---|---|---|
| `assert-one-allowance-model.test.mjs` | 463 | `text: fitCopy(\`${g.label} (${g.rows.length})\`)` | `text: headingCopy(...)` |
| `assert-one-allowance-model.test.mjs` | 504-506 | `const rated = rowCopy({` | `const rated = fitCopy(rowCopy({` |
| `assert-one-allowance-model.test.mjs` | 552-558 | `fitCopy(` for `header`/`sep`/`lines.push` | `fitCells(` for the monospace table |
| `assert-one-allowance-model.test.mjs` | 570 | `const rated = rowCopy({` | `const rated = fitCopy(rowCopy({` |
| `assert-one-allowance-model.test.mjs` | 571-576 | ternary `fitCopy` (`const body = raw.length >= …`) | loop `fitCopy` (`if (n + 1 > COPY_WIDTH - 1) break;`) |
| `assert-freemodel-tiers.test.mjs` | 77 | heading `=== fitCopy(\`${g.label} (${g.rows.length})\`)` | heading has a two-space indent |

**One of these is a real behavioural conflict, five are stale regexes.**

The behavioural one: `assert-button-alignment.test.mjs:137-139` requires
`headingCopy(...)` to start with two spaces; `assert-freemodel-tiers.test.mjs:77` compares the
same button text against an unindented `fitCopy(...)`. Both cannot pass. R-16's indented
heading was kept, because a heading that starts in column 0 reads as another data row.

The other five are `main`-side source-shape regexes that predate the R-16 alignment spec and
would pass again if rewritten to the strings in the "In force" column. **These live in
`scripts/assert-*.mjs`, which AGENTS.md §3 protects when changing what "pass" means** — the
five regex updates need the human's before→after confirmation. The behavioural conflict
(`freemodel-tiers` vs `button-alignment`) is a spec decision, not a regex fix, and should go
to the human too.

Also already changed in this merge, same protected class, previously approved as part of the
reader-spec work: `assert-one-allowance-model.test.mjs` name-column cap `24 → 30`
(lines 437-444), so the sensor matches `MODEL_NAME_MAX = 30`.

`assert-setup-gaps.test.mjs` reports **57 pass, 6 fail** on a Mac and is expected to pass on the
VM. The 6 are the Freebuff signed-in checks, which read `/home/ubuntu/.config/freebuff/
credentials.json`; that path does not exist off the VPS. Not a code defect — same class as
`assert-session-key.test.mjs` reporting 24/0 on the VM and 22/2 on the Mac.

---

## 3. Next steps, in order

1. **Get a decision on the heading indent** (behavioural conflict above). Then update the five
   stale regexes in `assert-one-allowance-model.test.mjs` to the "In force" strings, and
   `assert-freemodel-tiers.test.mjs:77` to match the chosen indent. Re-run all five sensors
   above; they should reach 0 fail.
2. **Full battery before merge to `main`:** every named sensor in
   `docs/agent/DOMAIN_REGRESSION_MAP.md` for the touched rows, plus `npx tsc --noEmit` and the
   named vitest files for `bot-host` / `work-session`.
3. **Re-sync the vendor mirror** after any `free-lanes.mjs` edit:
   `node scripts/sync-router-vendor.mjs`. `tools/telegram-provider-router/src/free-lane-table.vendor.mjs`
   is generated — never hand-edit it.
4. **Merge to `main` via PR** (never push to `main` directly). PR #223 was open against this
   branch; re-check whether it is still the right PR or open a new one.
5. **Deploy merged `main`** to `bot-host@vm` / `bot-host@vm2`, replacing `/home/ubuntu/bot-host-r14`.
6. **Enforce the production `/relay` token route.** Staging is already live at
   `https://health-tracking.duckdns.org/relay-staging/*` (Caddy → `127.0.0.1:8891`, token in
   `~/.config/bot-host/relay.env`, mode 0600, anonymous → 401). Production relay still runs
   tokenless on loopback 8890 via `/home/ubuntu/bot-host/scripts/worker-relay.mjs --port=8890`.
   The user approved this cutover.
7. **Connect real workers**, then run the same-pass QS evidence:
   - phone: `agent/r16-scorecard`, `--host=mobile`, `/relay` or `/relay-staging`
   - Grok VPS: same, `--host=grok`
   - Colab: the cells in `plan/DIRECT_RELAY_ROUTE.md` with `WORKER_RELAY_TOKEN` and `--host=collab`

---

## 4. Scorecard honesty rules — do not break these

- Canonical live board: `plan/R16_QS_MATRIX.md`, currently **5 green / 3 partial / 4 red**.
- A VPS-local `mobile` / `collab` / `grok` worker is a **stand-in**. It proves the mechanism and
  it cannot turn a real-device row green.
- Unit tests, stand-ins, forged ledger stamps, and deliberate quota burn are **not** live
  QS-row evidence.
- **QS-9 (genuine exhaustion) and QS-11 (genuine mid-stream death): wait for real events.** The
  user explicitly declined manufactured exhaustion.
- The stale-session fix is implemented and sensor-proven but **not deployed**; the remote
  stand-in roam still fails on a stale session until `main` ships.

## 5. Live evidence already banked

Real Telegram (`~/proto/tg-user-session/driver.py`, Telethon 1.45.0):
- depleted Cline Muse button tap
- reply naming the depleted lane, its reset time, and the next usable lane
- full live four-lane cascade: DeepSeek → Muse → MiMo → Space Bunny
- no raw provider JSON; tiered and catalog scores visible

Detail in `plan/R16_LIVE_EVIDENCE.md`.

## 6. Files most likely to be needed next

```
scripts/lib/free-lanes.mjs                     canonical rows, tiers, reader spec (source of truth)
tools/telegram-provider-router/src/free-lane-table.vendor.mjs   GENERATED — sync, never edit
scripts/bot-host.mjs                           remote exec, stale-session repair, canary chain, keyboard
scripts/assert-button-alignment.test.mjs       the reader-spec sensor (25/0, authoritative)
scripts/assert-one-allowance-model.test.mjs    5 stale source-shape checks
scripts/assert-freemodel-tiers.test.mjs        1 behavioural conflict (heading indent)
scripts/worker-relay.mjs  scripts/worker-agent.mjs  scripts/lib/swap-guards.mjs   relay auth
plan/R16_QS_MATRIX.md  plan/R16_LIVE_EVIDENCE.md  plan/DIRECT_RELAY_ROUTE.md
```
