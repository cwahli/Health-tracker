# Bug Backlog — Health-tracker QA
**Compiled:** 2026-09-22  
**Source:** QA runner output, dispatch audit log, dispatch logs, on-disk screenshots  

---

## Bug #1 — BUG-20260921-1836

| Field | Value |
|-------|-------|
| **Title** | Blank dark navy screen — no UI rendered after login |
| **Journey** | meal |
| **Severity** | Critical (blocker) |
| **Reported** | 2026-09-21 |
| **Status** | ✅ **FIXED** (live — meal journey passes with 0 defects) |
| **Dispatch attempts** | 1 (opencode → cline → grok → agy) |
| **Dispatch duration** | 785 seconds |
| **Dispatch outcome** | escalated_human (agent pool failed, but fix reached production through another path) |
| **QA runner result** | PASSED — zero defects (verified 2026-09-22 13:38 UTC) |

### Description

After navigating to the app and authenticating via Demo Login, the entire page rendered as a solid dark navy blank screen. No navigation tabs, no content, no error message, no loading indicator — zero UI elements. The QA runner timed out after 15 seconds waiting for `#nav-tab-food` to appear.

### Observed (Before — broken)
- Solid dark navy background, no variation
- Zero text, icons, controls, or layout
- No loading state or error message
- `#nav-tab-food` never appeared

**Screenshot — Before:**  
`/home/ubuntu/src/Health-tracker/qa-evidence/bug_meal_1790003331836.png`

### Expected
- Dark navy theme with full app shell rendering
- Food History tab and meal log entries visible after login
- Bottom navigation with all tabs functional

### Fixed (After — working)
- Full app shell renders: header with user profile, search bar, meal log entries, bottom navigation
- Bottom nav: Home | Activity | FAB (+) | Food (active) | Trends
- Meal entries show title, date, tag, description, nutrition metrics
- QA runner: "Journey 'meal' PASSED with zero defects!"

**Screenshot — After (latest):**  
`/home/ubuntu/src/Health-tracker/qa-evidence/clean_meal_1790084302362.png` (2026-09-22 13:38 UTC)  
**Also on disk:** `clean_meal_1790081363786.png` (2026-09-22 12:49 UTC)

---

## Bug #2 — BUG-20260921-8449

| Field | Value |
|-------|-------|
| **Title** | Home dashboard discrepancies vs reference design |
| **Journey** | home (not covered by QA runner — requires manual browser capture) |
| **Severity** | Medium (visual/UX correctness) |
| **Reported** | 2026-09-21 |
| **Status** | 🔴 **OPEN — escalated to human** |
| **Dispatch attempts** | 2 |
| **Dispatch duration** | 1249 seconds total |
| **Dispatch outcome** | Both attempts failed. Attempt 1: full scope (6 issues), all agents failed. Attempt 2: narrowed scope (bottom nav + omega-3), agy hit FAILED_PRECONDITION, grok produced no code changes. |

### Description

The live Home Dashboard deviates from the reference design in 7 areas: bottom navigation tab order/labels, omega-3 floating-point display, telemetry errors banner, missing Ready pill, and presence of extra sections not in the reference.

### Issues (7 items)

| # | Issue | Observed (Live) | Expected (Reference) |
|---|-------|-----------------|----------------------|
| 1 | Bottom nav tab 2 label/icon | **Health** (pulse/heartbeat icon) | **Trends** (line graph icon) |
| 2 | Bottom nav tab 5 label/icon | **Trends** (upward line graph) | **Progress** (trending arrow) |
| 3 | Omega-3 weekly target display | `7.700000000000001g` (floating-point artifact) | `7.7g` (clean) |
| 4 | Telemetry Errors banner | Visible at top of page | Absent |
| 5 | "Ready (5)" status pill | Missing from header | Green pill with checkmark in header |
| 6 | Extra sections present | "Health status to improve" (HbA1c/Vitamin D/BMI), "Clinical Action Recommendations 0/3 Completed" (3 items), "Daily Benefits" (3 items) | Absent (per reference design) |
| 7 | "What's up today" button | Present under Daily Recommendation section | Absent |

### Reference (correct state)
User-provided reference screenshot showing the expected Home Dashboard.

**Screenshot — Reference:**  
`/home/ubuntu/.hermes/profiles/qa_meal/cache/images/img_aa35e52a6554.jpg`

### Observed (Live — before second dispatch attempt)
Home dashboard captured on 2026-09-21 showing all 7 discrepancies listed above.

**Screenshot — Live (before):**  
`/home/ubuntu/src/Health-tracker/qa-evidence/opencode-live-home.png`

**Bug report JSON:**  
`/home/ubuntu/src/Health-tracker/qa-evidence/bug_home_1790025521672.json`  
**Screenshot — Bug runner attempt:**  
`/home/ubuntu/src/Health-tracker/qa-evidence/bug_home_1790025521672.png`

### Fix status
No fix deployed. Both dispatch attempts through the agent pool failed. A third attempt with narrowed scope (bottom nav + omega-3 only) was made on 2026-09-22 but also failed when agy returned `FAILED_PRECONDITION: User location is not supported for the API use`.

### Dispatch log
`/home/ubuntu/.hermes/logs/dispatch_BUG-20260921-8449.log` (162 KB, full trace of both attempts)

---

## Summary Table

| Bug ID | Title | Severity | Status | Screenshots Available |
|--------|-------|----------|--------|----------------------|
| BUG-20260921-1836 | Blank screen — no UI rendered | Critical | ✅ Fixed (live) | ✅ Before + ✅ After (x2, latest from today) |
| BUG-20260921-8449 | Home dashboard discrepancies (7 items) | Medium | 🔴 Open — escalated | ✅ Reference + ✅ Live (before) + ❌ Fresh post-dispatch capture pending |

---

## File Inventory

### QA Evidence Directory
`/home/ubuntu/src/Health-tracker/qa-evidence/`

| File | Size | Date | Purpose |
|------|------|------|---------|
| `bug_meal_1790003331836.png` | 2.7 KB | 2026-09-21 | BUG-1836 BEFORE (blank screen) |
| `clean_meal_1790084302362.png` | ~60 KB | 2026-09-22 | BUG-1836 AFTER (latest, today 13:38) |
| `clean_meal_1790081363786.png` | ~60 KB | 2026-09-22 | BUG-1836 AFTER (12:49) |
| `clean_meal_1790081014544.png` | ~60 KB | 2026-09-22 | BUG-1836 AFTER (12:43) |
| `clean_meal_1790025018906.png` | ~60 KB | 2026-09-21 | BUG-1836 AFTER (first pass) |
| `opencode-live-home.png` | 49 KB | 2026-09-21 | BUG-8449 LIVE home dashboard (discrepancies visible) |
| `bug_home_1790025521672.png` | 60 KB | 2026-09-21 | BUG-8449 QA runner attempt screenshot |
| `bug_home_1790025521672.json` | 685 B | 2026-09-21 | BUG-8449 QA runner JSON report |

### Dispatch Logs
`/home/ubuntu/.hermes/logs/`

| File | Size | Purpose |
|------|------|---------|
| `dispatch_BUG-20260921-8449.log` | 162 KB | Full trace of both dispatch attempts for BUG-8449 |

### Reference Images
`/home/ubuntu/.hermes/profiles/qa_meal/cache/images/`

| File | Size | Purpose |
|------|------|---------|
| `img_aa35e52a6554.jpg` | 73 KB | BUG-8449 reference (correct Home Dashboard state) |

### Audit Log
`/home/ubuntu/.hermes/dispatch_audit.log`

Both bugs logged with status `escalated_human`.

---

## Remaining Work

1. **BUG-8449 fresh capture** — re-capture home dashboard after the Sep 22 narrowed-scope dispatch to confirm whether state changed. Not yet done.
2. **BUG-8449 fix** — still open. Both agent pool attempts failed. Human handoff or third dispatch attempt needed.
3. **Backlog file** — this file (`bug-backlog.md`) compiled and written.
