import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ratchet for the 2026-09-25 card #8 stranding: the SHEPHERD builder switched
 * to a journey/card-8 checkpoint branch, the dispatcher pushed that branch
 * verbatim, and auto-pr / ci / claim-guard / auto-merge all watch `agent/**`
 * only — the green fix sat on origin with zero runs and no PR.
 *
 * Both ends of the contract are locked here: the dispatcher must mirror a
 * non-agent branch onto agent/dispatch-<area>, and the workflows must keep
 * watching agent/**.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('dispatch branch scope (agent/** lands, journey/* mirrors)', () => {
  const dispatch = read('scripts/run-coding-dispatch.sh');

  it('dispatcher pushes the coder branch verbatim (history kept)', () => {
    expect(dispatch).toMatch(/push -u origin "\$run_branch"/);
  });

  it('dispatcher mirrors non-agent branches onto agent/dispatch-<area>', () => {
    expect(dispatch).toMatch(/case "\$run_branch" in/);
    expect(dispatch).toMatch(/agent\/\*\) ;;/);
    expect(dispatch).toContain('HEAD:refs/heads/${pr_branch}');
    expect(dispatch).toContain('agent/dispatch-${DISPATCH_AREA}');
    expect(dispatch).toMatch(/mirror push/);
  });

  it('attempt reporting names the mirrored pipeline branch', () => {
    expect(dispatch).toMatch(/run_branch="\$pr_branch"/);
  });

  it('auto-pr still opens PRs for agent/** pushes', () => {
    const autoPr = read('.github/workflows/auto-pr.yml');
    expect(autoPr).toContain("branches: ['agent/**']");
    expect(autoPr).not.toMatch(/branches:.*journey/);
  });

  it('auto-merge still merges agent/** PRs on the same push event', () => {
    const autoMerge = read('.github/workflows/auto-merge.yml');
    expect(autoMerge).toContain("branches: ['agent/**']");
  });
});
