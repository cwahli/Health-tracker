import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, resolveRegistryPath } from './registry.mjs';
import { projectIdForWorkspace } from './work-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HERMES_DIR = path.join(os.homedir(), '.hermes');
const STATE_FILE = path.join(HERMES_DIR, 'projects_state.json');

const CORE_PROJECT_ROLES = [
  {
    id: 'lead_architect',
    name: 'Lead System Architect',
    description: 'Preserves system invariants, schema integrity, and overall technical vision',
    instructions: 'You are the Lead System Architect for Health-tracker. Your mandate is to maintain architecture integrity, review code changes, enforce invariant rules, ensure clean data plane boundaries, and prevent regressions.',
    tools: ['read', 'grep', 'git_status', 'review'],
  },
  {
    id: 'frontend_ui',
    name: 'Frontend UI/UX Specialist',
    description: 'Builds and optimizes React 19 UI, Lucide icons, Tailwind styling, and mobile responsiveness',
    instructions: 'You are the Frontend UI/UX Specialist. You build user-facing React 19 UI components, ensure 100% mobile viewport responsiveness, optimize icon tree-shaking, adhere to component design guidelines, and deliver delightful UX.',
    tools: ['read', 'write_code', 'build', 'lint'],
  },
  {
    id: 'data_backend',
    name: 'Data & Cloud Backend Engineer',
    description: 'Oversees Cloudflare D1 SQL, Supabase sync, R2 photo buckets, and Node server routes',
    instructions: 'You are the Data & Cloud Backend Engineer. You manage backend endpoints in dist/server.cjs, safeguard D1 SQL schemas, handle R2 photo uploads, verify Firebase sessions, and optimize query latency.',
    tools: ['read', 'write_code', 'db_query', 'build'],
  },
  {
    id: 'qa_audit',
    name: 'QA & Forensic Regression Auditor',
    description: 'Runs automated smoke tests, journey test suites (meal, biomarker, onboarding), and catches bugs',
    instructions: 'You are the QA & Forensic Regression Auditor. Your job is to verify user journeys, run automated tests (scripts/qa-runner.mjs), catch regressions, and provide concrete pass/fail proof before code merges.',
    tools: ['read', 'run_tests', 'qa_runner'],
  },
  {
    id: 'reliability_ops',
    name: 'Reliability & Infrastructure Ops',
    description: 'Maintains Caddy reverse proxy, systemd services, fail2ban, health checks, and watchdog scripts',
    instructions: 'You are the Reliability & Infrastructure Ops Engineer. You manage Caddy SSL configurations, monitor systemd units (health-tracker.service, tmux-health), tune fail2ban rules, inspect watchdog logs, and ensure 99.9% host uptime.',
    tools: ['read', 'systemctl', 'caddy_reload', 'netstat'],
  },
];

const COUNCIL_ROLES = [
  { id: 'accuracy_review', name: 'Accuracy Review (Forensic Auditor)', file: 'accuracy_review.md' },
  { id: 'case_review', name: 'Case Review (Defense Strategist)', file: 'case_review.md' },
  { id: 'manager_simulation', name: 'Manager Representative (Red Team)', file: 'manager_simulation.md' },
  { id: 'legal_policy', name: 'Legal & Policy (Procedural Compliance)', file: 'legal_policy.md' },
  { id: 'arbitrator', name: 'Arbitrator (The Strategic Judge)', file: 'arbitrator.md' },
  { id: 'final_case_builder', name: 'Final Case Builder (Executive Publisher)', file: 'final_case_builder.md' },
];

export const KNOWN_PROJECTS = {
  'health-tracker': {
    id: 'health-tracker',
    name: 'Health Tracker Website (Project 1)',
    type: 'internal',
    projectNumber: 1,
    workspace: REPO_ROOT,
    allowGit: true,
    description: 'Main Health-tracker website and biomarker platform',
    roles: CORE_PROJECT_ROLES,
  },
  'external-1': {
    id: 'external-1',
    name: 'PIP Defense & Rating Review Council (External 1)',
    type: 'external',
    projectNumber: 1,
    workspace: path.join(os.homedir(), 'projects', 'external-1'),
    templateDir: path.join(REPO_ROOT, 'projects', 'external-1'),
    allowGit: false,
    gdriveFolder: '[External-1-PIP-Defense]',
    description: 'Multi-agent legal, accuracy, and defense case council for performance rating and PIP navigation',
    roles: COUNCIL_ROLES,
  },
  'external-2': {
    id: 'external-2',
    name: 'PIP Defense & Rating Review Council (Project 2)',
    type: 'external',
    projectNumber: 2,
    workspace: path.join(os.homedir(), 'projects', 'external-2'),
    templateDir: path.join(REPO_ROOT, 'projects', 'external-2'),
    allowGit: false,
    gdriveFolder: '[External-2-PIP-Defense]',
    description: 'Multi-agent legal, accuracy, and defense case council for performance rating and PIP navigation',
    roles: COUNCIL_ROLES,
  },
};

/**
 * The directory a worker should run in, for the workspace id a job carries.
 *
 * A job travels with an id, not a path: `/home/ubuntu/src/Health-tracker` is
 * this machine's checkout and means nothing on the notebook that claims the
 * job. The id is resolved here on the machine that will do the work, so each
 * host lands in its own checkout for the same project.
 *
 * Candidates, in order: this host's registry entry (what its own bot would
 * use), the project's path on this machine (external-N lives under
 * ~/projects), then the id itself when it is already an absolute path — a
 * workspace nothing knows about is passed through rather than guessed at.
 * The first candidate that exists wins; null means "nothing here matches",
 * and the caller runs in its own directory instead of spawning into a
 * missing one.
 */
export function workspaceForId(id, { host = '' } = {}) {
  const key = String(id || '').trim();
  if (!key) return null;
  const candidates = [];
  if (host) {
    try {
      const registry = loadRegistry(resolveRegistryPath(null, REPO_ROOT));
      const bot = (registry.bots || []).find((b) => b.id === host);
      const ws = bot?.agent?.workspace;
      // The registry's workspace is that bot's checkout; it answers for this
      // id only when it is the same project, or a notebook's website path
      // would be handed an external job.
      if (ws && projectIdForWorkspace(ws) === key) candidates.push(ws);
    } catch {
      // no registry on this host: fall through to the project's own path
    }
  }
  const known = KNOWN_PROJECTS[key]?.workspace;
  if (known) candidates.push(known);
  if (path.isAbsolute(key)) candidates.push(key);
  return (
    candidates.find((p) => {
      try {
        return Boolean(p) && fs.existsSync(p);
      } catch {
        return false;
      }
    }) || null
  );
}

export const ROLE_ALIASES = {
  // Project 1 Core Engineering Roles
  arch: 'lead_architect',
  architect: 'lead_architect',
  lead: 'lead_architect',
  ui: 'frontend_ui',
  frontend: 'frontend_ui',
  data: 'data_backend',
  backend: 'data_backend',
  db: 'data_backend',
  qa: 'qa_audit',
  test: 'qa_audit',
  audit_dev: 'qa_audit',
  ops: 'reliability_ops',
  infra: 'reliability_ops',
  reliability: 'reliability_ops',

  // Project 2 Council Roles
  accuracy: 'accuracy_review',
  audit: 'accuracy_review',
  case: 'case_review',
  defense: 'case_review',
  sim: 'manager_simulation',
  simulate: 'manager_simulation',
  manager: 'manager_simulation',
  legal: 'legal_policy',
  policy: 'legal_policy',
  arb: 'arbitrator',
  arbitrator: 'arbitrator',
  judge: 'arbitrator',
  builder: 'final_case_builder',
  final: 'final_case_builder',
  casebuilder: 'final_case_builder',
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {
    // fallback to empty state
  }
  return { chats: {}, dynamicProjects: {} };
}

function saveState(state) {
  try {
    fs.mkdirSync(HERMES_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('[project-registry] Failed to save state:', err.message);
  }
}

// Load any previously persisted dynamic projects into KNOWN_PROJECTS
function loadPersistedProjects() {
  const state = loadState();
  if (state.dynamicProjects) {
    for (const [id, def] of Object.entries(state.dynamicProjects)) {
      if (!KNOWN_PROJECTS[id]) {
        KNOWN_PROJECTS[id] = def;
      }
    }
  }
}
loadPersistedProjects();

/**
 * Dynamically provision a new external project (e.g. Project 3, Project 4).
 */
export function initExternalProject(rawIdOrNum, customName = null) {
  const numStr = String(rawIdOrNum).replace(/[^0-9]/g, '');
  const pid = numStr ? `external-${numStr}` : `external-${String(rawIdOrNum).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
  const name = customName || `External Project ${numStr || pid}`;
  const gdriveFolder = `[External-${numStr || pid}-${name.replace(/\s+/g, '-')}]`;
  const workspace = path.join(os.homedir(), 'projects', pid);
  const templateDir = path.join(REPO_ROOT, 'projects', pid);

  fs.mkdirSync(workspace, { recursive: true });

  // A new number gets a BLANK charter. Copying external-2 wholesale handed the
  // new project the rating case: its charter, its soul, and deliverable
  // templates whose tables were already filled with invented claims. Only the
  // role instruction files are shared; the case documents are written empty.
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true });
    const srcTmpl = path.join(REPO_ROOT, 'projects', 'external-2');
    const srcRoles = path.join(srcTmpl, 'roles');
    if (fs.existsSync(srcRoles)) {
      copyDirRecursive(srcRoles, path.join(templateDir, 'roles'));
    }
    fs.writeFileSync(path.join(templateDir, 'charter.md'), blankCharter(pid, name, gdriveFolder), 'utf8');
    fs.writeFileSync(path.join(templateDir, 'soul.md'), blankSoul(pid, name), 'utf8');
    const srcTemplates = path.join(srcTmpl, 'templates');
    if (fs.existsSync(srcTemplates)) {
      const destTemplates = path.join(templateDir, 'templates');
      fs.mkdirSync(destTemplates, { recursive: true });
      for (const file of fs.readdirSync(srcTemplates)) {
        const dest = path.join(destTemplates, file);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(srcTemplates, file), dest);
      }
      for (const file of fs.readdirSync(destTemplates)) {
        if (file.startsWith('0') || file.startsWith('A_') || file.startsWith('B_') || file.startsWith('C_')) {
          fs.writeFileSync(path.join(destTemplates, file), blankTemplate(file), 'utf8');
        }
      }
    }
  }

  const project = {
    id: pid,
    name,
    type: 'external',
    projectNumber: numStr ? Number(numStr) : null,
    workspace,
    templateDir,
    allowGit: false,
    gdriveFolder,
    description: `Dynamic external project workspace: ${name}`,
    roles: COUNCIL_ROLES,
  };

  KNOWN_PROJECTS[pid] = project;

  const state = loadState();
  state.dynamicProjects = state.dynamicProjects || {};
  state.dynamicProjects[pid] = project;
  saveState(state);

  seedProjectWorkspace(pid);
  return project;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}


/** Header-only case documents for a new external project. No invented rows. */
function blankTemplate(file) {
  if (file.startsWith('01_')) {
    return `# Case Facts & Timeline\n\n> One row per event. Leave a row empty rather than guessing; an accuracy strike removes a row, it never invents one.\n\n| Date | Event or interaction | What was said | What actually happened | Receipt or artifact | Follow-up |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n\n## Open questions\n1. \n`;
  }
  if (file.startsWith('02_')) {
    return `# Evidence & Metric Ledger\n\n> One row per claim under review. An empty ledger is correct until a receipt exists.\n\n| Claim ID | Area | Statement under review | Objective metric or deliverable | Evidence receipt | Context or blocker | Status |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  }
  if (file.startsWith('A_')) {
    return `# Talking Points\n\n> Filled from the ledger. Every line traces to a receipt.\n\n## Goal\n\n## Points\n1. \n\n## If the rating is disputed\n`;
  }
  if (file.startsWith('B_')) {
    return `# Formal Response\n\n**Date:**\n**To:**\n**From:**\n**Subject:**\n\n## Summary\n\n## Points under clarification\n\n## Evidence relied on\n\n## Acknowledgment\n`;
  }
  if (file.startsWith('C_')) {
    return `# 30/60/90 Alignment Plan\n\n**Period:**\n**Cadence:**\n\n## Principles\n1. Every objective is measurable and time-bound.\n2. Success is judged by a verified artifact, not an opinion.\n\n## Days 1-30\n| ID | Objective | Success criteria | Target date | Dependency |\n| :--- | :--- | :--- | :--- | :--- |\n\n## Days 31-60\n| ID | Objective | Success criteria | Target date | Dependency |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n\n## Days 61-90\n| ID | Objective | Success criteria | Target date | Dependency |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  }
  return `# ${file}\n`;
}

function blankCharter(pid, name, gdriveFolder) {
  return `# Project Charter: ${pid} — ${name}

> Blank charter. The mission, the objectives and the case are the user's to
> write. Nothing here is filled in on their behalf.

## Mission & Purpose
_TODO: one paragraph. What is this project for, in the user's own words._

## Objectives
1. _TODO_
2. _TODO_

## Ground rules
1. Receipts over rhetoric. Cite a date, a metric, or a record.
2. The charter and the evidence change only when the user changes them, or when accuracy appends a strike.
3. A contradiction stays as two dated lines. It is not resolved by deleting one.
4. Total website isolation. Never modify, commit, or push anything in the Health-tracker website repository.

## Operational boundary
- **Workspace**: ~/projects/${pid}
- **Drive folder**: ${gdriveFolder} (local mirror until an account is named)
- **Website repository**: off limits for writes, commits, and deploys.
`;
}

function blankSoul(pid, name) {
  return `# ${pid} shared soul: ${name}

Three laws every role obeys:
1. Receipts over rhetoric. Never dispute an opinion with another opinion; cite what exists.
2. Write only your own file. The charter and the evidence change only by the user or an accuracy strike.
3. Total website isolation. Never modify, commit, or push anything in the Health-tracker website repository.

Say when the documents are not enough. An empty ledger is a finding, not a gap to fill with a guess.
`;
}

/**
 * Resolves a raw string into a known project ID:
 * - "1", "project 1", "health-tracker", "ht", "website" -> "health-tracker"
 * - "2", "project 2", "external 2", "external-2", "pip", "pip-defense" -> "external-2"
 * - "external 1", "external-1" -> "external-1" (for backward compatibility)
 * - "3", "project 3", "external 3", "external-3" -> "external-3" (dynamically initialized)
 */
export function resolveProjectId(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/['"]/g, '');

  if (s === 'health-tracker' || s === 'ht' || s === 'main' || s === 'website') {
    return 'health-tracker';
  }
  if (s === '1' || s === 'project 1' || s === 'project1') {
    return 'health-tracker';
  }
  if (
    s === 'external 2' ||
    s === 'external-2' ||
    s === 'external2' ||
    s === '2' ||
    s === 'project 2' ||
    s === 'project2' ||
    s === 'pip' ||
    s === 'pip-case' ||
    s === 'pip-defense'
  ) {
    return 'external-2';
  }
  if (s === 'external 1' || s === 'external-1' || s === 'external1') {
    return 'external-1';
  }

  // Dynamic project 3+ check (e.g. "external 3", "project 3", "3", "external-4")
  const matchNum = s.match(/^(?:project\s*|external\s*|-)?(\d+)$/);
  if (matchNum) {
    const num = Number(matchNum[1]);
    if (num === 1) return 'health-tracker';
    if (num === 2) return 'external-2';
    if (num >= 3) {
      const pid = `external-${num}`;
      if (!KNOWN_PROJECTS[pid]) {
        initExternalProject(num);
      }
      return pid;
    }
  }

  const matchNamed = s.match(/^external[-_\s]+(.+)$/);
  if (matchNamed) {
    const sub = matchNamed[1].trim();
    if (sub === '1') return 'external-1';
    if (sub === '2') return 'external-2';
    const pid = `external-${sub}`;
    if (!KNOWN_PROJECTS[pid]) {
      initExternalProject(sub);
    }
    return pid;
  }

  if (KNOWN_PROJECTS[s]) return s;
  return null;
}

export function resolveRoleId(raw, projectId = 'external-2') {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/['"]/g, '');
  if (ROLE_ALIASES[s]) return ROLE_ALIASES[s];
  const project = KNOWN_PROJECTS[projectId] || KNOWN_PROJECTS['external-2'];
  if (project?.roles) {
    const match = project.roles.find((r) => r.id === s || r.id.includes(s));
    if (match) return match.id;
  }
  return null;
}

export function getChatProject(chatId) {
  const state = loadState();
  const cid = String(chatId);
  const entry = state.chats[cid];
  const pid = entry?.projectId || 'health-tracker';
  return KNOWN_PROJECTS[pid] || KNOWN_PROJECTS['health-tracker'];
}

export function getChatRole(chatId) {
  const state = loadState();
  const cid = String(chatId);
  return state.chats[cid]?.roleId || null;
}

export function switchChatProject(chatId, rawProjectId) {
  const pid = resolveProjectId(rawProjectId);
  if (!pid) {
    const known = Object.keys(KNOWN_PROJECTS).join(', ');
    throw new Error(`Unknown project "${rawProjectId}". Known projects: ${known}, or use "/project external 2", "/project 1", etc.`);
  }
  const state = loadState();
  const cid = String(chatId);
  state.chats[cid] = {
    ...(state.chats[cid] || {}),
    projectId: pid,
    roleId: null, // reset active role to full council when switching projects
    switchedAt: new Date().toISOString(),
  };

  const project = KNOWN_PROJECTS[pid];
  if (project.type === 'external') {
    fs.mkdirSync(project.workspace, { recursive: true });
    seedProjectWorkspace(pid);
  }

  saveState(state);
  return project;
}

export function switchChatRole(chatId, rawRole) {
  const currentProject = getChatProject(chatId);
  const roleId = resolveRoleId(rawRole, currentProject.id);
  if (!roleId) {
    const valid = (currentProject.roles || []).map((r) => r.id).join(', ');
    throw new Error(`Unknown role "${rawRole}". Valid roles for ${currentProject.name}: ${valid}`);
  }

  const state = loadState();
  const cid = String(chatId);
  state.chats[cid] = {
    ...(state.chats[cid] || {}),
    roleId,
    roleSwitchedAt: new Date().toISOString(),
  };
  saveState(state);
  return currentProject.roles.find((r) => r.id === roleId);
}

export function resetChatRole(chatId) {
  const state = loadState();
  const cid = String(chatId);
  if (state.chats[cid]) {
    delete state.chats[cid].roleId;
    saveState(state);
  }
}

export function seedProjectWorkspace(projectId) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj || !proj.templateDir || !proj.workspace) return;
  const tmplDir = path.join(proj.templateDir, 'templates');
  if (!fs.existsSync(tmplDir)) return;

  // The workspace may not exist yet: a project created on a fresh host has a
  // template dir but no folder. Copying into a missing directory threw ENOENT
  // and the whole council stage died before any model call.
  fs.mkdirSync(proj.workspace, { recursive: true });

  const files = fs.readdirSync(tmplDir);
  for (const f of files) {
    const src = path.join(tmplDir, f);
    const dest = path.join(proj.workspace, f);
    if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

export function getProjectSoul(projectId) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj || proj.type !== 'external') return null;
  const soulPath = path.join(proj.templateDir, 'soul.md');
  if (fs.existsSync(soulPath)) {
    return fs.readFileSync(soulPath, 'utf8');
  }
  // Fallback to external-2 soul if dynamic project
  const fallbackSoul = path.join(REPO_ROOT, 'projects', 'external-2', 'soul.md');
  if (fs.existsSync(fallbackSoul)) {
    return fs.readFileSync(fallbackSoul, 'utf8');
  }
  return null;
}

export function getProjectRoles(projectId) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) return [];
  if (proj.type !== 'external') {
    return proj.roles || CORE_PROJECT_ROLES;
  }

  // For external projects, scan roles/ directory dynamically
  const rolesDir = proj.templateDir && fs.existsSync(path.join(proj.templateDir, 'roles'))
    ? path.join(proj.templateDir, 'roles')
    : (proj.workspace && fs.existsSync(path.join(proj.workspace, 'roles')) ? path.join(proj.workspace, 'roles') : null);

  if (!rolesDir) {
    return proj.roles || COUNCIL_ROLES;
  }

  const files = fs.readdirSync(rolesDir).filter((f) => f.endsWith('.md'));
  if (!files.length) {
    return proj.roles || COUNCIL_ROLES;
  }

  const dynamicRoles = [];
  for (const f of files) {
    const roleId = f.replace(/\.md$/, '');
    const full = path.join(rolesDir, f);
    const content = fs.readFileSync(full, 'utf8');
    const firstLine = content.split('\n').find((l) => l.trim().startsWith('#'));
    const name = firstLine ? firstLine.replace(/^#+\s*/, '').trim() : roleId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    dynamicRoles.push({
      id: roleId,
      name,
      file: f,
      instructions: content,
      tools: ['standard_agent_tools'],
    });
  }

  proj.roles = dynamicRoles;
  return dynamicRoles;
}

export function addProjectRole(projectId, { id, name, instructions, tools = ['standard_agent_tools'] }) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) throw new Error(`Project ${projectId} not found.`);
  const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  const targetDirs = [
    proj.templateDir ? path.join(proj.templateDir, 'roles') : null,
    proj.workspace ? path.join(proj.workspace, 'roles') : null,
  ].filter(Boolean);

  const fileContent = `# ${name}\n\n${instructions.trim()}\n`;
  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${cleanId}.md`), fileContent, 'utf8');
  }

  if (!proj.roles) proj.roles = [];
  const existingIdx = proj.roles.findIndex((r) => r.id === cleanId);
  const roleObj = { id: cleanId, name, file: `${cleanId}.md`, instructions, tools };
  if (existingIdx >= 0) {
    proj.roles[existingIdx] = roleObj;
  } else {
    proj.roles.push(roleObj);
  }
  ROLE_ALIASES[cleanId] = cleanId;
  return roleObj;
}

export function removeProjectRole(projectId, rawRoleId) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) throw new Error(`Project ${projectId} not found.`);
  const canonicalId = resolveRoleId(rawRoleId, projectId) || rawRoleId;

  const targetDirs = [
    proj.templateDir ? path.join(proj.templateDir, 'roles') : null,
    proj.workspace ? path.join(proj.workspace, 'roles') : null,
  ].filter(Boolean);

  let removed = false;
  for (const dir of targetDirs) {
    const file = path.join(dir, `${canonicalId}.md`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      removed = true;
    }
  }

  if (proj.roles) {
    proj.roles = proj.roles.filter((r) => r.id !== canonicalId);
  }
  return removed;
}

export function getRoleInstructions(projectId, roleId) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj || !roleId) return null;
  const roles = getProjectRoles(projectId);
  const roleDef = roles?.find((r) => r.id === roleId);
  if (!roleDef) return null;
  if (roleDef.instructions) {
    return roleDef.instructions;
  }
  if (roleDef.file) {
    const rolePath = path.join(proj.templateDir || path.join(REPO_ROOT, 'projects', 'external-2'), 'roles', roleDef.file);
    if (fs.existsSync(rolePath)) {
      return fs.readFileSync(rolePath, 'utf8');
    }
  }
  return null;
}

export function checkRoleDetails(projectId, rawRole) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) return null;
  const canonicalRoleId = resolveRoleId(rawRole, projectId);
  if (!canonicalRoleId) return null;
  const roles = getProjectRoles(projectId);
  const roleDef = roles?.find((r) => r.id === canonicalRoleId);
  if (!roleDef) return null;
  const instructions = getRoleInstructions(projectId, canonicalRoleId);
  return {
    projectId,
    projectName: proj.name,
    roleId: canonicalRoleId,
    name: roleDef.name,
    description: roleDef.description || roleDef.name,
    instructions,
    tools: roleDef.tools || ['standard_agent_tools'],
  };
}

export function composeExternalPrompt({ chatId, prompt, activeProject = null, activeRole = null }) {
  const project = activeProject || getChatProject(chatId);
  const roleId = activeRole || getChatRole(chatId);

  if (project.type !== 'external') {
    if (!roleId) return prompt;
    const roleDef = project.roles?.find((r) => r.id === roleId);
    const roleInstructions = getRoleInstructions(project.id, roleId);
    const roleHeader = [
      `[PROJECT: ${project.name}]`,
      `[ACTIVE ROLE: ${roleDef ? roleDef.name : roleId}]`,
      roleInstructions ? `[ROLE INSTRUCTIONS]\n${roleInstructions.trim()}` : '',
      `\n[USER REQUEST]`,
    ].filter(Boolean).join('\n');
    return `${roleHeader}\n${prompt}`;
  }

  const soul = getProjectSoul(project.id);
  const rolePrompt = roleId ? getRoleInstructions(project.id, roleId) : null;

  const header = [
    `[PROJECT: ${project.name}]`,
    `[WORKSPACE: ${project.workspace}]`,
    `[GDRIVE FOLDER: ${project.gdriveFolder || 'N/A'}]`,
    `[SANDBOX RULE: Modifying files in /root/Health-tracker or git committing to website is STRICTLY PROHIBITED.]`,
    `[PRESERVED SKILLS: Tables rendering, images/media analysis, Cloudflare, Firebase, inter-bot collaboration remain fully enabled.]`,
  ];

  if (soul) {
    header.push(`\n[PROJECT SOUL]\n${soul.trim()}`);
  }

  if (rolePrompt) {
    header.push(`\n[ACTIVE ROLE: ${roleId}]\n${rolePrompt.trim()}`);
  } else {
    header.push(`\n[COUNCIL MODE: You represent the full Multi-Agent Council. Coordinate between Legal, Accuracy, Case Review, Manager Red-Team, and Arbitrator to build the best case.]`);
  }

  header.push('\n[USER REQUEST / EVIDENCE]');
  return `${header.join('\n')}\n${prompt}`;
}

export function formatProjectsSummary(chatId) {
  const current = getChatProject(chatId);
  const currentRole = getChatRole(chatId);

  const lines = [
    '📁 *[Projects Registry]*',
    `• *Active Project:* \`${current.name}\` (\`${current.id}\`)`,
    `• *Type:* ${current.type === 'external' ? '🌐 External Workspace' : '💻 Health-Tracker Website'}`,
    `• *Workspace:* \`${current.workspace}\``,
  ];

  if (current.type === 'external') {
    lines.push(`• *Google Drive Folder:* \`${current.gdriveFolder}\``);
    lines.push(`• *Active Role:* ${currentRole ? `\`${currentRole}\`` : '_Full Council (Collaborative)_'}`);
    lines.push(`• *Website Git Commits:* 🔒 _Disabled (Isolated)_`);
    lines.push('\n*Available Council Roles:*');
    for (const r of current.roles || []) {
      lines.push(`  - \`/role ${r.id.split('_')[0]}\` : ${r.name}`);
    }
  }

  lines.push('\n*Switch Commands:*');
  lines.push('• `/project 1` — Return to Health-tracker website');
  lines.push('• `/project external 2` — Switch to Project 2 (PIP Defense Council)');
  lines.push('• `/project external 3` — Dynamically create & switch to Project 3');
  lines.push('• `/council run` — Run multi-agent review');

  return lines.join('\n');
}
