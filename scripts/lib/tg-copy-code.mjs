// tg-copy-code.mjs — shared "copy code" feature for every Telegram bot runner.
//
// Problem: on mobile, a ``` fenced snippet sent as plain text (or as legacy
// Markdown without a language) renders without Telegram's native copy button,
// so users must long-press the whole bubble and drag-select the snippet.
//
// What this module does (two mechanisms, both standard Telegram Bot API):
//   1. Native code blocks: converts ```lang fences to HTML
//      <pre><code class="language-X"> so Telegram clients show tap-to-copy.
//   2. Copy buttons: attaches InlineKeyboard copy_text buttons (1-256 chars
//      each, no callback handling needed — the client copies locally) for
//      short snippets, so one tap copies the exact command.
//
// ADAPTER CONTRACT for a new platform runner:
//   import { chunkForTelegram, sendCopyable } from './lib/tg-copy-code.mjs';
//
//   // Option A (recommended): replace chunkText+sendMessage in your deliver
//   // path with sendCopyable(api, chatId, text). Plain messages without code
//   // are sent byte-identical to before (no parse_mode, no keyboard).
//   await sendCopyable(api, chatId, finalText);
//
//   // Option B: build payloads yourself (e.g. you need custom retry).
//   for (const p of chunkForTelegram(finalText)) {
//     await api.sendMessage(chatId, p.text, p.extra);
//   }
//
// Agent-facing convention (see scripts/skills/telegram-copy-code/SKILL.md):
// agents keep writing ```lang fences; the bot upgrades them automatically.
// For an explicit one-tap button with exact text, agents may also emit a
// `COPY:<text>` line on its own line (same placement rules as MEDIA:).

import { chunkText, MAX_MESSAGE_CHARS } from './tg-api.mjs';

export const COPY_TEXT_LIMIT = 256;
export const MAX_COPY_BUTTONS = 4;
export const COPY_LINE_RE = /^\s*COPY:\s*(.+?)\s*$/;

const LANG_ALIASES = new Map([
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['zsh', 'bash'],
  ['terminal', 'bash'],
  ['console', 'bash'],
  ['term', 'bash'],
  ['cmd', 'bash'],
  ['cron', 'bash'],
  ['crontab', 'bash'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['py', 'python'],
  ['yml', 'yaml'],
  ['dockerfile', 'docker'],
  ['plaintext', 'plaintext'],
  ['text', 'plaintext'],
  ['txt', 'plaintext'],
]);

export function normalizeLang(raw) {
  const lang = String(raw ?? '').trim().toLowerCase();
  if (!lang) return 'plaintext';
  if (LANG_ALIASES.has(lang)) return LANG_ALIASES.get(lang);
  const clean = lang.replace(/[^a-z0-9+#-]+/g, '');
  return clean || 'plaintext';
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Scan markdown text into segments: { type: 'text'|'fence', lang, code, raw }.
 * An unclosed fence runs to end of text. Backtick runs inside a fence are
 * literal. `COPY:` lines inside fences are code, never directives.
 */
export function splitFences(text) {
  const lines = String(text ?? '').split('\n');
  const segments = [];
  let prose = [];
  let i = 0;
  const flushProse = () => {
    if (prose.length) {
      segments.push({ type: 'text', raw: prose.join('\n') });
      prose = [];
    }
  };
  while (i < lines.length) {
    const open = lines[i].match(/^\s*```([^\s`]*)\s*$/);
    if (!open) {
      prose.push(lines[i]);
      i += 1;
      continue;
    }
    const lang = normalizeLang(open[1]);
    const codeLines = [];
    i += 1;
    let closed = false;
    while (i < lines.length) {
      if (/^\s*```\s*$/.test(lines[i])) {
        closed = true;
        i += 1;
        break;
      }
      codeLines.push(lines[i]);
      i += 1;
    }
    flushProse();
    segments.push({ type: 'fence', lang, code: codeLines.join('\n'), closed });
  }
  flushProse();
  return segments;
}

export function hasBalancedFences(text) {
  const matches = String(text ?? '').match(/```/g);
  return !matches || matches.length % 2 === 0;
}

/**
 * Pull `COPY:<text>` directive lines (own line, outside fences) out of text.
 * Returns { text, copies }. Lines longer than COPY_TEXT_LIMIT are kept as
 * plain text (Telegram would reject the button) — the fenced block still
 * gets the native tap-to-copy treatment.
 */
export function extractCopyDirectives(text) {
  const segments = splitFences(text);
  const copies = [];
  const kept = [];
  for (const seg of segments) {
    if (seg.type === 'fence') {
      kept.push(seg);
      continue;
    }
    const out = [];
    for (const line of seg.raw.split('\n')) {
      const m = line.match(COPY_LINE_RE);
      if (m && m[1].length >= 1 && m[1].length <= COPY_TEXT_LIMIT) {
        if (!copies.includes(m[1])) copies.push(m[1]);
        continue;
      }
      out.push(line);
    }
    kept.push({ type: 'text', raw: out.join('\n') });
  }
  const rebuilt = kept
    .map((s) => (s.type === 'fence' ? `\`\`\`${s.lang === 'plaintext' ? '' : s.lang}\n${s.code}\n\`\`\`` : s.raw))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: rebuilt, copies };
}

function renderInlineCode(escapedText) {
  return escapedText.replace(/`([^`\n]+?)`/g, (_, code) => `<code>${code}</code>`);
}

/**
 * Convert markdown-with-fences to Telegram HTML (parse_mode=HTML).
 * Returns { html, blocks } where blocks = [{ lang, code }] in order.
 * Only <pre><code class="language-X">, <code> are emitted; everything else
 * is escaped, so the result can never break Telegram HTML parsing.
 */
export function markdownToTelegramHtml(text) {
  const segments = splitFences(text);
  const blocks = [];
  const parts = [];
  for (const seg of segments) {
    if (seg.type === 'fence') {
      const code = seg.code.replace(/\n+$/, '');
      blocks.push({ lang: seg.lang, code });
      parts.push(`<pre><code class="language-${seg.lang}">${escapeHtml(code)}</code></pre>`);
    } else {
      parts.push(renderInlineCode(escapeHtml(seg.raw)));
    }
  }
  return { html: parts.join('\n').trim(), blocks };
}

export function labelForCopy(code, index, total) {
  const first = String(code).split('\n')[0].slice(0, 28).trim() || `snippet ${index + 1}`;
  if (total <= 1) return `📋 Copy: ${first}`;
  return `📋 Copy ${index + 1}: ${first}`;
}

/**
 * Build a Telegram reply_markup with copy_text buttons for short snippets.
 * Returns undefined when nothing qualifies (caller sends no keyboard).
 * Telegram rule: copy_text.text is 1-256 chars; no callback reaches the bot.
 */
export function buildCopyKeyboard(copies, { maxButtons = MAX_COPY_BUTTONS } = {}) {
  const seen = new Set();
  const items = [];
  for (const c of copies ?? []) {
    const s = String(c ?? '');
    if (s.length < 1 || s.length > COPY_TEXT_LIMIT) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    items.push(s);
    if (items.length >= maxButtons) break;
  }
  if (!items.length) return undefined;
  return {
    inline_keyboard: items.map((s, i) => [{ text: labelForCopy(s, i, items.length), copy_text: { text: s } }]),
  };
}

/**
 * Align GFM pipe tables found OUTSIDE fenced blocks into padded monospace,
 * wrapped in a ```text fence so they render aligned on every Telegram client.
 *
 * Why: Telegram has no table rendering — a raw `| a | b |` table arrives as
 * unaligned plain text (the VM2 nutrient-table outage). The fence routes the
 * block through the existing <pre> path below. Fenced content is never
 * touched; text without a valid table (header + `---` delimiter row) is
 * returned byte-identical.
 */
const PIPE_LINE_RE = /^\s*\|.*\|\s*$/;
const FENCE_RE = /^\s*```/;

function isDelimRow(line) {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|');
  return cells.length > 0 && cells.every((c) => /^[\s:\-]+$/.test(c)) && cells.some((c) => /---/.test(c));
}

function splitPipeRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isNumericCell(s) {
  return /^~?-?[\d][\d,.\s]*[a-zA-Zµ%°]*$/.test(s.trim()) && /[\d]/.test(s);
}

export function alignPipeTables(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let i = 0;
  let changed = false;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (!inFence && PIPE_LINE_RE.test(line)) {
      const group = [];
      while (i < lines.length && !FENCE_RE.test(lines[i]) && PIPE_LINE_RE.test(lines[i])) {
        group.push(lines[i]);
        i += 1;
      }
      if (group.length >= 2 && isDelimRow(group[1])) {
        const rows = group.filter((_, idx) => idx !== 1).map(splitPipeRow);
        const cols = Math.max(...rows.map((r) => r.length));
        const norm = rows.map((r) => [...r, ...Array(Math.max(0, cols - r.length)).fill('')]);
        const widths = norm[0].map((_, c) => Math.max(...norm.map((r) => r[c].length)));
        const aligned = norm.map((r, ri) =>
          r.map((cell, c) => {
            const right = ri > 0 && isNumericCell(cell);
            return right ? cell.padStart(widths[c]) : cell.padEnd(widths[c]);
          }).join('  ').trimEnd(),
        );
        aligned.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('  '));
        out.push('```text', ...aligned, '```');
        changed = true;
      } else {
        out.push(...group);
      }
      continue;
    }
    out.push(line);
    i += 1;
  }
  return changed ? out.join('\n') : String(text ?? '');
}

/**
 * Split long text into sendable Telegram payloads.
 * Each payload: { text, extra: { parse_mode?, reply_markup? }, hasCode }.
 * Messages without code are returned verbatim (no parse_mode, no keyboard)
 * so non-code traffic is byte-identical to the old plain-text path.
 */
export function chunkForTelegram(text, { limit = MAX_MESSAGE_CHARS, maxButtons = MAX_COPY_BUTTONS } = {}) {
  const body = alignPipeTables(String(text ?? '').trim());
  if (!body) return [];
  const payloads = [];
  for (const chunk of chunkText(body, limit)) {
    if (!hasBalancedFences(chunk)) {
      payloads.push({ text: chunk, extra: {}, hasCode: false });
      continue;
    }
    const { text: cleaned, copies: explicit } = extractCopyDirectives(chunk);
    const { html, blocks } = markdownToTelegramHtml(cleaned);
    const auto = blocks.map((b) => b.code).filter((c) => c.length >= 1 && c.length <= COPY_TEXT_LIMIT);
    const keyboard = buildCopyKeyboard([...explicit, ...auto], { maxButtons });
    const hasCode = blocks.length > 0 || explicit.length > 0;
    if (!hasCode) {
      payloads.push({ text: chunk, extra: {}, hasCode: false });
      continue;
    }
    if (html.length > limit) {
      // Converted HTML overflowed (tags add chars): fall back to plain so we
      // never split inside a <pre> tag or exceed Telegram's limit.
      payloads.push({ text: chunk, extra: {}, hasCode: false });
      continue;
    }
    const extra = { parse_mode: 'HTML' };
    if (keyboard) extra.reply_markup = keyboard;
    payloads.push({ text: html, extra, hasCode: true });
  }
  return payloads;
}

/**
 * Drop-in deliver: sends text as HTML+copy-buttons when it contains code,
 * plain otherwise. Returns the Telegram results.
 */
export async function sendCopyable(api, chatId, text, opts) {
  const out = [];
  for (const p of chunkForTelegram(text, opts)) {
    out.push(await api.sendMessage(chatId, p.text, p.extra));
  }
  return out;
}
