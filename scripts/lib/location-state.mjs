/**
 * Per-chat location requests that were refused because no worker answered.
 *
 * A refused `/location mobile` must not silently fall back to the VM. The
 * next turn is held until the worker connects or the user names a reachable
 * host, so a phone that is off does not quietly run work on the VPS.
 *
 * Store: ~/.hermes/location_state.json
 *   { "<chatId>": { requested, reason, since } }
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function locationStatePath(home = os.homedir()) {
  return path.join(home, '.hermes', 'location_state.json');
}

function readAll(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(locationStatePath(home), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(home, data) {
  const file = locationStatePath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function getBlockedLocation(chatId, { home = os.homedir() } = {}) {
  const row = readAll(home)[String(chatId)];
  return row && row.requested ? row : null;
}

export function setBlockedLocation(chatId, requested, reason = '', { home = os.homedir(), now = Date.now() } = {}) {
  const all = readAll(home);
  all[String(chatId)] = { requested: String(requested), reason: String(reason || ''), since: new Date(now).toISOString() };
  writeAll(home, all);
  return all[String(chatId)];
}

export function clearBlockedLocation(chatId, { home = os.homedir() } = {}) {
  const all = readAll(home);
  const key = String(chatId);
  if (!(key in all)) return false;
  delete all[key];
  writeAll(home, all);
  return true;
}
