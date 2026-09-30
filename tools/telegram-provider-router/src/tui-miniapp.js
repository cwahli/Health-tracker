/**
 * /tui on the standalone router — the same Telegram Mini App door bot-host
 * opens, with nothing invented on the side.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Commit 86e284f declared `/tui` out of scope for the Grok TG router, on the
 * grounds that "the router has no session/chat model and no ttyd, so it cannot
 * serve this command by construction". The first half of that was wrong: the
 * router has kept a per-chat OpenCode session map since BOT-22
 * (`src/chat-sessions.js`). The second half was true only of *this* box — the
 * terminal itself is a ttyd behind `scripts/tui-gateway.mjs`, which is not part
 * of either bot. So the router can hand out the same button bot-host hands out;
 * it just needs the same URL contract.
 *
 * The contract, copied from `scripts/bot-host.mjs` `readTuiUrl()`:
 *   TUI_GATEWAY_URL is an https origin (never the website host), and `/tui`
 *   opens `<origin>/?bot=<id>`. The gateway does the `initData` HMAC against
 *   `TUI_BOT_TOKEN_<ID>` and issues the session token; the router holds no
 *   terminal credential and never sees one.
 *
 * Everything here is a pure function of its arguments so the tests can drive it
 * without a bot, a network, or the live state dir. The handler in `index.js`
 * is the only place that talks to Telegram.
 */
import fs from "node:fs";
import { join } from "node:path";

/** The recorded "which chat opened the terminal" file, same name as bot-host's. */
export const TUI_OPEN_FILE = "tui-open.json";

/** Fallback bot id when the token is absent (import mode / tests). */
export const DEFAULT_BOT_ID = "grok_tg";

/**
 * Telegram bot ids are the left half of the token: `123456:AA…` -> `123456`.
 * The id (not the token) is what goes in the Mini App URL, and the token is
 * never logged or written down here.
 */
export function botIdFromToken(token, fallback = DEFAULT_BOT_ID) {
  const left = String(token || "").split(":")[0].trim();
  return /^[0-9]{5,}$/.test(left) ? left : fallback;
}

/**
 * The gateway origin `/tui` should point at, or "" when none is configured.
 *
 * Same shape bot-host accepts: a bare https origin. A path or query is refused
 * rather than silently dropped, because `https://host/tty/` pasted into the env
 * would otherwise produce a button that opens the wrong door.
 */
export function resolveTuiUrl(env = process.env) {
  const raw = String(env.TUI_GATEWAY_URL || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[A-Za-z0-9.-]+$/.test(raw) ? raw : "";
}

/** The Mini App URL for a bot. Throws only on a programming error (no origin). */
export function tuiButtonUrl({ gatewayUrl, botId }) {
  if (!resolveTuiUrl({ TUI_GATEWAY_URL: gatewayUrl })) {
    throw new Error("tuiButtonUrl needs an https gateway origin");
  }
  return `${String(gatewayUrl).replace(/\/+$/, "")}/?bot=${encodeURIComponent(botId)}`;
}

export function tuiOpenPath(stateDir) {
  return join(stateDir, TUI_OPEN_FILE);
}

/**
 * Remember which chat opened the terminal and which lane it is on.
 *
 * ttyd runs ONE static command per bot, so it cannot be told the chat any other
 * way; this file is what a per-chat attach script reads. Written tmp+rename so a
 * reader never sees a half-written file, and never fatal: a missing write just
 * leaves the terminal unattached to a conversation, which is the old behaviour.
 */
export function writeTuiOpen(record, { stateDir, fsImpl = fs } = {}) {
  if (!stateDir) return false;
  try {
    const target = tuiOpenPath(stateDir);
    const tmp = `${target}.tmp-${process.pid}`;
    fsImpl.mkdirSync(stateDir, { recursive: true });
    fsImpl.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    fsImpl.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

/** Read the record back. Never throws: a missing/corrupt file is "none". */
export function readTuiOpen({ stateDir, fsImpl = fs } = {}) {
  if (!stateDir) return null;
  try {
    const j = JSON.parse(fsImpl.readFileSync(tuiOpenPath(stateDir), "utf8"));
    if (!j || typeof j !== "object") return null;
    if (!j.chatId) return null;
    return j;
  } catch {
    return null;
  }
}

/** Human age, matching the router's other short stamps (`2m`, `3h`, `1d`). */
export function humanAge(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * One line for /tui status. Mirrors bot-host's `tuiStatusLine` shape without
 * inventing a lease this process does not own: the router knows what it handed
 * out, and says only that.
 */
export function tuiStatusLine(record, { now = Date.now() } = {}) {
  if (!record || !record.chatId) return "tui: none open (open one with /tui)";
  const age = record.at && Number.isFinite(Date.parse(record.at))
    ? ` · opened ${humanAge(now - Date.parse(record.at))} ago`
    : "";
  const sess = record.sessionId ? ` · ${String(record.sessionId).slice(0, 12)}…` : "";
  const lane = record.provider ? ` · ${record.provider}` : "";
  const gw = record.gatewayUrl ? ` · ${record.gatewayUrl}` : "";
  return `tui: open for chat ${record.chatId}${lane}${sess}${age}${gw}`;
}

/**
 * The message that accompanies the button. Plain text on purpose: the router
 * sends no `parse_mode`, so markdown here would reach the user as asterisks and
 * backticks rather than emphasis.
 */
export function tuiOpenText({ botId, workspace, moved = false } = {}) {
  return [
    moved ? "⚠️ The tunnel was reconnected, so any earlier /tui button is dead — use this one." : null,
    `⌨️ Terminal — a real OpenCode terminal for this chat${workspace ? ` in ${workspace}` : ""}.`,
    "It runs under tmux on the gateway host, so closing the Mini App keeps your place.",
    "We both keep working with it open: the terminal waits for a turn I am running, and I wait for a turn you started — one writer at a time.",
    `Opening it proves you are the Telegram user this chat belongs to (the gateway checks the Mini App initData against bot ${botId}), so there is no password to remember.`,
  ].filter(Boolean).join("\n");
}

/**
 * What to say when there is no gateway URL. Same shape as bot-host's, because
 * it is the same fact: the terminal is a separate service on its own hostname,
 * and until it is configured there is nothing to open. Naming the env var is
 * the difference between "broken" and "not set up yet".
 */
export function tuiOfflineText({ env = process.env } = {}) {
  const configured = String(env.TUI_GATEWAY_URL || "").trim();
  return [
    "⌨️ TUI is not served from this machine yet.",
    configured
      ? `TUI_GATEWAY_URL is set to "${configured}", which is not a bare https origin — the button needs one (e.g. https://tui.example.org).`
      : "Set TUI_GATEWAY_URL to the gateway's https origin (see docs/TUI_ROUTER.md in the router folder), and make sure the gateway holds this bot's token, then try /tui again.",
    "The gateway is a separate service on its own hostname and is gated on Telegram initData, so a public terminal is never anonymous.",
  ].join("\n");
}

/** `/tui off`: the router hands the terminal out, it does not own the pane. */
export function tuiOffText(record) {
  if (!record) return "⌨️ No TUI has been opened from this chat — nothing to forget.";
  return [
    `⌨️ Cleared the terminal record for chat ${record.chatId}.`,
    "The pane itself lives on the gateway host (ttyd under tmux), not on the router — close it there, or leave it; it is idle and costs nothing while closed.",
  ].join("\n");
}
