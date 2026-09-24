import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  spawnImpl = spawn,
}) {
  return new Promise((resolve) => {
    const args = buildClineArgs({ prompt, model, variant, plan, timeoutMs, workspace });
    const child = spawnImpl(resolveClineBin(clineBin), args, {
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
      resolve({
        code,
        sessionID: null,
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
