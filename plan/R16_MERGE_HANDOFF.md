# R-16 merge handoff — `agent/r16-scorecard`

**State:** `origin/main` (`b24a4d9`) is merged into `agent/r16-scorecard`, all conflict
markers resolved, every named R-16/alignment sensor green, `tsc --noEmit` exit 0.

**Not deployed.** Production still runs `/home/ubuntu/bot-host-r14`. Nothing from this
merge has shipped.

---

## 1. What happened in this merge

The branch was mid-merge from `main` and the remote branch had also moved (three commits
landing the rendered-width button work). Both had to be reconciled:

- `main`'s half: the `/allowance` ↔ `/freemodel` single-list work and the
  buttons-carry-the-row-copy refactor.
- The branch's newer half: `3f812de` "lay the buttons out by rendered width, not
  characters", which **replaced** the character-count approach with an em-based one
  after live keyboard measurement.

**The em-based approach won.** It is the branch's authoritative gate
(`assert-button-alignment` 35/0) and it is backed by a live measurement, not a guess:
the same 72 characters rendered anywhere from 386px to 465px across one keyboard, a
414.6px row rendered whole while the 418.4px row beside it lost its middle to `…`, and
the one row that read correctly (the tier heading) landed at 409px. So:

```
fitCopy(...)   72 characters  — character unit
fitCells(...)  72 display cells — monospace <code> table unit
rowWidth(...)  COPY_UNITS = 24em = 408px  — button label, rendered width
headingWidth   same 24em, indented by the mark column
```

Column order and widths are unchanged and are the single source of truth in
`scripts/lib/free-lanes.mjs`:

```
mark(2 chars / 3 cells) + ' ' + name(30) + 2 + plan(2) + 3 + reset(15) + 2 + score(7)
```

Columns start at character 2 (name), 34 (plan), 39 (reset), 56 (benchmark).

### Kept from both sides

- `continueTurnOnNextWorker`, `runRemoteTurn`, `midstreamFlagText` (QS-2 / QS-11)
- `resolvePackPath` / `packPathLine`, catalog-only tiers and scores
- depleted-button failover
- stale-session repair, policy 1b: `isStaleSessionPreflight()`, one retry with
  `sessionOverride: ''`, user-visible notice naming the lost thread, fail-closed on
  malformed IDs and OpenCode outages
- relay bearer auth: `worker-relay.mjs`, `worker-agent.mjs`, `lib/swap-guards.mjs`,
  `bot-host.mjs`
- `MODEL_NAME_MAX = 30`, `W_PLAN = 2`, `W_EXPIRY = 15`, `W_SCORE = 7`, `MARK_CHARS = 2`,
  `MARK_CELLS = 3`

### Two real bugs the merge surfaced, both fixed here

1. **`fitCells` did not always terminate the line.** It preserved an existing trailing
   `-` and otherwise padded with spaces, so `fitCells(rowCopy(...))` produced table rows
   with no dash while the header and rule had one. Caught by `every line of the
   allowance table is exactly 72 display cells`. Now always appends the dash.
2. **`assert-freemodel-tiers` compared the button against the raw row label** while the
   button prints `shortModelName(...)`. A Freebuff row labelled `Freebuff lane` whose
   model is `deepseek-v4-flash` printed as `DeepSeek V4` and the order check failed. The
   check now compares against the name the row actually prints, which is what its own
   comment always claimed.

---

## 2. Test status at this commit

```
assert-button-alignment.test.mjs        35 pass, 0 fail
assert-one-allowance-model.test.mjs    148 pass, 0 fail
assert-freemodel-tiers.test.mjs         10 pass, 0 fail
assert-r16-failover.test.mjs            33 pass, 0 fail
assert-swap-guards.test.mjs             81 pass, 0 fail
assert-relay-auth.test.mjs              12 pass, 0 fail
assert-worker-relay.test.mjs            34 pass, 0 fail
assert-allowance-walk.test.mjs          43 pass, 0 fail
assert-free-catalogs.test.mjs           60 pass, 0 fail
assert-cooldown-and-dead-ends.test.mjs  47 pass, 0 fail
assert-model-failover.mjs               10 pass, 0 fail
npx tsc --noEmit                        exit 0
```

**`assert-setup-gaps.test.mjs` reports 57 pass, 6 fail on a Mac and is expected to pass on
the VM.** The 6 are the Freebuff signed-in checks, which read
`/home/ubuntu/.config/freebuff/credentials.json`; that path does not exist off the VPS.
Same class as `assert-session-key.test.mjs` (24/0 on the VM, 22/2 on the Mac). Not a code
defect — verify on the VM before treating it as one.

Named vitest for `bot-host` / `work-session` was green before these layout changes
(176/176) and has **not** been re-run since. Run it before merging to `main`.

### Protected-file edits made in this merge

`scripts/assert-*.mjs` is protected by AGENTS.md §3 when changing what "pass" means. These
edits were unavoidable to reconcile the two sides, and each one only re-points a
source-shape regex at the implementation that is actually in force — no check was
weakened or deleted:

| File | Change | Why |
|---|---|---|
| `assert-one-allowance-model.test.mjs` | name cap `24 → 30`, `fitCopy`/`fitCells`/`rowWidth` source shapes, table finished in cells, helper import list | the reader spec widened to 30 and buttons moved to `rowWidth()` |
| `assert-freemodel-tiers.test.mjs` | `nameOf` compares against `shortModelName`, heading compared with `headingWidth` | the button prints the short name at rendered width |

Worth a human read, since §3 asks for a before→after confirmation.

---

## 3. Next steps, in order

1. **Re-run the named vitest** for the `bot-host` / `work-session` rows, then the full
   battery from `docs/agent/DOMAIN_REGRESSION_MAP.md` for the touched rows.
2. **Re-sync the vendor mirror** after any `free-lanes.mjs` edit:
   `node scripts/sync-router-vendor.mjs`.
   `tools/telegram-provider-router/src/free-lane-table.vendor.mjs` is generated — never
   hand-edit it.
3. **Verify on the VM** that `assert-setup-gaps` is 0 fail there.
4. **Merge to `main` via PR** (never push to `main` directly). PR #223 was open against
   this branch — re-check whether it is still the right PR or open a new one.
5. **Deploy merged `main`** to `bot-host@vm` / `bot-host@vm2`, replacing
   `/home/ubuntu/bot-host-r14`.
6. **Enforce the production `/relay` token route.** Staging is already live at
   `https://health-tracking.duckdns.org/relay-staging/*` (Caddy → `127.0.0.1:8891`, token
   in `~/.config/bot-host/relay.env` mode 0600, anonymous → 401). Production relay still
   runs tokenless on loopback 8890 via
   `/home/ubuntu/bot-host/scripts/worker-relay.mjs --port=8890`. The user approved this
   cutover.
7. **Connect real workers**, then run the same-pass QS evidence:
   - phone: `agent/r16-scorecard`, `--host=mobile`, `/relay` or `/relay-staging`
   - Grok VPS: same, `--host=grok`
   - Colab: the cells in `plan/DIRECT_RELAY_ROUTE.md` with `WORKER_RELAY_TOKEN` and
     `--host=collab`

---

## 4. Scorecard honesty rules — do not break these

- Canonical live board: `plan/R16_QS_MATRIX.md`, currently **5 green / 3 partial / 4 red**.
- A VPS-local `mobile` / `collab` / `grok` worker is a **stand-in**. It proves the
  mechanism; it cannot turn a real-device row green.
- Unit tests, stand-ins, forged ledger stamps and deliberate quota burn are **not** live
  QS-row evidence.
- **QS-9 (genuine exhaustion) and QS-11 (genuine mid-stream death): wait for real events.**
  The user explicitly declined manufactured exhaustion.
- The stale-session fix is implemented and sensor-proven but **not deployed**; the remote
  stand-in roam still fails on a stale session until `main` ships.

## 5. Live evidence already banked

Real Telegram (`~/proto/tg-user-session/driver.py`, Telethon 1.45.0):

- depleted Cline Muse button tap
- reply naming the depleted lane, its reset time, and the next usable lane
- full live four-lane cascade: DeepSeek → Muse → MiMo → Space Bunny
- no raw provider JSON; tiered and catalog scores visible

Detail in `plan/R16_LIVE_EVIDENCE.md`. Button rendering detail in
`plan/FREEMODEL_BUTTON_RENDERING.md`.

## 6. Files most likely to be needed next

```
scripts/lib/free-lanes.mjs                     canonical rows, tiers, reader spec (source of truth)
tools/telegram-provider-router/src/free-lane-table.vendor.mjs   GENERATED — sync, never edit
scripts/bot-host.mjs                           remote exec, stale-session repair, canary chain, keyboard
scripts/assert-button-alignment.test.mjs       the reader-spec gate (35/0, authoritative)
scripts/assert-one-allowance-model.test.mjs    single-list gate (148/0)
scripts/assert-freemodel-tiers.test.mjs        tier order + button shape (10/0)
scripts/worker-relay.mjs  scripts/worker-agent.mjs  scripts/lib/swap-guards.mjs   relay auth
plan/R16_QS_MATRIX.md  plan/R16_LIVE_EVIDENCE.md  plan/DIRECT_RELAY_ROUTE.md
```
