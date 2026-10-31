/**
 * agent-commandcode.mjs — the Command Code (`cmd`) lane.
 *
 * Command Code has a real headless mode: `cmd -p "<prompt>" --output-format json`
 * runs one turn, prints a newline-delimited JSON stream, persists a resumable
 * session, and exits. That is the same shape every other lane here honours —
 * `{ code, sessionID, finalText, lastError, stderr, usage }` — so bot-host can
 * put it beside runOpencode/runCline/runGemini without re-wiring anything.
 *
 * Three things are Command-Code-specific and load-bearing:
 *
 * 1. HEADLESS PERMISSIONS. `cmd -p` denies file writes and shell commands by
 *    default, and `--permission-mode yolo` does NOT lift that in headless mode —
 *    only `--yolo` does (docs/headless). The fleet runs its lanes unattended, so
 *    `--yolo` travels whenever the caller asks for the `yolo` mode. That is the
 *    caller's explicit decision, not something this module sneaks in.
 *
 * 2. SESSION ID COMES OUT, NOT IN. It is read from the single final `result`
 *    frame (`sessionId`); the next turn resumes it with `--resume <id>`. Unlike
 *    opencode there is NO shared server serialising turns, so the caller must
 *    never run a turn while a terminal holds the same session — bot-host enforces
 *    that (see the commandcode gate in bot-host.mjs).
 *
 * 3. STDOUT IS NOT QUITE CLEAN. `cmd` writes an auto-update notice ("Updated X →
 *    Y") to stdout, so `--no-auto-update` is passed and every non-JSON line is
 *    skipped rather than treated as a frame.
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildChildEnv } from './child-env.mjs';

const HOME = os.homedir();

/** The `cmd` binary: explicit path wins, then the usual install locations. */
export function resolveCommandcodeBin(explicit) {
  if (explicit) {
    try {
      fs.accessSync(explicit, fs.constants.X_OK);
      return explicit;
    } catch {
      // keep looking
    }
  }
  const candidates = [
    path.join(HOME, '.npm-global', 'bin', 'cmd'),
    '/usr/local/bin/cmd',
    '/usr/bin/cmd',
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return 'cmd';
}

/** Whether this host can run the lane at all (binary on disk). */
export function commandcodeAvailable({ commandcodeBin } = {}) {
  const bin = resolveCommandcodeBin(commandcodeBin);
  try {
    fs.accessSync(bin, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Headless exit codes → one human-actionable line. Mirrors the table in
 * docs/headless. Only used when a run exits non-zero WITHOUT a `result` frame
 * (a run that got far enough to emit one carries its own error).
 */
const EXIT_REASONS = {
  3: 'Command Code is not authenticated on this host (run `cmd login`, or set COMMAND_CODE_API_KEY).',
  4: 'Permission denied by the rules engine.',
  5: 'Command Code rate limit hit.',
  6: 'Network failure reaching Command Code.',
  7: 'Command Code server error (5xx).',
  8: 'Max turns reached before a final answer.',
  9: 'Model produced no response.',
  10: 'Command Code account is out of credits.',
  130: 'Interrupted.',
};

export function describeCommandcodeExit(code) {
  return EXIT_REASONS[Number(code)] || '';
}

/**
 * The effort levels the CLI advertises for a model, from its own refusal message.
 *
 * `cmd` validates `--effort` against the model BEFORE calling it, so a sentinel
 * level costs nothing and answers two ways:
 *   `Unknown effort "x". Supported: off, high, max.`  -> that list
 *   `Ornith 1.5 122B has no adjustable reasoning effort.` -> [] (none to offer)
 * Returns null when the output matches neither (could not tell), so a caller can
 * tell "no levels" from "unknown" instead of guessing.
 */
export function parseCommandcodeEffortProbe(text) {
  const s = String(text ?? '');
  const m = s.match(/Supported:\s*([a-z0-9,\s]+)\./i);
  if (m) {
    const levels = m[1].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (levels.length) return levels;
  }
  if (/no adjustable reasoning effort/i.test(s)) return [];
  return null;
}

export function commandcodeEffortLevels({ model = '', commandcodeBin, env = process.env, timeoutMs = 20000, exec = execFileSync } = {}) {
  const args = [
    '--no-auto-update', '-p', 'x',
    ...(model ? ['-m', String(model)] : []),
    '--effort', '__probe__',
    '--skip-onboarding',
  ];
  try {
    return parseCommandcodeEffortProbe(exec(resolveCommandcodeBin(commandcodeBin), args, { encoding: 'utf8', timeout: timeoutMs, env }));
  } catch (err) {
    // A non-zero exit still carries the message — on stdout or stderr.
    return parseCommandcodeEffortProbe(`${err?.stdout || ''}\n${err?.stderr || ''}\n${err?.message || ''}`);
  }
}

/** The argv for one headless turn. Exported so a sensor can pin it. */
export function buildCommandcodeArgs({
  prompt,
  model = '',
  effort = '',
  sessionId = '',
  permissionMode = 'yolo',
} = {}) {
  const args = ['--no-auto-update', '-p', String(prompt ?? ''), '--output-format', 'json'];
  // `--permission-mode yolo` does not lift the headless block; `--yolo` does.
  if (String(permissionMode) === 'yolo') args.push('--yolo');
  // Taste onboarding is for a human at a keyboard; a bot turn must not stall on it.
  args.push('--skip-onboarding', '--trust');
  if (sessionId) args.push('--resume', String(sessionId));
  if (model) args.push('-m', String(model));
  if (effort) args.push('--effort', String(effort));
  return args;
}

/** One NDJSON frame from the run → the fleet's event vocabulary. */
export function mapCommandcodeEvent(frame) {
  if (!frame || typeof frame !== 'object') return null;
  if (frame.type !== 'event' || !frame.event || typeof frame.event !== 'object') return null;
  const ev = frame.event;
  switch (ev.type) {
    case 'tool_running':
    case 'tool_result':
      return { kind: 'tool', tool: ev.toolName || ev.tool || 'tool', status: ev.type === 'tool_result' ? 'done' : 'running' };
    case 'reasoning':
      return { kind: 'reasoning', text: ev.text || '' };
    case 'text':
      return { kind: 'text', text: ev.text || '' };
    case 'error':
      return { kind: 'error', message: ev.message || 'command code error' };
    default:
      return { kind: 'other', type: ev.type || '' };
  }
}

/** Normalise the result frame's `usage` into `{ cost, tokens }`. */
export function normalizeCommandcodeUsage(usage) {
  if (!usage || typeof usage !== 'object') return { cost: 0, tokens: null };
  const cost = Number(usage.cost ?? usage.totalCost ?? 0) || 0;
  const input = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0) || (input + output);
  return { cost, tokens: total ? { total } : null };
}

export function runCommandcode({
  prompt,
  model = '',
  effort = '',
  sessionId = '',
  workspace,
  permissionMode = 'yolo',
  timeoutMs = 900000,
  commandcodeBin,
  onEvent,
  onSpawn,
  env,
  envMode = 'inherit',
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    const args = buildCommandcodeArgs({ prompt, model, effort, sessionId, permissionMode });
    const child = spawnImpl(resolveCommandcodeBin(commandcodeBin), args, {
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

    let stderr = '';
    let lastError = null;
    let finalText = '';
    let sessionID = null;
    let usage = { cost: 0, tokens: null };
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
      // A non-zero exit with no reason captured yet: fall back to the exit table.
      if (!lastError && !String(finalText || '').trim() && Number(code) !== 0) {
        lastError = describeCommandcodeExit(code) || `command code exited with code ${code}`;
      }
      resolve({ code, sessionID, finalText: String(finalText || '').trim(), lastError, stderr, usage });
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') return; // update notices and banners are not frames
      let frame;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (frame.type === 'result') {
        if (frame.sessionId) sessionID = String(frame.sessionId);
        usage = normalizeCommandcodeUsage(frame.usage);
        if (frame.subtype === 'error') {
          lastError = frame.error || lastError || 'Command Code run failed.';
        } else {
          finalText = typeof frame.finalText === 'string' ? frame.finalText : finalText;
          if (frame.subtype === 'max_turns') lastError = lastError || describeCommandcodeExit(8);
        }
        return;
      }
      const event = mapCommandcodeEvent(frame);
      if (event && onEvent) {
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
      finish(code);
    });
  });
}
