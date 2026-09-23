import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'https://api.telegram.org';
export const MAX_MESSAGE_CHARS = 4096;

const PHOTO_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.wav']);

export function mediaMethod(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (PHOTO_EXT.has(ext)) return 'sendPhoto';
  if (ext === '.mp4') return 'sendVideo';
  if (AUDIO_EXT.has(ext)) return 'sendAudio';
  return 'sendDocument';
}

export function mediaField(method) {
  if (method === 'sendPhoto') return 'photo';
  if (method === 'sendVideo') return 'video';
  if (method === 'sendAudio') return 'audio';
  return 'document';
}

export function isSendableMedia(file, { exists = fs.existsSync } = {}) {
  const value = String(file ?? '').trim();
  if (!value || !path.isAbsolute(value)) return false;
  return exists(value);
}

export class TelegramError extends Error {
  constructor(method, status, description, parameters) {
    super(`${method} failed (${status}): ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.status = status;
    this.description = description;
    this.parameters = parameters || {};
  }

  get retryAfter() {
    return Number(this.parameters.retry_after) || 0;
  }

  get isRateLimit() {
    return this.status === 429;
  }
}

export function clamp(text, limit = MAX_MESSAGE_CHARS) {
  const s = String(text ?? '');
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 3)}...`;
}

export function chunkText(text, limit = MAX_MESSAGE_CHARS) {
  const s = String(text ?? '');
  if (s.length <= limit) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export class TelegramApi {
  constructor(token, { baseUrl = API_BASE, fetchImpl = globalThis.fetch } = {}) {
    if (!token) throw new Error('TelegramApi: token is required');
    if (typeof fetchImpl !== 'function') throw new Error('TelegramApi: fetch is not available');
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
  }

  async call(method, payload = {}) {
    // Long-poll needs slack past Telegram timeout; everything else fails fast.
    // Without AbortSignal, a dead proot/Termux socket hangs forever and the bot
    // stops consuming updates while Telegram has already dropped the connection.
    // Roaming/carrier networks intermittently blackhole api.telegram.org IPv6
    // (undici tries AAAA first and fails without fallback), so non-poll calls
    // retry on network-level throws. TelegramErrors are never retried: a 4xx
    // means the request was processed, and resending could double-deliver.
    const pollSec = method === 'getUpdates' ? Number(payload.timeout) || 30 : 0;
    const abortMs = (pollSec + 10) * 1000;
    const attempts = method === 'getUpdates' ? 1 : 3;
    let res = null;
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        res = await this.fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(abortMs),
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    if (!res) throw lastErr;
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (!body.ok) {
      throw new TelegramError(
        method,
        body.error_code || res.status,
        body.description || `HTTP ${res.status}`,
        body.parameters,
      );
    }
    return body.result;
  }

  getMe() {
    return this.call('getMe');
  }

  getUpdates({ offset, timeout = 30, allowedUpdates = ['message'] } = {}) {
    return this.call('getUpdates', { offset, timeout, allowed_updates: allowedUpdates });
  }

  getFile(fileId) {
    return this.call('getFile', { file_id: fileId });
  }

  async downloadFile(remoteFilePath, destPath) {
    const url = `${this.baseUrl}/file/bot${this.token}/${remoteFilePath}`;
    const res = await this.fetch(url);
    if (!res.ok) {
      throw new TelegramError('downloadFile', res.status, `HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(destPath, buf);
    return destPath;
  }

  async downloadFileById(fileId, destPath) {
    const file = await this.getFile(fileId);
    if (!file?.file_path) {
      throw new TelegramError('getFile', 200, 'Telegram returned no file_path');
    }
    return this.downloadFile(file.file_path, destPath);
  }

  deleteWebhook({ dropPendingUpdates = false } = {}) {
    return this.call('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
  }

  answerCallbackQuery(callbackQueryId, extra = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...extra });
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text: clamp(text), ...extra });
  }

  sendChatAction(chatId, action = 'typing') {
    return this.call('sendChatAction', { chat_id: chatId, action });
  }

  async sendMediaFile(chatId, filePath, extra = {}) {
    const method = mediaMethod(filePath);
    const buf = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append(mediaField(method), new Blob([buf]), path.basename(filePath));
    for (const [key, value] of Object.entries(extra)) {
      if (value != null) form.append(key, String(value));
    }
    const res = await this.fetch(`${this.baseUrl}/bot${this.token}/${method}`, { method: 'POST', body: form });
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (!body.ok) {
      throw new TelegramError(
        method,
        body.error_code || res.status,
        body.description || `HTTP ${res.status}`,
        body.parameters,
      );
    }
    return body.result;
  }

  editMessageText(chatId, messageId, text, extra = {}) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: clamp(text),
      ...extra,
    });
  }
}
