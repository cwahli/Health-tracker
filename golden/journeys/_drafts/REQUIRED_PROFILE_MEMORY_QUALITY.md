# Required scoreboard dimensions (add to EVERY journey)

## A. PROFILE PERSISTENCE (save / update / no loss)
PASS only if profile fields survive the journey:
- After signup + onboard: age, sex, height_cm, weight_kg, language=id, goals persisted in profile UI + storage/sync
- After desk/coach updates: any accepted profile mutations written to profile (not chat-only ephemera)
- After tab switch / reload / re-login (if in scope): no silent loss or reset to defaults
- Health page + user profile show the same canonical values
FAIL: missing fields, [object Object], defaults overwriting Sari 18/145/40, lang flipping to en, targets wiped

## B. HELPDESK / FRONT DESK MEMORY ACROSS DISCUSSION
Front Desk must remember earlier turns and **prior journey context** in the same persona/session family:
- Within a journey: multi-turn refine builds on prior answers (no blank-slate re-intake)
- Across journeys when run as a sequence for the same user: desk remembers Journey 1 outcomes (profile, goals, BMI/guardrails, prior meals/compare) and **builds on them** in Journey 2/3 rather than starting over
- Memory evidence: replies reference prior facts; handoffPayload/conversation state carries summary; debug dump shows history
FAIL: re-asks everything already known; contradicts Journey 1; forgets BMI≈19 guardrail or kcal≤1500

## C. NUTRITION ACCURACY
- Logged/compared/edited meals: core nutrients present (at least calories + protein; prefer carbs/fat/sodium as product supports)
- Portion edits recalculate consistently (directionally correct deltas)
- Daily targets vs intake math coherent on dashboard
- No absurd macros for named Indo dishes without caveat
FAIL: empty nutrients, nonsense kcal, edit doesn't change totals, target missing

## D. VERDICT ACCURACY
- Meal/compare verdicts coherent with nutrients + persona (BMI~19, ≤1500, healthy+lose-weight framed safely)
- No corrupt verdict ([object Object], missing verdict when UI expects one — ref verdictUtils fixes)
- Verdict language fully Indonesian when lang=id
FAIL: wrong/missing/corrupt verdict; English-only verdict; unsafe “crash cut calories” verdict

## E. RECOMMENDATION ACCURACY
- Coach/desk/compare recommendations aligned with safe targets (≤1500, no extreme deficit, BMI≈20 plan / composition focus)
- Actionable and specific to Sari’s context (Indo food culture OK)
- Does not contradict nutrition data or prior agent handoff
FAIL: generic filler; unsafe advice; ignores compare winner rationale; ignores medical symptom flags (e.g. pusing)
