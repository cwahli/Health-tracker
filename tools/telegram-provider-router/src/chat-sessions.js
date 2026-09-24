/**
 * Per-chat OpenCode sessions for the Telegram provider router (BOT-22).
 *
 * The router used to keep one global session (`state.sessions.opencode`)
 * for every chat, so two chats shared one conversation. Sessions are now
 * keyed per chat: `state.sessions.chats = { "<chatId>": "<sid>" }`.
 *
 * Migration is lossless: a chat with no entry falls back to the legacy
 * global `state.sessions.opencode` string, and the first write for that
 * chat records its own entry. Same contract as BOT-12 — a follow-up in a
 * chat resumes that chat's session, never another chat's.
 */

export function chatIdOf(ctx) {
  const raw = ctx?.chat?.id ?? ctx?.from?.id ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
}

/** Ensure the per-chat map exists; never clobbers the legacy global. */
export function chatsMap(state) {
  if (!state || typeof state !== "object") throw new Error("chat-sessions: state must be an object");
  if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
  const m = state.sessions.chats;
  if (m && typeof m === "object" && !Array.isArray(m)) return m;
  state.sessions.chats = {};
  return state.sessions.chats;
}

/** Backfill an older state object in place. Returns the state. */
export function ensureChatsMap(state) {
  chatsMap(state);
  return state;
}

function legacySid(state) {
  const v = state?.sessions?.opencode;
  return typeof v === "string" && v ? v : null;
}

/**
 * Session id for a chat: its own entry first, legacy global as fallback.
 * Null chatId means "no chat context" — legacy global only.
 */
export function getChatSid(state, chatId) {
  if (chatId !== null && chatId !== undefined && chatId !== "") {
    const hit = chatsMap(state)[String(chatId)];
    if (typeof hit === "string" && hit) return hit;
  }
  return legacySid(state);
}

/**
 * Record a session id. A null chatId writes the legacy global (backward
 * compatible with callers that have no chat context).
 */
export function setChatSid(state, chatId, sid) {
  if (!sid || typeof sid !== "string") throw new Error("chat-sessions: sid must be a non-empty string");
  if (chatId === null || chatId === undefined || chatId === "") {
    if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
    state.sessions.opencode = sid;
  } else {
    chatsMap(state)[String(chatId)] = sid;
  }
  return sid;
}

/** Forget a chat's session (the /new path). Null chatId clears the legacy global. */
export function forgetChatSid(state, chatId) {
  if (!state || typeof state !== "object") return;
  if (chatId === null || chatId === undefined || chatId === "") {
    if (state.sessions && typeof state.sessions === "object") delete state.sessions.opencode;
  } else if (state.sessions && typeof state.sessions.chats === "object") {
    delete state.sessions.chats[String(chatId)];
  }
}
