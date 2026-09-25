import { spawn } from 'node:child_process';
import net from 'node:net';

import { resolveOpencodeBin } from './agent-opencode.mjs';

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('could not allocate an OpenCode server port'));
        else resolve(port);
      });
    });
  });
}

async function waitForServer(url, { fetchImpl = fetch, timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${url}/global/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return await response.json();
      lastError = new Error(`OpenCode server health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`OpenCode server did not become ready: ${lastError?.message || 'timeout'}`);
}

export async function opencodeServerHealthy(serverUrl, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetchImpl(`${serverUrl}/global/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startOpencodeServer({ workspace, env = {}, opencodeBin, port, spawnImpl = spawn, fetchImpl = fetch } = {}) {
  const chosenPort = port || await freePort();
  const child = spawnImpl(resolveOpencodeBin(opencodeBin), ['serve', '--hostname', '127.0.0.1', '--port', String(chosenPort)], {
    cwd: workspace,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${chosenPort}`;
  try {
    await waitForServer(url, { fetchImpl });
    child.unref?.();
    return { pid: child.pid || null, url, port: chosenPort };
  } catch (error) {
    child.kill?.('SIGTERM');
    throw error;
  }
}

export async function createOpencodeSession(serverUrl, { title = 'Health-tracker work session', fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${serverUrl}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error(`OpenCode session creation returned ${response.status}`);
  const session = await response.json();
  if (!session?.id) throw new Error('OpenCode session creation returned no session id');
  return session;
}

export function tuiAttachCommand({ serverUrl, workspace, sessionId, opencodeBin } = {}) {
  if (!serverUrl || !workspace || !sessionId) throw new Error('OpenCode TUI attach needs server URL, workspace, and session id');
  return [
    shellQuote(resolveOpencodeBin(opencodeBin)),
    'attach',
    shellQuote(serverUrl),
    '--dir',
    shellQuote(workspace),
    '--session',
    shellQuote(sessionId),
  ].join(' ');
}

export async function ensureOpencodeTui({ serverUrl, opencodeSessionId, workspace, title, env, opencodeBin, spawnImpl, fetchImpl } = {}) {
  if (serverUrl && opencodeSessionId && await opencodeServerHealthy(serverUrl, { fetchImpl })) {
    return {
      serverUrl,
      opencodeSessionId,
      command: tuiAttachCommand({ serverUrl, workspace, sessionId: opencodeSessionId, opencodeBin }),
    };
  }
  const server = await startOpencodeServer({ workspace, env, opencodeBin, spawnImpl, fetchImpl });
  const session = await createOpencodeSession(server.url, { title, fetchImpl });
  return {
    serverUrl: server.url,
    serverPid: server.pid,
    opencodeSessionId: session.id,
    command: tuiAttachCommand({ serverUrl: server.url, workspace, sessionId: session.id, opencodeBin }),
  };
}

export async function abortOpencodeSession({ serverUrl, sessionId, fetchImpl = fetch } = {}) {
  if (!serverUrl || !sessionId) return false;
  const response = await fetchImpl(`${serverUrl}/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' });
  return response.ok;
}
