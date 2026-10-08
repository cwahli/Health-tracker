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

/**
 * Runtimes bot-host can start. Any other `runtime` marks a registry pointer:
 * a bot owned by another host (e.g. the Grok box provider-router) that is
 * documented here for the one-poller guard but never started by bot-host
 * (see getBot). Pointers are exempt from agent requirements.
 */
export const BOT_HOST_RUNTIMES = ['bot-host', 'device', 'collab', 'hermes'];

export function isForeignRuntime(bot) {
  return Boolean(bot?.runtime) && !BOT_HOST_RUNTIMES.includes(bot.runtime);
}

export function applyMasterDefaults(registry) {
  const bots = registry.bots;
  const masterId = registry.master || bots[0]?.id;
  const master = bots.find((b) => b.id === masterId);
  if (!master) throw new Error(`Master bot "${masterId}" not found`);
  if (master.extends) throw new Error(`Master bot "${masterId}" must not extend another bot`);

  const masterRuntime = master.runtime || 'bot-host';
  const byId = new Map(bots.map((b) => [b.id, b]));
  const resolvedById = new Map();
  const inProgress = [];

  /**
   * Resolve one bot, recursing through `extends`.
   *
   * The recursion is the point: a parent may itself be a thin row that only
   * names a parent, so merging from the RAW parent row would hand the child an
   * empty `agent` block and silently drop every inherited feature. Resolving
   * the parent first means `extends` is transitive, which is what makes "a new
   * bot is a thin row" true all the way down a chain.
   */
  function resolve(bot) {
    const cached = resolvedById.get(bot.id);
    if (cached) return cached;
    if (inProgress.includes(bot.id)) {
      throw new Error(`Bot inheritance cycle: ${[...inProgress, bot.id].join(' -> ')}`);
    }
    if (bot.id === masterId) {
      resolvedById.set(bot.id, bot);
      return bot;
    }

    const botRuntime = bot.runtime || 'bot-host';
    if (botRuntime !== masterRuntime) {
      // Different runtime (e.g. hermes): self-contained, no bot-host inheritance.
      const selfContained = { ...bot, runtime: botRuntime };
      resolvedById.set(bot.id, selfContained);
      return selfContained;
    }

    const parentId = bot.extends || masterId;
    if (parentId === bot.id) throw new Error(`Bot "${bot.id}" cannot extend itself`);
    const rawParent = byId.get(parentId);
    if (!rawParent) throw new Error(`Bot "${bot.id}" extends unknown bot "${parentId}"`);

    inProgress.push(bot.id);
    let parent;
    try {
      parent = resolve(rawParent);
    } finally {
      inProgress.pop();
    }

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

    const out = {
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
    resolvedById.set(bot.id, out);
    return out;
  }

  const resolved = bots.map((bot) => resolve(bot));

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
    if (isForeignRuntime(bot)) continue; // pointer: documented, never started here
    if (!bot.agent?.kind) throw new Error(`Bot "${bot.id}" needs agent.kind`);
  }
  return parsed;
}

export function getBot(registry, id) {
  if (id) {
    const foreign = (registry.bots || []).find((b) => b.id === id && isForeignRuntime(b));
    if (foreign) {
      throw new Error(
        `Bot "${id}" uses runtime "${foreign.runtime}", not runnable by bot-host (see ${foreign.path || 'its own host docs'})`,
      );
    }
    // Explicit --id may select a device bot (phone-owned token, run on phone).
    // Default selection stays bot-host-only so VPS systemd never picks mobile.
    const bot = (registry.bots || []).find(
      (b) =>
        b.id === id &&
        b.enabled !== false &&
        ['bot-host', 'device'].includes(b.runtime || 'bot-host'),
    );
    if (bot) return bot;
    throw new Error(`Bot "${id}" not found or not enabled`);
  }
  const bots = registry.bots.filter(
    (b) => b.enabled !== false && (b.runtime || 'bot-host') === 'bot-host',
  );
  if (!bots.length) throw new Error('No enabled bots in registry');
  return bots[0];
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
      smallModel: bot.agent?.smallModel,
      healthRole: bot.agent?.healthRole || '',
      taxRole: bot.agent?.taxRole || '',
      homeProject: bot.agent?.homeProject || '',
    },
    progress: {
      mode: bot.progress?.mode || 'concise',
      editIntervalMs: bot.progress?.editIntervalMs ?? 2500,
      maxEdits: bot.progress?.maxEdits ?? 120,
      maxChars: bot.progress?.maxChars ?? 220,
      heartbeatMs: bot.progress?.heartbeatMs ?? 12000,
      // 'gist' keeps today's headline (a reasoning summary). 'phase' swaps that
      // for a label derived from the real tool lifecycle — truthful by
      // construction, and it cannot contradict the answer the way a paraphrased
      // chain-of-thought can. Ships defaulting to 'gist' because it is a
      // product decision, not a bug fix.
      progressMode: bot.progress?.progressMode ?? 'gist',
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
