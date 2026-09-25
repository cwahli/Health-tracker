#!/usr/bin/env node
/**
 * BOT-22: per-chat OpenCode sessions must isolate chats, migrate the legacy
 * global losslessly, and thread chat scope through index.js.
 *
 *   cd tools/telegram-provider-router && node scripts/test-chat-sessions.mjs
 *
 * Pure unit tests on src/chat-sessions.js (no network, no polling) plus a
 * static wiring check that src/index.js no longer reads a bare global
 * session. Exit 0 on all pass, 1 otherwise.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  chatIdOf,
  chatsMap,
  ensureChatsMap,
  getChatSid,
  setChatSid,
  forgetChatSid,
} from "../src/chat-sessions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src", "index.js");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("test-chat-sessions (BOT-22)\n");

// chatIdOf prefers chat id, falls back to sender.
check("chatIdOf reads ctx.chat.id", chatIdOf({ chat: { id: 42 }, from: { id: 7 } }) === "42");
check("chatIdOf falls back to ctx.from.id", chatIdOf({ from: { id: 7 } }) === "7");
check("chatIdOf null on empty ctx", chatIdOf({}) === null);

// Isolation: two chats never share a sid.
const state = { sessions: {} };
setChatSid(state, 111, "sid-aaa");
setChatSid(state, 222, "sid-bbb");
check("chat A reads its own sid", getChatSid(state, 111) === "sid-aaa");
check("chat B reads its own sid", getChatSid(state, 222) === "sid-bbb");
check("unknown chat reads null without legacy", getChatSid(state, 333) === null);

// Legacy migration: global survives as fallback until first per-chat write.
const legacy = { sessions: { opencode: "sid-legacy" } };
check("legacy global is the fallback", getChatSid(legacy, 999) === "sid-legacy");
setChatSid(legacy, 999, "sid-new");
check("first per-chat write wins over legacy", getChatSid(legacy, 999) === "sid-new");
check("other chats still see legacy", getChatSid(legacy, 555) === "sid-legacy");
check("legacy global untouched by per-chat writes", legacy.sessions.opencode === "sid-legacy");

// forgetChatSid drops back to legacy (the /new path then recreates).
forgetChatSid(legacy, 999);
check("forget returns the chat to legacy fallback", getChatSid(legacy, 999) === "sid-legacy");

// Backfill never clobbers.
const old = { sessions: { opencode: "sid-legacy", chats: { 1: "sid-one" } } };
ensureChatsMap(old);
check("backfill keeps chats map", old.sessions.chats[1] === "sid-one");
check("backfill keeps legacy global", old.sessions.opencode === "sid-legacy");
const bare = {};
ensureChatsMap(bare);
check("backfill builds map on bare state", typeof bare.sessions.chats === "object");

// Validation.
let threw = false;
try { setChatSid(state, 1, ""); } catch { threw = true; }
check("empty sid throws", threw);
threw = false;
try { chatsMap(null); } catch { threw = true; }
check("null state throws", threw);

// Wiring: index.js threads chat scope, no bare global reads remain.
const src = readFileSync(SRC, "utf8");
check("index imports chat-sessions.js", src.includes('from "./chat-sessions.js"'));
check("ensureOcSession takes chatId", /async function ensureOcSession\(chatId = null\)/.test(src));
check("runOpenCode accepts chatId", /chatId = null \} = \{\}/.test(src) || src.includes("chatId = null"));
check("dispatch receives chatId", src.includes("chatId: ctx.chat.id"));
check("no bare state.sessions.opencode reads remain",
  !src.includes("state.sessions.opencode") && !src.includes("state.sessions?.opencode"));
check("status paths use lastChatId scope", src.includes("getChatSid(state, state.lastChatId)"));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error("\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
