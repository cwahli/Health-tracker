/**
 * Decide whether a temporary PM row is due.
 *
 * sheet_row.rb archives the previous row whenever the same key is written
 * again. This module never loops and never writes the same fingerprint twice.
 * The CLI shells to sheet_row.rb only when decide() returns action "write".
 * Agents never set Status to Done.
 */

import { createHash } from 'node:crypto';

export const WAIT_MS = 20 * 60 * 1000;

export const TEMP_GOAL = 'Temporary: uncommitted work sat 20 minutes and the sheet was still empty.';

export function fingerprintOf(porcelain) {
  return String(porcelain || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .sort()
    .join('\n');
}

export function fingerprintId(fingerprint) {
  return createHash('sha256').update(String(fingerprint || '')).digest('hex').slice(0, 12);
}

export function emptySpool() {
  return { entries: {} };
}

export function decideWatch({ now, spool, fingerprint, write = false, ref = '', owner = 'watcher @ unknown', sheetBin = 'ruby', sheetScript = '' } = {}) {
  const book = spool && typeof spool === 'object' ? spool : emptySpool();
  const entries = book.entries || {};
  const fp = String(fingerprint || '');
  if (!fp) {
    const pending = Object.values(entries).filter((row) => row?.writtenAt && !row?.remindedAt);
    if (!pending.length) {
      return { action: 'clean', message: 'Tree is clean. No sheet write.', hash: null };
    }
    const keys = pending.map((row) => row.key).filter(Boolean).join(', ');
    return {
      action: 'remind',
      message: `You stopped and these temporary rows are still unfilled: ${keys}. Fill the real ticket. Do not run --write again on the same key — sheet_row.rb would move the old row to archive_done.`,
      hash: null,
    };
  }
  const hash = fingerprintId(fp);
  const entry = entries[hash];
  if (!entry) {
    return {
      action: 'watch',
      hash,
      message: 'Dirty work first seen. A temporary sheet row is due after 20 minutes if this fingerprint stays. Nothing was written.',
    };
  }
  if (entry.writtenAt) {
    return {
      action: 'noted',
      hash,
      key: entry.key,
      message: `Already noted as ${entry.key}. Nothing was written. The same key would archive the previous row.`,
    };
  }
  const age = Number(now) - Number(entry.firstSeenAt || now);
  if (age < WAIT_MS) {
    const mins = Math.ceil((WAIT_MS - age) / 60000);
    return {
      action: 'wait',
      hash,
      message: `Same uncommitted work. Temporary row in about ${mins} min. Nothing was written.`,
    };
  }
  const key = `auto:watch:${hash}`;
  if (!write) {
    return {
      action: 'due',
      hash,
      key,
      message: `Due for one temporary row ${key}. Print-only: pass --write --ref Topic-NN once. Nothing was written.`,
    };
  }
  if (!/^[A-Za-z]+-\d+$/.test(String(ref || ''))) {
    return {
      action: 'due',
      hash,
      key,
      message: `Due for ${key}, but --ref Topic-NN is required before any sheet write. Nothing was written.`,
    };
  }
  const note = `Fingerprint ${hash}. Fill the real ticket or mark this noise. Do not set Done. Do not write this key again.`;
  const todo = 'Replace this temporary row with the real ticket, or confirm it is noise.';
  return {
    action: 'write',
    hash,
    key,
    message: `Writing one temporary row ${key} ref ${ref}.`,
    argv: [
      sheetBin,
      sheetScript,
      '--key', key,
      '--ref', ref,
      '--goal', TEMP_GOAL,
      '--status', 'Assigned',
      '--note', note,
      '--todo', todo,
      '--owner', owner,
    ],
  };
}

export function applyDecision(spool, fingerprint, decision, now) {
  const next = {
    entries: { ...(spool?.entries || {}) },
  };
  if (decision?.action === 'watch' && decision.hash) {
    next.entries[decision.hash] = {
      fingerprint,
      firstSeenAt: now,
      writtenAt: null,
      key: null,
      remindedAt: null,
    };
  }
  if (decision?.action === 'write' && decision.hash) {
    const prev = next.entries[decision.hash] || { fingerprint, firstSeenAt: now, remindedAt: null };
    next.entries[decision.hash] = {
      ...prev,
      fingerprint,
      writtenAt: now,
      key: decision.key,
    };
  }
  if (decision?.action === 'remind') {
    for (const [id, row] of Object.entries(next.entries)) {
      if (row?.writtenAt && !row?.remindedAt) next.entries[id] = { ...row, remindedAt: now };
    }
  }
  return next;
}
