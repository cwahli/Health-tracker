import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import crypto from 'crypto';
import { mcpAuthRouter, resetMcpAuthStore, resolveCanonicalUid } from './server_routes_mcp_auth.js';
import {
  mcpRouter,
  setInMemoryMcpProfile,
  clearInMemoryMcpProfiles,
  setInMemoryMcpFoods,
  setInMemoryMcpBiomarkers,
  clearInMemoryMcpData,
  toYYYYMMDD,
  getYesterdayYYYYMMDD,
  getCurrentDateInTimezone,
  getYesterdayInTimezone,
  formatTimeInTimezone,
  mergeTargetsWithRatchet
} from './server_routes_mcp.js';
import { ADMIN_CREDENTIALS, registerUser, signSessionToken } from './server_auth.js';

let app: express.Express;
let server: Server;
let baseUrl = '';

beforeEach(async () => {
  // Ensure live D1 is not called during unit tests
  delete process.env.CLOUDFLARE_D1_DATABASE_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_D1_API_TOKEN;

  resetMcpAuthStore();
  clearInMemoryMcpData();

  if (!app) {
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(mcpAuthRouter);
    app.use(mcpRouter);

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// Helper to generate PKCE pair
function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('MCP OAuth 2.1 & Streamable HTTP Handshake Spike', () => {
  describe('Metadata Discovery (RFC 9728 & RFC 8414)', () => {
    it('serves RFC 9728 OAuth Protected Resource Metadata', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.resource).toBe(baseUrl);
      expect(data.authorization_servers).toContain(baseUrl);
      expect(data.scopes_supported).toContain('mcp:full');
    });

    it('serves RFC 8414 OAuth Authorization Server Metadata', async () => {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.issuer).toBe(baseUrl);
      expect(data.authorization_endpoint).toBe(`${baseUrl}/oauth/authorize`);
      expect(data.token_endpoint).toBe(`${baseUrl}/api/oauth/token`);
      expect(data.registration_endpoint).toBe(`${baseUrl}/api/oauth/register`);
      expect(data.code_challenge_methods_supported).toEqual(['S256']);
      expect(data.grant_types_supported).toContain('authorization_code');
      expect(data.grant_types_supported).toContain('refresh_token');
    });

    it('serves OpenID configuration alias identical to RFC 8414', async () => {
      const res = await fetch(`${baseUrl}/.well-known/openid-configuration`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authorization_endpoint).toBe(`${baseUrl}/oauth/authorize`);
    });
  });

  describe('Dynamic Client Registration (RFC 7591)', () => {
    it('registers a new MCP client successfully', async () => {
      const regRes = await fetch(`${baseUrl}/api/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Google Gemini MCP',
          redirect_uris: ['https://gemini.google.com/oauth/callback']
        })
      });
      expect(regRes.status).toBe(201);
      const data = await regRes.json();
      expect(data.client_id).toMatch(/^mcp_client_[a-f0-9]+$/);
      expect(data.redirect_uris).toEqual(['https://gemini.google.com/oauth/callback']);
    });

    it('rejects client registration with missing redirect_uris', async () => {
      const regRes = await fetch(`${baseUrl}/api/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Invalid Client' })
      });
      expect(regRes.status).toBe(400);
      const err = await regRes.json();
      expect(err.error).toBe('invalid_client_metadata');
    });
  });

  describe('Unauthenticated MCP Challenge', () => {
    it('returns 401 with WWW-Authenticate header when Bearer token is omitted', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      });
      expect(res.status).toBe(401);
      const authHeader = res.headers.get('www-authenticate');
      expect(authHeader).toBeTruthy();
      expect(authHeader).toContain('Bearer resource_metadata=');
      expect(authHeader).toContain('/.well-known/oauth-protected-resource');

      const body = await res.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error?.code).toBe(-32000);
    });

    it('returns 401 when token is invalid or corrupted', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer htk.invalid_payload_base64.fake_sig'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
    });
  });

  describe('OAuth 2.1 Code + PKCE Flow and Token Exchange', () => {
    it('enforces PKCE S256 on authorization page', async () => {
      // Missing code_challenge
      const resNoChallenge = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=test&redirect_uri=https://example.com/cb`);
      expect(resNoChallenge.status).toBe(400);

      // Unsupported plain challenge method
      const resPlain = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=test&redirect_uri=https://example.com/cb&code_challenge=xyz&code_challenge_method=plain`);
      expect(resPlain.status).toBe(400);

      // Valid params render consent HTML page
      const pkce = generatePkcePair();
      const resOk = await fetch(`${baseUrl}/oauth/authorize?response_type=code&client_id=test&redirect_uri=https://example.com/cb&code_challenge=${pkce.challenge}&code_challenge_method=S256`);
      expect(resOk.status).toBe(200);
      const html = await resOk.text();
      expect(html).toContain('Connect Health-tracker to Gemini');
      expect(html).toContain('Health-tracker Email');
      expect(html).toContain('Continue with Google');
      expect(html).toContain('firebase-app-compat.js');
    });

    it('completes the full OAuth 2.1 PKCE authorization and token exchange', async () => {
      const pkce = generatePkcePair();
      const redirectUri = 'https://gemini.google.com/oauth/callback';
      const stateParam = 'random_client_state_123';

      // 1. Post credentials to /oauth/authorize (signing in as Admin user)
      const authRes = await fetch(`${baseUrl}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: ADMIN_CREDENTIALS.email,
          password: ADMIN_CREDENTIALS.password,
          client_id: 'test_client_id',
          redirect_uri: redirectUri,
          state: stateParam,
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256'
        }).toString(),
        redirect: 'manual'
      });

      expect(authRes.status).toBe(302);
      const location = authRes.headers.get('location');
      expect(location).toBeTruthy();
      const redirectParsed = new URL(location!);
      expect(redirectParsed.origin + redirectParsed.pathname).toBe(redirectUri);
      expect(redirectParsed.searchParams.get('state')).toBe(stateParam);

      const authCode = redirectParsed.searchParams.get('code');
      expect(authCode).toMatch(/^mcp_code_/);

      // 2. Token exchange with INVALID PKCE verifier -> must fail with 400 invalid_grant
      const badTokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri,
          code_verifier: 'wrong_verifier_does_not_hash_to_challenge'
        })
      });
      expect(badTokenRes.status).toBe(400);
      const badJson = await badTokenRes.json();
      expect(badJson.error).toBe('invalid_grant');

      // 3. Token exchange with VALID PKCE verifier -> succeeds with 200
      const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier
        })
      });
      expect(tokenRes.status).toBe(200);
      const tokenData = await tokenRes.json();
      expect(tokenData.access_token).toBeTruthy();
      expect(tokenData.token_type).toBe('Bearer');
      expect(tokenData.refresh_token).toMatch(/^mcp_rt_/);
      expect(tokenData.scope).toBe('mcp:full');

      // 4. Code Replay protection -> code cannot be used a second time
      const replayRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier
        })
      });
      expect(replayRes.status).toBe(400);
      const replayJson = await replayRes.json();
      expect(replayJson.error).toBe('invalid_grant');

      // 5. Refresh token exchange
      const refreshRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token
        })
      });
      expect(refreshRes.status).toBe(200);
      const refreshData = await refreshRes.json();
      expect(refreshData.access_token).toBeTruthy();
    });

    it('authenticates via Google OAuth Firebase ID token and binds canonical UID', async () => {
      const pkce = generatePkcePair();
      const redirectUri = 'https://gemini.google.com/oauth/callback';
      const googleEmail = 'cwah.liu@gmail.com';
      const fakeGoogleToken = `test_firebase_token_google_user_99__${googleEmail}`;

      const authRes = await fetch(`${baseUrl}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          firebase_id_token: fakeGoogleToken,
          client_id: 'test_client_id',
          redirect_uri: redirectUri,
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256'
        }).toString(),
        redirect: 'manual'
      });

      expect(authRes.status).toBe(302);
      const location = authRes.headers.get('location');
      expect(location).toBeTruthy();
      const authCode = new URL(location!).searchParams.get('code');
      expect(authCode).toMatch(/^mcp_code_/);

      const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier
        })
      });

      expect(tokenRes.status).toBe(200);
      const tokenData = await tokenRes.json();
      expect(tokenData.access_token).toBeTruthy();

      // Check that this token is bound to canonical Chiwah UID
      setInMemoryMcpProfile('hiJun2hTdDTk2igwerun2LKvwb42', {
        nickname: 'Chiwah Google',
        email: googleEmail,
        weight: 70
      });

      const mcpRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenData.access_token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });

      expect(mcpRes.status).toBe(200);
      const mcpBody = await mcpRes.json();
      const resultObj = JSON.parse(mcpBody.result.content[0].text);
      expect(resultObj.profile.nickname).toBe('Chiwah Google');
      expect(resultObj.profile.email).toBe(googleEmail);
    });

    it('authenticates via active session token (localStorage auth_token)', async () => {
      const pkce = generatePkcePair();
      const redirectUri = 'https://gemini.google.com/oauth/callback';
      const existingToken = signSessionToken({
        uid: 'user_active_session_123',
        email: 'active@example.com',
        nickname: 'Active User'
      });

      const authRes = await fetch(`${baseUrl}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          auth_token: existingToken,
          client_id: 'test_client_id',
          redirect_uri: redirectUri,
          code_challenge: pkce.challenge,
          code_challenge_method: 'S256'
        }).toString(),
        redirect: 'manual'
      });

      expect(authRes.status).toBe(302);
      const location = authRes.headers.get('location');
      expect(location).toBeTruthy();
      const authCode = new URL(location!).searchParams.get('code');
      expect(authCode).toMatch(/^mcp_code_/);

      const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier
        })
      });

      expect(tokenRes.status).toBe(200);
      const tokenData = await tokenRes.json();
      expect(tokenData.access_token).toBeTruthy();
    });
  });

  describe('MCP Streamable HTTP JSON-RPC Protocol & Tool Execution', () => {
    let accessTokenA: string;
    let accessTokenB: string;
    const uidA = resolveCanonicalUid(ADMIN_CREDENTIALS.uid, ADMIN_CREDENTIALS.email);
    let uidB: string;

    beforeEach(async () => {
      // Set up Persona A (Admin / Chiwah)
      const pkceA = generatePkcePair();
      const authResA = await fetch(`${baseUrl}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: ADMIN_CREDENTIALS.email,
          password: ADMIN_CREDENTIALS.password,
          redirect_uri: 'https://example.com/cb',
          code_challenge: pkceA.challenge,
          code_challenge_method: 'S256'
        }).toString(),
        redirect: 'manual'
      });
      const codeA = new URL(authResA.headers.get('location')!).searchParams.get('code')!;
      const tokenResA = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: codeA,
          redirect_uri: 'https://example.com/cb',
          code_verifier: pkceA.verifier
        })
      });
      const jsonA = await tokenResA.json();
      accessTokenA = jsonA.access_token;

      // Set up Persona B (Standard user)
      const userBEmail = `persona_b_${Date.now()}_${Math.random().toString(36).substring(2)}@test.com`;
      const userBPass = 'Password123!';
      const regB = await registerUser(userBEmail, userBPass, 'Persona B');
      uidB = regB.user!.uid;

      const pkceB = generatePkcePair();
      const authResB = await fetch(`${baseUrl}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: userBEmail,
          password: userBPass,
          redirect_uri: 'https://example.com/cb',
          code_challenge: pkceB.challenge,
          code_challenge_method: 'S256'
        }).toString(),
        redirect: 'manual'
      });
      const codeB = new URL(authResB.headers.get('location')!).searchParams.get('code')!;
      const tokenResB = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: codeB,
          redirect_uri: 'https://example.com/cb',
          code_verifier: pkceB.verifier
        })
      });
      const jsonB = await tokenResB.json();
      accessTokenB = jsonB.access_token;

      // Pre-seed mock profile data for Persona A and Persona B
      setInMemoryMcpProfile(uidA, {
        profile: {
          nickname: 'C. Liu',
          language: 'en',
          targets: { calories: 2200, protein: 160 }
        },
        report: { dailyNutrientTargets: { calories: 2200 } }
      });

      setInMemoryMcpProfile(uidB, {
        profile: {
          nickname: 'Persona B',
          language: 'id',
          targets: { calories: 1800, protein: 110 }
        },
        report: { dailyNutrientTargets: { calories: 1800 } }
      });
    });

    it('performs initialize handshake', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'Gemini', version: '1.0' }
          }
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe('init-1');
      expect(data.result.protocolVersion).toBe('2024-11-05');
      expect(data.result.serverInfo.name).toBe('health-tracker-mcp');
      expect(data.result.capabilities.tools).toBeDefined();
    });

    it('handles ping and notifications/initialized', async () => {
      const initRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized'
        })
      });
      expect(initRes.status).toBe(200);

      const pingRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'ping'
        })
      });
      expect(pingRes.status).toBe(200);
      const pingJson = await pingRes.json();
      expect(pingJson.id).toBe(42);
      expect(pingJson.result).toEqual({});
    });

    it('lists available tools including manage_home', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tools-list-1',
          method: 'tools/list'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools).toBeInstanceOf(Array);
      const homeTool = data.result.tools.find((t: any) => t.name === 'manage_home');
      expect(homeTool).toBeDefined();
      expect(homeTool.inputSchema.properties.action.enum).toContain('get_profile');
    });

    it('executes manage_home:get_profile with strict multi-tenant isolation', async () => {
      // 1. Query with Persona A's access token
      const resA = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'call-a',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });

      expect(resA.status).toBe(200);
      const jsonA = await resA.json();
      expect(jsonA.id).toBe('call-a');
      expect(jsonA.result.content[0].type).toBe('text');
      const payloadA = JSON.parse(jsonA.result.content[0].text);
      expect(payloadA.canonicalUid).toBe(uidA);
      expect(payloadA.profile.nickname).toBe('C. Liu');
      expect(payloadA.targets.calories).toBe(2200);

      // 2. Query with Persona B's access token
      const resB = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenB}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'call-b',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });

      expect(resB.status).toBe(200);
      const jsonB = await resB.json();
      expect(jsonB.id).toBe('call-b');
      const payloadB = JSON.parse(jsonB.result.content[0].text);
      expect(payloadB.canonicalUid).toBe(uidB);
      expect(payloadB.profile.nickname).toBe('Persona B');
      expect(payloadB.targets.calories).toBe(1800);

      // Multi-tenant isolation verified: A's payload does not have B's data, and B's does not have A's data
      expect(payloadA.canonicalUid).not.toBe(payloadB.canonicalUid);
      expect(payloadA.targets.calories).not.toBe(payloadB.targets.calories);
    });

    it('returns structured MCP error for unsupported tool actions', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bad-act',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'non_existent_action' }
          }
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toContain('Unsupported action');
    });

    it('returns -32601 Method not found for unregistered tools', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessTokenA}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bad-tool',
          method: 'tools/call',
          params: {
            name: 'non_existent_tool',
            arguments: {}
          }
        })
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe(-32601);
    });
  });

  describe('Step 2: Domain Query Tools & Allowance Progress (manage_home, manage_meals, manage_biomarkers)', () => {
    let accessToken: string;
    const testUid = 'user_test_step2';
    const testEmail = 'step2_tester@health-tracker.co.uk';

    beforeEach(async () => {
      // Create test user and obtain Bearer token via registration + token exchange
      const regRes = await fetch(`${baseUrl}/api/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Gemini Step2 Test',
          redirect_uris: ['https://gemini.google.com/oauth/callback']
        })
      });
      const client = await regRes.json();
      const { verifier, challenge } = generatePkcePair();
      const existingToken = signSessionToken({
        uid: testUid,
        email: testEmail,
        nickname: 'Chiwah'
      });

      const authRes = await fetch(`${baseUrl}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          auth_token: existingToken,
          client_id: client.client_id,
          redirect_uri: 'https://gemini.google.com/oauth/callback',
          code_challenge: challenge,
          code_challenge_method: 'S256'
        }).toString(),
        redirect: 'manual'
      });
      const code = new URL(authRes.headers.get('location')!).searchParams.get('code')!;

      const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: client.client_id,
          redirect_uri: 'https://gemini.google.com/oauth/callback',
          code_verifier: verifier
        })
      });
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
    });

    it('lists all Step 2 tools in tools/list', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const toolNames = data.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('manage_home');
      expect(toolNames).toContain('manage_meals');
      expect(toolNames).toContain('manage_biomarkers');
    });

    it('calculates exact allowance progress for today and yesterday (answering allowance query)', async () => {
      const today = toYYYYMMDD(new Date());
      const yesterday = getYesterdayYYYYMMDD(today);

      setInMemoryMcpProfile(testUid, {
        profile: {
          id: testUid,
          nickname: 'Chiwah',
          targets: {
            calories: 1651,
            saturatedFat: '15 g',
            totalFibre: '30 g',
            sodium: '1500 mg'
          }
        },
        report: {
          dailyNutrientTargets: {
            calories: '1,651 kcal'
          }
        }
      });

      // Seed meals for today: 600 kcal lunch + 350 kcal snack = 950 kcal
      // Seed meals for yesterday: 750 kcal + 670 kcal = 1420 kcal
      const mockFoods = [
        {
          id: 'meal-today-1',
          firebase_uid: testUid,
          date: today,
          name: 'Grilled Chicken Bowl',
          composition: 'Chicken breast, brown rice, broccoli',
          calories: 600,
          saturated_fat: 4,
          sodium: 600,
          nutrients: { calories: 600, protein: 45, carbohydrates: 50, totalFat: 20, saturatedFat: 4, totalFibre: 10, sodium: 600 },
          image_urls: ['chicken.jpg']
        },
        {
          id: 'meal-today-2',
          firebase_uid: testUid,
          date: today,
          name: 'Greek Yogurt & Berries',
          composition: 'Greek yogurt, blueberries, chia seeds',
          calories: 350,
          saturated_fat: 2,
          sodium: 100,
          nutrients: { calories: 350, protein: 20, carbohydrates: 40, totalFat: 5, saturatedFat: 2, totalFibre: 6, sodium: 100 },
          image_urls: ['/photos/yogurt.jpg']
        },
        {
          id: 'meal-yest-1',
          firebase_uid: testUid,
          date: yesterday,
          name: 'Salmon Salad',
          composition: 'Wild salmon, avocado, mixed greens',
          calories: 750,
          saturated_fat: 6,
          sodium: 500,
          nutrients: { calories: 750, protein: 50, carbohydrates: 20, totalFat: 35, saturatedFat: 6, totalFibre: 8, sodium: 500 }
        },
        {
          id: 'meal-yest-2',
          firebase_uid: testUid,
          date: yesterday,
          name: 'Steak and Veggies',
          composition: 'Sirloin steak, asparagus, sweet potato',
          calories: 670,
          saturated_fat: 10,
          sodium: 700,
          nutrients: { calories: 670, protein: 55, carbohydrates: 15, totalFat: 30, saturatedFat: 10, totalFibre: 7, sodium: 700 }
        }
      ];
      setInMemoryMcpFoods(testUid, mockFoods);

      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'allowance-check',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_allowance_progress' }
          }
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.isError).toBeFalsy();
      const progress = JSON.parse(json.result.content[0].text);

      expect(progress.baseline_daily_allowance_kcal).toBe(1651);

      // Verify Today: 950 consumed, 701 remaining (58%)
      expect(progress.today.date).toBe(today);
      expect(progress.today.target_allowance_kcal).toBe(1651);
      expect(progress.today.consumed_kcal).toBe(950);
      expect(progress.today.remaining_kcal).toBe(701);
      expect(progress.today.percentage_reached).toBe(58);
      expect(progress.today.status).toBe('within_allowance');
      expect(progress.today.meal_count).toBe(2);
      expect(progress.today.nutrients.saturated_fat.ceiling_exceeded).toBe(false);
      expect(progress.today.meals[0].photos[0]).toBe('https://health-tracker.co.uk/photos/chicken.jpg');

      // Verify Yesterday: 1420 consumed, 231 remaining (86%)
      expect(progress.yesterday.date).toBe(yesterday);
      expect(progress.yesterday.target_allowance_kcal).toBe(1651);
      expect(progress.yesterday.consumed_kcal).toBe(1420);
      expect(progress.yesterday.remaining_kcal).toBe(231);
      expect(progress.yesterday.percentage_reached).toBe(86);
      expect(progress.yesterday.status).toBe('within_allowance');
      expect(progress.yesterday.meal_count).toBe(2);
      expect(progress.yesterday.nutrients.saturated_fat.ceiling_exceeded).toBe(true); // 16g > 15g
    });

    it('updates nutrient targets via set_targets and reflects immediately', async () => {
      setInMemoryMcpProfile(testUid, {
        profile: { id: testUid, targets: { calories: 1651 } }
      });

      const updateRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'set-targets-1',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'set_targets',
              targets: { calories: 1750, saturatedFat: '14 g', totalFibre: '32 g' }
            }
          }
        })
      });

      expect(updateRes.status).toBe(200);
      const updateJson = await updateRes.json();
      const updateData = JSON.parse(updateJson.result.content[0].text);
      expect(updateData.success).toBe(true);
      expect(updateData.updated_targets.calories).toBe(1750);

      // Verify get_profile reflects the updated targets
      const getProfRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-prof-after-set',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });
      const profJson = await getProfRes.json();
      const profData = JSON.parse(profJson.result.content[0].text);
      expect(profData.targets.calories).toBe(1750);
      expect(profData.targets.saturatedFat).toBe('14 g');
    });

    it('filters meals by date, date range, search keyword and converts photo URLs', async () => {
      const today = toYYYYMMDD(new Date());
      const yesterday = getYesterdayYYYYMMDD(today);

      const foods = [
        {
          id: 'meal-m1',
          firebase_uid: testUid,
          date: today,
          name: 'Pacific Salmon & Asparagus',
          composition: 'Wild salmon, olive oil, lemon',
          calories: 550,
          image_urls: ['173000_salmon.jpg'],
          items_breakdown: [{ name: 'Wild salmon fillet', weight_grams: 200, calories: 400 }]
        },
        {
          id: 'meal-m2',
          firebase_uid: testUid,
          date: yesterday,
          name: 'Quinoa Veggie Salad',
          composition: 'Quinoa, cucumber, bell pepper, feta',
          calories: 420,
          image_urls: ['https://cdn.example.com/custom.png'],
          items_breakdown: [{ name: 'Quinoa', weight_grams: 150, calories: 250 }]
        }
      ];
      setInMemoryMcpFoods(testUid, foods);

      // 1. Filter by date: today
      const todayRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-today',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: { action: 'list', date: today }
          }
        })
      });
      const todayData = JSON.parse((await todayRes.json()).result.content[0].text);
      expect(todayData.meals.length).toBe(1);
      expect(todayData.meals[0].name).toBe('Pacific Salmon & Asparagus');
      expect(todayData.meals[0].image_urls[0]).toBe('https://health-tracker.co.uk/photos/173000_salmon.jpg');

      // 2. Search keyword: 'quinoa'
      const searchRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'search-quinoa',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: { action: 'list', search: 'quinoa' }
          }
        })
      });
      const searchData = JSON.parse((await searchRes.json()).result.content[0].text);
      expect(searchData.meals.length).toBe(1);
      expect(searchData.meals[0].id).toBe('meal-m2');
      expect(searchData.meals[0].image_urls[0]).toBe('https://cdn.example.com/custom.png');

      // 3. Get Detail
      const detailRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'meal-detail',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: { action: 'get_detail', meal_id: 'meal-m1' }
          }
        })
      });
      const detailData = JSON.parse((await detailRes.json()).result.content[0].text);
      expect(detailData.id).toBe('meal-m1');
      expect(detailData.items_breakdown[0].name).toBe('Wild salmon fillet');
      expect(detailData.image_urls[0]).toBe('https://health-tracker.co.uk/photos/173000_salmon.jpg');
    });

    it('lists biomarker records and computes longitudinal trends', async () => {
      const bioLogs = [
        {
          id: 'bio-1',
          firebase_uid: testUid,
          date: '2026-08-01',
          biomarkers: { cholesterol: '5.8 mmol/L', hba1c: '5.4 %', vitaminD: '40 nmol/L' }
        },
        {
          id: 'bio-2',
          firebase_uid: testUid,
          date: '2026-09-01',
          biomarkers: { cholesterol: '5.2 mmol/L', hba1c: '5.3 %', vitaminD: '50 nmol/L' }
        },
        {
          id: 'bio-3',
          firebase_uid: testUid,
          date: '2026-10-01',
          biomarkers: { cholesterol: '4.9 mmol/L', hba1c: '5.1 %', vitaminD: '62 nmol/L' }
        }
      ];
      setInMemoryMcpBiomarkers(testUid, bioLogs);

      // 1. List with key filtering
      const listRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bio-list',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: { action: 'list', keys: ['cholesterol'] }
          }
        })
      });
      const listData = JSON.parse((await listRes.json()).result.content[0].text);
      expect(listData.biomarker_logs.length).toBe(3);
      expect(listData.biomarker_logs[0].biomarkers.cholesterol).toBeDefined();
      expect(listData.biomarker_logs[0].biomarkers.vitaminD).toBeUndefined();

      // 2. Get Trends
      const trendRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bio-trends',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: { action: 'get_trends', keys: ['cholesterol', 'vitaminD'] }
          }
        })
      });
      const trendData = JSON.parse((await trendRes.json()).result.content[0].text);
      const chTrend = trendData.trends.cholesterol;
      expect(chTrend.readings_count).toBe(3);
      expect(chTrend.latest.value).toBe(4.9);
      expect(chTrend.previous.value).toBe(5.2);
      expect(chTrend.min.value).toBe(4.9);
      expect(chTrend.max.value).toBe(5.8);
      expect(chTrend.delta).toBe(-0.3);
      expect(chTrend.trend).toBe('decreasing');

      const vitTrend = trendData.trends.vitaminD;
      expect(vitTrend.readings_count).toBe(3);
      expect(vitTrend.latest.value).toBe(62);
      expect(vitTrend.delta).toBe(12);
      expect(vitTrend.trend).toBe('increasing');
    });
  });

  describe('Step 3: Timezone Alignment & Server-Side Sync Ratchet', () => {
    const testUid = 'user_step3_tz_ratchet';
    const testEmail = 'tz_test@example.com';
    let accessToken: string;

    beforeEach(() => {
      accessToken = signSessionToken({
        uid: testUid,
        email: testEmail,
        nickname: 'Tz Ratchet User'
      });
      setInMemoryMcpProfile(testUid, {
        profile: {
          id: testUid,
          email: testEmail,
          timezone: 'Europe/London',
          targets: { calories: 1800, saturatedFat: 15 }
        },
        report: {
          dailyNutrientTargets: { calories: 1800, saturatedFat: 15 }
        }
      });
    });

    it('resolves timezone-aware dates and relative date tokens correctly', () => {
      // 1. Relative tokens 'today' and 'yesterday'
      const londonToday = getCurrentDateInTimezone('Europe/London');
      const londonYesterday = getYesterdayInTimezone('Europe/London');
      expect(toYYYYMMDD('today', 'Europe/London')).toBe(londonToday);
      expect(toYYYYMMDD('yesterday', 'Europe/London')).toBe(londonYesterday);

      // 2. Cross-day boundary check for UTC timestamp
      // 2026-10-27T23:30:00Z: in Tokyo (UTC+9) it is 2026-10-28; in New York (UTC-4) it is 2026-10-27
      const ts = '2026-10-27T23:30:00.000Z';
      const tokyoDate = toYYYYMMDD(ts, 'Asia/Tokyo');
      const nyDate = toYYYYMMDD(ts, 'America/New_York');
      expect(tokyoDate).toBe('2026-10-28');
      expect(nyDate).toBe('2026-10-27');

      // 3. formatTimeInTimezone
      const tokyoTime = formatTimeInTimezone(ts, 'Asia/Tokyo');
      const nyTime = formatTimeInTimezone(ts, 'America/New_York');
      expect(tokyoTime).toContain('08:30:00');
      expect(nyTime).toContain('19:30:00');
    });

    it('updates user timezone and language via manage_home:update_profile', async () => {
      const updateRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'update-tz',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'update_profile',
              timezone: 'Asia/Tokyo',
              language: 'ja',
              nickname: 'Kenji'
            }
          }
        })
      });
      expect(updateRes.status).toBe(200);
      const updateData = JSON.parse((await updateRes.json()).result.content[0].text);
      expect(updateData.success).toBe(true);
      expect(updateData.profile.timezone).toBe('Asia/Tokyo');
      expect(updateData.profile.language).toBe('ja');
      expect(updateData.profile.nickname).toBe('Kenji');

      // Verify get_profile reflects the new timezone and outputs current_date
      const getRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-prof-tz',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });
      const getData = JSON.parse((await getRes.json()).result.content[0].text);
      expect(getData.timezone).toBe('Asia/Tokyo');
      expect(getData.current_date).toBe(getCurrentDateInTimezone('Asia/Tokyo'));
    });

    it('queries meals with relative token "yesterday" and attaches date_local and time_local', async () => {
      const yesterdayStr = getYesterdayInTimezone('Europe/London');
      const todayStr = getCurrentDateInTimezone('Europe/London');

      setInMemoryMcpFoods(testUid, [
        {
          id: 'meal-yest-1',
          firebase_uid: testUid,
          date: `${yesterdayStr}T19:30:00.000Z`,
          name: 'Steak & Salad',
          calories: 650,
          saturated_fat: 12
        },
        {
          id: 'meal-today-1',
          firebase_uid: testUid,
          date: `${todayStr}T12:00:00.000Z`,
          name: 'Chicken Rice',
          calories: 500,
          saturated_fat: 4
        }
      ]);

      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-yest',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: { action: 'list', date: 'yesterday' }
          }
        })
      });
      const data = JSON.parse((await res.json()).result.content[0].text);
      expect(data.meals.length).toBe(1);
      expect(data.meals[0].id).toBe('meal-yest-1');
      expect(data.meals[0].date_local).toBe(yesterdayStr);
      expect(data.meals[0].timezone).toBe('Europe/London');
      expect(data.meals[0].time_local).toBeTruthy();
    });

    it('enforces target ratchet: newer MCP edits cannot be overwritten by stale client sync', () => {
      const now = Date.now();
      const existingTargets = { calories: 1651, saturatedFat: 12 };
      const existingTimestamps = { calories: now, saturatedFat: now };

      // Case 1: Stale client push (e.g. from an old tab with timestamp from 1 hour ago)
      const staleIncomingTargets = { calories: 2000, saturatedFat: 20 };
      const staleIncomingTimestamps = { calories: now - 3600000, saturatedFat: now - 3600000 };

      const staleMerge = mergeTargetsWithRatchet(
        existingTargets,
        staleIncomingTargets,
        existingTimestamps,
        staleIncomingTimestamps,
        now - 3600000
      );
      // Stale incoming must be rejected; newer existing targets preserved
      expect(staleMerge.targets.calories).toBe(1651);
      expect(staleMerge.targets.saturatedFat).toBe(12);

      // Case 2: Fresh client push (newer timestamp)
      const freshIncomingTargets = { calories: 1750, saturatedFat: 14 };
      const freshIncomingTimestamps = { calories: now + 5000, saturatedFat: now + 5000 };

      const freshMerge = mergeTargetsWithRatchet(
        existingTargets,
        freshIncomingTargets,
        existingTimestamps,
        freshIncomingTimestamps,
        now + 5000
      );
      // Fresh incoming must win
      expect(freshMerge.targets.calories).toBe(1750);
      expect(freshMerge.targets.saturatedFat).toBe(14);
      expect(freshMerge.targetTimestamps.calories).toBe(now + 5000);
    });

    it('stamps targetTimestamps when updating targets via set_targets', async () => {
      const setRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'set-targets-ts',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'set_targets',
              targets: { calories: 1700, totalFibre: 35 }
            }
          }
        })
      });
      const data = JSON.parse((await setRes.json()).result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.updated_targets.calories).toBe(1700);
      expect(data.targetTimestamps).toBeTruthy();
      expect(data.targetTimestamps.calories).toBeGreaterThan(0);
      expect(data.targetTimestamps.totalFibre).toBeGreaterThan(0);
    });
  });

  describe('Step 4: Shared Domain Service & Mutation Tools (manage_meals, manage_biomarkers, manage_home)', () => {
    const testUid = 'user_step4_mutations';
    const testEmail = 'step4_test@example.com';
    let accessToken: string;
    let createdMealId = '';
    let createdBioDate = '';
    let createdBioId = '';

    beforeEach(() => {
      accessToken = signSessionToken({
        uid: testUid,
        email: testEmail,
        nickname: 'Step4 User'
      });
    });

    it('logs structured meals using finalizeDishLedger (single kcal writer)', async () => {
      const logRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'log-meal-1',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'log_structured',
              name: 'Grilled Salmon & Steamed Broccoli',
              date: 'today',
              items: [
                {
                  name: 'Salmon',
                  weightGrams: 200,
                  protein: 40,
                  totalFat: 24,
                  carbohydrates: 0,
                  sodium: 120,
                  saturatedFat: 5
                },
                {
                  name: 'Steamed Broccoli',
                  weightGrams: 150,
                  protein: 4,
                  totalFat: 0.5,
                  carbohydrates: 10,
                  sodium: 50,
                  saturatedFat: 0.1
                }
              ]
            }
          }
        })
      });

      expect(logRes.status).toBe(200);
      const data = JSON.parse((await logRes.json()).result.content[0].text);
      expect(data.id).toBeTruthy();
      createdMealId = data.id;

      // Atwater: Salmon (40*4 + 24*9 = 376) + Broccoli (4*4 + 10*4 + 0.5*9 = 60.5) = ~436.5 kcal
      expect(data.calories).toBeGreaterThanOrEqual(430);
      expect(data.calories).toBeLessThanOrEqual(445);
      expect(data.items_breakdown).toHaveLength(2);
      expect(data.receiptTable).toBeTruthy();
      expect(data.date_local).toBe(getCurrentDateInTimezone('Europe/London'));

      // Verify meal appears in manage_meals:list
      const listRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-check-1',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: { action: 'list', search: 'Salmon' }
          }
        })
      });
      const listData = JSON.parse((await listRes.json()).result.content[0].text);
      expect(listData.total).toBeGreaterThanOrEqual(1);
      expect(listData.meals.some((m: any) => m.id === createdMealId)).toBe(true);
    });

    it('patches an existing meal via manage_meals:edit', async () => {
      // 1. Create a meal first
      const createRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'create-for-edit',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'log_structured',
              name: 'Salmon Dish',
              items: [
                { name: 'Salmon', weightGrams: 200, protein: 40, totalFat: 24, carbohydrates: 0 }
              ]
            }
          }
        })
      });
      const mealToEdit = JSON.parse((await createRes.json()).result.content[0].text);

      const editRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'edit-meal-1',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'edit',
              meal_id: mealToEdit.id,
              commands: [
                {
                  action: 'update_weight',
                  itemName: 'Salmon',
                  newWeightGrams: 250
                }
              ]
            }
          }
        })
      });

      expect(editRes.status).toBe(200);
      const editData = JSON.parse((await editRes.json()).result.content[0].text);
      expect(editData.success).toBe(true);
      expect(editData.changed).toBe(true);
      const salmonItem = editData.meal.items_breakdown.find((it: any) => it.name === 'Salmon');
      expect(salmonItem.weightGrams).toBe(250);
      // Increased weight increases calories
      expect(editData.meal.calories).toBeGreaterThan(450);
    });

    it('refuses destructive empty meal in manage_meals:edit', async () => {
      // Create a meal with 2 items
      const createRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'create-for-refuse',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'log_structured',
              name: 'Two Item Dish',
              items: [
                { name: 'Salmon', weightGrams: 200, protein: 40, totalFat: 24, carbohydrates: 0 },
                { name: 'Broccoli', weightGrams: 100, protein: 3, totalFat: 0, carbohydrates: 7 }
              ]
            }
          }
        })
      });
      const meal = JSON.parse((await createRes.json()).result.content[0].text);

      const editRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'edit-empty-refuse',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'edit',
              meal_id: meal.id,
              commands: [
                { action: 'remove_item', itemName: 'Salmon' },
                { action: 'remove_item', itemName: 'Broccoli' }
              ]
            }
          }
        })
      });

      const resBody = await editRes.json();
      expect(resBody.result.isError).toBe(true);
      expect(resBody.result.content[0].text).toContain('Cannot delete all items from a meal');
    });

    it('deletes meal via manage_meals:delete and writes tombstone in deletedFoodLogIds', async () => {
      // Create meal to delete
      const createRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'create-for-del',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'log_structured',
              name: 'Disposable Meal',
              items: [
                { name: 'Apple', weightGrams: 150, protein: 0.5, totalFat: 0.3, carbohydrates: 21 }
              ]
            }
          }
        })
      });
      const meal = JSON.parse((await createRes.json()).result.content[0].text);

      const delRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'del-meal-1',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'delete',
              meal_id: meal.id
            }
          }
        })
      });

      expect(delRes.status).toBe(200);
      const delData = JSON.parse((await delRes.json()).result.content[0].text);
      expect(delData.success).toBe(true);
      expect(delData.mealId).toBe(meal.id);
      expect(delData.deleted_at).toBeGreaterThan(0);

      // Verify tombstone stamped on user profile
      const profRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'check-tombstone',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });
      const profData = JSON.parse((await profRes.json()).result.content[0].text);
      expect(profData.profile.deletedFoodLogIds[meal.id]).toBeGreaterThan(0);
    });

    it('logs biomarker entries with same-day merging, canonical key mapping, and plausibility gates', async () => {
      // 1. Log first batch of biomarkers
      const log1Res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bio-log-1',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: {
              action: 'log_entries',
              date: 'today',
              readings: {
                'LDL Cholesterol': 3.2,
                'HbA1c': 5.4
              },
              note: 'Morning clinic draw'
            }
          }
        })
      });

      expect(log1Res.status).toBe(200);
      const log1Data = JSON.parse((await log1Res.json()).result.content[0].text);
      expect(log1Data.success).toBe(true);
      const recId = log1Data.record.id;
      // Canonical mapping check ('LDL Cholesterol' -> 'ldl')
      expect(log1Data.record.biomarkers.ldl).toBe(3.2);
      expect(log1Data.record.biomarkers.hba1c).toBe(5.4);

      // 2. Log second batch on the same day -> MUST merge without duplicate records
      const log2Res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bio-log-2',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: {
              action: 'log_entries',
              date: 'today',
              readings: {
                'Fasting Glucose': 5.1
              }
            }
          }
        })
      });

      const log2Data = JSON.parse((await log2Res.json()).result.content[0].text);
      expect(log2Data.success).toBe(true);
      expect(log2Data.record.id).toBe(recId);
      // All three markers present in single record
      expect(log2Data.record.biomarkers.ldl).toBe(3.2);
      expect(log2Data.record.biomarkers.hba1c).toBe(5.4);
      expect(log2Data.record.biomarkers.fasting_glucose).toBe(5.1);

      // 3. Improbable value test
      const log3Res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'bio-log-improbable',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: {
              action: 'log_entries',
              date: 'today',
              readings: {
                'hematocrit': 42.1 // Expected 0.36-0.50
              }
            }
          }
        })
      });
      const log3Data = JSON.parse((await log3Res.json()).result.content[0].text);
      expect(log3Data.warnings).toBeTruthy();
      expect(log3Data.warnings[0]).toContain('flagged as improbable');
    });

    it('deletes biomarker values field-by-field and whole record with tombstone', async () => {
      // 1. Create a biomarker record with 2 fields
      const createRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'create-for-del-bio',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: {
              action: 'log_entries',
              date: 'today',
              readings: {
                'LDL Cholesterol': 3.2,
                'Fasting Glucose': 5.1
              }
            }
          }
        })
      });
      const createData = JSON.parse((await createRes.json()).result.content[0].text);
      const bioRecordId = createData.record.id;

      // 2. Delete single field 'fasting_glucose'
      const delFieldRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'del-bio-field',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: {
              action: 'delete_values',
              record_id: bioRecordId,
              key: 'fasting_glucose'
            }
          }
        })
      });

      expect(delFieldRes.status).toBe(200);
      const delFieldData = JSON.parse((await delFieldRes.json()).result.content[0].text);
      expect(delFieldData.success).toBe(true);
      expect(delFieldData.deleted_key).toBe('fasting_glucose');
      expect(delFieldData.remaining_biomarkers.fasting_glucose).toBeUndefined();
      expect(delFieldData.remaining_biomarkers.ldl).toBe(3.2);

      // 3. Delete entire record
      const delRecordRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'del-bio-record',
          method: 'tools/call',
          params: {
            name: 'manage_biomarkers',
            arguments: {
              action: 'delete_values',
              record_id: bioRecordId
            }
          }
        })
      });

      const delRecordData = JSON.parse((await delRecordRes.json()).result.content[0].text);
      expect(delRecordData.success).toBe(true);
      expect(delRecordData.deleted_id).toBe(bioRecordId);
      expect(delRecordData.deleted_at).toBeGreaterThan(0);

      // Verify tombstone in profile
      const profRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'check-bio-tombstone',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: { action: 'get_profile' }
          }
        })
      });
      const profData = JSON.parse((await profRes.json()).result.content[0].text);
      expect(profData.profile.deletedBiomarkerLogIds[bioRecordId]).toBeGreaterThan(0);
    });

    it('manages clinical actions and daily habits via manage_home', async () => {
      // 1. Add action
      const addActRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'act-add',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'manage_actions',
              sub_action: 'add',
              item: {
                task: 'Schedule Coronary Calcium CT Scan',
                explanation: 'Evaluate calcified plaque score',
                priority: 'high',
                type: 'test'
              }
            }
          }
        })
      });
      const addActData = JSON.parse((await addActRes.json()).result.content[0].text);
      expect(addActData.success).toBe(true);
      expect(addActData.actions).toHaveLength(1);
      const actionId = addActData.actions[0].id;
      expect(addActData.actions[0].task).toBe('Schedule Coronary Calcium CT Scan');
      expect(addActData.actions[0].completed).toBe(false);

      // 2. Toggle action
      const toggleActRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'act-toggle',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'manage_actions',
              sub_action: 'toggle',
              itemId: actionId
            }
          }
        })
      });
      const toggleActData = JSON.parse((await toggleActRes.json()).result.content[0].text);
      expect(toggleActData.actions.find((a: any) => a.id === actionId).completed).toBe(true);

      // 3. Add habit
      const addHabitRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'habit-add',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'manage_habits',
              sub_action: 'add',
              habit: {
                activity: 'Zone 2 Cardio 45m',
                target: 'Daily'
              }
            }
          }
        })
      });
      const addHabitData = JSON.parse((await addHabitRes.json()).result.content[0].text);
      expect(addHabitData.success).toBe(true);
      expect(addHabitData.dailyBenefits).toHaveLength(1);
      const habitId = addHabitData.dailyBenefits[0].id;

      // 4. Toggle habit
      const toggleHabitRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'habit-toggle',
          method: 'tools/call',
          params: {
            name: 'manage_home',
            arguments: {
              action: 'manage_habits',
              sub_action: 'toggle',
              habitId
            }
          }
        })
      });
      const toggleHabitData = JSON.parse((await toggleHabitRes.json()).result.content[0].text);
      expect(toggleHabitData.dailyBenefits.find((h: any) => h.id === habitId).completed).toBe(true);
    });

    it('enforces idempotency preventing duplicate operations on agent retry', async () => {
      const idempotencyKey = 'idem-unique-key-12345';

      // 1. First execution
      const res1 = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'idem-call-1',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'log_structured',
              idempotency_key: idempotencyKey,
              name: 'Idempotency Test Meal',
              items: [{ name: 'Greek Yogurt', weightGrams: 170, protein: 17, totalFat: 0, carbohydrates: 6 }]
            }
          }
        })
      });
      const data1 = JSON.parse((await res1.json()).result.content[0].text);
      const firstMealId = data1.id;

      // 2. Retry execution with SAME idempotency_key
      const res2 = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'idem-call-2',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: {
              action: 'log_structured',
              idempotency_key: idempotencyKey,
              name: 'Idempotency Test Meal',
              items: [{ name: 'Greek Yogurt', weightGrams: 170, protein: 17, totalFat: 0, carbohydrates: 6 }]
            }
          }
        })
      });
      const data2 = JSON.parse((await res2.json()).result.content[0].text);

      // Must return identical cached record and meal ID without duplicate insertion
      expect(data2.id).toBe(firstMealId);
      expect(data2.name).toBe('Idempotency Test Meal');

      // Verify in list that only ONE such meal exists
      const listRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'idem-list-check',
          method: 'tools/call',
          params: {
            name: 'manage_meals',
            arguments: { action: 'list', search: 'Idempotency Test Meal' }
          }
        })
      });
      const listData = JSON.parse((await listRes.json()).result.content[0].text);
      const matchingMeals = listData.meals.filter((m: any) => m.name === 'Idempotency Test Meal');
      expect(matchingMeals).toHaveLength(1);
    });
  });

  describe('Step 5 - Dynamic Schema Resource & Prompts Library', () => {
    let accessToken: string;

    beforeEach(() => {
      accessToken = signSessionToken({
        uid: 'test-user-step5',
        email: 'user-step5@example.com'
      });
    });

    it('advertises resources and prompts capabilities in initialize response', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'init-5',
          method: 'initialize',
          params: {}
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.capabilities.resources).toBeDefined();
      expect(data.result.capabilities.resources.listChanged).toBe(false);
      expect(data.result.capabilities.prompts).toBeDefined();
      expect(data.result.capabilities.prompts.listChanged).toBe(false);
      expect(data.result.capabilities.tools).toBeDefined();
      expect(data.result.serverInfo.version).toBe('1.2.0');
    });

    it('lists the dynamic schema catalog resource via resources/list', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'res-list-5',
          method: 'resources/list',
          params: {}
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.resources).toHaveLength(1);
      const catalogRes = data.result.resources[0];
      expect(catalogRes.uri).toBe('schema://health-tracker/catalog');
      expect(catalogRes.name).toBe('Health-tracker Clinical & Nutritional Catalog');
      expect(catalogRes.mimeType).toBe('application/json');
    });

    it('reads the dynamic schema catalog resource with 31 nutrients, standard and custom biomarkers', async () => {
      // Set a profile with custom biomarker and customized targets
      setInMemoryMcpProfile('test-user-step5', {
        uid: 'test-user-step5',
        email: 'user-step5@example.com',
        timezone: 'America/New_York',
        language: 'en',
        dailyNutrientTargets: {
          calories: '1600 kcal',
          saturatedFat: '12 g'
        },
        customBiomarkers: [
          {
            key: 'omega3_index',
            name: 'Omega-3 Index',
            unit: '%',
            normalRange: '8.0 - 12.0',
            category: 'fatty_acids'
          }
        ]
      });

      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'res-read-5',
          method: 'resources/read',
          params: { uri: 'schema://health-tracker/catalog' }
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.contents).toHaveLength(1);
      const content = data.result.contents[0];
      expect(content.uri).toBe('schema://health-tracker/catalog');
      expect(content.mimeType).toBe('application/json');

      const catalog = JSON.parse(content.text);
      expect(catalog.version).toBe('1.0.0');
      expect(catalog.user.timezone).toBe('America/New_York');

      // Nutrients: 31 active keys
      expect(catalog.nutrients.count).toBe(31);
      expect(catalog.nutrients.items).toHaveLength(31);
      const calNutrient = catalog.nutrients.items.find((n: any) => n.key === 'calories');
      expect(calNutrient).toBeDefined();
      expect(calNutrient.unit).toBe('kcal');
      expect(calNutrient.polarity).toBe('limit');
      expect(calNutrient.user_target).toBe('1600 kcal');

      const proteinNutrient = catalog.nutrients.items.find((n: any) => n.key === 'protein');
      expect(proteinNutrient.unit).toBe('g');
      expect(proteinNutrient.polarity).toBe('goal');

      const stepsNutrient = catalog.nutrients.items.find((n: any) => n.key === 'steps');
      expect(stepsNutrient.unit).toBe('steps');
      expect(stepsNutrient.polarity).toBe('goal');

      // Biomarkers: standard + custom
      expect(catalog.biomarkers.standard_count).toBeGreaterThanOrEqual(60);
      expect(catalog.biomarkers.custom_count).toBe(1);
      const hba1cDef = catalog.biomarkers.items.find((b: any) => b.key === 'hba1c');
      expect(hba1cDef).toBeDefined();
      expect(hba1cDef.name).toBe('HbA1c');
      expect(hba1cDef.unit).toBe('mmol/mol');

      const customDef = catalog.biomarkers.items.find((b: any) => b.key === 'omega3_index');
      expect(customDef).toBeDefined();
      expect(customDef.name).toBe('Omega-3 Index');
      expect(customDef.is_custom).toBe(true);

      // Tools listed in catalog
      expect(catalog.tools.length).toBeGreaterThanOrEqual(3);
      expect(catalog.tools.map((t: any) => t.name)).toContain('manage_meals');
    });

    it('returns error when reading an unknown resource uri', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'res-err-5',
          method: 'resources/read',
          params: { uri: 'schema://health-tracker/unknown-resource' }
        })
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe(-32602);
      expect(data.error.message).toContain('Resource not found');
    });

    it('lists all 4 native clinical prompts via prompts/list', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-list-5',
          method: 'prompts/list',
          params: {}
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.prompts).toHaveLength(4);
      const names = data.result.prompts.map((p: any) => p.name);
      expect(names).toContain('audit_meal_accuracy');
      expect(names).toContain('daily_nutrition_debrief');
      expect(names).toContain('biomarker_diet_correlation');
      expect(names).toContain('triage_and_fix_latest_issue');
    });

    it('gets audit_meal_accuracy prompt with and without meal_id argument', async () => {
      // 1. Without meal_id (audits most recent)
      const res1 = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-audit-1',
          method: 'prompts/get',
          params: { name: 'audit_meal_accuracy', arguments: {} }
        })
      });
      const data1 = await res1.json();
      expect(data1.result.messages[0].content.text).toContain('most recent logged meal');
      expect(data1.result.messages[0].content.text).toContain('Atwater calculation');

      // 2. With specific meal_id
      const res2 = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-audit-2',
          method: 'prompts/get',
          params: { name: 'audit_meal_accuracy', arguments: { meal_id: 'meal-target-123' } }
        })
      });
      const data2 = await res2.json();
      expect(data2.result.messages[0].content.text).toContain('meal ID "meal-target-123"');
    });

    it('gets daily_nutrition_debrief prompt with date argument', async () => {
      const res = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-debrief',
          method: 'prompts/get',
          params: { name: 'daily_nutrition_debrief', arguments: { date: 'yesterday' } }
        })
      });
      const data = await res.json();
      expect(data.result.messages[0].content.text).toContain('daily nutrition debrief for "yesterday"');
      expect(data.result.messages[0].content.text).toContain('manage_home(action: "get_allowance_progress"');
    });

    it('gets biomarker_diet_correlation and triage_and_fix_latest_issue prompts', async () => {
      // 1. biomarker_diet_correlation
      const bioRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-bio',
          method: 'prompts/get',
          params: { name: 'biomarker_diet_correlation', arguments: { biomarker_key: 'ldl' } }
        })
      });
      const bioData = await bioRes.json();
      expect(bioData.result.messages[0].content.text).toContain('biomarker "ldl"');
      expect(bioData.result.messages[0].content.text).toContain('manage_biomarkers(action: "list"');

      // 2. triage_and_fix_latest_issue
      const triageRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-triage',
          method: 'prompts/get',
          params: { name: 'triage_and_fix_latest_issue' }
        })
      });
      const triageData = await triageRes.json();
      expect(triageData.result.messages[0].content.text).toContain('diagnostic health data triage');

      // 3. Unknown prompt name
      const errRes = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'prompt-err',
          method: 'prompts/get',
          params: { name: 'nonexistent_prompt' }
        })
      });
      expect(errRes.status).toBe(404);
      const errData = await errRes.json();
      expect(errData.error.code).toBe(-32602);
      expect(errData.error.message).toContain('Prompt not found');
    });
  });

  describe('record projection tools', () => {
    const uid = 'user_record_projection';
    let accessToken: string;

    beforeEach(() => {
      accessToken = signSessionToken({ uid, email: 'record@example.com' });
    });

    it('logs, lists, confirms, and deletes through the projection', async () => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
      const call = async (id: string, arguments_: Record<string, unknown>) => {
        const res = await fetch(`${baseUrl}/api/mcp`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'manage_biomarkers', arguments: arguments_ } }),
        });
        expect(res.status).toBe(200);
        return JSON.parse((await res.json()).result.content[0].text);
      };

      const logged = await call('rec-log', {
        action: 'log',
        date: '2024-06-01',
        text: 'I slept badly',
        readings: { HDL: 50, CRP: 0 },
        photoCount: 10,
        diary: { id: 'bowel', columns: [{ id: 'col-1', label: 'pain', retiredAt: null }], events: [] },
        diaryEvent: {
          diaryId: 'bowel',
          observedAt: '2024-06-01',
          movementNumber: 1,
          clientKey: 'k',
          cells: [{ columnId: 'col-1', value: 1 }],
        },
      });
      expect(logged.labs[0].biomarkers.hdl).toBe(50);
      expect(logged.labs[0].biomarkers.crp).toBe(0);
      expect(logged.symptomEvents).toHaveLength(1);
      expect(logged.photos.id).toBe('photo-batch');
      expect(logged.photos.parts).toHaveLength(10);
      expect(logged.diary.events[0].cells[0].columnId).toBe('col-1');
      expect(logged.sqlWriter).toBe('d1UpsertBiomarkers');

      const listed = await call('rec-list', { action: 'list', date_from: '2024-06-01', date_to: '2024-06-01' });
      expect(listed.biomarker_logs[0].biomarkers.hdl).toBe(50);
      expect(listed.biomarker_logs[0].biomarkers.__observations).toBeUndefined();
      expect(listed.symptomEvents).toHaveLength(1);
      expect(listed.tracked).toBe(2);

      const observationId = logged.rows[0].biomarkers.__observations[0].id;
      const edited = await call('rec-edit', { action: 'edit', observation_id: observationId, value: 1.293 });
      expect(edited.rows[0].biomarkers.__observations[0].rawValue).toBe(50);
      expect(edited.labs[0].biomarkers.hdl).toBe(1.293);

      const source = await call('rec-source', { action: 'confirm_source', userConfirm: 'confirmed', everyPartPassed: false });
      expect(source.deleteSource).toBe(false);

      const removed = await call('rec-del', { action: 'delete', observation_id: observationId });
      expect(removed.labs[0].biomarkers.hdl).toBeUndefined();
      expect(removed.labs[0].biomarkers.crp).toBe(0);
      expect(removed.symptomEvents).toHaveLength(1);
    });
  });
});
