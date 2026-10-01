/**
 * A `node --import` stand-in for `fetch`, so a *command* can be driven against
 * the recorded vendor shapes.
 *
 * The lane takes its transport as an argument (`fetchImpl`), which is how the
 * sensor drives it in-process. The command surface is a different thing: the CLI
 * and `/health research` build their own runner, in their own process, with the
 * global `fetch`. Patching that global is how this file gives them recorded
 * answers with no credential, no network, and **no test-only seam in the shipped
 * code** — the alternative would be a production env var that exists only for
 * tests, which is a worse trade.
 *
 *   SEARCH_FIXTURE=<fixture json> SEARCH_CALLS=<append file> SEARCH_CASES='{}' \
 *     node --import scripts/fixtures/search-provider-shim.mjs scripts/health-runner.mjs \
 *       --research --query="..."
 *
 * Every request it serves is appended to `SEARCH_CALLS` as one JSON object per
 * line, so the caller can pin the shape that went out (endpoint, method, headers,
 * body) rather than trusting the reply.
 */
import fs from 'node:fs';

import { loadSearchFixture, recordedFetch } from './search-providers.mjs';

const spec = loadSearchFixture(process.env.SEARCH_FIXTURE || undefined);
const callsFile = String(process.env.SEARCH_CALLS || '');
const cases = JSON.parse(process.env.SEARCH_CASES || '{}');

globalThis.fetch = recordedFetch(spec, {
  cases,
  onCall: (call) => {
    if (callsFile) fs.appendFileSync(callsFile, `${JSON.stringify(call)}\n`);
  },
});
