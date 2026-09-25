import { describe, it, expect, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUGCTL = path.join(HERE, '..', 'scripts', 'bugctl.mjs');

let dir;
let queuePath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugctlq-'));
  queuePath = path.join(dir, 'queue.jsonl');
});

/** A port nothing listens on (offline API). */
async function closedPort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function runBugctl(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BUGCTL, ...args],
      {
        env: { ...process.env, BUGCTL_QUEUE: queuePath, BUG_API_BASE: 'http://127.0.0.1:1', ...env },
        timeout: 20000,
      },
      (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function queueRows() {
  if (!fs.existsSync(queuePath)) return [];
  return fs.readFileSync(queuePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Stub bug API that records requests and answers { ok: true }. */
function stubApi(response = { ok: true }) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, port: srv.address().port }));
  });
}

describe('offline queue (sess-ticket-resume)', () => {
  it('queues create when the API is unreachable and exits 0', async () => {
    const port = await closedPort();
    const r = await runBugctl(['create', '--title', 'Offline card', '--json'], {
      BUG_API_BASE: `http://127.0.0.1:${port}`,
    });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.queued).toBe(true);
    const rows = queueRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ op: 'create', title: 'Offline card' });
    expect(rows[0].queued_at).toBeTruthy();
  });

  it('flush replays queued rows and empties the queue', async () => {
    const dead = await closedPort();
    await runBugctl(['create', '--title', 'Replay me', '--json'], { BUG_API_BASE: `http://127.0.0.1:${dead}` });
    expect(queueRows().length).toBe(1);

    const { srv, seen, port } = await stubApi();
    try {
      const r = await runBugctl(['flush', '--json'], { BUG_API_BASE: `http://127.0.0.1:${port}` });
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out).toMatchObject({ message: 'flush done', sent: 1, failed: 0, remaining: 0 });
      expect(seen.length).toBe(1);
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/bugs' });
      expect(JSON.parse(seen[0].body).title).toBe('Replay me');
      expect(queueRows()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it('flush keeps un-sendable rows and exits 1', async () => {
    const dead = await closedPort();
    await runBugctl(['create', '--title', 'Stays queued', '--json'], { BUG_API_BASE: `http://127.0.0.1:${dead}` });
    const r = await runBugctl(['flush', '--json'], { BUG_API_BASE: `http://127.0.0.1:${dead}` });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(queueRows().length).toBe(1);
  });

  it('flush drops corrupt lines, sends the valid, and reports both', async () => {
    fs.writeFileSync(queuePath, 'not json\n');
    const dead = await closedPort();
    await runBugctl(['create', '--title', 'Good row', '--json'], { BUG_API_BASE: `http://127.0.0.1:${dead}` });
    const { srv, port } = await stubApi();
    try {
      const r = await runBugctl(['flush', '--json'], { BUG_API_BASE: `http://127.0.0.1:${port}` });
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stdout)).toMatchObject({ sent: 1, failed: 1, remaining: 0 });
      expect(queueRows()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  it('flush on a missing queue reports empty', async () => {
    const r = await runBugctl(['flush', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).message).toBe('queue empty');
  });

  it('queues steward curation without flattening its operation payload', async () => {
    const dead = await closedPort();
    const r = await runBugctl(['curate', '--id', '7', '--op', 'edit', '--expected-revision', '0', '--reason', 'clarify', '--json'], { BUG_API_BASE: `http://127.0.0.1:${dead}` });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).queued).toBe(true);
    expect(queueRows()[0]).toMatchObject({ op: 'curate', id: '7', payload: { op: 'edit', expected_revision: 0, reason: 'clarify' } });
  });

  it('list reads the canonical all-card endpoint', async () => {
    const { srv, seen, port } = await stubApi({
      ok: true,
      source: 'canonical-bug-list',
      count: 1,
      rows: [{ public_n: 7, title: 'one card' }],
    });
    try {
      const r = await runBugctl(['list', '--json'], { BUG_API_BASE: `http://127.0.0.1:${port}` });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ source: 'canonical-bug-list', count: 1 });
      expect(seen[0].url).toMatch(/^\/api\/bugs\/list\??$/);
    } finally {
      srv.close();
    }
  });

  it('curate and handoff send revisioned steward operations', async () => {
    const { srv, seen, port } = await stubApi({
      ok: true,
      tag_id: 'tag_7',
      state: 'packed',
      receipt: { op: 'handoff', from_revision: 1, to_revision: 2 },
      work_item: { revision: 2 },
    });
    try {
      const edit = await runBugctl(['curate', '--id', '7', '--op', 'edit', '--expected-revision', '1', '--reason', 'clarify scope', '--json'], { BUG_API_BASE: `http://127.0.0.1:${port}` });
      expect(edit.code).toBe(0);
      expect(JSON.parse(seen[0].body)).toMatchObject({ op: 'edit', expected_revision: 1, reason: 'clarify scope' });
      const handoff = await runBugctl(['handoff', '--id', '7', '--expected-revision', '2', '--reason', 'ready for orchestrator', '--json'], { BUG_API_BASE: `http://127.0.0.1:${port}` });
      expect(handoff.code).toBe(0);
      expect(JSON.parse(seen[1].body)).toMatchObject({ op: 'handoff', assignee: 'orchestrator', expected_revision: 2 });
    } finally {
      srv.close();
    }
  });

  it('prints text packet bodies and preserves JSON packet output', async () => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      seen.push(req.url);
      if (req.url?.includes('format=text')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('# Bug 8\nTitle: Text packet');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ public_n: 8, title: 'JSON packet' }));
    });
    const port = await new Promise((resolve) => {
      srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
    });
    try {
      const env = { BUG_API_BASE: `http://127.0.0.1:${port}` };
      const text = await runBugctl(['packet', '--id', '8', '--format', 'text'], env);
      expect(text.code).toBe(0);
      expect(text.stdout.split('\n')[0]).toBe('# Bug 8');
      expect(text.stdout).not.toContain('HTTP 200');
      const json = await runBugctl(['packet', '--id', '8', '--json'], env);
      expect(json.code).toBe(0);
      expect(JSON.parse(json.stdout)).toEqual({ public_n: 8, title: 'JSON packet' });
      expect(seen).toEqual(['/api/bugs/8/packet?format=text', '/api/bugs/8/packet']);
    } finally {
      srv.close();
    }
  });
});
