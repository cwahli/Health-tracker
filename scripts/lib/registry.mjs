import fs from 'node:fs';
import path from 'node:path';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeOnto(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? mergeOnto(base[k], v) : v;
  }
  return out;
}

export function applyMasterDefaults(registry) {
  const bots = registry.bots;
  const masterId = registry.master || bots[0]?.id;
  const master = bots.find((b) => b.id === masterId);
  if (!master) throw new Error(`Master bot "${masterId}" not found`);
  if (master.extends) throw new Error(`Master bot "${masterId}" must not extend another bot`);

  const resolved = bots.map((bot) => {
    if (bot.id === masterId) return bot;

    const botRuntime = bot.runtime || 'bot-host';
    const masterRuntime = master.runtime || 'bot-host';
    if (botRuntime !== masterRuntime) {
      // Different runtime (e.g. hermes): self-contained, no bot-host inheritance.
      return { ...bot, runtime: botRuntime };
    }

    const parentId = bot.extends || masterId;
    const parent = bots.find((b) => b.id === parentId);
    if (!parent) throw new Error(`Bot "${bot.id}" extends unknown bot "${parentId}"`);
    if (parentId === bot.id) throw new Error(`Bot "${bot.id}" cannot extend itself`);

    const merged = mergeOnto(
      {
        name: parent.name,
        telegram: parent.telegram || {},
        agent: parent.agent || {},
        progress: parent.progress || {},
        session: parent.session || {},
      },
      {
        ...(bot.name !== undefined ? { name: bot.name } : {}),
        telegram: bot.telegram || {},
        agent: bot.agent || {},
        progress: bot.progress || {},
        session: bot.session || {},
      },
    );

    // Per-bot extras are ADDITIVE: agent.skills appends to the inherited
    // agent.sharedSkills (common skills). Setting agent.sharedSkills on a
    // child still replaces the inherited list (see test 'lets child override').
    if (Array.isArray(bot.agent?.skills) && bot.agent.skills.length > 0) {
      const base = Array.isArray(merged.agent?.sharedSkills) ? merged.agent.sharedSkills : [];
      merged.agent = { ...merged.agent, sharedSkills: [...base, ...bot.agent.skills] };
    }

    return {
      ...parent,
      ...bot,
      name: merged.name,
      telegram: merged.telegram,
      agent: merged.agent,
      progress: merged.progress,
      session: merged.session,
      id: bot.id,
      enabled: bot.enabled,
      extends: bot.extends,
    };
  });

  return { ...registry, master: masterId, bots: resolved };
}

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
  const seenEnv = new Set();
  for (const bot of parsed.bots) {
    if (!bot.id) throw new Error('Every bot entry needs an "id"');
    if (seen.has(bot.id)) throw new Error(`Duplicate bot id: ${bot.id}`);
    seen.add(bot.id);
    if (!bot.telegram?.tokenEnv) {
      throw new Error(`Bot "${bot.id}" needs telegram.tokenEnv (each bot has its own token)`);
    }
    if (seenEnv.has(bot.telegram.tokenEnv)) {
      throw new Error(
        `Duplicate tokenEnv "${bot.telegram.tokenEnv}" — one Telegram token = one getUpdates poller`,
      );
    }
    seenEnv.add(bot.telegram.tokenEnv);
  }

  parsed = applyMasterDefaults(parsed);

  for (const bot of parsed.bots) {
    if (!bot.telegram?.tokenEnv) throw new Error(`Bot "${bot.id}" needs telegram.tokenEnv`);
    if (!bot.agent?.kind) throw new Error(`Bot "${bot.id}" needs agent.kind`);
  }
  return parsed;
}

export function getBot(registry, id) {
  const bots = registry.bots.filter(
    (b) => b.enabled !== false && (b.runtime || 'bot-host') === 'bot-host',
  );
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
    runtime: bot.runtime || 'bot-host',
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
      clineBin: bot.agent?.clineBin,
      allowExternalDirectory: bot.agent?.allowExternalDirectory === true,
      sharedSkills: Array.isArray(bot.agent?.sharedSkills) ? bot.agent.sharedSkills : [],
      playwrightOutputDir: bot.agent?.playwrightOutputDir || '',
    },
    progress: {
      mode: bot.progress?.mode || 'concise',
      editIntervalMs: bot.progress?.editIntervalMs ?? 2500,
      maxEdits: bot.progress?.maxEdits ?? 40,
      maxChars: bot.progress?.maxChars ?? 220,
    },
    session: { mode: bot.session?.mode || 'per-chat' },
    ...(bot.hermes ? { hermes: bot.hermes } : {}),
  };
}

export function resolveToken(bot, env = process.env) {
  const name = bot.telegram.tokenEnv;
  const token = env[name];
  if (!token) {
    throw new Error(`Missing Telegram token: set ${name} (e.g. in ~/.config/bot-host/${bot.id}.env)`);
  }
  return token;
}

export function resolveRegistryPath(explicit, repoRoot) {
  return explicit || process.env.OPENCODE_BOT_REGISTRY || path.join(repoRoot, 'bots', 'registry.json');
}
