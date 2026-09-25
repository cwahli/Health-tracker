#!/usr/bin/env node
/**
 * Unit tests for the Freebuff Telegram lane (src/freebuff-tg-lane.js).
 *
 *   cd tools/telegram-provider-router && node scripts/test-freebuff-tg-lane.mjs
 *
 * The lane is EXPERIMENTAL and off by default (FREEBUFF_TG_LANE=1 to enable):
 * with 0 Freebucks until 2026-10-16 and a live human CLI session owning the
 * account, NOTHING here may start a real freebuff instance or spend balance.
 * Every test drives a scripted fake exec + stub fetch + temp creds/owner
 * files. Pure-logic core: no network, no child processes, no live ledger.
 */
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  freebuffLaneEnabled,
  isZeroHrModel,
  stripChrome,
  pickerChoiceFor,
  readFreebucksBalance,
  humanSessionActive,
  tryAcquireLane,
  releaseLane,
  runFreebuffLane,
} from "../src/freebuff-tg-lane.js";

let passed = 0;
const failures = [];
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failures.push(name);
      console.log(`  ✗ ${name}\n      ${e.message}`);
    });
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "eq"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const DIR = mkdtempSync(join(tmpdir(), "fb-lane-"));
const creds = (token = "TESTTOKEN") => {
  const p = join(DIR, `creds-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ default: { authToken: token, fingerprintId: "fp1" } }));
  return p;
};
const owner = (pid) => {
  const p = join(DIR, `owner-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ instanceId: "x", pid }));
  return p;
};
const DEAD_PID = 4000000000; // never alive
// Freebucks POOL stub: /api/v1/freebuff/session (NOT /api/v1/usage — the wallet
// is a different currency and read 0 while the pool had 10/25).
const fetchBalance = (poolRemaining) => async (url) => {
  const u = String(url || "");
  if (!u.includes("/api/v1/freebuff/session")) return { ok: false, status: 404, json: async () => ({}) };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      accessTier: "limited",
      freebucks: {
        balance: poolRemaining,
        daily: { limit: 25, spent: 25 - poolRemaining, remaining: poolRemaining, resetAt: "2026-09-26T17:00:00.000Z" },
        wallet: { balance: 0 },
      },
    }),
  };
};
const noSleep = async () => {};
const baseEnv = { FREEBUFF_TG_LANE: "1" };
const fastTimeouts = { taskPromptMs: 200, workingAppearMs: 200, totalMs: 500, pollMs: 5, quietMs: 20 };

const tests = [];

// ---- gate + units ----
tests.push(["gate off by default", () => {
  eq(freebuffLaneEnabled({}), false, "unset → off");
  eq(freebuffLaneEnabled({ FREEBUFF_TG_LANE: "0" }), false, "0 → off");
  eq(freebuffLaneEnabled({ FREEBUFF_TG_LANE: "1" }), true, "1 → on");
}]);

tests.push(["isZeroHrModel: only the published 0-FB model, not the old 0/hr claims", () => {
  // Corrected 2026-09-25 from freebucks.prices: space-bunny-alpha is 0;
  // GLM 5.3 is 5 FB and mimo-v2.6 is not published, so neither is "free".
  ok(isZeroHrModel("stealth/space-bunny-alpha"), "space bunny alpha is 0 FB");
  ok(isZeroHrModel("Space Bunny Alpha · free · 0 FB"), "0 FB label");
  eq(isZeroHrModel("z-ai/glm-5.3-flash"), false, "GLM 5.3 costs 5 FB, not 0");
  eq(isZeroHrModel("xiaomi/mimo-v2.6-flash"), false, "mimo-v2.6 not published");
  eq(isZeroHrModel(""), false, "empty");
}]);

tests.push(["stripChrome drops TUI lines, keeps reply", () => {
  const out = stripChrome("working...\nThe fix is in auth.js\n\nEnter a coding task\nSession ended · 5 Freebucks left");
  eq(JSON.stringify(out), JSON.stringify(["The fix is in auth.js"]), "reply only");
}]);

tests.push(["pickerChoiceFor matches on model words, needs 2+ shared tokens", () => {
  const menu = ["Select a model:", "  1) Muse 2.1 (45/hr)", "  2) GLM 5.3 Flash (0/hr)", "  3) Space Bunny Alpha (0/hr)"];
  eq(pickerChoiceFor(menu, "z-ai/glm-5.3-flash"), "2", "glm → 2");
  eq(pickerChoiceFor(menu, "stealth/space-bunny-alpha"), "3", "space bunny → 3");
  eq(pickerChoiceFor(menu, "deepseek/deepseek-v4-flash"), "", "no deepseek entry → default Enter");
  // One shared word must NOT be enough (would pick Muse for muse-spark).
  eq(pickerChoiceFor(["  1) Muse 2.1 (45/hr)"], "meta/muse-spark-1.3-contributor"), "", "single-word match refused");
  eq(pickerChoiceFor(["Enter a coding task"], "z-ai/glm-5.3-flash"), "", "no menu → default Enter");
}]);

tests.push(["readFreebucksBalance reads the POOL endpoint, not the wallet", async () => {
  const r = await readFreebucksBalance({ fetchFn: fetchBalance(10), credsPath: creds() });
  eq(r.balance, 10, "pool remaining (wallet 0 must not be used)");
  eq(r.walletBalance, 0, "wallet reported separately");
  eq(r.resetAt, "2026-09-26T17:00:00.000Z", "pool daily reset, not the Oct wallet reset");
  const missing = await readFreebucksBalance({ fetchFn: fetchBalance(5), credsPath: join(DIR, "nope.json") });
  eq(missing.error, "not signed in", "missing creds");
}]);

tests.push(["humanSessionActive: live pid yields, dead pid does not", () => {
  eq(humanSessionActive({ ownerPath: owner(process.pid) }), true, "own pid alive → active");
  eq(humanSessionActive({ ownerPath: owner(DEAD_PID) }), false, "dead pid → idle");
  eq(humanSessionActive({ ownerPath: join(DIR, "nope.json") }), false, "no file → idle");
}]);

// ---- lane runs (scripted fakes; exec must stay silent unless stated) ----
tests.push(["lane off → refuses without touching exec", async () => {
  let calls = 0;
  const r = await runFreebuffLane({
    prompt: "hi", env: {}, exec: async () => { calls++; return { stdout: "", code: 0 }; },
    sleep: noSleep, credsPath: creds(), ownerPath: owner(DEAD_PID), timeouts: fastTimeouts,
  });
  eq(r.ok, false, "not ok");
  eq(calls, 0, "exec untouched");
}]);

tests.push(["balance 0 + paid model → honest empty, no session spawned", async () => {
  let calls = 0;
  const r = await runFreebuffLane({
    prompt: "hi", model: "deepseek/deepseek-v4.1-flash", env: baseEnv,
    fetchFn: fetchBalance(0), credsPath: creds(), ownerPath: owner(DEAD_PID),
    exec: async () => { calls++; return { stdout: "", code: 0 }; },
    sleep: noSleep, timeouts: fastTimeouts,
  });
  eq(r.ok, false, "not ok");
  ok(/pool is empty/i.test(r.text), "names the empty pool");
  eq(calls, 0, "no tmux spawned");
}]);

tests.push(["live human session → yields, never spawns", async () => {
  let calls = 0;
  const r = await runFreebuffLane({
    prompt: "hi", model: "z-ai/glm-5.3-flash", env: baseEnv,
    fetchFn: fetchBalance(0), credsPath: creds(), ownerPath: owner(process.pid),
    exec: async () => { calls++; return { stdout: "", code: 0 }; },
    sleep: noSleep, timeouts: fastTimeouts,
  });
  eq(r.ok, false, "not ok");
  ok(/yields/i.test(r.text), "yields to terminal");
  eq(calls, 0, "no second instance (take-over guard)");
}]);

tests.push(["busy lane → honest busy verdict", async () => {
  ok(tryAcquireLane(), "take lock");
  try {
    const r = await runFreebuffLane({
      prompt: "hi", env: baseEnv, fetchFn: fetchBalance(9), credsPath: creds(),
      ownerPath: owner(DEAD_PID), exec: async () => { throw new Error("must not run"); },
      sleep: noSleep, timeouts: fastTimeouts,
    });
    eq(r.ok, false, "not ok");
    ok(/busy/i.test(r.text), "busy verdict");
  } finally {
    releaseLane();
  }
}]);

tests.push(["balance probe failure → honest, no session", async () => {
  let calls = 0;
  const r = await runFreebuffLane({
    prompt: "hi", env: baseEnv, fetchFn: async () => { throw new Error("net down"); },
    credsPath: creds(), ownerPath: owner(DEAD_PID),
    exec: async () => { calls++; return { stdout: "", code: 0 }; },
    sleep: noSleep, timeouts: fastTimeouts,
  });
  eq(r.ok, false, "not ok");
  ok(/balance check failed/i.test(r.text), "names probe failure");
  eq(calls, 0, "no session on uncertain balance");
}]);

tests.push(["full stub run with menu pick → reply extracted, session killed, lock freed", async () => {
  const TASK = "Enter a coding task";
  const MENU = ["Select a model:", "  1) Muse 2.1 (45/hr)", "  2) GLM 5.3 Flash (0/hr)", "  3) Space Bunny Alpha (0/hr)", TASK].join("\n");
  const REPLY = ["fix auth", "The fix is in auth.js line 42", "Restart the service after editing"].join("\n");
  let phase = "task";
  let killed = 0;
  const seen = [];
  const exec = async (argv) => {
    seen.push(argv.join(" "));
    const sub = argv[1];
    if (sub === "kill-session") { killed++; phase = "dead"; return { stdout: "", code: 0 }; }
    if (sub === "new-session") { phase = "task"; return { stdout: "", code: 0 }; }
    if (sub === "send-keys") {
      const last = argv[argv.length - 1];
      if (phase === "task" && last === "Enter") phase = "menu";
      else if (phase === "menu" && last === "3") phase = "picked";
      else if (phase === "picked" && last === "Enter") phase = "waitFresh";
      else if (argv.includes("-l")) phase = "working";
      else if (phase === "working" && last === "Enter") phase = "replyWait";
      return { stdout: "", code: 0 };
    }
    if (sub === "capture-pane") {
      if (phase === "task") return { stdout: TASK, code: 0 };
      if (phase === "menu" || phase === "picked") return { stdout: MENU, code: 0 };
      if (phase === "waitFresh") return { stdout: TASK, code: 0 };
      if (phase === "working") return { stdout: "working...", code: 0 };
      if (phase === "replyWait") { phase = "replied"; return { stdout: "working...", code: 0 }; }
      return { stdout: REPLY, code: 0 };
    }
    return { stdout: "", code: 0 };
  };
  const r = await runFreebuffLane({
    prompt: "fix auth", model: "stealth/space-bunny-alpha", session: "tg-fb-test", env: baseEnv,
    fetchFn: fetchBalance(10), credsPath: creds(), ownerPath: owner(DEAD_PID),
    exec, sleep: noSleep, timeouts: { ...fastTimeouts, totalMs: 2000 },
  });
  eq(r.ok, true, `lane ok (${r.text.slice(0, 80)})`);
  ok(r.text.includes("The fix is in auth.js line 42"), "reply line kept");
  ok(!/working\.\.\.|Enter a coding task/.test(r.text), "no chrome in reply");
  ok(!r.text.split("\n").includes("fix auth"), "prompt echo dropped");
  ok(seen.some((s) => /(^|\s)3$/.test(s)), "menu digit 3 typed for Space Bunny Alpha");
  eq(killed, 2, "pre-kill + finally kill");
  // lock freed: an immediate second run reaches the balance gate (fails there, not busy)
  const r2 = await runFreebuffLane({
    prompt: "hi", model: "deepseek/deepseek-v4.1-flash", env: baseEnv,
    fetchFn: fetchBalance(0), credsPath: creds(), ownerPath: owner(DEAD_PID),
    exec, sleep: noSleep, timeouts: fastTimeouts,
  });
  ok(/pool is empty/i.test(r2.text), "second run not stuck busy");
}]);

tests.push(["no working activity → timeout verdict + cleanup", async () => {
  let killed = 0;
  const exec = async (argv) => {
    if (argv[1] === "kill-session") { killed++; return { stdout: "", code: 0 }; }
    if (argv[1] === "capture-pane") return { stdout: "Enter a coding task", code: 0 };
    return { stdout: "", code: 0 };
  };
  const r = await runFreebuffLane({
    prompt: "hi", model: "z-ai/glm-5.3-flash", env: baseEnv,
    fetchFn: fetchBalance(5), credsPath: creds(), ownerPath: owner(DEAD_PID),
    exec, sleep: noSleep, timeouts: { ...fastTimeouts, workingAppearMs: 30, totalMs: 300 },
  });
  eq(r.ok, false, "not ok");
  ok(/never showed activity|did not reach/i.test(r.text), "timeout verdict");
  ok(killed >= 2, "session cleaned up");
}]);

// ---- run ----
for (const [name, fn] of tests) await t(name, fn);
console.log("");
if (failures.length) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: all ${passed} checks passed`);
process.exit(0);
