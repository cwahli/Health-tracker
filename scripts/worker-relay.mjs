#!/usr/bin/env node
/**
 * Worker relay: the VM end of the location hand-off.
 *
 * The worker dials outward to this endpoint. There is no inbound address on a
 * phone or a notebook, no Tailscale hop and no tunnel URL.
 *
 *   POST /connect        { host, botId, pid, detail, machine, standin }  register, start presence
 *   POST /heartbeat      { host, machine, standin }      keep presence fresh
 *   GET  /jobs/next?host=<h>&wait=<ms>                long-poll for one job
 *   POST /jobs/result    { jobId, text, code, model, error, ledger, sessionID }
 *   GET  /sessions/<id>/export                        that conversation, for a
 *                                                     worker that has not got it
 *   GET  /sessions/<id>/check                         is it here? (preflight)
 *   PUT  /packs/<id>                                  the sender's changed
 *                                                     files, hashes checked
 *   GET  /packs/<id>                                  that pack, for the worker
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
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  KNOWN_HOSTS,
  recordWorkerConnected,
  workerStatus,
} from './lib/worker-presence.mjs';
import { claimJob, completeJob, pendingCount } from './lib/worker-jobs.mjs';
import { savePack, loadPack, PACK_BODY_MAX } from './lib/swap-pack.mjs';
import {
  SCOPES,
  accessToken,
  appendDocText,
  appendRows,
  createDoc,
  createSheet,
  deleteFile,
  deleteSheet,
  forgetToken,
  getFile,
  getSheet,
  googleReady,
  listChildren,
  redact,
  renameFile,
  serviceAccountFromEnv,
  uploadBinary,
} from './lib/google-store.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};

const PORT = Number(arg('port', process.env.WORKER_RELAY_PORT || 8890));
const BIND = arg('host', process.env.WORKER_RELAY_BIND || '127.0.0.1');
const MAX_BODY = 256 * 1024;
// Direct-route auth: when a token is configured, every route except the
// monitoring /health check requires `Authorization: Bearer <token>`. The relay
// holds session exports and pack contents, so a publicly reachable relay must
// never serve anonymously. Unset keeps the old loopback behavior (with a loud
// warning) so existing single-machine deploys keep working.
const RELAY_TOKEN = String(arg('relay-token', process.env.WORKER_RELAY_TOKEN || ''));
if (!RELAY_TOKEN) console.log('[relay] WARNING: no relay token configured — set WORKER_RELAY_TOKEN before exposing this port');

function authorized(req) {
  if (!RELAY_TOKEN) return true;
  const header = String(req.headers['authorization'] || '');
  const got = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const a = Buffer.from(got);
    const b = Buffer.from(RELAY_TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function send(res, code, payload) {
  const body = JSON.stringify(payload ?? {});
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        // Refuse by name rather than hang: the sender gets a 413 instead of
        // a socket that never answers.
        raw = '';
        req.destroy();
        resolve({ __overflow: true });
      }
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

/**
 * Is that conversation here — without shipping it? `opencode session list` is
 * a local read, so the preflight can answer before a job exists rather than
 * after a worker has claimed it. 404 means "not on this host", 503 means
 * "cannot tell" (opencode missing or its own listing failed).
 */
function checkSession(id, res) {
  execFile('opencode', ['session', 'list'], { timeout: 20000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
    if (err && err.code === 'ENOENT') return send(res, 503, { error: 'opencode is not installed on this host' });
    if (err) return send(res, 503, { error: 'session list failed' });
    const found = String(stdout || '').split('\n').some((line) => line.includes(id));
    if (!found) return send(res, 404, { ok: false, error: 'session not found' });
    return send(res, 200, { ok: true, id });
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

  // Everything past /health needs the bearer token when one is configured.
  // An unauthenticated caller learns nothing: 401 before any routing, any
  // body parsing, any opencode call.
  if (!authorized(req)) {
    return send(res, 401, { error: 'relay token required' });
  }

  // The Google store, on behalf of a location that holds no credential. A phone
  // has no key and never will, so the write happens here and the caller gets a
  // receipt (file id, row range) it can show in chat. The boundary is the same
  // one an external turn gets in-process: the caller sends a *project*, never a
  // folder id, so a caller cannot name a folder this host has not enrolled.
  if (route === 'GET /store/health') {
    const ready = googleReady(process.env);
    return send(res, ready.ready ? 200 : 503, {
      ok: ready.ready,
      relay: os.hostname(),
      pid: process.pid,
      account: ready.email || '',
      reason: redact(ready.reason || ''),
      projects: Object.keys(ready.folders || {}),
    });
  }

  if (route === 'POST /store') {
    const body = await readBody(req);
    if (body?.__overflow) return send(res, 413, { error: `store request exceeds ${MAX_BODY} bytes` });
    const op = String(body?.op || '').trim();
    const project = String(body?.project || '').trim();
    const ready = googleReady(process.env);
    if (!ready.ready) return send(res, 503, { error: `relay has no Google store: ${redact(ready.reason)}`, op, project });
    const folder = (ready.folders || {})[project];
    if (!folder) {
      return send(res, 400, {
        error: `project ${project || '(none)'} has no Google folder enrolled on this relay`,
        op,
        enrolled: Object.keys(ready.folders || {}),
      });
    }
    const tok = await accessToken(serviceAccountFromEnv(process.env), { scopes: Object.values(SCOPES) });
    if (!tok.ok) return send(res, 502, { error: `relay token grant failed: ${redact(tok.error || '')}`, op, project });
    const id = String(body?.id || '').trim();
    const name = String(body?.name || '').trim();
    const out = { ok: true, op, project, folder: `${String(folder).slice(0, 8)}…`, via: `relay:${os.hostname()}`, at: new Date().toISOString() };
    try {
      if (op === 'createPicture') {
        const bytes = Buffer.from(String(body?.base64 || ''), 'base64');
        if (!bytes.length) return send(res, 400, { error: 'createPicture needs base64 bytes', op });
        if (bytes.length > 2 * 1024 * 1024) return send(res, 413, { error: 'picture exceeds 2 MB', op });
        const r = await uploadBinary(folder, name || 'picture.png', bytes, { mimeType: String(body?.mimeType || 'image/png') }, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id: r.id, name: r.file?.name, size: r.file?.size, error: redact(r.error || '') });
      }
      if (op === 'createDoc') {
        const r = await createDoc(folder, name || 'doc', { body: String(body?.text || '') }, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id: r.id, name: r.title, link: r.webViewLink, error: redact(r.error || '') });
      }
      if (op === 'createSheet') {
        const r = await createSheet(name || 'sheet', { tabName: String(body?.tab || 'turn_log') }, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id: r.spreadsheetId, name: r.properties?.title, error: redact(r.error || '') });
      }
      if (op === 'rename') {
        if (!id) return send(res, 400, { error: 'rename needs an id', op });
        const r = await renameFile(id, name, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id, name: r.name, error: redact(r.error || '') });
      }
      if (op === 'appendDoc') {
        if (!id) return send(res, 400, { error: 'appendDoc needs an id', op });
        const r = await appendDocText(id, String(body?.text || ''), tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id, error: redact(r.error || '') });
      }
      if (op === 'appendRows') {
        if (!id) return send(res, 400, { error: 'appendRows needs an id', op });
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (!rows.length) return send(res, 400, { error: 'appendRows needs rows', op });
        const r = await appendRows(id, String(body?.tab || 'turn_log'), rows, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id, range: r.json?.updates?.updatedRange, rows: rows.length, error: redact(r.error || '') });
      }
      if (op === 'delete') {
        if (!id) return send(res, 400, { error: 'delete needs an id', op });
        const kind = String(body?.kind || 'file');
        const r = kind === 'sheet' ? await deleteSheet(id, tok.token) : await deleteFile(id, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, id, kind, error: redact(r.error || '') });
      }
      if (op === 'get') {
        if (!id) return send(res, 400, { error: 'get needs an id', op });
        const r = String(body?.kind || 'file') === 'sheet' ? await getSheet(id, tok.token) : await getFile(id, tok.token);
        return send(res, 200, { ...out, ok: r.ok, id, missing: Boolean(r.missing), name: r.file?.name || r.sheet?.properties?.title, error: redact(r.error || '') });
      }
      if (op === 'list') {
        const r = await listChildren(folder, tok.token);
        return send(res, r.ok ? 200 : 502, { ...out, ok: r.ok, count: r.files?.length || 0, files: (r.files || []).map((f) => ({ id: f.id, name: f.name })), error: redact(r.error || '') });
      }
      return send(res, 400, { error: `unknown store op: ${op || '(none)'}`, ops: ['createPicture', 'createDoc', 'createSheet', 'rename', 'appendDoc', 'appendRows', 'delete', 'get', 'list'] });
    } catch (err) {
      return send(res, 502, { ok: false, op, project, error: redact(err && err.message ? err.message : err) });
    }
  }

  if (route === 'POST /connect') {
    const body = await readBody(req);
    const host = String(body.host || '').trim().toLowerCase();
    if (!host) return send(res, 400, { error: 'host is required' });
    const row = recordWorkerConnected({
      host,
      pid: Number(body.pid) || null,
      detail: String(body.detail || '').slice(0, 200),
      cwd: String(body.cwd || '').slice(0, 400),
      machine: body.machine && typeof body.machine === 'object' ? body.machine : null,
      standin: body.standin === true ? true : body.standin === false ? false : null,
    });
    console.log(`[relay] worker connected: ${host}${row.detail ? ` (${row.detail})` : ''}${row.standin ? ' [stand-in]' : ''}`);
    return send(res, 200, { ok: true, worker: row });
  }

  if (route === 'POST /heartbeat') {
    const body = await readBody(req);
    const host = String(body.host || '').trim().toLowerCase();
    if (!host) return send(res, 400, { error: 'host is required' });
    const row = recordWorkerConnected({ host, pid: Number(body.pid) || null, detail: body.detail || '', cwd: String(body.cwd || '').slice(0, 400), machine: body.machine && typeof body.machine === 'object' ? body.machine : null, standin: body.standin === true ? true : body.standin === false ? false : null });
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

  if (route.startsWith('PUT /packs/')) {
    const id = decodeURIComponent(url.pathname.slice('/packs/'.length));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return send(res, 400, { error: 'bad pack id' });
    const body = await readBody(req, PACK_BODY_MAX);
    if (body?.__overflow) return send(res, 413, { error: `pack exceeds ${PACK_BODY_MAX} bytes` });
    if (body?.id && String(body.id) !== id) return send(res, 400, { error: 'pack id mismatch' });
    const saved = savePack({ ...body, id });
    if (!saved.ok) return send(res, 400, { error: saved.reason });
    console.log(`[relay] pack ${id} stored (${saved.files} file(s), ${saved.bytes} bytes)`);
    return send(res, 200, { ok: true, id, bytes: saved.bytes, files: saved.files });
  }

  if (route.startsWith('GET /packs/')) {
    const id = decodeURIComponent(url.pathname.slice('/packs/'.length));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return send(res, 400, { error: 'bad pack id' });
    const payload = loadPack(id);
    if (!payload) return send(res, 404, { error: 'no such pack' });
    const body = JSON.stringify(payload);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  if (route.startsWith('GET /sessions/')) {
    const rest = decodeURIComponent(url.pathname.slice('/sessions/'.length));
    const wantsCheck = rest.endsWith('/check');
    const id = rest.replace(/\/(check|export)$/, '');
    if (!/^ses_[A-Za-z0-9]{4,80}$/.test(id)) return send(res, 400, { error: 'bad session id' });
    if (wantsCheck) return checkSession(id, res);
    return exportSession(id, res);
  }

  return send(res, 404, { error: 'no such route', route });
});

server.listen(PORT, BIND, () => {
  console.log(`[relay] listening on ${BIND}:${PORT} — workers dial in, the VM dials nothing`);
});
