import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  ATTACH_WARN_MSGS,
  ATTACH_WARN_BYTES,
  attachNeedsConfirm,
  formatBytes,
  validateAttachTarget,
  recordOrphan,
  unorphan,
  listOrphans,
} from './session-orphans.mjs';

const DatabaseSync = (() => {
  try {
    return createRequire(import.meta.url)('node:sqlite').DatabaseSync;
  } catch {
    return null;
  }
})();

const itDb = DatabaseSync ? it : it.skip;

describe('attachNeedsConfirm', () => {
  it('warns past the measured heavy thresholds only', () => {
    expect(attachNeedsConfirm({ msgs: 10, bytes: 1024 })).toBe(false);
    expect(attachNeedsConfirm({ msgs: ATTACH_WARN_MSGS, bytes: 0 })).toBe(true);
    expect(attachNeedsConfirm({ msgs: 0, bytes: ATTACH_WARN_BYTES })).toBe(true);
  });
  it('formats sizes for chat copy', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(35991 * 1024)).toBe('35.1 MB');
  });
});

describe('validateAttachTarget', () => {
  let home = '';
  let dbPath = '';
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'orph-'));
    dbPath = path.join(home, 'opencode.db');
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  function seed() {
    const db = new DatabaseSync(dbPath);
    db.exec('create table session_v2 (id text, directory text, title text, time_archived integer)');
    db.exec('create table session_message (session_id text, data blob)');
    db.prepare('insert into session_v2 values (?, ?, ?, ?)').run('ses_live0000001', '/w', 'Build auth', null);
    db.prepare('insert into session_v2 values (?, ?, ?, ?)').run('ses_old00000002', '/other', 'Old', null);
    db.prepare('insert into session_v2 values (?, ?, ?, ?)').run('ses_arch000003', '/w', 'Gone', 1700000000000);
    for (let i = 0; i < 3; i++) db.prepare('insert into session_message values (?, ?)').run('ses_live0000001', Buffer.from('x'.repeat(100)));
    db.close();
  }
  itDb('accepts a live session in the chat workspace with its size', () => {
    seed();
    expect(validateAttachTarget({ sessionId: 'ses_live0000001', workspace: '/w', dbPath, home })).toEqual({
      ok: true, sessionId: 'ses_live0000001', title: 'Build auth', directory: '/w', msgs: 3, bytes: 300,
    });
  });
  itDb('refuses unknown, archived, and wrong-workspace ids with reasons', () => {
    seed();
    expect(validateAttachTarget({ sessionId: 'ses_nope0000000', workspace: '/w', dbPath, home }).ok).toBe(false);
    expect(validateAttachTarget({ sessionId: 'ses_arch000003', workspace: '/w', dbPath, home }).reason).toMatch(/archived/);
    expect(validateAttachTarget({ sessionId: 'ses_old00000002', workspace: '/w', dbPath, home }).reason).toMatch(/\/other/);
  });
  it('refuses non-opencode ids out loud (Cline threads cannot attach)', () => {
    expect(validateAttachTarget({ sessionId: '1791653950109_ec21d', workspace: '/w', dbPath: '/none', home }).reason).toMatch(/Cline/);
    expect(validateAttachTarget({ sessionId: '', workspace: '/w', dbPath: '/none', home }).ok).toBe(false);
  });
});

describe('orphan list', () => {
  let home = '';
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'orph-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('records once, lists, and unregisters on rebind', () => {
    expect(listOrphans({ home })).toEqual([]);
    const row = recordOrphan({ sessionId: 'ses_abc', workspace: '/w', reason: '/new', home, now: 1000 });
    expect(row?.since).toBe(new Date(1000).toISOString());
    recordOrphan({ sessionId: 'ses_abc', workspace: '/w', reason: '/new', home });
    expect(listOrphans({ home })).toHaveLength(1);
    expect(unorphan({ sessionId: 'ses_nope', home })).toBe(false);
    expect(unorphan({ sessionId: 'ses_abc', home })).toBe(true);
    expect(listOrphans({ home })).toEqual([]);
  });
});
