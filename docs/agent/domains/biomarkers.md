# Domain rulebook: Biomarkers

**Load when:** dictionary, extract/review, calibration, combine/dedupe, biomarker logs, MedicalHistory, ranges, Home/coach intake.

**Architecture (design):** `plan/BIOMARKER_LIFECYCLE_PLAN.md`  
**Ingest router:** `plan/BIOMARKER_INGEST_ROUTER_PLAN.md` — source classifier, leftover-only Parser, flagged-only Review.  
**Build + goldens:** `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` — class-first (not meal-green); ingest router I0–I9.  
**Roadmap:** `plan/BIOMARKER_IMPLEMENTATION_ROADMAP.md` — Waves 0–7. Do not invent a third pipeline.  
**WIP:** `AI_HANDOVER.md` · **Gates:** `DOMAIN_REGRESSION_MAP.md` → Biomarkers.

**How to use:** Laws so dictionary / agents / logs / sync do not drift.  
**Evolution:** new agents, key migrations, store splits — IMPACT + tests + this file if invariants change (`AGENTS.md` §3 before→after).

**2026-08-14 consolidation (product change):** target is catalog / pending / overlay / observations. **Code still implements the blended model** in §8. Follow **laws** on every change; move toward the target; do not invent a third pipeline.

### Before → after (this edit)

| Before | After |
|---|---|
| Mental model: extract agents → customs + logs → agent5/data_review | Four records: catalog, pending, overlay, observations |
| Agents documented as agent1–5 personas | Named roles (Review, Lab Parser, …); ids still used in code |
| Approval inferred from unit+range+grouping+risks+conditions | Target: catalog `approved`. Code still infers — do not add more inferrers |
| `customBiomarkers` treated as the dictionary | Target: catalog defaults + user overlay. `customBiomarkers` remains the **synced bag** until Slice 1–3 |
| Sanitize-on-set implied OK | **Law:** flag, do not silent-rewrite numbers |
| (2026-08-14 add) | Binding literature laws §2.1: three ranges, convert table, upsert id, no average, age band, labFlag/printedRange, no race coefficient |

---

## 1. Target mental model

```text
Sources (labs / photos / text)
  → Lab Parser (raw observations only)
  → identity (catalog key + aliases)     miss → Pending (this user)
  → clean (relabel XOR convert; dates; flags)
  → Dictionary approve (human) if new key
  → overlay (Range Calibrator) if rangeVariesBy + overlay stale
  → live observations
  → Home / Health Coach / food badges     approved + unflagged only
  → sync / tombstones (domains/sync.md)
```

Changing **one** layer without the next is the usual cascade.

**Used** (Home, categories, coach, food badges) only if: catalog approved **and** latest observation unflagged **and** legal value+unit pair.

---

## 2. Four records (do not merge)

| Record | Owns | Must not |
|---|---|---|
| **Catalog** (admin dictionary) | key, aliases, default unit/range/description/category, `rangeVariesBy` | Invented by extract; user-specific ranges |
| **Pending** | Unknown printed name + raw value/unit/date/source | Appear on Home/coach; become a catalog key without approve |
| **Overlay** | This profile’s range / optimal / brackets + profile fingerprint | Change catalog defaults; rewrite log numbers |
| **Observation** | Dated value + unit + source on an approved key | Exist as a bare number with unit only on the dictionary (target; today they do — see §8) |

**Relabel vs convert:** unit-label change never rewrites numbers. Number change is Review + named factor + keep raw. Never both unless the user chose convert.

**Calibrator** is overlay for a key **already in the catalog** when the population default is wrong for this age/sex/ethnicity. Not “new key.” Auto-run when overlay missing/stale **and** `rangeVariesBy` says it can move. User does not guess. Overlay fingerprint = **age band** + sex + ethnicity. See plan §5.

### 2.1 Binding literature laws

1. **Three ranges, never smashed** — printed (on the observation) · catalog default · overlay. No writer copies one onto another.  
2. **Convert only via per-analyte table.** Incomparable or unknown pair → flag, do not guess.  
3. **Observation identity** `(canonicalKey, date, sourceReportId)` — re-extract is upsert.  
4. **Same calendar day ≠ average.** Merge on ingest only for the same source extract.  
5. **Overlay fingerprint uses age band**, not exact age.  
6. **Keep `printedRange` and `labFlag`** when the report has them.  
7. **No race coefficient in the catalog.** Calibrator may cite a named society.

---

## 3. Agent roles (names vs ids)

**Ids matter in code and storage.** Display names below are what we say.

| Say | Id / menu | Allowed writes (target) |
|---|---|---|
| **Lab Parser** | `agent1` (`medical`, `medical_extract`) | Raw / pending observations. **No catalog keys, no math** |
| **Review** | `biomarker_review` (`data_accuracy` → task `compare`) | **Only** agent that rewrites stored numbers (`modificationCommand`). n=1–5 may also propose alias, category, relabel **or** convert, compact `proposal.range` |
| **Catalog Cleaner** | `catalog_clean` (tasks: `units` / `category` / `aliases` / `default_range`; aliases `agent2`, `agent3`, `standardize_units`, `medical_categorise`, `name_consolidation`, `calibrate_ranges`) | Catalog fields after human apply. **One task per run.** No observation numbers, no overlay |
| **Range Calibrator** | `data_review` (`agent5`) | Overlay only. **No** observation values, no catalog grouping |
| **Health Coach** | `health_baseline` (`daily_recommendation` → task `today`) | `report` targets from approved+unflagged |
| **Test Planner** | `agent4` (`agent7` → task `literature`) | Summaries / gaps / actions / literature |
| **Front Desk** | `front_desk` | Route / profile. **No lab rows** |
| **Dictionary** | Dictionary UI | Approve, alias-map, reject, combine → tombstones |

**Retired as picks (keep instruction packs, alias them):** `agent2`/`agent3`/`standardize_units`/`calibrate_ranges` → Catalog Cleaner tasks; `agent5` → Calibrator; `medical_extract` → Parser; `data_accuracy` → Review `compare`; `daily_recommendation` → Coach `today`; `agent7` → Planner `literature`.

**Instruction packs are product.** Do not delete `server.ts` / viewer / `custom_system_instruction_*` when folding a name. Do not concatenate opposite packs (Parser no-math vs Review convert vs Calibrator overlay).

**Dispatcher:** n=1–5 → one Review session. n=10–50 report leftovers → Parser chunks. n≥20 hygiene → Catalog Cleaner **one task**. Overlay-stale ∩ `rangeVariesBy` → Calibrator. Full Calibrator novel stays on `data_review`.

### Laws

1. **Order:** parse → identity → clean → approve → overlay → use. Do not have agent N overwrite N−1 identity without an explicit merge.  
2. **Dictionary owns keys.** Agents propose; human approval owns permanence.  
3. **One canonical key per analyte.** Aliases fan in. Combine flow for merges — no half-merge.  
4. **No invented lab numbers.** Ranges/context ≠ fabricated readings.  
5. Change an agent schema ⇒ audit **apply / `onAgentFinish` / `handleLogMedical`**.  
6. **Food intake:** `filterLogsByTombstone` + `getMappedBiomarkerKey`; no tombstoned or unapproved keys.  
7. **Food is read-only** on dictionary/logs. Transient badges only.  
8. **Review apply** consumes `modificationCommand` (same date normalize as `handleLogMedical`). Empty `corrections` is not a no-op when commands exist.  
9. **Do not silent-rewrite** history in `setBiomarkerHistory` (no sanitize convert, no alias merge, no same-day collapse on set). Flag only. Ingest may merge same calendar day **once**.  
10. **`0` is a value.** `isValEmpty` must not treat zero as missing.  
11. **Literature laws §2.1** (three ranges, convert table, upsert, no average, age band, labFlag/printedRange, no race coefficient).

---

## 4. Dictionary & identity (current stores)

| Store | Role today | Target |
|---|---|---|
| `biomarkerDefinitions` | Hardcoded built-ins | Seed catalog |
| `biomarker_dictionary_store` | Dead dual path (`approvePendingBiomarker`) | Remove writes; migrate then drop |
| `profile.customBiomarkers` | Synced bag: defs + overlay + pending + agent scratch | Split overlay vs catalog |
| Tombstones | `deletedCustomBiomarkerKeys`, `deletedNotUsedBiomarkerKeys`, `notUsedBiomarkers` | Unchanged protocol (`sync.md`) |

**Invariants (keep during migration):**

- Renaming a key is a **migration** (logs, customs, tombstones, calibrations, UI).  
- Pending/approve helpers must not be bypassed by silent agent auto-write.  
- Combine via existing combine flows.  
- Not-used / deleted-not-used: no resurrect without user action.  
- Prefer `getMappedBiomarkerKey` before any new custom key.

---

## 5. Calibration

| Piece | Notes |
|---|---|
| Catalog `defaultRange` + `rangeVariesBy` | Population default; when overlay may differ |
| Overlay on profile | `data_review` / Review `proposal` |
| `agentCalibration.ts` | Reads `batch_analysis_results` (until overlay is first-class) |
| `evaluateStructuredRange` | Single parse path for range strings |

**Laws:** Calibration **contextualizes ranges**; it does not replace raw logged values.  
Profile filters (age/gender/ethnicity) on custom ranges must keep working.  
Do not store free-text ranges in three formats without one parse path.

---

## 6. Logs vs dictionary vs profile

| Data | Identity |
|---|---|
| `BiomarkerLog` | `id` + `date` + `biomarkers` map (today unitless numbers) |
| Delete log | `sync_state: 'delete'` **and/or** `deletedBiomarkerLogIds[id] = ts` |
| Display | Exclude deleted; tombstone **ts vs `updated_at`** |

Any UI “remove” must use the **same** delete/tombstone rules as `domains/sync.md`.

---

## 7. Cross-surface checklist (before COMPLETE)

- [ ] Dictionary key identity preserved or migrated  
- [ ] Apply path updates the correct record (observation vs catalog vs overlay vs pending)  
- [ ] No duplicate keys for the same analyte  
- [ ] Tombstones still filter (`MedicalAgentExecutor`, App)  
- [ ] Calibration still keyed by the same key  
- [ ] Combine / not-used / pending approval not bypassed  
- [ ] No new silent rewrite on `setBiomarkerHistory`  
- [ ] Convert uses the per-analyte table (or flags); no generic scale hack  
- [ ] Same-day merge only same `sourceReportId`; no averaging  
- [ ] Printed range / lab flag not written onto catalog or overlay  
- [ ] Instruction pack aliased if an agent name was folded  
- [ ] `assert-biomarker-flow.mjs` exit 0 if review/apply touched  
- [ ] Food still read-only on customs  

---

## 8. Agent → store write map (code as of 2026-08, until slices land)

**Apply hub:** `App.tsx` `onAgentFinish` + `handleLogMedical`.  
**Executor is read-only for stores.**

| Id | Durable writes today | Notes |
|---|---|---|
| `medical_extract` / `agent1` | History + current + `customBiomarkers`; batch may tombstone | Slug **without** always `getMappedBiomarkerKey` |
| `data_review` | Overlay fields only (2026-08-14) | No longer writes `userValue` / `correctedHistoricalLogs` |
| `agent2` / Catalog `category` | Grouping/risk/conditions on customs | No history values |
| `agent3` / Catalog `aliases` | Summary / alias groups | Real combine = dictionary modal |
| `agent4` | Planning summaries / gaps / actions | No lab keys |
| `agent5` | `agentContextualizerSummary` only | Does **not** write ranges |
| `biomarker_review` | `modificationCommand` + optional `corrections` + `proposal` overlay | Date match via `toYYYYMMDD` |
| `medical` | Apply → `handleLogMedical` | Customs often `needsApproval` |
| `front_desk` | Profile only; lab lines routed to Lab Parser | **No** `onAddBiomarkerLogs` writes |
| Dictionary UI | customs, approve, combine → tombstones | True consolidate path |

**Shared:** delete/combine/sanitize tombstones; `mergeProfiles` / `mergeBiomarkerHistory`.

### Identity rules (class X if you diverge)

1. `getMappedBiomarkerKey` before a new custom key.  
2. No parallel keys (`hdl` + `hdl_c_mgdl`) without combine.  
3. Delete key ⇒ tombstone + history migration.  
4. No invented numeric labs.  
5. Align slug logic across agent1 / `handleLogMedical` / front_desk or document in `AI_HANDOVER`.

### Tests

```bash
npx vitest run src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts
node scripts/assert-biomarker-flow.mjs
```

### Backlog (see plan slices)

1. Slice 0: no mutate on set; Review `modificationCommand`; relabel vs convert.  
2. Slice 1: catalog gate; all ingest through `getMappedBiomarkerKey`; retire destinations.  
3. Slice 2: per-log unit / conversion event; `0` is a value.  
4. Slice 3: Calibrator overlay-only + auto-run; Home/coach gate.  
5. Slice 4: Biomarkers golden inbox.  
6. Remove or migrate `biomarker_dictionary_store`.  
7. Hallucination guards on apply.

---

## 9. Anti-patterns

- Agent invents catalog keys on extract  
- Infer “approved” from complete-looking fields (target) / add more inferrers  
- Concatenate every specialist prompt into Review  
- Unit Relabel that converts numbers; sanitize that converts on load  
- `agent5` treated as the range writer  
- Front desk logging labs  
- UI delete without tombstone  
- Food mutating `customBiomarkers`  
- COMPLETE after one apply path when logs + dictionary + sync all moved  
- Deleting instruction packs when folding a **name**  
- Averaging two same-day labs  
- Generic `/10` `/100` `/38.67` convert  
- Copying printed lab range onto catalog or overlay  
- Race/ethnicity coefficient in catalog defaults
