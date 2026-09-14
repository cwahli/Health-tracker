# AGENTS.md — Always-on rules (keep short)

**Updated:** 2026-09-01

**Token rule:** Read **this file first**. Load domain files **only** from the table in §1. Do not open `plan/FOOD.md` Part A/B, `plan/QUALITY.md`, or old `AI_HANDOVER` history unless that table says so.

---

## 0. Do this every session (stops Gemini stalls)

1. **Read is free.** Never ask the human to approve, confirm, or say `continue` in order to **read** a file, log, photo, or doc — including this file and `docs/agent/**`. If a read truncates, immediately request the rest in the **same turn**.
2. **A question is not implement.** “How accurate is OCR?” / “review the prototype” = **answer**. Do not edit files, add tests, or run vitest unless the user asked to implement.
3. **Tests only if you changed application code** (`src/`, `server.ts`, `server_*.ts`, `agents/`, `supabase/`). Docs, reviews, and prototype-log reads: **run nothing**. Never `npm test` (~97 files). Named row from `docs/agent/DOMAIN_REGRESSION_MAP.md` only.
4. **Do not edit** `AGENTS.md` or `docs/agent/**` unless the human asked for a process change. Confirmation in §3 is for **edits**, not reads.
5. **Follow `plan/ROADMAP.md`.** There is no `studio/` pack folder. “Work on the roadmap” = **Current work**, then the next open ID. Do not invent a pack file. Do not mix F-9.5 (`App.tsx`) with F-10.
6. **Journey:** `docs/agent/JOURNEY.md`. Planner → Guard → **go** → Builder → Guard. Reviewer only after a second Guard fail or if asked — writes `specs/learnings/`, never standing/Guard/`src/` in that turn. **promote** = new packet. Standing: `docs/agent/standing.json` (do not drop rows to pass). Unattended night runs: only `scripts/discover-gated-work.mjs` items (must have a gate). Class S and questions skip.
7. **i18n (durable).** User-visible UI copy goes in `src/utils/translations.ts`. `en` is the source of truth; `id` must have the same keys (parity test). New languages: add a locale and fill keys; missing keys fall back to English. Agent system instructions must include `userProfile.language` and tell the model to write **user-visible answers** in that language (JSON keys, nutrient codes, biomarker keys stay English). Do not hardcode English chrome in new UI.

```text
plan/ROADMAP.md     = remaining work (the only execute file)
AI_HANDOVER.md      = short WIP board (update freely)
specs/active/<ID>   = locked contract for this ID (durable memory)
AGENTS + docs/agent = process (protected to EDIT)
```

**Surfaces (same graph):** AI Studio, Antigravity (Gemini), Grok here. Shared memory is **git** + `specs/` + `standing.json`, not the chat. Antigravity also reads `GEMINI.md` and `.agents/rules/journey.md` (pointers only). After COMPLETE (`tsc` + named gates + Guard), commit/push from any surface.

---

## 1. Load map

| Task | Read (stop there) |
|------|-------------------|
| Status | `AI_HANDOVER.md` (**header only**) |
| What to build | `plan/ROADMAP.md` matching ID |
| “review / improve / journey” | `docs/agent/JOURNEY.md` + `.agents/skills/{planner,builder,guard,reviewer}/SKILL.md`. Wait for **go**. |
| What went wrong / improve process | Reviewer skill → `specs/learnings/`. **promote** to grow standing, not to weaken Guard. |
| Standing (must-keep) | `docs/agent/standing.json` · `node scripts/journey-guard.mjs` |
| Food create / F-10 | `plan/FOOD.md` **Process** (stop at the module table) + `docs/agent/domains/food-calc.md` §1–1d |
| Food identity / catalog | `plan/FOOD.md` Part A + `FALSE_FRIEND` playbook — **not** F-1/F-2 USDA |
| Job session / preview vs debug (`STALE_TURN`) | `docs/agent/domains/sync.md` jobs + ROADMAP F-9.5 |
| Debug download / contract report | `docs/agent/domains/debug-contract.md` (reliability pillar truth). Execute F-8.13 / Q-8. Do not load QUALITY.md whole file. |
| Biomarkers | `docs/agent/domains/biomarkers.md` + ROADMAP Track B |
| Which tests | `docs/agent/DOMAIN_REGRESSION_MAP.md` **matching row** |
| What to implement | `plan/ROADMAP.md` **Current work** |
| Master scorecard | `golden/scorecard/instruction/README.md` then `WORKFLOW.md`. Run `npm run scorecard:debug`. Never `npm test`. Never edit `current/` or `result_summary/`. |
| `work bug` / `next bug` / `work 11` | **L15** below. Not a bare `continue`. |

Do **not** load: `plan/archive/**`, `archive/**`, root `ROADMAP.md` (stub), `plan/QUALITY.md` except §1.4, `FOOD_SINGLE_PATH.md` unless F-8.10/12/13. There is no `studio/`.

---

## 2. Coding laws

### L1 — Blast radius
Touch only files the task needs. Job-lifecycle files are **out of blast radius** for food-calc unless IMPACT names them **and** `src/jobs/__tests__/JobSession.contract.test.ts` is in the same commit: `src/jobs/JobStore.ts`, `src/jobs/SupabaseJobSync.ts`, `src/jobs/JobQueueRunner.ts`, `src/App.tsx` poller, `src/components/LogChat.tsx` submit / `loadJobMessages`, `src/components/TaskPlaceholderCard.tsx`, `src/components/FoodHistoryTab.tsx` job combine. FAIL example: `8742686`.

### L2 — Contracts
No breaking signatures without every call site in the same task.

### L3 — Finish the turn
Investigate and implement without pausing for “continue?”. Pagination of a file is not a pause — read the rest yourself.

### L4 — No stubs
Import without a correct-path call site = FAIL.

### L5 — Sibling paths
One path fixed ≠ done. Shared helper + all call sites, or known-broken in `AI_HANDOVER.md`.

### L6 — Preserve fields
Do not drop merge/construct fields unless scoped.

### L7 — Detect and repair the **class**
Not paint a meal green (`includes()`, alias, `expected.json`, `POST /loop`). See L14.

### L8 — Extract, don’t rewrite god files
No drive-by split of `App.tsx` / `LogChat.tsx` / `server_food_analyze_run.ts`.

### L9 — Rulebooks guide, don’t fossilize
Product evolution is allowed. If the pipeline changes, update the domain file **in the same change** as the code. Do not invent a silent second pipeline.

### L11 — Code changes only
When you **changed application code**: named vitest + `tsc`. Default model for any live Gemini call: `gemini-3.5-flash-lite`. `npm run build` is not how localhost picks up React (Vite, not `dist/`). If debug already has the new numbers and the card does not: class `STALE_TURN`, not food-calc.

### L12 — Prompt net-zero
Agent instruction edits stay net-zero lines. Math lives in TypeScript, not English. Schema: agent emits estimates; TS derives calories / unsaturated fat / salt.

### L13 — Roadmap IDs
After an ID’s named gate is green, start the next open non-Grok ID on `plan/ROADMAP.md` in the same turn. Do not ask the human to say continue. COMPLETE needs that ID’s named gate exit 0.

### L14 — No meal-green loops
Work item = class (`FALSE_FRIEND`, `DISH_DROP`, `STALE_TURN`, `ALWAYS_SECOND_AGENT`, …). Inner loop = named vitest. Forbidden: `POST /loop`, replay until `all_green`, catalog paint. Two burned hypotheses → STOP that job.

### L15 — Bug queue (only these phrases)
Triggers: `work bug` · `next bug` · `work 11` / `work #11` · Hand off that starts with `AGENTS.md L15`.  
Not L15: `continue`, `work`, pack phases.  
Live: `GET /api/bugs/next` (or `?mode=next` / `?n=11`). Drain **automatic** tape fails on `continue.active_line`. Named vitest for the class. `POST /attempts`. Do not `POST /loop` or paint `expected.json`. Detail: `plan/QUALITY.md` §14 if you are actually on a bug card.

### L16 — Feature Test & Debug Coupling (Case-by-case)
When implementing or updating features (new agent flows, dispatches, interactive dialog actions, or schema updates), integrate them directly into the testing and debugging framework:
- **Debug observability match**: Ensure the feature's states, dispatches, and UI components are represented in the Canonical Run Tree (`debugRunTree.ts`, `dumpContract.ts`) or dialog inventory so runs are immediately inspectable.
- **Testing & golden consolidation**: Identify where the feature naturally belongs in the testing framework (e.g., existing golden process tests, golden meal/biomarker suites, or Tier 2 Playwright stubs). Consolidate assertions into the **most relevant existing file** rather than spawning redundant, uncontrolled one-off test suites.
- **Scope**: Applied on a case-by-case basis. Pure cosmetic/copy tweaks (Class S) do not require debug or golden updates; substantive logic, pipeline, or UI interaction updates must have their matching debug and golden/test representation.

### L17 — Hashimoto's Ratchet & Reversible Loops (SHEPHERD)
Every bugfix must leave behind a deterministic Sensor (named unit/contract test) and grow `docs/agent/standing.json` via Learner (`specs/learnings/`) so the error can never recur. If a Builder attempt fails Guard, do not patch on top of dirty code: use SHEPHERD `[revert]` (`node scripts/journey-checkpoint.mjs restore <slug> <node>`) to snap back to the clean checkpoint before forking Hypothesis 2 (`[fork]`). Two failed attempts → STOP and escalate to Reviewer / Learner.

### L10 — COMPLETE (code only)
`tsc` + matching regression-map commands + the ROADMAP ID’s named assert if any. Skip all of that when no application code changed. Forbidden until then: “all done” / “fully verified.”

---

## 3. Protected docs (**edit** confirmation, never read)

**Protected to edit:** `AGENTS.md`, `docs/agent/**`, and `scripts/assert-*.mjs` **when changing what “pass” means**.

- **Read** them whenever the load map says so. No confirmation.
- **Edit** only if the human confirmed a before→after, or ROADMAP Current work names the file. Unrelated bugfixes must not touch them.
- Prefer `AI_HANDOVER.md` for status.

---

## 4. Change classes

| Class | Process |
|-------|---------|
| **S** | Copy/CSS; no IMPACT paste |
| **M** | Helper + named unit test |
| **L** | Food/biomarker pipeline; IMPACT + domain doc if invariants change |
| **X** | Sync/tombstones/protected **edits**; confirmation + IMPACT |

Questions and prototype reviews are not L/X.

---

## 5. AI Studio

Read `plan/ROADMAP.md`. Execute **Current work**, then the next open ID. Named gates on that ID only. Update `AI_HANDOVER.md` **Now** when an ID finishes. F-9.5 (`App.tsx`) is Grok-only — do not mix.
