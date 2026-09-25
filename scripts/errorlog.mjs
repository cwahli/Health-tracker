#!/usr/bin/env node
/**
 * errorlog.mjs — CLI for the BOT-25 bot error log.
 *
 * Usage:
 *   node scripts/errorlog.mjs list [--status=open|recovering|closed|all] [--json]
 *   node scripts/errorlog.mjs close --id=<12-hex> [--by=manual]
 *   node scripts/errorlog.mjs report [--out=<path>]   # markdown table (stdout when no --out)
 *   node scripts/errorlog.mjs check                   # exit 1 when open/recovering errors exist
 *
 * Store is host-local ($BOT_ERROR_LOG or ~/.hermes/bot-error-log.json).
 * The generated report is intentionally NOT committed: per-host quota state
 * must never become repo content.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listErrors,
  closeError,
  evaluateRecovery,
  errorLogPath,
} from './lib/error-log.mjs';

function arg(name, def = null) {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${name}`);
  if (i >= 0) return argv[i + 1] ?? def;
  const kv = argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}

function printUsage() {
  console.log('usage: errorlog.mjs <list|close|report|check> [options]');
  console.log('  list [--status=open|recovering|closed|all] [--json]');
  console.log('  close --id=<id> [--by=manual]');
  console.log('  report [--out=<path>]');
  console.log('  check   (exit 1 when open/recovering errors exist)');
}

function oneLine(e) {
  const rec = e.recovery ? ` recovery=${e.recovery.rule || '?'}:${e.recovery.ok ? 'ok' : 'pending'}` : '';
  const by = e.closedBy ? ` by=${e.closedBy}` : '';
  return `${e.status === 'open' ? 'OPEN ' : e.status === 'recovering' ? 'RECOV' : 'SHUT '} ${e.id} ${e.count}x [${e.bot || '-'}/${e.lane || '-'}] ${e.kind} last=${(e.last || '').slice(0, 16)}${by}${rec}${e.hint ? ` :: ${e.hint.slice(0, 100)}` : ''}`;
}

function reportMarkdown(rows) {
  const lines = [
    '# Bot error log',
    '',
    `_Updated: ${new Date().toISOString()} — host-local state, do not commit._`,
    '',
    '| ID | Status | ×N | Bot / Lane | Kind | Last | Closed by | Recovery | Hint |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const e of rows) {
    const rec = e.recovery ? `${e.recovery.rule || '?'}:${e.recovery.ok ? 'ok' : 'pending'}` : '-';
    lines.push(`| ${e.id} | ${e.status} | ${e.count} | ${(e.bot || '-')}/${(e.lane || '-')} | ${e.kind} | ${(e.last || '').slice(0, 16)} | ${e.closedBy || '-'} | ${rec} | ${(e.hint || '').slice(0, 80)} |`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const [cmd] = process.argv.slice(2);
  switch (cmd) {
    case 'list': {
      const rows = listErrors({ status: arg('status', 'all') });
      if (process.argv.slice(2).includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        if (!rows.length) console.log('error log clean — no records.');
        for (const e of rows) console.log(oneLine(e));
      }
      break;
    }
    case 'close': {
      const id = arg('id');
      if (!id) { console.error('close needs --id=<id>'); process.exitCode = 2; break; }
      const rec = closeError(id, { by: arg('by', 'manual') });
      if (!rec) { console.error(`unknown error id "${id}"`); process.exitCode = 1; break; }
      console.log(`closed ${rec.id} by=${rec.closedBy}`);
      break;
    }
    case 'report': {
      const out = reportMarkdown(listErrors({ status: 'all' }));
      const dest = arg('out');
      if (dest) {
        fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
        fs.writeFileSync(dest, out);
        console.log(`wrote ${dest}`);
      } else {
        process.stdout.write(out);
      }
      break;
    }
    case 'check': {
      const rows = listErrors({ status: 'all' }).filter((e) => e.status !== 'closed');
      for (const e of rows) console.log(oneLine(e));
      if (rows.length) {
        console.log(`${rows.length} unresolved error(s) — see 'errorlog.mjs list'`);
        process.exitCode = 1;
      } else {
        console.log('error log clean — nothing open.');
      }
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`errorlog: ${err.message}`);
    process.exit(1);
  });
}
