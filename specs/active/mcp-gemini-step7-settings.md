---
id: mcp-gemini-step7-settings
status: done
class: MCP_SETTINGS_UI
edit_mode: patch
skill: builder
auto_go: false
allowed_files:
  - server_routes_mcp_auth.ts
  - server_d1_schema.ts
  - server_mcp.test.ts
  - src/components/Header.tsx
  - src/components/GeminiMcpConnectCard.tsx
  - src/components/GeminiMcpConnectCard.test.tsx
  - src/utils/geminiMcpCopy.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
  - specs/active/mcp-gemini-step7-settings.md
frozen_files:
  - src/components/ProfileModal.tsx
  - src/utils/translations/en.ts
  - src/utils/translations/id.ts
  - src/utils/translations/fr.ts
  - src/utils/translations/zh.ts
  - src/utils/translations.test.ts
  - src/App.tsx
  - server.ts
  - docs/agent/standing.json
  - AGENTS.md
gate:
  - npx vitest run server_mcp.test.ts src/components/GeminiMcpConnectCard.test.tsx
  - npx tsc --noEmit
  - node scripts/journey-guard.mjs mcp-gemini-step7-settings
---

# MCP-GEMINI-STEP7 — Settings UI and i18n

**Done 2026-10-29.** The settings card is on main. Do not re-execute this packet. The live handshake stays closed for now. `auto_go` is false so an unattended run does not pick it up.

## Journey
A signed-in person opens the profile dialog and can copy the MCP server URL, create a Gemini client id and secret, and revoke that access. The secret is shown once. Revoke stops that person's Gemini sessions and does not touch another person's client.

## Findings
- Phase 7 in `plan/GEMINI_MCP_INTEGRATION_PLAN.md` is the settings card: MCP URL, client id, client secret, revoke, in en, id, fr, and zh.
- Gemini consumer apps register themselves. The static id and secret are the fallback Gemini shows under "Show more", plus the Enterprise redirect `https://vertexaisearch.cloud.google.com/oauth-redirect`.
- Open PR #781 owns `ProfileModal.tsx` and the four translation packs. This step mounts the card from `Header.tsx` into the profile dialog and keeps the four languages in `src/utils/geminiMcpCopy.ts`.

## Plan
1. Session routes `GET /api/mcp/settings`, `POST /api/mcp/settings/client`, and `POST /api/mcp/settings/revoke` on the existing MCP auth router. A client with a secret hash must present that secret at the token endpoint. Revoked clients cannot start a new grant.
2. The profile dialog shows the card in the signed-in user's language, with copy, create, and a two-click revoke.
3. Named tests cover the credential lifecycle and the four-language card.

## Test plan
```text
npx vitest run server_mcp.test.ts src/components/GeminiMcpConnectCard.test.tsx
npx tsc --noEmit
node scripts/journey-guard.mjs mcp-gemini-step7-settings
```

## Audit plan
1. Scope stays on Step 7. The live gemini.google.com handshake stays a human check.
2. The secret is not returned by GET and is not written to the client list.
3. Residual: dictionary strings move into `translations/*.ts` after #781 merges. The live Gemini connect is not run from this box.

## Blast radius
Allowed files are the YAML list. ProfileModal and the translation packs stay frozen while #781 is open.
