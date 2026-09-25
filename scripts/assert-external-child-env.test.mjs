// R-14.1 card 3 sensor: an external turn's child process must not hold the
// website's git or deploy credentials, and must not be able to reach the
// website checkout. A prompt sentence is not the control, so the check is on
// the environment the runner actually spawns with.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { buildChildEnv, PROJECT_ENV_DENIED, PROJECT_ENV_PASSTHROUGH } from './lib/child-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

console.log('assert-external-child-env:');

const parent = {
  PATH: '/usr/bin',
  HOME: '/home/ubuntu',
  LANG: 'en_US.UTF-8',
  GITHUB_TOKEN: 'ghp_website_secret',
  GH_TOKEN: 'ghp_website_secret',
  CLOUDFLARE_API_TOKEN: 'cf_website_secret',
  RENDER_API_KEY: 'render_website_secret',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_website_secret',
  DEPLOY_WEBHOOK: 'https://deploy.example/hook',
  AWS_SECRET_ACCESS_KEY: 'aws_website_secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  TELEGRAM_BOT_TOKEN: '123:bot-token',
  SECRET_MY_APP: 'shh',
  RANDOM_THING: 'should not travel',
};
const extra = { OPENCODE_CONFIG_CONTENT: '{}', GOOGLE_GENERATIVE_AI_API_KEY: 'gkey', TELEGRAM_CHAT_ID: '42' };

// 1. Project mode is a list, not the parent environment.
const projectEnv = buildChildEnv({ parentEnv: parent, extraEnv: extra, mode: 'project' });
check('GITHUB_TOKEN does not reach an external child', !('GITHUB_TOKEN' in projectEnv));
check('GH_TOKEN does not reach an external child', !('GH_TOKEN' in projectEnv));
check('cloudflare deploy token does not reach an external child', !('CLOUDFLARE_API_TOKEN' in projectEnv));
check('render key does not reach an external child', !('RENDER_API_KEY' in projectEnv));
check('supabase key does not reach an external child', !('SUPABASE_SERVICE_ROLE_KEY' in projectEnv));
check('deploy webhook does not reach an external child', !('DEPLOY_WEBHOOK' in projectEnv));
check('aws secret does not reach an external child', !('AWS_SECRET_ACCESS_KEY' in projectEnv));
check('ssh agent socket does not reach an external child', !('SSH_AUTH_SOCK' in projectEnv));
check('telegram bot token does not reach an external child', !('TELEGRAM_BOT_TOKEN' in projectEnv));
check('generic secret does not reach an external child', !('SECRET_MY_APP' in projectEnv));
check('unlisted parent variables do not travel', !('RANDOM_THING' in projectEnv));
check('the passthrough list is not a free-for-all', PROJECT_ENV_PASSTHROUGH.length < 40);

// 2. The lane still works: PATH/HOME and the caller's explicit keys survive.
check('PATH survives', projectEnv.PATH === '/usr/bin');
check('HOME survives', projectEnv.HOME === '/home/ubuntu');
check('OPENCODE_CONFIG_CONTENT survives', projectEnv.OPENCODE_CONFIG_CONTENT === '{}');
check('the model key the caller passed survives', projectEnv.GOOGLE_GENERATIVE_AI_API_KEY === 'gkey');
check('git never waits on a prompt', projectEnv.GIT_TERMINAL_PROMPT === '0');

// 3. The website lane is unchanged.
const inheritEnv = buildChildEnv({ parentEnv: parent, extraEnv: extra, mode: 'inherit' });
check('project 1 keeps GITHUB_TOKEN', inheritEnv.GITHUB_TOKEN === 'ghp_website_secret');
check('project 1 keeps the deploy token', inheritEnv.CLOUDFLARE_API_TOKEN === 'cf_website_secret');
check('default mode is inherit', buildChildEnv({ parentEnv: parent }).GITHUB_TOKEN === 'ghp_website_secret');

// 4. Deny rules cover the names this host actually exports.
for (const name of ['GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN', 'TELEGRAM_BOT_TOKEN', 'DEPLOY_HOOK', 'AWS_SECRET_ACCESS_KEY']) {
  check(`denied: ${name}`, PROJECT_ENV_DENIED.some((re) => re.test(name)));
}

// 5. No runner spawns with a raw parent-environment spread any more.
for (const file of ['agent-opencode.mjs', 'agent-cline.mjs', 'opencode-tui.mjs']) {
  const src = fs.readFileSync(path.join(HERE, 'lib', file), 'utf8');
  check(`${file} spawns through buildChildEnv`, src.includes('buildChildEnv({ extraEnv: env, mode: envMode })'));
  check(`${file} has no raw process.env spread`, !src.includes('...process.env'));
}

// 6. The turn path picks the mode from the project type.
const botSrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
check('the turn path derives the mode from the project type', /const turnEnvMode = isExternalTurn \? 'project' : 'inherit';/.test(botSrc));
check('the opencode surface gets the mode', /envMode: turnEnvMode,/.test(botSrc));
check('the cline surface gets the mode', (botSrc.match(/envMode: turnEnvMode,/g) || []).length >= 2);
check('/compact respects the active project', /envMode: compactExternal \? 'project' : 'inherit'/.test(botSrc));

// 7. Behaviour, not just wiring: capture the env the runner spawns with.
const { runOpencode } = await import('./lib/agent-opencode.mjs');
const captured = [];
const stubSpawn = (bin, args, opts) => {
  captured.push({ cwd: opts.cwd, env: opts.env });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit('close', 1);
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from('{"type":"text","part":{"text":"ok"}}\n'));
    child.emit('close', 0);
  });
  return child;
};

process.env.GITHUB_TOKEN = 'ghp_from_real_parent_env';
process.env.CLOUDFLARE_API_TOKEN = 'cf_from_real_parent_env';
try {
  await runOpencode({
    prompt: 'x', model: 'm', workspace: '/tmp/ext', timeoutMs: 5000,
    env: extra, envMode: 'project', spawnImpl: stubSpawn,
  });
  await runOpencode({
    prompt: 'x', model: 'm', workspace: '/tmp/web', timeoutMs: 5000,
    env: extra, envMode: 'inherit', spawnImpl: stubSpawn,
  });
} finally {
  delete process.env.GITHUB_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;
}
check('external spawn receives no GITHUB_TOKEN', !('GITHUB_TOKEN' in captured[0].env));
check('external spawn receives no cloudflare token', !('CLOUDFLARE_API_TOKEN' in captured[0].env));
check('external spawn receives no telegram token', !('TELEGRAM_BOT_TOKEN' in captured[0].env));
check('external spawn still receives PATH', Boolean(captured[0].env.PATH));
check('website spawn keeps GITHUB_TOKEN', captured[1].env.GITHUB_TOKEN === 'ghp_from_real_parent_env');
check('the spawn cwd is the workspace it was given', captured[0].cwd === '/tmp/ext');

// Gemini must run INSIDE OpenCode, not by calling Google's API from a bot. That
// works because buildOpencodeEnv aliases GEMINI_API_KEY to the variable OpenCode's
// google provider actually reads (GOOGLE_GENERATIVE_AI_API_KEY) — the alias was
// already there, and it is the only reason the Gemini rows in /allowance and
// /freemodel are real. Verified live on 2026-09-25: all three google/gemini models
// answer through the CLI with the env this module builds.
//
// Three ways this can silently stop working, all asserted here: the alias going
// away, the alias being overwritten by a bad value, and the filtered "project" env
// dropping the key so the CLI comes back with "API key is missing".
const { buildOpencodeEnv } = await import('./lib/agent-opencode.mjs');
const geminiAlias = buildOpencodeEnv({ runtimeEnv: { GEMINI_API_KEY: 'AIza_test_key' } });
check('GEMINI_API_KEY is aliased to the variable opencode actually reads',
  geminiAlias.GOOGLE_GENERATIVE_AI_API_KEY === 'AIza_test_key', JSON.stringify(geminiAlias));
check('an explicit GOOGLE_GENERATIVE_AI_API_KEY is never overwritten',
  buildOpencodeEnv({ runtimeEnv: { GEMINI_API_KEY: 'AIza_old', GOOGLE_GENERATIVE_AI_API_KEY: 'AIza_explicit' } }).GOOGLE_GENERATIVE_AI_API_KEY === 'AIza_explicit');
check('no gemini key means no alias is invented', !('GOOGLE_GENERATIVE_AI_API_KEY' in buildOpencodeEnv({ runtimeEnv: {} })));
check('the alias reaches a filtered project-mode child', buildChildEnv({ parentEnv: {}, extraEnv: geminiAlias, mode: 'project' }).GOOGLE_GENERATIVE_AI_API_KEY === 'AIza_test_key');
check('and an inherit-mode child', buildChildEnv({ parentEnv: {}, extraEnv: geminiAlias, mode: 'inherit' }).GOOGLE_GENERATIVE_AI_API_KEY === 'AIza_test_key');
check('the gemini key is not on the project passthrough allowlist (it must arrive as an explicit credential)',
  !PROJECT_ENV_PASSTHROUGH.includes('GOOGLE_GENERATIVE_AI_API_KEY') && !PROJECT_ENV_PASSTHROUGH.includes('GEMINI_API_KEY'));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
