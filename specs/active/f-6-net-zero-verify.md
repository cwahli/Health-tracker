---
id: f-6-net-zero-verify
status: locked
skill: food-ui
edit_mode: patch
allowed_files:
  - specs/active/f-6-net-zero-verify.md
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - server_vision_scout.ts
  - src/components/chat-cards/FoodCard.tsx
  - docs/agent/standing.json
  - scripts/journey-guard.mjs
  - AGENTS.md
gate:
  - node scripts/assert-budgets.mjs
---
# F-6 — net-zero verify (no prod change) — PACKET (locked)

## Goal
ROADMAP F-6: FoodCard net-zero toward ~3800, no new food table, no +100-line enhances.

## Measurement (2026-09-15 session)
- `src/components/chat-cards/FoodCard.tsx` = 3336 lines — already under the ~3800 target. No trim needed.
- Session added 0 lines to food UI (F-3/F-4 touched scout/reconcile tests only).
- `assert-budgets.mjs`: 3 pre-existing `GOD_FILE_GROWTH` fails — App.tsx 9359/9200, LogChat 7282/7000, server_vision_scout.ts 2148/1800. These predate this session (only +10 net App.tsx from B7.6 since `48a87ee`); fixing them is Q-9-class split work, explicitly forbidden here (no god-file rewrite, no drive-by split).

## Law
- Verify-only ID: this packet changes no application code. Record residuals honestly in `AI_HANDOVER.md`.

## Sensor
- `assert-budgets.mjs` output archived in the commit message / handover line. No new test (budgets script is the sensor).

## Gates
`node scripts/assert-budgets.mjs` (expected: same 3 pre-existing fails, zero food-UI growth) · `node scripts/journey-guard.mjs f-6-net-zero-verify`.

## Status: LOCKED
