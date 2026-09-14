/**
 * Floating bug snapshot control (admin-only).
 * Multi-shot capture → assign bug tag → R2 /bugs/ pack via POST /api/bugs/snapshot
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, Plus, Trash2, Bug, Loader, Check, ImagePlus, CheckCircle2, Sparkles, Utensils, AlertCircle, MessageSquare, ArrowLeft, Eye, ClipboardPaste } from 'lucide-react';
import {
  isBugSnapshotEnabled,
  setBugSnapshotEnabled,
  isBugAutoTriageEnabled,
  setBugAutoTriageEnabled,
  buildSimplifiedDom,
  buildAccessibilityTree,
  initBrowserLogRecorder,
  getBrowserLogBuffer,
  initNetworkRecorder,
  getRecentNetworkEntries,
  getNetworkFailureCount,
  initInteractionRecorder,
  getInteractionRing,
  formatInteractionRing,
  recordTabInteraction,
  captureBugEnv,
  saveBugSnapshotDraft,
  loadBugSnapshotDraft,
  clearBugSnapshotDraft,
  compressToWebpOrJpeg,
  scrubPiiText,
  buildCaptureChecklist,
  BUG_SNAPSHOT_MAX_SHOTS,
  BUG_SNAPSHOT_LOG,
  AGENT_STRUCTURE_DEFAULT,
} from '../utils/bugSnapshot';
import { jobFitsSnap, resolveDomainPack, snapSurface } from '../utils/bugDomainPacks';
import { compressImage } from '../utils/imageCompressor';
import { CATEGORY_OPTIONS, saveBugTrackerCache } from './FlagIssueModal';
import { BugCategory } from '../utils/issueBacklog';
import { AVAILABLE_LLMS } from '../utils/llm';
import { JobStore } from '../jobs/JobStore';
import { get as idbGet } from 'idb-keyval';
import { ImageStore } from '../jobs/ImageStore';
import { normalizeMealImageUrl, UNUSABLE_IMAGE_TOKENS } from '../utils/foodImageSources';
import { saveAgentRequestLog } from '../utils/agentLogsTracker';
import {
  extractMealLines,
  extractCapturedMealProblems,
  isStaleCapturedStallSymptom,
  stripStaleStallLines,
  deriveGoldenTitle,
  PHASE_LABEL,
  groupJourneyByDish,
  snapshotVisibleInvariants,
  sanitizeJobErrorText,
  type GoldenMealLine,
  type GoldenJourneyRow,
  type GoldenInvariant,
} from '../utils/goldenScoreboard';
import { collectOriginalFixture, pickSnapshotJob } from '../utils/goldenFixture';
import { hydrateWorkItem, publicId } from '../utils/bugWorkItem';
import { BugSnapRemainingSection, HomeStatePanel, HealthLogsPanel, type BugSnapRowItem } from './bugQueue';
import { autoSpotFood, autoSpotHome, autoSpotHealth, mergeAutoSpotHits, type AutoSpotHit } from '../utils/bugAutoSpot';

export interface BugSnapshotFabProps {
  isAdmin: boolean;
  firebaseUid?: string | null;
  /** Active page / tab identifier to auto-select */
  activeTab?: string;
  /** Optional: active job context for modal payloads */
  getModalContext?: () => Promise<Record<string, unknown>> | Record<string, unknown> | null;
  /** Job open in the unified food/medical modal */
  viewingJobId?: string | null;
  biomarkerHistory?: any[];
  biomarkers?: any;
  profile?: any;
}

function readOpenModalJobId(): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(
    '#food-chat-container[data-job-id], [data-unified-modal][data-job-id], [data-modal="food"][data-job-id], [data-modal="meal"][data-job-id], [data-modal][data-job-id]'
  );
  const id = el?.getAttribute('data-job-id')?.trim();
  if (id) return id;
  const insideModal = document.querySelector<HTMLElement>('#food-chat-container, [data-unified-modal="true"]');
  const innerId = insideModal?.getAttribute('data-job-id') || insideModal?.querySelector('[data-job-id]')?.getAttribute('data-job-id');
  return innerId?.trim() || null;
}

export function isAnyMealModalOpen(viewingJobId?: string | null, activeTab?: string): boolean {
  if (viewingJobId) return true;
  if (typeof document === 'undefined') return false;
  const modal = document.querySelector<HTMLElement>(
    '#food-chat-container, [data-unified-modal="true"], [data-modal="food"], [data-modal="meal"]'
  );
  if (modal && modal.offsetParent !== null) return true;
  if (Boolean(readOpenModalJobId())) return true;
  if (activeTab === 'food') return true;
  return false;
}

export async function resolveDisplayableImage(ref: unknown): Promise<string | null> {
  if (!ref) return null;
  if (ref instanceof Blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(ref);
    });
  }
  if (typeof ref !== 'string') return null;
  const s = ref.trim();
  if (!s || UNUSABLE_IMAGE_TOKENS.has(s) || s.includes('image_removed_for_snapshot') || s.includes('Image reference preserved')) {
    return null;
  }
  if (s.startsWith('data:image/')) return s;
  if (s.startsWith('blob:')) return s;
  if (s.startsWith('imageStore/')) {
    try {
      const val = await idbGet<string | Blob>(s);
      if (val) return await resolveDisplayableImage(val);
    } catch {
      /* ignore */
    }
  }
  if (s.startsWith('/photos/') || s.startsWith('/api/r2/photos/') || s.startsWith('/api/golden/photo')) {
    return s;
  }
  const norm = normalizeMealImageUrl(s);
  if (norm) return norm;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

export function getCategoryForTab(tab?: string, viewingJobId?: string | null): BugCategory {
  if (isAnyMealModalOpen(viewingJobId, tab)) return 'foodcart';
  if (!tab) return 'Home';
  const lower = tab.toLowerCase();
  if (lower === 'home') return 'Home';
  if (lower === 'food') return 'foodcart';
  if (
    lower === 'biomarker' ||
    lower === 'medical' ||
    lower === 'health' ||
    lower === 'insights' ||
    lower === 'trends'
  ) {
    return 'biomarker';
  }
  if (lower === 'dictionary') return 'biomarker';
  if (lower === 'database') return 'database';
  if (lower === 'settings' || lower === 'unmatched') return 'Other';
  return 'Home';
}

function isBugSnapshotNode(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return (
    node.id === 'bug-snapshot-fab' ||
    node.classList.contains('bug-snapshot-ignore') ||
    node.classList.contains('bug-modal')
  );
}

/** DOM capture only — no getDisplayMedia, no permission prompt. */
async function capturePageScreenshot(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  try {
    const { toJpeg } = await import('html-to-image');
    const modal = document.querySelector<HTMLElement>('#food-chat-container, [data-unified-modal="true"]');
    const target = modal && modal.offsetParent !== null ? modal : document.body;

    const scrollElements = [target, ...Array.from(target.querySelectorAll('*'))]
      .filter((el) => el.scrollTop > 0);
      
    scrollElements.forEach((el) => {
      el.setAttribute('data-bug-scroll', `${el.scrollTop}`);
    });

    const scrollCSS = scrollElements
      .map(
        (el) =>
          `[data-bug-scroll="${el.scrollTop}"] > * { transform: translateY(-${el.scrollTop}px) !important; }`
      )
      .join('\n');

    const styleTag = document.createElement('style');
    styleTag.textContent = scrollCSS;
    target.appendChild(styleTag);

    try {
      const dataUrl = await toJpeg(target, {
        quality: 0.75,
        pixelRatio: 1,
        cacheBust: false,
        skipFonts: true,
        backgroundColor: '#0f172a',
        ...(target === document.body
          ? {
              width: window.innerWidth,
              height: window.innerHeight,
            }
          : {}),
        filter: (node) => !isBugSnapshotNode(node),
      });
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        return await compressImage(dataUrl, 1280, 1280, 0.75);
      }
    } finally {
      target.removeChild(styleTag);
      scrollElements.forEach((el) => {
        el.removeAttribute('data-bug-scroll');
      });
    }
  } catch (err) {
    console.warn(`${BUG_SNAPSHOT_LOG} html-to-image capture failed`, err);
  }

  return null;
}


export default function BugSnapshotFab({
  isAdmin,
  firebaseUid,
  activeTab,
  getModalContext,
  viewingJobId = null,
  biomarkerHistory,
  biomarkers,
  profile,
}: BugSnapshotFabProps) {
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [snapshotType, setSnapshotType] = useState<'bug' | 'meal'>('bug');
  const [goldenTitle, setGoldenTitle] = useState('');
  const [shots, setShots] = useState<string[]>([]);
  const [category, setCategory] = useState<BugCategory>(getCategoryForTab(activeTab, viewingJobId));
  const [tagId, setTagId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [symptom, setSymptom] = useState('');
  const [bugTags, setBugTags] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [precisionCapture, setPrecisionCapture] = useState(false);
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<string>('');
  const [lastTriageJobId, setLastTriageJobId] = useState<string | null>(null);
  const [saveAsGolden, setSaveAsGolden] = useState(false);
  const [goldenLines, setGoldenLines] = useState<GoldenMealLine[]>([]);
  const [extraIssuesText, setExtraIssuesText] = useState('');
  const [previewIssues, setPreviewIssues] = useState<string[]>([]);
  const [previewJourney, setPreviewJourney] = useState<GoldenJourneyRow[]>([]);
  const [previewInvariants, setPreviewInvariants] = useState<GoldenInvariant[]>([]);

  // Q-6.4 G1 Combined Snap State: remaining checklist rows + film shot selection + auto-spot
  const [selectedShotIndex, setSelectedShotIndex] = useState<number | null>(0);
  const [remainingRows, setRemainingRows] = useState<BugSnapRowItem[]>([
    {
      id: 'row-1',
      text: '',
      comment: '',
      photos: [],
      checked: true,
      source: 'user',
    },
  ]);
  const [selectedRowId, setSelectedRowId] = useState<string>('row-1');
  const [autoSpotHits, setAutoSpotHits] = useState<AutoSpotHit[]>([]);
  const [checkedAutoSpotIds, setCheckedAutoSpotIds] = useState<Set<string>>(new Set());

  // Requirement 7: User-controlled sharing checkboxes
  const [sendChecklist, setSendChecklist] = useState({
    a11y: true,
    overview: true,
    sessionData: true,
    photo: true,
    nutrientCalculation: true,
    debugJson: true,
  });
  const captureGenRef = useRef(0);
  const lastCaptureKeyRef = useRef('');
  const lastCaptureLenRef = useRef(0);

  useEffect(() => {
    initBrowserLogRecorder();
    initNetworkRecorder();
    initInteractionRecorder();
    setEnabled(isBugSnapshotEnabled());
    const onStorage = () => setEnabled(isBugSnapshotEnabled());
    window.addEventListener('bug_snapshot_settings_changed', onStorage);
    return () => window.removeEventListener('bug_snapshot_settings_changed', onStorage);
  }, []);

  // Update pre-selected category whenever activeTab changes if modal is not currently open
  useEffect(() => {
    if (!open) {
      setCategory(getCategoryForTab(activeTab, viewingJobId));
    }
    if (activeTab) recordTabInteraction(activeTab);
  }, [activeTab, open, viewingJobId]);

  // Restore draft when opening
  useEffect(() => {
    if (!open) return;
    const draft = loadBugSnapshotDraft();
    if (!draft) return;
    if (draft.snapshotType) {
      setSnapshotType(draft.snapshotType);
      setSaveAsGolden(draft.snapshotType === 'meal');
    }
    if (draft.goldenTitle) setGoldenTitle(draft.goldenTitle);
    if (draft.category) setCategory(draft.category as BugCategory);
    if (draft.tagId) setTagId(draft.tagId);
    if (draft.newTitle) setNewTitle(draft.newTitle);
    // Never put leftover stall auto-fill back — handleOpenFab already set the current job.
    if (draft.symptom) {
      const cleaned = stripStaleStallLines(draft.symptom);
      if (cleaned) setSymptom(cleaned);
    }
  }, [open]);

  // Persist draft while editing — never keep leftover stall auto-fill
  useEffect(() => {
    if (!open) return;
    saveBugSnapshotDraft({
      category,
      tagId,
      newTitle,
      symptom: stripStaleStallLines(symptom),
      shots,
      snapshotType,
      goldenTitle,
    });
  }, [open, category, tagId, newTitle, symptom, shots, snapshotType, goldenTitle]);

  // Paste images (Cmd/Ctrl+V or Paste button)
  const handlePasteClipboard = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        const files: File[] = [];
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              files.push(new File([blob], `clipboard-${Date.now()}.${type.split('/')[1] || 'png'}`, { type }));
            }
          }
        }
        if (files.length > 0) {
          addShotsFromFiles(files);
          return;
        }
      }
    } catch {
      /* clipboard read permission or unsupported */
    }
    setError('Press ⌘V / Ctrl+V to paste screenshot directly from your clipboard.');
    setTimeout(() => setError(null), 4000);
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        e.preventDefault();
        addShotsFromFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, shots.length]);

  const handleAddRow = () => {
    const newId = `row-${Date.now()}`;
    setRemainingRows((prev) => [
      ...prev,
      {
        id: newId,
        text: '',
        comment: '',
        photos: [],
        checked: true,
        source: 'user',
      },
    ]);
    setSelectedRowId(newId);
  };

  const handleBatchAdd = (bugTexts: string[], replace?: boolean) => {
    if (!bugTexts.length) return;
    const now = Date.now();
    const newItems: BugSnapRowItem[] = bugTexts.map((text, i) => ({
      id: `row-${now}-${i}`,
      text,
      comment: '',
      photos: [],
      checked: true,
      source: 'user',
    }));

    setRemainingRows((prev) => {
      if (replace) {
        const filtered = prev.filter((r) => r.source === 'auto' || r.text.trim() || r.photos.length > 0);
        return [...filtered, ...newItems];
      }
      if (prev.length === 1 && prev[0].source === 'user' && !prev[0].text.trim() && !prev[0].photos.length) {
        return newItems;
      }
      return [...prev, ...newItems];
    });

    if (newItems[0]) {
      setSelectedRowId(newItems[0].id);
    }
  };

  const handleBatchInsert = (targetRowId: string, bugTexts: string[]) => {
    if (!bugTexts.length) return;
    const now = Date.now();
    setRemainingRows((prev) => {
      const idx = prev.findIndex((r) => r.id === targetRowId);
      if (idx === -1) return prev;
      const targetRow = prev[idx];
      const updatedTarget: BugSnapRowItem = { ...targetRow, text: bugTexts[0] };
      const additionalRows: BugSnapRowItem[] = bugTexts.slice(1).map((text, i) => ({
        id: `row-${now}-${i}`,
        text,
        comment: '',
        photos: [],
        checked: true,
        source: 'user',
      }));
      const next = [...prev];
      next.splice(idx, 1, updatedTarget, ...additionalRows);
      return next;
    });
  };

  const handleRemoveRow = (id: string) => {
    setRemainingRows((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      if (filtered.length === 0) {
        const newId = `row-${Date.now()}`;
        setSelectedRowId(newId);
        return [
          {
            id: newId,
            text: '',
            comment: '',
            photos: [],
            checked: true,
            source: 'user',
          },
        ];
      }
      return filtered;
    });
  };

  const handleToggleRow = (id: string, checked: boolean) => {
    setRemainingRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, checked } : r))
    );
  };

  const handleTextChange = (id: string, text: string) => {
    setRemainingRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, text } : r))
    );
  };

  const handleCommentChange = (id: string, comment: string) => {
    setRemainingRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, comment } : r))
    );
  };

  const handlePinShot = (id: string) => {
    if (selectedShotIndex == null || !shots[selectedShotIndex]) return;
    const shotUrl = shots[selectedShotIndex];
    setRemainingRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.photos.includes(shotUrl)) return r;
        return { ...r, photos: [...r.photos, shotUrl] };
      })
    );
  };

  const handleClearPhoto = (id: string) => {
    setRemainingRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, photos: [] } : r))
    );
  };

  const handleToggleAutoSpot = (hit: AutoSpotHit, checked: boolean) => {
    setCheckedAutoSpotIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(hit.id);
      else next.delete(hit.id);
      return next;
    });
  };

  const loadTags = useCallback(() => {
    fetch('/api/bug-tracker/overview')
      .then((r) => r.json())
      .then((data) => {
        if (data?.bugTags) {
          setBugTags(data.bugTags);
          saveBugTrackerCache(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    if (!open) return;
    const isFood = category === 'foodcart' || activeTab === 'food' || isAnyMealModalOpen(viewingJobId, activeTab);
    const jobs = typeof JobStore?.getAllJobs === 'function' ? JobStore.getAllJobs() : [];
    const modalJobId = viewingJobId || readOpenModalJobId();
    const job = pickSnapshotJob(jobs, modalJobId);
    const food = job?.result?.pendingFoodLog || job?.result?.data?.pendingFoodLog;
    const scout = job?.result?.scoutItems || job?.result?.data?.scoutItems || job?.result?.scout || food?.scoutSnapshot;
    const logs = String(job?.result?.backendLogs || job?.liveThoughts?.backendLogs || job?.statusMessage || '');
    const rawError = String(job?.error?.message || job?.error || '');
    const errorText = sanitizeJobErrorText(rawError, logs, job?.status);
    const transportJob = /429|RESOURCE_EXHAUSTED|quota|Vision Scout Failed|503|UNAVAILABLE/i.test(logs + errorText);
    const lines = extractMealLines(food);
    if (transportJob && !scout) {
      setGoldenLines([]);
    } else if (lines.length) {
      setGoldenLines(lines.map((l) => ({ ...l, scored: l.calories != null })));
    }

    const surface = isAnyMealModalOpen(viewingJobId, activeTab) ? 'food' : snapSurface(category, activeTab);
    if (surface === 'food' || isFood) {
      fetch('/api/golden/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logText: logs,
          foodLog: food,
          scout,
          errorText,
          jobStatus: job?.status,
          jobId: job?.id || job?.jobId || modalJobId,
          backendLogsUrl: job?.result?.backendLogsUrl || job?.result?.debugUrl || job?.debugUrl,
        }),
      })
        .then((r) => r.json())
        .then((board) => {
          const journey = Array.isArray(board.journey) ? board.journey : [];
          const inv = snapshotVisibleInvariants(
            Array.isArray(board.invariants) ? board.invariants : [],
            journey
          );
          setPreviewIssues((board.outcomes || []).map((o: any) => o.label));
          setPreviewJourney(journey);
          setPreviewInvariants(inv);
          if (Array.isArray(board.observedMeal) && board.observedMeal.length) {
            setGoldenLines(board.expectedMeal || board.observedMeal);
          }
          const local = autoSpotFood({ foodLog: food, scout, logText: logs, journey });
          const serverHits = Array.isArray(board.autoSpot) ? board.autoSpot : [];
          const remaining = mergeAutoSpotHits(serverHits, local.remaining);
          const hits = remaining.concat(local.parked || []);
          setAutoSpotHits(hits);
          setCheckedAutoSpotIds(new Set(remaining.map((h) => h.id)));
        })
        .catch(() => {
          const spotted = autoSpotFood({ foodLog: food, scout, logText: logs });
          const hits = spotted.remaining.concat(spotted.parked || []);
          setAutoSpotHits(hits);
          setCheckedAutoSpotIds(new Set(spotted.remaining.map((h) => h.id)));
        });
    } else if (surface === 'home') {
      const tiles = ['bmi', 'weight', 'height']
        .filter((k) => biomarkers?.[k] != null || profile?.[k] != null)
        .map((k) => ({ key: k, value: biomarkers?.[k] ?? profile?.[k] }));
      const spotted = autoSpotHome({ tiles, profile });
      const hits = spotted.remaining.concat(spotted.parked || []);
      setAutoSpotHits(hits);
      setCheckedAutoSpotIds(new Set(spotted.remaining.map((h) => h.id)));
      setPreviewJourney([]);
      setGoldenLines([]);
    } else if (surface === 'health') {
      const spotted = autoSpotHealth({
        history: (biomarkerHistory || []).map((row: any) => ({
          id: row?.id,
          date: row?.date,
          keys: row?.biomarkers ? Object.keys(row.biomarkers) : row?.keys,
          values: row?.biomarkers || row?.values,
          sourceReportId: row?.sourceReportId,
        })),
        jobText: String(JobStore.getAllJobs?.()?.find((j: any) => /medical|biomarker/i.test(j?.kind || ''))?.inputSnapshot?.text || ''),
      });
      const hits = spotted.remaining.concat(spotted.parked || []);
      setAutoSpotHits(hits);
      setCheckedAutoSpotIds(new Set(spotted.remaining.map((h) => h.id)));
      setPreviewJourney([]);
      setGoldenLines([]);
    } else {
      setAutoSpotHits([]);
      setPreviewJourney([]);
      setGoldenLines([]);
    }
  }, [open, category, activeTab, viewingJobId, biomarkerHistory]);

  if (!isAdmin || !enabled) return null;

  const normalizeCat = (c: string) => (c || 'foodcart').toLowerCase();
  const pageTags = bugTags.filter(
    (t) => normalizeCat(t.category) === normalizeCat(category) && t.status !== 'fixed'
  );
  const otherTags = bugTags.filter(
    (t) => normalizeCat(t.category) !== normalizeCat(category) && t.status !== 'fixed'
  );

  // Requirement 3: Support adding multiple screenshots at the same time
  const addShotsFromFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;
    const remainingSlots = BUG_SNAPSHOT_MAX_SHOTS - shots.length;
    if (remainingSlots <= 0) return;
    const toProcess = fileArray.slice(0, remainingSlots);

    try {
      const newShots: string[] = [];
      for (const f of toProcess) {
        const dataUrl = await compressImage(f, 1280, 1280, 0.8);
        const webp = await compressToWebpOrJpeg(dataUrl, 1280, 0.8);
        if (webp && !shots.includes(webp) && !newShots.includes(webp)) {
          newShots.push(webp);
        }
      }
      if (newShots.length > 0) {
        setShots((s) => [...s, ...newShots.filter((x) => !s.includes(x))].slice(0, BUG_SNAPSHOT_MAX_SHOTS));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to read image(s)');
    }
  };

  /** Requirement 2: Open modal immediately, extract captured meal errors & photos, then take screen capture */
  const handleOpenFab = async () => {
    const modalJobId = viewingJobId || readOpenModalJobId();
    const modalOpen = isAnyMealModalOpen(modalJobId, activeTab);

    // Default to 'bug' (Bug Report) mode whenever opened
    setSnapshotType('bug');
    setSaveAsGolden(false);
    const cat = modalOpen ? 'foodcart' : getCategoryForTab(activeTab, modalJobId);
    setCategory(cat);
    setError(null);
    setSuccess(null);
    setCapturing(true);
    setShots([]);
    clearBugSnapshotDraft();

    // Extract active job context (captured meal processing problems + meal photo)
    const jobs = typeof JobStore?.getAllJobs === 'function' ? JobStore.getAllJobs() : [];
    const activeJob = pickSnapshotJob(jobs, modalJobId);

    // Auto-match active job to existing bug tag if confident, else prompt open vs new
    let autoMatchedTagId = '';
    if (activeJob && Array.isArray(bugTags) && bugTags.length > 0) {
      const activeJobId = activeJob.id;
      const matched = bugTags.find((t: any) => {
        if (t.status === 'fixed') return false;
        if (activeJobId && t.hold_refs?.includes(activeJobId)) return true;
        if (activeJobId && t.linked_issues?.some((l: any) => l.id === activeJobId || l.job_id === activeJobId)) return true;
        const normTitle = String(t.title || '').toLowerCase();
        const normJobTitle = String(activeJob.title || activeJob.inputSnapshot?.text || '').toLowerCase();
        if (normTitle && normJobTitle && (normTitle.includes(normJobTitle) || normJobTitle.includes(normTitle))) return true;
        return false;
      });
      if (matched) autoMatchedTagId = matched.id;
    }
    setTagId(autoMatchedTagId);

    // Pre-populate bug and golden meal title from job context
    const derivedTitle = deriveGoldenTitle({
      foodLog: activeJob?.result?.pendingFoodLog || activeJob?.result?.data?.pendingFoodLog,
      scout: activeJob?.result?.scoutItems || activeJob?.result?.data?.scoutItems || activeJob?.result?.scout,
      jobId: activeJob?.id,
      fallback: activeJob?.title || activeJob?.inputSnapshot?.text || '',
    });
    setGoldenTitle(derivedTitle);
    setNewTitle(derivedTitle);

    const capturedProblems = extractCapturedMealProblems(activeJob).filter(
      (p) => !isStaleCapturedStallSymptom(p)
    );
    setSymptom(
      capturedProblems.length > 0
        ? `[Captured Meal Processing Issues]\n` + capturedProblems.join('\n')
        : ''
    );

    setOpen(true);
    loadTags();

    // Asynchronously resolve real photos from the active job (IDB blobs, imageStore refs, R2 URLs)
    const jobPhotos: string[] = [];
    if (activeJob && cat === 'foodcart') {
      try {
        const fx = await collectOriginalFixture(activeJob);
        for (const p of fx.photos) {
          const resolved = await resolveDisplayableImage(p);
          if (resolved && !jobPhotos.includes(resolved)) {
            jobPhotos.push(resolved);
          }
        }
      } catch {
        const mealPhoto =
          activeJob?.result?.photoUrl ||
          activeJob?.result?.pendingFoodLog?.imageUrl ||
          activeJob?.result?.data?.pendingFoodLog?.imageUrl ||
          activeJob?.inputSnapshot?.imageRefs?.[0];
        if (mealPhoto) {
          const resolved = await resolveDisplayableImage(mealPhoto);
          if (resolved && !jobPhotos.includes(resolved)) {
            jobPhotos.push(resolved);
          }
        }
      }
    }

    if (jobPhotos.length > 0) {
      setShots(jobPhotos.slice(0, BUG_SNAPSHOT_MAX_SHOTS));
    }

    const modal = typeof document !== 'undefined'
      ? document.querySelector<HTMLElement>('#food-chat-container, [data-unified-modal="true"]')
      : null;
    const r = modal?.getBoundingClientRect();
    const captureKey = `${activeJob?.id || 'none'}:${Math.round(r?.left || 0)}:${Math.round(r?.top || 0)}:${Math.round(r?.width || 0)}:${Math.round(r?.height || 0)}`;
    if (captureKey === lastCaptureKeyRef.current) {
      setCapturing(false);
      return;
    }

    const token = ++captureGenRef.current;
    const run = async () => {
      try {
        const frame = await capturePageScreenshot();
        if (token !== captureGenRef.current) return;
        if (frame) {
          const webp = await compressToWebpOrJpeg(frame, 1280, 0.8);
          if (Math.abs(webp.length - lastCaptureLenRef.current) < 80) {
            lastCaptureKeyRef.current = captureKey;
            return;
          }
          lastCaptureLenRef.current = webp.length;
          lastCaptureKeyRef.current = captureKey;
          setShots([webp, ...jobPhotos].slice(0, BUG_SNAPSHOT_MAX_SHOTS));
        }
      } catch {
        /* meal photo already attached if we had one */
      } finally {
        if (token === captureGenRef.current) setCapturing(false);
      }
    };
    window.setTimeout(run, 0);
  };

  const handleClose = () => {
    setOpen(false);
    setPrecisionCapture(false);
    setShots([]);
    clearBugSnapshotDraft();
  };

  const handleStartPrecisionCapture = () => {
    // Save draft state so nothing written or attached is lost
    saveBugSnapshotDraft({
      category,
      tagId,
      newTitle,
      symptom: stripStaleStallLines(symptom),
      shots,
      snapshotType,
      goldenTitle,
    });
    setPrecisionCapture(true);
    setOpen(false);
  };

  const handleCancelPrecisionCapture = () => {
    setPrecisionCapture(false);
    setOpen(true);
  };

  const handleTakePrecisionShot = () => {
    if (isCapturingFrame || shots.length >= BUG_SNAPSHOT_MAX_SHOTS) return;
    setIsCapturingFrame(true);
    setError(null);
    const token = ++captureGenRef.current;

    window.setTimeout(async () => {
      try {
        const frame = await capturePageScreenshot();
        if (token !== captureGenRef.current) return;
        if (!frame) {
          setError('Could not capture the screen area. Please try again or use Add image.');
        } else {
          const webp = await compressToWebpOrJpeg(frame, 1280, 0.8);
          lastCaptureLenRef.current = webp.length;
          const nextShots = [webp, ...shots.filter((x) => x !== webp)].slice(0, BUG_SNAPSHOT_MAX_SHOTS);
          setShots(nextShots);
          saveBugSnapshotDraft({
            category,
            tagId,
            newTitle,
            symptom: stripStaleStallLines(symptom),
            shots: nextShots,
            snapshotType,
            goldenTitle,
          });
          setSuccess('Picture captured and added to bug snapshot!');
        }
      } catch (err: any) {
        setError(err?.message || 'Screenshot capture failed');
      } finally {
        setIsCapturingFrame(false);
        setPrecisionCapture(false);
        setOpen(true);
      }
    }, 60);
  };

  const handleCaptureScreen = () => {
    setCapturing(true);
    setError(null);
    const token = ++captureGenRef.current;
    window.setTimeout(async () => {
      try {
        const frame = await capturePageScreenshot();
        if (token !== captureGenRef.current) return;
        if (!frame) {
          setError('Could not capture the meal card. Paste (⌘V) or use Add image.');
        } else if (Math.abs(frame.length - lastCaptureLenRef.current) < 80) {
          /* same frame — skip */
        } else {
          lastCaptureLenRef.current = frame.length;
          setShots((s) => [frame, ...s.filter((x) => x !== frame)].slice(0, BUG_SNAPSHOT_MAX_SHOTS));
        }
      } finally {
        if (token === captureGenRef.current) setCapturing(false);
      }
    }, 0);
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const effectiveTitle = (newTitle || goldenTitle).trim();
      if (snapshotType === 'bug') {
        if ((tagId === 'new_bug' || !tagId) && !effectiveTitle) {
          throw new Error('Enter a title for the new bug');
        }
      } else {
        if (!effectiveTitle) {
          throw new Error('Enter a title for the golden meal');
        }
      }
      if (shots.length === 0) throw new Error('Add at least one screenshot');

      let payload: any = {};
      if (getModalContext) {
        try {
          payload = (await Promise.resolve(getModalContext())) || {};
        } catch {
          payload = {};
        }
      }
      // Prefer live agent logs from local tracker if present
      let logs = '';
      try {
        const raw = localStorage.getItem('agent_live_logs_hot') || localStorage.getItem('agent_logs_hot');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            logs = parsed
              .slice(-200)
              .map((l: any) => (typeof l === 'string' ? l : l?.message || JSON.stringify(l)))
              .join('\n');
          } else if (typeof parsed === 'string') logs = parsed;
        }
      } catch {
        /* ignore */
      }
      if (payload.backendLogs) logs = String(payload.backendLogs) + (logs ? '\n' + logs : '');

      // Prefer focused dialog for a11y (all agents default structure)
      const a11yRoot =
        typeof document !== 'undefined'
          ? document.querySelector('[data-unified-modal], [role="dialog"]') || document.body
          : null;
      const a11y = buildAccessibilityTree(a11yRoot);
      const dom = buildSimplifiedDom(); // cold fallback only
      const browserLogs = getBrowserLogBuffer();
      const network = getRecentNetworkEntries();
      const jobs = typeof JobStore?.getAllJobs === 'function' ? JobStore.getAllJobs() : [];
      const snapCat = snapshotType === 'meal' ? 'foodcart' : category;
      if (payload?.jobId && !jobFitsSnap({ category: snapCat, activeTab, jobKind: payload.kind })) {
        const {
          jobId: _jid,
          kind: _k,
          mode: _m,
          status: _st,
          result: _r,
          pendingFoodLog: _p,
          backendLogs: _b,
          scoutItems: _s,
          photoUrl: _ph,
          debugUrl: _d,
          pipelineErrors: _e,
          progressPercent: _pp,
          ...rest
        } = payload;
        payload = rest;
      }

      const contextJobId = (payload as any)?.jobId || viewingJobId || readOpenModalJobId() || null;
      const jobPool = jobs.filter((j: any) =>
        jobFitsSnap({ category: snapCat, activeTab, jobKind: j?.kind })
      );
      const activeJob = pickSnapshotJob(jobPool, contextJobId);

      let debug_payload: any = null;
      let nutrition_table_md = '';
      let meal_file_name = 'nutrition_table.md';
      let resolvedBackendLogs = '';
      let resolvedScoutItems: any[] = [];
      let resolvedFoodLog: any = null;

      if (activeJob) {
        try {
          const { buildDebugMarkdownReport, debugReportFromJobMsg, stripHeavyImages } = await import('../utils/debugPayload');

          // Only fetch cold R2 debug data for real food/biomarker jobs that exist on server.
          // bug_triage and other local-only jobs are not stored in agent_jobs table.
          const isSupabaseJob =
            Boolean(activeJob?.id) &&
            activeJob.kind !== 'bug_triage' &&
            !String(activeJob.id).startsWith('triage_') &&
            !String(activeJob.id).startsWith('bug_triage_') &&
            !String(activeJob.id).startsWith('local_') &&
            (Boolean(activeJob.serverSubmittedAt) || Boolean(activeJob.debugUrl) || Boolean(activeJob.photoUrl) || activeJob.status === 'succeeded' || activeJob.status === 'running');

          let fullJobData: any = null;
          if (isSupabaseJob && activeJob?.id) {
            try {
              const uid = (payload as any)?.firebaseUid || firebaseUid || 'anonymous';
              const dbgRes = await fetch(
                `/api/jobs/debug?jobId=${encodeURIComponent(activeJob.id)}&userId=${encodeURIComponent(uid)}`
              );
              if (dbgRes.ok) {
                fullJobData = await dbgRes.json().catch(() => null);
              }
            } catch (fetchErr) {
              // Gracefully fall back to activeJob in memory
            }
          }

          const jobForReport = fullJobData || activeJob;

          resolvedFoodLog =
            fullJobData?.result?.pendingFoodLog ||
            fullJobData?.result?.data?.pendingFoodLog ||
            fullJobData?.pendingFoodLog ||
            activeJob.result?.pendingFoodLog ||
            activeJob.result?.data?.pendingFoodLog ||
            activeJob.result?.raw?.data ||
            activeJob.messages?.slice().reverse().find((m: any) => m.pendingFoodLog || m.data?.pendingFoodLog)?.pendingFoodLog ||
            activeJob.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog ||
            (payload as any)?.pendingFoodLog ||
            null;

          resolvedScoutItems =
            fullJobData?.result?.scoutItems ||
            fullJobData?.scoutItems ||
            activeJob.result?.scoutItems ||
            activeJob.messages?.slice().reverse().find((m: any) => m.data?.scoutItems || m.scoutItems)?.data?.scoutItems ||
            (payload as any)?.scoutItems ||
            [];

          const resolvedReceipt =
            resolvedFoodLog?.receiptTable ||
            fullJobData?.result?.receiptTable ||
            activeJob.result?.receiptTable ||
            (payload as any)?.receiptTable ||
            [];

          resolvedBackendLogs =
            fullJobData?.backendLogs ||
            fullJobData?.result?.backendLogs ||
            activeJob.result?.backendLogs ||
            activeJob.liveThoughts?.backendLogs ||
            (payload as any)?.backendLogs ||
            '';

          const resolvedScoutInternalReasoning =
            fullJobData?.result?.scoutInternalReasoning ||
            fullJobData?.scoutInternalReasoning ||
            activeJob.result?.scoutInternalReasoning ||
            resolvedFoodLog?.scoutInternalReasoning ||
            activeJob.messages?.slice().reverse().find((m: any) => m.data?.scoutInternalReasoning || m.scoutInternalReasoning)?.data?.scoutInternalReasoning ||
            (payload as any)?.scoutInternalReasoning ||
            null;

          const resolvedRawScout =
            fullJobData?.result?.rawScout ||
            fullJobData?.rawScout ||
            activeJob.result?.rawScout ||
            resolvedFoodLog?.rawScout ||
            activeJob.messages?.slice().reverse().find((m: any) => m.data?.rawScout || m.rawScout)?.data?.rawScout ||
            (payload as any)?.rawScout ||
            null;

          const resolvedScoutContentType =
            fullJobData?.result?.scoutContentType ||
            fullJobData?.scoutContentType ||
            activeJob.result?.scoutContentType ||
            (payload as any)?.scoutContentType ||
            null;

          const resolvedDiningEnv =
            fullJobData?.result?.diningEnvironment ||
            fullJobData?.diningEnvironment ||
            activeJob.result?.diningEnvironment ||
            resolvedFoodLog?.diningEnvironment ||
            (payload as any)?.diningEnvironment ||
            null;

          debug_payload = stripHeavyImages({
            jobId: activeJob.id,
            kind: activeJob.kind,
            status: activeJob.status,
            inputSnapshot: activeJob.inputSnapshot,
            result: fullJobData?.result || activeJob.result,
            messages: activeJob.messages,
            liveThoughts: activeJob.liveThoughts,
            progressPercent: activeJob.progressPercent,
            attemptByStep: activeJob.attemptByStep,
            error: activeJob.error,
            backendLogs: resolvedBackendLogs,
            pipelineErrors: fullJobData?.result?.pipelineErrors || activeJob.result?.pipelineErrors,
            scoutItems: resolvedScoutItems,
            scoutInternalReasoning: resolvedScoutInternalReasoning,
            rawScout: resolvedRawScout,
            scoutContentType: resolvedScoutContentType,
            diningEnvironment: resolvedDiningEnv,
            pendingFoodLog: resolvedFoodLog,
            receiptTable: resolvedReceipt,
            exportedAt: new Date().toISOString(),
          });

          const lastMsg = activeJob.messages?.[activeJob.messages.length - 1];
          const reportInput = debugReportFromJobMsg(jobForReport, lastMsg);
          nutrition_table_md = buildDebugMarkdownReport({
            ...reportInput,
            pendingFoodLog: resolvedFoodLog || reportInput.pendingFoodLog,
            scoutItems: resolvedScoutItems.length > 0 ? resolvedScoutItems : reportInput.scoutItems,
            scoutInternalReasoning: resolvedScoutInternalReasoning || reportInput.scoutInternalReasoning,
            rawScout: resolvedRawScout || reportInput.rawScout,
            scoutContentType: resolvedScoutContentType || reportInput.scoutContentType,
            diningEnvironment: resolvedDiningEnv || reportInput.diningEnvironment,
            receiptTable: resolvedReceipt.length > 0 ? resolvedReceipt : reportInput.receiptTable,
            backendLogs: resolvedBackendLogs || reportInput.backendLogs,
          });

          const mealName =
            resolvedFoodLog?.name ||
            (payload as any)?.dish_query ||
            (payload as any)?.query ||
            reportInput.pendingFoodLog?.name ||
            activeJob.inputSnapshot?.text ||
            activeJob.id;
          const safeMeal = String(mealName)
            .replace(/[^a-zA-Z0-9_\- ]/g, '')
            .trim()
            .slice(0, 60);
          meal_file_name = safeMeal ? `${safeMeal}.md` : `report-${activeJob.id}.md`;
        } catch (repErr) {
          console.warn('[BugSnapshot] Report generation skipped:', repErr);
        }
      }

      const domain_pack = resolveDomainPack({
        category: snapCat,
        activeTab,
        jobs: jobPool,
        payload,
        jobId: contextJobId,
        biomarkerHistory,
        biomarkers,
        profile,
      });
      const env = captureBugEnv({
        activeJobId:
          (payload as any)?.jobId ||
          activeJob?.id ||
          domain_pack.food?.jobId ||
          domain_pack.biomarker?.jobId ||
          null,
        activeMode: (payload as any)?.mode || activeJob?.kind || domain_pack.food?.mode || null,
        modelId: localStorage.getItem('selectedModelId'),
      });

      const interactions = formatInteractionRing();
      const combinedLogs = scrubPiiText(
        [
          logs,
          browserLogs ? `=== BROWSER CONSOLE LOGS ===\n${browserLogs}` : '',
          interactions ? `=== INTERACTIONS (last ${getInteractionRing().length}) ===\n${interactions}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      );

      const check = buildCaptureChecklist({
        a11y: !!a11y?.textOutline,
        domainPack: !!domain_pack,
        shots: shots.length,
        logs: !!combinedLogs,
        networkFails: getNetworkFailureCount(),
        interactions: getInteractionRing().length,
      });
      setChecklist(check);

      const allRemainingLines = [
        ...remainingRows
          .filter((r) => r.checked && r.text.trim())
          .map((r) => (r.comment.trim() ? `${r.text.trim()} — ${r.comment.trim()}` : r.text.trim())),
        ...autoSpotHits
          .filter((h) => checkedAutoSpotIds.has(h.id) && !/scouted only/i.test(h.text))
          .map((h) => h.text.trim()),
      ];

      const autoTriage = isBugAutoTriageEnabled();
      const effectiveCategory = category || 'foodcart';
      const effectiveTagId = tagId === 'new_bug' ? undefined : tagId || undefined;
      const effectiveNewTitle = tagId === 'new_bug' || !tagId ? (newTitle.trim() || goldenTitle.trim() || undefined) : undefined;
      const effectiveSymptom = symptom.trim() || allRemainingLines.join('\n');

      const body = {
        category: effectiveCategory,
        tag_id: effectiveTagId,
        new_bug_title: effectiveNewTitle,
        user_symptom: effectiveSymptom || undefined,
        remaining: allRemainingLines.length > 0 ? allRemainingLines : undefined,
        remaining_lines: remainingRows
          .filter((r) => r.checked && r.text.trim())
          .map((r) => ({
            text: r.comment.trim() ? `${r.text.trim()} — ${r.comment.trim()}` : r.text.trim(),
            comment: r.comment.trim() || undefined,
            photo_urls: r.photos,
            source: r.source,
          })),
        shots,
        payload: {
          ...payload,
          debug_payload,
          debug_job: debug_payload,
          nutrition_table_md,
          meal_file_name,
          domain_pack,
          structure_default: AGENT_STRUCTURE_DEFAULT,
          interactions: getInteractionRing().slice(-50),
          remaining: allRemainingLines,
        },
        debug_payload,
        nutrition_table_md,
        meal_file_name,
        domain_pack,
        logs: combinedLogs,
        dom,
        a11y,
        network,
        env,
        firebase_uid: firebaseUid || undefined,
        dish_query:
          (payload as any)?.dish_query ||
          (payload as any)?.query ||
          domain_pack.food?.mealName ||
          (effectiveCategory === 'foodcart' ? (goldenTitle.trim() || newTitle.trim()) : undefined),
        chain_key: (payload as any)?.chain_key || undefined,
        auto_triage: autoTriage,
        modelId: localStorage.getItem('selectedModelId') || 'gemini-3.5-flash-lite',
      };

      const res = await fetch('/api/bugs/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      // Q-6.4 item 6: snap writes issue_tags only. Do not mint D1 golden_cases / disk inbox/.
      // Replay catalog / log on food #n uses POST /api/golden/preview.

      // Save directly to AI Agent Diagnostic Log History
      try {
        const logEntries: any[] = [
          {
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] User symptom: ${symptom || '(none provided)'}`,
          },
          {
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Uploaded ${shots.length} screenshot(s), a11y tree outline, slim DOM, and network activity on category "${category}".`,
          },
        ];

        if (activeJob) {
          const debugFileName = `debug-${activeJob.id}.json`;
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Active Job: ${activeJob.id} (status=${activeJob.status || 'unknown'}, kind=${activeJob.kind || 'food'})`,
          });
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: [
              `[BugSnapshot] Files captured for agent:`,
              `  • ${debugFileName}  ← full debug JSON payload`,
              nutrition_table_md ? `  • ${meal_file_name}  ← nutrition calculation table` : '  • (no nutrition table — job may have no result)',
              `  • overview.md  ← a11y + domain pack briefing`,
            ].join('\n'),
          });
        }
        if (nutrition_table_md) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Nutrition Calculation & Receipt Table (${meal_file_name}):\n${nutrition_table_md}`,
          });
        }
        if (debug_payload) {
          const debugFileName = `debug-${activeJob?.id || 'job'}.json`;
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Full Debug Payload (${debugFileName}):\n${JSON.stringify(debug_payload, null, 2)}`,
          });
        }
        if (combinedLogs) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            message: `[BugSnapshot] Live Logs & Browser Trace:\n${combinedLogs}`,
          });
        }
        logEntries.push({
          timestamp: new Date().toLocaleTimeString(),
          message: `[BugSnapshot] Report ${json.reportId || json.id} linked to bug tag "${json.tag_id || tagId}". ${autoTriage ? 'Auto-triage agent is working...' : 'Triage available on demand.'}`,
        });

        saveAgentRequestLog({
          id: `snapshot_${json.tag_id || tagId}_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          summary: `[BugSnapshot] Captured "${newTitle || tagId}" (${category})`,
          logs: logEntries,
        });
        window.dispatchEvent(new Event('agent_logs_updated'));
      } catch (logErr) {
        console.warn('[BugSnapshot] Failed to save log history:', logErr);
      }

      // Durable client job so retry is possible if auto-triage fails
      const triageJobId = json.triage_job_id || null;
      setLastTriageJobId(triageJobId);
      if (autoTriage && json.tag_id) {
        try {
          JobStore.createJob({
            id: triageJobId || `bug_triage_${json.tag_id}_${Date.now()}`,
            kind: 'bug_triage',
            status: triageJobId ? 'running' : 'queued',
            stepIndex: 0,
            stepTotal: 1,
            progressPercent: triageJobId ? 40 : 10,
            statusMessage: triageJobId
              ? 'Auto-triage running (a11y + domain pack)…'
              : 'Snapshot saved; triage not started',
            messages: [],
            inputSnapshot: {
              text: String(json.tag_id),
              imageRefs: [],
              modelId: body.modelId,
              tagId: json.tag_id,
              reportId: json.reportId,
              mode: 'bug_triage',
            } as any,
            attemptByStep: {},
            result: {
              tagId: json.tag_id,
              reportId: json.reportId,
              r2_prefix: json.r2_prefix,
              capture_checklist: json.capture_checklist,
            },
          });
        } catch {
          /* ignore JobStore errors */
        }
      }

      clearBugSnapshotDraft();
      setSuccess(
        `Saved ${String(json.id || '').slice(0, 8)}… · ${check}${
          autoTriage ? ' · triage queued' : ''
        }`
      );
      setShots([]);
      setSymptom('');
      loadTags();
      setTimeout(() => {
        setSuccess(null);
        setOpen(false);
      }, 1600);
    } catch (e: any) {
      setError(e?.message || 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full text-xs rounded-xl px-3 py-2 bg-slate-950/80 border border-white/20 text-white placeholder:text-white/40';

  const currentCategoryLabel =
    CATEGORY_OPTIONS.find((c) => normalizeCat(c.key) === normalizeCat(category))?.label || category;

  return (
    <>
      {!open && !precisionCapture &&
        createPortal(
          <button
            type="button"
            id="bug-snapshot-fab"
            title="Capture bug snapshot"
            onClick={handleOpenFab}
            className="fixed right-3 bottom-24 md:right-4 md:bottom-28 z-[80] flex items-center gap-1.5 px-3 py-2.5 rounded-2xl shadow-lg border border-rose-400/40 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all hover:scale-[1.03]"
          >
            <Camera className="w-4 h-4" />
            <span className="hidden sm:inline">Bug snap</span>
          </button>,
          document.body
        )}

      {precisionCapture &&
        createPortal(
          <div
            id="bug-precision-capture-dock"
            className="bug-snapshot-ignore fixed right-3 bottom-20 md:right-5 md:bottom-24 z-[99999] flex flex-col items-end gap-2 pointer-events-auto select-none animate-in fade-in slide-in-from-right-4 duration-200"
          >
            {/* Context Tooltip */}
            <div className="bg-slate-950/95 backdrop-blur-md text-white text-[11px] font-medium px-3.5 py-2 rounded-xl shadow-2xl border border-indigo-500/40 max-w-[280px] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
              <span>Navigate or scroll to the exact area, then tap <strong>Snap area</strong>.</span>
            </div>

            {/* Precision Floating Shutter Bar */}
            <div className="flex items-center gap-2 p-2 rounded-2xl bg-slate-900/95 backdrop-blur-md shadow-2xl border border-white/20">
              <button
                type="button"
                title="Return to bug snapshot modal"
                onClick={handleCancelPrecisionCapture}
                className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors border border-white/10"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return</span>
              </button>

              <button
                type="button"
                title="Snap this exact screen area"
                disabled={isCapturingFrame || shots.length >= BUG_SNAPSHOT_MAX_SHOTS}
                onClick={handleTakePrecisionShot}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all border border-rose-400/50 group disabled:opacity-50"
              >
                {isCapturingFrame ? (
                  <Loader className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Camera className="w-4 h-4 group-hover:scale-110 transition-transform" />
                )}
                <span>{isCapturingFrame ? 'Capturing area…' : 'Snap area'}</span>
                <span className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] text-rose-200 font-mono">
                  {shots.length}/{BUG_SNAPSHOT_MAX_SHOTS}
                </span>
              </button>
            </div>
          </div>,
          document.body
        )}

      {open &&
        createPortal(
          <div className="bug-snapshot-ignore bug-modal fixed inset-0 z-[9990] bg-slate-950 flex flex-col">
            <div className="bg-slate-900 text-white w-full h-full max-h-[100dvh] rounded-none border-0 shadow-none flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <Bug className="w-4 h-4 text-rose-400" />
                  Bug snapshot
                </div>
                <button
                  type="button"
                  title="Close"
                  onClick={handleClose}
                  className="p-2 rounded-xl hover:bg-white/10 border border-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
                {error && (
                  <div className="p-2 rounded-lg bg-rose-950/80 border border-rose-500/40 text-rose-200">{error}</div>
                )}
                {success && (
                  <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {success}
                  </div>
                )}

                {/* Capture & Add Image Toolbar */}
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    title="Take picture of target screen area (minimizes modal)"
                    disabled={shots.length >= BUG_SNAPSHOT_MAX_SHOTS}
                    onClick={handleStartPrecisionCapture}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold disabled:opacity-40 flex items-center gap-1.5 text-white shadow-sm transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Take picture
                  </button>
                  <label className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold cursor-pointer flex items-center gap-1.5 text-white transition-all">
                    <ImagePlus className="w-3.5 h-3.5" />
                    Add image
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addShotsFromFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    title="Paste screenshot from clipboard (⌘V / Ctrl+V)"
                    disabled={shots.length >= BUG_SNAPSHOT_MAX_SHOTS}
                    onClick={handlePasteClipboard}
                    className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold disabled:opacity-40 flex items-center gap-1.5 text-white transition-all cursor-pointer"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    Paste
                  </button>
                  <span className="text-white/50 self-center text-xs">
                    {shots.length}/{BUG_SNAPSHOT_MAX_SHOTS}
                  </span>
                </div>

                {shots.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-white/50">Click a shot to select for pinning (blue ring):</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {shots.map((s, i) => {
                        const isSelectedShot = selectedShotIndex === i;
                        return (
                          <div
                            key={i}
                            className={`relative shrink-0 w-20 h-20 rounded-xl overflow-hidden cursor-pointer group shadow-sm transition-all ${
                              isSelectedShot
                                ? 'border-2 border-indigo-400 ring-2 ring-indigo-400/70'
                                : 'border border-white/20 hover:border-white/40'
                            }`}
                            onClick={() => setSelectedShotIndex(i)}
                          >
                            <img
                              src={normalizeMealImageUrl(s) || s}
                              alt={`shot ${i + 1}`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const target = e.currentTarget;
                                if (!target.dataset.tried) {
                                  target.dataset.tried = '1';
                                  const norm = normalizeMealImageUrl(s);
                                  if (norm && norm !== s) target.src = norm;
                                }
                              }}
                            />
                            <button
                              type="button"
                              title="Delete shot"
                              className="absolute top-1 right-1 p-1 rounded-lg bg-black/75 text-rose-300 hover:bg-rose-600 hover:text-white transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShots((prev) => prev.filter((_, j) => j !== i));
                                if (selectedShotIndex === i) {
                                  setSelectedShotIndex(shots.length > 1 ? 0 : null);
                                }
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              title="Enlarge preview"
                              className="absolute top-1 left-1 p-1 rounded-lg bg-black/75 text-white/80 hover:bg-indigo-600 hover:text-white transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewUrl(s);
                              }}
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-white/80">
                              #{i + 1}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unified Form Body */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="font-bold text-white/90 text-xs">Page / Category</label>
                      <select
                        value={category}
                        onChange={(e) => {
                          setCategory(e.target.value as BugCategory);
                          setTagId('');
                        }}
                        className={inputCls}
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-white/90 text-xs">Bug tag</label>
                      <select
                        value={tagId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTagId(val);
                          if (val && val !== 'new_bug') {
                            const selectedTag = bugTags.find((t) => t.id === val);
                            if (selectedTag?.category) {
                              const match = CATEGORY_OPTIONS.find(
                                (c) => normalizeCat(c.key) === normalizeCat(selectedTag.category)
                              );
                              if (match) setCategory(match.key);
                            }
                          }
                        }}
                        className={inputCls}
                      >
                        <option value="">— Select open #n or create new —</option>
                        <option value="new_bug">+ Create new bug…</option>
                        {pageTags.length > 0 && (
                          <optgroup label={`Active bugs for ${currentCategoryLabel}`}>
                            {pageTags.map((t) => {
                              const pub = publicId(hydrateWorkItem(t), t.id);
                              return (
                                <option key={t.id} value={t.id}>
                                  Open {pub}: {t.title}
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                        {otherTags.length > 0 && (
                          <optgroup label="Other active bugs">
                            {otherTags.map((t) => {
                              const pub = publicId(hydrateWorkItem(t), t.id);
                              const catLabel =
                                CATEGORY_OPTIONS.find(
                                  (c) => normalizeCat(c.key) === normalizeCat(t.category)
                                )?.label || t.category || 'Other';
                              return (
                                <option key={t.id} value={t.id}>
                                  Open {pub} [{catLabel}]: {t.title}
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Attached Bug Tag Context Card */}
                  {tagId && tagId !== 'new_bug' && (() => {
                    const selectedTag = bugTags.find((t) => t.id === tagId);
                    if (!selectedTag) return null;
                    const item = hydrateWorkItem(selectedTag);
                    const pub = publicId(item, selectedTag.id);
                    const pinnedBug = (item.bug || selectedTag.pinned_instruction || '').trim();
                    const identifiedProblem = (
                      selectedTag.identified_problems ||
                      selectedTag.description ||
                      selectedTag.symptom ||
                      selectedTag.notes ||
                      selectedTag.user_note ||
                      ''
                    ).trim();

                    return (
                      <div className="p-3 rounded-xl border border-violet-500/40 bg-violet-950/40 space-y-2 text-xs text-violet-100 shadow-md">
                        <div className="flex items-center justify-between gap-2 border-b border-violet-500/20 pb-1.5">
                          <span className="font-bold text-violet-300 flex items-center gap-1.5 text-xs">
                            <Bug className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            Attaching to Open {pub}: {selectedTag.title}
                          </span>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-violet-900 text-violet-200 border border-violet-500/30">
                            Queue: {item.queue || selectedTag.status || 'ready'}
                          </span>
                        </div>
                        {pinnedBug ? (
                          <div className="text-[11px] text-white/95 leading-relaxed bg-black/40 p-2 rounded-lg border border-white/10 space-y-0.5">
                            <div className="flex items-center gap-1 font-bold text-amber-300 text-[10px]">
                              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>Pinned Bug:</span>
                            </div>
                            <p>{pinnedBug}</p>
                          </div>
                        ) : null}
                        {identifiedProblem && identifiedProblem !== pinnedBug ? (
                          <div className="text-[11px] text-white/90 leading-relaxed bg-black/40 p-2 rounded-lg border border-amber-500/30 space-y-0.5">
                            <span className="font-bold text-amber-400 text-[10px] block">User Context / Identified:</span>
                            <p>{identifiedProblem}</p>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

                  {/* Title Input */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="font-bold text-amber-300 text-xs">Title *</label>
                      {(() => {
                        const jobs = typeof JobStore?.getAllJobs === 'function' ? JobStore.getAllJobs() : [];
                        const modalJobId = viewingJobId || readOpenModalJobId();
                        const activeJob = pickSnapshotJob(jobs, modalJobId);
                        const food = activeJob?.result?.pendingFoodLog || activeJob?.result?.data?.pendingFoodLog;
                        const mTitle = food?.name || activeJob?.title || activeJob?.inputSnapshot?.text || '';
                        const foodSurface =
                          isAnyMealModalOpen(viewingJobId, activeTab) || snapSurface(category, activeTab) === 'food';
                        if (mTitle && foodSurface) {
                          return (
                            <span className="text-[10px] font-bold text-indigo-300 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700 truncate max-w-[220px]">
                              Meal · {mTitle}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <input
                      value={newTitle || goldenTitle}
                      onChange={(e) => {
                        setNewTitle(e.target.value);
                        setGoldenTitle(e.target.value);
                      }}
                      className={inputCls}
                      placeholder="Short descriptive title for this bug snapshot"
                    />
                  </div>

                  {(() => {
                    const surface = isAnyMealModalOpen(viewingJobId, activeTab) ? 'food' : snapSurface(category, activeTab);
                    if (surface === 'home') {
                      const tiles = ['bmi', 'weight', 'height']
                        .filter((k) => biomarkers?.[k] != null || profile?.[k] != null)
                        .map((k) => ({
                          key: k,
                          label: k,
                          value: biomarkers?.[k] ?? profile?.[k],
                        }));
                      const tombs = {
                        ...(profile?.deletedCustomBiomarkerKeys || {}),
                        ...(profile?.deletedBiomarkerLogIds || {}),
                      };
                      const thinTombs = Object.fromEntries(
                        Object.entries(tombs).filter(([k]) => /bmi|weight|height/i.test(k))
                      );
                      return (
                        <HomeStatePanel
                          surface="home"
                          tiles={tiles}
                          tombstones={thinTombs as Record<string, string | number>}
                        />
                      );
                    }
                    if (surface === 'health') {
                      const logs = (biomarkerHistory || []).slice(0, 12).flatMap((row: any) => {
                        const bm = row?.biomarkers && typeof row.biomarkers === 'object' ? row.biomarkers : {};
                        return Object.entries(bm).slice(0, 8).map(([key, value]) => ({
                          id: row?.id,
                          key,
                          value: value as string | number,
                          date: row?.date,
                        }));
                      });
                      return (
                        <HealthLogsPanel
                          surface="health"
                          keys={logs.map((l) => l.key)}
                          historyCount={biomarkerHistory?.length || 0}
                          logs={logs}
                        />
                      );
                    }
                    if (surface !== 'food') return null;
                    return (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-2.5 space-y-2.5">
                        {previewJourney.length > 0 && (
                          <div className="rounded-lg border border-white/10 bg-black/30 p-2 space-y-1 text-xs">
                            <p className="text-[11px] font-bold text-amber-200">
                              Scout identity — {previewJourney.filter((j) => j.identityPass).length}/{previewJourney.length} identified
                            </p>
                            {groupJourneyByDish(previewJourney).map((g) => (
                              <div key={g.dish} className="space-y-0.5 pl-1">
                                <p className="text-[10px] font-semibold text-white/90 truncate">{g.dish}</p>
                                {g.rows.map((j) => (
                                  <div key={j.id} className="flex items-baseline justify-between gap-2 text-[10px] pl-2">
                                    <span className="text-white/70 truncate">{j.query}</span>
                                    <span className={j.identityPass ? 'text-emerald-300 shrink-0 font-semibold' : 'text-rose-300 shrink-0 font-semibold'}>
                                      {PHASE_LABEL[j.phase] || j.phase}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Top dishes table */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="font-bold text-amber-200 text-xs">Top dishes — target values</p>
                            <button
                              type="button"
                              onClick={() => {
                                setGoldenLines((prev) => [
                                  ...prev,
                                  {
                                    name: `Dish ${prev.length + 1}`,
                                    weightGrams: null,
                                    calories: null,
                                    protein: null,
                                    carbohydrates: null,
                                    totalFat: null,
                                    sodium: null,
                                    scored: true,
                                  },
                                ]);
                              }}
                              className="px-2 py-0.5 rounded bg-amber-500/30 hover:bg-amber-500/50 border border-amber-400/40 text-[10px] text-amber-200 font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              Add Dish
                            </button>
                          </div>
                          {goldenLines.length > 0 && (
                            <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/40">
                              <table className="w-full text-[10px] border-collapse">
                                <thead>
                                  <tr className="text-left text-[9px] uppercase tracking-wide text-white/45 border-b border-white/10">
                                    <th className="px-1.5 py-1 font-bold w-6"></th>
                                    <th className="px-1.5 py-1 font-bold">Dish</th>
                                    <th className="px-1 py-1 font-bold text-amber-200/80 w-14">kcal</th>
                                    <th className="px-1 py-1 font-bold text-emerald-200/80 w-14">g</th>
                                    <th className="px-1 py-1 font-bold text-blue-200/80 w-12">P</th>
                                    <th className="px-1 py-1 w-6"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {goldenLines.map((line, i) => (
                                    <tr key={i} className="border-t border-white/5 align-middle">
                                      <td className="px-1.5 py-1">
                                        <input
                                          type="checkbox"
                                          checked={line.scored}
                                          title="Score this dish"
                                          onChange={(e) => {
                                            const next = [...goldenLines];
                                            next[i] = { ...next[i], scored: e.target.checked };
                                            setGoldenLines(next);
                                          }}
                                          className="rounded border-amber-400"
                                        />
                                      </td>
                                      <td className="px-1.5 py-1">
                                        <input
                                          className="w-full min-w-[140px] bg-slate-900 border border-white/20 rounded px-1.5 py-0.5 text-[10px] text-white"
                                          value={line.name}
                                          placeholder="Dish name"
                                          onChange={(e) => {
                                            const next = [...goldenLines];
                                            next[i] = { ...next[i], name: e.target.value };
                                            setGoldenLines(next);
                                          }}
                                        />
                                      </td>
                                      <td className="px-1 py-1">
                                        <input
                                          className="w-14 bg-slate-900 border border-white/20 rounded px-1 py-0.5 text-[10px] text-amber-200"
                                          value={line.calories ?? ''}
                                          placeholder="kcal"
                                          onChange={(e) => {
                                            const next = [...goldenLines];
                                            const v = e.target.value === '' ? null : Number(e.target.value);
                                            next[i] = { ...next[i], calories: v };
                                            setGoldenLines(next);
                                          }}
                                        />
                                      </td>
                                      <td className="px-1 py-1">
                                        <input
                                          className="w-14 bg-slate-900 border border-white/20 rounded px-1 py-0.5 text-[10px] text-emerald-200"
                                          value={line.weightGrams ?? ''}
                                          placeholder="g"
                                          onChange={(e) => {
                                            const next = [...goldenLines];
                                            const v = e.target.value === '' ? null : Number(e.target.value);
                                            next[i] = { ...next[i], weightGrams: v };
                                            setGoldenLines(next);
                                          }}
                                        />
                                      </td>
                                      <td className="px-1 py-1">
                                        <input
                                          className="w-12 bg-slate-900 border border-white/20 rounded px-1 py-0.5 text-[10px] text-blue-200"
                                          value={line.protein ?? ''}
                                          placeholder="P"
                                          onChange={(e) => {
                                            const next = [...goldenLines];
                                            const v = e.target.value === '' ? null : Number(e.target.value);
                                            next[i] = { ...next[i], protein: v };
                                            setGoldenLines(next);
                                          }}
                                        />
                                      </td>
                                      <td className="px-1 py-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setGoldenLines((prev) => prev.filter((_, idx) => idx !== i));
                                          }}
                                          className="p-1 text-rose-400 hover:text-rose-200 cursor-pointer"
                                          title="Remove dish"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Q-6.4 G1: Bugs on this meal / page (Checklist rows + film pin toolbar + AutoSpot) */}
                  <BugSnapRemainingSection
                    rows={remainingRows}
                    selectedRowId={selectedRowId}
                    selectedShotUrl={selectedShotIndex != null ? shots[selectedShotIndex] : null}
                    autoSpotHits={autoSpotHits}
                    checkedAutoSpotIds={checkedAutoSpotIds}
                    onSelectRow={setSelectedRowId}
                    onAddRow={handleAddRow}
                    onBatchAdd={handleBatchAdd}
                    onBatchInsert={handleBatchInsert}
                    onRemoveRow={handleRemoveRow}
                    onToggleRow={handleToggleRow}
                    onTextChange={handleTextChange}
                    onCommentChange={handleCommentChange}
                    onPinShot={handlePinShot}
                    onClearPhoto={handleClearPhoto}
                    onToggleAutoSpot={handleToggleAutoSpot}
                  />

                  {/* Optional user notes / symptom */}
                  <div className="space-y-1">
                    <label className="font-bold text-white/90 text-xs">Identified problem / symptom (optional)</label>
                    <textarea
                      rows={2}
                      value={symptom}
                      onChange={(e) => setSymptom(e.target.value)}
                      className={inputCls}
                      placeholder="What looks wrong? (full diagnosis can be filled by Analyze later)"
                    />
                  </div>
                </div>

                {/* Requirements 6 & 7: Cleaned up Capture pack and checkboxes for info sent */}
                {(() => {
                  const surface = isAnyMealModalOpen(viewingJobId, activeTab)
                    ? 'food'
                    : snapSurface(category, activeTab);
                  const isFoodSurface = surface === 'food';
                  const isHomeSurface = surface === 'home';
                  const isHealthSurface = surface === 'health';

                  return (
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/25 p-2.5 space-y-2 text-[11px] text-white/70">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>Capture pack data to send to agent</span>
                        </div>
                        <span className="text-[10px] font-mono uppercase bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded">
                          {surface}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={sendChecklist.a11y}
                            onChange={(e) => setSendChecklist((s) => ({ ...s, a11y: e.target.checked }))}
                            className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                          />
                          <span>Accessibility tree</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={sendChecklist.photo}
                            onChange={(e) => setSendChecklist((s) => ({ ...s, photo: e.target.checked }))}
                            className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                          />
                          <span>Screenshots ({shots.length})</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={sendChecklist.overview}
                            onChange={(e) => setSendChecklist((s) => ({ ...s, overview: e.target.checked }))}
                            className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                          />
                          <span>Overview & logs</span>
                        </label>

                        {isHomeSurface && (
                          <>
                            <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sendChecklist.sessionData}
                                onChange={(e) => setSendChecklist((s) => ({ ...s, sessionData: e.target.checked }))}
                                className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                              />
                              <span>Home tiles & profile</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sendChecklist.debugJson}
                                onChange={(e) => setSendChecklist((s) => ({ ...s, debugJson: e.target.checked }))}
                                className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                              />
                              <span>Tombstones (thin)</span>
                            </label>
                          </>
                        )}

                        {isFoodSurface && (
                          <>
                            <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sendChecklist.nutrientCalculation}
                                onChange={(e) => setSendChecklist((s) => ({ ...s, nutrientCalculation: e.target.checked }))}
                                className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                              />
                              <span>Nutrient calculation</span>
                            </label>

                            <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sendChecklist.debugJson}
                                onChange={(e) => setSendChecklist((s) => ({ ...s, debugJson: e.target.checked }))}
                                className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                              />
                              <span>Debug JSON payload</span>
                            </label>
                          </>
                        )}

                        {isHealthSurface && (
                          <>
                            <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sendChecklist.sessionData}
                                onChange={(e) => setSendChecklist((s) => ({ ...s, sessionData: e.target.checked }))}
                                className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                              />
                              <span>Biomarker history</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sendChecklist.debugJson}
                                onChange={(e) => setSendChecklist((s) => ({ ...s, debugJson: e.target.checked }))}
                                className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                              />
                              <span>Medical tombstones</span>
                            </label>
                          </>
                        )}

                        {!isFoodSurface && !isHomeSurface && !isHealthSurface && (
                          <label className="flex items-center gap-1.5 text-white/80 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={sendChecklist.sessionData}
                              onChange={(e) => setSendChecklist((s) => ({ ...s, sessionData: e.target.checked }))}
                              className="rounded border-emerald-500/50 text-emerald-500 focus:ring-0 bg-slate-900"
                            />
                            <span>Session data</span>
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })()}
          </div>

              <div className="p-3 border-t border-white/10 flex gap-2 justify-end shrink-0">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3 py-2 rounded-xl bg-slate-700 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSubmit}
                  className="px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40 flex items-center gap-1.5 text-white bg-rose-600 hover:bg-rose-500 cursor-pointer shadow-md"
                >
                  {busy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {tagId && tagId !== 'new_bug' ? 'Save snapshot → open bug' : 'Save & upload snapshot'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {previewUrl &&
        createPortal(
          <div
            className="bug-snapshot-ignore fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <img
              src={previewUrl}
              alt="shot preview"
              className="max-w-full max-h-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-black/60 text-white hover:bg-black/90"
            >
              <X className="w-5 h-5" />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/** Settings toggle rows — embed in Settings panel */
export function BugSnapshotSettingsToggle() {
  const [on, setOn] = useState(isBugSnapshotEnabled());
  const [auto, setAuto] = useState(isBugAutoTriageEnabled());
  return (
    <div className="space-y-2">
      <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-800/50 rounded-2xl flex items-center justify-between shadow-xs">
        <div>
          <p className="text-sm font-bold text-theme-text">Bug snapshot capture</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Floating control to snapshot the page into R2 /bugs/ (admin). Off hides the button.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => {
            const next = !on;
            setOn(next);
            setBugSnapshotEnabled(next);
            window.dispatchEvent(new Event('bug_snapshot_settings_changed'));
          }}
          className={`relative w-12 h-7 rounded-full transition-colors ${on ? 'bg-rose-600' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
      <div className="p-3.5 bg-violet-50/70 dark:bg-violet-950/25 border border-violet-200/80 dark:border-violet-800/50 rounded-2xl flex items-center justify-between shadow-xs">
        <div>
          <p className="text-sm font-bold text-theme-text">Auto-triage after snapshot</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Runs Flash-lite on a11y + domain pack after save. Instance stays if the model fails — retry from Bug Tracker.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          onClick={() => {
            const next = !auto;
            setAuto(next);
            setBugAutoTriageEnabled(next);
          }}
          className={`relative w-12 h-7 rounded-full transition-colors ${auto ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${auto ? 'translate-x-5' : ''}`}
          />
        </button>
      </div>
    </div>
  );
}
