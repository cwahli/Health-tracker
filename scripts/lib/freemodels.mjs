import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/**
 * Curated Gemini lane (shared infrastructure, see scripts/lib/agent-gemini.mjs).
 * Refs use the repo's provider/model shape (`gemini/<vendor-id>`) and select
 * with a `gemini:` prefix, mirroring `cline:`. Vendor-side ids must match the
 * Gemini API catalog; local validation only checks this list until a key is set.
 */
export const GEMINI_MODELS = [
  'gemini/gemini-3.7-flash',
  'gemini/gemini-3.8-flash',
  'gemini/gemini-3.1-pro',
  'gemini/gemini-3.5-flash-lite',
];

export const GEMINI_MODEL_NOTES = {
  'gemini/gemini-3.7-flash': 'keyed API lane (GEMINI_API_KEY); single-shot, no tools/session',
  'gemini/gemini-3.8-flash': 'keyed API lane (GEMINI_API_KEY); single-shot, no tools/session',
  'gemini/gemini-3.1-pro': 'keyed API lane (GEMINI_API_KEY); strongest reasoning of the four',
  'gemini/gemini-3.5-flash-lite': 'keyed API lane (GEMINI_API_KEY); cheapest/fastest of the four',
};

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
  if (surface === 'gemini') {
    // Keyed lane, not zero-cost: label says (api) so the picker is honest.
    const pretty = id.replace(/^gemini\//, '');
    return `gemini:${pretty} (api)`;
  }
  return `${id.replace('/', ':')} (free)`;
}

function defaultPaths() {
  return {
    modelsCachePath: path.join(os.homedir(), '.cache', 'opencode', 'models.json'),
    authPath: path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'),
  };
}

function defaultReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function listFreeOpenCode({ modelsCachePath, authPath, readJson } = {}) {
  const read = readJson || defaultReadJson;
  const paths = defaultPaths();
  const cache = read(modelsCachePath || paths.modelsCachePath);
  const auth = read(authPath || paths.authPath);
  if (!cache || typeof cache !== 'object') return [];
  const authorized = auth && typeof auth === 'object' ? new Set(Object.keys(auth)) : null;
  const refs = [];
  for (const [provider, entry] of Object.entries(cache)) {
    if (authorized && !authorized.has(provider)) continue;
    const models = entry && typeof entry === 'object' ? entry.models : null;
    if (!models || typeof models !== 'object') continue;
    for (const [id, spec] of Object.entries(models)) {
      const cost = (spec && typeof spec === 'object' && spec.cost) || {};
      if (Number(cost.input) !== 0 || Number(cost.output) !== 0) continue;
      refs.push(`${provider}/${id}`);
    }
  }
  return [...new Set(refs)].sort();
}

export function buildFreeModelList(opts = {}) {
  const cline = CLINE_FREE_MODELS.map((id) => {
    const ref = toModelRef('cline', id);
    return { ref, label: formatFreeLabel(ref), surface: 'cline' };
  });
  // Curated before cache-scanned: deterministic on every host (VPS, phone,
  // collab) even when ~/.cache/opencode/models.json is absent.
  const gemini = GEMINI_MODELS.map((id) => {
    const ref = toModelRef('gemini', id);
    return { ref, label: formatFreeLabel(ref), surface: 'gemini' };
  });
  const opencode = listFreeOpenCode(opts).map((ref) => ({
    ref,
    label: formatFreeLabel(ref),
    surface: 'opencode',
  }));
  return [...cline, ...gemini, ...opencode];
}

export function formatFreeModelText(entries, { current } = {}) {
  const clineCount = entries.filter((entry) => entry.surface === 'cline').length;
  const geminiCount = entries.filter((entry) => entry.surface === 'gemini').length;
  const opencodeCount = entries.length - clineCount - geminiCount;
  const lines = [
    `Free models: ${entries.length} (${clineCount} cline, ${geminiCount} gemini, ${opencodeCount} opencode) · current: ${current || '(unknown)'}`,
    'Tap a model below to switch this chat.',
    'Cline DeepSeek has a daily free cap (~22h cooldown when hit); cline runs do not carry session context.',
    'Gemini lanes use the shared GEMINI_API_KEY lane (single-shot answers, no tools/session).',
  ];
  const notes = entries
    .filter((entry) => entry.surface === 'cline' && CLINE_FREE_NOTES[entry.ref.replace(/^cline:/, '')])
    .map((entry) => `• ${entry.label}: ${CLINE_FREE_NOTES[entry.ref.replace(/^cline:/, '')]}`);
  if (notes.length) lines.push('', ...notes);
  const geminiNotes = entries
    .filter((entry) => entry.surface === 'gemini' && GEMINI_MODEL_NOTES[entry.ref.replace(/^gemini:/, '')])
    .map((entry) => `• ${entry.label}: ${GEMINI_MODEL_NOTES[entry.ref.replace(/^gemini:/, '')]}`);
  if (geminiNotes.length) lines.push('', ...geminiNotes);
  return lines.join('\n');
}
