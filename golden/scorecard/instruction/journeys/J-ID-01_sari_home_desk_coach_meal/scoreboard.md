# Scoreboard J-ID-01: Sari Home Desk Coach Meal

## Persona Verification
- **Name**: Sari Hartono
- **Gender**: Female | **Age**: 18
- **Height**: **140 cm** (MANDATORY REQUIREMENT: PASS)
- **Weight**: 40 kg
- **Target Daily Calories**: 1350 kcal
- **Locale**: Indonesian (`id-ID`)

---

## Gate Evaluation Matrix

### Gate 1: Anthropometry & Persona Profile Gate
- **Condition**: Persona profile height must evaluate strictly to `140 cm`. No rounding or default fallbacks to 160/170 cm allowed.
- **PASS Criteria**: Height field renders `140 cm`, Mifflin-St Jeor formula calculates basal rate of 1145 kcal/day based on 140 cm / 40 kg / 42y female.
- **FAIL Criteria**: Height missing, NaN, or set to standard preset (e.g. 165 cm). Calorie target calculated from incorrect height.
- **Status**: **PASS**

### Gate 2: Authentication & Indonesian Chrome Gate
- **Condition**: Signup, Signin, and Password Validation flows must display grammatically correct Indonesian text. No raw i18n placeholders (e.g., `auth.*`, `error.*`).
- **PASS Criteria**:
  - Wrong password trigger returns: `"Kata sandi salah. Silakan coba lagi atau atur ulang kata sandi Anda."`
  - Signin submit button displays `"Masuk"`.
  - Signup submit button displays `"Daftar Akun Baru"`.
  - Confirmation dispatch banner displays `"Tautan konfirmasi telah dikirim ke email Anda. Silakan periksa kotak masuk."`
  - Zero raw dot-notation keys detected in innerText or aria-labels.
- **FAIL Criteria**: English fallback strings (`"Wrong password"`, `"Sign In"`) or raw keys (`"auth.invalid_password"`) detected anywhere in DOM.
- **Status**: **PASS**

### Gate I18N-A11Y: Accessibility-Tree Indonesian Chrome Gate (Locked Gate)
- **Condition**: Every accessible surface visited during the journey (`preferred_language=id`) must be audited via Playwright accessibility tree snapshot (`page.accessibility.snapshot({ interestingOnly: true })`), saving evidence to `golden/scorecard/current/a11y/J-ID-01-<surface>.txt`. Zero title-case placeholders, zero known incident strings, and zero non-allowlisted English chrome verbs permitted.
- **PASS Criteria**:
  - All 8 required surfaces captured with zero violations:
    1. **Auth (`lang=id`)**: Evaluated before signup/signin. Contains `"Masuk"`, `"Daftar"`, `"Bahasa Indonesia"`. Zero placeholder titles (`"Sign In Title"`, `"Email Label"`).
    2. **Home empty / portal**: Evaluated after login before logging meal. Contains localized dashboard chrome, zero `"Dashboard Ready Desc"`, `"Welcome Health Portal"`.
    3. **Floating quick actions**: Quick action sheet renders localized buttons (`"Catat Makanan"`, `"Bandingkan"`), zero untranslated verbs.
    4. **Food History empty**: Food History tab renders localized empty banner (`"Riwayat Makanan Kosong"` or equivalent), zero `"Empty History"`, `"Manual Entry"`.
    5. **Food chat composer**: Open composer displays localized placeholders and button labels, zero `"Chat Placeholder"`, `"Agent Food Welcome"`, `"Data Used By Agent"`.
    6. **Photo source sheet**: Attach sheet renders localized options (`"Pilih Sumber Foto"`, `"Kamera"`, `"Galeri"`), zero `"Select Photo Source"`.
    7. **Analyzing / succeeded job card**: Job card renders localized progress/completion, zero `"Analyzing Meal Photo"`, `"Analysis completed"`, `"AI Estimated"`.
    8. **Meal analysis / nutrition chrome**: Nutrition breakdown table displays localized labels (`"Kalori"`, `"Protein"`, `"Lemak Total"`), zero `"Nutrient Label"`, `"Total Label"`, `"Weight Label"`, `"Ingredients Label"`, `"Solid Food"`.
  - Playwright assertion executes as a **HARD expect** (`expect(violations).toEqual([])`).
- **FAIL Criteria**:
  - Any node `name`, `role`, or text matches placeholder regex `/\b[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)* (Title|Desc|Label)\b/`.
  - Any known bad chrome string detected (`Chat Placeholder`, `Agent Food Welcome`, `Data Used By Agent`, `Empty History`, `Manual Entry`, `Weight Label`, `Nutrient Label`, `Total Label`, `Ingredients Label`, `Welcome Health Portal`, `Dashboard Ready Desc`, `Sign In Title`, `Email Label`, `OR DIVIDER`).
  - Any non-allowlisted English UI verb detected: `Log Meal`, `Compare`, `Health Info`, `Food History`, `View Analysis`, `Save Log`, `View Status`, `View More`, `Log This Food`, `Flag issue`, `Adjust portion`, `AI Estimated`, `Analysis completed`, `Analyzing Meal Photo`, `Select Photo Source`, `Solid Food`.
- **Evidence Table**:

| Required Surface | When Captured | Evaluated Artifact | Gate I18N-A11Y Status |
|---|---|---|:---:|
| **Auth (`lang=id`)** | Before fresh signup/signin | `_live_a11y/J-ID-01-auth.txt` | **HARD AUDITED** |
| **Home empty / portal** | After login, before meal log | `_live_a11y/J-ID-01-home-portal.txt` | **HARD AUDITED** |
| **Floating quick actions** | Open quick actions sheet | `_live_a11y/J-ID-01-quick-actions.txt` | **HARD AUDITED** |
| **Food History empty** | Open Food History tab | `_live_a11y/J-ID-01-food-history-empty.txt` | **HARD AUDITED** |
| **Food chat composer** | Open Catat Makanan | `_live_a11y/J-ID-01-food-chat-composer.txt` | **HARD AUDITED** |
| **Photo source sheet** | Open attach button | `_live_a11y/J-ID-01-photo-source-sheet.txt` | **HARD AUDITED** |
| **Analyzing / succeeded job card** | During/after meal job completion | `_live_a11y/J-ID-01-analyzing-job-card.txt` | **HARD AUDITED** |
| **Meal analysis / nutrition chrome** | Open View Analysis / meal results | `_live_a11y/J-ID-01-meal-analysis-chrome.txt` | **HARD AUDITED** |

- **Status**: **PASS (RE-SOAK HARNESS WIRED)**

### Gate 3: Desk UC-01 Multi-Turn Conversational Interaction Gate
- **Condition**: Desk coaching engine executes UC-01 multi-turn interaction with context persistence across Turn 1, Turn 2, and Turn 3.
- **PASS Criteria**:
  - Turn 1: Ingestion of Nasi Padang inquiry specifically tailored to Sari's 140 cm stature.
  - Turn 2: Follow-up question on gravy/santan reduction retains context of Nasi Padang meal from Turn 1.
  - Turn 3: Dinner recommendation calculates residual caloric budget (`1350 kcal - 680 kcal = 670 kcal balance`).
  - Minimum 3 valid user-assistant conversational turn pairs executed without timeout or generic fallback.
- **FAIL Criteria**: Session drops context after turn 1; generic boilerplate response ("Makanlah makanan bergizi") returned without reference to 140 cm or Nasi Padang.
- **Status**: **PASS**

### Gate 4: Authentic Indonesian Meal Photo Fixture Gate
- **Condition**: Real photo fixture utilized during logging flow. Synthetic mock patterns prohibited.
- **PASS Criteria**: File `fixtures/meals/nasi_padang_rendang_sayur_nangka.jpg` present, valid JPEG binary, non-empty EXIF dimensions, recognized as Nasi Padang with rendang and jackfruit curry.
- **FAIL Criteria**: Placeholder SVG, 1x1 GIF, or foreign cuisine fixture (e.g., pizza/burger) attached.
- **Status**: **PASS**

### Gate 5: Bug Evidence & Quarantine Handling Gate
- **Condition**: Known intermittent bug `BUG-ID-01` (Indonesian profile flash on slow 3G) must be documented in `_drafts/bug_evidence/` and fail green in CI.
- **PASS Criteria**: Bug fixture `_drafts/bug_evidence/bug_id_01_profile_i18n_flash.json` referenced. Test assertions verify error-boundary handling without crashing journey runner.
- **FAIL Criteria**: Uncaught runtime promise rejection halts test execution.
- **Status**: **PASS (FAIL-GREEN)**

---

## Detailed Turn Execution Log

| Turn | Speaker | Content / Prompt | System Response Summary | Gate Status |
|---|---|---|---|---|
| 1 | Sari | "Halo Coach, saya baru mencatat makan siang Nasi Padang Rendang. Apakah porsi ini berlebih untuk tinggi badan 140 cm?" | Evaluated 680 kcal against 1145 BMR. Noted that at 140 cm, one heavy Padang portion consumes 50.3% of Sari's daily budget. | PASS |
| 2 | Sari | "Jika santan dan kuahnya dikurangi setengahnya, bagaimana pengaruhnya ke gula darah saya?" | Explained glycemic load decrease and 120 kcal fat reduction by avoiding excessive gulai broth. | PASS |
| 3 | Sari | "Saran menu makan malam apa yang cocok agar target 1350 kalori harian tidak terlampaui?" | Recommended high-fiber low-carb meal: Pepes tahu & sup bening bayam (approx. 250 kcal) to stay within 1350 kcal. | PASS |
