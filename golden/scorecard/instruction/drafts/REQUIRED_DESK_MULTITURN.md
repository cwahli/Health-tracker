# Helpdesk / Front Desk MUST be multi-turn (UC-01 pattern)

Reference golden: `prototype/receptionist/benchmark/UC-01.json`
(+ live reports under prototype/receptionist/reports/UC-01_live.md)

NOT a single Q&A. Desk gathers missing fields across turns (needs_info → refine → ready_for_handoff).

Canonical turn shape (adapt to Indonesian + height **140 cm**):
1. User: want lose weight / sehat turun BB → needs_info; ask gender/age/height/weight/activity; optional uiForm
2. User provides demographics (18 F Indo, 140cm, …) → still needs_info if weight missing
3. User: weight 40kg + lifestyle → ready_for_handoff → health_coach with full handoffPayload
4. Follow-up (e.g. best weight?) → continues with memory; coach/desk build on gathered profile

Scoreboard FAIL if desk one-shots advice without gathering, or handoffs with missing vitals.
