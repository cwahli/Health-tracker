/**
 * assert-pm-current.test.mjs — sensor for the `current` tab resolvers.
 *
 * The tab is only as honest as its links: a guessed GitHub URL or a guessed
 * tree is worse than a blank cell. These drive the pure resolvers with
 * fixtures — newest PR wins, no match means blank, a missing directory means
 * blank, frontmatter picks the right file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_COLUMNS,
  currentRow,
  linkedTree,
  matchPr,
  specFileFor,
} from './pm-current.mjs';

const PRS = [
  { number: 381, state: 'MERGED', headRefName: 'journey/bug-board-parity' },
  { number: 387, state: 'OPEN', headRefName: 'agent/meal-qa-loop' },
  { number: 101, state: 'MERGED', headRefName: 'agent/dispatch-v304-proof' },
];

test('the newest PR whose head names the item wins, else blank', () => {
  assert.equal(matchPr(PRS, 'bug-board-parity'), '#381 merged journey/bug-board-parity');
  assert.equal(matchPr(PRS, 'BUG-BOARD-PARITY'), '#381 merged journey/bug-board-parity', 'match is case-insensitive');
  assert.equal(matchPr(PRS, '#8'), '', 'no head names #8 — blank, never a guessed link');
  assert.equal(matchPr(PRS, ''), '');
  assert.equal(matchPr([], 'F-13'), '');
  const two = [
    { number: 90, state: 'MERGED', headRefName: 'agent/dispatch-8' },
    { number: 95, state: 'CLOSED', headRefName: 'agent/dispatch-8-retry' },
  ];
  assert.equal(matchPr(two, '#8'), '#95 closed agent/dispatch-8-retry', 'newest match wins');
});

test('numeric ids match on segment boundaries, not substrings', () => {
  const tricky = [
    { number: 378, state: 'MERGED', headRefName: 'agent/r14-status-truth' },
    { number: 301, state: 'MERGED', headRefName: 'agent/handover-f13-live' },
    { number: 305, state: 'MERGED', headRefName: 'agent/r16-token-match' },
    { number: 317, state: 'MERGED', headRefName: 'agent/r14-card9-pause' },
    { number: 294, state: 'CLOSED', headRefName: 'agent/v-30.1' },
  ];
  assert.equal(matchPr(tricky, '#1'), '', 'card #1 is not every r14 branch, nor v-30.1');
  assert.equal(matchPr(tricky, '#4'), '', 'card #4 is not r14 either');
  assert.equal(matchPr(tricky, '#6'), '', 'card #6 is not r16');
  assert.equal(matchPr(tricky, '#13'), '', 'card #13 is not handover-f13');
  assert.equal(matchPr(tricky, '#9'), '#317 merged agent/r14-card9-pause', 'card9 is a real segment');
});

test('a linked tree needs the directory on disk, with its branch', () => {
  const exists = (p) => p === '/home/u/dev/dispatch-8';
  const branchOf = () => 'journey/card-8';
  assert.equal(
    linkedTree('card', '#8', { home: '/home/u', exists, branchOf }),
    '/home/u/dev/dispatch-8 (journey/card-8)',
  );
  assert.equal(linkedTree('card', '#9', { home: '/home/u', exists, branchOf }), '', 'no directory, no tree');
  assert.equal(linkedTree('lane', 'orchestrator', { home: '/home/u', exists, branchOf }), '', 'lanes have no tree convention');
  assert.equal(
    linkedTree('spec', 'F-13', { home: '/home/u', exists: (p) => p === '/home/u/dev/f-13', branchOf: () => '' }),
    '/home/u/dev/f-13',
    'a tree whose branch cannot be read is still the path, without a guessed branch',
  );
});

test('the packet file is found by frontmatter id', () => {
  const files = {
    'card-3.md': '---\nid: V-30.4-proof\nstatus: locked\n---\n',
    'F-13.md': '---\nid: F-13\nstatus: locked\n---\n',
  };
  const io = { list: () => Object.keys(files), read: (f) => files[f.split('/').pop()] };
  assert.equal(specFileFor('/specs/active', 'F-13', io), 'F-13.md');
  assert.equal(specFileFor('/specs/active', 'NOPE', io), '');
  assert.equal(specFileFor('/missing', 'F-13', { ...io, list: () => { throw new Error('gone'); } }), '');
});

test('a current row is the declared layout with author, github, tree', () => {
  const item = {
    key: 'card:t', kind: 'card', id: '#8', state: 'new', blocked: false,
    stallReason: '', owner: '', source: 'bugctl', branch: '', note: '', worktree: '', live: null,
  };
  const row = currentRow(item, { at: 'T', author: 'a', github: 'g', tree: '/t', lastActivity: 'L' });
  assert.equal(row.length, CURRENT_COLUMNS.length);
  for (const col of ['key', 'id', 'author', 'github', 'tree', 'last_activity', 'built_at']) {
    assert.ok(row[CURRENT_COLUMNS.indexOf(col)] !== undefined, col);
  }
  assert.equal(row[CURRENT_COLUMNS.indexOf('author')], 'a');
  assert.equal(row[CURRENT_COLUMNS.indexOf('built_at')], 'T');
});
