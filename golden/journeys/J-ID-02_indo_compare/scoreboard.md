# Scoreboard J-ID-02: Indonesian Meal Comparison (indo_compare)

## Persona Verification
- **Name**: Sari Hartono
- **Gender**: Female | **Age**: 42
- **Height**: **140 cm** (MANDATORY REQUIREMENT: PASS)
- **Weight**: 58.0 kg
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
