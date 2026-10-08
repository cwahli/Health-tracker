/**
 * A private Telegram chat id is the user's id on every bot. Project and role
 * for that conversation belong to one bot. A group project stays on the room.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

if (process.env.CHAT_SCOPE_CHILD !== '1') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-scope-'));
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: REPO,
    env: { ...process.env, HOME: home, CHAT_SCOPE_CHILD: '1' },
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    process.stderr.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    process.exit(child.status || 1);
  }
  process.stdout.write(child.stdout || '');
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

const {
  bindRegistryBot,
  getChatProject,
  getChatRole,
  resetChatRole,
  switchChatProject,
  switchChatRole,
} = await import('./lib/project-registry.mjs');

const user = '6218257274';
const group = '-1004399464785';
let failed = 0;
function check(name, ok) {
  if (ok) console.log(`ok ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

const stateFile = path.join(os.homedir(), '.hermes', 'projects_state.json');
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify({
  chats: { [user]: { projectId: 'external-2', roleId: 'legal_policy' } },
  dynamicProjects: {},
}, null, 2));

bindRegistryBot('vm4');
check('vm4 does not inherit the shared PM seat', getChatRole(user) === null);
check('vm4 does not inherit the shared private project', getChatProject(user).id === 'health-tracker');

switchChatProject(user, 'chiwah-tax');
const accountant = switchChatRole(user, 'accountant');
check('vm4 can take the tax accountant seat', accountant?.id === 'tax_accountant');
check('vm4 role is tax accountant', getChatRole(user) === 'tax_accountant');
check('vm4 project stays chiwah-tax', getChatProject(user).id === 'chiwah-tax');

bindRegistryBot('vm3');
check('vm3 is not the tax accountant', getChatRole(user) === null);
check('vm3 project stays the default', getChatProject(user).id === 'health-tracker');
switchChatRole(user, 'pm');
check('vm3 can take PM on its own', getChatRole(user) === 'pm');

bindRegistryBot('vm4');
check('vm3 taking PM leaves vm4 on tax', getChatRole(user) === 'tax_accountant');
resetChatRole(user);
check('reset clears only vm4', getChatRole(user) === null);
bindRegistryBot('vm3');
check('vm3 keeps PM after vm4 resets', getChatRole(user) === 'pm');

switchChatProject(group, 'external-health');
bindRegistryBot('vm4');
check('group project is shared', getChatProject(group).id === 'external-health');
switchChatRole(group, 'analyst');
check('vm4 can take the health analyst seat in the room', getChatRole(group) === 'health_analyst');
bindRegistryBot('vm3');
check('vm3 does not wear vm4 room role', getChatRole(group) === null);
check('vm3 still sees the room project', getChatProject(group).id === 'external-health');

bindRegistryBot('');
check('unbound readers still see the legacy key', getChatRole(user) === 'legal_policy');
check('unbound readers still see the legacy project', getChatProject(user).id === 'external-2');

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('chat scope ok');
