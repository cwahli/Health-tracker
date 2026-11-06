---
id: MCP-FOCUS-PULL
status: locked
class: MCP_FOCUS_PULL
edit_mode: patch
skill: builder
allowed_files:
  - src/hooks/useAppSync.ts
  - src/utils/focusPull.ts
  - src/utils/focusPull.test.ts
frozen_files:
  - server_routes_mcp.ts
  - server_db_d1.ts
  - docs/agent/standing.json
  - src/App.tsx
gate:
  - npx vitest run src/utils/focusPull.test.ts
---

# MCP-FOCUS-PULL — pull cloud changes when the tab is shown or the window focuses

## Goal
When the website tab becomes visible or the window focuses, pull cloud changes with the existing incremental sync (`checkForDbChanges`, non-force). The 5s debounce already inside that function is the only debounce.

## In scope
- Pure `bindFocusPull` (visibilitychange + window focus, unbind on return).
- `useAppSync` `useEffect` (empty deps) calling `checkForDbChangesRef.current?.(undefined, false)`.
- Vitest for the helper and the wiring string.

## Out of scope
- A second debounce timer.
- Server upsert guard (already on main).
- `server_routes_mcp.ts`, `server_db_d1.ts`, `docs/agent/standing.json`, `src/App.tsx`.

## Done when
1. `npx vitest run src/utils/focusPull.test.ts` exits 0.
2. `git diff --name-only` ⊆ allowed_files plus this spec.
