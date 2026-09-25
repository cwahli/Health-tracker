#!/usr/bin/env node
/**
 * assert-session-key.test.mjs — the session a chat has must follow the chat.
 *
 * `sessionKey` used to be location + chat + workspace, so a session could only
 * ever be found on the machine that created it: `/location collab` re-keyed the
 * row, and a poller moved to the notebook looked up a path that did not exist
 * there (`vps|chat|/home/ubuntu/src/Health-tracker` vs
 * `mobile|chat|/root/Health-tracker`). The key is chat + project now.
 *
 * These are the three shapes the location experiment measures (A move the
 * poller, B move the compute, C share the store). A sensor, not a live proof:
 * the live pass for a location card still goes through Telegram.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { sessionKey, projectIdForWorkspace, resolveSession, getSession } =
  await import(path.join(HERE, 'lib', 'work-session.mjs'));
const { workspaceForId } = await import(path.join(HERE, 'lib', 'project-registry.mjs'));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('assert-session-key\n');

const CHAT = '6218257274';
const WS_VM = '/home/ubuntu/src/Health-tracker';
const WS_COLLAB = '/root/Health-tracker';

// 1. The key does not name a machine.
const onVm = sessionKey({ location: 'vps', chat: CHAT, workspace: WS_VM });
const onCollab = sessionKey({ location: 'mobile', chat: CHAT, workspace: WS_COLLAB });
const onGrok = sessionKey({ location: 'grok', chat: CHAT, project: 'health-tracker' });
check('the same chat and project key the same everywhere', onVm === onCollab && onVm === onGrok, onVm);
check('the key carries no location', !/^vps\|/.test(onVm) && !/collab/.test(onVm), onVm);
check('the key carries no machine path', !onVm.includes('/'), onVm);
check('the key carries no bot id', !/bot/i.test(onVm), onVm);
check('/location changes nothing about the key',
  sessionKey({ location: 'collab', chat: CHAT, workspace: WS_VM }) === onVm);

// 2. What it does separate on.
check('different chats do not collide',
  sessionKey({ chat: '111', project: 'health-tracker' }) !== onVm);
check('different projects do not collide',
  sessionKey({ chat: CHAT, project: 'external-2' }) !== onVm);
check('an external chat keeps its project number',
  sessionKey({ location: 'vps', chat: CHAT, workspace: '/home/ubuntu/projects/external-2' }) === `${CHAT}|external-2`);

// 3. Workspace -> project, for callers that do not pass the id.
check('the website checkout on the VM resolves to health-tracker',
  projectIdForWorkspace(WS_VM) === 'health-tracker');
check('the same checkout on the notebook resolves to health-tracker',
  projectIdForWorkspace(WS_COLLAB) === 'health-tracker');
check('a trailing slash does not change the project',
  projectIdForWorkspace(`${WS_VM}/`) === 'health-tracker');
check('an unknown workspace is kept as-is rather than guessed',
  projectIdForWorkspace('/srv/scratch') === '/srv/scratch');

// 4. The row itself survives the move (the thing A, B and C all failed).
const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'session-key-')), 'work-sessions.json');
const created = resolveSession({ location: 'vps', chat: CHAT, workspace: WS_VM, lane: 'opencode' }, store);
check('the session is created on the VM', created.id === onVm, created.id);
const foundOnCollab = resolveSession({ location: 'collab', chat: CHAT, workspace: WS_COLLAB }, store);
check('the row is found again from collab', foundOnCollab.id === created.id && foundOnCollab.createdAt === created.createdAt);
check('re-resolving does not fork the row',
  Object.keys(JSON.parse(fs.readFileSync(store, 'utf8')).sessions).length === 1);
const readBack = getSession(onVm, store);
check('the stored key is the new shape', Boolean(readBack) && readBack.id === onVm);
check('an unknown key still reads null', getSession('nope|nope', store) === null);

// 5. The job travels with an id; the directory is resolved on the machine that
//    does the work. A path from here would be a path that does not exist there.
const hereCheckout = workspaceForId('health-tracker', { host: 'vm' });
check('health-tracker resolves to a checkout that exists on this host', Boolean(hereCheckout) && fs.existsSync(hereCheckout), String(hereCheckout));
check('and the id survives the round trip', projectIdForWorkspace(String(hereCheckout)) === 'health-tracker', String(hereCheckout));
const otherCheckout = workspaceForId('health-tracker', { host: 'collab' });
check('a host with no checkout here falls back to one that exists', Boolean(otherCheckout) && fs.existsSync(otherCheckout), String(otherCheckout));
const external = workspaceForId('external-2', { host: 'vm' });
check('an external project resolves to its own folder, not the website', Boolean(external) && external !== hereCheckout && /external-2$/.test(external), String(external));
check('an unknown workspace resolves to nothing rather than a guess', workspaceForId('scratch-volume', { host: 'vm' }) === null);
check('a legacy absolute path still resolves', workspaceForId(WS_VM, {}) === WS_VM);
check('an empty id resolves to nothing', workspaceForId('', {}) === null);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
