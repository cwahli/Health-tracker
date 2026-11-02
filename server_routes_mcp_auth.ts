import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isD1Configured, d1Query } from './server_d1.js';
import { authenticateUser, signSessionToken, verifySessionToken } from './server_auth.js';

let firebaseClientConfig: any = null;
try {
  const cfgRaw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8');
  firebaseClientConfig = JSON.parse(cfgRaw);
} catch {
  firebaseClientConfig = { projectId: 'health-tracker-b04dd', apiKey: '', authDomain: 'health-tracker-b04dd.firebaseapp.com' };
}

export async function verifyFirebaseTokenHelper(token: string): Promise<{ uid: string; email?: string } | null> {
  if (!token || typeof token !== 'string') return null;
  if (process.env.NODE_ENV === 'test' && token.startsWith('test_firebase_token_')) {
    const parts = token.replace('test_firebase_token_', '').split('__');
    return { uid: parts[0] || 'test_uid', email: parts[1] || 'test@example.com' };
  }
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch { return null; }
}

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
  owner_uid?: string | null;
  revoked_at?: number | null;
}

/** Static client redirects for Gemini consumer and Gemini Enterprise. */
export const GEMINI_STATIC_REDIRECT_URIS = [
  'https://gemini.google.com/oauth/callback',
  'https://vertexaisearch.cloud.google.com/oauth-redirect',
];

export interface StoredMcpAuthCode {
  code: string;
  client_id: string;
  firebase_uid: string;
  user_email?: string;
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
      client.owner_uid = row.owner_uid || null;
      client.revoked_at = row.revoked_at || null;
      inMemoryMcpClients.set(clientId, client);
      return client;
    }
  }

  return null;
}

async function saveMcpClient(record: StoredMcpClient): Promise<void> {
  inMemoryMcpClients.set(record.client_id, record);
  if (!isD1Configured()) return;
  const uris = JSON.stringify(record.redirect_uris);
  try {
    await d1Query(
      `INSERT INTO mcp_oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, created_at, owner_uid, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.client_id, record.client_secret_hash || null, record.client_name, uris, record.created_at, record.owner_uid || null, record.revoked_at || null]
    );
  } catch {
    await d1Query(
      `INSERT INTO mcp_oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [record.client_id, record.client_secret_hash || null, record.client_name, uris, record.created_at]
    );
  }
}

function presentedClientSecret(req: Request): string {
  const bodySecret = req.body?.client_secret;
  if (typeof bodySecret === 'string' && bodySecret) return bodySecret;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return '';
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx >= 0 ? decoded.slice(idx + 1) : '';
  } catch {
    return '';
  }
}

function secretMatches(client: StoredMcpClient, req: Request): boolean {
  if (!client.client_secret_hash) return true;
  const presented = presentedClientSecret(req);
  if (!presented) return false;
  const hash = crypto.createHash('sha256').update(presented).digest('hex');
  const a = Buffer.from(hash);
  const b = Buffer.from(client.client_secret_hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function rejectIfClientUnusable(clientId: string | undefined, req: Request, res: Response): Promise<boolean> {
  if (!clientId) return false;
  const client = await findMcpClient(clientId);
  if (!client) return false;
  if (client.revoked_at) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Client has been revoked' });
    return true;
  }
  if (client.client_secret_hash && !secretMatches(client, req)) {
    res.status(401).json({ error: 'invalid_client', error_description: 'Client secret is missing or wrong' });
    return true;
  }
  return false;
}

async function sessionFromRequest(req: Request): Promise<{ uid: string; email?: string } | null> {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const session = verifySessionToken(token);
  if (session?.uid) return { uid: session.uid, email: session.email };
  return verifyFirebaseTokenHelper(token);
}

function ownedClients(ownerUid: string): StoredMcpClient[] {
  return [...inMemoryMcpClients.values()].filter((client) => client.owner_uid === ownerUid);
}

function countActiveSessions(ownerUid: string): number {
  let count = 0;
  for (const token of inMemoryMcpRefreshTokens.values()) {
    if (token.firebase_uid === ownerUid && !token.revoked_at && Date.now() <= token.expires_at) count += 1;
  }
  return count;
}

function publicClient(client: StoredMcpClient) {
  return {
    client_id: client.client_id,
    client_name: client.client_name,
    created_at: client.created_at,
    redirect_uris: client.redirect_uris,
    revoked: Boolean(client.revoked_at),
  };
}

async function issueOwnedMcpClient(ownerUid: string): Promise<{ client_id: string; client_secret: string; redirect_uris: string[] }> {
  const now = Date.now();
  for (const previous of ownedClients(ownerUid)) {
    if (previous.revoked_at) continue;
    previous.revoked_at = now;
    for (const token of inMemoryMcpRefreshTokens.values()) {
      if (token.client_id === previous.client_id && !token.revoked_at) token.revoked_at = now;
    }
  }
  const clientSecret = `mcp_sec_${crypto.randomBytes(24).toString('base64url')}`;
  const record: StoredMcpClient = {
    client_id: `mcp_client_${crypto.randomBytes(12).toString('hex')}`,
    client_secret_hash: crypto.createHash('sha256').update(clientSecret).digest('hex'),
    client_name: 'Gemini MCP (settings)',
    redirect_uris: [...GEMINI_STATIC_REDIRECT_URIS],
    created_at: new Date().toISOString(),
    owner_uid: ownerUid,
    revoked_at: null,
  };
  await saveMcpClient(record);
  return { client_id: record.client_id, client_secret: clientSecret, redirect_uris: record.redirect_uris };
}

function revokeOwnerAccess(ownerUid: string): { revoked_sessions: number; revoked_clients: number } {
  const now = Date.now();
  let revoked_sessions = 0;
  let revoked_clients = 0;
  for (const token of inMemoryMcpRefreshTokens.values()) {
    if (token.firebase_uid === ownerUid && !token.revoked_at) {
      token.revoked_at = now;
      revoked_sessions += 1;
    }
  }
  for (const client of ownedClients(ownerUid)) {
    if (!client.revoked_at) {
      client.revoked_at = now;
      revoked_clients += 1;
    }
  }
  if (isD1Configured()) {
    void d1Query('UPDATE mcp_refresh_tokens SET revoked_at = ? WHERE firebase_uid = ? AND revoked_at IS NULL', [now, ownerUid]).catch(() => {});
    void d1Query('UPDATE mcp_oauth_clients SET revoked_at = ? WHERE owner_uid = ? AND revoked_at IS NULL', [now, ownerUid]).catch(() => {});
  }
  return { revoked_sessions, revoked_clients };
}

mcpAuthRouter.get('/api/mcp/settings', async (req: Request, res: Response) => {
  const session = await sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  const uid = resolveCanonicalUid(session.uid, session.email);
  const baseUrl = getBaseUrl(req);
  res.json({
    mcp_url: `${baseUrl}/api/mcp`,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    redirect_uris: GEMINI_STATIC_REDIRECT_URIS,
    active_sessions: countActiveSessions(uid),
    clients: ownedClients(uid).map(publicClient),
  });
});

mcpAuthRouter.post('/api/mcp/settings/client', async (req: Request, res: Response) => {
  const session = await sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  const uid = resolveCanonicalUid(session.uid, session.email);
  const issued = await issueOwnedMcpClient(uid);
  const baseUrl = getBaseUrl(req);
  res.status(201).json({
    mcp_url: `${baseUrl}/api/mcp`,
    client_id: issued.client_id,
    client_secret: issued.client_secret,
    redirect_uris: issued.redirect_uris,
    secret_shown_once: true,
  });
});

mcpAuthRouter.post('/api/mcp/settings/revoke', async (req: Request, res: Response) => {
  const session = await sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  const uid = resolveCanonicalUid(session.uid, session.email);
  res.json(revokeOwnerAccess(uid));
});

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
    .btn-google { width:100%; background:#fff; color:#1f2937; font-size:15px; font-weight:500; padding:11px 16px; border:1px solid #d1d5db; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:16px; box-sizing:border-box; }
    .btn-google:hover { background:#f3f4f6; }
    .divider { display:flex; align-items:center; text-align:center; margin:18px 0; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.5px; }
    .divider::before, .divider::after { content:''; flex:1; border-bottom:1px solid var(--border); }
    .divider span { padding:0 12px; }
    .session-card { background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:12px; padding:16px; margin-bottom:20px; text-align:center; }
    .session-info { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:12px; }
    .session-avatar { width:36px; height:36px; background:#064e3b; color:#34d399; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; }
    .session-email { font-size:14px; font-weight:600; color:var(--text); word-break:break-all; }
    .btn-switch { background:transparent; border:none; color:var(--muted); font-size:12px; cursor:pointer; text-decoration:underline; margin-top:8px; }
  </style>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <span class="badge">Model Context Protocol</span>
    </div>
    <h1>Authorize ${escapeHtml(clientName)}</h1>
    <p class="desc">Sign in with your Health-tracker account to connect this client to your health records, meals, and biomarkers.</p>
    
    ${error ? `<div class="error-banner">${escapeHtml(error)}</div>` : ''}

    <div id="session-card" style="display: none;" class="session-card">
      <div class="session-info">
        <div class="session-avatar">👤</div>
        <div>
          <div style="font-size:12px;color:var(--muted);">Currently signed in</div>
          <div class="session-email" id="session-email"></div>
        </div>
      </div>
      <button type="button" id="btn-quick-connect" class="btn-submit">Connect this Account</button>
      <div><button type="button" id="btn-switch-account" class="btn-switch">Sign in with a different account</button></div>
    </div>

    <div id="auth-methods-container">
      <button type="button" id="google-signin-btn" class="btn-google">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.347 2.825.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/></svg>
        <span class="btn-text">Continue with Google</span>
      </button>

      <div class="divider"><span>or sign in with email</span></div>

      <form id="auth-form" method="POST" action="/oauth/authorize">
        <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
        <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
        <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
        <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}" />
        <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
        <input type="hidden" name="scope" value="${escapeHtml(scope || 'mcp:full')}" />
        <input type="hidden" id="firebase_id_token" name="firebase_id_token" value="" />
        <input type="hidden" id="auth_token" name="auth_token" value="" />

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
    </div>

    <div class="footer-note">
      Connecting creates a scoped session binding to your profile only. Tokens expire automatically and can be revoked anytime.
    </div>
  </div>
  <script>
    (function() {
      var cfg = ${JSON.stringify(firebaseClientConfig)};
      var fbApp = (window.firebase && cfg && cfg.apiKey) ? (firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg)) : null;
      var f = document.getElementById('auth-form'), em = document.getElementById('email'), pw = document.getElementById('password');
      var fbTok = document.getElementById('firebase_id_token'), aTok = document.getElementById('auth_token');
      var gBtn = document.getElementById('google-signin-btn'), sCard = document.getElementById('session-card'), authCont = document.getElementById('auth-methods-container');
      var sEmail = document.getElementById('session-email'), qBtn = document.getElementById('btn-quick-connect'), swBtn = document.getElementById('btn-switch-account');
      function sendToken(type, val) {
        if (type === 'firebase') fbTok.value = val; else aTok.value = val;
        if (em) em.removeAttribute('required'); if (pw) pw.removeAttribute('required');
        f.submit();
      }
      function showSession(email, onGo) {
        if (!sCard) return; sEmail.textContent = email; sCard.style.display = 'block';
        if (authCont) authCont.style.display = 'none';
        qBtn.onclick = onGo;
        swBtn.onclick = function() {
          if (window.firebase && firebase.auth) { try { firebase.auth().signOut(); } catch(e){} }
          sCard.style.display = 'none'; if (authCont) authCont.style.display = 'block';
        };
      }
      if (fbApp) {
        try {
          firebase.auth().getRedirectResult().then(function(r) {
            if (r && r.user) r.user.getIdToken().then(function(t) { sendToken('firebase', t); });
          }).catch(function() {});
          firebase.auth().onAuthStateChanged(function(u) {
            if (u && u.email) showSession(u.email, function() {
              qBtn.disabled = true; qBtn.textContent = 'Connecting...';
              u.getIdToken().then(function(t) { sendToken('firebase', t); }).catch(function(){ qBtn.disabled = false; });
            });
          });
        } catch(e) {}
        if (gBtn) gBtn.onclick = function() {
          gBtn.disabled = true; var prov = new firebase.auth.GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' });
          firebase.auth().signInWithPopup(prov).then(function(r) {
            if (r && r.user) r.user.getIdToken().then(function(t) { sendToken('firebase', t); });
            else { gBtn.disabled = false; }
          }).catch(function(err) {
            gBtn.disabled = false;
            if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) firebase.auth().signInWithRedirect(prov);
          });
        };
      }
      try {
        var sTok = localStorage.getItem('auth_token');
        if (sTok && (!sCard.style.display || sCard.style.display === 'none')) {
          fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + sTok } }).then(function(r){ return r.json(); }).then(function(d) {
            if (d && d.success && d.userProfile && d.userProfile.email) {
              showSession(d.userProfile.email, function() { qBtn.disabled = true; sendToken('session', sTok); });
            }
          }).catch(function(){});
        }
      } catch(e) {}
    })();
  </script>
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
  if (client?.revoked_at) {
    return res.status(400).send('invalid_client: client has been revoked');
  }
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
    firebase_id_token,
    auth_token,
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

  const registeredClient = client_id ? await findMcpClient(String(client_id)) : null;
  if (registeredClient?.revoked_at) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Client has been revoked' });
  }

  // Authenticate user credentials
  let authenticatedUser: { uid: string; email?: string } | null = null;
  let authError = '';

  if (firebase_id_token) {
    authenticatedUser = await verifyFirebaseTokenHelper(firebase_id_token);
    if (!authenticatedUser) authError = 'Invalid Google sign-in session. Please try again.';
  }

  if (!authenticatedUser && auth_token) {
    const session = verifySessionToken(auth_token);
    if (session) authenticatedUser = { uid: session.uid, email: session.email };
    else authError = 'Session expired. Please sign in again.';
  }

  if (!authenticatedUser && email && password) {
    const authResult = await authenticateUser(email, password);
    if (authResult.success && authResult.user) {
      authenticatedUser = { uid: authResult.user.uid, email: authResult.user.email };
    } else {
      authError = authResult.error || 'Invalid email or password';
    }
  }

  if (!authenticatedUser) {
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
      error: authError || 'Invalid email or password'
    }));
  }

  const canonicalUid = resolveCanonicalUid(authenticatedUser.uid, authenticatedUser.email);
  const authCode = `mcp_code_${crypto.randomBytes(24).toString('base64url')}`;
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const codeRecord: StoredMcpAuthCode = {
    code: authCode,
    client_id: String(client_id || 'default_mcp_client'),
    firebase_uid: canonicalUid,
    user_email: authenticatedUser.email,
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

      if (await rejectIfClientUnusable(storedCode.client_id, req, res)) return;

      // Mark code as used
      storedCode.used_at = Date.now();
      inMemoryMcpAuthCodes.set(code, storedCode);
      if (isD1Configured()) {
        void d1Query('UPDATE mcp_auth_codes SET used_at = ? WHERE code = ?', [storedCode.used_at, code]);
      }

      // 3. Issue Access Token & Refresh Token
      const accessToken = signSessionToken({
        uid: storedCode.firebase_uid,
        email: storedCode.user_email || `${storedCode.firebase_uid}@mcp.client`,
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

      if (await rejectIfClientUnusable(storedRt.client_id, req, res)) return;

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
