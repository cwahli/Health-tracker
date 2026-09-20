import React, { useState, Suspense } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Terminal } from 'lucide-react';
import { ChatMessage, FoodLog, UserProfile } from '../types';
import { biomarkerDefinitions, getBiomarkerStatusLabel } from '../utils/biomarkers';
import { displayStatusLabel } from '../utils/i18n';
import { auth } from '../firebase';
import { safeIdbSet } from '../utils/storageUtils';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const FullScreenLogViewer = lazyWithRetry(() => import('./FullScreenLogViewer'));

export interface DataUsedByAgentPanelProps {
  isAgent: (agent: string) => boolean;
  t: any;
  messages: ChatMessage[];
  agentType?: string | null;
  setActiveInstructionAgentType: (v: string | null) => void;
  setActiveInstructionPrompt: (v: string | null) => void;
  profile?: UserProfile | null;
  reviewBiomarkerKey?: string;
  dataReviewBatchKeys?: string[] | null;
  biomarkers?: { [key: string]: number | string };
  biomarkerHistory?: any[];
  dataReviewBatchIdx?: number | string | null;
  localBatchSize: number;
  setLocalBatchSize: (v: number) => void;
  budget: string;
  setBudget: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  maxDistance: number;
  setMaxDistance: (v: number) => void;
  userLocation?: { lat: number; lng: number } | null;
  activeFoodLogs: FoodLog[];
  activeHistory: any[];
  outOfRangeBiomarkers: any[];
  remainingAllowance: any;
  lastSentPayload: any;
  getWelcomeMessage: () => ChatMessage;
  setMessages: (messages: any, resetTurnId?: boolean) => void;
  setLastSentPayload: (payload: any) => void;
  payloadStorageKey: string;
  chatStorageKey: string;
  activeConversationId?: string | null;
}

export const DataUsedByAgentPanel: React.FC<DataUsedByAgentPanelProps> = ({
  isAgent,
  t,
  messages,
  agentType,
  setActiveInstructionAgentType,
  setActiveInstructionPrompt,
  profile,
  reviewBiomarkerKey,
  dataReviewBatchKeys,
  biomarkers,
  biomarkerHistory,
  dataReviewBatchIdx,
  localBatchSize,
  setLocalBatchSize,
  budget,
  setBudget,
  currency,
  setCurrency,
  maxDistance,
  setMaxDistance,
  userLocation,
  activeFoodLogs,
  activeHistory,
  outOfRangeBiomarkers,
  remainingAllowance,
  lastSentPayload,
  getWelcomeMessage,
  setMessages,
  setLastSentPayload,
  payloadStorageKey,
  chatStorageKey,
  activeConversationId,
}) => {
  const [showDataUsed, setShowDataUsed] = useState(false);
  const [showFullScreenConv, setShowFullScreenConv] = useState(false);
  const [isSendingLogs, setIsSendingLogs] = useState(false);
  const [logsSendStatus, setLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');

  if (!isAgent('food') && !isAgent('food_idea') && !isAgent('medical')) {
    return null;
  }

  const handleSendLogToAdmin = async () => {
    setIsSendingLogs(true);
    setLogsSendStatus('idle');
    try {
      const logsText = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
      const sessionId = auth.currentUser?.uid || 'anonymous';
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        },
        body: JSON.stringify({ logsText }),
      });
      if (res.ok) {
        setLogsSendStatus('success');
        const subject = encodeURIComponent(`Healthy App Food Chat Logs - User ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,\nHere is the compiled food log history for user ${sessionId}:\n${logsText}`);
        window.open(`mailto:cwah.liu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      } else {
        setLogsSendStatus('error');
      }
    } catch (err) {
      console.error("Error sending logs:", err);
      setLogsSendStatus('error');
    } finally {
      setIsSendingLogs(false);
      setTimeout(() => setLogsSendStatus('idle'), 4000);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-900/55 rounded-xl px-4 py-2.5 mb-4 border border-theme-border/20">
      <button
        type="button"
        onClick={() => setShowDataUsed(!showDataUsed)}
        className="w-full flex items-center justify-between text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold cursor-pointer transition-colors"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold font-sans text-theme-text-secondary">
          {t.dataUsedByAgent}
        </span>
        <div className="flex items-center text-slate-400 dark:text-slate-500">
          {showDataUsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>
      {showDataUsed && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-200/50 dark:border-slate-800/50 space-y-3.5 text-theme-text-secondary font-sans leading-normal">
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => {
                let targetAgent = 'agent1';
                let targetPrompt = null;
                if (isAgent('food')) {
                  targetAgent = 'food';
                  const lastMsgWithStep = [...messages].reverse().find(m => m.data?.agentResult?.agentPrompt);
                  targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                }
                else if (isAgent('food_idea')) {
                  targetAgent = 'food_idea';
                  const lastMsgWithStep = [...messages].reverse().find(m => m.data?.pendingFoodIdeas && m.data?.agentResult?.agentPrompt);
                  targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                }
                else {
                  const lastMsgWithStep = [...messages].reverse().find(m => m.agentTypeStep || m.agentType);
                  targetAgent = lastMsgWithStep?.agentType || agentType || 'agent1';
                  targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                }
                setActiveInstructionAgentType(targetAgent);
                setActiveInstructionPrompt(targetPrompt);
              }}
              className="flex-1 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            >
              <span>ℹ️ View Instructions</span>
            </button>
            <button
              type="button"
              onClick={() => setShowFullScreenConv(true)}
              className="flex-1 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm text-center"
            >
              <Terminal className="w-4 h-4 text-indigo-500" />
              <span>📜 View Log History</span>
            </button>
          </div>
          {/* Profile Stats */}
          <div className="grid grid-cols-2 gap-2.5 font-size-xs bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30">
            <div>
              <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Demographics</span>
              <span className="font-bold text-slate-700 dark:text-slate-200">{(profile?.age) || 'Unknown'} yo • {profile?.gender || 'Unknown'} • {profile?.ethnicity || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Body Metrics</span>
              <span className="font-bold text-slate-700 dark:text-slate-200">{profile?.weight || 'Unknown'} kg • {profile?.height || 'Unknown'} cm (BMI: {profile?.weight && profile?.height ? (Number(profile.weight) / Math.pow(Number(profile.height) / 100, 2)).toFixed(1) : 'Unknown'})</span>
            </div>
          </div>
          {(agentType === 'biomarker_review' || reviewBiomarkerKey) && (
            <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-200/60 dark:border-indigo-800/40 text-xs space-y-1.5 font-sans mt-2">
              <div className="font-bold text-indigo-950 dark:text-indigo-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Focus Biomarker Data Sent to AI
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-indigo-200/80 dark:bg-indigo-800/80 text-indigo-900 dark:text-indigo-100 rounded-full font-mono font-bold">
                  {reviewBiomarkerKey || (dataReviewBatchKeys && dataReviewBatchKeys.length > 0 ? `${dataReviewBatchKeys.length} Biomarkers` : 'General')}
                </span>
              </div>
              {reviewBiomarkerKey ? (() => {
                const def = profile?.customBiomarkers?.[reviewBiomarkerKey] || biomarkerDefinitions.find(d => d.key === reviewBiomarkerKey);
                const rawCur = (biomarkers?.[reviewBiomarkerKey] || null) as any;
                const valStr = rawCur && typeof rawCur === 'object' && 'value' in rawCur ? String(rawCur.value) : (rawCur !== undefined && rawCur !== null ? String(rawCur) : '');
                const unitStr = rawCur && typeof rawCur === 'object' && 'unit' in rawCur ? String(rawCur.unit || '') : (def?.unit || '');
                const rangeStr = rawCur && typeof rawCur === 'object' && 'normalRange' in rawCur ? String(rawCur.normalRange || '') : (def?.normalRange || 'Standard reference range');
                const histLogs = (biomarkerHistory || []).filter(h => h.biomarkers && h.biomarkers[reviewBiomarkerKey] !== undefined && h.biomarkers[reviewBiomarkerKey] !== '');
                return (
                  <div className="text-slate-700 dark:text-slate-300 space-y-1 pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
                    <div><span className="font-semibold text-slate-500 dark:text-slate-400">Name:</span> <span className="font-bold">{def?.name || reviewBiomarkerKey}</span></div>
                    <div><span className="font-semibold text-slate-500 dark:text-slate-400">Latest Logged:</span> <span className="font-bold">{valStr ? `${valStr} ${unitStr}` : 'No value logged yet'}</span></div>
                    <div><span className="font-semibold text-slate-500 dark:text-slate-400">Standard Range:</span> <span className="font-bold">{rangeStr}</span></div>
                    <div><span className="font-semibold text-slate-500 dark:text-slate-400">Historical Records:</span> <span className="font-bold text-indigo-600 dark:text-indigo-400">{histLogs.length} test records attached</span></div>
                  </div>
                );
              })() : dataReviewBatchKeys && dataReviewBatchKeys.length > 0 ? (
                <div className="text-slate-700 dark:text-slate-300 space-y-1 pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
                  <div><span className="font-semibold text-slate-500 dark:text-slate-400">Batch Review:</span> <span className="font-bold">{dataReviewBatchKeys.map(k => profile?.customBiomarkers?.[k]?.name || biomarkerDefinitions.find(d => d.key === k)?.name || k).join(', ')}</span></div>
                  <div><span className="font-semibold text-slate-500 dark:text-slate-400">Mode:</span> <span className="font-bold text-indigo-600 dark:text-indigo-400">Multi-Biomarker Simultaneous AI Review</span></div>
                </div>
              ) : null}
            </div>
          )}
          {isAgent('medical') && dataReviewBatchIdx !== null && (
            <div className="mt-2.5">
              <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Agent Batch Size</span>
                <input 
                    type="number"
                    value={localBatchSize}
                    onChange={(e) => setLocalBatchSize(Number(e.target.value))}
                    placeholder="Number of items per batch..."
                    className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                />
              </div>
            </div>
          )}
          {isAgent('food_idea') && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                  <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Budget</span>
                  <input 
                      type="number"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="Enter budget..."
                      className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                  />
                </div>
                <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                  <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Currency</span>
                  <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                  >
                    <option value="IDR" className="bg-slate-100 dark:bg-slate-900">IDR (Rp)</option>
                    <option value="GBP" className="bg-slate-100 dark:bg-slate-900">GBP (£)</option>
                    <option value="USD" className="bg-slate-100 dark:bg-slate-900">USD ($)</option>
                    <option value="EUR" className="bg-slate-100 dark:bg-slate-900">EUR (€)</option>
                    <option value="AUD" className="bg-slate-100 dark:bg-slate-900">AUD ($)</option>
                    <option value="SGD" className="bg-slate-100 dark:bg-slate-900">SGD ($)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                  <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Distance</span>
                  <select
                      value={maxDistance}
                      onChange={(e) => setMaxDistance(parseFloat(e.target.value) || 3)}
                      className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                  >
                    <option value="0.5" className="bg-slate-100 dark:bg-slate-900">0.5 km</option>
                    <option value="1" className="bg-slate-100 dark:bg-slate-900">1 km</option>
                    <option value="2" className="bg-slate-100 dark:bg-slate-900">2 km</option>
                    <option value="3" className="bg-slate-100 dark:bg-slate-900">3 km</option>
                    <option value="5" className="bg-slate-100 dark:bg-slate-900">5 km</option>
                    <option value="7" className="bg-slate-100 dark:bg-slate-900">7 km</option>
                    <option value="10" className="bg-slate-100 dark:bg-slate-900">10 km</option>
                  </select>
                </div>
                <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                  <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Location</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200 truncate block mt-0.5">
                    {userLocation ? `📍 ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : '❌ Not available'}
                  </span>
                </div>
              </div>
              <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Last 20 Meals</span>
                <span className="font-bold text-slate-700 dark:text-slate-200 max-h-20 overflow-y-auto block whitespace-pre-wrap">
                  {(activeFoodLogs || []).slice(-20).map(f => f.name).join(', ') || 'No meals logged yet'}
                </span>
              </div>
            </>
          )}
          {agentType && (
            <div className="space-y-2">
              <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Biomarker History Logs</span>
                <details className="group cursor-pointer">
                  <summary className="font-bold text-slate-700 dark:text-slate-200 select-none">
                    {activeHistory.length || 0} historic logs
                  </summary>
                  <div className="mt-2 text-[10px] font-mono text-slate-500 max-h-32 overflow-y-auto pl-2 border-l-2 border-theme-border">
                    {activeHistory.map((h, i) => (
                      <div key={i} className="mb-1">{h.date}: {Object.keys(h.biomarkers || {}).length} markers</div>
                    ))}
                  </div>
                </details>
              </div>
              <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Checked Biomarker Values ({biomarkers ? Object.keys(biomarkers).length : 0})</span>
                {biomarkers && Object.keys(biomarkers).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1 max-h-32 overflow-y-auto">
                    {Object.entries(biomarkers || {}).map(([key, value]) => {
                      const def = (profile?.customBiomarkers && profile.customBiomarkers[key]) || biomarkerDefinitions[key] || { name: key, unit: '' };
                      return (
                        <span key={key} className="px-2 py-1 bg-theme-bg-card border border-theme-border rounded text-[10px] font-mono text-theme-neutral">
                          {def.name}: <strong className="text-indigo-600 dark:text-indigo-400">{value}</strong> <span className="text-slate-400">{def.unit}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-slate-450 dark:text-slate-500 italic font-size-xs block mt-1">No biomarker data available.</span>
                )}
              </div>
            </div>
          )}
          {/* Warning Biomarkers */}
          {(isAgent('food') || isAgent('food_idea')) && (
            <div>
              <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Important Biomarkers Needing Improvement</span>
              {outOfRangeBiomarkers.length > 0 ? (
                <div className="space-y-1">
                  {outOfRangeBiomarkers.map(b => (
                    <div key={b.key} className="flex items-center justify-between font-size-xs font-mono bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-950/30 px-2 py-1 rounded-lg">
                      <span className="font-sans font-bold text-theme-neutral">{b.name}</span>
                      <span className="text-rose-600 dark:text-rose-450 font-black">
                        {b.value} {b.unit} ({displayStatusLabel(profile?.language, getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile))})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-slate-450 dark:text-slate-500 italic font-size-xs">{t.allActiveBiomarkersNormal || 'All active biomarkers are within normal reference ranges.'}</span>
              )}
            </div>
          )}
          {/* Remaining Daily Allowances */}
          {(isAgent('food') || isAgent('food_idea')) && (
            <div>
              <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-2">{t.nutrientTargetsRollingStatus || 'Nutrient Targets & 7-Day Rolling Status'}</span>
              <div className="grid grid-cols-3 gap-2">
                {/* Calories Card */}
                <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2.5 rounded-xl flex flex-col justify-between">
                  <div>
                    <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-1">{t.caloriesLabel || 'Calories'}</span>
                    <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200 block">
                      {remainingAllowance.calories} <span className="text-[10px] text-slate-400 font-normal">{t.kcalLeft || 'kcal left'}</span>
                    </span>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] space-y-0.5 text-slate-500 dark:text-slate-400">
                    <div>{t.todayColon || 'Today:'} <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{remainingAllowance.caloriesLogged || 0}/{remainingAllowance.caloriesTarget}</span></div>
                    <div>{t.sevenDayAvg || '7d Avg:'} <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(remainingAllowance.averages?.calories || 0)}</span></div>
                  </div>
                </div>
                {/* Sat. Fat Card */}
                <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2.5 rounded-xl flex flex-col justify-between">
                  <div>
                    <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-1">{t.satFatLabel || 'Sat Fat'}</span>
                    <span className={`font-mono text-sm font-bold block ${remainingAllowance.saturatedFat === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                      {remainingAllowance.saturatedFat.toFixed(1)} <span className="text-[10px] text-slate-400 font-normal font-sans">{t.gLeft || 'g left'}</span>
                    </span>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] space-y-0.5 text-slate-500 dark:text-slate-400">
                    <div>{t.todayColon || 'Today:'} <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{(remainingAllowance.saturatedFatLogged || 0).toFixed(1)}/{remainingAllowance.saturatedFatTarget}</span></div>
                    <div>{t.sevenDayAvg || '7d Avg:'} <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{(remainingAllowance.averages?.saturatedFat || 0).toFixed(1)}</span></div>
                  </div>
                </div>
                {/* Sodium Card */}
                <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2.5 rounded-xl flex flex-col justify-between">
                  <div>
                    <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-1">{t.sodiumLabel || 'Sodium'}</span>
                    <span className={`font-mono text-sm font-bold block ${remainingAllowance.sodium === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                      {remainingAllowance.sodium} <span className="text-[10px] text-slate-400 font-normal">{t.mgLeft || 'mg left'}</span>
                    </span>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] space-y-0.5 text-slate-500 dark:text-slate-400">
                    <div>{t.todayColon || 'Today:'} <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{remainingAllowance.sodiumLogged || 0}/{remainingAllowance.sodiumTarget}</span></div>
                    <div>{t.sevenDayAvg || '7d Avg:'} <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(remainingAllowance.averages?.sodium || 0)}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Conversation Log History */}
          <div className="border border-theme-border rounded-xl bg-slate-100/50 dark:bg-slate-950/20 p-3 mt-3 space-y-2 text-left">
            <div className="flex items-center justify-between">
              <span className="text-indigo-650 dark:text-indigo-400 font-bold block text-[10px] uppercase tracking-wider">
                📡 Real-Time Full Agent Request Payload & Log
              </span>
              <button
                type="button"
                onClick={() => {
                  let logTxt = lastSentPayload ? JSON.stringify(lastSentPayload, null, 2) : messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                  if (isAgent('medical')) {
                    logTxt = `=== PAYLOAD ===\n` + logTxt;
                  }
                  navigator.clipboard.writeText(logTxt);
                }}
                className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-theme-text-secondary transition-colors cursor-pointer"
              >
                Copy Log
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowFullScreenConv(true)}
              className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm animate-fade-in mb-2"
            >
              <span>🔍 View Log</span>
            </button>
            {showFullScreenConv && (
              <Suspense fallback={null}>
                <FullScreenLogViewer
                  isOpen={showFullScreenConv}
                  onClose={() => setShowFullScreenConv(false)}
                  title="Full Agent Request Payload & Log"
                  logsText={(() => {
                    const msgLog = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                    let logTxt = lastSentPayload ? `=== PAYLOAD ===\n${JSON.stringify(lastSentPayload, null, 2)}\n\n=== CONVERSATION ===\n${msgLog}` : msgLog;
                    if (isAgent('medical')) {
                      logTxt += `\n\n[Medical Profile]\n${JSON.stringify(profile, null, 2)}`;
                    }
                    return logTxt;
                  })()}
                  logsArray={(() => {
                    const arr = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`);
                    if (lastSentPayload) {
                      arr.unshift(`=== PAYLOAD ===\n${JSON.stringify(lastSentPayload, null, 2)}`);
                    }
                    if (isAgent('medical')) {
                      arr.push(`[Medical Profile]\n${JSON.stringify(profile, null, 2)}`);
                    }
                    return arr;
                  })()}
                  onSendToAdmin={handleSendLogToAdmin}
                  isSendingLogs={isSendingLogs}
                  logsSendStatus={logsSendStatus}
                  onClearLogs={async () => {
                    const welcome = getWelcomeMessage();
                    setMessages([welcome], true);
                    setLastSentPayload(null);
                    sessionStorage.removeItem(payloadStorageKey);
                    sessionStorage.removeItem(chatStorageKey);
                    localStorage.removeItem(chatStorageKey);
                    localStorage.removeItem(payloadStorageKey);
                    if (activeConversationId) {
                      const userId = auth.currentUser?.uid;
                      if (userId) {
                        await safeIdbSet(`${chatStorageKey}_${userId}_${activeConversationId}`, [welcome]);
                        await safeIdbSet(`${payloadStorageKey}_${userId}_${activeConversationId}`, null);
                      } else {
                        await safeIdbSet(`${chatStorageKey}_guest_${activeConversationId}`, [welcome]);
                        await safeIdbSet(`${payloadStorageKey}_guest_${activeConversationId}`, null);
                      }
                    }
                    setShowFullScreenConv(false);
                  }}
                  eventsCount={messages.length}
                />
              </Suspense>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DataUsedByAgentPanel;
