import { trackApiCall } from '../utils/apiTracker';
import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, FoodLog, NutrientBreakdown, RecommendationReport } from '../types';
import { translations } from '../utils/translations';
import { displayNutrientName } from '../utils/i18n';
import { Edit2, Trash2, Calendar, Search, ChevronDown, ChevronUp, Image as ImageIcon, Save, Check, Plus, Loader, X, Camera, Download } from 'lucide-react';
import { nutrientDefinitions, getNutrientColor } from '../utils/nutrition';
import { formatNutrientDisplayValue } from '../utils/nutrients';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { compressMultipleImages } from '../utils/imageCompressor';
import { getCurrentDateInTimezone, toYYYYMMDD } from '../utils/dateUtils';
import ImageSlider from './ImageSlider';
import { resolveFoodImage, resolveFoodImages } from '../utils/imageResolver';
import { mergeFoodLogsDeduped, foodLogFingerprint } from '../utils/foodLogDedupe';
import { fetchFoodLogDetail } from '../utils/syncUtils';

/** B13 — only this many history rows mount image sliders at once */
export const FOOD_HISTORY_PAGE_SIZE = 15;
import { NutrientPieChart } from './NutrientPieChart';
import { NutrientTargetRow } from './NutrientTargetRow';
import { NutritionLabelTable } from './chat-cards/NutritionLabelTable';
import { MealPortionController } from './chat-cards/MealPortionController';
import { scaleMealPortion, scaleSingleDishPortion } from '../utils/portionUtils';
import { PhysicalFormBadge } from './PhysicalFormBadge';
import { JobStore, isJobBlank } from '../jobs/JobStore';
import { toPendingFoodLog } from '../mealBuild/adapters';
import TaskPlaceholderCard from './TaskPlaceholderCard';
import { CroppedFoodImage, isValidBoundingBox, getFoodImageUrl, resolveHistoricalImgSrc } from './chat-cards/FoodCard';
import { ZoomableImage } from './ZoomableImage';
import { buildDebugMarkdownReport } from '../utils/debugPayload';
import { calculateMealDebugRetentionStatus } from '../utils/debugLogRetention';

interface FoodHistoryTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  onUpdateFoodLog: (food: FoodLog) => void;
  onDeleteFoodLog: (id: string) => void;
  /** Persist collapsed food list when sync left duplicates in state */
  onReplaceFoodLogs?: (foods: FoodLog[]) => void;
  onLogFood?: (food: FoodLog) => void;
  onEditingActiveChange?: (active: boolean) => void;
  isManualEntryOpen?: boolean;
  onManualEntryOpenChange?: (open: boolean) => void;
  manualEntryAlert?: string | null;
  onClearManualEntryAlert?: () => void;
  report?: RecommendationReport | null;
  initiallyExpandedFoodId?: string | null;
  onClearInitiallyExpandedFoodId?: () => void;
  onViewJob?: (jobId: string) => void;
}

function cleanData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}

const formatLogDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[2], 10);
    const monthIndex = parseInt(parts[1], 10) - 1;
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = months[monthIndex] || parts[1];
    return `${day} ${monthName}`;
  }
  return dateStr;
};

const getRecommendationColorClass = (rec: string, level?: string) => {
  const lvl = String(level || '').toLowerCase();
  if (lvl === 'alert' || lvl === 'bad' || lvl === 'avoid' || lvl === 'danger' || lvl === 'severe') {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
  }
  if (lvl === 'warning' || lvl === 'caution' || lvl === 'moderate') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  }
  if (lvl === 'good' || lvl === 'safe' || lvl === 'healthy' || lvl === 'best') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  }
  const lower = String(rec || '').toLowerCase();
  if (lower.includes('good') || lower.includes('safe') || lower.includes('best') || lower.includes('perfect') || lower.includes('healthy')) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  }
  if (lower.includes('moderate') || lower.includes('caution') || lower.includes('amber') || lower.includes('risk') || lower.includes('warning')) {
    if (lower.includes('high')) {
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
    }
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  }
  if (lower.includes('bad') || lower.includes('avoid') || lower.includes('severe') || lower.includes('danger')) {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
};

export default function FoodHistoryTab({
  profile,
  foodLogs,
  onUpdateFoodLog,
  onDeleteFoodLog,
  onReplaceFoodLogs,
  onLogFood,
  onEditingActiveChange,
  isManualEntryOpen: propIsManualEntryOpen,
  onManualEntryOpenChange,
  manualEntryAlert,
  onClearManualEntryAlert,
  report,
  initiallyExpandedFoodId,
  onClearInitiallyExpandedFoodId,
  onViewJob
}: FoodHistoryTabProps) {
  const t = translations[profile.language] || translations.en;
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [openLabelLogMap, setOpenLabelLogMap] = useState<Record<string, number | null>>({});
  const [zoomState, setZoomState] = useState<{ src: string; boundingBox?: number[] | null; foodName?: string; items: any[]; currentIdx: number; resolvedImgs: string[] } | null>(null);
  // Lazy-fetched heavy detail fields per log id (composition, scoutItems, itemsBreakdown, chatTranscript)
  const [detailOverrides, setDetailOverrides] = useState<Record<string, { composition?: string; scoutItems?: any[]; itemsBreakdown?: any[]; chatTranscript?: any[] }>>({});
  const [protectedRefs, setProtectedRefs] = useState<Set<string>>(new Set());

  // Fetch protected references from bug tracker to protect associated debug logs
  useEffect(() => {
    let isMounted = true;
    fetch('/api/debug-logs/protected-refs')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (isMounted && data && Array.isArray(data.refs)) {
          setProtectedRefs(new Set(data.refs.map((r: string) => String(r).toLowerCase())));
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const retentionStatusMap = React.useMemo(() => {
    return calculateMealDebugRetentionStatus(foodLogs, protectedRefs, 10);
  }, [foodLogs, protectedRefs]);

  // Fetch heavy detail fields when a log is expanded and we don't already have them
  useEffect(() => {
    if (!expandedLogId) return;
    if (detailOverrides[expandedLogId]) return; // already fetched
    const uid = auth.currentUser?.uid || profile?.uid;
    const email = auth.currentUser?.email || profile?.email;
    if (!uid) return;
    let cancelled = false;
    fetchFoodLogDetail(expandedLogId, uid, email || undefined).then(detail => {
      if (cancelled || !detail) return;
      setDetailOverrides(prev => ({
        ...prev,
        [expandedLogId]: {
          composition: detail.composition || undefined,
          scoutItems: Array.isArray(detail.scout_items) ? detail.scout_items : undefined,
          itemsBreakdown: Array.isArray(detail.items_breakdown) ? detail.items_breakdown : undefined,
          chatTranscript: Array.isArray(detail.chat_transcript) ? detail.chat_transcript : undefined,
        }
      }));
    }).catch(err => {
      console.warn('[FoodHistoryTab] fetchFoodLogDetail catch:', err?.message || err);
    });
    return () => { cancelled = true; };
  }, [expandedLogId]);
  const [currentPage, setCurrentPage] = useState(1);
  /** B13 — page size for history list + image loads (free-tier / capacity) */
  const itemsPerPage = FOOD_HISTORY_PAGE_SIZE;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);
  
  // Photo and compression states inside card edit
  const [cardCompressingLogId, setCardCompressingLogId] = useState<string | null>(null);
  const [cardCompressingProgress, setCardCompressingProgress] = useState({ current: 0, total: 0, percent: 0 });

  // Drag and drop sorting state for photos
  const [draggedPhotoIndex, setDraggedPhotoIndex] = useState<number | null>(null);

  // Editing states
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editLogState, setEditLogState] = useState<FoodLog | null>(null);
  const [manualMultiplier, setManualMultiplier] = useState<string>('1');
  const [editMultiplier, setEditMultiplier] = useState<string>('1');

  useEffect(() => {
    if (onEditingActiveChange) {
      onEditingActiveChange(!!editingLogId);
    }
  }, [editingLogId, onEditingActiveChange]);

  // Manual Entry States
  const [localManualEntryOpen, setLocalManualEntryOpen] = useState(false);
  const isManualEntryOpen = propIsManualEntryOpen !== undefined ? propIsManualEntryOpen : localManualEntryOpen;
  const setIsManualEntryOpen = (val: boolean) => {
    setLocalManualEntryOpen(val);
    if (onManualEntryOpenChange) {
      onManualEntryOpenChange(val);
    }
    if (!val && onClearManualEntryAlert) {
      onClearManualEntryAlert();
    }
  };
  const [manualCompressing, setManualCompressing] = useState(false);
  const [manualCompressingProgress, setManualCompressingProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [manualLog, setManualLog] = useState<Partial<FoodLog>>({
    date: getCurrentDateInTimezone(profile.timezone),
    name: '',
    composition: '',
    weightGrams: 150,
    quantity: '1 serving',
    consumedAmount: 1,
    benefits: 'Custom manually logged food.',
    risks: 'None reported.',
    healthImpact: 'Supports daily nutritional goals.',
    recommendation: 'neutral',
    imageUrls: [],
    nutrients: {
      calories: 0,
      protein: 0,
      totalFat: 0,
      saturatedFat: 0,
      unsaturatedFat: 0,
      omega3: 0,
      carbohydrates: 0,
      addedSugar: 0,
      totalFibre: 0,
      solubleFibre: 0,
      sodium: 0,
      potassium: 0,
      magnesium: 0,
      calcium: 0,
      iron: 0,
      zinc: 0,
      selenium: 0,
      iodine: 0,
      phosphorus: 0,
      vitaminD: 0,
      vitaminB12: 0,
      folate: 0,
      vitaminC: 0,
      vitaminE: 0,
      vitaminK: 0,
      vitaminA: 0,
      vitaminB6: 0,
      thiamine: 0,
      riboflavin: 0,
      niacin: 0
    }
  });

  const updateField = (field: keyof FoodLog, value: any) => {
    if (!editLogState) return;
    const parseNum = (str: string | undefined) => {
      if (!str) return null;
      const match = String(str).match(/[\d.]+/);
      return match ? parseFloat(match[0]) : null;
    };

    let updatedLog = { ...editLogState, [field]: value };

    if (field === 'consumedAmount') {
      const oldNum = editLogState.consumedAmount || 1;
      const newNum = Number(value) || 1;
      if (newNum > 0 && oldNum > 0 && oldNum !== newNum) {
        const scale = newNum / oldNum;
        const newNutrients = { ...(editLogState.nutrients || {}) };
        Object.keys(newNutrients).forEach(k => {
          newNutrients[k as keyof NutrientBreakdown] = Number(((newNutrients[k as keyof NutrientBreakdown] || 0) * scale).toFixed(2));
        });
        updatedLog.nutrients = newNutrients as NutrientBreakdown;
        updatedLog.weightGrams = Number(((editLogState.weightGrams || 0) * scale).toFixed(1));
      }
    } else if (field === 'weightGrams') {
      const oldWeight = editLogState.weightGrams || 1;
      const newWeight = Number(value) || 0;
      if (newWeight > 0 && oldWeight > 0 && oldWeight !== newWeight) {
        const scale = newWeight / oldWeight;
        const newNutrients = { ...(editLogState.nutrients || {}) };
        Object.keys(newNutrients).forEach(k => {
          newNutrients[k as keyof NutrientBreakdown] = Number(((newNutrients[k as keyof NutrientBreakdown] || 0) * scale).toFixed(2));
        });
        updatedLog.nutrients = newNutrients as NutrientBreakdown;
      }
    }

    setEditLogState(updatedLog);
  };

  const updateManualField = (field: keyof FoodLog, value: any) => {
    const parseNum = (str: string | undefined) => {
      if (!str) return null;
      const match = String(str).match(/[\d.]+/);
      return match ? parseFloat(match[0]) : null;
    };
    let updatedLog = { ...manualLog, [field]: value };

    if (field === 'consumedAmount') {
      const oldNum = manualLog.consumedAmount || 1;
      const newNum = Number(value) || 1;
      if (newNum > 0 && oldNum > 0 && oldNum !== newNum) {
        const scale = newNum / oldNum;
        const newNutrients = { ...(manualLog.nutrients || {}) };
        Object.keys(newNutrients).forEach(k => {
          newNutrients[k as keyof NutrientBreakdown] = Number(((newNutrients[k as keyof NutrientBreakdown] || 0) * scale).toFixed(2));
        });
        updatedLog.nutrients = newNutrients as NutrientBreakdown;
        updatedLog.weightGrams = Number(((manualLog.weightGrams || 0) * scale).toFixed(1));
      }
    } else if (field === 'weightGrams') {
      const oldWeight = manualLog.weightGrams || 1;
      const newWeight = Number(value) || 0;
      if (newWeight > 0 && oldWeight > 0 && oldWeight !== newWeight) {
        const scale = newWeight / oldWeight;
        const newNutrients = { ...(manualLog.nutrients || {}) };
        Object.keys(newNutrients).forEach(k => {
          newNutrients[k as keyof NutrientBreakdown] = Number(((newNutrients[k as keyof NutrientBreakdown] || 0) * scale).toFixed(2));
        });
        updatedLog.nutrients = newNutrients as NutrientBreakdown;
      }
    }

    setManualLog(updatedLog);
  };

  const updateNutrient = (nutrientKey: keyof NutrientBreakdown, value: number) => {
    if (!editLogState) return;
    setEditLogState({
      ...editLogState,
      nutrients: {
        ...(editLogState.nutrients || {}),
        [nutrientKey]: value
      } as NutrientBreakdown
    });
  };

  const remapItemImageIndex = (item: any, from: number, to: number) => {
    if (!item || typeof item !== 'object') return item;
    const currIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
    let newIdx = currIdx;
    if (currIdx === from) {
      newIdx = to;
    } else if (from < to && currIdx > from && currIdx <= to) {
      newIdx = currIdx - 1;
    } else if (from > to && currIdx >= to && currIdx < from) {
      newIdx = currIdx + 1;
    }
    return { ...item, sourceImageIndex: newIdx };
  };

  const remapItemsList = (items: any[] | undefined, from: number, to: number) => {
    if (!Array.isArray(items)) return items;
    return items.map(item => remapItemImageIndex(item, from, to));
  };

  const deleteItemImageIndex = (item: any, deletedIdx: number, remainingCount: number) => {
    if (!item || typeof item !== 'object') return item;
    const currIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
    let newIdx = currIdx;
    if (currIdx === deletedIdx) {
      newIdx = Math.max(0, Math.min(deletedIdx, remainingCount - 1));
    } else if (currIdx > deletedIdx) {
      newIdx = Math.max(0, currIdx - 1);
    }
    return { ...item, sourceImageIndex: newIdx };
  };

  const deleteItemsList = (items: any[] | undefined, deletedIdx: number, remainingCount: number) => {
    if (!Array.isArray(items)) return items;
    return items.map(item => deleteItemImageIndex(item, deletedIdx, remainingCount));
  };

  // Drag-and-drop Photo sorting
  const handlePhotoDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPhotoIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedPhotoIndex === null || draggedPhotoIndex === index || !editLogState) return;

    const from = draggedPhotoIndex;
    const to = index;
    const currentUrls = editLogState.imageUrls ? [...editLogState.imageUrls] : (editLogState.imageUrl ? [editLogState.imageUrl] : []);
    const updatedUrls = [...currentUrls];
    
    // Perform splice
    const [draggedItem] = updatedUrls.splice(from, 1);
    updatedUrls.splice(to, 0, draggedItem);
    
    setDraggedPhotoIndex(to);
    setEditLogState({
      ...editLogState,
      imageUrls: updatedUrls,
      imageUrl: updatedUrls[0] || '',
      scoutItems: remapItemsList(editLogState.scoutItems, from, to),
      itemsBreakdown: remapItemsList(editLogState.itemsBreakdown, from, to),
      ...((editLogState as any).items ? { items: remapItemsList((editLogState as any).items, from, to) } : {})
    });
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoIndex(null);
  };

  // Drag-and-drop for manual log photos
  const handleManualPhotoDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedPhotoIndex === null || draggedPhotoIndex === index) return;

    const from = draggedPhotoIndex;
    const to = index;
    const currentUrls = manualLog.imageUrls ? [...manualLog.imageUrls] : [];
    const updatedUrls = [...currentUrls];
    
    const [draggedItem] = updatedUrls.splice(from, 1);
    updatedUrls.splice(to, 0, draggedItem);
    
    setDraggedPhotoIndex(to);
    setManualLog({
      ...manualLog,
      imageUrls: updatedUrls,
      imageUrl: updatedUrls[0] || '',
      scoutItems: remapItemsList(manualLog.scoutItems, from, to),
      itemsBreakdown: remapItemsList(manualLog.itemsBreakdown, from, to),
      ...((manualLog as any).items ? { items: remapItemsList((manualLog as any).items, from, to) } : {})
    });
  };

  const [jobs, setJobs] = useState(() =>
    JobStore.getAllJobs().filter(
      j => j.kind === 'food_log' || j.kind === 'food_compare' || j.kind === 'food' || !j.kind
    )
  );
  useEffect(() => {
    const unsubscribe = JobStore.subscribe(() => {
      setJobs(
        JobStore.getAllJobs()
          .filter(
            j => j.kind === 'food_log' || j.kind === 'food_compare' || j.kind === 'food' || !j.kind
          )
          .map(j => ({ ...j }))
      );
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const activeFoodLogs = React.useMemo(() => {
    const nonDeleted = (foodLogs || []).filter(f => f.sync_state !== 'delete');
    return mergeFoodLogsDeduped(nonDeleted, []);
  }, [foodLogs]);

  // Persist collapsed list when state still holds sync retries (oatmeal/honi doubles)
  React.useEffect(() => {
    if (!onReplaceFoodLogs) return;
    const live = (foodLogs || []).filter((f) => f.sync_state !== 'delete');
    if (live.length > activeFoodLogs.length && activeFoodLogs.length > 0) {
      console.log(
        `[FoodDedupe] Collapsing ${live.length} → ${activeFoodLogs.length} food cards (sync duplicates)`
      );
      onReplaceFoodLogs(activeFoodLogs);
    }
  }, [foodLogs, activeFoodLogs, onReplaceFoodLogs]);

  const combinedItems = React.useMemo(() => {
    const inFlightJobIds = new Set(
      jobs.filter(j =>
        ['queued', 'running', 'processing', 'awaiting_user', 'cancel_requested'].includes(j.status) ||
        (typeof j.inFlightTurnAt === 'number' && (!j.finishedAt || new Date(j.finishedAt).getTime() < j.inFlightTurnAt))
      ).map(j => j.id)
    );
    const savedLogs = activeFoodLogs
      .filter(log => !inFlightJobIds.has(log.id))
      .map(log => {
      let dateIso = new Date().toISOString();
      if (log.id && typeof log.id === 'string' && log.id.startsWith('food_')) {
        const ts = parseInt(log.id.split('_')[1]);
        if (!isNaN(ts)) {
          dateIso = new Date(ts).toISOString();
        }
      } else if (log.date) {
        try {
          const d = new Date(log.date);
          if (!isNaN(d.getTime())) {
            dateIso = d.toISOString();
          }
        } catch {}
      }
      return {
        type: 'log' as const,
        id: log.id,
        date: log.date || '',
        createdAt: dateIso,
        data: log
      };
    });

    const jobItems = jobs
      .filter(job => {
        if (!job || isJobBlank(job)) return false;
        // Exclude draft jobs
        if (job.status === 'draft') return false;
        const hasText = !!job.inputSnapshot?.text?.trim();
        const hasImages = !!(job.inputSnapshot as any)?.hasImage || !!job.photoUrl;
        const hasServerResult = !!(
          job.result?.pendingFoodLog ||
          job.result?.clean_result?.pendingFoodLog ||
          job.result?.raw?.data ||
          job.result?.data ||
          job.result?.photoUrl
        );
        const isActiveServerJob =
          (job.kind === 'food_log' || job.kind === 'food_compare' || (job as any).kind === 'food' || !job.kind) &&
          ['queued', 'running', 'processing', 'awaiting_user', 'cancel_requested', 'failed'].includes(job.status);
        const hasMeaningfulMessages = !!(
          job.messages &&
          job.messages.length > 0 &&
          job.messages.some((m: any) => m.content?.trim() || m.pendingFoodLog || m.data?.pendingFoodLog)
        );

        if (!hasText && !hasImages && !hasServerResult && !isActiveServerJob && !hasMeaningfulMessages) return false;

        if (job.status !== 'succeeded') return true;
        let pendingFoodLog =
          job.result?.clean_result?.pendingFoodLog ||
          job.result?.pendingFoodLog ||
          (job.result?.clean_result?.mealBuild ? toPendingFoodLog(job.result.clean_result.mealBuild) : null) ||
          (job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null) ||
          job.result?.clean_result?.data ||
          (job.mealBuild ? toPendingFoodLog(job.mealBuild) : null) ||
          job.result?.raw?.data ||
          job.result?.data ||
          job.result?.foodData ||
          (job.result?.items ? job.result : null) ||
          job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
          job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

        if (pendingFoodLog && typeof pendingFoodLog === 'object' && !pendingFoodLog.id) {
          pendingFoodLog = { ...pendingFoodLog, id: job.id };
        }

        if (!pendingFoodLog) return hasMeaningfulMessages;
        return !activeFoodLogs.some(f => {
          if (f.id === pendingFoodLog.id || f.id === job.id || (f as any).jobId === job.id) return true;
          // Soft match: same fingerprint
          try {
            if (foodLogFingerprint(f as any) === foodLogFingerprint(pendingFoodLog as any)) return true;
          } catch { /* ignore */ }
          return false;
        });
      })
      .map(job => ({
        type: 'job' as const,
        id: job.id,
        date: (typeof job.createdAt === 'string' ? job.createdAt : new Date(job.createdAt || Date.now()).toISOString()).split('T')[0],
        createdAt: job.createdAt,
        data: job
      }));

    const all = [...savedLogs, ...jobItems];
    const seen = new Set<string>();
    const deduped: typeof all = [];
    all.forEach(item => {
      // Normalize date + calories so UI list cannot show oatmeal twice
      const key =
        item.type === 'log'
          ? foodLogFingerprint(item.data as any)
          : `job_${item.id}`;
      if (item.type === 'log') {
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      } else {
        const job = item.data as any;
        const isInFlight = ['queued', 'running', 'processing', 'awaiting_user', 'cancel_requested'].includes(job.status);
        if (isInFlight) {
          // Always display in-flight job cards to show live analysis or modification progress
          deduped.push(item);
          return;
        }
        // Hide job cards that soft-match an already shown saved meal
        let pending =
          job.result?.clean_result?.pendingFoodLog ||
          job.result?.pendingFoodLog ||
          (job.result?.clean_result?.mealBuild ? toPendingFoodLog(job.result.clean_result.mealBuild) : null) ||
          (job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null) ||
          job.result?.clean_result?.data ||
          (job.mealBuild ? toPendingFoodLog(job.mealBuild) : null) ||
          job.result?.raw?.data ||
          job.result?.data ||
          job.result?.foodData ||
          (job.result?.items ? job.result : null) ||
          job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
          job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;
          
        if (pending && typeof pending === 'object' && !pending.id) {
          pending = { ...pending, id: job.id };
        }
        
        const jobFp = pending ? foodLogFingerprint(pending as any) : '';
        if (jobFp && seen.has(jobFp)) return;
        deduped.push(item);
      }
    });

    return deduped.sort((a, b) => {
      const getIsoDate = (item: typeof a): string => {
        if (item.type === 'log') {
          return toYYYYMMDD((item.data as any)?.date);
        }
        const job = item.data as any;
        const pending = job?.result?.pendingFoodLog || job?.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog;
        if (pending?.date) return toYYYYMMDD(pending.date);
        if (job?.createdAt) return toYYYYMMDD(job.createdAt);
        return '1970-01-01';
      };

      const dateA = getIsoDate(a);
      const dateB = getIsoDate(b);

      if (dateA !== dateB) {
        return dateB.localeCompare(dateA); // Newest date first (e.g. 2026-08-25 before 2026-08-24)
      }

      // If dates match, sort by latest timestamp within that date
      const getTime = (item: typeof a) => {
        if (item.type === 'log') {
          const l = item.data as any;
          if (l.updated_at && typeof l.updated_at === 'number') return l.updated_at;
          if (l.id && typeof l.id === 'string') {
            const match = l.id.match(/\d{10,13}/);
            if (match) {
              const parsed = parseInt(match[0], 10);
              if (!isNaN(parsed) && parsed > 1000000000) return parsed;
            }
          }
          if (item.createdAt) {
            const t = new Date(item.createdAt).getTime();
            if (!isNaN(t)) return t;
          }
          return 0;
        } else {
          const j = item.data as any;
          if (j.createdAt) {
            const t = new Date(j.createdAt).getTime();
            if (!isNaN(t)) return t;
          }
          if (j.updatedAt) {
            const t = new Date(j.updatedAt).getTime();
            if (!isNaN(t)) return t;
          }
          return 0;
        }
      };

      return getTime(b) - getTime(a);
    });
  }, [activeFoodLogs, jobs]);

  const filteredLogs = React.useMemo(() => {
    return combinedItems.filter(item => {
      if (item.type === 'log') {
        const log = item.data;
        const name = log.name || '';
        const message = log.message || log.description || '';
        const composition = log.composition || '';
        const healthImpact = log.healthImpact || '';
        return name.toLowerCase().includes(searchTerm.toLowerCase()) ||
               message.toLowerCase().includes(searchTerm.toLowerCase()) ||
               composition.toLowerCase().includes(searchTerm.toLowerCase()) ||
               healthImpact.toLowerCase().includes(searchTerm.toLowerCase());
      } else {
        const job = item.data;
        const text = job.inputSnapshot?.text || '';
        const status = job.status || '';
        let pendingFoodLog =
          job.result?.clean_result?.pendingFoodLog ||
          job.result?.pendingFoodLog ||
          (job.result?.clean_result?.mealBuild ? toPendingFoodLog(job.result.clean_result.mealBuild) : null) ||
          (job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null) ||
          job.result?.clean_result?.data ||
          (job.mealBuild ? toPendingFoodLog(job.mealBuild) : null) ||
          job.result?.raw?.data ||
          job.result?.data ||
          job.result?.foodData ||
          (job.result?.items ? job.result : null) ||
          job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
          job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;
          
        if (pendingFoodLog && typeof pendingFoodLog === 'object' && !pendingFoodLog.id) {
          pendingFoodLog = { ...pendingFoodLog, id: job.id };
        }
        
        const mealName = pendingFoodLog?.name || '';
        return text.toLowerCase().includes(searchTerm.toLowerCase()) ||
               status.toLowerCase().includes(searchTerm.toLowerCase()) ||
               mealName.toLowerCase().includes(searchTerm.toLowerCase());
      }
    });
  }, [combinedItems, searchTerm]);

  // Auto-navigate to the correct pagination page and expand initiallyExpandedFoodId (e.g. clicked from TrendsTab)
  useEffect(() => {
    if (!initiallyExpandedFoodId) return;

    // If search term would filter out this item, reset search term so it is visible
    if (searchTerm) {
      const matchInFiltered = filteredLogs.some(item => item.data?.id === initiallyExpandedFoodId);
      if (!matchInFiltered) {
        setSearchTerm('');
      }
    }

    // Find the item index in combinedItems and switch to that page
    const targetIdx = combinedItems.findIndex(item => item.data?.id === initiallyExpandedFoodId);
    if (targetIdx >= 0) {
      const targetPage = Math.floor(targetIdx / itemsPerPage) + 1;
      if (currentPage !== targetPage) {
        setCurrentPage(targetPage);
      }
    }

    setExpandedLogId(initiallyExpandedFoodId);
    onClearInitiallyExpandedFoodId?.();
  }, [initiallyExpandedFoodId, combinedItems, filteredLogs, itemsPerPage, currentPage, searchTerm, onClearInitiallyExpandedFoodId]);

  // Smooth scroll into view when expandedLogId or currentPage updates
  useEffect(() => {
    if (!expandedLogId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`food-log-item-${expandedLogId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [expandedLogId, currentPage]);

  const handleDownloadDebugLog = async (log: FoodLog) => {
    const targetJobId =
      (log as any).jobId ||
      (log.debugUrl ? log.debugUrl.match(/debug\/(?:[^\/]+\/)?([a-zA-Z0-9_\-]+)\.json/i)?.[1] : null) ||
      log.id;
    const uid = auth.currentUser?.uid || 'anonymous';

    // 1) Try server proxy endpoint with strict non-HTML validation
    try {
      const res = await fetch(`/api/jobs/debug?jobId=${encodeURIComponent(targetJobId)}&userId=${encodeURIComponent(uid)}&format=markdown`);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text();
        // Ensure this is not an iframe cookie check HTML challenge or empty stub
        if (
          !contentType.includes('text/html') &&
          !text.trim().startsWith('<!doctype') &&
          !text.trim().startsWith('<html') &&
          !text.includes('Cookie check') &&
          !text.includes('No server execution trace found')
        ) {
          const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `debug-${targetJobId}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          return;
        }
      }
    } catch (err) {
      console.warn('[FoodHistoryTab] Server debug fetch failed, using client fallback:', err);
    }

    // 2) If debugUrl is an R2 link, try fetching raw JSON via proxy or direct
    let remotePayload: any = null;
    if (log.debugUrl && (log.debugUrl.startsWith('http://') || log.debugUrl.startsWith('https://') || log.debugUrl.startsWith('debug/'))) {
      try {
        const rawDebug = log.debugUrl.replace('pub-d17eecca64f82625d29dc38b14f46c14.r2.dev', 'pub-2ae421ce82904986ae87c8bc27552cff.r2.dev');
        const r2Url = rawDebug.startsWith('http') ? rawDebug : `https://pub-2ae421ce82904986ae87c8bc27552cff.r2.dev/${rawDebug.replace(/^\/+/, '')}`;
        let r2Res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(r2Url)}`);
        if (!r2Res.ok) {
          r2Res = await fetch(r2Url);
        }
        if (r2Res.ok) {
          const contentType = r2Res.headers.get('content-type') || '';
          if (contentType.includes('json') || !contentType.includes('html')) {
            remotePayload = await r2Res.json().catch(() => null);
          }
        }
      } catch (r2Err) {
        console.warn('[FoodHistoryTab] R2 debug fetch failed:', r2Err);
      }
    }

    // 3) Client fallback: synthesize complete Markdown report from log & remote payload
    const job = JobStore.getJob(targetJobId);
    const backendLogs =
      remotePayload?.backendLogs ||
      (typeof (log as any).backendLogs === 'string' ? (log as any).backendLogs : '') ||
      (Array.isArray((log as any).backendLogs) ? (log as any).backendLogs.join('\n') : '') ||
      (log as any).rawLogs ||
      job?.result?.backendLogs ||
      '';

    const mdContent = buildDebugMarkdownReport({
      jobId: targetJobId,
      status: remotePayload?.status || job?.status || 'saved',
      mode: remotePayload?.mode || job?.result?.mode || 'food_log',
      message: remotePayload?.message || remotePayload?.result?.message || log.healthImpact || log.benefits,
      sessionEvents: job?.sessionEvents || remotePayload?.result?.sessionEvents,
      backendLogs,
      pendingFoodLog: remotePayload?.result?.pendingFoodLog || remotePayload?.pendingFoodLog || log,
      scoutItems: remotePayload?.result?.scoutItems || (log as any).scoutItems || (log as any).items,
      receiptTable: remotePayload?.result?.receiptTable || (log as any).receiptTable,
      debugUrl: log.debugUrl,
      photoUrl: (log as any).photoUrl || (Array.isArray(log.imageUrls) ? log.imageUrls[0] : log.imageUrl),
      comprehensiveNutrients: log.nutrients as unknown as Record<string, number>,
      exportedAt: new Date().toISOString()
    });

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-${targetJobId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleStartEdit = (log: FoodLog) => {
    setEditingLogId(log.id);
    setEditLogState(JSON.parse(JSON.stringify(log)));
  };

  const handleSaveEdit = () => {
    if (editLogState) {
      onUpdateFoodLog(editLogState);
    }
    setEditingLogId(null);
    setEditLogState(null);
  };

  const handleSaveManualLog = () => {
    if (!manualLog.name?.trim()) {
      alert(t.alertManualName);
      return;
    }
    if (onLogFood) {
      const fullLog: FoodLog = {
        ...manualLog,
        id: `food_manual_${Date.now()}`,
        date: manualLog.date || getCurrentDateInTimezone(profile.timezone),
        name: manualLog.name,
        composition: manualLog.composition || 'Manually logged ingredients',
        weightGrams: Number(manualLog.weightGrams) || 100,
        quantity: manualLog.quantity || '1 serving',
        consumedAmount: manualLog.consumedAmount || 1,
        benefits: manualLog.benefits || 'Manually logged food benefits.',
        risks: manualLog.risks || 'No reported risks.',
        healthImpact: manualLog.healthImpact || 'Supports biomarker balances.',
        recommendation: manualLog.recommendation || 'neutral',
        imageUrls: manualLog.imageUrls || [],
        imageUrl: manualLog.imageUrls?.[0] || undefined,
        nutrients: manualLog.nutrients as NutrientBreakdown
      };
      onLogFood(fullLog);
    }
    // Reset manual state
    setManualLog({
      date: getCurrentDateInTimezone(profile.timezone),
      name: '',
      composition: '',
      weightGrams: 150,
      quantity: '1 serving',
      benefits: 'Custom manually logged food.',
      risks: 'None reported.',
      healthImpact: 'Supports daily nutritional goals.',
      recommendation: 'neutral',
      imageUrls: [],
      nutrients: {
        calories: 0,
        protein: 0,
        totalFat: 0,
        saturatedFat: 0,
        unsaturatedFat: 0,
        omega3: 0,
        carbohydrates: 0,
        addedSugar: 0,
        totalFibre: 0,
        solubleFibre: 0,
        sodium: 0,
        potassium: 0,
        magnesium: 0,
        calcium: 0,
        iron: 0,
        zinc: 0,
        selenium: 0,
        iodine: 0,
        phosphorus: 0,
        vitaminD: 0,
        vitaminB12: 0,
        folate: 0,
        vitaminC: 0,
        vitaminE: 0,
        vitaminK: 0,
        vitaminA: 0,
        vitaminB6: 0,
        thiamine: 0,
        riboflavin: 0,
        niacin: 0
      }
    });
    setIsManualEntryOpen(false);
  };


  return (
    <div className="space-y-4 pb-40 animation-fade-in max-w-md mx-auto px-0 mt-4 font-sans text-theme-text">
      
      {/* Search Input and Manual Entry Link */}
      <div className="space-y-2 px-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
          <input
            id="food-search-input"
            type="text"
            placeholder={t.searchFoodPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-theme-bg-card border border-theme-border/80 rounded-2xl pl-10 pr-28 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-sm"
          />
          <button
            type="button"
            onClick={() => setIsManualEntryOpen(true)}
            className="absolute right-2.5 top-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            {t.manualEntry}
          </button>
        </div>
      </div>

      {/* Manual Entry Form Dialog (Modal) */}
      {isManualEntryOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex flex-col p-0 animation-fade-in font-sans">
          <div className="w-full h-full bg-theme-bg-card flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-theme-border flex flex-col gap-3 sticky top-0 bg-theme-bg-card z-10 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600">
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-theme-text text-sm">{t.manualFoodEntry}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsManualEntryOpen(false)}
                  className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {manualEntryAlert && (
                <div className="px-3 py-2 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-xs font-medium rounded-lg border border-rose-100 dark:border-rose-800 flex items-center gap-2">
                  <X className="w-3.5 h-3.5" />
                  {manualEntryAlert}
                </div>
              )}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-left">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.foodNameRequired}</label>
                  <input
                    type="text"
                    required
                    placeholder={t.foodNamePlaceholder}
                    value={manualLog.name || ''}
                    onChange={(e) => setManualLog({ ...manualLog, name: e.target.value })}
                    className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.dateRequired}</label>
                  <input
                    type="date"
                    value={manualLog.date || ''}
                    onChange={(e) => setManualLog({ ...manualLog, date: e.target.value })}
                    className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.weightGramsLabel}</label>
                  <input
                    type="number"
                    placeholder="e.g. 150"
                    value={manualLog.weightGrams || ''}
                    onChange={(e) => updateManualField('weightGrams', Number(e.target.value) || 0)}
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.servingSizeLabel}</label>
                  <input
                    type="text"
                    placeholder={t.servingSizePlaceholder}
                    value={manualLog.quantity || ''}
                    onChange={(e) => updateManualField('quantity', e.target.value)}
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.consumedAmountLabel}</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 1, 1.5, 2"
                    value={manualLog.consumedAmount || ''}
                    onChange={(e) => updateManualField('consumedAmount', Number(e.target.value) || 0)}
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.compositionIngredientsLabel}</label>
                <textarea
                  rows={2}
                  placeholder={t.compositionPlaceholder}
                  value={manualLog.composition || ''}
                  onChange={(e) => setManualLog({ ...manualLog, composition: e.target.value })}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:ring-2 focus:ring-indigo-500/20 focus:outline-none resize-none"
                />
              </div>

              {/* Recommendation selection */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t.recommendationRatingLabel}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['good', 'neutral', 'bad'] as const).map((rec) => (
                    <button
                      key={rec}
                      type="button"
                      onClick={() => setManualLog({ ...manualLog, recommendation: rec })}
                      className={`py-1.5 px-3 rounded-xl text-xs font-bold capitalize transition-all border ${
                        manualLog.recommendation === rec
                          ? rec === 'good'
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-sm'
                            : rec === 'bad'
                              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-500 text-rose-600 dark:text-rose-400 shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 border-slate-400 text-theme-text-secondary shadow-sm'
                          : 'bg-theme-bg-card border-theme-border text-theme-text-secondary hover:bg-slate-50 dark:hover:bg-slate-850'
                      }`}
                    >
                      {rec === 'good' ? t.ratingGood : rec === 'bad' ? t.ratingBad : t.ratingNeutral}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photos attachment helper inside Manual Entry */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t.addPhotosDragReorder}</label>
                <div className="flex flex-wrap gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/50 dark:border-slate-800">
                  {manualLog.imageUrls && manualLog.imageUrls.map((img, idx) => (
                    <div
                      key={idx}
                      draggable={true}
                      onDragStart={(e) => handlePhotoDragStart(e, idx)}
                      onDragOver={(e) => handleManualPhotoDragOver(e, idx)}
                      onDragEnd={handlePhotoDragEnd}
                      className={`relative w-14 h-14 rounded-xl overflow-hidden border bg-slate-100 dark:bg-slate-950 transition-all ${
                        draggedPhotoIndex === idx ? 'border-indigo-500 scale-105 opacity-50' : 'border-slate-200 dark:border-slate-850'
                      } cursor-grab active:cursor-grabbing`}
                    >
                      <img src={img} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" referrerPolicy="no-referrer" />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (manualLog.imageUrls || []).filter((_, i) => i !== idx);
                          setManualLog({
                            ...manualLog,
                            imageUrls: updated,
                            imageUrl: updated[0] || undefined
                          });
                        }}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white shadow"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}

                  <label className="w-14 h-14 rounded-xl border border-dashed border-slate-300 dark:border-slate-750 flex flex-col items-center justify-center bg-white dark:bg-slate-850 text-slate-400 hover:text-indigo-500 transition-all cursor-pointer flex-shrink-0">
                    <Plus className="w-4 h-4 mb-0.5" />
                    <span className="text-[8px] font-bold">{t.addPhoto}</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={async (e) => {
                        const inputEl = e.target;
                        const fileList = inputEl.files ? Array.from(inputEl.files) : [];
                        if (fileList.length > 0) {
                          const validFiles = fileList.filter((file: any) => {
                            const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
                            return !isDng;
                          });
                          if (validFiles.length === 0) {
                            inputEl.value = '';
                            return;
                          }

                          setManualCompressing(true);
                          setManualCompressingProgress({ current: 0, total: validFiles.length, percent: 0 });
                          try {
                            const compressed = await compressMultipleImages(validFiles, (progress) => {
                              setManualCompressingProgress({
                                current: progress.currentIndex,
                                total: progress.totalCount,
                                percent: progress.percentage
                              });
                            }, 400, 400, 0.5);
                            const currentUrls = manualLog.imageUrls || [];
                            setManualLog({
                              ...manualLog,
                              imageUrls: [...currentUrls, ...compressed]
                            });
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setManualCompressing(false);
                            inputEl.value = '';
                          }
                        } else {
                          inputEl.value = '';
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {manualCompressing && (
                  <div className="text-[9px] text-indigo-500 font-bold flex items-center gap-1.5 pt-0.5 px-1 animate-pulse">
                    <Loader className="w-3 h-3 animate-spin" />
                    {t.compressingPhoto} {manualCompressingProgress.current}/{manualCompressingProgress.total} ({manualCompressingProgress.percent}%)
                  </div>
                )}
              </div>

              {/* Core 30 Nutrients editing inside Manual Entry */}
              <div className="border border-theme-border rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30">
                <div className="p-3 border-b border-theme-border flex items-center justify-between gap-2 bg-white dark:bg-slate-950">
                  <label className="text-xs font-bold text-theme-text-secondary">{t.scalePortion}</label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400 font-mono">x</span>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={manualMultiplier}
                      onChange={(e) => setManualMultiplier(e.target.value)}
                      className="w-16 text-right px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-theme-border rounded-lg text-xs font-mono font-bold text-theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const m = parseFloat(manualMultiplier);
                        if (isNaN(m) || m <= 0 || m === 1) return;
                        const newNutrients = { ...(manualLog.nutrients || {}) };
                        Object.keys(newNutrients).forEach(k => {
                          newNutrients[k as keyof NutrientBreakdown] = Number(((newNutrients[k as keyof NutrientBreakdown] || 0) * m).toFixed(2));
                        });
                        setManualLog({
                          ...manualLog,
                          weightGrams: Number(((manualLog.weightGrams || 0) * m).toFixed(1)),
                          nutrients: newNutrients as NutrientBreakdown
                        });
                        setManualMultiplier('1');
                      }}
                      className="ml-1 px-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 rounded-lg text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                    >
                      {t.apply}
                    </button>
                  </div>
                </div>
                <div className="p-3 bg-slate-100/50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-850">
                  <span className="text-xs font-bold text-theme-neutral">{t.nutrients31Label}</span>
                </div>
                <div className="p-3 space-y-4 max-h-80 overflow-y-auto">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">{t.coreNutrients11}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      {(() => {
                        const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                        return nutrientDefinitions
                          .filter(nut => coreKeys.includes(nut.key))
                          .map((nut) => {
                            const val = manualLog.nutrients?.[nut.key] || 0;
                            return (
                              <div key={nut.key} className="flex items-center justify-between gap-1 py-0.5">
                                <span className="text-slate-500 font-medium truncate max-w-[95px]" title={nut.labels[profile.language] || nut.labels.en}>
                                  {nut.labels[profile.language] || nut.labels.en}
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="0"
                                    value={val === 0 ? '' : val}
                                    onChange={(e) => {
                                      const updatedNutrients = {
                                        ...(manualLog.nutrients || {}),
                                        [nut.key]: Number(e.target.value) || 0
                                      };
                                      setManualLog({ ...manualLog, nutrients: updatedNutrients as NutrientBreakdown });
                                    }}
                                    className="w-14 text-right px-1 bg-white dark:bg-slate-800 border border-theme-border rounded text-xs font-mono font-bold text-slate-950 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  />
                                  <span className="text-[10px] text-slate-400 font-mono w-5">{nut.unit}</span>
                                </div>
                              </div>
                            );
                          });
                      })()}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">{t.additionalNutrients20}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      {(() => {
                        const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                        return nutrientDefinitions
                          .filter(nut => !coreKeys.includes(nut.key))
                          .map((nut) => {
                            const val = manualLog.nutrients?.[nut.key] || 0;
                            return (
                              <div key={nut.key} className="flex items-center justify-between gap-1 py-0.5">
                                <span className="text-slate-500 font-medium truncate max-w-[95px]" title={nut.labels[profile.language] || nut.labels.en}>
                                  {nut.labels[profile.language] || nut.labels.en}
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="0"
                                    value={val === 0 ? '' : val}
                                    onChange={(e) => {
                                      const updatedNutrients = {
                                        ...(manualLog.nutrients || {}),
                                        [nut.key]: Number(e.target.value) || 0
                                      };
                                      setManualLog({ ...manualLog, nutrients: updatedNutrients as NutrientBreakdown });
                                    }}
                                    className="w-14 text-right px-1 bg-white dark:bg-slate-800 border border-theme-border rounded text-xs font-mono font-bold text-slate-950 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  />
                                  <span className="text-[10px] text-slate-400 font-mono w-5">{nut.unit}</span>
                                </div>
                              </div>
                            );
                          });
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-theme-border flex justify-end gap-2 bg-slate-50 dark:bg-slate-900/40">
              <button
                type="button"
                onClick={() => setIsManualEntryOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-150 rounded-xl transition-all"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={handleSaveManualLog}
                className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all cursor-pointer"
              >
                {t.logFoodManually}
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredLogs.length === 0 ? (
        <div id="food-history-empty" className="bg-theme-bg-card border border-theme-border/80 rounded-3xl p-8 text-center shadow-sm mx-4">
          <ImageIcon className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-xs text-theme-text-secondary leading-relaxed font-medium">
            {t.emptyHistory}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((item) => {
            if (item.type === 'job') {
              const job = item.data;
              return (
                <TaskPlaceholderCard
                  key={`job_${job.id}`}
                  job={job}
                  onView={(id) => {
                    if (onViewJob) onViewJob(id);
                  }}
                  onDelete={async (id) => {
                    await JobStore.deleteJob(id);
                  }}
                  onCancel={(id) => {
                    const j = JobStore.getJob(id);
                    if (j) {
                      if (j.status === 'queued') {
                        JobStore.updateJob(id, { status: 'cancelled' });
                      } else if (j.status === 'running') {
                        j.abortController?.abort();
                        JobStore.updateJob(id, { status: 'cancelled' });
                      }
                    }
                  }}
                  onSave={(foodLog) => {
                    if (onLogFood) {
                      onLogFood(foodLog);
                      JobStore.deleteJob(job.id);
                    }
                  }}
                  profileLanguage={profile.language}
                />
              );
            }

            const log = item.data;
            const isExpanded = expandedLogId === log.id;
            const isEditing = editingLogId === log.id;
            // Merge lazy-fetched detail overrides with the (possibly lightweight) log object
            const overrides = detailOverrides[log.id];
            const effectiveComposition = overrides?.composition || log.composition;
            const effectiveScoutItems = (overrides?.scoutItems && overrides.scoutItems.length > 0) ? overrides.scoutItems : (log.scoutItems || (log as any).scoutSnapshot || (Array.isArray(log.itemsBreakdown) && log.itemsBreakdown.length > 0 ? log.itemsBreakdown : (Array.isArray((log as any).items) ? (log as any).items : [])));
            const effectiveItemsBreakdown = (overrides?.itemsBreakdown && overrides.itemsBreakdown.length > 0) ? overrides.itemsBreakdown : log.itemsBreakdown;
            const resolvedImgs = resolveFoodImages(log.imageUrls, activeFoodLogs, log);
            const resolvedImg =
              resolvedImgs[0] ||
              resolveFoodImage(log.imageUrl, activeFoodLogs, log) ||
              resolveFoodImage(
                log.imageUrls && log.imageUrls.length > 0 ? log.imageUrls[0] : undefined,
                activeFoodLogs,
                log
              );
            
            return (
              <div
                key={`log_${log.id}`}
                id={`food-log-item-${log.id}`}
                onClick={() => {
                  if (!isEditing && !isExpanded) {
                    setExpandedLogId(log.id);
                  }
                }}
                className={`overflow-hidden transition-all border-b border-theme-border pb-4 mb-4 ${!isEditing && !isExpanded ? 'cursor-pointer' : ''} ${isExpanded ? 'ring-2 ring-indigo-500/40 rounded-2xl bg-indigo-50/10 dark:bg-indigo-950/10' : ''}`}
              >
                {/* Large visual rendering of attached meal images (lazy-loaded in ImageSlider) */}
                {(resolvedImgs.length > 0 || resolvedImg) ? (
                  <div className="w-full h-48 overflow-hidden relative">
                    <ImageSlider
                      images={resolvedImgs}
                      singleImage={resolvedImg}
                      altText={log.name || 'Meal log'}
                      deferUntilVisible
                      language={profile.language}
                    />
                  </div>
                ) : null}

                <div className="pt-4 space-y-3 px-4">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="border-b border-theme-border pb-2">
                        <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold text-left">{t.editingFoodLogDetails}</h4>
                      </div>

                      {/* Basic details */}
                      <div className="space-y-3 text-left">
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">{t.foodName}</label>
                            <input
                              type="text"
                              value={editLogState?.name || ''}
                              onChange={(e) => updateField('name', e.target.value)}
                              className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">{t.dateLogged}</label>
                            <input
                              type="date"
                              value={editLogState?.date ? editLogState.date.substring(0, 10) : ''}
                              onChange={(e) => updateField('date', e.target.value)}
                              className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">{t.weightGramsLabel}</label>
                            <input
                              type="number"
                              value={editLogState?.weightGrams ?? ''}
                              onChange={(e) => updateField('weightGrams', Number(e.target.value) || 0)}
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">{t.servingSizeLabel}</label>
                            <input
                              type="text"
                              value={editLogState?.quantity || ''}
                              onChange={(e) => updateField('quantity', e.target.value)}
                              className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-1">{t.consumedAmountLabel}</label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editLogState?.consumedAmount || ''}
                              onChange={(e) => updateField('consumedAmount', Number(e.target.value) || 0)}
                              className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">{t.compositionIngredientsLabel}</label>
                          <textarea
                            rows={2}
                            value={editLogState?.composition || ''}
                            onChange={(e) => updateField('composition', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                          />
                        </div>

                        {/* Manage Pictures directly inside the Edit Pen */}
                        <div className="space-y-2 mt-3">
                          <label className="text-[10px] font-bold text-slate-400 block">{t.managePicturesDrag}</label>
                          <div className="flex flex-wrap gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/50 dark:border-slate-800">
                            {((editLogState?.imageUrls && editLogState.imageUrls.length > 0) || editLogState?.imageUrl) ? (
                              (editLogState?.imageUrls || (editLogState?.imageUrl ? [editLogState?.imageUrl] : [])).map((img, idx) => {
                                if (!img) return null;
                                return (
                                  <div
                                    key={idx}
                                    draggable={true}
                                    onDragStart={(e) => handlePhotoDragStart(e, idx)}
                                    onDragOver={(e) => handlePhotoDragOver(e, idx)}
                                    onDragEnd={handlePhotoDragEnd}
                                    className={`relative w-16 h-16 rounded-xl overflow-hidden border bg-slate-100 dark:bg-slate-950 transition-all ${
                                      draggedPhotoIndex === idx ? 'border-indigo-500 scale-105 opacity-50' : 'border-slate-200 dark:border-slate-850'
                                    } cursor-grab active:cursor-grabbing`}
                                  >
                                    <img src={resolveFoodImage(img, activeFoodLogs) || img} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" referrerPolicy="no-referrer" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentUrls = editLogState.imageUrls ? [...editLogState.imageUrls] : (editLogState.imageUrl ? [editLogState.imageUrl] : []);
                                        const updatedUrls = currentUrls.filter((_, i) => i !== idx);
                                        setEditLogState({
                                          ...editLogState,
                                          imageUrls: updatedUrls,
                                          imageUrl: updatedUrls[0] || '',
                                          scoutItems: deleteItemsList(editLogState.scoutItems, idx, updatedUrls.length),
                                          itemsBreakdown: deleteItemsList(editLogState.itemsBreakdown, idx, updatedUrls.length),
                                          ...((editLogState as any).items ? { items: deleteItemsList((editLogState as any).items, idx, updatedUrls.length) } : {})
                                        });
                                      }}
                                      className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white transition-colors cursor-pointer shadow-md z-10"
                                      title={t.removePicture}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })
                            ) : null}

                            <label className="w-16 h-16 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500/60 flex flex-col items-center justify-center bg-white dark:bg-slate-850 text-slate-400 hover:text-indigo-500 transition-all cursor-pointer flex-shrink-0">
                              <Plus className="w-4 h-4 mb-0.5" />
                              <span className="text-[8px] font-bold">{t.addPhoto}</span>
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={async (e) => {
                                  const inputEl = e.target;
                                  const fileList = inputEl.files ? Array.from(inputEl.files) : [];
                                  if (fileList.length > 0) {
                                    const validFiles = fileList.filter((file: any) => {
                                      const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
                                      return !isDng;
                                    });
                                    const dngCount = fileList.length - validFiles.length;
                                    if (dngCount > 0) {
                                      alert(t.alertDng);
                                    }
                                    if (validFiles.length === 0) {
                                      inputEl.value = '';
                                      return;
                                    }

                                    setCardCompressingLogId(log.id);
                                    setCardCompressingProgress({ current: 0, total: validFiles.length, percent: 0 });
                                    try {
                                      const compressed = await compressMultipleImages(validFiles, (progress) => {
                                        setCardCompressingProgress({
                                          current: progress.currentIndex,
                                          total: progress.totalCount,
                                          percent: progress.percentage
                                        });
                                      }, 400, 400, 0.5);
                                      const currentUrls = editLogState.imageUrls ? [...editLogState.imageUrls] : (editLogState.imageUrl ? [editLogState.imageUrl] : []);
                                      const updatedUrls = [...currentUrls, ...compressed];
                                      setEditLogState({
                                        ...editLogState,
                                        imageUrls: updatedUrls,
                                        imageUrl: updatedUrls[0] || ''
                                      });
                                    } catch (err) {
                                      console.error("Error compressing images in pen:", err);
                                    } finally {
                                      setCardCompressingLogId(null);
                                      inputEl.value = '';
                                    }
                                  } else {
                                    inputEl.value = '';
                                  }
                                }}
                                className="hidden"
                              />
                            </label>
                          </div>
                          {cardCompressingLogId === log.id && (
                            <div className="text-[9px] text-indigo-500 font-bold flex items-center gap-1.5 pt-0.5 px-1 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block animate-ping"></span>
                              {t.compressingPhoto} {cardCompressingProgress.current}/{cardCompressingProgress.total} ({cardCompressingProgress.percent}%)
                            </div>
                          )}
                        </div>
                      </div>

                      {/* AI Diagnostics */}
                      <div className="space-y-3 bg-indigo-50/20 dark:bg-indigo-950/10 p-3.5 rounded-2xl border border-indigo-100/30 dark:border-indigo-900/10 text-left">
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] font-semibold text-slate-500 block mb-1">{t.recommendationSummaryTag}</label>
                            <input
                              type="text"
                              value={editLogState?.recommendation || ''}
                              onChange={(e) => updateField('recommendation', e.target.value)}
                              placeholder={t.recommendationTagPlaceholder}
                              className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text focus:outline-none focus:ring-1 focus:ring-indigo-500/30 font-semibold"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-1">{t.specificBenefits}</label>
                          <textarea
                            rows={2}
                            value={editLogState?.benefits || ''}
                            onChange={(e) => updateField('benefits', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-1">{t.specificRisksWarnings}</label>
                          <textarea
                            rows={2}
                            value={editLogState?.risks || ''}
                            onChange={(e) => updateField('risks', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-1">{t.healthImpactOverview}</label>
                          <textarea
                            rows={2}
                            value={editLogState?.healthImpact || ''}
                            onChange={(e) => updateField('healthImpact', e.target.value)}
                            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded-xl px-3 py-2 text-theme-text"
                          />
                        </div>
                      </div>

                      {/* Nutrients editable list */}
                      <div className="space-y-2 text-left">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-400 block">{t.editNutrients31}</label>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-mono">{t.scaleX}</span>
                            <input
                              type="number"
                              step="any"
                              min="0.01"
                              value={editMultiplier}
                              onChange={(e) => setEditMultiplier(e.target.value)}
                              className="w-14 text-right px-1 py-0.5 bg-theme-bg-card border border-theme-border rounded text-xs font-mono font-bold text-theme-text focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const m = parseFloat(editMultiplier);
                                if (isNaN(m) || m <= 0 || m === 1 || !editLogState) return;
                                const currentRatio = editLogState.portionRatio || 1.0;
                                const newRatio = Math.round(currentRatio * m * 100) / 100;
                                const scaled = scaleMealPortion(editLogState, newRatio);
                                setEditLogState(scaled);
                                setEditMultiplier('1');
                              }}
                              className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 rounded text-[10px] font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                            >
                              {t.apply}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-4 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-800 max-h-80 overflow-y-auto">
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">{t.coreNutrients11}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                              {(() => {
                                const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                                return nutrientDefinitions
                                  .filter(nut => coreKeys.includes(nut.key))
                                  .map((nut) => {
                                    const val = editLogState?.nutrients ? editLogState.nutrients[nut.key] : 0;
                                    return (
                                      <div key={nut.key} className="flex items-center justify-between gap-1 py-0.5">
                                        <span className="text-slate-500 font-medium truncate max-w-[90px]" title={nut.labels[profile.language] || nut.labels.en}>
                                          {nut.labels[profile.language] || nut.labels.en}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            step="any"
                                            value={val === 0 ? '' : val}
                                            onChange={(e) => updateNutrient(nut.key as any, Number(e.target.value) || 0)}
                                            className="w-14 text-right px-1 bg-white dark:bg-slate-800 border border-theme-border rounded text-xs font-mono font-bold text-slate-950 dark:text-slate-100"
                                          />
                                          <span className="text-[10px] text-slate-400 font-mono w-5">{nut.unit}</span>
                                        </div>
                                      </div>
                                    );
                                  });
                              })()}
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">{t.additionalNutrients20}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                              {(() => {
                                const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                                return nutrientDefinitions
                                  .filter(nut => !coreKeys.includes(nut.key))
                                  .map((nut) => {
                                    const val = editLogState?.nutrients ? editLogState.nutrients[nut.key] : 0;
                                    return (
                                      <div key={nut.key} className="flex items-center justify-between gap-1 py-0.5">
                                        <span className="text-slate-500 font-medium truncate max-w-[90px]" title={nut.labels[profile.language] || nut.labels.en}>
                                          {nut.labels[profile.language] || nut.labels.en}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            step="any"
                                            value={val === 0 ? '' : val}
                                            onChange={(e) => updateNutrient(nut.key as any, Number(e.target.value) || 0)}
                                            className="w-14 text-right px-1 bg-white dark:bg-slate-800 border border-theme-border rounded text-xs font-mono font-bold text-slate-950 dark:text-slate-100"
                                          />
                                          <span className="text-[10px] text-slate-400 font-mono w-5">{nut.unit}</span>
                                        </div>
                                      </div>
                                    );
                                  });
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Sticky floating actions on the bottom right of the screen */}
                      <div className="fixed bottom-24 right-5 z-50 flex flex-row gap-3 items-center">
                        {/* Cancel/Cross Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLogId(null);
                            setEditLogState(null);
                          }}
                          className="w-14 h-14 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-slate-500/10 cursor-pointer"
                          title={t.cancelEditing}
                        >
                          <X className="w-6 h-6 stroke-[2.5px]" />
                        </button>
                        
                        {/* Save/Tick Button */}
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          className="w-full sm:w-14 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/20 cursor-pointer"
                          title={t.saveAllChanges}
                        >
                          <Check className="w-6 h-6 stroke-[2.5px]" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start">
                        <div className="min-w-0 flex-1 text-left">
                          <h3 className="font-bold text-theme-text text-sm truncate">
                            {log.name}
                          </h3>
                          
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {formatLogDate(log.date)}
                            </span>
                            {(() => {
                              const vLabel = log.verdict?.label || (log.recommendation && log.recommendation !== 'neutral' ? log.recommendation : null);
                              if (!vLabel) return null;
                              return (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize tracking-wide ${getRecommendationColorClass(vLabel, log.verdict?.level || (typeof log.recommendation === 'string' ? log.recommendation : undefined))}`}>
                                  {vLabel}
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(log);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                            title={t.editFoodLog}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteFoodLog(log.id);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                            title={t.deleteEntry}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* AI Diagnostic Summary */}
                      {(() => {
                        const summaryText = log.message || log.description || (log.healthImpact && !log.healthImpact.includes("Contributes to daily macro") ? log.healthImpact : null) || effectiveComposition || log.composition;
                        if (!summaryText) return null;
                        return (
                          <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium text-left my-1 w-full">
                            <p>{summaryText}</p>
                          </div>
                        );
                      })()}
                      

                      {/* Calories Badge & Top Targets & Expand Indicator */}
                      <div className="flex flex-wrap items-center justify-between pt-1 gap-2">
                        <NutrientTargetRow
                          nutrients={log.nutrients}
                          report={report}
                          profile={profile}
                          activeFoodLogs={activeFoodLogs}
                          logDate={log.date}
                          logId={log.id}
                        />

                        {/* Reduce link shown below top nutrients when card is expanded */}
                        {isExpanded && (
                          <div className="pt-2 text-left">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedLogId(null);
                              }}
                              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline cursor-pointer inline-flex items-center gap-1"
                            >
                              <span>{t.reduce}</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Detailed 30 Nutrients Panel & AI Diagnostics */}
                      {isExpanded && (
                        <div className="space-y-4 pt-3 border-t border-theme-border/60 animation-slide-down">
                          {/* Weight & Portion Details inside Show-Hide */}
                          <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-left">
                            <span className="text-theme-text-secondary font-medium">{t.weightColon}</span>
                            <span className="font-semibold text-slate-850 dark:text-slate-200">{log.weightGrams}g</span>
                            {log.quantity && (
                              <>
                                <span className="text-slate-300 dark:text-slate-700">|</span>
                                <span className="text-theme-text-secondary font-medium">{t.servingSizeColon}</span>
                                <span className="font-semibold text-slate-850 dark:text-slate-200">{log.quantity}</span>
                              </>
                            )}
                            {log.consumedAmount && log.consumedAmount !== 1 && (
                              <>
                                <span className="text-slate-300 dark:text-slate-700">|</span>
                                <span className="text-theme-text-secondary font-medium">{t.consumedColon}</span>
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{log.consumedAmount}x</span>
                              </>
                            )}
                          </div>

                          {/* Interactive Meal Composition Gallery & Breakdown */}
                          {(() => {
                            const scoutItemsList = (Array.isArray(effectiveScoutItems) && effectiveScoutItems.length > 0)
                              ? effectiveScoutItems.map((item: any) => ({
                                  ...item,
                                  keyword: item.keyword || item.canonicalDbName || item.name || item.originalName,
                                  originalName: item.originalName || item.scoutOriginalName || item.name || item.keyword,
                                  boundingBox2D: item.boundingBox2D,
                                  sourceImageIndex: item.sourceImageIndex ?? 0,
                                  itemConfidence: item.itemConfidence || item.confidenceRating || 'High',
                                  weightGrams: item.weightGrams || item.weight,
                                  nutrients: item.nutrients || item,
                                  nutritionFacts: item.nutritionFacts || item.rawNutritionLabel || item.nutrients || item,
                                  visualIngredients: item.visualIngredients,
                                  components: item.components
                                }))
                              : (Array.isArray(effectiveItemsBreakdown) && effectiveItemsBreakdown.length > 0)
                                ? effectiveItemsBreakdown.map((item: any) => ({
                                    ...item,
                                    keyword: item.keyword || item.canonicalDbName || item.name || item.originalName,
                                    originalName: item.scoutOriginalName || item.originalName || item.name || item.keyword,
                                    boundingBox2D: item.boundingBox2D,
                                    sourceImageIndex: item.sourceImageIndex ?? 0,
                                    itemConfidence: item.itemConfidence || 'High',
                                    weightGrams: item.weightGrams || item.weight,
                                    nutrients: item.nutrients || item,
                                    nutritionFacts: item.nutritionFacts || item.rawNutritionLabel || item.nutrients || item,
                                    visualIngredients: item.visualIngredients,
                                    components: item.components
                                  }))
                                : [];

                            if (scoutItemsList.length === 0 && !effectiveComposition) return null;

                            return (
                              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-left space-y-2.5 border border-slate-200/50 dark:border-slate-800/50">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10.5px] font-bold text-indigo-500 dark:text-indigo-400 flex items-center gap-1">
                                    🔍 {t.mealComposition} {scoutItemsList.length > 0 ? `(${scoutItemsList.length})` : ''}
                                  </span>
                                </div>

                                {scoutItemsList.length > 0 && (
                                  <div className="flex overflow-x-auto flex-nowrap sm:flex-wrap items-start justify-start gap-3 pt-1 pb-2 w-full font-sans scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                                    {scoutItemsList.map((item: any, i: number) => {
                                      const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
                                      const resolvedImgSrc = resolveHistoricalImgSrc(item, resolvedImgs, activeFoodLogs, undefined) || (resolvedImgs.length > 0
                                        ? (resolvedImgs[rawIdx] || resolvedImgs[0])
                                        : (resolvedImg || getFoodImageUrl(item.keyword || item.originalName)));
                                      const hasBbox = isValidBoundingBox(item.boundingBox2D);
                                      const isSelectedLabel = openLabelLogMap[log.id] === i;

                                      return (
                                        <div key={i} className="flex flex-col items-center gap-1 shrink-0 relative group w-[95px] sm:w-[110px]">
                                          <div className="relative w-full">
                                            <div 
                                              className="w-full aspect-square rounded-xl overflow-hidden cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-sm bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50"
                                              onClick={() => setZoomState({
                                                src: resolvedImgSrc,
                                                boundingBox: hasBbox ? item.boundingBox2D : null,
                                                foodName: item.originalName || item.keyword,
                                                items: scoutItemsList,
                                                currentIdx: i,
                                                resolvedImgs: resolvedImgs
                                              })}
                                              title={t.clickToZoom}
                                            >
                                              {hasBbox ? (
                                                <CroppedFoodImage
                                                  src={resolvedImgSrc}
                                                  boundingBox={item.boundingBox2D}
                                                  alt={item.keyword || item.originalName}
                                                  className="w-full h-full object-cover"
                                                  imageUrls={resolvedImgs}
                                                  sourceImageIndex={rawIdx}
                                                />
                                              ) : (
                                                <img
                                                  src={resolvedImgSrc}
                                                  alt={item.keyword || item.originalName}
                                                  className="w-full h-full object-cover"
                                                  onError={(e) => {
                                                    const t = e.target as HTMLImageElement;
                                                    if (!t.src.includes('unsplash.com')) t.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&q=80&auto=format';
                                                  }}
                                                />
                                              )}
                                            </div>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={() => setOpenLabelLogMap(prev => ({
                                              ...prev,
                                              [log.id]: prev[log.id] === i ? null : i
                                            }))}
                                            className="text-[10px] text-center font-semibold leading-tight text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer break-words line-clamp-2 w-full font-sans inline-flex items-center justify-center gap-0.5 mt-1"
                                          >
                                            <span>{item.originalName || item.keyword}</span>
                                            <ChevronDown className={`w-3 h-3 transition-transform shrink-0 text-slate-400 ${isSelectedLabel ? 'rotate-180' : ''}`} />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Per-dish nutrient breakdown dropdown */}
                                {openLabelLogMap[log.id] !== undefined && openLabelLogMap[log.id] !== null && scoutItemsList[openLabelLogMap[log.id]!] && (
                                  <div className="mt-2 w-full pt-2 border-t border-slate-200/60 dark:border-slate-800">
                                    <NutritionLabelTable
                                      defaultOpen={true}
                                      hideOwnToggle={true}
                                      activeScoutItems={[{
                                        ...scoutItemsList[openLabelLogMap[log.id]!],
                                        nutritionFacts: scoutItemsList[openLabelLogMap[log.id]!].nutritionFacts || scoutItemsList[openLabelLogMap[log.id]!].nutrients
                                      }]}
                                    />
                                  </div>
                                )}

                                {effectiveComposition && (
                                  <div className={scoutItemsList.length > 0 ? "pt-2 border-t border-slate-200/50 dark:border-slate-800/50" : ""}>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">{t.compositionAndIngredients}</span>
                                    <p className="text-xs text-slate-750 dark:text-slate-300 font-semibold leading-relaxed">{effectiveComposition}</p>
                                  </div>
                                )}

                                {/* Portion controls now handled inside item tab views */}
                              </div>
                            );
                          })()}

                          <div className="space-y-4 py-2 bg-slate-50 dark:bg-slate-900/40 rounded-2xl px-3.5">
                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">{t.coreNutrients11}</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                                {(() => {
                                  const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                                  return nutrientDefinitions
                                    .filter(nut => coreKeys.includes(nut.key))
                                    .map((nut) => {
                                      const val = log.nutrients ? log.nutrients[nut.key] : undefined;
                                      return (
                                        <div key={nut.key} className="flex justify-between py-1 border-b border-theme-border/20 text-left">
                                          <span className="text-slate-400 font-medium truncate max-w-[120px]">
                                            {nut.labels[profile.language] || nut.labels.en}
                                          </span>
                                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                                            {val !== undefined && val !== null ? formatNutrientDisplayValue(val, nut.unit) : '--'}
                                          </span>
                                        </div>
                                      );
                                    });
                                })()}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">{t.additionalNutrients20}</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                                {(() => {
                                  const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                                  return nutrientDefinitions
                                    .filter(nut => !coreKeys.includes(nut.key))
                                    .map((nut) => {
                                      const val = log.nutrients ? log.nutrients[nut.key] : undefined;
                                      return (
                                        <div key={nut.key} className="flex justify-between py-1 border-b border-theme-border/20 text-left">
                                          <span className="text-slate-400 font-medium truncate max-w-[120px]">
                                            {nut.labels[profile.language] || nut.labels.en}
                                          </span>
                                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                                            {val !== undefined && val !== null ? formatNutrientDisplayValue(val, nut.unit) : '--'}
                                          </span>
                                        </div>
                                      );
                                    });
                                })()}
                              </div>
                            </div>
                          </div>

                          {/* Component Contribution & Nutrition Label Tables */}
                          {((effectiveScoutItems && effectiveScoutItems.length > 0) || (effectiveItemsBreakdown && effectiveItemsBreakdown.length > 0)) && (
                            <div className="space-y-4 pt-4 border-t border-slate-200/50 dark:border-slate-800/50">
                              {effectiveScoutItems && effectiveScoutItems.length > 0 && (
                                <div className="space-y-2 text-left">
                                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold block mb-1">
                                    📋 {t.nutritionLabelsAndReference}
                                  </span>
                                  <NutritionLabelTable activeScoutItems={effectiveScoutItems.map((item: any) => ({
                                    ...item,
                                    // HISTORY NUTRITIONFACTS BRIDGE (Aug 2026): NutritionLabelTable's row
                                    // list only reads item.rawNutritionLabel / item.nutritionFacts, but
                                    // saved log items only carry the computed set under item.nutrients.
                                    // Mirrors the same bridge FoodCard.tsx's displayedScoutItems applies
                                    // for the live chat view, so History shows the full computed table
                                    // instead of an empty/truncated one.
                                    nutritionFacts: item.nutritionFacts || item.nutrients,
                                  }))} />
                                </div>
                              )}

                              {Array.isArray(effectiveItemsBreakdown) && effectiveItemsBreakdown.length > 0 && (
                                <div className="border border-theme-border/80 rounded-xl overflow-hidden bg-theme-bg-card shadow-sm">
                                  <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border-b border-theme-border">
                                    <span className="text-[10px] font-bold text-theme-text-secondary uppercase tracking-wider">
                                      📊 {t.componentContribution}
                                    </span>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-[11px]">
                                      <thead>
                                        <tr className="border-b border-theme-border bg-slate-50 dark:bg-slate-800/30 text-theme-text-secondary font-bold">
                                          <th className="p-2">{t.itemName}</th>
                                          <th className="p-2 text-right">{t.weightLabel}</th>
                                          <th className="p-2 text-right">{t.caloriesLabel}</th>
                                          <th className="p-2 text-right">{t.satFatLabel}</th>
                                          <th className="p-2 text-right">{t.sodiumLabel}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {effectiveItemsBreakdown.map((item: any, itemIdx: number) => {
                                          const formatNutVal = (v: any, unit: string) => {
                                            if (v === undefined || v === null) return '--';
                                            const num = typeof v === 'string' ? parseFloat(v.replace(/[^\d.]/g, '')) : v;
                                            if (isNaN(num)) return v;
                                            return `${num.toFixed(1).replace(/\.0$/, '')}${unit}`;
                                          };
                                          return (
                                            <tr 
                                              key={itemIdx} 
                                              className="border-b last:border-b-0 border-theme-border text-slate-750 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-800/20"
                                            >
                                              <td className="p-2 font-semibold text-xs leading-normal whitespace-normal break-words max-w-[180px]" title={item.name}>
                                                <div>{item.name}</div>
                                                <div className="mt-1">
                                                  <PhysicalFormBadge item={item} />
                                                </div>
                                              </td>
                                              <td className="p-2 text-right font-mono text-slate-500">
                                                {formatNutVal(item.weightGrams, 'g')}
                                              </td>
                                              <td className="p-2 text-right font-mono text-orange-600 dark:text-orange-400 font-semibold">
                                                {formatNutVal(item.calories, 'kcal')}
                                              </td>
                                              <td className="p-2 text-right font-mono text-amber-500 font-semibold">
                                                {formatNutVal(item.saturatedFat, 'g')}
                                              </td>
                                              <td className="p-2 text-right font-mono text-slate-600 dark:text-slate-400 font-semibold">
                                                {formatNutVal(item.sodium, 'mg')}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Debug Log Download (Inside Expanded Log) */}
                          {(log.debugUrl || (log as any).backendLogs || (log as any).jobId) && (() => {
                            const retention = retentionStatusMap.get(log.id);
                            const isAvailable = retention ? retention.kept : true;
                            const isBugProtected = Boolean(retention?.isBugProtected);
                            const isLast10 = Boolean(retention?.isLast10);
                            const rank = retention?.rank;

                            return (
                              <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.aiDiagnosticLog}</span>
                                  {isAvailable && isBugProtected && !isLast10 && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60" title="Kept beyond 10 meals because it is linked in Bug Tracker">
                                      {t.bugTrackerHold}
                                    </span>
                                  )}
                                  {isAvailable && isLast10 && typeof rank === 'number' && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60" title="Retained as one of the 10 most recent meals">
                                      {t.recentLabel} {rank}/10
                                    </span>
                                  )}
                                </div>
                                {isAvailable ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadDebugLog(log)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200/60 dark:border-indigo-800/60 transition-colors cursor-pointer"
                                    title="Download complete diagnostic report (.md)"
                                  >
                                    <Download className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>{t.downloadDebugLog}</span>
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                                    {t.logPruned}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {/* Pagination Controls */}
          {filteredLogs.length > itemsPerPage && (
            <div className="flex items-center justify-between pt-6 pb-4 px-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-800 dark:text-slate-300 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {t.previousPage}
              </button>
              <span className="text-sm font-medium text-theme-text-secondary">
                {t.page} {currentPage} {t.of} {Math.ceil(filteredLogs.length / itemsPerPage)}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredLogs.length / itemsPerPage), p + 1))}
                disabled={currentPage === Math.ceil(filteredLogs.length / itemsPerPage)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-800 dark:text-slate-300 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {t.nextPage}
              </button>
            </div>
          )}
        </div>
      )}

      {zoomState && (
        <ZoomableImage
          src={zoomState.src}
          boundingBox={zoomState.boundingBox}
          foodName={zoomState.foodName}
          language={profile.language}
          onClose={() => setZoomState(null)}
          hasNext={zoomState.currentIdx < zoomState.items.length - 1}
          hasPrev={zoomState.currentIdx > 0}
          onNext={() => {
            const nextIdx = zoomState.currentIdx + 1;
            const item = zoomState.items[nextIdx];
            const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
            const imgSrc = resolveHistoricalImgSrc(item, zoomState.resolvedImgs, activeFoodLogs, undefined) || ((zoomState.resolvedImgs.length > 0)
              ? (zoomState.resolvedImgs[rawIdx] || zoomState.resolvedImgs[0])
              : getFoodImageUrl(item.keyword || item.originalName));
            setZoomState({
              ...zoomState,
              currentIdx: nextIdx,
              src: imgSrc,
              boundingBox: isValidBoundingBox(item.boundingBox2D) ? item.boundingBox2D : null,
              foodName: item.originalName || item.keyword
            });
          }}
          onPrev={() => {
            const prevIdx = zoomState.currentIdx - 1;
            const item = zoomState.items[prevIdx];
            const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
            const imgSrc = resolveHistoricalImgSrc(item, zoomState.resolvedImgs, activeFoodLogs, undefined) || ((zoomState.resolvedImgs.length > 0)
              ? (zoomState.resolvedImgs[rawIdx] || zoomState.resolvedImgs[0])
              : getFoodImageUrl(item.keyword || item.originalName));
            setZoomState({
              ...zoomState,
              currentIdx: prevIdx,
              src: imgSrc,
              boundingBox: isValidBoundingBox(item.boundingBox2D) ? item.boundingBox2D : null,
              foodName: item.originalName || item.keyword
            });
          }}
        />
      )}
    </div>
  );
}
