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
});
