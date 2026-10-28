---
id: biomarker-flexible-log
status: draft
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/healthRecord.ts
  - src/utils/healthRecord.test.ts
  - tests/fixtures/health-record/grid.csv
  - tests/fixtures/health-record/prose.txt
  - tests/fixtures/health-record/nested-panel.xml
  - tests/fixtures/health-record/pages-10.json
  - tests/fixtures/health-record/symptom-diary.json
  - tests/fixtures/health-record/README.md
frozen_files:
  - src/App.tsx
  - src/types.ts
  - src/components/LogChat.tsx
  - src/components/MedicalHistoryTab.tsx
  - src/components/HomeTab.tsx
  - src/components/InsightsTab.tsx
  - src/components/BiomarkerDictionaryModal.tsx
  - src/jobs/JobStore.ts
  - src/server/biomarkers/pipeline.ts
  - src/server/biomarkers/instruction.ts
  - src/server/receptionist/instruction.ts
  - src/utils/biomarkers.ts
  - server.ts
  - serverJobs.ts
  - server_meal_gate.ts
  - server_routes_mcp.ts
  - server_routes_sync.ts
  - docs/agent/domains/biomarkers.md
  - docs/agent/standing.json
  - AGENTS.md
  - scripts/assert-standing.mjs
  - scripts/assert-biomarker-lifecycle-m31.mjs
  - scripts/journey-guard.mjs
gate:
  - npx vitest run src/utils/healthRecord.test.ts
  - npx tsc --noEmit
  - node scripts/journey-guard.mjs biomarker-flexible-log
---

# Packet: Flexible health record (milestone 0)

Agent fills this. Human replies: go | stop | one comment.

**This go is milestone 0 only.** Milestones 1–6 are specified here so the shape does not drift, and each one is a new packet after the previous gate is green. A go does not delete the dictionary, the clinical pipeline, or any agent instruction.

## Journey

Biomarkers, symptom diaries, and simple spoken notes become one user-owned record. The website and Gemini MCP both read and write that record. A data-entry agent adds, edits, removes, and consolidates. The health coach also plans tests. Literature stays its own on-demand agent. The receptionist can call any of them, and they can call each other. Nothing runs as a required pipeline.

Milestone 0 proves a format-agnostic record and checker. A lab file may be a document, a sheet, XML, or any other layout. A photo entry may be one image or a batch of 10. A symptom diary keeps accepting logs as columns are added or removed. The same milestone proposes cleanup for dirty values, absurd numbers, mixed units, and the same analyte under two names. Nothing in that list rewrites a stored number or merges two markers until a person confirms. No model call and no UI change in this go. Later milestones may remove the dictionary and the clinical pipeline only after these cases pass.

## Findings (do not redo)

- Base of this worktree is `origin/main` at `c033348d`. Do not edit MCP files from this packet.
- MCP on `origin/main` already serves `manage_home` (`get_profile`, `get_allowance_progress`, `get_dashboard`, `set_targets`), `manage_meals` (`list`, `get_detail`), and `manage_biomarkers` (`list`, `get_trends`). Biomarker reads assume one D1 row per date whose `biomarkers` field is a key-to-value map. `get_trends` skips non-numeric values and guesses the unit with a regex.
- Branch `agent/mcp-gemini` at `144f9153` (2026-10-28, clean, matching its remote) adds `update_profile`, timezone on the read tools, and a server upsert guard `WHERE excluded.updated_at >= coalesce(stored, '')` on food and biomarker rows in `server_db_d1.ts`. `useAppSync.ts` on that branch still has no `visibilitychange` pull. That branch is not on main. Main still assigns `updated_at = excluded.updated_at` with no newer-than check.
- There is no MCP action that logs, edits, or deletes a biomarker. `parseLabImages` sends every image in one model call. A 10-photo entry must not use that call.
- “Tracked biomarkers” and “Total log entries” are the two counters at the bottom of `MedicalHistoryTab.tsx`, not a Google Sheet. Tracked = `allDefinitions.length`: markers that have a non-empty value in the current map or in history, excluding `weight`, `height`, `age`, alias keys hidden by combine, and keys in `notUsedInMedicalHistory`. Total log entries = the sum of `Object.keys(historyRow.biomarkers).length` across active history rows. A new store is acceptable only when a fixture profile reproduces both numbers.
- Today the same facts live in several places: D1 `biomarker_logs` (one JSON map per date), `profiles.data.customBiomarkers`, `pendingObservations`, `biomarkerDefinitions`, not-used maps, tombstone maps, and agent-analysis blobs. `d1UpsertBiomarkers` replaces the whole date row.
- The dictionary is still the live product. `MedicalHistoryTab` opens `BiomarkerDictionaryModal`. Filters are risk, medical condition (`potentialMedicalConditions`), and medical practice (`standardMedicalGrouping`). Risk is already the default `viewType`.
- The clinical multi-agent path is still live: Insights steps `agent1`–`agent5`, `data_review`, `health_baseline`, `agent7`, plus `src/server/biomarkers/pipeline.ts` (`runBiomarkerPipeline`). That pipeline classifies rows as catalog hit vs pending miss, then calls a fill agent. `docs/agent/domains/biomarkers.md` still says the dictionary owns keys and forbids deleting instruction packs. Those laws stay frozen until a later packet whose only job is the law change. Do not invent a third pipeline beside them in milestone 0.
- `getMappedBiomarkerKey` already collapses distinct symptoms onto one score (`hemorrhoids` and `blood_in_stool` → `hemorrhoidal_symptom_score`). `getDuplicateAliasGroups` in `src/utils/biomarkerAuditEngine.ts` builds the same kind of group from the dictionary, stems, and synonyms. Milestone 0 does not call either. A second name is a confirm card.
- Unit changes already have one table, `convertViaTable` / `ANALYTE_CONVERSIONS`. Unknown pairs refuse. `computeBiomarkerTelemetryMultiplier` only returns a factor from that table. The domain law is relabel or convert, never both, and history is not rewritten on load. Cleanup cards follow that law. The raw value stays.
- `BiomarkerLog` is one number-map per calendar day. A symptom diary with two events on the same day, or 17 columns on one event, does not fit. Labs keep “same calendar day, same marker, do not average.” Symptom events keep their own timestamp.
- Standing `biomarker_lifestyle_exclusion`: `steps`, `weight`, `sleep_duration`, and the other device keys must not be judged with laboratory ratio checks. Sleep and symptom scores stay outside that check.
- `isValEmpty` must keep treating `0` as a real value (anal pain 0, abdominal pain 0).
- Food must stay read-only on this record. `finalizeDishLedger` stays the only calorie writer. The future condition strip is context for the coach and the meal agent.
- Job telemetry strings in `serverJobs.ts` (`extract`, `classified`, `running agent`) are a standing row. Later pipeline removal must not delete those hooks while other jobs still emit them.
- Burned hypothesis `specs/rejected/b0-apply-smoke.json`: do not prove a front-desk medical job by server-polling `job_frontdesk_*`. Those jobs are client-only. Do not assert `observationMeta` on the extract path.
- G-B1 convert locks stay `1.293` / `1.411` / `3.362` / `79.56` / `13.68`. Milestone 0 does not convert units.
- The private Drive file `Evergreen Life Record Download - Results.xml` (id `1XwdWhqsL9NaS_YorJkAmxHp3FtZFOmrV`, read 2026-10-28) is one example of a nested lab export, not the product schema. It is personal data. Do not commit it. A nested panel inside it is the reason `nested-panel.xml` exists: a parser that keeps only the first name in a wrapper drops the children. The checker must also pass a CSV grid, a prose note, and a 10-page photo batch whose columns and labels are different from that file.
- The symptom sheet “Daily Health Symptom Tracker” (id `1aB-Jm0wyNSdOnKAAOxdrqFUEllI-HYoVWh3fyZlhz4Q`, tab `Feuille 1`) is one event with 17 columns, plus a note that mentions poor sleep. That sheet is one diary shape. A later log may arrive with fewer columns, more columns, or a different header order. Cells are stored by column id, never by position.
- 2026-10-28 correction: milestone 0 must not lock the checker to XML tag counts. Exact tag counts are valid only for a format whose parser sees every cell. A doc or a photo has no tag count. For those, pass means two independent reads returned the same multiset of rows and every row cites a page or a cell. A model’s own “100%” is not a pass.
- The symptom sheet “Daily Health Symptom Tracker” (id `1aB-Jm0wyNSdOnKAAOxdrqFUEllI-HYoVWh3fyZlhz4Q`, tab `Feuille 1`, gid 0) has one header row and one event row. Columns: Date & Time (with Timezone), Movement # of Day, Stool Volume, Stool Form / Bristol Scale, Stool Color, Bleeding Amount, Bleeding Color, Bleeding Timing & Clots, Anal Pain (0-10), Abdominal Pain (0-10), Straining Level, Local Sensations, Systemic Symptoms, Hydration, Diet & Fiber, Medications & Supplements, Clinical Notes / Action Items. The note also mentions poor sleep. That is a second symptom series, not a 17th hidden column of the bowel event, unless the user adds that column.
- `gws` is not on this Mac. The reads used `scripts/lib/google-store.mjs` after `loadHostEnv`.
- Voice already has an active packet, `VOICE-LIVE-1` (`gemini-3.8-live` on `/api/gemini/live-ws`). Onboarding voice waits for that packet. Do not add a second speech stack.
- Medical model default in `server_routes_medical_gemini.ts` and `runBiomarkerPipeline` is `gemini-3.5-flash-lite` (AGENTS.md L11). Muse Spark is a coding agent, not an in-app extractor. Patient files do not go through the coding-agent path.
- Sync traps still open on main, owned by MCP step 3: `mergeProfiles` is an unconditional spread, food union lets local content win, biomarker upsert ignores `updated_at`, open tabs pull on login and manual Cloud Sync. This packet does not fix sync. It must not add a write path that bypasses tombstones later.

### Standing triplets that stay in force

- (Condition: a key is `steps`, `sleep_duration`, `weight`, or another `isExcludedDeviceMetric` key, Action: skip laboratory ratio checks, Pitfall: a night of poor sleep is flagged as a 10× unit error.)
- (Condition: two lab observations share a marker and a calendar day, Action: upsert by source identity and do not average, Pitfall: the second panel replaces or averages the first.)
- (Condition: two symptom events share a calendar day, Action: keep both, with their own time, Pitfall: the date-map merge collapses two movements into one cell.)
- (Condition: the value is `0`, Action: store it, Pitfall: `isValEmpty` drops “abdominal pain 0”.)
- (Condition: a source file is still retained and the checker has not passed, Action: keep the rows staged and out of the tracked and total-log counts, Pitfall: the model’s own “100%” publishes a short count.)
- (Condition: the meal agent or the coach reads the record, Action: pass confirmed rows as read-only context, Pitfall: the food path writes biomarker rows or a second calorie total.)
- (Condition: a later delete removes a marker or one cell, Action: write the existing tombstone timestamp and let the newer tombstone win, Pitfall: the website re-uploads the row from localStorage.)
- (Condition: MCP step 3 has not landed, Action: do not add MCP biomarker writes in this packet, Pitfall: a second writer lands beside the unfixed upsert.)

## Plan

### Milestone 0 — this go. One record, any layout, ongoing diary. No model. No UI.

1. Add `src/utils/healthRecord.ts` with plain types and pure functions. No imports from `biomarkers.ts`, the dictionary, or the pipeline. Done when: the module compiles alone.
   - `StagedRow`: printed label, numeric value or text value (either may be null), unit or null, when or null, cite `{ fileId, page?, cell?, quote }`. A missing field stays null. Nothing invents a required analyte.
   - `Marker`, `Observation`, `SourceBatch`: a batch has one id and one or more parts (a file, a sheet tab, or a page). Verify status and user confirm are separate.
   - `Diary`: id, `columns: { id, label, retiredAt? }[]`, `events: SymptomEvent[]`. A cell is `{ columnId, value }`. `0` is kept. Position is not stored.
   - Counts: `trackedMarkerCount` and `totalLogEntryCount`, same exclusions as `MedicalHistoryTab`. A symptom event counts as one log entry however many cells it has. Unconfirmed or failed parts do not count.
2. Add three ingest doors that all emit `StagedRow[]`. Done when: each door has a fixture and none of them shares the other’s pass rule.
   - **Grid.** `grid.csv` is a sheet whose first row is titles and whose columns are not a lab panel (for example time, a score, a free-text note, a blank cell). `verifyGrid` passes only when every non-empty data cell is a header, a staged row whose cite text contains the value, or an explicit ignore. A staged number that is not in its cell fails. Dropping one data cell fails.
   - **Prose.** `prose.txt` is a short note with two results and one sentence that is not a result (“slept badly”). The checker accepts rows whose quotes are substrings of the note. A row whose number is not in the note fails. The sleep sentence can be a symptom row. It is not forced into a numeric lab.
   - **Nested panel.** `nested-panel.xml` is a small synthetic wrapper with a header that has a comment and no value, plus two child results. A walk that keeps every name passes. A first-name-only walk fails `verify` because a child value is missing. This fixture is one layout, not the schema.
   - Pitfall: do not mark a field required in a way that makes a model invent it. Pitfall: do not rename printed labels. Pitfall: do not call `getMappedBiomarkerKey`.
3. Add `verifyAgreement(readA, readB)` for pages. Done when: the function compares the multiset of `(printed, value, unit, when, page)` and ignores any model score. `pages-10.json` has 10 pages. Pages 1–6 and 8–10 agree. Page 7 disagrees by one dropped value. Agreed pages can be confirmed on their own. Page 7 stays staged. The batch id is the same for all 10. In-flight cap of 4 is a runner detail inside the test as a queue length, not a product limit of 4 photos.
4. Diary functions, still pure:
   - `appendEvent` adds a log. Earlier events stay. Identity is `(diaryId, observedAt, movementNumber | clientKey)`. The same key twice updates that event and does not create a second one.
   - `addColumn` issues a new column id. Old events keep their old cells. New events may use the new id.
   - `retireColumn` sets `retiredAt`. A later event that omits that id does not shift the other cells. The old event still has the retired cell.
   - An event that arrives with an unknown header stores the known cells and returns the unknown header as a proposed column. It does not publish the new column until `addColumn` is called.
   - Two events on one calendar day both remain. A later day appends a third.
5. `deleteSourceAllowed` is true only when every part of the batch is `passed` and the user confirm is `confirmed`. A batch with page 7 still failed cannot be deleted.
5b. Add `proposeCleanup` in the same module. It returns proposal cards. It does not write. Done when: the cases in the test plan under “cleanup” pass.
   - **Exact duplicate.** Same normalized label, same unit, same instant, same value. The card says `auto`. Applying it keeps one observation and a second cite. The number does not change. A second copy with a different value is not a duplicate. It is a conflict. Do not average.
   - **Two names.** Compare the new label to markers this user already has. A proposal fires when the normalized labels match, or a source code matches a code already stored on a marker, or the agent later marks them as the same analyte. Until the card is `confirmed`, the row stays staged and does not increase the tracked count. Rejecting the card creates a separate marker. Accepting it stores the extra label as an alias on the survivor and tombstones the duplicate marker id.
   - **Mixed units on one marker.** A series may hold `mg/dL` and `mmol/L`. Display uses the profile unit preference. The raw value and raw unit stay on the row. A convert card is offered only when `convertViaTable` in `src/utils/biomarkerLifecycle.ts` has a factor for that analyte. Locked factors stay the G-B1 set: HDL 50 → 1.293, triglycerides 125 → 1.411, LDL 130 → 3.362, creatinine 0.9 → 79.56, bilirubin 0.8 → 13.68. HbA1c keeps the IFCC formula already in that function (`mmol/mol = 10.93×% − 23.5`). An unknown pair returns `ok: false` and the card says “no conversion”, with actions relabel or leave. Relabel changes the unit text and does not change the number. Convert changes the number by the named factor and keeps the raw. A card cannot contain both.
   - **Absurd value.** If the source printed a range and the number sits far outside it, or `isBiomarkerValueImprobable` would flag it, the card offers relabel, convert via the table, or leave. `computeBiomarkerTelemetryMultiplier` may explain a table factor. It may not invent a generic ×10 or ÷100. `steps`, `sleep_duration`, `weight`, and the other `isExcludedDeviceMetric` keys do not get this card.
   - **Dirty text.** `5.2 H`, `<0.1`, `Positive`, and `see comment` stay text. They are not coerced to 0 or 0.1. A text value landing in an otherwise numeric series is its own card. `0` remains a real numeric value.
   - **Same calendar day, two standards.** If converting one onto the other’s unit matches within the table’s rounding, one observation with two cites is proposed. If it does not match, both stay and the card is a conflict.
   - Pitfall: `getDuplicateAliasGroups` and `getMappedBiomarkerKey` group by the old dictionary, including distinct symptoms onto one score. `proposeCleanup` must not call them. A synonym hit can be mentioned on the card. It cannot merge by itself.
   - Pitfall: applying a card rewrites history only through this function, after `confirmed`. The raw number remains on the observation.
6. Profile-count fixture: three lab keys across two dates, one empty custom, one not-used key, and `weight`. Done when: tracked count is 3 and total log entries equals the sum of keys on the history rows.
7. README: Drive files stay on Drive. Fixtures are synthetic. Done when: a search of `tests/fixtures/health-record` finds no personal name and no date of birth.
8. Do not wire this module into the app, D1, MCP, or an agent. Done when: `git diff --name-only` against the worktree base is only the allowed list.

### Milestone 1 — next packet, after milestone 0 is green. Still no live model.

The history screen uses the same diary and observation functions. Risk tags only on new rows. Same-day labs do not average. `sleep_duration` and symptom scores skip laboratory ratio checks.

Pass before milestone 2: a diary that started at 17 columns still shows the first event after a column is removed and after a column is added; a log that arrives a week later with the columns in a different order lands on the same ids; a re-import of the same movement does not double the total-log count; a brand-new header is proposed and the rest of that log is still saved.

### Milestone 2 — data-entry agent. Any file, and a batch of 10 photos. No live Gemini in the unit gate.

One agent id, `data_entry`, is the only writer. It sees the user’s existing markers. After a batch verifies, it runs `proposeCleanup` and shows the cards in the user’s language. Exact duplicates apply as `auto` and stay reversible. Every card that merges two names, converts a number, or relabels a unit waits for a confirm. The user can uncheck one row inside a batch. The agent does not set `confirmed`. A near name stays staged until that confirm. Rejecting it creates a new marker.

Store original bytes on R2, one object per part, one batch id. Grid and nested-markup doors run with no model. A PDF or doc with a recovered table uses the grid door. Prose and photos use two `gemini-3.5-flash-lite` reads per page. At most four pages run at once. A batch of 10 queues. Publish a page only when `verifyAgreement` passes. A heavier Gemini model sees only disagreed pages. Muse Spark is not an extractor. The model cannot set `verify: passed`.

`parseLabImages` is not the photo path. It puts every image in one call.

Receptionist handoff for a file, a 10-photo batch, or “I slept badly” targets `data_entry`.

The same agent can be asked to clean the record that is already stored. That run uses `proposeCleanup` on the whole history, not a second pipeline.

Pass before milestone 3: the grid, the prose note, and the nested panel pass with zero model calls; page 7 of the 10-page fixture stays uncounted while the other nine can be confirmed; a second name does not become a second tracked marker while its card is open; HDL in mg/dL converts only after confirm and the raw 50 is still stored; an unknown unit pair does not change the number; sleep is not flagged as a lab error; the source batch cannot be deleted while any page is failed; the receptionist contract routes the file and the sleep sentence to `data_entry`.

### Ordering against MCP

Do this in parallel with the MCP branch, and do not add biomarker write tools first.

| Lane | When | Why |
|---|---|---|
| MCP step 3 (`agent/mcp-gemini`, `144f9153`) | Finish and land on its own branch. Focus pull is still missing. | Server upserts on that branch already refuse an older `updated_at`. Main does not. Writes from anywhere are unsafe on main until this lands. This packet does not touch those files. |
| This packet, milestones 0–1 | In parallel, starting now. | New files only. No dependency on MCP. |
| Milestone 2 | After 0–1. Still no MCP edits. | The photo batch and the any-format doors have to exist before a tool exposes them. |
| MCP read adapter | After milestone 2, small packet on the MCP branch. | `list` and `get_trends` keep working. They read a compatibility view: numeric labs stay a map so current Gemini sessions still parse; symptom events are a separate list so `get_trends` stops dropping text diaries. |
| MCP write actions `log`, `edit`, `delete`, `confirm_source`, `confirm_cleanup` | After the read adapter and after step 3 is on main. | A write tool built on today’s date map would teach Gemini the shape this plan is replacing. `confirm_cleanup` is the only way a Gemini session applies a merge or a unit convert. |

Building the flexible record after all remaining MCP steps would freeze write tools on the date map. Building it before step 3 by editing `server_routes_mcp.ts` would collide with `144f9153`. Parallel, with writes last, is the dependency order.

### Milestone 3 — remove the dictionary and the clinical pipeline. Own packet. Domain law update in that packet.

After milestones 0–2 are green, and only then: remove the dictionary UI, `runBiomarkerPipeline`’s catalog hit/miss split, and the Insights required chain (`agent1`, `agent2`, `agent3`, `agent4`, `agent5`, `data_review`). Keep literature (`agent7`) as its own on-demand action. Fold test planning (`agent4`) into the health coach (`health_baseline`) as one agent the user sees as Health coach. Update `docs/agent/domains/biomarkers.md` in that same change (AGENTS.md L9). Alias old ids onto `data_entry`, `health_coach`, and `literature` so stored analyses still open. Do not delete `serverJobs.ts` telemetry hooks that other jobs use.

The history screen edits the same functions the agent uses. Risk is the only category filter. Condition and practice toggles go away. Tracked and total-log counters stay visible and keep the milestone 0 definitions.

Pass before milestone 4: no control opens `BiomarkerDictionaryModal`; Insights does not offer the chain; a cell edit through the history function changes the same observation the agent function changes; en/id/fr/zh strings for new chrome exist; `assert-biomarker-lifecycle-m31.mjs` is either still green or its expected strings are updated in that packet on purpose.

### Milestone 4 — home strip and food context. Own packet.

Under the Home “Top targets” block, show the latest confirmed labs and confirmed symptom flags (hemorrhoid diary, poor sleep). Staged pages and failed parts stay off that strip and off the meal prompt. The coach reads the strip when it recommends allowances and tests. The meal agent receives the strip as read-only context. It does not write the record and it does not write calories.

Pass before milestone 5: a confirmed hemorrhoid event and a confirmed sleep note render under Top targets; an unconfirmed page from a 10-photo batch does not; the meal debug payload contains those two facts and no staged lab number.

### Milestone 5 — empty-profile onboarding. Own packet. Voice waits on VOICE-LIVE-1.

Receptionist state `onboarding_gather_info` on an empty profile offers three doors: paste a number, attach a file or up to 10 photos, or say a symptom. Each door commits through `data_entry`. The dictionary and the clinical chain are not on this path. Voice uses the live receptionist socket from `VOICE-LIVE-1`. If that packet is not landed, milestone 5 stops at typed onboarding and says so.

Pass before milestone 6: a blank profile can log one number and one sleep sentence and see both in history; the dictionary route is absent; a voice proof is a screenshot of the live socket only after `VOICE-LIVE-1` is on the build under test.

### Milestone 6 — MCP writes. Own packet. See Ordering.

`manage_biomarkers` gains `log`, `edit`, `delete`, `confirm_source`, and `confirm_cleanup`. No dictionary action. A merge or a unit convert from Gemini applies only through `confirm_cleanup`. A `log` call may carry text, a grid, or up to 10 image parts. The schema resource lists the user’s markers, not `biomarkerDefinitions`. Writes call the milestone 0 functions. They ship only after `agent/mcp-gemini`’s upsert guard is on main and the focus pull exists, so an open website tab cannot resurrect a deleted event.

Pass: a 10-photo batch and a diary append succeed through the MCP tool and through the website function; removing a column does not shift old logs; a delete stays deleted after a website sync.

## Test plan

Milestone 0, this packet:

```text
npx vitest run src/utils/healthRecord.test.ts
npx tsc --noEmit
node scripts/journey-guard.mjs biomarker-flexible-log
```

`healthRecord.test.ts` must contain these cases by name. A case that is skipped does not count.

- `grid drops a cell and fails`
- `grid rejects a number that is not in the cell`
- `prose rejects an invented number`
- `prose keeps a non-numeric symptom sentence`
- `nested panel keeps every child`
- `panel without a value is not a number`
- `ten pages share one batch`
- `disagreed page stays uncounted`
- `agreed pages can confirm while one page failed`
- `model score cannot mark verify passed`
- `source delete needs every part passed and user confirm`
- `append keeps earlier diary logs`
- `same movement key does not double`
- `added column does not shift old cells`
- `retired column stays on old logs and is absent from new logs`
- `unknown header is proposed and known cells still save`
- `fewer columns do not shift the rest`
- `two symptom events on one day both remain`
- `zero pain is stored`
- `tracked count matches the history sheet rules`
- `total log entries count events not columns`
- `fixtures have no personal name`
- `exact duplicate keeps one value and two cites`
- `same instant with a different value is a conflict`
- `second name stays untracked until confirm`
- `rejected name becomes its own marker`
- `hdl mg/dl converts only after confirm and keeps raw 50`
- `unknown unit pair does not change the number`
- `relabel does not change the number`
- `convert and relabel are not on the same card`
- `printed range outlier proposes and does not write`
- `sleep duration is not an absurd lab`
- `inequality and positive stay text`
- `zero stays a number`
- `same day units that convert to one value propose one observation`
- `same day units that do not match stay two observations`

Do not run `npm test`. Do not call Gemini. Do not commit the Drive file or the symptom sheet.

Later milestones add their own named tests in their own packets. Live Gemini, when a milestone finally needs it, is a separate proof with a screenshot, and the author of the extractor does not score that live run (`builder_ne_tier3_ab_scorer`).

## Audit plan

1. Scope vs ROADMAP. This does not reopen R-14.1, R-15, R-16, TUI, V-17b, D-10, or F-13.2. It does not take over MCP-GEMINI steps 3–7. It does not mark Track B rows done.
2. Frozen examples for milestone 0: the grid, the prose note, the nested panel, the 10-page batch, and the diary JSON. Personal Drive files stay out of git.
3. Residual, named: the live app still uses the dictionary and the clinical pipeline until milestone 3. Main can still overwrite a newer biomarker row until `144f9153` lands. The focus pull is still absent. Voice onboarding does not exist until `VOICE-LIVE-1` and milestone 5. For a photo, “passed” means two reads agreed and the user confirmed. It does not mean a human compared every pixel. A document that states no row count has no exact completeness number beyond that agreement.

## Blast radius

Allowed / Frozen are the YAML lists above.

Out of scope for this go: UI, D1 migrations, agent prompts, receptionist copy, dictionary deletion, Insights, Home, food prompts, MCP, sync merge, `src/types.ts`, `src/utils/biomarkers.ts`.

## Stop and come back

Two repairs fail on milestone 0. A frozen file appears in the diff. The real Evergreen XML is committed. A test passes by shrinking the expected count. Live Gemini is called. The builder starts milestone 1 in this same packet.
