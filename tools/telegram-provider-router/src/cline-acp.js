/**
 * Minimal ACP client for Cline — headless turns on a *resumable* task.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The router used `cline -m … -c … --thinking … --json "<prompt>"` for every
 * Telegram turn. That starts a NEW Cline task each time, so the chat had no
 * single conversation, and `/tui` had nothing to resume: the terminal opened a
 * different task than the reply came from (live bug, 2026-09-30).
 *
 * Cline's CLI cannot resume a task in one-shot image: `--id <session>` forces
 * `interactive:true` (it discards the prompt and requires a TTY), and
 * `--json` + `--id` is rejected outright. ACP is the supported headless door:
 * `cline --acp` speaks JSON-RPC over stdio, advertises `loadSession:true`, and
 * `session/load` continues the exact stored task. `session/new` returns the
 * same session id `cline --id` later resumes in its interactive TUI.
 *
 * The driver is injectable (`spawnImpl`) so the protocol handling is unit
 * tested against a fake child — no bot, no network, no Cline account.
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** CLI argv for ACP mode (prompt is sent over the protocol, never argv). */
export function buildAcpArgs({ model, cwd, thinking } = {}) {
  const args = ["--acp"];
  if (model) args.push("-m", String(model));
  if (cwd) args.push("-c", String(cwd));
  if (thinking) args.push("--thinking", String(thinking));
  return args;
}

/** The Cline CLI lives off the default PATH on this box; keep that PATH fix. */
export function clineAcpEnv(base = process.env) {
  return {
    ...base,
    PATH: `/home/box/.local/bin:/home/box/.local/n/bin:${base.PATH || ""}`,
  };
}

/** Text carried by a `session/update` notification (empty for other kinds). */
export function acpUpdateText(update) {
  if (!update || update.sessionUpdate !== "agent_message_chunk") return "";
  const c = update.content;
  if (c && c.type === "text" && typeof c.text === "string") return c.text;
  return "";
}

/**
 * The ACP permission response for `session/request_permission`. Prefer an
 * allow-ish option (the CLI runs with auto-approve by default), and fall back
 * to the first offered option so the agent is never left waiting.
 */
export function permissionResult(request) {
  const options = Array.isArray(request?.options) ? request.options : [];
  const allow = options.find((o) => /allow/i.test(String(o?.kind || o?.optionId || o?.name || "")));
  const optionId = allow?.optionId || options[0]?.optionId || "allow_always";
  return { outcome: { outcome: "selected", optionId } };
}

/**
 * Run one Cline turn over ACP and return `{ text, sessionId, stopReason }`.
 *
 * When `sessionId` is given the task is loaded (resumed); otherwise a new task
 * is created and its id returned so the caller can persist it per chat.
 *
 * Server-initiated requests are answered here: permission prompts use
 * `permissionResult`, and file reads/writes are served from the local fs (which
 * is what the CLI advertises when it talks ACP to an editor).
 */
export function runClineAcp({
  prompt,
  model,
  cwd,
  thinking,
  sessionId = null,
  timeoutMs = 1200000,
  clineBin = "cline",
  env = process.env,
  spawnImpl = spawn,
  fsImpl = fs,
  onSpawn = null,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(clineBin, buildAcpArgs({ model, cwd, thinking }), {
        cwd,
        env: clineAcpEnv(env),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      reject(new Error(`spawn failed: ${e?.message || e}`));
      return;
    }
    if (typeof onSpawn === "function") {
      try {
        onSpawn(child);
      } catch {
        /* pid tracking is best-effort */
      }
    }

    let settled = false;
    let nextId = 1;
    const pending = new Map();
    let out = "";
    let stderrTail = "";
    let activeSession = sessionId || null;
    const timer = setTimeout(() => fail(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {}
      try {
        child.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        } catch {}
      }, 3000).unref?.();
    }
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }
    const fail = (e) => finish(reject, e);

    function send(method, params) {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        try {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        } catch (e) {
          pending.delete(id);
          rej(e);
        }
      });
    }
    function respond(id, result) {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
      } catch {}
    }
    function respondError(id, message) {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: String(message) } })}\n`);
      } catch {}
    }

    function handleServerRequest(msg) {
      const { id, method, params } = msg;
      if (method === "session/request_permission") {
        respond(id, permissionResult(params));
        return;
      }
      if (method === "fs/read_text_file") {
        try {
          respond(id, { content: fsImpl.readFileSync(params.path, "utf8") });
        } catch (e) {
          respondError(id, e?.message || "read failed");
        }
        return;
      }
      if (method === "fs/write_text_file") {
        try {
          fsImpl.writeFileSync(params.path, params.content ?? "");
          respond(id, null);
        } catch (e) {
          respondError(id, e?.message || "write failed");
        }
        return;
      }
      respondError(id, `unsupported method: ${method}`);
    }

    const decoder = new StringDecoder("utf8");
    let buf = "";
    function handleLine(raw) {
      const line = raw.trim();
      if (!line || line.startsWith("[acp]")) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      // Server → client request (has both id and method).
      if (msg.id !== undefined && msg.method) {
        handleServerRequest(msg);
        return;
      }
      if (msg.method === "session/update") {
        out += acpUpdateText(msg.params?.update || {});
        return;
      }
      // Response to a client → server request.
      if (msg.id !== undefined && !msg.method) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "ACP error"));
        else p.resolve(msg.result);
      }
    }

    child.stdout.on("data", (d) => {
      buf += decoder.write(d);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        handleLine(line);
      }
    });
    child.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    child.on("error", (e) => {
      fail(new Error(e?.code === "ENOENT" ? `Command not found: ${clineBin}` : e?.message || String(e)));
    });
    child.on("close", (code) => {
      if (!settled) fail(new Error(stderrTail.trim().slice(0, 1000) || `cline --acp exited ${code}`));
    });

    (async () => {
      try {
        await send("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        });
        if (sessionId) {
          await send("session/load", { sessionId, cwd, mcpServers: [] });
          activeSession = sessionId;
        } else {
          const created = await send("session/new", { cwd, mcpServers: [] });
          activeSession = created?.sessionId || created?.session?.sessionId || null;
          if (!activeSession) throw new Error("ACP session/new returned no sessionId");
        }
        const r = await send("session/prompt", {
          sessionId: activeSession,
          prompt: [{ type: "text", text: String(prompt ?? "") }],
        });
        finish(resolve, { text: out.trim(), sessionId: activeSession, stopReason: r?.stopReason || null });
      } catch (e) {
        fail(e);
      }
    })();
  });
}
