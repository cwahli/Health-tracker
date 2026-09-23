export const COMMAND_NAMES = ['start', 'help', 'status', 'new', 'model', 'models', 'agent', 'thinking', 'abort'];

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

export function modelKeyboard(models, { page = 0, pageSize = 8 } = {}) {
  const total = models.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, page), pages - 1);
  const slice = models.slice(current * pageSize, current * pageSize + pageSize);
  const rows = slice.map((model, index) => [
    { text: isFreeModel(model) ? `✓ ${model}` : model, callback_data: `m:${current * pageSize + index}` },
  ]);
  const nav = [];
  if (current > 0) nav.push({ text: 'Prev', callback_data: `mp:${current - 1}` });
  nav.push({ text: `${current + 1}/${pages}`, callback_data: 'noop' });
  if (current < pages - 1) nav.push({ text: 'Next', callback_data: `mp:${current + 1}` });
  if (nav.length > 1 || pages > 1) rows.push(nav);
  return { inline_keyboard: rows };
}

export function agentKeyboard(agents) {
  return {
    inline_keyboard: agents.map((agent, index) => [
      { text: `${agent.name} (${agent.type})`, callback_data: `a:${index}` },
    ]),
  };
}

export function variantKeyboard(variants) {
  return {
    inline_keyboard: variants.map((variant, index) => [{ text: variant, callback_data: `v:${index}` }]),
  };
}

export function decodeCallback(data) {
  const [kind, value] = String(data ?? '').split(':');
  return { kind, value };
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
    '/agent [name]     pick an agent',
    '/build            switch to the build agent',
    '/plan             switch to the plan agent',
    '/thinking [level] pick the thinking level (variant)',
    '/new              start a fresh session',
    '/status           show session, model, agent, workspace, usage',
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
