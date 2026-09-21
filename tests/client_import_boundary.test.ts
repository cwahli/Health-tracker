import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * L17 sensor for the 2026-09-21 blank-app regression.
 *
 * `src/utils/debugLogRetention.ts` was reachable from `src/main.tsx` and started
 * statically importing `server_d1.js` (D-2 commit 2046231). That pulled
 * `dotenv/config` into the browser bundle, and the app died on boot with
 * `ReferenceError: process is not defined`.
 *
 * This walks the *client* import graph from `src/main.tsx` and fails if any
 * server-only package becomes reachable. It is the deterministic sensor for the
 * class "server-only import leaks into the client bundle".
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'src/main.tsx');

const SERVER_ONLY = [
  'dotenv',
  'dotenv/config',
  '@aws-sdk',
  'firebase-admin',
  'sharp',
  'express',
  'yargs',
  'pg',
];

function isServerOnly(spec: string): boolean {
  return SERVER_ONLY.some((s) => spec === s || spec.startsWith(`${s}/`) || spec.startsWith(s));
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const noJs = base.replace(/\.(js|mjs|cjs)$/, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${noJs}.ts`,
    `${noJs}.tsx`,
    `${noJs}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* not a file */
    }
  }
  return null;
}

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const specs = new Set<string>();
  let m: RegExpExecArray | null;

  // line-anchored static imports/exports (no greedy cross-line matching)
  const reStatic = /^\s*(?:import|export)\s+(?:type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/gm;
  while ((m = reStatic.exec(src))) {
    if (/^\s*(?:import|export)\s+type\s/.test(m[0])) continue;
    specs.add(m[1]);
  }
  const reSideEffect = /^\s*import\s*['"]([^'"]+)['"]/gm;
  while ((m = reSideEffect.exec(src))) specs.add(m[1]);
  const reDynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reDynamic.exec(src))) specs.add(m[1]);

  return [...specs];
}

describe('client bundle boundary (L17)', () => {
  it('no server-only package is reachable from src/main.tsx', () => {
    const visited = new Set<string>();
    const queue = [ENTRY];
    visited.add(ENTRY);
    const leaks: string[] = [];

    while (queue.length > 0) {
      const file = queue.shift()!;
      for (const spec of importsOf(file)) {
        if (isServerOnly(spec)) {
          leaks.push(`${spec}  <--  ${path.relative(ROOT, file)}`);
          continue;
        }
        const next = resolveRelative(file, spec);
        if (next && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    expect(leaks, `server-only imports reachable from the client:\n${leaks.join('\n')}`).toEqual([]);
  });
});
