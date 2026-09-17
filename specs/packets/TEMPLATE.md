---
id: <slug>
status: draft
skill: <food-calc | biomarkers | sync-jobs | debug-contract>
edit_mode: patch
allowed_files: []
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
gate: []
---

# Packet: <journey name>

Agent fills this. Human replies: go | stop | one comment.

## Journey
<what “better” means, one paragraph>

## Findings (do not redo)
- …

## Plan
1. … Done when: …
2. … Done when: …

## Test plan
```text
npx tsc --noEmit
npx vitest run <named files from DOMAIN_REGRESSION_MAP.md>
node scripts/journey-guard.mjs <slug>
```

## Audit plan
1. Scope vs ROADMAP (no silent extra IDs)
2. <debug contract / one frozen example / class list>
3. Honest residual named, not painted

## Blast radius
Allowed / Frozen are the YAML lists above.
Out of scope: …

## Stop and come back
Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested
