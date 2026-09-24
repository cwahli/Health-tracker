# Agent Alignment: Hermes parity gap matrix + target architecture

Audited 2026-09-24. Goal: every agent starts from at least the Hermes baseline
(read previous messages, own memory file, learn) and all future fixes land
once, everywhere (Case H ladder, plan/RELIABILITY.md §14.6).

Legend: ✅ has · ❌ missing · ⚠️ partial/diverged · (design) = intentionally different.

## 1. Gap matrix — what Hermes has that others don't

| # | Capability | Hermes (Mac gateway) | VPS bot-host (vm/opencode/vm2) | Mobile | Grok TG router | Collab |
|---|---|---|---|---|---|---|
| 1 | Per-chat conversation history | ✅ SQLite sessions + messages, runtime `conversation_history` | ✅ opencode lane only (`--session`, disk `sessions.json`); ❌ cline lane (`sessionID:null` hardcoded); ❌ gemini lane | ✅ same code as VPS | ⚠️ ONE global session shared by all chats (bleed) | ❌ (design: GPU tunnels) |
| 2 | TG reply-quote in prompt | ? (dispatcher unconfirmed) | ✅ text/caption via `buildQuotedPrompt` (2026-09-24); media-only quotes ignored | ✅ same code | ❌ | ❌ |
| 3 | Own long-term memory file | ✅ `~/.hermes/memories/MEMORY.md`, agent-writable via memory tools + write gates | ❌ no memory file; only manual `/new` handoff brief | ❌ | ❌ | ❌ |
| 4 | User profile | ✅ `USER.md` | ❌ | ❌ | ❌ | ❌ |
| 5 | Soul / reply style | ✅ `SOUL.md` (direct, no filler) | ❌ no persona; verbosity unbounded | ❌ | ❌ | ❌ |
| 6 | Failure learning loop | ⚠️ `bot-failures.jsonl` (empty) + `learning_pod.json` (tool stats only) | ⚠️ `scripts/lib/failure-log.mjs` + `review-failures.mjs`, `proc-learning` partial — UNSHARED with Hermes | ⚠️ same code as VPS | ❌ | ❌ |
| 7 | Shared skills, gated | ❌ registry points at `~/.hermes/shared_skills/{social-media,autonomous-ai-agents}/…` which DO NOT EXIST on disk; no gate | ✅ `scripts/skills/common` + propagation checker | ✅ same | ⚠️ vendored, manual sync | ⚠️ skill text only |
| 8 | Tool allowances | ✅ `tool_allowances.json` | ✅ `telegram-allowance` skill + `tool-allowance.mjs` — separate impl, same idea | ✅ same | ⚠️ tickets, partial | ❌ |
| 9 | Context mgmt (`/compact`, warnings) | ✅ compression + breakdown | ✅ `/compact` + headline 60/75% warnings | ✅ same | ✅ headline (shared code now) | ❌ |
| 10 | Proactive / cron / heartbeat | ✅ `cron/` + ticker heartbeat + executions.db | ❌ purely reactive | ❌ | ❌ | ❌ |
| 11 | Cost/usage visibility | ✅ `account_usage.py` | ✅ totals + headline usage | ✅ same | ✅ headline + status cmd | ❌ |
| 12 | Media in/out | ✅ (skill path — but see #7, path broken) | ✅ inbound-media + photo-out | ✅ same | ✅ `extractMedia` + MEDIA: | ⚠️ link-only |

Headline result (revised 2026-09-24): quote text on bot-host is done. The highest-value gaps are #1 session resume on every surface (a surface that cannot resume is degraded; there is no Cline lane to finish), #3 memory retrieval, #5 soul, #7 skills bridge (paths missing on disk), #6 the two learning loops. Next code is the crash receipt, not a vendor resume flag.

## 2. Target architecture — fix once, everywhere

```
bots/capabilities.json          ← registry, all 5 classes declared per cap
scripts/lib/                    ← canonical code (tg-progress.mjs pattern)
scripts/skills/common/          ← canonical skills (one SKILL.md each)
bots/memory/<bot-id>.md         ← NEW: per-bot memory file (repo-owned)
bots/memory/USER.md             ← NEW: shared user profile (repo-owned)
scripts/check-capability-propagation.mjs  ← gate: orphans + vendor drift
tools/telegram-provider-router/src/*.vendor.mjs ← mirrors, never hand-edited
~/.hermes/shared_skills/        ← RESTORED symlinks/copies of canonical skills
```

Rules:

0. **Bot = location, execution surface = runner, provider/model = backend.** A bot id names a *place* (vm = VPS, mobile = phone, collab = Colab, hermes_* = gateway). The runner is a per-message choice via `/model` + `/freemodel` (`parseModelRef`), not an identity. There is no Cline agent and no Gemini agent. Gemini, Token Harbor, and other APIs are backends behind the selected runner. A surface that cannot honor session, memory, the typed ticket, or the crash receipt is marked degraded. The optional Cline adapter is degraded for resume (CLI 3.0.65). API-only backends declare no live tools and no session. Gaps are BOT-12…21, never a new bot per vendor.

1. **Memory is retrieved, not dumped.** Stores are `decisions/`, `dead-ends/`, and `facts/`, plus shared `USER.md` under the existing caps. A build, investigate, or decide turn retrieves matching rows. Other turns inject nothing. Do not auto-append a `/compact` summary. Hermes reads the same `USER.md`. Boot health gate: missing, over-cap, or stale produces a receipt (BOT-13).
2. **Sessions behind one contract.** `sessions.json` per chat stays. Every supported surface writes a resumable id and continues from the compact handoff. A surface that cannot is degraded. The router moves from one global session to per-chat when that work is scheduled. `/new` resets the chat id. It does not erase the three stores.
3. **One learning loop.** Repo `failure-log.mjs` is the writer on every surface. Each dispatch adds one outcome row (ticket, surface, provider/model, defect class, tokens, wall-clock, outcome). The pre-action gate reads it in code. Hermes `bot-failures.jsonl` is a reader. A prompt footer is not the gate (BOT-15).
4. **Skills sync both directions with a gate.** Fix the two dead
   `shared_skills` paths (symlink to repo skills or copy + check). Extend the
   checker (or a small `check-hermes-parity` step on the Mac) to fail when a
   canonical skill is missing box-side.
5. **Soul per bot class.** One short `bots/soul.md` (or per-id override),
   injected like memory. Stops verbose drift and makes "sounds like us"
   testable.

## 3. Phased plan (each phase = one shared change, all agents inherit)

- **P1 — history:** quote text shipped. Session resume is the shared contract above. Do not probe a vendor `--id` as the next task.
- **P1.5 — `/tx` work sessions:** one on-demand work session per active
  location/chat/workspace, shared by every execution surface. `tx on` enables
  shared visibility, `tx off` hides it without stopping work, and `tx status` /
  `tx debug` inspect the active session. Generic `/debug`, `/handoff`, and
  `/abort` are backend-independent. tmux is only the live-terminal adapter where
  the selected runner supports a TTY; API-only providers expose structured
  events/transcripts and honestly report that live attach is unavailable.
  One location maps to one tmux session; each bot/workstream maps to a window,
  not a new top-level tmux session. `/status` reports work-session, execution
  surface/provider, controller, and debug capability. Shared observation is the
  default; input is serialized so bot and human do not interleave PTY writes.
  BOT-18 consumes this contract for watchdog/recovery.
- **P2 — memory:** BOT-13 retrieved stores. Same prompt path for every surface. No per-vendor memory file.
- **P3 — skills bridge:** restore `shared_skills` paths + parity gate.
- **P4 — learning:** BOT-15 outcome row + code gate. The weekly job archives logs.
- **P5 — soul:** `bots/soul.md` + injection.

Next code is BOT-18 (receipt + 409 exit), then BOT-20 (typed `work_item`). P2–P5 follow the roadmap order. One shared change per step.

## 4. The three systems (reviewed 2026-09-24 + literature)

### 4a. Soul — composed, not copied

Problem: a feature change (e.g. "tables go via JSON pipeline") must reach
every bot's instructions at once; per-agent souls fork on the first edit.
Hermes already layers (default template → user `SOUL.md` → per-profile).

Design: `bots/soul.md` = shared base (identity + reply-shape rules).
Per-capability usage lines live IN `bots/capabilities.json` as a `soul`
field (one line per capability, e.g. chat-table: "Tables: emit the JSON
block, never pipe tables"). Compose at prompt time:
`shared base + soul-lines of done capabilities + bots/soul.<id>.md override`.
The checker verifies every done capability's soul line is present in the
composed soul — editing a feature updates one line, all bots inherit.
Hermes `SOUL.md` stays the wording source (import, never fork).

**Scaling without spaghetti: namespaced containers.** As the soul grows, free
text rots — every edit risks touching unrelated instructions. So the composed
soul is namespaced sections, each owned by exactly one editor:

```
[shared:identity]      ← bots/soul.md (who the bot is, reply shape)
[shared:memory]        ← bots/memory/* injection (facts, profile)
[cap:chat-table]       ← capabilities.json soul lines, one container per cap
[cap:ui-progress]
...
[bot:vm]               ← bots/soul.<id>.md override (location quirks only)
```

Rules that keep it clean: (1) no raw text outside a container — the composer
rejects it; (2) a capability edit may touch ONLY its own `[cap:<id>]`
container; (3) `[bot:<id>]` may narrow but never contradict shared sections
(checker fails on contradiction markers, e.g. restating a capability rule
differently); (4) each container carries a line budget (base ≤ 20 lines, each
cap ≤ 2 lines, override ≤ 10) so growth is visible and reviewable; (5) the
composer logs the container list per prompt in debug mode, so a bad behavior
traces to exactly one owner. Complexity scales as sections, never as one
long prompt nobody dares to edit.

### 4b. Learning — the missing process, now specified

Existing pieces (verified): `recordFailure` (but opencode-lane only),
`review-failures.mjs` (manual, never scheduled), VPS log HAS rows, Mac log
empty, learnings scattered (`specs/learnings/`, picker catalog, nowhere).
Literature shape (ESAA: mechanical capture, judgment only for curation):

1. **Record (automatic):** all lanes + delivery + crash paths call
   `recordFailure` (extend beyond opencode lane). Never throws, never blocks.
2. **Merge (automatic, scheduled):** weekly job pulls the VPS log next to the
   Mac log; `review-failures.mjs --threshold 2` groups by signature.
3. **Curate (agent-assisted):** each LEARN-flagged signature must produce one
   durable artifact — sensor test, checker rule, skill line, capability soul
   line, or memory-footnote. No artifact = the process failed, not the agent.
4. **Share (automatic):** artifacts land in git (tests/skills/soul/memory) so
   every host inherits via pull. Host-local logs never need to sync beyond
   the weekly merge.

### 4c. Auto-healing — detection ladder + bounded recovery + repair on demand

**Tracking substrate first (audited 2026-09-24): what exists, what's missing.**
Exists but scattered: bot-host in-memory `health{okAt/errAt}` (lost on
restart, not exposed), `totals.json` (cost/tokens per bot), `sessions.json`,
opencode-lane failure rows, Hermes `dispatch_audit.log` (deploy records) +
`learning_pod.json` (tool stats) + cron `executions.db`. Missing everywhere:
a per-run record. So crash/pending/error is NOT automatically known anywhere
— it is inferred by a human reading journals. Literature (Red Hat/Elastic/
Databricks/Arize observability, all 2026) agrees on the shape: traces of
every step, grouped by session, outcome recorded at the workflow boundary,
diagnostic signals (tool failures, retries, latency, cost) attached, prompts
stored separately from the ledger. Our local-first version:

- `runs.jsonl` (host-local, one schema, append-only):
  `{run_id, bot, lane, chat, model, started, ended, outcome, latency_s,
  tokens, cost}`. Written OPEN at run start (this doubles as the Playbook-B
  lease), closed at `finish()` with `ok|timeout|abort|error`. Any row still
  OPEN at boot sweep = `crash` — closed then, TG message finalized, failure
  row written. Crash/pending/error becomes a query, not an investigation.
- Liveness: poll-loop heartbeat per bot (last `getUpdates` timestamp + last
  reply timestamp) beside the ledger; systemd owns the process, the ledger
  owns the truth about work.
- Weekly merge (same job as the failure-log merge): all hosts' `runs.jsonl`
  + failure rows in one place. The review reads crash rate, p95 latency,
  error signatures — investigation triggers fall out of data, not vibes.

Existing: systemd `Restart=always`, run timeouts (bot-host `timeoutMs`,
router `OC_IDLE_MS`/`OC_MAX_MS`), lane failover, 409 handling (open item).
Literature (Samsung reliability-threshold framework; Cloudflare durable
recovery; heartbeat zero-LLM watchdog; SelfHeal fix+critic pair; real-time
derailment watchdog):

- **L1 process:** systemd + 409 loud exit (already/queued). No LLM involved.
- **L2 run watchdog (zero LLM):** the progress event stream IS the telemetry —
  add stall timer (no events > N s), error-cascade counter, repeat
  fingerprint (same tool+args ×3). Nudge = inject "try a different approach"
  into the run; max nudges → abort with terminal message (never a raw stack).
- **L3 bounded recovery:** retry / continue-with-summary / failover lane,
  with a budget (max 2 recoveries per turn, then terminalize). Partial output
  is preserved, never discarded.
- **L4 repair on demand (not a standing agent):** a twice-flagged signature
  spawns one investigatory run shaped like the literature's fix+critic pair —
  fix proposes, critic checks, output is a patch or a bug card, and the
  signature's learning artifact closes the loop so it never reproduces.
  Schedule: weekly alongside the failure review, plus manual trigger.
  Auto-repair that actually works repairs CONFIG first (failover, restart,
  throttle — automatic, bounded, measured) and code second (triggered run →
  patch → existing review/CI, never autonomous commit). Rationale from the
  field: half of automated recovery moves do nothing (Boucle 220-loop
  dataset) — so every rung logs its hit rate and dead rungs are removed;
  Cloudflare-style budgets keep recovery from becoming a second loop.

**Playbook A — agent stuck a long time (progress message spinning, no answer).**
Verified constraint: our runners are single-shot CLI calls, so mid-run
steering is impossible — every rung below is kill-and-resume shaped, and the
ladder (nudge → replan → escalate → reset → handoff → abort, cf.
agentpatterns.ai stuck-loop recovery, LangChain LoopDetectionMiddleware,
Anthropic progress-file reset) adapts accordingly:
  1. *Detect:* progress metric flat across N heartbeats while activity
     continues (same tool+args ×3 = repeater; tool churn with no goal movement
     = wanderer; A↔B alternation = looper). Activity volume alone never
     triggers — it rises in stuck loops too.
  2. *Rung 1 — resume-with-note:* kill child, resume session with one injected
     line naming the observation ("you edited X 3× without passing tests —
     try a different approach"). Cheapest perturbation; often suffices.
  3. *Rung 2 — replan:* kill, resume forcing a structured step (restate goal,
     list tried, propose new plan) before any tool call.
  4. *Rung 3 — escalate:* failover lane / stronger model / higher thinking
     (existing `runWithModelFailover`, now as a recovery move, not just quota).
  5. *Rung 4 — reset:* `/new` from the compact summary (never raw history),
     plus git revert of the run's file changes (Anthropic canonical reset).
  6. *Rung 5/6 — handoff then abort:* terminal message states what was tried
     and what to send next; failure recorded with the stuck signature.
  Bounds: max 3 attempts per rung, max 2 recoveries per turn, hard iteration
  cap as backstop; every rung's hit rate is logged so dead rungs get removed
  (Boucle: half of automated recovery moves do nothing — measure, don't trust).

**Playbook B — crash shown as "pending" on TG (the ⏳ message that never ends).**
Traced 2026-09-24: graceful ends (abort/timeout/SIGTERM drain) call
`renderer.finish()` and close the message; a hard death (crash, SIGKILL, OOM)
never runs `finish`, so the progress message says "working…" forever and the
user gets silence. Fix:
  1. *Run lease:* at run start, write `{chatId, messageId, startedAt, pid}`
     to the session store; delete on `finish`. A lease without a finish IS the
     crash detector — no second process needed.
  2. *Boot sweep:* on startup, each bot lists stale leases (startedAt older
     than the boot) and edits each orphaned progress message to a terminal
     state ("the bot restarted mid-run — nothing was computed, send it
     again"), then clears the lease. Silence becomes a receipt.
  3. *systemd* (`Restart=always`, 5s) restarts the process; the sweep runs
     before polling resumes, so recovery lands before new work.
  4. *Learn:* the sweep writes a `crash-pending` failure row; two of the same
     signature trigger the L4 repair run (was it OOM? which lane? growing
     memory?) instead of a third silent restart.

## 5. Prior art reviewed 2026-09-24 — what the field validates, what to steal

Sources: TG Bot API rate-limit studies (Jan 2026), grammY/PTB production
practices, ESAA-Conversational (arxiv 2606.23752), PROJECTMEM (2606.12329),
Shared Selective Persistent Memory (2607.09493), Kairo, passbaton, OpenAI
Agents SDK session-memory cookbook, TG UX practices.

**Already aligned (keep):** long-polling for single-instance (webhook only wins
>30k msg/h — correctly not our problem); 429-honouring backoff; per-chat
1 msg/s pacing; `/abort` (= industry `/cancel`); progress lines + completion
notice; copy buttons over retyping; disk-persisted sessions (= "save progress
between sessions"); cooperative file leases (≈ Kairo `kairo_lease`, no
consensus needed); bots-can't-see-bots ⇒ file-claims coordination (matches
platform constraint, not just our choice).

**Steal — memory design (sharpens P2/P4):**
- *Selective > full history (96% vs 71% task completion).* Persist task specs,
  decisions, tool configs, output constraints; DISCARD reasoning traces.
  Consequence for BOT-12: cline resume should inject the compact summary, not
  raw history — raw replay actively degrades.
- *Handoff as entry contract* (ESAA): `/compact` output must be goal + state +
  files-to-read-first, sized (tiny ~1500 / normal ~4000 / deep ~20000 chars,
  cf. Kairo brief modes), so any cold agent (even another lane) can continue.
- *Memory-as-Governance* (PROJECTMEM): deterministic pre-action gate — warn
  before repeating a logged failed fix or touching a known-fragile file.
  Our `file-locks` + `failure-log` are 80% there; the gate is the missing 20%
  (BOT-15).
- *Mechanical capture, judgment only for curation* (ESAA): turns/failures log
  automatically; the agent curates only decisions. Maps to auto failure-log +
  manual `/remember`.

**Steal — transport (new items, file as follow-ups):**
- *Proactive throttling:* Bot API 7.8+ returns `X-RateLimit-Remaining`; slow
  workers ~20% when remaining < 5 instead of waiting for 429
  (`scripts/lib/tg-api.mjs` + `tg-throttle.mjs`).
- *409-conflict loud exit:* a second poller on a token must `process.exit(1)`
  with a clear log, not silently fight over offsets (BOT-5 is registry-level;
  the runtime has no 409 detection — verified 2026-09-24).
- *Abandoned-task nudge:* industry UX practice; only Hermes (cron) could do it —
  repo bots are reactive-only. Hermes-side item.
- *Defensive AI parsing:* validate nested fields of every CLI JSON event
  before reading. Audit every surface adapter, not one vendor parser.

**Adopted 2026-09-24 (literature review, written into `plan/ROADMAP.md` Bot side):**

Keep: script orchestrates; one writer; one defect per card; selective handoff; artifact keys on the card.

Add, in execute order:

1. **BOT-20 typed `work_item`.** Free-text `--task` is not a dispatch payload. Tech10 (Mar 2026): an untyped handoff is the cascading-failure surface. Anthropic's multi-agent note (Jun 2025): objective, format, boundaries, and tool guidance travel as fields.
2. **BOT-21 coordination tax.** Log `(ticket, agent, tool, args-hash)`. Same hash twice on one ticket alerts. Two repro verdicts must match or escalate. ProveAI (May 2026).
3. **BOT-13 retrieval.** Decisions, dead-ends, facts. Precision-gated injection. Boot health gate. False-fire count. Helwig arXiv:2609.05510 (78,933 hooks; 84 of 85 failures in the first three weeks; zero false-fires on the ten-day precision instrument). Do not inject the whole memory file. Do not stand up a second vector service in this ID; lexical retrieve-by-ticket is enough until a measured miss says otherwise.
4. **BOT-18 first code.** Lease, boot sweep to a receipt, `process.exit(1)` on 409. Before any new capability.
5. **V-30.3 verify rule, binding now.** The card's `verify` check closes it. Journey green does not.
6. **BOT-15 outcome row.** The gate reads surface, provider, defect class, tokens, wall-clock, outcome. That is the cost brain. It replaces a fixed vendor chain.
7. **Executable surface.** Handover top + this order + one packet. History stays in the long files and is not loaded whole.

Anthropic, *Building Effective Agents* (Dec 2024): this workload is a workflow (pack → repro → plan → code → verify). An LLM orchestrator would add coordination tax on a depth-first queue. The Jun 2025 multi-agent result (90.2% over single-agent) was a breadth-first research task. It is not a reason to add coordinating models here.
