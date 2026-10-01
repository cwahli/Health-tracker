/**
 * The hand-run probe behind `search-provider-probe.json`.
 *
 * The lane's three provider requests are vendor contracts, and the recordings in
 * `search-providers.json` pin them — but a recording is only as good as the
 * moment it was taken. This script takes that moment *on the wire*: it builds
 * each declared request with the lane's own `SEARCH_PROVIDERS[].build` and sends
 * it to the real host with a well-formed but deliberately invalid credential, so
 * what comes back is the vendor's answer to exactly the bytes the lane sends.
 *
 * It is run **by hand**, never by a sensor and never by CI: no test imports this
 * file, and nothing under `scripts/lib` or `scripts/*.mjs` does either. It
 * refuses to be useful without a network and it is not part of a gate. Its
 * output is merged into `search-provider-probe.json`; re-run it before trusting
 * that file after a vendor or a `build` changes.
 *
 *   node scripts/fixtures/search-provider-probe.mjs              # transcript
 *   node scripts/fixtures/search-provider-probe.mjs --json out.json
 *
 * The controls are hand-built on purpose: each one changes exactly one thing
 * about the declared request (drop the credential header, move it into the body,
 * move the path) so the answer tells you which of the two — the credential
 * placement or the route — the vendor is reacting to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_HITS_PER_QUERY, SEARCH_PROVIDERS } from '../lib/health/research.mjs';
import { loadSearchFixture } from './search-providers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY_CAP = 1200;

/** A well-formed value that is not a credential: every rejection is the vendor's. */
const BOGUS = 'probe-not-a-credential-0000';
const TIMEOUT_MS = 15000;

const spec = loadSearchFixture(path.join(HERE, 'search-providers.json'));

function record(request, sentBy, label, response, ms) {
  const trimmed = response.body.length > BODY_CAP;
  return {
    label,
    sentBy,
    request: {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: String(request.body ?? ''),
    },
    response: {
      status: response.status,
      contentType: response.contentType,
      body: trimmed ? `${response.body.slice(0, BODY_CAP)}… [${response.body.length - BODY_CAP} bytes withheld]` : response.body,
      ...(trimmed ? { truncated: true } : {}),
    },
    ms,
  };
}

async function send(request, sentBy, label) {
  const started = Date.now();
  const response = { status: 0, contentType: '', body: '' };
  try {
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body ? { body: request.body } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    response.status = res.status;
    response.contentType = res.headers.get('content-type') || '';
    response.body = await res.text();
  } catch (err) {
    response.body = `REQUEST FAILED: ${err.message}`;
  }
  const rec = record(request, sentBy, label, response, Date.now() - started);
  console.log(`\n=== ${label}`);
  console.log(`  ${rec.request.method} ${rec.request.url}`);
  console.log(`  sent headers: ${JSON.stringify(rec.request.headers)}`);
  if (rec.request.body) console.log(`  sent body:    ${rec.request.body}`);
  console.log(`  -> HTTP ${rec.response.status} ${rec.response.contentType} (${rec.response.body.length} bytes read)`);
  console.log(`  body: ${rec.response.body.replace(/\s+/g, ' ').slice(0, 300)}`);
  return rec;
}

const declaredBy = (provider, overrides = {}) => {
  const { url, init } = provider.build({ key: BOGUS, cx: BOGUS, query: spec.query, limit: MAX_HITS_PER_QUERY, ...overrides });
  return { url, init, method: init.method || 'GET' };
};

const declaredRequest = (provider) => {
  const { url, init, method } = declaredBy(provider);
  return { method, url, headers: init.headers, body: init.body ?? '' };
};

const out = { observedAt: new Date().toISOString(), platform: `${process.platform} node ${process.version}`, credential: BOGUS, providers: [] };

for (const provider of spec.providers) {
  const declared = SEARCH_PROVIDERS.find((p) => p.id === provider.id);
  const entry = { id: provider.id, doc: provider.doc, probes: [] };

  // The lane's own bytes, on the vendor's wire.
  entry.probes.push(await send(declaredRequest(declared), 'SEARCH_PROVIDERS.build', 'declared request, invalid credential'));

  if (provider.id === 'brave') {
    const { url, init } = declaredBy(declared);
    const headers = { ...init.headers };
    delete headers['X-Subscription-Token'];
    entry.probes.push(await send({ method: 'GET', url, headers }, 'hand', 'control: declared path, credential header removed'));
    entry.probes.push(
      await send({ method: 'GET', url: url.replace('/web/search?', '/web/searchX?'), headers: init.headers }, 'hand', 'control: path that does not exist, declared header kept'),
    );
  }

  if (provider.id === 'tavily') {
    const { url, init } = declaredBy(declared);
    const body = JSON.parse(init.body);
    entry.probes.push(
      await send({ method: init.method, url, headers: { 'Content-Type': 'application/json', 'User-Agent': init.headers['User-Agent'] }, body: JSON.stringify({ api_key: BOGUS, ...body }) }, 'hand', 'control: declared path, credential in the body (the shape this lane used to send)'),
    );
    entry.probes.push(await send({ method: init.method, url: `${url}X`, headers: init.headers, body: init.body }, 'hand', 'control: path that does not exist, Bearer kept'));
  }

  if (provider.id === 'google-cse') {
    const { url, init } = declaredBy(declared);
    const withoutKey = url.replace(`key=${encodeURIComponent(BOGUS)}&`, '');
    entry.probes.push(await send({ method: 'GET', url: withoutKey, headers: init.headers }, 'hand', 'control: declared path, no key at all'));
    entry.probes.push(
      await send({ method: 'GET', url: withoutKey, headers: { ...init.headers, 'X-Goog-Api-Key': BOGUS } }, 'hand', 'control: declared path, key in a header instead of the query'),
    );
    entry.probes.push(
      await send({ method: 'GET', url: url.replace(`num=${MAX_HITS_PER_QUERY}`, 'num=25'), headers: init.headers }, 'hand', 'control: declared path, num above the documented maximum, invalid key'),
    );
    entry.probes.push(await send({ method: 'GET', url: url.replace('/customsearch/v1?', '/customsearch/v1x?'), headers: init.headers }, 'hand', 'control: path that does not exist'));
  }

  out.providers.push(entry);
}

const jsonAt = process.argv.indexOf('--json');
const outFile = jsonAt === -1 ? '' : process.argv[jsonAt + 1] || '';
if (outFile) {
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${outFile}`);
}
console.log(`\n\n=== JSON ===\n${JSON.stringify(out, null, 1)}`);
