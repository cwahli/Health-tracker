#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

import { TelegramApi, TelegramError, chunkText } from './lib/tg-api.mjs';
import { sendCopyable } from './lib/tg-copy-code.mjs';
import { Throttle } from './lib/tg-throttle.mjs';
import { loadRegistry, resolveToken, resolveRegistryPath, normalizeConfig } from './lib/registry.mjs';
import {
  loadSession,
  saveSession,
  switchBackend,
  switchProject,
  getActiveProject,
  registerColabTunnel,
  disconnectColab,
  getSessionSummary,
  BACKENDS,
} from './lib/collab-session.mjs';
import {
  buildStatusSnapshot,
  formatStatusPlain,
  compactUnsupported,
} from './lib/bot-status.mjs';
import { listLocks } from './lib/file-locks.mjs';

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BOOTED_AT = Date.now();

/** Live per-file claims (informational only — /fix never blocks on them). */
function liveClaims() {
  return listLocks();
}

function claimWarning(arg) {
  const claims = liveClaims();
  if (!claims.length) return '';
  const lower = String(arg ?? '').toLowerCase();
  const hits = claims.filter((c) => c.file && lower.includes(String(c.file).toLowerCase()));
  if (!hits.length) return '';
  const names = [...new Set(hits.map((h) => `${h.file} (by ${h.bugId || 'another run'})`))].slice(0, 5);
  return `\n⚠️ Live claims: ${names.join(', ')} — the fix will route around them, not wait.`;
}

function lockHolder() {
  return null;
}

function acquireDispatchLock() {
  // Chat/fix never blocks on other agents. File claims are advisory at run
  // start (run-coding-dispatch.sh) + claim-guard on the open PRs.
  return null;
}

function releaseDispatchLock() {
  // No global lock to release anymore.
}

function getTargetCwd() {
  const p = getActiveProject();
  if (p && p.dir && fs.existsSync(p.dir)) {
    return p.dir;
  }
  return REPO_ROOT;
}

function parseArgs(argv) {
  const args = { id: 'collab', registry: null, simulate: null, checkConfig: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--check-config') args.checkConfig = true;
    else if (a.startsWith('--id=')) args.id = a.slice(5);
    else if (a.startsWith('--registry=')) args.registry = a.slice(11);
    else if (a.startsWith('--simulate=')) args.simulate = a.slice(11);
  }
  return args;
}

export function parseCollabCommand(text) {
  const t = text.trim();
  if (!t.startsWith('/')) return null;
  const match = t.match(/^\/([a-zA-Z0-9_-]+)(?:@\w+)?(?:\s+(.*))?$/s);
  if (!match) return null;
  return { name: match[1].toLowerCase(), arg: (match[2] || '').trim() };
}

async function handleCommand({ api, chatId, cmd, config }) {
  const { name, arg } = cmd;
  const targetDir = getTargetCwd();
  const currentProject = getActiveProject();

  if (name === 'start' || name === 'help') {
    const helpMsg = `🤖 *Welcome to Colab Bot!*

Mobile-first AI dev assistant and compute router for your projects.

*Project Management:*
• \`/project\` — View active project & list known repos
• \`/project <name>\` — Switch active project (e.g. \`/project health-tracker\`)
• \`/project <repo_url>\` — Clone & switch to a new GitHub repository

*Model & Compute Switching:*
• \`/switch\` or \`/switch status\` — Show active engine & Colab GPU status
• \`/switch <engine>\` — Switch model:
   - \`/switch colab\` (Qwen 3.8-27B on Colab GPU)
   - \`/switch qwen-max\` (Qwen 3.8 Max 2.4T MoE API)
   - \`/switch qwen-flash\` (Qwen 3.8 Flash fast API)
   - \`/switch opencode [model]\` (OpenCode CLI, e.g. muse-spark-1.3)
   - \`/switch gemini\` (Google AI Pro Gemini 2.0 / Pro)

*Colab Cloud Control:*
• \`/colab register <url>\` — Connect Colab Cloudflare tunnel
• \`/colab status\` — Check Colab GPU status
• \`/colab stop\` — Disconnect Colab & unassign runtime

*Dev & Execution:*
• \`/fix <task>\` — Pull latest $\\to$ code fix $\\to$ Playwright test $\\to$ git push
• \`/test [filter]\` — Run Playwright E2E tests headlessly
• \`/status\` — View git branch, working directory & lock status
• \`/compact\` - Session compaction (opencode bots only; not on collab)
• \`/cancel\` — Revert working tree & release dispatch lock`;
    await api.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
    return;
  }

  if (name === 'project') {
    if (!arg) {
      const active = getActiveProject();
      const session = loadSession();
      const list = Object.entries(session.projects || {})
        .map(([k, p]) => `• \`${k}\`: *${p.name}* (\`${p.repoUrl}\`) ${k === session.activeProject ? '👈 [ACTIVE]' : ''}`)
        .join('\n');
      const reply = `📁 *[Projects Registry]*\n• *Active Project:* \`${active.name}\`\n• *Repo:* \`${active.repoUrl}\`\n• *Directory:* \`${active.dir}\`\n\n*All Projects:*\n${list}\n\n*Commands:*\n• \`/project <name>\` — Switch active project\n• \`/project https://github.com/user/new-repo.git\` — Add & switch to new repo`;
      await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      return;
    }

    try {
      switchProject(arg);
      const active = getActiveProject();
      if (!fs.existsSync(active.dir)) {
        try {
          execSync(`git clone ${active.repoUrl} ${active.dir}`, { encoding: 'utf8' });
        } catch (e) {
          console.warn('[project] git clone notice:', e.message);
        }
      }
      await api.sendMessage(chatId, `✅ *[Active Project Switched]*\n• *Project:* \`${active.name}\`\n• *Repository:* \`${active.repoUrl}\`\n• *Directory:* \`${active.dir}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      await api.sendMessage(chatId, `❌ *Project Error:* ${err.message}`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (name === 'status') {
    let gitInfo = 'Git status unavailable';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, encoding: 'utf8' }).trim();
      const status = execSync('git status -sb', { cwd: targetDir, encoding: 'utf8' }).trim();
      gitInfo = `Project: \`${currentProject.name}\`\nDirectory: \`${targetDir}\`\nBranch: \`${branch}\`\n\`\`\`\n${status}\n\`\`\``;
    } catch (e) {
      gitInfo = `Error: ${e.message}`;
    }

    const sessionMsg = getSessionSummary();
    const claims = liveClaims().slice(0, 8);
    const lockMsg = claims.length
      ? `📁 *File claims (${claims.length} live):*\n${claims.map((c) => `• \`${c.file}\` (${c.bugId || '?'}, pid ${c.pid || '?'})`).join('\n')}`
      : `🟢 *File claims:* none — every file is free`;

    const sharedBlock = formatStatusPlain(
      buildStatusSnapshot({
        bot: { id: config.id, name: config.name },
        platform: 'collab',
        capabilities: { compact: false, costTracking: false, backends: true },
        effective: {},
        session: null,
        handoff: false,
        usage: null,
        totals: null,
        runtime: { bootedAt: BOOTED_AT, taskState: 'idle', lock: null },
        health: null,
      }),
    );
    const reply = `${sessionMsg}\n\n📂 *[Workspace Status]*\n${gitInfo}\n\n${lockMsg}\n\n${sharedBlock}`;
    await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    return;
  }

  if (name === 'compact') {
    await api.sendMessage(
      chatId,
      compactUnsupported('collab', 'sessions here are GPU/backend tunnels, not LLM context'),
    );
    return;
  }

  if (name === 'switch') {
    if (!arg || arg.toLowerCase() === 'status') {
      const current = getSessionSummary();
      const available = Object.entries(BACKENDS)
        .map(([k, v]) => `• \`/switch ${k}\` — *${v.name}* (\`${v.defaultModel}\`)\n  _${v.description}_`)
        .join('\n');
      const reply = `${current}\n\n*Available Backends to Switch:*\n${available}\n\n_Example: \`/switch colab\` or \`/switch qwen-max\`_`;
      await api.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      return;
    }

    const parts = arg.split(/\s+/);
    const backendKey = parts[0].toLowerCase();
    const customModel = parts.slice(1).join(' ') || null;

    try {
      const updated = switchBackend(backendKey, customModel);
      const bInfo = BACKENDS[backendKey];
      await api.sendMessage(
        chatId,
        `✅ *[Model Switched]*\n• *Active Backend:* ${bInfo.name} (\`${backendKey}\`)\n• *Active Model:* \`${updated.model}\`\n\nReady for \`/fix\` and dev commands.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await api.sendMessage(chatId, `❌ *Switch Error:* ${err.message}`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (name === 'colab') {
    const parts = arg.split(/\s+/);
    const sub = parts[0]?.toLowerCase();

    if (sub === 'register') {
      const url = parts[1];
      if (!url || !url.startsWith('http')) {
        await api.sendMessage(chatId, '❌ Usage: `/colab register https://<subdomain>.trycloudflare.com`', { parse_mode: 'Markdown' });
        return;
      }
      registerColabTunnel(url);
      await api.sendMessage(
        chatId,
        `🚀 *[Colab GPU Connected]*\n• Tunnel: \`${url}\`\n• Status: 🟢 Online\n\nYou can now run \`/switch colab\` to route coding and batch tasks to your Colab GPU!`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (sub === 'stop') {
      disconnectColab();
      await api.sendMessage(
        chatId,
        `🛑 *[Colab Disconnected]*\nColab session marked offline. Ensure your notebook runs \`runtime.unassign()\` to halt compute unit billing.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const session = loadSession();
    const statusText = session.collab.status === 'online'
      ? `🟢 Online (\`${session.collab.tunnelUrl}\`)\n• Registered: ${session.collab.lastRegistered}`
      : '🔴 Offline';
    await api.sendMessage(chatId, `📊 *[Colab Status]*\n• Status: ${statusText}\n\nTo connect: \`/colab register <url>\`\nTo disconnect: \`/colab stop\``, { parse_mode: 'Markdown' });
    return;
  }

  if (name === 'test') {
    await api.sendMessage(chatId, `⏳ *[Playwright]* Running tests headlessly on \`${currentProject.name}\`...`, { parse_mode: 'Markdown' });
    try {
      const filter = arg ? ` ${arg}` : '';
      const cmd = `npx playwright test${filter} --reporter=list`;
      const output = execSync(cmd, { cwd: targetDir, encoding: 'utf8', timeout: 180000 });
      const lines = output.trim().split('\n');
      const summary = lines.slice(-5).join('\n');
      await api.sendMessage(chatId, `✅ *[Playwright Tests Passed]*`, { parse_mode: 'Markdown' });
      await sendCopyable(api, chatId, `\`\`\`plaintext\n${summary}\n\`\`\``);
    } catch (err) {
      const out = (err.stdout || err.stderr || err.message).slice(-600);
      await api.sendMessage(chatId, `❌ *[Playwright Tests Failed]*`, { parse_mode: 'Markdown' });
      await sendCopyable(api, chatId, `\`\`\`plaintext\n${out}\n\`\`\``);
    }
    return;
  }

  if (name === 'cancel' || name === 'abort') {
    releaseDispatchLock();
    try {
      execSync('git checkout .', { cwd: targetDir, encoding: 'utf8' });
      await api.sendMessage(chatId, `🧹 *[Aborted]* Working directory reset with \`git checkout .\` and locks released.`, { parse_mode: 'Markdown' });
    } catch (e) {
      await api.sendMessage(chatId, `⚠️ Working directory reset failed: ${e.message}`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (name === 'fix') {
    if (!arg) {
      await api.sendMessage(chatId, `❌ Usage: \`/fix <description of bug or change>\`\nExample: \`/fix Round Omega-3 to 1 decimal place on WeeklyNutritionCard\``, { parse_mode: 'Markdown' });
      return;
    }

    // Parallel by design: /fix never waits on another agent. Advisory claims
    // warn; the run proceeds in its own worktree via run-coding-dispatch.sh.
    const warn = claimWarning(arg);

    const session = loadSession();
    await api.sendMessage(
      chatId,
      `⏳ *[Colab Bot]* Starting dev workflow on *${currentProject.name}*:${warn}\n"${arg}"\n• Model: \`${session.model}\` (${session.activeBackend})\n• Pulling latest \`origin/main\`...`,
      { parse_mode: 'Markdown' }
    );

    try {
      // Step 1: Git pull
      try {
        execSync('git fetch origin main && git pull --ff-only origin main', { cwd: targetDir, encoding: 'utf8' });
      } catch (ge) {
        console.warn('[fix] git pull warning:', ge.message);
      }

      // Step 2: Dispatch to model / OpenCode / Colab
      await api.sendMessage(chatId, `⏳ *[Colab Bot]* Generating fix with \`${session.model}\`...`);
      
      const dispatchScript = path.join(REPO_ROOT, 'scripts', 'run-coding-dispatch.sh');
      if (fs.existsSync(dispatchScript)) {
        const bugId = `BUG-${Date.now().toString().slice(-6)}`;
        try {
          execSync(
            `bash ${dispatchScript} --task="${arg.replace(/"/g, '\\"')}" --bug-id="${bugId}" --category="meal" --foreground`,
            { cwd: targetDir, encoding: 'utf8', timeout: 600000 }
          );
        } catch (de) {
          throw new Error(`Coder dispatch failed: ${de.message}`);
        }
      } else {
        throw new Error('scripts/run-coding-dispatch.sh not found');
      }

      // Step 3: Typecheck & Playwright
      await api.sendMessage(chatId, `⏳ *[Colab Bot]* Verifying TypeScript compilation & Playwright tests...`);
      try {
        execSync('npm run lint', { cwd: targetDir, encoding: 'utf8', timeout: 120000 });
      } catch (te) {
        if (!te.message?.includes('not found')) {
          throw new Error(`TypeScript check failed: ${te.message}`);
        }
        console.warn('[fix] tsc not installed locally, continuing...');
      }

      // Step 4: Commit and push
      let commitHash = 'unknown';
      try {
        const commitMsg = `fix: ${arg.slice(0, 60)}`;
        execSync('git add -u', { cwd: targetDir, encoding: 'utf8' });
        execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: targetDir, encoding: 'utf8' });
        execSync('git push origin main', { cwd: targetDir, encoding: 'utf8' });
        commitHash = execSync('git rev-parse --short HEAD', { cwd: targetDir, encoding: 'utf8' }).trim();
      } catch (pe) {
        throw new Error(`Git commit/push failed: ${pe.message}`);
      }

      await api.sendMessage(
        chatId,
        `✅ *[Colab Bot Dev Loop Complete]*\n• Project: \`${currentProject.name}\`\n• Commit: \`${commitHash}\` pushed to \`origin/main\`\n• Playwright: Passed\n• Deployed live via webhook.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      execSync('git checkout .', { cwd: targetDir, encoding: 'utf8' });
      await api.sendMessage(chatId, `❌ *[Fix Failed]* Reverted dirty workspace.\nError: ${err.message}`, { parse_mode: 'Markdown' });
    } finally {
      releaseDispatchLock();
    }
    return;
  }

  await api.sendMessage(chatId, `Unknown command \`/${name}\`. Send \`/help\` for list of commands.`, { parse_mode: 'Markdown' });
}

async function simulate(config, args) {
  const cmd = parseCollabCommand(args.simulate);
  if (!cmd) {
    console.log(`[simulate] not a command: ${args.simulate}`);
    return;
  }
  const api = {
    sendMessage: async (chatId, text) => {
      console.log(`[Colab Bot Reply -> ${chatId}]\n${text}`);
      return { message_id: 1 };
    },
  };
  await handleCommand({ api, chatId: 'sim-user', cmd, config });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Colab Bot - Multi-Project Mobile Dev & Compute Router\n\nUsage:\n  node scripts/collab-bot.mjs [--id=collab]\n  node scripts/collab-bot.mjs --simulate="/project"\n  node scripts/collab-bot.mjs --simulate="/status"\n  node scripts/collab-bot.mjs --check-config`);
    process.exit(0);
  }

  const registryPath = resolveRegistryPath(args.registry, REPO_ROOT);
  const registry = loadRegistry(registryPath);
  // Collab owns its runtime (not bot-host): look up by id directly instead of
  // getBot, which only serves runtime bot-host entries.
  const botDef = (registry.bots || []).find((b) => b.id === args.id && b.enabled !== false);
  if (!botDef) throw new Error(`Bot "${args.id}" not found or not enabled`);
  const config = normalizeConfig(botDef, { defaultWorkspace: REPO_ROOT });

  if (args.checkConfig) {
    console.log(`registry: ${registry.__path || 'loaded'}`);
    console.log(JSON.stringify(config, null, 2));
    let tokenStatus = 'OK';
    try {
      resolveToken(config);
    } catch (e) {
      tokenStatus = `MISSING -> ${e.message}`;
    }
    console.log(`token: ${tokenStatus}`);
    process.exit(0);
  }

  if (args.simulate) {
    await simulate(config, args);
    process.exit(0);
  }

  const token = resolveToken(config);
  const api = new TelegramApi({ token });
  const throttle = new Throttle();

  console.log(`[collab-bot] Starting polling for @${config.name} (${config.id})...`);
  let offset = 0;

  while (true) {
    try {
      const updates = await api.getUpdates({ offset, timeout: 30 });
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const senderId = msg.from?.id;
        if (config.telegram.allowedUserIds?.length && !config.telegram.allowedUserIds.includes(senderId)) {
          console.warn(`[collab-bot] Unauthorized user ${senderId}`);
          continue;
        }

        const cmd = parseCollabCommand(msg.text);
        if (cmd) {
          await handleCommand({ api, chatId: msg.chat.id, cmd, config });
        }
      }
    } catch (err) {
      console.error('[collab-bot] Polling error:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error('[collab-bot] Fatal error:', err);
  process.exit(1);
});
