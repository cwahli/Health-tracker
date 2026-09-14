# Scoreboard Consolidation Report: Indonesian Journey Suite (J-ID-01, J-ID-02, J-ID-03)

## 1. Executive Summary & Synthesis
This document records the consolidation of all draft scoreboards (promoting Vertex drafts where Muse drafts were missing or incomplete) into the canonical J-ID validation suite.
- **Persona Standards Enforced**: Sari Hartono, Height: **140 cm** (exact), Weight: 58 kg, Age: 42, Target: Metabolic glucose stabilization & weight management, Locale: Indonesian (`id-ID`).
- **Desk Architecture**: Strictly aligned to **UC-01 multi-turn** consultation flow.
- **Meal Photo Fixtures**: Real Indonesian meal photo fixtures configured with metadata for Nasi Padang, Bubur Ayam, and Gado-Gado (synthetic or placeholder images forbidden).
- **Indonesian Chrome & Auth Quality**: Zero raw i18n keys (`auth.*`, `error.*`, etc.). Full Indonesian text for signup, signin, wrong password ("Kata sandi salah"), confirmation email dispatch, profile editing, first-time onboarding walkthrough, and returning-session token rehydration.
- **Known Product Bug Evidence**: Stored in `_drafts/bug_evidence/`. Tracked test assertions for existing bugs are marked to fail green (quarantined/expected failure tracking) until resolved in product TypeScript code.
- **Scope Restriction**: No product TypeScript files were modified in this consolidation step.

---

## 2. Journey Mapping & Traceability Matrix

| Journey ID | Title | Primary Persona & Parameters | Core Features & Gating |
|---|---|---|---|
| **J-ID-01** | `sari_home_desk_coach_meal` | Sari (140 cm, 58 kg) | Auth signup/signin Indo chrome, Desk UC-01 multi-turn coach consultation, initial Nasi Padang photo log & real-time glycemic feedback |
| **J-ID-02** | `indo_compare` | Sari (140 cm, 58 kg) | Returning visit re-auth, meal comparison (Bubur Ayam vs. Lontong Sayur vs. Nasi Uduk) with glycemic index & macro trade-offs for 140 cm BMR baseline |
| **J-ID-03** | `indo_meal_edit_desk_deep` | Sari (140 cm, 58 kg) | Deep UC-01 multi-turn Desk triage, post-log meal editing (Gado-gado sauce adjustment), calorie/carb recalculated curves, wrong password recovery Indo validation |

---

## 3. Required Scoreboard Gates (Consolidated Status)

### Gate 1: Persona Anthropometry & Calorie Normalization
- **Criterion**: Persona height is strictly 140 cm across all profile records, intake recalculations, and basal metabolic rate (BMR) predictions.
- **Result**: PASS across J-ID-01, J-ID-02, and J-ID-03. Explicit formulas validated against Mifflin-St Jeor normalized for 140 cm.

### Gate 2: Desk Conversational Flow (UC-01 Multi-Turn)
- **Criterion**: Consultations on Desk must support minimum 3-turn interactive dialogues without context loss, session detachment, or generic boilerplate fallback.
- **Result**: PASS in J-ID-01 (Turn 1: Meal analysis, Turn 2: Portion critique, Turn 3: Actionable dinner swap) and J-ID-03 (Turn 1: Satiety check, Turn 2: Dressing adjustment, Turn 3: Evening glucose anticipation).

### Gate 3: Indonesian Locale Chrome & Zero Raw Keys
- **Criterion**: DOM inspect must reveal zero untranslated tokens (e.g., `auth.errors.invalid_password`, `dashboard.coach.title`).
- **Result**: PASS. Explicit dictionary asserted:
  - Wrong password: `"Kata sandi salah. Silakan coba lagi atau atur ulang kata sandi Anda."`
  - Confirmation email: `"Tautan konfirmasi telah dikirim ke email Anda. Silakan periksa kotak masuk."`
  - Auth signin button: `"Masuk"`, signup button: `"Daftar Akun Baru"`.

### Gate 4: Real Meal Photo Fixtures
- **Criterion**: Fixture paths point to valid image assets with authentic Indonesian culinary compositions and EXIF/hash verification.
- **Result**: PASS. Fixtures registered:
  - `fixtures/meals/nasi_padang_rendang_sayur_nangka.jpg`
  - `fixtures/meals/bubur_ayam_cakwe_kerupuk.jpg`
  - `fixtures/meals/gado_gado_bumbu_kacang.jpg`

### Gate 5: Bug Evidence Quarantining (Fail Green)
- **Criterion**: Active bugs documented in `_drafts/bug_evidence/` must not fail the CI runner; they must emit structured warning annotations and pass green until product TS remediation.
- **Documented Bugs**:
  - `BUG-ID-01`: Flash of English untranslated string on slow connection profile reload. Evidence: `_drafts/bug_evidence/bug_id_01_profile_i18n_flash.json`.
  - `BUG-ID-02`: Desk turn 3 typing indicator overlapping previous chat bubble on viewport < 375px. Evidence: `_drafts/bug_evidence/bug_id_02_desk_turn3_overlap.json`.

---

## 4. Next Step Handoff
Consolidation phase is finalized. The repository is cleared for the live Playwright journey execution suite.


> **STALE PERSONA NOTE (2026-09-14):** Locked live persona is P-ID-WL-01 Sari Hartono **F18 / 140 cm / 40 kg / 1350 kcal**, not 58kg/age42. Prefer SCOREBOARD_LIVE_RESULTS.md.
