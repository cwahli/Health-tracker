# Roadmap — start here

**This is the only execute file.** There is no `studio/` pack folder. Four architecture files sit beside this one. Do not add a fifth.

| File | What it is |
|---|---|
| **This file** | What is left, in order — AI Studio works **this file** |
| [BIOMARKER_LIFECYCLE.md](./BIOMARKER_LIFECYCLE.md) | Pillar 1 architecture |
| [FOOD.md](./FOOD.md) | Pillar 2 — Process (stop at the module table) |
| [RELIABILITY.md](./RELIABILITY.md) | Pillar 3 — infra / quotas + how we fix the site (working process) |
| [QUALITY.md](./QUALITY.md) | Pillar 4 — how we test (§1.4; process goldens §1.3 / **Q-8**) |

Laws: `docs/agent/domains/{biomarkers,food-calc,sync}.md`  
WIP: `AI_HANDOVER.md` (header only) · Completed: `archive/` · `plan/archive/`

**As of 2026-09-17.** Scorecard sealed ALL GREEN **713/0/0** (`golden/scorecard/result_summary/LATEST.md`). Q-9 extract-only shipped. F-11.2 / F-11.3 curator LLM shipped. Q-8.6 outer soak shipped. **Grok-only is retired** — locked packets in `specs/active/` are executable by any agent (Gemini / OpenCode / Cline / Antigravity). Do not reopen FDC or put curator back on Analyze.

---

## AI Studio — how to run (PRE-APPROVED)

The human will say **work on the roadmap**. That means:

1. Read **this file** from the top through **Current work**.
2. Implement the **first open ID** that is not `blocked_human`. Locked packets in `specs/active/` are **pre-approved go** — do not wait for Grok quota.
3. Named gates for that ID (below). Never `npm test`. Never ask to confirm a **read**. If a file truncates, read the rest in the same turn.
4. When that ID’s gates are green, **immediately** start the next open ID in this file. Do not wait for “continue.”
5. Stop when you hit `blocked_human` or context pressure (then write one line on `AI_HANDOVER.md` **Now** table: which ID finished).

Do **not** open `archive/`, `plan/archive/`, `FOOD.md` Part A/B, or old F-9 packs.

---

## Current work — Grok lock done; any agent executes packets (2026-09-17)

B0 / B7.4–7.6 / B8.0 / Q-8.6 / F-10.8 / Q-9 / F-11.2–11.3 are **shipped**. Do not restart them.

**Do this, in order. Packets are locked = go.**

1. **Q-4** — `specs/active/q-4-agent-result-table.md` (`auto_go: true`). Extract-only `KIT_DRIFT`. Any builder.
2. **Q-10** — `specs/active/q-10-dependency-audit.md` (`auto_go: true`). Hygiene only, after Q-4 gates green. Any builder.
3. **R-13.1** — `specs/active/R-13.md`. Code allowed now. **R-13.0** (Workers Paid, secrets, Firebase hosts) is `blocked_human` — do not invent secrets. Do not start R-13.4 / R-5 / a second Cloud Run go-live in the same PR.

**Still `blocked_human`:** **L-5** (no milestone locale), **R-13.0** checklist. **Do not start:** USDA, curator-on-Analyze, Q-9 rewrite binge, Header/`App.tsx` split without a new packet, ConfirmBar as a side quest.

**Gate:** `npx tsc --noEmit` · `node scripts/assert-biomarker-lifecycle-m31.mjs` · `npm run scorecard:debug` (sealed ALL GREEN 705/0/0 at `3ff047d`, `golden/scorecard/result_summary/LATEST.md`).

**Human ops DONE 2026-09-14 (site live, not Gemini):** Render serves `GET /api/scorecard/contract` (`live_origin` PASS in sealed run); `supabase/migrations/20260913_brand_menu_items_status.sql` applied to live Supabase by hand; Home Top Targets confirmed (sat fat over target red).

```text
                    ┌─────────────────────┐
                    │  4. Quality loop     │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   1. Biomarkers         2. Food              3. Sync
```

**Standing rules (every task)**

1. Work item = **one class**, not a job id or “make EMIS all-green.”
2. Inner loop = **vitest, no Gemini.** Outer = one frozen example.
3. Allowed files only (`QUALITY.md` playbooks).
4. Two burned hypotheses → STOP.
5. Honest residual (pending / unmatched / flagged / MISS) is success.
6. Ship after COMPLETE (`tsc` + named gates). IMPACT before coding.

Locked converts never change: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`.

---

## Which track now

| If you are… | Do |
|---|---|
| **AI Studio / Gemini / OpenCode / Cline (default)** | **Current work** above. Locked `specs/active/` packets. F-10 is shipped. |
| **Grok leftover** | **Retired 2026-09-17.** F-9.5 / F-10.6 / Q-8.1–8.6 / Q-9 / F-11 / F-12 / B8.1 shipped. Q-4 + Q-10 packets locked for any agent. Do not sit in a live wait loop. |
| Tests feel huge / every edit runs everything | **Q-7:** named map rows only. Do not `npm test`. Do not recreate missing asserts. |
| Food create architecture | **F-10** (one Meal Agent + TS expand). Not a Dietitian critic. |
| Food calories / debug file | **F-8.10, F-8.12, F-8.13** (split, packaged bind, debug). Soak is **F-10.8**, not a replay of always-dietitian. |
| Food identity still wrong | One **class** playbook (`FALSE_FRIEND` first). **Not** USDA. Brand catalog = **F-11**. Delete FDC = **F-12**. |
| Biomarkers | **B0** Apply smoke, then B2 leftover hygiene, then real G-B2. Chat UX = fill-template (one agent + TS batch), not 10 personas. |
| Site is slow | **R-8** measure (Q-1 is already green). Then R-9 defer. Not FoodCard/App splits first |
| Quota / egress spike | **R-1** measure, then only the matching R-id |
| Make the site live / Cloudflare | **R-13** — [RELIABILITY.md](./RELIABILITY.md) **§12**. Packet `specs/active/R-13.md` **locked**. R-13.1 any agent; R-13.0 human. Not R-2. Not Pages Functions importing `server.ts`. |
| Localisation leftover | **Active** — human unparked Track L 2026-09-15. Restore EN/ID packs (no invent); L-1…L-4 in progress; L-5 waits on named milestone locale. |
| Website / live-pass bugs | **Track S** below. One class, named vitest. Not the next live case. |
| New feature or update | [RELIABILITY.md](./RELIABILITY.md) **§10** gate table in the same change, then the F / B / L id. Do not start with a live case matrix. |

Do **not** start: putting curator back on Analyze, reopening FDC, Track R D1 (**R-5** / **R-13.4**), god-file rewrite to look done, a Commercial Cooking Critic LLM, a 10-case live replay queue, **L-5**, **Q-9** rewrite binge, inventing a catalog primitive. **R-13.1** is unlocked (packet locked); **R-13.0** stays human.  
Do **not** add a sixth plan file. F-10 lives here + [FOOD.md](./FOOD.md) Process.

---

## Agent Consolidation & Deprecation Strategy (2026-09-03)

The following multi-agent sprawl is scheduled for removal to streamline the architecture:

1. **Biomarker Agents Replacement**:
   - **Agents to be removed**: Lab Parser (`medical` / `agent1`), Range Calibrator (`data_review` / `agent5`), Categoriser (`agent2`), and Biomarker Reviewer (`biomarker_review`).
   - **Single Unified Replacement**: The new Biomarker Agent developed and benchmarked on the biomarker prototype (`prototype/biomarkers/` with cases C1–C7) will replace all four fragmented biomarker agents with a single-dispatch pipeline.
2. **Peripheral Agent Removals**:
   - **Agents to be removed**: Culinary Ideation Agent (`food_idea`) and Daily Actions Agent (`daily_recommendation`).
3. **Front Desk Routing Strategy**:
   - Plan all routing accordingly: Front Desk operates as the primary intake passation gateway and will route directly to:
     - **Unified Biomarker Agent** for clinical lab panels, blood tests, and reference range queries.
     - **Adaptive Meal Agent** (`food`) for all dietary logging and nutritional breakdown.
     - **Health Coach** (`health_baseline`) for metabolic baseline and lifestyle habit planning.
     - **Front Desk Inline** (`general_receptionist`) for direct profile updates, single vitals, and general Q&A.

---

## Track S — Site class-fixes (2026-09-04)

**Standing process for all new work:** [RELIABILITY.md](./RELIABILITY.md) §10. **This table** is only the 2026-09-03 live-pass burn-down. **Test method:** [QUALITY.md](./QUALITY.md).
**Do not** treat unrun live cases (C4, C6, UC-03 to UC-08) as a to-do list. They are examples for the class they hit.

Landed on GitHub `155a49a` (2026-09-04): empty-demo chat wipe, vision-scout heal so Vision Scout Corrupted does not reach the user, some Meal-06/10 EN/ID chrome, receptionist form locale plus empty-reply fallback.

| ID | Class | Status | Gate (inner) | Frozen example (outer, only after green) | Do not |
|---|---|---|---|---|---|
| **S-1** | `LEAK_EN_CHROME` | Landed | `src/utils/i18n.test.ts` plus leftover-string list in that test | One Kosong Front Desk plus one meal chrome check after the list is green | Unpark L-2 to L-5; translate food names |
| **S-2** | `LEAK_EN_AGENT` | Landed | `agents/dietitianInstructions.i18n.test.ts` plus receptionist/coach `withAgentLanguage` | **L-1** one Indonesian meal-log proof (verdict/advice) | Treat old saved English analyses as chrome bugs |
| **S-3** | `SCOUT_PARSE_FATAL` | Landed; live replay pending | `server_vision_scout.test.ts` | One Meal-10 replay only | 10-case food loop; claim first-pass live green |
| **S-4** | `SCOUT_UNDERCOUNT` | Landed | golden meal locks plus card chrome (kcal/P/C/F visible) | Meal-06 / Meal-10 numbers vs GT | Paint expected.json to match the undercount |
| **S-5** | `CHAT_STALE` | Landed | `src/utils/storageUtils.test.ts` | — | Re-find by logging Kosong live every session |
| **S-6** | `HANDOFF_I18N` | Landed | `src/server/receptionist/handoffContract.test.ts` driven by `prototype/receptionist/benchmark/UC-0x.json` | One UC-02 vitality after the test is green | Full receptionist click-through of UC-01 to 09 |

**Parked leftovers under S-1 (do not dump a 50-key i18n pass):** 1 serving; Preparation:; View Diagnostic Logs; receipt internals (Item Sub-Total / Estimated / Printed Packaging Label); Gender/debug chrome.

**Who runs Track S:** OpenCode plus Token Plan Qwen (DeepSeek PAYG after Token Plan is gone) for one class / one PR. Antigravity only on chiwah.liu@gmail.com for a large class-fix. Grok Bot triages a red golden or reviews a short diff and does not click the next seven cases. Skip Aider+Qwen and Alibaba Qwen Code / Lingma.

### Track S (continued) — 2026-09-12 log-issue queue (meal-log journey first)

Found while triaging `debug-job_1789169906811` + red gates. Work in this order:

| ID | Class | Item | Gate (inner) | Do not |
|---|---|---|---|---|
| **S-7** | `MEAL_JOURNEY_OPEN` | Meal-log journey: quick-action → Log Meal dialog → composer → stubbed card (Q-8.3 `prototype/tests/dialog-inventory.spec.ts` 2 failing: composer never appears after Log Meal click) | Spec green; if the dialog itself fails to open in-app, fix the app open flow, not the locators | Paint the spec to match a broken dialog; live Gemini in the loop |
| **S-8** | `LEAK_KEY` | Raw i18n keys from meal compose/narration (`ledgerLoggedMeal`, `adviceProbioticSugar`, `balancedMealFallbackName`, `apMealPosition/…`): 10 failing tests in `server_food_dietitian_dispatch.test.ts` + `narration.test.ts` | The 10 tests + `src/utils/i18n.test.ts` parity (en + id) | Touch helper logic; add en without id |
| **S-9** | `CHAT_STALE` | Empty-demo wipe misses prefixes: export `CHAT_MEMORY_PREFIXES` from `storageUtils.ts`, clear `last_sent_payload_` / `active_session_id_` / `jobstore_` / `chat_messages_` (`tests/deskProcess.golden.test.ts` 1 failing) | deskProcess golden | Widen beyond demo-wipe callers; drop `preferred_language` |

**Status 2026-09-12: S-7/S-8/S-9 all green.** Single root cause found: `bca0f80` bulk-overwrote `src/utils/translations.ts` (6,538 lines) with humanized key names and dropped keys. Fix = reverted that file to `bca0f80~1`, deleted tracked junk `scratch_keys.json`. S-7 verified by 3/3 `dialog-inventory.spec.ts` passing with zero spec changes; S-8 by 54/54 i18n+dispatch+narration tests; S-9 by 7/7 deskProcess golden after the prefix export. Class: `TRANSLATION_DUMP_REGRESSION`. Note: `bca0f80` was a 144-file commit that also deleted golden assets (`tests/Golden_meal/7/8/9`, compare sets) — those deletions were NOT restored here (out of blast radius); `src/utils/storageUtils.test.ts` (S-5 gate) still does not exist.

| **S-10** | `PORTION_FUNNEL` | **COMPLETE 2026-09-12.** Portion clarify asked redundantly (stated 100g re-asked) and stayed silent on 28g-vs-180g-pack: `buildPortionClarifyPayload` never saw user text; pack cues missed `Berat Bersih`; halves gated on whole-pack sanity; pack parser blind to `packageLabelText`. Fix: `src/utils/quantityText.ts` locale boundary (structured candidates, one locale table), candidate funnel in `server_portion_clarify.ts` (user > label > visual; adopt/suppress/inject), shared text blob, per-option sanity, scout dispatch leg + `quantityResolution` in debug export. No prompt/schema/ledger changes. | `server_portion_clarify.test.ts` (38) + `quantityText.test.ts` (10) + `portion-funnel.spec.ts` Playwright + shell-smoke 8/8 + Guard PASS | Second LLM for narration; per-country code paths; silent clamping past pack (record overflow, plausibility gate is backstop) |

# Remaining work

## Track B — Biomarkers (active)

**Architecture:** `BIOMARKER_LIFECYCLE.md`  
**Test method:** `QUALITY.md`  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Gate always:** `node scripts/assert-biomarker-lifecycle-m31.mjs`

Ingest **code** for B1–B6 is on GitHub. Ingest **v1 shipped 2026-09-14** — rows below are the criteria record.

### Done — criteria record (all shipped, kept so gates stay citable)

| # | Item | Done when | Class |
|---|---|---|---|
| **B0.1–0.3** | **Shipped 2026-09-14:** Apply smoke CLOSED on `job_medical_1786666223594` | Card shows HDL 50→**1.293**, TG 125→**1.411**, LDL 130→**3.362**, creat 0.9→**79.56**, bili 0.8→**13.68**; Apply writes history + Home; `observationMeta` raw kept; older SI rows (HDL 1.43, creat 100/72, bili 16/13) untouched | `APPLY_MISS` |
| **B0.5** | **Not needed:** Apply hit, no miss | Failing `APPLY_MISS` test, then fix hydrate / `enrichReviewModificationCommands` only | `APPLY_MISS` |
| **B2.1** | **Shipped** | Extract prompt has no second `Chat History:` prefix (`server.ts`) | hygiene |
| **B2.2** | **Shipped** | Schema / prompt no longer ask the model for `updated_at` | — |
| **B2.3** | **Shipped** | `remainingText` gone from extract path (`server.ts` → `LogChat` → `MedicalAgentExecutor` → `serverJobs`) | — |
| **B2.4** | **Shipped** | `lab_extract` vs `symptom_diary` actually route; G-B6 test **calls** the classifier | `WRONG_DOOR` |
| **B2.6** | **Shipped** | G-B3 shifted-columns / UK `109/L` / panel skip exist and call `lexTable` | `CONFORMANCE_SHAPE` |
| **B4.3** | **Shipped** | `lexTable` + `buildIngestBatch` run on the 140-row fixture; assert **class counts from the lexer**, not `expected.json` labels | — |
| **B5.11** | **Shipped** | Same report upserts; no second observation row | `UPSERT_IDENTITY` |
| **B6** | **Shipped** | `golden-from-medical-debug.mjs`; inbox Biomarkers grouped by class (not a G-B1 stub); G-B5/7/9 tests **execute** the door / completeness / image path | — |
| **B7.4** | **Shipped** (`74e29bc`, packet `specs/done/b7-4-pending-store.md`): Real Pending store | Unknown names never become catalog keys; pending not a field on the `customBiomarkers` bag | `COMPLETENESS` |
| **B7.5** | **Shipped** (`93b702d`, packet `specs/done/b7-5-silent-calibrator.md`): Silent Calibrator | Overlay re-runs when demographic fingerprint (`ageBand\|gender\|ethnicity`) changes — product path, not only a helper | `CURRENCY` |
| **B7.6** | **Shipped** (`9080458`, packet `specs/done/b7-6-name-deduper-leftovers.md`): Name Deduper leftovers | Parallel keys from aliases / `metric_N` still in live profiles are merged or tombstoned | `IDENTITY_PARALLEL_KEY` |

**Stop if:** lexer writes observations · G-B4 fails · Parser is sent a high-confidence name.

Weight/height stay `droppedByApply` until a product decision.

### After B6 (do not start to unstick B0–B4)

B7.4 / B7.5 / B7.6 above. Helpers for 7.1–7.3, 7.7, 7.8 already exist — do not rebuild them.

### Landed — do not redo

| Wave | What is already on GitHub |
|---|---|
| **B0.4** | No Home Auto-Fix / Inspect / Review; no Dictionary Auto-Calibrate / Quick Approve |
| **B1** | `IngestTrace` / `ClassId`; passthrough on medical jobs; `tests/Golden_biomarker/`; G-B1 convert locks; `assert-biomarker-ingest.mjs`; inbox Food \| Biomarkers **tab** |
| **B2 (partial)** | `lexTable` / `buildIngestBatch` / `shouldAbortTablePath`; table path in `serverJobs` |
| **B3** | Shared `getMappedBiomarkerKey`; urine ≠ serum; `convertViaTable` only |
| **B4 (partial)** | NHS aliases; leftover unmatched → Parser; abort when 0 high-confidence |
| **B5 (partial)** | Flagged → Review `update_biomarker`; staged apply; new dates can insert; pending filtered from Home/coach |
| **B6 (fixtures)** | G-B5/6/7/9 JSON examples exist — they do **not** yet execute the pipeline |
| **B7.1–7.3, 7.7, 7.8** | Catalog cleanup helper; relabel XOR convert UI; `observationMeta` backfill; telemetry writers stripped; `biomarker_dictionary_store` deprecated |

`customBiomarkers` is still the synced bag. That is why B7.4 remains.

**Ingest v1 ships** when: B0 Apply verified · G-B1 green · G-B2 green **from the lexer** · no high-confidence names in Parser prompt · no `remainingText` · batch confirm · M31 0.

**Lifecycle done** when: ingest v1 + B7.4–7.6 · unknown names never catalog keys · relabel cannot rewrite numbers · Home/coach never consume pending/flagged.

**Out of Track B:** food pipeline, rename agent ids, delete instruction packs, fuzzy auto-approve, `approve_all`, vision required, new health-planning agents until B0 + `USE_SURFACE_LEAK` are green.

**Same agent pattern as F-10:** typical chat is **one** Review / fill-template dispatch. TypeScript owns identity, `convertViaTable`, status labels, and batch size. Expand to Parser chunks / specialists only when n≥20 or `sourceKind` is table/image leftovers (`BIOMARKER_LIFECYCLE.md` §4.3). Do not add Lab Parser + Review + Calibrator on a C1-sized send. Fill-template remaining work: [BIOMARKER_FILL_TEMPLATE_CASES.md](./BIOMARKER_FILL_TEMPLATE_CASES.md) (C1–C7 green **before** modal wiring).

### B8 — One math path, one door (platform continuity)

Does **not** replace B0–B7. Same pillar, same `convertViaTable` law. Trigger: second conversion table + restored Auto-Fix landed after B0.4. Method: `QUALITY.md` §7.

| # | Item | Done when | Class | Who |
|---|---|---|---|---|
| **B8.0** | **Shipped (Option B)** | Auto-Fix banned from Home; warning banner preserved pointing to Health Clean & Sanitize (`CATALOG.json` choice B, onlyComponent null) | product | Human + Gemini |
| **B8.1** | **Shipped** | `computeBiomarkerTelemetryMultiplier` uses `ANALYTE_CONVERSIONS` only; locked `1.293` / `1.411` / `3.362` / `79.56` / `13.68` unchanged | `SECOND_MATH_PATH` | Grok (constants) |
| **B8.2** | **Shipped** | Dictionary toolbar **or** Cleaning menu, not both | `CLONE_UI` | Gemini |
| **B8.3** | **Shipped** | `runGeneralizedBiomarkerAudit` / `detectFlaggedTelemetryErrors` not re-run from Dictionary + Medical History + Trends + LogChat on the same paint | `EAGER_MOUNT` | Gemini after Grok names call sites |

---

## Track F — Food identity quality + create agent

**Architecture:** `FOOD.md` Process (Meal Agent + TS expand) + Part A catalog (do **not** rebuild curator — M30 assert is green)  
**Method:** `QUALITY.md` + `FALSE_FRIEND` / `DISH_DROP` / `OPENING_WRONG` / `SILENT_REPAIR`  
**Laws:** `docs/agent/domains/food-calc.md`

M21/M22 meal document stay. F-5 TypeError `.calories` is **done**.  
Live USDA/FDC is **abandoned** (F-12). Brand catalog self-clean is **F-11**.

| ID | Status | Done when / parked why | Do not |
|---|---|---|---|
| **F-1** | **Abandoned** | 50-meal audit: FDC overwrite is net-negative. Replaced by **F-12** delete | Reopen FDC; “fix USDA” |
| **F-2** | **Abandoned** | Same. Analyze is OCR → brand → Meal Agent | Last-resort USDA; Analyze USDA-first |
| **F-3** | **Shipped 2026-09-15** | DISH_DROP sensor: sole Nasi Uduk dengan-dan dish unrolls to 3 items (packet `specs/done/f-3-dish-drop-nasi-uduk.md`) | `POST /loop` until all-green |
| **F-4** | **Shipped 2026-09-15** | Measured alias hit rate 1.0 over 13-probe list + negation/dangerous-single merge gates (packet `specs/done/f-4-alias-hit-rate.md`) | Silent merge |
| **F-6** | **Shipped 2026-09-15** | FoodCard 3336 under 3800, 0 food-UI lines added; 3 pre-existing god-file budget fails recorded (packet `specs/done/f-6-net-zero-verify.md`) | New food table / +100 lines “enhance” |
| **F-7** | **Gate green** | `assert-budgets.mjs` PROMPT_BUDGET/scout. Keep net-zero on prompt edits (L12) | Prompt-only unit math |

Q-1 (`assert-budgets.mjs`) is **green**. Brand self-clean is **F-11**. USDA delete is **F-12**.

### F-8 — Single-path add/edit (calorie host must die)

**Architecture:** [FOOD_SINGLE_PATH.md](./FOOD_SINGLE_PATH.md) · [FOOD.md](./FOOD.md) Process  
**Laws:** `docs/agent/domains/food-calc.md`

**Shipped (2026-08-30…31):** F-8.1–F-8.9 (gate, finalize map, edit executor, debug, tiles, packaged bind, heal slim, host deleted, thin HTTP adapter, compiler uses finalize, evidence-job TS fixture 1635 g).

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **F-8.10** | **Shipped** | `server_food_analyze_run.ts` split into 150–600 owners (Meal Agent dispatch, DB search, precalc/finalize, responses). Dead backup deleted. HTTP adapter stays ≤700. | 40-line shards; a second kcal writer |
| **F-8.11** | **Superseded by F-10.8** | Do not soak the old always-dietitian create path. Evidence job still required on the F-10 pipeline | Replay scout+dietitian as “done” |
| **F-8.12** | **Shipped 2026-09-15** | Hemaviton HIT with vitamin C locked 6/6 green; residual closed (packet `specs/done/f-8-12-packaged-bind-verify.md`). F-10 does not replace catalog bind | Invent 1000 mg vitamin C |
| **F-8.13** | **Shipped** | JSON run tree (`debugRunTree.ts`) + `dumpContract` on JSON + Contract-first markdown. Gaps A–F in `docs/agent/domains/debug-contract.md`. | Hash-only prompts; hide schema; PNG as contract; LangSmith/LLM-judge |

Execute **one class** per session. Inner = named vitest. Outer = one frozen example, not meal-green.

### F-9 — Job session (one current turn)

**Architecture:** [FOOD.md](./FOOD.md) Process · `docs/agent/domains/sync.md` jobs  
**Class:** `STALE_TURN` (preview/chat shows a previous turn while a new one is running)  
**Not:** food-calc, F-8.10 split, meal-green. Do **not** mix with F-8.10 in the same PR (`App.tsx` / `LogChat.tsx` collision = `8742686`).

F-8 made calories have one owner. F-9 makes “what is on the preview” have one owner: `job.currentTurn` + `status` + `result` (null while not terminal). Flags (`inFlightTurnAt`, `mealSnapshotKey`) remain as fallback until F-9.5 finishes — do not add siblings.

**Shipped in tree (2026-09-01, `3cf21ff`):** F-9.1 laws/vite assert · F-9.2 `jobPreview` + `JobSession.contract.test.ts` (4/4) · F-9.3 `sessionLog` + cloned `useJob` on the card · F-9.4 `current_turn` column/increment/await upsert/LogChat increment · F-9.5 `JobStore.apply` + sync/runner. Named vitest 26/26 + `assert-f9-pr1` + `assert-dev-serves-vite` green.

| ID | Status | Still to do | Do not | Who |
|---|---|---|---|---|
| **F-9.1** | **Shipped** | — | Add flags; `npm run build` as sync | — |
| **F-9.2** | **Shipped** | — | Store-only tests | — |
| **F-9.3** | **Shipped** (residual) | Session section on **debug download**; log `ignored_stale_turn` (today every commit is `accepted`/`completed`) | New modal | Optional later |
| **F-9.4** | **Shipped** (residual) | Flags `inFlightTurnAt` / `mealSnapshotKey` still exist as fallback. App poller does not send `currentTurn`. Delete flags in a later cleanup, not as a god-file rewrite | Infer turn from calories | later |
| **F-9.5** | **Shipped** | App poller status/result → `JobStore.apply` (`PollerPayload` / `AnalyzeFinished` / `AnalyzeFailed`). LogChat food+medical submit → `SubmitStarted`. Wrapper `updateJob` remains for credits/checkpoint/savedToLog | God-file rewrite; second merge path | **Grok** |

Gemini leftover from PR4 (do not treat as architecture): one-shot `patch_*.mjs` / `fix_*.mjs` at repo root — **deleted in this review**. Do not restore.

### F-10 — Adaptive Meal Agent (one role, expand when TS says so)

**Architecture:** [FOOD.md](./FOOD.md) Process · `docs/agent/domains/food-calc.md`  
**Class:** `ALWAYS_SECOND_AGENT` (create always ran Scout then Dietitian)  
**Evidence:** `prototype/meallog/meal/` (`compare_1_vs_2_agent.ts`, `run_all_11_elastic_benchmark.ts`, `BENCHMARK_PERFORMANCE_SUMMARY.md`)  
**Not:** USDA/FDC, putting curator back on Analyze, F-9.5, a Commercial Cooking Critic LLM, LLM-emitted calories.

Production today still **always** dispatches Vision Scout then Dietitian on create (`server_food_analyze_run.ts`). Prototype 1-agent (scout does identity + P/C/F + verdict; TS Atwater) matched or beat the hierarchical 2-agent path on the 11-case set. Elastic COMPLETE/DELEGATE showed simple packaged meals finishing in ~2.5s with one call; complex hotpots needed extra capacity. **Do not copy the prototype blindly:** the model picked DELEGATE poorly (airline tray COMPLETE’d and Na accuracy went to 0%), and the elastic schema emitted `calories` (F-8 forbidden).

Same pattern as biomarkers: one Review for n=1–5; TypeScript decides batch/expand; specialists only when the dispatcher expands.

| ID | Item | Done when | Do not | Who |
|---|---|---|---|---|
| **F-10.1** | **Shipped** | `src/mealBuild/shouldExpandMealAgent.ts` + vitest + `assert-f10-pr1.mjs`. Do not rewrite. | Trust lite-model self-assessment | — |
| **F-10.2** | **Shipped** | `server_derivation.ts` (`calculateDerivedNutrients`) + vitest. P/C/F present → Atwater; agent kcal ignored. | Ship elastic `calories`; carbs-from-energy on the hot path | — |
| **F-10.3** | **Shipped** | `src/mealBuild/workerMerge.ts` + vitest. Workers receive **locked grams + dish crop**, merged strictly by dishId. | Re-OCR; second kcal book | — |
| **F-10.4** | **Shipped** | `src/mealBuild/narration.ts` + vitest. Saved message numbers derive from finalize ledger table. | Dietitian `itemsBreakdown` rebuild; narrate from pre-finalize estimates | — |
| **F-10.5** | **Shipped** | `server_meal_edit.ts` + `ModeDAndEdit.test.ts`. `modificationCommand` / `[]` / `estimate` executor. | New persona; Mode Rewrite | — |
| **F-10.6** | **Shipped** | `diningEnvironment` × `cookingMethod` in `finalizeDishLedger` via `decidePrepAddition`. Honest residual named `prepAddition.reason`. | Default to a second critic LLM; claim 90% fat on Case 4/9 | **Grok** constants |
| **F-10.7** | **Shipped** | `server_food_analyze_run.ts` adaptive create cutover via `shouldExpandMealAgent`. Dietitian LLM skipped on single-agent paths; D8 scale preserved. | Wrap the old dietitian create as fallback forever | — |
| **F-10.8** | Inner named; outer = Q-8.6 | Inner: 11 prototype cases in `server_dish_finalize.test.ts` (restaurant fat residual on 1/4/9 named, not 90%). Outer: `scripts/soak-q8-tier3.md` | `POST /loop`; soak old scout+dietitian; Grok in the wait loop | Grok reviews / human |

**Do not mix** F-10 with F-9.5 (`App.tsx` collision). Catalog bind (F-8.12) stays on finalize. USDA is **F-12**. Brand clean is **F-11**.

### F-12 — Delete live USDA/FDC from Analyze

**Architecture:** [FOOD.md](./FOOD.md) **Part A.3**.  
**Evidence:** 50-meal audit (production ranker): loose FDC overwrite net-negative; strict match ~0–20 kcal, no extra 30-nutrient panel on current logs.  
**Trigger:** F-12.1–12.4 **shipped**. Not Current work.  
**Not:** keeping a “last-resort” hook; making Analyze USDA-first.

| ID | Item | Done when | Do not |
|---|---|---|---|
| **F-12.1** | Remove `searchUSDA` / `fetchUSDAFoodById` / two-round helpers and all Analyze call sites. **DONE 2026-09-13**: 4 defs + rank-import cut from `server.ts`; precalc DI/imports + scout-hint fetch block cut; db_search fan-out/consumption/HIT_UNIQUE-inject/rank-feed cut, curator gets `undefined` for optional `searchUSDAFn` (param removed in F-12.3). Single-path `F-12.1` negatives + rewritten db_search tests green; `tsc` 0; Guard PASS | `rg 'searchUSDA\s*\(' / 'fetchUSDAFoodById\s*\('` empty in `server*.ts` + `src/server/food` (param name + comments cleared in F-12.3). `tsc` baseline 0 | Wrap in a flag |
| **F-12.2** | Remove `collectFdcHintTasks` / `verifiedFdcHintMap` / `suggestedFdcId` merge. **DONE 2026-09-13**: hint collectors + stopword gate cut from `server_food_precalc`; ctx map init + type field cut; scout schema field + 3 merge sites cut (prompt never instructed it); hint unit test removed, single-path forbids all four names. 19/19 vitest, `tsc` 0, Guard PASS | Default precalc never hits FDC. Single-path test forbids `collectFdcHintTasks` | Leave a hint “just in case” |
| **F-12.3** | Stop `dbSource: 'usda'` writes; curator must not take `searchUSDAFn` / `chosenFdcId`. **DONE 2026-09-13**: `searchUSDAFn` param + USDA parametric-fallback block cut from curator; db_search passes 5 args; curator-result source mapping `usda`→`estimated` (OFF barcodes keep `off`); component fallback default `usda`→`estimated`; dead USDA-candidate push removed; `chosenFdcId` allowlist plumbing stays for F-11.2. Single-path F-12.3 sensor green; `tsc` 0; curator + M30 tests green. Historical `usda` reads (aggregation, scoped-match, dish type union) stay | New meals never `usda`. Historical rows stay | Rewrite old food_logs |
| **F-12.4** | **Shipped.** `fdcId` stripped from `CANONICAL_BASE_FOODS`; `getCachedUSDAFood` / `setCachedUSDAFood` / `LOCAL_USDA_CACHE` deleted. Lookup returns local `id` (map key) + nutrients only. | Local ghost-component table has numbers only. No HTTP | Delete the local staple table |

`docs/agent/domains/food-calc.md` rung 3 drops “USDA Atomics” — confirmed before→after with F-12.1. F-1/F-2 stay **Abandoned**.

### F-11 — Brand catalog self-clean (one librarian, off Analyze)

**Architecture:** [FOOD.md](./FOOD.md) **Part A.2**.  
**Trigger:** after F-12 or in parallel if no shared files. Human **go**.  
**Not:** food_items on Analyze, FDC lookup, a second resolver persona, blocking Save.

Today: curator LLM skipped on Analyze. Brand **match** in finalize. Brand **TS self-clean** (F-11.1) runs after ledgers, meal never waits. Curator LLM is **F-11.2**.

| ID | Item | Done when | Do not |
|---|---|---|---|
| **F-11.1** | **Shipped 2026-09-13** (`4a9f129`). TS cleaner unhooked from resolver; per chain+country throttle; soft quarantine; official > ocr > user; skip `usedRowId`. Live needs the `brand_menu_items.status` migration. | Named vitest: same-key clones collapse; unofficial quarantined; meal kcal unchanged | Gemini delete; global 1h throttle; hard delete |
| **F-11.2** | **Shipped 2026-09-16**. Curator LLM only when [FOOD.md](./FOOD.md) **A.2.1** passes. T2 Jaccard ≥ 0.85 + kcal ±10% + no meal/combo superset. TS rejects merge if kcal >15% or official loser. Unit test 11/11 green. | Next same spelling-variant HIT. Big Mac vs Big Mac Meal **not** merged. HIT/MISS/SKIPPED/OCR never call Gemini | Invent SKU; `chosenFdcId`; LLM every meal; write kcal onto this meal |
| **F-11.3** | **Shipped 2026-09-16**. One name: wire `curator` (`t1/curator`, `agent: 'curator'`). Dual-accept `food_resolver` / `resolver`. | Debug `t1/curator` or nothing — never both | Wire id `meal_agent` / `dietitian` (meal agent is `diet`) |

M30 assert retarget = confirmed before→after on `assert-food-curator-m30.mjs` + `food-calc.md` Database Curator (brand-only). Same change as F-11.2/11.3.

---

## Track R — Reliability (core done; start only on trigger)

**Architecture:** `RELIABILITY.md`  
**Laws:** `docs/agent/domains/sync.md`  
**Core:** M23–M28 `assert-free-tier-complete.mjs` **PASS**. Do not re-migrate images or re-kill chat Firestore writes.

| ID | Still to do | Trigger |
|---|---|---|
| **R-1** | Re-measure Firestore writes / Supabase egress | Quota or bill spike |
| **R-2** | Cloudflare Pages for `dist/` only (no API) | Static latency actually hurts. **Go-live is R-13.** |
| **R-3** | Playwright leftover-English plus demo-empty smoke | After **S-1** string list is green; not instead of class goldens |
| **R-4** | Finish `server.ts` router split | Already touching the monolith (`server_routes_{jobs,biomarkers,food}.ts` exist; `server.ts` still huge) |
| **R-5** | D1 as primary SQL | **After** R-1 still fails free tier |
| **R-6** | Job recovery soak | Interrupted jobs still orphan (unit test exists; not a soak) |
| **R-8** | **Shipped** | Numbers recorded in `AI_HANDOVER.md` (DOMContentLoaded 1,485ms → 343ms, FCP 1,644ms → 384ms, Load 2,223ms → 1,131ms). Baseline established. | Page feels slow |
| **R-9** | **Shipped** | Defer `startGoldenIngestWatcher` + `hydrateUserJobs` via `requestIdleCallback` (3500–4000ms timeout) + in-flight request deduplication. Zero startup duplicate fetches. | After R-8 baseline |
| **R-10** | Header code-split | `themeRegistry` audit, Drive backup, `FoodCatalogAdminTab`, quota checkers lazy; Header line count may not grow | After R-9 |
| **R-11** | `HomeTab` / `LogChat` stay out of other tabs’ first paint | Already lazy-tabbed; do not eagerly import them from Insights / History | Regression after R-10 |
| **R-12** | One-line stall/503 count (free-tier hang rate) | After F-8.13 JSON tree has `latency_ms` / error on dispatches. A number in `AI_HANDOVER.md`, **not** a metrics product. RELIABILITY.md §11.12 **H** | LangSmith; Grafana; inner-loop Gemini |
| **R-13** | Cloudflare go-live + AI Studio parity | Packet **locked** `specs/active/R-13.md`. R-13.1 any agent; R-13.0 `blocked_human`. Not R-2. |

### R-13 sub-IDs (one at a time after lock)

| ID | Still to do | Done when | Do not |
|---|---|---|---|
| **R-13.0** | Preconditions: Workers Paid, D1/R2/CORS, runtime secrets, Firebase + OAuth exact hosts, `NODE_ENV=production` | Checklist ticked in `AI_HANDOVER.md`. No `src/` / `server.ts` diff | `*.pages.dev` wildcard; `ALLOW_UNAUTH_SYNC=1` |
| **R-13.1** | Static SPA (`build:web`) + GCP Cloud Run (Option A 100% Free Plan, parallel to Render) + Firebase Spark plan | `npm run dev` still Vite on 3000; Cloud Run min-instances=0 ($0/mo, ~1.5s cold start vs Render 50s splash); job submit → D1 + R2; Google login on exact host; fresh Firebase config in `firebase-applet-config.json` ([plan/GCP_FREE_TIER_MIGRATION.md](./GCP_FREE_TIER_MIGRATION.md)) | Import `server.ts` into Pages Functions; skip `listen` on `CF_PAGES`; min-instances > 0 (incurs cost) |
| **R-13.2** | Loopback SSE `: ping`; keep 180s abort; align stale-fail copy | Silent 180s behind orange-cloud does not 524; `server_sse_json.test.ts` green | Raise Worker CPU to “make 3 min work” on V8 |
| **R-13.3** | `server_auth.ts` localhost-only skip; popup/redirect fallback; preview policy | Spoofed `uid` rejected in prod; Google + email verify + Drive backup on prod host | `NODE_ENV !== 'production'` as a localhost synonym |
| **R-13.4** | Native `env.DB` / `env.BUCKET`; in-process analyze; durable jobs | Worker can analyze without `127.0.0.1` and without `sharp` | Start this to unstick 13.1; D1-as-primary (that is **R-5**) |
| **R-13.5** | Workers Logs; 1102/1027/524 alerts; static excluded from compute | Static `/assets/*` not billed as Functions | Pages Functions as the log host |

R-7 knip / `getBiomarkerStatus` memo as a reliability gate is **abandoned**.  
R-8–R-11 are **client speed**, not a free-tier redo. Do not re-migrate images or re-kill Firestore writes.  
`App.tsx` extract (`useSyncOrchestrator`) stays **parked inside R-4** — only if a later pack already touches that file. God-file splits need a **locked packet** (Q-9 is the pattern). Do not split `App.tsx` / `LogChat.tsx` / `Header.tsx` without one.

---

## Track Q — Quality loop (remaining method work)

**Architecture:** `QUALITY.md`  
**Area PASS/FAIL board:** [`golden/scorecard/instruction/MASTER_SCORECARD.md`](../golden/scorecard/instruction/MASTER_SCORECARD.md) (Localization / Meal Log / Compare / Biomarkers / Receptionist / Reliability). Process: `golden/scorecard/instruction/README.md`. Refresh with `npm run scorecard:debug`, never `npm test`.

Rules unchanged: work item = class · inner = vitest · outer = one example · honest residual · firewall.

**Landed — do not redo:** Q-1 (`assert-budgets.mjs` PASS) · Q-2 (`CATALOG.json` primitives) · Q-3 (`AppModal` + `FilterPills` + tests; Audit uses FilterPills) · QUALITY.md header already “Waves 0–7” · `scripts/golden-from-medical-debug.mjs` exists.

| Still to do | Done when |
|---|---|
| **Q-4** `AgentResultTable` thin | **Current work.** Packet `specs/active/q-4-agent-result-table.md` locked. Extract-only. Any agent. |
| **Q-8** Process goldens | **Shipped 8.1–8.6.** |
| **Q-9** Website consolidation | **Shipped 2026-09-16** extract-only (`specs/done/q-9-website-consolidation.md`). Do not rewrite. |
| **Q-10** Dependency consolidation | **Current work after Q-4.** Packet `specs/active/q-10-dependency-audit.md` locked. Hygiene only. **Not** R-7 knip. |

**Landed — recently completed:**
- Make G-B2/5/6/7/9 execute the helper they name
- Inbox by class (Biomarkers tab lists examples grouped by class)
- **Q-5** Delete one-shot patch scripts
- **Q-6** Unified bug queue
- **Q-7** Test + golden hygiene

**Q-8 execute order** (do not skip the audit):

| ID | Do | Done when | Do not |
|---|---|---|---|
| **Q-8.1** | **Shipped.** Food process **audit**: walk QUALITY.md §1.3.1 exits. Dummy row per exit (including ones this dump did not take). Debug follows RELIABILITY.md **§11** + **§11.12** (JSON tree, dialog inventory, correlation id, dispatch signals, handoff record) | Checklist lists every §1.3.1 row + 11.12 A–F; dummy fixture or named residual; Contract emitted from JSON | Live Gemini; one dump = whole suite; screenshot as scorer; Phoenix/LangSmith |
| **Q-8.2** | **Shipped.** Make Soto classes green on dummy data: `QUEUE_LIE`, `DEGRADE_NOT_TERMINAL`, `DISPLAY_LAG`, `COMPLETE_ONCE`, `STALL_NO_FALLBACK`, `STALE_TURN`. Rewrite tests that encoded the bug (stall ⇒ failed) | Named vitest green; historical dumps still classify red via `test-from-debug` | G8 photos; `POST /loop` |
| **Q-8.3** | **Shipped.** `prototype/tests/dialog-inventory.spec.ts` stubs `/api/jobs/*` | Card ≠ Attempt/Retry when stub succeeded with kcal | Live Log Meal; mix with R-3 |
| **Q-8.4** | **Shipped.** `tests/bioProcess.golden.test.ts` | Dummy medical SSE + Apply + table abort + DIAG5-off-lab | Paint G-B1 all_green |
| **Q-8.5** | **Shipped.** `tests/deskProcess.golden.test.ts` | Dummy UC-02 handoff + dropped keys + FD not a meal analyzer | 10 live UC click-through |
| **Q-8.6** | **Shipped 2026-09-16.** Live soak executed per `scripts/soak-q8-tier3.md` (`job_1789535793972`). Inner loop 74/74 passed; 0 stalls / 0 503s. Dumps saved to `golden/scorecard/current/debug/`. | One website **or** API live after 8.2/8.4/8.5. If dump class already a row, inner failed. Grok not in the wait loop | API **and** website for the same meal; Grok bot 3-case loop |

Session replay: **abandoned** (Q-8 is dummy SSE/status, not replaying a browser session).  
Golden-execution Q work is usually **inside** B2/B4/B6 or F-3.  
File-collision rule: B0 and R-9 both touch `App.tsx` → serialize those two only. F-9.5 also touches `App.tsx` — serialize with B0/R-9. **Q-9** serializes with those too. **Q-8.3** must not collide with R-3 (different specs).

### Platform program order (not a fifth pillar)

Same reward change as class-first goldens (`QUALITY.md` §0): green means the **class** is closed, not “the page still works.”

```text
Q-1 + Q-2 + Q-3              ← landed
F-10.1–10.7                  ← shipped
F-9.5 App poller             ← shipped (Grok)
F-10.6 fat/Na TS             ← shipped (Grok)
F-8.13 debug contract        ← shipped
Q-8.1 → 8.5                  ← shipped (Grok)
F-8.10 shards                ← shipped
F-12.1–12.4 USDA gone        ← shipped (local staple table remains, no FDC ids)
F-11.1 brand TS self-clean   ← shipped (live: status migration)
B8.1 convertViaTable only    ← shipped
B0 / fill-template C1–C7     ← shipped
Q-8.6 / F-10.8 outer         ← shipped (2026-09-16 job_1789535793972, 74/74 pass, 0 stalls)
F-11.2 / F-11.3 curator LLM  ← shipped (2026-09-16 brandCurator + t1/curator wire)
Q-9 website consolidation    ← shipped (extract-only)
Q-4 AgentResultTable thin    ← Current work (packet locked; any agent)
Q-10 dependency audit        ← after Q-4 (packet locked; any agent)
R-13.1 Cloudflare go-live    ← after Q-10 or in parallel if no shared files; R-13.0 human
```

Do **not** open a Dictionary/FoodCard/`App.tsx` breakup without a locked packet. Q-9/Q-8.2 are green. Do **not** skip Q-4’s extract-only nodes.

### Who does which

| | **Any agent** (Studio / Antigravity / OpenCode / Cline) | **Grok** (quota-scarce) |
|---|---|---|
| Prefer | Current work packets: **Q-4** then **Q-10** then **R-13.1**. One class, named vitest. | Catalog / process lock only when a **new** primitive or new god-file split is needed. Already done for Q-4/Q-10/R-13. |
| Do not | `npm test`; critic LLM; USDA; invent a primitive; live Gemini as inner loop; wait for Grok | Sit in a live wait loop; rewrite binge; re-lock packets other agents are executing |

---

## Track L — Localisation (active)

**Unparked 2026-09-15.** Human: do L-1…L-5. Restore strings from known-good git (`85ce58b` / `95c5640` / `4cd66d1`) — do **not** invent copy. L-5 still needs a named milestone locale before growing `fr`/`zh` to complete.

**Architecture:** `src/utils/translations.ts` (`en` source of truth, `id` key-parity) · `src/utils/i18n.ts` (`t()`, English fallback, `withAgentLanguage` / `withScoutLanguage`) · named gates `src/utils/i18n.test.ts` and `agents/dietitianInstructions.i18n.test.ts`.
**Scope:** English + Indonesian only. `fr` / `zh` stay incomplete and fall back to English. More languages later.

### Landed — do not redo

EN/ID UI chrome for login, home, chat, food history, insights, trends/health, profile menu; status badges; nutrient display names; health category headings; BMI/BMR panel; Insights step blurbs; job Ready/Active/Queued chip; chat empty-state; demo/credits; skip-dietitian verdict/advice templates; agent instructions follow `profile.language`. Food identity names stay untranslated. Native file-picker chrome cannot be translated.

### Still to do (active)

- **L-1 Live Indonesian meal-log proof.** **Landed 2026-09-15.** Live Render PASS (`indo-l1-meal-verdict.live.spec.ts`, job `job_1789418889841_nx1b76vmp`): profile.language=id required; verdict/advice Indonesian (not English Supports Sustained Metabolic Energy). Food names may stay English.
- **L-2 Seeded / demo content.** Pack restore from `85ce58b` landed 2026-09-15 (seed*/outlier*/clinicalActionDesc/dailyBenefitsDesc). Covered by automated preciseCause language test (`81a9651`); no live eyeball needed.
- **L-3 Catalog display names.** `displayBiomarkerName` / `displayConditionName` already wired (MedicalHistoryTab, dictionary, audit). Keep keys English; vitest gates in `i18n.test.ts`.
- **L-4 Admin / leftover widgets.** Pack restore from `85ce58b` landed 2026-09-15 (table*/backup*/audit*/dict*/sanitize*/batch*/img*/del*). Scorecard `i18n_required_chrome` ALL GREEN, sealed 2026-09-15 (705/0/0).
- **L-5 More languages.** Deferred 2026-09-15 (no milestone locale chosen). Keep EN+ID only; do not make fr/zh complete as a side quest.

**Out of Track L:** dish/brand names, JSON keys / nutrient codes / biomarker keys, native Choose File, old saved meal-analysis sentences (re-log to refresh).

**Gates while active:** `npm run scorecard:debug` (`i18n_required_chrome` PASS) + named i18n vitest (`i18n.test.ts`, `dietitianInstructions.i18n.test.ts`) + I18N-A11Y soak into `golden/scorecard/current/a11y/` when chrome changes.

## Gates (named rows, not a pile)

**Every COMPLETE:** `npx tsc --noEmit` + the [DOMAIN_REGRESSION_MAP.md](../docs/agent/DOMAIN_REGRESSION_MAP.md) row(s) for files you touched. That is the whole default. See `QUALITY.md` §1.4.

**Soak** (`npm test`) is optional and slow (~97 files). Do not make it the inner loop. `tests/golden_inbox.test.ts` stays excluded.

Track-specific (only if that track’s files changed):

```bash
# Track B
node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts tests/golden_biomarker.test.ts
# Track F curator
node scripts/assert-food-curator-m30.mjs
# Track R sync
node scripts/assert-free-tier-complete.mjs
npx vitest run src/utils/syncUtils.regression.test.ts
# Track Q platform (prompt / god-file size)
node scripts/assert-budgets.mjs
```

Do **not** invent missing `scripts/assert-*.mjs` names from old map rows (Q-7).
