/**
 * google-store.mjs — one Drive/Sheets/Docs client for every agent surface.
 *
 * Why this shape:
 *
 *  - Service account, not per-bot OAuth. Headless hosts (vps, grok, collab) cannot
 *    run a consent flow, and DATA_PLANE.md forbids adding a second OAuth stack to
 *    the app. A service account is a key file, like the provider keys the bots
 *    already hold, so it needs no UX and no per-bot re-consent.
 *  - No `googleapis` dependency. That package drags in the OAuth client machinery
 *    this fleet will never use. The JWT grant is a signed assertion plus one POST
 *    to the token endpoint, which is all a service account needs.
 *  - Folder-scoped by configuration, not by hope. The account's access comes from
 *    Drive folder shares; this module is told folder IDs and never asked for
 *    "my" root. A surface that is not configured says so (see `googleReady`).
 *
 * Isolation, per R-14.1 card 3: the credential is read from the *host* environment.
 * An external-project turn gets `GOOGLE_FOLDER_<PROJECT>` and not the key path
 * (see `googleReady`'s `childEnv`), so a turn that cannot name its folder cannot
 * reach another project's data.
 *
 * Redaction is a hard rule, not a convention: nothing in this file returns or logs
 * key material, and `redact` is applied to any error text that could carry a token.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN_TTL_MS = 45 * 60 * 1000; // Google tokens live an hour; refresh well before.
const CLOCK_SKEW_S = 30;

export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive',
  spreadsheets: 'https://www.googleapis.com/auth/spreadsheets',
  documents: 'https://www.googleapis.com/auth/documents',
};

const API = {
  token: 'https://oauth2.googleapis.com/token',
  drive: 'https://www.googleapis.com/drive/v3',
  driveUpload: 'https://www.googleapis.com/upload/drive/v3',
  // Sheets and Docs live on their own hosts. www.googleapis.com answers these
  // paths with an HTML 404, which reads like a missing file rather than a wrong
  // host — a trap worth naming.
  sheets: 'https://sheets.googleapis.com/v1/spreadsheets',
  docs: 'https://docs.googleapis.com/v1/documents',
};

export const MIME = {
  folder: 'application/vnd.google-apps.folder',
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  md: 'text/markdown',
  json: 'application/json',
  text: 'text/plain',
};

let cached = null; // { token, expiresAt } — module scope so a turn pays the grant once.

/** Strip anything that looks like credential material out of text bound for a log. */
export function redact(value) {
  if (value === undefined || value === null) return value;
  return String(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/"private_key"\s*:\s*"[^"]*"/g, '"private_key":"[redacted]"')
    .replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted jwt]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[redacted token]')
    .replace(/(Bearer|Authorization:\s*)\s*[A-Za-z0-9._-]{20,}/gi, '$1 [redacted]');
}

/**
 * Load and validate the service account from a host environment.
 *
 * `GOOGLE_SERVICE_ACCOUNT_JSON` is a *path*. Inline JSON is accepted so a secret
 * manager can hand over the document itself, but the path is the documented shape:
 * a key on disk can be chmod 600, an env blob cannot.
 */
export function serviceAccountFromEnv(env = process.env) {
  const file = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const inline = String(env.GOOGLE_SERVICE_ACCOUNT_JSON_INLINE || '').trim();

  let raw = '';
  let source = '';
  if (file) {
    source = file;
    try {
      if (!fs.existsSync(file)) {
        return { ok: false, reason: `GOOGLE_SERVICE_ACCOUNT_JSON points at a missing file (${file})`, source };
      }
      // A key readable by other users is a leak waiting to be found; say so before
      // the grant, not after a security review.
      try {
        const mode = fs.statSync(file).mode & 0o777;
        if (mode & 0o077) {
          return { ok: false, reason: `service account file is mode ${mode.toString(8).padStart(3, '0')} (must be 600)`, source };
        }
      } catch {
        /* stat is best-effort; a missing mode check is not a failure */
      }
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      return { ok: false, reason: `cannot read service account file: ${redact(err.message)}`, source };
    }
  } else if (inline) {
    source = 'inline';
    raw = inline;
  } else {
    return { ok: false, reason: 'no GOOGLE_SERVICE_ACCOUNT_JSON path in this environment', source: '' };
  }

  let key;
  try {
    key = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `service account JSON does not parse: ${redact(err.message)}`, source };
  }

  if (key.type !== 'service_account') {
    return { ok: false, reason: `not a service account (type=${key.type || 'missing'})`, source };
  }
  if (!key.private_key || !/-----BEGIN PRIVATE KEY-----/.test(key.private_key)) {
    return { ok: false, reason: 'private_key missing or not a PEM', source };
  }
  if (!key.client_email) {
    return { ok: false, reason: 'client_email missing', source };
  }

  return { ok: true, key, email: key.client_email, projectId: key.project_id || '', source };
}

/**
 * Read the host's env the way the service does.
 *
 * The bots load `~/.config/bot-host/{common,<botId>}.env` through systemd's
 * `EnvironmentFile`, so a probe or a scorecard run from a plain shell would
 * otherwise report "no credential" for a store the live bot is using. The same
 * files are read here — with the same quote-stripping rule and the same
 * `[A-Za-z_][A-Za-z0-9_]*` name rule, which is why a hyphenated `GOOGLE_FOLDER_*`
 * is invisible — and the sources are returned so the caller can print which env
 * it judged.
 */
export function loadHostEnv(botId = '', base = process.env, { home = os.homedir(), apply = true } = {}) {
  const env = { ...base };
  const sources = ['process env'];
  const files = [`${home}/.config/bot-host/common.env`];
  if (botId) files.push(`${home}/.config/bot-host/${botId}.env`);
  for (const file of files) {
    let text = '';
    try {
      if (!fs.existsSync(file)) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    sources.push(path.basename(file));
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
      if (!value) continue;
      env[m[1]] = value;
      // Spawned children (opencode, a relay) inherit process.env, not this
      // object, so a caller that wants them to see the service's credential has
      // to have it in the real environment too.
      if (apply) process.env[m[1]] = value;
    }
  }
  return { env, sources };
}

/**
 * Resolve the folder a surface may write for one project.
 *
 * `GOOGLE_FOLDER_ID` is the single-folder default; `GOOGLE_FOLDER_<PROJECT>` is
 * the per-project map. A caller that reads `ready.folder` alone and forgets the
 * map sends an empty parent and gets a Drive 404 for "." — so every caller
 * resolves through here instead.
 */
export function folderFor(ready, projectId = 'health-tracker') {
  const explicit = String(ready?.folder || '').trim();
  if (explicit) return explicit;
  const key = String(projectId || '').trim();
  return String(ready?.folders?.[key] || '').trim();
}

const FOLDER_VAR = /^GOOGLE_FOLDER_([A-Z0-9_]+)$/;

/**
 * Read the folder map out of a host environment.
 *
 * The variable is `GOOGLE_FOLDER_<PROJECT_IN_UPPER_UNDERSCORE>`, not the project id:
 * systemd's EnvironmentFile accepts `[A-Za-z_][A-Za-z0-9_]*` only, so a hyphen in
 * the name makes systemd drop the line *silently* and the surface looks
 * unconfigured with no error anywhere. The underscore form is mapped back to the
 * project id here so callers still speak `health-tracker`.
 */
export function foldersFromEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(FOLDER_VAR);
    if (!m) continue;
    const id = String(v || '').trim().replace(/^["']|["']$/g, '');
    if (id) out[m[1].toLowerCase().replace(/_/g, '-')] = id;
  }
  return out;
}

/**
 * The honest per-location readiness answer, in the shape `/setup` already speaks.
 * Missing pieces are named; nothing is inferred from another host.
 */
/**
 * The user-identity credential (option B, plan §1b).
 *
 * A service account cannot own files, so on a personal Google account the store
 * needs an identity that has storage: one human's OAuth grant, used by every
 * agent. This is *not* per-bot OAuth — there is one consent, one credential
 * bundle, one rotation, and no agent ever sees a client secret.
 *
 * The bundle is written by `scripts/google-authorize.mjs` and holds the refresh
 * token plus the client id/secret that minted it. It is a path in the env, mode
 * 600, exactly like the service-account key it replaces.
 */
export function userIdentityFromEnv(env = process.env) {
  const file = String(env.GOOGLE_USER_CREDENTIALS_JSON || '').trim();
  const inline = String(env.GOOGLE_USER_CREDENTIALS_JSON_INLINE || '').trim();
  let raw = '';
  let source = '';
  if (file) {
    source = file;
    try {
      if (!fs.existsSync(file)) return { ok: false, reason: `GOOGLE_USER_CREDENTIALS_JSON points at a missing file (${file})`, source };
      try {
        const mode = fs.statSync(file).mode & 0o777;
        if (mode & 0o077) return { ok: false, reason: `user credential file is mode ${mode.toString(8).padStart(3, '0')} (must be 600)`, source };
      } catch { /* best effort */ }
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      return { ok: false, reason: `cannot read user credential file: ${redact(err.message)}`, source };
    }
  } else if (inline) {
    source = 'inline';
    raw = inline;
  } else {
    return { ok: false, reason: 'no GOOGLE_USER_CREDENTIALS_JSON path in this environment', source: '' };
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `user credential JSON does not parse: ${redact(err.message)}`, source };
  }
  if (!doc.refresh_token) return { ok: false, reason: 'no refresh_token in the credential bundle (re-run scripts/google-authorize.mjs)', source };
  if (!doc.client_id) return { ok: false, reason: 'no client_id in the credential bundle', source };
  const scopes = Array.isArray(doc.scopes) && doc.scopes.length ? doc.scopes : Object.values(SCOPES);
  return {
    ok: true,
    kind: 'user',
    source,
    email: doc.account || '',
    clientId: doc.client_id,
    clientSecret: doc.client_secret || '',
    refreshToken: doc.refresh_token,
    scopes,
    obtainedAt: doc.obtained_at || '',
  };
}

/**
 * One resolver for "who is this surface acting as".
 *
 * Both identities satisfy the same contract, so every call site (probe, scorecard,
 * relay) asks for an identity and never branches on the credential type. A user
 * identity is preferred when both are present: a service account can read a
 * My Drive folder but cannot write to it, so keeping it as the live identity would
 * leave the fleet permanently half-enabled.
 */
export function identityFromEnv(env = process.env) {
  const user = userIdentityFromEnv(env);
  if (user.ok) return user;
  const sa = serviceAccountFromEnv(env);
  if (sa.ok) {
    return {
      ok: true,
      kind: 'service_account',
      source: sa.source,
      email: sa.email,
      projectId: sa.projectId,
      key: sa.key,
      // A service account owns nothing, so it needs a shared drive to write
      // (plan §1b). Naming that here means every caller inherits the constraint
      // instead of rediscovering it as a 403.
      writesNeedSharedDrive: true,
      scopes: Object.values(SCOPES),
    };
  }
  return { ok: false, kind: 'none', reason: user.reason, source: user.source || sa.source, email: '' };
}

export function googleReady(env = process.env) {
  const who = identityFromEnv(env);
  const folders = foldersFromEnv(env);
  const folderId = String(env.GOOGLE_FOLDER_ID || '').trim().replace(/^["']|["']$/g, '');
  if (!who.ok) return { ready: false, reason: who.reason, source: who.source, email: '', kind: 'none', folder: '' };
  if (!folderId && Object.keys(folders).length === 0) {
    return { ready: false, reason: 'credential present, but no GOOGLE_FOLDER_<project> configured', source: who.source, email: who.email, kind: who.kind, folder: '' };
  }
  return {
    ready: true,
    reason: '',
    source: who.source,
    kind: who.kind,
    email: who.email,
    projectId: who.projectId || '',
    writesNeedSharedDrive: Boolean(who.writesNeedSharedDrive),
    folder: folderId || '',
    folders,
  };
}

/**
 * The child env an external-project turn is allowed to see: the folder to write,
 * never the path to the key. This is the card-3 boundary in code.
 */
export function googleChildEnv(env, projectId) {
  const key = String(projectId || '').trim();
  const folder = (foldersFromEnv(env)[key] || '').trim();
  if (!folder) return { ok: false, reason: `no Google folder configured for project ${key || '(none)'}` };
  return { ok: true, env: { GOOGLE_FOLDER_ID: folder, GOOGLE_PROJECT: key } };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Build the signed JWT assertion a service-account grant requires. */
export function buildAssertion(key, { scopes = Object.values(SCOPES), now = Date.now() } = {}) {
  const issued = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: key.token_uri || API.token,
    iat: issued - CLOCK_SKEW_S,
    exp: issued + 3600,
  }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

async function request(url, { method = 'GET', token = '', body, headers = {}, attempts = 3 } = {}) {
  let lastErr = '';
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) return { ok: true, status: res.status, json: text ? JSON.parse(text) : {} };
    // Prefer the API's own message over the body: a wrong-host 404 returns HTML,
    // and a board that prints HTML tells the reader nothing.
    let detail;
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message || redact(text).replace(/\s+/g, ' ').trim().slice(0, 240);
    } catch {
      // A wrong host or an abuse interstitial answers with an HTML page. Printing
      // the page helps nobody; the host and the status are the useful facts.
      detail = /^\s*</.test(text)
        ? `non-JSON error page from ${new URL(url).host}`
        : redact(text).replace(/\s+/g, ' ').trim().slice(0, 240);
    }
    lastErr = `HTTP ${res.status} ${detail}`;
    // 401/403 on a fresh token is a real answer (scope or share missing); retrying
    // the same request just burns quota. 429/5xx are worth one more try.
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 250 * 2 ** i));
  }
  return { ok: false, status: 0, error: lastErr || 'request failed' };
}

/**
 * Mint (or reuse) an access token for whichever identity this surface holds.
 *
 * One entry point, two grants: a service account signs a JWT assertion, a user
 * identity presents its refresh token. Callers do not branch, which is what keeps
 * the probe, the scorecard and the relay identical whether the fleet runs on a
 * Workspace shared drive or on one human's grant.
 */
export async function accessToken(identity, opts = {}) {
  const now = Date.now();
  if (!opts.force && cached && cached.expiresAt > now && (!opts.scopes || cached.kind === (identity?.kind || 'service_account'))) {
    return { ok: true, token: cached.token, cached: true, kind: cached.kind };
  }
  const scopes = opts.scopes || identity?.scopes || Object.values(SCOPES);

  if (identity?.kind === 'user' || (!identity?.key && identity?.refreshToken)) {
    const body = {
      grant_type: 'refresh_token',
      refresh_token: identity.refreshToken,
      client_id: identity.clientId,
    };
    // A desktop-app client has a secret; a public one does not. Send it only if
    // the bundle carries it, since sending an empty value is an error, not a
    // fallback.
    if (identity.clientSecret) body.client_secret = identity.clientSecret;
    const res = await request(API.token, { method: 'POST', body });
    if (!res.ok) {
      return {
        ok: false,
        error: res.error || 'refresh grant failed',
        // The two failures that actually happen, named: a revoked grant and an
        // expired one (an app left in "Testing" status expires refresh tokens
        // after 7 days). Both are fixed by re-running the authorizer.
        hint: /invalid_grant/.test(res.error || '') ? 're-run scripts/google-authorize.mjs (grant revoked, expired, or the consent app is in Testing status)' : '',
      };
    }
    cached = {
      token: res.json.access_token,
      kind: 'user',
      expiresAt: now + Math.max(60_000, Number(res.json.expires_in || 3600) * 1000 - CLOCK_SKEW_S * 1000),
    };
    return { ok: true, token: cached.token, cached: false, kind: 'user' };
  }

  if (!identity?.key) return { ok: false, error: 'no usable identity (neither a service account key nor a user refresh token)' };
  const assertion = buildAssertion(identity.key, { scopes, now });
  const res = await request(API.token, {
    method: 'POST',
    body: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
  });
  if (!res.ok) return { ok: false, error: res.error || 'token grant failed' };
  cached = {
    token: res.json.access_token,
    kind: 'service_account',
    expiresAt: now + Math.min(Number(res.json.expires_in || 3600) * 1000 - CLOCK_SKEW_S * 1000, TOKEN_TTL_MS),
  };
  return { ok: true, token: cached.token, cached: false, kind: 'service_account' };
}

export function forgetToken() {
  cached = null;
}

/**
 * Deterministic, never-colliding object name. Two agents on two locations writing
 * "the same" turn produce two distinct rows, and a retry of the same turn produces
 * the same name — which is what makes the write idempotent.
 */
/**
 * Drive: upload a binary object (a picture from a phone, a rendered chart).
 *
 * Separate from `createFile` because a picture is bytes, not a markdown string,
 * and because the multipart body for binary must not be line-ending-mangled the
 * way a text part is.
 */
export async function uploadBinary(folderId, name, bytes, { mimeType = 'image/png' } = {}, token) {
  const boundary = 'fleetstorebin';
  const meta = JSON.stringify({ name, parents: [folderId], mimeType });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const res = await fetch(`${API.driveUpload}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,mimeType,size,webViewLink')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), tail]),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status} ${redact(text).slice(0, 300)}` };
  return { ok: true, id: JSON.parse(text).id, file: JSON.parse(text) };
}

/**
 * Drive: read one object's metadata. `expectMissing` turns "deleted" into a
 * positive answer — a delete is only proven when a later read says 404, not when
 * the delete call returned 200.
 */
export async function getFile(fileId, token) {
  const res = await request(`${API.drive}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,name,mimeType,size,modifiedTime,parents,trashed')}`, { token });
  if (res.ok) return { ok: true, missing: false, file: res.json };
  return { ok: res.status === 404, missing: res.status === 404, status: res.status, error: res.error || '' };
}

export async function listChildren(folderId, token) {
  const res = await listFolder(folderId, token, { pageSize: 100, fields: 'files(id,name,mimeType,size)' });
  if (!res.ok) return res;
  return { ok: true, files: res.json.files || [] };
}

/**
 * Drive: rename an existing object.
 *
 * The one PATCH this module is allowed to make, and the payload is exactly
 * `{ name }` — a rename changes a label, never content. Replacing bytes would be
 * `files/{id}/upload` against an existing id, which is the shape the fleet does
 * not use: artifacts are written once, under a content-addressed name, and a
 * second write is a second object.
 */
export async function renameFile(fileId, name, token) {
  const clean = String(name || '').replace(/[\\/\r\n\t]/g, '-').trim().slice(0, 200);
  if (!clean) return { ok: false, error: 'empty name' };
  const res = await request(`${API.drive}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,name,modifiedTime')}`, {
    method: 'PATCH',
    token,
    body: { name: clean },
  });
  if (!res.ok) return res;
  return { ok: true, id: res.json.id, name: res.json.name, modifiedTime: res.json.modifiedTime };
}

/** Drive: delete an object permanently. */
export async function deleteFile(fileId, token) {
  const res = await request(`${API.drive}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', token });
  return { ok: res.ok, status: res.status, error: res.error || '' };
}

/** Sheets: delete the whole spreadsheet (the scorecard's own test objects only). */
export async function deleteSheet(sheetId, token) {
  const res = await request(`${API.sheets}/${encodeURIComponent(sheetId)}`, { method: 'DELETE', token });
  return { ok: res.ok, status: res.status, error: res.error || '' };
}

/** Sheets: read one spreadsheet's metadata (used to prove create/delete). */
export async function getSheet(sheetId, token) {
  const res = await request(`${API.sheets}/${encodeURIComponent(sheetId)}?fields=${encodeURIComponent('spreadsheetId,properties.title,sheets.properties')}`, { token });
  if (res.ok) return { ok: true, missing: false, sheet: res.json };
  return { ok: res.status === 404, missing: res.status === 404, status: res.status, error: res.error || '' };
}

export function objectName({ at, location, chat, turnId, slug = '' }) {
  const stamp = String(at || '').replace(/[^0-9]/g, '').slice(0, 14) || String(Date.now());
  // Collapse runs of dots as well as punctuation: Drive tolerates `..` in a name,
  // but a name is also logged, pasted into a shell, and used in a local cache
  // path, and `../..` surviving sanitization is the kind of thing that bites later.
  const clean = (p) => String(p)
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  const parts = [stamp, clean(location || 'unknown') || 'unknown', clean(chat || 'nochat') || 'nochat', clean(turnId || 'noturn') || 'noturn'];
  const tail = clean(slug);
  return `${parts.join('-')}${tail ? `-${tail}` : ''}`;
}

export function monthTab(at) {
  const d = new Date(at || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}`;
}

/** Drive: list one page of a folder. Read-only, so the probe can use it freely. */
export async function listFolder(folderId, token, { pageSize = 10, fields = 'files(id,name,mimeType,modifiedTime,size)' } = {}) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `${API.drive}/files?q=${q}&pageSize=${pageSize}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime desc`;
  return request(url, { token });
}

export async function createFile(folderId, name, { mimeType = MIME.md, content = '' } = {}, token) {
  const boundary = 'fleetstore';
  const meta = { name, parents: [folderId], mimeType };
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(meta),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const res = await fetch(`${API.driveUpload}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,mimeType,webViewLink')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status} ${redact(text).slice(0, 300)}` };
  return { ok: true, id: JSON.parse(text).id, file: JSON.parse(text) };
}

/** Drive: create a Google Doc, optionally seeded, and file it in the folder. */
export async function createDoc(folderId, title, { body = '' } = {}, token) {
  const res = await request(`${API.drive}/files`, {
    method: 'POST',
    token,
    body: { name: title, parents: [folderId], mimeType: MIME.doc },
  });
  if (!res.ok) return res;
  const id = res.json.id;
  if (body) {
    const seeded = await appendDocText(id, body, token);
    if (!seeded.ok) return { ok: false, status: seeded.status, error: `doc created (${id}) but seed failed: ${seeded.error}`, id };
  }
  return { ok: true, id, title, webViewLink: res.json.webViewLink || `https://docs.google.com/document/d/${id}/edit` };
}

export async function appendDocText(docId, text, token) {
  const end = await request(`${API.docs}/documents/${docId}`, { token, });
  if (!end.ok) return end;
  const body = end.json.body?.content || [];
  const last = body[body.length - 1];
  const index = last?.endIndex || 1;
  return request(`${API.docs}/documents/${docId}:batchUpdate`, {
    method: 'POST',
    token,
    body: { requests: [{ insertText: { location: { index }, text: `\n${text}` } }] },
  });
}

/** Sheets: create the spreadsheet once. Later tabs are the writer's job. */
export async function createSheet(title, { tabName = 'turn_log' } = {}, token) {
  return request(`${API.sheets}`, {
    method: 'POST',
    token,
    body: { properties: { title }, sheets: [{ properties: { title: tabName } }] },
  });
}

/** Sheets: append rows. Appending is the only write shape this fleet uses. */
export async function appendRows(sheetId, tab, rows, token) {
  const body = { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', range: `${tab}!A1`, values: rows };
  return request(`${API.sheets}/${sheetId}/values/${tab}:append`, { method: 'POST', token, body });
}

export async function readTab(sheetId, tab, token, { range = `${tab}!A1:Z200` } = {}) {
  return request(`${API.sheets}/${sheetId}/values/${encodeURIComponent(range)}`, { token });
}
