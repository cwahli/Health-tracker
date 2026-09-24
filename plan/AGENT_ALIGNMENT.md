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
