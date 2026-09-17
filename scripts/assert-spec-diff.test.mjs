import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Q-11.1 — self-test for the locked-spec diff gate.
 *
 * The gate gains one rule: a path that does not exist at HEAD cannot be a rewrite.
 * This exercises the real script in a throwaway git repo so the rule can be trusted:
 * a packet that adds a module must pass, and an in-place rewrite of an allowed
 * existing file must still fail.
 *
 * The guard script lives at scripts/assert-spec-diff.mjs; this test runs it with
 * cwd set to a synthetic repo, so nothing in the working tree is touched.
 */

const guard = path.resolve(process.cwd(), 'scripts/assert-spec-diff.mjs');
let repo = '';

const SPEC = `---
id: selftest
status: locked
class: SELFTEST
edit_mode: patch
allowed_files:
  - src/existing.ts
  - src/newModule.ts
frozen_files:
  - src/frozen.ts
gate:
  - npx tsc --noEmit
---

# Self-test packet
`;

function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function body(prefix, n) {
  return Array.from({ length: n }, (_, i) => `export const ${prefix}_${i} = ${i};`).join('\n') + '\n';
}

function writeRepoFile(rel, text) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function runGuard() {
  try {
    const stdout = execFileSync(process.execPath, [guard, 'selftest'], { cwd: repo, encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'q11-guard-'));
  git(['-c', 'init.defaultBranch=main', 'init']);
  git(['config', 'user.email', 'selftest@example.com']);
  git(['config', 'user.name', 'Q-11 self-test']);
  writeRepoFile('specs/active/selftest.md', SPEC);
  writeRepoFile('src/existing.ts', body('kept', 60));
  writeRepoFile('src/frozen.ts', body('frozen', 60));
  git(['add', '-A']);
  git(['commit', '-m', 'fixture']);
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

describe('assert-spec-diff rewrite rule', () => {
  it('passes when the packet adds a new module and only touches a line or two', () => {
    writeRepoFile('src/newModule.ts', body('fresh', 60));
    writeRepoFile('src/existing.ts', `${body('kept', 60)}export const extra = 1;\n`);
    const { status, output } = runGuard();
    expect(output).toContain('PASS patch_not_rewrite');
    expect(status).toBe(0);
  });

  it('fails when an allowed existing file is rewritten in place', () => {
    writeRepoFile('src/existing.ts', body('rewritten', 60));
    const { status, output } = runGuard();
    expect(output).toContain('FAIL rewrite');
    expect(status).toBe(1);
  });

  it('fails when a frozen application file is touched', () => {
    writeRepoFile('src/existing.ts', `${body('kept', 60)}export const extra = 2;\n`);
    writeRepoFile('src/frozen.ts', `${body('frozen', 60)}export const sneaky = 1;\n`);
    const { status, output } = runGuard();
    expect(output).toContain('FAIL frozen_touched');
    expect(status).toBe(1);
  });
});
