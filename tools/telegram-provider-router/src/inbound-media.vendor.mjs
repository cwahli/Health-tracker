// === VENDORED FROM scripts/lib/inbound-media.mjs — DO NOT EDIT ===
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.

import os from 'node:os';
import path from 'node:path';

// Telegrams images can arrive as a compressed `photo` (array of sizes) or as an
// uncompressed `document` (sent "as file"). This module turns a Telegram message
// into the download list, decides where the files live on disk, and builds the
// prompt the agent receives.

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function selectInboundMedia(message) {
  if (!message || typeof message !== 'object') return [];
  const items = [];

  // Telegram sends several resolutions; the last entry is the largest.
  const photos = Array.isArray(message.photo) ? message.photo : [];
  if (photos.length) {
    const largest = photos[photos.length - 1];
    if (largest?.file_id) items.push({ fileId: largest.file_id, name: 'photo.jpg', kind: 'photo' });
  }

  const doc = message.document;
  if (doc?.file_id) {
    const ext = MIME_EXT[doc.mime_type] || path.extname(doc.file_name || '') || '.bin';
    const name = doc.file_name || `document${ext}`;
    items.push({ fileId: doc.file_id, name, kind: 'document' });
  }

  return items;
}

export function sanitizeFileName(name) {
  const raw = String(name || 'file');
  const ext = (path.extname(raw) || '.bin').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const base = path
    .basename(raw, path.extname(raw))
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${base || 'file'}${ext}`;
}

export function inboundMediaDir({ workspace, chatId, allowExternalDirectory, tmpDir = os.tmpdir() } = {}) {
  const root =
    allowExternalDirectory || !workspace
      ? path.join(tmpDir, 'bot-host-media')
      : path.join(workspace, '.bot-media');
  return path.join(root, String(chatId ?? 'chat'));
}

export function buildInboundPrompt(text, filePaths) {
  const caption = String(text || '').trim();
  const paths = (filePaths || []).filter(Boolean);
  if (!paths.length) return caption;
  const list = paths.map((p, i) => `[Telegram attachment ${i + 1}: ${p}]`).join('\n');
  const instruction = caption || 'Analyze the attached image.';
  return `${list}\n\n${instruction}`.trim();
}
