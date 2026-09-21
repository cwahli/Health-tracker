/**
 * Persist Q-6 auto-file onto issue_tags.work_item (pointers only).
 * D-2: D1-only (Supabase removed, no 402).
 */
import { d1Query, isD1Configured, safeJsonParse } from './server_d1.js';
import { normalizeTagKey, titleFromKey } from './serverIssueBacklog.js';
import {
  applyAutoFile,
  classifyGoldenReds,
  classifyJobResult,
  type AutoFileCandidate,
} from './src/utils/bugAutoFile';
import { hydrateWorkItem } from './src/utils/bugWorkItem';

const LOG = '[bug-auto-file]';

async function persistWorkItem(tagId: string, item: ReturnType<typeof hydrateWorkItem>): Promise<boolean> {
  try {
    if (!isD1Configured()) {
      console.warn(`${LOG} persist skipped: D1 not configured (no 402).`);
      return false;
    }
    const res = await d1Query(`UPDATE issue_tags SET work_item = ?, updated_at = datetime('now') WHERE id = ?`, [
      JSON.stringify(item),
      tagId,
    ]);
    if (!res.success) {
      console.warn(`${LOG} persist skipped:`, res.error);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`${LOG} persist failed:`, e?.message || e);
    return false;
  }
}

async function loadOpenTags(): Promise<any[]> {
  try {
    if (!isD1Configured()) return [];
    const res = await d1Query<any>(
      `SELECT * FROM issue_tags WHERE status IN ('to_fix', 'in_progress') ORDER BY updated_at DESC LIMIT 200`
    );
    if (!res.success) {
      console.warn(`${LOG} load tags:`, res.error);
      return [];
    }
    return (res.results || []).map((t: any) => ({
      ...t,
      work_item: typeof t.work_item === 'string' ? safeJsonParse(t.work_item, null) : t.work_item,
      comments: typeof t.comments === 'string' ? safeJsonParse(t.comments, t.comments) : t.comments,
    }));
  } catch (e: any) {
    console.warn(`${LOG} load tags:`, e?.message || e);
    return [];
  }
}

export async function persistAutoFile(candidate: AutoFileCandidate): Promise<{
  ok: boolean;
  action: string;
  tag_id?: string;
  public_n?: number;
  unmatched?: boolean;
}> {
  const tags = await loadOpenTags();
  const usedNs = tags.map((t) => hydrateWorkItem(t).public_n).filter((n) => n > 0);
  const decision = applyAutoFile(tags, candidate, usedNs);

  if (decision.existing?.id) {
    await persistWorkItem(decision.existing.id, decision.item);
    return {
      ok: true,
      action: decision.action,
      tag_id: decision.existing.id,
      public_n: decision.item.public_n,
      unmatched: !!decision.item.unmatched,
    };
  }

  const rawTitle = (candidate.bug || candidate.query || 'Auto-filed job').slice(0, 200);
  const title_key = normalizeTagKey(rawTitle) || rawTitle.toLowerCase().slice(0, 160);
  const title = titleFromKey(title_key, rawTitle);
  if (!isD1Configured()) {
    console.warn(`${LOG} insert tag skipped: D1 not configured (no 402).`);
    return { ok: false, action: 'insert_failed' };
  }
  const newId = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ins = await d1Query(
    `INSERT INTO issue_tags (id, title, title_key, category, status, comments) VALUES (?, ?, ?, ?, 'to_fix', '[]')`,
    [newId, title, title_key, candidate.category || 'foodcart']
  );
  if (!ins.success) {
    console.warn(`${LOG} insert tag:`, ins.error || 'no id');
    return { ok: false, action: 'insert_failed' };
  }
  await persistWorkItem(newId, decision.item);
  return {
    ok: true,
    action: decision.action,
    tag_id: newId,
    public_n: decision.item.public_n,
    unmatched: !!decision.item.unmatched,
  };
}

export async function tryAutoFileJob(input: Parameters<typeof classifyJobResult>[0]): Promise<{
  ok: boolean;
  skipped?: boolean;
  action?: string;
  tag_id?: string;
  public_n?: number;
  unmatched?: boolean;
}> {
  try {
    const candidate = classifyJobResult(input);
    if (!candidate) return { ok: true, skipped: true };
    return persistAutoFile(candidate);
  } catch (e: any) {
    console.warn(`${LOG} job:`, e?.message || e);
    return { ok: false, action: 'error' };
  }
}

export async function tryAutoFileGolden(input: Parameters<typeof classifyGoldenReds>[0]): Promise<{
  ok: boolean;
  skipped?: boolean;
  action?: string;
  tag_id?: string;
  public_n?: number;
  unmatched?: boolean;
}> {
  try {
    const candidate = classifyGoldenReds(input);
    if (!candidate) return { ok: true, skipped: true };
    return persistAutoFile(candidate);
  } catch (e: any) {
    console.warn(`${LOG} golden:`, e?.message || e);
    return { ok: false, action: 'error' };
  }
}
