#!/usr/bin/env node
/**
 * `/tui` must attach to the provider the chat is ACTUALLY using.
 *
 *   cd tools/telegram-provider-router && node scripts/test-tui-provider.mjs
 *
 * The regression is the live bug of 2026-09-30: provider `cline`, but the
 * terminal ran `opencode attach …`, so the TUI showed a different model and a
 * different conversation. Every case below pins the mapping that prevents it.
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  buildAttachArgv,
  tuiAttachPlan,
  tuiAttachable,
  tuiNoSessionText,
  tuiSwitchKeyboard,
  tuiUnsupportedText,
  TUI_ATTACHABLE,
} from "../src/tui-provider.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src", "index.js");
const BASH = join(HERE, "..", "box", "tui-attach-router.sh");

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

console.log("test-tui-provider\n");

const WS = "/workspace/biomarker-and-nutrient-tracker";

// Attachability table.
check("opencode has a TUI", tuiAttachable("opencode"));
check("cline has a TUI", tuiAttachable("cline"));
for (const p of ["freebuff", "tokenharbor", "commandcode", "cloudflare"]) {
  check(`${p} has no TUI`, !tuiAttachable(p));
}

// opencode argv (v1 CLI attach form).
check(
  "opencode attaches the chat's ses_ session",
  eq(buildAttachArgv({ provider: "opencode", sessionId: "ses_abc", workspace: WS }), [
    "/home/box/.local/bin/opencode",
    "attach",
    "http://127.0.0.1:4096",
    "--dir",
    WS,
    "-s",
    "ses_abc",
  ])
);
check(
  "opencode without a session still opens a fresh terminal",
  eq(buildAttachArgv({ provider: "opencode", workspace: WS }), [
    "/home/box/.local/bin/opencode",
    "attach",
    "http://127.0.0.1:4096",
    "--dir",
    WS,
  ])
);

// cline argv (interactive TUI resumed on the task).
check(
  "cline resumes the chat's task id in the TUI",
  eq(buildAttachArgv({ provider: "cline", sessionId: "1790000_xyz_cli", workspace: WS, model: "cline-free/muse-spark-1.3-contributor" }), [
    "cline",
    "-i",
    "--id",
    "1790000_xyz_cli",
    "-m",
    "cline-free/muse-spark-1.3-contributor",
    "-c",
    WS,
  ])
);
check("cline with no task builds no argv (never opens a fresh, different task)", buildAttachArgv({ provider: "cline", workspace: WS, model: "m" }) === null);
check("unsupported provider builds no argv", buildAttachArgv({ provider: "tokenharbor", workspace: WS }) === null);

// REGRESSION: provider cline must never yield an opencode command.
{
  const plan = tuiAttachPlan({
    provider: "cline",
    providerLabel: "Cline",
    model: "cline-free/muse-spark-1.3-contributor",
    modelLabel: "muse spark 1.3 contributor free",
    sessionId: "1790000_xyz_cli",
    workspace: WS,
  });
  check("cline plan kind is cline", plan.kind === "cline");
  check("cline plan argv[0] is cline, NOT opencode", plan.argv?.[0] === "cline" && !plan.argv.includes("attach"));
  check("cline plan carries the task id", plan.sessionId === "1790000_xyz_cli");
  check("cline plan does not claim opencode", plan.kind !== "opencode");
}

// Unsupported provider → honest reply + switch buttons, never a terminal.
{
  const plan = tuiAttachPlan({ provider: "tokenharbor", providerLabel: "Token Harbor", modelLabel: "deepseek v4.1 flash free", workspace: WS });
  check("unsupported plan is not attachable", !plan.attachable);
  check("unsupported plan reason is unsupported", plan.reason === "unsupported");
  check("unsupported plan offers attachable providers", eq(plan.switchTo, [...TUI_ATTACHABLE]));
  const text = tuiUnsupportedText({ provider: "tokenharbor", providerLabel: "Token Harbor", modelLabel: "deepseek v4.1 flash free" });
  check("unsupported text names the active provider", /Token Harbor/.test(text));
  check("unsupported text refuses a mismatched terminal", /different conversation|mismatched/i.test(text));
  const rows = tuiSwitchKeyboard(plan.switchTo);
  check("switch keyboard has a row per provider", rows.length === 2 && rows[0][0].callback_data === "tui_switch:opencode");
}

// Cline with no task yet → say so, don't open a different task.
{
  const plan = tuiAttachPlan({ provider: "cline", providerLabel: "Cline", modelLabel: "muse spark free", sessionId: null, workspace: WS });
  check("cline with no task is not attachable", !plan.attachable);
  check("cline with no task reason is no-session", plan.reason === "no-session");
  check("no-session text tells the user to send a message first", /Send a message first/i.test(tuiNoSessionText({ providerLabel: "Cline" })));
}

// Wiring: the handler persists provider/model/task and uses the plan.
const src = readFileSync(SRC, "utf8");
check("index imports tui-provider.js", src.includes('from "./tui-provider.js"'));
check("handler builds a plan", src.includes("tuiAttachPlan({ provider, providerLabel, model, modelLabel, sessionId, workspace: WORKSPACE })"));
check("handler reads the active provider's session", src.includes("getProviderSid(state, provider, chatId)"));
check("record persists the provider", /provider,\n\s+model: model \|\| null,\n\s+modelLabel,/.test(src));
check("non-attachable path replies instead of writing a record", src.includes("if (!plan.attachable) {"));
check("switch buttons route through switchProviderMessage", src.includes("switchProviderMessage(provider)"));

// Wiring: the box attach script mirrors the mapping (case on provider).
if (existsSync(BASH)) {
  const bash = readFileSync(BASH, "utf8");  check("box attach script branches on the recorded provider", /case "\$PROVIDER" in/.test(bash));
  check("box attach script resumes the cline task with --id", /--id "\$SESSION"/.test(bash));
  check("box attach script runs opencode attach for opencode", /attach "\$OPENCODE_SERVER"/.test(bash));
  check("box attach script is provider-aware, not opencode-only", /PROVIDER="\$\{PROVIDER:-opencode\}"/.test(bash));
} else {
  check("box attach script present for mapping mirror", false, BASH);
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error("\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
