# Agent docs index

**Always-on:** root `AGENTS.md` (laws + load map only).  
**Load on demand** from the table in `AGENTS.md` §1.

| File | When to read |
|------|----------------|
| [PACKS.md](./PACKS.md) | Retired — execute `plan/ROADMAP.md` |
| [TEMPLATES.md](./TEMPLATES.md) | SELF-CHECK, GATE LOG paste format (IMPACT = locked spec file) |
| [JOURNEY.md](./JOURNEY.md) | **The process** (Studio + Antigravity + Grok). Planner → Guard → **go** → Builder → Guard → Reviewer |
| [BUG_PIPELINE.md](./BUG_PIPELINE.md) | **Bug lane**: states, roles, gates, §4.10 answers — ticket-first handoff for any card work |
| [standing.json](./standing.json) | Must-keep journeys/features. Guard enforces. Add a row when something was overwritten |
| [LOCKED_SPEC_PROCESS.md](./LOCKED_SPEC_PROCESS.md) | Packet internals (agent-written) |
| [DOMAIN_REGRESSION_MAP.md](./DOMAIN_REGRESSION_MAP.md) | Which tests/gates after a change |
| [domains/food-calc.md](./domains/food-calc.md) | Nutrition pipeline, modes A/D/Edit |
| [domains/biomarkers.md](./domains/biomarkers.md) | Catalog / pending / overlay / logs; named agents; write map |
| [plan/BIOMARKER_LIFECYCLE.md](../../plan/BIOMARKER_LIFECYCLE.md) | Biomarker architecture |
| [domains/sync.md](./domains/sync.md) | Firebase / Supabase / R2 multi-device |
| [domains/debug-contract.md](./domains/debug-contract.md) | Debug download as contract report (reliability pillar). F-8.13 / Q-8. **Durable truth** if ROADMAP/RELIABILITY §11 are shortened. |
| [../../scripts/opencode-bot.mjs](../../scripts/opencode-bot.mjs) + [../../bots/registry.json](../../bots/registry.json) | Telegram bot fronting opencode on the VPS (opencode-bot) |

## Document roles

| Location | Role |
|----------|------|
| `AI_HANDOVER.md` | WIP, status, multi-agent handoff (update freely) |
| `plan/` | Architecture & planned design (durable) |
| `specs/active/<ID>.md` | Locked per-ID contract (durable memory). Implementer must not edit |
| `AGENTS.md` + this tree | Process + domain guides (**protected** — confirmation + before→after) |

Rulebooks **guide** evolution; they do not ban it. Changing an invariant requires tests + rulebook update together.

**Commits/pushes to GitHub:** allowed after COMPLETE (`tsc` + named gates). AI Studio remains a valid ship path.

## Design goals

1. **Short always-on** — avoid context dilution and token waste.  
2. **Domain rulebooks** — food-calc, biomarkers, sync stay aligned as code grows.  
3. **Executable gates** — prose without tests will not stop cascades.  
4. **Regression suites (2026-08-09):**  
   - Sync: `src/utils/syncUtils.regression.test.ts`  
   - Biomarker identity: `src/utils/biomarkerIdentity.test.ts`  
   - Food merge/budget: extended vision/budget/portion/aggregation tests  
   See `DOMAIN_REGRESSION_MAP.md` smoke commands.
