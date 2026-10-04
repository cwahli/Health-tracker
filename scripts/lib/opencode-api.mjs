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