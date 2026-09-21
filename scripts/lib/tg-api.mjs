const API_BASE = 'https://api.telegram.org';
export const MAX_MESSAGE_CHARS = 4096;

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
    const res = await this.fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
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

  editMessageText(chatId, messageId, text, extra = {}) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: clamp(text),
      ...extra,
    });
  }
}
