import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Sensor for the review-failures "dispatch:unresolved" repeat
 * (2026-09-24/25, 3x, hint=#5): a coding tool that commits+pushes its own
 * changes leaves a clean worktree; the dispatcher used to read 0 changes and
 * falsely report "did not resolve". Fixed by capturing BASE_HEAD at snapshot
 * and consulting self_committed_changes() in the zero-diff path
 * (scripts/run-coding-dispatch.sh, ~L940-1005). This test wires that fix to
 * a named check so the class cannot silently recur (AGENTS.md L17).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const disp = fs.readFileSync(path.join(ROOT, 'scripts', 'run-coding-dispatch.sh'), 'utf8');

describe('run-coding-dispatch.sh self-commit wiring (dispatch:unresolved sensor)', () => {
  it('captures BASE_HEAD in snapshot_workspace', () => {
    const snap = /snapshot_workspace\(\)\s*\{[\s\S]*?\n\}/.exec(disp)?.[0] || '';
    expect(snap).toMatch(/BASE_HEAD=\$\(git -C "\$CODER_DIR" rev-parse HEAD/);
  });

  it('defines self_committed_changes() comparing HEAD against BASE_HEAD', () => {
    const fn = /self_committed_changes\(\)\s*\{[\s\S]*?\n\}/.exec(disp)?.[0] || '';
    expect(fn).not.toBe('');
    expect(fn).toMatch(/\[ -n "\$\{BASE_HEAD:-\}" \] \|\| return 0/);
    expect(fn).toMatch(/git -C "\$CODER_DIR" rev-parse HEAD/);
    expect(fn).toMatch(/--name-only "\$\{BASE_HEAD\}\.\.\$\{head_now\}"/);
  });

  it('the zero-diff path consults the committed diff before declaring no changes', () => {
    const use = disp.indexOf('committed_files=$(self_committed_changes)');
    const reported = disp.indexOf('No code changes produced by');
    expect(use).toBeGreaterThan(0);
    expect(reported).toBeGreaterThan(0);
    expect(use).toBeLessThan(reported);
    const checkFn = /check_git_and_tsc\(\)\s*\{[\s\S]*?\n\}/.exec(disp)?.[0] || '';
    expect(checkFn).toMatch(/if \[ "\$diff_count" -eq 0 \]; then/);
    expect(checkFn).toMatch(/self_committed=1/);
    expect(checkFn).toMatch(/committed its own changes/);
  });

  it('never lets the self-commit path fall through to the failed "0 changes" verdict', () => {
    const after = disp.slice(disp.indexOf('committed_files=$(self_committed_changes)'));
    const zeroExit = after.indexOf('No code changes produced by');
    const selfBlock = /self_committed=1/.exec(after)?.index ?? -1;
    expect(selfBlock).toBeGreaterThan(-1);
    expect(selfBlock).toBeLessThan(zeroExit);
    expect(after).toMatch(/ticket_fail_and_block "Halted with 0 code changes|Halted with 0 code changes/);
  });
});
