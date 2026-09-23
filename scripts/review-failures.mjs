#!/usr/bin/env node
/**
 * Review bot failures and turn repeats into learning work.
 *
 * Ratchet rule (mirrors AGENTS.md L17 SHEPHERD for code): the FIRST occurrence
 * of a signature is recorded; the SECOND occurrence of the same signature
 * without a linked learning is flagged — it must produce a sensor (unit test,
 * checker rule, guard) or a standing/capability update, not a third debug.
 *
 * Usage:
 *   node scripts/review-failures.mjs [--log <path>] [--since <ISO>] [--threshold 2]
 *   Default log: ~/.hermes/bot-failures.jsonl (or $BOT_FAILURE_LOG).
 */
import { loadFailures, groupFailures, failureLogPath } from './lib/failure-log.mjs';

function arg(name, def = null) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? def;
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}

const logPath = arg('log', failureLogPath());
const since = arg('since', null);
const threshold = Number(arg('threshold', '2')) || 2;

const rows = loadFailures(logPath).filter((r) => !since || (r.at || '') >= since);
const groups = groupFailures(rows);

console.log(`failures: ${rows.length} rows from ${logPath || '(disabled)'}, ${groups.length} signatures (repeat threshold ${threshold})`);
if (!groups.length) {
  console.log('  clean — nothing to learn.');
  process.exit(0);
}

let flagged = 0;
for (const g of groups) {
  const lanes = Object.entries(g.lanes).map(([l, n]) => `${l}×${n}`).join(', ');
  const mark = g.count >= threshold ? 'LEARN  ' : 'watch  ';
  if (g.count >= threshold) flagged += 1;
  console.log(`  ${mark} ${g.count}× "${g.kind}" [${lanes}] first=${(g.first || '').slice(0, 16)} last=${(g.last || '').slice(0, 16)}${g.hint ? ` hint=${g.hint}` : ''}`);
}
if (flagged) {
  console.log(`\n${flagged} signature(s) at/over threshold → convert each into a sensor (test/guard/checker rule) or a standing/capability update, then the repeat stops.`);
}
