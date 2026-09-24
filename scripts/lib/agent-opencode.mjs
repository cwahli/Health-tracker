import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recordFailure } from './failure-log.mjs';

const HOME = os.homedir();

export function expandSkillPath(p, workspace) {
  const value = String(p ?? '').trim();
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(workspace || '.', value);
}

export function buildOpencodeEnv({
  workspace,
  allowExternalDirectory,
  sharedSkills,
  playwrightOutputDir,
  smallModel,
} = {}) {
  const content = { $schema: 'https://opencode.ai/config.json' };
  // opencode uses a separate "small" model for session titles and other
  // background work. When it points at a model the account cannot use, every
  // run logs a hard error before the real prompt even starts — route it at a
  // model we know is funded.
  if (smallModel) content.small_model = smallModel;
  if (allowExternalDirectory) content.permission = { external_directory: 'allow' };
  const paths = (Array.isArray(sharedSkills) ? sharedSkills : [])
    .map((p) => expandSkillPath(p, workspace))
    .filter(Boolean);
  if (paths.length) content.skills = { paths };
  if (playwrightOutputDir) {
    content.mcp = {
      playwright: {
        type: 'local',
        command: [
          'npx',
          '-y',
          '@playwright/mcp@latest',
          '--headless',
          '--isolated',
          '--output-dir',
          playwrightOutputDir,
        ],
        enabled: true,
      },
    };
  }
  if (Object.keys(content).length <= 1) return {};
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(content) };
}

export function resolveOpencodeBin(explicit) {
  if (explicit) return explicit;
  const candidates = [
    path.join(HOME, '.opencode', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/usr/bin/opencode',
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return 'opencode';
}

export function mapOpencodeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const part = raw.part || {};
  switch (raw.type) {
    case 'reasoning':
      return { kind: 'reasoning', text: part.text || '' };
    case 'text':
      return { kind: 'text', text: part.text || '' };
    case 'tool':
      return {
        kind: 'tool',
        tool: part.tool || 'tool',
        status: part.state?.status || 'unknown',
        input: part.state?.input,
        output: part.state?.output,
      };
    case 'step_start':
      return { kind: 'step_start' };
    case 'step_finish':
      return { kind: 'step_finish', tokens: part.tokens, cost: part.cost };
    case 'error':
      return {
        kind: 'error',
        message: raw.error?.data?.message || raw.error?.message || 'unknown error',
      };
    default:
      return { kind: 'other', type: raw.type };
  }
}

export function execOpencode(args, { opencodeBin, spawnImpl = spawn, timeoutMs = 30000, env } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawnImpl(resolveOpencodeBin(opencodeBin), args, {
        env: { ...process.env, ...(env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      done('');
      return;
    }
    let out = '';
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
            done(out);
          }, timeoutMs)
        : null;
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', () => {
      if (timer) clearTimeout(timer);
      done(out);
    });
    child.on('close', () => {
      if (timer) clearTimeout(timer);
      done(out);
    });
  });
}

export async function listModels(opts = {}) {
  const out = await execOpencode(['models'], opts);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listAgents(opts = {}) {
  return execOpencode(['agent', 'list'], opts);
}

export function listModelsVerbose(opts = {}) {
  return execOpencode(['models', '--verbose'], { timeoutMs: 60000, ...opts });
}

export function buildOpencodeArgs({ prompt, model, variant, thinking = true, extraArgs = [] }) {
  const args = ['run', '--format', 'json'];
  // Provider failures (rate limit, no funds, bad auth) are written to stderr as
  // ERROR log lines, after which opencode sits there forever with an EMPTY
  // stdout — no JSON events at all. Without these flags the only thing the bot
  // can report is "timed out after 900000ms", 15 minutes later.
  args.push('--print-logs', '--log-level', 'ERROR');
  if (thinking) args.push('--thinking');
  if (variant) args.push('--variant', variant);
  if (model) args.push('-m', model);
  if (extraArgs.length) args.push(...extraArgs);
  args.push(prompt);
  return args;
}

/**
 * Provider errors that opencode logs to stderr and then hangs on. Order matters:
 * the first match wins, so put the most specific/actionable reasons first.
 *
 * Vocabulary is deliberately aligned with the provider router's
 * `isQuotaOrLimitError` (tools/telegram-provider-router/src/index.js) so both
 * runtimes classify the same outage the same way — see plan/RELIABILITY.md §14.
 */
const FATAL_LOG_ERRORS = [
  {
    pattern: /model not found/i,
    reason: 'Model not found on this provider — the model list may be stale, pick again from /freemodel.',
  },
  {
    pattern: /free_tier_limit|free usage exceeded|free limit reached|subscribe to go/i,
    reason: 'Free-tier allowance for this model is used up.',
  },
  {
    pattern: /rate limit exceeded|too many requests|throttl/i,
    reason: 'Provider rate limit hit — this model is throttled right now.',
  },
  {
    pattern: /insufficient account funds|out of credits|no credits|credit.?balance/i,
    reason: 'Provider account is out of funds.',
  },
  {
    pattern: /no payment method|payment required/i,
    reason: 'Provider has no payment method on file.',
  },
  {
    pattern: /unauthoriz|invalid api key|authentication/i,
    reason: 'Provider rejected the credentials (auth failed).',
  },
  {
    pattern: /quota|usage limit|daily.?cap|capacity|exhausted/i,
    reason: 'Provider quota or capacity limit reached.',
  },
];

/**
 * Parse a provider's own "when can I retry" hint out of an error string.
 *
 * Ported from the provider router's `parseDepletedUntil`: a bare "rate limited"
 * leaves the user guessing, while "try again in 3h 20m" / an ISO reset stamp
 * lets us say exactly when the model comes back. Returns '' when the provider
 * gives no hint (`0`-equivalent), never throws.
 */
export function parseRetryAfter(text) {
  const s = String(text || '');
  const iso = s.match(/(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  if (iso) {
    const t = Date.parse(iso[1]);
    if (Number.isFinite(t) && t > Date.now()) {
      const mins = Math.ceil((t - Date.now()) / 60000);
      return mins >= 60 ? `Retry in ~${Math.round(mins / 60)}h.` : `Retry in ~${mins}m.`;
    }
  }
  const hm = s.match(/in\s+(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*m/i);
  if (hm) return `Retry in ~${Number(hm[1])}h${Number(hm[2] || 0) ? ` ${Number(hm[2])}m` : ''}.`;
  const hOnly = s.match(/in\s+(\d+)\s*h(?:ours?|rs?)?\b/i);
  if (hOnly) return `Retry in ~${Number(hOnly[1])}h.`;
  const mOnly = s.match(/in\s+(\d+)\s*m(?:in(?:utes?)?)?\b/i);
  if (mOnly) return `Retry in ~${Number(mOnly[1])}m.`;
  const sOnly = s.match(/in\s+(\d+)\s*s(?:ec(?:onds?)?)?\b/i);
  if (sOnly) return `Retry in ~${Number(sOnly[1])}s.`;
  return '';
}

/**
 * Pull an actionable reason out of opencode's stderr log lines. Returns null when
 * stderr holds no ERROR-level line. The `error.error="..."` detail is preferred
 * because it carries the provider's own wording.
 */
export function extractLogError(stderr) {
  // Strip ANSI color (cline/opencode both emit \x1b[..m) so patterns match and
  // chat output stays clean.
  const text = String(stderr || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (!text || !/level=ERROR/.test(text)) return null;
  // opencode runs a cosmetic "small" model (session titles) before the model the
  // user actually asked for, so its failures are NOT fatal: a run can still
  // answer normally after one (measured on the VPS: `ling-3.0-flash-fin-free`
  // returned a full reply while the title agent logged "Insufficient account
  // funds"). Counting those would kill a run that was about to succeed, so only
  // `small=false` (or unlabelled) errors are considered.
  const lines = text
    .split('\n')
    .filter((line) => /level=ERROR/.test(line) && !/\bsmall=true\b/.test(line));
  if (!lines.length) return null;
  const details = [...new Set(lines
    .map((line) => line.match(/error\.error="([^"]+)"/)?.[1]
      // Newer shape: ... cause="Cause([Fail(ModelNotFoundError: Model not found: x. Did you mean: y?)])"
      || line.match(/Fail\(([A-Za-z]*Error): ([^)]+)\)/)?.slice(1).join(': '))
    .filter(Boolean))];
  // The last detail is the one from the run the user asked for.
  const detail = details.length ? details[details.length - 1] : '';
  const haystack = detail || lines.join('\n');
  const hint = parseRetryAfter(haystack);
  for (const { pattern, reason } of FATAL_LOG_ERRORS) {
    if (pattern.test(haystack)) {
      return [reason, hint, detail ? `(${detail})` : ''].filter(Boolean).join(' ');
    }
  }
  if (detail) return hint ? `${detail} ${hint}` : detail;
  return `opencode error: ${lines[lines.length - 1].trim().slice(0, 300)}`;
}

/**
 * Does this error mean "this lane is unavailable right now" (free allowance
 * spent, account unfunded, throttled, capacity) rather than "your request was
 * wrong"? Used to decide whether the same prompt is worth re-running on another
 * model.
 *
 * Vocabulary aligned with the provider router's `isQuotaOrLimitError`
 * (tools/telegram-provider-router, plan/RELIABILITY.md §14) so both runtimes
 * classify a lane failure the same way.
 */
const QUOTA_OR_LIMIT_RE =
  /quota|rate.?limit|\b429\b|\b402\b|\b4006\b|insufficient|out of credits|no credits|usage limit|free.?limit|exhausted|freebuck|free.?usage|payment required|exceeded|throttl|capacity|limit reached|daily.?cap|freeusagelimit|credit.?balance|neuron|workers ai|too many requests/i;

export function isQuotaOrLimitError(msg) {
  return QUOTA_OR_LIMIT_RE.test(String(msg || ''));
}

/** A timeout/abort means re-running would just wait again — never auto-retry those. */
const NO_RETRY_RE = /timed out after|aborted|^Abort/i;

/**
 * Failover chain for one dispatch: the chat's effective model first, then
 * the bot default. Identical entries collapse, so a chat on the default
 * model runs exactly once (current behavior). No invented models — both
 * ends come from the registry/prefs.
 */
export function failoverModels(primary, fallback) {
  return [...new Set([primary, fallback].filter(Boolean))];
}

/**
 * Run the user's prompt on the first model that works, mirroring the provider
 * router's free-lane failover: when a lane is rate-limited/unfunded, re-run the
 * SAME prompt on the next candidate instead of dead-ending in the chat.
 *
 * `makeRun(model)` is supplied by the caller so session/prompt/env wiring stays
 * in bot-host; this function only owns the retry decision, which keeps it unit
 * testable without spawning a real CLI.
 */
export async function runWithModelFailover({
  models,
  makeRun,
  onSwitch,
  isRetryable = defaultIsRetryable,
}) {
  const candidates = [...new Set((models || []).filter(Boolean))];
  if (!candidates.length) throw new Error('runWithModelFailover needs at least one model');
  const attempts = [];
  let result = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    result = await makeRun(model);
    attempts.push({ model, lastError: result?.lastError || null, ok: !isRetryable(result) });
    if (!isRetryable(result) || i === candidates.length - 1) break;
    if (typeof onSwitch === 'function') {
      try {
        onSwitch({ from: model, to: candidates[i + 1], reason: result?.lastError || '', attempt: i + 1 });
      } catch {
        // a UI hiccup must never break failover
      }
    }
  }
  return { result, attempts };
}

/**
 * Failover is only worth it when nothing was delivered to the user and the
 * failure was not a wait (timeout/abort). Any other error — quota, unfunded
 * account, unknown model, provider 5xx — is a reason to try the next lane.
 */
export function defaultIsRetryable(result) {
  if (!result) return false;
  if (result.finalText && String(result.finalText).trim()) return false;
  const err = String(result.lastError || '');
  if (!err) return false;
  return !NO_RETRY_RE.test(err);
}

export function runOpencode({
  prompt,
  model,
  variant,
  workspace,
  thinking = true,
  timeoutMs = 900000,
  opencodeBin,
  onEvent,
  onSpawn,
  extraArgs = [],
  env,
  spawnImpl = spawn,
}) {
  return new Promise((resolve) => {
    const args = buildOpencodeArgs({ prompt, model, variant, thinking, extraArgs });
    const child = spawnImpl(resolveOpencodeBin(opencodeBin), args, {
      cwd: workspace,
      env: { ...process.env, ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (typeof onSpawn === 'function') {
      try {
        onSpawn(child);
      } catch {
        // ignore
      }
    }

    const textParts = [];
    let stderr = '';
    let sessionID = null;
    let lastError = null;
    let buffer = '';
    let settled = false;
    let cost = 0;
    let tokens = null;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            lastError = lastError || `timed out after ${timeoutMs}ms`;
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, timeoutMs)
        : null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Safety net: a fatal startup error can arrive before any stdout, leaving
      // lastError empty. Without this the caller only sees "exit 0 / no text".
      if (!lastError && !textParts.length && stderr) lastError = extractLogError(stderr);
      // Learning loop: record classified failures best-effort so repeats can
      // be grouped into learnings (recordFailure never throws; BOT_FAILURE_LOG=0 disables).
      if (lastError && !textParts.length) {
        recordFailure({ lane: model || null, kind: lastError, hint: parseRetryAfter(String(lastError)) });
      }
      resolve({
        code,
        sessionID,
        finalText: textParts.join('\n\n').trim(),
        lastError,
        stderr,
        usage: { cost, tokens },
      });
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let raw;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (raw.sessionID) sessionID = raw.sessionID;
      const event = mapOpencodeEvent(raw);
      if (!event) return;
      if (event.kind === 'text' && event.text) textParts.push(event.text);
      if (event.kind === 'error') lastError = event.message;
      if (event.kind === 'step_finish') {
        cost += Number(event.cost) || 0;
        if (event.tokens) tokens = event.tokens;
      }
      if (onEvent) {
        try {
          onEvent(event);
        } catch {
          // renderer errors must never kill the run
        }
      }
    };

    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        handleLine(line);
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      // A fatal provider error leaves opencode hung with an empty stdout and no
      // JSON error event, so nothing would ever settle this run. Report the real
      // reason and stop now rather than waiting out the full 15-minute timeout.
      if (!settled && !textParts.length && !lastError) {
        const fatal = extractLogError(stderr);
        if (fatal) {
          lastError = fatal;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }
    });
    child.on('error', (err) => {
      lastError = err.message;
      finish(-1);
    });
    child.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      finish(code);
    });
  });
}

/**
 * Raw run failures → one line a human can act on. The timeout above is
 * `timed out after ${timeoutMs}ms` — never surface raw ms in a chat.
 */
export function humanizeRunError(raw) {
  const s = String(raw || '');
  const timeout = s.match(/timed out after (\d+)ms/);
  if (timeout) {
    const ms = Number(timeout[1]);
    const mins = ms / 60000;
    const dur = mins >= 2 ? `${Math.round(mins)}m` : `${Math.round(ms / 1000)}s`;
    return `Timed out after ${dur} — the model didn't finish.`;
  }
  return s;
}

export function isTimeoutError(raw) {
  return /timed out after \d+ms/.test(String(raw || ''));
}
