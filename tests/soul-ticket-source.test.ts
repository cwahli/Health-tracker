import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ratchet for the 2026-09-25 cross-agent ticket-list mismatch:
 * the orchestrator guessed non-existent endpoints (/api/tickets) and then
 * answered from an old queue snapshot in chat history while the bug-ticket
 * bot quoted a live read — two agents, two different "ticket lists".
 *
 * Every agent must read the ONE canonical server-backed list, fail loud when
 * the read fails, and quote generated_at + count so answers are comparable.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const lineCount = (text: string) => text.trimEnd().split('\n').length;

describe('ticket-list source of truth (cross-agent consistency)', () => {
  it('orchestrator soul pins the canonical list command and bans invented URLs', () => {
    const soul = read('bots/soul.orchestrator.md');
    expect(soul).toContain('bugctl.mjs list --json');
    expect(soul).toMatch(/Never invent API URLs/);
    expect(soul).toContain('/api/tickets');
  });

  it('orchestrator soul fails loud instead of rebuilding a list from history', () => {
    const soul = read('bots/soul.orchestrator.md');
    expect(soul).toMatch(/never rebuild a list from memory/i);
    expect(soul).toContain('generated_at');
    expect(soul).toMatch(/reply with its error/i);
  });

  it('orchestrator soul stays inside the soul-compose override budget (16)', () => {
    expect(lineCount(read('bots/soul.orchestrator.md'))).toBeLessThanOrEqual(16);
  });

  it('bug_ticket soul stays inside the soul-compose override budget (16)', () => {
    expect(lineCount(read('bots/soul.bug_ticket.md'))).toBeLessThanOrEqual(16);
  });

  it('orchestrator-dispatcher SKILL: canonical list, fail-loud, comparable answers', () => {
    const skill = read('scripts/skills/common/orchestrator-dispatcher/SKILL.md');
    expect(skill).toMatch(/bugctl\.mjs" list --json/);
    expect(skill).toMatch(/old chat summary/);
    expect(skill).toMatch(/paste the error/);
    expect(skill).toContain('generated_at');
    expect(skill).toContain('count');
  });

  it('bug-ticket SKILL: canonical list, no MEMORY.md, fail-loud, comparable answers', () => {
    const skill = read('scripts/skills/common/bug-ticket/SKILL.md');
    expect(skill).toMatch(/node scripts\/bugctl\.mjs list --json/);
    expect(skill).toMatch(/Never answer from `MEMORY\.md`/);
    expect(skill).toMatch(/paste the error/);
    expect(skill).toContain('generated_at');
  });
});
