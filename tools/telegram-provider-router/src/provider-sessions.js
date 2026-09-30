/**
 * Per-provider, per-chat session ids for the router.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `/tui` must open the SAME conversation the Telegram chat is using. That is a
 * per-chat fact, not a per-process one, and it is provider-shaped:
 *   - opencode: an `ses_…` id on the box's OpenCode server. Storage already
 *     exists (`chat-sessions.js`, BOT-22) and this module delegates to it so
 *     there is exactly one writer for that map.
 *   - cline: a Cline session/task id (e.g. `1790766218066_6JrDl_cli`). The
 *     router used to start a brand-new headless Cline task on every Telegram
 *     turn, so the chat had no conversation to attach to. This module gives
 *     Cline the same per-chat shape OpenCode has, which is what lets the TUI
 *     resume the task the chat was actually using.
 *
 * Migration is lossless, mirroring `chat-sessions.js`: a chat with no entry
 * falls back to the legacy global string (`state.sessions.cline`), and the
 * first write records its own entry.
 */

import { getChatSid, setChatSid, forgetChatSid } from "./chat-sessions.js";

/** Providers that keep their per-chat map next to OpenCode's, keyed by shape. */
const MAP_KEY = { cline: "clineChats" };
/** Legacy single-session string for a provider (pre-per-chat). */
const LEGACY_KEY = { cline: "cline" };

/** True when this provider has a per-chat session store in this module. */
export function providerSessionsSupported(provider) {
  return provider === "opencode" || Boolean(MAP_KEY[provider]);
}

function normalizeChat(chatId) {
  if (chatId === null || chatId === undefined || chatId === "") return null;
  return String(chatId);
}

/** Session id for (provider, chat): the chat's own entry first, legacy global second. */
export function getProviderSid(state, provider, chatId) {
  if (provider === "opencode") return getChatSid(state, chatId);
  const key = MAP_KEY[provider];
  if (!key || !state) return null;
  const chat = normalizeChat(chatId);
  const map = state.sessions?.[key];
  if (chat && map && typeof map === "object" && !Array.isArray(map)) {
    const hit = map[chat];
    if (typeof hit === "string" && hit) return hit;
  }
  const legacy = state.sessions?.[LEGACY_KEY[provider]];
  return typeof legacy === "string" && legacy ? legacy : null;
}

/**
 * Record a session id for (provider, chat). A null chatId writes the provider's
 * legacy global, matching `chat-sessions.js` so callers without chat context
 * still work.
 */
export function setProviderSid(state, provider, chatId, sid) {
  if (provider === "opencode") return setChatSid(state, chatId, sid);
  if (!providerSessionsSupported(provider)) {
    throw new Error(`provider-sessions: ${provider} has no session store`);
  }
  if (!sid || typeof sid !== "string") {
    throw new Error("provider-sessions: sid must be a non-empty string");
  }
  if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
  const chat = normalizeChat(chatId);
  if (chat === null) {
    state.sessions[LEGACY_KEY[provider]] = sid;
    return sid;
  }
  const key = MAP_KEY[provider];
  if (!state.sessions[key] || typeof state.sessions[key] !== "object" || Array.isArray(state.sessions[key])) {
    state.sessions[key] = {};
  }
  state.sessions[key][chat] = sid;
  return sid;
}

/** Forget a provider's session for a chat (the /new-style reset). */
export function forgetProviderSid(state, provider, chatId) {
  if (provider === "opencode") return forgetChatSid(state, chatId);
  const key = MAP_KEY[provider];
  if (!key || !state?.sessions) return;
  const chat = normalizeChat(chatId);
  if (chat === null) {
    delete state.sessions[LEGACY_KEY[provider]];
    return;
  }
  if (state.sessions[key] && typeof state.sessions[key] === "object") {
    delete state.sessions[key][chat];
  }
}
