import fs from 'node:fs';
import path from 'node:path';

export function loadRegistry(registryPath) {
  const raw = fs.readFileSync(registryPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid registry JSON at ${registryPath}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.bots)) {
    throw new Error(`Registry at ${registryPath} must contain a "bots" array`);
  }
  const seen = new Set();
  for (const bot of parsed.bots) {
    if (!bot.id) throw new Error('Every bot entry needs an "id"');
    if (seen.has(bot.id)) throw new Error(`Duplicate bot id: ${bot.id}`);
    seen.add(bot.id);
    if (!bot.telegram?.tokenEnv) throw new Error(`Bot "${bot.id}" needs telegram.tokenEnv`);
    if (!bot.agent?.kind) throw new Error(`Bot "${bot.id}" needs agent.kind`);
  }
  return parsed;
}

export function getBot(registry, id) {
  const bots = registry.bots.filter((b) => b.enabled !== false);
  if (!bots.length) throw new Error('No enabled bots in registry');
  if (!id) return bots[0];
  const bot = bots.find((b) => b.id === id);
  if (!bot) throw new Error(`Bot "${id}" not found or not enabled`);
  return bot;
}

export function normalizeConfig(bot, { defaultWorkspace = process.cwd() } = {}) {
  return {
    id: bot.id,
    name: bot.name || bot.id,
    telegram: {
      tokenEnv: bot.telegram?.tokenEnv,
      allowedUserIds: (bot.telegram?.allowedUserIds || []).map(Number),
    },
    agent: {
      kind: bot.agent?.kind || 'opencode',
      model: bot.agent?.model,
      variant: bot.agent?.variant,
      defaultAgent: bot.agent?.defaultAgent || 'build',
      workspace: bot.agent?.workspace || defaultWorkspace,
      timeoutMs: bot.agent?.timeoutMs ?? 900000,
      thinking: bot.agent?.thinking !== false,
      opencodeBin: bot.agent?.opencodeBin,
      allowExternalDirectory: bot.agent?.allowExternalDirectory === true,
      sharedSkills: Array.isArray(bot.agent?.sharedSkills) ? bot.agent.sharedSkills : [],
    },
    progress: {
      mode: bot.progress?.mode || 'concise',
      editIntervalMs: bot.progress?.editIntervalMs ?? 2500,
      maxEdits: bot.progress?.maxEdits ?? 40,
      maxChars: bot.progress?.maxChars ?? 220,
    },
    session: { mode: bot.session?.mode || 'per-chat' },
  };
}

export function resolveToken(bot, env = process.env) {
  const name = bot.telegram.tokenEnv;
  const token = env[name];
  if (!token) {
    throw new Error(`Missing Telegram token: set ${name} (e.g. in ~/.config/opencode-bot/${bot.id}.env)`);
  }
  return token;
}

export function resolveRegistryPath(explicit, repoRoot) {
  return explicit || process.env.OPENCODE_BOT_REGISTRY || path.join(repoRoot, 'bots', 'registry.json');
}
