// R-14 guard 9 sensor: the files a conversation has been editing travel with
// it. The sender packs what git says is changed, the relay stores only packs
// whose hashes all check out, and the worker re-hashes every file before it
// writes one — a path that would leave the workspace is refused outright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  packPath,
  changedFiles,
  buildPack,
  packWithContents,
  verifyPack,
  applyPack,
  savePack,
  loadPack,
  PACK_MAX_FILES,
} from './lib/swap-pack.mjs';

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

console.log('assert-swap-pack:');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-pack-home-'));
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-pack-ws-'));
const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-pack-dst-'));

try {
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'app.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(ws, 'README.md'), '# swap\n');
  fs.writeFileSync(path.join(ws, 'node_modules', 'left-pad', 'index.js'), '// vendored\n');
  // Vendored code is ignored the same way a real project ignores it, so the
  // pack is built from what the conversation actually changed.
  fs.writeFileSync(path.join(ws, '.gitignore'), 'node_modules/\n');

  // 1. What gets packed: what git reports changed, vendored trees left behind.
  const init = spawnSync('git', ['-C', ws, 'init', '-q'], { encoding: 'utf8' });
  check('a workspace can be a git repo for this test', init.status === 0);
  const changed = changedFiles(ws);
  check('git reports the uncommitted files', changed.ok === true && changed.files.length >= 2);
  check('vendored directories are not candidates', !changed.files.some((f) => f.includes('node_modules')));

  const built = buildPack(ws, { home, id: 'p_test1' });
  check('a pack builds with ids, hashes and sizes', built.ok === true && built.id === 'p_test1' && built.files.length >= 2 && built.totalBytes > 0);
  check('every file carries a sha256', built.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  check('the manifest records where it came from', built.source === 'git');

  const payload = packWithContents(built);
  check('the payload carries the contents', payload.ok === true && payload.files.every((f) => typeof f.data === 'string' && f.data.length > 0));
  check('the payload keeps the hashes it shipped', payload.files.every((f) => f.sha256 && f.bytes >= 0));

  // 2. Bounded and named when it will not fit.
  const tooMany = buildPack(ws, { home, id: 'p_test2', maxFiles: 1 });
  check('a workspace with more changed files than the limit is refused by name', tooMany.ok === false && /too many changed files/.test(tooMany.reason));
  const noRoot = buildPack('', { home });
  check('no workspace means no pack', noRoot.ok === false && /no workspace/.test(noRoot.reason));
  const badRoot = buildPack(path.join(ws, 'nope'), { home });
  check('a workspace that is not a directory is refused', badRoot.ok === false && /not a directory/.test(badRoot.reason));
  check('the default limit is a real number of files', Number.isFinite(PACK_MAX_FILES) && PACK_MAX_FILES > 0);

  // 3. Arrival: every hash must check out before anything is written.
  check('a complete pack verifies', verifyPack(payload).ok === true);
  const tampered = JSON.parse(JSON.stringify(payload));
  tampered.files[0].data = Buffer.from('evil').toString('base64');
  const badVerify = verifyPack(tampered);
  check('a tampered file fails its hash and is named', badVerify.ok === false && badVerify.mismatched.length === 1 && /failed their hash/.test(badVerify.reason));
  const emptyPack = verifyPack({ id: 'x', files: [] });
  check('an empty pack is refused', emptyPack.ok === false && /no files/.test(emptyPack.reason));

  // 4. Applying: a bad hash anywhere means nothing is written; a path that
  // would leave the workspace is refused even when its hash is right.
  const applied = applyPack(dst, payload);
  check('a verified pack applies into the workspace', applied.ok === true && applied.applied.length === payload.files.length);
  check('the files really landed', fs.readFileSync(path.join(dst, 'README.md'), 'utf8') === '# swap\n');
  const partial = applyPack(dst, tampered);
  check('a tampered pack writes nothing', partial.ok === false && partial.applied.length === 0);

  const escape = { id: 'p_evil', files: [{ path: '../escaped.txt', sha256: 'x', bytes: 4, data: Buffer.from('evil').toString('base64') }] };
  escape.files[0].sha256 = crypto.createHash('sha256').update(Buffer.from('evil')).digest('hex');
  const refused = applyPack(dst, escape);
  check('a path that would leave the workspace is refused', refused.ok === false && /leaves the workspace/.test(refused.reason));
  check('nothing was written outside the workspace', !fs.existsSync(path.join(path.dirname(dst), 'escaped.txt')));
  const missingRoot = applyPack(path.join(dst, 'not-here'), payload);
  check('a workspace that does not exist here is named', missingRoot.ok === false && /does not exist/.test(missingRoot.reason));

  // 5. The relay stores only packs it has verified, under a safe id.
  const saved = savePack(payload, { home });
  check('the relay stores a verified pack', saved.ok === true && saved.files === payload.files.length);
  check('the pack can be read back', loadPack(payload.id, { home })?.files?.length === payload.files.length);
  check('an unknown pack reads as nothing', loadPack('p_nope', { home }) === null);
  const badSave = savePack(tampered, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'pack-bad-')) });
  check('the relay refuses to store a tampered pack', badSave.ok === false && /failed their hash/.test(badSave.reason));
  const noId = savePack({ files: [] }, { home });
  check('a pack without an id is refused', noId.ok === false && /no id/.test(noId.reason));
  const traversal = packPath('../etc/passwd', home);
  check('a hostile id cannot escape the pack directory', !traversal.includes('..') && traversal.startsWith(path.join(home, '.hermes', 'packs')));

  // 6. Source wiring: the pack is built on a canary and applied by the worker.
  const bot = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
  const agent = fs.readFileSync(path.join(HERE, 'worker-agent.mjs'), 'utf8');
  const relay = fs.readFileSync(path.join(HERE, 'worker-relay.mjs'), 'utf8');
  const jobs = fs.readFileSync(path.join(HERE, 'lib', 'worker-jobs.mjs'), 'utf8');
  const workerFn = bot.slice(bot.indexOf('export async function runOnWorker'), bot.indexOf('/** Where the'));
  check('the sender builds a pack for the swap turn', /buildPack\(packRoot\)/.test(workerFn) && /packWithContents\(built\)/.test(workerFn));
  check('the pack is uploaded to the relay', /\/packs\/\$\{encodeURIComponent\(payload\.id\)\}/.test(workerFn) && /method: 'PUT'/.test(workerFn));
  check('the canary turn is the one that ships files', /packRoot: wantCanary \? effectiveWorkspace : ''/.test(bot));
  check('the job carries the pack id', /packId: String\(job\.packId \|\| ''\)/.test(jobs));
  check('the worker fetches and applies the pack', /applyJobPack\(job\.packId, workspace\)/.test(agent) && /applyPack\(workspace, payload\)/.test(agent));
  check('the worker reports how many files it applied', /packApplied/.test(agent));
  check('the relay has both pack routes', /PUT \/packs\//.test(relay) && /GET \/packs\//.test(relay));
  check('the relay gives packs a larger body limit than jobs', /readBody\(req, PACK_BODY_MAX\)/.test(relay));
} finally {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(dst, { recursive: true, force: true });
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
