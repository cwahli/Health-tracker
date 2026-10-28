---
id: biomarker-flexible-log
status: draft
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/healthRecord.ts
  - src/utils/healthRecord.test.ts
  - tests/fixtures/health-record/evergreen-anon.xml
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
  - node scripts/journey-guard.mjs biomarker-flexible-log
---

# Packet: Flexible health record (milestone 0)

Agent fills this. Human replies: go | stop | one comment.

**This go is milestone 0 only.** Milestones 1–6 are specified here so the shape does not drift, and each one is a new packet after the previous gate is green. A go does not delete the dictionary, the clinical pipeline, or any agent instruction.

## Journey

Biomarkers, symptom diaries, and simple spoken notes become one user-owned record. The website and Gemini MCP both read and write that record. A data-entry agent adds, edits, removes, and consolidates. The health coach also plans tests. Literature stays its own on-demand agent. The receptionist can call any of them, and they can call each other. Nothing runs as a required pipeline.

Milestone 0 proves the record and the checker on the two real shapes the user supplied, with no model and no UI change. Later milestones may remove the dictionary and the clinical pipeline only after these cases pass.

## Findings (do not redo)

- Base is `origin/main` at the worktree create. The shared checkout `agent/mcp-gemini` is dirty and is not this packet’s tree. MCP steps 1–2 are already on main. `manage_biomarkers` is still a later MCP step. Do not edit MCP files from this packet.
- “Tracked biomarkers” and “Total log entries” are the two counters at the bottom of `MedicalHistoryTab.tsx`, not a Google Sheet. Tracked = `allDefinitions.length`: markers that have a non-empty value in the current map or in history, excluding `weight`, `height`, `age`, alias keys hidden by combine, and keys in `notUsedInMedicalHistory`. Total log entries = the sum of `Object.keys(historyRow.biomarkers).length` across active history rows. A new store is acceptable only when a fixture profile reproduces both numbers.
- Today the same facts live in several places: D1 `biomarker_logs` (one JSON map per date), `profiles.data.customBiomarkers`, `pendingObservations`, `biomarkerDefinitions`, not-used maps, tombstone maps, and agent-analysis blobs. `d1UpsertBiomarkers` replaces the whole date row.
- The dictionary is still the live product. `MedicalHistoryTab` opens `BiomarkerDictionaryModal`. Filters are risk, medical condition (`potentialMedicalConditions`), and medical practice (`standardMedicalGrouping`). Risk is already the default `viewType`.
- The clinical multi-agent path is still live: Insights steps `agent1`–`agent5`, `data_review`, `health_baseline`, `agent7`, plus `src/server/biomarkers/pipeline.ts` (`runBiomarkerPipeline`). That pipeline classifies rows as catalog hit vs pending miss, then calls a fill agent. `docs/agent/domains/biomarkers.md` still says the dictionary owns keys and forbids deleting instruction packs. Those laws stay frozen until a later packet whose only job is the law change. Do not invent a third pipeline beside them in milestone 0.
- `getMappedBiomarkerKey` already collapses distinct symptoms onto one score (`hemorrhoids` and `blood_in_stool` → `hemorrhoidal_symptom_score`). That is the opposite of adjustable symptom columns. Milestone 0 does not call it.
- `BiomarkerLog` is one number-map per calendar day. A symptom diary with two events on the same day, or 17 columns on one event, does not fit. Labs keep “same calendar day, same marker, do not average.” Symptom events keep their own timestamp.
- Standing `biomarker_lifestyle_exclusion`: `steps`, `weight`, `sleep_duration`, and the other device keys must not be judged with laboratory ratio checks. Sleep and symptom scores stay outside that check.
- `isValEmpty` must keep treating `0` as a real value (anal pain 0, abdominal pain 0).
- Food must stay read-only on this record. `finalizeDishLedger` stays the only calorie writer. The future condition strip is context for the coach and the meal agent.
- Job telemetry strings in `serverJobs.ts` (`extract`, `classified`, `running agent`) are a standing row. Later pipeline removal must not delete those hooks while other jobs still emit them.
- Burned hypothesis `specs/rejected/b0-apply-smoke.json`: do not prove a front-desk medical job by server-polling `job_frontdesk_*`. Those jobs are client-only. Do not assert `observationMeta` on the extract path.
- G-B1 convert locks stay `1.293` / `1.411` / `3.362` / `79.56` / `13.68`. Milestone 0 does not convert units.
- The private Drive file `Evergreen Life Record Download - Results.xml` (id `1XwdWhqsL9NaS_YorJkAmxHp3FtZFOmrV`, 50,659 bytes, read 2026-10-28) is the complex fixture. It is personal data. Do not commit it, copy it into chat, or put the name or date of birth in the repo. Commit an anonymized structural clone only.
- Measured shape of that file: 77 `<result>` elements, nested so they contain 183 `<name>`, 182 `<date>`, 153 `<value>` (152 numeric, 1 non-numeric), 150 `<units>`, 43 `<comment>`, 85 distinct printed names, 25 distinct unit strings, 15 calendar dates from 2020-11-04 through 2026-10-19. Panel headers (full blood count, serum lipids, renal profile) sit above child results. Some printed names are already truncated by the export. Codes are present. Questionnaire scores use units such as `/4` and `/12`. A regex that keeps only the first name inside each `<result>` drops the children. A model schema that requires a numeric `value` drops comments, panel headers, and the one text value.
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

### Milestone 0 — this go. Record, checker, counts. No model. No UI.

1. Add `src/utils/healthRecord.ts` with plain types and pure functions. No imports from `biomarkers.ts`, the dictionary, or the pipeline. Done when: the module compiles alone.
   - `Marker`: id, printed name, kind (`lab` | `biometric` | `score` | `symptom` | `panel`), unit, risk tags, symptom flag, optional column definitions.
   - `Observation`: id, marker id, observed date `YYYY-MM-DD`, optional time and timezone, numeric value or text value, unit, printed min, printed max, comment, source id, source path, kind.
   - `SymptomEvent`: id, marker id, observed instant with timezone, ordered cells `{ columnId, value }`. A cell may be text. `0` is kept.
   - `SourceFile`: id, sha256, mime, byte length, verify status (`unchecked` | `failed` | `passed`), user confirm (`pending` | `confirmed`).
   - Counts: `trackedMarkerCount` and `totalLogEntryCount`. A lab or score observation counts as one log entry. A symptom event counts as one log entry no matter how many columns it has. Panel nodes with no value do not count as log entries and do not count as tracked markers. `weight`, `height`, and `age` do not count as tracked. Unconfirmed or failed-verify rows do not count.
2. Parse the anonymized Evergreen-shaped XML in that module with a real XML walk, not a first-tag regex. Done when: every `<name>` becomes a node, nested children stay attached to their panel, and a panel with a comment and no value is `kind: 'panel'`.
   - Pitfall: 77 wrappers and 183 names. A flat split on `</result>` that reads the first `<name>` silently drops the blood-count children.
   - Pitfall: do not rename truncated printed names and do not map them through `getMappedBiomarkerKey`.
   - Pitfall: do not invent a number for a comment-only node.
3. Add `verifySource(sourceText, stagedRows)` that returns pass or a list of misses. Done when: the function never reads a model score.
   - Every numeric `<value>` has one staged observation with the same number, unit, and calendar date.
   - Every staged numeric observation’s number occurs in the source on that date.
   - Name count, date count, and value count match the source.
   - A short staged set fails. A set with an extra invented number fails.
   - `user confirm` is a separate flag. `deleteSourceAllowed` is true only when verify is `passed` and confirm is `confirmed`.
4. Add the symptom-diary fixture as JSON with the 17 column ids and two events on the same calendar day, plus a separate one-cell symptom `{ name: 'sleep', text: 'poor sleep' }`. Done when: both bowel events survive, the sleep row is its own marker with `symptomFlag: true`, and total log entries is 3.
5. Add a small profile fixture in the test that mirrors today’s counters: three lab keys across two dates, one empty custom, one not-used key, and `weight`. Done when: `trackedMarkerCount` is 3 and `totalLogEntryCount` equals the sum of keys on the history rows, using the same exclusions as `MedicalHistoryTab` (`weight` / `height` / `age`, not-used, empty).
6. Write `tests/fixtures/health-record/README.md` stating the Drive file stays on Drive and the committed XML is synthetic. Done when: a search of the fixture finds no personal name and no date of birth.
7. Do not wire this module into the app, D1, MCP, or an agent. Done when: `git diff --name-only` against the worktree base is only the allowed list.

### Milestone 1 — next packet, after milestone 0 is green. Still no live model.

Symptom columns on the same history surface as labs. Adjustable columns append. They do not shift old cells. Risk tags only: stop writing `standardMedicalGrouping` and `potentialMedicalConditions` on new rows. Same-day labs still do not average. Same-day symptom events still both remain. `sleep_duration` and symptom scores still skip `isBiomarkerValueImprobable` ratio checks.

Pass before milestone 2: the 17-column event round-trips; a new column leaves old cells on their ids; a second movement the same day is a second entry; “poor sleep” does not become a lab and does not raise a telemetry flag; tracked and total-log counts follow the milestone 0 rules.

### Milestone 2 — data-entry agent on fixtures. No live Gemini in the unit gate.

One agent id, `data_entry`. It is the only writer of markers and observations. It receives the user’s existing marker list and returns `attach` or `create`. Exact normalized printed name attaches. A near name is staged for the user. A new name creates a marker. No dictionary lookup.

Complex file path: store the bytes (R2, content-addressed, same idea as meal photos), run the milestone 0 lexer for XML and for tables `lexTable` already parses, run `verifySource`, and publish into the counted record only after verify passes and the user confirms. Re-running the same sha256 upserts by `(source id, source path)`.

Screenshot and prose path: one `gemini-3.5-flash-lite` pass per page or per date cluster, at most four in flight. A second flash-lite pass lists only the numbers and dates it can see. Publish only where the two lists match and `verifySource` passes against that agreed list. Send a heavier Gemini model only the disagreed pages. Do not send the file to Muse Spark. The model cannot set `verify: passed`.

Receptionist handoff for “add this result” or “I slept badly” targets `data_entry` only. Simple one-value utterances may still be captured by the receptionist and then committed through the same `data_entry` functions.

Pass before milestone 3: XML fixture verifies with zero model calls; a fixture where the model drops one nested child stays staged and uncounted; a near-name HDL does not auto-merge; an exact printed name does; delete-source stays false until both bits are set; receptionist contract test routes the lab sentence and the sleep sentence to `data_entry`.

### Milestone 3 — remove the dictionary and the clinical pipeline. Own packet. Domain law update in that packet.

After milestones 0–2 are green, and only then: remove the dictionary UI, `runBiomarkerPipeline`’s catalog hit/miss split, and the Insights required chain (`agent1`, `agent2`, `agent3`, `agent4`, `agent5`, `data_review`). Keep literature (`agent7`) as its own on-demand action. Fold test planning (`agent4`) into the health coach (`health_baseline`) as one agent the user sees as Health coach. Update `docs/agent/domains/biomarkers.md` in that same change (AGENTS.md L9). Alias old ids onto `data_entry`, `health_coach`, and `literature` so stored analyses still open. Do not delete `serverJobs.ts` telemetry hooks that other jobs use.

The history screen edits the same functions the agent uses. Risk is the only category filter. Condition and practice toggles go away. Tracked and total-log counters stay visible and keep the milestone 0 definitions.

Pass before milestone 4: no control opens `BiomarkerDictionaryModal`; Insights does not offer the chain; a cell edit through the history function changes the same observation the agent function changes; en/id/fr/zh strings for new chrome exist; `assert-biomarker-lifecycle-m31.mjs` is either still green or its expected strings are updated in that packet on purpose.

### Milestone 4 — home strip and food context. Own packet.

Under the Home “Top targets” block, show the latest confirmed labs and confirmed symptom flags (hemorrhoid diary, poor sleep). Staged and failed-verify rows stay off that strip and off the meal prompt. The coach reads the strip when it recommends allowances and tests. The meal agent receives the strip as read-only context. It does not write the record and it does not write calories.

Pass before milestone 5: a confirmed hemorrhoid event and a confirmed sleep note render under Top targets; an unconfirmed XML import does not; the meal debug payload contains those two facts and no staged lab number.

### Milestone 5 — empty-profile onboarding. Own packet. Voice waits on VOICE-LIVE-1.

Receptionist state `onboarding_gather_info` on an empty profile offers three doors: paste a number, attach a file or screenshot, or say a symptom. Each door commits through `data_entry`. The dictionary and the clinical chain are not on this path. Voice uses the live receptionist socket from `VOICE-LIVE-1`. If that packet is not landed, milestone 5 stops at typed onboarding and says so.

Pass before milestone 6: a blank profile can log one number and one sleep sentence and see both in history; the dictionary route is absent; a voice proof is a screenshot of the live socket only after `VOICE-LIVE-1` is on the build under test.

### Milestone 6 — MCP uses the same functions. Own packet, after MCP step 3’s sync ratchet.

`manage_biomarkers` actions: list, log, edit, delete, confirm source. No dictionary action. The schema resource lists the user’s markers, not `biomarkerDefinitions`. Writes go through the milestone 0 functions, with the sync ratchet (per-cell `updated_at`, tombstone wins, `possibleUids` on read, `canonicalUid` on write). An open website tab picks the change up on focus via the incremental pull MCP step 3 adds.

Pass: the milestone 0 and milestone 1 cases succeed through the MCP tool and through the website function, and a delete stays deleted after a website sync.

## Test plan

Milestone 0, this packet:

```text
npx vitest run src/utils/healthRecord.test.ts
npx tsc --noEmit
node scripts/journey-guard.mjs biomarker-flexible-log
```

`healthRecord.test.ts` must contain these cases by name. A case that is skipped does not count.

- `xml keeps every nested name`
- `panel without a value is not a number`
- `truncated printed name is stored as printed`
- `same analyte on four dates stays four observations`
- `verify fails when a child value is missing`
- `verify fails when a number was invented`
- `model score cannot mark verify passed`
- `source delete needs verify and user confirm`
- `two symptom events on one day both remain`
- `zero pain is stored`
- `sleep is its own symptom marker`
- `tracked count matches the history sheet rules`
- `total log entries count events not columns`
- `fixture xml has no personal name`

Do not run `npm test`. Do not call Gemini. Do not commit the Drive XML.

Later milestones add their own named tests in their own packets. Live Gemini, when a milestone finally needs it, is a separate proof with a screenshot, and the author of the extractor does not score that live run (`builder_ne_tier3_ab_scorer`).

## Audit plan

1. Scope vs ROADMAP. This does not reopen R-14.1, R-15, R-16, TUI, V-17b, D-10, or F-13.2. It does not take over MCP-GEMINI steps 3–7. It does not mark Track B rows done.
2. One frozen example for milestone 0: the anonymized XML plus the 17-column diary JSON. Personal Drive file stays out of git.
3. Residual, named: the live app still uses the dictionary and the clinical pipeline until milestone 3. Sync can still resurrect deletes until MCP step 3. Voice onboarding does not exist until `VOICE-LIVE-1` and milestone 5. Screenshot “100%” means two independent reads agreed and the checker passed. It does not mean a human compared every pixel.

## Blast radius

Allowed / Frozen are the YAML lists above.

Out of scope for this go: UI, D1 migrations, agent prompts, receptionist copy, dictionary deletion, Insights, Home, food prompts, MCP, sync merge, `src/types.ts`, `src/utils/biomarkers.ts`.

## Stop and come back

Two repairs fail on milestone 0. A frozen file appears in the diff. The real Evergreen XML is committed. A test passes by shrinking the expected count. Live Gemini is called. The builder starts milestone 1 in this same packet.
