# Journey graph (the process)

**You:** one sentence, then **go** or **stop**.  
**The system:** Planner → Guard → (you) → Builder → Guard → Reviewer (on fail or when you ask).

This is the aggregation of harness / loop / graph / skills / standing invariants. It replaces you locking files, and it replaces one-off “don’t overwrite compare” reminders.

Triggers: `review and improve the food log journey` · `learn from meal log and apply to compare` · `include nutrition targets on log and compare`.

This graph is **not** AI Studio-only. Same files on every surface:

| Surface | Always-on | Skills | Guard |
|---------|-----------|--------|--------|
| **Grok (here)** | `AGENTS.md` | `.agents/skills/*` (auto) | `journey-guard.mjs` |
| **Antigravity / Gemini** | `AGENTS.md` + `GEMINI.md` + `.agents/rules/journey.md` | same `.agents/skills/*` | same script |
| **AI Studio** | `AGENTS.md` (mounted) | load map names the skills; Studio may not auto-discover them | same script |

Chat does not carry over between tools. A packet in `specs/active/` and a checkpoint in `specs/checkpoints/` do. If Antigravity starts a compare journey Grok already packeted, it must **read the existing packet**, not write a second plan.

---

## Why this shape (Harness Engineering + SHEPHERD 2026)

| Idea | Source | What we take | What we skip |
|------|--------|--------------|--------------|
| **Harness Engineering** | Mitchell Hashimoto, Fowler, OpenAI | **Agent = Model + Harness**. 6 layers (Guides, Sensors, Loop, Memory, Permissions, Observability). **The Ratchet**: every bug leaves a test + standing row. | Pure prompt engineering; prompt inflation |
| **Reversible Substrate** | Stanford SHEPHERD (2026) | **Git execution tree**: `[observe]` event stream, `[revert]` dirty state on fail, `[fork]` clean counterfactual hypothesis without compounding errors (>95% prompt cache reuse). | Heavy Docker containers |
| **Maker ≠ Checker** | Osmani / Martin Fowler | Maker ≠ checker; state on disk; stop when a script says so | You prompting every step; nightly cron |
| **Topological Graph** | LangGraph (Chase + Weiss) | Fixed wiring; **you are one node**; repair only the failing node | LangGraph framework rewrite; 100-agent swarm |
| **Standing Registry** | Incident memory | Countless incidents become **rows** in `standing.json`. Guard enforces all of them every time. | A new process doc per bug |
| **Procedural Graphs** | Google / Lu et al. (2026) | **Active-node micro-graph**: step-level guidance, local sensor gates, and **Negative Rejection Cache** (`specs/rejected/`) to permanently prune burned hypotheses across sessions. | Dynamic online self-rewriting of Guard code |

**Guard is a script, not a model.** An LLM checker will agree to swap compare onto the log pack. `scripts/journey-guard.mjs` will not.

```text
 you: one sentence
        │
        ▼
 [Planner]   skill: planner. Read-only. Queries specs/rejected/. Writes specs/active/<slug>.md (micro-node DAG)
        │
        ▼
 [Guard]     node scripts/journey-guard.mjs   (standing + spec-diff)
        │ packet must not already violate standing
        ▼
 [YOU]       go | stop | one comment
        │ go → packet status: locked
        │ ROADMAP Current work + auto_go: true is already go (2026-09-17)
        ▼
 [Builder]   skill: builder. Checkpoint saved: checkpoint/<slug>/start
        │ executes node-by-node with local sensor gates
        ▼
 [Guard]     standing + spec-diff + packet vitest (Sensors)
        │
        ├── fail → SHEPHERD [revert] dirty state & [fork] clean 2nd hypothesis → Guard
        │          second fail → [Reviewer / Learner] (contrastive diff) → you
        ▼
 COMPLETE    packet → specs/done/
        │
        ▼
 [Reviewer]  (Learner Agent): compiles specs/learnings/<slug>.md
             writes burned hypothesis to specs/rejected/<slug>.json
             proposes standing triplet + sensor test (Hashimoto's Ratchet)
        │
        ▼
 you: promote | skip
        │ promote → standing.json grows; error is permanently blocked
        ▼
 [Guard]     standing may only grow
```

---

## The roles

| Role | Who | Writes | Must not |
|------|-----|--------|----------|
| **Planner** | LLM | draft packet only (checks `specs/rejected/`) | `src/`, instructions, schemas, tests |
| **Builder** | LLM | `allowed_files` (step-by-step on active node) | `standing.json`, Guard scripts, Frozen files, whole-file instruction replace |
| **Guard** | `journey-guard.mjs` | nothing | “fix” a fail by editing standing or tests |
| **Reviewer** | LLM | `specs/learnings/*.md` and `specs/rejected/*.json` | `src/`, standing, Guard, tests, in the same turn |
| **You** | human | **go** / **stop** / **promote** | file lists, YAML, locking |

Skills: `.agents/skills/{planner,builder,guard,reviewer}/SKILL.md`.

Reviewer is the *compile learning* node (Ichigo layer 6 / loop “turn failure into infrastructure”). It is not a second Guard. An LLM must not be allowed to edit the script that says fail. After **promote**, a new packet may *add* a standing row or a skill line; Guard still has to pass.

---

## Standing registry (how “countless examples” stop)

Source of truth: `docs/agent/standing.json`.

Each incident becomes a **row** (journey identity or must-keep feature). Guard reads every row on every run. You do not re-ask for nutrition targets; they are a feature row. You do not hope compare survives “learn from log”; they are sibling journeys whose instruction files must stay distinct.

When something new vanishes or gets swapped:

1. Planner packet may add a standing row (Allowed: `docs/agent/standing.json` only).
2. You **go**.
3. Guard now fails any future Builder that drops it.

Do not keep must-keeps in chat.

---

## “Learn from X”

Planner sets:

- Destination = the journey you are improving (compare).
- Source = the one to learn from (log).
- Frozen = **both** instruction files + both schema exports + `standing.json`.
- Plan = extract the mechanism (e.g. inject `buildNutritionTargetStatus` on the live call). Never `import { scoutSystemInstruction as compare }`.

If Builder still swaps packs, Guard fails `siblings_distinct` / `food_compare_instruction_missing`.

---

## Packet

`specs/packets/TEMPLATE.md` → `specs/active/<slug>.md`.

Must include standing features that apply, Frozen sibling instruction/schema, and:

```text
node scripts/journey-guard.mjs <slug>
```

plus named vitest from `DOMAIN_REGRESSION_MAP.md`.

---

## Your loop

```text
review and improve the compare meal journey. learn from meal log. keep nutrition targets.
```

Wait for the packet. Reply **go**. That is the whole human process.

---

# Unattended loop (hours, not “all bugs”)

You can leave a run overnight. That does **not** delete every bug. Feature-level agents still fail most real features (FeatureBench: even a strong model is ~11% resolved on full feature tasks). What an unattended loop *can* do is burn **gated classes** while you sleep, so you merge in the morning instead of sitting in the chat.

Babysitting today is mostly **agent-induced**: compare overwritten, targets dropped, god-file rewrites. A longer unattended run **without** Guard makes that worse. The loop is the same graph with auto-**go** only when a gate already exists.

```text
[Discover]  node scripts/discover-gated-work.mjs
                 │  only standing FAIL / named vitest red / ROADMAP ID with a gate
                 ▼
[for each item]  worktree  journey/<id>
                 checkpoint save
                 auto-lock packet (Frozen from standing)
                 Builder (one class)
                 Guard
                    fail ×2 → Reviewer learning → skip item (do not retry-until-green)
                    pass → commit on the branch, leave for morning merge
                 restore checkpoint if standing would go red
[Stop]      budget (N items or T hours) or queue empty
```

## Auto-go vs still you

| Auto-go (unattended) | Still you |
|----------------------|-----------|
| Standing FAIL (restore/re-wire) | “Learn from meal log” |
| Named vitest red for one class | Anything touching `App.tsx` / jobs / LogChat |
| ROADMAP ID that already lists a gate | New journey, new product behavior |
| Fingerprint / `assert-spec-diff` red | No named test yet |

If there is no gate, Discover prints `(none)`. **Do not invent a night job.** First promote a standing row or a vitest (Reviewer → **promote**). Then the loop can eat it.

## Rules the night run cannot break

- Same Guard. Same standing. Standing may only grow, and only via a **promote** packet you already approved, not at 3am.
- One worktree per item. Never two Builders on `server_food_analyze_run.ts`.
- Two failed repairs → skip, write a learning, next item. No `POST /loop`.
- Kill switch: delete the branch / stop the process. Budget in the packet (`max_items`, `max_hours`).
- Morning: you merge green branches. You do not reconstruct wiped instructions — checkpoints are there.

## How this gets rid of *your* babysitting

1. Convert a repeating pain into a standing row or named test (once).
2. Discover queues it.
3. Night Builder + Guard.
4. You review the diff, not the 40-message chat.

That is loop engineering on top of the graph. It does not replace judgment on Apply, handoff, or “does this meal feel right.” Those stay human. It does stop you from re-asking for nutrition targets and from fishing compare instructions out of memory.

Discover now:

```text
node scripts/discover-gated-work.mjs
```

If it prints `(none)`, the next hour of agent time should be **adding a gate**, not coding.

## Basic bugs (display, math, missing/extra, load fail)

These are not “try harder overnight.” They map to Guard budget 2 (QUALITY.md pyramid). No Gemini.

| What you see | Automatic check | When Guard runs it |
|--------------|-----------------|--------------------|
| Failed loading / crash | Playwright `pageerror` + R-3 smoke | `src/components/**` or `App.tsx` in the diff |
| Tab / composer / card missing | `key-journeys.spec.ts` (nav ids) | same |
| Extra Retry / Attempt / duplicate controls | `dialog-inventory.spec.ts` | same |
| Card kcal ≠ ledger | dialog inventory stub kcal | same |
| Wrong calculation | `server_derivation.test.ts`, meal gate, SI locks, `nutritionTargetStatus.test.ts` | derivation / convert / expand files in the diff |
| Nutrition targets gone | `standing.json` + fingerprints | every Guard |

`node scripts/assert-shell-smoke.mjs` is the UI pack. `journey-guard.mjs` starts it when UI files changed (or `GUARD_SMOKE=1`). Live Gemini stays budget 3 — once, human or script, not the inner loop.

A bug with **no** locator and **no** number still needs one test added (Reviewer → promote). After that, unattended runs catch it. There is no general “make the UI look right” agent that is cheaper than a stub.

### Quota / egress lockout (the 6GB class)

This is not a display bug. It is **unbounded pull or poll**. RELIABILITY.md §9: historical spikes were `SELECT *` + base64 in rows + full history on every reload (2.4–2.7 GB days; you hit ~6 GB and lockout).

Guard class `EGRESS_BOMB`: `node scripts/assert-egress-bomb.mjs`

- No `food_logs.select('*')` / `biomarker_logs.select('*')` on the pull path
- `lastSyncTime` on client pull; full pull only on force
- Job poll only if `hasActiveJob`
- Direct client Supabase stays **disabled** (proxy / D1 / R2 only)

Runs automatically when sync / `App.tsx` / JobSync files change. Unattended Builder cannot COMPLETE a “fix” that reintroduces a full table download. That is the same standing pattern as nutrition targets: asked more than once → a row, not a chat reminder.

---

# Worked example (end to end)

This is the incident that used to wipe compare and drop nutrition targets. Same sentence; new graph.

## You type (and stop)

```text
review and improve the compare meal journey. learn from meal log. keep nutrition targets.
```

You do not list files. You do not lock YAML.

---

## 1. Planner (read-only)

Loads `standing.json`. Destination = `food_compare`. Source = `food_log`. Standing feature `nutrition_targets` applies even if you had not said “keep.”

Writes `specs/active/compare-learn-from-log.md`:

```yaml
id: compare-learn-from-log
status: draft
skill: food-calc
edit_mode: patch
allowed_files:
  - server_food_analyze_run.ts
  - server_food_analyze_run_scout.ts
  - src/server/food/server_food_scout_source.ts
frozen_files:
  - prototype/meallog/compare/scout_only_compare_instructions.ts
  - server_vision_scout.ts
  - src/server/food/server_food_analyze_schema.ts
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - src/App.tsx
```

Plan (mechanisms only):

1. Keep compare instruction (`EVALUATION ONLY`, `allExtractedDishes`). Do not import `scoutSystemInstruction`.
2. Wire `buildNutritionTargetStatus` into the **live** `systemInstruction` passed to `runScoutRetryLoop` (already the standing row — keep it).
3. If log has a better *injection* pattern, copy that pattern onto compare. Do not copy the log pack.

Then:

```text
node scripts/journey-checkpoint.mjs save compare-learn-from-log planner
```

Stops: “Packet ready. Reply **go**, **stop**, or one comment.”

---

## 2. Guard (script)

```text
node scripts/journey-guard.mjs compare-learn-from-log
```

Standing must already be green. Packet is `draft` and no `src/` diffs yet → `PASS interrupt`. If Planner had already edited compare instructions, `interrupt_before builder` would FAIL.

---

## 3. You

| You | Graph |
|-----|--------|
| **go** | `status: locked`. Builder may start. |
| **stop** | Nothing merged. |
| **also freeze HomeTab** | Planner rewrites packet once, Guard again, then **go**. |

---

## 4. Builder

```text
node scripts/journey-checkpoint.mjs save compare-learn-from-log builder-start
```

Patches only Allowed files. Legal: pass `resolvedScoutSystemInstruction` into `runScoutRetryLoop`. Illegal: replace compare instruction with log; drop `allExtractedDishes`; touch `App.tsx`.

**If Builder starts while still `draft`:** Guard FAIL `interrupt`. Restore:

```text
node scripts/journey-checkpoint.mjs restore compare-learn-from-log planner
```

**If Builder overwrites the compare pack anyway:** Frozen-file / standing FAIL. Time travel:

```text
node scripts/journey-checkpoint.mjs restore compare-learn-from-log builder-start
```

The old compare instruction is in the checkpoint, not “gone.”

---

## 5. Guard again

```text
node scripts/journey-guard.mjs compare-learn-from-log
npx tsc --noEmit
npx vitest run src/server/food/journeyFingerprints.test.ts src/server/food/server_food_scout_source.test.ts
```

Must still see `EVALUATION ONLY`, `allExtractedDishes`, `buildNutritionTargetStatus` on the live call, siblings distinct, diff ⊆ Allowed.

Fail once → Builder repairs **that node**. Fail twice → Reviewer.

---

## 6. Reviewer (only on second fail, or if you ask “what went wrong”)

Writes `specs/learnings/compare-learn-from-log-YYYYMMDD.md`:

- Class: `LEARN_FROM_REPLACE` or `FEATURE_DROP`
- Evidence: Guard FAIL id
- Propose standing row (add only)
- Restore command

Does not edit Guard or `standing.json` in that turn.

You: **promote** (tiny packet, standing grows) or **skip**.

---

## 7. COMPLETE

Packet → `specs/done/`. One HANDOVER line. Next session reads standing + done packet, not the chat. Nutrition targets are not “asked again”; they are a row. Compare is not “remembered”; it is a sibling journey Guard still fingerprints.

That is the whole system: one sentence, one **go**, checkpoints so a wipe is a restore, standing so a vanished feature is a FAIL, Reviewer so the next incident becomes a row instead of another retrieval session.

---

## Builder ≠ Tier-3 scorer

**Maker ≠ Checker** already covers code vs Guard. It also covers **live quality claims**:

- The agent (or packet) that **authors** a new compare/log method must **not** run or grade its own Tier-3 / live A/B and publish the win.
- Eval uses a **frozen ground-truth scorecard** (`golden/meal/.../correct_results.md` or named vitest), shared constraints (no dish-name spoilers), and preferably a separate surface/script owner.
- One-call “STEP 1..N” prose is not a gated procedural graph. Keep production Mode D monolith unless a packet proves multi-call gates.

