import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareInboundMedia } from '../src/inbound-media-adapter.mjs';

const workspace = await mkdtemp(path.join(os.tmpdir(), 'router-inbound-'));
const chatId = 42;

try {
  const requested = [];
  const fetched = [];
  const api = {
    getFile: async (fileId) => {
      requested.push(fileId);
      return { file_path: fileId === 'photo-1' ? 'photos/file_1.jpg' : 'documents/report 1.pdf' };
    },
  };
  const fetchImpl = async (url) => {
    fetched.push(url);
    const body = new TextEncoder().encode(url.includes('file_1.jpg') ? 'photo-bytes' : 'document-bytes');
    return { ok: true, arrayBuffer: async () => body.buffer };
  };
  const message = {
    caption: 'Review this meal',
    photo: [{ file_id: 'photo-1' }],
    document: { file_id: 'doc-1', file_name: '../report 1.pdf' },
  };
  const result = await prepareInboundMedia({
    api,
    message,
    text: message.caption,
    chatId,
    workspace,
    token: 'TEST_TOKEN',
    fetchImpl,
    now: () => 123,
  });

  assert.equal(result.selected, 2);
  assert.equal(result.failures, 0);
  assert.equal(result.paths.length, 2);
  assert.deepEqual(requested, ['photo-1', 'doc-1']);
  assert.equal(result.paths.every((filePath) => filePath.startsWith(path.join(workspace, '.bot-media', String(chatId)))), true);
  assert.match(result.prompt, /Review this meal/);
  assert.match(result.prompt, /\[Telegram attachment 1: /);
  assert.match(result.prompt, /\[Telegram attachment 2: /);
  assert.equal(await readFile(result.paths[0], 'utf8'), 'photo-bytes');
  assert.equal(await readFile(result.paths[1], 'utf8'), 'document-bytes');
  assert.equal(fetched.length, 2);

  const missingPath = await prepareInboundMedia({
    api: { getFile: async () => ({}) },
    message: { photo: [{ file_id: 'missing' }] },
    text: 'caption',
    chatId,
    workspace,
    token: 'TEST_TOKEN',
    fetchImpl: async () => {
      throw new Error('fetch must not run');
    },
  });
  assert.equal(missingPath.selected, 1);
  assert.equal(missingPath.paths.length, 0);
  assert.equal(missingPath.failures, 1);
  assert.equal(missingPath.prompt, 'caption');

  const failedDownload = await prepareInboundMedia({
    api: { getFile: async () => ({ file_path: 'documents/failed.pdf' }) },
    message: { document: { file_id: 'failed' } },
    text: 'caption',
    chatId,
    workspace,
    token: 'TEST_TOKEN',
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(failedDownload.paths.length, 0);
  assert.equal(failedDownload.failures, 1);

  const textOnly = await prepareInboundMedia({ message: { text: 'hello' }, text: 'hello', workspace, chatId });
  assert.deepEqual(textOnly, { selected: 0, paths: [], failures: 0, prompt: 'hello' });

  process.stdout.write('router inbound-media: 1 passed\n');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
