# Bug ticket pipeline for TG agentic development — audit + plan (proposal)

**Status:** **V-30.1 DONE 2026-09-24** (store + CLI + A-f1/A-f5); **V-30.2 DONE 2026-09-24** (packer + fixtures + P9 token + one live Telegram E2E reply + `enabled: true` + `@Bug_ticket_bot`; fixture traceability + packer-only boundary closed in the same change); **V-30.3 DONE 2026-09-24** (`qa-reproduce` skill, `qa-runner --ticket`, `bugctl repro --check`, §4.6 R2 bundle, `svc-repro` done, gate `assert-bug-repro` 57/0, and a live verdict posted on card #2: `failed` → `not_reproducible` with R2 evidence keys — card #2 was already fixed by `00b8cb1`, proving the known-good path end to end); **V-30.4 DONE 2026-09-24** (human go received; packet-driven `run-coding-dispatch.sh --ticket=#n`, `scripts/lib/bug-dispatch.mjs` idempotency guard, plan-before-dispatch, attempt start/end rows, failure → `bugctl block --reason`, verifier separation, scratch fixture `src/utils/bugDispatchFlow.test.ts`, gate `assert-bug-dispatch` 49/0 (50/0 on VPS); bugctl reads never enter the offline queue; **live proof complete**: card #3 `new→packed→in_fix→verifying→done` with PR #101 + named_test verify by a non-author + exit-3 double-dispatch refusal; card #4 failure → `blocked_reason` + guard refusal; three hardening fixes from the proof — #98 stop/heartbeat zombie, #102/#103 journal drops); **V-30.5 NOT STARTED** and still requires its explicit human go. V-30.0 decisions all recorded (§6.1/§8). The executable handoff is §6.2.
**Drafted / last updated:** 2026-09-24
**Scope:** make one durable bug-ticket store the working memory for the Telegram (TG) agent
fleet, so a chat agent can never lose a bug between answers.
**Roadmap entry:** `plan/ROADMAP.md` → *Track V Phase 10* — `V-30.0` **DECIDED 2026-09-24**;
`V-30.1` **DONE 2026-09-24**; `V-30.2` **DONE 2026-09-24** (P9 + E2E closed);
`V-30.3` **DONE 2026-09-24** (human go received; live verdict posted on card #2);
`V-30.4` **DONE 2026-09-24** (human go received; gate `assert-bug-dispatch` 49/0; live proof: card #3 full lifecycle → `done`, card #4 → `blocked_reason`, stop/heartbeat + journal fixes #98/#102/#103);
`V-30.5` **NOT STARTED**, requiring its explicit human go.

**This is not a fifth pillar.** It sits beside `plan/BOT_ROLES.md` and
`docs/agents/telegram_work.md` and proposes a new **track** (see §6). It borrows the
existing laws (AGENTS.md, `docs/agent/JOURNEY.md`, `plan/QUALITY.md` §14) — it does not
replace them.

---

## R. Review guide — read this first

**What this document is:** a self-contained proposal to review and edit. Every claim carries a
`file:line` citation you can check (e.g. `sed -n '1085,1087p' serverBugSnapshot.ts`); the
local ground-truth file list is in §9.

**Files involved (the entire change set):**

| File | State | Editable during review? |
|---|---|---|
| `plan/BUG_TICKET_PIPELINE.md` (this file) | **new, tracked in HEAD** | ✅ yes — it *is* the proposal |
| `plan/ROADMAP.md` | Track V Phase 10 status + executable handoff pointer + decision mirror | ✅ yes |
| implementation files listed in §5.2 (`src/`, `scripts/`, `bots/`, tests) | **V-30.1–V-30.4 done; V-30.5 still open** | follow the phase gates; do not re-open completed rows |

**State of the tree (2026-09-24, updated after V-30.2 closure + V-30.3):** V-30.1 is merged and
V-30.2 is **closed**: `HERMES_BUG_TICKET_TOKEN` present on the host, one live E2E reply recorded
(session `20260924_162828_f191298f`, TG message ids 8/12/14/16, packed card #2) in
`AI_HANDOVER.md`, registry `enabled: true` + `username: "@Bug_ticket_bot"`, and the §6.2
audit follow-up (traceable fixture + packer-only boundary) landed with it. V-30.3 is
**closed too**: skill, runner, `repro --check`, and gate (`assert-bug-repro` 57/0) landed,
and the live run on card #2 posted `repro.status=failed` (exit 1 — the `7.700000000000001g`
artifact no longer reproduces; fixed by `00b8cb1` on 2026-09-22), deriving
`not_reproducible` with R2 keys `bugs/tag_mufs4t96_wj02x7/1790272128947-*` and
`svc-repro` → `done`. The `confirmed` (known-bad) path is gate-proven and awaits the
next genuinely-reproducing card. V-30.4 is done with a live VPS proof (card #3 → `done`,
card #4 → `blocked_reason`, gate `assert-bug-dispatch` 50/0 on VPS); V-30.5 has no implementation. Re-read §6.2
before starting any later phase; the dependency graph is intentional.

**Review order:**
1. §0 verdict (one screen) → §2 audit (evidence for every gap) → §3 prior art → §4 design →
   §5 change list → §6 rollout + **§6.1 decision sheet** → §7 risks → §10 (store options A–D
   walked end to end on one bug).
2. Check §8: **all decisions are made** (L1, L2 + P1–P10, 2026-09-24). Your review is to test
   the choices against §2's evidence and the rejected alternatives, not to fill blanks.
3. To **override** a direction: edit its `Decision` cell in **§6.1**, mirror the change into §8,
   and re-sync the roadmap status strings. The sheet is the canonical record.

**Historical review note (before implementation):** the proposal required an explicit human go
before each phase. V-30.1 and V-30.2 have since landed and closed (P9 + E2E recorded 2026-09-24);
V-30.3 received its human go and is code-done; V-30.4 received its human go and is done
(gate green + live VPS proof). V-30.5 still follows the same gate rule.
Do not treat this document's review as a new authorization for token creation or protected-doc edits.

**Do not, as part of a review:** edit protected docs (`AGENTS.md`, `docs/agent/**`,
`scripts/assert-*.mjs` — AGENTS.md §3 requires an explicit before→after), create the
`bug_ticket` profile or any token, touch `bots/registry.json`, or write `src/`/`scripts/` code.
Those are V-30.x work items, listed in §5.2.

**Decided (2026-09-24) — all twelve, with rationale in §8:**
- **L1 — QA is reused:** no new QA agent; one skill (`qa-reproduce`) + one card state on the
  existing per-surface profiles (§4.4).
- **L2 — the packer is a new Hermes profile `bug_ticket`** — one new bot, its own token, no
  dispatch powers (§4.4 bootstrap table → V-30.2).
- **P1–P10:** store, state vocabulary, auth, numbering, `not_reproducible` owner, repro depth,
  QA wake policy, backlog artifact, token creation, channel model — see the sheet in §6.1.

---

## 0. Verdict in one screen

You already have **two half-pipelines, not one**:

| | Pipeline A — product bug queue (web, `issue_tags`) | Pipeline B — TG QA/dispatch (V-28/V-29) |
|---|---|---|
| Store | D1 `issue_tags` + `issue_backlog` + `issue_tag_links` (`server_d1_schema.ts:78-107`) | chat scrollback + `~/.hermes/dispatch_audit.log` + `~/.hermes/logs/dispatch_*.log` + hand-written `bug-backlog.md` |
| Triage | fingerprint merge + pre-filled **Bug** field + `remaining[]` (QUALITY §14.1) | free-text `--task=` string + a screenshot path |
| Memory of attempts | `burns[]` / `tried[]`, `BURN_BUDGET = 2`, server-side reject of paper passes | none (audit row has tool+status+duration only) |
| Ready queue | `GET /api/bugs/next` (ready/in-progress, occurrences → severity → oldest) | none — the orchestrator is told a bug by a chat message |
| Evidence | portable pointers (job_id, debug_url, photo_urls, R2 keys) | host-absolute paths (`/home/ubuntu/...`) that are already dead in your Mac checkout |
| Verification | named vitest + `POST /attempts` (a chat claim cannot close a card) | `qa-runner.mjs` journey green (journey green ≠ this defect fixed) |
| Learning | `standing.json` + `specs/rejected/` + `specs/learnings/` | `~/.hermes/bot-failures.jsonl` + `review-failures.mjs` (lane failures, not bug hypotheses) |

**The amnesia symptom is structural, not model quality.** Bots have no shared
ticket store, no rules injection (`plan/BOT_ROLES.md:14`: gateway cwd is `~/.hermes`, so
repo `AGENTS.md` is *not* in TG turns), and tiny memories (`USER.md` 1,375 chars, `MEMORY.md` 2,200 chars, and the Orchestrator /
`qa_biomarker` / `qa_onboarding` memory directories are **empty** — `plan/BOT_ROLES.md:15-18`).
So a bug lives in a chat thread; a few answers later the thread is compacted and the bug
is gone.

**The fix is not a new tracker.** Pipeline A's card model is the right substrate — the
`work_item` JSON already is "what's left, what was tried, what is burned, what evidence".
The change is: **make the TG lane speak to that store, and add the one missing role — a
packer (bug ticket agent)** — between "someone noticed something" and "a coder is
dispatched". The "reproduce" step needs **no new bot**: it is a new *mode* for the existing QA
profiles (§4.4).

Your workflow, mapped:

```text
  you: "there's an X bug"
        │
        ▼
  [BUG TICKET AGENT]  packs ONE verifiable defect  ──► card #n (state: packed)
        │                         │
        │ unclear / can't grade   │ clear + gradable
        ▼                         ▼
  [QA AGENT]  reproduces        [ORCHESTRATOR]  plans (hypothesis + named gate)
        │  reproduced │ not_reproducible        │
        ▼             ▼                        ▼
   orchestrator   packed/needs-info      coder via run-coding-dispatch.sh
        │                                       │
        └──────────────► [VERIFY] named test green ──► done (human on human-check lines)
```

---

## 1. Requirements (R1–R8) + traceability

| # | Requirement | Today | Gap |
|---|---|---|---|
| R1 | A bug survives the chat (durable ticket) | A: yes. B: no | TG lane writes no card |
| R2 | A **bug ticket agent** I can just tell "there is X bug" | does not exist | no packer role, no pack gate |
| R3 | Unclear bug → **QA agent reproduces** it | does not exist as a step | `qa-runner.mjs` runs fixed journeys, not "this ticket" |
| R4 | Clear bug → **orchestrator** plans then fixes | partial (V-29 dispatch exists) | dispatch takes a task *string*; no plan artifact on the card |
| R5 | Never redo a burned hypothesis | A: yes. B: no | burns never reach the TG lane |
| R6 | Evidence addressable months later, from any host | A: yes (pointers). B: no | TG cites host-absolute paths |
| R7 | Close only on evidence (maker ≠ checker) | A: yes. B: journey-level only | the two layers don't meet |
| R8 | A defect that repeats leaves a sensor | repo: yes (`standing.json`, L17) | TG lane learns about *lanes*, not *bugs* |

---

## 2. Audit — how the existing bug-fixing pipeline actually works

### 2.1 Pipeline A — the product bug queue (this is already a good ticket system)

**Intake (three sources → one store, deliberately not four).** `plan/QUALITY.md:537-548`:

1. Manual **Snapbug** from the app → `POST /api/bugs/snapshot` (`serverBugSnapshot.ts:566`;
   body: category, tag_id/new_bug_title, symptom, shots, payload, logs, dom, a11y, network).
2. **Auto-file** on job finalize / golden reds → `POST /api/bugs/auto-file`
   (`serverBugSnapshot.ts:1131`) via `serverBugAutoFile.ts` (`classifyGoldenReds`,
   `shouldHoldR2`).
3. Golden reds / replay tape (`POST /api/bugs/:tagId/reanalyze`, `:1237`).

Merge rule: `class + canonical key + week` → one card (`#18 ×5`), `fingerprint()`
(`src/utils/bugWorkItem.ts:139`), `isoWeekKey():128`. `hold_refs` + `shouldHoldR2` stop R2
photos being pruned while a card holds them.

**Store.** D1 `issue_tags(id, title, title_key, category, status, comments,
resolution_note, whats_still_open, work_item, created_at, updated_at, resolved_at)`
(`server_d1_schema.ts:78-92`); evidence rows in `issue_backlog`
(with `payload.r2_prefix` / `r2_manifest_key` / `shot_count`); joins in
`issue_tag_links`. The **card body is `work_item` JSON** (`BugWorkItem`,
`bugWorkItem.ts:60-77`):

```text
public_n · bug · class · fingerprint · occurrences · queue
remaining[] · parked[] · done[] · checks[]
burns[]        (at, actor, hyp, file, test, result, burned, note, line)
commits[]      (snap | auto | agent | retest | note  + evidence + attempt)
current_evidence { job_id, report_id, debug_url, photo_urls[], r2_prefix,
                   browser_log, last_actions, error_status, hold, scout_url,
                   fixture_query, expected_dishes[], line_photos[] }
```

**Queue policy.** `queue: ready → in_progress → blocked (2 burns) | done`.
`BURN_BUDGET = 2` (`:9`). Ordering: `sortReadyQueue():281` = occurrences → `CLASS_SEVERITY`
(`:87`) → oldest. Pickers: `pickContinueTag():298` (in-progress with remaining first),
`pickNextOtherTag():329`, `pickQueueTag():343`.

**Agent contract (the anti-amnesia machinery that already exists):**

| Endpoint | Role |
|---|---|
| `GET /api/bugs/next` (`?mode=next`, `?n=11`) `serverBugSnapshot.ts:1082` | the job: NOW + remaining + tried + burns + `continue` |
| `GET /api/bugs/open` `:1038` | brief list for coding agents |
| `GET /api/bugs/:tagId` `:1363` | NOW + commits + report manifests |
| `GET /api/bugs/:tagId/artifacts` `:1548` | deep fetch (reportId/name) |
| `POST /api/bugs/:tagId/attempts` `:1417` | **required end of every agent loop** `{hyp,file,test,result,burned,note,line}` |
| `PATCH /api/bugs/:tagId` `:1464` | edit Bug field / class / remaining / unblock |
| `POST /api/bugs/:tagId/attach` `:1501` | auto-match failed → attach to #n |
| `GET /api/bugs/unmatched` `:1114`, `/triage-jobs` `:1028` | leftovers + triage job status |

`buildStartPayload()` (`:938`) returns `{say, tag_id, now, commits, how_to_end,
instruction, continue}`; `continue` (`buildContinueJob():798`) carries `active_line`,
`class_hint`, `file_hint`, `predicted_test`, `photo`, `comment`, tape ids,
`tried` (this line), `line_strikes`, `parked`, `keep_going`, `do_not[]` and
`DRAIN_CARD_INSTRUCTION` (`:487`). For an agent with no HTTP access, the same job is
pasted as prose via `formatContinuePrompt():880`.

**Two script gates that make "done" mean something** (Maker ≠ Checker, enforced in code,
not by an LLM):

- `rejectAttemptPass()` (`:424`) refuses a claimed pass with `weak_test` (a filename, not
  an `it()` sentence), `paint` (paint-pass language), `paint_fdc` (the test names this
  meal's FDC), `wrong_file` (file ≠ the line's file hint) → HTTP 409.
- `applyAttempt()` (`:490`) + `lineStrikeCount():467` → two strikes park the line; `burns`
  never collapse when `current_evidence` moves. `done` is set **only** by the server when
  the named test is green (`serverBugSnapshot.ts:1447-1450`), never by a chat claim.

**Who is told to work it.** `AGENTS.md` L15 (`:101-104`): triggers `work bug`,
`next bug`, `work 11` / `work #11`; detail in `plan/QUALITY.md` §14 (`:531-570`).

**Observability already specified:** typing pulse every 4 s, "Waiting For" rule, single
verifiable defect rule, structured failure diagnostics — `docs/agents/telegram_work.md`
§1/§2, `plan/BOT_ROLES.md` §6.

#### Audit findings on Pipeline A (real, small, worth fixing)

- **A-f1 — `/api/bugs/next` can miss cards.** The SQL pre-slices
  `ORDER BY created_at ASC LIMIT 100` (`serverBugSnapshot.ts:1085-1087`) *before*
  `pickQueueTag` applies occurrences → severity → oldest. Past 100 open cards, ordering
  and visibility are wrong. Fix: order/filter in SQL (or page the window).
- **A-f2 — no explicit `surface` field.** The UI has Home / Food / Health / Other packs
  (QUALITY §14.4 "Work items" item 1: split `snapSurface` home vs health) but the card
  carries only free-text `category`. The TG lane needs a surface to route to the right QA
  journey and the right bot topic.
- **A-f3 — no repro stage, no repro artifact.** Nothing records "we ran it; it
  reproduces / it doesn't". `qa-runner.mjs` runs a scripted journey; the *ticket* is not
  the unit under test. So "QA verifies" currently means "a journey that no longer crashes
  ran green" — which is how BUG-8449's real defect (`7.700000000000001g`) stayed open
  while a fix landed by another path (§2.4).
- **A-f4 — nothing writes to A from the TG lane.** Grep of `scripts/*` for `/api/bugs`
  finds only `golden-loop.mjs:22` — which mentions it to *refuse*. The TG pipeline never
  files or updates a card.
- **A-f5 — write endpoints appear unauthenticated.** `POST/PATCH /api/bugs/*` show no
  token guard in `serverBugSnapshot.ts`. Fine while only the app calls them; a
  prerequisite before TG bots (VPS / phone / Colab) call them from outside localhost.

### 2.2 Pipeline B — the TG QA → dispatch → deploy → re-verify lane (V-28 / V-29)

```text
[User / cron / QA bot]
  1. @Meal_journey_QA   node scripts/qa-runner.mjs --journey=meal
       -> screenshot to chat, "Single Verifiable Defect Rule" (1 defect per ticket)
       -> run-coding-dispatch.sh --task=<free text> --screenshot=<path>
  2. @Orchestrator      tool-allowance probe -> ONE tool (no silent cascade by default)
       -> heartbeat every 2m + typing pulse every 4s
  3. Coder (opencode | cline | grok | agy)  edits in a per-area worktree
  4. commit + push main -> webhook rebuild
  5. qa-runner re-runs the journey -> before/after screenshot -> "resolved"
```

(`docs/agents/telegram_work.md:53-84`, `:181-218`; `scripts/qa-auto-loop.mjs:1-80`.)

**Runtime inventory.** `bots/registry.json` — 11 entries, runtimes `bot-host`
(vm, vm2, opencode), `hermes` (default, qa_meal, qa_biomarker, qa_onboarding,
orchestrator, meal_audit — **all `enabled: false`**), `collab`, `device`
(android / mobile), `tg-provider-router`. Tokens: 3 layers, master
(`~/.config/bot-host/tokens.env`) → `scripts/sync-bot-tokens.mjs` → per-runtime env, one
poller per token (BOT-5) — `bots/TOKENS.md`.

**Dispatch = the OS harness, deliberately not the brain.** `scripts/run-coding-dispatch.sh`
(1,210 lines): per-bug lock JSON + advisory per-file claims (`scripts/lib/file-locks.mjs`),
detached `setsid` process, keyword-based thinking auto-tune (`:290-300`), workspace
snapshot + `new_changes()` diffing + rollback to clean HEAD, `tsc --noEmit`, commit/push,
webhook wait, then QA hand-back with **one** extra fix attempt (`:1150-1174`). Subcommands
`status` / `stop --bug-id` / `cancel` / `list-models` / `list-agents`. Outcome recorded by
`record_audit()` (`:543`) as
`{timestamp, bug_id, category, agent, model, tier, duration_seconds, status}` →
`~/.hermes/dispatch_audit.log`; exhaustion prints `escalated_human` (`:1199`).

**Capability + learning plumbing (extend, do not replace):**
`bots/capabilities.json` (19 capabilities; T1 chat / T2 service / T3 UI / T4 process /
T5 tool / T6 session; per-class matrix hermes | vps | mobile | grok_tg | collab),
`scripts/check-capability-propagation.mjs` (CI gate, `--strict`),
`scripts/add-capability.mjs` (scaffold), `scripts/lib/failure-log.mjs` →
`~/.hermes/bot-failures.jsonl`, `scripts/review-failures.mjs` (2nd identical signature
**must** become a sensor or standing row). Same ratchet as `AGENTS.md` L17, one layer down.

### 2.3 Durable memory that already exists on the repo side

`AGENTS.md` (laws + load map) · `docs/agent/JOURNEY.md` (Planner → Guard → **go** →
Builder → Guard → Reviewer; *Guard is a script, not a model*) · `docs/agent/standing.json`
+ `scripts/assert-standing.mjs` + `scripts/journey-guard.mjs` ·
`specs/active|done|learnings|rejected|checkpoints` · `scripts/journey-checkpoint.mjs`
(SHEPHERD `[revert]` / `[fork]`) · `scripts/discover-gated-work.mjs` (unattended work needs
a gate) · `docs/agent/DOMAIN_REGRESSION_MAP.md` (file → named tests) · `AI_HANDOVER.md`
(WIP board) · `plan/ROADMAP.md` (only execute file) ·
`.github/workflows/{ci,claim-guard,auto-pr,auto-merge}.yml` +
`docs/agent/GITHUB_WORKFLOW.md` + `scripts/lock.sh` (the open PR is the lock).
**Also `plan/AGENT_ALIGNMENT.md` (audited 2026-09-24):** the bot-side parity matrix — which
lanes have conversation history, a memory file, a soul, a skills bridge — plus its own P1–P5
rails (`bots/memory/<bot-id>.md`, `/remember`, unified failure log). Its row 6 records that
Hermes and the VPS keep **two failure logs that never meet**, which corroborates §2.5's
"learning: lane failures, not bug hypotheses". This proposal's §4.9 (memory rules) sits on those
rails rather than next to them.

**Lesson:** this repo already solved amnesia for *code work* with three moves — short
always-on rules, state on disk, script gates. The bug lane has the first one and half of
the second. This proposal finishes the third.

### 2.4 What the BUG-8449 incident proves (your own evidence chain)

From `bug-backlog.md` + `plan/BOT_ROLES.md:23`:

1. QA found 7 discrepancies on Home; **all 7 shipped as ONE ticket**
   (`bug-backlog.md:68-78`). Coders stalled: opencode out of funds, cline thought 8 min and
   produced no diff, grok hit its 10-minute wall, agy geo-blocked → `escalated_human`,
   1,249 s (`:59-62`, `:97-98`).
2. A narrowed second attempt also failed; a third died on `FAILED_PRECONDITION` (`:98`).
3. The **real** defect was one line — Omega-3 rendered `7.700000000000001g`
   (`plan/BOT_ROLES.md:23`) — fixed later via an unrelated PR path (`AI_HANDOVER.md`,
   "Nutrition Weekly Target Float Fix").
4. The record of all this is a **hand-compiled markdown file** pointing at
   `/home/ubuntu/...` paths, ending in "Remaining Work … not yet done"
   (`bug-backlog.md:151-155`). The lane that *did* fix it left no row on any card.

That is R2 + R3 + R5 + R6 failing at once. A packer would have made 7 atomic cards; a
reproducer would have priced them; the orchestrator would have picked the one with a gate;
and the card would have closed on a named test — with `escalated_human` becoming a
`blocked` card on a "needs human" list instead of a line in a log.

### 2.5 Gap analysis (capability × pipeline × what an agentic lane needs)

| Capability | A (web) | B (TG) | Needed | Verdict |
|---|---|---|---|---|
| Durable card for every defect | ✅ `issue_tags` | ❌ chat/log only | both write one store | **build bridge** |
| Atomic defect enforcement | partial (auto-file lines) | ❌ prose rule only | schema-gated pack step | **build** |
| Duplicate suppression | ✅ fingerprint + occurrences | ❌ | TG intake must fingerprint | **build** |
| Repro as a first-class artifact | ❌ | ❌ | QA-owned repro block | **build** |
| Plan as an artifact on the card | ❌ (lives in dispatch log) | ❌ | orchestrator plan block | **build** |
| Attempt ledger + burn budget | ✅ `attempts`, 2-burn park | ❌ | dispatch writes attempts | **bridge** |
| Portable evidence pointers | ✅ job/R2 keys | ❌ host paths | R2 prefix per card | **bridge** |
| Ready queue for an agent | ✅ `/api/bugs/next` | ❌ (chat-driven) | queue by assignee/state | **build** |
| Verify gate (maker ≠ checker) | ✅ named test + 409s | journey only | ticket-scoped verify | **bridge** |
| Escalation queue | ~ status `blocked` in DB, no list | ❌ log line | "needs human" list view | **build** |
| Learning / sensor per bug | ✅ standing + learnings | lane failures only | ticket → learnings row | **extend** |

---

## 3. What the field has already learned (copy / skip)

| Source | The idea worth taking | What to skip |
|---|---|---|
| **Beads** (`bd`, gastownhall) — git-native tracker built for coding agents | Structured store + **dependency graph** and a computed **ready queue** (`bd ready`, `--explain` shows `blocked_by`) so an agent never picks blocked work; hash IDs to avoid collisions between agents/branches; `--json` on every command; sync via git refs (`refs/dolt/data`), not a hosted service; instructions for agents live in `AGENTS.md` | A second datastore. We already have D1 + a ready picker; add *edges* (`blocked_by`, `duplicate_of`) as fields, not a new DB |
| **Better Stack — "Beads" write-up** | Names the failure precisely: a `TASKS.md`/markdown plan costs context to read, goes stale, and cannot answer "what is ready / what did we try" — *finite memory needs queryable state* | Treating the ticket file as the agent's whole memory |
| **GitHub Agentic Workflows — Issue Triage** (`gh-aw`) | Event trigger + **narrow tool permissions** + **`safe-outputs` allow-lists** (only these labels, only these comments) + an integrity filter so untrusted text can't steer the agent; the workflow markdown **is** the prompt | GitHub-hosted runners/labels (we have our own store); keep the *allow-list* idea for states/labels |
| **CoreStory — Agentic Bug Resolution** (6 phases) | Explicit **Reproduce/Test-first** phase: write the *failing check* before reading implementation; hypothesis + ranked root causes; "the reproduction passes ⇒ already fixed, wrong steps, or wrong test"; ticketing **MCP** so the agent fetches and posts to the ticket; the ticket carries the investigation record | A vendor MCP; our equivalent is `bugctl` + `/api/bugs/*` |
| **Learn Cursor — bug triage agent** | `AgentJob { task, context[], allowedTools[], checks[], handoff: diff \| comment \| pull_request }`; *handoff is the trust decision, never merge*; **never claim "reproduced" unless it actually ran**; "fix the intake before blaming the model" | Broad tool grants; auto-merge as a first step |
| **Our own `docs/agent/JOURNEY.md`** | Harness = Model + Harness; **Maker ≠ Checker**; **the Ratchet** (every bug leaves a sensor + a standing row); Guard is a *script*; SHEPHERD `[revert]`/`[fork]` on a dirty failure | LangGraph-style rewrites, agent swarms |

**Synthesis (the design rule):** the ticket is the *only* working memory; the chat is a
transport; every state move is done by a **script-checkable gate**, not by an agent's
opinion — which is exactly how `journey-guard.mjs` already protects code.

---

## 4. Design

### 4.1 One store, two front doors

```text
  Telegram bots (QA / bug ticket / orchestrator)   Web app Snapbug
                │                                        │
                └────────────►  bugctl.mjs  ◄────────────┘
                     (thin CLI + JSON, offline queue)
                                │
                                ▼
              /api/bugs/*  (existing routes + state/repro/plan)
                                │
                    ┌───────────┴────────────┐
                    ▼                        ▼
        D1 issue_tags.work_item        issue_backlog rows
        (the card = the memory)        (evidence pointers)
                    │                        │
                    └──────► R2  (photos, run logs, debug payloads)
```

**Three laws** (proposed for `AGENTS.md` L15, a protected doc → needs your before→after):

1. **If it is not on a card, it does not exist.** A defect mentioned only in chat is not
   in the system. The packer's first act is to create or match a card.
2. **Chat may never be the only place a decision lives.** Every decision becomes a
   `commits[]` row with `actor` + artifact reference.
3. **A state is never declared — it is derived.** An agent posts an *artifact* (`defect`,
   `repro`, `plan`, an attempt, `verify`) and the server projects the state from it (§4.3.4).
   Prose in chat cannot move a card; only the artifact can.

*Decided (P1): **A + D** — D1 `issue_tags` as the only store, plus the git journal; C is the
documented escape hatch; B is rejected (§10).*

### 4.2 Ticket schema v2 (extend `work_item`; no new store)

Additions to `BugWorkItem` (`src/utils/bugWorkItem.ts:60`) — all optional, so old cards
hydrate unchanged:

| Field | Shape | Why |
|---|---|---|
| `surface` | `food \| home \| health \| other` | routes to the right QA journey + TG topic (A-f2) |
| `source` | `web_snap \| tg_qa \| auto_file \| golden_red \| human` | provenance + who to reply to |
| `idem_key` | `fingerprint(class, key, isoWeek) + surface` | TG-side dedupe (A: has `fingerprint`; reuse `:139`) |
| `defect` | `{component, observed, expected, criteria}` | the packed atomic defect — the Single Verifiable Defect Rule as **data**, not prose |
| `repro` | `{status: not_needed \| needed \| confirmed \| failed \| ambiguous, command, params, run_log, before, after, expected, actual, exit_code, by, at}` | R3 |
| `plan` | `{hypothesis, files[], approach, gates[], risks[], blocked_by[], by, at}` | R4 (today only in a 162 KB dispatch log) |
| `verify` | `{method: named_test \| journey \| manual, command, result, evidence[], by, at}` | R7 |
| `assignee` | `bug_ticket \| qa_meal \| qa_biomarker \| qa_onboarding \| orchestrator \| human` | ready-queue per bot |
| `reply_to` | `{chat_id, thread_id, profile}` | answers land in the thread that filed it |
| `blocked_by[]` / `duplicate_of` | tag ids | dependency edges (Beads' best idea, no new DB) |

Existing fields stay authoritative: `remaining[]` (unfixed checks), `burns[]`,
`commits[]`, `current_evidence`, `checks[]`, `hold_refs`, `occurrences`, `class`,
`public_n`.

**DB:** no migration needed for the fields above — they live inside `work_item` JSON. One
small migration is proposed for **indexing only**: `issue_tags.surface`, plus optionally an
indexed copy of the *projected* state (§4.3.4) so SQL can filter and order on it. `status`
keeps writing the legacy-compatible values (`to_fix` for anything unfinished, `fixed` for
`done`) so the web UI and `/api/bugs/next` keep working unchanged — note it does **not** carry
`blocked` today; that lives only in `queue` (§4.3.1).

### 4.3 Lifecycle, states and gates

#### 4.3.1 What exists today — three vocabularies (do not add a fourth)

| Layer | Values | Source |
|---|---|---|
| DB `issue_tags.status` | `to_fix` (intake / reopen), `in_progress`, `fixed` (with `resolved_at`), schema default `open`, `ignored` accepted on read | `serverBugSnapshot.ts:612,1443,1446,1490,1492,1536` · `serverIssueBacklog.ts:318-365,697,765` · `server_d1_schema.ts:78-92` |
| `work_item.queue` — the **operative** state | `ready \| in_progress \| blocked \| done` | `bugWorkItem.ts:11` |
| Derived on read | `fixed\|ignored → done`, else stored `queue`, else `in_progress`, else `ready` | `mapLegacyStatus()`, `bugWorkItem.ts:189-194` |
| UI filters (a third projection) | `active \| all \| pending_review \| ready \| unactioned \| stuck \| done` | `BugTrackerModal.tsx:91` |

Two facts that decide the design: **`blocked` is never written to the DB** (it lives only in
`queue`), and `PATCH` accepts `queue ∈ [ready,in_progress,blocked,done]` while writing back only
`fixed` or `to_fix` (`serverBugSnapshot.ts:1473-1492`). So `status` is already a coarse
projection of `queue` — not an independent truth.

#### 4.3.2 The choice: declared states vs derived states

| Option | What it means | Cost | Verdict |
|---|---|---|---|
| **S-A** — declared, 11 states (as first drafted) | a new `state` field the roles set via a transition endpoint | a **fourth** vocabulary plus a new authority (`assertTransition`) that can disagree with `mapLegacyStatus` | rejected |
| **S-B** — declared but lean (6) | `new/packed/reproduced/in_fix/verifying/done` + flags | still a fourth vocabulary, just smaller | rejected |
| **S-C** — **derived projection** *(chosen — in lean form, §4.3.5)* | roles never set a state; they post **artifacts** (`defect`, `repro`, `plan`, attempts, `verify`); one pure function projects the state server-side and denormalizes it into `status` | one new pure module + unit test; `mapLegacyStatus` is extended, not replaced | **chosen (P2)** |
| **S-D** — existing vocabulary only | keep `ready/in_progress/blocked/done`; store repro/plan/verify as inert data | zero migration, but the queue cannot tell "QA's turn" from "orchestrator's turn" | rejected (fails the R3/R4 routing) |

**Why derived wins:** an agent cannot *declare* a state, so illegal states are impossible by
construction — the same philosophy as *Guard is a script, not a model* (`docs/agent/JOURNEY.md`).
And it gives you **one** projection to serve both the TG queue and the modal's filters, instead
of three tables drifting apart.

#### 4.3.3 The vocabulary — each state is reachable only by posting its artifact

| State | Reached when (artifact) | Posted by | Next |
|---|---|---|---|
| `new` | nothing yet — the raw report only (`defect` absent) | any intake (web snap / TG QA / auto-file / human) | packer |
| `packed` | `defect{component,observed,expected,criteria}` + `class` + `surface` + `fingerprint`; exactly one defect; no duplicate | bug ticket agent | QA or orchestrator per `assignee` |
| `needs_repro` | `defect` present **and** `repro.status = "needed"` (with a command/steps stub) | bug ticket agent | QA agent |
| `reproduced` | `repro.status = "confirmed"` + `command` + `exit_code ≠ 0` + `run_log` + `before` key | QA agent | orchestrator |
| `not_reproducible` | `repro.status ∈ {failed, ambiguous}` + `run_log` | QA agent | packer (close or `blocked_reason=needs_info`) |
| `planned` | `plan{hypothesis, files[], gates[]}` present, no open attempt | orchestrator | coder via dispatch |
| `in_fix` | an open attempt row `{tool, model, worktree, started_at}` | orchestrator / dispatch | verifier |
| `verifying` | an attempt marked *applied* (fix committed + deployed) with no `verify` yet | orchestrator | verifier |
| `done` | `verify{result:"green", command, evidence[]}` — the named gate, never a chat claim | verifier | — |
| `blocked` | 2 burns on the active line **or** `blocked_reason` (access / quota / creds / human call) | any (automatic at 2 burns) | human `Unblock` |
| `duplicate` | `duplicate_of` + link rows + `occurrences++` | packer / intake | — |

#### 4.3.4 The projection — one function, one place

`bugState(item)` in `src/utils/bugTicketState.ts` runs **server-side on every write** and is
denormalized so SQL filtering/ordering keeps working. Precedence, highest first:

```text
done              verify.result === 'green'
blocked           burns(active line) >= BURN_BUDGET  ||  blocked_reason
duplicate         duplicate_of
verifying         lastAttempt.applied && !verify
in_fix            openAttempt
planned           plan
reproduced        repro.status === 'confirmed'
not_reproducible  repro.status ∈ {failed, ambiguous}
needs_repro       defect && repro.status === 'needed'
packed            defect
new               (otherwise)
```

Rules that come with it:

- **`assignee` carries routing; the state carries progress.** *Who works the card next* is
  `assignee`, so the ready queue can hand work to a bot without a state for every handoff.
- **Widening, not replacing:** `mapLegacyStatus()` stays and becomes the *input* to the
  projection (`queue=ready` → `new`/`packed`; `in_progress` → `in_fix`; `blocked` flag →
  `blocked`; `done`/`fixed` → `done`), so every existing card shows the state it shows today and
  no data migration is required.
- **Old readers keep working:** keep writing the legacy-compatible `status` values (`to_fix` for
  anything unfinished, `fixed` for `done`) and put the projected state in `work_item.state` plus
  (optionally) an indexed column — the projection is identical either way. Decide at
  implementation; the design does not depend on it.
- **The modal's 7 filters are derived from the same projection** (one mapping table), so this
  *removes* the third vocabulary instead of adding a fourth.

#### 4.3.5 Lean variant (S-C-lite) — the chosen vocabulary (P2)

Because `assignee` carries routing, `needs_repro` and `planned` are *reporting* states rather than
routing ones. Collapse them:

`new → packed → in_fix → verifying → done`, plus flags `needs_repro` (assignee = QA),
`not_reproducible`, `blocked_reason`, `duplicate_of`.

Same bookkeeping, fewer names to teach an agent, identical TG messages ("Packed #21 → QA's
turn"). Cost: `bugctl queue --assignee=qa_meal` filters on a flag rather than a state.

Human-only actions (unchanged from today): park a line, split a line to a sibling card, unblock,
decide a severity dispute, promote to a golden fixture.

### 4.4 Roles and agent contracts (one new bot, three existing ones reused)

**Roles inventory — exactly one new bot is proposed:**

| Role | Owner today | Change | New token? |
|---|---|---|---|
| Intake / pack (triage, dedupe, single-defect, store owner) | *nobody* | **new profile `bug_ticket`** (decided 2026-09-24) | yes (1) |
| Reproduce | `qa_meal` (live) + `qa_biomarker` / `qa_onboarding` (asleep) | **skill + state only** | no |
| Plan + dispatch | `orchestrator` | `--ticket=` instead of `--task=` + a plan block on the card | no |
| Fix | `run-coding-dispatch.sh` coders | attempt rows, `blocked` on failure | no |
| Verify | the same QA profiles, on a card they did not fix | "didn't author it" rule + the named gate | no |
| Human | you | generated "needs human" list | no |

Zero-new-bots alternative: fold the packer into the collab bot or the orchestrator — rejected
(§8 item 4): intake must not own dispatch, and a human-reported Home/Health bug should not have
to arrive in a QA bot's chat.

**1. Bug Ticket Agent — the packer** (new; Hermes profile `bug_ticket`, TG handle e.g.
`@Bug_ticket_bot`)

- Triggers: `bug <free text>`, a photo/screenshot with a caption, `/newbug`, `/ticket <n>`,
  or an inbound ticket from any QA bot.
- Reads: `bugctl queue --state=new --json` and the returned packet/defect fingerprints; there is no
  `bugctl find` command in the V-30.1/V-30.2 CLI. Add a real `find` command only if the handoff
  needs a separate query; otherwise the packer filters the queue result by fingerprint.
- Must produce **one** of: `packed` (single defect), `needs_repro` (unclear), or
  `duplicate` (merged). Never all three; never a bundled card.
- Forbidden: editing `src/`, running coders, `done`, bundling >1 discrepancy
  (BUG-8449 is the fixture for this rule).
- Gate: `bugctl pack --check` — schema + single-defect + criteria + fingerprint.
- Reply contract: `✅ Packed *Home / Omega-3* → #21 (needs_repro @qa_meal). Evidence: <R2 key>`
  then `⏳ Waiting for @qa_meal to reproduce...` (per `docs/agents/telegram_work.md` §2).

**Bootstrap shape (decided 2026-09-24 — new Hermes profile, no reuse):**

| Step | Detail |
|---|---|
| Token | BotFather → add `HERMES_BUG_TICKET_TOKEN=<token>` to the master `~/.config/bot-host/tokens.env` → `node scripts/sync-bot-tokens.mjs --check` then without `--check` (`bots/TOKENS.md`) |
| Registry | new entry `hermes_bug_ticket`, `runtime: "hermes"`, `telegram.tokenEnv` as above, `allowedUserIds: [6218257274]`, `hermes: { profile: "bug_ticket", username: "@<handle>" }`, `agent: { kind: "hermes" }`, start `enabled: false` until one E2E reply is proven |
| Profile | `~/.hermes/profiles/bug_ticket/` — short soul (the three laws + this role), `USER.md` synced, `MEMORY.md` ≤2,200 chars holding only: tickets live in `issue_tags`, use `bugctl`, the three laws. **Code landed; the live host still needs the P9 token in its `.env`.** |
| Skills | `scripts/skills/common/bug-ticket/SKILL.md` (synced by `sync-hermes-skills.sh`) + `telegram-photo`, `telegram-copy-code`, `telegram-tables` for replies. **Do not** link `orchestrator-dispatcher` (the sync filter covers `qa_*`, `meal_audit`, and `bug_ticket`) so intake cannot dispatch. |
| Packs | V-30.2 already added `svc-bug-ticket` (T2), `proc-ticket-state` (T4), and `sess-ticket-resume` (T6). V-30.5 must add `svc-repro`, update statuses only with proof, and run `check-capability-propagation.mjs --strict`; strict mode must not be called green while any of these rows is `open`/`partial`. |

**2. QA reproduce — a new *mode* for the existing QA profiles (no new QA bot)**

Reuse, do not create. Registry facts (`bots/registry.json`, `plan/BOT_ROLES.md:16-20`):
`qa_meal` (@Meal_journey_QA_bot) is the only QA profile with a token and a memory file;
`qa_biomarker` and `qa_onboarding` are registered but **tokenless and asleep** ("Do not wake
them"), with empty memory dirs and the wrong skills preloaded. All three are
`enabled: false` in the registry.

Surface → owner, and what each actually needs:

| Surface | Owner | Already has (`scripts/skills/common/`) | Add |
|---|---|---|---|
| meal + home | `qa_meal` | `qa-meal-journey`, `qa-telegram-journey`, `telegram-testing`, `browser-screenshot`, `telegram-photo` | `qa-reproduce` skill + the `needs_repro` state |
| health | `qa_biomarker` (asleep) | preloads the meal skills — wrong for its surface | wake on the first Health repro need; give it `qa-reproduce` |
| onboarding / profile | `qa_onboarding` (asleep) | same | same, only when needed |

Evidence that `qa_meal` already covers the Home surface: BUG-8449 was a Home-dashboard
report whose reference capture lives in `~/.hermes/profiles/qa_meal/cache/images/`
(`bug-backlog.md:83-84`).

So the deliverable for this role is: **one skill** (`scripts/skills/common/qa-reproduce/`,
symlinked by `scripts/sync-hermes-skills.sh`), a state the existing profile can pick up, and
one write path. **No new token, no new daemon, no new soul.**

- Trigger: a card in `needs_repro` assigned to its surface (or an explicit
  `repro #21`).
- Must produce: `repro` block — exact command/steps, params, expected vs actual, run log,
  before (+ after when fixed) artifact keys, `exit_code`, verdict
  (`confirmed` / `failed` / `ambiguous`).
- Forbidden: fixing anything, dispatching a coder, filing a second card, or claiming a
  verdict without a run (Learn Cursor's rule). "It looks fine in code" is not
  `not_reproducible`.
- Gate: `bugctl repro --check` — verdict + command + artifact keys present.
- Note: journey-green ≠ this defect fixed. The repro must target the card's `criteria`.

**3. Orchestrator** (`orchestrator`)

- Trigger: `packed` with `repro.needed=false`, or `reproduced`.
- Must produce: `plan` block (hypothesis, files, **named gate commands** from
  `docs/agent/DOMAIN_REGRESSION_MAP.md`), then dispatch
  `run-coding-dispatch.sh --ticket=#21` (per-card, not free text), then verify + close.
- Forbidden: editing code itself; calling `done` without the named gate; retrying a line in
  `burns[]`; letting a coder cascade silently (`--cascade` stays opt-in).
- Gate: `run-coding-dispatch.sh` writes attempt rows and refuses to start when the card is
  `blocked` or `done`.

**4. Verifier.** The QA profile can verify **only** cards it did not fix; the coder and
orchestrator can never verify their own fix. Where the surface has a journey, run it *and*
the ticket gate; where it does not (Home visual), the verify artifact is a fresh capture +
the named vitest that covers the calculation.

**5. Human.** Unblock, park, split, promote, severity disputes — surfaced as a pinned
"🧍 Needs human" list generated from `bugctl queue --state=blocked`.

**Unchanged roles:** `run-coding-dispatch.sh` stays the OS harness (detach, locks,
heartbeat, rollback, commit/push, deploy wait); `review-failures.mjs` stays the lane
ratchet, now fed by ticket attempt rows too.

### 4.5 The handoff packet — the ticket *is* the prompt

Every handoff (packer → QA, packer → orchestrator, orchestrator → coder, → verifier) sends
this JSON **and** a one-line instruction. Never the chat history, never a free-text task.

```json
{
  "ticket": "#21",
  "state": "needs_repro",
  "surface": "home",
  "defect": {
    "component": "HomeTab / WeeklyNutritionCard",
    "observed": "Omega-3 weekly shows 7.700000000000001g",
    "expected": "7.7g",
    "criteria": "WeeklyNutritionCard renders omega-3 rounded to 1dp => text is exactly '7.7g'"
  },
  "class": "CLONE_UI",
  "fingerprint": "CLONE_UI:omega3_weekly:2026-W39",
  "occurrences": 3,
  "evidence": { "job_id": null, "photo_urls": ["bugs/tag_x/…-before.png"], "debug_url": null },
  "repro": { "status": "needed" },
  "tried": ["rounded weeklyTarget in HomeTab.tsx → still 7.700000000000001 (burned)"],
  "do_not": ["POST /loop", "edit expected.json", "retry anything in tried"],
  "gates": ["npx vitest run src/utils/nutritionTargetStatus.test.ts"],
  "instruction": "<state-specific paragraph, mirroring DRAIN_CARD_INSTRUCTION>",
  "reply_to": { "chat_id": -100…, "thread_id": 21, "profile": "bug_ticket" }
}
```

Implementation: extend `buildStartPayload` (`bugWorkItem.ts:938`) so `now` carries the new
blocks and `continue.instruction` becomes state-specific. Keep
`formatContinuePrompt()` (`:880`) as the text rendering for hosts with no HTTP. This is the
concrete fix for amnesia: the receiving agent needs **one** GET (or one paste) to be fully
briefed, regardless of its session age.

*Corroboration:* `plan/AGENT_ALIGNMENT.md` §4 cites "handoff as entry contract" (ESAA) — goal +
state + files-to-read-first, sized ~1,500/4,000/20,000 chars. The ticket packet is that
contract, with the durable store behind it instead of a conversation summary, so raw reasoning
traces are never replayed (its "selective > full history" finding).

### 4.6 Evidence contract (portable, deterministic)

- Every artifact goes to R2 under `bugs/<tag_id>/<ts>-<kind>.<ext>` and is referenced **by
  key only**. Reuse the existing `issue_backlog.payload.r2_prefix` / `r2_manifest_key` /
  `shot_count` convention (already written by `POST /api/bugs/snapshot`).
- Repro bundle (minimum): `repro.txt` (exact command + env + params), `run.log`,
  `before.png`, `expected.md`, `result.json {verdict, exit_code}`.
- Verify bundle: `after.png` + the named-gate output (paste into `commits[]`).
- Rule: a host-absolute path is never evidence. `bug-backlog.md`'s `/home/ubuntu/...`
  references are the counter-example (dead the moment the repo is read elsewhere).

### 4.7 Dedupe and idempotency on the TG path

- `idem_key = fingerprint(class, canonical_key, isoWeek) + surface`; TG intake must check
  it before creating a card. Hit → `duplicate_of` + `occurrences++` + reply
  "already `#18 ×5`".
- Dispatch idempotency: `--ticket=#21` plus the card's `in_fix` state means a second
  orchestrator cannot double-dispatch the same card; the existing per-bug lock JSON
  (`~/.hermes/dispatch_locks/<BUG_ID>.json`) does the process-level part.
- `BUG-ID` becomes the **public** `#n` so chat, audit log, worktree, and card all agree on
  one key (today `BUG-20260921-8449` exists only in chat/logs).

### 4.8 Attempt-ledger parity (the burn budget reaches Telegram)

`run-coding-dispatch.sh` gains two writes:

1. on start: `POST /api/bugs/<id>/attempts {actor, result:"running", hyp, file, test}`
   (recorded as an open attempt, not a burn);
2. on end: `{result, burned, file, test, note, line}` — the same shape the web lane already
   uses, so `rejected` reasons (`weak_test` / `paint` / `paint_fdc` / `wrong_file`, 409) and
   the 2-burn park apply verbatim.

Offline fallback: append to `~/.hermes/bot-attempts.jsonl` (same discipline as
`scripts/lib/failure-log.mjs`) and let the packer replay it. `escalated_human` becomes
`state=blocked` + `blocked_reason`, not just an audit line.

### 4.9 Memory rules for chat agents (the anti-amnesia contract)

- **Chat holds at most three things:** the card it is working (`#21` + packet JSON), the
  one-line instruction, and the raw output of the gate it just ran. Everything else must be
  re-derivable → `/new` is safe at any moment.
- **Skills hold procedure, cards hold state.** Keep souls/skills short
  (`plan/BOT_ROLES.md:9`); never put ticket state into `MEMORY.md`.
- **Boot sequence for every bot:** `bugctl queue --assignee=<bot>` — not `MEMORY.md`. The
  only facts worth keeping in memory (≤2,200 chars) are: tickets live in `issue_tags`,
  read/write them with `bugctl`, plus the three laws.
- **`/resume`** prints the current card's packet JSON; per-chat sessions already exist in
  `bot-host` (`sessions.json`), so this is a small addition.
- **The gateway cwd problem stays visible:** `plan/BOT_ROLES.md:14` records that `AGENTS.md`
  is *not* injected into TG turns. So the pack / QA / orchestrator **procedures** must live
  in the skills (`scripts/skills/common/`, synced by `scripts/sync-hermes-skills.sh`), and
  the three laws must be inside each soul's short text.

### 4.10 Acceptance test (the gate that proves amnesia is gone)

`node scripts/assert-bug-ticket-continuity.mjs` — a **clean shell, no chat history**, one
fixture card; it must answer from disk/API alone:

1. What am I working on? (`#21` + defect)
2. What has already been tried and burned?
3. What is the exact next command?
4. Where is the evidence?
5. What closes this ticket?
6. Who is waiting on whom?

If any answer needs a chat log, the phase fails. This is the bug-lane equivalent of
`journey-guard.mjs` and it belongs in CI beside `npm run lint`.

**Current implementation gap:** the V-30.1 `assert-bug-ticket-continuity.mjs` proves route shape,
derived states, and a projection walk, but it does **not** yet answer all six questions for a
real BUG-8449 record. V-30.5 must extend that gate or add a separate retro-audit gate before
claiming §4.10 is satisfied.

### 4.11 Channel model (kills "which bot do I ask?")

One TG ticket room, topics per surface (home / food / health), per-agent `reply_to`:

```text
you            -> @Bug_ticket_bot   "home: omega-3 shows 7.700000000000001g"
bug_ticket     -> #21 packed, needs_repro -> topic 21, pings @Meal_journey_QA
qa (progress)  -> "⏳ Running meal journey… (12s)"            (typing pulse per V-28)
qa (verdict)   -> reproduced + artifact keys -> pings @Orchestrator
orchestrator   -> plan + dispatch + deploy wait + verify (status lines every 2m)
verify         -> "✅ #21 done — gate <command> green"  |  ❌ + blocked card
human          -> pinned list from `bugctl queue --state=blocked`
```

---

## 5. What changes in the existing pipeline (implementation ledger)

### 5.1 Keep as-is (do not rebuild)

`issue_tags` / `issue_backlog` / `issue_tag_links` and the `work_item` model · the
`/api/bugs/*` endpoints · `BURN_BUDGET` + `rejectAttemptPass` + `applyAttempt` ·
fingerprint / occurrences / `isoWeekKey` · `qa-runner.mjs` journey mode · the OS-harness
duties of `run-coding-dispatch.sh` (detach, per-bug lock, file claims, heartbeat, typing
pulse, rollback, commit/push, webhook wait) · `bots/capabilities.json` + propagation
checker · `failure-log.mjs` + `review-failures.mjs` · `standing.json` /
`specs/rejected/` / `journey-guard.mjs` / `journey-checkpoint.mjs` /
`discover-gated-work.mjs` · `docs/agent/DOMAIN_REGRESSION_MAP.md` · the GitHub PR gates
(`ci`, `claim-guard`) · `bots/TOKENS.md` token flow.

### 5.2 Extend (file → change)

| File | Change |
|---|---|
| `src/utils/bugWorkItem.ts` | add `surface`, `source`, `idem_key`, `defect`, `repro`, `plan`, `verify`, `assignee`, `reply_to`, `blocked_by`, `duplicate_of`; per-state `instruction`; extend `buildStartPayload` / `formatContinuePrompt`. New module `src/utils/bugTicketState.ts` (the `bugState()` projection, §4.3.4) + `src/utils/bugTicketState.test.ts`; **extend** `mapLegacyStatus()` rather than replacing it |
| `serverBugSnapshot.ts` | artifact endpoints `POST /api/bugs/:tagId/{defect,repro,plan,verify}` (each validated, then `bugState()` projected and persisted — there is **no agent-settable state route**), `GET /api/bugs/queue?state=&assignee=&surface=` (ready queue + `blocked_by`), `GET /api/bugs/:tagId/packet` (`?format=text`); fix **A-f1** ordering; add the token guard (**A-f5**). **Packer-only boundary (§6.2 audit follow-up, documented + tested):** `validateDefect()` enforces the required fields only; the single-defect/fingerprint rules live solely at `bugctl pack --check` (`scripts/lib/bug-pack.mjs`) and are proven against the committed fixture by `assert-bug-pack.mjs` — the server does **not** duplicate `looksBundled`/`splitMultiItemReport` (asserted by that gate). |
| `scripts/bugctl.mjs` | **V-30.1/V-30.2/V-30.3 landed; V-30.4 landed.** Thin HTTP client + offline JSONL queue: `next, list, show, packet, pack, repro, plan, claim, attempt, state, evidence, duplicate, unblock, queue` — `--json` everywhere. `pack --check` (V-30.2) and `repro --check` (V-30.3) validate the `validateRepro` vocabulary/artifacts and run **before** every POST. V-30.4: a packet **read** never enters the offline queue (`WRITE_OPS`-gated `withFallback` — a queued read can never be replayed and would keep `flush` red forever); `case 'packet'` calls `api()` directly and exits non-OK loud. Writes (`plan/attempt/block/...`) still queue offline. V-30.5 must add `/resume` only if it is a Telegram command, not a second state store. |
| `scripts/run-coding-dispatch.sh` | **V-30.4 landed:** `--ticket=#n` packet-driven dispatch (legacy `--task=` unchanged). Ticket mode: live `bugctl packet` read (fail-fast exit 2 offline), `bug-dispatch.mjs` idempotency guard **before detach** (refuses `in_fix`/`verifying`/`done`/blocked/not-repro/duplicate/no-defect → exit 3), plan artifact posted **before detach** (spec `allowed_files`/`gate`, else the defect component's real file), attempt `start` row post-lock (→ `in_fix`), attempt `committed` + `applied=true` on push (→ `verifying`), failure paths end in attempt `failed:` + `bugctl block --reason` (cascade, single-tool, and abort-trap), `--burned=false` on every bookkeeping row, prompt carries packet + repro + plan + locked spec + verification contract (author ≠ verifier; dispatcher never posts verify), pushes `agent/dispatch-*` never main. |
| `scripts/lib/bug-dispatch.mjs` | **V-30.4 new (pure, no HTTP):** `dispatchGuard` (idempotency + same-run lock exception), `categoryFor` (surface → category), `specPathFor`/`parseSpec` (locked spec frontmatter), `planFromPacket` (hypothesis/files/gates, default named gate), CLI `guard\|category\|spec-path\|plan-args` for the dispatcher. |
| `scripts/assert-bug-dispatch.mjs` + `src/utils/bugDispatchFlow.test.ts` | **V-30.4 new named gate:** wiring/contract asserts (49 checks) + the committed scratch fixture proving `packed → in_fix → verifying → done`, failed dispatch keeps `blocked_reason`, and double-dispatch refusal — no production card is the test fixture. |
| `scripts/qa-runner.mjs` | **V-30.3 landed:** `--ticket=<#n>` loads the packet via `bugctl packet`, runs the card's command (exit 0 = reproduced → `confirmed`, non-zero → `failed`), captures `before.png`, uploads the §4.6 bundle as R2 keys (`repro.txt`, `run.log`, `before.png`, `expected.md`, `result.json` under `bugs/<tag_id>/<ts>-<kind>.<ext>`), and writes the verdict through `bugctl repro` (no R2 creds → exit 3, verdict withheld — a host path is not evidence). Journey mode unchanged. |
| `scripts/bug-backlog.mjs` | **V-30.5 open:** generate `bug-backlog.md` from the store; do not delete the current hand-compiled file until the generator reproduces the BUG-8449 fixture and its source evidence is preserved. |
| `bots/registry.json` | **V-30.2 landed + closed 2026-09-24:** `hermes_bug_ticket` with `enabled: true`, `HERMES_BUG_TICKET_TOKEN`, `hermes.profile=bug_ticket`, and `hermes.username="@Bug_ticket_bot"` (filled after one E2E reply per §6.2 runbook). |
| `bots/capabilities.json` | **V-30.2 landed** `svc-bug-ticket` (now `done`, E2E proven), `proc-ticket-state`, `sess-ticket-resume`; **V-30.3 landed** `svc-repro` (**`done`** — gate 57/0 + live verdict on card #2 with real R2 keys); V-30.5 updates statuses from proof and runs `check-capability-propagation.mjs --strict` in CI. Do not duplicate the existing rows. |
| `scripts/skills/common/qa-reproduce/SKILL.md` | **V-30.3 landed:** reproduce-only procedure (verdict table, `repro --check`, §4.6 keys, `not_needed` ≠ `not_reproducible`, never fix/dispatch/verify), preloaded into the `qa_meal` profile by `setup-hermes-global-soul.sh`. Do not create a second `.agents/skills` copy. |
| `scripts/skills/common/orchestrator-dispatcher/SKILL.md` | **V-30.4 landed (v2.1.0):** Step 0 packet dispatch (`--ticket=#n`, guard refusals surfaced, plan/attempt/block owned by the dispatcher, specify-role-first pointer), Step 5 verification is NOT yours (`named_test` + named gate + journey never closes), invariants 5–6 (packet is the prompt; author ≠ verifier; never main). |
| `specs/TEMPLATE.md` | **V-30.4 landed:** the three anti-patch sections every bug spec must carry — **Understanding** (mechanism / not-this / evidence key / explicit non-goal), **Layer** (display\|calc\|data, siblings frozen), **Forbidden patch** (no symptom-hide, no new flag, no renamed locator, no second write path) — plus the **two-sided fixture** section. |
| `.github/workflows/ci.yml` | **V-30.5 open:** add the ticket-state, pack-fixture, continuity, and strict capability gates. Make `assert-bug-pack.mjs` host-independent first: it currently checks `~/.hermes/profiles/bug_ticket` and would fail in clean CI. |
| `docs/agents/telegram_work.md` | **V-30.5 open:** add ticket-first handoff rules, the "needs human" list, and the exact waiting/claim rules. Keep the existing BUG-8449 incident section as evidence. |

### 5.3 Protected and durable documentation still open

- `AGENTS.md` L15: add trigger phrases (`pack bug`, `repro #n`, `plan #n`, `verify #n`) and
  the three laws — L15 must stay ~6 lines. This is **not yet edited** and needs the human
  before→after process required by `AGENTS.md` §3.
- `docs/agent/BUG_PIPELINE.md` **must be created before V-30.5 closes**: the bug-lane counterpart
  of `JOURNEY.md` (states, gates, who moves what) + a row in `docs/agent/README.md`.
- `docs/agents/telegram_work.md`: add ticket-first handoff and the "needs human" list; this
  file currently still describes the old QA → dispatch → QA path as the primary workflow.
- `plan/ROADMAP.md`: the new IDs (§6) + a line in **Current work**.
- `plan/QUALITY.md` §14: one pointer that the TG lane now writes the same cards (no rule
  change). Do not change the quality rules without the required review.

### 5.4 Explicitly NOT building (non-goals)

- No second tracker (no Beads/Dolt/GitHub Issues/Jira), no new D1 table for bugs, no sixth
  `plan/` architecture file, no separate "repro" store.
- No markdown as a state store; no per-bug process doc.
- No chat-claim `done`; no auto-merge; no unattended `--cascade` by default.
- No self-verification (the fixer never writes the verdict).
- No new memory server; no growth of per-bot memory beyond the existing caps.
- Not the bot-side memory/rail work: `plan/AGENT_ALIGNMENT.md` P1–P5 (`bots/memory/<bot-id>.md`,
  `/remember`, skills bridge, unified failure log, `bots/soul.md`) owns **facts**; this ticket
  owns **work**. Build on the same rails (`scripts/lib`, prompt-level injection), never as
  parallel one-agent patches — and do not rebuild either side.

---

## 6. Rollout (each phase has a gate and an artifact; nothing is big-bang)

Track IDs — **V-30.1 … V-30.5** (*decided, P4*): Track V Phase 10. The BOT-xx range is in
active use (BOT-12…18 as of 2026-09-24 and growing), so V-30.x is the stable numbering.

| Phase | Deliverable | Gate (must exit 0) | Evidence artifact | Status |
|---|---|---|---|---|
| **V-30.1** store + CLI | schema fields + `bugState()` + `bugctl` + artifact endpoints + **A-f1/A-f5** fixes | `npx vitest run src/utils/bugTicketState.test.ts` · `node scripts/assert-bug-ticket-continuity.mjs` · `npm run lint`; scripted `new→packed→in_fix→done` via `bugctl` | scripted session and continuity assert | **DONE 2026-09-24** — PR #62 / `86e8495` |
| **V-30.2** packer | code: `bug-pack.mjs`, `bugctl pack --check`/`--split`, Hermes profile/skill, registry entry, three capability rows. **Closed 2026-09-24:** traceable fixture (`scripts/fixtures/bug-8449.json`, checked against `bug-backlog.md` at gate time) + packer-only boundary doc/test, P9 token, `@Bug_ticket_bot` handle, one live E2E reply (session `20260924_162828_f191298f`, packed card #2), `enabled: true` | `node scripts/assert-bug-pack.mjs` + `npx vitest run src/utils/bugPackFixtures.test.ts`; then live E2E: intake → one card or needs_repro/duplicate → Telegram reply with `#n` | fixture transcript/card ids, token-sync output, Telegram message/reply id, final `enabled: true` | **DONE 2026-09-24** — PRs #66/#67; closure in AI_HANDOVER.md |
| **V-30.3** reproducer | `qa-reproduce` skill; `qa-runner.mjs --ticket=<#n>`; `bugctl repro --check`; one QA write path using existing profiles/tokens | known-good card posts `repro.status=failed` with `run.log` → derived flag `not_reproducible`; known-bad card posts `status=confirmed` with `command`, `exit_code`, `run.log`, and portable `before.png` key; both verdicts persist on card | both fixture transcripts, artifact keys, and derived flags | **DONE 2026-09-24** — skill/runner/`repro --check`/§4.6 keys/`svc-repro` done/gate `assert-bug-repro` 57/0; **live verdict on card #2**: `failed` → `not_reproducible` (defect fixed by `00b8cb1`, so the known-good path is the one that proved live), R2 keys `bugs/tag_mufs4t96_wj02x7/1790272128947-*`; `confirmed` path gate-proven, awaits a genuinely-bad card; do not use `not_needed` as a synonym for `not_reproducible` |
| **V-30.4** orchestrator | packet-driven `run-coding-dispatch.sh --ticket=#21`; plan block; start/end attempt rows; `bugctl block --reason`; idempotent in-flight guard; verifier cannot be fixer | scratch dev-only card reaches `done` only after named gate green; failed dispatch leaves `blocked_reason`; no direct main push or chat-only claim | card timeline, attempt rows, commit/PR, named-gate output, verify artifact | **DONE 2026-09-24 — code + live VPS proof.** Code: `--ticket=#n` + `bug-dispatch.mjs` guard + plan/attempt/block rows + verifier separation + `orchestrator-dispatcher` v2.1.0 + TEMPLATE anti-patch sections + scratch fixture `bugDispatchFlow` (12 tests) + gate `assert-bug-dispatch` 49/0. **Live:** card #3 `new→packed→in_fix→verifying→done` (journal `specs/bug-journal/3.jsonl`, PR #101, named_test verify by non-author, exit-3 double-dispatch refusal); card #4 failure → `attempt failed:` + `blocked_reason` + guard refusal exit 3; offline write queued during API restart → `flush` replayed; hardening fixes landed from the proof: #98 (stop/heartbeat zombie) + #102/#103 (journal drops) |
| **V-30.5** memory + ratchet | generated `bug-backlog.mjs`; `/resume`; `svc-repro`; status transitions; CI gates; `docs/agent/BUG_PIPELINE.md`; `telegram_work.md`; BUG-8449 retro-audit | `review-failures.mjs` has no repeated fixture signature; `check-capability-propagation.mjs --strict` exits 0; continuity + pack gates run in CI; retro-audit answers §4.10 questions 1–6 from disk/API only | generated backlog, resume transcript, CI output, retro-audit answers | **NOT STARTED** — after V-30.4 and explicit human go; do not delete hand-compiled backlog before fixture parity |

### 6.2 Executable handoff (audit 2026-09-24)

This is the canonical pickup sequence. Do not infer work from a green V-30.2 fixture gate alone:
V-30.2 is not operationally done until the P9/E2E closure below is recorded.

#### Dependency graph

```text
P9 token + profile env + registry handle
        ↓
V-30.2 live E2E reply and enabled:true
        ↓ (explicit human go)
V-30.3 reproduce contract + qa-runner --ticket
        ↓
V-30.4 packet dispatch + plan/attempt/block/verify
        ↓
V-30.5 backlog/resume/CI/capability/retro-audit/docs
```

No token is committed to git. No later phase may use a fake handle, a synthetic E2E message, or
an unrelated open/partial capability row as proof.

#### V-30.2 closure — human P9, then agent verification

**Closed 2026-09-24.** Recorded evidence: `HERMES_BUG_TICKET_TOKEN` present in
`~/.config/bot-host/tokens.env` (line 22, never printed); live E2E session
`20260924_162828_f191298f` with TG message ids 8/12/14/16 packing card #2
(fingerprint `CLONE_UI|omega_3_weekly_shows_7_700000000000001g|2026-W39`);
`bots/registry.json` has `enabled: true` and `username: "@Bug_ticket_bot"`;
all recorded in `AI_HANDOVER.md`.

**V-30.2 audit follow-up — resolved 2026-09-24 (same change set):**
(a) the gate fixture is now the committed normalized file
`scripts/fixtures/bug-8449.json`, derived from the `bug-backlog.md`
"Issues (7 items)" table and re-checked row-by-row against that source at
gate time; the fixture also runs through the **CLI** intake path
(`bugctl pack --split` + `bugctl pack --check`), not only the helper.
(b) the server/CLI contract is resolved as an explicitly documented +
tested **packer-only boundary**: `validateDefect()` enforces required
fields (unit-tested in `bugTicketState.test.ts`), the single-defect and
fingerprint rules stay solely at `bugctl pack --check`, the server does
not duplicate them, and `assert-bug-pack.mjs` asserts all three facts.
Both are named checks in that gate.

Runbook:

1. The human creates a dedicated BotFather token and writes **only** the key/value to the
   master `~/.config/bot-host/tokens.env` as `HERMES_BUG_TICKET_TOKEN`.
2. On the host, ensure the profile exists and has an env file, then preview and apply the
   distribution:
   ```bash
   bash scripts/setup-hermes-global-soul.sh
   node scripts/sync-bot-tokens.mjs --check
   node scripts/sync-bot-tokens.mjs
   node scripts/sync-bot-tokens.mjs --list
   ```
   Confirm `hermes_bug_ticket` shows `hasToken=yes`; never print the token.
3. Record the actual BotFather handle in `bots/registry.json` under
   `bots[].hermes.username`, without changing `enabled` yet.
4. Identify the installed Hermes service with `hermes gateway list`, then restart only the
   `bug_ticket` profile/service using the host's supported profile-targeting command. If the
   installed CLI has no profile targeting, use the host's service manager for that profile only;
   do not guess a restart flag and do not restart unrelated services.
5. Send one real ticket-room message to the handle. It must produce one card, `needs_repro`, or
   a duplicate reply, with a public card id and no bundled ticket. Save the message/reply ids in
   the handover entry, not chat-only prose.
6. Only after that E2E succeeds, set `bots/registry.json` `hermes_bug_ticket.enabled` to `true`
   and run `node scripts/sync-bot-tokens.mjs --list` plus `node scripts/assert-bug-pack.mjs`.
7. Close V-30.2 only when the E2E artifact and the final registry state are durable in git/docs.

#### V-30.3 — reproducer implementation packet

Implement only after V-30.2 is closed and the human gives the phase go.
**DONE 2026-09-24:** all bullets below shipped together —
`qa-reproduce` skill (preloaded into `qa_meal` by `setup-hermes-global-soul.sh`),
`qa-runner.mjs --ticket=<#n>` (§4.6 R2 keys, exit-0 = `confirmed`),
`bugctl repro --check`, and named gate `scripts/assert-bug-repro.mjs` (57/0).
**Live proof:** `qa-runner --ticket=2` on 2026-09-24 posted
`repro.status=failed` (exit 1) → derived `not_reproducible`, R2 keys
`bugs/tag_mufs4t96_wj02x7/1790272128947-*`, `by: qa_meal` — card #2's
`7.700000000000001g` artifact no longer reproduces because `00b8cb1`
(2026-09-22) rounds `weeklyTarget`; the card's 2026-09-21 observation
predates that fix. `svc-repro` is `done`. The `confirmed` (known-bad)
path is covered by the gate's exec cases and will get its live proof on
the next genuinely-reproducing card.

Reference transcript (what the output looks like on a real card): the stuck
meal-analysis card — QA posts `repro{status: confirmed, command, exit_code,
run_log, before.png → R2 key}` plus a Telegram line (`reproduced — spinner
5min, result null, before.png linked`), then STOPs. Never "looks fine in
code" as a verdict; never a fix; never a dispatch. The full step-by-step
outputs (packer `packCheck` JSON → packet text → repro post → spec draft →
`go` → dispatch → attempt rows → `verify` green → `done`) are recorded in
`plan/ROADMAP.md` Track V Phase 10 (V-30.4 row) as the executable example.

- Add `scripts/skills/common/qa-reproduce/SKILL.md` to the existing `qa_meal` profile first;
  do not create a QA bot or token. Add `qa-reproduce` to that profile's
  `preload_skills` in the durable setup/config path, not only as an unconfigured symlink. Keep
  `qa_biomarker`/`qa_onboarding` asleep until P7 requires them.
- Extend `scripts/qa-runner.mjs` with `--ticket=<#n>`. It must load the packet, execute the
  card's command/criteria, capture the run, and write through `bugctl repro`; preserve all
  existing `--journey=meal|biomarker|onboarding` behavior.
- Add `bugctl repro --check` before any repro POST. The check must require the existing
  `validateRepro` status vocabulary and artifact fields; it must not invent a new state.
- Use the current derived semantics exactly: a known-good/no-longer-reproducible card posts
  `status=failed` with `run.log`, and `bugState()` derives the `not_reproducible` flag. A
  known-bad card posts `status=confirmed` with `command`, `exit_code`, `run_log`, and a
  portable `before.png` R2 key. `not_needed` means no repro was required; it is **not** a
  synonym for `not_reproducible`.
- Implement the §4.6 evidence contract (`repro.txt`, `run.log`, `before.png`, `expected.md`,
  `result.json`) using R2 keys. Host-absolute paths are not evidence.
- Add a deterministic named gate (recommended: `scripts/assert-bug-repro.mjs`) covering both
  verdicts and the derived flags, plus the existing ticket-state tests and `npm run lint`.
- Do not dispatch a coder or post `verify` from the reproducer.

#### V-30.4 — orchestrator implementation packet

Start only after V-30.3's two verdict fixtures and named gate are green.

- Keep legacy `--task=` working. Add `--ticket=#n` to
  `scripts/run-coding-dispatch.sh`; the packet, not chat history, is the coder prompt. **Audit
  note:** `GET /api/bugs/:id/packet` already carries the V-30 fields, but `buildNow()`/
  `buildContinueJob()` in `src/utils/bugWorkItem.ts` still return the legacy payload. Either
  extend those builders and test them, or make every ticket consumer call `bugctl packet`; do
  not ship a dispatcher that reads the old packet and silently drops `defect`, `repro`, `plan`,
  or `verify`.
- Post the plan artifact before dispatch. Record an attempt at start and end using the same
  attempt schema as the web lane; on failure call `bugctl block --reason ...` and preserve
  `blocked_reason` rather than only writing `escalated_human`. The dispatcher must use the
  host's `BUG_API_BASE`/`BUG_API_TOKEN` contract and queue a write when the API is unavailable.
- Refuse a second dispatch for a card already `in_fix` unless the existing per-bug lock proves
  it is the same run. Never push directly to `main`; use the repository PR flow.
- Verification must be posted by a QA/verifier that did not author the fix, and only after the
  named gate from `docs/agent/DOMAIN_REGRESSION_MAP.md` is green. `verify.method`
  must be `named_test` (or `manual` human check) — a journey-green alone stays
  `verifying` and never closes the card.
- The Specify role (any healthy backend — opencode/cline/grok/agy/human) writes
  `specs/active/<card>.md` from `specs/TEMPLATE.md` with packet + repro on the
  card, and must include the three anti-patch fields: **Understanding** (what the
  bug is NOT, with `before.png` key + one explicit non-goal — kills wrong-thing
  fixes), **Layer** (display / calc / data — one only; sibling layers frozen —
  kills cross-layer sprawl), **Forbidden patch** (named: no symptom-hide, no new
  flag, no renamed locator, no second merge path — kills patchy fixes), plus a
  **two-sided fixture** (broken input → correct output; adjacent input →
  unchanged — proves structure, not symptom). Reference: the `STALE_TURN-card22`
  spec in the ROADMAP V-30.4 row.
- Add a scratch dev-only fixture test that proves `packed → in_fix → verifying → done`, a failed
  dispatch `blocked`, and a double-dispatch refusal. No production card is the test fixture.

  **LANDED 2026-09-24 (code-done, gate `assert-bug-dispatch` 49/0):**
  - **Audit note resolved as option B:** every ticket consumer reads `bugctl packet`
    (`run-coding-dispatch.sh --ticket=#n` parses the packet JSON itself);
    `buildNow()`/`buildContinueJob()` stay legacy and are never read by the dispatcher —
    no `defect`/`repro`/`plan`/`verify` field can be silently dropped.
  - Guard/plan/category/spec helpers live in the new pure module `scripts/lib/bug-dispatch.mjs`
    (`dispatchGuard` refuses `in_fix`/`verifying`/`done`/blocked/not-repro/duplicate/no-defect
    with a same-run lock-pid exception; exit 3 on refusal). Plan posts **before detach**;
    attempt `start` posts post-lock; attempt `committed`+`applied=true` on push; every failure
    path (cascade, single-tool, abort trap) posts a `failed:` end row and
    `bugctl block --reason …` so `blocked_reason` survives alongside `escalated_human`.
  - Verifier separation is enforced three ways: dispatcher source contains no
    verify/close call (gate assert), the coder prompt carries the author ≠ verifier
    contract with the card's named gate, and `orchestrator-dispatcher` skill Step 5
    forbids posting verify. Journey-green → `verifying` stays enforced by `bugState()`.
  - Specify role: `specs/TEMPLATE.md` now contains the three anti-patch sections +
    two-sided fixture; the dispatcher embeds `specs/active/card-<n>.md` when present and
    points to it (specify-role-first warning) when absent.
  - Queue contract: bugctl reads never queue (`WRITE_OPS` gate) — writes still do
    (proven by `tests/bugctl-queue.test.ts`, 5/5).
  - Scratch fixture committed at `src/utils/bugDispatchFlow.test.ts` (12 tests).
  - **LIVE PROOF 2026-09-24 (VPS):** card #3 walked `new → packed → in_fix →
    verifying → done` end to end (plan row, attempt start/committed, PR #101
    auto-merged, exit-3 refusal on re-dispatch, `named_test` verify by a
    non-author with gate 50/0); card #4 exercised the failure path
    (`attempt failed:` + `blocked_reason` + guard refusal). The proof itself
    found and fixed three defects: #98 (heartbeat TERM trap + stop SIGKILL
    race left an `in_fix` zombie), #102/#103 (block/unblock journal rows
    dropped on the legacy response shape). Ops notes: opencode zen balance
    depleted and `opencode-go` is paid — dispatch defaults to free models
    (`nemotron-3.5-lightning-free`, fallback `space-bunny-free`).

#### V-30.5 — memory, CI, and ratchet packet

Start only after V-30.4's end-to-end fixture is green.

- Add `scripts/bug-backlog.mjs` to generate `bug-backlog.md` from the store. Preserve the current
  hand-compiled file until the generator reproduces the BUG-8449 rows; do not delete evidence.
- Add `/resume` to the existing bot command surface (`scripts/lib/commands.mjs` and
  `scripts/bot-host.mjs`) so it prints the current ticket packet. It must not create a second
  state store or depend on chat scrollback. Add command/help coverage to `tests/bot-host.test.ts`.
- Add only the missing `svc-repro` capability row. The three V-30.2 rows already exist:
  `proc-ticket-state` is `done`; `svc-bug-ticket` becomes `done` only after P9/E2E; and
  `sess-ticket-resume` becomes `done` only after `/resume` is proven.
- Make `assert-bug-pack.mjs` CI-safe before adding it to CI: it currently requires the local
  `~/.hermes/profiles/bug_ticket` directory and will fail on a clean runner. Use an explicit
  host-profile check or a temporary fixture HOME; do not weaken the repository assertions.
- Add ticket-state, pack-fixture, continuity, and capability gates to `.github/workflows/ci.yml`.
  The global `--strict` checker is currently red because five pre-existing capability rows are
  `partial` and the two unproven ticket rows are `open`. Do not mark unrelated rows `done` and
  do not weaken `--strict`; either close those rows in their owning work or explicitly scope the
  ticket strict check before claiming the global gate is green.
- Create `docs/agent/BUG_PIPELINE.md`, update `docs/agents/telegram_work.md` to make the
  ticket-first handoff primary, and add the missing protected-doc references only through the
  required review process.
- Re-open BUG-8449 from the generated backlog and answer §4.10 questions 1–6 from disk/API
  alone. Record the answers and the generated backlog as the V-30.5 evidence artifact.

#### Definition of done for the whole lane

- [ ] P9 token exists only on host env files; registry has the real handle and `enabled:true`.
- [ ] One live Telegram E2E message/reply is recorded with a public card id.
- [ ] V-30.3 proves both derived repro flags with portable artifact keys.
- [x] V-30.4 proves plan → attempt → verify and blocked failure without direct main push. (live 2026-09-24: card #3/#4, PR #101, refusals exit 3)
- [ ] V-30.5 proves generated backlog, `/resume`, CI gates, strict capability status, docs, and
      the BUG-8449 retro-audit.
- [ ] No phase is marked DONE from a chat claim, synthetic fixture, or tokenless test alone.

**Rollback story:** every phase is additive — new `work_item` fields are optional, `--task=`
stays supported, the web UI and `/api/bugs/next` keep working, `bugctl` is a new file. If a
phase stalls, the old chat → dispatch path still runs. A failed live E2E leaves
`hermes_bug_ticket.enabled:false`; a failed repro/verifier run leaves the card blocked or
unverified, never `done`.

### 6.1 Decision sheet (V-30.0 — DECIDED 2026-09-24)

**This table is the single editable record.** Mirrored in `plan/ROADMAP.md` → **Track V Phase 10
(V-30.0)** as `DECIDED 2026-09-24`. All rows below are decided; to override one, edit its
**Decision** cell, mirror the change into §8, and re-sync the roadmap status strings. No phase
may start before its predecessor phase is done, and V-30.3…V-30.5 each start only on an explicit
human go. V-30.2's code landed, but its P9 token + E2E closure is still a human operation.

| # | Pending action | Options | Recommendation | Blocks | **Decision (2026-09-24)** |
|---|---|---|---|---|---|
| **P1** | Store / transport | A: D1 `issue_tags` only · B: git ticket files own the state · C: D1 writer + git as the bus · D: A + a git-committed journal (walked end to end in §10) | A + D | V-30.1 | ✅ **A + D** — D1 `issue_tags` is the only store; journal for review; C kept as the documented escape hatch (§10) |
| **P2** | **State vocabulary** | S-C derived, full 11 names (§4.3.4) · S-C-lite, 5 names + flags (§4.3.5) · S-C-lite without `not_reproducible` (folded into `blocked_reason`) | S-C-lite | V-30.1 | ✅ **S-C-lite** — derived `bugState()`, 5 names + flags; `not_reproducible` kept as its own flag |
| **P3** | Write-endpoint auth | shared `BUG_API_TOKEN` header on `POST/PATCH /api/bugs/*` · VPS-local writes only | token header (required by A and C; this is the A-f5 fix) | V-30.1 | ✅ **Token header** — `X-Bug-Api-Token` on all `/api/bugs/*` writes (the A-f5 fix) |
| **P4** | Track numbering | V-30.x (Track V Phase 10) · a BOT-xx range in the bot table | V-30.x — the BOT-xx range is in **active use** by the Hermes-parity program (BOT-12…18 as of 2026-09-24, growing: `17873f2`, `fbe0405`, `fdbf05d`, `971a4cf`), so it must be re-checked at claim time; V-30.x is free and stable | docs only | ✅ **V-30.x** — Track V Phase 10; the BOT-xx range is in active use and must not be claimed |
| **P5** | Owner of `not_reproducible` | packer decides close vs `blocked_reason=needs_info` · orchestrator triages | packer | V-30.2 | ✅ **Packer** — decides close or writes `blocked_reason=needs_info`; the orchestrator never re-opens the free-text hop |
| **P6** | Repro depth | command + `run.log` + screenshot per card · committed Playwright test per ticket | shallow now; Promote path later | V-30.3 | ✅ **Shallow now** — command + `run.log` + screenshot; committed Playwright test only via a later Promote |
| **P7** | QA profile wake policy | wake `qa_biomarker` / `qa_onboarding` on the first Health/profile repro · `qa_meal` covers all surfaces for now | on demand — keep them asleep until needed | V-30.3 | ✅ **On demand** — keep `qa_biomarker`/`qa_onboarding` asleep until the first Health/profile repro needs them |
| **P8** | Backlog artifact | generated `bug-backlog.md` · `bugctl queue` + `docs/agent/BUG_QUEUE.md` | generated | V-30.5 | ✅ **Generated** — `bug-backlog.md` generated from the store (keeps the human habit) |
| **P9** | Human: create the packer token | BotFather → `HERMES_BUG_TICKET_TOKEN` → master `tokens.env` → `sync-bot-tokens.mjs` | required before the V-30.2 E2E proof | V-30.2 | ✅ **Approved, human step** — create in V-30.2 via BotFather → `HERMES_BUG_TICKET_TOKEN` → master `tokens.env` → `sync-bot-tokens.mjs` |
| **P10** | Channel model | one ticket room with per-surface topics · per-agent chats with `reply_to` routing | ticket room | V-30.2 / V-30.4 | ✅ **Ticket room** — one ticket room with per-surface topics; per-card `reply_to` routing |

**Decided 2026-09-24 — decisions are locked, but operational gates remain:** no decision is
waiting for a new product choice. P9 is the remaining V-30.2 human operation: BotFather token →
master `tokens.env` → sync → one E2E reply → `enabled: true`. V-30.3…V-30.5 remain unstarted
until their explicit human go.

---

## 7. Risks and how the design handles them

| Risk | Handling |
|---|---|
| **A second tracker creeps in** (the classic failure) | §5.4 non-goal; all state stays in `issue_tags.work_item`; `bugctl` is a client, not a store |
| **Packer becomes a fixer / QA starts fixing / orchestrator self-verifies** | artifact-authority in §4.3.3–4.4 (each role may post only its own artifact) + maker ≠ checker; the verifier is a profile that did not author the fix |
| **Bots cannot reach the API** (phone/Termux/Colab lanes) | `bugctl` offline JSONL queue + replay by the packer; plus the **A-f5** token guard before any write endpoint is exposed |
| **Journey-green mistaken for "this defect fixed"** | repro/verify must target the card's `criteria`; verify bundle requires the named gate, not just a journey |
| **Ticket rot** (cards nobody closes) | `occurrences` + `blocked_by` ordering; "needs human" list; blocked cards are visible, not silent |
| **Latency** (a pack step before dispatch) | packer is 1 LLM turn on a stubbed card; the alternative is BUG-8449's 1,249 s and 3 attempts |
| **Protected docs pulled out of shape** | `AGENTS.md` L15 stays ~6 lines; the long form lives in the new `docs/agent/BUG_PIPELINE.md`; edits need your before→after |
| **Quota/cost** | unchanged tool allowance; tickets *reduce* wasted dispatches (no third attempt on a burned hypothesis) |
| **Secrets** | unchanged: master → `sync-bot-tokens.mjs` → per-runtime env; `bots/TOKENS.md`; never in git |

---

## 8. Decisions (all made 2026-09-24)

**Decided 2026-09-24 — locked items L1/L2 plus the full P1–P10 sheet in §6.1:**

- **L1 — QA is reused** — one skill (`qa-reproduce`) + one card state on the existing
  per-surface QA profiles, no new QA bot (§4.4).
- **L2 — the packer is a new Hermes profile `bug_ticket`** — one new bot, its own token, no
  dispatch powers (§4.4 bootstrap table → V-30.2).
- **P1 — store: A + D.** D1 `issue_tags` is the only store; the git journal buys reviewable
  history without a second store. C stays the documented escape hatch; B is rejected (§10).
- **P2 — state vocabulary: S-C-lite.** Derived `bugState()` projection, 5 names + flags;
  `not_reproducible` kept as its own flag (§4.3.5, chosen row in §4.3.2).
- **P3 — write auth: token header.** `X-Bug-Api-Token` on all `POST/PATCH /api/bugs/*` writes
  (the A-f5 fix); VPS-local-only rejected.
- **P4 — numbering: V-30.x (Track V Phase 10).** The BOT-xx range is in active use
  (BOT-12…18 as of 2026-09-24, growing) and must not be claimed.
- **P5 — `not_reproducible` owner: the packer.** Decides close or writes
  `blocked_reason=needs_info`; the orchestrator never re-opens the free-text hop.
- **P6 — repro depth: shallow now.** Command + `run.log` + screenshot per card; a committed
  Playwright test per ticket only via a later Promote step.
- **P7 — QA wake policy: on demand.** `qa_biomarker`/`qa_onboarding` stay asleep until the
  first Health/profile repro needs them.
- **P8 — backlog artifact: generated.** `bug-backlog.md` generated from the store
  (keeps the human habit); `bugctl queue` is the machine view.
- **P9 — packer token: approved human step.** Created inside V-30.2 via BotFather →
  `HERMES_BUG_TICKET_TOKEN` → master `tokens.env` → `sync-bot-tokens.mjs`; the V-30.2 E2E
  reply through the new token gates `enabled: true`.
- **P10 — channel model: ticket room.** One ticket room with per-surface topics;
  per-card `reply_to` routing (also V-30.2 / V-30.4).

**Canonical record:** the decision sheet in §6.1 (P1–P10 with decision cells). The rows are
mirrored in `plan/ROADMAP.md` → Track V Phase 10 (**V-30.0** = `DECIDED 2026-09-24`).
This section explains the options — §6.1 is the fill-in/override place. To override a
direction: edit its `Decision` cell in §6.1, mirror the change into the list above, and
re-sync the roadmap status strings.

**Rejected alternatives (kept for review):**

1. **Numbering (P4 — decided: V-30.x).** Rejected: BOT-12..16 range (registry adjacent —
   in active use by the Hermes-parity program, BOT-12…18 as of 2026-09-24). Only affects doc placement.
2. **Owner of "not reproducible" (P5 — decided: packer).** QA writes the verdict; the packer
   decides close or writes `blocked_reason=needs_info`; the orchestrator never sees it.
   Alternative: the orchestrator triages; that re-introduces the free-text hop.
3. **Repro depth (P6 — decided: shallow now).** Command + log + screenshot per card; a
   committed Playwright test per ticket is the later "Promote" step, not the first version.
4. **Packer shape (L2 — decided 2026-09-24: new Hermes profile `bug_ticket`).** Rejected: (b) a `/pack` mode
   of collab/orchestrator (reshapes a documented role, and the orchestrator would pack the
   cards it plans) and (c) no separate packer (human-reported Home/Health bugs land in a QA
   chat, and the surface owner grades its own evidence). Whichever way it runs, the pack step
   is still enforced by `bugctl pack --check`.
5. **Write-endpoint auth (P3 — decided: token header).** Shared `BUG_API_TOKEN` header on `/api/bugs/*` writes
   vs VPS-local-only writes over a private bridge (nothing public at all).
6. **Backlog artifact (P8 — decided: generated).** Generated `bug-backlog.md` (keeps the human habit)
   vs retire it for `bugctl queue` + a `docs/agent/BUG_QUEUE.md` snapshot.
7. **States (P2 — decided: S-C-lite).** Derived `bugState()` projection with the 5-name vocabulary
   (§4.3.5); rejected: full 11-name S-C (§4.3.4, kept as the internal mapping) and declared
   states (S-A/S-B, rejected with reasons in §4.3.2).

**Next execution unit after the V-30.2 code merge:** close P9 and the one live Telegram E2E
(§6.2). Do not start V-30.3 from a tokenless fixture; do not start V-30.4 or V-30.5 ahead of
their predecessor gates.

---

## 9. Sources

- Local ground truth: `AGENTS.md` L15/L17 · `plan/QUALITY.md` §14 · `plan/BOT_ROLES.md` ·
  `docs/agents/telegram_work.md` · `docs/agent/JOURNEY.md` · `docs/agent/GITHUB_WORKFLOW.md`
  · `src/utils/bugWorkItem.ts` · `serverBugSnapshot.ts` · `server_d1_schema.ts` ·
  `scripts/{qa-runner,qa-auto-loop,run-coding-dispatch,review-failures,discover-gated-work}.mjs|sh`
  · `bots/{registry,capabilities}.json` · `bots/TOKENS.md` · `bug-backlog.md` ·
  `plan/AGENT_ALIGNMENT.md` (bot-side parity matrix + P1–P5 memory rails, audited 2026-09-24 —
  related work; BOT-12/BOT-15 are already cited there).
- Beads (git-native tracker for agents) — quick start & CLI reference:
  <https://github.com/gastownhall/beads> · write-up:
  <https://betterstack.com/community/guides/ai/beads-issue-tracker-ai-agents/>
- GitHub Agentic Workflows — Issue Triage:
  <https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows/>
- CoreStory — Agentic Bug Resolution playbook: <https://docs.corestory.ai/playbooks/agentic-bug-resolution>
- Learn Cursor — bug triage agent guide:
  <https://www.learncursor.dev/guides/build-bug-triage-agent-linear-github>

---

## 10. Appendix — store / transport, A vs B vs C, walked end to end

Same bug, same five steps, three transports. Example used throughout:

> You tell the packer: **"Home screen shows omega-3 as 7.700000000000001g"**
> (surface `home`, class `CLONE_UI`, observed `7.700000000000001g`, expected `7.7g`,
> criteria "weekly omega-3 text equals `7.7g`", one photo attached). Fixture parity:
> this is the real BUG-8449 defect (`plan/BOT_ROLES.md:23`).

### A — D1 `issue_tags` is the only store; bots are HTTP clients (`bugctl` → `/api/bugs/*`)

Who runs where: the packer (`bug_ticket` Hermes profile), `qa_meal` and `orchestrator` all
live on the VPS/gateway, which can reach the live site. `bugctl` is a thin fetch wrapper with
`BUG_API_TOKEN`; writes that fail go to `~/.hermes/bot-attempts.jsonl` and replay later.

| # | Who | Command / call | State after |
|---|---|---|---|
| 0 | you | TG message + photo to `@Bug_ticket_bot` | — |
| 1 | packer | `bugctl queue --json` → fingerprint miss; upload photo to R2 key `bugs/<tag>/…-before.png`; `bugctl create --title … --surface home --class CLONE_UI`; `bugctl pack --check …`; `bugctl pack --id <tag> …` | `POST /api/bugs` + the defect write → card **#21** *projects* to `packed` with `needs_repro` if `repro.status=needed` is posted |
| 2 | packer | `bugctl pack --check` (1 defect ✓ criteria ✓ fingerprint ✓) → TG: `✅ Packed #21 → needs_repro @qa_meal` + `⏳ Waiting for @qa_meal…` | `packed` with `needs_repro` flag |
| 3 | `qa_meal` | `bugctl queue --assignee=qa_meal --state=needs_repro` → `bugctl packet --id 21` → runs the check → uploads `repro.txt`, `run.log`, `before.png`, `expected.md`, `result.json` → `bugctl repro --id 21 …` | `repro.status=confirmed`; TG pings @Orchestrator |
| 4 | orchestrator | `bugctl packet --id 21` → `bugctl plan --id 21 …` → `run-coding-dispatch.sh --ticket=#21 --tool=opencode` (dispatch reads the packet, writes attempt rows on start/end, tsc, commit+push, deploy wait) | `in_fix → verifying` |
| 5 | `qa_meal` | re-runs the **same** repro and posts `bugctl verify --id 21 --result green --command … --evidence …` | **`done`** (`status=fixed`) |

Needs: HTTP + a token; R2 upload from the bot host. The phone/Colab lanes are *reachable*
(the site is public HTTPS) — the offline JSONL queue is for flakiness and for not spreading
the token onto the device, not for reachability.
Breaks when: the site or D1 is down → that host sees a stale cache and its writes queue.

### B — git-native ticket files own the state; `issue_tags` is a mirror for the web UI

A card is `specs/bugs/21.json` + generated `specs/bugs/index.json`; `bugctl` is a **local
file tool** (no network). Every transition is a commit, so the card's life is `git log -p`.
A mirror job (Action or VPS cron) upserts `specs/bugs/*.json` into `issue_tags` so the web
modal still shows the queue.

| # | Who | Command / call | State after |
|---|---|---|---|
| 0 | you | TG message + photo | — |
| 1 | packer | `bugctl pack --defect … ` writes `specs/bugs/21.json` (state `needs_repro`) + updates `index.json`; artifacts to R2; `git add specs/bugs && git commit && git push` (existing `agent/**` → PR flow) | card on `agent/bugs` |
| 2 | packer | TG reply from the file it just wrote | `needs_repro` |
| 3 | `qa_meal` | `git pull` → sees `#21` needs repro → runs it → writes `repro{}` into `21.json` → push | `reproduced` (a commit) |
| 4 | orchestrator | pull → writes `plan{}` → dispatch → on success writes `commits[]` + state → push | `verifying` |
| 5 | `qa_meal` | pull → verifies → writes `verify{}` + `status:"fixed"` → push; mirror job syncs D1 | `done` |

Needs: git push rights on every lane (already true: SSH push + `auto-pr.yml` + `claim-guard`),
R2 for artifacts, and the mirror job. CI can validate the ticket schema on every PR —
attractive.
Breaks when: two agents touch the same card in the same window (a merge conflict on JSON is
now a machine problem; `lock.sh`/`claim-guard` is the mitigation), or git history grows with
every state transition.
Cost to be honest about: this creates a **second store** and a sync direction to maintain —
exactly what §5.4 lists as a non-goal.

### C — D1 stays the writer, git is the bus (inbox in, queue out)

Agents never call the API. They read `specs/bug-queue.json` and write proposals into
`specs/bug-inbox/<idem_key>.json`. One VPS job (`scripts/bugs-sync.mjs`, cron 1–2 min or on
push) imports the inbox into `issue_tags`, resolves by `idem_key`, applies a monotonic `rev`,
and re-exports the queue snapshot.

| # | Who | Command / call | State after |
|---|---|---|---|
| 0 | you | TG message + photo | — |
| 1 | packer | writes `specs/bug-inbox/CLONE_UI-omega3-week39.json` (`{action:"create", defect, evidence}`) + push; TG reply reads its own file | filed (pending import) |
| 2 | sync job | imports → creates card **#21** in D1 → exports `bug-queue.json` | `packed/needs_repro` |
| 3 | `qa_meal` | reads `bug-queue.json` → repro → writes `bug-inbox/#21-repro.json` + push | next tick → `reproduced` |
| 4 | orchestrator | reads export → `plan{}` → dispatch → writes `bug-inbox/#21-plan.json` | next tick → `in_fix/verifying` |
| 5 | `qa_meal` | verify → `bug-inbox/#21-verify.json` | next tick → `done` |

Needs: the sync job + cron/service + the `rev` rule. No public write endpoint, no token on
any device, every agent action reviewable, offline-first everywhere.
Breaks when: the sync job is down (agents work from a stale export — harmless but confusing),
or the same card is written twice in one tick (needs `rev` + last-writer-wins).
Cost: one more daemon, and a visible lag at every handoff (the TG thread says "waiting" for
up to a tick).

### D — hybrid: D1 owns the state, a git-committed journal gives you B's review story

Same store, same transport, same endpoint surface as **A** — plus one extra bookkeeping rule:

- `bugctl` appends one JSONL row per transition it makes (`pack`, `repro`, `plan`, `attempt`,
  `verify`) to `specs/bug-journal/<n>.jsonl`, and the acting agent commits that file with its
  own work (`run-coding-dispatch.sh` can fold it into the fix commit).
- You gain: `git log --follow -p specs/bug-journal/21.jsonl` is the ticket's life, reviewable
  and offline-readable; CI can lint the rows; a fresh agent on any host gets a
  `git pull` + read-only view of tickets even with no API.
- You do **not** gain: authoritative offline writes (still A) or "no token on the device".
- Cost: one extra file written by `bugctl`, one small CI lint. No daemon, no second store
  owning state, no sync direction.

### A vs B vs C vs D on the dimensions that matter here

| Dimension | **A** — D1 only | **B** — git files own it | **C** — D1 + git bus | **D** — A + git journal |
|---|---|---|---|---|
| Where a card lives | `issue_tags.work_item` | `specs/bugs/#21.json` | `issue_tags` (+ inbox/queue as transport) | `issue_tags` (+ append-only journal) |
| What a bot needs | HTTP + `BUG_API_TOKEN` | git clone + SSH push | git only | HTTP + token to write; `git pull` for read-only |
| New moving parts | `bugctl` + 4 endpoints + token guard | **mirror job** (files → D1) + lock discipline | **sync job** (import/export) + `rev` rule | `bugctl` + 4 endpoints + token guard + one CI lint |
| Phone / Colab lane | offline JSONL queue (for flakiness; the site is publicly reachable) | works natively | works natively | offline queue to write, journal to read |
| Public write surface | yes, token-guarded | none | none | yes, token-guarded |
| Human review | web modal, live | `git log -p` per card — **best** | commits **and** web modal | web modal + `git log -p` journal |
| Conflict safety | server-side projection on write + `updated_at` check | git/PR locks (`claim-guard`, `lock.sh`) | `rev` counter, single writer | projection on write; journal is append-only |
| Visible lag | none | mirror lag for the web UI only | up to one tick at **every** handoff | none |
| Web UI impact | none | needs the mirror | none | none |
| Migration cost | zero | export every existing tag + mirror | one script + a `rev` field | zero |
| Matches §5.4 non-goals | ✅ | ❌ second store to keep in sync | ⚠️ one extra daemon | ✅ |

**Decision (P1): A + D** — A's store (no migration, no daemon, live web modal) plus the
append-only journal so the ticket's life is reviewable in git and readable offline. **C** stays
the documented escape hatch (it reuses A's store, so only the transport would change if the
HTTP dependency or the shared write token ever bites). **B** is rejected: a second store next to
`issue_tags` is the split that caused BUG-8449.

**Why A + D wins (the deciding considerations):**

1. Do you want the web bug modal and the TG lane to be the *same* rows at all times? → A, C or D.
2. Is a shared write token acceptable on the phone/Colab lanes? → if no, C. (Note
   `bots/TOKENS.md`: device tokens are **"device-owned — not synced"**, so a new
   `BUG_API_TOKEN` on the phone would be an unmanaged secret you rotate by hand.)
3. How many daemons are you willing to babysit? → A (0) or D (+1 CI lint) vs C (+1 sync job).
4. Do you want "every ticket transition is a reviewable commit"? → B (state in git) or D
   (journal in git) — D gets you the review without the second store.
5. Does the TG lane need to survive the deploy window? The webhook rebuild + service restart
   (`docs/agents/telegram_work.md:42`, "~45s") is exactly when a fix is being verified — C/D
   read a repo file instead of the restarting service; A alone goes briefly blind there.

**Where A genuinely loses** (so the trade is not one-sided): a shared write token that must
exist wherever a bot writes; a new *public* write surface on the live app (the **A-f5** auth
work); the deploy-window blindness above; and no repo-local, reviewable history of the ticket.
