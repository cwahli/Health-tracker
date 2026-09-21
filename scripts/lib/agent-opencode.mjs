import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

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

export function buildOpencodeArgs({ prompt, model, variant, thinking = true, extraArgs = [] }) {
  const args = ['run', '--format', 'json'];
  if (thinking) args.push('--thinking');
  if (variant) args.push('--variant', variant);
  if (model) args.push('-m', model);
  if (extraArgs.length) args.push(...extraArgs);
  args.push(prompt);
  return args;
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
  extraArgs = [],
  spawnImpl = spawn,
}) {
  return new Promise((resolve) => {
    const args = buildOpencodeArgs({ prompt, model, variant, thinking, extraArgs });
    const child = spawnImpl(resolveOpencodeBin(opencodeBin), args, {
      cwd: workspace,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const textParts = [];
    let stderr = '';
    let sessionID = null;
    let lastError = null;
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
        sessionID,
        finalText: textParts.join('\n\n').trim(),
        lastError,
        stderr,
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
      finish(code);
    });
  });
}
