#!/usr/bin/env node
/**
 * Worker relay: the VM end of the location hand-off.
 *
 * The worker dials outward to this endpoint. There is no inbound address on a
 * phone or a notebook, no Tailscale hop and no tunnel URL.
 *
 *   POST /connect        { host, botId, pid, detail }  register, start presence
 *   POST /heartbeat      { host }                      keep presence fresh
 *   GET  /jobs/next?host=<h>&wait=<ms>                long-poll for one job
 *   POST /jobs/result    { jobId, text, code, model, error, ledger, sessionID }
 *   GET  /sessions/<id>/export                        that conversation, for a
 *                                                     worker that has not got it
 *   GET  /health                                       liveness + who is connected
 *
 * The session export is a GET on purpose: conversations run 3.6 KB to 4 MB,
 * and the request-body limit is 256 KB. A worker that cannot fetch one
 * runs a blank conversation and says so in its log.
 *
 * Binds loopback by default. Put it behind the existing Caddy site to reach it
 * from a phone; the worker still dials out, so the VM opens nothing inbound to
 * the device.
 *
 * Usage: node scripts/worker-relay.mjs [--port=8890] [--host=127.0.0.1]
 */
import http from 'node:http';
import os from 'node:os';
import { execFile } from 'node:child_process';
import {
  KNOWN_HOSTS,
  recordWorkerConnected,
  workerStatus,
} from './lib/worker-presence.mjs';
import { claimJob, completeJob, pendingCount } from './lib/worker-jobs.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const PORT = Number(arg('port', process.env.WORKER_RELAY_PORT || 8890));
const BIND = arg('host', process.env.WORKER_RELAY_BIND || '127.0.0.1');
const MAX_BODY = 256 * 1024;

function send(res, code, payload) {
  const body = JSON.stringify(payload ?? {});
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * One conversation, exported for a worker that has not got it. This is the
 * only route that answers with a body larger than MAX_BODY, and it is a
 * response, not a request: the limit above guards what a device can POST.
 */
function exportSession(id, res) {
  execFile('opencode', ['export', id], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
    if (err && err.code === 'ENOENT') {
      return send(res, 503, { error: 'opencode is not installed on this host' });
    }
    if (err) return send(res, 404, { error: 'session not found' });
    const body = String(stdout || '');
    if (!body.trim().startsWith('{')) return send(res, 502, { error: 'opencode export produced no session' });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /health') {
    return send(res, 200, {
      ok: true,
      pid: process.pid,
      host: os.hostname(),
      pending: pendingCount(),
      workers: KNOWN_HOSTS.map((h) => ({ host: h, ...workerStatus(h) })),
    });
  }

  if (route === 'POST /connect') {
    const body = await readBody(req);
    const host = String(body.host || '').trim().toLowerCase();
    if (!host) return send(res, 400, { error: 'host is required' });
    const row = recordWorkerConnected({
      host,
      pid: Number(body.pid) || null,
      detail: String(body.detail || '').slice(0, 200),
    });
    console.log(`[relay] worker connected: ${host}${row.detail ? ` (${row.detail})` : ''}`);
    return send(res, 200, { ok: true, worker: row });
  }

  if (route === 'POST /heartbeat') {
    const body = await readBody(req);
    const host = String(body.host || '').trim().toLowerCase();
    if (!host) return send(res, 400, { error: 'host is required' });
    const row = recordWorkerConnected({ host, pid: Number(body.pid) || null, detail: body.detail || '' });
    return send(res, 200, { ok: true, lastSeen: row.lastSeen });
  }

  if (route === 'GET /jobs/next') {
    const host = String(url.searchParams.get('host') || '').trim().toLowerCase();
    const wait = Math.min(60000, Math.max(0, Number(url.searchParams.get('wait') || 0)));
    const deadline = Date.now() + wait;
    for (;;) {
      const job = claimJob(host);
      if (job) {
        console.log(`[relay] handed ${job.id} to ${host || 'any worker'} (${job.model || 'default model'})`);
        return send(res, 200, { job });
      }
      if (Date.now() >= deadline) return send(res, 204, {});
      await new Promise((r) => setTimeout(r, 750));
    }
  }

  if (route === 'POST /jobs/result') {
    const body = await readBody(req);
    const job = completeJob(body.jobId, body);
    if (!job) return send(res, 404, { error: 'unknown job' });
    console.log(`[relay] ${job.id} finished on ${job.host} (code ${job.result?.code ?? '?'})`);
    return send(res, 200, { ok: true, jobId: job.id });
  }

  if (route.startsWith('GET /sessions/')) {
    const id = decodeURIComponent(url.pathname.slice('/sessions/'.length)).replace(/\/export$/, '');
    if (!/^ses_[A-Za-z0-9]{4,80}$/.test(id)) return send(res, 400, { error: 'bad session id' });
    return exportSession(id, res);
  }

  return send(res, 404, { error: 'no such route', route });
});

server.listen(PORT, BIND, () => {
  console.log(`[relay] listening on ${BIND}:${PORT} — workers dial in, the VM dials nothing`);
});
