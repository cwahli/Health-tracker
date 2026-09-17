import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Loader2, Trash2, XCircle, CheckCircle2, AlertTriangle, Eye, Save, RotateCcw, Sliders, HelpCircle } from 'lucide-react';
import { AgentJob, JobStatus } from '../jobs/types';
import { ImageStore } from '../jobs/ImageStore';
import { JobStore } from '../jobs/JobStore';
import { previewStatus, previewStatusLabel, isEditJob, isTurnInFlight } from '../jobs/jobPreview';
import { useJob } from '../hooks/useJob';
import { JobQueueRunner } from '../jobs/JobQueueRunner';
import { FoodLog } from '../types';
import { humanizeJobFailure } from '../utils/jobFailure';
import { isJobSafeToLeave } from '../jobs/jobUploadState';
import { toPendingFoodLog } from '../mealBuild/adapters';
import { translations } from '../utils/translations';
import { normalizeMealImageUrl, nextPhotoFallbackUrl, isUsableImageUrl, uniqueMealImageUrls } from '../utils/foodImageSources';

function hasDegradedDietStage(job: AgentJob): boolean {
  const stages = job?.result?.degradedStages;
  if (!Array.isArray(stages)) return false;
  return stages.includes('diet') || stages.includes('dietitian');
}

interface TaskPlaceholderCardProps {
  job: AgentJob;
  onView: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onSave: (foodLog: FoodLog) => void;
  profileLanguage?: string;
}

export default function TaskPlaceholderCard({
  job: jobProp,
  onView,
  onDelete,
  onCancel,
  onSave,
  profileLanguage = 'en'
}: TaskPlaceholderCardProps) {
  const t = translations[profileLanguage || 'en'] || translations.en;
  const live = useJob(jobProp.id).job;
  const job = live || jobProp;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const triedUrlsRef = useRef<Set<string>>(new Set());
  const candidateUrlsRef = useRef<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  // Tick once per second while this job is actively in-flight, so the
  // "elapsed" readout below stays live. Cleared automatically once the job
  // leaves an active state (effect re-runs and the old interval is cleared).
  useEffect(() => {
    const isActive = isTurnInFlight(job);
    if (!isActive) return;
    const interval = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [job.status, job.inFlightTurnAt, job.finishedAt]);

  const startTs = job.inFlightTurnAt ?? (job.createdAt ? new Date(job.createdAt).getTime() : null);
  const elapsedSeconds = startTs ? Math.max(0, Math.floor((nowTs - startTs) / 1000)) : null;
  const elapsedLabel = elapsedSeconds !== null
    ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
    : null;
  const elapsedIsLong = (elapsedSeconds ?? 0) >= 180; // 3 minutes

  const handleLocalSave = async () => {
    if (!pendingFoodLog || isSaving) return;
    setIsSaving(true);
    
    // Create a deep copy of pendingFoodLog to avoid mutating state directly
    const logToSave = JSON.parse(JSON.stringify(pendingFoodLog));
    if (job?.id && !logToSave.jobId) {
      logToSave.jobId = job.id;
    }
    const resolvedDebugUrl = job.result?.debugUrl || (job as any).debugUrl || job.result?.clean_result?.debugUrl;
    if (resolvedDebugUrl && !logToSave.debugUrl) {
      logToSave.debugUrl = resolvedDebugUrl;
    }
    const resolvedBackendLogs = job.result?.backendLogs || (job as any).backendLogs || job.result?.clean_result?.backendLogs;
    if (resolvedBackendLogs && !logToSave.backendLogs) {
      logToSave.backendLogs = resolvedBackendLogs;
    }
    
    try {
      let finalImageUrl = '';
      let finalImageUrls: string[] = [];

      // 1. Try fetching and converting raw images from ImageStore
      const images = await ImageStore.getImages(job.id);
      if (images && images.length > 0) {
        const dataUrls = await Promise.all(
          images.map(async (img) => {
            if (typeof img === 'string') {
              if (img.startsWith('data:image/') || img.startsWith('http') || img.startsWith('/photos/') || img.startsWith('/api/r2/photos/')) {
                return normalizeMealImageUrl(img) || img;
              }
              if (img.startsWith('blob:')) {
                try {
                  const res = await fetch(img);
                  const b = await res.blob();
                  return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(b);
                  });
                } catch {
                  // Fall through
                }
              }
              return img;
            }
            if (img && typeof img === 'object') {
              const imgAny = img as any;
              const blob = imgAny instanceof Blob ? imgAny : new Blob([imgAny], { type: imgAny.type || 'image/jpeg' });
              return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            }
            return '';
          })
        );
        
        const validUrls = dataUrls.filter(url => url && (url.startsWith('data:image/') || url.startsWith('http') || url.startsWith('/photos/') || url.startsWith('/api/r2/photos/')));
        if (validUrls.length > 0) {
          finalImageUrl = validUrls[0];
          finalImageUrls = validUrls;
        }
      }

      // 2. FALLBACK: If ImageStore didn't yield a valid URL, use candidate URLs or imageUrl or remote photos
      const fallbackCandidates = [
        imageUrl,
        ...candidateUrlsRef.current,
        (job as any).photoUrl,
        job.result?.photoUrl,
        job.result?.clean_result?.photoUrl,
        (job.result as any)?.data?.photoUrl,
        (job as any).clean_result?.photoUrl,
        (job as any).photo_url
      ].filter(Boolean) as string[];

      for (const cand of fallbackCandidates) {
        if (!cand) continue;
        if (cand.startsWith('data:image/') || cand.startsWith('http') || cand.startsWith('/photos/') || cand.startsWith('/api/r2/photos/')) {
          const norm = normalizeMealImageUrl(cand) || cand;
          if (!finalImageUrl) finalImageUrl = norm;
          if (!finalImageUrls.includes(norm)) finalImageUrls.push(norm);
        } else if (cand.startsWith('blob:')) {
          try {
            const res = await fetch(cand);
            const b = await res.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(b);
            });
            if (dataUrl) {
              if (!finalImageUrl) finalImageUrl = dataUrl;
              if (!finalImageUrls.includes(dataUrl)) finalImageUrls.push(dataUrl);
            }
          } catch (e) {
            console.warn('[TaskPlaceholderCard] Failed to convert blob to base64:', e);
          }
        }
      }

      const remotePhotos = 
        job.result?.clean_result?.pendingFoodLog?.imageUrls ||
        job.result?.clean_result?.imageUrls ||
        job.result?.imageUrls ||
        [];

      if (remotePhotos.length > 0) {
        // Sanitize (never `|| r`): dead entries (empty strings, revoked blob:,
        // placeholder tokens) must not be persisted — they later dedupe to
        // zero and orphan the hero slider on reload, especially offline.
        const normRemotes = uniqueMealImageUrls(remotePhotos);
        if (finalImageUrls.length === 0) finalImageUrls = normRemotes;
        if (!finalImageUrl) finalImageUrl = normRemotes[0] || '';
      }

      // Final sanitize before persist: drop dead entries, prefer durable
      // /photos|https over ephemeral data:/blob: duplicates of the same
      // capture. data: URLs are the durable-offline form and are kept when
      // no durable copy exists yet (R2 upload happens on sync).
      if (finalImageUrl) finalImageUrls = [finalImageUrl, ...finalImageUrls];
      finalImageUrls = uniqueMealImageUrls(finalImageUrls);
      finalImageUrl = finalImageUrls[0] || '';

      // Apply the resolved image URL(s) if found
      if (finalImageUrl) {
        logToSave.imageUrl = finalImageUrl;
        logToSave.imageUrls = finalImageUrls.length > 0 ? finalImageUrls : [finalImageUrl];
      }
    } catch (e) {
      console.warn('[TaskPlaceholderCard] Failed to convert ImageStore images to base64 for saving:', e);
    } finally {
      onSave(logToSave);
      setIsSaving(false);
    }
  };

  // Load image preview: check ImageStore first for raw bytes, then fallback to photoUrl / pendingFoodLog / messages / inputSnapshot
  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];

    const loadPreview = async () => {
      try {
        const rawCandidates: (string | Blob)[] = [];

        // 1. Check ImageStore first for raw bytes / staged blobs
        try {
          const images = await ImageStore.getImages(job.id);
          if (images && images.length > 0) {
            rawCandidates.push(...images);
          }
        } catch {
          // ignore
        }

        // 2. Check inputSnapshot imageRefs (might be image keys or IDs or data URLs)
        if (job.inputSnapshot?.imageRefs && Array.isArray(job.inputSnapshot.imageRefs)) {
          for (const ref of job.inputSnapshot.imageRefs) {
            if (ref) {
              if (typeof ref === 'string' && (ref.startsWith('data:image/') || ref.startsWith('http') || ref.startsWith('/photos/') || ref.startsWith('/api/r2/photos/'))) {
                rawCandidates.push(ref);
              } else if (typeof ref === 'string') {
                try {
                  const refImgs = await ImageStore.getImages(ref);
                  if (refImgs && refImgs.length > 0) {
                    rawCandidates.push(...refImgs);
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        }

        // 3. Check inputSnapshot additional properties
        const inputSnap = job.inputSnapshot as any;
        if (inputSnap?.imageUrl) rawCandidates.push(inputSnap.imageUrl);
        if (Array.isArray(inputSnap?.imageUrls)) rawCandidates.push(...inputSnap.imageUrls);
        if (Array.isArray(inputSnap?.photos)) rawCandidates.push(...inputSnap.photos);
        if (inputSnap?.photoUrl) rawCandidates.push(inputSnap.photoUrl);

        // 4. Check direct job properties & clean_result
        const directPhoto =
          (job as any).photoUrl ||
          (job as any).photo_url ||
          (job as any).imageUrl ||
          job.result?.photoUrl ||
          job.result?.clean_result?.photoUrl ||
          (job.result as any)?.data?.photoUrl ||
          (job as any).clean_result?.photoUrl;
        if (directPhoto) rawCandidates.push(directPhoto);

        const directPhotos =
          (job as any).imageUrls ||
          (job as any).remotePhotos ||
          job.result?.imageUrls ||
          job.result?.clean_result?.imageUrls;
        if (Array.isArray(directPhotos)) rawCandidates.push(...directPhotos);

        // 5. Check pendingFoodLog and mealBuild
        const pendingFoodLog =
          job.result?.pendingFoodLog ||
          job.result?.raw?.data ||
          job.result?.data ||
          job.result?.foodData ||
          job.result?.mealBuild?.content?.pendingFoodLog ||
          job.result?.mealBuild?.content ||
          job.mealBuild?.content?.pendingFoodLog ||
          job.mealBuild?.content ||
          job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
          job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

        if (pendingFoodLog?.imageUrl) rawCandidates.push(pendingFoodLog.imageUrl);
        if (Array.isArray(pendingFoodLog?.imageUrls)) rawCandidates.push(...pendingFoodLog.imageUrls);

        // 6. Check messages
        if (job.messages && Array.isArray(job.messages)) {
          for (let i = job.messages.length - 1; i >= 0; i--) {
            const m = job.messages[i] as any;
            if (!m) continue;
            if (m.imageUrl) rawCandidates.push(m.imageUrl);
            if (Array.isArray(m.imageUrls)) rawCandidates.push(...m.imageUrls);
            if (m.photoUrl) rawCandidates.push(m.photoUrl);
            if (Array.isArray(m.photos)) rawCandidates.push(...m.photos);
            if (Array.isArray(m.attachments)) {
              for (const att of m.attachments) {
                if (typeof att === 'string') rawCandidates.push(att);
                else if (att?.url) rawCandidates.push(att.url);
              }
            }
            if (m.data?.imageUrl) rawCandidates.push(m.data.imageUrl);
            if (Array.isArray(m.data?.imageUrls)) rawCandidates.push(...m.data.imageUrls);
            if (m.data?.pendingFoodLog?.imageUrl) rawCandidates.push(m.data.pendingFoodLog.imageUrl);
            if (Array.isArray(m.data?.pendingFoodLog?.imageUrls)) rawCandidates.push(...m.data.pendingFoodLog.imageUrls);
          }
        }

        // Convert rawCandidates to valid, normalized URLs
        const validCandidates: string[] = [];
        for (const item of rawCandidates) {
          if (!item) continue;
          if (typeof item === 'string') {
            const trimmed = item.trim();
            if (!trimmed || trimmed === '[image_removed_for_snapshot]') continue;
            if (trimmed.startsWith('data:image/') || trimmed.startsWith('blob:')) {
              if (!validCandidates.includes(trimmed)) validCandidates.push(trimmed);
            } else {
              const norm = (normalizeMealImageUrl(trimmed) || trimmed) as string;
              const usable = isUsableImageUrl(norm);
              const isPath = norm.startsWith('/photos/') || norm.startsWith('/api/r2/photos/') || norm.startsWith('http');
              if (usable || isPath) {
                if (!validCandidates.includes(norm)) validCandidates.push(norm);
              }
            }
          } else if (item instanceof Blob || (typeof item === 'object' && ('size' in item || 'type' in item))) {
            try {
              const blob = item instanceof Blob ? item : new Blob([item], { type: (item as any).type || 'image/jpeg' });
              const objectUrl = URL.createObjectURL(blob);
              createdUrls.push(objectUrl);
              validCandidates.push(objectUrl);
            } catch {
              // ignore
            }
          }
        }

        if (!active) return;
        candidateUrlsRef.current = validCandidates;
        triedUrlsRef.current.clear();

        if (validCandidates.length > 0) {
          const first = validCandidates[0];
          triedUrlsRef.current.add(first);
          setImageUrl(first);
        } else {
          setImageUrl(null);
        }
      } catch (err) {
        console.warn('[TaskPlaceholderCard] Failed to load image preview:', err);
      }
    };

    loadPreview();

    return () => {
      active = false;
      for (const u of createdUrls) {
        URL.revokeObjectURL(u);
      }
    };
  }, [
    job.id,
    (job as any).photoUrl,
    (job as any).imageUrl,
    job.result,
    job.inputSnapshot,
    job.messages
  ]);

  const handleImageError = () => {
    if (!imageUrl) return;
    triedUrlsRef.current.add(imageUrl);

    // 1. Try nextPhotoFallbackUrl for proxy / signed R2 routes
    const nextProxyFallback = nextPhotoFallbackUrl(imageUrl, triedUrlsRef.current);
    if (nextProxyFallback) {
      triedUrlsRef.current.add(nextProxyFallback);
      setImageUrl(nextProxyFallback);
      return;
    }

    // 2. Try the next candidate from candidateUrlsRef
    const nextCandidate = candidateUrlsRef.current.find(c => c && !triedUrlsRef.current.has(c));
    if (nextCandidate) {
      triedUrlsRef.current.add(nextCandidate);
      setImageUrl(nextCandidate);
      return;
    }

    // 3. Exhausted all candidates
    setImageUrl(null);
  };

  const lastMsgContent = (job.messages && job.messages.length > 0) ? job.messages[job.messages.length - 1]?.content : '';
  const pendingLog =
    job.result?.pendingFoodLog ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    job.result?.mealBuild?.content ||
    job.mealBuild?.content ||
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

  const hasResults = !!(
    pendingLog?.name ||
    pendingLog?.foodName ||
    (pendingLog?.itemsBreakdown && pendingLog.itemsBreakdown.length > 0) ||
    (job.result?.scoutItems && job.result.scoutItems.length > 0) ||
    (job.mealBuild?.items && job.mealBuild.items.length > 0)
  );

  const turnInFlight = isTurnInFlight(job);
  const effectiveStatus: AgentJob['status'] = previewStatus(job);

  const isActivelyRetryingOrRunning =
    effectiveStatus === 'running' ||
    effectiveStatus === 'processing' ||
    effectiveStatus === 'queued';

  const isFailedOrTimedOut =
    !isActivelyRetryingOrRunning && (
      effectiveStatus === 'failed' ||
      effectiveStatus === 'cancelled' ||
      effectiveStatus === 'cancel_requested' ||
      (effectiveStatus !== 'succeeded' && (
        !!job.error ||
        (typeof job.statusMessage === 'string' && /(?:timed out|analysis failed|server error)/i.test(job.statusMessage) && !/analysis complete/i.test(job.statusMessage)) ||
        (typeof job.result?.message === 'string' && /(?:timed out|analysis failed)/i.test(job.result.message)) ||
        (typeof job.result?.error === 'string' && !!job.result.error) ||
        (typeof lastMsgContent === 'string' && /(?:timed out|analysis failed|server error)/i.test(lastMsgContent) && !job.result?.pendingFoodLog && !job.result?.modificationCommand && !job.result?.extractedData)
      ))
    );

  const isEditMode = isEditJob(job);

  const getStatusLabel = () => {
    const queue = JobStore.getAllJobs().filter(j => j.status === 'queued' || j.status === 'running');
    const myIndex = queue.findIndex(j => j.id === job.id);
    const ahead = myIndex > 0 ? myIndex : 0;
    return previewStatusLabel(job, { queuedAhead: ahead, lastMsgContent, dict: t });
  };

  const getStatusColorClass = () => {
    if (effectiveStatus === 'succeeded' && hasDegradedDietStage(job)) {
      return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700';
    }
    if (isFailedOrTimedOut) {
      return 'text-rose-600 bg-rose-50 dark:bg-rose-950/40';
    }
    const statusKey = effectiveStatus as JobStatus;
    switch (statusKey) {
      case 'queued':
        return 'text-slate-500 bg-slate-100 dark:bg-slate-900/60';
      case 'running':
      case 'processing':
        return 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40';
      case 'failed':
        return 'text-rose-600 bg-rose-50 dark:bg-rose-950/40';
      case 'cancelled':
      case 'cancel_requested':
        return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40';
      case 'awaiting_user':
        return 'text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/60 font-bold border border-purple-300 dark:border-purple-700 animate-pulse';
      case 'succeeded':
        return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40';
      default:
        return 'text-slate-500 bg-slate-100 dark:bg-slate-900/60';
    }
  };

  const pendingFoodLog =
    job.result?.pendingFoodLog ||
    (job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null) ||
    job.result?.clean_result?.pendingFoodLog ||
    (job.result?.clean_result?.mealBuild ? toPendingFoodLog(job.result.clean_result.mealBuild) : null) ||
    job.result?.clean_result?.data ||
    (job.mealBuild ? toPendingFoodLog(job.mealBuild) : null) ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    (job.result?.items ? job.result : null) ||
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog ||
    (job as any).clean_result?.pendingFoodLog ||
    (job as any).clean_result?.data;

  const extractMealName = (): string | null => {
    if (job.result?.clean_result?.foodData?.name && job.result.clean_result.foodData.name !== 'Meal') return job.result.clean_result.foodData.name;
    if (job.result?.foodData?.name && job.result.foodData.name !== 'Meal') return job.result.foodData.name;
    if (job.result?.mealBuild?.content?.name && job.result.mealBuild.content.name !== 'Meal') return job.result.mealBuild.content.name;
    if (job.result?.clean_result?.mealBuild?.content?.name && job.result.clean_result.mealBuild.content.name !== 'Meal') return job.result.clean_result.mealBuild.content.name;
    if (pendingFoodLog?.name && pendingFoodLog.name !== 'Meal') return pendingFoodLog.name;
    if (pendingFoodLog?.title && pendingFoodLog.title !== 'Meal') return pendingFoodLog.title;
    if (pendingFoodLog?.content?.name && pendingFoodLog.content.name !== 'Meal') return pendingFoodLog.content.name;
    if (job.mealBuild?.content?.name && job.mealBuild.content.name !== 'Meal') return job.mealBuild.content.name;
    if (job.result?.data?.name && job.result.data.name !== 'Meal') return job.result.data.name;

    const items =
      job.result?.itemsBreakdown ||
      job.result?.clean_result?.itemsBreakdown ||
      job.result?.foodData?.itemsBreakdown ||
      job.result?.mealBuild?.items ||
      job.result?.clean_result?.mealBuild?.items ||
      pendingFoodLog?.itemsBreakdown ||
      pendingFoodLog?.items ||
      job.result?.items ||
      job.result?.scoutItems ||
      job.result?.clean_result?.scoutItems ||
      job.mealBuild?.items ||
      (job as any).scoutItems ||
      (job as any).clean_result?.scoutItems;

    if (Array.isArray(items) && items.length > 0) {
      const names = items
        .map((it: any) => typeof it === 'string' ? it : (it?.name || it?.originalName || it?.keyword || it?.canonicalDbName))
        .filter(Boolean);
      if (names.length > 0) {
        return names.join(', ');
      }
    }

    const textContent = job.result?.text || job.result?.message || job.result?.clean_result?.text || job.result?.clean_result?.message;
    if (typeof textContent === 'string') {
      const boldMatch = textContent.match(/\*\*([^*]+)\*\*/);
      if (boldMatch && boldMatch[1]) {
        return boldMatch[1].trim();
      }
    }

    return null;
  };

  const detectedName = extractMealName();
  const rawInputText = (job.inputSnapshot?.text?.trim() || '').replace(/^Portion Selection:\s*/i, '');

  const isAwaitingPortion =
    job.status === 'awaiting_user' &&
    !job.result?.portionClarifyAnswered &&
    !job.result?.clean_result?.portionClarifyAnswered &&
    !(job as any).clean_result?.portionClarifyAnswered;

  const displayTitle =
    isAwaitingPortion
      ? (detectedName
          ? (t.portionSelectionNeeded ? t.portionSelectionNeeded.replace('{name}', detectedName) : `${detectedName} — Portion Selection Needed`)
          : job.result?.portionClarify?.promptMessage ||
            job.result?.clean_result?.portionClarify?.promptMessage ||
            (job as any).clean_result?.portionClarify?.promptMessage ||
            (t.portionChoiceNeeded || 'Portion Choice Needed'))
      : (detectedName ||
        (rawInputText && rawInputText !== 'Analyze this meal photo.'
          ? rawInputText
          : job.kind === 'food_compare'
          ? (t.mealComparisonRequest || 'Meal Comparison Request')
          : job.kind === 'medical'
          ? (t.medicalDataRequest || 'Medical Data Request')
          : job.kind === 'front_desk'
          ? (t.healthPreparationChat || 'Health Preparation Chat')
          : job.status === 'succeeded' ? (t.mealAnalysisComplete || 'Meal Analysis Complete') : job.status === 'failed' ? (t.analysisFailed || 'Analysis failed') : (t.analyzingMealPhoto || 'Analyzing Meal Photo...')));

  return (
    <div id={`task-card-${job.id}`} data-testid="task-placeholder-card" className={`bg-theme-bg-card border rounded-3xl py-4 pl-0 pr-4 shadow-sm mx-0 mb-4 w-full transition-all hover:shadow-md overflow-hidden ${
      isAwaitingPortion
        ? 'border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-950/20'
        : 'border-theme-border'
    }`}>
      <div className="flex gap-4">
        {/* Preview Image / Fallback Icon */}
        <div className="w-20 h-20 rounded-r-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 flex-shrink-0 relative flex items-center justify-center border border-theme-border/50 border-l-0">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={t.mealPreview || "Meal Preview"}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={handleImageError}
            />
          ) : (
            <div className="p-2 text-slate-400 font-mono text-[10px] text-center uppercase">
              {t.noImage || 'No Image'}
            </div>
          )}
          {/* Progress / Action Overlay */}
          {(effectiveStatus === 'queued' || effectiveStatus === 'running' || effectiveStatus === 'processing') && (
            <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          )}
          {job.status === 'awaiting_user' && (
            <div className="absolute inset-0 bg-purple-950/40 backdrop-blur-[1px] flex flex-col items-center justify-center p-1 text-center">
              <Sliders className="w-5 h-5 text-purple-200 animate-bounce mb-0.5" />
              <span className="text-[9px] font-bold text-white leading-tight">{t.pickPortion || 'Pick Portion'}</span>
            </div>
          )}
        </div>

        {/* Content details */}
        <div className="flex-grow min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColorClass()}`}>
                {getStatusLabel()}
              </span>
              {!isEditMode && effectiveStatus !== 'succeeded' && effectiveStatus !== 'running' && effectiveStatus !== 'processing' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  {(t.attemptOf || 'Attempt {current} of {max}').replace('{current}', String(job.attemptCount || 1)).replace('{max}', String(job.maxAttempts || 3))}
                </span>
              )}
              {(effectiveStatus === 'running' || effectiveStatus === 'queued' || effectiveStatus === 'processing') && job.progressPercent > 0 && (
                <span className="text-[10px] font-mono text-slate-400 font-bold">
                  {job.progressPercent}%
                </span>
              )}
            </div>

            <h4 className="text-sm font-bold text-theme-text-primary truncate">
              {displayTitle}
            </h4>

            {(effectiveStatus === 'running' || effectiveStatus === 'processing' || effectiveStatus === 'queued') && (
              <div className="mt-1 space-y-1">
                {job.statusMessage && !job.statusMessage.toLowerCase().includes('uploading to server') ? (
                  <p className="text-xs text-theme-text-secondary font-medium">
                    {job.statusMessage}
                  </p>
                ) : !job.statusMessage ? (
                  <p className="text-xs text-theme-text-secondary font-medium">
                    {job.kind === 'medical' ? (t.analyzingMedicalData || 'Analyzing medical data...') : job.kind === 'front_desk' ? (t.chattingEllipsis || 'Chatting...') : (t.analyzingYourMeal || 'Analyzing your meal...')}
                  </p>
                ) : null}
                {isJobSafeToLeave(job) ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                    <span>{t.uploadedSafeToClose || 'Uploaded to server • Safe to close browser & check back later'}</span>
                  </div>
                ) : (
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${elapsedIsLong ? 'text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/40 border-red-200/60 dark:border-red-800/60' : 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-amber-200/60 dark:border-amber-800/60'}`}>
                    <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${elapsedIsLong ? 'text-red-500' : 'text-amber-500'}`} />
                    <span>{t.uploadingKeepTabOpen || 'Uploading to server… Keep this tab open'}</span>
                  </div>
                )}
                {elapsedLabel && (
                  <div className={`text-[10px] font-mono ${elapsedIsLong ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                    {elapsedIsLong
                      ? (t.stuckFor ? t.stuckFor.replace('{time}', elapsedLabel) : `Stuck for ${elapsedLabel} — this is longer than normal`)
                      : (t.elapsedTime ? t.elapsedTime.replace('{time}', elapsedLabel) : `${elapsedLabel} elapsed`)}
                  </div>
                )}
              </div>
            )}
            
            {(effectiveStatus === 'running' || effectiveStatus === 'processing' || effectiveStatus === 'queued') && (
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
                <motion.div
                  className={`h-full rounded-full ${effectiveStatus === 'queued' ? 'bg-indigo-400 animate-pulse' : 'bg-indigo-600'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(job.progressPercent || 0, effectiveStatus === 'queued' ? 10 : 20)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            {job.status === 'awaiting_user' && (
              <p className="text-xs text-purple-700 dark:text-purple-300 font-medium mt-1">
                👉 {t.confirmPortionToFinish || 'Please confirm portion size to finish logging your meal.'}
              </p>
            )}

            {isFailedOrTimedOut && (() => {
              const raw =
                job.error?.message ||
                (job.statusMessage && !['Analyzing on server...', 'Analyzing your meal...'].includes(job.statusMessage) ? job.statusMessage : null) ||
                (typeof job.result?.message === 'string' && job.result.message ? job.result.message : null) ||
                (typeof lastMsgContent === 'string' ? lastMsgContent : '') ||
                '';
              const failureReason = humanizeJobFailure(raw);
              return (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium line-clamp-4">
                    ⚠️ {failureReason}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {(t.attemptFailedTapRetry || 'Attempt {n} of {m} failed • Tap "Retry" to try again')
                      .replace('{n}', String(job.attemptCount || 1))
                      .replace('{m}', String(job.maxAttempts || 3))}
                  </p>
                </div>
              );
            })()}

            {effectiveStatus === 'succeeded' && pendingFoodLog && (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-theme-text-secondary">
                <span>🔥 {pendingFoodLog.nutrients?.calories || 0} kcal</span>
                <span>•</span>
                <span>💪 {(t.proteinGrams || '{n}g protein').replace('{n}', String(pendingFoodLog.nutrients?.protein || 0))}</span>
                {pendingFoodLog.recommendation && (
                  <>
                    <span>•</span>
                    <span className="capitalize font-semibold text-emerald-600 dark:text-emerald-400">
                      {pendingFoodLog.recommendation}
                    </span>
                  </>
                )}
              </div>
            )}

            {(job.result?.mealBuild?.staleDietitianNarrative || (job as any).mealBuild?.staleDietitianNarrative) && (
              <div className="text-amber-700 dark:text-amber-400 text-xs mt-1 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">
                {t.macrosUpdatedRetryAdvice || 'Macros updated — coaching may reflect a previous portion. Use Retry Advice to refresh.'}
              </div>
            )}

            {/* Comparison Options Summary Row with Calories */}
            {(() => {
              const compGroups = job.result?.comparisonSet?.optionMeals || job.result?.comparison?.options || job.result?.comparison?.groups || job.result?.clean_result?.comparison?.groups || (job as any).clean_result?.comparison?.groups;
              const scoutItems =
                job.result?.itemsBreakdown ||
                job.result?.clean_result?.itemsBreakdown ||
                job.result?.foodData?.itemsBreakdown ||
                job.result?.mealBuild?.items ||
                job.result?.clean_result?.mealBuild?.items ||
                pendingFoodLog?.itemsBreakdown ||
                pendingFoodLog?.items ||
                job.result?.items ||
                job.result?.meal?.items ||
                job.result?.scoutItems ||
                job.result?.clean_result?.scoutItems ||
                (job as any).scoutItems;

              if (compGroups && Array.isArray(compGroups) && compGroups.length > 0) {
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {compGroups.map((opt: any, idx: number) => {
                      const defaultOpt = t.optionN ? t.optionN.replace('{n}', String(idx + 1)) : `Option ${idx + 1}`;
                      const name = opt.groupName || opt.content?.name || opt.name || opt.title || defaultOpt;
                      let numericCals = NaN;
                      const directCal = opt.averageNutrients?.calories ?? opt.nutrients?.calories ?? opt.calories ?? opt.totalCalories;
                      if (directCal != null) {
                        const parsed = parseFloat(String(directCal).replace(/[^\d.]/g, ''));
                        if (!isNaN(parsed) && parsed > 0) numericCals = parsed;
                      }
                      if (isNaN(numericCals) && (opt.averageNutrients || opt.nutrients)) {
                        const n = opt.averageNutrients || opt.nutrients;
                        const p = Number(n.protein) || 0;
                        const c = Number(n.carbohydrates ?? n.carbs) || 0;
                        const f = Number(n.totalFat ?? n.fat) || 0;
                        const macroSum = Math.round(4 * p + 4 * c + 9 * f);
                        if (macroSum > 0) numericCals = macroSum;
                      }
                      return (
                        <span key={idx} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-100 dark:border-indigo-900/50 text-[11px] font-semibold flex items-center gap-1">
                          <span>{name}:</span>
                          <span className="font-bold text-indigo-800 dark:text-indigo-200">{!isNaN(numericCals) && numericCals > 0 ? `${Math.round(numericCals)} kcal` : (t.calculating || 'Calculating...')}</span>
                        </span>
                      );
                    })}
                  </div>
                );
              } else if (effectiveStatus === 'succeeded' && scoutItems && Array.isArray(scoutItems) && scoutItems.length > 1) {
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {scoutItems.map((item: any, idx: number) => {
                      const defaultOpt = t.optionN ? t.optionN.replace('{n}', String(idx + 1)) : `Option ${idx + 1}`;
                      const name = item.canonicalDbName || item.originalName || item.name || item.keyword || defaultOpt;
                      let numericCals = NaN;
                      const directCal = item.nutrients?.calories ?? item.calories ?? item.estimatedCalories ?? item.rawNutritionLabel?.calories ?? item.preCalcNutrients?.calories;
                      if (directCal != null) {
                        const parsed = parseFloat(String(directCal).replace(/[^\d.]/g, ''));
                        if (!isNaN(parsed)) numericCals = parsed;
                      }
                      if (isNaN(numericCals) && item.nutrients) {
                        const p = Number(item.nutrients.protein) || 0;
                        const c = Number(item.nutrients.carbohydrates ?? item.nutrients.carbs) || 0;
                        const f = Number(item.nutrients.totalFat ?? item.nutrients.fat) || 0;
                        const macroSum = Math.round(4 * p + 4 * c + 9 * f);
                        if (macroSum >= 0) numericCals = macroSum;
                      }
                      return (
                        <span key={idx} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-100 dark:border-indigo-900/50 text-[11px] font-semibold flex items-center gap-1">
                          <span>{name}:</span>
                          <span className="font-bold text-indigo-800 dark:text-indigo-200">{!isNaN(numericCals) && numericCals >= 0 ? `${Math.round(numericCals)} kcal` : (t.calculating || 'Calculating...')}</span>
                        </span>
                      );
                    })}
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-theme-border/40">
            {/* View / Select Portion Button */}
            {job.status === 'awaiting_user' && !job.result?.portionClarifyAnswered && !job.result?.clean_result?.portionClarifyAnswered ? (
              <button
                type="button"
                onClick={() => onView(job.id)}
                className="px-3.5 py-1.5 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer animate-pulse"
              >
                <Sliders className="w-3.5 h-3.5" />
                {t.selectPortion || 'Select Portion'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onView(job.id)}
                className="px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                {effectiveStatus === 'succeeded' && !isFailedOrTimedOut ? (t.viewAnalysis || 'View Analysis') : (t.viewStatus || 'View Status')}
              </button>
            )}

            {/* Save Log Button for Succeeded Jobs */}
            {effectiveStatus === 'succeeded' && !isFailedOrTimedOut && ((job.status === 'succeeded') || job.result?.savable || job.result?.mealBuild?.savable || job.mealBuild?.savable) && !!pendingFoodLog && (
              <button
                type="button"
                onClick={handleLocalSave}
                disabled={isSaving}
                className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {isSaving ? (t.savingEllipsis || 'Saving...') : (t.saveLog || 'Save Log')}
              </button>
            )}

            {/* Retry Button for Failed, Cancelled, or Timed-out Jobs (or stuck jobs) */}
            {(isFailedOrTimedOut || job.status === 'failed' || job.status === 'cancelled' || job.status === 'cancel_requested' || hasDegradedDietStage(job) || elapsedIsLong) && (!isActivelyRetryingOrRunning || elapsedIsLong) && (
              <button
                type="button"
                onClick={() => {
                  const isDegraded = hasDegradedDietStage(job);
                  const nextAttempt = (job.attemptCount || 1) + 1;
                  JobStore.updateJob(job.id, {
                    status: 'queued',
                    attemptCount: nextAttempt,
                    retryNotBefore: undefined,
                    error: undefined,
                    clientSubmitPending: false,
                    statusMessage: isDegraded
                      ? (t.retryingAiAdvice ? t.retryingAiAdvice.replace('{n}', String(nextAttempt)) : `Retrying AI advice (Attempt ${nextAttempt})...`)
                      : (t.retryingAnalysisAttempt ? t.retryingAnalysisAttempt.replace('{n}', String(nextAttempt)) : `Retrying analysis (Attempt ${nextAttempt})...`),
                    resumeStage: isDegraded ? 'diet' : undefined
                  });
                  JobQueueRunner.wake();
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1 cursor-pointer ${
                  hasDegradedDietStage(job)
                    ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20'
                    : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {hasDegradedDietStage(job) ? (t.retryAdvice || 'Retry Advice') : (t.retry || 'Retry')}
              </button>
            )}

            {/* Delete (Trash) Button: Always available for all jobs to cancel/discard */}
            <button
              type="button"
              onClick={() => onDelete(job.id)}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-full transition-all cursor-pointer"
              title={t.deleteTask || "Delete task"}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
