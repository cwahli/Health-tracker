import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveClineBin } from './agent-cline.mjs';
import { resolveOpencodeBin } from './agent-opencode.mjs';
import * as setupGapsModule from './setup-gaps.mjs';

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
  // `google/` catalog rows execute through the direct Gemini runner: the
  // OpenCode `google/` provider is unavailable on hosts without a wired
  // OpenCode google credential (live VPS 2026-10-03), while GEMINI_API_KEY
  // answers directly. Mirrored in free-lanes.laneWalkRef — keep both in sync.
  if (surface === 'google' || surface === 'gemini') {
    const full = String(id || '').startsWith('gemini/') ? id : `gemini/${id}`;
    return `gemini:${full}`;
  }
  // A chat-only lane id without a vendor path (e.g. provider `tokenharbor`,
  // model `mimo-v2.6-flash:free`) is not runnable as-is: the OpenCode CLI
  // answers `Invalid model reference` and the walk burns a turn on it every
  // time (live VM5 2026-10-03). Keep the vendor so the attempt is routed and
  // stamped against the right lane and bucket.
  //
  // `opencode` is not an exception. `withCatalogLanes` strips `opencode/` off
  // the stored lane for quota-key hygiene, so `toModelRef('opencode',
  // 'big-pickle')` handed the CLI a bare slug and the walk burned nine turns on
  // `Invalid model reference` before it reached a lane that worked (live VM4
  // 2026-10-06, 14 hops for the prompt "hi"). An id that already carries a path
  // (`opencode/big-pickle`, `tokenharbor/x`, `google/gemini-3.8-flash`) still
  // returns as-is — that is the whole of the old behaviour — and only the
  // genuinely bare id gains its surface. A provider-less lane is an OpenCode
  // lane, which is also how `routeCandidates` reads it.
  if (String(id || '').includes('/')) return id;
  return `${surface || 'opencode'}/${id}`;
}

export function formatFreeLabel(ref) {
  const { surface, id } = parseModelRef(ref);
  if (surface === 'cline') {
    const pretty = id.replace(/^cline-free\//, '').replace(/-/g, ' ');
    return `cline:${pretty} (free)`;
  }
  if (surface === 'gemini') return `gemini:${id.replace(/^gemini\//, '')} (moved to opencode)`;
  if (/^freebuff\//i.test(ref)) return `Freebuff:${id.replace(/^freebuff\//, '')} (terminal-only)`;
  // The "(keyed)" suffix said how the row is reached — through the shared Gemini
  // key — and in a 20-column name column it is what got cut, printing
  // "gemini 3.8 flash (ke". The Plan column already says GM, and the row's note
  // carries how it is reached, so the name is just the name.
  if (/^(?:opencode|google)\/gemini-/i.test(ref)) return `opencode:${id.replace(/^(?:opencode|google)\/gemini-/i, 'gemini ').replace(/-/g, ' ')}`;
  return `${id.replace('/', ':')} (free)`;
}

/**
 * Is a keyed provider wired up on this host?
 *
 * Split out because two callers need the same answer: the model list, which must
 * decide whether a row may be offered, and the list builder, which must decide
 * whether to keep the row at all. They disagreed once — the list read
 * CLOUDFLARE_API_TOKEN while the bots use CLOUDFLARE_WORKERS_AI_TOKEN — and the
 * Cloudflare models vanished from /freemodel on a host whose key worked.
 */
export function specialProviderReadiness({ authPath, readJson = defaultReadJson, home = os.homedir(), env = process.env } = {}) {
  const auth = readJson(authPath || defaultPaths(home).authPath);
  const authorized = auth && typeof auth === 'object' ? new Set(Object.keys(auth)) : null;
  return {
    tokenharbor: Boolean(authorized?.has('tokenharbor') || hasValue(env, ['TH_KEY', 'TOKEN_HARBOR_KEY', 'TOKEN_HARBOR_API_KEY', 'TOKENHARBOR_API_KEY'])),
    cloudflare: Boolean(authorized?.has('cloudflare') || hasValue(env, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CLOUDFLARE_WORKERS_AI_TOKEN', 'CLOUDFLARE_WORKERS_AI_API_TOKEN'])),
  };
}

/**
 * Models that are free without "-free" in the name, with the citation.
 *
 * On the OpenCode/Go subscription surfaces a zero list price does NOT mean a free
 * model — the cost fields are 0 for models that are simply not metered, and the
 * vendor marks a genuinely free model in its name. Two models on this host sit at
 * cost 0 without the suffix: grok-code, which the user confirmed on 2026-09-26 is
 * not free and which therefore has no place in a free list at all, and big-pickle,
 * which qa-evidence/model-comparison.json documents as "Free, no card; no per-day
 * cap published" and which is this stack's default model. The exception carries its
 * citation so it can be re-checked rather than trusted.
 */
export const FREE_NAME_EXCEPTIONS = {
  'big-pickle': 'qa-evidence/model-comparison.json — "Free, no card; no per-day cap published"',
};

/**
 * Free lanes the live catalog still lists but this host cannot actually run.
 *
 * These two are catalogued by OpenCode and free by name, so nothing filters them
 * out — but a real turn against them returns the vendor's own refusal, twice in
 * a row, not a transient blip:
 *
 *   opencode/fledge-alpha-free       403 FreeTierError "This model is not
 *                                    available in your country" — a per-region
 *                                    block, so it will not fix itself here.
 *   opencode/ling-3.0-flash-fin-free 404 "Upstream request failed: Endpoint is
 *                                    unavailable." — the upstream endpoint is
 *                                    gone.
 *
 * They are listed rather than dropped, for the same reason an unwired keyed
 * provider is: a silent gap cannot be told apart from a model that does not
 * exist. The vendor's own words are the citation so the row can be re-probed
 * (`opencode run -m <ref> "Reply with exactly: ok"`) and the entry deleted when
 * the vendor starts answering, rather than trusted on the strength of this note.
 */
export const UNRUNNABLE_FREE_LANES = {
  'opencode/fledge-alpha-free': 'Vendor 403: "This model is not available in your country" (probed 2026-10-07, twice).',
  'opencode/ling-3.0-flash-fin-free': 'Vendor 404: "Upstream request failed: Endpoint is unavailable." (probed 2026-10-07, twice).',
};

/**
 * The live catalog, straight from the OpenCode CLI: `opencode models`.
 *
 * This used to read ~/.cache/opencode/models.json, and that file is a fossil.
 * OpenCode v2 keeps its catalog in ~/.local/share/opencode/opencode.db and no
 * longer rewrites the JSON cache, so on this host the last write was 2026-09-26
 * and nothing since has touched it (an orphaned models.json.*.tmp from an
 * interrupted write is still sitting next to it). /freemodel therefore offered 36
 * opencode free lanes of which 25 were gone — every one of them answered
 * `provider.no-route: Model unavailable` on a real turn.
 *
 * `opencode models` is the source /model already uses, it costs ~0.3s against a
 * warm background service, and it only lists providers this host can actually
 * route — which is also why the old hand-rolled auth.json gate is not needed on
 * this path. Returns null (not []) when the CLI cannot answer, so the caller can
 * fall back to the cache rather than read "no free models" into a broken CLI.
 */
function liveOpenCodeModels({ env = process.env, opencodeBin, timeoutMs = 15000 } = {}) {
  try {
    const out = execFileSync(resolveOpencodeBin(opencodeBin), ['models'], {
      env,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 << 20,
    });
    const refs = String(out)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[^\s/]+\/[^\s/]+$/.test(line));
    return refs.length ? refs : null;
  } catch {
    return null;
  }
}

export function listFreeOpenCode({ modelsCachePath, authPath, readJson = defaultReadJson, home = os.homedir(), env = process.env, includeUnready = false, liveModels, opencodeBin, liveTimeoutMs } = {}) {
  // The live catalog answers "what can this host run today", so it is asked
  // first. Cost is deliberately not consulted here: v2 does not put cost on the
  // model list at all (GET /api/model returns cost as []), so the name is the
  // only free signal there is — which is what FREE_NAME_EXCEPTIONS already says.
  const live = typeof liveModels === 'function'
    ? liveModels({ env, opencodeBin, timeoutMs: liveTimeoutMs })
    : liveOpenCodeModels({ env, opencodeBin, timeoutMs: liveTimeoutMs });
  if (live && live.length) {
    const refs = live.filter((ref) => {
      const id = ref.slice(ref.indexOf('/') + 1);
      return /-free/.test(id) || FREE_NAME_EXCEPTIONS[id];
    });
    return [...new Set(refs)].sort();
  }

  const paths = defaultPaths(home);
  const cache = readJson(modelsCachePath || paths.modelsCachePath);
  const auth = readJson(authPath || paths.authPath);
  if (!cache || typeof cache !== 'object') return [];
  const authorized = auth && typeof auth === 'object' ? new Set(Object.keys(auth)) : null;
  const { tokenharbor: tokenHarborReady, cloudflare: cloudflareReady } = specialProviderReadiness({ authPath, readJson, home, env });
  const refs = [];
  for (const [provider, entry] of Object.entries(cache)) {
    const providerName = provider.toLowerCase();
    const specialReady = providerName === 'tokenharbor' ? tokenHarborReady : providerName === 'cloudflare' ? cloudflareReady : false;
    const specialProvider = providerName === 'tokenharbor' || providerName === 'cloudflare';
    if (authorized && !authorized.has(provider) && !specialReady) continue;
    // A provider that is present but not wired up used to be dropped from the
    // list entirely, which is the opposite of useful: the user could not tell a
    // missing key from a model that does not exist. It is listed with a verdict
    // instead, so it sits at the bottom as not-selectable until it is set up.
    if (specialProvider && !specialReady && !includeUnready) continue;
    const models = entry && typeof entry === 'object' ? entry.models : null;
    if (!models || typeof models !== 'object') continue;
    for (const [id, spec] of Object.entries(models)) {
      const cost = (spec && typeof spec === 'object' ? spec.cost : null) || {};
      if (Number(cost.input) !== 0 || Number(cost.output) !== 0) continue;
      // A zero price is not a free model; the name is the signal.
      if (!/-free/.test(id) && !FREE_NAME_EXCEPTIONS[id]) continue;
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
  // One answer per question. This used to require the `freebuff`/`manicode`
  // binary to be on PATH *and* a credentials file to exist, while /setup's check
  // only looked for the file. On this host the bot's PATH has no manicode, so
  // /setup said "signed in" and /freemodel said "pending setup/sign-in" for the
  // same provider, in the same minute. The credential lookup is now the shared
  // one, so the two surfaces cannot disagree about whether Freebuff is signed in.
  const { findFreebuffCredentials } = setupGapsModule;
  return findFreebuffCredentials({ env, home }).ok === true;
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
    const opencodeRefs = listFreeOpenCode({ ...opts, env, home, includeUnready: true });
    const keyedReady = specialProviderReadiness({ ...opts, env, home });
    for (const ref of opencodeRefs) {
      // A keyed provider that is present but not wired up stays in the list as a
      // row with a verdict, rather than being dropped. The user then sees which
      // models exist and what is missing, instead of a silent gap. The same goes
      // for a lane the vendor still catalogues but refuses to run (see
      // UNRUNNABLE_FREE_LANES): it is offered as a row you can see and cannot
      // pick, with the vendor's own reason, not as a button that fails on tap.
      const vendor = String(ref).split('/')[0].toLowerCase();
      const notReady = UNRUNNABLE_FREE_LANES[String(ref).toLowerCase()]
        || (vendor === 'tokenharbor' && !keyedReady.tokenharbor
          ? 'Token Harbor is not configured on this host (/setup)'
          : vendor === 'cloudflare' && !keyedReady.cloudflare
            ? 'Cloudflare Workers AI is not configured on this host (/setup)'
            : '');
      entries.push(entry(ref, { surface: 'opencode', tool: 'opencode', location, selectable: !notReady, note: notReady }));
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

// formatFreeModelText used to live here and is gone with /free (2026-10-03).
// It rendered the raw catalog as a prose list, told the reader "Tap a model
// below to switch this chat" while attaching no keyboard at all, and /freemodel
// had already replaced it with the canonical lane list and real buttons. It was
// the only thing here that rendered that list as text, so removing the command
// removed its last caller rather than orphaning it.
