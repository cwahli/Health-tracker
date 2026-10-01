#!/usr/bin/env node
/**
 * Per-provider per-chat session ids (Cline task ids + OpenCode delegation).
 *
 *   cd tools/telegram-provider-router && node scripts/test-provider-sessions.mjs
 *
 * Pure unit tests on src/provider-sessions.js plus a static wiring check that
 * the router persists and reads the Cline session per chat. Exit 0 on all pass.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  getProviderSid,
  setProviderSid,
  forgetProviderSid,
  providerSessionsSupported,
} from "../src/provider-sessions.js";

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

console.log("test-provider-sessions\n");

// opencode delegates to the existing chat-sessions store.
const oc = { sessions: {} };
setProviderSid(oc, "opencode", 111, "ses_aaa");
check("opencode writes through to sessions.chats", oc.sessions.chats["111"] === "ses_aaa");
check("opencode reads back", getProviderSid(oc, "opencode", 111) === "ses_aaa");

// Cline per chat, isolated.
const st = { sessions: {} };
setProviderSid(st, "cline", "111", "1790000_aaa_cli");
setProviderSid(st, "cline", "222", "1790000_bbb_cli");
check("cline chat A reads its own task", getProviderSid(st, "cline", "111") === "1790000_aaa_cli");
check("cline chat B reads its own task", getProviderSid(st, "cline", "222") === "1790000_bbb_cli");
check("cline unknown chat reads null", getProviderSid(st, "cline", "333") === null);
check("cline map lives under sessions.clineChats", st.sessions.clineChats["111"] === "1790000_aaa_cli");

// Legacy global fallback + first write wins.
const legacy = { sessions: { cline: "1790000_legacy_cli" } };
check("cline legacy global is the fallback", getProviderSid(legacy, "cline", "999") === "1790000_legacy_cli");
setProviderSid(legacy, "cline", "999", "1790000_new_cli");
check("cline first per-chat write wins", getProviderSid(legacy, "cline", "999") === "1790000_new_cli");
check("cline other chats still see legacy", getProviderSid(legacy, "cline", "555") === "1790000_legacy_cli");

// A null chatId writes the legacy global (callers with no chat context).
setProviderSid(st, "cline", null, "1790000_global_cli");
check("cline null chat writes the legacy global", st.sessions.cline === "1790000_global_cli");

// forget drops the chat back to legacy (then to null when no legacy).
forgetProviderSid(st, "cline", "111");
check("cline forget removes the chat entry", getProviderSid(st, "cline", "111") === "1790000_global_cli");
forgetProviderSid(legacy, "cline", "999");
check("cline forget returns to legacy", getProviderSid(legacy, "cline", "999") === "1790000_legacy_cli");

// Validation + unknown providers.
let threw = false;
try { setProviderSid(st, "cline", "1", ""); } catch { threw = true; }
check("empty cline sid throws", threw);
threw = false;
try { setProviderSid(st, "tokenharbor", "1", "x"); } catch { threw = true; }
check("unknown provider store throws", threw);
check("providerSessionsSupported covers opencode + cline only",
  providerSessionsSupported("opencode") && providerSessionsSupported("cline") && !providerSessionsSupported("tokenharbor"));

// Wiring: index.js persists and reads the Cline session per chat.
const src = readFileSync(SRC, "utf8");
check("index imports provider-sessions.js", src.includes('from "./provider-sessions.js"'));
check("runCline reads the per-chat cline task", /getProviderSid\(state, "cline", chatId\)/.test(src));
check("runCline persists the returned cline task", /setProviderSid\(state, "cline", chatId, res\.sessionId\)/.test(src));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error("\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
