import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildChildEnv } from './child-env.mjs';

const HOME = os.homedir();

export const CLINE_THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'];

export function resolveClineBin(explicit) {
  if (explicit) return explicit;
  const candidates = [
    path.join(HOME, '.npm-global', 'bin', 'cline'),
    path.join(HOME, '.local', 'bin', 'cline'),
    '/usr/local/bin/cline',
    '/usr/bin/cline',
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return 'cline';
}

export function clineSessionsDir(explicit) {
  if (explicit) return explicit;
  if (process.env.CLINE_SESSIONS_DIR) return process.env.CLINE_SESSIONS_DIR;
  return path.join(HOME, '.cline', 'data', 'sessions');
}

/** Session directory names are `<epoch-ms>_<rand>`, e.g. 1790714599861_80trx. */
export const CLINE_SESSION_ID_RE = /^\d+_[A-Za-z0-9]+$/;

export function listClineSessionIds(dir = clineSessionsDir(), readdirImpl = fs.readdirSync) {
  try {
    return readdirImpl(dir).filter((name) => CLINE_SESSION_ID_RE.test(name));
  } catch {
    return [];
  }
}

/**
 * The id of the session one run just created.
 *
 * Cline 3.0.65 has no headless resume — `cline --id <id> --json` answers
 * "interactive mode is unsupported" and `cline --id <id>` without a TTY
 * answers "interactive mode requires a TTY" (both measured on 3.0.65, see
 * TUI_TG_AUTH_TRAIL.md). So the id cannot be passed IN; it can only be read back
 * OUT. Every run writes `<sessions>/<epoch>_<rand>/<epoch>_<rand>.json`, and the
 * before/after diff of that directory is the run's own footprint.
 *
 * Candidates are filtered on the run's own workspace, because the directory is
 * shared by every cline process on the host: a run in /a and a run in /b both
 * land here, and an id from the wrong checkout resumes a conversation that has
 * nothing to do with this chat. `cwd` is the discriminator; `started_at` breaks
 * ties so the newest wins.
 */
export function pickClineSessionId({ before = [], after = [], workspace = '', readMeta = defaultReadClineSessionMeta, dir } = {}) {
  const seen = new Set(before);
  const fresh = after.filter((id) => !seen.has(id)).sort();
  const dated = [];
  for (const id of fresh) {
    const meta = readMeta(id, dir) || {};
    if (workspace && meta.cwd && meta.cwd !== workspace) continue;
    dated.push({ id, started: Number(meta.started_at_epoch) || Date.parse(meta.started_at || '') || 0 });
  }
  if (!dated.length) return null;
  dated.sort((a, b) => b.started - a.started);
  return dated[0].id;
}

function defaultReadClineSessionMeta(id, dir = clineSessionsDir()) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, id, `${id}.json`), 'utf8'));
    return { ...raw, started_at_epoch: Date.parse(raw.started_at || '') || 0 };
  } catch {
    return null;
  }
}

export function buildClineArgs({ prompt, model, variant, plan = false, timeoutMs = 0, workspace }) {
  const args = ['-P', 'cline', '-m', model, '--json', '--auto-approve', 'true'];
  if (variant && CLINE_THINKING_LEVELS.includes(variant)) args.push('--thinking', variant);
  if (plan) args.push('-p');
  if (timeoutMs > 0) args.push('-t', String(Math.ceil(timeoutMs / 1000)));
  if (workspace) args.push('-c', workspace);
  // cline declares `[command] [prompt]`: a lone single-word first positional is
  // read as a subcommand and dies with "Unknown command or unquoted prompt"
  // (so a plain "Hi" could never work). A trailing space forces the prompt
  // branch (verified live against the real CLI); it is semantically null.
  const single = String(prompt ?? '').trim().split(/\s+/).filter(Boolean).length === 1;
  args.push(single ? `${prompt} ` : prompt);
  return args;
}

export function mapClineEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'run_result') {
    return {
      kind: 'run_result',
      text: typeof raw.text === 'string' ? raw.text : '',
      usage: raw.usage || null,
      finishReason: raw.finishReason || '',
      model: raw.model || null,
    };
  }
  if (raw.type === 'error') {
    return { kind: 'error', message: raw.message || 'cline error' };
  }
  const event = raw.event || {};
  if (event.type === 'error') {
    const message = event.error?.message || event.message || 'cline error';
    return { kind: 'error', message };
  }
  if (event.type === 'iteration_start' || event.type === 'done' || event.type === 'iteration_end') {
    return { kind: 'step_finish' };
  }
  const thinking = event.thinking || event.reasoning || (event.type === 'reasoning' ? event.text : '');
  if (typeof thinking === 'string' && thinking.trim()) {
    return { kind: 'reasoning', text: thinking };
  }
  if (event.type && /tool/i.test(String(event.type))) {
    return { kind: 'tool', tool: event.tool || event.type, status: event.status || 'running' };
  }
  return { kind: 'other', type: event.type || raw.type };
}

export function runCline({
  prompt,
  model,
  variant,
  plan = false,
  workspace,
  timeoutMs = 900000,
  clineBin,
  onEvent,
  onSpawn,
  env,
  envMode = 'inherit',
  spawnImpl = spawn,
  sessionsDir,
  listSessionIds = listClineSessionIds,
  readSessionMeta = defaultReadClineSessionMeta,
}) {
  return new Promise((resolve) => {
    const args = buildClineArgs({ prompt, model, variant, plan, timeoutMs, workspace });
    // The before/after diff of the sessions directory is the only way to learn
    // this run's id, because Cline cannot be told which id to use. Taken BEFORE
    // the spawn, or the run's own directory is already in the snapshot.
    const before = listSessionIds(sessionsDir);
    const child = spawnImpl(resolveClineBin(clineBin), args, {
      cwd: workspace,
      env: buildChildEnv({ extraEnv: env, mode: envMode }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (typeof onSpawn === 'function') {
      try {
        onSpawn(child);
      } catch {
        // ignore
      }
    }

    let finalText = '';
    let lastError = null;
    let stderr = '';
    let cost = 0;
    let tokens = null;
    let buffer = '';
    let settled = false;

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
      const sessionID = pickClineSessionId({
        before,
        after: listSessionIds(sessionsDir),
        workspace,
        readMeta: readSessionMeta,
        dir: sessionsDir,
      });
      resolve({
        code,
        sessionID,
        finalText: finalText.trim(),
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
      const event = mapClineEvent(raw);
      if (!event) return;
      if (event.kind === 'run_result') {
        const usage = event.usage || {};
        cost = Number(usage.totalCost) || 0;
        const input = Number(usage.inputTokens) || 0;
        const output = Number(usage.outputTokens) || 0;
        if (input || output) tokens = { total: input + output };
        if (event.finishReason === 'error') {
          lastError = lastError || event.text || 'cline run failed';
        } else if (event.text) {
          finalText = event.text;
        }
      }
      if (event.kind === 'error') lastError = event.message;
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
    });
    child.on('error', (err) => {
      lastError = err.message;
      finish(-1);
    });
    child.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (!finalText && !lastError && code !== 0) lastError = `cline exited with code ${code}`;
      finish(code);
    });
  });
}
