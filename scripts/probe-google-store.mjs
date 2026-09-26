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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  SCOPES,
  accessToken,
  forgetToken,
  googleReady,
  listFolder,
  redact,
  serviceAccountFromEnv,
} from './lib/google-store.mjs';

const BOT_ID = process.env.BOT_ID || process.argv.find((a) => a.startsWith('--bot='))?.slice(6) || 'probe';
const LOCATION = process.env.LOCATION || 'vps';
const JSON_OUT = process.argv.includes('--json');

/**
 * The service reads its credentials from ~/.config/bot-host/{common,<id>}.env.
 * A probe run from a plain shell would report "no credential" for a provider the
 * live bot is using, so the same files are read here with systemd EnvironmentFile
 * quote-stripping, and the sources are printed so the output says which env it
 * judged.
 */
function loadHostEnv() {
  const home = os.homedir();
  const env = { ...process.env };
  const envSources = ['process env'];
  for (const file of [`${home}/.config/bot-host/common.env`, `${home}/.config/bot-host/${BOT_ID}.env`]) {
    let text = '';
    try {
      if (!fs.existsSync(file)) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    envSources.push(path.basename(file));
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
      if (value) {
        env[m[1]] = value;
        process.env[m[1]] = value;
      }
    }
  }
  return { env, envSources };
}

const rows = [];
const row = (field, value, state) => rows.push({ field, value: String(value), state });

async function main() {
  const { env, envSources } = loadHostEnv();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const sa = serviceAccountFromEnv(env);
  const ready = googleReady(env);

  row('utc', now, 'info');
  row('bot', BOT_ID, 'info');
  row('location', LOCATION, 'info');
  row('env sources', envSources.join(', '), 'info');
  row('credential', ready.ready ? `ok (${redact(ready.source)})` : `MISSING — ${redact(ready.reason)}`, ready.ready ? 'pass' : 'fail');
  row('service account', sa.ok ? sa.email : 'unreadable', sa.ok ? 'pass' : 'fail');
  row('scopes', Object.keys(SCOPES).join(' '), 'info');

  // Bracket notation on purpose: `obj?.health-tracker` parses as `(obj?.health) - tracker`.
  const named = ready.folders?.['health-tracker'] || ready.folders?.['health_tracker'] || '';
  const folder = ready.folder || named || '';
  row('folder id', folder ? `${folder.slice(0, 8)}…` : 'none', folder ? 'pass' : 'fail');
  const others = Object.entries(ready.folders || {});
  if (others.length) row('folders', others.map(([k, v]) => `${k}=${String(v).slice(0, 8)}…`).join(' '), 'pass');

  let tokenOk = false;
  if (sa.ok) {
    const tok = await accessToken(sa, { scopes: Object.values(SCOPES) });
    tokenOk = tok.ok;
    row('token grant', tok.ok ? `ok (${tok.cached ? 'cached' : 'minted'})` : `FAILED — ${redact(tok.error || '')}`, tok.ok ? 'pass' : 'fail');
  } else {
    row('token grant', 'not attempted (no credential)', 'skip');
  }

  let visible = 0;
  if (tokenOk && folder) {
    const listed = await listFolder(folder, await accessToken(sa, { scopes: Object.values(SCOPES) }).then((t) => t.token));
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
