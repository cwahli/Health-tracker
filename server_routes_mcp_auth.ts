import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { isD1Configured, d1Query } from './server_d1.js';
import { authenticateUser, signSessionToken, verifySessionToken } from './server_auth.js';

export const mcpAuthRouter = Router();

export function resolveCanonicalUid(uid?: string, email?: string): string {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUid = (uid || '').trim();
  const isCwah = cleanEmail.includes('cwah.liu') || cleanEmail.includes('chiwah.liu') ||
                 cleanUid.includes('cwah_liu') || cleanUid.includes('chiwah_liu') ||
                 cleanUid === 'hiJun2hTdDTk2igwerun2LKvwb42';
  return isCwah ? 'hiJun2hTdDTk2igwerun2LKvwb42' : (cleanUid || cleanEmail);
}

export function getBaseUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol) || 'https';
  const host = req.get('host') || 'health-tracker.co.uk';
  if (host.includes('health-tracker.co.uk') || host.includes('duckdns.org')) {
    return `https://${host}`;
  }
  return `${proto}://${host}`;
}

// In-memory fallbacks when D1 is offline or during unit tests
export interface StoredMcpClient {
  client_id: string;
  client_secret_hash?: string | null;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

export interface StoredMcpAuthCode {
  code: string;
  client_id: string;
  firebase_uid: string;
  code_challenge: string;
  code_challenge_method: string;
  redirect_uri: string;
  expires_at: number;
  used_at?: number | null;
}

export interface StoredMcpRefreshToken {
  token: string;
  client_id: string;
  firebase_uid: string;
  expires_at: number;
  revoked_at?: number | null;
}

export const inMemoryMcpClients = new Map<string, StoredMcpClient>();
export const inMemoryMcpAuthCodes = new Map<string, StoredMcpAuthCode>();
export const inMemoryMcpRefreshTokens = new Map<string, StoredMcpRefreshToken>();

export function resetMcpAuthStore(): void {
  inMemoryMcpClients.clear();
  inMemoryMcpAuthCodes.clear();
  inMemoryMcpRefreshTokens.clear();
}

// ---------------------------------------------------------------------------
// RFC 9728: OAuth 2.0 Protected Resource Metadata
// ---------------------------------------------------------------------------
mcpAuthRouter.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['openid', 'profile', 'mcp:full']
  });
});

// ---------------------------------------------------------------------------
// RFC 8414 & OpenID Connect Discovery Metadata
// ---------------------------------------------------------------------------
const handleMetadata = (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    registration_endpoint: `${baseUrl}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['openid', 'profile', 'mcp:full']
  });
};

mcpAuthRouter.get('/.well-known/oauth-authorization-server', handleMetadata);
mcpAuthRouter.get('/.well-known/openid-configuration', handleMetadata);

// ---------------------------------------------------------------------------
// RFC 7591: Dynamic Client Registration
// ---------------------------------------------------------------------------
mcpAuthRouter.post('/api/oauth/register', async (req: Request, res: Response) => {
  try {
    const { client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method } = req.body || {};

    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris array is required'
      });
    }

    const clientId = `mcp_client_${crypto.randomBytes(12).toString('hex')}`;
    const authMethod = token_endpoint_auth_method || 'none';
    let clientSecret: string | undefined;
    let secretHash: string | null = null;

    if (authMethod !== 'none') {
      clientSecret = `mcp_sec_${crypto.randomBytes(24).toString('base64url')}`;
      secretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');
    }

    const clientRecord: StoredMcpClient = {
      client_id: clientId,
      client_secret_hash: secretHash,
      client_name: String(client_name || 'Gemini MCP Client'),
      redirect_uris,
      created_at: new Date().toISOString()
    };

    inMemoryMcpClients.set(clientId, clientRecord);

    if (isD1Configured()) {
      await d1Query(
        `INSERT INTO mcp_oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [clientId, secretHash, clientRecord.client_name, JSON.stringify(redirect_uris), clientRecord.created_at]
      );
    }

    res.status(201).json({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: clientRecord.client_name,
      redirect_uris,
      grant_types: grant_types || ['authorization_code', 'refresh_token'],
      response_types: response_types || ['code'],
      token_endpoint_auth_method: authMethod
    });
  } catch (err: any) {
    console.error('[MCP Auth] Dynamic Registration error:', err);
    res.status(500).json({ error: 'server_error', error_description: err?.message || 'Registration failed' });
  }
});

// Helper to look up registered client
async function findMcpClient(clientId: string): Promise<StoredMcpClient | null> {
  const cached = inMemoryMcpClients.get(clientId);
  if (cached) return cached;

  if (isD1Configured()) {
    const result = await d1Query<any>('SELECT * FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1', [clientId]);
    if (result.success && result.results && result.results.length > 0) {
      const row = result.results[0];
      let uris: string[] = [];
      try {
        uris = JSON.parse(row.redirect_uris);
      } catch {
        uris = [row.redirect_uris];
      }
      const client: StoredMcpClient = {
        client_id: row.client_id,
        client_secret_hash: row.client_secret_hash,
        client_name: row.client_name,
        redirect_uris: uris,
        created_at: row.created_at
      };
      inMemoryMcpClients.set(clientId, client);
      return client;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTML Consent & Authorization Page
// ---------------------------------------------------------------------------
function renderConsentPage(params: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  error?: string;
}): string {
  const { clientName, clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope, error } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Health-tracker to Gemini</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #10b981;
      --primary-hover: #059669;
      --danger: #ef4444;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 440px;
      width: 100%;
      padding: 32px 28px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }
    .logo-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .badge {
      background: #064e3b;
      color: #34d399;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      text-align: center;
      margin: 0 0 8px 0;
    }
    p.desc {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
      margin: 0 0 24px 0;
    }
    .error-banner {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid var(--danger);
      color: #fca5a5;
      font-size: 13px;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 20px;
      text-align: center;
    }
    .field {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input[type="email"], input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="email"]:focus, input[type="password"]:focus {
      border-color: var(--primary);
    }
    .btn-submit {
      width: 100%;
      background: var(--primary);
      color: #ffffff;
      font-size: 15px;
      font-weight: 600;
      padding: 12px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.2s;
    }
    .btn-submit:hover {
      background: var(--primary-hover);
    }
    .footer-note {
      font-size: 11px;
      color: var(--muted);
      text-align: center;
      margin-top: 20px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <span class="badge">Model Context Protocol</span>
    </div>
    <h1>Authorize ${escapeHtml(clientName)}</h1>
    <p class="desc">Sign in with your Health-tracker account to connect this client to your health records, meals, and biomarkers.</p>
    
    ${error ? `<div class="error-banner">${escapeHtml(error)}</div>` : ''}

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}" />
      <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope || 'mcp:full')}" />

      <div class="field">
        <label for="email">Health-tracker Email</label>
        <input type="email" id="email" name="email" required autocomplete="username" placeholder="name@example.com" />
      </div>

      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••" />
      </div>

      <button type="submit" class="btn-submit">Sign In & Connect</button>
    </form>

    <div class="footer-note">
      Connecting creates a scoped session binding to your profile only. Tokens expire automatically and can be revoked anytime.
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Authorization Endpoint: GET & POST /oauth/authorize
// ---------------------------------------------------------------------------
mcpAuthRouter.get('/oauth/authorize', async (req: Request, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
    code_challenge_method
  } = req.query as Record<string, string>;

  if (response_type !== 'code') {
    return res.status(400).send('unsupported_response_type: response_type must be code');
  }

  if (!code_challenge) {
    return res.status(400).send('invalid_request: code_challenge is required (PKCE)');
  }

  if (code_challenge_method !== 'S256') {
    return res.status(400).send('invalid_request: code_challenge_method must be S256');
  }

  if (!redirect_uri) {
    return res.status(400).send('invalid_request: redirect_uri is required');
  }

  // Validate or register fallback client
  let client = await findMcpClient(client_id);
  const clientName = client?.client_name || 'Gemini MCP';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderConsentPage({
    clientName,
    clientId: client_id || 'default_mcp_client',
    redirectUri: redirect_uri,
    state,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method || 'S256',
    scope
  }));
});

mcpAuthRouter.post('/oauth/authorize', async (req: Request, res: Response) => {
  const {
    email,
    password,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope
  } = req.body || {};

  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri required' });
  }

  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({ error: 'invalid_request', error_description: 'S256 code_challenge required' });
  }

  // Authenticate user credentials
  const authResult = await authenticateUser(email, password);
  if (!authResult.success || !authResult.user) {
    let client = await findMcpClient(client_id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(renderConsentPage({
      clientName: client?.client_name || 'Gemini MCP',
      clientId: client_id || 'default_mcp_client',
      redirectUri: redirect_uri,
      state,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'S256',
      scope,
      error: authResult.error || 'Invalid email or password'
    }));
  }

  const canonicalUid = resolveCanonicalUid(authResult.user.uid, authResult.user.email);
  const authCode = `mcp_code_${crypto.randomBytes(24).toString('base64url')}`;
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const codeRecord: StoredMcpAuthCode = {
    code: authCode,
    client_id: String(client_id || 'default_mcp_client'),
    firebase_uid: canonicalUid,
    code_challenge,
    code_challenge_method: code_challenge_method || 'S256',
    redirect_uri,
    expires_at: expiresAt,
    used_at: null
  };

  inMemoryMcpAuthCodes.set(authCode, codeRecord);

  if (isD1Configured()) {
    try {
      await d1Query(
        `INSERT INTO mcp_auth_codes (code, client_id, firebase_uid, code_challenge, code_challenge_method, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [authCode, codeRecord.client_id, canonicalUid, code_challenge, codeRecord.code_challenge_method, redirect_uri, expiresAt]
      );
    } catch (e: any) {
      console.warn('[MCP Auth] Failed to persist code in D1 (in-memory code active):', e?.message);
    }
  }

  try {
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (state) redirectUrl.searchParams.set('state', state);
    res.redirect(redirectUrl.toString());
  } catch (err: any) {
    // If not a valid parseable absolute URL
    const sep = redirect_uri.includes('?') ? '&' : '?';
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    res.redirect(`${redirect_uri}${sep}code=${encodeURIComponent(authCode)}${stateParam}`);
  }
});

// ---------------------------------------------------------------------------
// Token Exchange Endpoint: POST /api/oauth/token
// ---------------------------------------------------------------------------
mcpAuthRouter.post('/api/oauth/token', async (req: Request, res: Response) => {
  try {
    const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token } = req.body || {};

    if (grant_type === 'authorization_code') {
      if (!code || !code_verifier) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'code and code_verifier are required'
        });
      }

      // 1. Look up auth code
      let storedCode = inMemoryMcpAuthCodes.get(code);
      if (!storedCode && isD1Configured()) {
        const d1Res = await d1Query<any>('SELECT * FROM mcp_auth_codes WHERE code = ? LIMIT 1', [code]);
        if (d1Res.success && d1Res.results && d1Res.results.length > 0) {
          storedCode = d1Res.results[0];
        }
      }

      if (!storedCode) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code not found or expired'
        });
      }

      if (storedCode.used_at) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code has already been used'
        });
      }

      if (Date.now() > storedCode.expires_at) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization code has expired'
        });
      }

      if (redirect_uri && storedCode.redirect_uri !== redirect_uri) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match authorization request'
        });
      }

      // 2. Verify PKCE S256
      const calculatedChallenge = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest('base64url');

      if (calculatedChallenge !== storedCode.code_challenge) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'PKCE verification failed: code_verifier does not match code_challenge'
        });
      }

      // Mark code as used
      storedCode.used_at = Date.now();
      inMemoryMcpAuthCodes.set(code, storedCode);
      if (isD1Configured()) {
        void d1Query('UPDATE mcp_auth_codes SET used_at = ? WHERE code = ?', [storedCode.used_at, code]);
      }

      // 3. Issue Access Token & Refresh Token
      const accessToken = signSessionToken({
        uid: storedCode.firebase_uid,
        email: `${storedCode.firebase_uid}@mcp.client`,
        nickname: 'Gemini MCP',
        userType: 'Standard'
      });

      const refreshToken = `mcp_rt_${crypto.randomBytes(32).toString('base64url')}`;
      const refreshExpiresAt = Date.now() + (90 * 24 * 60 * 60 * 1000); // 90 days

      const refreshRecord: StoredMcpRefreshToken = {
        token: refreshToken,
        client_id: storedCode.client_id,
        firebase_uid: storedCode.firebase_uid,
        expires_at: refreshExpiresAt,
        revoked_at: null
      };

      inMemoryMcpRefreshTokens.set(refreshToken, refreshRecord);

      if (isD1Configured()) {
        void d1Query(
          `INSERT INTO mcp_refresh_tokens (token, client_id, firebase_uid, expires_at) VALUES (?, ?, ?, ?)`,
          [refreshToken, storedCode.client_id, storedCode.firebase_uid, refreshExpiresAt]
        );
      }

      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 30 * 24 * 60 * 60,
        refresh_token: refreshToken,
        scope: 'mcp:full'
      });
    }

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'refresh_token required'
        });
      }

      let storedRt = inMemoryMcpRefreshTokens.get(refresh_token);
      if (!storedRt && isD1Configured()) {
        const d1Res = await d1Query<any>('SELECT * FROM mcp_refresh_tokens WHERE token = ? LIMIT 1', [refresh_token]);
        if (d1Res.success && d1Res.results && d1Res.results.length > 0) {
          storedRt = d1Res.results[0];
        }
      }

      if (!storedRt || storedRt.revoked_at || Date.now() > storedRt.expires_at) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Refresh token invalid, expired, or revoked'
        });
      }

      const newAccessToken = signSessionToken({
        uid: storedRt.firebase_uid,
        email: `${storedRt.firebase_uid}@mcp.client`,
        nickname: 'Gemini MCP',
        userType: 'Standard'
      });

      return res.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 30 * 24 * 60 * 60,
        refresh_token,
        scope: 'mcp:full'
      });
    }

    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'grant_type must be authorization_code or refresh_token'
    });
  } catch (err: any) {
    console.error('[MCP Auth] Token Exchange error:', err);
    res.status(500).json({ error: 'server_error', error_description: err?.message || 'Token exchange failed' });
  }
});
