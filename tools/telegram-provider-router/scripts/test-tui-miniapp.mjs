#!/usr/bin/env node
/**
 * Smoke: /tui on the standalone router.
 *
 *   cd tools/telegram-provider-router && node scripts/test-tui-miniapp.mjs
 *
 * WHY THIS FILE
 * -------------
 * `/tui` was declared "out of scope for Grok TG" in 86e284f and nothing failed
 * when a user asked for it — the command was simply absent from the popup. The
 * class of that failure is "a user-visible surface with no sensor", so this is
 * the sensor: the URL contract, the record the gateway-side attach reads, and
 * the published/handled pair, all asserted against the real tree.
 *
 * Pure functions only. No Telegram call, no polling, no live state: the router
 * is imported in `TG_ROUTER_NO_START=1` mode with `TG_ROUTER_STATE_DIR` on a
 * throwaway dir, exactly like scripts/test-sticky-failover.mjs.
 */
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const SRC = join(TOOL_DIR, "src", "index.js");
const MOD = join(TOOL_DIR, "src", "tui-miniapp.js");

const stateDir = mkdtempSync(join(tmpdir(), "ht-tui-miniapp-"));
process.env.TG_ROUTER_NO_START = "1";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:TEST-TOKEN";
process.env.TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || "1";
process.env.TG_ROUTER_STATE_DIR = stateDir;
process.env.TUI_GATEWAY_URL = "";

let mod;
let tui;
try {
  mod = await import(pathToFileURL(SRC).href);
  tui = await import(pathToFileURL(MOD).href);
} catch (e) {
  console.error(`Cannot import a router module: ${e.message}`);
  console.error("If this is a missing dependency, run: npm install  (inside tools/telegram-provider-router)");
  process.exit(2);
}

let passed = 0;
let failed = 0;
const check = (name, cond, got = "") => {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}${got ? ` — got ${got}` : ""}`);
    failed++;
  }
};

const src = readFileSync(SRC, "utf8");

// T1) the bot id is the token's left half, and a non-token falls back rather
// than putting a secret-shaped string in a URL.
check("T1 botIdFromToken reads the numeric id", tui.botIdFromToken("123456789:AA-abc") === "123456789");
check("T1b botIdFromToken ignores a password-shaped token", tui.botIdFromToken("not-a-token") === tui.DEFAULT_BOT_ID);

// T2) the gateway origin contract, copied from bot-host's readTuiUrl: a bare
// https origin or nothing. A path/query is refused, not silently dropped.
check("T2 a bare https origin is accepted",
  tui.resolveTuiUrl({ TUI_GATEWAY_URL: "https://tui.example.org" }) === "https://tui.example.org");
check("T2b a trailing slash is trimmed",
  tui.resolveTuiUrl({ TUI_GATEWAY_URL: "https://tui.example.org/" }) === "https://tui.example.org");
check("T2c plain http is refused", tui.resolveTuiUrl({ TUI_GATEWAY_URL: "http://tui.example.org" }) === "");
check("T2d a path is refused (would open the wrong door)",
  tui.resolveTuiUrl({ TUI_GATEWAY_URL: "https://tui.example.org/tty/" }) === "");
check("T2e unset is empty", tui.resolveTuiUrl({}) === "");

// T3) the button URL matches bot-host's shape exactly: /?bot=<id>.
check("T3 the button URL is the gateway root with ?bot=",
  tui.tuiButtonUrl({ gatewayUrl: "https://tui.example.org/", botId: "123456789" }) === "https://tui.example.org/?bot=123456789");
let threw = false;
try {
  tui.tuiButtonUrl({ gatewayUrl: "", botId: "1" });
} catch {
  threw = true;
}
check("T3b a missing origin throws instead of building a relative button", threw);

// T4) the record a gateway-side attach reads. Round trip, atomic-ish write,
// and a corrupt file degrades to null instead of throwing.
const wrote = tui.writeTuiOpen({ chatId: "42", botId: "123456789", provider: "opencode", sessionId: "ses_abc123", at: new Date().toISOString() }, { stateDir });
check("T4 writeTuiOpen lands the record", wrote && existsSync(join(stateDir, tui.TUI_OPEN_FILE)));
const back = tui.readTuiOpen({ stateDir });
check("T4b readTuiOpen round-trips the chat and session",
  back?.chatId === "42" && back?.sessionId === "ses_abc123", JSON.stringify(back));
check("T4c the file name is the one bot-host uses", tui.TUI_OPEN_FILE === "tui-open.json");
check("T4d no temp file is left behind", !existsSync(`${join(stateDir, tui.TUI_OPEN_FILE)}.tmp-${process.pid}`));
rmSync(join(stateDir, tui.TUI_OPEN_FILE), { force: true });
check("T4e a missing record reads as none", tui.readTuiOpen({ stateDir }) === null);

// T5) status is one line and never invents a lease this process does not own.
check("T5 no record says none open",
  tui.tuiStatusLine(null) === "tui: none open (open one with /tui)");
const line = tui.tuiStatusLine({ chatId: "42", provider: "opencode", sessionId: "ses_abc123def456", at: new Date(Date.now() - 120000).toISOString() }, { now: Date.now() });
check("T5b an open record names the chat, the lane and the age",
  /^tui: open for chat 42 · opencode · ses_abc123de…/.test(line) && /opened 2m ago/.test(line), line);

// T6) copy: plain text (the router sends no parse_mode) and it names the env
// var when there is nothing to open, so "broken" reads as "not set up yet".
check("T6 the open copy carries no markdown emphasis",
  !/[`*_]/.test(tui.tuiOpenText({ botId: "123456789", workspace: "/workspace/x" })));
check("T6b the offline copy names TUI_GATEWAY_URL",
  /TUI_GATEWAY_URL/.test(tui.tuiOfflineText({ env: {} })));
check("T6c a bad configured URL is repeated back so the typo is visible",
  /not a bare https origin/.test(tui.tuiOfflineText({ env: { TUI_GATEWAY_URL: "http://x/y" } })));
check("T6d /tui off with no record is not an error", /nothing to forget/.test(tui.tuiOffText(null)));

// T7) published == handled == declared. The repo-wide gate
// (scripts/assert-command-scope.mjs) does this across both bots; this pins the
// router half locally so the tool's own `npm test` catches a regression.
check("T7 the router publishes /tui",
  [...src.matchAll(/command:\s*"tui"/g)].length === 1);
check("T7b the router registers a /tui handler",
  [...src.matchAll(/bot\.command\("tui"/g)].length === 1);
check("T7c /help mentions /tui", /\/tui \[status\|off\]/.test(src));
check("T7d the bot id comes from the token, not a literal",
  /botIdFromToken\(TOKEN\)/.test(src) && /ROUTER_BOT_ID/.test(src));
check("T7e the record path is the router's own state dir",
  /writeTuiOpen\(/.test(src) && /stateDir:\s*STATE_DIR/.test(src));

// T8) the import surface other tests and scripts rely on.
check("T8 the router exports ROUTER_BOT_ID for scripts",
  typeof mod.ROUTER_BOT_ID === "string" && mod.ROUTER_BOT_ID.length > 0);
check("T8b the router exports the state file name", mod.TUI_OPEN_FILE === "tui-open.json");

try {
  rmSync(stateDir, { recursive: true, force: true });
} catch {
  /* temp dir */
}

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
