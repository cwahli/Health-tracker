/**
 * The literature lane's recorded vendor shapes, as data.
 *
 * The lane talks to three search APIs, and each `build` in
 * `scripts/lib/health/research.mjs` is a *vendor contract*: the endpoint, the
 * method, where the credential goes, which response field carries a hit. Those
 * contracts change without our code changing, and the first moment a mis-shaped
 * request matters is on a host that finally has a credential — the one moment
 * nobody is watching the log.
 *
 * So the shapes live in `search-providers.json`: one recorded response per
 * documented envelope, plus the answers a real API actually gives (a rate limit,
 * an auth failure, a bot check served as 200 HTML, a quietly renamed field, an
 * empty result set). This module turns them into a `fetch`, and the sensor drives
 * the lane's real entry point against it.
 *
 * Test infrastructure: nothing under `scripts/lib` or `scripts/*.mjs` imports
 * this, and it is never loaded by a bot host.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_FILE = path.join(HERE, 'search-providers.json');

export function loadSearchFixture(file = FIXTURE_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** One recorded response, in the shape `fetch` hands back. */
export function recordedResponse(rec) {
  const text = rec.raw !== undefined ? rec.raw : JSON.stringify(rec.body);
  return {
    ok: rec.status >= 200 && rec.status < 300,
    status: rec.status,
    // A recorded HTML body parses here exactly as a real one does: it throws.
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/**
 * A `fetch` that plays the recording.
 *
 * `cases` names the response per provider id (default `ok`) — that is how one run
 * is given a failing first provider and a healthy second one. `onCall` sees every
 * request, so a caller can judge the shape that actually went out; the command
 * surface uses it to append to a file instead.
 */
export function recordedFetch(spec, { cases = {}, onCall = null } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    if (onCall) onCall({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: String(init.body ?? '') });
    const provider = spec.providers.find((p) => u.includes(p.host));
    if (provider) {
      const rec = provider[cases[provider.id] || 'ok'];
      // A host with no egress is the likeliest failure of all, and it arrives as a
      // thrown error rather than a response: `fetch` itself never returns.
      if (rec.throws) throw new Error(rec.throws);
      return recordedResponse(rec);
    }
    const page = spec.pages.find((p) => p.url === u);
    if (page) return recordedResponse(page);
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'no recorded response for this url' }),
      text: async () => '{"error":"no recorded response for this url"}',
    };
  };
}

/** The requests that went to a vendor host — i.e. the search calls, in order. */
export const vendorCalls = (calls, spec) => calls.filter((c) => spec.providers.some((p) => String(c.url).includes(p.host)));

/** The provider a recorded call went to, by host. */
export const providerOf = (call, spec) => (spec.providers.find((p) => String(call.url).includes(p.host)) || {}).id || '';
