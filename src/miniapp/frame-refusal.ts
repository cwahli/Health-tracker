/**
 * Framed-tab refusal detection (the Hotels "bad token" hole, live 2026-10-11).
 *
 * A framed tab is born with the shell's page token baked into its own src.
 * When that credential is dead past the renewal grace the frame would load
 * the gateway's refusal JSON instead of the app. The shell now refuses to
 * mount frames on a refused credential (switch-time renewal 401 → sign-in
 * wall), and the terminal tab probes its frame with the shared detector
 * below — one definition for the refusal shape, pinned by the sensor.
 *
 * Pure helpers only (no JSX, no DOM) so the sensor can pin them without a
 * browser.
 */

/** True when the text is the gateway's refusal JSON. Whitespace-tolerant:
 * Chrome pretty-prints served JSON (newlines/spaces), so the raw innerText
 * of a refused frame never starts with `{"ok"` directly. */
export function isRefusalText(text: string): boolean {
  try {
    return String(text || '')
      .replace(/\s+/g, '')
      .startsWith('{"ok":false');
  } catch {
    return false;
  }
}
