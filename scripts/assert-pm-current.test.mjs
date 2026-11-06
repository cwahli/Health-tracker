/**
 * assert-pm-current.test.mjs — sensor for the `fleet` tab resolvers.
 *
 * The tab is only as honest as its links: a guessed GitHub URL or a guessed
 * tree is worse than a blank cell. These drive the pure resolvers with
 * fixtures — newest PR wins, no match means blank, a missing directory means
 * blank, frontmatter picks the right file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLEET_COLUMNS,
  colLetter,
  fleetReadRange,
  fleetRow,
  escapeMarkdownCell,
  goalFor,
  linkedTree,
  markdownTable,
  matchPr,
  ownerFor,
  prAuthor,
  specAuthor,
  specFileFor,
  summarizeFleet,
  tenWords,
  todoFor,
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

test('the packet file is found by frontmatter id', () => {  const files = {
    'card-3.md': '---\nid: V-30.4-proof\nstatus: locked\n---\n',
    'F-13.md': '---\nid: F-13\nstatus: locked\n---\n',
  };
  const io = { list: () => Object.keys(files), read: (f) => files[f.split('/').pop()] };
  assert.equal(specFileFor('/specs/active', 'F-13', io), 'F-13.md');
  assert.equal(specFileFor('/specs/active', 'NOPE', io), '');
  assert.equal(specFileFor('/missing', 'F-13', { ...io, list: () => { throw new Error('gone'); } }), '');
});

test('owner is the worker, never the assigner', () => {
  const item = (owner) => ({ owner });
  assert.equal(
    ownerFor(item(''), 'deepseek-v4-flash (max) Mac 2026-09-29'),
    'deepseek-v4-flash (max) Mac 2026-09-29',
    'spec author doing the work wins over blank',
  );
  assert.equal(
    ownerFor(item('orchestrator'), 'Space Bunny Free (high) VM 2026-10-01'),
    'Space Bunny Free (high) VM 2026-10-01',
    'worker author replaces the assigner',
  );
  assert.equal(ownerFor(item('orchestrator'), ''), '', 'bare orchestrator is not an owner');
  assert.equal(
    ownerFor(item('orchestrator'), 'orchestrator via unresolved'),
    '',
    'an orchestrator-derived author is still the assigner',
  );
  assert.equal(
    ownerFor(item('qa_meal'), ''),
    'qa_meal',
    'a genuine worker assignee survives when no author is recorded',
  );
  assert.equal(ownerFor(item(''), ''), '', 'unknown stays blank, never guessed');
  assert.equal(
    ownerFor(item(''), 'Your Name 2026-09-17'),
    '',
    'a git-config placeholder is not a worker',
  );
});

test('a current row is the declared layout with author, github, tree', () => {
  const item = {
    key: 'card:t', kind: 'card', id: '#8', state: 'new', blocked: false,
    stallReason: '', owner: '', source: 'bugctl', branch: '', note: '', worktree: '', live: null,
  };
  const row = fleetRow(item, { at: 'T', author: 'a', github: 'g', goal: 'go', todo: 'do', tree: '/t', lastActivity: 'L' });
  assert.equal(row.length, FLEET_COLUMNS.length);
  for (const col of ['key', 'id', 'author', 'github', 'goal', 'todo', 'tree', 'last_activity', 'built_at']) {
    assert.ok(row[FLEET_COLUMNS.indexOf(col)] !== undefined, col);
  }
  assert.equal(row[FLEET_COLUMNS.indexOf('author')], 'a');
  assert.equal(row[FLEET_COLUMNS.indexOf('goal')], 'go');
  assert.equal(row[FLEET_COLUMNS.indexOf('todo')], 'do');
  assert.equal(row[FLEET_COLUMNS.indexOf('built_at')], 'T');
});

test('a current row carries the resolved owner, falling back to the projection', () => {
  const item = {
    key: 'card:t', kind: 'card', id: '#8', state: 'new', blocked: false,
    stallReason: '', owner: 'qa_meal', source: 'bugctl', branch: '', note: '', worktree: '', live: null,
  };
  const oi = FLEET_COLUMNS.indexOf('owner');
  assert.equal(
    fleetRow(item, { owner: 'worker agent' })[oi],
    'worker agent',
    'explicit resolved owner wins',
  );
  assert.equal(
    fleetRow(item, { owner: '' })[oi],
    '',
    'a resolved blank stays blank, never falls back to the assigner',
  );
  assert.equal(
    fleetRow(item, {})[oi],
    'qa_meal',
    'without one the projection owner survives',
  );
});

test('goal is ten words from the packet goal, title, or ticket', () => {
  assert.equal(tenWords('one two three four five six seven eight nine ten eleven'), 'one two three four five six seven eight nine ten …');
  assert.equal(tenWords('short'), 'short');
  const spec = { kind: 'spec', id: 'PM-2' };
  assert.equal(
    goalFor(spec, { specBody: '---\nid: PM-2\n---\n\n## Goal\nOne sentence, checkable: a dedicated project-manager bot runs here today\n' }),
    'One sentence, checkable: a dedicated project-manager bot runs here today',
  );
  assert.equal(goalFor(spec, { specBody: '# Packet: Case-12 T2 — same-thread meal edit (add/remove)\n' }), 'Case-12 T2 — same-thread meal edit (add/remove)');
  assert.equal(goalFor(spec, { specBody: 'no headings at all' }), '');
  assert.equal(goalFor({ kind: 'card', title: 'Inbox leftover: Fruit Salad + Croissant + 3 more' }), 'Inbox leftover: Fruit Salad + Croissant + 3 more');
  assert.equal(goalFor({ kind: 'card' }), '');
});

test('todo names the next step from live state', () => {
  assert.equal(todoFor({ kind: 'card', state: 'new' }), 'awaiting triage and dispatch');
  assert.equal(todoFor({ kind: 'card', state: 'in_fix' }), 'fix in progress');
  assert.equal(
    todoFor({ kind: 'card', state: 'packed', blocked: true, blockedReason: 'dispatch failed: opencode did not resolve (no fix committed) extra words here' }),
    'blocked: dispatch failed: opencode did not resolve (no fix committed) …',
  );
  assert.equal(todoFor({ kind: 'card', state: 'packed', blocked: false }), 'packed, awaiting dispatch');
  assert.equal(todoFor({ kind: 'spec', state: 'draft' }), 'draft packet, not started');
  assert.equal(todoFor({ kind: 'spec', state: 'locked' }), 'active contract, in progress');
  assert.equal(todoFor({ kind: 'lane', state: 'committed', lastOutcome: 'committed', owner: 'o' }), 'steady state, nothing pending');
  assert.equal(todoFor({ kind: 'card', state: 'packed', blocked: true, blockedReason: 'x' }, { rung: 'escalate' }), 'needs operator decision');
  assert.equal(todoFor({ kind: 'card', state: 'new' }, { rung: 'retry' }), 'retry the work');
});

test('the author is the agent from the commit trailer, else the git identity', () => {
  const log = [
    'COMMIT:aaa',
    'WHO:Your Name',
    'WHEN:2026-09-17',
    'fix(food): something',
    '',
    '\x1e',
    'COMMIT:bbb',
    'WHO:cwahli',
    'WHEN:2026-09-16',
    'Author: Muse Spark 1.3 (none) VM',
    'older work',
    '',
  ].join('\n');
  const exec = () => log;
  assert.equal(
    specAuthor('/r', 'F.md', { exec }),
    'Muse Spark 1.3 (none) VM 2026-09-16',
    'newest commit with a trailer wins, not the newest commit',
  );
  const noTrailer = 'COMMIT:aaa\nWHO:Your Name\nWHEN:2026-09-17\nfix(food): something\n';
  assert.equal(specAuthor('/r', 'F.md', { exec: () => noTrailer }), 'Your Name 2026-09-17', 'pre-trailer history falls back to git identity');
  assert.equal(specAuthor('/r', 'F.md', { exec: () => { throw new Error('gone'); } }), '', 'git failure means blank, never a guess');
});

test('a PR names its agent in the body trailer, old PRs stay blank', () => {
  const exec = () => 'Title\n\nSome description.\n\nAuthor: opencode-go/deepseek-v4.1-flash (max) VM\n';
  assert.equal(prAuthor(389, { exec }), 'opencode-go/deepseek-v4.1-flash (max) VM');
  assert.equal(prAuthor(1, { exec: () => { throw new Error('gone'); } }), '');
});

test('a body without a trailer falls back to the newest commit trailer', () => {
  const exec = (bin, args) => {
    const cmd = [bin, ...(args || [])].join(' ');
    if (cmd.includes('pr view')) return 'Title with no trailer';
    if (cmd.includes('/commits')) return 'first work\nAgent: Pixel Canary (xhigh)\n\nsecond work\nno trailer here\n';
    throw new Error('unexpected');
  };
  assert.equal(prAuthor(317, { exec }), 'Pixel Canary (xhigh)');
  const none = (bin, args) => {
    const cmd = [bin, ...(args || [])].join(' ');
    return cmd.includes('pr view') ? 'no trailer' : 'work\nmore work\n';
  };
  assert.equal(prAuthor(2, { exec: none }), '', 'no trailer anywhere stays blank');
});

test('the read range is exact — header + rows, never a guessed T57', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(19), 'T', '20 columns ends at T');
  assert.equal(colLetter(26), 'AA');
  assert.equal(FLEET_COLUMNS.length, 20);
  assert.equal(fleetReadRange(0), 'fleet!A1:T1');
  assert.equal(fleetReadRange(1), 'fleet!A1:T2');
  assert.equal(fleetReadRange(55), 'fleet!A1:T56', '55 rows + header = 56, not T57');
});

test('markdown tables render pipes, never text blocks', () => {
  assert.equal(escapeMarkdownCell('a|b'), 'a\\|b');
  const out = markdownTable(['id', 'state'], [['#8', 'new'], ['#9', 'a|b']]);
  assert.ok(out.startsWith('| id | state |'), 'pipe header');
  assert.ok(out.includes('| --- | --- |'), 'separator row');
  assert.ok(out.includes('#8'), 'rows present');
  assert.ok(out.includes('a\\|b'), 'pipes escaped');
});

test('fleet summary is computed, never hand-counted', () => {
  const at = (agent_live, blocked = 'no') => {
    const values = new Array(FLEET_COLUMNS.length).fill('');
    values[FLEET_COLUMNS.indexOf('agent_live')] = agent_live;
    values[FLEET_COLUMNS.indexOf('blocked')] = blocked;
    return values;
  };
  const built = [
    { item: { kind: 'spec', state: 'locked' }, values: at('') },
    { item: { kind: 'spec', state: 'draft' }, values: at('') },
    { item: { kind: 'card', state: 'packed' }, values: at('stale', 'yes') },
    { item: { kind: 'card', state: 'new' }, values: at('live') },
    { item: { kind: 'lane', state: 'unresolved' }, values: at('') },
  ];
  const sum = summarizeFleet(built);
  assert.equal(sum.packets, 2);
  assert.equal(sum.packetsLocked, 1);
  assert.equal(sum.packetsDraft, 1);
  assert.equal(sum.cards, 2);
  assert.equal(sum.lanes, 1);
  assert.equal(sum.total, 5);
  assert.equal(sum.live, 1);
  assert.equal(sum.stale, 1);
  assert.equal(sum.blocked, 1);
});
