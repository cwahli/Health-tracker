/**
 * F3 BLOCKER proof: cross-account meal visibility via /api/jobs/*.
 *
 * Regression: every email-signup user's meal jobs were stored with
 * user_id='anonymous' (submit trusted the client body, and email users have
 * no Firebase session so the client always sent 'anonymous'), and
 * GET /api/jobs/status with no userId returned the GLOBAL list — persona B
 * saw persona A's meals.
 *
 * Fixed behavior proven here over real HTTP against the shipped router
 * (in-memory store; D1 explicitly disabled so no live backend is touched):
 *  1. submit derives userId from the verified session token and IGNORES a
 *     spoofed client-supplied userId;
 *  2. B lists → empty (A's jobs invisible); unauthenticated list → 401;
 *  3. foreign byId → 404, identical to missing (no existence oracle).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { signSessionToken, verifyFirebaseIdToken } from './server_auth.js';
import { jobsRouter } from './server_routes_jobs.js';
import {
  inMemoryServerJobs,
  listInMemoryServerJobs,
  isJobOwnedBy,
} from './serverJobs.js';

const UID_A = 'usr_persona_aaa';
const UID_B = 'usr_persona_bbb';
const tokenFor = (uid: string) =>
  signSessionToken({ uid, email: `${uid}@example.com`, nickname: uid });

let app: express.Express;
let server: Server;
let baseUrl = '';

beforeEach(async () => {
  // Force the in-memory job store: never touch live D1 from a unit test
  // (repo .env carries D1 credentials via dotenv/config).
  delete process.env.CLOUDFLARE_D1_DATABASE_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_D1_API_TOKEN;
  inMemoryServerJobs.clear();
  const { recentSubmissionsMap, activeUserJobLocks } = await import('./serverJobs.js');
  recentSubmissionsMap.clear();
  activeUserJobLocks.clear();
  if (!app) {
    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(jobsRouter);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

const authHeaders = (uid: string | null) =>
  uid ? { Authorization: `Bearer ${tokenFor(uid)}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

async function submitAs(uid: string | null, body: any) {
  return fetch(`${baseUrl}/api/jobs/submit`, {
    method: 'POST',
    headers: authHeaders(uid),
    body: JSON.stringify(body),
  });
}

describe('F3 jobs auth: strict session identity', () => {
  it('rejects the old localhost body-uid spoof even on localhost', async () => {
    // No Bearer token, body claims to be persona A — the pre-fix fallback
    // honored this. Strict mode must throw 401 instead.
    await expect(
      verifyFirebaseIdToken(
        { headers: { host: '127.0.0.1:3100' }, body: { userId: UID_A } },
        { allowBodyFallback: false }
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it('honors a valid htk session token and ignores body userId', async () => {
    const identity = await verifyFirebaseIdToken(
      {
        headers: { host: '127.0.0.1:3100', authorization: `Bearer ${tokenFor(UID_A)}` },
        body: { userId: UID_B },
      },
      { allowBodyFallback: false }
    );
    expect(identity.uid).toBe(UID_A);
  });

  it('submit stores the verified uid, ignoring a spoofed client userId', async () => {
    const res = await submitAs(UID_A, {
      jobId: 'job_f3_a1',
      userId: UID_B, // attacker claim: file under B (or pre-fix 'anonymous')
      kind: 'food_log',
      mode: 'review',
      text: 'nasi lemak',
    });
    expect(res.status).toBe(200);
    const stored = inMemoryServerJobs.get('job_f3_a1');
    expect(stored).toBeDefined();
    expect(stored.user_id).toBe(UID_A);
  });

  it('submit without any credential → 401 and stores nothing', async () => {
    const res = await submitAs(null, {
      jobId: 'job_f3_anon',
      userId: 'anonymous',
      kind: 'food_log',
      mode: 'review',
      text: 'mie goreng',
    });
    expect(res.status).toBe(401);
    expect(inMemoryServerJobs.get('job_f3_anon')).toBeUndefined();
  });

  it('B lists → empty; unauthenticated list → 401; A lists → own jobs only', async () => {
    await submitAs(UID_A, { jobId: 'job_f3_a2', kind: 'food_log', mode: 'review', text: 'soto' });
    await submitAs(UID_B, { jobId: 'job_f3_b1', kind: 'food_log', mode: 'review', text: 'rendang' });

    // Persona B must not see A's meal (the reported leak).
    const listB = await fetch(`${baseUrl}/api/jobs/status`, { headers: authHeaders(UID_B) });
    expect(listB.status).toBe(200);
    const jobsB = (await listB.json()).jobs;
    expect(jobsB.map((j: any) => j.id)).toEqual(['job_f3_b1']);

    // No credential → 401, never the global list.
    const listAnon = await fetch(`${baseUrl}/api/jobs/status`);
    expect(listAnon.status).toBe(401);

    // A sees only their own.
    const listA = await fetch(`${baseUrl}/api/jobs/status`, { headers: authHeaders(UID_A) });
    const jobsA = (await listA.json()).jobs;
    expect(jobsA.map((j: any) => j.id)).toEqual(['job_f3_a2']);
  });

  it('foreign byId → 404, same as missing (no existence oracle)', async () => {
    await submitAs(UID_A, { jobId: 'job_f3_a3', kind: 'food_log', mode: 'review', text: 'gado-gado' });

    const foreign = await fetch(`${baseUrl}/api/jobs/status?jobId=job_f3_a3`, {
      headers: authHeaders(UID_B),
    });
    expect(foreign.status).toBe(404);

    const missing = await fetch(`${baseUrl}/api/jobs/status?jobId=job_f3_nope`, {
      headers: authHeaders(UID_B),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(await foreign.json());

    const owner = await fetch(`${baseUrl}/api/jobs/status?jobId=job_f3_a3`, {
      headers: authHeaders(UID_A),
    });
    expect(owner.status).toBe(200);
    expect((await owner.json()).jobs[0].id).toBe('job_f3_a3');

    const unauth = await fetch(`${baseUrl}/api/jobs/status?jobId=job_f3_a3`);
    expect(unauth.status).toBe(401);
  });

  it('store helpers fail closed: no uid → empty; ownership is exact-match', () => {
    inMemoryServerJobs.set('j1', { id: 'j1', user_id: UID_A });
    inMemoryServerJobs.set('j2', { id: 'j2', user_id: UID_B });
    inMemoryServerJobs.set('j3', { id: 'j3', user_id: 'anonymous' });
    expect(listInMemoryServerJobs(undefined)).toEqual([]);
    expect(listInMemoryServerJobs('')).toEqual([]);
    expect(listInMemoryServerJobs(UID_A).map((j: any) => j.id)).toEqual(['j1']);
    expect(isJobOwnedBy({ user_id: UID_A }, UID_A)).toBe(true);
    expect(isJobOwnedBy({ user_id: UID_A }, UID_B)).toBe(false);
    expect(isJobOwnedBy({ user_id: 'anonymous' }, UID_A)).toBe(false);
    expect(isJobOwnedBy(null, UID_A)).toBe(false);
  });
});
