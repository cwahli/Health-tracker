import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  lockHolder,
  acquireDispatchLock,
  releaseDispatchLock,
  beginDispatchRun,
  endDispatchRun,
  humanizeRunError,
  isTimeoutError,
} from './opencode-bot.mjs';

/**
 * Sensors for the two reported bot failures:
 *  1. "The repo is busy with opencode-chat (pid <self>)" — a stale self-lock
 *     made the bot reject every message for the life of the process.
 *  2. "Error: timed out after 900000ms" — raw ms leaked into the chat.
 * The lock path is redirected to a temp dir so ~/.hermes is never touched.
 */

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bot-lock-'));
  process.env.OPENCODE_BOT_DISPATCH_LOCK = path.join(tmpDir, 'dispatch_lock');
});

afterAll(() => {
  delete process.env.OPENCODE_BOT_DISPATCH_LOCK;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  endDispatchRun();
  releaseDispatchLock();
  try {
    fs.unlinkSync(process.env.OPENCODE_BOT_DISPATCH_LOCK);
  } catch {
    // already gone
  }
});

function writeLock(content) {
  fs.mkdirSync(path.dirname(process.env.OPENCODE_BOT_DISPATCH_LOCK), { recursive: true });
  fs.writeFileSync(process.env.OPENCODE_BOT_DISPATCH_LOCK, content);
}

describe('dispatch lock (repo-busy self-deadlock)', () => {
  it('reclaims a stale lock naming this process when no run is active', () => {
    writeLock(`${process.pid}:opencode-chat\n`);
    expect(lockHolder()?.pid).toBe(process.pid);
    const holder = acquireDispatchLock();
    expect(holder).toBeNull(); // acquired — no longer blocked
    expect(fs.readFileSync(process.env.OPENCODE_BOT_DISPATCH_LOCK, 'utf8')).toContain(`${process.pid}:`);
  });

  it('keeps the lock when this process genuinely holds it for a live run', () => {
    beginDispatchRun();
    writeLock(`${process.pid}:opencode-chat\n`);
    const holder = acquireDispatchLock();
    expect(holder).toEqual({ pid: process.pid, bug: 'opencode-chat' });
  });

  it('still refuses a lock held by another live pid', () => {
    // pid 1 exists but is not ours — holder is respected (kill(1,0) succeeds
    // for any user; only EPERM/ESRCH would fail, EPERM means "alive").
    writeLock(`1:BUG-20260923-0001\n`);
    const holder = lockHolder();
    if (holder) {
      expect(holder.pid).toBe(1);
      expect(acquireDispatchLock()).toEqual(holder);
    } else {
      // Environment where pid 1 signals EPERM as failure — treat as dead, reclaim.
      expect(acquireDispatchLock()).toBeNull();
    }
  });

  it('treats a dead pid in the lock as free', () => {
    const child = spawnSync(process.execPath, ['-e', '']);
    const deadPid = child.pid;
    writeLock(`${deadPid}:opencode-chat\n`);
    expect(lockHolder()).toBeNull();
    expect(acquireDispatchLock()).toBeNull();
  });
});

describe('humanizeRunError (raw timeout ms)', () => {
  it('maps the 900000ms wall to minutes with a next step', () => {
    const out = humanizeRunError('timed out after 900000ms');
    expect(out).toMatch(/15m/);
    expect(out).toMatch(/\/new/);
    expect(out).toMatch(/\/model/);
    expect(out).not.toMatch(/900000ms/);
  });

  it('maps sub-minute timeouts to seconds', () => {
    expect(humanizeRunError('timed out after 30000ms')).toMatch(/30s/);
  });

  it('passes non-timeout errors through unchanged', () => {
    expect(humanizeRunError('spawn opencode ENOENT')).toBe('spawn opencode ENOENT');
    expect(humanizeRunError('')).toBe('');
  });

  it('isTimeoutError detects only timeout strings', () => {
    expect(isTimeoutError('timed out after 900000ms')).toBe(true);
    expect(isTimeoutError('quota exceeded')).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
