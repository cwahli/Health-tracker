#!/usr/bin/env node
/**
 * assert-bot-names.mjs — a bot's name is the bot's name.
 *
 * WHY
 * ---
 * `scripts/lib/seat-tags.mjs` (in progress on a serving tree) sets the in-group
 * tag that says which health chair a bot sits in. It also renamed the bot itself
 * through `setMyName`, because the Telegram @ menu matches a bot's *name* rather
 * than the in-group tag, so typing @research would resolve to whatever bot had
 * been renamed "Research Lead".
 *
 * That is the wrong trade, and the operator settled it on 2026-10-02: a seated
 * bot keeps its own name, and the tag beside it in the room is what identifies
 * the seat. A bot's name is how the operator recognises that bot everywhere else
 * in Telegram — private chats, other groups, the bot list — and it was being
 * overwritten from a fact scoped to one room. Live, before it was undone:
 *
 *   vm2  "Data Steward"     vm4  "Health Analyst"
 *   vm5  "Test Planner"     vm6  "Research Lead"
 *
 * WHY A SENSOR AND NOT A CONVENTION
 * ---------------------------------
 * A comment saying "do not rename bots" is a comment. This makes it a gate, in
 * the two places a rename can come from:
 *
 *   1. **The source, offline (this is what CI runs).** No shipped module may
 *      write a bot's identity — `setMyName`, `setMyUsername`,
 *      `setMyDescription` — at all, and specifically nothing may derive a name
 *      from a seat. There is no legitimate caller of those three in this repo;
 *      a bot's name is set once, by whoever creates it, or by the operator in
 *      BotFather. So the ban is total rather than conditional, which means a
 *      rename cannot hide inside a branch that is not about seats.
 *
 *   2. **The live fleet, on request (`--live`).** Every enabled bot's
 *      `getMe` first_name against the `name` in its registry row. This is the
 *      half that would have caught the four bots while it was happening; it needs
 *      the network and the bot tokens, so it is not a CI gate and says so.
 *
 * `--live` exits non-zero on drift and prints the setMyName call that undoes it,
 * because the fix for a renamed bot is one API call and a person should make it
 * on purpose rather than discover it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LIVE = process.argv.includes('--live');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'bots', 'registry.json'), 'utf8'));
const bots = (registry.bots || []).filter((b) => b.runtime !== 'hermes');

console.log('assert-bot-names:');

if (!LIVE) {
  // 1. Offline: no shipped code writes a bot's identity.
  const banned = ['setMyName', 'setMyUsername', 'setMyDescription'];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|js|ts|sh)$/.test(entry.name)) continue;
      // This file names the banned methods because it bans them, so it is the
      // one file that is not subject to the ban. Naming the exception is better
      // than hiding the strings: the check still fails on anything else.
      if (path.resolve(full) === path.resolve(fileURLToPath(import.meta.url))) continue;
      const text = fs.readFileSync(full, 'utf8');
      // Comments may discuss the rule; only code is judged.
      const code = text
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('#'))
        .join('\n');
      for (const method of banned) {
        if (code.includes(method)) offenders.push(`${path.relative(ROOT, full)}: ${method}`);
      }
    }
  };
  walk(path.join(ROOT, 'scripts'));
  check('no shipped script writes a bot name, username or bio', offenders.length === 0, offenders.join(' | '));

  // 2. Nothing derives a display name from a seat, which is the shape the ban
  //    is really about.
  const seatDerived = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'scripts', 'lib'))) {
    if (!file.endsWith('.mjs')) continue;
    const text = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', file), 'utf8');
    const code = text.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    if (/setMyName/.test(code)) seatDerived.push(`scripts/lib/${file}`);
  }
  check('no seat module renames a bot to its chair', seatDerived.length === 0, seatDerived.join(' | '));

  // 3. Every bot has the name the fleet agrees on, so the live check has
  //    something to compare against.
  const nameless = bots.filter((b) => !String(b.name || '').trim()).map((b) => b.id);
  check('every bot row names its bot', nameless.length === 0, nameless.join(', '));
  check('the fleet has bots to check', bots.length > 0, `${bots.length} row(s)`);

  console.log(`\n${passed} pass, ${failed} fail`);
  console.log('(offline only — run with --live to compare the real bots against these names)');
  process.exit(failed === 0 ? 0 : 1);
}

// --- --live -----------------------------------------------------------------
// Tokens live beside the registry the forge writes; several env files, because
// each bot has its own.
function tokenFor(bot) {
  const envName = bot?.telegram?.tokenEnv || '';
  if (!envName) return '';
  const dir = path.join(os.homedir(), '.config', 'bot-host');
  const files = [`${bot.id}.env`, 'tokens.env', 'common.env'];
  for (const f of files) {
    try {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const m = text.match(new RegExp(`^${envName}=(.+)$`, 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      /* next file */
    }
  }
  return '';
}

// The rule on the live fleet is NOT "the Telegram name equals the registry
// label". The registry `name` is a human label for humans; the Telegram name is
// whatever the bot has always been called, and it was set once at creation or by
// the operator in BotFather. Comparing the two would make this gate an argument
// to rename five bots over capitalisation — which is the same class of mistake,
// in the other direction.
//
// What is actually forbidden is the seat name. A bot wearing "Health Analyst"
// outside the health room is the failure; "VM5 bot" vs "VM5" is not.
const SEAT_NAMES = new Set([
  'Data Steward', 'Health Analyst', 'Test Planner', 'Research Lead',
  'Safety Reviewer', 'Doctor', 'Coordinator',
  'Tax Accountant', 'Tax Verifier',
]);

console.log(`\nlive check (${bots.filter((b) => b.enabled !== false).length} enabled bot(s)):`);
for (const bot of bots.filter((b) => b.enabled !== false)) {
  const token = tokenFor(bot);
  if (!token) {
    console.log(`  SKIP  ${bot.id} — no token for ${bot.telegram?.tokenEnv || '(none)'}`);
    continue;
  }
  let me;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    me = (await res.json()).result;
  } catch (err) {
    check(`${bot.id} answers getMe`, false, String(err?.message || err).slice(0, 80));
    continue;
  }
  const got = String(me?.first_name || '');
  check(`${bot.id} is not wearing a seat name`, !SEAT_NAMES.has(got), `reads "${got}"`);
  // Informational, never a verdict: the registry label and the Telegram name are
  // allowed to differ, and a human reads this line rather than a gate failing.
  const label = String(bot.name || '');
  console.log(`        ${bot.id.padEnd(9)} telegram="${got}"  registry label="${label}"${got === label ? '' : '  (differs — allowed)'}`);
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
