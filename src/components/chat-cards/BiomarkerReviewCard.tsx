import * as React from 'react';
import { AgentCardProps } from './types';
import { Check, Edit2, Sparkles, ArrowRight, X, RotateCcw, MessageSquare, ShieldCheck, AlertCircle, Info, Trash2 } from 'lucide-react';

import { biomarkerDefinitions } from '../../utils/biomarkers';
import { translations } from '../../utils/translations';

export function getMappedBiomarkerKey(rawNameOrKey: string): string {
  if (!rawNameOrKey) return '';
  const lower = rawNameOrKey.trim().toLowerCase();
  if (lower === 'hs-crp' || lower === 'hscrp' || lower === 'crp-hs' || lower === 'crphs' || lower === 'high sensitivity c-reactive protein' || lower === 'c-reactive protein') {
    return 'hscrp';
  }
  const matched = biomarkerDefinitions.find(d => 
    d.key.toLowerCase() === lower || 
    d.name.toLowerCase() === lower ||
    (d as any).aliases?.some((a: string) => a.toLowerCase() === lower)
  );
  return matched ? matched.key : lower.replace(/[^a-z0-9_]/g, '_');
}

const COMMON_UNITS = [
  '%',
  'g/dL',
  'g/L',
  'mg/dL',
  'mg/L',
  'ng/dL',
  'ng/mL',
  'pg/mL',
  'U/L',
  'uIU/mL',
  'mIU/L',
  'mmol/L',
  'umol/L',
  'K/uL',
  'M/uL',
  'fL',
  'pg',
  'mL/min/1.73m²',
  'ratio',
  'score',
];

const normalizeDateStr = (s?: string) => {
  if (!s) return '';
  const clean = s.trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return clean;
};

const findOldValInHistory = (history: any[], modDate: string, keyName: string) => {
  if (!history || !modDate || !keyName) return null;
  const targetNorm = normalizeDateStr(modDate);
  const matchedLog = history.find(h => normalizeDateStr(h.date) === targetNorm);
  if (!matchedLog || !matchedLog.biomarkers) return null;

  if (matchedLog.biomarkers[keyName] !== undefined && matchedLog.biomarkers[keyName] !== null) {
    return matchedLog.biomarkers[keyName];
  }
  const lowerKey = keyName.toLowerCase().replace(/\s+/g, '_');
  for (const [k, v] of Object.entries(matchedLog.biomarkers)) {
    if (k.toLowerCase().replace(/\s+/g, '_') === lowerKey) {
      return v;
    }
  }
  return null;
};

const STOPWORDS = new Set([
  'through', 'from', 'to', 'until', 'between', 'and', 'or', 'on', 'at', 'in',
  'entry', 'entries', 'log', 'logs', 'error', 'errors', 'date', 'dates'
]);

export function extractFallbackModifications(text: string, history: any[], profile: any): any[] {
  if (!text || typeof text !== 'string') return [];
  const results: any[] = [];
  const cleanText = text.replace(/[*_]/g, '');

  const chunks = cleanText.split(/(?:[•\n;\r]|(?:\d+[\.\)]\s+))/);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || !/(?:->|→)/.test(trimmed)) continue;

    // Pattern 1: date (biomarker): old [unit] -> new [unit]
    let m = trimmed.match(/(\d{2}[-\/]\d{2}[-\/]\d{4})\s*\(([^)]+)\)[:\s]*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const date = m[1].replace(/\//g, '-');
      const rawName = m[2].trim();
      const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
      const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/\s+/g, '_');
      const oldUnit = m[4].trim() || undefined;
      const newUnit = m[6].trim() || undefined;
      results.push({
        action: 'update_biomarker',
        keyName,
        date,
        oldValue: m[3],
        oldUnit,
        newValue: m[5],
        unit: newUnit || oldUnit,
        reason: 'Scaling and notation calibration'
      });
      continue;
    }

    // Pattern 2: biomarker date: old [unit] -> new [unit]
    m = trimmed.match(/([a-zA-Z_]+(?:\s+[a-zA-Z_]+)?)\s+(?:on\s+)?(\d{2}[-\/]\d{2}[-\/]\d{4})[:\s]*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const rawName = m[1].trim();
      if (STOPWORDS.has(rawName.toLowerCase())) continue;
      const date = m[2].replace(/\//g, '-');
      const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
      const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/\s+/g, '_');
      const oldUnit = m[4].trim() || undefined;
      const newUnit = m[6].trim() || undefined;
      results.push({
        action: 'update_biomarker',
        keyName,
        date,
        oldValue: m[3],
        oldUnit,
        newValue: m[5],
        unit: newUnit || oldUnit,
        reason: 'Scaling and notation calibration'
      });
      continue;
    }

    // Pattern 3: Range dates, e.g. "hemoglobin 03-08-2026 through 05-06-2026: 166 g/L -> 16.6 g/dL"
    m = trimmed.match(/([a-zA-Z_]+(?:\s+[a-zA-Z_]+)?)\s+(\d{2}[-\/]\d{2}[-\/]\d{4})\s+(?:through|to|until|-)\s+(\d{2}[-\/]\d{2}[-\/]\d{4})[:\s]*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const rawName = m[1].trim();
      if (!STOPWORDS.has(rawName.toLowerCase())) {
        const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
        const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/\s+/g, '_');
        const oldUnit = m[5].trim() || undefined;
        const newUnit = m[7].trim() || undefined;
        const d1 = m[2].replace(/\//g, '-');
        const d2 = m[3].replace(/\//g, '-');

        const matchedHistory = (history || []).filter(h => {
          if (!h || !h.date) return false;
          return h.biomarkers && (h.biomarkers[keyName] !== undefined || Object.keys(h.biomarkers).some(k => k.toLowerCase().replace(/\s+/g, '_') === keyName));
        });

        if (matchedHistory.length > 0) {
          matchedHistory.forEach(h => {
            results.push({
              action: 'update_biomarker',
              keyName,
              date: h.date,
              oldValue: m[4],
              oldUnit,
              newValue: m[6],
              unit: newUnit || oldUnit,
              reason: 'Scaling and notation calibration'
            });
          });
        } else {
          results.push({
            action: 'update_biomarker',
            keyName,
            date: d1,
            oldValue: m[4],
            oldUnit,
            newValue: m[6],
            unit: newUnit || oldUnit,
            reason: 'Scaling and notation calibration'
          });
        }
        continue;
      }
    }

    // Pattern 4: date biomarker old [unit] -> new [unit] (e.g. "03-08-2026 Hematocrit 0.48 -> 48.0 %" or "02-08-2026 LDL-C 4.2 mmol/L -> 162 mg/dL")
    m = trimmed.match(/^(\d{2}[-\/]\d{2}[-\/]\d{4})\s+([a-zA-Z0-9_\-\s]+?)\s+([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const date = m[1].replace(/\//g, '-');
      const rawName = m[2].trim();
      const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
      const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/[\s\-]+/g, '_');
      const oldUnit = m[4].trim() || undefined;
      const newUnit = m[6].trim() || undefined;
      results.push({
        action: 'update_biomarker',
        keyName,
        date,
        oldValue: m[3],
        oldUnit,
        newValue: m[5],
        unit: newUnit || oldUnit,
        reason: 'Scaling and notation calibration'
      });
      continue;
    }
  }

  return results;
}

export const BiomarkerReviewCard: React.FC<AgentCardProps> = ({ msg, onLogMedical, profile, biomarkerHistory, onDeleteMessage }) => {
  const t = translations[profile?.language || 'en'] || translations.en;
  const rawTargetKey = msg.data?.targetBiomarkerKey || msg.data?.agentResult?.targetBiomarkerKey || msg.data?.agentResult?.proposal?.key || msg.data?.agentResult?.proposal?.keyName || msg.data?.proposal?.key || msg.data?.proposal?.name || (msg.agentResult as any)?.targetBiomarkerKey || '';
  const proposal = msg.data?.agentResult?.proposal || msg.data?.proposal || (msg.agentResult as any)?.proposal || null;
  const mods = msg.data?.agentResult?.modificationCommand || msg.data?.modificationCommand || msg.modificationCommand || (msg.agentResult as any)?.modificationCommand || null;
  const reply = msg.data?.agentResult?.reply || msg.data?.agentResult?.text || msg.content;

  const targetKey = getMappedBiomarkerKey(rawTargetKey || proposal?.name || '') || rawTargetKey || 'hscrp';
  const currentDef = profile?.customBiomarkers?.[targetKey] || biomarkerDefinitions.find(d => d.key === targetKey || d.name.toLowerCase() === targetKey.toLowerCase()) || {};

  const initialStatus: 'pending' | 'accepted' | 'refused' = msg.data?.proposalStatus || (msg.data?.agentResult as any)?.proposalStatus || 'pending';
  const [decisionState, setDecisionState] = React.useState<'pending' | 'accepted' | 'refused'>(initialStatus);

  const [localMods, setLocalMods] = React.useState<any[]>([]);
  const [localProposal, setLocalProposal] = React.useState<any>(null);
  const [localUnits, setLocalUnits] = React.useState<Record<string, string>>({});
  const [isEditingProposal, setIsEditingProposal] = React.useState(false);

  React.useEffect(() => {
    let initialMods = (mods && Array.isArray(mods) && mods.length > 0) ? mods : [];
    if (initialMods.length === 0 && reply) {
      initialMods = extractFallbackModifications(reply, biomarkerHistory || [], profile);
    }
    setLocalMods(initialMods ? JSON.parse(JSON.stringify(initialMods)) : []);
    setLocalProposal(proposal ? JSON.parse(JSON.stringify(proposal)) : null);
    
    // Initialize units
    const initialUnits: Record<string, string> = {};
    if (proposal && proposal.metric) {
      initialUnits[targetKey] = proposal.metric;
    }
    if (initialMods) {
      initialMods.forEach((m: any) => {
        if (m.keyName && !initialUnits[m.keyName]) {
          const foundDef = profile?.customBiomarkers?.[m.keyName] || biomarkerDefinitions.find(d => d.key === m.keyName) || {};
          initialUnits[m.keyName] = foundDef.unit || '';
        }
      });
    }
    setLocalUnits(initialUnits);
  }, [msg, mods, proposal, profile, targetKey, reply, biomarkerHistory]);

  if (msg.role !== 'assistant') return null;
  if (!proposal && (!mods || mods.length === 0) && !reply) return null;

  const hasModifications = localMods && localMods.length > 0;

  const normalize = (s: string | undefined | null) => s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
  const normRange = (s: string | undefined | null) => s?.toLowerCase().replace(/[^\d<>=.-]/g, '') || '';

  const hasProposalChanges = Boolean(
    localProposal && (
      (localProposal.name && normalize(currentDef.name) !== normalize(localProposal.name) && !(currentDef.aliases || []).some((a: string) => normalize(a) === normalize(localProposal.name))) ||
      (localProposal.metric && currentDef.unit && currentDef.unit !== localProposal.metric) ||
      (localProposal.range && normRange(currentDef.normalRange || (currentDef as any).range) !== normRange(localProposal.range)) ||
      (localProposal.description && (currentDef.description || currentDef.descriptions?.en || currentDef.descriptions?.zh || currentDef.descriptions?.fr) !== localProposal.description) ||
      (Array.isArray(localProposal.rangeBrackets) && localProposal.rangeBrackets.length > 0) ||
      (localProposal.optimalValue && currentDef.optimalValue !== localProposal.optimalValue)
    )
  );

  const isActionable = Boolean(hasModifications || hasProposalChanges);

  const handleAccept = () => {
    if (isActionable && onLogMedical) {
      const profileUpdates: any = {};
      
      // 1. If we have a local proposal (definition update), build its customBiomarkers entry
      if (localProposal && hasProposalChanges) {
        const resolvedKey = getMappedBiomarkerKey(localProposal.name || targetKey) || targetKey || 'hscrp';
        profileUpdates.customBiomarkers = {
          [resolvedKey]: {
            ...currentDef,
            name: localProposal.name || currentDef.name || resolvedKey,
            unit: localUnits[resolvedKey] || localProposal.metric || currentDef.unit || '',
            normalRange: (Array.isArray(localProposal.rangeBrackets)
              ? localProposal.rangeBrackets.find((b: any) => /optimal|ideal|normal|healthy|remission/i.test(b?.name || ''))?.range
              : undefined) || localProposal.range || currentDef.normalRange || '',
            description: localProposal.description || currentDef.description || '',
            specificRiskContext: localProposal.medicalInsight || (currentDef as any).specificRiskContext || '',
            rangeBrackets: localProposal.rangeBrackets || (currentDef as any).rangeBrackets || undefined,
            demographicAdjusted: !!(localProposal.isEthnicitySpecific || localProposal.ethnicityTag),
            ethnicityTag: localProposal.ethnicityTag || undefined
          }
        };
      }

      // 2. Add units for other modified biomarkers to the profileUpdates
      localMods.forEach((m: any) => {
        if (m.action === 'update_biomarker' && m.keyName) {
          const key = m.keyName;
          const chosenUnit = localUnits[key];
          if (chosenUnit !== undefined) {
            if (!profileUpdates.customBiomarkers) {
              profileUpdates.customBiomarkers = {};
            }
            const foundDef = profile?.customBiomarkers?.[key] || biomarkerDefinitions.find(d => d.key === key) || {};
            profileUpdates.customBiomarkers[key] = {
              ...foundDef,
              name: foundDef.name || key,
              unit: chosenUnit,
              normalRange: foundDef.normalRange || (foundDef as any).range || 'Unknown',
              description: foundDef.description || '',
              specificRiskContext: (foundDef as any).specificRiskContext || ''
            };
          }
        }
      });

      // Parse numeric values correctly
      const parsedMods = localMods.map((m: any) => {
        if (m.action === 'update_biomarker' && m.newValue !== undefined && m.newValue !== null) {
          const num = Number(m.newValue);
          return {
            ...m,
            newValue: Number.isFinite(num) ? num : m.newValue
          };
        }
        return m;
      });

      onLogMedical({}, Object.keys(profileUpdates).length > 0 ? profileUpdates : undefined, undefined, undefined, parsedMods);
    }

    setDecisionState('accepted');
    if (msg.data) msg.data.proposalStatus = 'accepted';
    if (msg.data?.agentResult) (msg.data.agentResult as any).proposalStatus = 'accepted';
  };

  const handleRefuse = () => {
    setDecisionState('refused');
    if (msg.data) msg.data.proposalStatus = 'refused';
    if (msg.data?.agentResult) (msg.data.agentResult as any).proposalStatus = 'refused';
  };

  const handleReconsider = () => {
    setDecisionState('pending');
    if (msg.data) msg.data.proposalStatus = 'pending';
    if (msg.data?.agentResult) (msg.data.agentResult as any).proposalStatus = 'pending';
  };

  return (
    <div className="mt-3 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/30 rounded-2xl p-4 w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-indigo-100/50 dark:border-indigo-800/30">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h4 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 tracking-wider uppercase font-display">
            {isActionable ? 'Biomarker Clinical Review & Calibration' : 'Biomarker Clinical Review & Analysis'}
          </h4>
        </div>
        {decisionState === 'accepted' && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
            <Check className="w-3 h-3" />
            {isActionable ? 'Accepted & Applied' : 'Acknowledged'}
          </span>
        )}
        {decisionState === 'refused' && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/40">
            <X className="w-3 h-3" />
            {isActionable ? 'Proposal Declined' : 'Dismissed'}
          </span>
        )}
      </div>

      {/* Agent Narrative Response */}
      {reply && (
        <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed bg-white/70 dark:bg-slate-900/50 p-3.5 rounded-xl border border-indigo-50 dark:border-indigo-800/20">
          {reply}
        </div>
      )}

      {/* Proposed Biomarker Definition & Clinical Diagnostics */}
      {localProposal && (hasProposalChanges || isEditingProposal) && (
        <div className="space-y-3 bg-white/80 dark:bg-slate-900/60 p-3.5 rounded-xl border border-indigo-100/80 dark:border-indigo-800/40 shadow-xs">
          <div className="flex items-center justify-between border-b border-indigo-100/50 dark:border-indigo-900/30 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {localProposal.name || currentDef.name || targetKey}
              </span>
              {(localProposal.isEthnicitySpecific || localProposal.ethnicityTag) && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                  {localProposal.ethnicityTag ? `${localProposal.ethnicityTag} Specific` : 'Demographic-Specific'}
                </span>
              )}
            </div>
            {decisionState === 'pending' && (
              <button
                type="button"
                onClick={() => setIsEditingProposal(!isEditingProposal)}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                <Edit2 className="w-3 h-3" />
                {isEditingProposal ? 'Done Editing' : 'Edit Definition'}
              </button>
            )}
          </div>

          {/* Current log context if available */}
          {(localProposal.value !== undefined || localProposal.date) && (
            <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2 bg-indigo-50/50 dark:bg-indigo-950/30 px-2.5 py-1 rounded-lg">
              <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span>
                Reviewed Record: <strong className="font-mono text-slate-800 dark:text-slate-200">{localProposal.value ?? ''} {localProposal.metric || currentDef.unit || ''}</strong>
                {localProposal.date ? ` on ${localProposal.date}` : ''}
              </span>
            </div>
          )}

          {isEditingProposal ? (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{t.name2}</label>
                  <input
                    type="text"
                    value={localProposal.name || ''}
                    onChange={(e) => setLocalProposal({ ...localProposal, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{t.unit}</label>
                  <input
                    type="text"
                    list="proposal-units-list"
                    value={localProposal.metric || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocalProposal({ ...localProposal, metric: val });
                      setLocalUnits(prev => ({ ...prev, [targetKey]: val }));
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <datalist id="proposal-units-list">
                    {COMMON_UNITS.map(unit => (
                      <option key={unit} value={unit} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{t.recepColRange}</label>
                <input
                  type="text"
                  value={localProposal.range || ''}
                  onChange={(e) => setLocalProposal({ ...localProposal, range: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="e.g. < 1.0 mg/L"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{t.description}</label>
                <textarea
                  value={localProposal.description || ''}
                  onChange={(e) => setLocalProposal({ ...localProposal, description: e.target.value })}
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Current Baseline Box */}
              <div className="bg-slate-50/50 dark:bg-slate-800/30 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2 block">{t.currentBaseline}</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">{t.name2}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{currentDef.name || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">{t.unit}</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{currentDef.unit || '—'}</span>
                  </div>
                  <div className="flex flex-col sm:col-span-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">{t.referenceRange}</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{currentDef.normalRange || (currentDef as any).range || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Proposed Updates */}
              {(() => {
                const normalize = (s: string | undefined | null) => s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
                const normRange = (s: string | undefined | null) => s?.toLowerCase().replace(/[^\d<>=.-]/g, '') || '';
                
                const isNameChanged = localProposal.name && normalize(currentDef.name) !== normalize(localProposal.name) && !(currentDef.aliases || []).some((a: string) => normalize(a) === normalize(localProposal.name));
                const isUnitChanged = localProposal.metric && currentDef.unit !== localProposal.metric;
                const isRangeChanged = localProposal.range && normRange(currentDef.normalRange || (currentDef as any).range) !== normRange(localProposal.range);
                const isDescChanged = localProposal.description && (currentDef.description || currentDef.descriptions?.en || currentDef.descriptions?.zh || currentDef.descriptions?.fr) !== localProposal.description;
                
                return (
                  <div className="space-y-2">
                    {Boolean(isNameChanged || isUnitChanged || isRangeChanged || isDescChanged || (localProposal.rangeBrackets && localProposal.rangeBrackets.length > 0)) && (
                      <span className="text-[10px] uppercase font-bold text-indigo-500 tracking-wider mb-1 block">{t.proposedUpdates}</span>
                    )}
                    
                    {isNameChanged && (
                      <DiffRow 
                        label="Name" 
                        oldVal={currentDef.name} 
                        newVal={localProposal.name!} 
                      />
                    )}
                    {isUnitChanged && (
                      <DiffRow 
                        label="Unit" 
                        oldVal={currentDef.unit} 
                        newVal={localProposal.metric!} 
                      />
                    )}
                    {isRangeChanged && (
                      <DiffRow 
                        label="Reference Range" 
                        oldVal={currentDef.normalRange || (currentDef as any).range} 
                        newVal={localProposal.range!} 
                      />
                    )}
                    
                    {localProposal.rangeBrackets && localProposal.rangeBrackets.length > 0 && (
                      <div className="flex flex-col gap-1.5 py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-0">
                        <div className="flex items-center gap-1.5 shrink-0 sm:w-32 mb-1">
                          <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">{t.rangeBrackets}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">
                            Upgraded
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] mb-2">
                          <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 w-14 shrink-0">Before:</span>
                          <span className="line-through text-rose-600 dark:text-rose-400 font-medium bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded border border-rose-200/50 dark:border-rose-800/30">
                            {currentDef.normalRange || (currentDef as any).range || '—'}
                          </span>
                        </div>
                        <div className="flex items-start gap-2 text-[11px]">
                          <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 w-14 shrink-0 mt-1">Proposed:</span>
                          <div className="flex flex-col gap-1 w-full">
                            {localProposal.rangeBrackets.map((b: any, idx: number) => {
                            // Infer max from next bracket's min if max is null
                            let effectiveMax = b.max;
                            if ((effectiveMax === undefined || effectiveMax === null) && idx < localProposal.rangeBrackets.length - 1) {
                              effectiveMax = localProposal.rangeBrackets[idx + 1].min;
                            }
                            // Infer min from prev bracket's max if min is null
                            let effectiveMin = b.min;
                            if ((effectiveMin === undefined || effectiveMin === null) && idx > 0) {
                              effectiveMin = localProposal.rangeBrackets[idx - 1].max;
                            }
                            
                            return (
                              <div key={idx} className="flex items-center gap-2 text-xs">
                                <span className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase tracking-wider ${
                                  (() => {
                                    const num = typeof b.severity === 'number' ? b.severity : (typeof b.severity === 'string' && !isNaN(Number(b.severity)) ? Number(b.severity) : null);
                                    if (num !== null) {
                                      if (num >= 5 || num <= -5) return 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300';
                                      if (num >= 3) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300';
                                      if (num >= 1) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300';
                                      if (num === 0) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300';
                                      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300';
                                    }
                                    const s = String(b.severity || b.label || '').toLowerCase();
                                    if (s.includes('critical') || s.includes('emergency')) return 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300';
                                    if (s.includes('high') || s.includes('elevated') || s.includes('severe')) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300';
                                    if (s.includes('borderline') || s.includes('mild') || s.includes('moderate')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300';
                                    if (s.includes('low') || s.includes('deficient')) return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300';
                                    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300';
                                  })()
                                }`}>
                                  {b.name || b.label || b.alias || 'Range'}
                                </span>
                                <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded border border-indigo-200/50 dark:border-indigo-800/30">
                                  {b.range || (effectiveMin !== undefined && effectiveMin !== null && effectiveMax !== undefined && effectiveMax !== null
                                    ? `${effectiveMin} - ${effectiveMax}`
                                    : effectiveMin !== undefined && effectiveMin !== null
                                    ? `≥ ${effectiveMin}`
                                    : effectiveMax !== undefined && effectiveMax !== null
                                    ? `< ${effectiveMax}`
                                    : '—')}
                                </span>
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {isDescChanged && (
                      <DiffRow 
                        label="Description" 
                        oldVal={currentDef.description || currentDef.descriptions?.en || currentDef.descriptions?.zh || currentDef.descriptions?.fr} 
                        newVal={localProposal.description!} 
                      />
                    )}

                    {localProposal.medicalInsight && (
                      <div className="mt-2 pt-2 border-t border-indigo-100/50 dark:border-indigo-900/30">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300 block mb-1">
                          Diagnostic Insight & Guidance
                        </span>
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-indigo-50/40 dark:bg-indigo-950/30 p-2.5 rounded-lg border border-indigo-100/40 dark:border-indigo-900/20">
                          {localProposal.medicalInsight}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Proposed Log Modifications (History Updates) */}
      {hasModifications && (
        <div className="space-y-3 bg-white/80 dark:bg-slate-900/60 p-3.5 rounded-xl border border-indigo-100/80 dark:border-indigo-800/40 shadow-xs">
          <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>{t.proposedLogModifications}</span>
            <span className="text-[10px] font-normal text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-100/80 dark:bg-indigo-900/50 px-2 py-0.5 rounded-full font-bold">
              {localMods.length} {localMods.length === 1 ? 'entry change' : 'entry changes'}
            </span>
          </div>
          {localMods.map((mod: any, i: number) => {
            const historyOldVal = findOldValInHistory(biomarkerHistory || [], mod.date, mod.keyName);
            const rawOld = mod.oldValue ?? historyOldVal;
            const oldValStr = rawOld !== null && rawOld !== undefined ? String(rawOld) : '';
            const markerName = profile?.customBiomarkers?.[mod.keyName]?.name 
              || biomarkerDefinitions.find(d => d.key === mod.keyName)?.name 
              || mod.keyName;

            return (
              <div key={i} className="flex flex-col gap-2 text-xs p-3 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/70 dark:border-indigo-800/30">
                <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-indigo-200/60 dark:bg-indigo-800/60 text-indigo-900 dark:text-indigo-100 rounded text-[10px] font-mono font-bold">
                      {mod.date}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{markerName}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wide font-extrabold text-indigo-600 dark:text-indigo-400">
                    {mod.action === 'remove_biomarker' ? 'Remove Entry' : 'Update Value'}
                  </span>
                </div>

                {mod.action === 'remove_biomarker' ? (
                  <div className="text-rose-600 dark:text-rose-400 font-medium text-[11px] flex items-center gap-2 pt-0.5">
                    <span>{t.currentColon} <span className="line-through font-bold">{oldValStr || 'Flagged value'}</span></span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="font-bold text-rose-600">{t.entryRemoved}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between bg-white/40 dark:bg-slate-900/30 p-2.5 rounded-lg border border-indigo-100/30 dark:border-indigo-900/10">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-wider">{t.currentColon}</span>
                      <span className="line-through text-rose-500 font-mono font-bold bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded border border-rose-200/40 dark:border-rose-800/20">
                        {oldValStr || 'Unspecified'}
                      </span>
                    </div>

                    <div className="hidden sm:block text-slate-400 font-light">→</div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-wider">Fixed:</span>
                        <input
                          type="text"
                          value={mod.newValue ?? ''}
                          disabled={decisionState !== 'pending'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLocalMods(prev => prev.map((m, idx) => idx === i ? { ...m, newValue: val } : m));
                          }}
                          className="w-20 px-2 py-1 text-xs font-mono font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-center disabled:opacity-75"
                          placeholder="value"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-wider">{t.unitColon}</span>
                        <input
                          type="text"
                          list={`units-list-${i}`}
                          value={localUnits[mod.keyName] || ''}
                          disabled={decisionState !== 'pending'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLocalUnits(prev => ({ ...prev, [mod.keyName]: val }));
                            if (localProposal && mod.keyName === targetKey) {
                              setLocalProposal({ ...localProposal, metric: val });
                            }
                          }}
                          className="w-24 px-2 py-1 text-xs font-bold text-indigo-800 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-75"
                          placeholder="e.g. pg/mL"
                        />
                        <datalist id={`units-list-${i}`}>
                          {COMMON_UNITS.map(unit => (
                            <option key={unit} value={unit} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                  </div>
                )}

                {mod.reason && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 italic pt-1.5 border-t border-indigo-100/40 dark:border-indigo-900/30">
                    Reason: {mod.reason}
                  </div>
                )}
              </div>
            );
          })} 
        </div>
      )}

      {/* Decision Status Badges and Actions */}
      {decisionState === 'accepted' && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{t.proposalChangesSuccessfullyAcceptedAndAp}</span>
          </div>
          <button
            type="button"
            onClick={handleReconsider}
            className="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold hover:underline ml-2 shrink-0 cursor-pointer flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Re-evaluate
          </button>
        </div>
      )}

      {decisionState === 'refused' && (
        <div className="p-3 bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
            <span>{t.proposalDeclinedOriginalSettingsAndRecor}</span>
          </div>
          <button
            type="button"
            onClick={handleAccept}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline ml-2 shrink-0 cursor-pointer flex items-center gap-1"
          >
            <Check className="w-3 h-3" />
            Accept Anyway
          </button>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-indigo-100/50 dark:border-indigo-800/30">
        <button
          type="button"
          onClick={() => {
            if (onDeleteMessage) {
              onDeleteMessage(msg.id);
            } else {
              handleRefuse();
            }
          }}
          className="px-2.5 py-1.5 bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-transparent hover:border-rose-200 dark:hover:border-rose-800/40 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0"
          title={isActionable ? "Dismiss Proposal" : "Dismiss"}
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {decisionState === 'pending' && (
          <button
            type="button"
            onClick={handleAccept}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            {isActionable ? 'Accept Proposal' : 'Acknowledge'}
          </button>
        )}
      </div>
    </div>
  );
};

const DiffRow = ({ label, oldVal, newVal }: { label: string, oldVal?: string, newVal: string }) => {
  const isChanged = Boolean(oldVal && oldVal.trim() !== '' && oldVal.trim() !== newVal.trim());
  const isNew = Boolean(!oldVal || oldVal.trim() === '');

  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 sm:gap-4 py-2 border-b border-slate-100 dark:border-slate-800/50 last:border-0">
      <div className="flex items-center gap-1.5 shrink-0 sm:w-32">
        <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">{label}</span>
        {isChanged && (
          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">
            Changed
          </span>
        )}
      </div>
      
      <div className="flex flex-col gap-1 w-full">
        {isChanged ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 w-14 shrink-0">Before:</span>
              <span className="line-through text-rose-600 dark:text-rose-400 font-medium bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded border border-rose-200/50 dark:border-rose-800/30">
                {oldVal}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 w-14 shrink-0">Proposed:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded border border-emerald-200/50 dark:border-emerald-800/30 break-words">
                {newVal}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 break-words">{newVal}</span>
            {isNew && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300">
                New
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
