#!/usr/bin/env node
/**
 * probe-google-store.mjs — zero-burn readiness for the Google store.
 *
 * The lane probe answers "what can this host do?" without touching a provider.
 * This one answers the same question for Drive/Sheets/Docs and, by construction,
 * writes nothing: it mints a token, lists one page of the configured folder, and
 * stops. No file is created, no row is appended, no Doc is made. That is what
 * makes it safe to run on a schedule and before the pilot.
 *
 * A red row here names the missing piece instead of throwing, because a location
 * that is not enrolled must say which variable is absent, not crash a turn.
 *
 * Usage:
 *   node scripts/probe-google-store.mjs            # table + verdict
 *   node scripts/probe-google-store.mjs --json     # machine-readable
 */

import process from 'node:process';

import {
  SCOPES,
  accessToken,
  forgetToken,
  googleReady,
  folderFor,
  identityFromEnv,
  listFolder,
  loadHostEnv,
  redact,
} from './lib/google-store.mjs';

const BOT_ID = process.env.BOT_ID || process.argv.find((a) => a.startsWith('--bot='))?.slice(6) || 'probe';
const LOCATION = process.env.LOCATION || 'vps';
const JSON_OUT = process.argv.includes('--json');

const rows = [];
const row = (field, value, state) => rows.push({ field, value: String(value), state });

/** Drive metadata reads never throw here: a red row must explain itself. */
async function metajsonSafe(res) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function main() {
  const { env, sources: envSources } = loadHostEnv(BOT_ID);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const who = identityFromEnv(env);
  const ready = googleReady(env);

  row('utc', now, 'info');
  row('bot', BOT_ID, 'info');
  row('location', LOCATION, 'info');
  row('env sources', envSources.join(', '), 'info');
  // Bracket notation on purpose: `obj?.health-tracker` parses as `(obj?.health) - tracker`.
  const folder = folderFor(ready, 'health-tracker');
  const credOk = ready.ready && Boolean(folder);
  row('credential', credOk ? `ok (${redact(ready.source)})` : `MISSING — ${redact(ready.reason || 'no folder enrolled')}`, credOk ? 'pass' : 'fail');
  row('identity', who.ok ? who.kind : 'none', who.ok ? 'pass' : 'fail');
  row('account', who.ok ? (who.email || 'unknown until a grant is read') : 'unreadable', who.ok ? 'pass' : 'fail');
  row('scopes', Object.keys(SCOPES).join(' '), 'info');

  row('folder id', folder ? `${folder.slice(0, 8)}…` : 'none', folder ? 'pass' : 'fail');
  const others = Object.entries(ready.folders || {});
  if (others.length) row('folders', others.map(([k, v]) => `${k}=${String(v).slice(0, 8)}…`).join(' '), 'pass');

  let tokenOk = false;
  if (who.ok) {
    const tok = await accessToken(who, { scopes: Object.values(SCOPES) });
    tokenOk = tok.ok;
    row('token grant', tok.ok ? `ok (${tok.cached ? 'cached' : 'minted'}, ${tok.kind})` : `FAILED — ${redact(tok.error || '')}${tok.hint ? ` — ${tok.hint}` : ''}`, tok.ok ? 'pass' : 'fail');
  } else {
    row('token grant', 'not attempted (no credential)', 'skip');
  }

  let visible = 0;
  if (tokenOk && folder) {
    const listed = await listFolder(folder, await accessToken(who, { scopes: Object.values(SCOPES) }).then((t) => t.token));
    if (listed.ok) {
      visible = (listed.json.files || []).length;
      row('drive list (read-only)', `ok — ${visible} object(s) visible`, 'pass');
    } else {
      row('drive list (read-only)', `FAILED — ${redact(listed.error || '')}`, 'fail');
    }
  } else {
    row('drive list (read-only)', 'not attempted', 'skip');
  }

  row('sheets', tokenOk ? 'token holds spreadsheet scope; first tab created in G-1 (this probe writes nothing)' : 'no token', tokenOk ? 'pass' : 'skip');
  row('docs', tokenOk ? 'token holds documents scope; first Doc generated in G-4 (this probe writes nothing)' : 'no token', tokenOk ? 'pass' : 'skip');

  // The one thing a read *can* prove, and the thing that silently breaks every
  // write: Drive says `canAddChildren: true` for a folder shared with a service
  // account and then refuses the create with 403 "Service Accounts do not have
  // storage quota". A file is owned by whoever created it, so the identity needs
  // storage of its own — a shared drive, or a real account. Both are visible
  // without writing anything: `about.get` reports the quota, and a My Drive
  // folder has no `driveId`.
  if (tokenOk) {
    const tok2 = await accessToken(who, { scopes: Object.values(SCOPES) });
    const about = await metajsonSafe(await fetch(`https://www.googleapis.com/drive/v3/about?fields=${encodeURIComponent('user,storageQuota')}`, {
      headers: { Authorization: `Bearer ${tok2.token}` },
    }));
    const limit = Number(String(about?.storageQuota?.limit || '0').replace(/\D/g, '')) || 0;
    row('drive quota', limit ? `${(Number(String(about.storageQuota.usage || '0').replace(/\D/g, '')) / 1e9).toFixed(2)} GB used of ${(limit / 1e9).toFixed(2)} GB` : 'none reported', limit ? 'pass' : 'fail');
    if (folder) {
      const meta = await metajsonSafe(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder)}?fields=${encodeURIComponent('id,name,driveId,ownedByMe,capabilities(canAddChildren)')}`, {
        headers: { Authorization: `Bearer ${tok2.token}` },
      }));
      const shared = Boolean(meta.driveId);
      row('folder name', meta.name || 'unreadable', 'info');
      row('folder is a shared drive', shared ? `yes (${meta.driveId})` : 'no — My Drive folder', 'info');
      // The verdict, stated per identity rather than as one verdict for both.
      const saMode = who.kind === 'service_account';
      row('write ownership', saMode
        ? (shared ? 'the drive owns created files, so a service account can create' : 'a service account cannot own files here — writes will 403 (needs a shared drive)')
        : (limit ? `the account owns storage (${(limit / 1e9).toFixed(2)} GB), so creates in its own Drive work` : 'this account reports no storage quota — creates will 403'),
      (saMode ? shared : limit > 0) ? 'pass' : 'fail');
    } else {
      row('write ownership', 'not attempted (no folder)', 'skip');
    }
  } else {
    row('write ownership', 'not attempted (no token)', 'skip');
  }

  row('writes this run', '0 (zero-burn by construction)', 'pass');

  forgetToken();

  const fails = rows.filter((r) => r.state === 'fail');
  const verdict = fails.length === 0 ? 'READY' : 'NOT READY';
  const report = { verdict, location: LOCATION, bot: BOT_ID, rows, fails: fails.length };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const w = Math.max(...rows.map((r) => r.field.length));
    const mark = { pass: 'ok  ', fail: 'FAIL', skip: 'skip', info: '    ' };
    console.log(`\n  google store — ${LOCATION} / ${BOT_ID}   ${verdict}\n`);
    for (const r of rows) console.log(`  ${mark[r.state]} ${r.field.padEnd(w)}  ${r.value}`);
    console.log('');
  }
  process.exitCode = fails.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`probe-google-store: ${redact(err && err.message ? err.message : err)}`);
  process.exitCode = 2;
});
