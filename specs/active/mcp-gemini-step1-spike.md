---
id: MCP-GEMINI-SPIKE-1
status: locked
class: MCP_OAUTH_STREAMABLE_HTTP
edit_mode: patch
skill: builder
auto_go: true
allowed_files:
  - server.ts
  - server_d1_schema.ts
  - server_routes_mcp.ts
  - server_routes_mcp_auth.ts
  - server_mcp.test.ts
  - plan/ROADMAP.md
  - AI_HANDOVER.md
frozen_files:
  - agents/**
  - server_dish_finalize.ts
  - server_derivation.ts
  - src/jobs/JobStore.ts
  - src/jobs/SupabaseJobSync.ts
  - .github/workflows/ci.yml
gate:
  - npx tsc --noEmit
  - npx vitest run server_mcp.test.ts
---

# MCP-GEMINI-SPIKE-1 — Step 1: Handshake Spike & Demonstration

## 1. Objective
Establish the foundational Model Context Protocol (MCP) Streamable HTTP endpoint and OAuth 2.1 authentication chain on `health-tracker.co.uk`. Demonstrate live from Google Gemini (`gemini.google.com`) that Gemini can authenticate, establish an MCP connection, and query user profile data (`manage_home(action: 'get_profile')`) with strict multi-tenant profile isolation.

## 2. Invariants & Scope
- **OAuth 2.1 Standard:** Implement RFC 9728 (Protected Resource Metadata), RFC 8414 (Authorization Server Metadata), RFC 7591 (Dynamic Client Registration), and RFC 7636 (PKCE with S256).
- **Challenge:** Unauthenticated calls to `POST /api/mcp` return HTTP 401 with `WWW-Authenticate` header pointing to metadata and authorization endpoints.
- **Profile Binding:** Token binds to the `canonicalUid` of the authenticated user at `/oauth/authorize`.
- **MCP Protocol:** Streamable HTTP JSON-RPC 2.0 handler supporting `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
- **First Tool:** `manage_home` with action `get_profile`.
- **Testing:** Comprehensive test suite in `server_mcp.test.ts` covering discovery, registration, PKCE code flow, token exchange, and tool invocation.
