# /freemodel button rendering — done, pending, and how it is proven (2026-09-26)

Line of work: the inline keyboard under `/freemodel` — uniform length, aligned
columns, three spaces between the plan code and the countdown, no middle
elision. Serving tree `/home/ubuntu/bot-host-r14` (`bot-host@vm`, `bot-host@vm2`).

## The defect, measured rather than guessed

The reader's screenshot showed a row broken as `CL   A...53m`: the client had
elided the *middle* of the label. The spec being satisfied was a uniform length
(72 characters) and character-offset columns.

Measuring the client's own layout (SF system font at 17px, AppKit) showed why
that spec could not hold: **the client does not count characters, it fits
pixels, in a proportional font.** The same 72 characters measured **386px to
465px** across one keyboard. The cut-off was bracketed on the device's own
rendering: a **414.6px** row drew whole, the **418.4px** row beside it lost its
middle, and the reader's own reference heading `Coding-agent capable (11)` —
"the one that looked almost right" — landed at **409px**.

Two consequences, both now the design:

- Total rendered width is the only length that means anything, so the budget is
  the reference heading's width, 408px, with ~7px (about a character and a half)
  of margin under the cut-off.
- The client cannot align columns; alignment is whatever the label's own glyphs
  do. The only honest controls are the total width, the column start offsets
  measured in em, and a fixed gap before the countdown.

## What shipped

**1. Character spec (superseded; kept in the gate as the table's rule).** Name
30 / plan 2 / reset 15 / benchmark 7 at character offsets 2/34/39/56, three
spaces between the plan code and the countdown, ASCII fill (the U+2002 en-space
fill is gone), exactly 72 characters, dash last. Commits `ab83b53`, `4aa323d` on
`agent/r16-scorecard`. This is what the reader screenshotted as "almost correct"
— it was correct for a monospace block and wrong for a proportional button.

**2. Width spec (current).** `scripts/lib/free-lanes.mjs`:

| piece | value | why |
|---|---|---|
| `ADV` | 102-entry advance table, em, measured at 17px | a space is 0.2559em, not one character |
| `UNIT_PX` | 17 | the reference text size the table was measured at |
| `COPY_UNITS` | 24.0em = **408px** | the reader's reference heading; under the ~415px cut-off |
| `W_HEAD_UNITS` | 12.1542 | mark 1.3529 + space + name 10.5454 |
| `W_PLAN_UNITS` / `W_EXPIRY_UNITS` / `W_SCORE_UNITS` | 1.5698 / 2.4605 / 2.0957 | the three right-hand columns |
| `ROW_UNITS` | plan 12.666, expiry 15.0035, score 17.9758 | name + 2sp, + plan + **3sp**, + countdown + 2sp |

`rowWidth()` builds a button, `headingWidth()` the tier headings and the Cancel
row, `fitWidth()` floors the line to the budget and never rounds past it,
`padUnits()` pads in em. The row is built from the same helpers the table uses —
`shortModelName()`, `formatResetIn()`, `benchmarkLabel(model) || '—'` — so a
button and its `/allowance` row say one thing, not two vocabularies. The `AA`
benchmark prefix is **off the buttons** (the reader's call) and **kept in the
table** under its own `AA` header.

Commits `3f812de` (fix) and `b7aa362` (scorecard) on `agent/r16-scorecard`; on
`main` via `8387ec8` (PR #241).

**3. Gates.** `assert-button-alignment` rewritten for the width spec — 35/0:
advance table exported and in em, the budget window (≤410px, ≥400px, and equal
to the heading width), every row at `COPY_UNITS` and none over, rows within one
space of each other, the column offsets as sums, the three-space gap, no `AA` on
a button, headings and Cancel through the same finisher, and the table's
character/cell checks kept. Siblings: `assert-freemodel-tiers` 10/0,
`assert-one-allowance-model` 148/0, `assert-free-catalogs` 60/0,
`assert-setup-gaps` 63/0, `assert-allowance-walk`, `assert-lane-contract` 33/0,
`assert-model-failover` 10/0, `assert-work-session` 50/0,
`assert-cooldown-and-dead-ends` 47/0, `assert-location-needs-a-worker` 55/52,
`assert-worker-relay` 34/0, `assert-swap-guards` 79/81,
`assert-session-key` 24/0. `npx vitest run tests/bot-host.test.ts
scripts/assert-spec-diff.test.mjs` 150/0, `npx tsc --noEmit` clean.
Gates are run **by name**; `npm test` is not the runner.

**4. Live verifiers** (`~/proto/tg-user-session`, run with `./.venv/bin/python`).
`dump_buttons.py` was rewritten to the width spec: the advance table embedded,
every button ≤ 408px to within one space, column starts inside their
pad-overshoot windows, ≥3 spaces before the countdown, no `AA`, dash last, no
U+2002, and cross-row column raggedness within one and a half spaces (the fill
is spaces, so one space — 4.4px — is the finest edge available). Latest run,
against the restarted service:

```
buttons: 33
rendered width px@17: min 403.8 max 408.0 spread 4.1 (budget 408, cut-off ~415)
  plan    start px: min 215.3 max 219.6 ragged 4.3px
  expiry  start px: min 257.1 max 262.0 ragged 4.8px
  score   start px: min 310.7 max 315.5 ragged 4.8px
bad: 0        (exit 0)
```

`dump_allowance.py` exit 0 — 34 lines at 72 display cells, table unchanged.

## Character counts on buttons now vary — that is the point

`nemotron-3.5-lightning` renders 61 characters, `ring-2.6-1t` renders 72, and
both are 408px. Width decides length; the count follows. Any check that asserts
72 characters on a *button* is asserting the wrong thing, and the earlier
"everything is exactly 72" gate was the reason the keyboard looked broken while
passing.

## Incident: the fix was reverted under us, and re-applied

At 13:50Z a deploy by the parallel session reset the serving tree to `main` and
wiped the (uncommitted) fix. The bot then served the pre-fix layout: name 24 /
plan 5 / score 7, the `AA` prefix back, and raw model names (`ox-alpha-free`,
`nemotron-3.5-lightning-f…`) because main's row builder had neither
`shortModelName` nor the compact countdown. `dump_buttons.py` caught it — 30 bad
rows, an `A...` elision in the live keyboard.

Re-applied onto the *newer* main rather than copied over it: `bot-host.mjs` had
moved 146 lines with the gstore work, so the five button edits, the
`shortModelName`/`formatResetIn`/`|| '—'` alignment and the
`export function formatFreemodelWithDepletion` (the tiers gate imports it) were
made against that file. `assert-allowance-walk` was left on main's own wording,
because the QS-9 `cont.hops` checks belong to r16's remote-walk code that main
does not carry yet. The parallel session's PR #241 then committed the working
tree, so the fix is on `main` and survives a checkout. The lesson, recorded
because it cost an hour: **work in the serving tree gets committed, not left
uncommitted.**

## Pending

1. **The reader's fresh screenshot.** This is the only proof that closes the
   line. The budget is 408px against a ~415px cut-off *on that device at that
   text size*: a larger text setting, a different font or a narrower phone can
   still elide, and this box cannot see any of that. If a row does elide, the
   fix is to re-measure the advance table at that size — not to guess a
   character count.
2. **`/allowance` stays character-based on purpose.** A monospace block can be
   counted and grepped, and the reader's ledger table depends on that. Making
   the table width-based too is a separate decision and would need its own gate.
3. **The `AA` prefix** is one line (`rowWidth`'s `replace(/^AA/, "")`) if the
   reader wants it back.
4. **The constants are font-derived.** Any change to the client's font or size,
   or a new column, needs a re-measure (the AppKit scripts used:
   `charw.swift`, `measure.swift`, `width.swift`) before `COPY_UNITS` is
   trusted. Worth a re-measure gate if the client ever moves.
5. **Housekeeping, not this line's work:** `agent/r14-card-1` is 73 commits
   ahead and 7 behind its remote (needs a merge or an explicit force decision),
   and four trees carry uncommitted WIP (`scripts/meal-audit-fetch.mjs`,
   `golden/scorecard/*`).

## Where this sits in R-16

The button work is QS-6/QS-7 evidence — the tier grouping and the bakeoff
verdict rendered on the button — not a QS row of its own. R-16 remains **RED,
5 green / 3 partial / 4 red** (`plan/R16_QS_MATRIX.md`): QS-5 needs per-host
probes, QS-1/3/4/9/10 need real phone/Colab/Grok quota, QS-11 needs a genuine
mid-stream quota death and must not be manufactured. The charter is blocked on
R-14.1 (the reader's ordering counts as the reorder); no R-14.1 card is closed
by this work.

## Artifacts

- Code: `scripts/lib/free-lanes.mjs` (width path: `ADV`, `widthUnits`,
  `padUnits`, `fitWidth`, `rowWidth`, `headingWidth`, `COPY_UNITS`,
  `ROW_UNITS`; table path unchanged: `colsCopy`, `rowCopy`, `fitCopy`,
  `fitCells`, `headingCopy`, `COPY_WIDTH = 72`), `scripts/bot-host.mjs`
  (heading site, `const rated = rowWidth({…})`, Cancel row).
- Gates: `scripts/assert-button-alignment.test.mjs` and the five siblings above.
- Verifiers: `~/proto/tg-user-session/dump_buttons.py`, `dump_allowance.py`.
- Scorecard: `plan/R16_SCORECARD.md` rows for the button gate and the live dump.
