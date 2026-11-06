---
id: biomarker-flexible-log
status: locked
skill: biomarkers
edit_mode: patch
allowed_files:
  - src/utils/healthRecord.ts
  - src/utils/healthRecord.test.ts
  - tests/fixtures/health-record/grid.csv
  - tests/fixtures/health-record/prose.txt
  - tests/fixtures/health-record/nested-panel.xml
  - tests/fixtures/health-record/pages-10.json
  - tests/fixtures/health-record/pdf-pages.json
  - tests/fixtures/health-record/symptom-diary.json
  - tests/fixtures/health-record/README.md
frozen_files:
  - src/App.tsx
  - src/hooks/useBiomarkerActions.ts
  - src/hooks/useAppShellState.ts
  - src/hooks/useAppSync.ts
  - src/components/AppModals.tsx
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

Milestone 0 proves a format-agnostic record and checker. A lab file may be a document, a sheet, XML, or any other layout. A photo entry may be one image or a batch of 10. An entry may also attach one PDF or several PDFs at once. A PDF page with a text layer is read as text. A page that is a scan, or that contains a screenshot, is read by OCR. A symptom diary keeps accepting logs as columns are added or removed. The same milestone proposes cleanup for dirty values, absurd numbers, mixed units, and the same analyte under two names. Nothing in that list rewrites a stored number or merges two markers until a person confirms. No model call and no UI change in this go. Later milestones may remove the dictionary and the clinical pipeline only after these cases pass.

## Findings (do not redo)

- This worktree is `agent/biomarker-flexible-log` at `c033348d`, three commits behind `origin/main` `99208116`. Do not rebase in this go. Do not edit MCP files from this packet.
- `origin/main` `99208116` is also `origin/agent/mcp-gemini`. It is MCP step 3. `server_db_d1.ts` on main refuses an older `updated_at` for `food_logs` and `biomarker_logs` (`WHERE excluded.updated_at >= coalesce(stored, '')`). `useAppSync.ts` on main still has no `visibilitychange` pull. An open tab can still overwrite a newer row. Biomarker writes and any D1 shape change wait for that pull.
- MCP on main serves `manage_home` (`get_profile`, `get_allowance_progress`, `get_dashboard`, `set_targets`), `manage_meals` (`list`, `get_detail`), and `manage_biomarkers` (`list`, `get_trends`). Biomarker reads assume one D1 row per date whose `biomarkers` field is a key-to-value map. `get_trends` skips non-numeric values and guesses the unit with a regex. There is no `get_health_summary` tool.
- There is no MCP action that logs, edits, or deletes a biomarker. `parseLabImages` sends every image in one model call. A 10-photo entry must not use that call. A multi-PDF entry must not use it either.
- `package.json` has no PDF library. `pdfjs`, `pdf-parse`, `unpdf`, `pdf-lib`, and `mupdf` are absent (checked 2026-10-28). The product’s vision path is Gemini on meal and label images, not a lab-PDF extractor. Telegram tests mention a `.pdf` file id and do not open pages. Milestone 0 classifies page descriptors in `pdf-pages.json`. It does not add a parser and it does not commit PDF bytes. Opening a real PDF is milestone 2.
- A PDF is routed per page, not per file. A born-digital page keeps its text layer. A page that is only an image goes to OCR. One file can mix both, and one page can be both when selectable text sits beside an embedded screenshot. Sources read 2026-10-28: [PDF text extraction vs OCR](https://www.booktranslator.app/blog/pdf-text-extraction-vs-ocr), [Scanned PDFs Are a Different Problem](https://www.wpsolr.com/scanned-pdfs-are-a-different-problem/), [Scanned vs native PDFs](https://openpreservation.org/blogs/scanned-vs-native-pdfs-how-to-differentiate-them/). OCR here is the same two `gemini-3.5-flash-lite` vision reads used for photos. Do not add Tesseract, ocrmypdf, Docling, or LlamaParse. An empty text layer is not “no results”.
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
- G-B1 convert locks stay `1.293` / `1.411` / `3.362` / `79.56` / `13.68`. Ingest does not convert. A convert card changes the number only after confirm, and only by `convertViaTable`.
- The private Drive file `Evergreen Life Record Download - Results.xml` (id `1XwdWhqsL9NaS_YorJkAmxHp3FtZFOmrV`) was read again on 2026-10-28 (50,659 bytes) and then deleted from `/tmp`. It is personal data. Do not commit it, and do not make its 153 values the unit-test count. Measured shape, tags only: 77 `<result>` elements, none nested, zero `<child>` tags. Inside one result the rows are flat sibling tuples, not wrapped children. A tuple is `date name code`, optionally `comment`, and for a reading also `value units value_minimum value_maximum`. 63 results hold one tuple. The largest holds 18. 153 readings all have `<units>`. 29 tuples have no value (panel headers). 11 readings are numeric `0`. A parser that keeps only the first `name` in a result drops the rest. `nested-panel.xml` copies that shape with synthetic names, not this file.
- The symptom sheet “Daily Health Symptom Tracker” (id `1aB-Jm0wyNSdOnKAAOxdrqFUEllI-HYoVWh3fyZlhz4Q`, tab `Feuille 1`) is one event with 17 columns, plus a note that mentions poor sleep. That sheet is one diary shape. A later log may arrive with fewer columns, more columns, or a different header order. Cells are stored by column id, never by position.
- 2026-10-28 correction: milestone 0 must not lock the checker to XML tag counts. Exact tag counts are valid only for a format whose parser sees every cell. A doc or a photo has no tag count. For those, pass means two independent reads returned the same multiset of rows and every row cites a page or a cell. A model’s own “100%” is not a pass.
- 2026-10-28 correction: one entry may attach one PDF or several PDFs together, including beside photos. Each page is text, OCR, or both. Milestone 0 proves that router on descriptors. It does not open a PDF file.
- The symptom sheet “Daily Health Symptom Tracker” (id `1aB-Jm0wyNSdOnKAAOxdrqFUEllI-HYoVWh3fyZlhz4Q`, tab `Feuille 1`, gid 0) has one header row and one event row. Columns: Date & Time (with Timezone), Movement # of Day, Stool Volume, Stool Form / Bristol Scale, Stool Color, Bleeding Amount, Bleeding Color, Bleeding Timing & Clots, Anal Pain (0-10), Abdominal Pain (0-10), Straining Level, Local Sensations, Systemic Symptoms, Hydration, Diet & Fiber, Medications & Supplements, Clinical Notes / Action Items. The note also mentions poor sleep. That is a second symptom series, not a 17th hidden column of the bowel event, unless the user adds that column.
- `gws` is not on this Mac. The reads used `scripts/lib/google-store.mjs` after `loadHostEnv`.
- Voice relay is on main. PR #827 squash `1dad71e` is an ancestor of `99208116`. `server_gemini_live_ws.ts` and `VoiceReceptionistFab.tsx` are on main. The live tools are `update_profile`, `navigate_tab`, `handoff_specialist`, and `log_meal`. There is no `stage_health_record` tool and no `handoff_to_specialist` tool. `specs/active/VOICE-LIVE-1.md` is still in the tree. Milestone 5 uses the existing socket and the existing `handoff_specialist` tool. It does not add a second speech stack.
- Q-11 moved biomarker apply out of `App.tsx`. `useBiomarkerActions.ts` holds `handleLogMedical` and calls `enrichReviewModificationCommands`. `useAppShellState.ts` holds the shell stores. `pushPendingObservation` lives in `appProfileUtils.ts` and is called from `AppModals.tsx`. `mergeParallelAliasGroups` is called from `useAppSync.ts`. `scripts/assert-biomarker-lifecycle-m31.mjs` still reads `App.tsx` for those strings. Run on this worktree on 2026-10-28: 6 fails (`P0:A3` enrich, `P1` `collectCatalogUnitMap`, `P2` parallel-key fold count, `P4` calibrator count, `P8` pending push). `P0:A2`, `P0:A4`, `P0:A6`, `P5`, `P6`, and `P7` passed. Milestone 0 does not edit the assert and does not put the strings back into `App.tsx` to turn the gate green.
- `src/utils/frontDeskRouting.ts` routes one way: front desk to `health_baseline`, `medical`, `agent4`, `agent7`, or a food specialist. `src/server/healthCoach/instruction.ts` returns allowances, nutrient targets, and activities. It has no test-plan fields. Those two facts are milestone 3, not milestone 0.
- In-app models in `src/utils/llm.ts`: default `gemini-3.5-flash-lite`. Heavier text models already listed are `gemini-2.5-flash` and `gemini-2.5-pro`. Muse Spark is an OpenCode Go coding lane, not an in-app extractor. Patient files do not go through that lane.
- Risk labels already on definitions include Cardiovascular, Metabolic, Kidney, Hematology, Hepatic, Liver, Gastrointestinal, Bone & Mineral, Musculoskeletal, Wellness, and Screenings & Wellness. A new marker uses one of those. Do not add a second list such as Renal, Hematologic, or Sleep & Recovery.
- `isBiomarkerValueImprobable` in `biomarkers.ts` reads the dictionary. `healthRecord.ts` does not import it. An absurd card in milestone 0 uses the printed range on the row, or a flag the caller passes in.
- Sync still open after step 3: `mergeProfiles` is an unconditional spread, food union lets local content win, and open tabs do not pull on focus. This packet does not fix sync.
- Corrections refused from the 2026-10-28 review: do not move D1 or MCP writes into milestone 1. Do not require the private file’s 153 values in a test. Do not add `<child>` tags. Do not claim the live file has a unitless numeric row. Do not add `pdfjs` in milestone 0. Do not move fixtures to `src/utils/__fixtures__/`. Do not rename `deleteSourceAllowed`. Do not flip this packet to `go` from inside the plan.

### Standing triplets that stay in force

- (Condition: a key is `steps`, `sleep_duration`, `weight`, or another `isExcludedDeviceMetric` key, Action: skip laboratory ratio checks, Pitfall: a night of poor sleep is flagged as a 10× unit error.)
- (Condition: two lab observations share a marker and a calendar day, Action: upsert by source identity and do not average, Pitfall: the second panel replaces or averages the first.)
- (Condition: two symptom events share a calendar day, Action: keep both, with their own time, Pitfall: the date-map merge collapses two movements into one cell.)
- (Condition: the value is `0`, Action: store it, Pitfall: `isValEmpty` drops “abdominal pain 0”.)
- (Condition: a source file is still retained and the checker has not passed, Action: keep the rows staged and out of the tracked and total-log counts, Pitfall: the model’s own “100%” publishes a short count.)
- (Condition: the meal agent or the coach reads the record, Action: pass confirmed rows as read-only context, Pitfall: the food path writes biomarker rows or a second calorie total.)
- (Condition: a later delete removes a marker or one cell, Action: write the existing tombstone timestamp and let the newer tombstone win, Pitfall: the website re-uploads the row from localStorage.)
- (Condition: the focus pull is still absent, Action: do not add MCP biomarker writes or a D1 shape change in this packet, Pitfall: an open website tab overwrites a newer row.)
- (Condition: a PDF page has letters or digits and no large embedded image, Action: read that text and do not call vision, Pitfall: a digital lab report is rasterized and OCR scrambles the columns.)
- (Condition: a PDF page has no letters or digits and is an image, or it contains a large embedded image, Action: OCR that image with the two-read photo path, Pitfall: an empty text layer is stored as zero rows and the scan is dropped.)
- (Condition: one entry holds one or more PDFs, Action: one batch id, one stored object per file, each page cited as file plus page, Pitfall: every PDF is sent in one model call.)
- (Condition: a PDF is password-locked, Action: stage that file as locked and do not drop it, Pitfall: the rest of the batch is marked passed while the locked file vanished.)

## Plan

### Milestone 0 — this go. One record, any layout, ongoing diary. No model. No UI.

1. Add `src/utils/healthRecord.ts` with plain types and pure functions. No imports from `biomarkers.ts`, the dictionary, or the pipeline. Done when: the module compiles alone.
   - `StagedRow`: printed label, numeric value or text value (either may be null), unit or null, `printedRange` `{ min, max } | null`, when or null, `kind: 'biomarker' | 'symptom'`, cite `{ fileId, page?, cell?, quote }`. A missing field stays null. Nothing invents a required analyte or a unit.
   - `Marker`, `Observation`, `SourceBatch`: a batch has one id and one or more parts. A part is a file, a sheet tab, a photo page, or a PDF page (`fileId` + `page`). Verify status and user confirm are separate. One entry may hold several PDFs, and those PDFs may sit beside photos in the same batch.
   - `Diary`: id, `columns: { id, label, retiredAt? }[]`, `events: SymptomEvent[]`. A cell is `{ columnId, value }`. `0` is kept. Position is not stored.
   - Counts: `trackedMarkerCount` and `totalLogEntryCount`, same exclusions as `MedicalHistoryTab`. A symptom event counts as one log entry however many cells it has. Unconfirmed or failed parts do not count.
2. Add three ingest doors that all emit `StagedRow[]`. Done when: each door has a fixture and none of them shares the other’s pass rule.
   - **Grid.** `grid.csv` is a sheet whose first row is titles and whose columns are not a lab panel (for example time, a score, a free-text note, a blank cell). `verifyGrid` passes only when every non-empty data cell is a header, a staged row whose cite text contains the value, or an explicit ignore. A staged number that is not in its cell fails. Dropping one data cell fails.
   - **Prose.** `prose.txt` is a short note with two results and one sentence that is not a result (“slept badly”). The checker accepts rows whose quotes are substrings of the note. A row whose number is not in the note fails. The sleep sentence is `kind: 'symptom'`. It is not forced into a numeric lab. Its risk label, if any, is one of the existing labels passed in by the caller.
   - **Flat panel.** `nested-panel.xml` is one synthetic `<result>` with flat sibling tuples and no `<child>` tag. Tuple one is `date name code comment` and has no value. Tuple two is a reading with `value`, `units`, `value_minimum`, and `value_maximum`. Tuple three is a reading whose `value` is `0` and whose units are present. A fourth tuple in the same fixture has a numeric `value` and a range and no `units` tag. That fourth tuple is synthetic. The live file’s readings all had units. A walk that keeps every tuple passes. A walk that keeps only the first `name` fails. The header is not a number. Its comment stays on the header. A reading’s comment stays on that reading. `printedRange` comes from `value_minimum` and `value_maximum`. The unitless reading keeps `unit: null`. The `0` stays numeric. The file is one layout, not the schema.
   - Pitfall: do not mark a field required in a way that makes a model invent it. Pitfall: do not rename printed labels. Pitfall: do not call `getMappedBiomarkerKey`.
3. Add `verifyAgreement(readA, readB)` for pages. Done when: the function compares the multiset of `(printed, value, unit, when, page)` and ignores any model score. `pages-10.json` has 10 pages. Pages 1–6 and 8–10 agree. Page 7 disagrees by one dropped value. Agreed pages can be confirmed on their own. Page 7 stays staged. The batch id is the same for all 10. In-flight cap of 4 is a runner detail inside the test as a queue length, not a product limit of 4 photos. PDF pages use this same queue.
3b. Add `routePdfPage` and `openDescribedPdfBatch`. Done when: `pdf-pages.json` passes the PDF cases in the test plan. The fixture is descriptors only. No PDF bytes, no parser dependency, no Gemini.
   - Input is `{ fileId, page, text, imageCount, imageAreaRatio, locked? }`.
   - `hasText` is true when `text` contains at least one letter or digit.
   - `largeImage` is true when `imageAreaRatio >= 0.20`. A letterhead logo stays under that line and does not force OCR.
   - `locked` → door `locked`, even when the descriptor also has text. No text read. No OCR. That part stays staged. Other pages in the same batch can still be confirmed. `deleteSourceAllowed` stays false while any part is locked.
   - `hasText` and not `largeImage` → door `text`. Zero vision calls. The text then uses the prose door, or the grid door when a table was recovered.
   - not `hasText`, and (`imageCount >= 1` or `imageAreaRatio >= 0.50`) → door `ocr`. That page later uses `verifyAgreement`, the same rule as a photo. The cite is `fileId` + `page`.
   - `hasText` and `largeImage` → door `both`. Text rows and OCR rows are both staged. `proposeCleanup` then applies the exact-duplicate card so one printed number becomes one observation with two cites.
   - Neither text nor an image → door `empty`. Staged. Not a pass. Not deleted.
   - `pdf-pages.json` is synthetic. File A has three pages: text only; a scan (`text` empty, `imageAreaRatio` 0.95); text plus a screenshot (`imageAreaRatio` 0.40, same printed number on both doors). File B has two pages: text plus a logo (`imageCount` 1, `imageAreaRatio` 0.05); an empty page (no text, no image). File C is `locked: true` and also has text, so the lock wins. Opening A alone is one batch. Opening A and B together is one batch, five pages, four in flight, the fifth waiting. Opening A, B, and C together keeps C staged. Cites keep `fileId` and `page`. Photos and PDF pages in one entry share the cap of 4. A text page still occupies a slot, so a long PDF does not open every page at once.
   - Pitfall: do not OCR a letterhead logo. Pitfall: do not send every page of every PDF in one model call. Pitfall: a text read and an OCR read of the same number must not become two tracked markers.
4. Diary functions, still pure:
   - `appendEvent` adds a log. Earlier events stay. Identity is `(diaryId, observedAt, movementNumber | clientKey)`. The same key twice updates that event and does not create a second one.
   - `addColumn` issues a new column id. Old events keep their old cells. New events may use the new id.
   - `retireColumn` sets `retiredAt`. A later event that omits that id does not shift the other cells. The old event still has the retired cell.
   - An event that arrives with an unknown header stores the known cells and returns the unknown header as a proposed column. It does not publish the new column until `addColumn` is called.
   - Two events on one calendar day both remain. A later day appends a third.
5. `deleteSourceAllowed` is true only when every part of the batch is `passed` and the user confirm is `confirmed`. A batch with page 7 still failed cannot be deleted.
5b. Add `proposeCleanup` in the same module. It returns proposal cards. It does not write. Done when: the cases in the test plan under “cleanup” pass.
   - **Exact duplicate.** Same normalized label, same unit, same instant, same value. The card says `auto`. Applying it keeps one observation and a second cite. The number does not change. A second copy with a different value is not a duplicate. It is a conflict. Do not average.
   - **Two names.** The caller passes the markers this user already has (`id`, printed name, aliases, kind, unit, risk labels). A proposal fires when the normalized labels match, or a source code matches a code already stored on that user’s marker. A new string does not match through the dictionary, a stem, or a synonym table. Until the card is `confirmed`, the row stays staged and does not increase the tracked count. Rejecting the card creates a separate marker. Accepting it stores the extra label as an alias on the survivor and tombstones the duplicate marker id. The survivor keeps one of the existing risk labels. A symptom is not merged onto a lab score.
   - **Mixed units on one marker.** A series may hold `mg/dL` and `mmol/L`. Display uses the profile unit preference. The raw value and raw unit stay on the row. A convert card is offered only when `convertViaTable` in `src/utils/biomarkerLifecycle.ts` has a factor for that analyte. Locked factors stay the G-B1 set: HDL 50 → 1.293, triglycerides 125 → 1.411, LDL 130 → 3.362, creatinine 0.9 → 79.56, bilirubin 0.8 → 13.68. HbA1c keeps the IFCC formula already in that function (`mmol/mol = 10.93×% − 23.5`). An unknown pair returns `ok: false` and the card says “no conversion”, with actions relabel or leave. Relabel changes the unit text and does not change the number. Convert changes the number by the named factor and keeps the raw. A card cannot contain both.
   - **Absurd value.** If the row has a `printedRange` and the number sits far outside it, or the caller passes `improbable: true`, the card offers relabel, convert via the table, or leave. The module does not consult `biomarkerDefinitions` and does not invent a bound such as “HbA1c cannot be 950”. `computeBiomarkerTelemetryMultiplier` may explain a table factor. It may not invent a generic ×10 or ÷100. `steps`, `sleep_duration`, `weight`, and the other `isExcludedDeviceMetric` keys do not get this card.
   - **Dirty text.** `5.2 H`, `<0.1`, `Positive`, `see comment`, and `120/80` stay text. They are not coerced to 0, 0.1, or two numbers. A card may record a comparator such as `<` beside the raw text. The stored value remains the raw text. A text value landing in an otherwise numeric series is its own card. `0` remains a real numeric value.
   - **Same calendar day, two standards.** If converting one onto the other’s unit matches within the table’s rounding, one observation with two cites is proposed and the total-log count rises by one. HbA1c uses the IFCC formula already in `convertViaTable`. Both raws stay on the cites. If the converted values do not match, both observations stay and the card is a conflict. Do not average. Do not store a second shadow number that can drift from the raw.
   - Pitfall: `getDuplicateAliasGroups` and `getMappedBiomarkerKey` group by the old dictionary, including distinct symptoms onto one score. `proposeCleanup` must not call them. A synonym hit can be mentioned on the card. It cannot merge by itself.
   - Pitfall: applying a card rewrites history only through this function, after `confirmed`. The raw number remains on the observation.
6. Profile-count fixture: three lab keys across two dates, one empty custom, one not-used key, and `weight`. Done when: tracked count is 3 and total log entries equals the sum of keys on the history rows.
7. README: Drive files stay on Drive. Fixtures are synthetic. Done when: a search of `tests/fixtures/health-record` finds no personal name and no date of birth.
8. Do not wire this module into the app, D1, MCP, or an agent. Done when: `git diff --name-only` against the worktree base is only the allowed list.

### Milestone 1 — next packet, after milestone 0 is green. Still no live model.

The history screen uses the same diary and observation functions. The two counters on that screen are `trackedMarkerCount` and `totalLogEntryCount` from this module, so the UI cannot show a second definition. Risk tags on new rows are chosen from the existing labels. A symptom event has `kind: 'symptom'` and sits in the same list. Its columns stay addressable by id when one is added or removed. Same-day labs do not average. `sleep_duration` and symptom scores skip laboratory ratio checks.

Milestone 1 does not migrate D1, does not edit `server_db_d1.ts` or `server_routes_mcp.ts`, and does not remove the practice and condition filter buttons. Those buttons go away in milestone 3. The seven stored copies (D1 date map, `customBiomarkers`, `pendingObservations`, `biomarkerDefinitions`, not-used maps, tombstones, agent-analysis blobs) stay until the milestone that first writes the record to D1, and that milestone starts only after a focus pull exists.

Pass before milestone 2: a diary that started at 17 columns still shows the first event after a column is removed and after a column is added; a log that arrives a week later with the columns in a different order lands on the same ids; a re-import of the same movement does not double the total-log count; a brand-new header is proposed and the rest of that log is still saved; the history counters match the milestone 0 functions on the same fixture.

### Milestone 2 — data-entry agent. Any file, a batch of 10 photos, and one or more PDFs. No live Gemini in the unit gate.

One agent id, `data_entry`, is the only writer. It sees the user’s existing markers. After a batch verifies, it runs `proposeCleanup` and shows the cards in the user’s language. Exact duplicates apply as `auto` and stay reversible. Every card that merges two names, converts a number, or relabels a unit waits for a confirm. The user can uncheck one row inside a batch. The agent does not set `confirmed`. A near name stays staged until that confirm. Rejecting it creates a new marker.

Store original bytes on R2, one object per file or photo, one batch id. Confirmed rows stay in the milestone 0 record. They are not upserted into `biomarker_logs` until the focus pull and the single D1 projection exist. One entry accepts one PDF or many PDFs together, and those files may sit beside photos. Grid and nested-markup doors run with no model. Each PDF page follows `routePdfPage`. A text page, and a doc whose table was recovered, uses the grid or prose door with no vision call. An OCR page is rendered and read twice with `gemini-3.5-flash-lite`, the same two-read path as a photo. A page that has text and a large embedded screenshot does both, then the exact-duplicate card. At most four pages run at once across photos and PDF pages. A batch of 10 photos, or a PDF longer than four pages, queues. Publish a page only when its door passes: text and grid by their own checkers, OCR by `verifyAgreement`. The two reads use `gemini-3.5-flash-lite` and the two prompts are not the same string. A disagreed page, and only that page, may be read once more with `gemini-2.5-flash`. `gemini-2.5-pro` is not the default tie-break. Muse Spark is not an extractor. The model cannot set `verify: passed`. The private lab file is not the fixture and not the count the test expects. A synthetic result with several tuples must account for every value tuple in that fixture.

There is no PDF parser in the repo today. Milestone 2 adds the opener. It reads the text layer per page and renders a page, or the embedded image, only when `routePdfPage` says `ocr` or `both`. The unit gate still uses `pdf-pages.json`. A password-locked PDF stays staged as `locked`. Do not add Tesseract or a second OCR engine.

`parseLabImages` is not the photo path and not the PDF path. It puts every image in one call.

Receptionist handoff for a file, a 10-photo batch, one or more PDFs, or “I slept badly” targets `data_entry`.

The same agent can be asked to clean the record that is already stored. That run uses `proposeCleanup` on the whole history, not a second pipeline.

Pass before milestone 3: the grid, the prose note, and the nested panel pass with zero model calls; page 7 of the 10-page fixture stays uncounted while the other nine can be confirmed; a second name does not become a second tracked marker while its card is open; HDL in mg/dL converts only after confirm and the raw 50 is still stored; an unknown unit pair does not change the number; sleep is not flagged as a lab error; the source batch cannot be deleted while any page is failed or locked; the receptionist contract routes the file, the PDF batch, and the sleep sentence to `data_entry`; a text PDF page takes the text door with zero vision calls; a scan page takes OCR and stays uncounted until the two reads agree; one PDF and two PDFs each share one batch id; an embedded screenshot is OCR’d beside the page text and the same number stays one observation.

### Ordering against MCP

Do the record work beside the remaining sync work, and do not add biomarker write tools first.

| Lane | When | Why |
|---|---|---|
| MCP step 3 | On main at `99208116`. | The server upsert already refuses an older `updated_at`. This packet does not touch those files and does not rebase onto that commit. |
| Focus pull | Still missing on `useAppSync.ts`. Own small packet before any biomarker write. | Without it, an open tab can overwrite a newer D1 row. Milestone 1 does not take this job. |
| This packet, milestones 0–1 | Starting now, on this worktree. | New record files, then the history screen. No D1 migration and no MCP edits. |
| Milestone 2 | After 0–1. Still no MCP edits. | The photo batch, the PDF doors, and the any-format doors have to exist before a tool exposes them. |
| One D1 projection | After the focus pull, before MCP writes. | The seven copies collapse here. Counters stay the milestone 0 functions. A later server edit starts from main so it cannot drop the `99208116` guard. |
| MCP read adapter | After milestone 2, on a branch cut from main. | `list` and `get_trends` keep working. They read a compatibility view: numeric labs stay a map so current Gemini sessions still parse; symptom events are a separate list so `get_trends` stops dropping text diaries. |
| MCP write actions `log`, `edit`, `delete`, `confirm_source`, `confirm_cleanup` | After the read adapter, the D1 projection, and the focus pull. | A write tool built on today’s date map would teach Gemini the shape this plan is replacing. `confirm_cleanup` is the only way a Gemini session applies a merge or a unit convert. |

The server half of step 3 has landed. The client focus pull has not. Writes still come last. Building them in milestone 1 would put Gemini on the date map this plan is replacing. Live screenshots (L18) belong to the milestone that shows a screen. They do not replace milestone 6. `standing.json` stays frozen until a later packet whose only job is the new rows.

### Milestone 3 — remove the dictionary and the clinical pipeline. Own packet. Domain law update in that packet.

After milestones 0–2 are green, and only then: remove the dictionary UI, `runBiomarkerPipeline`’s catalog hit/miss split, and the Insights required chain (`agent1`, `agent2`, `agent3`, `agent4`, `agent5`, `data_review`). Keep literature (`agent7`) as its own on-demand action. Fold test planning (`agent4`) into the health coach (`health_baseline`) as one agent the user sees as Health coach. The coach JSON keeps its allowance and activity fields and gains test-plan fields in that same instruction. Update `docs/agent/domains/biomarkers.md` in that same change (AGENTS.md L9). Alias old ids onto `data_entry`, `health_coach`, and `literature` so stored analyses still open. `medical` and `agent4` remain as aliases, not as extra agents the user sees. Do not delete `serverJobs.ts` telemetry hooks that other jobs use.

Handoff among the four ids `front_desk`, `data_entry`, `health_baseline`, and `agent7` is `{ fromAgent, toAgent, reason, payload, returnToCaller }`. Any of the four may emit one. The result is appended to the caller’s turn. It is not a required next step. Food specialists stay outside this mesh. `frontDeskRouting.ts` today only maps front desk to a specialist. This milestone adds the return path and the `data_entry` id. It does not add a second router.

The history screen edits the same functions the agent uses. `viewType` keeps `risk` only. `practice` and `condition` go away, and new rows do not write `standardMedicalGrouping` or `potentialMedicalConditions`. A marker carries `kind: 'biomarker' | 'symptom'`. A symptom diary expands in that same list, and its columns can be added or hidden without shifting stored cells. Tracked and total-log counters stay visible and keep the milestone 0 definitions.

The M31 assert is already red on this base. This milestone does not “keep it green” by stuffing strings into `App.tsx`. It presents a before/after of `scripts/assert-biomarker-lifecycle-m31.mjs` for a human to confirm before the file changes. The diff retargets the `App.tsx` greps onto the files that actually call them (`useBiomarkerActions.ts`, `AppModals.tsx`, `useAppSync.ts`, `useJobRuntime.ts`), or drops a grep only when that product path is deleted on purpose. It retires `P0:A2`, `P0:A4`, and the dictionary half of `P8` when the modal is gone. It keeps `P0:A6`, `P1` raw value, `P5`, `P6`, and `P7`.

Pass before milestone 4: no control opens `BiomarkerDictionaryModal`; Insights does not offer the chain; a cell edit through the history function changes the same observation the agent function changes; the history screen has no practice or condition filter; a symptom diary expands in that list; a coach reply contains both an allowance and a test-plan field; a `data_entry` handoff can name `health_baseline`, and a `health_baseline` handoff can name `data_entry` or `agent7`; en/id/fr/zh strings for new chrome exist; the M31 diff has been confirmed and the kept rows pass.

### Milestone 4 — home strip and food context. Own packet.

Under the Home “Top targets” block, show the latest confirmed labs and confirmed symptom flags (hemorrhoid diary, poor sleep). Staged pages and failed parts stay off that strip and off the meal prompt. The coach reads the strip when it recommends allowances and tests. The meal agent receives the strip as read-only context. It does not write the record and it does not write calories.

Pass before milestone 5: a confirmed hemorrhoid event and a confirmed sleep note render under Top targets; an unconfirmed page from a 10-photo batch, or from a PDF, does not; the meal debug payload contains those two facts and no staged lab number.

### Milestone 5 — empty-profile onboarding. Own packet. Voice uses the socket already on main.

Receptionist state `onboarding_gather_info` on an empty profile offers three doors: paste a number, attach a file (one file, up to 10 photos, or one or more PDFs), or say a symptom. Each door commits through `data_entry`. The dictionary and the clinical chain are not on this path. Voice uses the live socket already on main (`/api/gemini/live-ws`, `VoiceReceptionistFab.tsx`). A spoken lab or symptom is a `handoff_specialist` call whose target resolves to `data_entry`. Do not add `stage_health_record`. Do not add a second speech stack.

Pass before milestone 6: a blank profile can log one number and one sleep sentence and see both in history; the dictionary route is absent; a voice proof is a screenshot of that existing socket handing the same two facts to `data_entry`.

### Milestone 6 — MCP writes. Own packet. See Ordering.

`manage_biomarkers` gains `log`, `edit`, `delete`, `confirm_source`, and `confirm_cleanup`. No dictionary action. A merge or a unit convert from Gemini applies only through `confirm_cleanup`. A `log` call may carry text, a grid, up to 10 image parts, or one or more PDF parts. The schema resource lists the user’s markers, not `biomarkerDefinitions`. Writes call the milestone 0 functions. They ship only after `agent/mcp-gemini`’s upsert guard is on main and the focus pull exists, so an open website tab cannot resurrect a deleted event.

Pass: a 10-photo batch, a two-PDF batch, and a diary append succeed through the MCP tool and through the website function; removing a column does not shift old logs; a delete stays deleted after a website sync.

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
- `flat result keeps every sibling tuple`
- `panel header without a value is not a number`
- `printed range stays on the row`
- `unitless synthetic row keeps a null unit`
- `xml zero value stays numeric`
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
- `hba1c pair counts as one log entry`
- `same day units that do not match stay two observations`
- `comparator stays beside the raw text`
- `blood pressure pair stays one text value`
- `one pdf and two pdfs share one batch`
- `text page uses the text door`
- `scan page uses ocr`
- `embedded screenshot is ocr beside the text`
- `text and ocr of the same number stay one observation`
- `locked pdf stays staged`
- `small logo does not force ocr`
- `empty pdf page stays staged`
- `pdf pages use the same in-flight queue`

Do not run `npm test`. Do not call Gemini. Do not commit the Drive file, the symptom sheet, or a patient PDF.

Later milestones add their own named tests in their own packets. Live Gemini, when a milestone finally needs it, is a separate proof with a screenshot, and the author of the extractor does not score that live run (`builder_ne_tier3_ab_scorer`).

## Audit plan

1. Scope vs ROADMAP. This does not reopen R-14.1, R-15, R-16, TUI, V-17b, D-10, or F-13.2. It does not take over MCP-GEMINI steps 3–7. It does not mark Track B rows done.
2. Frozen examples for milestone 0: the grid, the prose note, the nested panel, the 10-page batch, the PDF page descriptors, and the diary JSON. No PDF bytes. Personal Drive files stay out of git.
3. Residual, named: the live app still uses the dictionary and the clinical pipeline until milestone 3. The server upsert guard is on main at `99208116`. The focus pull is still absent, so an open tab can still overwrite a newer row. The M31 assert is already red for six `App.tsx` greps and stays untouched until milestone 3’s confirmed diff. Voice relay code is on main. Milestone 5 still has to point `handoff_specialist` at `data_entry`. For a photo or an OCR page, “passed” means two reads agreed and the user confirmed. It does not mean a human compared every pixel. For a text PDF page, “passed” means the text checker matched the text layer. A locked PDF is not a pass. Opening real PDF bytes is milestone 2. A document that states no row count has no exact completeness number beyond that agreement. The private lab file is not a gate.

## Blast radius

Allowed / Frozen are the YAML lists above.

Out of scope for this go: UI, D1 migrations, agent prompts, receptionist copy, dictionary deletion, Insights, Home, food prompts, MCP, sync merge, `src/types.ts`, `src/utils/biomarkers.ts`.

## Stop and come back

Two repairs fail on milestone 0. A frozen file appears in the diff. The real Evergreen XML or a patient PDF is committed. A test passes by shrinking the expected count, or by expecting the private file’s 153 values. Live Gemini is called. A PDF parser dependency is added in this go. The builder rebases onto main, edits `server_routes_mcp.ts`, or starts milestone 1 in this same packet. The packet status is flipped to `go` without a reply that says go.
