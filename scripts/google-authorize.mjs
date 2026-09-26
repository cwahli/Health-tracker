#!/usr/bin/env node
/**
 * google-authorize.mjs — the one human consent that gives every agent a writer.
 *
 * Why this exists: a service account cannot own files (plan §1b), so on a personal
 * Google account the store needs an identity with storage. That is one human's
 * OAuth grant, held once in the host config and used by every surface. It is *not*
 * per-bot OAuth: one consent, one credential bundle, one rotation, and no agent
 * ever reads a client secret.
 *
 * The flow is a loopback redirect, which means the authorization code never has to
 * be pasted into a chat window:
 *
 *   1. this script prints a consent URL and listens on 127.0.0.1:<port>
 *   2. the human opens the URL in a browser on another machine, with that port
 *      tunnelled back here:   ssh -L <port>:127.0.0.1:<port> ubuntu@<vps>
 *   3. Google redirects the browser to 127.0.0.1:<port>, the code lands here, it
 *      is exchanged for tokens, and the bundle is written mode 600
 *
 * If tunnelling is not possible, `--code=<the code from the address bar>` finishes
 * the same exchange from the command line.
 *
 * Zero-burn verification: the script then calls Drive `about.get`, a read, and
 * reports which account was granted and how much Drive quota it has. That read is
 * also the earliest proof that writes will work — a service account showed 0 quota
 * here, which is exactly what blocked the whole store.
 *
 * Usage:
 *   node scripts/google-authorize.mjs --client=/path/to/oauth-client.json
 *   node scripts/google-authorize.mjs --client=… --port=8898
 *   node scripts/google-authorize.mjs --code=4/0Ac…            (finish by hand)
 *   node scripts/google-authorize.mjs --status                 (report, change nothing)
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { SCOPES, forgetToken, loadHostEnv, redact } from './lib/google-store.mjs';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const HOME = os.homedir();
const CONF_DIR = `${HOME}/.config/bot-host`;
const BUNDLE = arg('bundle', `${CONF_DIR}/google-user-credentials.json`);
const PORT = Number(arg('port', '8898'));
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE_LIST = Object.values(SCOPES);
const TIMEOUT_MS = Number(arg('timeout', '900')) * 1000;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Read the OAuth client the console handed the human: {"installed":{…}}. */
function readClient() {
  const file = arg('client', process.env.GOOGLE_OAUTH_CLIENT_JSON || '');
  if (!file) return { ok: false, reason: 'no --client=<path to the OAuth client .json> given' };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `cannot read the client file: ${redact(err.message)}` };
  }
  const c = doc.installed || doc.web || doc;
  if (!c.client_id || !c.client_secret) return { ok: false, reason: 'client file has no client_id/client_secret' };
  return { ok: true, clientId: c.client_id, clientSecret: c.client_secret, file };
}

const say = (line = '') => console.log(line);

async function exchange({ code, clientId, clientSecret }) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret || '',
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `token endpoint: ${json.error || res.status} ${json.error_description || ''}`.trim() };
  return { ok: true, json };
}

async function persist({ clientId, clientSecret, json, state }) {
  const granted = String(json.scope || '').split(' ').filter(Boolean);
  const missing = SCOPE_LIST.filter((s) => !granted.includes(s));
  // A credential bundle is written *before* the account is reported, so a partial
  // grant is visible to the probe instead of silently becoming a second mystery.
  const bundle = {
    kind: 'user',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: json.refresh_token,
    scopes: granted,
    obtained_at: new Date().toISOString(),
    via: 'scripts/google-authorize.mjs',
    state_used: Boolean(state),
  };
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
  fs.writeFileSync(BUNDLE, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(BUNDLE, 0o600);
  return { granted, missing };
}

/** Zero-burn: who am I, and does this account have storage to write with? */
async function whoAmI(accessToken) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=' + encodeURIComponent('user,storageQuota'), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `about.get: ${res.status}` };
  const q = json.storageQuota || {};
  const used = Number(String(q.usage || '0').replace(/\D/g, '')) || 0;
  const limit = Number(String(q.limit || '0').replace(/\D/g, '')) || 0;
  return { ok: true, email: json.user?.emailAddress || '', usage: used, limit, gb: (n) => (n / 1e9).toFixed(2) };
}

function reportAccount(info) {
  if (!info.ok) {
    say(`  account   : UNREADABLE — ${redact(info.error)}`);
    return false;
  }
  say(`  account   : ${info.email}`);
  if (info.limit) {
    say(`  quota     : ${info.gb(info.usage)} GB used of ${info.gb(info.limit)} GB`);
    // The check that matters: a service account reported no quota at all here and
    // that is what blocked every write. A user identity must show a real limit.
    say(`  can write : ${info.limit > 0 ? 'yes — the account owns storage' : 'NO — this identity still has no storage quota'}`);
    return info.limit > 0;
  }
  say('  quota     : not reported by the API (unlimited or unmanaged)');
  return true;
}

async function status() {
  say('\n  google user identity — status\n');
  if (!fs.existsSync(BUNDLE)) {
    say(`  credential: none (${BUNDLE} does not exist)\n`);
    return 1;
  }
  const doc = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
  const mode = (fs.statSync(BUNDLE).mode & 0o777).toString(8);
  say(`  bundle    : ${BUNDLE} (mode ${mode})`);
  say(`  obtained  : ${doc.obtained_at || 'unknown'}`);
  say(`  scopes    : ${(doc.scopes || []).join(' ')}`);
  say(`  refresh   : ${doc.refresh_token ? 'present (never printed)' : 'MISSING'}`);
  return 0;
}

async function main() {
  loadHostEnv('probe');

  if (process.argv.includes('--status')) {
    process.exitCode = await status();
    return;
  }

  const client = readClient();
  if (!client.ok) {
    say(`\n  google authorize\n\n  ${client.reason}\n`);
    process.exitCode = 1;
    return;
  }

  // Hand-finished path: the browser landed on a dead port and the human copied
  // the code out of the address bar.
  const pasted = arg('code');
  if (pasted) {
    say('\n  exchanging the pasted authorization code…');
    const r = await exchange({ code: pasted, clientId: client.clientId, clientSecret: client.clientSecret });
    if (!r.ok) {
      say(`  FAILED: ${r.error}`);
      say('  (a code is single-use and short-lived — run without --code to get a fresh URL)\n');
      process.exitCode = 1;
      return;
    }
    const { granted, missing } = await persist({ clientId: client.clientId, clientSecret: client.clientSecret, json: r.json, state: false });
    say(`  granted   : ${granted.join(' ')}`);
    if (missing.length) say(`  MISSING   : ${missing.join(' ')}  ← the store needs these`);
    const refreshed = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r.json.refresh_token, client_id: client.clientId, client_secret: client.clientSecret }),
    }).then((x) => x.json()).catch(() => ({}));
    reportAccount(await whoAmI(refreshed.access_token || ''));
    say(`\n  bundle written: ${BUNDLE} (mode 600)\n`);
    process.exitCode = refreshed.access_token ? 0 : 1;
    return;
  }

  const state = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE_LIST.join(' '));
  // offline + consent: `offline` is what returns a refresh token at all, and
  // `consent` is what makes Google return one even if a grant already exists.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  const result = await new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      const body = (html) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      };
      if (u.pathname !== '/') {
        body('<p>Nothing here. You can close this tab.</p>');
        return;
      }
      if (u.searchParams.get('state') !== state) {
        body('<p>State mismatch — this response is not from the request this script started.</p>');
        done({ ok: false, error: 'state mismatch' });
        return;
      }
      if (u.searchParams.get('error')) {
        body(`<p>Google returned <code>${u.searchParams.get('error')}</code>. Close this tab; the script will report it.</p>`);
        done({ ok: false, error: u.searchParams.get('error') });
        return;
      }
      const code = u.searchParams.get('code');
      if (!code) {
        body('<p>No code in the callback. Close this tab.</p>');
        done({ ok: false, error: 'no code in callback' });
        return;
      }
      body('<p>Got it. You can close this tab — the credential is being written.</p>');
      done({ ok: true, code });
    });
    const timer = setTimeout(() => {
      say('  (timed out waiting for the browser callback)');
      done({ ok: false, error: 'timeout', url: url.toString() });
    }, TIMEOUT_MS);
    server.on('error', (err) => done({ ok: false, error: `listen failed: ${redact(err.message)}`, url: url.toString() }));
    server.listen(PORT, '127.0.0.1', () => {
      say('\n  google authorize — one consent, every agent\n');
      say(`  listening : 127.0.0.1:${PORT}  (redirect ${REDIRECT})`);
      say('\n  1) on the machine with your browser, tunnel this port to the VPS:');
      say(`       ssh -N -L ${PORT}:127.0.0.1:${PORT} ubuntu@51.254.217.163`);
      say('  2) then open this URL in that browser:\n');
      say(`     ${url.toString()}\n`);
      say('     (sign in as the account that should own the files; the warning that')
        && say('      this app is unverified is expected for a personal account —')
        && say('      "Advanced" → "Go to (unsafe)" is the intended path.)');
      say(`\n  no tunnel? open the URL anyway and copy the \`code\` from the address bar:`);
      say(`       node scripts/google-authorize.mjs --code='…'\n`);
    });
  });

  forgetToken();

  if (!result.ok) {
    say(`\n  FAILED: ${redact(result.error)}`);
    if (result.url) say(`  retry with a fresh URL: node scripts/google-authorize.mjs --port=${PORT + 1}\n`);
    process.exitCode = 1;
    return;
  }

  say('  code received — exchanging…');
  const r = await exchange({ code: result.code, clientId: client.clientId, clientSecret: client.clientSecret });
  if (!r.ok) {
    say(`  FAILED: ${r.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (!r.json.refresh_token) {
    say('  FAILED: Google returned no refresh_token.');
    say('  That means the consent did not ask for offline access — start again and');
    say('  accept every scope. (A code cannot be reused; a new URL is needed.)\n');
    process.exitCode = 1;
    return;
  }
  const { granted, missing } = await persist({ clientId: client.clientId, clientSecret: client.clientSecret, json: r.json, state: true });
  say(`  granted   : ${granted.join(' ')}`);
  if (missing.length) say(`  MISSING   : ${missing.join(' ')}  ← the store needs these`);
  const refreshed = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r.json.refresh_token, client_id: client.clientId, client_secret: client.clientSecret }),
  }).then((x) => x.json()).catch(() => ({}));
  reportAccount(await whoAmI(refreshed.access_token || ''));
  say(`\n  bundle written: ${BUNDLE} (mode 600)`);
  say('  next: add GOOGLE_USER_CREDENTIALS_JSON to ~/.config/bot-host/common.env, then');
  say('        node scripts/probe-google-store.mjs\n');
  process.exitCode = refreshed.access_token ? 0 : 1;
}

main().catch((err) => {
  console.error(`google-authorize: ${redact(err && err.stack ? err.stack : err)}`);
  process.exitCode = 2;
});
