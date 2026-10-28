import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeminiMcpConnectPanel } from './GeminiMcpConnectCard';
import { geminiMcpCopy } from '../utils/geminiMcpCopy';

describe('Gemini MCP connect card', () => {
  it('keeps en, id, fr, and zh on the same keys', () => {
    const enKeys = Object.keys(geminiMcpCopy.en).sort();
    for (const locale of ['id', 'fr', 'zh'] as const) {
      expect(Object.keys(geminiMcpCopy[locale]).sort()).toEqual(enKeys);
      for (const key of enKeys) {
        const value = geminiMcpCopy[locale][key as keyof typeof geminiMcpCopy.en];
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps Simplified Chinese free of the traditional-only set', () => {
    const traditionalOnly = '這們為麼發裡後點開關門問聽說語讓時會還過對麵髮來進遠運帳設隱緩權驗際連軟盤標籤頁網郵龍鳳龜';
    for (const value of Object.values(geminiMcpCopy.zh)) {
      for (const ch of traditionalOnly) {
        expect(value.includes(ch)).toBe(false);
      }
    }
  });

  it('renders the URL, create, and revoke controls in the profile language', () => {
    const html = renderToStaticMarkup(
      <GeminiMcpConnectPanel
        language="id"
        mcpUrl="https://health-tracker.co.uk/api/mcp"
        activeSessions={2}
        signedIn
        onCopy={() => {}}
        onCreate={() => {}}
        onRevoke={() => {}}
      />
    );
    expect(html).toContain('Hubungkan ke Gemini MCP');
    expect(html).toContain('https://health-tracker.co.uk/api/mcp');
    expect(html).toContain('Sesi aktif: 2');
    expect(html).toContain('id="gemini-mcp-create"');
    expect(html).toContain('id="gemini-mcp-revoke"');
    expect(html).toContain('id="gemini-mcp-copy-url"');
  });

  it('shows a client id and a one-time secret after credentials are created', () => {
    const html = renderToStaticMarkup(
      <GeminiMcpConnectPanel
        language="en"
        mcpUrl="https://health-tracker.co.uk/api/mcp"
        clientId="mcp_client_abc"
        clientSecret="mcp_sec_once"
        activeSessions={0}
        signedIn
        onCopy={() => {}}
        onCreate={() => {}}
        onRevoke={() => {}}
      />
    );
    expect(html).toContain('mcp_client_abc');
    expect(html).toContain('mcp_sec_once');
    expect(html).toContain('Shown once');
    expect(html).toContain('id="gemini-mcp-copy-secret"');
  });
});
