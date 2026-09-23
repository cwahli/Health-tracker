import { describe, it, expect } from 'vitest';

import {
  normalizeLang,
  escapeHtml,
  splitFences,
  hasBalancedFences,
  extractCopyDirectives,
  markdownToTelegramHtml,
  buildCopyKeyboard,
  chunkForTelegram,
  sendCopyable,
  COPY_TEXT_LIMIT,
} from './tg-copy-code.mjs';

describe('normalizeLang', () => {
  it('keeps explicit languages', () => {
    expect(normalizeLang('bash')).toBe('bash');
    expect(normalizeLang('Python')).toBe('python');
  });
  it('maps shell aliases to bash', () => {
    for (const a of ['sh', 'shell', 'zsh', 'terminal', 'cron']) expect(normalizeLang(a)).toBe('bash');
  });
  it('falls back to plaintext', () => {
    expect(normalizeLang('')).toBe('plaintext');
    expect(normalizeLang('!!!')).toBe('plaintext');
  });
});

describe('splitFences', () => {
  it('splits prose and fenced blocks', () => {
    const segs = splitFences('hi\n```bash\ncrontab -l\n```\nbye');
    expect(segs.map((s) => s.type)).toEqual(['text', 'fence', 'text']);
    expect(segs[1]).toMatchObject({ lang: 'bash', code: 'crontab -l', closed: true });
  });
  it('treats unclosed fence as code to end of text', () => {
    const segs = splitFences('```sh\nls -l');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: 'fence', lang: 'bash' });
  });
  it('detects unbalanced fences', () => {
    expect(hasBalancedFences('a ```b\nc')).toBe(false);
    expect(hasBalancedFences('```a\nx\n```')).toBe(true);
  });
});

describe('extractCopyDirectives', () => {
  it('strips COPY: lines outside fences', () => {
    const { text, copies } = extractCopyDirectives('run this\nCOPY:crontab -l\ndone');
    expect(copies).toEqual(['crontab -l']);
    expect(text).not.toContain('COPY:');
    expect(text).toContain('run this');
  });
  it('ignores COPY: inside fences and overlong lines', () => {
    const long = `COPY:${'x'.repeat(COPY_TEXT_LIMIT + 1)}`;
    const { text, copies } = extractCopyDirectives(`\`\`\`bash\nCOPY:not-a-directive\n\`\`\`\n${long}`);
    expect(copies).toEqual([]);
    expect(text).toContain('COPY:not-a-directive');
  });
});

describe('markdownToTelegramHtml', () => {
  it('emits language class for native copy button', () => {
    const { html, blocks } = markdownToTelegramHtml('check:\n```bash\ncrontab -l\n```');
    expect(html).toContain('<pre><code class="language-bash">crontab -l</code></pre>');
    expect(blocks).toEqual([{ lang: 'bash', code: 'crontab -l' }]);
  });
  it('escapes HTML in prose and code', () => {
    const { html } = markdownToTelegramHtml('a < b & c\n```\nx < y\n```');
    expect(html).toContain('a &lt; b &amp; c');
    expect(html).toContain('x &lt; y');
    expect(html).not.toMatch(/<(?!pre|code|\/pre|\/code)/);
  });
  it('converts inline code', () => {
    const { html } = markdownToTelegramHtml('run `crontab -l` now');
    expect(html).toContain('<code>crontab -l</code>');
  });
});

describe('buildCopyKeyboard', () => {
  it('builds copy_text buttons', () => {
    const kb = buildCopyKeyboard(['crontab -l']);
    expect(kb.inline_keyboard).toHaveLength(1);
    expect(kb.inline_keyboard[0][0]).toEqual({ text: '📋 Copy: crontab -l', copy_text: { text: 'crontab -l' } });
  });
  it('dedupes, enforces 256 limit and max buttons', () => {
    const kb = buildCopyKeyboard(['a', 'a', 'x'.repeat(257), 'b', 'c', 'd', 'e'], { maxButtons: 3 });
    expect(kb.inline_keyboard).toHaveLength(3);
  });
  it('returns undefined when nothing qualifies', () => {
    expect(buildCopyKeyboard([])).toBeUndefined();
  });
});

describe('chunkForTelegram', () => {
  it('passes plain messages through unchanged', () => {
    const [p] = chunkForTelegram('just a status update');
    expect(p).toMatchObject({ text: 'just a status update', hasCode: false });
    expect(p.extra).toEqual({});
  });
  it('upgrades code chunks to HTML with copy keyboard', () => {
    const [p] = chunkForTelegram('Verify on the VPS:\n```bash\ncrontab -l\n```');
    expect(p.hasCode).toBe(true);
    expect(p.extra.parse_mode).toBe('HTML');
    expect(p.text).toContain('class="language-bash"');
    expect(p.extra.reply_markup.inline_keyboard[0][0].copy_text).toEqual({ text: 'crontab -l' });
  });
  it('falls back to plain for unbalanced fences', () => {
    const [p] = chunkForTelegram('broken ```bash\ncrontab -l');
    expect(p.hasCode).toBe(false);
    expect(p.extra).toEqual({});
  });
});

describe('sendCopyable', () => {
  it('sends payloads via api.sendMessage', async () => {
    const calls = [];
    const api = { sendMessage: async (c, t, e) => calls.push([c, t, e]) && { message_id: calls.length } };
    await sendCopyable(api, 1, 'hi\n```bash\ncrontab -l\n```');
    expect(calls).toHaveLength(1);
    expect(calls[0][2].parse_mode).toBe('HTML');
  });
});
