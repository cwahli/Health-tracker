#!/usr/bin/env node
/**
 * Cline headless turns must be RESUMEABLE so Telegram and the TUI share one
 * conversation. The old `cline --json "<prompt>"` started a new task each turn.
 *
 *   cd tools/telegram-provider-router && node scripts/test-cline-acp.mjs
 *
 * The ACP driver is exercised against a fake `cline --acp` child: initialize,
 * session/new, session/load, session/prompt, the permission request, and the fs
 * read request. No bot, no network, no Cline account.
 */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAcpArgs,
  acpUpdateText,
  permissionResult,
  runClineAcp,
} from "../src/cline-acp.js";

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("test-cline-acp\n");

// Pure: argv + update parsing + permission choice.
check("argv is ACP with model, cwd and thinking",
  eq(buildAcpArgs({ model: "cline-free/muse-spark-1.3-contributor", cwd: "/ws", thinking: "high" }),
     ["--acp", "-m", "cline-free/muse-spark-1.3-contributor", "-c", "/ws", "--thinking", "high"]));
check("argv omits an unset thinking level", eq(buildAcpArgs({ model: "m", cwd: "/ws" }), ["--acp", "-m", "m", "-c", "/ws"]));
check("agent_message_chunk text is extracted",
  acpUpdateText({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } }) === "hi");
check("non-text updates yield nothing", acpUpdateText({ sessionUpdate: "tool_call" }) === "");
check("permission prefers an allow option",
  permissionResult({ options: [{ optionId: "reject_once", kind: "reject_once" }, { optionId: "allow_once", kind: "allow_once" }] }).outcome.optionId === "allow_once");
check("permission falls back to the first option", permissionResult({ options: [{ optionId: "x" }] }).outcome.optionId === "x");

// A fake `cline --acp` child that speaks just enough ACP.
function fakeCline({ sessionId = "1790000_new_cli", chunks = ["he", "llo"], keepOpen = false } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter();
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (sig) => {
    child.signalCode = sig || "SIGTERM";
    child.exitCode = 0;
    child.emit("close", 0);
  };
  const received = [];
  let buf = "";
  const write = (obj) => stdout.write(`${JSON.stringify(obj)}\n`);
  stdin.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      received.push(msg);
      queueMicrotask(() => respond(msg));
    }
  });
  function respond(msg) {
    if (msg.method === "initialize") {
      write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
      return;
    }
    if (msg.method === "session/new") {
      write({ jsonrpc: "2.0", id: msg.id, result: { sessionId } });
      return;
    }
    if (msg.method === "session/load") {
      write({ jsonrpc: "2.0", id: msg.id, result: { sessionId: msg.params.sessionId } });
      return;
    }
    if (msg.method === "session/prompt") {
      write({ jsonrpc: "2.0", id: 9001, method: "session/request_permission", params: { sessionId: msg.params.sessionId, options: [{ optionId: "allow_once", kind: "allow_once" }, { optionId: "reject_once", kind: "reject_once" }] } });
      write({ jsonrpc: "2.0", id: 9002, method: "fs/read_text_file", params: { sessionId: msg.params.sessionId, path: "/tmp/acp-read" } });
      for (const c of chunks) {
        write({ jsonrpc: "2.0", method: "session/update", params: { sessionId: msg.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: c } } } });
      }
      if (!keepOpen) write({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
      return;
    }
    write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "nope" } });
  }
  child.received = received;
  return child;
}

const fsStub = { readFileSync: () => "file body", writeFileSync: () => {} };

// New session: adopts the returned id and streams the text.
{
  const fake = fakeCline();
  let spawnedArgs = null;
  const res = await runClineAcp({
    prompt: "hi",
    model: "cline-free/muse-spark-1.3-contributor",
    cwd: "/ws",
    spawnImpl: (_bin, args) => {
      spawnedArgs = args;
      return fake;
    },
    fsImpl: fsStub,
  });
  check("new session text is stitched from chunks", res.text === "hello", res.text);
  check("new session adopts the ACP session id", res.sessionId === "1790000_new_cli", res.sessionId);
  check("new session stop reason is end_turn", res.stopReason === "end_turn");
  check("spawn used the ACP argv", eq(spawnedArgs, ["--acp", "-m", "cline-free/muse-spark-1.3-contributor", "-c", "/ws"]));
  const methods = fake.received.filter((m) => m.method).map((m) => m.method);
  check("driver sends initialize, session/new, session/prompt",
    eq(methods, ["initialize", "session/new", "session/prompt"]), JSON.stringify(methods));
  const perm = fake.received.find((m) => m.id === 9001 && m.result);
  check("driver answers the permission request with allow", perm?.result?.outcome?.optionId === "allow_once");
  const read = fake.received.find((m) => m.id === 9002 && m.result);
  check("driver serves the fs read from the local fs", read?.result?.content === "file body");
}

// Resume: session/load is used and the same id comes back.
{
  const fake = fakeCline({ sessionId: "1790000_resumed_cli", chunks: ["ACP-OK"] });
  const res = await runClineAcp({ prompt: "again", sessionId: "1790000_resumed_cli", cwd: "/ws", spawnImpl: () => fake, fsImpl: fsStub });
  const methods = fake.received.filter((m) => m.method).map((m) => m.method);
  check("resume sends session/load, not session/new",
    methods.includes("session/load") && !methods.includes("session/new"), JSON.stringify(methods));
  check("resume keeps the same session id", res.sessionId === "1790000_resumed_cli");
  check("resume returns the new text", res.text === "ACP-OK");
}

// Timeout: an unanswered prompt rejects instead of hanging forever.
{
  const fake = fakeCline({ keepOpen: true });
  let rejected = false;
  try {
    await runClineAcp({ prompt: "hang", cwd: "/ws", timeoutMs: 60, spawnImpl: () => fake, fsImpl: fsStub });
  } catch (e) {
    rejected = /Timed out/.test(String(e.message));
  }
  check("a prompt that never answers times out", rejected);
}

// Wiring: index.js uses ACP and no longer one-shots cline --json.
const src = readFileSync(SRC, "utf8");
check("index imports cline-acp.js", src.includes('from "./cline-acp.js"'));
check("runCline uses runClineAcp", src.includes("await runClineAcp({"));
check("index no longer one-shots cline with --json", !/"--json",\s*q/.test(src) && !src.includes('args.push("--json", q)'));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error("\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
