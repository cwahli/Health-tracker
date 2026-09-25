import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveClineBin } from './agent-cline.mjs';
import { resolveOpencodeBin } from './agent-opencode.mjs';

export const CLINE_FREE_MODELS = [
  'cline-free/deepseek-v4.1-flash',
  'cline-free/muse-spark-1.3-contributor',
  'cline-free/kat-coder-pro',
  'cline-free/solar-pro4',
];

export const CLINE_FREE_NOTES = {
  'cline-free/deepseek-v4.1-flash': 'daily free cap (~22h cooldown when hit)',
  'cline-free/muse-spark-1.3-contributor': 'solid free backup',
  'cline-free/kat-coder-pro': 'free coding model',
  'cline-free/solar-pro4': 'free coding model',
};

export const GEMINI_MODELS = [
  'gemini/gemini-3.7-flash',
  'gemini/gemini-3.8-flash',
  'gemini/gemini-3.1-pro',
  'gemini/gemini-3.5-flash-lite',
];

export const GEMINI_TO_OPENCODE = {
  'gemini/gemini-3.7-flash': 'google/gemini-3.7-flash',
  'gemini/gemini-3.8-flash': 'google/gemini-3.8-flash',
  'gemini/gemini-3.1-pro': 'google/gemini-3.1-pro',
  'gemini/gemini-3.5-flash-lite': 'google/gemini-3.5-flash-lite',
};

export const GEMINI_MODEL_NOTES = {
  'gemini/gemini-3.7-flash': 'keyed API through OpenCode; not a standalone bot surface',
  'gemini/gemini-3.8-flash': 'keyed API through OpenCode; not a standalone bot surface',
  'gemini/gemini-3.1-pro': 'keyed API through OpenCode; strongest reasoning of the four',
  'gemini/gemini-3.5-flash-lite': 'keyed API through OpenCode; cheapest/fastest of the four',
};

export const FREEBUFF_FREE_MODELS = ['deepseek/deepseek-v4.1-flash'];

function defaultPaths(home = os.homedir()) {
  return {
    modelsCachePath: path.join(home, '.cache', 'opencode', 'models.json'),
    authPath: path.join(home, '.local', 'share', 'opencode', 'auth.json'),
  };
}

function defaultReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hasValue(scope, names) {
  for (const name of names) {
    if (typeof scope?.[name] === 'string' && scope[name].trim()) return true;
  }
  return false;
}

function commandAvailable(command, { env = process.env, timeoutMs = 4000 } = {}) {
  try {
    execFileSync(command, ['--version'], { env, stdio: 'ignore', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export function detectFreeModelLocation({ env = process.env, home = os.homedir(), platform = process.platform, arch = process.arch } = {}) {
  const explicit = String(env.BOT_LOCATION || env.BOT_HOST_LOCATION || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (env.TERMUX_VERSION || env.ANDROID_ROOT) return 'mobile';
  if (platform === 'android') return 'mobile';
  if (home === '/root' && arch === 'arm64') return 'mobile';
  return 'vps';
}

export function parseModelRef(raw) {
  const value = String(raw ?? '').trim();
  if (value.startsWith('cline:')) return { surface: 'cline', id: value.slice('cline:'.length), raw: value };
  if (value.startsWith('gemini:')) return { surface: 'gemini', id: value.slice('gemini:'.length), raw: value };
  if (value.startsWith('opencode:')) return { surface: 'opencode', id: value.slice('opencode:'.length), raw: value };
  return { surface: 'opencode', id: value, raw: value };
}

export function toModelRef(surface, id) {
  if (surface === 'cline') return `cline:${id}`;
  if (surface === 'gemini') return `gemini:${id}`;
  return id;
}

export function formatFreeLabel(ref) {
  const { surface, id } = parseModelRef(ref);
  if (surface === 'cline') {
    const pretty = id.replace(/^cline-free\//, '').replace(/-/g, ' ');
    return `cline:${pretty} (free)`;
  }
  if (surface === 'gemini') return `gemini:${id.replace(/^gemini\//, '')} (moved to opencode)`;
  if (/^freebuff\//i.test(ref)) return `Freebuff:${id.replace(/^freebuff\//, '')} (terminal-only)`;
  if (/^(?:opencode|google)\/gemini-/i.test(ref)) return `opencode:${id.replace(/^(?:opencode|google)\/gemini-/i, 'gemini ').replace(/-/g, ' ')} (keyed)`;
  return `${id.replace('/', ':')} (free)`;
}

export function listFreeOpenCode({ modelsCachePath, authPath, readJson = defaultReadJson, home = os.homedir(), env = process.env } = {}) {
  const paths = defaultPaths(home);
  const cache = readJson(modelsCachePath || paths.modelsCachePath);
  const auth = readJson(authPath || paths.authPath);
  if (!cache || typeof cache !== 'object') return [];
  const authorized = auth && typeof auth === 'object' ? new Set(Object.keys(auth)) : null;
  const tokenHarborReady = authorized?.has('tokenharbor') || hasValue(env, ['TH_KEY', 'TOKEN_HARBOR_KEY', 'TOKEN_HARBOR_API_KEY', 'TOKENHARBOR_API_KEY']);
  const cloudflareReady = authorized?.has('cloudflare') || hasValue(env, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN']);
  const refs = [];
  for (const [provider, entry] of Object.entries(cache)) {
    const providerName = provider.toLowerCase();
    const specialReady = providerName === 'tokenharbor' ? tokenHarborReady : providerName === 'cloudflare' ? cloudflareReady : false;
    if (authorized && !authorized.has(provider) && !specialReady) continue;
    if (providerName === 'tokenharbor' && !tokenHarborReady) continue;
    if (providerName === 'cloudflare' && !cloudflareReady) continue;
    const models = entry && typeof entry === 'object' ? entry.models : null;
    if (!models || typeof models !== 'object') continue;
    for (const [id, spec] of Object.entries(models)) {
      const cost = (spec && typeof spec === 'object' ? spec.cost : null) || {};
      if (Number(cost.input) !== 0 || Number(cost.output) !== 0) continue;
      refs.push(`${provider}/${id}`);
    }
  }
  return [...new Set(refs)].sort();
}

export function listGeminiOpenCode({ modelsCachePath, authPath, readJson = defaultReadJson, home = os.homedir(), env = process.env } = {}) {
  const paths = defaultPaths(home);
  const cache = readJson(modelsCachePath || paths.modelsCachePath);
  const auth = readJson(authPath || paths.authPath);
  if (!cache || typeof cache !== 'object') return [];
  const googleReady = Boolean(auth && typeof auth === 'object' && Object.keys(auth).some((k) => /^google(-|$)/i.test(k)))
    || hasValue(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEYS']);
  if (!googleReady) return [];
  const models = cache.google?.models || {};
  const allowed = new Set(GEMINI_MODELS.map((id) => id.replace(/^gemini\//, '')));
  return Object.keys(models)
    .filter((id) => allowed.has(id))
    .sort()
    .map((id) => `google/${id}`);
}

export function clineReady({ location = '', env = process.env, home = os.homedir(), clineBin, readJson = defaultReadJson, platform = process.platform } = {}) {
  if (location === 'mobile') return false;
  if (!commandAvailable(resolveClineBin(clineBin), { env })) return false;
  const candidates = [
    path.join(home, '.cline', 'data', 'settings', 'providers.json'),
    path.join(home, '.config', 'cline', 'data', 'settings', 'providers.json'),
    '/home/box/.cline/data/settings/providers.json',
  ];
  for (const file of candidates) {
    const data = readJson(file);
    const auth = data?.providers?.cline?.settings?.auth || data?.cline?.settings?.auth || data?.auth || {};
    if (auth.accessToken || auth.token || auth.refreshToken || auth.apiKey) return true;
  }
  return platform === 'win32' ? false : false;
}

export function freebuffReady({ env = process.env, home = os.homedir(), readJson = defaultReadJson } = {}) {
  const command = commandAvailable('freebuff', { env }) || commandAvailable('manicode', { env });
  if (!command) return false;
  const candidates = [
    path.join(home, '.config', 'manicode', 'credentials.json'),
    '/home/box/.config/manicode/credentials.json',
  ];
  return candidates.some((file) => {
    const data = readJson(file);
    const auth = data?.default || data || {};
    return Boolean(auth.authToken || auth.token || auth.accessToken);
  });
}

function entry(ref, { surface, tool, provider, selectable = true, location = '', note = '', pendingAction = '' } = {}) {
  const resolvedSurface = surface || 'opencode';
  const resolvedProvider = provider || String(ref).split('/')[0] || resolvedSurface;
  return {
    ref,
    label: formatFreeLabel(ref),
    surface: resolvedSurface,
    tool: tool || resolvedSurface,
    provider: resolvedProvider,
    selectable,
    location,
    ...(note ? { note } : {}),
    ...(pendingAction ? { status: 'pending-signin', pendingAction } : {}),
  };
}

function pendingEntry(tool, pendingAction, location) {
  const item = entry(`pending:${tool}`, {
    surface: tool,
    tool,
    provider: tool,
    selectable: false,
    location,
    pendingAction,
  });
  item.label = `${tool} (pending setup/sign-in)`;
  return item;
}

export function buildFreeModelList(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const location = String(opts.location || detectFreeModelLocation({ env, home, platform: opts.platform, arch: opts.arch }) || 'vps');
  const opencodeAvailable = commandAvailable(resolveOpencodeBin(opts.opencodeBin), { env });
  const entries = [];
  const clineAvailable = clineReady({ ...opts, env, home, location });
  if (clineAvailable) {
    for (const id of CLINE_FREE_MODELS) {
      entries.push(entry(toModelRef('cline', id), { surface: 'cline', tool: 'cline', provider: 'cline', location, note: CLINE_FREE_NOTES[id] || '' }));
    }
  } else {
    entries.push(pendingEntry('cline', location === 'mobile'
      ? 'Cline CLI is not supported by the Android arm64 host; use a supported host or provide a native build, then sign in.'
      : 'Install the Cline CLI and sign in on this host.', location));
  }
  if (opencodeAvailable) {
    const opencodeRefs = listFreeOpenCode({ ...opts, env, home });
    for (const ref of opencodeRefs) {
      entries.push(entry(ref, { surface: 'opencode', tool: 'opencode', location }));
    }
    const geminiRefs = listGeminiOpenCode({ ...opts, env, home });
    for (const ref of geminiRefs) {
      entries.push(entry(ref, { surface: 'opencode', tool: 'opencode', provider: 'gemini', location, note: 'Gemini API through OpenCode' }));
    }
    if (!opencodeRefs.some((ref) => ref.startsWith('tokenharbor/') || ref.startsWith('opencode/tokenharbor/'))) {
      entries.push(pendingEntry('tokenharbor', 'Configure the Token Harbor provider and sign in on this host; its quota is separate.', location));
    }
    if (!geminiRefs.length) {
      entries.push(pendingEntry('gemini', 'Set GEMINI_API_KEY for this host and expose the model through OpenCode.', location));
    }
  } else {
    entries.push(pendingEntry('opencode', 'Install or start OpenCode on this host; it is the tool surface for the shared provider catalog.', location));
    entries.push(pendingEntry('tokenharbor', 'Install/start OpenCode, configure Token Harbor, and sign in on this host.', location));
    entries.push(pendingEntry('gemini', 'Install/start OpenCode, set GEMINI_API_KEY, and expose Gemini through it.', location));
  }
  if (freebuffReady({ ...opts, env, home })) {
    for (const id of FREEBUFF_FREE_MODELS) {
      entries.push(entry(`freebuff/${id}`, { surface: 'freebuff', tool: 'freebuff', provider: 'freebuff', selectable: false, location, note: 'terminal-only Freebuff lane' }));
    }
  } else {
    entries.push(pendingEntry('freebuff', 'Install Freebuff and sign in on this host; it is terminal-only.', location));
  }
  return entries;
}

export function formatFreeModelText(entries, { current, location = '' } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const selectable = list.filter((entry) => entry.selectable !== false);
  const countProvider = (provider) => selectable.filter((entry) => entry.provider === provider).length;
  const countOpencode = selectable.filter((entry) => entry.tool === 'opencode' && entry.provider !== 'tokenharbor' && !/^(?:opencode|google)\/gemini-/i.test(entry.ref)).length;
  const countGemini = selectable.filter((entry) => /^(?:opencode|google)\/gemini-/i.test(entry.ref)).length;
  const where = location || list[0]?.location || 'this host';
  const parts = [
    ['opencode', countOpencode],
    ['cline', countProvider('cline')],
    ['tokenharbor', countProvider('tokenharbor')],
    ['gemini', countGemini],
    ['freebuff', countProvider('freebuff')],
  ].filter(([, n]) => n > 0).map(([provider, n]) => `${n} ${provider}`);
  const pending = list.filter((entry) => entry.status === 'pending-signin');
  const terminal = list.length - selectable.length - pending.length;
  const lines = [
    `Free models at ${where}: ${selectable.length} selectable${parts.length ? ` (${parts.join(', ')})` : ''}${pending.length ? ` · ${pending.length} pending setup/sign-in` : ''}${terminal ? ` · ${terminal} terminal-only` : ''} · current: ${current || '(unknown)'}`,
    'This list is location-scoped: tools, credentials, and quota belong to this host.',
  ];
  if (selectable.length) lines.push('Tap a model below to switch this chat.');
  else lines.push('No selectable free model is currently installed and authenticated on this host.');
  const notes = list.filter((entry) => entry.note).map((entry) => `• ${entry.label}: ${entry.note}`);
  if (notes.length) lines.push('', ...notes);
  if (pending.length) {
    lines.push('', 'Pending setup/sign-in:');
    lines.push(...pending.map((entry) => `• ${entry.tool}: ${entry.pendingAction}`));
  }
  if (countProvider('cline')) lines.push('', 'Cline is listed only when its local CLI and auth are usable; its daily caps are per host.');
  if (list.some((entry) => String(entry.ref || '').match(/^(?:opencode|google)\/gemini-/i))) lines.push('Gemini is exposed through OpenCode, not as a standalone bot surface.');
  if (list.some((entry) => entry.surface === 'freebuff' && entry.selectable !== false)) lines.push('Freebuff is shown for visibility but is terminal-only and is not a Telegram tap target.');
  return lines.join('\n');
}
