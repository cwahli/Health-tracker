#!/usr/bin/env node
/**
 * proto-deploy — build the current checkout and serve it as the proto
 * preview. This is the ONLY dev-side preview step in the proto-first flow
 * (docs/agent/PROTO_FIRST.md). It never touches the dev deploy
 * (/home/ubuntu/deploy/Health-tracker, systemd health-tracker on :3000)
 * and never merges or pushes to main.
 *
 * What it does:
 *   1. git rev-parse HEAD  (the SHA printed as the proto version)
 *   2. npm run build:web   (Vite build — proves the web bundle compiles)
 *   3. serve dist/ on 127.0.0.1:3100 under /ht/ via a tiny static server
 *   4. curl health (HTTP 200 + <title> contains the built HTML)
 *      and print the proto URL the human should open.
 *
 * Usage:
 *   node scripts/proto-deploy.mjs [--port 3100] [--no-serve]
 *   node scripts/proto-deploy.mjs --help
 *
 * On the VPS, the same dist/ is the ht-proto-preview systemd unit
 * (scripts/proto/ht-proto-preview.service); Caddy proxies
 * proto.health-tracker.co.uk/ht/* → 127.0.0.1:3100
 * (scripts/proto/caddy-ht.snippet). This script is the local form of
 * that preview — CI only checks that it exists and prints the URL shape.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/proto-deploy.mjs [--port 3100] [--no-serve]');
  process.exit(0);
}
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? Number(args[portIdx + 1] || 3100) : 3100;
const noServe = args.includes('--no-serve');

const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
let sha = 'unknown-sha';
try { sha = git(['rev-parse', 'HEAD']); } catch { /* detached dir: keep unknown */ }
const short = sha.slice(0, 12);
console.log(`proto-deploy: SHA ${sha}`);

// 2. Build (fail closed: a build failure is a proto failure, not a pass).
console.log('proto-deploy: building web bundle…');
try {
  execFileSync('npm', ['run', 'build:web'], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
} catch (e) {
  console.error('proto-deploy: build failed — do not claim proto proof. See the build log above.');
  process.exit(1);
}

const dist = join(ROOT, 'dist');
if (!existsSync(dist)) {
  console.error('proto-deploy: no dist/ after build — nothing to serve.');
  process.exit(1);
}

// 3+4. Serve + health. The /ht/ prefix is the Caddy contract on the VPS:
// the browser sees https://proto.health-tracker.co.uk/ht/<sha>/ while the
// local server answers at http://127.0.0.1:<port>/ht/<sha>/.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const serveFile = (res, abs) => {
  const data = readFileSync(abs);
  res.writeHead(200, {
    'Content-Type': MIME[extname(abs)] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=300',
  });
  res.end(data);
};
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const prefix = `/ht/${short}/`;
  const base = `/ht/${short}/`;
  if (url.pathname === '/health' || url.pathname === '/health/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, sha, at: new Date().toISOString() }));
  }
  if (!url.pathname.startsWith('/ht/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('proto preview lives under /ht/<sha>/');
  }
  // Strip the /ht/<sha>/ prefix; fall back to index.html for SPA routes.
  let rel = url.pathname.replace(/^\/ht\/[^/]+\//, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  let abs = join(dist, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) abs = join(dist, 'index.html');
  if (!existsSync(abs)) { res.writeHead(404); return res.end('no index.html'); }
  return serveFile(res, abs);
});

const urlLocal = `http://127.0.0.1:${PORT}/ht/${short}/`;
const urlPublic = `https://proto.health-tracker.co.uk/ht/${short}/`;
if (noServe) {
  console.log(`Proto (build only): dist/ is at ${dist}`);
  console.log(`Proto: ${urlPublic}`);
  process.exit(0);
}
server.listen(PORT, '127.0.0.1', async () => {
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());
    const html = await fetch(urlLocal).then((r) => r.text());
    const ok = health.ok === true && /<title/i.test(html);
    console.log(ok ? 'proto-deploy: OK' : 'proto-deploy: HEALTH FAILED');
    console.log(`Proto: ${urlPublic}`);
    console.log(`Proto (local): ${urlLocal}`);
    if (!ok) process.exit(1);
  } catch (e) {
    console.error('proto-deploy: health check threw', e.message);
    server.close(() => process.exit(1));
    return;
  }
  console.log('proto-deploy: serving (Ctrl-C to stop).');
});
