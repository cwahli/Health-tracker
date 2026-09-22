#!/usr/bin/env node
/**
 * scripts/tool-allowance.mjs
 * 
 * Dynamic Tool Allowance Tracker & Selector for Orchestrator.
 * Monitors tool availability, quota/rate-limits, and allowances for:
 * - OpenCode (muse-spark-1.3, deepseek-flash-4.1)
 * - Cline CLI (with --auto-approve and thinking levels)
 * - Grok Build CLI
 * - Antigravity CLI (agy)
 *
 * Usage:
 *   node scripts/tool-allowance.mjs pick-tool [--category=meal] [--preferred=cline]
 *   node scripts/tool-allowance.mjs report-result --tool=cline --status=success --bug-id=BUG-123 --duration=30
 *   node scripts/tool-allowance.mjs report-result --tool=opencode --status=rate_limited --reason="429"
 *   node scripts/tool-allowance.mjs status
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const HERMES_DIR = process.env.HERMES_DIR || path.join(os.homedir(), '.hermes');
const STATE_FILE = path.join(HERMES_DIR, 'tool_allowances.json');
const LEARNING_POD_FILE = path.join(HERMES_DIR, 'learning_pod.json');

const DEFAULT_STATE = {
  tools: {
    opencode: {
      name: 'OpenCode',
      status: 'available',
      allowance_level: 'high',
      cooldown_until: null,
      success_count: 0,
      failure_count: 0,
      rate_limit_count: 0,
      last_used: null,
      default_model: 'deepseek-v4.1-flash',
      priority: 1
    },
    cline: {
      name: 'Cline CLI',
      status: 'available',
      allowance_level: 'high',
      cooldown_until: null,
      success_count: 0,
      failure_count: 0,
      rate_limit_count: 0,
      last_used: null,
      default_thinking: 'high',
      priority: 2
    },
    grok: {
      name: 'Grok Build CLI',
      status: 'available',
      allowance_level: 'high',
      cooldown_until: null,
      success_count: 0,
      failure_count: 0,
      rate_limit_count: 0,
      last_used: null,
      priority: 3
    },
    agy: {
      name: 'Antigravity CLI',
      status: 'unavailable',
      allowance_level: 'unavailable',
      reason: 'User location is not supported on VPS',
      cooldown_until: null,
      success_count: 0,
      failure_count: 0,
      rate_limit_count: 0,
      last_used: null,
      priority: 4
    }
  },
  history: []
};

function ensureDir() {
  if (!fs.existsSync(HERMES_DIR)) {
    try {
      fs.mkdirSync(HERMES_DIR, { recursive: true });
    } catch (e) {
      // Fallback to local .cache if ~/.hermes is not writable
    }
  }
}

function loadState() {
  ensureDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      // Merge with default tools to ensure new tools appear automatically
      for (const [key, defaultVal] of Object.entries(DEFAULT_STATE.tools)) {
        if (!parsed.tools[key]) {
          parsed.tools[key] = defaultVal;
        }
      }
      // Migrate depleted or outdated default models
      if (parsed.tools.opencode && (parsed.tools.opencode.default_model === "muse-spark-1.3" || !parsed.tools.opencode.default_model)) {
        parsed.tools.opencode.default_model = "deepseek-v4.1-flash";
      }
      return parsed;
    }
  } catch (e) {
    console.warn('[ToolAllowance] Could not read state file, using defaults:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function syncMemorySummary(state) {
  const memoryFile = path.join(HERMES_DIR, 'memories', 'MEMORY.md');
  if (!fs.existsSync(memoryFile)) return;
  try {
    let content = fs.readFileSync(memoryFile, 'utf-8');
    const statusNotes = [];
    if (state.tools.opencode && state.tools.opencode.status === 'depleted') {
      statusNotes.push('OpenCode model muse-spark-1.3 is depleted ($0 balance); default is deepseek-v4.1-flash.');
    }
    if (state.tools.agy && state.tools.agy.status === 'unavailable') {
      statusNotes.push('Antigravity CLI is unavailable (European VPS IP geo-blocked by Gemini API).');
    }
    if (state.tools.grok && state.tools.grok.cooldown_until && new Date(state.tools.grok.cooldown_until).getTime() > Date.now()) {
      statusNotes.push(`Grok is in cooldown until ${new Date(state.tools.grok.cooldown_until).toISOString()}.`);
    }

    const marker = '## Tool Allowance & Health Notes';
    if (statusNotes.length > 0) {
      const block = `${marker}\n${statusNotes.join('\n')}\n`;
      if (content.includes(marker)) {
        content = content.replace(new RegExp(`${marker}[\\s\\S]*?(?=\\n##|$)`), block);
      } else {
        content = content.trim() + `\n\n${block}`;
      }
    } else if (content.includes(marker)) {
      content = content.replace(new RegExp(`${marker}[\\s\\S]*?(?=\\n##|$)`), '');
    }

    if (content.length <= 2200) {
      fs.writeFileSync(memoryFile, content, 'utf-8');
    }
  } catch (e) {
    // Non-critical memory sync
  }
}

function saveState(state) {
  ensureDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    syncMemorySummary(state);
  } catch (e) {
    console.warn('[ToolAllowance] Could not save state file:', e.message);
  }
}

function isBinaryInstalled(toolName) {
  const binaryMap = {
    opencode: ['opencode', path.join(os.homedir(), '.opencode/bin/opencode')],
    cline: ['cline', path.join(os.homedir(), '.local/bin/cline'), '/usr/local/bin/cline'],
    grok: ['grok', path.join(os.homedir(), '.grok/bin/grok'), path.join(os.homedir(), '.local/bin/grok')],
    agy: ['agy', path.join(os.homedir(), '.local/bin/agy'), path.join(os.homedir(), '.gemini/antigravity/bin/agy')]
  };

  const candidates = binaryMap[toolName] || [toolName];
  for (const bin of candidates) {
    try {
      execSync(`which "${bin}" 2>/dev/null || test -x "${bin}"`, { stdio: 'ignore' });
      return true;
    } catch (e) {
      // continue search
    }
  }
  return false;
}

function refreshCooldowns(state) {
  const now = Date.now();
  let changed = false;

  for (const [name, tool] of Object.entries(state.tools)) {
    if (tool.cooldown_until) {
      const cooldownMs = new Date(tool.cooldown_until).getTime();
      if (now >= cooldownMs) {
        tool.cooldown_until = null;
        tool.status = 'available';
        tool.allowance_level = 'high';
        changed = true;
        console.log(`[ToolAllowance] Cooldown expired for ${name}. Restored to available.`);
      }
    }
  }

  if (changed) {
    saveState(state);
  }
}

function pickTool(options = {}) {
  const state = loadState();
  refreshCooldowns(state);

  const preferred = options.preferred;
  const category = options.category || 'general';

  // Check if preferred tool is installed and available
  if (preferred && state.tools[preferred]) {
    const prefTool = state.tools[preferred];
    const isInstalled = isBinaryInstalled(preferred);
    const inCooldown = prefTool.cooldown_until && new Date(prefTool.cooldown_until).getTime() > Date.now();

    if (isInstalled && !inCooldown && prefTool.status !== 'depleted' && prefTool.status !== 'unavailable') {
      return {
        tool: preferred,
        config: prefTool,
        reason: `Explicitly preferred tool '${preferred}' is healthy and available.`
      };
    } else {
      console.warn(`[ToolAllowance] Preferred tool '${preferred}' unavailable (installed=${isInstalled}, inCooldown=${inCooldown}, status=${prefTool.status}). Falling back to pool...`);
    }
  }

  // Evaluate all tools in priority order
  const toolKeys = Object.keys(state.tools).sort((a, b) => state.tools[a].priority - state.tools[b].priority);

  for (const key of toolKeys) {
    const tool = state.tools[key];
    const isInstalled = isBinaryInstalled(key);
    const inCooldown = tool.cooldown_until && new Date(tool.cooldown_until).getTime() > Date.now();

    if (!isInstalled) {
      tool.status = 'not_installed';
      continue;
    }

    if (inCooldown) {
      tool.status = 'rate_limited';
      continue;
    }

    if (tool.status === 'depleted' || tool.status === 'unavailable') {
      continue;
    }

    // Found the best available tool with healthy allowance
    return {
      tool: key,
      config: tool,
      reason: `Selected '${key}' as highest-priority healthy tool in pool (allowance: ${tool.allowance_level}).`
    };
  }

  // All automated tools exhausted
  return {
    tool: 'none',
    config: null,
    reason: 'All automated tools in the pool are rate-limited, depleted, or not installed.'
  };
}

function reportResult(toolName, status, meta = {}) {
  const state = loadState();
  refreshCooldowns(state);

  const tool = state.tools[toolName];
  if (!tool) {
    console.error(`[ToolAllowance] Unknown tool '${toolName}'`);
    return;
  }

  const timestamp = new Date().toISOString();
  tool.last_used = timestamp;

  if (status === 'success') {
    tool.success_count += 1;
    tool.failure_count = 0;
    tool.status = 'available';
    tool.allowance_level = 'high';
    tool.cooldown_until = null;
  } else if (status === 'depleted') {
    tool.status = 'depleted';
    tool.allowance_level = 'depleted';
    tool.cooldown_until = null;
    console.log(`[ToolAllowance] Tool ${toolName} permanently marked depleted (insufficient funds)`);
  } else if (status === 'unavailable') {
    tool.status = 'unavailable';
    tool.allowance_level = 'unavailable';
    tool.cooldown_until = null;
    console.log(`[ToolAllowance] Tool ${toolName} marked unavailable (${meta.reason || 'location blocked'})`);
  } else if (status === 'rate_limited' || status === 'low_allowance') {
    tool.rate_limit_count += 1;
    tool.allowance_level = status;
    tool.status = 'rate_limited';
    // 15 minute cooldown for rate limit / low quota
    const cooldownDate = new Date(Date.now() + 15 * 60 * 1000);
    tool.cooldown_until = cooldownDate.toISOString();
    console.log(`[ToolAllowance] Tool ${toolName} placed in cooldown until ${tool.cooldown_until} (${meta.reason || 'quota reached'})`);
  } else if (status === 'failed') {
    tool.failure_count += 1;
    if (tool.failure_count >= 3) {
      tool.allowance_level = 'degraded';
      // 10 minute cooldown after 3 consecutive failures
      tool.cooldown_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    }
  }

  const historyEntry = {
    timestamp,
    tool: toolName,
    status,
    bug_id: meta.bug_id || 'N/A',
    category: meta.category || 'general',
    duration_seconds: meta.duration_seconds || 0,
    reason: meta.reason || null
  };

  state.history.unshift(historyEntry);
  if (state.history.length > 100) state.history = state.history.slice(0, 100);

  saveState(state);

  // Also update learning pod
  try {
    let learningPod = { models: {}, history: [] };
    if (fs.existsSync(LEARNING_POD_FILE)) {
      learningPod = JSON.parse(fs.readFileSync(LEARNING_POD_FILE, 'utf-8'));
    }
    learningPod.history = learningPod.history || [];
    learningPod.history.unshift(historyEntry);
    if (learningPod.history.length > 100) learningPod.history = learningPod.history.slice(0, 100);
    fs.writeFileSync(LEARNING_POD_FILE, JSON.stringify(learningPod, null, 2));
  } catch (e) {
    // optional learning pod update
  }
}

// CLI Command Dispatcher
const args = process.argv.slice(2);
const command = args[0] || 'status';

function parseArg(flag, defaultValue = null) {
  const match = args.find(a => a.startsWith(`--${flag}=`));
  if (match) return match.slice(flag.length + 3);
  return defaultValue;
}

if (command === 'pick-tool') {
  const preferred = parseArg('preferred');
  const category = parseArg('category');
  const result = pickTool({ preferred, category });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'report-result') {
  const tool = parseArg('tool');
  const status = parseArg('status', 'success');
  const bugId = parseArg('bug-id');
  const category = parseArg('category');
  const duration = parseInt(parseArg('duration', '0'), 10);
  const reason = parseArg('reason');

  if (!tool) {
    console.error('Error: --tool is required for report-result');
    process.exit(1);
  }

  reportResult(tool, status, { bug_id: bugId, category, duration_seconds: duration, reason });
  console.log(`[ToolAllowance] Recorded ${status} for ${tool}.`);
} else if (command === 'status') {
  const state = loadState();
  refreshCooldowns(state);

  console.log('=== Tool Allowance & Availability Status ===');
  for (const [key, tool] of Object.entries(state.tools)) {
    const installed = isBinaryInstalled(key);
    const cooldown = tool.cooldown_until ? ` (Cooldown until ${tool.cooldown_until})` : '';
    console.log(`- ${tool.name} (${key}): Installed=${installed}, Status=${tool.status}, Allowance=${tool.allowance_level}${cooldown}, Successes=${tool.success_count}, Fails=${tool.failure_count}`);
  }
} else if (command === 'list-agents') {
  const state = loadState();
  refreshCooldowns(state);

  const AGENT_META = {
    opencode: { tier: 'free', models: ['deepseek-v4.1-flash (active)', 'muse-spark-1.3 (depleted)'], thinking: false },
    cline:    { tier: 'free', models: ['DeepSeek auto-approve'],                 thinking: true  },
    grok:     { tier: 'free', models: ['grok-build (free quota)'],               thinking: false },
    agy:      { tier: 'free', models: ['gemini-flash (geo-blocked on VPS)'],     thinking: false }
  };

  console.log('Agent Pool Status:\n');
  for (const [key, tool] of Object.entries(state.tools)) {
    const installed = isBinaryInstalled(key);
    const meta = AGENT_META[key] || { tier: 'unknown', models: [], thinking: false };
    const inCooldown = tool.cooldown_until && new Date(tool.cooldown_until).getTime() > Date.now();
    const isDepleted = tool.status === 'depleted';
    const isUnavailable = tool.status === 'unavailable';
    const available = installed && !inCooldown && !isDepleted && !isUnavailable;
    const icon = !installed ? '[MISSING]' : isUnavailable ? '[GEOBLOCKED]' : isDepleted ? '[DEPLETED]' : inCooldown ? '[COOLDOWN]' : '[OK]';
    const cooldownStr = inCooldown ? ` cooldown until ${new Date(tool.cooldown_until).toLocaleTimeString()}` : '';
    const reasonStr = isUnavailable && tool.reason ? ` (${tool.reason})` : isDepleted ? ' (out of funds)' : '';
    const thinkingStr = meta.thinking ? ' | thinking: high/low' : '';
    console.log(`${icon} ${tool.name} | tier: ${meta.tier} | ${available ? 'available' : 'unavailable'}${cooldownStr}${reasonStr}`);
    console.log(`       models: ${meta.models.join(', ')}${thinkingStr}`);
    console.log(`       successes: ${tool.success_count} | failures: ${tool.failure_count}`);
  }
} else if (command === 'probe' || command === 'canary') {
  const targetTool = parseArg('tool');
  const state = loadState();
  refreshCooldowns(state);

  const toolsToProbe = targetTool ? [targetTool] : Object.keys(state.tools);
  console.log('=== Canary Health Probe ===');
  for (const t of toolsToProbe) {
    const tool = state.tools[t];
    if (!tool) {
      console.log(`[UNKNOWN] Tool '${t}' not in pool`);
      continue;
    }
    const installed = isBinaryInstalled(t);
    const isDepleted = tool.status === 'depleted';
    const isUnavailable = tool.status === 'unavailable';
    const inCooldown = tool.cooldown_until && new Date(tool.cooldown_until).getTime() > Date.now();

    if (!installed) {
      console.log(`❌ ${tool.name} (${t}): Binary missing from system path.`);
    } else if (isUnavailable) {
      console.log(`🚫 ${tool.name} (${t}): Marked unavailable (${tool.reason || 'geo-blocked'}).`);
    } else if (isDepleted) {
      console.log(`💸 ${tool.name} (${t}): Depleted balance / insufficient credits.`);
    } else if (inCooldown) {
      console.log(`⏳ ${tool.name} (${t}): In cooldown until ${tool.cooldown_until}.`);
    } else {
      console.log(`✅ ${tool.name} (${t}): Healthy and ready for dispatch.`);
    }
  }
} else if (command === 'list-models' || command === 'models') {
  const state = loadState();
  refreshCooldowns(state);

  const MODEL_CATALOG = {
    opencode: {
      name: 'OpenCode CLI',
      models: [
        { id: 'deepseek-v4.1-flash', status: 'available', tier: 'free', notes: 'Recommended active model. Fast and reliable.' },
        { id: 'deepseek-chat', status: 'available', tier: 'free', notes: 'General reasoning model.' },
        { id: 'muse-spark-1.3', status: 'depleted', tier: 'paid', notes: 'Depleted ($0 balance / insufficient account funds).' }
      ],
      thinking_modes: ['low', 'high', 'auto'],
      default_model: 'deepseek-v4.1-flash'
    },
    cline: {
      name: 'Cline CLI',
      models: [
        { id: 'deepseek', status: 'available', tier: 'api', notes: 'Direct DeepSeek API integration with auto-approve.' }
      ],
      thinking_modes: ['high', 'low', 'none'],
      default_model: 'deepseek'
    },
    grok: {
      name: 'Grok Build CLI',
      models: [
        { id: 'grok-build', status: 'available', tier: 'free-quota', notes: 'xAI Grok Build. 6-minute timeout limit.' }
      ],
      thinking_modes: ['none'],
      default_model: 'grok-build'
    },
    agy: {
      name: 'Antigravity CLI (agy)',
      models: [
        { id: 'gemini-flash', status: 'unavailable', tier: 'free', notes: 'Geo-blocked: Gemini API unavailable on VPS datacenter IP.' }
      ],
      thinking_modes: ['none'],
      default_model: 'gemini-flash'
    }
  };

  const asJson = args.includes('--json');
  if (asJson) {
    console.log(JSON.stringify(MODEL_CATALOG, null, 2));
    process.exit(0);
  }

  console.log('=== Granular Agent & Model Catalog ===\n');
  for (const [toolKey, toolInfo] of Object.entries(MODEL_CATALOG)) {
    const toolState = state.tools[toolKey] || {};
    const installed = isBinaryInstalled(toolKey);
    const inCooldown = toolState.cooldown_until && new Date(toolState.cooldown_until).getTime() > Date.now();
    const toolStatus = !installed ? 'NOT INSTALLED' : inCooldown ? 'COOLDOWN' : (toolState.status || 'unknown').toUpperCase();

    console.log(`• [${toolKey}] ${toolInfo.name} (${toolStatus})`);
    console.log(`  Thinking Modes: ${toolInfo.thinking_modes.join(', ')}`);
    console.log('  Available Models:');
    for (const m of toolInfo.models) {
      const mark = m.status === 'available' ? '✅' : m.status === 'depleted' ? '💸' : '🚫';
      console.log(`    ${mark} ${m.id} [${m.tier}] - ${m.notes}`);
    }
    console.log('');
  }
} else {
  console.log('Usage: node scripts/tool-allowance.mjs <status|list-agents|list-models|pick-tool|report-result|probe> [options]');
}
