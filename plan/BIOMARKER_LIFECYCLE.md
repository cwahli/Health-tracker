# Biomarker lifecycle

**Pillar:** 1 — Biomarkers. **Start work from:** [ROADMAP.md](./ROADMAP.md).  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Studio:** `studio/M31_BIOMARKER_LIFECYCLE_REMAINING_MULTIPASS.md`

This file is the **architecture**. Two parts, nothing dropped:

- **Part A** — product model (was `BIOMARKER_LIFECYCLE_PLAN.md`)
- **Part B** — ingest front door (was `BIOMARKER_INGEST_ROUTER_PLAN.md`)

Execute order, PRs, and class-first rules live in `ROADMAP.md` + `QUALITY.md`.

---

## Part A — Product model (catalog / pending / overlay / observations)

**Pillar:** 1 — Biomarkers. Map: `plan/README.md`. Execute: `BIOMARKER_IMPLEMENTATION_ROADMAP.md`.

**Status:** Design agreed 2026-08-14. Slices 0–3 **core** landed. 2026-08-14 late session: Home auto-fix / dictionary auto-calibrate+approve removed; pending = explicit `needsApproval` only; Review synthesizes convert commands when the model writes an essay. **Remaining work is §13 — do not start new agents until that list is walked.**  
**Rulebook (laws while coding):** `docs/agent/domains/biomarkers.md`  
**Ingest front door (2026-08-16):** `plan/BIOMARKER_INGEST_ROUTER_PLAN.md` — what Lab Parser / Review see after the deterministic router. Does not replace this file.  
**Gates:** `docs/agent/DOMAIN_REGRESSION_MAP.md` → Biomarkers  
**Do not implement this file as one PR.** Slices below. Instruction packs stay; agent *ids* stay until a dedicated migration.

---

## 0. Why this exists

Food is one-shot (scout → catalog → dietitian). Biomarkers are a **living catalog + dated observations** over months. The current app treats them like “another chat agent team”: 10+ personas write one bag (`customBiomarkers` + unitless log numbers). Result: ghosts, dups, invented keys, deletes that bounce, unit change that rewrites the number, Home/coach steered by dirty values.

This plan is the clean slate: **layers, roles, dispatcher, goldens** — reviewed against lab-informatics practice.

---

## 1. Literature / best practice (what we copy)

Not a hospital LIS. We still follow the same *shapes*.

| Practice | Source | What we do |
|---|---|---|
| **One code per analyte** | LOINC — identity so two labs do not file the same test as two concepts | Catalog `key` + `aliases[]`. `getMappedBiomarkerKey` on every ingest |
| **Value and unit are one pair** | FHIR Observation `valueQuantity` (value + UCUM unit); referenceRange is separate | Store `rawValue`+`rawUnit` and `canonicalValue`+`canonicalUnit`. Relabel ≠ convert |
| **Observation vs report** | FHIR Observation vs DiagnosticReport | One dated observation row; a PDF is a *source*, not a value |
| **Reference range vs this patient** | FHIR `referenceRange` + interpretation; lab “default” vs clinical overlay | Catalog = population default. Overlay = this profile. Calibrator writes overlay only |
| **Pre → analytical → post** | Lab medicine lifecycle | Source lock → extract → identity → clean → gate → use |
| **Completeness, conformance, plausibility, concordance, currency** | Weiskopf & Weng (JAMIA 2013); Kahn et al. harmonized DQ (2016) | Completeness = pending vs approved; conformance = legal unit pair + ISO date; plausibility = flag 15× / impossible pair; concordance = Field Compare; currency = as-of / profile fingerprint on overlay |
| **DQ loop** | HL7 PIQI-style assess → remediate → monitor | Flagger (code) → Review → goldens. Sanitize must **not** silent-rewrite |
| **Provenance** | LOINC/FHIR mapping literature (keep source names) | Never drop printed name/unit. Conversion is an event |

**We do not copy:** full LOINC codes in v1 (keys + aliases are enough); a hospital LIS; race-based eGFR coefficients as catalog medicine — Calibrator *cites* a named society, catalog stays generic.

### 1.1 Binding laws (from literature — Slice 0+)

These are **invariants**, not ideas. Code that contradicts them is a bug.

1. **Three ranges, never smashed.** Printed (on the observation, from the report) · catalog default · user overlay. Field Compare may show all three. No writer copies one onto another.
2. **Convert only via a per-analyte table.** Units must be comparable (UCUM idea). Unknown pair → flag, do not guess (`/38.67` on “whatever is large” is forbidden). HbA1c `%` ↔ `mmol/mol` is its own rule, not a multiply.
3. **Observation identity** is `(canonicalKey, date, sourceReportId)` (or excerpt hash). Re-parse of the same report is an **upsert**, not a second row.
4. **Same calendar day ≠ average.** Merge on ingest only when it is the same extract of the same source. Two labs on 13 Aug stay two observations.
5. **Overlay fingerprint uses age band** (e.g. 20–29), plus sex and ethnicity — not exact birthday. Re-run Calibrator when the **band** (or sex/ethnicity) changes.
6. **Keep `printedRange` and `labFlag`** (H/L/critical) on the observation when the report has them. Concordance: lab flag vs our overlay status is a check, not an LLM rewrite.
7. **No race coefficient in the catalog.** `rangeVariesBy: ethnicity` means “a published interval might differ.” Overlay may cite a society. Catalog defaults stay generic.

---

## 2. Target model (four records)

Do not merge these again.

```text
Catalog (admin dictionary)     population default: name, aliases, unit, range, category
        ▲ approve / alias-map
Pending extract (this user)    unknown names + raw observations
        │
Observations (logs)            dated value+unit+source on an approved key
        │
User overlay                   this person's range / optimal / notes
        ▼
Home + Health Coach            approved + unflagged only
```

### 2.1 Catalog (admin)

One row per analyte. Seed from `biomarkerDefinitions`. Status: `draft | approved | retired`.

Required: `key`, `aliases[]`, `displayName`, `canonicalUnit`, `usUnit`, `defaultRange`, `defaultDescription`, `grouping`, `defaultPopulation`, **`rangeVariesBy: ('age'|'sex'|'ethnicity')[]`**.

Only Dictionary UI (human) creates or **approves** a key. Agents **propose**.

### 2.2 Pending

Extract of a name that is not an approved key/alias → raw row in **this user’s** Medical History → Pending. No `customBiomarkers[new_slug]`. Not on Home. Not in coach.

### 2.3 Overlay

`profileAdjustedNormalRange`, `optimalValue`, `rangeBrackets`, description override. Keyed by catalog key + **profile fingerprint** (**age band**, sex, ethnicity). Does not change the catalog. If a Calibrator run equals the catalog default, store `same_as_catalog` and skip next time.

### 2.4 Observation

`{ id, key, date (ISO), rawValue, rawUnit, canonicalValue, canonicalUnit, sourceJobId, excerpt, printedRange?, labFlag? }`.  
Identity for upsert: `(key, date, sourceJobId)`.  
`key` is live only if catalog-approved. Grow = append dates.

**Today:** `BiomarkerLog.biomarkers` is `{ key: number }` with unit only on the dictionary. That is the US/SI class of bugs. Migration is Slice 2.

---

## 3. What “used” means

A key may appear in Medical History **categories**, Home, food badges, and `health_baseline` nutrient targets **only if**:

1. Catalog `status === approved` (not “has five fields”)  
2. Latest observation is **not flagged**  
3. Value+unit pair is legal  
4. Overlay range (if any) uses the same unit as the canonical value  

Otherwise: Pending or “Needs review.”

---

## 4. Agents — names, keep/fold, instructions

Internal **ids stay** (`agent1`, `data_review`, …) until a storage migration. **Say the new names.** Instruction text in `server.ts`, `FullScreenInstructionViewer`, `custom_system_instruction_*` is **not deleted**. Retired *picks* **alias** to the owner pack.

### 4.1 Names

| Say | Id / menu today | Fate |
|---|---|---|
| **Lab Parser** | `medical`, `medical_extract`, extract half of `agent1` | Keep as parse-only |
| **Review** | `biomarker_review` | Generalist for **1–5 keys** |
| **Name Deduper** | Name Consolidation (`agent3` folded) | Specialist 20+ |
| **Categoriser** | Medical Categorisation (`agent2` folded) | Specialist 20+ |
| **Unit Relabel** | Standardize Units | Specialist 20+; **relabel only** |
| **Field Compare** | Data Accuracy | Specialist 20+ |
| **Range Calibrator** | `data_review` (menu “Standardize Biomarkers” folded) | Overlay only; 20+ or silent one-key |
| **Health Coach** | `health_baseline` | Approved + unflagged only |
| **Test Planner** | `agent4` | Untouched |
| **Literature** | `agent7` | Untouched |
| **Front Desk** | `front_desk` | Route / profile; **no lab rows** |
| **Dictionary** | Dictionary UI | Human gate |

**Removed as destinations:** `agent3`, `agent5` (ranges lie), `medical_extract` as a second pick, Standardize Biomarkers label, front_desk-as-logger.  
**`agent5` range language** moves onto Calibrator. Blurb may feed Coach.  
**`agent1` / `agent2`** not user destinations; extract → Parser, ontology → Categoriser.

### 4.2 Role matrix (jobs stay even when names fold)

| Role | Owner | n=1–5 | n≥20 |
|---|---|---|---|
| Parse | Lab Parser | Composed into Review/Add | Parser only (chunked) |
| Identity | `getMappedBiomarkerKey` + catalog | Same | Same |
| Dedupe names | Name Deduper | Slice inside Review | Deduper only |
| Categorise | Categoriser | Slice inside Review | Categoriser only |
| Relabel unit | Unit Relabel | Mode on Review | Unit Relabel only |
| Convert / fix number | **Review only** | Review | Review on **flagged subset** |
| Field diff | Field Compare | Before/after in Review | Field Compare only |
| Overlay ranges | Range Calibrator | Auto if `rangeVariesBy` + overlay stale (silent or Review `proposal`) | Calibrator on that subset |
| Approve | Human Dictionary | One click | Queue |
| Coach / plan / literature | those agents | After clean | After clean |

### 4.3 Dispatcher

```text
scope = selected or flagged keys

n = 1–5:
  one Review (or Add) session
  composed slices — NOT concatenated specialist novels
  optional silent Calibrator on that key if overlay required (see §5)

n = 10–50 (one report):
  Lab Parser (chunks) → identity code → Pending leftovers
  Review on flagged only
  Calibrator on stale overlay ∩ rangeVariesBy

n ≥ 20–100 dictionary hygiene:
  Catalog Cleaner — exactly one task per run (units | category | aliases | default_range)
```

### 4.4 Instruction law

- Do **not** paste Parser 8.8k + Calibrator 8.8k + Units + Deduper into Review.  
- Review core (~4.1k) + ~2k slices (alias, one category, relabel **xor** convert). One JSON: `modificationCommand` + `proposal`.  
- Full Calibrator 8.8k stays on `data_review`. Review `proposal.range` is the compact overlay.  
- Opposite rules stay in different packs: Parser **no math**; Review **may convert**; Unit Relabel **no numbers**; Calibrator **no log numbers**.  
- `custom_system_instruction_agent2` etc. remain valid via alias.

---

## 5. When to run Range Calibrator (you do not guess)

Catalog = standard definition + **standard** range.  
Calibrator = **this profile** (age, sex, ethnicity). A key already in the dictionary can still need it.

You cannot see “will the range move?” without a table or a model. **The user never chooses.**

| Gate | Action |
|---|---|
| `rangeVariesBy` empty | Use catalog default. Do not run Calibrator |
| Symptom / AUDIT scores | Never ethnicity-calibrate (baseline 0 / AUDIT cutoffs in pack) |
| Overlay exists and profile fingerprint matches | Skip |
| Overlay missing or fingerprint changed, and `rangeVariesBy` intersects the change | **Run** (n=1: silent one-key; n≥20: batch those keys only) |
| Untagged new key, n=1 | Run compact overlay once; write back `rangeVariesBy` or `same_as_catalog` |
| Untagged, n≥20 | Cheap yes/no preflight, then full pack on `yes` only |

Seed `rangeVariesBy` (code, not LLM): BMI/ethnicity; Hb/Hct/ferritin/creatinine/uric acid/hormones/sex; eGFR/age; lipids/ethnicity optional. Sodium/many enzymes = `[]`.

BMI Asian cutoffs already exist in Home — they belong on catalog/overlay, not a one-off in the UI.

---

## 6. Unit vs value (non-negotiable)

Every unit edit is exactly one of:

- **`relabel`** — change catalog/display unit (and range *text* if it only names the unit). Numbers stay.  
- **`convert`** — rewrite canonical numbers with a named factor; keep `rawValue`/`rawUnit`. Review only.

Standardize Units = relabel. Ignore `conversionFactor` for writes.  
`setBiomarkerHistory` must **stop** remapping, same-day-merging, and `normalizeHistoricalTelemetryErrors` rewrites. Flagger stays. Sodium→143 and silent cholesterol `/38.67` go away as side effects.

---

## 7. Add-one-biomarker (user sees one session)

Example: “ApoB 90 mg/dL on 13 Aug.”

1. **Review/Add** extracts raw row (verbatim).  
2. Catalog hit → write observation; relabel **or** convert if unit fights dictionary.  
3. Catalog miss → **Pending** + suggested key/unit/category/default range. **Human approve.** No Categoriser chat.  
4. If `rangeVariesBy` and overlay stale → silent one-key Calibrator (or `proposal`).  
5. Home/coach only after approved + unflagged.

Two **model** calls possible (Review + silent Calibrator). Not five agents.

Whole PDF → Lab Parser (chunks), not this path.

---

## 8. Current code (honest)

| Symptom | Cause |
|---|---|
| Ghost / rematerialize | Current map last-write-wins; alias not tombstoned; built-ins always exist; dead `biomarker_dictionary_store` |
| Duplicates | Writers skip `getMappedBiomarkerKey`; front_desk always `push`; date `DD-MM-YYYY` vs ISO |
| Hallucinated keys/values | No source guard; agent1 invents slugs; sodium sanitize → 143 |
| Can’t delete | Locked bmi/weight/height logs; built-in rematerialize; sync union on equal `updated_at` |
| Deleted wrongly | agent1 fuzzy score≥40; `isValEmpty` treats `0` as empty; same-day merge last-wins |
| Number moves alone | `setBiomarkerHistory` → sanitize rewrite |
| Unit change also changes number | Relabel then sanitize/Review/US-save convert; no mode |
| Approval is fake | `isBiomarkerApproved` = five fields; agents auto-clear `needsApproval` |
| Home/coach on junk | No approval/flag gate |
| Review apply miss | `onAgentFinish` wants `corrections`; model emits `modificationCommand` |

Write map (today) stays in `docs/agent/domains/biomarkers.md` § write map until slices land.

---

## 9. Goldens (after Slice 0–2)

**Taxonomy:** lifecycle stages are UX/dispatch. Goldens group by **class** (Weiskopf DQ + auto-bugs), not by job. Build plan: `BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` §1.2.

Inbox: **Food | Biomarkers**. Do not clone meal kcal tables. Group the biomarker tab by **class**, then example.

Pin: `domain=biomarkers`, `class`, `agentId`, `lifecycleStage`, `jobId`, `scopeKeys`, `asOf`, history+def slice, fingerprint.

Board: observation table (key, date, raw, canonical, unit) + events + definition + batch cursor + **class**.

First fixture: `job_medical_1786660190499` (HDL/TG/LDL/bili unit mix) — example of `SILENT_REWRITE` + `APPLY_MISS`. Auto-bugs: impossible pair, 15× shift, apply didn’t land, silent sanitize would rewrite, pending on Home.

Replay = class unit test first, then frozen example. Not food NEW Analyze. Work item is the class, not “make this job all-green.”

---

## 10. Implementation slices

Do not delete instruction files. Goldens are Slice 4 — they are now unblocked for the HDL/TG unit-mix case, but the inbox itself is not built.

Status key: **landed** = in Desktop tree · **partial** = code exists, product gap remains · **open** = not done.

### Slice 0 — Contract (no new UI) — **landed, one leftover**

- Types: catalog / pending / overlay / observation (additive; logs can stay unitless until Slice 2) — **landed (additive)**  
- Approval = catalog flag, not five fields — **landed** (`isBiomarkerApproved` / `isPendingCatalogApproval`)  
- `setBiomarkerHistory`: **no** remap/merge/sanitize rewrite (flag only) — **landed**  
- Unify Review apply: `modificationCommand` + `toYYYYMMDD` — **landed** (plus synthesize-from-history when the model omits the array)  
- Relabel vs convert enum on unit apply — **open**  
- Display names in `agentConfig` + dictionary menu (ids unchanged) — **landed**

**Gate:** identity + sanitize tests updated so sanitize-on-set no longer *must* rewrite; Review apply test for `modificationCommand`.

### Slice 1 — Dictionary is the gate — **partial**

- Seed catalog from built-ins + `rangeVariesBy` — **partial** (built-ins exist; `rangeVariesBy` seeded in code, not a first-class catalog row)  
- Extract → pending if unknown; `getMappedBiomarkerKey` if hit — **partial** (mapped hits no longer become pending; unknown names still write `customBiomarkers[new_slug]`)  
- Parser/agent1/front_desk **stop** creating catalog keys — **partial** (built-ins skipped; unknown slugs still created)  
- Dictionary: approve / alias-map / reject — **partial** (one-click Approve / Auto-Calibrate **removed**; Save still edits the blended bag)  
- Hide `agent1`/`agent2`/`agent3`/`agent5`/`medical_extract` as destinations — **partial** (redirects exist; Insights may still open Lab Parser for report extract — intentional)  
- Alias instruction keys — **landed**  
- Kill writes to `biomarker_dictionary_store` (read once to migrate pending) — **landed** (writes stopped; migrate-then-drop still open)

### Slice 2 — Clean without destroying numbers — **partial**

- Per-log unit **or** conversion event — **partial** (`observationMeta` on **new** writes only; historical rows still bare numbers)  
- Unit Relabel does not convert — **open** as a dedicated UI/agent path  
- Review only number writer — **landed** for the Review apply path; `normalizeHistoricalTelemetryErrors` still exists in code (Home button removed)  
- ISO dates on ingest; same-day merge **on ingest only** if same `sourceReportId` — never average two labs — **partial**  
- `isValEmpty`: `0` is a value — **landed**  
- Extend flagger (HDL/LDL/TG/bilirubin) — **do not** auto-convert them — **landed** (flag + Review table convert; no silent `/38.67`)

### Slice 3 — Overlay + use surfaces — **partial**

- Calibrator writes overlay only — **partial** (data_review overlay-only path landed; Insights/dictionary still have leftover overlay-adjacent UI)  
- Auto-run policy §5 — **open** (helper `shouldRunCalibrator` exists; no silent one-key product)  
- Home, coach, food: approved + unflagged — **landed** for new payloads  
- Nutrient objectives rebuilt only from that set — **partial**

### Slice 4 — Goldens + Biomarkers inbox — **open**

- Domain pack, G-B1 from the medical debug job  
- Dispatcher by `scopeKeys.length`

---

## 11. Out of scope (this plan)

- Renaming storage ids (`agent4` → `test_planner`)  
- Deleting `server.ts` instruction blocks  
- Full LOINC/UCUM adoption  
- Rewriting Insights accordion in Slice 0  
- Food pipeline changes  

---

## 12. Doc map (after this plan)

| File | Role |
|---|---|
| **This file** | Architecture, literature, slices, **§13 remaining** |
| `docs/agent/domains/biomarkers.md` | Laws + current write map (protected) |
| `docs/agent/DOMAIN_REGRESSION_MAP.md` | Which tests |
| `AI_HANDOVER.md` | WIP / which slice is active |
| `studio/M31_BIOMARKER_LIFECYCLE_REMAINING_MULTIPASS.md` | **AI Studio pack** — paste §A; implements §13 P0–P8 |
| `plan/BIOMARKER_INGEST_ROUTER_PLAN.md` | Front door: classifier / leftover Parser / failure modes |
| `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` | **Build** — class-first goldens (UX lifecycle ≠ test taxonomy) + ingest router. Does not replace §13. |
| `plan/BIOMARKER_IMPLEMENTATION_ROADMAP.md` | **Order of work** — Waves 0–7 + PR cut. |

When a slice changes an invariant, update the rulebook **in the same change** (`AGENTS.md` §3).

---

## 13. Remaining work (2026-08-14)

Walk this list in order. Do **not** start another agent rewrite, Calibrator UI, or food work to “finish biomarkers.” Confirm Apply, then clean leftover data, then Slice 2 backfill, then Slice 4 so this class of bug cannot regress.

### 13.1 Smoke (do next — no new design)

- [ ] Reopen the existing Review job (refresh first). The apply card must show five convert rows, not only the essay:
  - HDL-C `50` → `1.293` mmol/L on 14-08-2026
  - Triglycerides `125` → `1.411` mmol/L
  - LDL-C `130` → `3.362` mmol/L
  - Creatinine `0.9` → `79.56` µmol/L
  - Total Bilirubin `0.8` → `13.68` µmol/L
- [ ] Click Apply. Confirm Medical History + Home show the converted numbers, raw is kept on `observationMeta`, and the Home telemetry banner drops those five keys.
- [ ] Confirm older SI rows are **untouched** (HDL 1.43, creat 100/72, bili 16/13).
- [ ] Confirm Home no longer shows Auto-Fix Historical Scaling, Inspect Card, Review in Medical History, or Edit Logs in Medical History.
- [ ] Confirm Dictionary no longer shows Auto-Calibrate, Auto-Fill Defaults, Quick Approve, Approve, Approve Selected, or Save & Approve.
- **B8 continuity (2026-08-19):** Flagged Telemetry Auto-Fix later returned on Home, and `computeBiomarkerTelemetryMultiplier` is a second factor table next to `convertViaTable`. Reconcile under `ROADMAP.md` **B8.0–B8.1** / `QUALITY.md` §13 (`SECOND_MATH_PATH`). Do **not** add a third convert path. Locked numbers stay `1.293` / `1.411` / `3.362` / `79.56` / `13.68`.

### 13.2 Leftover data on this profile (cleanup, not new architecture)

These are already in `customBiomarkers` / history from older extract+sync. The **pending count** no longer inflates from missing fields, but the junk rows remain until cleaned.

- [ ] One-time cleanup of leftover pending slugs: map aliases (`hdl_c`, unit-suffixed names) onto catalog keys; tombstone the duplicate key.
- [ ] Drop empty ghosts (`metric_N`, `needsApproval` with no history and no unit). `dataSanitize` already proposes this — run / apply it.
- [ ] Clear stale `needsApproval` on catalog-mapped keys (built-in overlay leftover). Display already ignores them; stored flags should go.
- [ ] Delete invented ethnicity `customRanges` that became `< 0 U/L` (auto-calibrate leftover). Do not invent replacements.
- [ ] Stop Lab Parser / LogChat / Insights from writing `customBiomarkers[new_slug]` for unknown printed names. Target: Pending observation only (plan §2.2). Mapped hits already skip.

### 13.3 Slice leftovers (product gaps)

**Contract / units**

- [ ] Relabel XOR convert as a first-class mode on any unit edit (plan §6). Relabel never rewrites numbers. Convert is Review + named table factor + keep raw.
- [ ] Backfill `observationMeta` (rawValue, rawUnit, printedRange, labFlag) onto **all** historical rows, not only new extracts. Until this, US/SI mixups stay flag-only unless Review runs.
- [ ] Observation identity `(canonicalKey, date, sourceReportId)` — re-parse of the same report is upsert, not a second row.
- [ ] Same calendar day ≠ average. Ingest merge only when `sourceReportId` matches. Two labs on the same date stay two observations.
- [ ] ISO dates on ingest; display may stay DD-MM-YYYY.
- [ ] Remove or permanently disable `normalizeHistoricalTelemetryErrors` as a writer (Home button is gone; the function must not come back on another surface).

**Dictionary / pending store**

- [ ] Real Pending store (this user, unknown printed name + raw value/unit/date/source). Not `customBiomarkers[new_slug]`.
- [ ] Human Dictionary is the only approve / alias-map / reject path. Agents propose. No one-click dummy approve.
- [ ] Seed catalog rows with `rangeVariesBy` as data, not only a helper map.
- [ ] Migrate then drop `biomarker_dictionary_store`.
- [ ] Name Deduper pass on leftover unit-suffixed / alias duplicates after the one-time cleanup.

**Overlay / live surfaces**

- [ ] Overlay as its own record (range / optimal / brackets + age-band fingerprint). Stop smashing printed / catalog / overlay.
- [ ] Silent one-key Range Calibrator when `rangeVariesBy` is set **and** overlay fingerprint is missing/stale (§5). User does not pick Calibrator.
- [ ] Do **not** restore Auto-Calibrate or ethnicity-invented ranges.
- [ ] Nutrient objectives rebuilt only from approved + unflagged observations (finish any food-badge / target path that still reads flagged or pending keys).

**Dispatcher / agents**

- [ ] n = 1–5 → one Review/Add session (composed slices, not concatenated specialist novels).
- [ ] n = 10–50 (one report) → Lab Parser chunks → identity → Pending leftovers → Review on **flagged only**.
- [ ] n ≥ 20 dictionary hygiene → exactly one specialist pack per run.
- [ ] Keep instruction packs. Do not delete `server.ts` / `custom_system_instruction_*`. Do not paste Calibrator 8.8k into Review.

### 13.4 Slice 4 — Goldens + Biomarkers inbox (**not started**)

Do not clone food kcal tables.

- [ ] Food | Biomarkers inbox in the golden UI.
- [ ] Pin G-B1 from `job_medical_1786660190499` **and** the later `job_medical_1786666223594` (same HDL 50 / TG 125 / LDL 130 / creat 0.9 / bili 0.8 vs SI history).
- [ ] Board: observation table (key, date, raw, canonical, unit) + events + definition + batch cursor.
- [ ] Auto-list bugs: impossible pair, 15× shift, apply didn’t land, silent sanitize would rewrite, pending on Home, Review essay with empty `modificationCommand`.
- [ ] Replay = re-parse frozen medical log **or** re-run the same agent on the frozen slice. Not food NEW Analyze.
- [ ] Gate: Review with empty `modificationCommand` still produces the five convert rows; Apply lands; SI history unchanged.

### 13.5 Still true from §8 (not fully retired)

These symptoms are **reduced**, not gone. Treat each as a remaining bug until a golden says otherwise.

| Symptom | Still to do |
|---|---|
| Ghost / rematerialize | Tombstone aliases; stop built-in rematerialize via custom overlay |
| Duplicates | Every writer must call `getMappedBiomarkerKey`; Name Deduper on leftovers |
| Hallucinated keys | Parser must not invent slugs; unknown → Pending only |
| Can’t delete / bounce | Same tombstone rules on every remove; sync must not resurrect `needsApproval` (newer-wins landed — soak) |
| Number moves alone | Keep sanitize flag-only; no new silent writers |
| Unit change also changes number | Relabel XOR convert UI (still open) |
| Approval is fake | Pending count fixed; leftover flags + slug-as-catalog still to clean |
| Home/coach on junk | New payloads gated; soak old profile after cleanup |
| Review apply miss | Synthesize-from-history landed; **Apply smoke still required** |

### 13.6 Out of scope (do not put on this remaining list)

Unchanged from §11: renaming storage ids, deleting instruction blocks, full LOINC/UCUM, Insights accordion rewrite, food pipeline / lassi / picnic goldens, GitHub push (process, not this architecture).

### 13.7 Definition of done for this plan

The biomarker track is done when:

1. Apply of the five 14-08-2026 converts is verified on the live profile.  
2. Unknown extract names never become catalog keys.  
3. Every historical observation has a unit (or an explicit “unit unknown” flag).  
4. Relabel cannot rewrite a number.  
5. G-B1 golden is pinned and replay-green.  
6. Home / coach / food badges never consume pending or flagged values.

Until then, new health-planning agents stay blocked on dirty telemetry.

---

## Part B — Ingest router (classifier, handoff, failure modes)

**Pillar:** 1 — Biomarkers. Map: `plan/README.md`. Execute: `BIOMARKER_IMPLEMENTATION_ROADMAP.md`.

**Status:** Design from 2026-08-16 review. Not started.  
**Parent:** `plan/BIOMARKER_LIFECYCLE_PLAN.md` (layers, roles, laws). This file does **not** replace that plan. It specifies the missing front door: how raw user input becomes observations, and what Lab Parser / Review actually see.  
**Build plan (class-first goldens + slices, debug):** `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md`  
**Rulebook:** `docs/agent/domains/biomarkers.md`  
**Do not implement this as one PR.** Implement via the build plan I0–I9, not §9 here alone.

---

## 0. Why this exists

Today every add-biomarker path dumps the raw payload into Lab Parser (`agent1_step1` / `medical`). The model:

- Re-reads the same CSV in `Chat History:` **and** `USER RAW DATA:`
- Echoes unparsed rows back as `remainingText` (22k output chars on the diagnostic job)
- Carries symptom-diary rules (HDSS / GERD / multi-day) on lab reports
- Invents `updated_at`
- Does identity, chunking, and qualitative judgement in one call

That is why a clean 115-row NHS/EMIS table costs 15–25s and three 50-item chunks.

The lifecycle plan already says the right order:

```text
parse → identity → clean → approve → overlay → use
```

Code still asks the LLM to do all five. This plan puts a **deterministic ingest router** in front of the agents so they only do the work that actually needs a model.

---

## 1. Target shape

```text
User input (text / table / photo / PDF / chat / Health Connect / UI)
        │
        ▼
┌───────────────────────────────────────┐
│  0. Source classifier (no LLM)        │
│     table | prose | image | structured│
│     | symptom | bypass                │
└──────────────────┬────────────────────┘
                   │
     ┌─────────────┼──────────────┐
     ▼             ▼              ▼
  bypass        table          image/PDF
  (Health       lexer          vision extract
   Connect,     (no LLM)       → same row
   Home UI,                    contract
   Dictionary)
                   │              │
                   ▼              ▼
        ┌──────────────────────────────────┐
        │  1. Row contract                 │
        │  printedName, date, rawValue,    │
        │  rawUnit, printedRange, comment, │
        │  sourceKind, sourceRowIndex      │
        └──────────────────┬───────────────┘
                           ▼
        ┌──────────────────────────────────┐
        │  2. Identity + unit-family gate  │
        │  catalog key / alias / custom    │
        │  name+unit family+plausibility   │
        └──────────────────┬───────────────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
     high-confidence   flagged          unmatched
     (write obs,       (Review on       (Lab Parser
      no LLM)           that subset)     on that subset)
           │               │                │
           └───────────────┴────────────────┘
                           ▼
              pending new keys → Dictionary
              learned aliases  → proposal only
              stale overlay    → Calibrator (unchanged)
```

**Hard rule:** high-confidence rows are invisible to every agent. There is no `approve_all` over 90 pre-parsed items.

---

## 2. How each agent's job changes

Agent **ids stay**. Instruction packs stay. What changes is *when they run, what they are given, and what they are allowed to emit*.

### 2.1 Lab Parser (`medical` / `agent1_step1` / `medical_extract`)

| | Today | After |
|---|---|---|
| Trigger | Any medical paste, photo, or “continue” | Only `unmatched` + `prose` + `symptom` + vision leftovers |
| Input | Full raw report + history + remaining text + 11k system prompt (labs **and** HDSS/GERD) | Compact pack for **this source kind only**. Rows already structured. No matched rows. |
| Job | Character-level extract of everything, invent keys, echo remainder | Map leftovers to a key **or** a pending suggestion. Extract value/unit/date verbatim. |
| Output | `extractedData[]` for the whole report + `remainingText` copy of the tail | `new_mappings[]` + `pending[]` only. **No `remainingText`.** Server owns the cursor. |
| Forbidden | Math, unit conversion (already law) | Same, plus rewriting a high-confidence row, inventing `updated_at` |

Two instruction packs, never concatenated:

- **`lab_extract`** — structured / leftover lab rows. No symptom-diary rules.
- **`symptom_diary`** — HDSS / GERD / joint pain, score 0–3, multi-day expansion. Only when the classifier says `symptom` or Front Desk routed a diary line.

Chunking moves off the model. If leftovers still exceed a token budget, the **server** slices by `sourceRowIndex` and calls Parser again. The model never copies unparsed text.

### 2.2 Review (`biomarker_review`)

| | Today | After |
|---|---|---|
| Trigger | User opens Review on 1–5 keys, or a later hygiene pass | Auto on **flagged ingest subset** (unit-family miss, implausible value, caveat comment). Still the destination for manual “fix this key”. |
| Input | Scoped current + history for those keys (already partly done) | Same, plus the pre-parser flag (`why_flagged`: unit mismatch, 15× range, comment mentions formula change, composite parse). |
| Job | Relabel xor convert; `modificationCommand` | Unchanged. Still the **only** agent that may rewrite a stored number. |
| Must not | Rubber-stamp 90 good rows | Same. If a row is not flagged, Review is not invoked. |

Parser and Review stay opposite packs: Parser **no math**; Review **may convert** via the per-analyte table.

### 2.3 Range Calibrator (`data_review`)

No change to role. Still overlay only. Still auto-runs when `rangeVariesBy` intersects a stale fingerprint.

Ingest change: Calibrator is **not** in the extract path. A 115-row CSV must not pull the 8.8k calibrator novel. After observations land, the existing gate decides whether a silent one-key or batch overlay run is needed.

### 2.4 Categoriser / Name Deduper / Unit Relabel

No change to role. They remain dictionary-hygiene specialists (n≥20), not part of first ingest.

Parser must not categorise. A new pending key does not get `riskCategories` from the extract call.

### 2.5 Front Desk (`front_desk`)

Stays a router. **Still must not write lab rows.**

New duty: classify intent and hand off.

| User says / does | Front Desk does |
|---|---|
| Pastes a table or “here is my bloods” | Route to Lab Parser **after** the ingest router (so a clean CSV may never reach an LLM) |
| “Blood in stool the last few days” | Route to `symptom_diary` pack |
| Photo of a report | Route to vision extract → same row contract |
| “Change my height to 163” | Profile update, not a lab observation |
| “What does my ALT mean?” | Answer / send to Coach. No extract. |

### 2.6 Dictionary (human)

Unchanged owner of permanence.

New queue items the ingest path may create:

- **Pending key** — printed name we have never seen.
- **Proposed alias** — Parser mapped `HbA1c levl - IFCC standardised` → `hba1c`. Shown as “add this print name as an alias?” not silently written.

Agents never auto-promote aliases. One wrong silent write (urine albumin → albumin) poisons every later upload.

### 2.7 Health Coach / Test Planner / Literature

No ingest change. They still read **approved + unflagged** observations only. Faster extract must not put pending or unit-flagged values on Home.

### 2.8 Work that disappears

These jobs stop existing as model work:

- Re-extracting `Serum sodium 143 mmol/L` when `serum_sodium` + `mmol/L` is already known
- Copying 80 unparsed CSV lines into JSON
- Inventing Unix timestamps
- Deciding whether “Renal profile” is a biomarker (empty Result + known panel header → skip, keep comment as a note)
- 50-item “continue?” loops on a well-formed table

---

## 3. Shared row contract

Every source that can produce observations must emit the same object **before** identity. Agents never see raw CSV characters if a lexer already succeeded.

```ts
type IngestRow = {
  sourceKind: 'table' | 'prose' | 'image' | 'structured' | 'symptom';
  sourceRowIndex?: number;          // table / leftover cursor
  sourceReportId: string;           // job id; upsert identity
  printedName: string;              // never drop
  date: string | null;              // per-row ISO; inherit previous table date if blank
  rawValue: number | string | null; // verbatim; 0 is a value
  rawUnit: string;                  // verbatim; '' if none
  qualitativeValue?: string;        // NEGATIVE, TRACE, '109 / 53'
  printedRange?: string;
  labFlag?: string;                 // H / L / from comment if explicit
  comment?: string;
  excerpt?: string;                 // short source snippet for Review
};
```

Identity output (code, not LLM):

```ts
type IdentityDecision =
  | { bucket: 'high_confidence'; key: string; reason: 'exact_key' | 'alias' | 'custom_name' }
  | { bucket: 'flagged'; key?: string; why: FlagReason }
  | { bucket: 'unmatched' }
  | { bucket: 'skip'; why: 'panel_header' | 'empty' | 'tombstoned' };
```

**High-confidence requires all three:** name match (see §4) **and** unit family match **and** value not implausible (`isBiomarkerValueImprobable` / convert-table pair).

Store on write: `rawValue` + `rawUnit` + `printedRange` + `printedName`. Canonical value is filled only when the convert table knows the pair. Otherwise leave canonical empty and flag — do not guess `/38.67`.

Observation identity stays `(canonicalKey, date, sourceReportId)`. Same calendar day from the **same** extract upserts. Two labs on 13 Aug stay two rows.

---

## 4. Identity matcher (what “recognised” means)

`getMappedBiomarkerKey` today is exact-slug against the 29 built-ins only. It does **not** read `customBiomarkers`. A probe of the NHS list got **10 / 65** unique names. The matcher has to grow or the router does almost nothing.

Match order (first hit wins; longer printed name wins over a shorter token):

1. Exact catalog key / name (punctuation-stripped, UK/US spelling fold: haemoglobin→hemoglobin).
2. Exact alias on the catalog **or** `CUSTOM_KEY_ALIASES`.
3. Exact custom key / custom display name / custom alias on **this profile**.
4. Whole-token contains of a catalog key (`hba1c` inside `hba1c levl ifcc standardised`; `egfr` inside `egfrcreat ckd-epi`). Reject if a **longer** catalog token also matches (`cholesterol/hdl ratio` beats `cholesterol`).
5. Stop. Do not Levenshtein-auto-approve.

Specimen / matrix guard: `urine` / `serum` / `saliva` / `free` / `total` / `adjusted` / `non-hdl` in the printed name must agree with the candidate key. `Serum albumin` ≠ future urine albumin. `Serum calcium` ≠ `Serum adjusted calcium`.

Unit family (examples, not exhaustive):

| Family | Members |
|---|---|
| count_e9 | `10^9/L`, `109/L`, `K/uL`, `x10^9/L` |
| count_e12 | `10^12/L`, `1012/L`, `M/uL` |
| fraction_or_pct | `L/L` hematocrit 0.48 ↔ `%` 48 — convert table, not string equality |
| lipids_molar | `mmol/L` for chol / HDL / LDL / trig |
| lipids_mass | `mg/dL` for the same |
| hba1c | `%` vs `mmol/mol` — IFCC formula only, already in `unitConversion.ts` |

Name match + wrong family → `flagged`, not high-confidence. That is how `triglycerides 1.7 mmol/L` against catalog `mg/dL` avoids being stored as 1.7 and marked Optimal.

---

## 5. Source classifier — whole input range

Classifier is code. It runs before any agent. Mixed payloads are split, not forced into one path.

### 5.1 Decision table

| # | What the user does | Classifier | Deterministic work | Agent? |
|---|---|---|---|---|
| 1 | Pastes NHS/EMIS CSV (`Date,Test Name,Result,Normal Range,Comment`) | `table` | RFC 4180 lexer, per-row date, alias match | Parser **only** on unmatched / qualitative-in-comment / questionnaires. Review **only** on unit/plausibility flags. |
| 2 | Pastes TSV / pipe / another portal table (Quest, LabCorp, private UK) | `table` if headers sniff; else `prose` | Same lexer + header map | Fail-open: unparseable lines → Parser |
| 3 | Pastes a table **plus** a sentence (“the ALT is the one I care about”) | split: `table` + `prose` | Table as (1). Sentence is overlay, not a second full extract | Parser on the sentence only if it contains a new reading |
| 4 | Photo / screenshot of a report | `image` | none yet | **Vision extract** to the row contract, then the **same** matcher. No CSV lexer on pixels. |
| 5 | Multi-page PDF / several photos | `image` | page/image list | Vision per page → rows → matcher. Server concatenates rows; no `remainingText`. |
| 6 | Chat one-liner: “ALT was 41 last Tuesday” | `prose` | date parse if explicit | Lab Parser `lab_extract` on that sentence. Tiny prompt. No diary pack. |
| 7 | Symptom diary: “blood in stool the last few days” | `symptom` | none | `symptom_diary` pack only (score + multi-day). Must not run on (1). |
| 8 | Mixed: photo + “also I have heartburn” | `image` + `symptom` | matcher on vision rows | Vision leftovers → `lab_extract`. Heartburn → `symptom_diary`. Two small calls, not one mega-prompt. |
| 9 | “continue” on a long paste | n/a | server advances `lastProcessedIndex` | Same agent as the original leftover bucket. Model does not search the previous JSON inside the raw file. |
| 10 | Google / Apple Health steps (or later vitals) | `structured` **bypass** | write `steps` (etc.) as observations | **No Lab Parser.** Already a key+value. |
| 11 | Manual Home / dictionary add or edit | `structured` **bypass** | write / overlay via UI | No extract agent. |
| 12 | Front Desk general chat | bypass | route only | Front Desk. No lab rows. |
| 13 | User opens Review on one key | n/a | load that key’s logs | Review as today. |
| 14 | User runs Calibrator / Categoriser / Deduper | n/a | batch keys | Unchanged specialist packs. |
| 15 | Nutrition label paste | **not this pipeline** | `parseMenuNutritionPaste` | Food catalog. Do not invent a second biomarker path. |
| 16 | FR / ZH / ID lab text | `prose` unless table headers recognised | English/NHS token matcher will mostly miss | Parser gets the unmatched rows. Do not fuzzy-match across languages in v1. |
| 17 | Same file spanning 2020–2026 | `table` | **per-row** dates; no file-level date | — |
| 18 | Empty panel headers, GPPAQ names-as-answers, infection tests with blank Result | `table` | skip headers; qualitative tokens from Comment; GPPAQ → unmatched | Parser for GPPAQ / AUDIT items / HIV-in-comment. |

### 5.2 Worked example — the NHS list from the review

This is the file that triggered the diagnostic. Expected **first** ship (after an NHS alias table, not with today’s 29-key slugger):

| Bucket | Approx. rows | Who works |
|---|---|---|
| Skip (panel / empty / point-of-care) | ~12 | Code. Keep comments as notes when they carry clinical text (“Raised — diet advice”). |
| High-confidence labs (Na, K, creat, ALT, AST, lipids in mmol/L matching catalog family, HbA1c mmol/mol, BMI, …) | majority, **after** aliases exist | Code only. 0 tokens. |
| Flagged | triglycerides/LDL if catalog unit is still `mg/dL`; hematocrit `0.48 L/L` vs `%`; any 15× outlier | Review on **those keys only** |
| Unmatched | GPPAQ, AUDIT items, FAST, HIV/COVID qualitative, QRISK/QDiabetes if not yet in catalog, PSA, pulse, BP composite | Lab Parser `lab_extract` on this short list |
| Dropped by apply today | `weight` / `height` | Fix apply (`handleLogMedical` currently ignores them). Matcher must not pretend they landed. |

Do not quote “91 rows, 0 tokens” until a golden of this file says so. Day-one without the alias table still sends most rows to Parser — the prompt is just smaller because the lexer already split columns.

### 5.3 Image / PDF path (the other high-volume input)

```text
photo/PDF
  → vision model: "return IngestRow[] only. no keys. no remainingText."
  → same identity gate as a CSV
  → high-confidence write
  → leftovers to Lab Parser (already rows, not pixels)
```

Vision is allowed to **segment** a page into rows. It is not allowed to choose canonical keys if the matcher can. If vision returns garbage columns, those rows are `unmatched`, not silently stored.

### 5.4 Symptom path (must stay separate)

Classifier cues: no table headers, first-person symptom language, no numeric lab shape, or Front Desk tag.

Parser here **may** quantify 0–3 and expand “the last few days” using `CURRENT DATE`. That pack is forbidden on sourceKind `table` / `image` leftovers. A CSV must never create HDSS rows.

### 5.5 Structured bypass

Google Health steps, later Health Connect vitals, and typed Home fields already have a key. Running Lab Parser over them is how you get duplicate `steps` keys and invented dates. Router writes the observation and stops.

---

## 6. What the agent is actually sent

### 6.1 Lab Parser (`lab_extract`) — leftover only

```text
EXISTING KEYS: canonical built-ins + approved custom keys
  (no metric_01…metric_60, no duplicate aliases)

UNMATCHED ROWS:
  [ { i: 14, date: "2026-06-09", printedName: "Chlamydia DNA detection",
      rawValue: null, comment: "NEGATIVE" }, ... ]

FLAGGED (context only, do not re-extract):
  [ { i: 41, printedName: "Serum triglycerides", rawValue: 1.7,
      rawUnit: "mmol/L", catalogKey: "triglycerides",
      catalogUnit: "mg/dL", why: "unit_family_mismatch" } ]
```

Flagged rows are listed so Parser does not invent a parallel key. Parser does **not** convert them. Review does.

Response schema (delta):

```json
{
  "text": "string",
  "new_mappings": [
    {
      "sourceRowIndex": 14,
      "biomarker": "chlamydia_dna",
      "display_name": "Chlamydia DNA",
      "numeric_value": null,
      "qualitative_value": "NEGATIVE",
      "unit": "",
      "date": "2026-06-09",
      "explanation": "qualitative in comment"
    }
  ],
  "proposed_aliases": [
    { "printedName": "HbA1c levl - IFCC standardised", "key": "hba1c" }
  ]
}
```

Removed from the schema: `updated_at`, `remainingText`, `hasMoreMarkers`, `estimatedTotalMarkers`. Server stamps time. Server knows if more leftover rows exist.

### 6.2 Review — flagged only

Same `modificationCommand` + optional `proposal` as today. Input is the flagged subset plus `why_flagged`. Empty `corrections` is still not a no-op when commands exist (existing law).

### 6.3 Prompt construction bugs that this plan also kills

Independent of the matcher; do these even if identity ships later:

1. Raw payload lives in **one** place (`USER RAW DATA` or the unmatched-row JSON). Never also inside `Chat History:`.
2. Stop prepending `Chat History:` twice.
3. `Chat History` for extract jobs is routing/intent only — not the 115-row paste.

---

## 7. Apply path (after agents, still code)

`handleLogMedical` / `onAgentFinish` stay the write hub. Router writes must go through the same hub so tombstones, same-day upsert, and pending stamps stay consistent.

Fixes required so the router is not lying:

| Bug | Effect on this plan |
|---|---|
| Apply drops `weight` / `height` / `age` | Biometric rows from EMIS never land. Either stop dropping or route them to profile fields **explicitly**, not silently. |
| Apply merges any same calendar day | Correct for LFT+bone albumin on one draw. Wrong for two labs, same date, different `sourceReportId`. Gate merge on source id (lifecycle law §2.1.4). |
| New extract slugs skip `getMappedBiomarkerKey` on the custom bag | Parallel keys (`serumsodium` vs `serum_sodium`). Router + apply must share one identity function that **includes** custom names. |

Pending: unknown printed name → this user’s Medical History Pending. Not `customBiomarkers[new_slug]` as an approved Home key. `needsApproval` remains explicit.

---

## 8. Laws this plan must not break

Copied so implementers do not “simplify”:

1. Parser **no math**. Review **may convert**. Calibrator **no log numbers**.
2. Dictionary owns keys. Agents propose aliases; humans approve.
3. Three ranges never smashed (printed / catalog / overlay).
4. Convert only via the per-analyte table. Unknown pair → flag.
5. `0` is a value.
6. Do not silent-rewrite history on set.
7. Coach / Home see approved + unflagged only.
8. Front Desk writes no lab rows.
9. Instruction packs stay; do not concatenate Parser + Calibrator + Deduper into Review.
10. Food nutrition paste stays on the food pipeline.

---

## 9. Implementation slices

Not one PR. Each slice is independently shippable and golden-tested.

| Slice | What lands | Agent-visible change |
|---|---|---|
| **A** | Prompt hygiene: single raw injection, no double `Chat History:`, drop `updated_at`, replace `remainingText` with server cursor | Parser cheaper even with no matcher |
| **B** | Split `lab_extract` vs `symptom_diary` packs; classifier chooses | Lab CSV no longer carries HDSS rules |
| **C** | Table lexer + row contract + skip panel headers | Parser receives rows, not a blob — still all unmatched until D |
| **D** | Identity function used by matcher **and** apply: built-ins + aliases + custom names; unit-family gate | First high-confidence auto-writes. Parser input shrinks. |
| **E** | NHS/EMIS alias table + qualitative-in-comment + BP / AUDIT composites | This diagnostic file becomes the golden |
| **F** | Vision extract emits `IngestRow[]` then D | Photos share the matcher |
| **G** | Flagged subset → Review automatically; proposed aliases → Dictionary queue | Reviewer-only-on-errors, without `approve_all` |
| **H** | Apply fixes: weight/height policy, `sourceReportId` upsert | Router results actually persist |

Slice A–B are the original Phases 1–3. They do not depend on a matcher. Ship them first.

**Out of v1:** fuzzy auto-approve, silent alias writes, sending matched rows to the model “just in case”, one engine for photos and CSVs, language-agnostic fuzzy names.

---

## 10. Acceptance

A change is done when:

1. Golden of the NHS/EMIS paste: lexer column-splits every well-formed row; high-confidence count is asserted; triglycerides `1.7 mmol/L` is **flagged**, not stored as 1.7 against `mg/dL`; GPPAQ/AUDIT items are unmatched, not skipped; panel headers are skip+note.
2. `agent1_step1` traces on that golden show **no** high-confidence printed names in the prompt, and **no** `remainingText`.
3. A one-sentence “ALT was 41 yesterday” still reaches `lab_extract` and produces one observation.
4. “Blood in stool the last few days” still reaches `symptom_diary` and expands days. The NHS CSV does not.
5. A lab photo still produces rows (vision) and then uses the same identity function.
6. Google Health steps do not call medical-analyze.
7. New keys are pending; Home/coach unchanged until Dictionary approve + unflagged.
8. `assert-biomarker-lifecycle` / identity tests still pass; `getMappedBiomarkerKey` (or its successor) is the single identity entry.

---

## 11. Key decisions

1. **Router in front of agents, not a smarter Lab Parser.** Agents keep their ids and packs. Work is removed by not calling them.
2. **High-confidence rows never go to an LLM.** `approve_all` is rejected — it recreates token cost and yes-bias.
3. **One row contract for table, vision, and prose leftovers.** Identity is shared. Sources differ only in how they produce rows.
4. **Two Parser packs.** Symptom diary must not ride on lab extract.
5. **Unit family is part of identity.** Name-only match is how this exact CSV would poison lipids and hematocrit.
6. **Aliases are proposed, not learned silently.** Matches the Dictionary-owns-keys law.
7. **Bypass structured sources.** Health Connect and typed UI are not “reports”.
8. **Ship prompt cuts (A–B) before the matcher (D–E).** They pay down the diagnostic immediately; the matcher is worthless if apply still drops height/weight and identity ignores custom names.

---

## 12. Open questions (product, not architecture)

1. **Weight / height from a lab file:** write as observations, write to profile, or both? Today apply drops them. Need an explicit choice before slice H.
2. **Panel-header comments** (“Raised — repeat in 3 months” on `Serum lipids`): store as a note on the next lipid observation, a pending free-text, or drop?
3. **Blood pressure:** two keys (`systolic` / `diastolic`) vs one qualitative `109 / 53`. Recommend two keys; confirm before the composite extractor lands.

These do not block slices A–C.

---

## 13. Failure modes and the Layer-1 ↔ Parser handoff

This is the dangerous boundary. Layer 1 (classifier + lexer + identity) can **write without a model**. If it is wrong, Parser never sees the row and cannot save you. If it is unsure, Parser must get a structured leftover — not a guess, and not a dropped line.

### 13.1 Bias

| Error type | Who pays | Rule |
|---|---|---|
| **False high-confidence** (wrong key or wrong number written, Parser never called) | Patient / Home / Coach | **Forbidden.** Name + unit family + plausible, or do not write. |
| **False unmatched / flagged** (good row sent to Parser) | Tokens / latency | **Allowed.** This is the safe direction. |
| **Silent drop** (row had signal, neither layer saw it) | Lost clinical data | **Forbidden.** Skip only for known empty panel headers. Everything else is skip-with-note, unmatched, flagged, or reject. |
| **Parser invents a number** for an incomplete row | Same as false high-confidence | **Forbidden.** Parser maps names and reads qualitative tokens. It does not fill blanks. |

Layer 1 is therefore **conservative**. Parser is a **name/qualitative resolver**, not a second extractor of rows Layer 1 already committed.

### 13.2 Handoff object (every ingest)

Layer 1 always produces a batch, even when it writes nothing:

```ts
type IngestBatch = {
  classifier: {
    sourceKind: 'table' | 'prose' | 'image' | 'structured' | 'symptom' | 'reject';
    confidence: 'high' | 'low';
    why: string;
  };
  rows: IngestRow[];                 // every line that had any signal
  decisions: IdentityDecision[];     // parallel to rows
  highConfidence: IngestRow[];       // staged, not Home-live until user confirms batch
  flagged: { row: IngestRow; why: FlagReason }[];
  unmatched: IngestRow[];            // Parser input
  skipped: { row: IngestRow; why: string }[];
  rejected: { reason: string; excerpt: string };
  lexerHealth: {
    parsedFraction: number;          // rows with ≥ date|name|value
    shiftedColumnSuspect: boolean;
  };
};
```

**Abort table path** (treat the whole paste as `prose`, **zero** high-confidence writes) when any of:

- classifier confidence is `low`
- `parsedFraction < 0.6`
- `shiftedColumnSuspect` (dates in Result, names that look like units, >20% rows with value-in-name-column)
- sourceKind was forced to `reject` (see §13.5)

Parser then receives either structured `unmatched[]` or, if the lexer itself is untrustworthy, the **original text** under `lab_extract` with instruction: *do not invent rows; return `new_mappings` only for readings you can quote*. That is the fail-open hatch. It is still smaller than today’s dual-injected blob because history/profile/diary packs stay off.

**Parser must not** receive `highConfidence[]` for re-approval. It may receive a **count** (“82 rows already staged as standard labs”) so it does not recreate `serum_sodium` from a leftover comment.

**Flagged[]** is sent as context only: “these keys exist, do not invent a parallel key.” Parser does not convert them.

### 13.3 Incomplete input

| What arrived | Layer 1 | Parser |
|---|---|---|
| Name + empty Result + empty Comment (`Renal profile`) | `skip` known panel, or `unmatched` if unknown header | Only if unmatched. Must not invent a value. |
| Name + empty Result + qualitative in Comment (`NEGATIVE`) | `unmatched` (or high-confidence if that qualitative token is in a tiny allow-list **and** the name already maps) | Map name; copy `NEGATIVE` verbatim. |
| Name + empty Result + answer in the name (GPPAQ, SARS-CoV-2 “…negative”) | `unmatched` | May read the name. Must not invent a numeric score. |
| Value + unit, no name | `unmatched`, printedName `""` | **Refuse to guess the analyte.** Return pending or drop with explanation. |
| Name + number, no unit (`4.3` or `4.3 n/a`) | Match name; **flag** if catalog has a unit. High-confidence only for unitless scores we already know (ratios). | Does not invent `mmol/L`. |
| Name + unit, no number (`mmol/L` only, or `pending`, `insufficient sample`) | `unmatched` or `skip-with-note` | No numeric_value. May create a pending note, not a 0. `0` is only a value when the print is `0`. |
| No date on a table row | Inherit previous row’s date if the file is sorted; else `flagged` `missing_date` | Must not default to “today” for a lab table. Prose/symptom may use `CURRENT DATE`. |
| Truncated comment / cut-off CSV line (PSA, LDL in the diagnostic file) | Parse the columns that closed; rest stays in `comment` / `excerpt` | Do not complete the English sentence. |
| `<5`, `>90`, `undetectable` | Store as qualitative, or numeric bound + flag. Not a float 5. | May keep `qualitative_value: "<5"`. No math. |
| European `4,3 mmol/L` | Lexer tries `,` as decimal when there is no other comma-column; if ambiguous → unmatched | Quote as printed if still unmatched. |
| Half a paste (user selected 20 of 140 rows) | Process those 20. Do not assume missing FBC lines exist. | Same. |
| Header only, or 1–2 junk lines | `reject` or prose with no mappings | Return empty `new_mappings`. |
| Photo cropped, missing the Result column | Vision rows with empty rawValue → unmatched | Same as empty Result. Do not OCR-guess a number from a smudge. |

Incomplete is **not** “ask the model to finish the spreadsheet.” It is “stage what is printed, flag what is missing, never fill.”

### 13.4 Wrong-but-lab-shaped (the matcher’s real risk)

These look like rows. Layer 1 is tempted to write.

| Failure | Example | Layer 1 must | Parser |
|---|---|---|---|
| **False friend name** | `Urine albumin` vs serum albumin; `Free T` vs total; `Cholesterol/HDL ratio` vs cholesterol; `MCH` vs haemoglobin | Longer-token wins + specimen guard. Unit family: mg/L urine ≠ g/L serum → **flag or unmatched**, never high-confidence | Sees unmatched/flagged with `candidateKey` and `why: specimen_or_token_conflict` |
| **Shifted columns** | User re-saved CSV; Result is in Comment; dates in Test Name | `shiftedColumnSuspect` → abort table path, **zero** auto-writes | Gets original text or raw lines. Better a slow parse than 80 wrong numbers. |
| **Wrong unit, right name** | Triglycerides `1.7 mmol/L` vs catalog `mg/dL`; hematocrit `0.48 L/L` vs `%` | **Flagged**, not high-confidence | Context only. Review converts. |
| **Impossible value** | ALT `10000`, Na `14`, HbA1c `400` | **Flagged** `implausible` even if name+unit match | Context only. Review or user. |
| **User typed the wrong number** in an otherwise perfect row | ALT really 14, they typed 41 | Undetectable. High-confidence will write 41. | Does not second-guess a clean row. Mitigation is **batch confirm**, not a second LLM. |
| **Someone else’s EMIS export** / demo file | Perfect 140-row table, wrong patient | Looks high-confidence. Matcher cannot know. | Never sees it. **Batch confirm** required before Home: “Log 82 readings (2020–2026) into *this* profile?” |
| **Same file pasted twice** | Second job, same `sourceReportId` hash | Upsert `(key, date, sourceHash)`. No duplicate points. | Leftovers upsert the same pending keys. |
| **Edited row in a good file** | User changed one ALT before paste | That row writes the edited number if it still passes gates | Not a Layer-1 problem. |
| **US and UK mixed in one paste** | Hb 14.5 g/dL next to Hb 166 g/L | Each row gated separately. g/dL vs catalog g/L → flagged | No silent ×10. |
| **Qualitative vs numeric dual-use** | Protein `Negative` one day, `15 mg/dL` the next | Both legal. Different value kinds on same key. | Must not coerce `Negative` to 0. |

### 13.5 Completely wrong input (not a lab report)

| What they pasted / sent | Classifier | Layer 1 writes | Parser |
|---|---|---|---|
| Food / nutrition label | `reject` or hand to food pipeline (`parseMenuNutritionPaste`) | Nothing medical | Not called |
| “What’s for dinner” in medical chat | `reject` / Front Desk | Nothing | Not called, or Front Desk routes |
| Symptom sentence | `symptom` | Nothing yet | `symptom_diary` only |
| Random prose, no numbers, no symptoms | `reject` | Nothing | Optional one-liner: “I don’t see lab readings.” Empty mappings. |
| Photo of a clinic letter / invoice / ID | `image` → vision returns 0 rows or garbage | Zero high-confidence (lexerHealth on vision rows fails) | Empty or “this is not a results table” |
| HTML / email thread with a table buried in it | Try table extract on `<table>` / markdown; if messy → `prose` | No auto-write unless a clean table island is isolated | Prose pack on the island or full text |
| Another agent’s JSON dump | Looks structured but not Date/Test/Result | `prose` or `reject` | Do not treat keys as new biomarkers blindly |
| Empty, whitespace, or a single comma | `reject` | Nothing | Not called |
| Non-English paragraph | `prose` | Unmatched | Parser may map if it can; v1 no fuzzy cross-language identity |
| Profile chat (“I am 34, 163 cm”) | Front Desk, not Lab Parser | Profile fields only if Front Desk path | Lab Parser not invoked |

**Rule:** if Layer 1 cannot name at least one analyte **or** the classifier is `reject`/`low`, Parser’s success metric is **empty `new_mappings`**, not creativity.

### 13.6 Modality misfires (wrong door)

| Misfire | What goes wrong | Handoff |
|---|---|---|
| Photo sent, classifier thinks `prose` (caption only) | Miss the pixels | If `images[]` present, **always** run vision path in parallel. Caption is overlay prose, not a substitute. |
| Table pasted, classifier thinks `symptom` because “blood” appears | HDSS pack on a CBC | Table header wins over keyword. `Date,Test Name,Result` ⇒ `table`. |
| Symptom + accidental CSV snippet | Diary expansion on lab rows | Split: table island vs first-person sentences. Two packs. |
| Continue on a job whose lexer already finished | Old `remainingText` path re-sends the tail | Server: leftover cursor empty ⇒ “already done”, no model call. |
| User pastes labs into Front Desk | Front Desk must not write rows | Route to router. Same Layer 1. |
| User pastes labs into food chat | Food scout | Do not identity-match ALT into a meal. Reject/route. |
| Vision returns rows **and** Layer 1 also lexes the caption CSV | Duplicate observations | One `sourceReportId`. Dedup by `(printedName, date, rawValue)` before write. |

### 13.7 What Parser is allowed to do on leftovers

Allowed:

- Map `N. gonorrhoeae nucl acid detn` → suggested key + `NEGATIVE`
- Split `109 / 53 mmHg` into systolic/diastolic **or** keep qualitative
- Say “this line is a GPPAQ item, pending key `gppaq_cycling`”
- Return **no** mappings and a sentence when the leftover list is not medical

Forbidden:

- Emit a row that is not in `unmatched[]` (no “I also noticed sodium”)
- Change a flagged or high-confidence value
- Default missing dates to today on `sourceKind=table`
- Default missing values to 0, “normal”, or the printed range midpoint
- Convert units
- Auto-approve a new key onto Home

If Parser is unsure whether a leftover is a biomarker: **pending or omit**, never high-confidence.

### 13.8 User-visible recovery when Layer 1 or Parser was wrong

Auto-write is **staged** for the batch (see open question: confirm-before-Home). Recovery does not need a fourth agent:

1. Batch card lists staged high-confidence counts by date.
2. User can uncheck a date or a key before Save.
3. After Save, Review on one key still works (`modificationCommand`).
4. Re-paste of the same file upserts; it does not stack a second ALT on that day from the same hash.
5. A bad alias proposal is declined in Dictionary; it is not already in the matcher.

### 13.9 Failure goldens (add with slice D–E)

Each line is a test that must not high-confidence-write the wrong thing:

1. NHS file as-is (happy path + flags in §5.2).
2. Same file with columns rotated one to the right → **zero** auto-writes, Parser or prose.
3. `Urine albumin 12 mg/L` next to `Serum albumin 46 g/L` → two identities, no merge.
4. `Serum triglycerides 1.7 mmol/L` → flagged, not 1.7 against mg/dL.
5. Paste of a Yolk nutrition label into medical chat → reject / food route, 0 lab rows.
6. “blood in stool the last few days” → symptom pack, 0 table writes.
7. Photo + “ALT is the one I care about” → vision rows + one prose leftover; no double ALT.
8. Single cell `41` with no name → Parser refuses analyte.
9. `insufficient sample` on creatinine → no 0, no skip-without-note.
10. Re-paste identical file → upsert, observation count unchanged.

### 13.10 Key decision (handoff)

**Layer 1 may only commit when it is boring.** Anything incomplete, specimen-ambiguous, unit-mismatched, implausible, unparseable, or not-a-report goes to Parser as structured leftovers — or to reject. Parser may not invent analytes or numbers. Completely wrong *but well-formed* labs (wrong patient) are a **batch confirm** problem, not an LLM problem.

---

## 14. Structural Architectural Improvements (Planned)

*These concepts are planned to systemically address edge cases in range rendering, demographic branching, and ingestion formatting noise across all biomarkers.*

### 14.1 Demographic-Aware Reference Range Engine
**Goal:** Replace single, combined string ranges (`"normalRange": "202 - 416"`) with dynamic resolution branches.
- **Schema Addition:** `BiomarkerDemographicRange` containing specific limits for `male`, `female`, and `ageStratified` thresholds.
- **Execution:** The central assessment engine (`getEffectiveNormalRange`) will resolve boundaries in real-time utilizing the user profile's `gender` and `age`, allowing precision evaluations of sex-dependent markers (e.g., Uric Acid, Creatinine, Ferritin).

### 14.2 Multi-Line Token & OCR Ingestion Sanitizer
**Goal:** Eliminate parser artifacts globally.
- **Sanitization Filter:** A universal pre-processing gate on all ingested lab strings.
- **Unit Prioritization:** Stripping legacy unit lines when SI lines are present in the same cell stack.
- **Noise Removal:** Programmatic removal of tokens like `Unknown`, `—`, `(count)`, and `(score)` before database insertion.

### 14.3 Universal Range Archetype & Zero-Width Bound Handler
**Goal:** Stop division-by-zero errors and scale anomalies on binary/qualitative readouts.
- **Archetype Classes:** Define discrete rendering logic for four range types:
  1. Continuous Interval (`[min, max]`)
  2. Single-Sided Threshold (`< X` or `> Y`)
  3. Zero-Baseline / Absent (where optimal is strict 0)
  4. Qualitative / Discrete State (e.g., `Negative`)

### 14.4 Multi-Tier Interval Ranges & Assessment Scale Standardization
**Goal:** Extend single binary intervals to clinical multi-tier classification.
- **Tiered Schema:** Introduce `RangeTier[]` to `BiomarkerDefinition` (e.g. tracking BMI stages: Normal, Overweight, Obesity I, II, III).
- **Assessment Metadata Protocol:** Standardize clinical questionnaires (AUDIT, PHQ, HDSS) with explicit instrument properties: `scaleMin`, `scaleMax`, and `interpretationTiers` ensuring consistent UI scale rendering independent of the specific test limits.
