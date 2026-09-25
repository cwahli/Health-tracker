import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  buildInboundPrompt,
  inboundMediaDir,
  sanitizeFileName,
  selectInboundMedia,
} from './inbound-media.vendor.mjs';

function fileUrl(token, filePath) {
  const encodedPath = String(filePath).split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://api.telegram.org/file/bot${token}/${encodedPath}`;
}

export async function prepareInboundMedia({
  api,
  message,
  text = '',
  chatId,
  workspace,
  token,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const items = selectInboundMedia(message);
  const baseText = String(text || '');
  if (!items.length) return { selected: 0, paths: [], failures: 0, prompt: baseText };

  const destinationRoot = path.resolve(String(workspace || process.cwd()));
  const destinationDir = inboundMediaDir({
    workspace: destinationRoot,
    chatId,
    allowExternalDirectory: false,
  });
  try {
    await mkdir(destinationDir, { recursive: true });
  } catch {
    return { selected: items.length, paths: [], failures: items.length, prompt: baseText };
  }

  const paths = [];
  let failures = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      const file = await api.getFile(item.fileId);
      if (!file?.file_path) throw new Error('missing file path');
      const response = await fetchImpl(fileUrl(token, file.file_path));
      if (!response?.ok) throw new Error('download failed');
      const bytes = Buffer.from(await response.arrayBuffer());
      const stamp = `${now()}-${randomUUID().slice(0, 8)}`;
      const destination = path.join(destinationDir, `${stamp}-${index}-${sanitizeFileName(item.name)}`);
      await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
      paths.push(destination);
    } catch {
      failures += 1;
    }
  }

  return {
    selected: items.length,
    paths,
    failures,
    prompt: paths.length ? buildInboundPrompt(baseText, paths) : baseText,
  };
}
