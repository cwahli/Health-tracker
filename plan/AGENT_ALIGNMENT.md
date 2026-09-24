# Agent Alignment: Hermes parity gap matrix + target architecture

Audited 2026-09-24. Goal: every agent starts from at least the Hermes baseline
(read previous messages, own memory file, learn) and all future fixes land
once, everywhere (Case H ladder, plan/RELIABILITY.md §14.6).

Legend: ✅ has · ❌ missing · ⚠️ partial/diverged · (design) = intentionally different.

## 1. Gap matrix — what Hermes has that others don't

| # | Capability | Hermes (Mac gateway) | VPS bot-host (vm/opencode/vm2) | Mobile | Grok TG router | Collab |
|---|---|---|---|---|---|---|
| 1 | Per-chat conversation history | ✅ SQLite sessions + messages, runtime `conversation_history` | ✅ opencode lane only (`--session`, disk `sessions.json`); ❌ cline lane (`sessionID:null` hardcoded); ❌ gemini lane | ✅ same code as VPS | ⚠️ ONE global session shared by all chats (bleed) | ❌ (design: GPU tunnels) |
| 2 | TG reply-quote in prompt | ? (dispatcher unconfirmed) | ❌ `reply_to_message` never read | ❌ same code | ❌ | ❌ |
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

Headline result: the highest-value gaps are #1 (cline lane), #2 (reply-quote),
#3 (memory file), #5 (soul), #7 (skills bridge — actively broken, not just
missing), #6 (two learning loops that never meet).

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

0. **Bot = location, lane = tool.** A bot id names a *place* (vm = VPS,
   mobile = phone, collab = Colab, hermes_* = gateway). The lane
   (`opencode` CLI with tools+session, `cline` CLI with tools+thinking,
   `gemini` keyed API single-shot) is a per-message tool choice via
   `/model` + `/freemodel` (`parseModelRef`), not an identity. Every lane
   honors the same contracts — session, memory, headline, commands,
   skills. Where a lane *cannot* (gemini: no tools/session by
   construction), the picker must say so instead of silently degrading.
   Lane-parity gaps are tracked as BOT-12…17, never as per-bot exceptions.

1. **Memory files are repo-owned, agent-written.** `bots/memory/<id>.md`
   (+ shared `USER.md`) load into every bot-host prompt like today's handoff
   brief, and grow via `/remember <fact>` + auto-append of the `/compact`
   summary. Hermes keeps its own store but READS the same `USER.md` so the
   profile can't fork. Cline/gemini lanes get the same injection (prompt-level,
   no runner changes needed).
2. **Sessions behind one contract.** `sessions.json` per chat stays; cline
   adopts `--id` resume into the same file; router moves global→per-chat when
   scheduled. The contract (per-chat id, disk-persisted, `/new` resets) is
   identical even though runners differ.
3. **One learning loop.** Repo `failure-log.mjs` is the writer; Hermes
   `bot-failures.jsonl` becomes a reader (or vice versa — decide once).
   `review-failures.mjs` output goes somewhere every agent's prompt can see
   (memory file footer is the cheap option).
4. **Skills sync both directions with a gate.** Fix the two dead
   `shared_skills` paths (symlink to repo skills or copy + check). Extend the
   checker (or a small `check-hermes-parity` step on the Mac) to fail when a
   canonical skill is missing box-side.
5. **Soul per bot class.** One short `bots/soul.md` (or per-id override),
   injected like memory. Stops verbose drift and makes "sounds like us"
   testable.

## 3. Phased plan (each phase = one shared change, all agents inherit)

- **P1 — history:** cline `--id` resume + `reply_to_message` inclusion
  (both `scripts/lib`, all bot-host agents inherit; router per-chat later).
- **P2 — memory:** `bots/memory/` + prompt injection + `/remember` (prompt-level:
  works on opencode/cline/gemini lanes with zero runner changes).
- **P3 — skills bridge:** restore `shared_skills` paths + parity gate.
- **P4 — learning:** unify failure logs; review output → memory footer.
- **P5 — soul:** `bots/soul.md` + injection.

P1 is proposed next (needs one live probe to find the cline session id).
P2–P5 are recorded here so they get built on these rails, not as five
one-agent patches.

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
  before reading (`mapClineEvent` does some; audit the rest).
