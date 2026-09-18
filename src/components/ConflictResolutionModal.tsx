import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState } from 'react';
import { UserProfile, BiomarkerLog, FoodLog } from '../types';
import { X, Cloud, Laptop, Check, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflictData: {
    localProfile: UserProfile;
    cloudProfile: UserProfile;
    localFoods: FoodLog[];
    cloudFoods: FoodLog[];
    localBioHistory: BiomarkerLog[];
    cloudBioHistory: BiomarkerLog[];
    localActions: any[];
    cloudActions: any[];
    localBenefits: any[];
    cloudBenefits: any[];
    cloudReport: any;
    localReport: any;
  } | null;
  onResolve: (biomarkerSource: 'local' | 'cloud', foodSource: 'local' | 'cloud') => Promise<void>;
}

export default function ConflictResolutionModal({
  isOpen,
  onClose,
  conflictData,
  onResolve,
}: ConflictResolutionModalProps) {
  const [biomarkerChoice, setBiomarkerChoice] = useState<'local' | 'cloud'>('cloud');
  const [foodChoice, setFoodChoice] = useState<'local' | 'cloud'>('cloud');
  const [isResolving, setIsResolving] = useState(false);
  const [expandedView, setExpandedView] = useState<{ title: string, logs: any[], type: 'bio' | 'food' } | null>(null);

  if (!isOpen || !conflictData) return null;

  const {
    localProfile,
    cloudProfile,
    localFoods,
    cloudFoods,
    localBioHistory,
    cloudBioHistory,
  } = conflictData;

  const localCustomCount = Object.keys(localProfile.customBiomarkers || {}).length;
  const cloudCustomCount = Object.keys(cloudProfile.customBiomarkers || {}).length;

  const localToApproveCount = Object.keys(localProfile.customBiomarkers || {}).filter(
    k => localProfile.customBiomarkers?.[k]?.needsApproval
  ).length;
  const cloudToApproveCount = Object.keys(cloudProfile.customBiomarkers || {}).filter(
    k => cloudProfile.customBiomarkers?.[k]?.needsApproval
  ).length;

  // Get last 3 logs for visual reference
  const last3LocalBio = [...localBioHistory]
    .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))
    .slice(0, 3);
  const last3CloudBio = [...cloudBioHistory]
    .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))
    .slice(0, 3);

  const last3LocalFoods = [...localFoods]
    .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))
    .slice(0, 3);
  const last3CloudFoods = [...cloudFoods]
    .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))
    .slice(0, 3);

  const handleApplyResolution = async () => {
    setIsResolving(true);
    try {
      await onResolve(biomarkerChoice, foodChoice);
      onClose();
    } catch (e) {
      console.error("Conflict resolution failed", e);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col p-0 bg-slate-950/80 backdrop-blur-md animate-fade-in font-sans">
      <div className="bg-theme-bg-card w-full h-full shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-b border-theme-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                Resolve Synchronization Conflict
              </h2>
              <p className="text-xs text-theme-text-secondary">
                Edits were made on multiple devices. Select which data you want to keep.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Container (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Biomarkers Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                1. Biomarkers &amp; Custom Definitions
              </h3>
              <span className="text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-full font-semibold">
                Keeping: {biomarkerChoice === 'local' ? 'Local Device' : 'Cloud Database'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Local Device Biomarkers */}
              <div 
                onClick={() => setBiomarkerChoice('local')}
                className={`relative cursor-pointer border rounded-2xl p-5 transition-all flex flex-col justify-between ${
                  biomarkerChoice === 'local'
                    ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 ring-2 ring-indigo-500/20'
                    : 'border-theme-border hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/25'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-theme-neutral">
                      <Laptop className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-bold">This Local Device</span>
                    </div>
                    {biomarkerChoice === 'local' && (
                      <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border">
                      <span className="text-slate-400 block mb-0.5">Biomarker Logs</span>
                      <strong className="text-base text-slate-800 dark:text-slate-100">{localBioHistory.length}</strong>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border">
                      <span className="text-slate-400 block mb-0.5">Custom / Approved</span>
                      <strong className="text-base text-slate-800 dark:text-slate-100">
                        {localCustomCount} <span className="text-xs font-normal text-slate-500">({localToApproveCount} pending)</span>
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase block">Last logged entries:</span>
                    {last3LocalBio.length === 0 ? (
                      <span className="text-xs text-slate-400 block italic">No history logged</span>
                    ) : (
                      last3LocalBio.map((log, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-theme-text-secondary border-b border-theme-border/50 pb-1">
                          <span>{log.date}</span>
                          <span className="font-mono text-theme-neutral">
                            {Object.keys(log.biomarkers || {}).length} markers ({Object.keys(log.biomarkers || {}).slice(0, 2).join(', ')}...)
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Cloud Database Biomarkers */}
              <div 
                onClick={() => setBiomarkerChoice('cloud')}
                className={`relative cursor-pointer border rounded-2xl p-5 transition-all flex flex-col justify-between ${
                  biomarkerChoice === 'cloud'
                    ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 ring-2 ring-indigo-500/20'
                    : 'border-theme-border hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/25'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                      <Cloud className="w-4 h-4" />
                      <span className="text-sm font-bold">Cloud Database (Sync)</span>
                    </div>
                    {biomarkerChoice === 'cloud' && (
                      <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border">
                      <span className="text-slate-400 block mb-0.5">Biomarker Logs</span>
                      <strong className="text-base text-slate-800 dark:text-slate-100">{cloudBioHistory.length}</strong>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border">
                      <span className="text-slate-400 block mb-0.5">Custom / Approved</span>
                      <strong className="text-base text-slate-800 dark:text-slate-100">
                        {cloudCustomCount} <span className="text-xs font-normal text-slate-500">({cloudToApproveCount} pending)</span>
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase block">Last logged entries:</span>
                    {last3CloudBio.length === 0 ? (
                      <span className="text-xs text-slate-400 block italic">No history logged</span>
                    ) : (
                      last3CloudBio.map((log, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-theme-text-secondary border-b border-theme-border/50 pb-1">
                          <span>{log.date}</span>
                          <span className="font-mono text-theme-neutral">
                            {Object.keys(log.biomarkers || {}).length} markers ({Object.keys(log.biomarkers || {}).slice(0, 2).join(', ')}...)
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Food Log Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                2. Food &amp; Nutrient History
              </h3>
              <span className="text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-full font-semibold">
                Keeping: {foodChoice === 'local' ? 'Local Device' : 'Cloud Database'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Local Device Food */}
              <div 
                onClick={() => setFoodChoice('local')}
                className={`relative cursor-pointer border rounded-2xl p-5 transition-all flex flex-col justify-between ${
                  foodChoice === 'local'
                    ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 ring-2 ring-indigo-500/20'
                    : 'border-theme-border hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/25'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-theme-neutral">
                      <Laptop className="w-4 h-4 text-slate-500" />
                      <span className="text-sm font-bold">This Local Device</span>
                    </div>
                    {foodChoice === 'local' && (
                      <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border text-xs">
                    <span className="text-slate-400 block mb-0.5">Total Food Logs</span>
                    <strong className="text-base text-slate-800 dark:text-slate-100">{localFoods.length} entries</strong>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase block">Last food entries:</span>
                    {last3LocalFoods.length === 0 ? (
                      <span className="text-xs text-slate-400 block italic">No food logged</span>
                    ) : (
                      last3LocalFoods.map((log, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-theme-text-secondary border-b border-theme-border/50 pb-1">
                          <span>{log.date}</span>
                          <span className="truncate max-w-[150px] font-semibold text-theme-neutral">{log.name}</span>
                          <span>{log.nutrients?.calories || 0} kcal</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Cloud Database Food */}
              <div 
                onClick={() => setFoodChoice('cloud')}
                className={`relative cursor-pointer border rounded-2xl p-5 transition-all flex flex-col justify-between ${
                  foodChoice === 'cloud'
                    ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 ring-2 ring-indigo-500/20'
                    : 'border-theme-border hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/25'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                      <Cloud className="w-4 h-4" />
                      <span className="text-sm font-bold">Cloud Database (Sync)</span>
                    </div>
                    {foodChoice === 'cloud' && (
                      <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border text-xs">
                    <span className="text-slate-400 block mb-0.5">Total Food Logs</span>
                    <strong className="text-base text-slate-800 dark:text-slate-100">{cloudFoods.length} entries</strong>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase block">Last food entries:</span>
                    {last3CloudFoods.length === 0 ? (
                      <span className="text-xs text-slate-400 block italic">No food logged</span>
                    ) : (
                      last3CloudFoods.map((log, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-theme-text-secondary border-b border-theme-border/50 pb-1">
                          <span>{log.date}</span>
                          <span className="truncate max-w-[150px] font-semibold text-theme-neutral">{log.name}</span>
                          <span>{log.nutrients?.calories || 0} kcal</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-theme-border flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-theme-border text-theme-text-secondary font-bold text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Resolve Later
          </button>
          <button
            onClick={handleApplyResolution}
            disabled={isResolving}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
          >
            {isResolving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving Decisions...
              </>
            ) : (
              <>
                Confirm &amp; Resolve Sync
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

      </div>

      {expandedView && (
        <div className="absolute inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-theme-bg-card rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-theme-border animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-theme-border">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">{expandedView.title}</h3>
              <button
                onClick={() => setExpandedView(null)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh] space-y-2">
              {expandedView.logs.map((log, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm text-theme-text-secondary border-b border-theme-border/50 pb-2 mb-2 last:border-0 last:pb-0 last:mb-0">
                  <span className="font-medium">{log.date}</span>
                  {expandedView.type === 'bio' ? (
                    <span className="font-mono text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                      {Object.keys(log.biomarkers || {}).length} markers ({Object.keys(log.biomarkers || {}).slice(0, 3).join(', ')}...)
                    </span>
                  ) : (
                    <div className="flex flex-col items-end">
                      <span className="truncate max-w-[200px] font-semibold text-theme-neutral">{log.name}</span>
                      <span className="text-xs">{log.nutrients?.calories || 0} kcal</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
