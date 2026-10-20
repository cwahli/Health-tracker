/**
 * wa-gateway-lib: pure helpers for the unofficial WhatsApp companion gateway
 * (scripts/wa-gateway.mjs). Kept dependency-free so sensors stay hermetic.
 *
 * Source of truth for the login-code shape is server_whatsapp.parseLoginCode
 * (TS, not importable from plain node): exactly one `wa_<32hex>`, lowercase.
 * If that regex ever changes, mirror it here.
 */

export function parseGatewayCode(text) {
  if (typeof text !== 'string') return null;
  const matches = text.match(/wa_[0-9a-f]{32}/gi);
  if (!matches || matches.length !== 1) return null;
  return matches[0].toLowerCase();
}

/** Message text a user could have typed a code into (plain or caption). */
export function extractGatewayText(msg) {
  try {
    const m = msg?.message;
    if (!m) return null;
    if (typeof m.conversation === 'string' && m.conversation) return m.conversation;
    if (typeof m.extendedTextMessage?.text === 'string' && m.extendedTextMessage.text) {
      return m.extendedTextMessage.text;
    }
    if (typeof m.imageMessage?.caption === 'string' && m.imageMessage.caption) {
      return m.imageMessage.caption;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sender identity = the chat the message arrived in. Direct chats only:
 * groups (@g.us), channels (@newsletter) and status (@broadcast) never
 * verify. Returns digits-only wa_id (BSUID user parts pass through as-is
 * when they are already non-JID ids) or null.
 */
export function extractGatewayWaId(remoteJid) {
  if (typeof remoteJid !== 'string') return null;
  if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter') || remoteJid === 'status@broadcast') {
    return null;
  }
  const user = remoteJid.split('@')[0];
  if (!user) return null;
  if (user.includes(':') || user.includes('-')) return null; // device suffix / odd forms
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(user)) return null;
  return user;
}
