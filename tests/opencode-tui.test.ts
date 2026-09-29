import { describe, expect, it } from 'vitest';

import {
  abortOpencodeSession,
  createOpencodeSession,
  ensureOpencodeTui,
  opencodeServerHealthy,
  startOpencodeServer,
  tuiAttachCommand,
} from '../scripts/lib/opencode-tui.mjs';

describe('OpenCode TUI server wiring', () => {
  it('starts a local server, creates a session, and builds an attach command', async () => {
    const child = { pid: 42, unref: () => {}, kill: () => {} };
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([url, options]);
      if (url.endsWith('/global/health')) return { ok: true, status: 200, json: async () => ({ healthy: true }) };
      return { ok: true, status: 200, json: async () => ({ id: 'ses_test' }) };
    };
    const server = await startOpencodeServer({ workspace: '/ws', port: 4567, spawnImpl: () => child, fetchImpl });
    expect(server).toEqual({ pid: 42, url: 'http://127.0.0.1:4567', port: 4567 });
    const session = await createOpencodeSession(server.url, { fetchImpl });
    expect(session.id).toBe('ses_test');
    // v2.0.19: no `attach` subcommand, no `--dir` flag. The command must be the
    // v2 shape or the CLI prints help and the pane never opens (2026-09-29).
    const attach = tuiAttachCommand({ serverUrl: server.url, workspace: '/ws', sessionId: session.id });
    expect(attach).toContain("--server 'http://127.0.0.1:4567'");
    expect(attach).not.toMatch(/\battach\b/);
    expect(attach).not.toContain('--dir');
    // The directory is a trailing positional argument in v2, after the flags.
    expect(attach.endsWith("--session 'ses_test' '/ws'")).toBe(true);
    expect(calls.some(([url]) => url.endsWith('/session'))).toBe(true);
  });

  it('reuses a healthy server and session for the TUI', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/global/health')) return { ok: true, status: 200 };
      throw new Error(`unexpected request ${url}`);
    };
    const result = await ensureOpencodeTui({
      serverUrl: 'http://127.0.0.1:4567',
      opencodeSessionId: 'ses_existing',
      workspace: '/ws',
      fetchImpl,
    });
    expect(result.opencodeSessionId).toBe('ses_existing');
    expect(result.command).toContain("--session 'ses_existing'");
  });

  it('reports unhealthy servers and aborts the attached session', async () => {
    expect(await opencodeServerHealthy('http://127.0.0.1:1', { fetchImpl: async () => { throw new Error('down'); } })).toBe(false);
    const calls = [];
    const result = await abortOpencodeSession({
      serverUrl: 'http://127.0.0.1:4567',
      sessionId: 'ses_test',
      fetchImpl: async (url, options) => {
        calls.push([url, options.method]);
        return { ok: true, status: 200 };
      },
    });
    expect(result).toBe(true);
    expect(calls).toEqual([['http://127.0.0.1:4567/session/ses_test/abort', 'POST']]);
  });
});
