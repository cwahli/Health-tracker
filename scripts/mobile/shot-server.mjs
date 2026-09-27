#!/usr/bin/env node
// Reference server for the screenshot bridge: exposes the phone's own
// screenshots to the VPS over the reverse tunnel that
// start-phone-shot-tunnel.sh dials. Node-only (Termux ships Node; see the
// README in this directory) and loopback-bound -- the only thing that ever
// reaches it is 127.0.0.1:7777 on the VPS.
//
//   SHOT_TOKEN=... ./shot-server.mjs --dir=$HOME/DCIM/Screenshots --port=7788
//
// Why a token exists here: the tunnel lands on a shared box that runs several
// other services and a ttyd shell. Without a credential, anything local on the
// VPS could read every screenshot on the phone -- and screenshots are where
// 2FA codes and one-time passwords land. The token is compared with a
// constant-time-ish length-checked scan; it is a bearer secret over a tunnel,
// not a substitute for one.
//
// Protocol consumed by pull_shot.sh:
//   GET /health                  -> 200 "ok\n"
//   GET /list.tsv?since=&limit=  -> 200 "name\tmtime\tstamp\n" newest first,
//                                    404 when nothing matches (the client reads
//                                    that as "no new screenshots")
//   GET /file/<name>             -> image bytes, or 404
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a) || [];
    return [m[1], m[2] ?? true];
  }),
);

const DIR = path.resolve(String(argv.dir ?? process.env.SHOT_DIR ?? path.join(process.env.HOME, 'DCIM/Screenshots')));
const PORT = Number(argv.port ?? process.env.SHOT_PORT ?? 7788);
const HOST = String(argv.host ?? process.env.SHOT_BIND ?? '127.0.0.1');
const TOKEN = String(argv.token ?? process.env.SHOT_TOKEN ?? '');
const MAX_MB = Number(argv['max-mb'] ?? process.env.SHOT_MAX_MB ?? 64);
const IMG = /\.(png|jpe?g|gif|webp|bmp)$/i;

if (!TOKEN && !argv['allow-anonymous']) {
  console.error('shot-server: no SHOT_TOKEN/--token set. Refusing to serve every screenshot on this');
  console.error('             phone to anything local on the VPS. Set a token, or pass');
  console.error('             --allow-anonymous on purpose (loopback-only bridge, no secrets).');
  process.exit(2);
}

const stamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const okToken = (req) => {
  if (!TOKEN) return true;
  const got = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

const listing = (url) => {
  const since = Number(url.searchParams.get('since') ?? 0);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 500);
  if (!fs.existsSync(DIR)) return '';
  return fs.readdirSync(DIR)
    .filter((n) => IMG.test(n))
    .map((n) => {
      try { return { n, m: Math.floor(fs.statSync(path.join(DIR, n)).mtimeMs / 1000) }; }
      catch { return null; }
    })
    .filter((e) => e && e.m >= since)
    .sort((x, y) => y.m - x.m)
    .slice(0, limit)
    .map((e) => `${e.n}\t${e.m}\t${stamp(e.m * 1000)}`)
    .join('\n');
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const send = (code, body, type = 'text/plain') => {
    res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };
  if (url.pathname === '/health') return send(200, 'ok\n');
  if (!okToken(req)) return send(401, 'unauthorised\n');

  if (url.pathname === '/list.tsv') {
    const body = listing(url);
    return body ? send(200, body + '\n') : send(404, 'none\n');
  }

  if (url.pathname.startsWith('/file/')) {
    // basename(), not join(): the name arrives percent-decoded from a phone
    // filesystem and "../" in it must not be able to leave the screenshots dir.
    const name = path.basename(decodeURIComponent(url.pathname.slice('/file/'.length)));
    const full = path.join(DIR, name);
    if (!IMG.test(name) || !fs.existsSync(full)) return send(404, 'not found\n');
    const size = fs.statSync(full).size;
    if (size > MAX_MB * 1024 * 1024) return send(413, 'too large\n');
    const type = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size });
    return fs.createReadStream(full).pipe(res);
  }

  send(404, 'no route\n');
}).listen(PORT, HOST, function () {
  // Print the REAL bound port: the test harness starts this with --port=0.
  console.log(`shot-server: http://${HOST}:${this.address().port} dir=${DIR} auth=${TOKEN ? 'bearer' : 'OPEN'}`);
});
