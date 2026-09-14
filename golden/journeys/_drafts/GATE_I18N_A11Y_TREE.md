# Gate I18N-A11Y — Accessibility-tree Indonesian chrome (locked)

## Why Playwright missed this before
- Auth/Home i18n used `expect.soft` → soft fail still green.
- Specs never opened Food History empty state, food-chat overlay, photo-source sheet, analyzing card, or nutrition table chrome.
- Checks looked for raw keys (`auth.*`) or a few strings, not the full visible/a11y name set.
- Demo / returning paths skipped full signup chrome.

## PASS (all must hold when `preferred_language=id`)
1. Capture Playwright `page.accessibility.snapshot({ interestingOnly: true })` (and/or `locator.ariaSnapshot()` on `#root` / main) on **each** required surface below.
2. Flatten every node `name` + `role` + static text into one string set.
3. **HARD fail** (not soft) if any of:
   - Title-Case placeholder: `/\b[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)* (Title|Desc|Label)\b/`
   - Known bad chrome from incidents: `Chat Placeholder`, `Agent Food Welcome`, `Data Used By Agent`, `Empty History`, `Manual Entry`, `Weight Label`, `Nutrient Label`, `Total Label`, `Ingredients Label`, `Welcome Health Portal`, `Dashboard Ready Desc`, `Sign In Title`, `Email Label`, `OR DIVIDER`
   - English chrome allowlist-exceptions only (see below) — any other common UI verbs in English fail: Log Meal, Compare, Health Info, Food History, View Analysis, Save Log, View Status, View More, Log This Food, Flag issue, Adjust portion, AI Estimated, Analysis completed, Analyzing Meal Photo, Select Photo Source, Solid Food (unless exact allowlisted technical token)
4. Save snapshot artifact: `golden/journeys/_live_a11y/J-ID-0X-<surface>.txt` for evidence.

## Required surfaces (visit all in journey)
| Surface | When |
|---|---|
| Auth (lang=id) | Before signup/signin |
| Home empty / portal | After login, before meal |
| Floating quick actions | Open sheet |
| Food History empty | Open Food History tab |
| Food chat composer | Catat Makanan open |
| Photo source sheet | Open attach |
| Analyzing / succeeded job card | During/after meal job |
| Meal analysis / nutrition chrome | Open View Analysis |

## Allowlist (do NOT fail)
- Food/dish/brand names as observed (OCR/scout)
- Nutrient **codes** in tables: `calories`, `protein`, `totalFat`, … (machine keys); labels must still be localized when shown as chrome
- Units: `kcal`, `g`, `mg`, `mcg`, `%`
- Proper nouns: Google, Facebook, Gemini model names in debug-only chrome if debug gated
- Dates/times, emails, job ids
- User-entered text
- Agent free-text replies in Indonesian (or mixed food names) — not scored as chrome
- Debug download already localized (`Unduh Log Debug`)

## Evidence columns for scoreboard
| PASS | FAIL | Evidence |
| Accessibility snapshot for surface S contains zero placeholder / non-allowlisted English chrome | Any forbidden string in snapshot names | `_live_a11y/J-ID-0X-S.txt` + Playwright hard expect |

## End-of-pass report completeness (required)
Every green run must regenerate a report section **"Coverage checklist — all requirements"** that lists EVERY gate/surface below with status `PASS` | `FAIL` | `NOT COVERED`, plus artifact path (`_live_a11y/...` or debug dump). A journey may not be called complete unless every row is `PASS` (no NOT COVERED).

Include in:
1. `golden/journeys/SCOREBOARD_LIVE_RESULTS.md` (bottom)
2. `/workspace/gemini38-meal-review/tasks/FULL_THREE_JOURNEYS_FINAL_REPORT.md` (bottom)
3. Each journey scoreboard's live results appendix when present

Checklist rows (minimum):
- Auth lang=id a11y chrome
- Home empty/portal a11y chrome
- Floating quick actions a11y chrome
- Food History empty a11y chrome
- Food chat composer a11y chrome
- Photo source sheet a11y chrome
- Analyzing / succeeded job card a11y chrome
- Meal analysis / nutrition table chrome a11y
- Debug contract classifyDump 0 fails (per journey)
- Job waited until terminal (not 5%)
- Soft asserts banned for i18n/a11y (hard only)
