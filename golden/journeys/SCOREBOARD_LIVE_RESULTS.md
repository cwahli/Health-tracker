# Scoreboard vs live Playwright — J-ID-01/02/03

**When:** 2026-09-14 ~07:49 Jakarta (00:49 UTC)  
**Host:** https://health-tracker-backend-64gt.onrender.com/  
**Harness result:** ALL_GREEN round 2 (`VERTEX_THREE_JOURNEYS_REPORT.md`)  
**Entry path that worked:** Demo login → Open Quick Actions → Catat Makanan / Log meal → `#food-chat-input` + `#food-chat-send-btn`

**Important:** Consolidated `scoreboard.md` files mark every gate **PASS**, but those statuses are **design/doc claims** from Vertex consolidation — **not** live Playwright evidence. Below maps each gate to what the live run actually proved.

**Persona note:** Locked product persona is Sari F18 / **40 kg** / **140 cm**. Consolidated scoreboards incorrectly say 58 kg / age 42 — treat height 140 cm as the only locked field that matched intent.

---

## J-ID-01 — `sari_home_desk_coach_meal`

**Live PW:** `indo-j-id-01-e2e.live.spec.ts` — **PASS** (~10.8s)  
**What the test did:** demo login → open food chat → text log `Nasi Uduk dengan Telur Balado dan Tempe Orek` → soft-match nutrition/name text → optional delete.

| Gate | Scoreboard claim | Live evidence | Verdict |
|---|---|---|---|
| G1 Anthropometry 140 cm / BMR | PASS | Not asserted (demo Alex profile, no Sari signup) | **NOT COVERED** |
| G2 Auth + Indo chrome (Masuk/Daftar/wrong password) | PASS | Not exercised (demo login only) | **NOT COVERED** |
| G3 Desk UC-01 3-turn coach | PASS | Not exercised (food chat meal log only) | **NOT COVERED** |
| G4 Real meal photo fixture | PASS | Text-only log; no photo fixture attached | **NOT COVERED** |
| G5 Bug evidence FAIL-GREEN | PASS (FAIL-GREEN) | Not asserted | **NOT COVERED** |
| Harness: open food chat + log Indo meal text | (not a scoreboard gate) | `#food-chat-input` visible; submit; soft regex on result | **LIVE PASS** |

**How PW “passed”:** Hard expects only on demo home attached, quick-actions + Log meal, `#food-chat-input` visible/enabled, send enabled. Nutrition match is `expect.soft` and skipped if no text. Cleanup is best-effort if delete UI present.

---

## J-ID-02 — `indo_compare`

**Live PW:** `indo-j-id-02-e2e.live.spec.ts` — **PASS** (~10.7s)  
**What the test did:** same harness → text log `Nasi Padang Rendang Daging dan Sayur Singkong` → soft-match macros → optional delete. **No compare UI / Meal_03 photos.**

| Gate | Scoreboard claim | Live evidence | Verdict |
|---|---|---|---|
| G1 Caloric delta vs 140 cm / 1350 kcal | PASS | Not asserted | **NOT COVERED** |
| G2 Returning visit auth + Indo compare chrome | PASS | Demo session only; no returning-visit auth | **NOT COVERED** |
| G3 UC-01 3-turn compare dialogue | PASS | Single meal text log; no compare turns | **NOT COVERED** |
| G4 Real compare photo fixtures | PASS | No photos | **NOT COVERED** |
| G5 Bug evidence FAIL-GREEN | PASS (FAIL-GREEN) | Not asserted | **NOT COVERED** |
| Harness: multi-item Indo lunch text log | (not a scoreboard gate) | Food chat path + soft match padang/rendang/kcal | **LIVE PASS** |

**How PW “passed”:** Same hard harness expects as J-ID-01; soft nutrition regex; optional cleanup.

---

## J-ID-03 — `indo_meal_edit_desk_deep`

**Live PW:** `indo-j-id-03-e2e.live.spec.ts` — **PASS** (~3.2m)  
**What the test did:** food chat → log Gado-Gado text → second turn edit `porsinya setengah...` → soft-match → optional delete. Longer runtime from live model/job wait.

| Gate | Scoreboard claim | Live evidence | Verdict |
|---|---|---|---|
| G1 Edit recalculation 490→360 kcal / 140 cm | PASS | Soft text only; no numeric kcal assert | **NOT COVERED** (edit turn attempted) |
| G2 Auth recovery Indo chrome | PASS | Not exercised | **NOT COVERED** |
| G3 UC-01 deep desk 3 turns | PASS | 2 food-chat turns (log + edit), not Front Desk UC-01 | **PARTIAL** (multiturn food chat only) |
| G4 Real gado-gado photo | PASS | Text-only | **NOT COVERED** |
| G5 Bug evidence FAIL-GREEN | PASS (FAIL-GREEN) | Not asserted | **NOT COVERED** |
| Harness: log + multiturn edit in food chat | (not a scoreboard gate) | Two submits via `#food-chat-input`; soft match | **LIVE PASS** |

**How PW “passed”:** Same harness; turn-2 reopens food chat if needed; soft regex on edit response; optional cleanup.

---

## Summary

| Journey | Playwright | Scoreboard gates live-proven |
|---|---|---|
| J-ID-01 | PASS | 0 / 5 (harness only) |
| J-ID-02 | PASS | 0 / 5 (harness only) |
| J-ID-03 | PASS | 0 / 5 full; multiturn food-chat **partial** |

**Rejected hypothesis (Learner):** `specs/rejected/indo-j-id-e2e-unblock.json` — meal composer does **not** live on Home.  
**Learning:** `specs/learnings/indo-j-id-e2e-unblock-20260914.md`

**Next if full scoreboard green is required:** extend specs to Sari signup/onboard (40 kg / 140 cm), Indo auth chrome asserts, real Meal_04/Meal_03 photos, UC-01 Front Desk multiturn, compare mode, numeric edit deltas, debug dumps — then re-soak vs these gates.
