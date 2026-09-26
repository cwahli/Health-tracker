#!/usr/bin/env node
/**
 * google-store-flush.mjs — drain a bot's Google spool from the command line.
 *
 * The bot flushes on its own timer and from `/store flush`. This exists for the
 * times that is not enough: the timer has not fired yet, the service is down, or
 * you simply want to see the queue move now. It is the same code path the bot
 * uses — `turn-store` plus `google-writer` — so a manual flush proves exactly what
 * an automatic one would.
 *
 * Zero-burn by default. `--create-sheet` is the one flag that writes outside the
 * project folder's own log, and it says so before doing it.
 *
 * Usage:
 *   node scripts/google-store-flush.mjs --bot=vm
 *   node scripts/google-store-flush.mjs --bot=vm --status
 *   node scripts/google-store-flush.mjs --bot=vm --limit=200
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { flushTurns, storeStatus } from './lib/turn-store.mjs';
import { ensureTurnLog, makeSends, writerFor } from './lib/google-writer.mjs';
import { redact } from './lib/google-store.mjs';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const BOT = arg('bot', process.env.BOT_ID || '');
const LIMIT = Number(arg('limit', '50'));
const STATUS_ONLY = process.argv.includes('--status');
const CREATE_SHEET = process.argv.includes('--create-sheet');

function loadHostEnv() {
  const env = { ...process.env };
  const files = [path.join(os.homedir(), '.config/bot-host/common.env')];
  if (BOT) files.push(path.join(os.homedir(), `.config/bot-host/${BOT}.env`));
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
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
  return env;
}

async function main() {
  if (!BOT) {
    console.error('  --bot=<id> is required (the bot whose spool should be drained)');
    process.exitCode = 2;
    return;
  }
  const env = loadHostEnv();
  const status = storeStatus(BOT);

  if (STATUS_ONLY) {
    console.log(`\n  store spool — ${BOT}`);
    console.log(`  dir      : ${status.dir}`);
    console.log(`  queued   : ${status.pending}${status.pending ? ` (${Object.entries(status.byKind).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`);
    console.log(`  oldest   : ${status.oldest || '-'}\n`);
    process.exitCode = 0;
    return;
  }

  if (!status.pending && !CREATE_SHEET) {
    console.log(`  ${BOT}: nothing queued (${status.dir})`);
    process.exitCode = 0;
    return;
  }

  const writer = await writerFor(env, { force: true });
  if (!writer.ok) {
    console.log(`  ${BOT}: store not ready — ${redact(writer.reason || 'unknown')}`);
    process.exitCode = 1;
    return;
  }

  if (CREATE_SHEET) {
    const { createSheet } = await import('./lib/google-store.mjs');
    const made = await ensureTurnLog(env, writer, { createSheet });
    console.log(`  turn log : ${made.ok ? `${made.created ? 'created' : 'already configured'} (${made.id})` : `FAILED — ${redact(made.reason || '')}`}`);
    if (made.ok && made.created) console.log(`  export   : GOOGLE_TURN_LOG_SHEET_ID=${made.id}  (add it to common.env)`);
    if (!made.ok) process.exitCode = 1;
  }

  const events = [];
  const report = await flushTurns(BOT, makeSends(writer, env), { limit: LIMIT, onEvent: (e) => events.push(e) });
  const after = storeStatus(BOT);
  console.log(`\n  store flush — ${BOT} as ${writer.kind}${writer.account ? ` (${writer.account})` : ''}`);
  for (const e of events) console.log(`    ${e.kind.padEnd(13)} ${e.ok ? 'ok  ' : 'FAIL'} ${e.detail}`);
  console.log(`\n  sent: ${report.sent} · failed: ${report.failed} · still queued: ${after.pending}`);
  if (report.firstError) console.log(`  first error: ${redact(report.firstError)}`);
  console.log('');
  process.exitCode = report.failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`google-store-flush: ${redact(err && err.stack ? err.stack : err)}`);
  process.exitCode = 2;
});
