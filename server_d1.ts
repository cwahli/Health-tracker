/**
 * Cloudflare D1 HTTP API (Cloud Run has no native D1 binding).
 * Used for tiny golden_cases metadata. Logs stay on R2.
 */
import 'dotenv/config';
import { notifyIssueTagsWrite } from './serverIssueTagEvents';

function cfg() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const databaseId = (process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_D1_API_TOKEN || '').trim();
  return { accountId, databaseId, token };
}

export function isD1Configured(): boolean {
  const { accountId, databaseId, token } = cfg();
  return Boolean(accountId && databaseId && token);
}

export type D1QueryResult<T = any> = {
  success: boolean;
  results: T[];
  meta?: any;
  error?: string;
};

export async function d1Query<T = any>(sql: string, params: any[] = []): Promise<D1QueryResult<T>> {
  const { accountId, databaseId, token } = cfg();
  if (!accountId || !databaseId || !token) {
    return { success: false, results: [], error: 'D1 env missing (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN)' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const json: any = await res.json().catch(() => ({}));
  // A write against issue_tags changes what every bug-card reader should
  // return, so it fires the shared signal here rather than at each of the two
  // dozen call sites. Listeners must not be able to fail this write, so this
  // happens after the response is parsed and is wrapped by the callee.
  if (res.ok && json.success !== false) {
    notifyIssueTagsWrite(sql, params);
  }
  if (!res.ok || json.success === false) {
    const err =
      json?.errors?.[0]?.message ||
      json?.error ||
      json?.messages?.[0] ||
      `D1 HTTP ${res.status}`;
    return { success: false, results: [], error: String(err) };
  }
  const batch = Array.isArray(json.result) ? json.result[0] : json.result;
  return {
    success: true,
    results: (batch?.results || []) as T[],
    meta: batch?.meta,
  };
}

export async function d1Exec(sql: string): Promise<D1QueryResult<any>> {
  return d1Query(sql, []);
}

export function safeJsonParse<T = any>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}
