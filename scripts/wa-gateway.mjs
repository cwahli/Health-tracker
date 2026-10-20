#!/usr/bin/env node
/**
 * wa-gateway: unofficial WhatsApp companion watcher (plan B).
 *
 * Why this exists: Meta Cloud API delivers nothing while the app is
 * unpublished and Business Verification needs docs we don't have. This
 * service pairs the spare SIM as a companion device (Baileys) and WATCHES
 * the inbox for `LOGIN wa_<code>` messages, marking them verified in D1 —
 * the same row the Meta webhook would have marked. Pure inbound: it NEVER
 * sends messages (ban-risk hygiene + $0).
 *
 * Env (deploy .env carries all of these):
 *   CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN
 *   WA_GATEWAY_AUTH_DIR  auth-state dir (default ~/.wa-gateway/auth)
 *   WA_GATEWAY_QR_FILE   where to write the pairing QR png
 *                        (default <auth-dir>/../qr.png)
 *   WA_EXPECT_NUMBER     digits-only spare number; inbound from anyone still
 *                        verifies (identity is the sender), this is only logged.
 *
 * Run: node scripts/wa-gateway.mjs  (systemd wa-gateway.service in prod)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import QRCode from 'qrcode';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { parseGatewayCode, extractGatewayText, extractGatewayWaId } from './wa-gateway-lib.mjs';

const AUTH_DIR = process.env.WA_GATEWAY_AUTH_DIR || join(homedir(), '.wa-gateway', 'auth');
const QR_FILE = process.env.WA_GATEWAY_QR_FILE || join(dirname(AUTH_DIR), 'qr.png');
const log = (...a) => console.log('[wa-gateway]', new Date().toISOString(), ...a);

function d1env() {
  return {
    accountId: (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    databaseId: (process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim(),
    token: (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_API_TOKEN || '').trim(),
  };
}

async function d1Query(sql, params) {
  const { accountId, databaseId, token } = d1env();
  if (!accountId || !databaseId || !token) return { ok: false, error: 'D1 env missing' };
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    return { ok: false, error: json?.errors?.[0]?.message || `D1 HTTP ${res.status}` };
  }
  const batch = Array.isArray(json.result) ? json.result[0] : json.result;
  return { ok: true, results: batch?.results || [], meta: batch?.meta };
}

/** Same claim the Meta webhook performs (server_whatsapp.markCodeVerified). */
async function markVerified(code) {
  const codeHash = createHash('sha256').update(code, 'utf8').digest('hex');
  const now = Date.now();
  const found = await d1Query('SELECT code_hash FROM wa_login_codes WHERE code_hash = ? LIMIT 1', [codeHash]);
  if (!found.ok || found.results.length === 0) return { claimed: false, reason: 'unknown-code' };
  return { claimed: true, codeHash, now };
}

async function claimVerified(codeHash, waId, now) {
  const res = await d1Query(
    `UPDATE wa_login_codes SET wa_id = ?, verified_at = ?
     WHERE code_hash = ? AND verified_at IS NULL AND consumed_at IS NULL AND expires_at > ?`,
    [waId, now, codeHash, now],
  );
  if (!res.ok) return false;
  if (typeof res.meta?.changes === 'number') return res.meta.changes === 1;
  return true;
}

async function handleMessage(msg) {
  try {
    if (!msg?.message || msg.key?.fromMe) return;
    const waId = extractGatewayWaId(msg.key.remoteJid);
    if (!waId) return;
    const text = extractGatewayText(msg);
    if (!text) return;
    const code = parseGatewayCode(text);
    if (!code) return;
    const pre = await markVerified(code);
    if (!pre.claimed) {
      log('code not pending (expired/unknown), ignoring', msg.key.id);
      return;
    }
    const ok = await claimVerified(pre.codeHash, waId, pre.now);
    log(ok ? 'VERIFIED' : 'RACE-LOST', code.slice(0, 8) + '…', 'from', waId, msg.key.id);
  } catch (err) {
    log('handle error', err?.message || err);
  }
}

async function writeQr(qr) {
  try {
    await QRCode.toFile(QR_FILE, qr, { width: 360, margin: 2 });
    log('PAIRING QR written to', QR_FILE, '— scan from the spare phone: WhatsApp > Linked devices > Link a device');
  } catch (err) {
    log('QR write failed', err?.message || err);
  }
}

async function start() {
  mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ['HealthTracker', 'gateway', '1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) await writeQr(qr);
    if (connection === 'open') log('connected as companion, watching inbox');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      log('connection closed', code);
      if (code === DisconnectReason.loggedOut) {
        log('logged out: clearing auth, need fresh QR scan');
        rmSync(AUTH_DIR, { recursive: true, force: true });
      }
      await new Promise((r) => setTimeout(r, 5000));
      start().catch((e) => log('restart failed', e?.message || e));
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages || []) await handleMessage(m);
  });
  log('starting');
}

start().catch((e) => {
  log('fatal', e?.message || e);
  process.exit(1);
});
