import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// STALE_CHUNK sensor (2026-11-06): the 2026-11-05 deploy 404'd new hashed chunks
// mid-build and the Cloudflare edge cached the misses, breaking HomeTab on fresh
// profiles (yellow "network update" loop, even in incognito). A missing
// /assets/* response must carry no-store on every cache layer so no edge or
// browser can pin it, and the deploy must stage the web build outside the live
// dist/ (vite empties its outDir first).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assets404Block(src: string): string {
  const start = src.indexOf("app.use('/assets'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('});', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('stale-chunk guard', () => {
  it('/assets 404 is no-store (browser, shared, and Cloudflare layers)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
    const block = assets404Block(src);
    expect(block).toMatch(/status\(404\)/);
    expect(block).toMatch(/no-store/);
    expect(block).toMatch(/Cloudflare-CDN-Cache-Control/);
  });

  it('deploy stages the web build outside the live dist/', () => {
    const deploy = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-prod.sh'), 'utf8');
    expect(deploy).toMatch(/--outDir dist\.next/);
    // The live dist/ must never be vite's direct outDir (vite empties it first,
    // which is the 404 window the edge cached).
    for (const line of deploy.split('\n')) {
      const t = line.trim();
      if (t.startsWith('#') || t === '') continue;
      expect(t).not.toMatch(/^npx vite build\s*$/);
      expect(t).not.toMatch(/^vite build\s*$/);
    }
  });
});
