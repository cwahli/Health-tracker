# Auth + i18n + visit types (REQUIRED scoreboard gates)

Evidence screenshots (live Render bug 2026-09-14):
- `_drafts/bug_evidence/auth_id_selected_chrome_keys.png` — Bahasa Indonesia selected but chrome shows raw keys / English ("Sign In Title", "Email Label", "Continue With Email"); wrong-password shows "Invalid email or password" still English.
- `_drafts/bug_evidence/profile_id_selected_chrome_keys.png` — Profile lang = Bahasa Indonesia (ID) but labels still English keys ("Nickname Label", "Edit Profile", "Sign Out"); some values Indo.

## PASS/FAIL themes (every journey touching auth/home must include rows)

### A. PAGE LANGUAGE SWITCH (not just dropdown value)
PASS: After selecting Bahasa Indonesia, ALL visible chrome strings are real Indonesian copy (title, desc, demo, email/password labels, buttons, dividers, social, errors). No raw i18n keys like `Sign In Title`, `Email Label`, `OR USE EMAIL`.
FAIL: Dropdown says Indonesia but page stays English OR shows translation keys.

### B. SIGN UP (first visit)
PASS: Switch to sign-up mode; fill email/password/nickname; submit; leave auth or enter verification flow; confirmation/verification messaging in Indonesian; profile can be set 18/F/140/40/id.
FAIL: signup broken; verification/confirm email UI English-only or missing when product requires it.

### C. SIGN IN (returning visit)
PASS: Existing account logs in with correct password; lands home with prior profile/lang/memory intact.
FAIL: cannot sign in; session loses Indo/profile.

### D. PASSWORD / AUTH ERRORS
PASS: Wrong password or invalid credentials shows localized Indonesian error (not English-only "Invalid email or password" unless that's also provided in id).
FAIL: English-only error while lang=id; no error shown.

### E. CONFIRMATION EMAIL (signup)
PASS: Signup triggers confirmation/verification path; any user-visible confirm/resend/bypass copy in Indonesian; email content Indo if testable (or document API/UI evidence).
FAIL: missing confirm step when required; English-only confirm chrome.

### F. FIRST VISIT vs RETURNING VISIT
PASS: Journey covers BOTH (1) cold first visit signup+onboard+desk… and (2) sign-out/return sign-in continuing with memory/profile.
FAIL: only demo path; only signup; returning visit blank slate.

Profile page same i18n rule as Auth when lang=id.

## G. SIGN-UP MODE CHROME + NATIVE / HTML TOOLTIPS
Evidence: `_drafts/bug_evidence/signup_id_tooltip_please_fill.png` — Sign Up form with Bahasa Indonesia selected; chrome still English keys ("Sign In Title"/"Nickname Label"/"Sign Up"); empty-field browser tooltip **"Please fill out this field."** in English.

PASS:
- Sign-up mode labels/buttons/placeholders in Indonesian (not raw keys)
- Required-field validation messages / native tooltips / custom errors in Indonesian when lang=id (e.g. equivalent of "Harap isi bidang ini" — not English-only "Please fill out this field.")
- Sign up completes successfully with valid inputs
- Sign in works for returning user with correct password

FAIL:
- Tooltip/validation stays English while lang=id
- Sign up or sign in broken
- Raw i18n keys on signup chrome
