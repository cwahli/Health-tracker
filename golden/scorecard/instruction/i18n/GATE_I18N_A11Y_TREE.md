# Gate I18N-A11Y — Accessibility-tree Indonesian chrome (locked)

## Why Playwright missed leftover chrome before
- Auth/Home i18n used `expect.soft` → soft fail still green.
- Specs never opened Food History, food-chat overlay, photo-source sheet, analyzing card, or nutrition table chrome.
- Checks looked for raw keys (`auth.*`) or a few strings, not the full a11y name set.
- Demo / returning paths skipped full signup chrome.
- Helper used removed API `page.accessibility.snapshot` (gone in Playwright 1.62+) and later self-corrupted mid-soak → SyntaxError / “No tests found” before any chrome assert ran.

## Capture API (pinned)
**Primary:** `page.locator('#root, body').first().ariaSnapshot()`  
**Fallback:** DOM walk of `#root`/`body` (aria-label / title / placeholder / direct text).  
**Forbidden:** `page.accessibility.snapshot` — undefined on Playwright ≥1.62; do not restore it.

Artifacts: `golden/scorecard/current/a11y/J-ID-0X-<surface>.txt`

## PASS (all must hold when `preferred_language=id`)
1. Capture `ariaSnapshot` (or fallback) on **each** required surface below.
2. Flatten every accessible name / quoted label into one string set.
3. **HARD fail** (not soft) if any of:
   - Title-Case placeholder: `/\b[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)* (Title|Desc|Label)\b/`
   - Incident strings in `FORBIDDEN_EN_CHROME.json`
   - Non-allowlisted English UI chrome verbs (Log Meal, Compare, Health Info, Food History, View Analysis, Save Log, View Status, View More, Log This Food, Flag issue, Adjust portion, AI Estimated, Analysis completed, Analyzing Meal Photo, Select Photo Source, Solid Food, …)
4. Empty artifact or capture throw = FAIL (infra), not a chrome PASS.

## Required surfaces
| Surface slug | When |
|---|---|
| `auth` | Before signup/signin, lang=id |
| `home` | After login, before meal |
| `quick-actions` | Floating sheet open |
| `food-history` | Food History tab / empty state |
| `food-chat` | Catat Makanan composer open |
| `photo-source` | Attach / photo source sheet |
| `analyzing-card` | Job card during/after meal |
| `meal-analysis` | View Analysis / nutrition chrome |

## Allowlist (do NOT fail)
- Food/dish/brand names as observed (OCR/scout)
- Nutrient **codes** (`calories`, `protein`, …); chrome **labels** must still be localized
- Units: `kcal`, `g`, `mg`, `mcg`, `%`
- Proper nouns: Google, Facebook; debug-only model names if debug gated
- Dates/times, emails, job ids, user-entered text
- Agent free-text replies (not chrome)
- Localized debug download (`Unduh Log Debug`)

## Agent soak hygiene (required — learned 2026-09-14)
Before claiming a journey soak green:

1. **`--list` gate:** `npx playwright test <spec> --list` must exit 0. SyntaxError / “No tests found” = soak FAIL; fix helpers first.
2. **No mid-soak self-edit** of `indo-journey-helpers.ts` / specs by failure-path aider until `--list` is green again.
3. **Restore, do not invent** i18n copy. On leftover English / missing keys: restore from known-good git (`i18n-en-id`, `4cd66d1`, or later restore commits). Grow `REQUIRED_CHROME.json` only; never invent Title-Case id values.
4. **Headline honesty:** if any checklist row is `NOT COVERED` or `FAIL`, top verdict is **INCOMPLETE** — never skim as LIVE PASS.
5. **One writer per file:** do not run parallel Vertex/Home-i18n/debug-green jobs that edit the same helpers/specs.
6. **Push hygiene:** `git fetch && git pull --rebase` before push after long soaks.
7. Artifacts land in `golden/scorecard/current/a11y/` (not a parallel `_live_a11y` tree).

## End-of-pass coverage checklist (required)
Every green run regenerates **"Coverage checklist — all requirements"** with `PASS` | `FAIL` | `NOT COVERED` + artifact path for each surface above, plus:
- Debug contract `classifyDump` 0 fails (per journey)
- Job waited until terminal (not “Starting… 5%”)
- Soft asserts banned for i18n/a11y (hard only)
- `playwright --list` passed before soak

A journey is **not complete** while any row is `NOT COVERED` or `FAIL`.
