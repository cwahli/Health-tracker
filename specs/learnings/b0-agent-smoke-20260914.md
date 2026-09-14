---
slug: b0-agent-smoke
date: 2026-09-14
class: PROCESS_GAP
node: Builder
status: draft
---

# Learning: front-desk smoke tests must settle client-side, and extract math must live in one table

## What happened
1. **Server poll can never settle a front-desk job.** `pollJobUntilTerminal` polls `GET /api/jobs/status`, but front-desk jobs are client-only by design (`SupabaseJobSync`: excluded from cloud sync and hydration polling). A scripted B0 smoke spun 8 minutes on `lastStatus: unknown` while the desk run had completed successfully on screen (reply + Extracted Biomarkers Panel rendered).
2. **The smoke caught a real SECOND_MATH_PATH.** Live extract wrote TG 125 mg/dL as 3.23 (cholesterol ×0.02586), creatinine as 80, HDL/LDL truncated: `src/server/biomarkers/backoffice.ts` `convertViaTable` carried local factors instead of `ANALYTE_CONVERSIONS`. Fixed by delegating to the shared table; hba1c/bun legacy branches kept verbatim (no table rows; lifecycle's hba1c branch is dead code — also recorded, not fixed).
3. **Persisted-state asserts must match the architecture.** Extract auto-land stores converted values directly; `observationMeta` raw preservation is Review-path behavior (proven by G-B1 `applyModificationCommands` tests). Asserting storage shapes the UI never promises burns runs. Assert panel/history UI text for live; leave meta to unit tests.
4. **Model prose rounds.** Reply text says 1.29/1.41/3.36/79.5 while structured values are exact (1.293/1.411/3.362/79.56). Assert structured panel/history, never prose (L12).

## What the user asked
1. "how do I apply smoke" → "Can you do that?" → "Can't you open the live site ... you don't need hand" → "Can't you use your own ID or demo account" → "it shouldn't stall locally ... investigate, download the debug, fix" → "take your learning so future smoke tests run by agent".

## Keep
- `pollFrontDeskSettled` + auto-branch in `pollJobUntilTerminal` (`prototype/tests/indo-journey-helpers.ts`): `job_frontdesk_*` settles on Extracted Biomarkers Panel, never server poll.
- `prototype/tests/b0-apply-smoke.live.spec.ts`: fresh Sari → SI seed → US send → five locks → UI debug download → history asserts. Green live in ~90s.
- Backoffice delegation to `ANALYTE_CONVERSIONS` (prod + prototype mirror) with G-B1 lock Sensor in `tests/golden_biomarker.test.ts`.
- Debug artifacts land in `golden/scorecard/current/debug/` (B0 precedent, like L-1).

## Propose standing (add only)
```json
{
  "id": "frontdesk_client_settle",
  "label": "Front-desk jobs are client-only: live specs settle on client signals, never server poll",
  "asked": "repeated",
  "files_must_contain": {
    "prototype/tests/indo-journey-helpers.ts": ["pollFrontDeskSettled", "job_frontdesk_"],
    "src/jobs/SupabaseJobSync.ts": ["Do not sync ephemeral front desk triage conversations"]
  }
}
```

## Cost note
Each B0 live run ≈ 2 model calls (SI seed + US send), ~2–9 min wall. Server-poll spins cost 8 dead minutes + the same quota — the branch eliminates that class of waste.
