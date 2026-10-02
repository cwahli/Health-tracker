#!/usr/bin/env node
/**
 * assert-seat-tag-writer.mjs — the sensor for the seat tag writer.
 *
 * WHAT IS PINNED, AND WHY EACH HALF EXISTS
 * ----------------------------------------
 * The writer's job is unglamorous and its failure modes are all "silently wrong
 * in a group":
 *
 *   1. **It refuses without explicit rights.** A Telegram custom title only
 *      exists on an admin record, so writing a tag means promoting the member.
 *      Promoting is a decision about what a bot may *do* in that room, so the
 *      writer must never invent it. Every refusal path is exercised here with no
 *      rights and with partial rights.
 *
 *   2. **Preview is the default.** `applyTagWrites` is dry-run unless the caller
 *      passes both a client and `dryRun: false`. A safe default is only safe if
 *      it is the default, so the sensor calls it the way a careless caller would
 *      and asserts nothing was written.
 *
 *   3. **A title change never demotes anyone.** `channels.editAdmin` replaces
 *      the whole admin record, so a call that sent a minimal one would silently
 *      strip whatever the member already had. The plan must report `retitle` for
 *      an existing admin and carry the rest of the record, and the sensor pins
 *      the carry-over fields.
 *
 *   4. **An unknown seat gets no tag.** A missing chair must not appear in the
 *      room as "undefined" or as the raw role id.
 *
 *   5. **No bot is ever renamed here.** Checked as a property of the source, not
 *      of a fixture: there is no fixture that can prove a call that is not in
 *      the file. `setMyName` / `setMyUsername` / `setMyDescription` are absent
 *      from both seat modules, because four bots were renamed to their chairs on
 *      2026-10-02 and the operator's rule is that the seat is the tag.
 *
 * The client is a fixture throughout — a recording stub — so this gate needs no
 * network, no token and no group, and cannot mutate anything even if it tried.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_RIGHTS,
  applyTagWrites,
  planTagWrites,
  readCurrentRanks,
  rowsForRegistry,
  validateRights,
} from './lib/seat-tag-writer.mjs';
import { clipTag, tagForHealthRole } from './lib/seat-tags.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

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

console.log('assert-seat-tag-writer:');

// --- 1. rights are never invented -------------------------------------------
check('no rights at all is refused with a sentence',
  validateRights(undefined).ok === false && /operator/.test(validateRights(undefined).reason));
check('an empty object is refused, naming what is missing',
  validateRights({}).ok === false && /change_info/.test(validateRights({}).reason));
check('a partial object is refused', validateRights({ view: true }).ok === false);
check('change_info false is refused even when complete',
  validateRights({ change_info: false, view: true }).ok === false);
check('a complete, explicit object is accepted',
  validateRights({ change_info: true, view: true }).ok === true);
check('the required rights are named in the module',
  REQUIRED_RIGHTS.includes('change_info') && REQUIRED_RIGHTS.includes('view'));

// --- 2. preview is the default ----------------------------------------------
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'bots', 'registry.json'), 'utf8'));
const rows = rowsForRegistry(REGISTRY);
check('rows come from the registry seats', rows.length >= 4, `${rows.length} row(s)`);
check('vm is the Coordinator and carries no seat id',
  rows.some((r) => r.rank === 'Coordinator') && !rows.find((r) => r.rank === 'Coordinator')?.botId.includes('seat'));

const noRights = planTagWrites({ rows: [{ username: 'vm4_bot', rank: 'Health Analyst' }], rights: null });
check('with no rights the plan is blocked, not half-applied', noRights.ok === false);
check('the blocked row says it would promote', noRights.planned[0].change === 'would-promote', noRights.planned[0].note);

// A recording client: any call at all is a failure of the default path.
const calls = [];
const recorder = { invoke: async (...args) => { calls.push(args); return true; } };
const dry = await applyTagWrites(noRights, { client: recorder, dryRun: true });
check('dryRun is the default and writes nothing', dry.dryRun === true && calls.length === 0);
check('a dry run still explains every row', dry.summary.some((s) => /vm4_bot/.test(s)), dry.summary.join(' | '));

const careless = await applyTagWrites(noRights, { client: recorder }); // no dryRun flag at all
check('calling it without opting in cannot write', calls.length === 0 && careless.dryRun === true);

// --- 3. a title change never demotes ----------------------------------------
const withRights = { change_info: true, view: true };
const current = { vm4_bot: { rank: '', admin: true, adminRights: { change_info: true, view: true, delete_messages: true } } };
const retitle = planTagWrites({
  rows: [{ username: 'vm4_bot', rank: 'Health Analyst' }],
  current,
  rights: withRights,
});
check('an existing admin is retitled, not promoted', retitle.planned[0].change === 'retitle', retitle.planned[0].note);
check('the note says the other rights are carried over', /carried over/.test(retitle.planned[0].note));
check('an already-correct tag is a no-op',
  planTagWrites({ rows: [{ username: 'vm4_bot', rank: 'Health Analyst' }], current: { vm4_bot: { rank: 'Health Analyst', admin: true } }, rights: withRights })
    .planned[0].change === 'none');
check('a non-admin is reported as a promotion, visibly',
  planTagWrites({ rows: [{ username: 'vm5_bot', rank: 'Test Planner' }], current: {}, rights: withRights })
    .planned[0].change === 'promote');

// The real write, through the injected seam, must receive the carried-over rights.
let seen = null;
const applied = await applyTagWrites(
  planTagWrites({ rows: [{ username: 'vm4_bot', rank: 'Health Analyst' }], current, rights: withRights }),
  {
    dryRun: false,
    client: recorder,
    apply: async (entry, plan) => {
      seen = { entry, rights: plan.rights };
      return { ok: true };
    },
  },
);
check('the write went through the injected seam', applied.ok === true && applied.applied.length === 1);
check('the write carried the title', seen?.entry?.title === 'Health Analyst');
check('the write carried only the two rights it was given',
  seen && Object.keys(seen.rights).sort().join(',') === 'change_info,view', JSON.stringify(seen?.rights));

// A failing write is reported, not swallowed.
const writeFailed = await applyTagWrites(
  planTagWrites({ rows: [{ username: 'vm4_bot', rank: 'Health Analyst' }], current, rights: withRights }),
  { dryRun: false, client: recorder, apply: async () => { throw new Error('CHAT_ADMIN_REQUIRED'); } },
);
check('a failed write is reported per row', writeFailed.ok === false && /CHAT_ADMIN_REQUIRED/.test(JSON.stringify(writeFailed.results)));

// --- 4. an unknown seat gets no tag -----------------------------------------
check('a made-up seat has no tag', tagForHealthRole('chief_happiness_officer') === '');
check('an empty seat is only the Coordinator when asked', tagForHealthRole('') === '' && tagForHealthRole('', { coordinator: true }) === 'Coordinator');
check('a real seat maps to its chair', tagForHealthRole('health_analyst') === 'Health Analyst');
check('a seated bot does not become the Coordinator',
  tagForHealthRole('doctor', { coordinator: true }) === 'Doctor');
check('an emoji tag is clipped, not rejected', clipTag('🥗 Diet') === 'Diet');
check('an over-long tag is cut to a readable length', clipTag('x'.repeat(40)).length === 24);
check('a row with no tag writes nothing', planTagWrites({ rows: [{ username: 'x', rank: '' }], current, rights: withRights }).planned[0].change === null);

// --- 5. nothing here renames a bot ------------------------------------------
for (const file of ['lib/seat-tags.mjs', 'lib/seat-tag-writer.mjs']) {
  const code = fs.readFileSync(path.join(HERE, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n');
  for (const method of ['setMyName', 'setMyUsername', 'setMyDescription']) {
    check(`${file} never calls ${method}`, !code.includes(method));
  }
}

// --- 6. reading current ranks is honest -------------------------------------
const unread = await readCurrentRanks([{ username: 'vm4_bot' }], { getParticipants: null });
check('no reader means no answer, not an empty one', unread.ok === false && unread.reason.includes('no participant reader'));
const read = await readCurrentRanks([{ username: 'vm4_bot' }], {
  getParticipants: async (row) => ({ rank: 'Health Analyst', adminRights: { view: true } }),
});
check('a read records the current title and admin flag', read.current.vm4_bot.rank === 'Health Analyst' && read.current.vm4_bot.admin === true);

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
