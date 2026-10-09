import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDecision, decideWatch, emptySpool, fingerprintOf, WAIT_MS } from './sheet-watch.mjs';
import { buildStartupCard } from '../startup-card.mjs';

test('fingerprint ignores order and blanks', () => {
  assert.equal(fingerprintOf(' M b\n\n?? a\n'), fingerprintOf('?? a\n M b'));
});

test('a dirty fingerprint is written once, after 20 minutes, and never as Done', () => {
  const fp = ' M scripts/bot-host.mjs';
  const t0 = 1_000_000;
  let spool = emptySpool();
  const first = decideWatch({ now: t0, spool, fingerprint: fp, write: true, ref: 'Watch-01' });
  assert.equal(first.action, 'watch');
  assert.equal(first.argv, undefined);
  spool = applyDecision(spool, fp, first, t0);

  const early = decideWatch({ now: t0 + WAIT_MS - 1, spool, fingerprint: fp, write: true, ref: 'Watch-01' });
  assert.equal(early.action, 'wait');

  const noRef = decideWatch({ now: t0 + WAIT_MS, spool, fingerprint: fp, write: true });
  assert.equal(noRef.action, 'due');
  assert.equal(noRef.argv, undefined);

  const due = decideWatch({
    now: t0 + WAIT_MS,
    spool,
    fingerprint: fp,
    write: true,
    ref: 'Watch-01',
    sheetBin: 'ruby',
    sheetScript: '/tmp/sheet_row.rb',
  });
  assert.equal(due.action, 'write');
  assert.equal(due.argv[0], 'ruby');
  assert.ok(due.argv.includes('--status'));
  assert.equal(due.argv[due.argv.indexOf('--status') + 1], 'Assigned');
  assert.equal(due.argv.includes('Done'), false);
  assert.equal(due.argv.includes('--move-to-archive'), false);
  spool = applyDecision(spool, fp, due, t0 + WAIT_MS);

  const again = decideWatch({ now: t0 + WAIT_MS + 5, spool, fingerprint: fp, write: true, ref: 'Watch-01' });
  assert.equal(again.action, 'noted');
  assert.equal(again.argv, undefined);

  const stopped = decideWatch({ now: t0 + WAIT_MS + 9, spool, fingerprint: '' });
  assert.equal(stopped.action, 'remind');
  assert.match(stopped.message, /archive_done/);
  assert.match(stopped.message, /auto:watch:/);
});

test('startup card names the sheet writer and the VM', () => {
  const card = buildStartupCard({ hostname: 'box', location: 'vps-france', commits: ['abc fix'] });
  assert.match(card, /You are already on the VM/);
  assert.match(card, /sheet_row\.rb/);
  assert.match(card, /never set sheet Status to Done/);
  assert.match(card, /abc fix/);
  const mac = buildStartupCard({ hostname: 'laptop', location: 'mac', commits: [] });
  assert.match(mac, /ubuntu@health-tracker\.co\.uk/);
});

test('the watcher CLI does not run the sheet command until the row is due', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-watch-'));
  const spool = path.join(dir, 'spool.json');
  const porcelain = path.join(dir, 'porcelain.txt');
  const log = path.join(dir, 'calls.txt');
  const bin = path.join(dir, 'fake-ruby');
  fs.writeFileSync(porcelain, ' M scripts/bot-host.mjs\n');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(log)}\n`);
  fs.chmodSync(bin, 0o755);
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'sheet-watcher.mjs');
  const base = [cli, '--spool', spool, '--porcelain-file', porcelain, '--sheet-bin', bin, '--sheet-script', '/tmp/sheet_row.rb', '--write', '--ref', 'Watch-03'];
  execFileSync(process.execPath, [...base, '--now', '1000'], { encoding: 'utf8' });
  assert.equal(fs.existsSync(log), false);
  const second = execFileSync(process.execPath, [...base, '--now', String(1000 + WAIT_MS)], { encoding: 'utf8' });
  assert.match(second, /Writing one temporary row/);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /--status\nAssigned/);
  assert.doesNotMatch(calls, /--status\nDone/);
  assert.doesNotMatch(calls, /move-to-archive/);
  execFileSync(process.execPath, [...base, '--now', String(1000 + WAIT_MS + 10)], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(log, 'utf8'), calls);
});
