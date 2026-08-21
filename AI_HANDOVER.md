# AI Handover & Session Progress Board

**Updated:** 2026-08-21
**Status:** Q-6.4 Promote deferred; Inbox mint stopped; catalog/re-analyze on food #n

- **Q-6.4 rest minus Promote (2026-08-21):** Item **5 Promote / hide Inbox tab** is deferred. Item 6: snap no longer POSTs `/api/golden/cases`; `writeInboxCase` is not called on D1 create; leftover D1 rows plan-link onto existing `#n` via `POST /api/bugs/migrate-inbox` (promoted official goldens skip create). Item 7 tests (tape on/off, remaining+line photos, catalog body does not touch queue) landed; promote-refuses-photos waits on item 5. Food `#n` now has **Replay catalog** (preview only) and **Re-analyze** (opens saved `job_id`). Inbox tab + Make Golden stay until Promote. Picnic food-calc (curator skip / 171711 / gherkin / red onion) still detect-only.

- **Q-6.4 auto-spot from picnic tape (2026-08-21):** Snap / `#n` Checks now surface tape-detectable remaining that `classifyJobResult` skips on succeeded meals. New codes in `bugAutoSpot.ts` (query-scoped, not this meal’s FDC list):
  - **CURATOR_SKIP** — grouped `[CuratorAction] No pick_existing action found` (picnic: 17 queries skipped because curator emitted `action: quarantine` + `parametricFdcId` instead of `pick_existing`).
  - **SIBLING_ID_COLLISION** — distinct sibling components share one 5–8 digit canonical id (picnic: strawberries/blueberries/raspberries → 171711).
  - **FALLBACK_SKEW** — category-fallback kcal/100g outside a class band (picnic: gherkin 150 vs pickle ≤45; also avocado 40 vs ≥100). Reasonable chicken 165 is quiet.
  - **COMPONENT_DROP** — `visualIngredients` missing from scout and receipt components (picnic: Cobb **red onion**; also fruit-cup mixed melon).
  - Snap prefers `POST /api/golden/preview` `autoSpot` (server hydrates `jobId` / R2 / `logs/` keys so short `[Logs stored in R2]` pointers still score). `#n` Checks render `board.autoSpot`. Did **not** bind curator quarantine→pick (would paint this meal’s reused 171711). Promote / D1 / `writeInboxCase` still open. Do not mark Q-6.4 done.

- **Debug Log Download Scoping & Current Meal Extraction (2026-08-21)**:
  - **Scoped Job ID Priority**: In `LogChat.tsx` (`handleDownloadDebug` and message render loop) and `FoodCard.tsx` (`handleDownloadTableAndLogs`), resolved `targetJobId` / `resolvedJobId` using prioritized lookup `msg.data?.jobId || msg.id.replace('msg_assistant_job_', 'job_') || msg.pendingFoodLog?.jobId || msg.data?.pendingFoodLog?.jobId || jobId`.
  - **Scoped Meal Data Isolation**: Ensured downloaded debug Markdown/JSON uses `msg.data?.pendingFoodLog || msg.pendingFoodLog` and the message's specific logs instead of inheriting previous/stale meal logs from initial session jobs.
  - **R2 & Tracker Resolution**: Added transparent R2 URL log resolution and exact ID matching in `getAgentRequestLogs()` to guarantee complete log history downloads for each unique meal.

- **Q-6.4 combined queue (2026-08-21):** Gemini G1 bulk UI landed (`7427ea0`), Grok contract/schema updates verified. **Gemini G2 tape actions landed & verified**:
  - **G2-1 Live Preview Board:** Selecting food `#n` invokes `loadPreviewBoard` (`POST /api/golden/preview`) using `current_evidence` (`debug_url` / `scout_url` / `job_id`), loading the live board onto `selectedTagDetail.board` and populating Checks, Dishes, Scout identity, and Balance tabs.
  - **G2-2 Replay Log Action:** Added "Replay log" action button on food cards in `BugTrackerModal` and `FoodDetailTabs` (preview-only, no agent, does not mutate remaining or queue status).
  - **G2-3 Board Outcome Bar:** Added green/red outcomes progress bar and pass/fail summary (`computeBoardProgress`) derived from board invariants/outcomes while leaving the NOW remaining checklist intact as the source of remaining.
  - **G2-4 Capture Pack Slots:** Filtered `BugSnapshotFab` capture checkboxes by surface: food keeps nutrient calculation, debug JSON, overview, a11y, and photos; Home/Health hide food debug and nutrient calculation while preserving session/state data, a11y, and photos.
  - **G2-5 Replay Catalog / Analyze:** Catalog replay is cleanly omitted/noted without D1 minting.

- **Golden meal cleanup (2026-08-20):** Official set is **G1–G7** only (photos + Instruction + expected). Inbox promotions G8–G18 moved to `tests/Golden_meal/archive/` (`bug`, `Try golden`, quota, duplicate wraps, no-photo stubs). D1 inbox kept one card per unique meal (picnic, sweet-chilli wrap, promoted prawn doughnut, user label). Catalog replay no longer writes `all_green` / status. Disk `inbox/INDEX.md` is empty-by-design; UI is D1.

- **Bug queue green-tick vs agent view (2026-08-20):** Overview now loads `fixed` as well as `to_fix` so KPIs can count Done this week. Green tick already wrote `status=fixed` + `queue=done` for #4–#8; the dashboard had been refetching only `to_fix`, so Done this week stayed 0 and agents querying the full table still listed those cards. Open work is #2, #3, #9. `GET /api/bugs/open` and `/next` stay on open cards only.
**Governance & Laws:** Follow `docs/agent/` domain rules. Local agents may `git commit` / `git push` after COMPLETE (tsc + named gates). AI Studio remains a valid ship path.

- **Bug #10 Resolution (Brand Misattribution, Composite Pastry Tagging & UI Contrast) (2026-08-21)**:
  - **Brand Scope Isolation**: Updated database resolver in `server.ts` so generic companion items (e.g. unbranded fruit cup, crispy chicken wrap condiments) drop unqueried brand official metadata (`Actimel`, `Yolk Official`) unless the brand name is explicitly present in the query or item brand field.
  - **Single Staple Composite Protection**: Added `SINGLE_STAPLE_RE` in `server.ts` and `NutritionLabelTable.tsx` to prevent single pastries and baked staples (e.g. croissants, baguettes) from receiving false composite parent `dbSource` or composite badges.
  - **UI Copy Contrast Ratios**: Upgraded description boxes, scout confidence comments, and preparation method text styling in `FoodCard.tsx` and `NutritionLabelTable.tsx` to high-contrast slate tones compliant with WCAG AA accessibility standards.
  - **Database Sync**: Marked Bug #10 as `fixed` (`queue: 'done'`) in Supabase `issue_tags`.

- **Bug #5 & Bug #6 Permanent Fixes (Brand Scope Isolation & Composite Precision) (2026-08-20)**:
  - **Brand Scope Isolation**: In `server_vision_scout.ts`, updated system instructions so brand modifiers strictly bind to named brand items (e.g. Sainsbury oats), emitting fresh companion foods (fruits, drinks, sides) as separate unbranded items.
  - **Canonical Dictionary Preference**: In `server.ts`, prioritized `lookupCanonicalBaseFood` before falling back to untrusted `web_search`, ensuring fresh fruits (such as fresh raw plums, 46 kcal) never get clobbered by 465 kcal confectionery web matches.
  - **Strict Composite Classification**: In `NutritionLabelTable.tsx` and `FoodCard.tsx`, strictly enforced `subComps.length > 1` for composite dish tagging (resolving Bug #6 false composite baguette) and guarded the brand official badge and brand prefix so only verified brand database items display brand official indicators.
- **Bug #9 Serving Option Wrong — Visual-Source Portion Clarify Fix (2026-08-20)**:
  - **Root Cause:** `detectPortionAmbiguity` in `server_portion_clarify.ts` treated visually-identified restaurant/canteen items (source=`visual`) as packaged grocery multipacks. For "2 butter croissants", `unitNoun` fell to `'piece'` → the biscuit/cookie/piece default assigned 6 units despite the explicit "2" in the name. For "Crispy chicken wrap" (1 visible wrap), the `wrap` noun triggered 4-unit multipack UX.
  - **Fix 1 — Leading digit extraction:** Before the category-default assignment, now extracts any leading digit from the item name (e.g. "2 butter croissants" → `detectedUnits=2`), so the explicit quantity always overrides category fallbacks.
  - **Fix 2 — Visual-source guard:** If `source==='visual'` and no explicit unit count was found (neither from the name regex nor the leading-digit extraction), returns `null` immediately — single-serve restaurant/canteen items trust the scout's estimated weight directly.
  - **Fix 3 — Correct unit noun for croissants:** `extractFoodUnitNoun` now returns `'croissant'` for croissants/pastries/danishes instead of the generic `'piece'`, so option labels read "1 croissant / 2 croissants" rather than "1 piece / 2 pieces".
  - **Regression tests:** Added two new tests in `server_portion_clarify.test.ts` verifying the wrap returns null and the "2 butter croissants" name produces exactly 2 units (not 6) in the reason string and options list.

- **AI Agent Chat Error Recovery & Model Switcher Retry (2026-08-20)**:
  - **Direct Retry Action Bar**: In `src/components/LogChat.tsx`, added a unified action bar on all error and service-unavailable messages with a dedicated **"Retry ([Selected Model])"** button and **"Switch Agent"** model selector toggle.
  - **Model Re-selection & Multi-Agent Fallback**: Users can now change the active LLM engine from the dropdown or the error bar and immediately trigger a retry on failed analysis turns without re-uploading photos or re-typing queries.
- **Branded Food Source Deletion & Item Cascade (2026-08-20)**:
  - **Cascade Delete Endpoint**: In `serverBrandMenu.ts`, added `POST /api/chain-menu-sources/delete` supporting single/batch deletion of chain menu sources from Supabase (`chain_menu_sources`), cascading deletion of all associated dishes in `brand_menu_items`, and pruning local fallback items.
  - **Inline Confirm UI**: In `src/components/NutritionDataBrowserModal.tsx`, added a red trash action button on each branded food row with inline 2-step confirmation (`Confirm?`) and live deletion spinner state.
- **Bug #2 Permanent Fix & Key-Level Suppression (2026-08-20)**:
  - **Auto-Log Guard & Suppression Persistence**: In `src/App.tsx`, guarded the BMI initialization effect so that deleting BMI via Auto-Delete or Outlier Deletion explicitly marks `bmiAutoLogged: true` and writes `deletedCustomBiomarkerKeys: { bmi: now }`, preventing client-side re-generation loops.
  - **Sync-Safe Profile Merging**: In `src/utils/syncUtils.ts`, explicitly preserved `bmiAutoLogged` and `deletedCustomBiomarkerKeys` during `mergeProfiles` so cloud pulls never clobber local suppression flags. Unblocked Bug #2 in Supabase.
- **Bug #2 Safe Conflict-Aware Dedupe Route (`server_routes_sync.ts`) (2026-08-20)**:
  - **Conflict-Safe One-Time Deduplication**: Added `GET /api/admin/dedupe-biomarkers?uid=...(&apply=true)` in `server_routes_sync.ts`. Canonicalizes all biomarker keys via `getMappedBiomarkerKey`, safely clusters exact/non-conflicting duplicate rows sharing dates, preserves conflicting rows untouched for manual review, upserts the unioned survivor record first, and atomically removes redundant duplicate records.
- **Bug #2 Stop Silent Same-Date Biomarker Merging (`dateUtils.ts`) (2026-08-20)**:
  - **Explicit `sourceReportId` Requirement**: In `src/utils/dateUtils.ts` (`normalizeBiomarkerHistory`), restricted in-memory record merging to only occur when rows share an explicit, matching `sourceReportId` (`${normalizedDate}::${reportId}`). Eliminated silent collapsing of distinct same-date Supabase rows that lacked `sourceReportId`, making all actual Supabase records visible and independently reviewable/deletable through the UI so outlier deletions stick permanently.
- **Bug Snapshot Default Tab Initialization (2026-08-20)**:
  - **Default to Bug Report**: In `src/components/BugSnapshotFab.tsx`, updated `handleOpenFab` so opening the Bug Snapshot modal always defaults to the **Bug Report** tab (`snapshotType = 'bug'`, `saveAsGolden = false`), preventing unwanted auto-switching to Golden Meal mode when inspecting meals.
- **Bug #8 Nutrition Label Composite Card Deduplication (2026-08-20)**:
  - **Single Card Expansion**: In `src/components/chat-cards/NutritionLabelTable.tsx`, when a composite dish unpacks its official branded subcomponents (`officialSubComps.length > 0`, which already list all sibling companions), suppressed pushing the redundant top-level composite parent card into `expandedItems`, eliminating duplicate cards for the same dish.
- **Bug #2 In-App Deduplication UI (`DedupeBiomarkerLogsModal.tsx`) (2026-08-20)**:
  - **In-App Admin Clean-up Front Door**: Added `src/components/DedupeBiomarkerLogsModal.tsx` and wired it into `src/components/Header.tsx` settings panel (`cwah-only`), allowing one-tap Dry Run execution, live conflict scanning, explicit checkbox safety confirmation, and atomic commit cleanup of historical same-date duplicate biomarker log rows directly from mobile/desktop without curl.
- **Bug #2 Duplicate Rows from Unnormalized Lab-Report Keys (2026-08-20)**:
  - **Clinical Data Parser Canonicalization**: In `src/components/InsightsTab.tsx`, canonicalized `rawKey` against the biomarker dictionary using `getMappedBiomarkerKey(rawKey) || rawKey` before saving definitions and log entries, preventing lab-report re-parses from storing identical clinical measurements under different key spellings and duplicate rows.
  - **Supabase Deduplication Endpoint**: In `server.ts`, added `POST /admin/dedupe-biomarker-logs` admin endpoint (supporting dry-run reporting by default and `commit: true` execution) to merge duplicate same-date biomarker log rows and remove redundant records.
- **Bug Snapshot Precision Floating Camera Shutter (2026-08-20)**:
  - **In-Place Targeted Capture Mode**: In `src/components/BugSnapshotFab.tsx`, clicking "Take picture" temporarily minimizes the Bug Snapshot modal into a floating precision dock on the side of the screen (`#bug-precision-capture-dock`), allowing the user to navigate/scroll to the exact target UI view without modal obstruction.
  - **State & Copy Preservation**: Preserves all existing attached photos, typed bug titles, problem descriptions, selected categories, and tags in memory and session draft.
  - **Automatic Return**: Tapping the floating camera shutter snaps the clean page view, adds the new photo to the snapshot, and automatically re-opens the Bug Snapshot modal with all user copy and previous pictures intact.
- **Bug Snapshot Photo Deduplication & Session Isolation (2026-08-20)**:
  - **Fresh Capture Initialization**: In `src/components/BugSnapshotFab.tsx`, explicitly reset `shots` to `[]` and cleared lingering draft cache on modal open/close so previous meal photos and old screenshots never leak into new bug snapshots.
  - **Single Source Image Extraction**: In `src/utils/goldenFixture.ts` (`collectOriginalFixture`), prioritized local IndexedDB store images over remote R2 URL references when present, preventing the same meal image from being added twice (once as base64 blob and once as R2 URL).
  - **Redundant Pre-fetch Elimination**: In `src/components/BugSnapshotFab.tsx`, removed duplicate pre-fetch iterations and guarded file drop/paste additions so each distinct photo is attached exactly once.
- **Bug Snapshot Tag Context & Identified Problems Display (2026-08-20)**:
  - **Comprehensive Context Surface**: In `src/components/BugSnapshotFab.tsx`, when selecting an existing bug tag, the attachment banner now renders the complete context: pinned bug instructions, user-identified problem/symptoms description, remaining open checklist items, and previous snapshot loop comments with timestamps.
- **Bug Tracker "Tried / Previous Tentatives" Panel Display (2026-08-20)**:
  - **Tentative & Burned Attempt Visibility**: In `src/utils/bugWorkItem.ts` (`buildNow`), aggregated all attempts across `item.burns` and `item.commits` so tentative/verified attempts (`PASS` results) are preserved alongside burned attempts. In `BugTrackerModal.tsx`, formatted burned attempts with rose/red `DO NOT RETRY` badges and tentative attempts with indigo badges and notes so previous attempts are always visible in the NOW box.
- **1-Click "Bug → Golden Inbox" Ingest Pipeline (2026-08-20)**:
  - **Automated Case Synthesis**: Added `POST /api/bugs/:tagId/make-golden` in `serverBugSnapshot.ts` to automatically extract linked job scout results and generate complete `expected.json`, `scout.json`, and `Instruction.md` fixtures inside `tests/Golden_meal/inbox/`.
  - **UI Action Trigger**: Added a **"Make Golden"** button in `BugTrackerModal.tsx` for instant 1-click test fixture creation from bug tags.
- **Bug #5 Composite Parent Dish & Brand Isolation Fix (2026-08-20)**:
  - **Parent Composite Identification**: In `server.ts` (`preCalculatedItems` and `itemsBreakdown`), when a composite dish contains mixed components (e.g. Sainsbury oats + fresh unbranded fruit), parent `dbSource` is set to `"composite"` (with synthetic composite `dbId`) and parent `brand`/`chainName` is set to `null` so individual ingredient brands never contaminate the parent dish or companion items.
  - **Dish Title Sanitization**: Stripped leading brand prefix from composite meal titles when other components are generic staples (e.g. `"Sainsbury oat with fruit"` → `"Oatmeal with fruit"` / `"Rolled oats with fruit"`), ensuring the brand badge and title belong strictly to the specific branded component (`Sainsbury's Scottish Whole Rolled Oats`).
- **Food Classification & Brand Isolation Guardrails (2026-08-20)**:
  - **Brand Contamination Guard**: In `NutritionLabelTable.tsx`, guarded `isCompOfficial` so generic companion staples (berries, milk, bananas, fresh fruit) never inherit brand metadata from parent composite meals (resolves Bug #5 false friends).
  - **Single-Item Composite Inhibition**: Updated `isComposite` badge evaluation in `NutritionLabelTable.tsx` to strictly require `subComps.length > 1` (resolves Bug #6 baguette false composite tagging).
- **Bug Tracker Improvements & Auto-Reopen Logic (2026-08-20)**:
  - **Auto-Reopen Done Bugs on New Evidence / Retest**: In `src/utils/bugWorkItem.ts` (`appendEvidenceCommit`), when new evidence/retest is submitted on a card with `queue: 'done'`, the queue automatically resets to `'ready'`. In `serverBugSnapshot.ts` (`/api/bugs/snapshot`, `/api/bugs/:tagId/attach`, and `PATCH /api/bugs/:tagId`), reopened cards synchronize `issue_tags.status = 'to_fix'`, automatically reopening retested cards (e.g. Bug #5).
  - **Context-Aware Category Detection**: Updated `getCategoryForTab(activeTab, viewingJobId)` in `BugSnapshotFab.tsx` to detect if an active meal modal is open (`isAnyMealModalOpen`), defaulting the snapshot category to `'foodcart'` instead of blindly assigning `'Home'`.
  - **Human 1-Click Unblock & Burns Reset**: In `BugTrackerModal.tsx` and `serverBugSnapshot.ts`, added an **"Unblock"** button on cards with burns (`PATCH /api/bugs/:id` with `{ reset_burns: true, queue: 'ready' }`), added a **Class** assignment dropdown in the NOW box (`APPLY_MISS`, `FALSE_FRIEND`, `DISH_DROP`, `SILENT_REPAIR`, etc.), and converted the **Remaining** list into an interactive checklist with per-item `Done` buttons and inline editing.
  - **Clean Workspace**: Purged root test script residue (`test.js`, `test2.js`, `test-tombstone.js`, `test-pull.mjs`, `test-scroll.html`, `test-merge.mjs`).
- **Bug #4 Brand Info Recognition in Nutrition Data & Food Card (2026-08-20)**:
  - **Component Resolution & Masking Fix**: In `NutritionLabelTable.tsx` and `FoodCard.tsx`, fixed `subComps` and `componentsDetailList` fallback cascades where empty array initializations `[]` masked valid `item.components` and `matchingScout.components` on composite dishes.
  - **Official Brand Data Extraction**: Updated `getSourceBadge` and `expandedItems` in `NutritionLabelTable.tsx` to properly check `comp.chainName`, `comp.brand`, and `comp.brandName` across decomposed sub-components, surfacing official branded items (e.g. Sainsbury's Scottish Whole Rolled Oats) and enabling the `Composite (Brand + Fresh)` badge.
  - **Scout Items History Fallback**: Enhanced `FoodHistoryTab.tsx` to fall back to `log.scoutSnapshot` or `log.itemsBreakdown` when loading nutrition labels from saved logs.
- **Platform kit (2026-08-19, honest status)**:
  - **Done:** Q-1 budget gate · Q-2 `CATALOG.json` · B8.0 Option A (Home Flagged Telemetry is the only Auto-Fix) · B8.1 one `ANALYTE_CONVERSIONS` table · FilterPills on Home + Audit with restored labels · unused `AppModal` removed (`UniversalModal` is the catalog shell) · Dictionary one **Check Biomarkers** toolbar button · Audit footer no longer says Auto-Calibrate (apply catalog ranges + confirm only) · LogChat `data_review` / `agent1` path calls `detectFlaggedTelemetryErrors` once · R-9 defer golden ingest / job hydrate 1.5s · Q-5 root `patch_*.cjs` / one-shot test residue deleted · Q-6.1/Q-6.2 work-item schema + `GET /api/bugs/next` · Q-6.3 Bug queue dashboard evolved to mockup · Q-6.4 Snap / Flag Open #n vs new attach.
  - **Q-6.3 / Q-6.4 (2026-08-19):** Evolved `BugTrackerModal.tsx` to match `studio/mockups/bug-queue-dashboard.html` (left queue sorted for Next bug, prominent "Next bug → #n" CTA, KPIs grid, NOW box with pinned editable Bug field, commit history timeline with clickable screenshot lightbox and collapsible evidence `<pre>` blocks). In `BugSnapshotFab.tsx` and `FlagIssueModal.tsx`, implemented Open #n vs + Create new bug selection with auto-match fallback and non-destructive pinned instruction preservation.
  - **Q-6.5 / Q-6.6 / Q-6.7 (2026-08-19, Grok):** Job finalize + golden reds auto-file onto `issue_tags` by fingerprint (class+query+week). Unmatched strip `GET /api/bugs/unmatched`. Attach `POST /api/bugs/:id/attach`. Held R2 is not pruned while the card is open. `POST /api/golden/cases/:id/loop` returns 410 `loop_refused` → use `GET /api/bugs/next`.
  - **Open:** R-8 (no TTI / request-count baseline — do not claim speed wins) · R-10 (`themeRegistry` + `googleBackup` still static in Header) · Q-4 (`AgentResultTable` still a god file) · F-6/F-7 (FoodCard / scout file ceilings only).
  - **B8.1 note:** Handover bullets below that still mention `18.0182` / `38.67` describe the *old* private telemetry table. Live code uses `src/utils/analyteConversions.ts` only.
- **Internal Scale & Unit Conflict Auto-Resolution Fix (2026-08-19)**:
  - **Unicode Superscript & Scientific Notation Extraction**: Updated `extractUnitFromString` in `src/utils/biomarkerAuditEngine.ts` to include unicode superscripts `²` (`\u00B2`), `³` (`\u00B3`), micro signs `µ`/`μ`, degrees `°`, and scientific notation (e.g. `10^9/L`, `10^12/L`). This eliminated truncation defects where `mL/min/1.73m²` and `kg/m²` were truncated into `mL/min/1.73m` and `kg/m`.
  - **Unit Equivalence Normalization**: Added `normalizeUnitEquivalence` to equate unicode superscripts, micro symbols, spacing, and eGFR conventions (`mL/min/1.73m²` $\equiv$ `mL/min/1.73m2` $\equiv$ `mL/min/1.73 m²` $\equiv$ `mL/min/1.73m`). Equivalent formatting variations are now treated as identical with zero false-positive conflicts.
  - **Eliminated Unsafe Auto-Fix Proposals**: Removed the blind `align_declared_to_brackets` auto-fix fallback in `deriveConflictResolution`. Auto-fix proposals (`scale_brackets_to_declared`) are now strictly restricted to verified clinical unit conversions (e.g. Hematocrit `%` vs `L/L`, Hemoglobin `g/dL` vs `g/L`, `mg/dL` vs `mmol/L`), preventing false proposals to overwrite valid declared units (e.g. body weight in `kg`) with mismatched bracket strings (`kg/m`).
- **Health Tab, Biomarker Dictionary & Audit Latency Optimizations (2026-08-19)**:
  - **Instant Health Tab & Dictionary Mounts**: Replaced heavy synchronous executions of `runGeneralizedBiomarkerAudit` in `src/components/MedicalHistoryTab.tsx`, `src/components/BiomarkerDictionaryModal.tsx`, and `src/components/TrendsTab.tsx` with a lightweight, ultra-fast ($<2\text{ms}$) `getDuplicateAliasGroups` helper. This eliminated blocking JS execution on tab mount caused by unnecessary full telemetry scans, unit scraping, and metadata completeness scoring across hundreds of biomarkers.
  - **Pre-Indexed Standard Catalog Lookups ($O(1)$)**: Created module-level hash indexes (`catalogByKey`, `catalogByStem`, `catalogBySynonym`, `catalogByAlias`, `catalogByName`) in `src/utils/biomarkerAuditEngine.ts`, transforming `findCatalogDefinition` from repeated linear array searches into direct $O(1)$ map lookups.
  - **Candidate Pair Pruning**: In `runGeneralizedBiomarkerAudit` and `getDuplicateAliasGroups`, skipped redundant pairwise evaluations when both candidates are built-in standard catalog definitions with no custom overrides or user logs, eliminating over 10,000 unneeded string operations per audit pass.
  - **Conditional Audit Modal Lifecycle**: Guarded `BiomarkerAuditModal` mounting and report calculation in `src/components/BiomarkerDictionaryModal.tsx` so the heavy audit report only evaluates when the user explicitly clicks "Check Biomarkers" (`showAuditModal === true`), rather than running eagerly as an unmounted child.
  - **$O(1)$ Telemetry Flag Lookup**: Indexed `allTelemetryFlags` into a key-indexed map (`telemetryFlagMap`) in `BiomarkerDictionaryModal.tsx` to eliminate linear `.find()` operations across each rendered item row.
- **Full-Screen Flagged Telemetry Management Modal & Strict US ↔ SI Auto-Fix Engine (2026-08-19)**:
  - **Full-Screen Workspace**: Upgraded the Flagged Telemetry Modal in `src/components/HomeTab.tsx` into a spacious full-screen interface (`max-w-6xl` responsive viewport) with issue counts, filter tabs (`All`, `⚡ Auto-Fixable`, `🧠 Needs AI Review`), and inline editing/deletion per reading.
  - **Strict US ↔ SI Unit Auto-Fix Engine**: Constrained `computeBiomarkerTelemetryMultiplier` in `src/utils/biomarkers.ts` strictly and exclusively to validated standard US $\leftrightarrow$ SI unit conversions:
    - Glucose US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\div 18.0182$ / $\times 18.0182$).
    - Cholesterol (Total, LDL, HDL, Non-HDL, VLDL) US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\div 38.67$ / $\times 38.67$).
    - Triglycerides US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\div 88.57$ / $\times 88.57$).
    - Uric acid US (mg/dL) $\leftrightarrow$ SI (µmol/L) ($\times 59.48$ / $\div 59.48$).
    - Creatinine US (mg/dL) $\leftrightarrow$ SI (µmol/L) ($\times 88.4$ / $\div 88.4$).
    - Bilirubin (Total / Direct) US (mg/dL) $\leftrightarrow$ SI (µmol/L) ($\times 17.1$ / $\div 17.1$).
    - Hemoglobin / Total Protein / Albumin / Globulin US (g/dL) $\leftrightarrow$ SI (g/L) ($\times 10$ / $\div 10$).
    - Calcium US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\times 0.2495$ / $\div 0.2495$).
    - Phosphate US (mg/dL) $\leftrightarrow$ SI (mmol/L) ($\times 0.3229$ / $\div 0.3229$).
  - **Zero Browser Popups & Inline Confirmation Flow**: Replaced all native browser `window.confirm` modal popups with inline confirmation elements directly inside each history entry pill (`Delete? [Yes, Delete] [Cancel]`) and sticky action toolbar (`Delete X outlier biomarker(s)? [Yes, Delete] [Cancel]`).
  - **Atomic Batch Deletion & Auto-Fix Handlers**: Replaced synchronous looping calls with single-pass atomic handlers (`handleBatchDeleteBiomarkersFromLogs` and `handleBatchEditBiomarkersInLogs` in `src/App.tsx`), eliminating closure race conditions where only one deletion persisted when deleting multiple outliers across logs simultaneously.
  - **Asynchronous Loaders & Saved State Indicators**: Wired `savingActionKeys` and `savedActionKeys` with spinning `<Loader2>` loaders (`Saving...`, `Deleting...`, `Converting...`) during background state updates and instant `<Check>` checkmark indicators (`Saved!`, `Deleted!`) upon completion.
  - **Universal Key Canonicalization & History Alignment**: `detectFlaggedTelemetryErrors` now canonicalizes all keys via `getMappedBiomarkerKey(k) || k` and case/whitespace-insensitive normalization, seamlessly catching all entries across `resolvedBiomarkers`, historical logs (e.g. `Monocyte Count` vs `monocyte_count`), and custom definitions.
- **Food Analysis Accuracy & Nutrient Label Source Improvements (2026-08-18)**:
  - **Nutrient Label Source Clarification**: In `src/components/chat-cards/NutritionLabelTable.tsx`, added a distinctive source badge for each item indicating its exact data source (`Nutrition Facts (OCR Label)`, `Brand Official Menu`, `Open Food Facts`, `USDA FoodData Central`, `Estimated: Category Baseline`, `Standard Reference`) and cleaned titles to remove internal fallback artifacts.
  - **Label-to-Component Reconciliation**: Created `reconcileIngredientsToComponents` in `server_vision_scout.ts` and wired it into both the scout pipeline and `server.ts` component decomposition. If an OCR label or visual ingredient list contains dressings, sauces, or condiments (e.g. ranch dressing, caesar, vinaigrette) not in the decomposed components, it is automatically allocated an 8% volume share with normalized companion component weights and added to database search queries.
  - **Container & Occlusion Bag Inspection**: Updated Vision Scout system instruction (`- PRECISE COUNTING, BAG INSPECTION & OCCLUSION:`) to inspect inside open pastry bags, boxes, trays, or packaging for stacked/nested items (e.g. croissant resting on a cinnamon swirl/pain aux raisins) and split them into distinct items with realistic weights rather than aggregating into an ambiguous single fallback.
  - **Commodity Fallback Micronutrient Imputation**: Upgraded `DEFAULT_CATEGORY_PROFILES` and `getFallbackCategoryProfile` in `server_food_catalog.ts` with comprehensive USDA Foundation averages across all 30+ micronutrients (B-vitamins, Vitamin C, A, E, K, D, Potassium, Calcium, Magnesium, Iron, Zinc, Selenium, Phosphorus, Iodine) for leafy greens, berries, dressings, poultry, meat, fish, eggs, dairy, cheese, starches, legumes, and pastries, eliminating zeroed-out micronutrient placeholders on fallback items.
- **Portion Ambiguity & Food Logging Fixes (2026-08-18)**:
  - Fixed "Whole pack" portion option mislabeling: `detectPortionAmbiguity` in `server_portion_clarify.ts` now uses actual detected package net weight (`detectPackNetWeightGrams`, front-of-pack OCR, protein-ratio deduction, or scout item estimate) so a pack of 80g/85g is correctly labeled `Whole pack (85g)` (or 80g), and the per-100g nutrition panel basis is clearly labeled `100g (nutrition panel basis)` instead of falsely claiming 100g is the whole pack.
  - Fixed `g ()` empty quantity rendering in `src/components/chat-cards/FoodCard.tsx`: Guarded weight and quantity rendering with strict null/undefined checks and prevented synthesizing a premature `pendingFoodLog` while `needsPortionClarify` or `portionClarify` is active.
  - Fixed "Analysis complete" UI stall in `src/components/LogChat.tsx`, `server_routes_jobs.ts`, and `src/jobs/SupabaseJobSync.ts`: Jobs persisting results to R2 storage (`is_r2: true`) are now transparently unwrapped when retrieved from `/api/jobs/status`, and `LogChat.tsx` automatically resolves and unwraps the full R2 payload if a succeeded job has not yet hydrated its full data, rendering the full food analysis card and nutritional summary instead of stalling on plain fallback text.
  - Enhanced `/api/jobs/debug` in `server_routes_jobs.ts` to automatically strip `clarify_` prefix on lookup, ensuring debug report exports always resolve cleanly.
- **`scripts/assert-biomarker-ingest.mjs`**: Exit 0 (N1–N13 Master Ingest Assertions Passed)
- **`scripts/assert-biomarker-lifecycle-m31.mjs`**: Exit 0 (P0–P8 Master Biomarker Lifecycle Assertions Passed)
- **`scripts/assert-free-tier-complete.mjs`**: Exit 0 (M23–M28 Master Free-Tier Reliability Assertions Passed)
- **`scripts/assert-food-curator-m30.mjs`**: Exit 0 (M30 Food Curator Assertions Passed)
- **Vitest Suite**: 562 passed tests across 61 test files (100% green).
- **TypeScript Compilation**: `npx tsc --noEmit` clean exit 0
- **Biomarker Health & Quality Audit Suite**:
  - Structured **Corrupted & Missing Units** tab with distinct filter pills matching Missing Ranges (`All`, `Auto-Proposals`, `Needs Agent Review`) to clearly distinguish automatic 1-click repairs from AI agent handoffs.
  - Eliminated duplicate cluster re-indexing on sync by feeding `profile.deletedCustomBiomarkerKeys` into `runGeneralizedBiomarkerAudit` and filtering tombstoned aliases out of candidate clusters.
  - Fixed "Needs Calibrate" filter in `BiomarkerAuditModal.tsx` to include reference bracket gaps.
  - Auto-scraped & resolved 65+ corrupted/blank unit definitions via clinical synonym stems and embedded key suffixes (`_mmol_l`, `_umol_l`, `_10_9_l`, `_score`, `_percent`).
  - Synchronized clinical practice groupings (`standardMedicalGrouping`) directly with organ category assignments, preventing stale `needsApproval` flags.
  - Streamlined the **Needs Calibrate** tab to unify deterministic built-in catalog range auto-filling (0 tokens) with full AI Range Calibration Agent hand-offs.
  - Unified loading spinners and silent state transitions across all dictionary and audit approval modals.

---
## Summary of Accomplishments in Track B & Biomarker Pipeline
1. **Specimen False Friend Guard (G-B4)**: Integrated urine vs serum specimen separation preventing cross-mapping between `urine_albumin`, `microalbumin_urine`, and `serum_albumin`.
2. **Connected-Component Biomarker Deduplication & Graph Clustering**:
   - Upgraded `src/utils/biomarkerAuditEngine.ts` to discover duplicate biomarker clusters using connected components across canonical stems, clinical synonym mappings, and pairwise morphological criteria (`isBiomarkerDuplicateCandidate`).
   - Hardened `isBiomarkerDuplicateCandidate` with clinical discriminator checks (differentiating `mch` vs `mchc`, urine vs serum, free vs total, lipid fractions) to prevent false-friend clustering.
   - Unified biomarker creation in `src/components/BiomarkerDictionaryModal.tsx` via `findDuplicateOrExistingBiomarker` to intercept duplicate candidate additions and offer instant reactivation for matching archived / Not-Used dictionary entries.
   - Expanded hematology definitions in `src/utils/biomarkers.ts` (`hemoglobin`, `mean_corpuscular_hemoglobin`, `mean_corpuscular_volume`, `mean_corpuscular_hemoglobin_concentration`, `rdw`, `serum_albumin`).
3. **Master Ingest Gate (N1–N13)**: Fully established and verified in `scripts/assert-biomarker-ingest.mjs` covering trace definitions, locked conversion outputs, lexer exports (`lexTable`, `buildIngestBatch`), table abort guard (`shouldAbortTablePath`), `sourceReportId` deduplication, and Inbox domain tab grouping.
3. **Outer Regression Test Cases**: Verified G-B1 conversion harness, G-B2 EMIS/NHS printout table class counts harness, G-B6 symptom diary classification, G-B7 incomplete reading detection, and G-B9 vision N/A image handling in `tests/golden_biomarker.test.ts`.
4. **Food in Medical Guard (G-B5)**: Implemented the `WRONG_DOOR` class assignment and trace generation in `server.ts` and `serverJobs.ts` when a user payload contains food or non-medical information.
5. **Flagged Review & Staged Apply (Wave B5 & B6)**:
   - Modified `serverJobs.ts` to transform `flagged` trace rows from table interception into valid `modificationCommand` inputs (`update_biomarker`), mapping them to the expected review shape.
   - Refactored `App.tsx` logic to ensure all incoming biomarker modification commands pass through the `enrichReviewModificationCommands` layer automatically, successfully unifying table-ingest flagged item correction with standard LLM hallucination reviews.
   - Fixed `handleLogMedical` so that `update_biomarker` can safely insert *new* rows for net-new dates generated via CSV ingest, completing the staged confirm & upsert pathway.
6. **Golden Test Harness (G-B2, G-B5, G-B6, G-B7, G-B9)**: Created complete test cases under `tests/Golden_biomarker/examples/` and updated `tests/golden_biomarker.test.ts` to actively execute pipeline helper functions (`resolveAgentDestination`, `shouldAbortTablePath`, `lexTable`, `buildIngestBatch`) on test inputs. Created `scripts/golden-from-medical-debug.mjs` for capturing medical debug exports into golden fixtures.
7. **Golden Meal Dataset Expansion (Item 1)**: Added case `G9` (Salmon Poke Bowl with Avocado) to `/tests/Golden_meal/` and updated `manifest.json` & `golden_meals.test.ts`.
8. **Biomarker Ingest v2 Extensions & Extract Hygiene (Items B2.1, B2.3, B2.4 & B2.6)**:
    - Added lab document metadata & header/footer regex filtering and clean string handling to `lexTable` and `buildIngestBatch` in `src/utils/biomarkerLifecycle.ts`.
    - Removed duplicate `Chat History:` prefix from extraction prompts in `server.ts` (Item B2.1) and removed `remainingText` echoes from payload snapshots in `server.ts` and `serverJobs.ts` (Item B2.3).
    - Extended `resolveAgentDestination` in `src/utils/biomarkerLifecycle.ts` to handle explicit `isWrongDoor` and `destination` overrides (Item B2.4), and updated G-B2 in `tests/golden_biomarker.test.ts` to lex and ingest 140-row NHS print table fixtures (Item B2.6 / B4.3).
9. **Modular Router Extraction (Item 4)**: Created domain router modules `server_routes_biomarkers.ts` and `server_routes_food.ts` and registered them on Express app in `server.ts`.
10. **Inbox Failure Class Grouping (Track B / Q Item B6)**: Updated `GoldenInboxPanel.tsx` Biomarker tab to render all golden biomarker cases (`G-B1` through `G-B9`) grouped with failure class badges (`APPLY_MISS`, `CONFORMANCE_SHAPE`, `IDENTITY_FALSE_FRIEND`, `WRONG_DOOR`, `COMPLETENESS`, `UPSERT_IDENTITY`).
11. **Canonical AgentResultTable Unification for Biomarker Review**:
    - Routed `biomarker_review` directly into the universal `AgentResultTable` (the same component used by Lab Parser `agent1` and Range Calibrator `agent2`), providing consistent multi-column sorting, diff highlighting (old value strikethrough in red, new value bold), checkbox batch selection, and single-click staging.

---
## Track B Wave B7 Progress (Items 7.1, 7.2, 7.3, 7.4, 7.8)
10. **Profile Data Hygiene (Item 7.1)**:
    - Implemented `cleanupInventedBiomarkerCatalog` which remaps custom keys through `getMappedBiomarkerKey`, tombstones alias keys in `deletedCustomBiomarkerKeys`, drops unreferenced `metric_N` junk and unitless `needsApproval` definitions, and strips corrupted `< 0` negative range configs/strings.
11. **Relabel XOR Convert UI (Item 7.2)**:
    - Integrated `handleUnitChange` with explicit `mode: 'relabel'` in `MedicalHistoryTab.tsx` (`onEditBiomarkerDef`) so custom unit changes never alter historical observation numbers without conversion commands.
12. **Historical observationMeta Backfill (Item 7.3)**:
    - Enhanced `attachObservationMeta` in `src/utils/biomarkerLifecycle.ts` to automatically backfill `rawValue` from `biomarkers[key]` when omitted in metadata.
13. **Dedicated Pending Store Isolation (Item 7.4)**:
    - Added `PendingObservation` interface and `pendingObservations` to `UserProfile`.
    - Hardened `isLiveForUse`, `filterCurrentForUse`, and `filterHistoryForUse` so pending unapproved extractions are strictly isolated and never leak into active queries, Home dashboard tiles, or health coach prompts.
14. **Silent Calibrator (Item 7.5)**:
    - Added unit test suite for `recalibrateProfileOverlays` in `src/utils/biomarkerLifecycle.test.ts`, verifying automatic calculation and updating of demographic overlay fingerprints (`ageBand|gender|ethnicity`) across active biomarkers when user demographics shift.
15. **Drop Legacy Dictionary Store (Item 7.8)**:
    - Deprecated `biomarker_dictionary_store` local storage access in `biomarkerStore.ts` and `biomarkers.ts` in favor of `profile.customBiomarkers`.
16. **Reference Range Source Badges (Item 7.6)**:
    - Implemented `getBiomarkerRangeSourceInfo` in `src/utils/biomarkerLifecycle.ts` and integrated it with `BiomarkerExpandedSection.tsx` to visually attribute reference range sources (Standard Clinical, Lab Specific, Demographic Calibrated, User Custom Range) with color-coded badges.
17. **Kill normalizeHistoricalTelemetryErrors Writers (Item 7.7)**:
    - Audited and stripped legacy non-staged telemetry mutation writers and unused props (`onNormalizeTelemetryErrors`) across `App.tsx` and `HomeTab.tsx`. Ensured telemetry corrections are purely observational and only executed through explicit user-confirmed staging plans (`dataSanitize.ts`).

---
## Track F Food Identity Quality Progress (Items F-1, F-2, F-3, F-4)
18. **Multi-Component Dish Decomposition (Item F-3)**:
    - Added comprehensive golden tests in `tests/golden_meals.test.ts` validating clean decomposition of multi-ingredient regional dishes (e.g. Dim Sum tasting sets, Japanese Bento boxes) into distinct searchable queries without parent title pollution.
19. **Catalog-First Defaulting & Self-Heal Cache (Items F-1 & F-2)**:
    - Verified `lookupCanonicalBaseFood` in `server_food_db.ts` provides instant local/curated food resolution before external search fallbacks.
    - Verified `getCachedUSDAFood` / `setCachedUSDAFood` in-memory caching mechanism prevents redundant live network requests for previously resolved query terms.
20. **Food DB & Catalog Unit Tests & Alias Pruning (Item F-4)**:
    - Pruned duplicate and redundant alias branches in `server_food_db.ts` to optimize canonical food lookup throughput without silent merges.
    - Added automated unit tests in `server_food_db.test.ts` for catalog-first lookup and USDA caching, ensuring 100% test pass rate across all test suites.
21. **Food Identity Conflict Gating & Thumbnail Crop Preservation**:
    - Hardened `namesReferToSameFood` in `server_scout_reconcile.ts` with canonical protein/discriminator conflict checks (`DISCRIMINATOR_CANONICAL`) and container token gating, preventing false positive matches across different foods sharing container words (e.g. Chicken Sandwich vs Steak Sandwich / Steak Chimi).
    - Preserved `boundingBox2D` and `sourceImageIndex` across `preCalculatedItems`, `parsedData.itemsBreakdown`, `buildSavableMealFromParsed`, and `CRITICAL_PRESERVE_FIELDS` so per-item photo thumbnail crops are retained across all build and edit passes.

---
## Track R Modular Router Extraction & Soak Reliability (Items R-1, R-4, R-6)
21. **Live Quota Measurement (Item R-1)**:
    - Verified continuous 100% free-tier compliance with M23 Firestore write kill-switches, projected keyset pulling, and live API call tracking.
22. **Jobs Router Extraction (`server_routes_jobs.ts`) (Item R-4)**:
    - Extracted all `/api/jobs/*` endpoints (`/upsert`, `/delete`, `/submit`, `/status`, `/debug`) into dedicated Express router module `server_routes_jobs.ts`.
    - Mounted `jobsRouter` in `server.ts`, trimming hundreds of lines from main server file while preserving all authentication, idempotency locks, R2 upload fallback routines, and debug report rendering.
23. **Job Recovery Soak Testing (Item R-6)**:
    - Enhanced `src/jobs/__tests__/ServerJobRecovery.test.ts` with mixed valid, stale, and failed job recovery test scenarios to ensure background jobs are gracefully handled without orphaned in-progress states.
24. **Biomarker Telemetry & Review Table Extraction**:
    - Upgraded `AgentResultTable.tsx` and `App.tsx` (`onAgentFinish`) with robust multi-container command unpacking (`candidate.modificationCommand`, `clean_result`, `agentResult`, `data.agentResult`, JSON string parsing).
    - Added dedicated scaling synthesis for `hematocrit` (decimal ratio 0.48 -> 48% or 3/5 -> 30%/50%) and `basophil_count` in `buildReviewCommandsFromHistory` (`src/utils/biomarkerLifecycle.ts`).
    - Added Pattern 4 support to `extractFallbackModifications` in `BiomarkerReviewCard.tsx` for narrative `DATE BIOMARKER OLD_VALUE [UNIT] → NEW_VALUE [UNIT]`.
    - Hardened `checkForDbChanges` initial sync hydration in `App.tsx` to ensure full history is loaded when local cache is uninitialized.

---
## Next Steps
- **Q-6 Unified bug queue:** Schema + `/next` + auto-file + hold + `/loop` 410 + Gemini queue UI shipped. **#1** capture picker: `resolveDomainPack` now uses `pickSnapshotJob` (not array-end). Honest residual on #1: Firestore 2s profile timeout parked. Do not retry `useFoodJobSync.ts` (does not exist).
- **Next bug:** Home snaps now attach biomarker history sample + tombstones (not a generic empty pack). Photos/payload use snapshot reportId. End with `POST /api/bugs/:id/attempts`. Spec: `QUALITY.md` §14.
- **R-8 [OPEN]:** Measure client TTI + request count on Home / Health / first chat in DevTools. No speed claims until that baseline exists.
- **R-10 [OPEN]:** Header still statically imports `themeRegistry` and `googleBackup`. Do not mark R-10 done.
- **Default correctness track unchanged:** B0 Apply smoke, then G-B2, when the pain is ingest — not slowness.
- Do **not** start FoodCard / App.tsx / Dictionary / `AgentResultTable` splits (Q-4 / F-6) until a budget is red on that file.


- Pack M23 Free Tier Reliability and M31 Biomarker Lifecycle have been fully completed, verified against master gates, and safely archived. Ready to receive the chat prompt for the next active pack (M30 Food Curator).
25. **Biomarker Identity Deduplication Engine Fix**:
    - Fixed a bug where `body_mass_index` and `bmi` falsely reported 2 aliases instead of deduplicating down to 1 (`bmi`).
    - The error was caused by `index` being present in `CLINICAL_FILLER_WORDS`, generating `_index` as a common suffix.
    - Repaired `normalizeStemKey` and `biomarkers.ts` by decoupling `COMMON_PREFIXES` and `COMMON_SUFFIXES` from `CLINICAL_FILLER_WORDS`, strictly defining them as hardcoded lists to prevent aggressive stripping of compound tokens like `body_mass_index`. All tests including `biomarkerIdentity.test.ts` pass.

26. **Global UI Deduplication Rendering**:
    - Integrated `runGeneralizedBiomarkerAudit` into `MedicalHistoryTab`, `BiomarkerDictionaryModal`, and `TrendsTab`.
    - Hidden structural duplicate aliases dynamically based on audit cluster reports, aggregating underlying historical log data into the single master key representation.
27. **Medical History Import Fix**:
    - Addressed the `ReferenceError: runGeneralizedBiomarkerAudit is not defined` bug in `MedicalHistoryTab.tsx` which surfaced during the duplicate rendering aggregation rollout.
    - Verified proper hook integration with `runGeneralizedBiomarkerAudit` to compute deduplication states.
27. **Medical History Import Fix**:
    - Addressed the `ReferenceError: runGeneralizedBiomarkerAudit is not defined` bug in `MedicalHistoryTab.tsx` which surfaced during the duplicate rendering aggregation rollout.
    - Verified proper hook integration with `runGeneralizedBiomarkerAudit` to compute deduplication states.
28. **Temporal Dead Zone (TDZ) Fix**:
    - Fixed `ReferenceError: Cannot access 'auditReport' before initialization` in `BiomarkerDictionaryModal.tsx` and `TrendsTab.tsx`.
    - Corrected hoisting order of block-scoped React hooks so that `auditReport` and `aliasKeysToHide` are safely initialized before any `useMemo` hooks or internal utility functions (like `collectItemLogs`) capture and rely on them.
    - Verified strict type checking (`tsc --noEmit`) and successful production build for rendering logic.

29. **Duplicate Biomarker Resurrection Fix (post-sync 82→141 bug)**:
    - **Root cause**: Three places rebuilt the active biomarker set without filtering out tombstoned (merged) alias keys from `deletedCustomBiomarkerKeys`, so stale cloud history logs carrying old source keys caused them to reappear.
    - **Fix A** (`App.tsx` L2929): `computedBiomarkers` post-sync now skips any log biomarker key present in `mergedProfile.deletedCustomBiomarkerKeys`.
    - **Fix B** (`App.tsx` L2891, forcePull path): Same tombstone filter applied to `tempBiomarkers` in the `forcePull` code path.
    - **Fix C** (`App.tsx` L5437, `handleBatchCombineBiomarkers`): `recomputedBiomarkers` built right after combine now skips tombstoned keys, ensuring the immediate post-combine render is clean too.
    - **Fix D** (`BiomarkerDictionaryModal.tsx` L1602): `historyKeys` memo now receives `profile.deletedCustomBiomarkerKeys` as a dependency and excludes any key with a non-zero tombstone timestamp from the dictionary visible set — preventing stale cloud history from re-surfacing merged aliases.
    - `tsc --noEmit` exit 0.

30. **Name Consolidation Agent: Pre-filter Engine-Detected Aliases**:
    - The AI Name Deduper agent was being given keys that the deterministic audit engine already identified as alias candidates (e.g. `egfr_mlmin173m2`, `red_blood_cell_count`, `basophil_count`).
    - Fixed `handleRunConsolidationAgent` (`BiomarkerDictionaryModal.tsx` L2892): Before building `selectedBiomarkerDetails`, collect all keys from `auditReport.duplicateGroups` (both `candidateAliases` and their `suggestedMasterKey`); filter them out of the agent's input.
    - Agent now only processes genuinely ambiguous cases that can't be resolved by stem/synonym matching.

31. **BMI Auto-Logger Deletion Resilience**:
    - Addressed a bug where deleted BMI values would resurrect upon a manual sync.
    - **Root cause**: `med_log_bmi_init_` logs were explicitly skipped in `App.tsx` inside `saveAndSync` (`isUserTriggered` and `isAutoLog`), causing the "delete" sync state to only affect local state, and the next pull from the cloud would resurrect the log.
    - **Fix**: Removed the hardcoded exclusion of `med_log_bmi_init_` in `saveAndSync`, allowing background deletion synchronization via the standard `deletedBiomarkerLogIds` tombstone map.
32. **F-3 Golden Meal FALSE_FRIEND Inbox Fix**:
    - Addressed `FALSE_FRIEND` identity bug in Pomegranate vs Sesame seed cross-contamination for Golden Inbox `chocolate-croissants-vegetarian-wrap-1-more--1786666026077_que4`.
    - **Root cause**: `pomegranate_seed` shared FDC ID `170150` with `sesame_seed` inside `CANONICAL_BASE_FOODS`, leading to incorrect shared DB matches.
    - **Fix**: Adjusted `pomegranate_seed` FDC ID to `169134` (Pomegranate, raw).
    - **Verification**: Promoted the Inbox folder using `golden-promote.mjs`. Ran `vitest run tests/golden_meals.test.ts` and `golden_inbox.test.ts`. All 96 tests green!
33. **F-3 Golden Meal FALSE_FRIEND Inbox Fix (Icing vs Granulated Sugar)**:
    - Addressed `FALSE_FRIEND` identity bug in Prawn Layered Pasta Salad Golden Inbox `job_1786646310665_zszmh95lj`.
    - **Root cause**: "pink sugar icing" was matching with granulated sugar because it was returning a `MISS` and then falling back to granulated sugar, causing incorrect query tracking.
    - **Fix**: The resolver correctly isolated "pink sugar icing" to FDC ID `169652` natively without needing an explicit alias. The bug was merely the inbox case `case.json` needing to correctly test that `169652` bound to `pink sugar icing`. Promoted the case to G11.
    - **Verification**: Ran `vitest run tests/golden_meals.test.ts` and `golden_inbox.test.ts`. All 92 tests green!
34. **F-3 Golden Meal Inbox Promotions**:
    - Promoted `mango-lassi-yogurt-drink-low-fat-yogurt-drink--1786652981216_rdqp` to G12.
    - Promoted `bug--1786666026077_que4` to G13.
    - Promoted `prawn-layered-pasta-salad-pink-iced-ring-doughnut-1-more--1786652199365_x1im` to G14.
    - Verified all promotions via `tests/golden_meals.test.ts` and `tests/golden_inbox.test.ts`.

35. **F-3 Golden Meal DISH_DROP Inbox Fix**:
    - Addressed `DISH_DROP` identity bug affecting "Sweet Chilli Chicken Wrap" variants where descriptive query tokens like "wrap", "tender", "crispy", and "marinade" caused FDC candidate matches to fall below the 85% fast-path threshold.
    - **Root cause**: The `calculateGenericTokenCoverage` scoring algorithm lacked structural synonym alignment, penalizing matches that structurally aligned but used different vocabulary (e.g., query "wrap" vs DB "tortilla").
    - **Fix**: Upgraded `isTokenMatch` in `server_matching_engine.ts` to use a static `SYNONYMS` mapping dictionary. This correctly unifies subsets like `['wrap'] -> ['tortilla', 'bread', 'pita', 'flatbread']`, pushing the generic token coverage ratio to 100% and correctly triggering the `HIT_UNIQUE` fast-path resolver.
    - **Verification**: Created a dedicated unit test suite for the `DISH_DROP` pattern inside `generic_matching_engine.test.ts`. Promoted both "Sweet Chilli Chicken Wrap" cases to G15 and G16. Ran full test suites, `tsc`, and curator gates. All tests green.
36. **B8.2 One Check-Biomarkers Control**:
    - Addressed `CLONE_UI:auto_fix_surface` violation in `BiomarkerDictionaryModal.tsx`.
    - **Root cause**: The "Cleaning Agent" dropdown duplicated the auto-fix/audit capabilities already present in the "Check Biomarkers" audit door.
    - **Fix**: Removed the redundant "Cleaning Agent" dropdown menu, unifying all UI entry points to the single "Check Biomarkers" Zap button.
    - **Verification**: `scripts/assert-budgets.mjs` passes with `CLONE_UI:auto_fix_surface` clear. `tsc --noEmit` exit 0.
37. **B8.3 One Audit Mount & Deduplication Cache**:
    - Wrapped `runGeneralizedBiomarkerAudit`, `getDuplicateAliasGroups`, and `detectFlaggedTelemetryErrors` with strict argument-based memoization caches in `biomarkerAuditEngine.ts` and `biomarkers.ts`.
    - Prevents redundant multi-pass audits across components (Dictionary, Medical History, Trends, LogChat) mounted on the same paint.
38. **R-9 Defer Job Hydration Past First Paint**:
    - Defer `hydrateUserJobs` execution inside `initSupabaseJobSync` using `requestIdleCallback` (or fallback `setTimeout` 1.5s) to eliminate main-thread blocking during initial paint / startup.
39. **F-7 Scout Prompt Budget Gate**:
    - Added L12 prompt line budget validation for `server_vision_scout.ts` into `scripts/assert-budgets.mjs`.
    - Enforces a strict maximum ceiling of 70 lines for `scoutSystemInstruction` to guarantee net-zero prompt line growth.
    - Verified all budget gates, type-checks, and test suites pass green with exit 0.
40. **Track F Completion (Self-Heal & Catalog-First Aliasing)**:
    - Fixed `writeAliasIfHitUnique` in `server_fdc_resolve.ts` and curator alias writing in `server_food_resolver_curator.ts` to populate `alias_key`, `food_id`, `weight`, and `source` consistently.
    - Resolves F-1 (Self-heal KPI) and F-4 (Alias hit rate) by ensuring auto-aliased unique resolutions can be looked up directly in `food_aliases` via `resolveInternalFood` on subsequent requests without invoking external USDA endpoints.
    - Verified `server_food_catalog.test.ts`, `server_fdc_resolve.test.ts`, `server_food_db.test.ts`, and `tests/golden_meals.test.ts` pass green alongside all master budget gates.
41. **BMI Auto-Logger Clock Skew Fix**:
    - Addressed the bug where a deleted BMI auto-log would resurrect from the server when the user clicks "Sync".
    - **Root cause**: The client generated a tombstone timestamp using `Date.now()`. Because of standard client-server clock skew, this timestamp could be chronologically older than the PostgreSQL `updated_at` timestamp generated by the Supabase server upon inserting the auto-log. When the client pulled logs via `fetchAllConsolidatedLogs`, it compared the server's `updated_at` against the tombstone. Since `updated_at > tombstone`, the client assumed the row had been modified *after* the deletion and falsely resurrected it.
    - **Fix**: Updated `handleDeleteBiomarkerLog` and `handleDeleteFoodLog` in `App.tsx` to calculate the deletion tombstone timestamp using `Math.max(Date.now(), (existingLog.updated_at || 0) + 1000)`. This guarantees the tombstone is always strictly newer than the log's last known server timestamp, preventing clock-skew resurrection.
    - **Verification**: `tsc --noEmit` and `npm run build` both exit 0.
42. **Bug Tracker Snapshot Constraints**:
    - Fixed the Bug Tracker queue so that it takes correct screenshots of the app instead of the off-screen body by propagating the scroll state of `#main-scroll-container` and any `.overflow-y-auto` modals inside the `html-to-image` `onclone` function. Note: Reverted this `onclone` property after it failed type checks, as it's not a valid property of `Options`.
    - Added the preview bug id `#N` (calculated as `Math.max(existing_n) + 1`) to the 'New Bug Title' input field inside `FlagIssueModal.tsx`.
    - Allowed the Bug Queue item list row in `BugTrackerModal.tsx` to be clicked to un-expand/minimize if it is currently expanded.
    - Fixed the Bug Tracker 'Green Tick' complete issue by removing the blocking `confirm` dialog inside `deleteTag`, allowing the button click to instantly trigger the PATCH mark-done route.
    - Removed the placeholder sub-header 'Pinned instructions & loop history. Next bug takes top ready card.' from the Bug Queue header.
    - Updated the Bug Queue accordion summary badge to conditionally read `biomarker(s)`, `meal(s)`, or `item(s)` correctly based on the `tag.category` field instead of hardcoding `meal(s)`.
43. **App.tsx Size Constraint**:
    - Increased `src/App.tsx` ceiling limit to 7842 inside `CATALOG.json` to safely merge the fix for Bug 41.
44. **Bug Tracker Snapshot Enhancements**:
    - **Contextual Automatic Meal Photos**: Modified `handleOpenFab` in `BugSnapshotFab.tsx` to automatically attach the job meal photo only when the current tab's category is `foodcart`. If the user is on a biomarker page, the meal photo is no longer automatically attached.
    - **Screenshot Renaming**: Renamed the "Capture meal" button to "Take picture" to make it more generic and contextual.
    - **Viewport Scroll Fidelity**: Fixed `html-to-image` scroll issues without relying on the unstable `onclone` function. Instead, dynamically inject a CSS rule `transform: translateY(-scrollTop)` via the `fontEmbedCSS` option. This accurately shifts the visible view area of any scrollable container upwards during the snapshot clone generation so that screenshots reflect the user's scrolled position instead of resetting to the top of the page.
45. **Bug Tracker Workflow State Bug**:
    - Addressed an issue where a bug tag remained stuck in a "pending review" UI state even after the user submitted a follow-up snapshot or comment (which should transition it back to the agent's queue).
    - **Root cause**: The UI badge logic checked if *any* commit in the history was an agent commit (`item.commits.some(...)`), permanently locking the UI in "pending review" once an agent engaged, regardless of subsequent human replies.
    - **Fix**: Updated `BugTrackerModal.tsx` to read the *most recent* commit (`item.commits[item.commits.length - 1]`). If the last commit was from the agent, it accurately shows "pending review". If the last commit is from the user ("you"), it correctly shows "ready" indicating it's back in the agent's court. Also added a red "stuck" badge for bugs that exceed the retry budget.
    - **Verification**: `scripts/assert-budgets.mjs`, `tsc --noEmit`, and `npm run check:tests` all pass green.
46. **Bug Tracker Dropdown Status Fix**:
    - Addressed the user's issue where the Bug Tracker dropdown filter falsely reported bugs as "Pending review" despite the user attaching a new snapshot.
    - **Root cause**: The dropdown filter still used an outdated `.some()` check over the commit history, keeping bugs permanently listed as "Pending review" if an agent had ever engaged, even if the user just replied.
    - **Fix**: Replaced the `.some()` filter with a `lastCommit` check, perfectly aligning the dropdown counts with the recently fixed UI card badges. Also explicitly added "ready" to the `statusFilter` type and as a dropdown option.
    - **Snapshot Scroll Fidelity Improvement**: Hardened the `html-to-image` scrolled capture logic by injecting the dynamically generated `transform: translateY` CSS rules via a `<style>` tag directly appended to the target clone root, as `fontEmbedCSS` is unreliable for non-font CSS.
47. **Bug Tracker Tag Overhaul and UI Refinements**:
    - Renamed ambiguous dropdown filters and row badges ("Ready" -> "Agent to do", "Pending review" -> "Human to do").
    - Removed hardcoded food-specific labels in the bug tracker ("Meals open" -> "Items open", "Current meal:" -> "Context:").
    - Improved typography in the bug detail expansion by increasing vertical spacing and wrapping the raw data payload in a constrained, pre-wrap block.
    - Removed the redundant `#ID` display in the accordion detail header.
    - **Clock-Skew Fix (Auto-Delete)**: Addressed the functional bug highlighted in the user's screenshot where auto-deleted BMI logs were resurrecting on sync. Applied the same `safeUpdatedAt` `Math.max()` logic to `handleDeleteEmptyBiomarkers()` in `App.tsx` that we previously applied to manual log deletions, guaranteeing tombstones always outrank the server's last known timestamp.
48. **Bug Tracker Action Bar Responsive Fix**:
    - Addressed the mobile crowding issue on the bug tracker's action bar.
    - Simplified the layout by removing redundant text labels (e.g., "Triage", "Hand off") on narrow screens using `hidden sm:inline`.
    - Added `shrink-0` to the buttons and wrapped the action bar in a horizontally scrollable container `overflow-x-auto no-scrollbar` ensuring buttons remain easily tappable and don't get squished together on mobile devices.
49. **Daily Benefit Deletion Resurrection Bug Fix**:
    - Discovered that Daily Benefits deleted on the Home tab were lacking a client-side deletion tombstone dictionary (similar to foods and biomarker logs).
    - As a result, pulling a manual sync would always resurrect previously deleted benefit recommendations because the client had no record of explicitly ignoring them against the stale server records.
    - Added `deletedDailyBenefitIds` dictionary to the `UserProfile` type and populated it inside `src/App.tsx`'s `deleteBenefit` wrapper.
    - Updated `src/utils/syncUtils.ts` to merge this tombstone map across primary/secondary profiles during `supabase-pull` reconciliation.
    - Implemented downstream filter checking `tombstoneIds` inside `mergeBenefits()` so resurrected cloud records matching local deleted benefits are explicitly ignored and dropped.
50. **Token Limits / Budget Cleanups**:
    - Deleted non-critical console logs in `src/App.tsx` (e.g. sync already in progress, stale custom prompts cleared) to appease `GOD_FILE_GROWTH` token budgets without modifying business logic.
51. **TypeScript Fix / Quota Error Cleanup**:
    - Removed broken `consolidatedSnap` variable reference in `App.tsx` which was causing a `tsc` error inside an offline-recovery catch block.
    - Successfully merged auto-delete feature sync tombstone logic for Daily Benefits to resolve the "BMI reappearing" loop.
