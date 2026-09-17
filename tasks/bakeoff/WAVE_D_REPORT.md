# WAVE_D_REPORT — docs + S-1 inventory (Laguna S 2.1 free substitute)

Date: 2026-09-15 ~00:18–00:30 UTC (2026-09-15 ~07:18–07:30 WIB)
**Intended model:** Cline Free GLM-5.3-Flash (`cline-free/glm-5.3-flash`) — **FAILED**: "Free model promotion ended".
**Actual model:** `poolside/laguna-s-2.1:free` `--thinking high` (confirmed free PONG earlier). OpenCode GLM also blocked (payment method).
Wall: ~11m then coordinator stopped (long ROADMAP deliberation + Cline OAuth nearing expiry); inventory completed from worker log + fresh `rg`.
Result: **PASS** for inventory deliverable; ROADMAP left as draft-in-report only (not applied — safer overnight).

## Model note (bakeoff)
- `cline-free/glm-5.3-flash` free promo **ended** as of this run.
- `z-ai/glm-5.3-flash` and `upstage/solar-pro4` still answer PONG (billing status unclear) — not used for Wave D to stay free-only.
- Laguna S 2.1 `:free` works.

## S-1 parked leftovers (file:line list only — not a 50-key dump)

| Leftover | Locations |
|---|---|
| `1 serving` hardcoded / default | `src/components/FoodHistoryTab.tsx:220`, `:873`, `:891`; `NutritionDataBrowserModal.tsx:73`; `AllAnalysesModal.tsx:265`; `src/utils/syncUtils.ts:170`; `server_food_meal_assemble.ts:142` (sanitize default); tests/fixtures elsewhere |
| `oneServingDefault` key (wired?) | `src/utils/translations.ts:1064` — key exists; FoodHistoryTab still hardcodes string |
| `Preparation:` fallback | `src/components/chat-cards/FoodCard.tsx:2680` (`t.preparationLabel \|\| 'Preparation:'`) |
| `View Diagnostic Logs` fallback | `src/components/LogChat.tsx:6305` (`t.viewDiagnosticLogs \|\| 'View Diagnostic Logs'`); EN string also at `translations.ts:1701` |
| ROADMAP park note | `plan/ROADMAP.md:126` lists these as parked under S-1 |

## ROADMAP draft (not applied)
Update Current work: B0 smoke + B7.4/7.5 shipped; workers = OpenCode Muse free + Cline free (Vertex ended); keep B0 locks as regression gates; next = Track S class-fixes via free workers. Date → 2026-09-15. Coordinator did **not** patch `plan/ROADMAP.md` overnight (optional; avoid redirecting live agent loop without human eyes).

## Files touched by Wave D worker
None committed (killed before editor writes). Report authored by overnight coordinator from worker research + `rg`.
