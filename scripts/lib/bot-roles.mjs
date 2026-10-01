/**
 * bot-roles.mjs — bot-identity roles (`/role accountant` and friends).
 *
 * Two different things share the word "role" in this fleet, and this file is
 * only about one of them:
 *
 * - chat persona (`switchChatRole` in bot-host.mjs): per-chat instructions
 *   within a project. Unchanged, still the fallback when the requested name
 *   is not a bot-identity role.
 * - bot identity (this file): the registry row that decides WHERE the bot
 *   works (agent.workspace), HOW (agent.skills procedure packs), and on WHAT
 *   MODEL (agent.model). Assigning one rewrites the bot's own row and the bot
 *   restarts into it — so it works for any bot, including a generic forge
 *   clone that starts life with none of these set.
 *
 * The catalog lives in bots/roles.json. Patch keys are bounded below: a role
 * may only touch per-bot leaves the clone gate already allowlists, so adding
 * a role can never fork fleet policy (commands, tokens, session behavior).
 * Everything here is pure except loadRoles; the registry write + restart live
 * in the bot-host.mjs handler, which is the only place with those side effects.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The only registry leaves a role may set or clear. */
export const ROLE_PATCH_KEYS = new Set([
  'notes',
  'agent.workspace',
  'agent.skills',
  'agent.model',
]);

export function defaultCatalogPath(repoRoot) {
  return path.join(repoRoot, 'bots', 'roles.json');
}

export function loadRoles(catalogPath) {
  const raw = fs.readFileSync(catalogPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.roles !== 'object' || Array.isArray(parsed.roles)) {
    throw new Error(`bot-roles: ${catalogPath} has no "roles" object`);
  }
  return parsed.roles;
}

/** Case-insensitive lookup; returns { id, ...role } or null. */
export function resolveRole(catalog, name) {
  const want = String(name ?? '').trim().toLowerCase();
  if (!want) return null;
  for (const [id, role] of Object.entries(catalog)) {
    if (id.toLowerCase() === want) return { id, ...role };
  }
  return null;
}

function getLeaf(obj, dotPath) {
  const parts = dotPath.split('.');
  let node = obj;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function setLeaf(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (node[part] === null || typeof node[part] !== 'object' || Array.isArray(node[part])) {
      node[part] = {};
    }
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

function deleteLeaf(obj, dotPath) {
  const parts = dotPath.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node?.[parts[i]];
    if (next === null || typeof next !== 'object') return;
    node = next;
  }
  if (node !== null && typeof node === 'object') delete node[parts[parts.length - 1]];
}

/**
 * Validate a catalog role structurally (unknown keys, bad shapes). Returns an
 * array of failure strings; empty means valid.
 */
export function validateRoleShape(id, role) {
  const failures = [];
  if (!role || typeof role !== 'object') return [`role "${id}" is not an object`];
  if (!String(role.label || '').trim()) failures.push(`role "${id}" has no label`);
  if (!String(role.blurb || '').trim()) failures.push(`role "${id}" has no blurb`);
  const set = role.set && typeof role.set === 'object' ? role.set : null;
  const clear = Array.isArray(role.clear) ? role.clear : null;
  if (!set) failures.push(`role "${id}" has no "set" object`);
  if (!clear) failures.push(`role "${id}" has no "clear" array`);
  for (const key of Object.keys(set || {})) {
    if (!ROLE_PATCH_KEYS.has(key)) {
      failures.push(`role "${id}" sets forbidden key "${key}" (allowed: ${[...ROLE_PATCH_KEYS].join(', ')})`);
    }
  }
  for (const key of clear || []) {
    if (!ROLE_PATCH_KEYS.has(key)) {
      failures.push(`role "${id}" clears forbidden key "${key}" (allowed: ${[...ROLE_PATCH_KEYS].join(', ')})`);
    }
  }
  return failures;
}

/**
 * Apply a role to a registry row (pure: returns the patched row, inputs
 * untouched). `<id>` in string values templates to the bot id.
 */
export function applyRoleToRow(row, role, botId) {
  const out = JSON.parse(JSON.stringify(row));
  for (const [key, value] of Object.entries(role.set || {})) {
    const rendered = typeof value === 'string' ? value.split('<id>').join(botId) : value;
    setLeaf(out, key, JSON.parse(JSON.stringify(rendered)));
  }
  for (const key of role.clear || []) deleteLeaf(out, key);
  // Prune an agent object emptied by clears, so the row reads as the thin
  // clone it is again instead of carrying `"agent": {}`.
  if (out.agent && typeof out.agent === 'object' && Object.keys(out.agent).length === 0) {
    delete out.agent;
  }
  return out;
}

/** Human-readable diff of what assigning the role changes on this row. */
export function describeRoleChange(row, role, botId) {
  const next = applyRoleToRow(row, role, botId);
  const lines = [];
  for (const key of [...Object.keys(role.set || {}), ...(role.clear || [])]) {
    const before = getLeaf(row, key);
    const after = getLeaf(next, key);
    const show = (v) => (v === undefined ? '(inherited)' : JSON.stringify(v));
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      lines.push(`• \`${key}\`: ${show(before)} → ${show(after)}`);
    }
  }
  return lines.length ? lines : ['• no changes — the row already matches this role'];
}

/**
 * Check the role's filesystem targets exist. `stat` is injected
 * (`(p) => boolean`) so tests drive it without touching disk.
 */
export function validateRoleTarget(role, { stat = null } = {}) {
  const isDir = stat || ((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  const workspace = role.set?.['agent.workspace'];
  if (workspace && !isDir(String(workspace))) {
    return { ok: false, reason: `workspace ${workspace} does not exist on this host` };
  }
  const skills = role.set?.['agent.skills'];
  if (Array.isArray(skills)) {
    for (const skill of skills) {
      const full = String(skill).startsWith('/') || !workspace
        ? String(skill)
        : path.join(String(workspace), String(skill));
      if (!isDir(full)) return { ok: false, reason: `skill pack ${skill} not found under ${workspace || '(no workspace)'}` };
    }
  }
  return { ok: true };
}
