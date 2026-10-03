#!/usr/bin/env node
/**
 * seat-tags.mjs — show, and optionally apply, the Health-coach seat tags.
 *
 * WHAT IT IS
 * ----------
 * The operator's front door to `lib/seat-tag-writer.mjs`. Running it with no
 * arguments prints exactly what would change and changes nothing. That is the
 * default on purpose: the write touches admin records in a live group, and a
 * tool whose safe mode is the one you have to ask for is a tool people will
 * skip.
 *
 *   node scripts/seat-tags.mjs                      # the plan, nothing sent
 *   node scripts/seat-tags.mjs --rights=change_info:true,view:true
 *                                                   # the plan with rights resolved
 *   node scripts/seat-tags.mjs --apply --rights=change_info:true,view:true
 *                                                   # do it
 *
 * WHY `--apply` NEEDS `--rights` IN THE SAME BREATH
 * --------------------------------------------------
 * A Telegram custom title lives on an admin record, so tagging a seat means
 * promoting that member. Promotion is a decision about what a bot may do in that
 * room, so it is the operator's to state, in the command, where it is visible in
 * the shell history and in the output. The writer will not supply a default:
 * `validateRights` refuses rather than guessing, and this CLI surfaces that as a
 * sentence instead of a stack trace.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * Rename a bot. There is no `setMyName` on this path, and
 * scripts/assert-bot-names.mjs fails the build if one appears.
 *
 * WHO IT TALKS AS
 * ---------------
 * The creator session (`tg-user.session`), because a bot cannot set its own tag
 * in a group the operator created. An unconfigured host is the normal state and
 * the answer is the commands to fix it, not a crash.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyTagWrites,
  planTagWrites,
  readCurrentRanks,
  rowsForRegistry,
  validateRights,
} from './lib/seat-tag-writer.mjs';
import { HEALTH_GROUP_TITLE } from './lib/seat-tags.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = flag('apply');
const JSON_OUT = flag('json');
const GROUP = value('group', HEALTH_GROUP_TITLE);

/** `change_info:true,view:true` -> { change_info: true, view: true } */
function parseRights(text) {
  const out = {};
  for (const pair of String(text || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = pair.split(':').map((s) => String(s).trim());
    if (!k) continue;
    if (v === 'true') out[k] = true;
    else if (v === 'false') out[k] = false;
    else out[k] = v;
  }
  return out;
}

const rights = parseRights(value('rights'));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'bots', 'registry.json'), 'utf8'));
const rows = rowsForRegistry(registry);

/**
 * The registry row carries a tokenEnv, not a @username, so every row arrived
 * here as "@?" and the plan could not be matched against the room. Resolving the
 * username from the bot token is a `getMe`: read-only, and it is the only
 * honest way to learn what a member is called without writing anything. (It is
 * deliberately NOT the display name — the seat is the tag, and the name belongs
 * to the bot.)
 */
async function resolveUsernames(list) {
  const dir = path.join(os.homedir(), '.config', 'bot-host');
  const envText = [];
  for (const f of ['tokens.env', 'common.env']) {
    try {
      envText.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      /* not every host has every file */
    }
  }
  for (const row of list) {
    const bot = (registry.bots || []).find((b) => b.id === row.botId);
    const envName = bot?.telegram?.tokenEnv || '';
    let token = '';
    for (const text of [path.join(dir, `${row.botId}.env`), ...envText.map((t) => t)]) {
      if (!text) continue;
      try {
        const m = fs.readFileSync(text, 'utf8').match(new RegExp(`^${envName}=(.+)$`, 'm'));
        if (m) {
          token = m[1].trim().replace(/^["']|["']$/g, '');
          break;
        }
      } catch {
        /* next source */
      }
    }
    if (!token) continue;
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
      row.username = me?.result?.username || '';
      row.userId = me?.result?.id ?? null;
    } catch {
      /* leave blank; the plan will say so rather than guess */
    }
  }
}
if (!flag('no-resolve')) await resolveUsernames(rows);

// Read the room so the plan says "would promote" rather than "already correct"
// when the member is not an admin. A missing session is not fatal: the plan is
// still worth printing, with every row marked as needing a read.
let current = {};
let readNote = '';
let getParticipants = null;
if (!flag('no-read')) {
  try {
    const { connect } = await import('./lib/tg-userbot-internal.mjs');
    const connected = await connect({});
    if (connected.ok) {
      const client = connected.client;
      const dialogs = await client.getDialogs({ limit: 200 });
      const matches = dialogs.filter((d) => (d.chat?.title || d.name || '') === GROUP);
      const group = matches.find((d) => d.isChannel) || matches[0];
      if (!group) {
        readNote = `group "${GROUP}" is not in the creator session's dialogs — run as the account that owns it`;
      } else {
        const byName = new Map();
        for await (const p of client.iterParticipants(group.entity)) {
          const rank = p.participant?.rank || p.adminRights?.rank || '';
          const admin = Boolean(p.participant?.adminRights || p.adminRights || p.participant?.className?.includes('Admin') || p.participant?.className?.includes('Creator'));
          byName.set(p.username || '', { rank, admin });
        }
        getParticipants = async (row) => byName.get(row.username) || null;
      }
    } else {
      readNote = connected.reason;
    }
  } catch (err) {
    readNote = String(err?.message || err).slice(0, 160);
  }
}
const read = await readCurrentRanks(rows, { getParticipants });
if (read.ok) current = read.current;

const verdict = validateRights(rights);
const plan = planTagWrites({ rows, current, rights: verdict.ok ? rights : null, title: GROUP });

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: plan.ok, reason: plan.reason, rights: plan.rights, title: GROUP, readNote, planned: plan.planned }, null, 2));
  process.exit(0);
}

console.log(`Health-coach seat tags${APPLY ? ' — APPLYING' : ' — plan only, nothing sent'}`);
if (readNote) console.log(`  (could not read the room: ${readNote})`);
console.log('');
for (const entry of plan.planned) {
  const was = entry.currentTitle ? `"${entry.currentTitle}"` : '(none)';
  console.log(`  @${String(entry.username || '?').padEnd(22)} ${entry.currentTitle === entry.title ? '=' : '→'} ${entry.title || '(no tag)'}   was ${was}   ${entry.note}`);
}
console.log('');
if (!verdict.ok) {
  console.log(`Refusing to apply: ${verdict.reason}`);
  console.log('');
  console.log('State the rights explicitly, e.g.');
  console.log(`  node scripts/seat-tags.mjs --apply --rights=change_info:true,view:true`);
  console.log('');
  console.log('  change_info  Telegram\'s own permission for editing a member\'s title — required.');
  console.log('  view         reading the member list to find the current record.');
  console.log('');
  console.log('Everything else a member already has is carried over untouched; this only ever');
  console.log('adds a title. Promoting is a decision about what a bot may do in that room, so');
  console.log('it is stated here rather than defaulted here.');
  process.exit(plan.planned.some((p) => p.title && p.currentTitle !== p.title) ? 2 : 0);
}

if (!APPLY) {
  console.log('Nothing sent. Re-run with --apply to write these.');
  process.exit(0);
}

const result = await applyTagWrites(plan, {
  dryRun: false,
  apply: async (entry) => {
    const { writeCustomTitle } = await import('./lib/seat-tag-write-live.mjs');
    return writeCustomTitle({ group: GROUP, username: entry.username, title: entry.title, rights: plan.rights });
  },
});
console.log(result.ok ? 'All tags written.' : 'Some tags were not written — see above.');
for (const row of result.results || []) {
  console.log(`  ${row.ok ? 'OK  ' : 'FAIL'} @${row.username} ${row.reason || ''}`);
}
process.exit(result.ok ? 0 : 1);
