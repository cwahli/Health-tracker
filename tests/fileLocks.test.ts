import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeFile,
  extractFiles,
  claimFiles,
  releaseFiles,
  releaseByBug,
  listLocks,
  isStale,
  TTL_MS,
} from '../scripts/lib/file-locks.mjs';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-locks-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('normalizeFile', () => {
  it('accepts repo-relative paths and strips decorations', () => {
    expect(normalizeFile('./src/App.tsx')).toBe('src/App.tsx');
    expect(normalizeFile('src/App.tsx,')).toBe('src/App.tsx');
    expect(normalizeFile('`scripts/lib/file-locks.mjs`')).toBe('scripts/lib/file-locks.mjs');
  });

  it('rejects absolute, escaping, and extensionless paths', () => {
    expect(normalizeFile('/etc/passwd')).toBeNull();
    expect(normalizeFile('../secrets.txt')).toBeNull();
    expect(normalizeFile('.env')).toBeNull();
    expect(normalizeFile('src/App')).toBeNull();
    expect(normalizeFile('')).toBeNull();
  });
});

describe('extractFiles', () => {
  it('scrapes distinct file paths from free-form text', () => {
    const text = 'Fix Round Omega-3 in src/components/WeeklyNutritionCard.tsx and check src/utils/translations.ts';
    expect(extractFiles(text)).toEqual([
      'src/components/WeeklyNutritionCard.tsx',
      'src/utils/translations.ts',
    ]);
  });

  it('caps the number of files and ignores duplicates', () => {
    const text = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`).join(' ');
    expect(extractFiles(text).length).toBe(25);
  });
});

describe('claimFiles', () => {
  it('claims a file for the first owner', () => {
    const { claimed, conflicts } = claimFiles(['src/App.tsx'], { bugId: 'A', pid: process.pid }, { dir });
    expect(claimed).toEqual(['src/App.tsx']);
    expect(conflicts).toEqual([]);
    expect(listLocks({ dir })).toHaveLength(1);
  });

  it('reports a conflict when another live run holds the same file', () => {
    claimFiles(['src/App.tsx'], { bugId: 'A', pid: process.pid }, { dir });
    const { claimed, conflicts } = claimFiles(['src/App.tsx'], { bugId: 'B', pid: process.pid }, { dir });
    expect(claimed).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].holder.bugId).toBe('A');
  });

  it('lets the same owner re-claim without conflict', () => {
    claimFiles(['src/App.tsx'], { bugId: 'A', pid: process.pid }, { dir });
    const { claimed, conflicts } = claimFiles(['src/App.tsx'], { bugId: 'A', pid: process.pid }, { dir });
    expect(claimed).toEqual(['src/App.tsx']);
    expect(conflicts).toEqual([]);
  });

  it('reclaims a claim whose holder process is dead', () => {
    claimFiles(['src/App.tsx'], { bugId: 'A', pid: 999999 }, { dir });
    const { claimed, conflicts } = claimFiles(['src/App.tsx'], { bugId: 'B', pid: process.pid }, { dir });
    expect(claimed).toEqual(['src/App.tsx']);
    expect(conflicts).toEqual([]);
  });
});

describe('isStale / listLocks', () => {
  it('treats an expired claim as stale and prunes it', () => {
    const past = Date.now() - TTL_MS - 1000;
    fs.writeFileSync(
      path.join(dir, `${encodeURIComponent('src/old.ts')}.json`),
      JSON.stringify({ file: 'src/old.ts', bugId: 'A', pid: process.pid, expiresAt: past }),
    );
    const raw = JSON.parse(fs.readFileSync(path.join(dir, `${encodeURIComponent('src/old.ts')}.json`), 'utf8'));
    expect(isStale(raw)).toBe(true);
    expect(listLocks({ dir })).toEqual([]);
    expect(fs.existsSync(path.join(dir, `${encodeURIComponent('src/old.ts')}.json`))).toBe(false);
  });

  it('keeps live claims and sorts them by file', () => {
    claimFiles(['src/b.ts', 'src/a.ts'], { bugId: 'A', pid: process.pid }, { dir });
    expect(listLocks({ dir }).map((c: { file: string }) => c.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('release', () => {
  it('releases only the given owner', () => {
    claimFiles(['src/a.ts'], { bugId: 'A', pid: process.pid }, { dir });
    claimFiles(['src/b.ts'], { bugId: 'B', pid: process.pid }, { dir });
    expect(releaseFiles(['src/a.ts'], 'B', { dir })).toBe(0);
    expect(releaseFiles(['src/a.ts'], 'A', { dir })).toBe(1);
    expect(listLocks({ dir }).map((c: { file: string }) => c.file)).toEqual(['src/b.ts']);
  });

  it('releaseByBug drops every claim for a run', () => {
    claimFiles(['src/a.ts', 'src/b.ts'], { bugId: 'A', pid: process.pid }, { dir });
    claimFiles(['src/c.ts'], { bugId: 'B', pid: process.pid }, { dir });
    expect(releaseByBug('A', { dir })).toBe(2);
    expect(listLocks({ dir }).map((c: { file: string }) => c.file)).toEqual(['src/c.ts']);
  });
});
