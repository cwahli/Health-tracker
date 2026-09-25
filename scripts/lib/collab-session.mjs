import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const HERMES_DIR = path.join(HOME, '.hermes');
const SESSION_FILE = path.join(HERMES_DIR, 'collab_session.json');

export const BACKENDS = {
  collab: {
    name: 'Google Colab GPU',
    defaultModel: 'Qwen/Qwen3.8-27B-Instruct',
    description: 'Self-hosted on Colab GPU via Cloudflare Tunnel',
  },
  'qwen-max': {
    name: 'Qwen 3.8 Max',
    defaultModel: 'qwen-3.8-max',
    description: 'Alibaba Cloud / OpenRouter 2.4T MoE Frontier Model',
  },
  'qwen-flash': {
    name: 'Qwen 3.8 Flash',
    defaultModel: 'qwen-3.8-flash',
    description: 'Fast, lightweight frontier API model for quick atomic fixes',
  },
  opencode: {
    name: 'OpenCode CLI',
    defaultModel: 'opencode/muse-spark-1.3-contributor-free',
    description: 'Local OpenCode agent with internal contributor models',
  },
  gemini: {
    name: 'Google Gemini Pro',
    defaultModel: 'gemini-2.0-flash',
    description: 'Google AI Pro tier API with high token quotas and sub-second speed',
  },
};

export const DEFAULT_SESSION = {
  activeBackend: 'opencode',
  model: 'opencode/muse-spark-1.3-contributor-free',
  activeProject: 'health-tracker',
  projects: {
    'health-tracker': {
      name: 'Health-tracker',
      repoUrl: 'https://github.com/cwahli/Health-tracker.git',
      branch: 'main',
      dir: '/root/Health-tracker',
    },
    'external-1': {
      name: 'PIP Defense & Rating Review Council',
      type: 'external',
      dir: path.join(HOME, 'projects', 'external-1'),
      gdriveFolder: '[External-1-PIP-Defense]',
      branch: 'main',
    },
  },
  collab: {
    tunnelUrl: null,
    status: 'offline',
    gpu: null,
    lastRegistered: null,
    lastHeartbeat: null,
  },
  git: {
    branch: 'main',
    autoPush: true,
  },
  history: [],
};

export function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, 'utf8');
      return { ...DEFAULT_SESSION, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('[collab-session] Error loading session, resetting to default:', err.message);
  }
  return { ...DEFAULT_SESSION };
}

export function saveSession(session) {
  fs.mkdirSync(HERMES_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2) + '\n', 'utf8');
  return session;
}

export function switchBackend(backendKey, customModel = null) {
  const session = loadSession();
  const def = BACKENDS[backendKey];
  if (!def) {
    throw new Error(
      `Unknown backend "${backendKey}". Supported backends: ${Object.keys(BACKENDS).join(', ')}`
    );
  }

  session.activeBackend = backendKey;
  session.model = customModel || def.defaultModel;

  session.history.unshift({
    timestamp: new Date().toISOString(),
    backend: backendKey,
    model: session.model,
  });
  if (session.history.length > 20) session.history.pop();

  return saveSession(session);
}

export function switchProject(projectNameOrUrl, options = {}) {
  const session = loadSession();
  let key = projectNameOrUrl.toLowerCase().trim();
  if (key === 'external 1' || key === '1' || key === 'pip' || key === 'pip-case') {
    key = 'external-1';
  }

  // If URL passed (e.g. https://github.com/user/my-project.git)
  if (key.startsWith('http') || key.includes('/')) {
    const parts = key.replace(/\.git$/, '').split('/');
    const repoName = parts[parts.length - 1];
    key = repoName.toLowerCase();
    if (!session.projects) session.projects = {};
    session.projects[key] = {
      name: repoName,
      repoUrl: projectNameOrUrl,
      branch: options.branch || 'main',
      dir: options.dir || path.join(HOME, 'src', repoName),
    };
  }

  if (!session.projects || !session.projects[key]) {
    const known = Object.keys(session.projects || {}).join(', ');
    throw new Error(`Unknown project "${key}". Known projects: ${known}. Or pass full GitHub URL: \`/project https://github.com/.../repo.git\``);
  }

  session.activeProject = key;
  session.git.branch = session.projects[key].branch || 'main';
  return saveSession(session);
}

export function getActiveProject() {
  const session = loadSession();
  const key = session.activeProject || 'health-tracker';
  return session.projects?.[key] || {
    name: 'Health-tracker',
    repoUrl: 'https://github.com/cwahli/Health-tracker.git',
    branch: 'main',
    dir: '/root/Health-tracker',
  };
}

export function registerColabTunnel(url, metadata = {}) {
  const session = loadSession();
  session.collab = {
    tunnelUrl: url.replace(/\/+$/, ''),
    status: 'online',
    gpu: metadata.gpu || 'L4/A100',
    lastRegistered: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  };
  return saveSession(session);
}

export function disconnectColab() {
  const session = loadSession();
  session.collab.status = 'offline';
  session.collab.tunnelUrl = null;
  return saveSession(session);
}

export function getSessionSummary() {
  const session = loadSession();
  const backend = BACKENDS[session.activeBackend] || { name: session.activeBackend };
  const project = getActiveProject();

  let collabStatusText = '🔴 Offline';
  if (session.collab.status === 'online' && session.collab.tunnelUrl) {
    collabStatusText = `🟢 Online (${session.collab.tunnelUrl})`;
  }

  return `🤖 *[Colab Bot Active Session]*
• *Active Project:* \`${project.name}\` (${project.branch})
• *Active Backend:* ${backend.name} (\`${session.activeBackend}\`)
• *Active Model:* \`${session.model}\`
• *Colab GPU Tunnel:* ${collabStatusText}
• *Auto-Push on Test Pass:* ${session.git.autoPush ? 'Enabled' : 'Disabled'}`;
}
