/**
 * d1.mjs — the app's Cloudflare D1 data, read-only.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Personal Health Coach project diffs what the app *stored* against the
 * spreadsheet the user keeps as the source of truth. "What the app stored" is a
 * D1 table (`biomarker_logs`) plus the profile row (`profiles`), and the whole
 * verify loop is worthless if it can silently write: the user applies fixes in
 * the app, the bot proves the result. So the write half does not exist here —
 * not as a policy, as the only code path:
 *
 *   - `assertReadOnlySql()` refuses anything that is not a single SELECT/WITH
 *     statement, and `createD1Reader().query()` calls it BEFORE the network
 *     request, so a mutating statement is never sent at all.
 *   - the queries this module runs are the exported `QUERIES` constants, and
 *     `scripts/assert-external-health.test.mjs` scans this file's source to
 *     prove every SQL literal in it is a SELECT.
 *
 * Credentials come from the host env or a `.env` file next to the checkout's
 * `.git` (the same file the server reads). The account id is discovered from
 * the token: `CLOUDFLARE_ACCOUNT_ID` is not in this repo's `.env`, and a tool
 * that demands it fails on the one host that is actually configured.
 */

const API_ROOT = 'https://api.cloudflare.com/client/v4';

/** Keywords that mean "this statement changes something". */
const MUTATING = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate|grant|revoke|savepoint|begin|commit|rollback|upsert)\b/i;

/** `--` line comments and `/* *\/` blocks never carry SQL we need to judge. */
function stripComments(sql) {
  return String(sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * The read-only guarantee, as a pure function.
 *
 * One statement, and it must be a read. Returns `{ ok, sql }` or
 * `{ ok: false, reason }` — never throws, so a caller can report the refusal
 * instead of a stack trace.
 */
export function assertReadOnlySql(sql) {
  const text = String(sql ?? '').trim();
  if (!text) return { ok: false, reason: 'empty statement' };
  const bare = stripComments(text).trim().replace(/;\s*$/, '');
  if (!bare) return { ok: false, reason: 'statement is only a comment' };
  if (!/^(select|with)\b/i.test(bare)) {
    return { ok: false, reason: 'statement must start with SELECT or WITH' };
  }
  if (bare.includes(';')) {
    return { ok: false, reason: 'one statement per query (found an interior ";")' };
  }
  const hit = bare.match(MUTATING);
  if (hit) return { ok: false, reason: `mutating keyword "${hit[1]}" is not allowed` };
  return { ok: true, sql: bare };
}

/** Parse a dotenv-shaped file into a plain object. No `export`, no expansion. */
export function parseEnvFile(text) {
  const env = {};
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (value) env[m[1]] = value;
  }
  return env;
}

/**
 * The D1 config for this host.
 *
 * Precedence: process env wins over the file (a caller's explicit value is the
 * strongest signal), and the file is the repo's own `.env`. `envFile` is an
 * argument because a git worktree has no `.env` — the live box keeps it in the
 * main checkout.
 */
export function loadD1Config({ env = process.env, envFile = '', readFile = null } = {}) {
  const sources = [];
  let fileEnv = {};
  const file = String(envFile || env.HEALTH_ENV_FILE || '').trim();
  if (file && typeof readFile === 'function') {
    try {
      fileEnv = parseEnvFile(readFile(file));
      sources.push(file);
    } catch (err) {
      return { ok: false, reason: `cannot read ${file}: ${err.message}`, sources };
    }
  }
  const merged = { ...fileEnv, ...env };
  const token = String(merged.CLOUDFLARE_API_TOKEN || '').trim();
  const databaseId = String(merged.CLOUDFLARE_D1_DATABASE_ID || '').trim();
  if (!token) return { ok: false, reason: 'no CLOUDFLARE_API_TOKEN in env or .env', sources };
  if (!databaseId) return { ok: false, reason: 'no CLOUDFLARE_D1_DATABASE_ID in env or .env', sources };
  return {
    ok: true,
    token,
    databaseId,
    accountId: String(merged.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    sources,
  };
}

/** The token's first account — the repo's `.env` has no account id. */
export async function discoverAccountId({ token, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API_ROOT}/accounts?per_page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`account discovery failed: ${detail}`);
  }
  const id = body.result?.[0]?.id || '';
  if (!id) throw new Error('account discovery found no account for this token');
  return id;
}

/**
 * A query runner that refuses to send anything but a SELECT.
 *
 * `assertReadOnlySql` runs first and a refusal throws without a request; there
 * is no `mode` flag to flip, because a flag is exactly how a read-only tool
 * grows a write path later.
 */
export function createD1Reader({ token, databaseId, accountId, fetchImpl = fetch } = {}) {
  if (!token || !databaseId || !accountId) throw new Error('createD1Reader needs token, databaseId and accountId');
  const endpoint = `${API_ROOT}/accounts/${accountId}/d1/database/${databaseId}/query`;
  return {
    accountId,
    async query(sql, params = []) {
      const guard = assertReadOnlySql(sql);
      if (!guard.ok) throw new Error(`refused non-read query: ${guard.reason}`);
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: guard.sql, params }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        const detail = body?.errors?.[0]?.message || `HTTP ${res.status}`;
        throw new Error(`d1 query failed: ${detail}`);
      }
      const batch = Array.isArray(body.result) ? body.result[0] : body.result;
      return batch?.results || [];
    },
  };
}

/**
 * Every statement this project runs. Exported so the sensor can assert the set
 * is read-only and so nothing else in the tree hand-writes SQL.
 */
export const QUERIES = {
  profileCounts: 'select firebase_uid, count(*) as rows, min(date) as first_date, max(date) as last_date from biomarker_logs group by firebase_uid order by rows desc',
  profileRow: 'select id, firebase_uid, data, updated_at from profiles where firebase_uid = ?',
  biomarkerRows: 'select id, firebase_uid, date, biomarkers, note, updated_at from biomarker_logs where firebase_uid = ? order by date, id',
};

/**
 * Which profile the verify loop is about.
 *
 * A uid is not a secret, but it is personal, so it is not committed: the host
 * sets `HEALTH_PROFILE_UID` (or the CLI takes `--uid`). Without one, the app's
 * own data answers — the profile with `biomarker_logs` rows is the one with a
 * health record, and the legacy ids that onboarding left behind have none. The
 * resolution is always reported, including the ids it did not pick, so a wrong
 * guess is visible instead of silent.
 */
export function resolveProfileUid({ counts = [], explicit = '' } = {}) {
  const rows = counts
    .map((r) => ({ uid: String(r.firebase_uid || '').trim(), rows: Number(r.rows) || 0 }))
    .filter((r) => r.uid && r.rows > 0);
  const clean = String(explicit || '').trim();
  if (clean) {
    const own = rows.find((r) => r.uid === clean);
    return {
      uid: clean,
      source: 'explicit',
      rows: own ? own.rows : 0,
      others: rows.filter((r) => r.uid !== clean),
    };
  }
  if (!rows.length) return { uid: '', source: 'none', rows: 0, others: [] };
  const [top, ...others] = rows;
  return { uid: top.uid, source: 'most-lab-rows', rows: top.rows, others };
}

/** Parse a `biomarkers` JSON blob; a broken row reads as empty, never throws. */
export function parseBiomarkers(raw) {
  try {
    const parsed = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** The profile's demographics, from the JSON `data` column. */
export function parseProfile(raw) {
  try {
    const data = JSON.parse(String(raw ?? '{}'));
    return data?.profile && typeof data.profile === 'object' ? data.profile : {};
  } catch {
    return {};
  }
}
