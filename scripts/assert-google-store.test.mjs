#!/usr/bin/env node
/**
 * Law sensor for the Google store (plan/GOOGLE_WORKSPACE_PLAN.md, gates G-0/G-1).
 *
 * The plan's own rules, and what each check prevents:
 *
 *  - "service account, not per-bot OAuth"  -> `serviceAccountFromEnv` refuses any
 *    document that is not a service account. An OAuth client id creeping in here
 *    would mean a consent flow on a headless host, which cannot complete.
 *  - "the credential is a PATH … never in the repo, never in chat" -> mode check,
 *    redaction, and a child env that carries the folder and never the key.
 *  - "the store is scoped by folder, not by account" -> per-project folder map, and
 *    the systemd EnvironmentFile trap that silently drops a hyphenated name.
 *  - "append-only; no cell is ever edited" -> the only Sheets write shape allowed is
 *    `values:append` with INSERT_ROWS, asserted here *and* by a source ratchet.
 *  - "never overwritten" -> content-addressed object names: same turn id twice is
 *    idempotent, two locations are two distinct objects.
 *  - "the probe writes nothing" -> asserted by import, not by trust.
 *
 * No live Google call happens in this file. `fetch` is stubbed; the JWT is signed
 * and verified with a keypair generated in-process, so the real key on the host is
 * never read, let alone printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIME,
  SCOPES,
  buildAssertion,
  foldersFromEnv,
  googleChildEnv,
  googleReady,
  monthTab,
  objectName,
  redact,
  serviceAccountFromEnv,
} from './lib/google-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = fs.readFileSync(path.join(HERE, 'lib', 'google-store.mjs'), 'utf8');
const PROBE = fs.readFileSync(path.join(HERE, 'probe-google-store.mjs'), 'utf8');

let passed = 0;
let failed = 0;
/** `cond` may be a boolean or a thunk; a thunk keeps expensive crypto work lazy. */
function check(name, cond, detail = '') {
  const ok = Boolean(typeof cond === 'function' ? cond() : cond);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

// A throwaway keypair: the real credential is never read by a test.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SA = {
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'abc',
  private_key: pem,
  client_email: 'doc-api@test-project.iam.gserviceaccount.com',
  client_id: '123',
  token_uri: 'https://oauth2.googleapis.com/token',
};

// ---------------------------------------------------------------- credential

check('no credential at all names the variable', (() => {
  const r = serviceAccountFromEnv({});
  return !r.ok && /GOOGLE_SERVICE_ACCOUNT_JSON/.test(r.reason);
})());

check('a missing key file is a failure, not a crash', (() => {
  const r = serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: '/nonexistent/key.json' });
  return !r.ok && /missing file/.test(r.reason);
})());

check('a world-readable key file is refused (leak guard)', (() => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstore-')), 'key.json');
  fs.writeFileSync(p, JSON.stringify(SA), { mode: 0o644 });
  fs.chmodSync(p, 0o644);
  const r = serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: p });
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
  return !r.ok && /must be 600/.test(r.reason);
})());

check('a 600 key file is accepted', (() => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gstore-')), 'key.json');
  fs.writeFileSync(p, JSON.stringify(SA), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  const r = serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: p });
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
  return r.ok && r.email === SA.client_email;
})());

check('an OAuth client id is refused (no consent flow on a headless host)', (() => {
  const r = serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON_INLINE: JSON.stringify({ type: 'authorized_user', client_id: 'x.apps.googleusercontent.com', client_secret: 's' }) });
  return !r.ok && /not a service account/.test(r.reason);
})());

check('a document with no private key is refused', (() => {
  const r = serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON_INLINE: JSON.stringify({ type: 'service_account', client_email: 'a@b.com' }) });
  return !r.ok && /private_key/.test(r.reason);
})());

check('unparseable JSON is refused with a message, not a stack', (() => {
  const r = serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON_INLINE: '{not json' });
  return !r.ok && /does not parse/.test(r.reason);
})());

// ------------------------------------------------------------------ folders

check('a credential with no folder is not "ready" and names the missing piece', (() => {
  const r = googleReady({ GOOGLE_SERVICE_ACCOUNT_JSON_INLINE: JSON.stringify(SA) });
  return !r.ready && /no GOOGLE_FOLDER/.test(r.reason);
})());

check('credential + folder = ready', (() => {
  const r = googleReady({ GOOGLE_SERVICE_ACCOUNT_JSON_INLINE: JSON.stringify(SA), GOOGLE_FOLDER_HEALTH_TRACKER: 'abc123' });
  return r.ready && r.email === SA.client_email;
})());

check('the underscore form maps to the project id', (() => {
  const f = foldersFromEnv({ GOOGLE_FOLDER_HEALTH_TRACKER: 'abc123' });
  return f['health-tracker'] === 'abc123';
})());

check('a hyphenated name is ignored — systemd drops it silently, so we must too', (() => {
  // This is the trap that made the first probe read NOT READY with the credential
  // present: `GOOGLE_FOLDER_health-tracker` is not a valid EnvironmentFile name.
  const f = foldersFromEnv({ GOOGLE_FOLDER_health_tracker: 'abc123' });
  return !f['health-tracker'] && !f['health_tracker'];
})());

check('quotes around a folder id are stripped like systemd does', (() => {
  return foldersFromEnv({ GOOGLE_FOLDER_HEALTH_TRACKER: '"abc123"' })['health-tracker'] === 'abc123';
})());

// ------------------------------------------------------- card-3 child env

check('an external turn gets its folder and never the key path', (() => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: '/home/ubuntu/.config/bot-host/google-fleet-key.json', GOOGLE_FOLDER_EXTERNAL_2: 'folder-2' };
  const child = googleChildEnv(env, 'external-2');
  const leaked = JSON.stringify(child.env).includes('SERVICE_ACCOUNT') || JSON.stringify(child.env).includes('private_key');
  return child.ok && child.env.GOOGLE_FOLDER_ID === 'folder-2' && !leaked;
})());

check('a turn with no folder for its project is refused, not given a default', (() => {
  const child = googleChildEnv({ GOOGLE_FOLDER_HEALTH_TRACKER: 'folder-1' }, 'external-9');
  return !child.ok && /external-9/.test(child.reason);
})());

// --------------------------------------------------------------------- JWT

check('the assertion is a 3-part RS256 JWT for the service account', (() => {
  const a = buildAssertion(SA);
  const [h, c, s] = a.split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  return head.alg === 'RS256'
    && head.typ === 'JWT'
    && claims.iss === SA.client_email
    && claims.aud === SA.token_uri
    && claims.scope.split(' ').length === 3
    && s.length > 100;
})());

check('the assertion signature verifies against the account public key', () => {
  const a = buildAssertion(SA);
  const [h, c, s] = a.split('.');
  return crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), crypto.createPublicKey(pem), Buffer.from(s, 'base64url'));
});

check('a tampered claim breaks the signature (the grant is not forgeable)', () => {
  const a = buildAssertion(SA);
  const [h, c, s] = a.split('.');
  const forged = JSON.stringify({ ...JSON.parse(Buffer.from(c, 'base64url').toString()), scope: `${Object.values(SCOPES).join(' ')} https://mail.google.com/` });
  return !crypto.verify('RSA-SHA256', Buffer.from(`${h}.${Buffer.from(forged).toString('base64url')}`), crypto.createPublicKey(pem), Buffer.from(s, 'base64url'));
});

check('the assertion carries the three store scopes and nothing else', () => {
  const claims = JSON.parse(Buffer.from(buildAssertion(SA).split('.')[1], 'base64url').toString());
  return claims.scope === Object.values(SCOPES).join(' ');
});

// ---------------------------------------------------------------- redaction

check('a private key never survives redaction', () => {
  const r = redact(`before ${pem} after`);
  return !r.includes('BEGIN PRIVATE KEY') && r.includes('[redacted private key]');
});

check('a JWT never survives redaction', () => {
  const jwt = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from('{"iss":"x"}').toString('base64url')}.${'A'.repeat(43)}`;
  return !redact(`token ${jwt}`).includes(jwt);
});

check('a bearer token never survives redaction', () => {
  return !redact('Authorization: Bearer ya29.a0AfB_abcdefghijklmnop').includes('ya29.a0AfB');
});

check('redaction does not eat ordinary log text', () => {
  return redact('bot-host@vm2 pid 1234 wrote 30 rows to turn_log').includes('turn_log');
});

// ------------------------------------------------------------- object names

check('the same turn twice is the same name (idempotent retry)', () => {
  const a = objectName({ at: '20260926T110704Z', location: 'vps', chat: '19485', turnId: 't42', slug: 'turn log' });
  const b = objectName({ at: '20260926T110704Z', location: 'vps', chat: '19485', turnId: 't42', slug: 'turn log' });
  return a === b && a === '20260926110704-vps-19485-t42-turn-log';
});

check('two locations writing the same turn do not collide', () => {
  const a = objectName({ at: '20260926T110704Z', location: 'vps', chat: '19485', turnId: 't42' });
  const b = objectName({ at: '20260926T110704Z', location: 'mobile', chat: '19485', turnId: 't42' });
  return a !== b;
});

check('a name carries nothing Drive or a shell would choke on', () => {
  const n = objectName({ at: '20260926T110704Z', location: '../../etc', chat: 'a b/c', turnId: 'x y', slug: 'weird/name & stuff' });
  return !/[\\/\s&]/.test(n) && !n.includes('..');
});

check('the monthly tab is UTC and zero-padded', () => {
  return monthTab('2026-09-26T11:07:04Z') === '2026-09' && monthTab('2026-12-31T23:59:59Z') === '2026-12';
});

// ----------------------------------------------------- source-law ratchets

check('the only Sheets row write is an append (no values:update path)', () => {
  return /:append/.test(LIB) && !/values:update|\/values\/\$\{range\}\$/.test(LIB);
});

check('appends are RAW + INSERT_ROWS so no cell is edited in place', () => {
  // Query parameters, not body fields: in the body the API rejects the whole call.
  return /valueInputOption=RAW/.test(LIB) && /insertDataOption=INSERT_ROWS/.test(LIB) && !/valueInputOption: 'RAW'/.test(LIB);
});

check('the Sheets API is called on v4 (v1 answers a challenge page from this host)', () => {
  return /sheets: 'https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets'/.test(LIB);
});

check('a spreadsheet is created through Drive, so it lands inside the project folder', () => {
  // spreadsheets.create has no parent parameter, so a sheet made that way escapes
  // the folder the whole plan scopes writes to.
  const fn = LIB.slice(LIB.indexOf('export async function createSheet'), LIB.indexOf('export async function renameFirstTab'));
  return /API\.drive}\/files/.test(fn) && /MIME\.sheet/.test(fn) && !/spreadsheets'\, \{\s*method: 'POST'/.test(fn);
});

check('a spreadsheet is deleted through Drive, the API that answers from this host', () => {
  // spreadsheets.delete is answered with a bot-challenge page here; drive.files.delete
  // returns 204 and Drive is also what created the file.
  const fn = LIB.slice(LIB.indexOf('export async function deleteSheet'), LIB.indexOf('/** Sheets: read one spreadsheet'));
  return /return deleteFile\(sheetId, token\)/.test(fn);
});

check('a Doc append inserts strictly before the body end, never at it', () => {
  // The last element is the closing sectionBreak; inserting at its endIndex is
  // rejected with "Index N must be less than the end index".
  return /\(last\?\.endIndex \|\| 2\) - 1/.test(LIB);
});

check('the only PATCH is a rename: exactly one, and its body is { name } alone', () => {
  const patches = [...LIB.matchAll(/method: 'PATCH'/g)].length;
  const nameOnly = [...LIB.matchAll(/method: 'PATCH',\s*\n\s*token,\s*\n\s*body: \{ name: clean \}/g)].length;
  return patches === 1 && nameOnly === 1;
});

check('nothing is ever replaced: no PUT, and no upload onto an existing file id', () => {
  const puts = [...LIB.matchAll(/method: 'PUT'/g)].length;
  return puts === 0 && !/files\/\$\{[^}]+\}\/upload/.test(LIB);
});

check('a rename cannot smuggle other fields (name is sanitized and length-capped)', () => {
  return /replace\(\/\[\\\\\/\\r\\n\\t\]\/g, '-'\)/.test(LIB) && /\.slice\(0, 200\)/.test(LIB);
});

check('no googleapis dependency is introduced', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  return !deps.some((d) => d.includes('googleapis') || d.startsWith('@google-cloud'));
});

check('the probe imports no write function (zero-burn is structural)', () => {
  const imports = PROBE.match(/from '\.\/lib\/google-store\.mjs'/)?.[0] || '';
  const block = PROBE.slice(PROBE.indexOf('from \'./lib/google-store.mjs\''));
  const named = block.slice(0, block.indexOf('}')).replace('} from', '');
  return !/createFile|appendRows|createDoc|createSheet|appendDocText/.test(named) && Boolean(imports);
});

check('the probe cannot write even if it wanted (no POST/PUT in its own source)', () => {
  return !/method: '(POST|PUT|PATCH|DELETE)'/.test(PROBE) && !/createFile\(|appendRows\(/.test(PROBE);
});

check('the probe detects the ownership wall without writing (driveId present = shared drive)', () => {
  return /fields=[^`]*driveId/.test(PROBE) && /a service account cannot own files here/.test(PROBE);
});

check('the plan records the ownership constraint and the forced identity choice', () => {
  const plan = fs.readFileSync(path.join(HERE, '..', 'plan', 'GOOGLE_WORKSPACE_PLAN.md'), 'utf8');
  return /storage quota/.test(plan) && /Shared Drive/.test(plan) && /BLOCKING/.test(plan);
});

check('the live board exists and refuses to claim green while rows are red', () => {
  const board = fs.readFileSync(path.join(HERE, '..', 'plan', 'GOOGLE_STORE_LIVE_MATRIX.md'), 'utf8');
  return /NOT GREEN/.test(board) && /G-10/.test(board) && /not started/.test(board);
});

check('the probe says how many writes it made', () => {
  return /writes this run/.test(PROBE) && /zero-burn by construction/.test(PROBE);
});

check('the Doc seeder inserts at the end index (never overwrites a human section)', () => {
  return /insertText: \{ location: \{ index \}/.test(LIB) && /endIndex/.test(LIB);
});

check('the store is not wired into the app origin (no second app data path)', () => {
  const lib = path.join(HERE, '..', 'src');
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /google-store|GOOGLE_SERVICE_ACCOUNT/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  if (fs.existsSync(lib)) walk(lib);
  return hits.length === 0;
});

// ------------------------------------------------- the live scorecard's laws

const CARD = fs.readFileSync(path.join(HERE, 'google-store-scorecard.mjs'), 'utf8');
const RELAY = fs.readFileSync(path.join(HERE, 'worker-relay.mjs'), 'utf8');

check('the scorecard only deletes ids it created in this run', () => {
  return /refusing to delete an id this run did not create/.test(CARD) && /created\.(files|docs|sheets)\.has\(id\)/.test(CARD);
});

check('a Google bot-challenge page is retried, not reported as a refusal', () => {
  // Measured: a window where 10/10 Sheets/Docs writes came back as challenge pages,
  // then 6/6 passed with identical requests. Failing a capability on one bad minute
  // is how a working store gets written off.
  return /const challenged = \/non-JSON error page\//.test(LIB)
    && /if \(!challenged && res\.status < 500/.test(LIB)
    && /challenged: true/.test(LIB);
});

check('a failed request keeps its HTTP status instead of collapsing to 0', () => {
  // Dropping the status turned every honest 404 into "status 0", so a successful
  // delete was reported as a file that was still there.
  return /let lastStatus = 0/.test(LIB) && /lastStatus = res\.status/.test(LIB)
    && /return \{ ok: false, status: lastStatus/.test(LIB);
});

check('a delete is proven by a later read saying missing, not by the delete call', () => {
  return /back\.missing/.test(CARD) && /404 as expected/.test(CARD);
});

check('the scorecard proves the keyless caller really has no credential', () => {
  return /delete keyless\[k\]/.test(CARD) && /still holds a credential/.test(CARD);
});

check('the scorecard spawns its own relay on a spare port (production relay untouched)', () => {
  return /freePort/.test(CARD) && /worker-relay\.mjs/.test(CARD) && /--relay-token=/.test(CARD);
});

check('the scorecard picture is a real PNG, not a text file with a .png name', () => {
  return /0x89, 0x50, 0x4e, 0x47/.test(CARD) && /pngChunk\('IDAT'/.test(CARD) && /crc32/.test(CARD);
});

check('the relay store route resolves the folder itself and never takes one from the caller', () => {
  // A caller that could send a folder id could name any folder; the body must not
  // contain a folder field, and the folder must come from the relay's own env.
  return /const folder = \(ready\.folders \|\| \{\}\)\[project\]/.test(RELAY)
    && !/body\?\.folder|body\.folder/.test(RELAY);
});

check('the relay store route sits behind the token guard', () => {
  return RELAY.indexOf('relay token required') < RELAY.indexOf('POST /store');
});

check('the relay refuses an unenrolled project by name rather than defaulting', () => {
  return /no Google folder enrolled on this relay/.test(RELAY) && /enrolled: Object\.keys/.test(RELAY);
});

check('the relay never returns key material or a token in a receipt', () => {
  const block = RELAY.slice(RELAY.indexOf('POST /store'), RELAY.indexOf('POST /connect'));
  return !/private_key|access_token/.test(block);
});

check('folderFor() is the single way a caller resolves its folder', () => {
  return /export function folderFor/.test(LIB) && /folderFor\(ready, 'health-tracker'\)/.test(CARD);
});

check('loadHostEnv() is shared by the probe and the scorecard (one env rule)', () => {
  const PROBE_ENV = fs.readFileSync(path.join(HERE, 'probe-google-store.mjs'), 'utf8');
  return /loadHostEnv/.test(PROBE_ENV) && /loadHostEnv/.test(CARD) && !/os\.homedir/.test(PROBE_ENV);
});

// ------------------------------------------------- the user identity (option B)

const AUTH = fs.readFileSync(path.join(HERE, 'google-authorize.mjs'), 'utf8');

check('accessToken dispatches on identity kind, so no call site branches', () => {
  return /identity\?\.kind === 'user'/.test(LIB) && /grant_type: 'refresh_token'/.test(LIB) && /jwt-bearer/.test(LIB);
});

check('a user bundle is refused unless it is mode 600', () => {
  return /user credential file is mode/.test(LIB);
});

check('a bundle with no refresh_token is refused with the fix, not a stack', () => {
  return /no refresh_token in the credential bundle/.test(LIB) && /google-authorize\.mjs/.test(LIB);
});

check('a user identity wins when both credentials are present', () => {
  // A service account that cannot write must never be the live identity just
  // because it is listed first.
  const fn = LIB.slice(LIB.indexOf('export function identityFromEnv'), LIB.indexOf('export function googleReady'));
  return /const user = userIdentityFromEnv/.test(fn) && /if \(user\.ok\) return user/.test(fn);
});

check('only a service account is told it needs a shared drive', () => {
  return /writesNeedSharedDrive: true/.test(LIB) && !/writesNeedSharedDrive: true[\s\S]{0,400}kind: 'user'/.test(LIB);
});

check('an invalid_grant is explained as a fixable cause', () => {
  return /invalid_grant/.test(LIB) && /re-run scripts\/google-authorize\.mjs/.test(LIB);
});

check('the authorizer asks for offline access and re-consent (else no refresh token)', () => {
  return /access_type.*offline/.test(AUTH) && /prompt.*consent/.test(AUTH);
});

check('the authorizer checks the OAuth state parameter', () => {
  return /state/.test(AUTH) && /state mismatch/.test(AUTH);
});

check('the authorizer never prints a refresh token or client secret', () => {
  const printed = [...AUTH.matchAll(/say\(([^)]*)\)/g)].map((m) => m[1]).join(' ');
  return !/refresh_token\b(?!.*present)/.test(printed.replace(/refresh   :.*/, '')) && !/client_secret/.test(printed);
});

check('the authorizer verifies with a read (about.get), never a write', () => {
  return /drive\/v3\/about/.test(AUTH) && !/files\?uploadType|values\/.*append|spreadsheets'\, \{/.test(AUTH);
});

check('the authorizer writes the bundle at 600 and says so', () => {
  return /mode: 0o600/.test(AUTH) && /chmodSync\(BUNDLE, 0o600\)/.test(AUTH);
});

check('the probe reports which identity is live and whether it has storage', () => {
  return /row\('identity'/.test(PROBE) && /row\('drive quota'/.test(PROBE);
});

check('the scorecard and relay resolve an identity, not a service account', () => {
  return /identityFromEnv/.test(CARD) && /identityFromEnv/.test(RELAY) && !/serviceAccountFromEnv/.test(CARD);
});

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
