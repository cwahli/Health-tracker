/**
 * Telegram command list for the "/" autocomplete popup.
 *
 * Telegram shows the popup from BotFather / setMyCommands, NOT from what
 * the bot code handles. This list is published via `setMyCommands` on
 * startup in bot-host.mjs. Keep COMMAND_NAMES in sync with the
 * `handleCommand` switch cases below.
 */

/** @type {{ command: string, description: string }[]} */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot and show help' },
  { command: 'help', description: 'Show available commands' },
  { command: 'status', description: 'Show session, model, agent, usage' },
  { command: 'new', description: 'Start a fresh session' },
  { command: 'compact', description: 'Summarize session and start fresh' },
  { command: 'model', description: 'Pick a model (or set it directly)' },
  { command: 'models', description: 'List available models' },
  { command: 'free', description: 'List free models only' },
  { command: 'freemodel', description: 'List free models (opencode + cline + gemini)' },
  { command: 'agent', description: 'Pick an agent' },
  { command: 'build', description: 'Switch to the build agent' },
  { command: 'plan', description: 'Switch to the plan agent' },
  { command: 'thinking', description: 'Pick the thinking level (variant)' },
  { command: 'abort', description: 'Cancel the running request' },
  { command: 'tx', description: 'Shared work view on|off|status for this chat' },
];

/** Names handled by bot-host.mjs handleCommand (kept in sync). */
export const COMMAND_NAMES = BOT_COMMANDS.map((c) => c.command);

/** Payload for Telegram `setMyCommands` (strips nothing — already valid). */
export function toTelegramCommands() {
  return BOT_COMMANDS.map(({ command, description }) => ({ command, description }));
}

/** Validate against Telegram Bot API limits; throws on violation. */
export function assertValidCommands(commands = BOT_COMMANDS) {
  const seen = new Set();
  for (const entry of commands) {
    if (!/^[a-z0-9_]{1,32}$/.test(entry.command)) {
      throw new Error(`Invalid bot command "${entry.command}" (must match /^[a-z0-9_]{1,32}$/)`);
    }
    if (seen.has(entry.command)) throw new Error(`Duplicate bot command "${entry.command}"`);
    seen.add(entry.command);
    const desc = String(entry.description ?? '');
    if (!desc || desc.length > 256) {
      throw new Error(`Invalid description for /${entry.command} (1-256 chars required)`);
    }
  }
  return true;
}

export function parseCommand(text) {
  const raw = String(text ?? '').trim();
  if (!raw.startsWith('/')) return null;
  const [head, ...rest] = raw.split(/\s+/);
  const name = head.slice(1).toLowerCase().replace(/@[A-Za-z0-9_]+$/, '');
  return { name, args: rest.join(' ').trim(), raw };
}

export function parseAgentList(text) {
  const seen = new Set();
  const agents = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = line.trim().match(/^([A-Za-z0-9_.:-]+)\s+\((primary|subagent)\)$/);
    if (!match) continue;
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    agents.push({ name: match[1], type: match[2] });
  }
  return agents;
}

export function parseModelsVerbose(text) {
  const lines = String(text ?? '').split('\n');
  const models = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const isId =
      line && !line.startsWith('{') && !line.startsWith('[') && !line.startsWith('}') && !line.startsWith('"');
    if (!isId) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith('{')) j += 1;
    let depth = 0;
    let started = false;
    const buf = [];
    while (j < lines.length) {
      const l = lines[j];
      buf.push(l);
      depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
      if (l.includes('{')) started = true;
      if (started && depth <= 0) break;
      j += 1;
    }
    let variants = [];
    let context = 0;
    try {
      const obj = JSON.parse(buf.join('\n'));
      if (obj && obj.variants && typeof obj.variants === 'object') variants = Object.keys(obj.variants);
      if (obj && obj.limit && Number(obj.limit.context) > 0) context = Number(obj.limit.context);
    } catch {
      // ignore malformed block
    }
    models.push(context ? { id: line, variants, context } : { id: line, variants });
    i = j + 1;
  }
  return models;
}

export function isFreeModel(modelId) {
  return /free/i.test(String(modelId ?? ''));
}

export function sortModelsFreeFirst(models) {
  const free = [];
  const paid = [];
  for (const m of models) (isFreeModel(m) ? free : paid).push(m);
  return [...free, ...paid];
}

export function modelKeyboard(models, { page = 0, pageSize = 8, kind = 'm' } = {}) {
  const total = models.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, page), pages - 1);
  const slice = models.slice(current * pageSize, current * pageSize + pageSize);
  // Embed the full model id (<=40 chars, well under Telegram's 64-byte
  // callback_data limit) instead of a bare index, so taps stay valid even
  // if the list was refetched/re-sorted (free-first) between showing the
  // keyboard and tapping it. Old `m:<index>` buttons still decode via the
  // index fallback in handleCallback. Labels are plain ids here (the /freemodel
  // path passes entry labels, not raw ids, so no free-checkmark here).
  const rows = slice.map((model) => [
    { text: model, callback_data: `${kind}:${model}` },
  ]);
  const nav = [];
  if (current > 0) nav.push({ text: 'Prev', callback_data: `${kind}p:${current - 1}` });
  nav.push({ text: `${current + 1}/${pages}`, callback_data: 'noop' });
  if (current < pages - 1) nav.push({ text: 'Next', callback_data: `${kind}p:${current + 1}` });
  if (nav.length > 1 || pages > 1) rows.push(nav);
  return { inline_keyboard: rows };
}

export function agentKeyboard(agents) {
  // Embed the agent name (short, e.g. "build") instead of a bare index so
  // taps stay valid even if `opencode agent list` output changes between
  // showing the keyboard and tapping it. Old `a:<index>` buttons still
  // decode via the index fallback in handleCallback.
  return {
    inline_keyboard: agents.map((agent) => [
      { text: `${agent.name} (${agent.type})`, callback_data: `a:${agent.name}` },
    ]),
  };
}

export function variantKeyboard(variants) {
  // Embed the variant name (short, e.g. "low"/"high") instead of a bare
  // index so taps stay valid even if the cached model list was refetched
  // or reordered between showing the keyboard and tapping it.
  // Old `v:<index>` buttons still decode via the index fallback.
  return {
    inline_keyboard: variants.map((variant) => [{ text: variant, callback_data: `v:${variant}` }]),
  };
}

export function decodeCallback(data) {
  const raw = String(data ?? '');
  const splitAt = raw.indexOf(':');
  if (splitAt < 0) return { kind: raw, value: undefined };
  return { kind: raw.slice(0, splitAt), value: raw.slice(splitAt + 1) };
}

export function helpText(config, { model, agent, variant } = {}) {
  return [
    config.name,
    `model: ${model || config.agent.model}`,
    `agent: ${agent || config.agent.defaultAgent || 'build'}`,
    `thinking: ${variant || config.agent.variant || '(default)'}`,
    '',
    'Send any message to run opencode.',
    '',
    'Commands:',
    '/model [name]     pick a model (or set it directly)',
    '/models           list available models',
    '/freemodel        list free models (opencode + cline + gemini)',
    '/agent [name]     pick an agent',
    '/build            switch to the build agent',
    '/plan             switch to the plan agent',
    '/thinking [level] pick the thinking level (variant)',
    '/new              start a fresh session',
    '/status           show session, model, agent, workspace, usage',
    '/tx [on|off]       shared work view for this chat (tmux attach line)',
    '/abort            cancel the running request',
    '/help             this message',
  ].join('\n');
}

export function formatTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return String(value);
}

export function extractMedia(text) {
  const lines = String(text ?? '').split('\n');
  const media = [];
  const kept = [];
  for (const line of lines) {
    const match = line.match(/^\s*MEDIA:(.+?)\s*$/);
    if (match) {
      const file = match[1].trim();
      if (file) media.push(file);
      continue;
    }
    kept.push(line);
  }
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, media };
}

export function extractCodeBlocks(text) {
  const source = String(text ?? '');
  const blocks = [];
  const re = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const lang = match[1] || '';
    const code = match[2].replace(/\s+$/, '');
    if (code.trim()) blocks.push(lang ? `\`\`\`${lang}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``);
  }
  return blocks;
}

export function formatUsage({ tokens, cost, contextLimit, agent } = {}) {
  const parts = [];
  if (agent) parts.push(agent);
  const total = Number(tokens?.total) || 0;
  const limit = Number(contextLimit) || 0;
  if (limit > 0 && total > 0) {
    const pct = (total / limit) * 100;
    const pctText = pct < 10 ? pct.toFixed(1) : pct.toFixed(0);
    parts.push(`ctx ${pctText}% (${formatTokens(total)}/${formatTokens(limit)})`);
  } else if (total > 0) {
    parts.push(`ctx ${formatTokens(total)} tokens`);
  }
  const spend = Number(cost) || 0;
  if (spend > 0) parts.push(`cost $${spend.toFixed(spend < 0.01 ? 5 : 4)}`);
  return parts.join(' · ');
}

export function statusText(config, { sessionId, model, agent, variant, usage } = {}) {
  const lines = [
    `model: ${model || config.agent.model}`,
    `agent: ${agent || config.agent.defaultAgent || 'build'}`,
    `thinking: ${variant || config.agent.variant || '(default)'}`,
    `workspace: ${config.agent.workspace}`,
    `session: ${sessionId || '(none)'}`,
  ];
  if (usage) lines.push(`last run: ${usage}`);
  return lines.join('\n');
}

export function formatModelList(models, { max = 0 } = {}) {
  const list = Array.isArray(models) ? models.map((m) => String(m).trim()).filter(Boolean) : [];
  if (!list.length) return 'No models found.';
  const shown = (max > 0 ? list.slice(0, max) : list).map((m) => `- ${m}`);
  if (max > 0 && list.length > max) shown.push(`... and ${list.length - max} more`);
  return shown.join('\n');
}
