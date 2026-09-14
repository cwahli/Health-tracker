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
