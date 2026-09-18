import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useMemo } from 'react';
import { UserProfile, BiomarkerLog } from '../types';
import { BiomarkerDefinition, getBiomarkerMetadata, getPhysiologicalBucket, BIOMARKER_GROUPING_OPTIONS } from '../utils/biomarkers';
import { X, Trash2, Search, ArrowRight, Merge, Info, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface CombineBiomarkersModalProps {
  profile: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  initialKey?: string;
  initialSelectedKeys?: string[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  allDefinitions: BiomarkerDefinition[];
  onSaveCombine: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string },
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onReviewWithAgent?: (keys: string[]) => void;
}

export default function CombineBiomarkersModal({
  profile,
  isOpen,
  onClose,
  initialKey,
  initialSelectedKeys,
  biomarkers,
  biomarkerHistory,
  allDefinitions,
  onSaveCombine,
  onReviewWithAgent,
}: CombineBiomarkersModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialSelectedKeys || (initialKey ? [initialKey] : []));
  const [searchQuery, setSearchQuery] = useState('');
  const [groupType, setGroupType] = useState<'risk' | 'practice' | 'condition'>('risk');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Fields for Step 2
  const [editedKey, setEditedKey] = useState('');
  const [editedName, setEditedName] = useState('');
  const [editedUnit, setEditedUnit] = useState('');
  const [editedRange, setEditedRange] = useState('');
  const [editedDescription, setEditedDescription] = useState('');

  // Combined logs list for Step 2
  const [logsToKeep, setLogsToKeep] = useState<{ id: string; originalLogId: string; date: string; value: number | string; originalKey: string }[]>([]);

  // Get all active keys that have data in history or biomarkers
  const activeKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.keys(biomarkers).forEach(k => keys.add(k));
    biomarkerHistory.forEach(h => {
      Object.keys(h.biomarkers).forEach(k => keys.add(k));
    });
    return Array.from(keys);
  }, [biomarkers, biomarkerHistory]);

  const initialDef = allDefinitions.find(d => d.key === initialKey);

  // Filter other biomarkers for Step 1 selection
  const otherBiomarkers = useMemo(() => {
    return activeKeys
      .filter(k => k !== initialKey)
      .map(k => {
        const def = allDefinitions.find(d => d.key === k);
        return {
          key: k,
          name: def?.name || k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          unit: def?.unit || '',
          category: def?.category || 'other'
        };
      })
      .filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()) || b.key.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [activeKeys, allDefinitions, initialKey, searchQuery]);

  const toggleSelectKey = (key: string) => {
    setSelectedKeys(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  const handleGoToStep2 = () => {
    if (selectedKeys.length <= 1) return;

    // Determine base key with the most log data points in history
    let baseKey = initialKey || selectedKeys[0];
    let maxLogsCount = 0;

    selectedKeys.forEach(k => {
      const count = biomarkerHistory.filter(h => h.biomarkers[k] !== undefined).length;
      if (count > maxLogsCount) {
        maxLogsCount = count;
        baseKey = k;
      }
    });

    const baseDef = allDefinitions.find(d => d.key === baseKey);
    const baseName = baseDef?.name || baseKey?.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    // Strip brackets/parentheses from pre-populated name
    const simpleName = baseName.split('(')[0].split('[')[0].trim();

    setEditedName(simpleName);
    setEditedUnit(baseDef?.unit || '');
    setEditedRange(baseDef?.normalRange || 'Unknown');
    setEditedDescription(baseDef?.descriptions?.en || '');

    // Gather all historical logs for selected keys
    const combinedLogs: { id: string; originalLogId: string; date: string; value: number | string; originalKey: string }[] = [];
    selectedKeys.forEach(k => {
      biomarkerHistory.forEach(h => {
        if (h.biomarkers[k] !== undefined) {
          combinedLogs.push({
            id: `${h.id}_${k}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            originalLogId: h.id,
            date: h.date,
            value: h.biomarkers[k],
            originalKey: k
          });
        }
      });
    });

    // Sort logs descending by date, but prefer initialKey for same dates
    combinedLogs.sort((a, b) => {
      if (a.date === b.date) {
        if (a.originalKey === initialKey) return -1;
        if (b.originalKey === initialKey) return 1;
        return 0;
      }
      return toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date));
    });
    
    const uniqueLogs: typeof combinedLogs = [];
    const seenDates = new Set<string>();
    for (const log of combinedLogs) {
      if (!seenDates.has(log.date)) {
        seenDates.add(log.date);
        uniqueLogs.push(log);
      }
    }

    setLogsToKeep(uniqueLogs);
    setStep(2);
  };

  const handleDeleteLogItem = (id: string) => {
    setLogsToKeep(prev => prev.filter(l => l.id !== id));
  };

  const handleSave = () => {
    if (!editedName.trim()) return;

    // Normalize target key from edited name
    const cleanName = editedName.split('(')[0].split('[')[0].trim();
    
    // Find if it matches standard definitions
    const stdMatch = allDefinitions.find(d => d.name.toLowerCase() === cleanName.toLowerCase() || d.key.toLowerCase() === cleanName.toLowerCase());
    const targetKey = stdMatch ? stdMatch.key : cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const targetDef = {
      name: cleanName,
      unit: editedUnit,
      normalRange: editedRange,
      description: editedDescription
    };

    const finalLogs = logsToKeep.map(log => ({
      date: log.date,
      value: log.value,
      originalLogId: log.originalLogId
    })).sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    onSaveCombine(targetKey, targetDef, finalLogs, selectedKeys);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex flex-col p-0 animation-fade-in font-sans">
      <div className="w-full h-full bg-white dark:bg-slate-950 flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-theme-border/80 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/10 flex items-center justify-center text-indigo-600">
              <Merge className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-theme-text font-display">
                Combine Duplicate Biomarkers
              </h3>
              <p className="text-[10px] text-slate-400 font-mono">
                Source: {initialDef?.name || initialKey || selectedKeys[0]}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="bg-indigo-600 dark:bg-indigo-950/40 p-3.5 border border-indigo-500/30 dark:border-indigo-800/20 rounded-2xl flex gap-3">
                <Info className="w-5 h-5 text-indigo-100 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-white dark:text-indigo-100 font-medium leading-relaxed mb-1.5">
                    Select other similar or duplicate biomarkers to combine with <strong>{initialDef?.name || initialKey || selectedKeys[0]}</strong>. All historic logs will be merged under a single consolidated marker.
                  </p>
                  <span className="inline-block text-[10px] font-extrabold bg-white/20 dark:bg-indigo-950 text-white dark:text-indigo-300 px-2 py-0.5 rounded-md">
                    {selectedKeys.length} biomarkers selected
                  </span>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search other active biomarkers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-theme-border rounded-xl text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 dark:text-slate-100"
                />
              </div>

              {/* Group By Selector */}
              <div className="flex items-center justify-between gap-2 border-t border-b border-theme-border py-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Group By:</span>
                <select
                  value={groupType}
                  onChange={(e) => setGroupType(e.target.value as any)}
                  className="px-2.5 py-1 text-xs font-semibold bg-theme-bg-card text-slate-700 dark:text-slate-200 border border-theme-border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
                >
                  {BIOMARKER_GROUPING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Checklist / Accordion */}
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {(() => {
                  if (otherBiomarkers.length === 0) {
                    return <p className="text-center text-xs text-slate-400 py-4">No other active biomarkers found matching filter.</p>;
                  }

                  // Group items
                  const groups: Record<string, typeof otherBiomarkers> = {};
                  otherBiomarkers.forEach(ob => {
                    const meta = getBiomarkerMetadata(ob.key, profile.customBiomarkers?.[ob.key]);
                    if (groupType === 'risk') {
                      const cats = meta.riskCategories && meta.riskCategories.length > 0 ? meta.riskCategories : ['General Health'];
                      cats.forEach(c => {
                        if (!groups[c]) groups[c] = [];
                        groups[c].push(ob);
                      });
                    } else if (groupType === 'practice') {
                      const practice = meta.standardMedicalGrouping || 'Other';
                      if (!groups[practice]) groups[practice] = [];
                      groups[practice].push(ob);
                    } else if (groupType === 'condition') {
                      const conditions = meta.potentialMedicalConditions && meta.potentialMedicalConditions.length > 0 ? meta.potentialMedicalConditions : ['General Health'];
                      conditions.forEach(c => {
                        if (!groups[c]) groups[c] = [];
                        groups[c].push(ob);
                      });
                    }
                  });

                  const groupNames = Object.keys(groups).sort();

                  return groupNames.map(groupName => {
                    const itemsInGroup = groups[groupName];
                    const selectedInGroup = itemsInGroup.filter(ob => selectedKeys.includes(ob.key));
                    const isExpanded = expandedGroups[groupName] !== false;

                    const toggleGroup = () => {
                      setExpandedGroups(prev => ({
                        ...prev,
                        [groupName]: !isExpanded
                      }));
                    };

                    return (
                      <div key={groupName} className="border border-theme-border rounded-2xl overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
                        <div 
                          onClick={toggleGroup}
                          className="flex items-center justify-between p-3.5 bg-slate-50/80 dark:bg-slate-900/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 cursor-pointer select-none transition-colors border-b border-theme-border"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-theme-neutral">{groupName}</span>
                            <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-theme-text-secondary px-1.5 py-0.5 rounded-full font-bold">
                              {itemsInGroup.length}
                            </span>
                            {selectedInGroup.length > 0 && (
                              <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">
                                {selectedInGroup.length} selected
                              </span>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>

                        {isExpanded && (
                          <div className="p-3 space-y-2 bg-white dark:bg-slate-950 divide-y divide-slate-100 dark:divide-slate-805">
                            {itemsInGroup.map(ob => {
                              const isSelected = selectedKeys.includes(ob.key);
                              return (
                                <div
                                  key={ob.key}
                                  onClick={() => toggleSelectKey(ob.key)}
                                  className={`p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50/20 dark:bg-indigo-950/10' : ''}`}
                                >
                                  <div className="min-w-0 pr-3">
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate">
                                      {ob.name}
                                    </span>
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                                      {ob.category} {ob.unit ? `(${ob.unit})` : ''}
                                    </span>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {}} // handled by div click
                                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50/50 dark:bg-amber-950/20 p-3.5 border border-amber-100/40 dark:border-amber-800/20 rounded-2xl flex gap-3">
                <Info className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-650 dark:text-slate-350 leading-relaxed">
                  Review the merged fields and the combined log data. You can delete duplicate or faulty log points below before saving.
                </p>
              </div>

              {/* Form fields */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 border border-slate-150 dark:border-slate-800 rounded-2xl space-y-3.5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                      Consolidated Biomarker Key (snake_case)
                    </label>
                    <input
                      type="text"
                      value={editedKey}
                      onChange={(e) => setEditedKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-750 bg-theme-bg-card rounded-xl text-xs font-mono font-semibold focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                      placeholder="e.g. hba1c"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                      Consolidated Biomarker Name
                    </label>
                    <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-750 bg-theme-bg-card rounded-xl text-xs font-semibold focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                    placeholder="e.g. HbA1c"
                  />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                      Measurement Unit
                    </label>
                    <input
                      type="text"
                      value={editedUnit}
                      onChange={(e) => setEditedUnit(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-750 bg-theme-bg-card rounded-xl text-xs font-semibold focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                      placeholder="e.g. % or mg/dL"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                      Normal Range Reference
                    </label>
                    <input
                      type="text"
                      value={editedRange}
                      onChange={(e) => setEditedRange(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-750 bg-theme-bg-card rounded-xl text-xs font-semibold focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                      placeholder="e.g. 4.0 - 5.6"
                    />
                  </div>
                </div>
              </div>

              {/* Combined Historical Logs List */}
              <div className="space-y-2">
                <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                  Combined Historical Logs ({logsToKeep.length})
                </span>
                <div className="border border-slate-150 dark:border-slate-800/80 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60 max-h-56 overflow-y-auto">
                  {logsToKeep.length === 0 ? (
                    <p className="p-4 text-center text-xs text-slate-400">All logs deleted. Please add or keep at least one log.</p>
                  ) : (
                    logsToKeep.map((log) => {
                      const def = allDefinitions.find(d => d.key === log.originalKey);
                      return (
                        <div key={log.id} className="p-3 bg-white dark:bg-slate-950 flex items-center justify-between text-xs gap-3">
                          <div className="min-w-0 flex-1">
                            <span className="font-mono font-semibold text-slate-500 block">{log.date}</span>
                            <span className="text-[10px] text-slate-400 truncate block">
                              Source: {def?.name || log.originalKey}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-850 dark:text-slate-200 font-mono">
                              {log.value} {editedUnit}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteLogItem(log.id)}
                              className="text-slate-400 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 dark:bg-slate-900/60 border-t border-theme-border/80 px-5 py-4 flex gap-3 justify-end">
          {step === 1 ? (
            <>
              {onReviewWithAgent && (
                <button
                  type="button"
                  onClick={() => {
                    onReviewWithAgent(selectedKeys);
                    onClose();
                  }}
                  className="mr-auto px-3 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Review with Agent"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Review with Agent</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-theme-bg-card text-slate-500 border border-theme-border rounded-xl text-xs font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedKeys.length <= 1}
                onClick={handleGoToStep2}
                className={`px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/10 transition-all ${selectedKeys.length <= 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-700'}`}
              >
                <span>Review & Merge</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-theme-bg-card text-slate-500 border border-theme-border rounded-xl text-xs font-bold hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={logsToKeep.length === 0}
                onClick={handleSave}
                className={`px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/10 transition-all ${logsToKeep.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-700'}`}
              >
                <Merge className="w-4 h-4" />
                <span>Save Consolidated Biomarker</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
