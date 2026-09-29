/**
 * github-rest.mjs — the one REST client the merge path talks to GitHub with.
 *
 * Extracted from `scripts/auto-merge.mjs` when a second caller appeared: the
 * notice that reports a red `main` (`scripts/notify-main-red.mjs`) runs as its
 * own workflow step and needs the same client. A second copy of it would be a
 * second set of headers, error shapes and API-version pins to drift, and this
 * repository already pays for that mistake elsewhere.
 *
 * The client is deliberately tiny and deliberately complete about failures: a
 * non-2xx becomes an Error carrying the status and the body, because every
 * caller here has to decide what a failure MEANS (refuse the merge, or report
 * that the notice could not be filed) and none of them may read "the call
 * failed" as "the answer was no". `apiBase` is an injected seam so the sensors
 * can point this at a loopback fake.
 */

/**
 * @param {object}   opts
 * @param {string}   opts.token      a token with the permissions the caller needs
 * @param {string}   opts.apiBase    defaults to the public API; `GITHUB_API_URL`
 *                                   in Actions, a fake in the sensors
 * @param {Function} opts.fetchImpl  the seam the sensors use
 */
export function makeClient({ token, apiBase, fetchImpl = globalThis.fetch } = {}) {
  const base = String(apiBase || 'https://api.github.com').replace(/\/$/, '');
  return {
    base,
    async call(pathname, { method = 'GET', body } = {}) {
      const res = await fetchImpl(`${base}${pathname}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'health-tracker-auto-merge',
          'x-github-api-version': '2022-11-28',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const detail = json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
        const err = new Error(`${method} ${pathname} -> HTTP ${res.status} ${detail}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return json;
    },
  };
}
