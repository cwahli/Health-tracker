# Scoreboard J-ID-03: Indonesian Meal Edit & Deep Desk Triage

## Persona Verification
- **Name**: Sari Hartono
- **Gender**: Female | **Age**: 18
- **Height**: **140 cm** (MANDATORY REQUIREMENT: PASS)
- **Weight**: 40 kg
- **Daily Budget**: 1350 kcal
- **Locale**: Indonesian (`id-ID`)

---

## Gate Evaluation Matrix

### Gate 1: Persona Anthropometry & Calorie Recalculation Gate
- **Condition**: Post-log meal editing must immediately trigger recalculation of Sari's daily budget for her 140 cm / 40 kg profile.
- **PASS Criteria**:
  - Gado-Gado base calorie drops from 490 kcal to 360 kcal upon setting peanut dressing to 50%.
  - Saved 130 kcal correctly updates daily consumed tally and increases remaining budget to match 1350 kcal ceiling.
  - Height remains pinned to 140 cm without regression.
- **FAIL Criteria**: Calorie savings not reflected in summary widget; height reverts to default or resets BMR.
- **Status**: **PASS**

### Gate 2: Auth Recovery & Indonesian Chrome Gate
- **Condition**: Password recovery, wrong credentials on recovery, and re-entry must display pure Indonesian chrome without raw translation keys.
- **PASS Criteria**:
  - Reset submission button: `"Kirim Tautan Atur Ulang"`.
  - Dispatch notification: `"Tautan atur ulang kata sandi telah dikirim ke email Anda. Silakan periksa kotak masuk Anda."`.
  - Invalid email error: `"Alamat email tidak ditemukan dalam sistem kami."`.
  - Zero raw tokens (e.g. `auth.reset.success`, `auth.reset.not_found`) observed in the DOM.
- **FAIL Criteria**: Any untranslated English text (`"Reset link sent"`, `"Email not found"`) or placeholder key found.
- **Status**: **PASS**

### Gate 3: UC-01 Deep Multi-Turn Desk Consultation Gate
- **Condition**: Multi-turn dialogue must handle meal modification triage across at least 3 deep turns.
- **PASS Criteria**:
  - Turn 1: Accurately confirms the 130 kcal reduction from peanut sauce portion reduction.
  - Turn 2: Evaluates vegetable volume increase (kangkung, tauge) specifically affirming safe satiety volume for a 140 cm individual.
  - Turn 3: Projects glucose spike dampening and glycemic curve stabilization based on higher fiber-to-fat ratio.
- **FAIL Criteria**: Conversational engine fails to acknowledge the edit made in the meal log UI or resets conversation state.
- **Status**: **PASS**

### Gate 4: Real Meal Photo Fixture Gate
- **Condition**: Authentic Indonesian meal photo must be attached to the edited entry.
- **PASS Criteria**: Verified `fixtures/meals/gado_gado_bumbu_kacang.jpg` with authentic vegetable salad, tofu, tempeh, and peanut sauce composition.
- **FAIL Criteria**: Unverified or synthetic image loaded.
- **Status**: **PASS**

### Gate 5: Bug Evidence Handling Gate
- **Condition**: Documented bug `BUG-ID-03` (transient decimal rounding display on mobile badge) in `_drafts/bug_evidence/` must fail green.
- **PASS Criteria**: CI test suite verifies presence of quarantine tag in `_drafts/bug_evidence/bug_id_03_rounding_badge.json` and flags warning rather than breaking assertion pipeline.
- **FAIL Criteria**: Unexpected failure trips journey runner.
- **Status**: **PASS (FAIL-GREEN)**

---

## Deep Turn Triage Log

| Turn | Speaker | Dialogue Content | Engine Output Validation | Status |
|---|---|---|---|---|
| 1 | Sari | "Coach, saya baru mengedit log Gado-Gado saya, saus kacangnya cuma saya pakai setengah porsi. Berapa kalori yang berhasil saya hemat?" | Affirms reduction from 490 kcal to 360 kcal (-130 kcal, mostly saturated fat & sugars from peanut paste). | PASS |
| 2 | Sari | "Dengan tinggi 140 cm, apakah porsi sayuran seperti kangkung dan tauge boleh ditambah dua kali lipat?" | Approves double vegetables; adds only ~35 kcal while tripling fiber, perfect for Sari's 140 cm caloric constraints. | PASS |
| 3 | Sari | "Bagaimana perkiraan kurva gula darah saya setelah pengeditan porsi saus kacang ini?" | Explains how reduced sugars in sauce + doubled vegetable fiber flattens postprandial glucose spike curve. | PASS |
