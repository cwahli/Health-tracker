/**
 * Provider → attach-command mapping for `/tui`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `/tui` used to hand out one terminal regardless of the active provider, and
 * the box glue always ran `opencode attach …`. Live, on 2026-09-30, the chat's
 * provider was `cline` (Muse Spark 1.3), so the TUI opened a *different* model
 * and a *different* conversation than the Telegram reply came from.
 *
 * The mapping is a pure function of the plan, so it can be unit-tested without
 * a bot, a network, or the live state dir. The handler in `index.js` calls it;
 * the box attach script mirrors the argv it produces.
 */

/** Providers whose active conversation a terminal can attach to. */
export const TUI_ATTACHABLE = Object.freeze(["opencode", "cline"]);
/** Providers that answer Telegram but expose no attachable interactive terminal. */
export const TUI_UNSUPPORTED = Object.freeze(["freebuff", "tokenharbor", "commandcode", "cloudflare"]);

export function tuiAttachable(provider) {
  return TUI_ATTACHABLE.includes(provider);
}

/**
 * The argv a terminal should run for a provider.
 *
 * - opencode: the box's v1 CLI attaches to the live server and resumes the
 *   chat's `ses_…` session (`opencode attach <url> --dir <ws> -s <sid>`).
 * - cline: the Cline CLI resumes an existing task id in its interactive TUI
 *   (`cline -i --id <sid> -m <model> -c <ws>`). `--id` requires a session: a
 *   fresh `cline -i` would be a different conversation, which is the bug.
 *
 * Returns `null` for a provider with no attachable terminal.
 */
export function buildAttachArgv({
  provider,
  sessionId,
  workspace,
  model,
  opencodeBin = "/home/box/.local/bin/opencode",
  opencodeServer = "http://127.0.0.1:4096",
  clineBin = "cline",
} = {}) {
  if (provider === "opencode") {
    const argv = [opencodeBin, "attach", opencodeServer, "--dir", workspace];
    if (sessionId) argv.push("-s", String(sessionId));
    return argv;
  }
  if (provider === "cline") {
    if (!sessionId) return null;
    return [clineBin, "-i", "--id", String(sessionId), "-m", model || "", "-c", workspace];
  }
  return null;
}

/**
 * Decide what `/tui` should do for the active provider.
 *
 * Returns `{ attachable, kind, sessionRef, argv, header }` when a terminal can
 * open, or `{ attachable:false, reason, switchTo }` when it cannot:
 *   - `reason: "unsupported"` — the provider has no TUI at all (freebuff,
 *     tokenharbor, commandcode); the reply offers buttons to switch.
 *   - `reason: "no-session"` — cline has a TUI but this chat has no task yet;
 *     opening a fresh one would be the mismatch again, so say so.
 */
export function tuiAttachPlan({
  provider,
  model = "",
  modelLabel = "",
  providerLabel = "",
  sessionId = null,
  workspace = "",
  opencodeBin,
  opencodeServer,
  clineBin,
} = {}) {
  const label = providerLabel || provider;
  const base = { provider, providerLabel: label, model, modelLabel, sessionId: sessionId || null, workspace };
  if (!tuiAttachable(provider)) {
    return { ...base, attachable: false, kind: "unsupported", reason: "unsupported", argv: null, switchTo: [...TUI_ATTACHABLE] };
  }
  if (provider === "cline" && !sessionId) {
    return { ...base, attachable: false, kind: "cline", reason: "no-session", argv: null, switchTo: [] };
  }
  const argv = buildAttachArgv({ provider, sessionId, workspace, model, opencodeBin, opencodeServer, clineBin });
  return { ...base, attachable: true, kind: provider, reason: null, argv, switchTo: [] };
}

/**
 * The honest reply when the active provider has no attachable terminal. It
 * names the provider that is actually answering, and tells the user which
 * providers do have a terminal.
 */
export function tuiUnsupportedText({ providerLabel, modelLabel, provider } = {}) {
  const who = providerLabel || provider || "this provider";
  const modelBit = modelLabel ? ` (${modelLabel})` : "";
  return [
    `⌨️ ${who}${modelBit} is answering this chat, but it has no attachable terminal — the Mini App would open a different conversation, so I will not hand out a mismatched one.`,
    `Providers with a terminal: ${TUI_ATTACHABLE.join(", ")}. Switch with the button below and run /tui again.`,
  ].join("\n");
}

/** The honest reply when cline is active but this chat has no task yet. */
export function tuiNoSessionText({ providerLabel, modelLabel } = {}) {
  const who = providerLabel || "Cline";
  return [
    `⌨️ ${who}${modelLabel ? ` (${modelLabel})` : ""} is active, but this chat has no task yet — there is nothing to resume.`,
    "Send a message first, then run /tui: the terminal will resume the exact task your Telegram reply came from.",
  ].join("\n");
}

/**
 * Inline keyboard rows offering the attachable providers. `data` is the
 * callback payload the handler answers with the same switch path as /switch.
 */
export function tuiSwitchKeyboard(switchTo = TUI_ATTACHABLE) {
  return switchTo.map((provider) => [{ text: `Switch to ${provider}`, callback_data: `tui_switch:${provider}` }]);
}
