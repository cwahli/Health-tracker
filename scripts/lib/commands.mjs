export const COMMAND_NAMES = ['start', 'help', 'status', 'new', 'model', 'models', 'abort'];

export function parseCommand(text) {
  const raw = String(text ?? '').trim();
  if (!raw.startsWith('/')) return null;
  const [head, ...rest] = raw.split(/\s+/);
  const name = head.slice(1).toLowerCase().replace(/@[A-Za-z0-9_]+$/, '');
  return { name, args: rest.join(' ').trim(), raw };
}

export function helpText(config, { model } = {}) {
  return [
    config.name,
    `model: ${model || config.agent.model} (${config.agent.variant})`,
    '',
    'Send any message to run opencode.',
    '',
    'Commands:',
    '/new                     start a fresh session',
    '/status                  show session, model and workspace',
    '/model                   show the current model',
    '/model <provider/model>  switch model for this chat',
    '/model reset             back to the default model',
    '/models                  list available models',
    '/abort                   cancel the running request',
    '/help                    this message',
  ].join('\n');
}

export function statusText(config, { sessionId, model } = {}) {
  return [
    `model: ${model || config.agent.model}`,
    `variant: ${config.agent.variant}`,
    `workspace: ${config.agent.workspace}`,
    `session: ${sessionId || '(none)'}`,
  ].join('\n');
}

export function formatModelList(models, { max = 60 } = {}) {
  const list = Array.isArray(models) ? models.map((m) => String(m).trim()).filter(Boolean) : [];
  if (!list.length) return 'No models found.';
  const shown = list.slice(0, max).map((m) => `- ${m}`);
  if (list.length > max) shown.push(`... and ${list.length - max} more`);
  return shown.join('\n');
}
