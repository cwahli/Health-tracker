import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';

import {
  selectInboundMedia,
  sanitizeFileName,
  inboundMediaDir,
  buildInboundPrompt,
} from '../scripts/lib/inbound-media.mjs';

describe('selectInboundMedia', () => {
  it('returns nothing for a plain text message', () => {
    expect(selectInboundMedia({ text: 'hello' })).toEqual([]);
    expect(selectInboundMedia(null)).toEqual([]);
  });

  it('picks the largest photo from the size array', () => {
    const message = {
      photo: [
        { file_id: 'small', file_size: 100 },
        { file_id: 'medium', file_size: 900 },
        { file_id: 'large', file_size: 5000 },
      ],
    };
    expect(selectInboundMedia(message)).toEqual([
      { fileId: 'large', name: 'photo.jpg', kind: 'photo' },
    ]);
  });

  it('handles an uncompressed document and keeps its filename', () => {
    const message = { document: { file_id: 'doc1', file_name: 'meal.png', mime_type: 'image/png' } };
    expect(selectInboundMedia(message)).toEqual([
      { fileId: 'doc1', name: 'meal.png', kind: 'document' },
    ]);
  });

  it('derives a document filename from mime when Telegram gives none', () => {
    const message = { document: { file_id: 'doc2', mime_type: 'image/jpeg' } };
    expect(selectInboundMedia(message)[0]).toEqual({
      fileId: 'doc2',
      name: 'document.jpg',
      kind: 'document',
    });
  });

  it('collects a photo and a document together', () => {
    const message = {
      photo: [{ file_id: 'p1' }],
      document: { file_id: 'd1', file_name: 'x.pdf' },
    };
    expect(selectInboundMedia(message).map((m) => m.fileId)).toEqual(['p1', 'd1']);
  });
});

describe('sanitizeFileName', () => {
  it('strips path separators and unsafe characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd.bin');
    expect(sanitizeFileName('my meal photo!!.PNG')).toBe('my_meal_photo.png');
  });

  it('defaults the extension to .bin and caps the base length', () => {
    expect(sanitizeFileName('noext')).toBe('noext.bin');
    expect(sanitizeFileName('a'.repeat(200) + '.txt').length).toBeLessThanOrEqual(64);
  });
});

describe('inboundMediaDir', () => {
  it('uses the OS temp dir when the agent may read external directories', () => {
    const dir = inboundMediaDir({
      workspace: '/repo',
      chatId: 42,
      allowExternalDirectory: true,
      tmpDir: '/tmp',
    });
    expect(dir).toBe(path.join('/tmp', 'bot-host-media', '42'));
  });

  it('falls back to a workspace subfolder when external reads are not allowed', () => {
    const dir = inboundMediaDir({
      workspace: '/repo',
      chatId: 42,
      allowExternalDirectory: false,
      tmpDir: '/tmp',
    });
    expect(dir).toBe(path.join('/repo', '.bot-media', '42'));
  });

  it('defaults the chat segment when there is no chat id', () => {
    const dir = inboundMediaDir({ workspace: '/repo', allowExternalDirectory: false });
    expect(dir.endsWith(path.join('.bot-media', 'chat'))).toBe(true);
  });
});

describe('buildInboundPrompt', () => {
  it('returns the caption alone when there is no media', () => {
    expect(buildInboundPrompt('just text', [])).toBe('just text');
  });

  it('lists each attachment path and keeps the caption', () => {
    const prompt = buildInboundPrompt('what is this?', ['/tmp/a.jpg', '/tmp/b.png']);
    expect(prompt).toContain('[Telegram attachment 1: /tmp/a.jpg]');
    expect(prompt).toContain('[Telegram attachment 2: /tmp/b.png]');
    expect(prompt.trim().endsWith('what is this?')).toBe(true);
  });

  it('adds a default instruction when there is media but no caption', () => {
    const prompt = buildInboundPrompt('', ['/tmp/a.jpg']);
    expect(prompt).toContain('/tmp/a.jpg');
    expect(prompt).toContain('Analyze the attached image.');
  });

  it('ignores empty/falsy paths', () => {
    expect(buildInboundPrompt('hi', [null, '', undefined])).toBe('hi');
  });
});

describe('inbound temp dir exists under os.tmpdir', () => {
  it('points inside the system temp directory', () => {
    const dir = inboundMediaDir({ workspace: os.tmpdir(), chatId: 1, allowExternalDirectory: true });
    expect(dir.startsWith(os.tmpdir())).toBe(true);
  });
});
