import React, { useEffect, useState, useMemo, useRef } from 'react';
import { saveBugTrackerCache } from '../FlagIssueModal';
import { BugCategory } from '../../utils/issueBacklog';
import {
  hydrateWorkItem,
  publicId,
  buildContinueJob,
  formatContinuePrompt,
  sortReadyQueue,
  getLastActionedDate,
  sortByLastActioned,
  CLASS_SEVERITY,
  BURN_BUDGET,
  BugWorkItem,
  BugNow,
  BugCommit,
} from '../../utils/bugWorkItem';
import { queueKpis, tagIsFixed } from '../../utils/bugQueueKpis';
import { bugArtifactUrl, bugShotName } from '../../utils/bugSnapshot';
import {
  buildTapeReplayBody,
  reanalyzeJobId,
  tapeFromJobRecord,
  scoreLocalTape,
  pickTapeBoard,
  tapeJobCandidatesFromDetail,
  isSyntheticTapeJobId,
  tapeBoardIsHydrated,
} from '../../utils/bugTapeReplay';
import { overlayAutoRemaining } from '../../utils/bugTapeReview';
import { t } from '../../utils/i18n';

/**
 * Lightweight change fingerprint for the overview payload. The overview
 * endpoint carries no generated_at, so the poller compares this key and
 * skips setData (no re-render) when nothing moved.
 */
const overviewPayloadKey = (json: any): string => {
  const tags: any[] = Array.isArray(json?.bugTags) ? json.bugTags : [];
  const reports: any[] = Array.isArray(json?.allReports) ? json.allReports : [];
  const del: any[] = Array.isArray(json?.deletionCandidates) ? json.deletionCandidates : [];
  // The overview rows carry no updated_at, so id+status alone is blind to
  // PATCH updates (queue/bug/edits leave both unchanged) and the poller
  // would skip setData forever on a real change. Fold the work_item content
  // into the key: any mutation the server persisted changes this string.
  const tagKey = (tag: any): string => {
    const wi = tag?.work_item;
    const wiStr = typeof wi === 'string' ? wi : JSON.stringify(wi ?? null);
    return `${tag?.id}:${tag?.updated_at || ''}:${tag?.status || ''}:${wiStr}`;
  };
  return [
    tags.length,
    reports.length,
    del.length,
    tags.map(tagKey).join(','),
  ].join('|');
};

/**
 * Shared bug-board data hook (packet bug-board-miniapp, Node 1).
 * Verbatim extraction of BugTrackerModal state + data logic. One writer:
 * both the site modal and the Telegram mini app consume this hook, so a fix
 * here lands in both places. No layout/markup lives here (see BugBoard).
 */
export function useBugBoard({ isOpen, language }: { isOpen: boolean; language?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    bugTags: any[];
    allReports: any[];
    deletionCandidates: any[];
  } | null>(null);

  const [activeTab, setActiveTab] = useState<BugCategory | 'all'>('all');
  const [boardMode, setBoardMode] = useState<'bugs' | 'golden'>('bugs');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'pending_review' | 'ready' | 'unactioned' | 'stuck' | 'done'>('active');
  const [sortOrder, setSortOrder] = useState<'last_actioned' | 'priority' | 'oldest'>('last_actioned');
  const [isFlagFormOpen, setIsFlagFormOpen] = useState(false);

  // Selected tag in right pane
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const selectedTagIdRef = useRef<string | null>(null);
  selectedTagIdRef.current = selectedTagId;
  const detailFetchGen = useRef(0);
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const lastLoadEndRef = useRef(0);
  const lastPayloadKeyRef = useRef<string | null>(null);
  const [selectedTagDetail, setSelectedTagDetail] = useState<{
    bug?: any;
    now?: BugNow;
    commits?: BugCommit[];
    reports?: any[];
    how_to_end?: string;
    say?: string;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Editable Bug field & Remaining in right pane
  const [editingBugField, setEditingBugField] = useState(false);
  const [editBugDraft, setEditBugDraft] = useState('');
  const [editingRemaining, setEditingRemaining] = useState(false);
  const [editRemainingDraft, setEditRemainingDraft] = useState('');
  const [savingField, setSavingField] = useState(false);

  // Adding attempt / note form
  const [showAddAttempt, setShowAddAttempt] = useState(false);
  const [attemptHyp, setAttemptHyp] = useState('');
  const [attemptFile, setAttemptFile] = useState('');
  const [attemptTest, setAttemptTest] = useState('');
  const [attemptResult, setAttemptResult] = useState('still_red');
  const [attemptBurned, setAttemptBurned] = useState(true);
  const [attemptNote, setAttemptNote] = useState('');
  const [submittingAttempt, setSubmittingAttempt] = useState(false);

  // Q-6.4 G1 food review tabs: history, checks, dishes, scout, balance
  const [trackerDetailTab, setTrackerDetailTab] = useState<'history' | 'checks' | 'dishes' | 'scout' | 'balance'>('history');
  const [selectedRemainingLine, setSelectedRemainingLine] = useState<string>('');

  // UI expand states
  const [openSnapCommitIds, setOpenSnapCommitIds] = useState<Record<string, boolean>>({});
  const [openPreBlocks, setOpenPreBlocks] = useState<Record<string, boolean>>({});
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption?: string } | null>(null);

  // Action states
  const [searchQuery, setSearchQuery] = useState('');
  const [purgingDone, setPurgingDone] = useState(false);
  const [copiedTagId, setCopiedTagId] = useState<string | null>(null);
  const [copiedHandoffId, setCopiedHandoffId] = useState<string | null>(null);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [zippingTagId, setZippingTagId] = useState<string | null>(null);
  const [makingGoldenId, setMakingGoldenId] = useState<string | null>(null);
  const [replayingLogId, setReplayingLogId] = useState<string | null>(null);
  const [replayingCatalogId, setReplayingCatalogId] = useState<string | null>(null);
  const [reanalyzingTagId, setReanalyzingTagId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // AI Triage states
  const [triageModelByTag, setTriageModelByTag] = useState<Record<string, string>>({});
  const [triagingTagId, setTriagingTagId] = useState<string | null>(null);
  const [triageStatus, setTriageStatus] = useState<string | null>(null);
  const [analyzeModalTag, setAnalyzeModalTag] = useState<{ id: string; title: string; modelId: string } | null>(null);
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);

  // Artifact viewer
  const [viewingArtifact, setViewingArtifact] = useState<{ name: string; content: string } | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);

  useEffect(() => {
    if (!analyzeModalTag) {
      setAnalyzeElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setAnalyzeElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [analyzeModalTag]);

  const artifactUrl = (tagId: string, reportId: string, name: string, key?: string) =>
    bugArtifactUrl(tagId, reportId, name, key);

  /**
   * Renderable URLs for one report's screenshots.
   *
   * Prefers the exact stored keys (`r2_shots[].key`) so the filename — and its
   * extension — always matches what is in R2; the artifacts route 404s on a
   * guessed name. Falls back to the positional convention only when a report
   * predates stored keys. Never a raw `bugs/...` key as an <img src>.
   */
  const reportShotSrcs = (tagId: string, rep: any): Array<{ url: string; name: string }> => {
    const count = Number(rep?.shot_count || 0);
    if (!count) return [];
    const reportId = rep?.reportId || rep?.id || '';
    const stored: any[] = Array.isArray(rep?.r2_shots) ? rep.r2_shots : [];
    const out: Array<{ url: string; name: string }> = [];
    for (let i = 0; i < count; i++) {
      const key = typeof stored[i]?.key === 'string' ? stored[i].key : null;
      const name = key ? bugShotName(key) : `shot-0${i + 1}.jpg`;
      out.push({ url: bugArtifactUrl(tagId, reportId, name, key), name });
    }
    return out;
  };

  const viewTextArtifact = async (tagId: string, reportId: string, name: string) => {
    setArtifactLoading(true);
    try {
      const res = await fetch(artifactUrl(tagId, reportId, name));
      const ct = res.headers.get('content-type') || '';
      let content = '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        content = 'data' in json ? JSON.stringify(json.data, null, 2) : String(json.text ?? JSON.stringify(json, null, 2));
      } else {
        content = await res.text();
      }
      setViewingArtifact({ name, content });
    } catch (e: any) {
      alert(e?.message || 'Failed to load artifact');
    } finally {
      setArtifactLoading(false);
    }
  };

  const downloadTagZip = async (tag: any) => {
    setZippingTagId(tag.id);
    try {
      const JSZip = (await import('jszip')).default;
      const { saveAs } = await import('file-saver');
      const zip = new JSZip();

      const item = hydrateWorkItem(tag);
      const bugSummaryContent = [
        `# Bug Summary: ${tag.title || tag.id}`,
        `- Public ID: ${publicId(item, tag.id)}`,
        `- Category: ${tag.category || 'Other'}`,
        `- Queue: ${item.queue}`,
        `- ID: ${tag.id}`,
        `- Exported At: ${new Date().toISOString()}`,
        '',
        `## Pinned Bug Instruction`,
        item.bug || tag.identified_problems || '(No bug instruction recorded)',
        '',
        `## Progress & Notes`,
        tag.comments?.map((c: any) => `- [${c.created_at || ''}] ${c.body || ''}`).join('\n') ||
          tag.resolution_note ||
          '(No progress notes recorded)',
        '',
        `## What's Still Open`,
        item.remaining.join('\n') || tag.whats_still_open || '(None)',
      ].join('\n');

      zip.file('bug_summary.md', bugSummaryContent);
      zip.file('bug summary.md', bugSummaryContent);

      zip.file(
        'meta.json',
        JSON.stringify(
          {
            id: tag.id,
            public_id: publicId(item, tag.id),
            title: tag.title,
            category: tag.category,
            status: tag.status,
            work_item: item,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      const reports = (tag.linked_issues || selectedTagDetail?.reports || []).filter((li: any) => li.reportId || li.id);

      for (const li of reports) {
        const reportId = li.reportId || li.id;
        const folder = zip.folder(String(reportId).slice(0, 8));
        if (!folder) continue;

        for (const shot of li.r2_shots || []) {
          const name = String(shot.key).split('/').pop() as string;
          try {
            const res = await fetch(artifactUrl(tag.id, reportId, name));
            if (res.ok) folder.file(name, await res.blob());
          } catch {}
        }

        const standardNames = [
          'accessibility_tree.txt',
          'domain_pack.json',
          'overview.md',
          'console.logs.txt',
          'network.recent.json',
          'dom.simplified.json',
          'note.txt',
          'payload.json',
          'debug_payload.json',
        ];

        for (const name of standardNames) {
          try {
            const res = await fetch(artifactUrl(tag.id, reportId, name));
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            let text = '';
            if (ct.includes('application/json')) {
              const json = await res.json();
              text = JSON.stringify('data' in json ? json.data : json, null, 2);
            } else {
              text = await res.text();
            }
            folder.file(name, text);
          } catch {}
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `bug-${publicId(item, tag.id).replace('#', '')}-${tag.id.slice(0, 8)}.zip`);
    } catch (e: any) {
      alert(e?.message || 'Zip download failed');
    } finally {
      setZippingTagId(null);
    }
  };

  const load = async (quiet?: boolean) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bug-tracker/overview');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const key = overviewPayloadKey(json);
      if (quiet && lastPayloadKeyRef.current !== null && key === lastPayloadKeyRef.current) {
        return;
      }
      lastPayloadKeyRef.current = key;
      setData(json);
      saveBugTrackerCache(json);
      const nowStr = new Date().toLocaleTimeString();
      setLastUpdated(nowStr);

      // Keep the open card even if remaining is empty. Do not jump to the next leftover.
      if (json.bugTags && json.bugTags.length > 0) {
        const sorted = sortReadyQueue(json.bugTags);
        const top = sorted[0] || json.bugTags[0];
        const current = selectedTagIdRef.current;
        if (!current || !json.bugTags.some((t: any) => t.id === current)) {
          setSelectedTagId(top.id);
          selectedTagIdRef.current = top.id;
          fetchTagDetail(top.id);
        } else {
          fetchTagDetail(current);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load bug tracker data');
    } finally {
      if (!quiet) setLoading(false);
      lastLoadEndRef.current = Date.now();
    }
  };

  const loadPreviewBoard = async (tagOrDetail: any) => {
    try {
      const now = tagOrDetail?.now;
      const ev =
        now?.current_evidence ||
        tagOrDetail?.bug?.current_evidence ||
        tagOrDetail?.reports?.[0]?.payload ||
        tagOrDetail?.reports?.[0];
      const extraIssues = now?.remaining || tagOrDetail?.bug?.remaining || [];
      const jobIds = tapeJobCandidatesFromDetail({
        ...tagOrDetail,
        now,
        jobId: reanalyzeJobId(ev) || tagOrDetail?.jobId || tagOrDetail?.bug?.job_id || null,
        commits: tagOrDetail?.commits,
      });
      let foodLog = ev?.pendingFoodLog || ev?.foodLog || null;
      let scout = ev?.scoutItems || ev?.scout || null;
      let logText = ev?.logText || ev?.backendLogs || '';
      let remote: any = null;

      for (const jobId of jobIds.length ? jobIds : [null]) {
        if (jobId && !isSyntheticTapeJobId(jobId)) {
          try {
            const jr = await fetch(`/api/jobs/status?jobId=${encodeURIComponent(jobId)}&full=true`);
            const jjson = await jr.json().catch(() => ({}));
            const tape = tapeFromJobRecord((jjson.jobs || [])[0]);
            if (!foodLog) foodLog = tape.foodLog;
            if (!scout) scout = tape.scout;
            if (tape.logText && tape.logText.length > String(logText || '').length) logText = tape.logText;
          } catch {
            /* job status is best-effort */
          }
          try {
            const dr = await fetch(`/api/jobs/debug?jobId=${encodeURIComponent(jobId)}`);
            if (dr.ok && (dr.headers.get('content-type') || '').includes('json')) {
              const payload = await dr.json().catch(() => null);
              const logs = payload?.backendLogs || payload?.result?.backendLogs;
              if (logs && !String(logs).startsWith('[Logs stored in R2') && String(logs).length > 800) {
                logText = String(logs);
              }
              if (!foodLog) {
                foodLog = payload?.result?.pendingFoodLog || payload?.pendingFoodLog || null;
              }
              if (!scout) {
                scout = payload?.result?.scoutItems || payload?.scoutItems || null;
              }
            }
          } catch {
            /* debug hydrate is best-effort */
          }
        }
        if (jobId || foodLog || scout || logText) {
          const body = buildTapeReplayBody({
            mode: 'log',
            jobId,
            foodLog,
            scout,
            logText,
            extraIssues,
          });
          const pRes = await fetch('/api/golden/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (pRes.ok) {
            const next = await pRes.json().catch(() => null);
            if (tapeBoardIsHydrated(next)) {
              remote = next;
              break;
            }
          }
        }
        if (tapeBoardIsHydrated(remote)) break;
      }
      const local =
        foodLog || scout
          ? scoreLocalTape({ foodLog, scout, logText, extraIssues })
          : null;
      const picked = pickTapeBoard(remote, local);
      if (picked) {
        const tagId = tagOrDetail?.id || tagOrDetail?.bug?.id || selectedTagId;
        const base = hydrateWorkItem({
          ...(typeof tagOrDetail === 'object' ? tagOrDetail : {}),
          work_item: {
            ...hydrateWorkItem(tagOrDetail),
            remaining: now?.remaining || hydrateWorkItem(tagOrDetail).remaining,
            done: now?.done || hydrateWorkItem(tagOrDetail).done,
            checks: now?.checks || hydrateWorkItem(tagOrDetail).checks,
          },
        });
        const over = overlayAutoRemaining(base, picked);
        const board = { ...picked, checks: over.checks || [] };
        setSelectedTagDetail((prev) => (prev ? { ...prev, board } : prev));
        if (
          tagId &&
          tapeBoardIsHydrated(picked) &&
          (JSON.stringify(over.remaining) !== JSON.stringify(base.remaining) ||
            JSON.stringify(over.checks || []) !== JSON.stringify(base.checks || []))
        ) {
          await fetch(`/api/bugs/${encodeURIComponent(tagId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              remaining: over.remaining,
              done: over.done,
              queue: over.queue,
              checks: over.checks,
            }),
          });
        }
        return board;
      }
    } catch (err) {
      console.warn('[BugTracker] preview board load skipped:', err);
    }
    return null;
  };

  const handleReplayLog = async (tag: any) => {
    if (!tag) return;
    setReplayingLogId(tag.id);
    try {
      await loadPreviewBoard(selectedTagDetail || tag);
    } catch (e) {
      console.warn('[BugTracker] Replay log failed:', e);
    } finally {
      setReplayingLogId(null);
    }
  };

  const handleReplayCatalog = async (tag: any) => {
    if (!tag) return;
    setReplayingCatalogId(tag.id);
    try {
      const detail = selectedTagDetail;
      const ev =
        detail?.now?.current_evidence ||
        detail?.bug?.current_evidence ||
        tag?.now?.current_evidence ||
        tag?.current_evidence ||
        {};
      const board = (detail as any)?.board;
      const scout =
        ev?.scoutItems ||
        ev?.scout ||
        board?.scout ||
        (detail as any)?.bug?.scout ||
        null;
      const foodLog = ev?.pendingFoodLog || ev?.foodLog || (detail as any)?.bug?.foodLog || null;
      const jobId = ev?.job_id || ev?.jobId || null;
      const extraIssues = detail?.now?.remaining || tag?.remaining || [];
      const body = buildTapeReplayBody({
        mode: 'catalog',
        jobId,
        scout,
        foodLog,
        extraIssues,
      });
      const pRes = await fetch('/api/golden/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (pRes.ok) {
        const next = await pRes.json().catch(() => null);
        if (next) {
          setSelectedTagDetail((prev) => (prev ? { ...prev, board: next } : prev));
        }
      }
    } catch (e) {
      console.warn('[BugTracker] Replay catalog failed:', e);
    } finally {
      setReplayingCatalogId(null);
    }
  };

  const handleReanalyze = async (tag: any) => {
    if (!tag) return;
    const ev =
      selectedTagDetail?.now?.current_evidence ||
      selectedTagDetail?.bug?.current_evidence ||
      tag?.now?.current_evidence ||
      hydrateWorkItem(tag).current_evidence ||
      null;
    const jobId = reanalyzeJobId(ev);
    if (!jobId) return;
    setReanalyzingTagId(tag.id);
    try {
      const r = await fetch(`/api/bugs/${encodeURIComponent(tag.id)}/reanalyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const hint =
          r.status === 404
            ? 'Re-analyze route missing — restart npm run dev (tsx does not load new /api routes), then click Re-analyze again.'
            : String(json.error || `Re-analyze failed (${r.status})`);
        setError(hint);
        console.warn('[BugTracker] Re-analyze failed:', json.error || r.status);
        return;
      }
      if (json.board) {
        setSelectedTagDetail((prev) => (prev ? { ...prev, board: json.board } : prev));
      }
      await fetchTagDetail(tag.id);
      if (json.board) {
        setSelectedTagDetail((prev) => (prev ? { ...prev, board: json.board } : prev));
      }
    } catch (e) {
      console.warn('[BugTracker] Re-analyze failed:', e);
    } finally {
      setReanalyzingTagId(null);
    }
  };

  const fetchTagDetail = async (tagId: string) => {
    const gen = ++detailFetchGen.current;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bugs/${tagId}`);
      const json = await res.json().catch(() => ({}));
      if (gen !== detailFetchGen.current) return;
      if (res.ok) {
        setSelectedTagDetail(json);
        setEditBugDraft(json.now?.bug || json.bug?.identified_problems || json.bug?.title || '');
        setEditRemainingDraft((json.now?.remaining || []).join(', '));
        const cat = (json.bug?.category || json.category || '').toLowerCase();
        if (cat === 'foodcart' || cat === 'golden') {
          await loadPreviewBoard(json);
          if (gen !== detailFetchGen.current) return;
        }
      }
    } catch {
      /* ignore fetch error */
    } finally {
      if (gen === detailFetchGen.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      try {
        const saved = localStorage.getItem('bug_tracker_local_cache');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.bugTags)) {
            setData(parsed);
            if (parsed._cachedAt) setLastUpdated(parsed._cachedAt);
          }
        }
      } catch (e) {
        console.warn('Failed to load local bug cache:', e);
      }
      load();
      fetch('/api/bugs/migrate-inbox', { method: 'POST' }).catch(() => {});
    }
  }, [isOpen]);

  // Shared-board auto-refresh (packet bug-board-miniapp, Node 3). Quiet poll:
  // no spinner, page-visible only, skipped while a load is in flight or within
  // 5s of the last one. The fingerprint check inside load() skips setData when
  // nothing moved, so an idle board does not re-render. Both the site modal
  // and the Telegram mini app inherit this through the hook.
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (loadingRef.current) return;
      if (Date.now() - lastLoadEndRef.current < 5000) return;
      load(true);
    }, 25000);
    return () => clearInterval(id);
  }, [isOpen]);

  const handleSelectTag = (tagId: string) => {
    if (selectedTagId === tagId) {
      setSelectedTagId(null);
      setEditingBugField(false);
      setEditingRemaining(false);
      setShowAddAttempt(false);
      return;
    }
    setSelectedTagId(tagId);
    selectedTagIdRef.current = tagId;
    setEditingBugField(false);
    setEditingRemaining(false);
    setShowAddAttempt(false);
    fetchTagDetail(tagId);
  };

  const handleNextBug = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bugs/next');
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json.empty && json.tag_id) {
        detailFetchGen.current += 1;
        setSelectedTagId(json.tag_id);
        selectedTagIdRef.current = json.tag_id;
        setSelectedTagDetail(json);
        setEditBugDraft(json.now?.bug || '');
        setEditRemainingDraft((json.now?.remaining || []).join(', '));
      } else {
        // Fallback to top ready tag in local data
        if (data?.bugTags) {
          const ready = sortReadyQueue(data.bugTags);
          if (ready.length > 0) {
            handleSelectTag(ready[0].id);
          } else {
            alert(t(language, 'alertNoReadyBugs'));
          }
        }
      }
    } catch {
      /* fallback */
    } finally {
      setLoading(false);
    }
  };

  const saveBugField = async () => {
    if (!selectedTagId) return;
    setSavingField(true);
    try {
      const res = await fetch(`/api/bugs/${selectedTagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bug: editBugDraft.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update bug field');
      if (selectedTagDetail) {
        setSelectedTagDetail({
          ...selectedTagDetail,
          now: selectedTagDetail.now ? { ...selectedTagDetail.now, bug: editBugDraft.trim() } : undefined,
        });
      }
      setEditingBugField(false);
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to save bug instruction');
    } finally {
      setSavingField(false);
    }
  };

  const handleUnblockBug = async (tagId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/bugs/${encodeURIComponent(tagId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_burns: true, queue: 'ready' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await fetchTagDetail(tagId);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to unblock bug');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateClass = async (tagId: string, nextClass: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/bugs/${encodeURIComponent(tagId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class: nextClass || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await fetchTagDetail(tagId);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to update class');
    } finally {
      setBusy(false);
    }
  };

  const toggleRemainingDone = async (tagId: string, itemText: string) => {
    if (!selectedBugNow) return;
    const curRemaining = selectedBugNow.remaining || [];
    const curDone = selectedBugNow.done || [];
    const nextRemaining = curRemaining.filter((r) => r !== itemText);
    const nextDone = [...curDone, itemText];
    setBusy(true);
    try {
      const res = await fetch(`/api/bugs/${encodeURIComponent(tagId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remaining: nextRemaining, done: nextDone }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await fetchTagDetail(tagId);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to update remaining items');
    } finally {
      setBusy(false);
    }
  };

  const handleMakeGolden = async (tag: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setMakingGoldenId(tag.id);
    try {
      const res = await fetch(`/api/bugs/${encodeURIComponent(tag.id)}/make-golden`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      alert(`Golden Case created at tests/Golden_meal/inbox/${json.slug}`);
    } catch (err: any) {
      alert(err?.message || 'Failed to make golden case');
    } finally {
      setMakingGoldenId(null);
    }
  };

  const saveRemainingItems = async () => {
    if (!selectedTagId) return;
    setSavingField(true);
    const rem = editRemainingDraft.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/bugs/${selectedTagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remaining: rem }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update remaining items');
      if (selectedTagDetail?.now) {
        setSelectedTagDetail({
          ...selectedTagDetail,
          now: { ...selectedTagDetail.now, remaining: rem },
        });
      }
      setEditingRemaining(false);
      load();
    } catch (err: any) {
      alert(err?.message || 'Failed to save remaining items');
    } finally {
      setSavingField(false);
    }
  };

  const handleLogAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTagId) return;
    setSubmittingAttempt(true);
    try {
      const res = await fetch(`/api/bugs/${selectedTagId}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: 'developer',
          hyp: attemptHyp.trim(),
          file: attemptFile.trim(),
          test: attemptTest.trim(),
          result: attemptResult,
          burned: attemptBurned,
          note: attemptNote.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to record attempt');
      setShowAddAttempt(false);
      setAttemptHyp('');
      setAttemptFile('');
      setAttemptTest('');
      setAttemptNote('');
      await fetchTagDetail(selectedTagId);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to log attempt');
    } finally {
      setSubmittingAttempt(false);
    }
  };

  const runBugTriageAgent = async (tag: any) => {
    const selectedModel = triageModelByTag[tag.id] || 'gemini-3.5-flash-lite';
    setBusy(true);
    setTriagingTagId(tag.id);
    setAnalyzeModalTag({
      id: tag.id,
      title: tag.title || tag.id,
      modelId: selectedModel,
    });
    setTriageStatus('Starting AI Bug Triage Agent...');
    try {
      const res = await fetch(`/api/bugs/${tag.id}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTriageStatus(`Triage completed in ${json.ms || '?'}ms`);
      await fetchTagDetail(tag.id);
      await load();
      setTimeout(() => setTriageStatus(null), 4000);
    } catch (err: any) {
      setTriageStatus(null);
      alert(err?.message || 'Triage failed');
    } finally {
      setAnalyzeModalTag(null);
      setTriagingTagId(null);
      setBusy(false);
    }
  };

  const deleteTag = async (tagId: string, title: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDeletingTagId(tagId);
    try {
      const res = await fetch(`/api/issue-tags/${encodeURIComponent(tagId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'fixed', resolution_note: 'Marked done from queue' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Failed (HTTP ${res.status})`);
      }
      await load();
    } catch (err: any) {
      alert(err?.message || 'Failed to mark bug done');
    } finally {
      setDeletingTagId(null);
    }
  };

  const hardDeleteTag = async (tagId: string, title?: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDeletingTagId(tagId);
    setError(null);
    try {
      const res = await fetch(`/api/issue-tags/${encodeURIComponent(tagId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Failed (HTTP ${res.status})`);
      }
      if (selectedTagId === tagId) {
        setSelectedTagId(null);
        setSelectedTagDetail(null);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete bug');
    } finally {
      setDeletingTagId(null);
    }
  };

  const handlePurgeDoneBugs = async () => {
    const doneTotal = kpis.doneAll;
    if (doneTotal === 0) {
      setError('There are no done bugs to delete.');
      return;
    }
    setPurgingDone(true);
    setError(null);
    try {
      const res = await fetch('/api/issue-tags/purge-done', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (selectedTagId && bugTags.find((t) => t.id === selectedTagId && tagIsFixed(t))) {
        setSelectedTagId(null);
        setSelectedTagDetail(null);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to purge done bugs');
    } finally {
      setPurgingDone(false);
    }
  };

  const pruneReport = async (tagId: string, issueId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bugs/${tagId}/reports/${issueId}/prune`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchTagDetail(tagId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Prune failed');
    } finally {
      setBusy(false);
    }
  };

  const copyTagSummary = (tag: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const item = hydrateWorkItem(tag);
    const pub = publicId(item, tag.id);
    const lines = [
      `Bug ${pub}: ${tag.title}`,
      `Category: ${tag.category || 'Other'} | Queue: ${item.queue}`,
      `Instruction: ${item.bug || tag.identified_problems || '(None)'}`,
      `Remaining: ${item.remaining.join(', ') || tag.whats_still_open || '(None)'}`,
      `Burns: ${item.burns.filter((b) => b.burned).length}/${BURN_BUDGET}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedTagId(tag.id);
    setTimeout(() => setCopiedTagId(null), 2000);
  };

  const copyHandoff = async (tag: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const res = await fetch(`/api/bugs/${tag.id}`);
    const json = await res.json().catch(() => ({}));
    const item = hydrateWorkItem(tag);
    const remainingList = json.now?.remaining || item.remaining || [];
    const activeLine = selectedRemainingLine || remainingList[0] || json.now?.bug || tag.title;
    const text = formatContinuePrompt(
      buildContinueJob(
        {
          ...tag,
          id: tag.id,
          title: tag.title,
          work_item: {
            ...item,
            remaining: remainingList,
            done: json.now?.done || item.done,
            current_evidence: json.now?.current_evidence || item.current_evidence,
            commits: json.commits || item.commits,
          },
        },
        activeLine
      )
    );
    await navigator.clipboard.writeText(text);
    setCopiedHandoffId(tag.id);
    setTimeout(() => setCopiedHandoffId(null), 2500);
    if (item.queue === 'ready') {
      fetch(`/api/bugs/${encodeURIComponent(tag.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue: 'in_progress' }),
      }).catch(() => {});
    }
  };

  const bugTags: any[] = data?.bugTags || [];
  const filteredTags = useMemo(() => {
    return bugTags.filter((t: any) => {
      // Category filter
      if (activeTab !== 'all' && (t.category || 'foodcart') !== activeTab) {
        return false;
      }
      const item = hydrateWorkItem(t);
      const isFixed = tagIsFixed(t);
      const isBlocked = item.queue === 'blocked' || item.burns.filter((b) => b.burned).length >= 2;
      const isReady = !isFixed && !isBlocked && item.queue === 'ready';
      
      const hasAgent = item.commits && item.commits.some((c) => c.kind === 'agent' || c.actor !== 'you');
      const lastCommit = item.commits && item.commits.length > 0 ? item.commits[item.commits.length - 1] : null;
      const isPendingReview = !isFixed && lastCommit && (lastCommit.kind === 'agent' || lastCommit.actor !== 'you');
      const isAgentToDo = !isFixed && hasAgent && lastCommit && (lastCommit.kind !== 'agent' && lastCommit.actor === 'you');
      const isUnactioned = !isFixed && !hasAgent;

      // Status filter
      if (statusFilter === 'active') {
        if (isFixed) return false;
      } else if (statusFilter === 'stuck') {
        if (isFixed || !isBlocked) return false;
      } else if (statusFilter === 'ready') {
        if (!isReady) return false;
      } else if (statusFilter === 'pending_review') {
        if (!isPendingReview) return false;
      } else if (statusFilter === 'unactioned') {
        if (!isUnactioned) return false;
      } else if (statusFilter === 'done') {
        if (!isFixed) return false;
      }

      // Text search filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const pub = publicId(item, t.id).toLowerCase();
        const title = String(t.title || '').toLowerCase();
        const rawId = String(t.id || '').toLowerCase();
        const problem = String(t.identified_problems || item.bug || '').toLowerCase();
        const category = String(t.category || '').toLowerCase();
        if (!title.includes(q) && !pub.includes(q) && !rawId.includes(q) && !problem.includes(q) && !category.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [bugTags, activeTab, statusFilter, searchQuery]);

  const sortedQueueTags = useMemo(() => {
    if (sortOrder === 'priority') {
      return [...filteredTags].sort((a, b) => {
        const wa = hydrateWorkItem(a);
        const wb = hydrateWorkItem(b);
        if (wb.occurrences !== wa.occurrences) return wb.occurrences - wa.occurrences;
        const sa = CLASS_SEVERITY[wa.class || ''] ?? 500;
        const sb = CLASS_SEVERITY[wb.class || ''] ?? 500;
        if (sa !== sb) return sa - sb;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      });
    }
    if (sortOrder === 'oldest') {
      return [...filteredTags].sort((a, b) => {
        const da = getLastActionedDate(a)?.getTime() || 0;
        const db = getLastActionedDate(b)?.getTime() || 0;
        return da - db;
      });
    }
    return sortByLastActioned(filteredTags);
  }, [filteredTags, sortOrder]);
  const kpis = queueKpis(bugTags);
  const readyCount = kpis.ready;
  const blockedCount = kpis.blocked;
  const doneCount = kpis.doneThisWeek;
  const openBugCount = kpis.open;

  // Selected tag object and work item
  const selectedTag = bugTags.find((t: any) => t.id === selectedTagId) || (sortedQueueTags[0] ?? null);
  const selectedTagItem: BugWorkItem = selectedTag ? hydrateWorkItem(selectedTag) : null as any;
  const selectedPubId = selectedTag ? publicId(selectedTagItem, selectedTag.id) : '';
  const selectedBugNow = selectedTagDetail?.now;
  const selectedCommits = selectedTagDetail?.commits || selectedTagItem?.commits || [];
  const selectedReports = selectedTagDetail?.reports || selectedTag?.linked_issues || [];

  // Top ready tag for "Next bug" label
  const topReadyTag = sortReadyQueue(bugTags.filter((t) => hydrateWorkItem(t).queue === 'ready'))[0];
  const topReadyPubId = topReadyTag ? publicId(hydrateWorkItem(topReadyTag), topReadyTag.id) : null;
  return {
    loading,
    setLoading,
    error,
    setError,
    data,
    activeTab,
    setActiveTab,
    boardMode,
    setBoardMode,
    statusFilter,
    setStatusFilter,
    sortOrder,
    setSortOrder,
    isFlagFormOpen,
    setIsFlagFormOpen,
    selectedTagId,
    setSelectedTagId,
    selectedTagDetail,
    detailLoading,
    editingBugField,
    setEditingBugField,
    editBugDraft,
    setEditBugDraft,
    editingRemaining,
    setEditingRemaining,
    editRemainingDraft,
    setEditRemainingDraft,
    savingField,
    showAddAttempt,
    setShowAddAttempt,
    attemptHyp,
    setAttemptHyp,
    attemptFile,
    setAttemptFile,
    attemptTest,
    setAttemptTest,
    attemptResult,
    setAttemptResult,
    attemptBurned,
    setAttemptBurned,
    attemptNote,
    setAttemptNote,
    submittingAttempt,
    trackerDetailTab,
    setTrackerDetailTab,
    selectedRemainingLine,
    setSelectedRemainingLine,
    openSnapCommitIds,
    setOpenSnapCommitIds,
    openPreBlocks,
    setOpenPreBlocks,
    lightboxImage,
    setLightboxImage,
    searchQuery,
    setSearchQuery,
    purgingDone,
    copiedTagId,
    copiedHandoffId,
    deletingTagId,
    zippingTagId,
    makingGoldenId,
    replayingLogId,
    replayingCatalogId,
    reanalyzingTagId,
    busy,
    lastUpdated,
    triageModelByTag,
    setTriageModelByTag,
    triagingTagId,
    triageStatus,
    analyzeModalTag,
    analyzeElapsed,
    viewingArtifact,
    setViewingArtifact,
    artifactLoading,
    artifactUrl,
    reportShotSrcs,
    viewTextArtifact,
    downloadTagZip,
    load,
    loadPreviewBoard,
    handleReplayLog,
    handleReplayCatalog,
    handleReanalyze,
    fetchTagDetail,
    handleSelectTag,
    handleNextBug,
    saveBugField,
    handleUnblockBug,
    handleUpdateClass,
    toggleRemainingDone,
    handleMakeGolden,
    saveRemainingItems,
    handleLogAttempt,
    runBugTriageAgent,
    deleteTag,
    hardDeleteTag,
    handlePurgeDoneBugs,
    pruneReport,
    copyTagSummary,
    copyHandoff,
    bugTags,
    sortedQueueTags,
    kpis,
    readyCount,
    blockedCount,
    doneCount,
    openBugCount,
    selectedTag,
    selectedTagItem,
    selectedPubId,
    selectedBugNow,
    selectedCommits,
    selectedReports,
    topReadyTag,
    topReadyPubId,
  };
}
