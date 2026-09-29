#!/usr/bin/env node
/**
 * pm-sweep.mjs — headless PM cycle for the systemd timer.
 *
 * Runs one `runCycle` with production paths and prints the rendered cycle to
 * stdout (the journal keeps it). Exit 0 when the cycle completed honestly —
 * even when every nudge reports `not delivered` — so the timer does not flap;
 * exit 1 only when the cycle itself threw.
 *
 * Usage: node scripts/pm-sweep.mjs --id=vm
 */
import { runCycle, renderCycle } from './lib/pm-run.mjs';
import { getBot, loadRegistry, resolveRegistryPath } from './lib/registry.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq < 0 ? '1' : hit.slice(eq + 1);
}

async function main() {
  const botId = arg('id', 'vm');
  let operatorChatId = (process.env.PM_OPERATOR_CHAT || '').trim();
  if (!operatorChatId) {
    try {
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const registry = loadRegistry(resolveRegistryPath('', repoRoot));
      const bot = getBot(registry, botId);
      const ids = bot?.telegram?.allowedUserIds || [];
      if (ids.length) operatorChatId = String(ids[0]);
    } catch {
      // No registry row (or unreadable): nudges report no-operator-chat honestly.
    }
  }
  try {
    const cycle = await runCycle({ botId, operatorChatId });
    console.log(renderCycle(cycle));
    process.exitCode = 0;
  } catch (err) {
    console.error(`pm-sweep failed: ${String(err?.message || err).slice(0, 300)}`);
    process.exitCode = 1;
  }
}

await main();
