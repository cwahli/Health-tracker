import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import crypto from 'crypto';
import { mcpAuthRouter, resetMcpAuthStore, resolveCanonicalUid } from './server_routes_mcp_auth.js';
import { mcpRouter, setInMemoryMcpProfile, clearInMemoryMcpProfiles } from './server_routes_mcp.js';
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
  clearInMemoryMcpProfiles();

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
});
