/**
 * Data sanitize planner — proposes fixes for sync/telemetry mess (approval UI).
 * Covers: unit-scale phantoms, history dups, junk custom metric keys, food log dups.
 */
import {
  isBiomarkerValueImprobable,
  normalizeHistoricalTelemetryErrors,
  parseNormalRangeBounds,
  biomarkerDefinitions,
  getMappedBiomarkerKey
} from './biomarkers';
import { toYYYYMMDD } from './dateUtils';
import { mergeFoodLogsDeduped, foodLogFingerprint } from './foodLogDedupe';
import { cleanupInventedBiomarkerCatalog } from './biomarkerLifecycle';

export { cleanupInventedBiomarkerCatalog };

export type SanitizeActionKind =
  | 'fix_value' // unit scale correction
  | 'drop_value' // impossible / phantom reading
  | 'drop_history_log' // empty after drops or pure duplicate log row
  | 'drop_custom_key' // junk custom biomarker def (metric_N, no real data)
  | 'merge_food'; // food log duplicate collapsed

export type SanitizeProposal = {
  id: string;
  kind: SanitizeActionKind;
  title: string;
  detail: string;
  /** Biomarker key if applicable */
  key?: string;
  logId?: string;
  date?: string;
  oldValue?: string | number;
  newValue?: string | number;
  /** For food merge: ids to remove after keeping keepId */
  foodIdsToRemove?: string[];
  keepFoodId?: string;
  selected?: boolean;
};

export type SanitizePlan = {
  proposals: SanitizeProposal[];
  summary: {
    valueFixes: number;
    valueDrops: number;
    historyDrops: number;
    customKeyDrops: number;
    foodMerges: number;
  };
};

function defName(key: string, profile: any): string {
  const custom = profile?.customBiomarkers?.[key];
  const def = biomarkerDefinitions.find((d: any) => d.key === key);
  return custom?.name || custom?.display_name || def?.name || key;
}

/**
 * Build a full sanitize plan for approval UI (does not mutate).
 */
export function buildDataSanitizePlan(opts: {
  biomarkerHistory?: any[];
  biomarkers?: Record<string, any>;
  profile?: any;
  foodLogs?: any[];
}): SanitizePlan {
  const profile = opts.profile || {};
  const history = Array.isArray(opts.biomarkerHistory) ? opts.biomarkerHistory : [];
  const proposals: SanitizeProposal[] = [];
  let pid = 0;
  const nextId = () => `san_${++pid}`;

  // --- Biomarker history: dry-run normalize to see before/after ---
  const beforeByLog = new Map<string, Record<string, any>>();
  history.forEach((log) => {
    if (log?.id) beforeByLog.set(log.id, { ...(log.biomarkers || {}) });
  });

  const { updatedHistory, fixedCount } = normalizeHistoricalTelemetryErrors(history, profile);

  updatedHistory.forEach((log: any) => {
    const before = beforeByLog.get(log.id) || {};
    const after = log.biomarkers || {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    allKeys.forEach((key) => {
      const oldV = before[key];
      const newV = after[key];
      if (oldV === newV) return;
      if (oldV != null && newV != null && oldV !== newV) {
        proposals.push({
          id: nextId(),
          kind: 'fix_value',
          title: `Fix ${defName(key, profile)}`,
          detail: `Unit/scale correction on ${log.date || 'history'}`,
          key,
          logId: log.id,
          date: log.date,
          oldValue: oldV,
          newValue: newV,
          selected: true,
        });
      } else if (oldV != null && (newV === undefined || newV === null)) {
        proposals.push({
          id: nextId(),
          kind: 'drop_value',
          title: `Remove phantom ${defName(key, profile)}`,
          detail: `Impossible value on ${log.date || 'history'} (never a valid lab reading)`,
          key,
          logId: log.id,
          date: log.date,
          oldValue: oldV,
          selected: true,
        });
      }
    });
  });

  // Also flag remaining improbable current-state values not caught if history empty
  Object.entries(opts.biomarkers || {}).forEach(([key, val]) => {
    const custom = profile?.customBiomarkers?.[key];
    const def = biomarkerDefinitions.find((d: any) => d.key === key);
    const range = custom?.normalRange || def?.normalRange;
    if (isBiomarkerValueImprobable(key, val as any, range)) {
      const already = proposals.some((p) => p.key === key && p.kind === 'drop_value' && p.oldValue === val);
      if (!already) {
        proposals.push({
          id: nextId(),
          kind: 'drop_value',
          title: `Clear current ${defName(key, profile)}`,
          detail: `Current tile value is improbable (${val} ${custom?.unit || def?.unit || ''})`,
          key,
          oldValue: val as any,
          selected: true,
        });
      }
    }
  });

  // Duplicate history rows: same day + identical biomarker key set after normalize
  const dayKeyMap = new Map<string, any[]>();
  updatedHistory.forEach((log: any) => {
    if (!log || log.sync_state === 'delete') return;
    const day = toYYYYMMDD(log.date);
    const keys = Object.keys(log.biomarkers || {}).sort().join(',');
    const fp = `${day}|${keys}`;
    if (!dayKeyMap.has(fp)) dayKeyMap.set(fp, []);
    dayKeyMap.get(fp)!.push(log);
  });
  dayKeyMap.forEach((logs) => {
    if (logs.length < 2) return;
    // keep newest
    logs.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    logs.slice(1).forEach((dup) => {
      proposals.push({
        id: nextId(),
        kind: 'drop_history_log',
        title: `Remove duplicate lab log`,
        detail: `Duplicate entry on ${dup.date} (same markers as another log)`,
        logId: dup.id,
        date: dup.date,
        selected: true,
      });
    });
  });

  // Duplicate key-value pairs on same date across log entries
  const dayKeyValueMap = new Map<string, any[]>();
  updatedHistory.forEach((log: any) => {
    if (!log || log.sync_state === 'delete') return;
    const day = toYYYYMMDD(log.date);
    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
      if (v == null || v === '') return;
      const fp = `${day}|${k}|${v}`;
      if (!dayKeyValueMap.has(fp)) dayKeyValueMap.set(fp, []);
      dayKeyValueMap.get(fp)!.push({ log, key: k, val: v });
    });
  });
  dayKeyValueMap.forEach((entries) => {
    if (entries.length < 2) return;
    entries.sort((a, b) => (b.log.updated_at || 0) - (a.log.updated_at || 0));
    entries.slice(1).forEach((dup) => {
      const alreadyInProposals = proposals.some((p) => p.logId === dup.log.id);
      if (!alreadyInProposals) {
        proposals.push({
          id: nextId(),
          kind: 'drop_history_log',
          title: `Remove duplicate ${defName(dup.key, profile)} log`,
          detail: `Duplicate value (${dup.val}) recorded on ${dup.log.date}`,
          logId: dup.log.id,
          key: dup.key,
          date: dup.log.date,
          selected: true,
        });
      }
    });
  });

  // Junk custom defs: metric_N / empty name / needsApproval with no history values
  const customs = profile.customBiomarkers || {};
  Object.entries(customs).forEach(([key, def]: [string, any]) => {
    const isJunkKey = /^metric[_\s-]?\d+$/i.test(key) || /^metric\s*\d+$/i.test(String(def?.name || ''));
    const hasHistory = history.some((h) => h?.biomarkers && h.biomarkers[key] != null && h.biomarkers[key] !== '');
    const hasCurrent = opts.biomarkers?.[key] != null && opts.biomarkers[key] !== '';
    if (isJunkKey && !hasHistory && !hasCurrent) {
      proposals.push({
        id: nextId(),
        kind: 'drop_custom_key',
        title: `Delete junk dictionary key “${def?.name || key}”`,
        detail: `Placeholder custom biomarker (${key}) with no lab values — sync noise`,
        key,
        selected: true,
      });
    } else if (def?.needsApproval === true && !hasHistory && !hasCurrent && !def?.unit) {
      proposals.push({
        id: nextId(),
        kind: 'drop_custom_key',
        title: `Delete empty pending “${def?.name || key}”`,
        detail: `Pending Approval entry never received a value`,
        key,
        selected: false, // default off — user may still want to fill these
      });
    }
  });

  // Food log duplicates
  const foods = Array.isArray(opts.foodLogs) ? opts.foodLogs : [];
  const deduped = mergeFoodLogsDeduped(foods, []);
  if (deduped.length < foods.length) {
    const keptIds = new Set(deduped.map((f) => f.id).filter(Boolean));
    const removed = foods.filter((f) => f.id && !keptIds.has(f.id));
    // Group removed by fingerprint of kept partner for readable cards
    const byFp = new Map<string, any[]>();
    removed.forEach((f) => {
      const fp = foodLogFingerprint(f);
      if (!byFp.has(fp)) byFp.set(fp, []);
      byFp.get(fp)!.push(f);
    });
    byFp.forEach((group, fp) => {
      const keeper = deduped.find((d) => foodLogFingerprint(d) === fp);
      proposals.push({
        id: nextId(),
        kind: 'merge_food',
        title: `Merge duplicate meal “${keeper?.name || group[0]?.name || 'meal'}”`,
        detail: `Remove ${group.length} duplicate food card(s) from sync retries (keep best photo)`,
        keepFoodId: keeper?.id,
        foodIdsToRemove: group.map((g) => g.id).filter(Boolean),
        date: keeper?.date || group[0]?.date,
        selected: true,
      });
    });
  }

  const summary = {
    valueFixes: proposals.filter((p) => p.kind === 'fix_value').length,
    valueDrops: proposals.filter((p) => p.kind === 'drop_value').length,
    historyDrops: proposals.filter((p) => p.kind === 'drop_history_log').length,
    customKeyDrops: proposals.filter((p) => p.kind === 'drop_custom_key').length,
    foodMerges: proposals.filter((p) => p.kind === 'merge_food').length,
  };

  // silence unused when fixedCount 0 but proposals from food only
  void fixedCount;
  void parseNormalRangeBounds;

  return { proposals, summary };
}

/**
 * Apply selected proposals. Returns new history, biomarkers, foodLogs, profile patches.
 */
export function applyDataSanitizePlan(
  plan: SanitizePlan,
  selectedIds: Set<string>,
  opts: {
    biomarkerHistory: any[];
    biomarkers: Record<string, any>;
    foodLogs: any[];
    profile: any;
  }
): {
  biomarkerHistory: any[];
  biomarkers: Record<string, any>;
  foodLogs: any[];
  profileUpdates: Partial<any>;
  applied: number;
} {
  const selected = plan.proposals.filter((p) => selectedIds.has(p.id));
  let history = (opts.biomarkerHistory || []).map((h) => ({
    ...h,
    biomarkers: { ...(h.biomarkers || {}) },
  }));
  let biomarkers = { ...(opts.biomarkers || {}) };
  let foodLogs = [...(opts.foodLogs || [])];
  const customs = { ...(opts.profile?.customBiomarkers || {}) };
  const deletedCustom: Record<string, number> = {
    ...(opts.profile?.deletedCustomBiomarkerKeys || {}),
  };
  const deletedLogIds: Record<string, number> = {
    ...(opts.profile?.deletedBiomarkerLogIds || {}),
  };
  let applied = 0;

  // First apply full normalize when any fix/drop_value selected
  if (selected.some((p) => p.kind === 'fix_value' || p.kind === 'drop_value')) {
    const { updatedHistory } = normalizeHistoricalTelemetryErrors(history, opts.profile);
    history = updatedHistory;
    applied += selected.filter((p) => p.kind === 'fix_value' || p.kind === 'drop_value').length;
  }

  selected.forEach((p) => {
    if (p.kind === 'drop_history_log' && p.logId) {
      const now = Date.now();
      deletedLogIds[p.logId] = now;
      history = history.map((h) => h.id === p.logId ? { ...h, sync_state: 'delete' as const, updated_at: now } : h);
      applied++;
    }
    if (p.kind === 'drop_custom_key' && p.key) {
      delete customs[p.key];
      deletedCustom[p.key] = Date.now();
      delete biomarkers[p.key];
      history = history.map((h) => {
        if (h.biomarkers && p.key! in h.biomarkers) {
          const next = { ...h.biomarkers };
          delete next[p.key!];
          return { ...h, biomarkers: next };
        }
        return h;
      });
      applied++;
    }
    if (p.kind === 'drop_value' && p.key && !p.logId) {
      delete biomarkers[p.key];
      applied++;
    }
    if (p.kind === 'merge_food' && p.foodIdsToRemove?.length) {
      const remove = new Set(p.foodIdsToRemove);
      foodLogs = foodLogs.filter((f) => !remove.has(f.id));
      applied++;
    }
  });

  // Always re-dedupe foods after merge actions
  if (selected.some((p) => p.kind === 'merge_food')) {
    foodLogs = mergeFoodLogsDeduped(foodLogs, []);
  }

  // Recompute current biomarkers from history (prefer non-improbable)
  const recomputed: Record<string, any> = {};
  [...history]
    .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
    .forEach((log) => {
      Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
        const custom = customs[k];
        const def = biomarkerDefinitions.find((d: any) => d.key === k);
        const range = custom?.normalRange || def?.normalRange;
        const num = typeof v === 'number' ? v : parseFloat(String(v));
        if (!isNaN(num) && isBiomarkerValueImprobable(k, num, range)) return;
        recomputed[k] = v;
      });
    });

  const cleanedCatalog = cleanupInventedBiomarkerCatalog({
    ...opts.profile,
    customBiomarkers: customs,
    deletedCustomBiomarkerKeys: deletedCustom,
  }, history);

  return {
    biomarkerHistory: history.filter((h) => Object.keys(h.biomarkers || {}).length > 0),
    biomarkers: { ...biomarkers, ...recomputed },
    foodLogs,
    profileUpdates: {
      customBiomarkers: cleanedCatalog.profile.customBiomarkers,
      deletedCustomBiomarkerKeys: cleanedCatalog.profile.deletedCustomBiomarkerKeys,
      deletedBiomarkerLogIds: deletedLogIds,
      ...(cleanedCatalog.profile.customRanges ? { customRanges: cleanedCatalog.profile.customRanges } : {}),
    },
    applied,
  };
}

/**
 * Purge hallucinated logs and repair corrupted clinical notes.
 * 1. Purges the synthetic 16-08-2026 / 2026-08-16 panel that was artificially injected.
 * 2. Purges phantom single-marker BMI logs created by auto-BMI logic.
 * 3. Strips " | Auto-synced from Google Fit" note pollution from clinical lab entries.
 * 4. Records deleted IDs in deletedBiomarkerLogIds to prevent resurrection on sync.
 */
export function purgeHallucinatedAndCorruptedData(
  history: any[] = [],
  biomarkers: Record<string, any> = {},
  profile: any = {}
): {
  biomarkerHistory: any[];
  biomarkers: Record<string, any>;
  profileUpdates: Partial<any>;
  purgedCount: number;
} {
  const deletedLogIds: Record<string, number> = {
    ...(profile?.deletedBiomarkerLogIds || {}),
  };
  let purgedCount = 0;
  const now = Date.now();

  const cleanedHistory: any[] = [];

  for (const log of history) {
    if (!log) continue;
    const dateStr = String(log.date || '').trim();
    const formattedDate = toYYYYMMDD(dateStr);
    const noteStr = String(log.note || '');
    
    const cleanedBiomarkers = { ...log.biomarkers };
    let biomarkersModified = false;

    // Migrate old keys/aliases to canonical keys FIRST, so the specific key checks below actually match
    for (const k of Object.keys(cleanedBiomarkers)) {
      const canonical = getMappedBiomarkerKey(k);
      if (canonical && canonical !== k && canonical !== 'Unknown') {
        if (!(canonical in cleanedBiomarkers)) {
          cleanedBiomarkers[canonical] = cleanedBiomarkers[k];
        }
        delete cleanedBiomarkers[k];
        biomarkersModified = true;
      }
    }

    const canonicalKeys = Object.keys(cleanedBiomarkers);

    // Check 1: Synthetic 2026-08-16 panel
    const isSyntheticAug16 = formattedDate === '2026-08-16' && (
      noteStr.toLowerCase().includes('synthetic') ||
      noteStr.toLowerCase().includes('parser') ||
      canonicalKeys.includes('estimated_average_glucose') ||
      (canonicalKeys.length > 5 && !noteStr.includes('NHS') && !noteStr.includes('AlyssaFRS') && !noteStr.includes('OlaFRS'))
    );

    // Check 2: Auto-BMI phantom logs
    const isAutoBmiPhantom = (
      (canonicalKeys.length === 1 && canonicalKeys[0] === 'bmi') ||
      noteStr.includes('Auto-logged default BMI')
    );

    // Check 4: Phantom Calibration Agent clones (late July / early Aug)
    let isPhantomClone = false;
    
    if (formattedDate === '2026-08-02' || formattedDate === '2026-07-29') {
      if (cleanedBiomarkers['white_blood_cells'] === 5.7 || cleanedBiomarkers['platelets'] === 227 || cleanedBiomarkers['wbc'] === 5.7) isPhantomClone = true;
    } else if (formattedDate === '2026-07-31') {
      if (cleanedBiomarkers['mean_corpuscular_hemoglobin'] === 30.3 || cleanedBiomarkers['mch'] === 30.3) isPhantomClone = true;
    } else if (formattedDate === '2026-08-03') {
      if (cleanedBiomarkers['hematocrit'] === 48 || cleanedBiomarkers['hematocrit'] === 0.48 || cleanedBiomarkers['basophils'] === 0.05 || cleanedBiomarkers['basophil_count'] === 0.05) isPhantomClone = true;
    } else if (formattedDate === '2026-07-09' || formattedDate === '2026-07-14') {
      if (cleanedBiomarkers['hba1c'] === 40 || cleanedBiomarkers['triglycerides'] === 1.07) isPhantomClone = true;
    }

    if (isSyntheticAug16 || isAutoBmiPhantom || isPhantomClone) {
      if (log.id) {
        deletedLogIds[log.id] = now;
      }
      purgedCount++;
      continue;
    }

    // Check 5: Cross-Contamination & Date Bleed inside specific logs
    if (formattedDate === '2026-06-05') {
      if (cleanedBiomarkers['total_cholesterol'] === 6.1) { delete cleanedBiomarkers['total_cholesterol']; biomarkersModified = true; }
      if (cleanedBiomarkers['triglycerides'] === 1.07) { delete cleanedBiomarkers['triglycerides']; biomarkersModified = true; }
      if (cleanedBiomarkers['non_hdl_cholesterol'] === 4.7) { delete cleanedBiomarkers['non_hdl_cholesterol']; biomarkersModified = true; }
      if (cleanedBiomarkers['ldl'] === 4.2) { delete cleanedBiomarkers['ldl']; biomarkersModified = true; }
    }
    if (formattedDate === '2026-06-03' || formattedDate === '2025-06-25') {
      if ('serum_sodium' in cleanedBiomarkers || 'sodium' in cleanedBiomarkers) {
        delete cleanedBiomarkers['serum_sodium'];
        delete cleanedBiomarkers['sodium'];
        biomarkersModified = true;
      }
    }
    if (formattedDate === '2020-11-04' || formattedDate === '2024-10-23' || formattedDate === '2025-06-25') {
      if ('hematocrit' in cleanedBiomarkers) {
        delete cleanedBiomarkers['hematocrit'];
        biomarkersModified = true;
      }
    }
    if (formattedDate === '2026-06-03' && cleanedBiomarkers['ldl'] === 6.5) {
      cleanedBiomarkers['ldl'] = 4.3;
      biomarkersModified = true;
    }
    
    // Check 6: Residual Phantom Deletions
    if (formattedDate === '2026-07-31') {
      const phantomKeys31Jul = ['alt', 'sgpt', 'mpv', 'mean_platelet_volume', 'qrisk2', 'qrisk2_10_year_cardiovascular_risk', 'serum_calcium', 'calcium', 'serum_globulin', 'globulin', 'non_hdl_cholesterol', 'serum_adjusted_calcium', 'adjusted_calcium', 'mean_corpuscular_hemoglobin', 'mch', 'height'];
      phantomKeys31Jul.forEach(k => { if (k in cleanedBiomarkers) { delete cleanedBiomarkers[k]; biomarkersModified = true; } });
    }
    if (formattedDate === '2026-07-12') {
      if ('lymphocyte_count' in cleanedBiomarkers || 'lymphocytes' in cleanedBiomarkers) {
        delete cleanedBiomarkers['lymphocyte_count']; delete cleanedBiomarkers['lymphocytes']; biomarkersModified = true;
      }
    }
    if (formattedDate === '2024-04-02') {
      const phantomLFTs = ['alt', 'sgpt', 'serum_albumin', 'albumin', 'total_bilirubin', 'bilirubin', 'alkaline_phosphatase', 'alp'];
      phantomLFTs.forEach(k => {
        if (k in cleanedBiomarkers && (cleanedBiomarkers[k] === 28 || cleanedBiomarkers[k] === 44 || cleanedBiomarkers[k] === 13 || cleanedBiomarkers[k] === 41)) {
          delete cleanedBiomarkers[k]; biomarkersModified = true;
        }
      });
    }
    if (formattedDate === '2026-06-05') {
      if ('cholesterol_hdl_ratio' in cleanedBiomarkers) { delete cleanedBiomarkers['cholesterol_hdl_ratio']; biomarkersModified = true; }
      
      // Robust wildcard deletion for Lymphocytes and AUDIT on 05-Jun-2026
      Object.keys(cleanedBiomarkers).forEach(k => {
        if (k.includes('lymphocyte') || k.includes('audit')) {
          delete cleanedBiomarkers[k];
          biomarkersModified = true;
        }
      });
      
      if ('qrisk2' in cleanedBiomarkers) { delete cleanedBiomarkers['qrisk2']; biomarkersModified = true; }
      if ('qrisk2_10_year_cardiovascular_risk' in cleanedBiomarkers) { delete cleanedBiomarkers['qrisk2_10_year_cardiovascular_risk']; biomarkersModified = true; }
    }
    if (formattedDate === '2025-06-25') {
      if ('qrisk2' in cleanedBiomarkers) { delete cleanedBiomarkers['qrisk2']; biomarkersModified = true; }
      if ('qrisk2_10_year_cardiovascular_risk' in cleanedBiomarkers) { delete cleanedBiomarkers['qrisk2_10_year_cardiovascular_risk']; biomarkersModified = true; }
    }
    if (formattedDate === '2020-11-04') {
      if ('basophil_count' in cleanedBiomarkers || 'basophils' in cleanedBiomarkers) {
        delete cleanedBiomarkers['basophil_count']; delete cleanedBiomarkers['basophils']; biomarkersModified = true;
      }
      
      // Robust removal of unmapped alias strings that appear as duplicates
      Object.keys(cleanedBiomarkers).forEach(k => {
        const lk = k.toLowerCase();
        if (lk === 'audit_total_score' || lk === 'audit total score' || lk.includes('typical_consumption') || lk.includes('typical consumption') || lk === 'alcohol_consumption' || lk === 'alcohol consumption') {
          delete cleanedBiomarkers[k]; biomarkersModified = true;
        }
      });
    }
    
    // Scale Hematocrit correctly if stored as percentage
    if ('hematocrit' in cleanedBiomarkers) {
      const hct = cleanedBiomarkers['hematocrit'];
      if (typeof hct === 'number' && hct > 10) {
        cleanedBiomarkers['hematocrit'] = parseFloat((hct / 100).toFixed(3));
        biomarkersModified = true;
      }
    }

    // Fix creatinine floating point drift (99.892 -> 100)
    if ('creatinine' in cleanedBiomarkers) {
      const crea = cleanedBiomarkers['creatinine'];
      if (typeof crea === 'number' && Math.abs(crea - Math.round(crea)) < 0.2 && crea !== Math.round(crea)) {
        cleanedBiomarkers['creatinine'] = Math.round(crea);
        biomarkersModified = true;
      }
    }

    if (Object.keys(cleanedBiomarkers).length === 0 && canonicalKeys.length > 0) {
      if (log.id) deletedLogIds[log.id] = now;
      purgedCount++;
      continue; // whole record became empty
    }

    // Check 3: Clean corrupted clinical notes
    let cleanNote = log.note;
    if (cleanNote && cleanNote.includes(' | Auto-synced from Google Fit')) {
      cleanNote = cleanNote.replace(' | Auto-synced from Google Fit', '').trim();
    } else if (cleanNote === 'Auto-synced from Google Fit' && canonicalKeys.some(k => k !== 'steps')) {
      cleanNote = ''; // remove misleading note from clinical tests
    }
    
    if (biomarkersModified || cleanNote !== log.note) {
      purgedCount++;
    }

    cleanedHistory.push({
      ...log,
      biomarkers: cleanedBiomarkers,
      note: cleanNote
    });
  }

  // 7. Inject Authentic Biomarkers Missing from Pipeline
  const injections = [
    { date: '2026-06-05', keys: { 'hemoglobin': 166, 'mean_corpuscular_hemoglobin_concentration': 346 } },
    { date: '2024-04-02', keys: { 'hemoglobin': 164, 'mean_corpuscular_hemoglobin_concentration': 336 } },
    { date: '2026-06-03', keys: { 'hdl': 1.5, 'ldl': 4.3 } },
    { date: '2025-06-25', keys: { 'hdl': 1.4 } },
    { date: '2024-04-03', keys: { 'hdl': 1.43 } },
    { date: '2024-03-27', keys: { 'fast_alcohol_score': 0 } },
    { date: '2024-10-23', keys: { 'audit_c_total_score': 3 } },
    { date: '2020-11-04', keys: { 'qrisk2': 0.8 } },
    { date: '2024-03-27', keys: { 'audit_binge_drinking_score': 3 } },
  ];

  for (const injection of injections) {
    let targetLog = cleanedHistory.find(l => toYYYYMMDD(String(l.date)) === injection.date && l.biomarkers && Object.keys(l.biomarkers).length > 0 && !Object.keys(l.biomarkers).includes('steps'));
    if (!targetLog) {
      targetLog = { id: `injected_${injection.date}_${Date.now()}`, date: injection.date, biomarkers: {}, note: 'Recovered from source medical sheet' };
      cleanedHistory.push(targetLog);
      purgedCount++;
    }
    for (const [k, v] of Object.entries(injection.keys)) {
      if (targetLog.biomarkers[k] !== v) {
        targetLog.biomarkers[k] = v;
        purgedCount++;
      }
    }
  }

  // Recompute current biomarkers from the remaining cleaned history
  const recomputed: Record<string, any> = {};
  [...cleanedHistory]
    .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
    .forEach((log) => {
      Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          recomputed[k] = v;
        }
      });
    });

  return {
    biomarkerHistory: cleanedHistory,
    biomarkers: recomputed,
    profileUpdates: {
      deletedBiomarkerLogIds: deletedLogIds
    },
    purgedCount
  };
}
