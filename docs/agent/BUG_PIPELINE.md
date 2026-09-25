# Bug pipeline (the ticket lane)

**You:** a defect (TG report, QA finding, or an L15 card) → **the lane:** steward → repro → plan → dispatch → verify.
Counterpart of [JOURNEY.md](./JOURNEY.md): JOURNEY owns feature journeys; this owns the bug-ticket loop. Design source: `plan/BUG_TICKET_PIPELINE.md`.

**Triggers:** `work bug` · `next bug` · `work 11` · `repro #n` · `plan #n` · `verify #n` (AGENTS.md L15) · `/resume [n]` on any bot-host bot.

---

## One store, two doors

- **Store:** D1 `issue_tags` — the only state owner. Writers go through `/api/bugs/*` with `X-Bug-Api-Token`.
- **Doors:** `node scripts/bugctl.mjs …` (CLI; writes queue offline as `.bugctl-queue.jsonl` when the API is down) and the TG **@Bug_ticket_bot** (packer intake, one card or needs_repro/duplicate per report).
- **Review story:** git journal `specs/bug-journal/<n>.jsonl` — every posted artifact appends one row (P1 A+D).
- **Generated view:** `node scripts/bug-backlog.mjs` → `bug-backlog.md`. The hand-compiled evidence file lives on as `bug-backlog.legacy.md` and is embedded verbatim; never delete it.

## States (S-C-lite — always derived, never set)

| State | Reaching it requires posting |
|---|---|
| `new` | `bugctl create` |
| `packed` | `bugctl pack` defect (single defect; bundled → split) |
| `in_fix` | attempt start row |
| `verifying` | attempt committed/pushed row |
| `done` | verify **green** with `named_test` — a journey green never closes (derived flag `verifying`) |

**Flags:** `blocked_reason`, `needs_repro`, `not_reproducible`, `duplicate_of`.
There is **no agent-settable state route** — asserted every CI run by `assert-bug-ticket-continuity`.

## Who moves what

| Role | Owns | Never |
|---|---|---|
| Steward (`@Bug_ticket_bot`, profile `bug_ticket`) | intake, pack, split, dedupe, curation receipts | fix, verify |
| QA (`qa_meal`, `qa-reproduce` skill) | repro verdict + portable R2 evidence keys | fix, dispatch |
| Orchestrator | `bugctl plan`, `run-coding-dispatch.sh --ticket=#n`, attempt rows, `bugctl block` | post verify |
| Builder | fix in the worktree, push `agent/dispatch-*` (never main) | post verify |
| Verifier | `bugctl verify --result green --command <gate>` | have authored the fix |
| Human | everything on the **needs human** list below | — |

## The loop

1. `node scripts/bugctl.mjs create --title=…` → card `#n` (journal `create` row).
2. `bugctl pack --id=#n --component --observed --expected --criteria --class --surface` → `packed` (vague → `needs_repro`; identical fingerprint → `duplicate_of`).
3. Repro: `node scripts/qa-runner.mjs --ticket=#n` → `confirmed` or `failed` (`not_reproducible`) with R2 keys `bugs/<tag_id>/<ts>-*`.
4. `bugctl plan --id=#n --hyp=… --files=… --gates=…`.
5. `bash scripts/run-coding-dispatch.sh --ticket=#n` — guard (exit 3 on in-flight/done/blocked), plan before detach, attempt start/committed rows, failure → `bugctl block --reason`.
6. Non-author verifier: `bugctl verify --id=#n --result green --command <gate> --evidence a,b --by <role>` → `done`.

Re-entry after any gap: `/resume [n]` (or `bugctl packet --id=#n --format=text`) — the packet **is** the prompt.

## Gates (exit 0)

| Gate | Proves |
|---|---|
| `npx vitest run src/utils/bugTicketState.test.ts` | derived projection (ticket-state) |
| `node scripts/assert-bug-pack.mjs` | BUG-8449 fixture traceability + packer rules (CI-safe fixture HOME) |
| `node scripts/assert-bug-repro.mjs` | both repro verdicts + derived flags |
| `node scripts/assert-bug-dispatch.mjs` | packet dispatch, guard, attempt rows |
| `node scripts/assert-bug-ticket-continuity.mjs` | §4.10 route shape + offline projection walk |
| `node scripts/assert-bug-retro-audit.mjs` | §4.10's six answers for BUG-8449, from disk alone |
| `node scripts/check-capability-propagation.mjs --strict --ids=svc-bug-ticket,proc-ticket-state,sess-ticket-resume,svc-repro` | ticket capability rows `done` (structural checks always run on all rows) |
| `node scripts/bug-backlog.mjs --check` | generated backlog reproduces the BUG-8449 fixture + legacy rows |

CI (`.github/workflows/ci.yml`) runs ticket-state, pack, continuity, capability, and retro-audit on every PR. The remaining gates run per-change per `DOMAIN_REGRESSION_MAP.md`.

## §4.10 — six answers, no chat

The retro-audit gate prints these for the re-opened BUG-8449 record; any answer that needs a chat log fails the phase:

1. **What am I working on?** → card row + defect (generated backlog + journal `create`/`pack`).
2. **What was tried and burned?** → plan/attempt rows (ledger, not scrollback).
3. **What is the exact next command?** → the packet footer (`bugctl packet --id=#n --format=text`).
4. **Where is the evidence?** → R2 keys / journal rows / `qa-evidence/` paths on the card.
5. **What closes this ticket?** → verify contract: `named_test` + plan gates + criteria, author ≠ verifier.
6. **Who is waiting on whom?** → the role chain above, from the card's derived state.

**Recorded transcript — 2026-09-25, card #7 (re-open of BUG-20260921-8449), gate output verbatim:**

1. *What am I working on?* — `#7 "BUG-20260921-8449 re-open: home dashboard vs reference (V-30.5 retro-audit)"` — defect: Home dashboard (BUG-20260921-8449): 6 of 7 legacy reference discrepancies remain untracked in the store (nav tab labels, telemetry errors banner, ready pill, extra sections, whats-up-today button; omega-3 display fixed by 00b8cb1) — state `packed`, from `specs/bug-journal/7.jsonl` + generated `bug-backlog.md` row.
2. *What was tried and burned?* — Burned ledger from `bug-backlog.legacy.md` + dispatch audit: attempt 1 full-scope 6-issue cascade failed (opencode, cline, grok, agy); attempt 2 narrowed bottom-nav+omega-3 failed (agy FAILED_PRECONDITION geo-block, grok 0 changes); attempt 3 on 2026-09-22 agy geo-blocked again — never retry agy from the VPS. omega-3 item already fixed by `00b8cb1` (card #2 not_reproducible). Scope: retro-audit only — do not dispatch a bundled fix.
3. *Exact next command* — `node scripts/bugctl.mjs packet --id=#7 --format=text`
4. *Where is the evidence?* — `qa-evidence/bug_meal_1790003331836.png` · `qa-evidence/clean_meal_1790084302362.png` · `qa-evidence/opencode-live-home.png` · `~/.hermes/logs/dispatch_BUG-20260921-8449.log` · `scripts/fixtures/bug-8449.json` (source: bug-backlog.md Issues table) · `specs/bug-journal/7.jsonl`
5. *What closes this ticket?* — `bugctl verify --result green --command "node scripts/assert-bug-retro-audit.mjs"` by a non-author verifier (criteria: gate exits 0 with all six answers from disk; the six remaining UI discrepancies stay tracked in `bug-backlog.legacy.md` until a human splits them).
6. *Who is waiting on whom?* — steward packs (done) → qa_meal repro → orchestrator plan/dispatch (plan posted) → builder fix → non-author verifier posts named_test verify; human owns the needs-human list.

Gate: `node scripts/assert-bug-retro-audit.mjs` → **12 pass, 0 fail, 6/6 answers from disk** (no chat, no API). The verify on card #7 is deliberately **not** self-posted (author ≠ verifier): a non-author session posts it after this gate merges.

## Needs human (stop and hand off)

- Scope beyond the single-defect rule (a bundle must be split by a human decision when the split is contested).
- Token/model/billing operations (BotFather, P9 token, allowance refills).
- `not_reproducible` disputes: close vs re-scope.
- Live TG taps that prove a command end to end (e.g. `/resume #n` on `@Bug_ticket_bot`).
- Anything `plan/ROADMAP.md` marks `blocked_human`.

## Memory rules

- **The packet is the prompt.** Chat announces; the store + journal remember.
- **No chat-claim `done`.** Only a verify artifact closes a card.
- Burned hypotheses go into the plan row or `specs/rejected/` — never into scrollback.
- `/resume` is a read: it creates no second state store and trusts no chat history.
