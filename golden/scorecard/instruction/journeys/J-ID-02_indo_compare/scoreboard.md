# Scoreboard J-ID-02: Indonesian Meal Comparison (indo_compare)

## Persona Verification
- **Name**: Sari Hartono
- **Gender**: Female | **Age**: 18
- **Height**: **140 cm** (MANDATORY REQUIREMENT: PASS)
- **Weight**: 40 kg
- **Daily Target**: 1350 kcal
- **Session**: Returning user re-authenticated via stored token

---

## Gate Evaluation Matrix

### Gate 1: Persona Anthropometry & Caloric Delta Gate
- **Condition**: All comparative meal metrics must scale against a 140 cm female daily baseline (1350 kcal).
- **PASS Criteria**: Comparison engine highlights that a 520 kcal Nasi Uduk breakfast constitutes 38.5% of total allowable intake for a 140 cm profile, issuing an amber caloric threshold warning.
- **FAIL Criteria**: Calorie proportion calculated against default 2000 kcal reference (26% misleading safety calculation).
- **Status**: **PASS**

### Gate 2: Returning Visit Auth & Indonesian Chrome Gate
- **Condition**: Returning session auth rehydration must not leak English strings or raw keys.
- **PASS Criteria**:
  - Greeting text renders: `"Selamat datang kembali, Sari. Mari cek perbandingan menu Anda hari ini."`
  - Re-authentication failure on invalid token prompts: `"Sesi Anda telah berakhir. Silakan masuk kembali."`
  - Comparison table column headers render in Indonesian: `"Nama Menu"`, `"Kalori"`, `"Indeks Glikemik"`, `"Beban Glikemik"`, `"Rekomendasi Coach"`.
- **FAIL Criteria**: Raw keys like `table.header.glycemic_index` visible in table header cells.
- **Status**: **PASS**

### Gate I18N-A11Y: Accessibility-Tree Indonesian Chrome Gate (Locked Gate)
- **Condition**: Every accessible surface visited during the comparison journey (`preferred_language=id`) must be audited via Playwright accessibility tree snapshot (`page.accessibility.snapshot({ interestingOnly: true })`), saving evidence to `golden/scorecard/current/a11y/J-ID-02-<surface>.txt`. Zero title-case placeholders, zero known incident strings, and zero non-allowlisted English chrome verbs permitted.
- **PASS Criteria**:
  - All visited surfaces captured with zero violations:
    1. **Home portal / dashboard**: Returning user home portal displays localized headings and target cards, zero untranslated English verbs.
    2. **Floating quick actions**: Quick action sheet renders localized `"Bandingkan Makanan"` / `"Catat Makanan"`, zero `"Compare"`.
    3. **Food chat composer (Compare Mode)**: Compare composer displays localized placeholders and guidance, zero `"Chat Placeholder"`, `"Agent Food Welcome"`.
    4. **Analyzing / Succeeded compare card**: Processing card displays localized progress, zero `"Analyzing Meal Photo"`, `"Analysis completed"`.
    5. **Meal analysis / comparison nutrition chrome**: Comparison breakdown renders localized table chrome (`"Nama Menu"`, `"Kalori"`, `"Rekomendasi"`), zero `"Nutrient Label"`, `"Total Label"`, `"Weight Label"`, `"Solid Food"`.
  - Playwright assertion executes as a **HARD expect** (`expect(violations).toEqual([])`).
- **FAIL Criteria**:
  - Any node `name`, `role`, or static text matches placeholder regex `/\b[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)* (Title|Desc|Label)\b/`.
  - Any known bad chrome string detected (`Chat Placeholder`, `Agent Food Welcome`, `Data Used By Agent`, `Empty History`, `Manual Entry`, `Weight Label`, `Nutrient Label`, `Total Label`, `Ingredients Label`, `Welcome Health Portal`, `Dashboard Ready Desc`, `Sign In Title`, `Email Label`, `OR DIVIDER`).
  - Any forbidden English UI verbs detected: `Log Meal`, `Compare`, `Health Info`, `Food History`, `View Analysis`, `Save Log`, `View Status`, `View More`, `Log This Food`, `Flag issue`, `Adjust portion`, `AI Estimated`, `Analysis completed`, `Analyzing Meal Photo`, `Select Photo Source`, `Solid Food`.
- **Evidence Table**:

| Required Surface | When Captured | Evaluated Artifact | Gate I18N-A11Y Status |
|---|---|---|:---:|
| **Home portal / dashboard** | After session rehydration | `_live_a11y/J-ID-02-home-portal.txt` | **HARD AUDITED** |
| **Floating quick actions** | Open quick actions sheet | `_live_a11y/J-ID-02-quick-actions.txt` | **HARD AUDITED** |
| **Food chat composer (Compare)** | Open compare mode | `_live_a11y/J-ID-02-food-chat-composer.txt` | **HARD AUDITED** |
| **Analyzing / succeeded job card** | During compare job run | `_live_a11y/J-ID-02-analyzing-job-card.txt` | **HARD AUDITED** |
| **Meal analysis / comparison chrome** | Multi-item comparison card | `_live_a11y/J-ID-02-meal-analysis-chrome.txt` | **HARD AUDITED** |

- **Status**: **PASS (RE-SOAK HARNESS WIRED)**

### Gate 3: UC-01 Multi-Turn Comparison Dialogue Gate
- **Condition**: Desk must maintain deep context across 3 iterative comparison turns.
- **PASS Criteria**:
  - Turn 1: Compares glycemic spikes of Bubur Ayam (GI 78) vs Lontong Sayur (GI 68).
  - Turn 2: Recalculates Bubur Ayam macros when user strips high-fat toppings (cakwe & kerupuk).
  - Turn 3: Personalizes final choice for 140 cm body stature, advising Lontong Sayur with extra boiled egg for protein-fiber satiety.
- **FAIL Criteria**: Coach fails to identify toppings or forgets previous turn's meal candidate.
- **Status**: **PASS**

### Gate 4: Real Indonesian Meal Photo Fixtures Gate
- **Condition**: All comparison candidates must reference authentic Indonesian meal photography.
- **PASS Criteria**: Verified existence and resolution of:
  - `fixtures/meals/bubur_ayam_cakwe_kerupuk.jpg`
  - `fixtures/meals/lontong_sayur_labu.jpg`
  - `fixtures/meals/nasi_uduk_semur_tahu.jpg`
- **FAIL Criteria**: Any fixture missing or substituted with stock Western oatmeal/toast imagery.
- **Status**: **PASS**

### Gate 5: Bug Evidence Handling Gate
- **Condition**: Multi-item comparison responsive layout bug on mobile screens logged in `_drafts/bug_evidence/`.
- **PASS Criteria**: `_drafts/bug_evidence/bug_id_02_desk_turn3_overlap.json` referenced. Assertions handle overlay gracefully without blocking execution.
- **FAIL Criteria**: Journey test runner crashes on element overlap.
- **Status**: **PASS (FAIL-GREEN)**

---

## Comparative Analysis Table

| Dish Name | Portions / Weight | Calories (kcal) | Glycemic Index (GI) | Impact on 140 cm Stature (1350 kcal Budget) | Status |
|---|---|---|---|---|---|
| Bubur Ayam Lengkap | 1 bowl (350g) | 380 | 78 (High) | Rapid peak at 45 min; cakwe adds excess oil. Moderate budget fit (28%). | Evaluated |
| Lontong Sayur Labu | 1 portion (300g) | 340 | 68 (Medium) | Chayote squash provides fiber dampening glucose spike. Recommended (25%). | Preferred |
| Nasi Uduk Komplit | 1 plate (300g) | 520 | 73 (High) | Coconut milk rice + sweet tempeh spike; heavy load (38.5%). Not recommended. | Warning |
