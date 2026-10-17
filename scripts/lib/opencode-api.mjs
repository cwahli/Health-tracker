/**
 * `opencode api <operationId>` — the supported v2 RPC surface, driven by
 * operationId rather than by URL.
 *
 * Why the CLI and not `fetch`: the background service needs Basic auth and the
 * password lives in ~/.config/opencode/service.json. Shelling out means the
 * bot never reads that file, never holds the secret, and cannot leak it into a
 * child env or a log line. The CLI resolves the base URL and the credentials
 * itself, and it reads the same service the chat's sessions already live in.
 *
 * Path parameters go through `--param name=value`. Query parameters declared
 * with `style: deepObject` (location, for one) are NOT reachable that way —
 * `--param location.directory=…` is silently ignored — so those callers still
 * need the raw URL form.
 */
import { execFile } from 'node:child_process';

import { resolveOpencodeBin } from './agent-opencode.mjs';
import { buildChildEnv } from './child-env.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Drop the CLI's structured log lines and JS stack frames so a caller can put
 * the remainder in a Telegram reply. The CLI writes `timestamp=… level=…` noise
 * to stderr *before* the real error, and the interesting line is the last one
 * before the frames.
 */
export function cleanApiError(stderr) {
  const lines = String(stderr || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('timestamp='))
    .filter((line) => !/^at\s/.test(line))
    .filter((line) => !/^[{[]/.test(line))
    .filter((line) => !/^cause:/.test(line));
  return lines[lines.length - 1] || '';
}

/** Args for one operation. Exported so the shape is testable without a binary. */
export function buildApiArgs(operationId, { params, data } = {}) {
  const args = ['api', String(operationId || '').trim()];
  for (const [name, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    args.push('--param', `${name}=${value}`);
  }
  if (data !== undefined) args.push('--data', JSON.stringify(data));
  return args;
}

/**
 * Run one operation and return its unwrapped `data` payload.
 *
 * Throws an Error whose message is already Telegram-shaped: no log prefixes,
 * no stack frames. Callers show `err.message` directly.
 */
export async function opencodeApi(operationId, {
  params,
  data,
  workspace,
  env = {},
  envMode = 'inherit',
  opencodeBin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execFileImpl = execFile,
} = {}) {
  const bin = resolveOpencodeBin(opencodeBin);
  const args = buildApiArgs(operationId, { params, data });
  const childEnv = buildChildEnv({ extraEnv: env, mode: envMode });

  const { stdout, stderr, code } = await new Promise((resolve, reject) => {
    execFileImpl(
      bin,
      args,
      { cwd: workspace || undefined, env: childEnv, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, out, err) => {
        if (error && typeof error.code === 'number' && error.code !== 0 && !out && !err) {
          reject(error);
          return;
        }
        resolve({ stdout: String(out || ''), stderr: String(err || ''), code: error ? Number(error.code) || 1 : 0 });
      },
    );
  });

  if (code !== 0) {
    const reason = cleanApiError(stderr) || `exit ${code}`;
    throw new Error(reason);
  }

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
  } catch {
    throw new Error(`opencode ${operationId} returned output that is not JSON`);
  }
}

/**
 * The model catalog, as `{ id, variants, context }` rows.
 *
 * WHY NOT `opencode models --verbose`
 * -----------------------------------
 * That flag does not exist. The installed CLI rejects it outright —
 * "Unrecognized flag: --verbose in command opencode models" (v2.0.24, verified
 * 2026-10-08) — and exits, so every caller of the old path got no catalog at all.
 * That is the whole of `/thinking`: with no catalog there are no variants, so the
 * keyboard could not be built and the command looked dead.
 *
 * `opencode api model.list` is the supported RPC surface and carries what the
 * old flag was scraped for: `variants` (which thinking levels the model actually
 * accepts) and `limit.context`.
 *
 * The shape differs from the old parser's expectation in a way that would have
 * silently produced zero variants: `variants` arrives as an ARRAY of
 * `{ id, settings }` objects, not an object keyed by level. An object-keyed read
 * yields `[]` — the exact "this model has no thinking levels" answer, with no
 * error anywhere. Hence `variantIds` below.
 *
 * Rows are keyed `provider/model`, the same string the fleet stores as
 * `eff.model`, so a lookup by the chat's current model matches.
 */
export function normalizeModelCatalog(data) {
  const rows = Array.isArray(data) ? data : [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const provider = String(row.providerID || '').trim();
    const model = String(row.modelID || row.id || '').trim();
    if (!provider || !model) continue;
    out.push({
      id: `${provider}/${model}`,
      variants: variantIds(row.variants),
      context: Number(row.limit?.context) || 0,
    });
  }
  return out;
}

/**
 * The thinking levels one catalog row offers.
 *
 * Tolerates both shapes seen in the wild: an array of `{ id }` (current CLI) and
 * an object keyed by level (the format the removed `--verbose` flag emitted).
 */
export function variantIds(variants) {
  if (Array.isArray(variants)) {
    return variants
      .map((v) => (typeof v === 'string' ? v : v?.id))
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
  }
  if (variants && typeof variants === 'object') {
    return Object.keys(variants).map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

/**
 * Read the catalog, or `null` when the host cannot answer.
 *
 * Never throws: a `/thinking` that reports "this host cannot tell me the levels"
 * is useful, and one that dies on a missing binary is not. Callers fall back to
 * the plain model list for names.
 */
export async function listModelCatalog(opts = {}) {
  try {
    return normalizeModelCatalog(await opencodeApi('model.list', opts));
  } catch {
    return null;
  }
}