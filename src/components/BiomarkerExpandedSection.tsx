import React, { useState } from 'react';
import { ResponsiveContainer, LineChart, XAxis, YAxis, Tooltip, ReferenceLine, Line } from 'recharts';
import { BrainCircuit, LineChart as LineChartIcon, Trash2 } from 'lucide-react';
import { BiomarkerLog, UserProfile } from '../types';
import { BiomarkerDefinition } from '../utils/biomarkers';
import BiomarkerCalculationPanel from './BiomarkerCalculationPanel';

interface BiomarkerExpandedSectionProps {
  def: BiomarkerDefinition;
  profile: UserProfile;
  biomarkerHistory: BiomarkerLog[];
  biomarkers: { [key: string]: number | string };
  onEditBiomarkerLog?: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog?: (id: string) => void;
  onOpenAiReview: (key: string) => void;
  onCombineBiomarker?: (key: string) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  hasPendingAlert?: boolean;
  onDismissAlert?: () => void;
  hideSensitive: boolean;
}

export const BiomarkerExpandedSection: React.FC<BiomarkerExpandedSectionProps> = ({
  def,
  profile,
  biomarkerHistory,
  biomarkers,
  onEditBiomarkerLog,
  onDeleteBiomarkerLog,
  onOpenAiReview,
  onCombineBiomarker,
  onApplyCalculation,
  hasPendingAlert,
  onDismissAlert,
  hideSensitive,
}) => {
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');

  const historyData = biomarkerHistory
    .filter(h => h.biomarkers[def.key] !== undefined)
    .map(h => ({
      date: h.date,
      value: typeof h.biomarkers[def.key] === 'string' ? parseFloat(h.biomarkers[def.key] as string) : Number(h.biomarkers[def.key]),
      originalVal: h.biomarkers[def.key],
      logId: h.id
    }))
    .sort((a, b) => a.date.localeCompare(b.date)); // oldest to newest for chart

  const description = def.descriptions[profile.language as keyof typeof def.descriptions] || def.descriptions.en;

  let normalMin: number | undefined;
  let normalMax: number | undefined;

  if (def.normalRange && def.normalRange !== 'Unknown' && def.normalRange !== 'Negative') {
    const parts = def.normalRange.replace(/[^0-9.-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      if (!isNaN(parseFloat(parts[0]))) normalMin = parseFloat(parts[0]);
      if (!isNaN(parseFloat(parts[1]))) normalMax = parseFloat(parts[1]);
    } else if (parts.length === 1 && !isNaN(parseFloat(parts[0]))) {
      if (def.normalRange.includes('<') || def.normalRange.includes('under')) {
        normalMax = parseFloat(parts[0]);
      } else if (def.normalRange.includes('>') || def.normalRange.includes('over')) {
        normalMin = parseFloat(parts[0]);
      }
    }
  }

  const handleSaveEdit = (logId: string) => {
    if (editValue && !isNaN(Number(editValue))) {
      const log = biomarkerHistory.find(h => h.id === logId);
      if (log && onEditBiomarkerLog) {
        onEditBiomarkerLog(logId, def.key, editValue, editDate || log.date);
      }
    }
    setEditingLogId(null);
  };

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800/60 text-sm">
      <p className="text-slate-600 dark:text-slate-300 text-xs mb-3 leading-relaxed font-medium">
        {description}
      </p>

      {def.benefitRisk && (
        <div className="mb-4 p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/40 dark:border-indigo-800/20 rounded-xl">
          <span className="block font-size-subtitle-small text-indigo-500 font-bold uppercase tracking-wider mb-1">Risk Assessment & Benefits</span>
          <p className="font-size-body text-slate-700 dark:text-slate-300 leading-relaxed font-semibold">
            {def.benefitRisk}
          </p>
        </div>
      )}

      <BiomarkerCalculationPanel
        biomarkerKey={def.key}
        profile={profile}
        currentValue={biomarkers[def.key]}
        onApplyRecommendations={onApplyCalculation}
        hasPendingAlert={hasPendingAlert}
        onDismissAlert={onDismissAlert}
      />

      <div className="mt-4 flex gap-2.5 mb-5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenAiReview(def.key);
          }}
          className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
        >
          <BrainCircuit className="w-4 h-4" />
          Review with AI
        </button>
        {onCombineBiomarker && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCombineBiomarker(def.key);
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"></path>
            </svg>
            Combine
          </button>
        )}
      </div>

      {historyData.length > 1 && (
        <div className="mb-4">
          <h4 className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
            <LineChartIcon className="w-3.5 h-3.5" /> Trend
          </h4>
          <div className="h-32 w-full bg-white dark:bg-slate-900 rounded-xl p-2 border border-slate-200 dark:border-slate-750">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData}>
                <XAxis dataKey="date" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', fontSize: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#64748b' }}
                />
                {normalMax !== undefined && <ReferenceLine y={normalMax} stroke="#f87171" strokeDasharray="3 3" />}
                {normalMin !== undefined && <ReferenceLine y={normalMin} stroke="#f87171" strokeDasharray="3 3" />}
                <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} dot={{ r: 4, fill: '#4f46e5' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {historyData.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Historical Logs</h4>
          <div className="space-y-2">
            {historyData.slice().reverse().map(h => (
              <div key={h.logId} className="flex flex-col bg-white dark:bg-slate-900 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  {editingLogId === h.logId ? (
                    <input 
                      type="date" 
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="form-input-styled text-xs font-mono w-28 text-slate-800 dark:text-slate-100"
                    />
                  ) : (
                    <span className="text-xs font-mono text-slate-500">{h.date}</span>
                  )}
                  <div className="flex items-center gap-3">
                    {editingLogId === h.logId ? (
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="form-input-styled w-16 text-xs text-slate-800 dark:text-slate-100"
                        />
                        <button onClick={() => handleSaveEdit(h.logId)} className="text-indigo-600 font-bold text-xs cursor-pointer">Save</button>
                        <button onClick={() => setEditingLogId(null)} className="text-slate-400 font-bold text-xs cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{hideSensitive ? '***' : h.originalVal} {def.unit}</span>
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            setEditValue(String(h.originalVal)); 
                            setEditDate(h.date);
                            setEditingLogId(h.logId); 
                          }}
                          className="text-indigo-400 hover:text-indigo-600 cursor-pointer"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                        </button>
                        {onDeleteBiomarkerLog && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); onDeleteBiomarkerLog(h.logId); }}
                            className="text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
