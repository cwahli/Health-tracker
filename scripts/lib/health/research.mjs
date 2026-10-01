/**
 * research.mjs — the literature lane: search, fetch, record, and the contract
 * that keeps an unverified link out of document 4.
 *
 * The Research Lead seat owns document 4 ("Medical Insights"), and the seat had
 * rules but no reach: a language model asked for a citation will produce one
 * from memory, with a plausible title, a plausible year and a plausible URL.
 * A citation nobody opened is indistinguishable from a citation that exists, to
 * every reader including the model itself — the same failure as the Doctor's
 * PASS with no receipt, one step earlier in the chain.
 *
 * So the lane is mechanical, and it runs **before** the seat writes:
 *
 *   1. **A declared provider chain.** `SEARCH_PROVIDERS` lists the search APIs
 *      this project may use, in priority order, each with the environment
 *      variables it needs. The chain is data, not code: adding Brave, Tavily or
 *      Google Programmable Search is one entry, and a missing credential is a
 *      named refusal (with the exact variables to set) — never a silent empty
 *      result, because "no hits" and "no way to search" must not look alike.
 *   2. **Fetch before cite.** Every hit is fetched for real, and the fetch is
 *      recorded in `result/health-research.json`: status, byte count, sha256,
 *      fetch time. A hit that could not be fetched is recorded too, marked not
 *      ok — visible, and not citable. "An unverified link is a refusal, not a
 *      link": the record is what makes the difference.
 *   3. **The document-4 contract.** `validateInsightCitations` is
 *      `validateDoctorReport`'s sibling for the literature document: every line
 *      of a doc-4 section must carry a link, every link must be one the log
 *      recorded as fetched, and every citation line must carry a year. The
 *      publisher refuses the section otherwise, with the offending links named.
 *
 * Everything network-facing is injectable (`fetchImpl`, `search`) so the whole
 * lane — search, chain fallback, fetch, record, contract — runs in a sensor with
 * no credential and no network, exactly as the council's model call runs on the
 * `runGemini` seam.
 *
 * Read-only apart from its own log: it never writes to the app, the sheet, or
 * Drive, and it never edits the analysis payload.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { USER_AGENT } from '../google-store.mjs';

/** Where fetched hits are recorded: the only links document 4 may cite. */
export const RESEARCH_LOG = 'health-research.json';
export const MAX_HITS_PER_QUERY = 10;

/**
 * Document 4's analysis sources.
 *
 * The seat owns the whole of "Medical Insights", and every one of its sections
 * is a literature digest — so every one of them is under the citation contract.
 * The sensor pins this list against the doc-4 template, so a template edit that
 * adds a section cannot quietly fall out of the contract.
 */
export const CITATION_SOURCES = [
  'analysis.profile',
  'analysis.by_marker',
  'analysis.contradictions',
  'analysis.not_settled',
];

/**
 * The declared provider chain, in priority order.
 *
 * Two kinds of variable per provider, and the difference matters to readiness:
 * `keys` are the ones that will do *either* — a Brave subscription is the same
 * token under `BRAVE_SEARCH_API_KEY` or the vendor's own `BRAVE_API_KEY` — while
 * `also` are the ones a provider needs *in addition* (Google's key and its
 * search-engine id). Getting this wrong reports a usable host as unusable.
 * Nothing here reads a credential from anywhere but the `env` map it is handed.
 *
 * Each `build` is a vendor contract, not a preference: the endpoint, the method,
 * where the credential goes, and which body field the hits come back in are all
 * pinned against recorded vendor responses in
 * `scripts/fixtures/search-providers.json` — a real host is the worst place to
 * discover that a provider moved its auth from the body to a header.
 */
export const SEARCH_PROVIDERS = [
  {
    id: 'brave',
    label: 'Brave Search API',
    keys: ['BRAVE_SEARCH_API_KEY', 'BRAVE_API_KEY'],
    also: [],
    hint: 'BRAVE_SEARCH_API_KEY (or BRAVE_API_KEY)',
    build: ({ key, query, limit }) => ({
      url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      init: { headers: { Accept: 'application/json', 'X-Subscription-Token': key, 'User-Agent': USER_AGENT } },
    }),
    parse: (json) => (json?.web?.results || []).map((r) => ({ title: r?.title || '', url: r?.url || '', snippet: r?.description || '' })),
  },
  {
    id: 'tavily',
    label: 'Tavily',
    keys: ['TAVILY_API_KEY'],
    also: [],
    hint: 'TAVILY_API_KEY',
    // Tavily's credential is a Bearer header. An earlier shape of this entry
    // sent it as `api_key` in the body, which is what the vendor's *old* SDK did;
    // today's docs and today's SDK send `Authorization: Bearer` and no `api_key`
    // at all. A body credential also ends up in places a header does not (proxy
    // logs, error reports), so this is both the working shape and the safer one.
    build: ({ key, query, limit }) => ({
      url: 'https://api.tavily.com/search',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${key}`, 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
      },
    }),
    parse: (json) => (json?.results || []).map((r) => ({ title: r?.title || '', url: r?.url || '', snippet: r?.content || '' })),
  },
  {
    id: 'google-cse',
    label: 'Google Programmable Search',
    keys: ['GOOGLE_SEARCH_API_KEY'],
    also: ['GOOGLE_SEARCH_CX'],
    hint: 'GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX',
    build: ({ key, cx, query, limit }) => ({
      url: `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&num=${limit}&q=${encodeURIComponent(query)}`,
      init: { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
    }),
    parse: (json) => (json?.items || []).map((r) => ({ title: r?.title || '', url: r?.link || '', snippet: r?.snippet || '' })),
  },
];

const pick = (env, name) => String(env?.[name] ?? '').trim();

/**
 * Which providers this host can actually use.
 *
 * Every entry reports its own variables, present or not, so `/health readiness`
 * can name exactly what to set — the same discipline as the model credential.
 */
export function searchAvailability(env = process.env) {
  const providers = SEARCH_PROVIDERS.map((p) => {
    const keys = p.keys.map((name) => ({ name, present: Boolean(pick(env, name)) }));
    const also = (p.also || []).map((name) => ({ name, present: Boolean(pick(env, name)) }));
    return { id: p.id, label: p.label, hint: p.hint, keys, also, ready: keys.some((k) => k.present) && also.every((k) => k.present) };
  });
  const ready = providers.filter((p) => p.ready).map((p) => p.id);
  // A provider that is usable needs none of its names listed; only the ones that
  // would actually block a provider are reported.
  const missing = [...new Set(providers.filter((p) => !p.ready).flatMap((p) => [...p.keys, ...p.also].filter((k) => !k.present).map((k) => k.name)))];
  return { ok: ready.length > 0, ready, providers, missing };
}

/**
 * Run one query against the declared chain, first ready provider first.
 *
 * A provider that answers with an error, an unparseable body, or no results
 * falls through to the next one; the attempts are returned so a partial answer
 * still says what was tried. Zero hits from a provider that answered is a
 * failure, not an empty result.
 *
 * A 200 is not a promise that the body is the documented one: a bot check, a
 * redirect to a login page, and a quiet field rename all arrive as 200s. Those
 * are named as what they are — the JSON parse error is a JavaScript internal and
 * the raw message can quote the page — so the refusal a user reads says which
 * provider failed and why, in the vendor's terms rather than the parser's.
 */
export async function webSearch({ query, env = process.env, fetchImpl = fetch, limit = MAX_HITS_PER_QUERY, providers = SEARCH_PROVIDERS } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'query', error: 'no query', hits: [], attempts: [] };

  const chain = providers.map((provider) => ({
    provider,
    creds: provider.keys.map((name) => ({ name, value: pick(env, name) })),
    also: (provider.also || []).map((name) => ({ name, value: pick(env, name) })),
  }));
  const ready = chain.filter((c) => c.creds.some((c2) => c2.value) && c.also.every((c2) => c2.value));
  if (!ready.length) {
    const missing = [...new Set(chain.flatMap((c) => [...c.creds, ...c.also].filter((x) => !x.value).map((x) => x.name)))];
    return {
      ok: false,
      reason: 'no-credential',
      error: `no search credential on this host — set one of: ${chain.map((c) => c.provider.hint).join(' / ')}`,
      missing,
      hits: [],
      attempts: [],
    };
  }

  const attempts = [];
  for (const c of ready) {
    const key = (c.creds.find((x) => x.value) || c.creds[0]).value;
    const cx = c.also[0]?.value || '';
    let req;
    try {
      req = c.provider.build({ key, cx, query: q, limit });
    } catch (err) {
      attempts.push({ provider: c.provider.id, error: `could not build the request: ${err.message}` });
      continue;
    }
    try {
      const res = await fetchImpl(req.url, req.init || {});
      if (!res || res.ok !== true) {
        attempts.push({ provider: c.provider.id, error: `HTTP ${res?.status ?? 'no response'}` });
        continue;
      }
      let body;
      try {
        body = await res.json();
      } catch {
        attempts.push({ provider: c.provider.id, error: 'the provider answered with a body that is not JSON (a bot check, or a redirect)' });
        continue;
      }
      let parsed;
      try {
        parsed = c.provider.parse(body);
      } catch {
        attempts.push({ provider: c.provider.id, error: 'the provider answered with a body that is not the documented shape' });
        continue;
      }
      const hits = (Array.isArray(parsed) ? parsed : []).filter((h) => /^https?:\/\//i.test(h?.url)).slice(0, limit);
      if (!hits.length) {
        attempts.push({ provider: c.provider.id, error: 'the provider answered with no results' });
        continue;
      }
      return { ok: true, provider: c.provider.id, query: q, hits, attempts };
    } catch (err) {
      attempts.push({ provider: c.provider.id, error: err.message });
    }
  }
  return {
    ok: false,
    reason: 'failed',
    error: `every declared provider that could run refused the query (${attempts.map((a) => `${a.provider}: ${a.error}`).join('; ')})`,
    hits: [],
    attempts,
  };
}

/** URLs in a line, with the punctuation a sentence supplies stripped back off. */
export function linksIn(text) {
  return [...String(text || '').matchAll(/https?:\/\/[^\s<>()[\]"'`]+/gi)].map((m) => m[0].replace(/[)\].,;:!?'"]+$/, ''));
}

/**
 * Fetch one hit and hash what came back — the receipt a citation rests on.
 *
 * A non-2xx answer, an empty body, or a transport error is recorded as a
 * refusal, with its reason: the log holds the attempts, so "we tried and it did
 * not answer" stays visible and cannot be cited.
 */
export async function fetchHit(hit, { fetchImpl = fetch, now = new Date() } = {}) {
  const url = String(hit?.url || '').trim();
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const base = { url, fetchedAt: at, query: hit?.query || '', snippet: hit?.snippet || '', title: hit?.title || '' };
  if (!/^https?:\/\//i.test(url)) {
    return { ...base, ok: false, status: 0, bytes: 0, sha256: '', error: 'not an http(s) url' };
  }
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' } });
  } catch (err) {
    return { ...base, ok: false, status: 0, bytes: 0, sha256: '', error: err.message };
  }
  if (!res || res.ok !== true) {
    return { ...base, ok: false, status: res?.status || 0, bytes: 0, sha256: '', error: `HTTP ${res?.status ?? 'no response'}` };
  }
  let body = '';
  try {
    body = String(await res.text());
  } catch (err) {
    return { ...base, ok: false, status: res.status || 0, bytes: 0, sha256: '', error: `body could not be read: ${err.message}` };
  }
  const bytes = Buffer.byteLength(body);
  if (!bytes) {
    return { ...base, ok: false, status: res.status || 0, bytes: 0, sha256: '', error: 'the page returned an empty body' };
  }
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || hit?.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    url,
    ok: true,
    status: res.status || 200,
    bytes,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    fetchedAt: at,
    title,
    query: hit?.query || '',
    snippet: hit?.snippet || '',
  };
}

/** The log: `result/health-research.json`, keyed by url, idempotent. */
export function loadResearchLog(file, { readFile = fs.readFileSync } = {}) {
  try {
    const parsed = JSON.parse(readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      return { version: 1, updatedAt: '', queries: [], hits: {}, ...parsed, hits: { ...(parsed.hits || {}) } };
    }
  } catch {
    // No log yet: the lane has not run here, which is a finding, not an error.
  }
  return { version: 1, updatedAt: '', queries: [], hits: {} };
}

/** Fold one run's queries and fetched hits into the log. A re-fetch updates in place. */
export function applyResearch(log, { queries = [], records = [], now = new Date() } = {}) {
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const next = {
    version: 1,
    ...(log || {}),
    hits: { ...((log || {}).hits || {}) },
    queries: [...((log || {}).queries || [])],
  };
  for (const record of records) {
    if (!record?.url) continue;
    const previous = next.hits[record.url] || {};
    next.hits[record.url] = { ...previous, ...record, firstFetchedAt: previous.firstFetchedAt || record.firstFetchedAt || record.fetchedAt || at };
  }
  for (const q of queries) next.queries.push({ ...q, at });
  next.updatedAt = at;
  next.queries = next.queries.slice(-50);
  return next;
}

/**
 * The document-4 citation contract — `validateDoctorReport`'s sibling.
 *
 * Three deterministic rules, and the section is refused (with the offending
 * links named) if any of them fails:
 *
 *   1. **Every line carries a link.** Document 4 is the cited digest; a
 *      literature line with no citation is a claim nobody can check. An empty
 *      section is not a refusal — that is the honest "awaiting the lane" state.
 *   2. **Every link was fetched and recorded.** The log is the only source of
 *      citable links, and only a record with `ok: true` counts. This is the rule
 *      the whole lane exists to enforce: an unverified link is a refusal.
 *   3. **Every citation line carries a year.** "Title, year, link" is the seat's
 *      own shape; a citation with no year cannot be aged, and the monthly
 *      renewal is what keeps the digest honest.
 */
export function validateInsightCitations(lines, { log = null } = {}) {
  const text = Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  const content = text.map((l) => String(l ?? '')).filter((l) => l.trim() !== '');
  if (!content.length) return { ok: true, citations: 0, lines: 0, refused: { uncited: [], unverified: [], undated: [] } };

  const hits = (log && log.hits) || {};
  const uncited = [];
  const unverified = [];
  const undated = [];
  for (const line of content) {
    const links = linksIn(line);
    if (!links.length) {
      uncited.push(line);
      continue;
    }
    for (const link of links) {
      const record = hits[link];
      if (!record || record.ok !== true) unverified.push(link);
    }
    // The year has to be the citation's own, so it is looked for on the line
    // with the links taken out — a slug like `…/khor-2024` is not a publication
    // year, and a rule that accepted it could not age the claim it guards.
    const withoutLinks = links.reduce((acc, link) => acc.split(link).join(' '), line);
    if (!/\b(?:19|20)\d{2}\b/.test(withoutLinks)) undated.push(line);
  }

  const problems = [];
  if (uncited.length) problems.push(`${uncited.length} line(s) carry no citation`);
  if (unverified.length) problems.push(`${unverified.length} link(s) were never fetched and recorded (${[...new Set(unverified)].slice(0, 3).join(', ')})`);
  if (undated.length) problems.push(`${undated.length} citation line(s) carry no year`);
  if (problems.length) {
    return {
      ok: false,
      reason: uncited.length ? 'uncited' : unverified.length ? 'unverified' : 'undated',
      error: `the document-4 citation contract refuses this section: ${problems.join('; ')}`,
      uncited,
      unverified: [...new Set(unverified)],
      undated,
    };
  }
  return { ok: true, citations: content.length, lines: content.length, refused: { uncited: [], unverified: [], undated: [] } };
}

/** The line a refused doc-4 section carries into the published document. */
export function citationRefusalText(verdict) {
  return `_Not published: an unverified link is not a link. ${verdict.error}. Run \`/health research\` — only a hit the log recorded as fetched may be cited._`;
}
