/**
 * readiness.mjs — "is this ready for bots?", answered from inside the product.
 *
 * The question comes up every time someone looks at the Personal Health Coach
 * and wonders whether a seat can actually run: the data has to be there, the
 * gate has to be readable, the four documents have to have a registry, and the
 * seat needs a context *and* a model credential. Every one of those can be
 * missing while `/health status` still answers — it reports the data loop, not
 * whether a seat could be started.
 *
 * So this check is deliberately its own surface. It reads the same artifacts
 * `/health status` reads plus the two things status never needed: the context a
 * seat would actually be handed, and whether a model credential exists on this
 * host. Each answer is a line with a level:
 *
 *   ok       — verified, with the number that makes it verifiable;
 *   finding  — a real gap that is not the machine's fault (an open fix-list
 *              item, a payload nobody has written yet, host config this box does
 *              not carry). Findings never refuse: the seat can still run.
 *   blocker  — a seat cannot run: no workspace/brief to read, no model
 *              credential. `ready` is false and the CLI exits 3, the same
 *              "refused on purpose" code `--analyze` uses.
 *
 * A missing credential is a *blocker*, not a finding, because the failure mode
 * it protects against is a seat that answers anyway — from an empty context —
 * with confident prose. The same rule as `readWorkspaceContext`: refuse, and
 * name the file the fix goes in.
 *
 * Read-only: reads files and env, writes nothing, never prints a secret value.
 */
import fs from 'node:fs';
import path from 'node:path';

import { KNOWN_PROJECTS } from '../project-registry.mjs';
import { geminiKeyIn } from '../agent-gemini.mjs';
import { ANALYSIS_FILE, BRIEF_FILES, VERIFY_FILE, buildHealthContext } from './context.mjs';
import { DOCS_FILE, loadDocsRegistry } from './docs.mjs';

/** The renewal window the charter names, plus a day of slack. */
export const STALE_AFTER_DAYS = 31;

export const CONTEXT_ENV_FILE = '~/.config/bot-host/common.env';

const days = (from, now) => Math.round((now.getTime() - Date.parse(from)) / 86400000);

/** One check line. */
const line = (key, level, title, detail = '') => ({ key, level, title, detail });

/**
 * Where the bot host reads its environment when it is not this shell.
 *
 * Only names are reported — never a value — so a missing key is actionable
 * without a secret ever reaching a chat or a log.
 */
function hostEnvLines(env) {
  const lines = [];
  const explicit = String(env.HEALTH_DOCS_FOLDER || env.GOOGLE_FOLDER_EXTERNAL_HEALTH || '').trim();
  lines.push(explicit
    ? line('docs_folder', 'ok', 'Document folder is named on this host')
    : line('docs_folder', 'finding', 'HEALTH_DOCS_FOLDER is not set on this host',
      `Add HEALTH_DOCS_FOLDER=<the External-Personal-Health-Coach folder id> to ${CONTEXT_ENV_FILE} (or GOOGLE_FOLDER_EXTERNAL_HEALTH), or /health refresh stays refused at stage 'docs-folder'.`));
  const envFile = String(env.HEALTH_ENV_FILE || '').trim();
  lines.push(envFile
    ? line('health_env_file', 'ok', 'HEALTH_ENV_FILE is set on this host', `Points at ${envFile}; the read-only D1 reader reads its credentials from there.`)
    : line('health_env_file', 'finding', 'HEALTH_ENV_FILE is not set on this host',
      `Add HEALTH_ENV_FILE=<checkout>/.env to ${CONTEXT_ENV_FILE} so /health verify can read the app; without it the verify refuses at stage 'config'.`));
  return lines;
}

/**
 * Role-file drift between the committed seats and the workspace's copy.
 *
 * The registry loads seats from the repo's `templateDir/roles`; a workspace may
 * also hold its own `roles/` (older projects do). When both exist and disagree,
 * the seat a chat runs is whichever the loader picked — which is exactly the
 * kind of difference nobody should have to guess at.
 */
function roleDriftLines(project, workspace) {
  const repoRoles = project?.templateDir ? path.join(project.templateDir, 'roles') : '';
  const wsRoles = path.join(workspace, 'roles');
  const list = (dir) => {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    } catch {
      return [];
    }
  };
  const committed = list(repoRoles);
  const inWorkspace = list(wsRoles);
  if (!committed.length) {
    return [line('seats', 'blocker', 'No seat files in the repo', `No *.md under ${repoRoles || '(no template dir)'} — the council has no seats to run.`)];
  }
  if (!inWorkspace.length) {
    return [line('seats', 'ok', `${committed.length} seats load from the repo`, `No workspace mirror at ${wsRoles}; seats load from ${repoRoles}: ${committed.join(', ')}.`)];
  }
  const missing = inWorkspace.filter((f) => !committed.includes(f));
  const extra = committed.filter((f) => !inWorkspace.includes(f));
  const differing = committed.filter((f) => inWorkspace.includes(f) && fs.readFileSync(path.join(repoRoles, f), 'utf8') !== fs.readFileSync(path.join(wsRoles, f), 'utf8'));
  if (!missing.length && !extra.length && !differing.length) {
    return [line('seats', 'ok', `${committed.length} seats, workspace mirror identical`, `${wsRoles} matches ${repoRoles}.`)];
  }
  return [line('seats', 'finding', 'The workspace role mirror differs from the repo', [
    differing.length ? `differs: ${differing.join(', ')}` : '',
    missing.length ? `only in the workspace: ${missing.join(', ')}` : '',
    extra.length ? `only in the repo: ${extra.join(', ')}` : '',
  ].filter(Boolean).join(' · ') + ' — the repo copy is the one the loader prefers, so a drift silently runs stale instructions.')];
}

/**
 * Run every check.
 *
 * `paths` is the caller's `{ workspace, sources, result }` (health-runner's
 * `healthPaths`, or `--workspace` on the CLI) so this module never has its own
 * opinion about where a project lives.
 */
export function checkHealthReadiness({
  projectId = 'external-health',
  env = process.env,
  paths = {},
  now = new Date(),
  modelKey = '',
} = {}) {
  const project = KNOWN_PROJECTS[projectId];
  const workspace = paths.workspace || project?.workspace || '';
  const result = paths.result || path.join(workspace, 'result');
  const at = now.toISOString();
  const checks = [];

  const exists = workspace && fs.existsSync(workspace) && fs.statSync(workspace).isDirectory();
  checks.push(exists
    ? line('workspace', 'ok', 'Workspace exists', workspace)
    : line('workspace', 'blocker', 'Workspace does not exist', `${workspace || '(unset)'} — nothing to seat a turn in. Set HEALTH_WORKSPACE or create the folder.`));

  // The context the seat would be handed, and the brief it refuses without.
  const context = exists ? buildHealthContext(workspace) : { ok: false, sections: [], absent: [], bytes: 0, refuses: ['workspace missing'] };
  checks.push(context.ok
    ? line('context', 'ok', `A seat sees ${context.sections.length} source(s), ${context.bytes} bytes`, `Absent (named as findings, not holes): ${context.absent.map((a) => a.path).join(', ') || 'none'}.`)
    : line('context', 'blocker', 'The seat context refuses', context.refuses.join('; ')));
  const brief = context.sections.find((s) => s.key === 'brief');
  checks.push(brief
    ? line('brief', 'ok', 'The brief is present', brief.path)
    : line('brief', 'blocker', 'No brief in the workspace', `Looked for ${BRIEF_FILES.join(', ')} in ${workspace || '(unset)'}.`));

  // The gate and the artifacts the data loop produces.
  let artifact = null;
  try {
    artifact = JSON.parse(fs.readFileSync(path.join(result, VERIFY_FILE), 'utf8'));
  } catch {
    artifact = null;
  }
  if (!artifact) {
    checks.push(line('verify', 'finding', 'No verify artifact', `Run /health ingest then /health verify — nothing in ${result} has been checked against the sheet.`));
  } else {
    const age = days(artifact.at, now);
    checks.push(Number.isFinite(age) && age > STALE_AFTER_DAYS
      ? line('verify', 'finding', `The verify artifact is ${age} days old`, `Older than the ${STALE_AFTER_DAYS}-day renewal window — re-run /health verify before a seat reasons from it.`)
      : line('verify', 'ok', `The verify artifact is ${Number.isFinite(age) ? `${age} day(s) old` : 'undated'}`, `Newest sheet date ${artifact.sheet?.newestDate || 'n/a'}, newest app date ${artifact.app?.newestDate || 'n/a'}.`));
    const open = (artifact.fixList?.items || []).filter((i) => i.state === 'open');
    checks.push(open.length
      ? line('gate', 'finding', `The data gate is OPEN (${open.length}: ${open.map((i) => i.id).join(', ')})`, 'These are the user\'s to fix in the app; the analysis stays refused by design, and a seat may run but every claim resting on an open item is unproven.')
      : line('gate', 'ok', 'The data gate is closed', 'Every fix-list item is closed or waived, so the analysis pass may publish.'));
  }

  const analysisPath = path.join(result, ANALYSIS_FILE);
  if (!fs.existsSync(analysisPath)) {
    checks.push(line('analysis', 'finding', 'No analysis payload', `Nothing has written ${ANALYSIS_FILE} yet, so every analysis section is unproven (Drop 2's Doctor seat is what produces it).`));
  } else {
    let shape = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
      shape = { at: parsed?.at || '', ok: true, error: '' };
    } catch (err) {
      shape = { at: '', ok: false, error: err.message };
    }
    if (!shape.ok) checks.push(line('analysis', 'finding', 'The analysis payload does not parse', shape.error));
    else {
      const again = buildHealthContext(workspace).sections.find((s) => s.key === 'analysis');
      const refused = /shape: REFUSED/.test(again?.text || '');
      checks.push(refused
        ? line('analysis', 'finding', 'The analysis payload would be refused by the publisher', 'The shape check names the offending key; /health refresh writes nothing while it is malformed.')
        : line('analysis', 'ok', 'The analysis payload is present and well-shaped', `Written ${shape.at || '(undated)'}.`));
    }
  }

  const docsPath = path.join(result, DOCS_FILE);
  if (fs.existsSync(docsPath)) {
    const registry = loadDocsRegistry(docsPath);
    const count = Object.keys(registry.docs || {}).length;
    checks.push(line('docs', count ? 'ok' : 'finding', count ? `${count} document(s) published` : 'The registry holds no documents', `Updated ${registry.updatedAt || 'unknown'}${count ? ` — keys: ${Object.keys(registry.docs).join(', ')}` : ' — /health refresh publishes the four documents.'}`));
  } else {
    checks.push(line('docs', 'finding', 'No document registry', `Nothing has been published from ${result} yet — /health refresh creates the four documents.`));
  }

  // The bot half: a context it can read, and a credential it can run on.
  const key = String(modelKey || geminiKeyIn(env) || '').trim();
  checks.push(key
    ? line('model', 'ok', 'A model credential is present on this host', 'Gemini lane only: the council runs single-shot with no tools or search grounding.')
    : line('model', 'blocker', 'No model credential on this host', `Set GEMINI_API_KEY in ${CONTEXT_ENV_FILE} (all bots on a host) or the phone's ~/.config/opencode-bot/<id>.env. /freemodel works without it; a seat turn does not.`));

  checks.push(...hostEnvLines(env));
  checks.push(...roleDriftLines(project, workspace));

  const blockers = checks.filter((c) => c.level === 'blocker').map((c) => c.key);
  const findings = checks.filter((c) => c.level === 'finding').map((c) => c.key);
  return {
    projectId,
    workspace,
    at,
    ready: blockers.length === 0,
    exit: blockers.length ? 3 : 0,
    blockers,
    findings,
    checks,
    context: { ok: context.ok, sections: context.sections.length, bytes: context.bytes, absent: context.absent.length },
  };
}

/** The Telegram reply: blockers first, then findings, then what is verified. */
export function formatReadinessText(result) {
  const icon = { ok: '✅', finding: '⚠️', blocker: '⛔' };
  const lines = [];
  lines.push(`🩺 *Health readiness — ${escapeMd(result.projectId)}*`);
  lines.push(result.ready
    ? '✅ *Ready for bots* — a seat turn can run on this host.'
    : `⛔ *Not ready for bots* — ${result.blockers.length} blocker(s): ${result.blockers.join(', ')}.`);
  lines.push(`• workspace \`${escapeMd(result.workspace || '(unset)')}\``);
  lines.push('');
  const rank = { blocker: 0, finding: 1, ok: 2 };
  for (const c of [...result.checks].sort((a, b) => rank[a.level] - rank[b.level])) {
    lines.push(`${icon[c.level] || '•'} *${escapeMd(c.title)}*`);
    if (c.detail) lines.push(`   ${escapeMd(c.detail)}`);
  }
  lines.push('');
  lines.push(result.ready
    ? 'Next: `/health status`, then run a seat stage.'
    : 'Fix the blockers above, then `/health readiness` again — findings alone do not stop a seat.');
  return lines.join('\n');
}

const escapeMd = (text) => String(text ?? '').replace(/([_*`[])/g, '\\$1');
