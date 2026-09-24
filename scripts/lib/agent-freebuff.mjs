import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FREEBUFF_API_BASE = process.env.FREEBUFF_API_BASE || 'https://www.codebuff.com';
export const FREEBUFF_AGENT_ID = 'base3-free-glm-5-3-flash';
export const FREEBUFF_CHAT_MODEL = 'z-ai/glm-5.3-flash';
const DEFAULT_TIMEOUT_MS = 120000;

function defaultCredentialsPath() {
  return process.env.FREEBUFF_CREDENTIALS_PATH || path.join(os.homedir(), '.config', 'manicode', 'credentials.json');
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fail(lastError, code = -1) {
  return {
    code,
    sessionID: null,
    finalText: '',
    lastError: String(lastError || 'Freebuff request failed'),
    stderr: '',
    usage: { cost: 0, tokens: null },
  };
}

function responseText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function mapFreebuffError({ status, body, message } = {}) {
  const text = [responseText(body), message].filter(Boolean).join(' ').slice(0, 500);
  const code = Number(status) || 0;
  if (code === 401 || code === 403 || /auth|unauthorized|permission denied/i.test(text)) {
    return `Freebuff credentials were rejected (auth failed)${text ? ` (${text.slice(0, 200)})` : ''}.`;
  }
  if (code === 402 || /payment required|freebucks|quota|credit|insufficient/i.test(text)) {
    return `Freebuff free allowance is empty or unavailable${text ? ` (${text.slice(0, 200)})` : ''}.`;
  }
  if (code === 429 || /rate.?limit|too many requests|temporarily unavailable/i.test(text)) {
    return `Freebuff rate limit reached${text ? ` (${text.slice(0, 200)})` : ''}.`;
  }
  if (code === 409 || /session.*busy|takeover|already active/i.test(text)) {
    return `Freebuff session is already active${text ? ` (${text.slice(0, 200)})` : ''}.`;
  }
  if (/country|anonymous_network|blocked|model.*unavailable|not found/i.test(text)) {
    return `Freebuff cannot serve this request in the current region or model state${text ? ` (${text.slice(0, 200)})` : ''}.`;
  }
  return text ? `Freebuff error: ${text.slice(0, 200)}` : 'Freebuff error: unknown error';
}

export function resolveFreebuffCredentials({ env = process.env, readFile = fs.readFileSync } = {}) {
  const token = String(env.FREEBUFF_AUTH_TOKEN || '').trim();
  const userId = String(env.FREEBUFF_USER_ID || '').trim();
  if (token && userId) return { authToken: token, actingUserId: userId };
  const file = env.FREEBUFF_CREDENTIALS_PATH || defaultCredentialsPath();
  let parsed;
  try {
    parsed = JSON.parse(readFile(file, 'utf8'));
  } catch {
    throw new Error('Freebuff credentials are missing or unreadable.');
  }
  const account = parsed?.default || parsed || {};
  const authToken = String(account.authToken || account.token || account.accessToken || '').trim();
  const actingUserId = String(account.id || account.userId || '').trim();
  if (!authToken || !actingUserId) throw new Error('Freebuff credentials are incomplete.');
  return { authToken, actingUserId };
}

export function freebuffSseText(raw) {
  const text = String(raw || '');
  let content = '';
  let reasoning = '';
  let usage = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }
    if (data?.usage) usage = data.usage;
    const choice = data?.choices?.[0];
    const delta = choice?.delta || choice?.message || {};
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    if (typeof choice?.text === 'string') content += choice.text;
  }
  return { text: content.trim() || reasoning.trim(), usage };
}

async function request(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    const body = parseJson(raw);
    return { response, body, raw };
  } catch (error) {
    if (error?.name === 'AbortError') return { transportError: `Freebuff request timed out after ${Math.round(timeoutMs / 1000)}s.` };
    return { transportError: `Freebuff transport error: ${String(error?.message || error).slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function runFreebuff({
  prompt,
  model = FREEBUFF_CHAT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  fetchImpl = fetch,
  credentialsPath,
} = {}) {
  const text = String(prompt || '').trim();
  if (!text) return fail('Freebuff run needs a non-empty prompt.');
  let credentials;
  try {
    credentials = resolveFreebuffCredentials({ env: { ...env, ...(credentialsPath ? { FREEBUFF_CREDENTIALS_PATH: credentialsPath } : {}) } });
  } catch (error) {
    return fail(error.message);
  }
  const modelId = String(model || '').trim();
  if (modelId !== FREEBUFF_CHAT_MODEL && modelId !== FREEBUFF_AGENT_ID) {
    return fail(`Unknown Freebuff model: ${modelId || '(empty)'}.`);
  }
  const chatModel = modelId === FREEBUFF_AGENT_ID ? FREEBUFF_CHAT_MODEL : modelId;
  const base = String(env.FREEBUFF_API_BASE || FREEBUFF_API_BASE).replace(/\/$/, '');
  const authHeaders = {
    Authorization: `Bearer ${credentials.authToken}`,
    'x-fb-timezone': 'UTC',
    'x-freebuff-first-tab-discount': '0',
  };
  const runHeaders = {
    ...authHeaders,
    'x-freebuff-acting-user-id': credentials.actingUserId,
    'Content-Type': 'application/json',
  };
  const admission = await request(fetchImpl, `${base}/api/v1/freebuff/session/admission`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'x-freebuff-model': chatModel,
      'x-freebuff-wallet-spend-limit': '0',
    },
  }, timeoutMs);
  if (admission.transportError) return fail(admission.transportError);
  if (!admission.response.ok || admission.body?.status !== 'active' || !admission.body?.instanceId) {
    return fail(mapFreebuffError({ status: admission.response.status, body: admission.body }), admission.response.status || -1);
  }
  const instanceId = admission.body.instanceId;
  let runId = '';
  try {
    const started = await request(fetchImpl, `${base}/api/v1/agent-runs`, {
      method: 'POST',
      headers: runHeaders,
      body: JSON.stringify({ action: 'START', agentId: FREEBUFF_AGENT_ID, ancestorRunIds: [] }),
    }, timeoutMs);
    if (started.transportError) return fail(started.transportError);
    if (!started.response.ok || !started.body?.runId) {
      return fail(mapFreebuffError({ status: started.response.status, body: started.body }), started.response.status || -1);
    }
    runId = started.body.runId;
    const completion = await request(fetchImpl, `${base}/api/v1/chat/completions`, {
      method: 'POST',
      headers: runHeaders,
      body: JSON.stringify({
        model: chatModel,
        provider: { data_collection: 'deny' },
        stream: true,
        tool_choice: 'auto',
        tools: [],
        messages: [{ role: 'user', content: text }],
        codebuff_metadata: {
          client_id: 'health-tracker-bot-host',
          cost_mode: 'free',
          freebuff_instance_id: instanceId,
          freebuff_reasoning_effort: env.FREEBUFF_REASONING_EFFORT || 'max',
          llm_step_number: '1',
          run_id: runId,
          trace_session_id: crypto.randomUUID(),
        },
      }),
    }, timeoutMs);
    if (completion.transportError) return fail(completion.transportError);
    if (!completion.response.ok) {
      return fail(mapFreebuffError({ status: completion.response.status, body: completion.body }), completion.response.status || -1);
    }
    const parsed = freebuffSseText(completion.raw);
    if (!parsed.text) return fail('Freebuff returned no text.', 0);
    const total = Number(parsed.usage?.total_tokens) || 0;
    return {
      code: 0,
      sessionID: null,
      finalText: parsed.text,
      lastError: null,
      stderr: '',
      usage: { cost: 0, tokens: total ? { total } : null },
    };
  } finally {
    await request(fetchImpl, `${base}/api/v1/freebuff/session`, {
      method: 'DELETE',
      headers: {
        ...authHeaders,
        'x-freebuff-instance-id': instanceId,
      },
    }, timeoutMs);
  }
}
