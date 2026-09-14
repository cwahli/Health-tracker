import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Cloud, RefreshCw, Trash2, Clock, Check, AlertTriangle, ShieldCheck, Activity, Coins } from 'lucide-react';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { ApiCallEvent, trackApiCall } from '../utils/apiTracker';
import { getAllLocalUsers } from '../utils/userManagement';
import { translations } from '../utils/translations';
interface ApiCallTrackerModalProps {
  language?: string;
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}
export default function ApiCallTrackerModal({ isOpen, onClose, userEmail, language }: ApiCallTrackerModalProps) {
  const t = translations[language || "en"] || translations.en;
  const [events, setEvents] = useState<ApiCallEvent[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<'idle' | 'success' | 'error'>('idle');

  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedUserType, setSelectedUserType] = useState<'all' | 'Admin' | 'Demo' | 'Standard'>('all');
  const [localUsers, setLocalUsers] = useState<any[]>([]);

  const getUserType = (email: string): 'Admin' | 'Demo' | 'Standard' => {
    const matched = localUsers.find(u => u.email.toLowerCase().trim() === email.toLowerCase().trim());
    return (matched?.userType as any) || 'Standard';
  };

  const loadEvents = () => {
    try {
      const saved = localStorage.getItem('local_api_events');
      if (saved) {
        setEvents(JSON.parse(saved));
      } else {
        setEvents([]);
      }
    } catch (e) {
      console.warn("Could not load api events", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadEvents();
      setSyncStatusMsg('idle');
      try {
        setLocalUsers(getAllLocalUsers());
      } catch (e) {
        console.warn('Failed to load local users:', e);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEventAdded = () => {
      loadEvents();
    };
    window.addEventListener('local_api_event_added', handleEventAdded);
    return () => window.removeEventListener('local_api_event_added', handleEventAdded);
  }, []);

  const filteredEventsByDate = useMemo(() => {
    return events.filter(e => {
      const eventDate = new Date(e.timestamp);
      
      if (startDate) {
        const [y, m, d] = startDate.split('-');
        const start = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        if (startTime) {
           const [h, min] = startTime.split(':');
           start.setHours(parseInt(h, 10), parseInt(min, 10), 0, 0);
        } else {
           start.setHours(0, 0, 0, 0);
        }
        if (eventDate < start) return false;
      }
      
      if (endDate) {
        const [y, m, d] = endDate.split('-');
        const end = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        if (endTime) {
           const [h, min] = endTime.split(':');
           end.setHours(parseInt(h, 10), parseInt(min, 10), 59, 999);
        } else {
           end.setHours(23, 59, 59, 999);
        }
        if (eventDate > end) return false;
      }

      return true;
    });
  }, [events, startDate, endDate, startTime, endTime]);

  const filteredEvents = useMemo(() => {
    if (selectedUserType === 'all') return filteredEventsByDate;
    return filteredEventsByDate.filter(e => getUserType(e.userEmail) === selectedUserType);
  }, [filteredEventsByDate, selectedUserType, localUsers]);

  const filteredTotals = useMemo(() => {
    const totals = {
      gemini: 0,
      usda: 0,
      brave: 0,
      unsplash: 0,
      wikipedia: 0,
      firebase_read: 0,
      firebase_write: 0,
      firebase_delete: 0
    };
    filteredEvents.forEach(e => {
      if (e.type in totals) {
        totals[e.type as keyof typeof totals]++;
      }
    });
    return totals;
  }, [filteredEvents]);

  const finalFilteredEvents = useMemo(() => {
     if (!selectedMetric) return filteredEvents;
     if (selectedMetric === 'unsplash_wiki') {
       return filteredEvents.filter(e => e.type === 'unsplash' || e.type === 'wikipedia');
     } else if (selectedMetric === 'firebase_all') {
       return filteredEvents.filter(e => e.type.startsWith('firebase_'));
     }
     return filteredEvents.filter(e => e.type === selectedMetric);
  }, [filteredEvents, selectedMetric]);

  const groupedQueries = useMemo(() => {
    const groups: Record<string, ApiCallEvent[]> = {};
    finalFilteredEvents.forEach(e => {
      const qid = e.queryId || 'default';
      if (!groups[qid]) {
        groups[qid] = [];
      }
      groups[qid].push(e);
    });
    Object.keys(groups).forEach(qid => {
      groups[qid].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    });
    const sortedQueryIds = Object.keys(groups).sort((a, b) => {
      const firstA = new Date(groups[a][0].timestamp).getTime();
      const firstB = new Date(groups[b][0].timestamp).getTime();
      return firstB - firstA;
    });
    return sortedQueryIds.map((qid, idx) => {
      const queryEvents = groups[qid];
      const firstEvent = queryEvents[0];
      const lastEvent = queryEvents[queryEvents.length - 1];
      
      const durationMs = new Date(lastEvent.timestamp).getTime() - new Date(firstEvent.timestamp).getTime();
      const durationStr = durationMs > 0 
        ? (durationMs >= 60000 
            ? `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
            : `${Math.floor(durationMs / 1000)}s`)
        : 'instant';
      const counts = {
        gemini: 0,
        usda: 0,
        brave: 0,
        unsplash: 0,
        wikipedia: 0,
        firebase_read: 0,
        firebase_write: 0,
        firebase_delete: 0
      };
      queryEvents.forEach(e => {
        if (e.type in counts) {
          counts[e.type as keyof typeof counts]++;
        }
      });
      return {
        queryId: qid,
        displayNumber: idx + 1,
        events: queryEvents,
        duration: durationStr,
        counts,
        firstTimestamp: firstEvent.timestamp
      };
    });
  }, [finalFilteredEvents]);
  const handleSyncToCloud = async () => {
    if (isSyncing || events.length === 0) return;
    setIsSyncing(true);
    setSyncStatusMsg('idle');
    try {
      // M23: telemetry stays local — free-tier kill-switch (no api_events Firestore writes)
      console.log('[FreeTier] telemetry cloud write disabled');
      const updatedEvents = events.map(e => ({ ...e, syncStatus: 'synced' as const }));
      localStorage.setItem('local_api_events', JSON.stringify(updatedEvents));
      setEvents(updatedEvents);
      setSyncStatusMsg('success');
    } catch (err) {
      console.error("Failed to mark api events synced:", err);
      setSyncStatusMsg('error');
    } finally {
      setIsSyncing(false);
    }
  };
  const handleClearHistory = () => {
    if (window.confirm("Are you sure you want to clear all API transaction history? This will delete local tracking logs.")) {
      localStorage.removeItem('local_api_events');
      setEvents([]);
      setSyncStatusMsg('idle');
    }
  };
  if (!isOpen) return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex flex-col bg-slate-900 text-slate-100 font-sans">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white leading-tight">{t.apiCallTracker}</h2>
            <p className="text-[10px] text-slate-400 font-medium">{t.apiTrackerSubTitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl mx-auto w-full">
        {/* Today's Breakdown */}
        <div className="bg-slate-950/40 border border-slate-800 rounded-3xl p-6 space-y-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                   <label className="block text-[10px] text-slate-400 font-bold mb-1">{t.startDate}</label>
                   <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-white outline-none focus:border-indigo-500 transition-colors" />
                   <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-white ml-2 outline-none focus:border-indigo-500 transition-colors" />
                </div>
                <div>
                   <label className="block text-[10px] text-slate-400 font-bold mb-1">{t.endDate}</label>
                   <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-white outline-none focus:border-indigo-500 transition-colors" />
                   <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-white ml-2 outline-none focus:border-indigo-500 transition-colors" />
                </div>
                <div>
                   <label className="block text-[10px] text-slate-400 font-bold mb-1">{t.userTypeFilter}</label>
                   <select 
                     value={selectedUserType} 
                     onChange={e => setSelectedUserType(e.target.value as any)} 
                     className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                   >
                     <option value="all">{t.allUsers}</option>
                     <option value="Admin">{t.admins}</option>
                     <option value="Demo">{t.demoAccounts}</option>
                     <option value="Standard">{t.standardUsers}</option>
                   </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncToCloud}
                  disabled={isSyncing || events.length === 0}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer hover:scale-[1.01]"
                >
                  {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span title="Cloud telemetry disabled (free tier)">Mark synced (local)</span>
                </button>
                <button
                  onClick={handleClearHistory}
                  className="p-2 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 rounded-xl transition-all cursor-pointer"
                  title="Clear local logs"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">
                {startDate === endDate ? (
                  startDate === new Date().toISOString().split('T')[0] ? "Today's Usage Summary" : `${startDate} Usage Summary`
                ) : (
                  `From ${startDate} ${startTime || '00:00'} to ${endDate} ${endTime || '23:59'}`
                )}
              </h3>
              <p className="text-[10px] text-slate-500 font-medium">{t.aggregatedCountsDesc}</p>
            </div>
          </div>
          {/* Sync Status Banner */}
          {syncStatusMsg !== 'idle' && (
            <div className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center gap-2.5 ${
              syncStatusMsg === 'success' 
                ? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-400' 
                : 'bg-rose-950/20 border-rose-900/50 text-rose-400'
            }`}>
              {syncStatusMsg === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>
                {syncStatusMsg === 'success' 
                  ? "Successfully synchronized all local events to Firestore /api_events collection!" 
                  : "Failed to synchronize events to the cloud. Please check your credentials & Firestore quota."}
              </span>
            </div>
          )}
          {/* Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <button 
              onClick={() => setSelectedMetric(selectedMetric === 'gemini' ? null : 'gemini')}
              className={`p-4 text-left border rounded-2xl transition-all cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500/50 ${selectedMetric === 'gemini' ? 'bg-indigo-950/40 border-indigo-500/50 ring-1 ring-indigo-500/50' : 'bg-slate-900 border-slate-800/80 hover:bg-slate-800/50'}`}>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t.geminiCalls}</span>
              <span className="text-2xl font-mono font-bold text-indigo-400">{filteredTotals.gemini}</span>
            </button>
            
            <button 
              onClick={() => setSelectedMetric(selectedMetric === 'usda' ? null : 'usda')}
              className={`p-4 text-left border rounded-2xl transition-all cursor-pointer outline-none focus:ring-2 focus:ring-amber-500/50 ${selectedMetric === 'usda' ? 'bg-amber-950/40 border-amber-500/50 ring-1 ring-amber-500/50' : 'bg-slate-900 border-slate-800/80 hover:bg-slate-800/50'}`}>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t.usdaQueries}</span>
              <span className="text-2xl font-mono font-bold text-amber-400">{filteredTotals.usda}</span>
            </button>
            <button 
              onClick={() => setSelectedMetric(selectedMetric === 'brave' ? null : 'brave')}
              className={`p-4 text-left border rounded-2xl transition-all cursor-pointer outline-none focus:ring-2 focus:ring-sky-500/50 ${selectedMetric === 'brave' ? 'bg-sky-950/40 border-sky-500/50 ring-1 ring-sky-500/50' : 'bg-slate-900 border-slate-800/80 hover:bg-slate-800/50'}`}>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t.braveSearches}</span>
              <span className="text-2xl font-mono font-bold text-sky-400">{filteredTotals.brave}</span>
            </button>
            <button 
              onClick={() => setSelectedMetric(selectedMetric === 'unsplash_wiki' ? null : 'unsplash_wiki')}
              className={`p-4 text-left border rounded-2xl transition-all cursor-pointer outline-none focus:ring-2 focus:ring-emerald-500/50 ${selectedMetric === 'unsplash_wiki' ? 'bg-emerald-950/40 border-emerald-500/50 ring-1 ring-emerald-500/50' : 'bg-slate-900 border-slate-800/80 hover:bg-slate-800/50'}`}>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t.unsplashWiki}</span>
              <span className="text-2xl font-mono font-bold text-emerald-400">{filteredTotals.unsplash + filteredTotals.wikipedia}</span>
            </button>
          </div>
          <button 
            onClick={() => setSelectedMetric(selectedMetric === 'firebase_all' ? null : 'firebase_all')}
            className={`w-full p-4 border rounded-2xl grid grid-cols-3 gap-4 text-center transition-all cursor-pointer outline-none focus:ring-2 focus:ring-slate-500/50 ${selectedMetric === 'firebase_all' ? 'bg-slate-800/80 border-slate-500/50 ring-1 ring-slate-500/50' : 'bg-slate-900 border-slate-800/80 hover:bg-slate-800/50'}`}>
            <div>
              <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{t.firestoreReads}</span>
              <span className="text-base font-mono font-semibold text-slate-300">{filteredTotals.firebase_read}</span>
            </div>
            <div className="border-x border-slate-800">
              <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{t.firestoreWrites}</span>
              <span className="text-base font-mono font-semibold text-slate-300">{filteredTotals.firebase_write}</span>
            </div>
            <div>
              <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{t.firestoreDeletes}</span>
              <span className="text-base font-mono font-semibold text-slate-300">{filteredTotals.firebase_delete}</span>
            </div>
          </button>
        </div>
        {/* Query History list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <h3 className="text-sm font-bold text-slate-200">{t.querySessionsHistory}</h3>
              <p className="text-[10px] text-slate-500 font-medium">{t.groupedSequenceDesc}</p>
            </div>
            <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950/50 px-2 py-0.5 rounded-full border border-indigo-900/30">
              {groupedQueries.length} Sessions Logged
            </span>
          </div>
          {groupedQueries.length === 0 ? (
            <div className="text-center py-12 bg-slate-950/20 border border-dashed border-slate-800 rounded-3xl text-slate-450 text-xs">
              No query sessions recorded yet. Firing chat requests or modifying database fields will log sessions here.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedQueries.map((group) => (
                <div key={group.queryId} className="bg-slate-950/20 border border-slate-800/80 rounded-3xl p-5 space-y-4">
                  {/* Session Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800/60 gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        <span>Query {group.displayNumber}</span>
                        <span className="text-[10px] font-mono text-slate-500">({group.queryId})</span>
                      </h4>
                      <p className="text-[10px] text-slate-450 font-medium mt-0.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Started {new Date(group.firstTimestamp).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                        <span>•</span>
                        <span>Duration: {group.duration}</span>
                      </p>
                      {(() => {
                        const email = group.events[0]?.userEmail || 'anonymous';
                        const uType = getUserType(email);
                        return (
                          <div className="flex items-center gap-1.5 mt-1 text-[10px] font-medium text-slate-400">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider ${
                              uType === 'Admin' ? 'bg-rose-950/45 text-rose-400 border border-rose-900/30' :
                              uType === 'Demo' ? 'bg-indigo-950/45 text-indigo-400 border border-indigo-900/30' :
                              'bg-slate-900 text-slate-400 border border-slate-850'
                            }`}>
                              {uType}
                            </span>
                            <span className="font-mono text-slate-500">{email}</span>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {group.counts.gemini > 0 && <span className="text-[9.5px] font-bold px-2 py-0.5 bg-indigo-950/50 text-indigo-400 border border-indigo-900/25 rounded-md">Gemini: {group.counts.gemini}</span>}
                      {group.counts.usda > 0 && <span className="text-[9.5px] font-bold px-2 py-0.5 bg-amber-950/50 text-amber-400 border border-amber-900/25 rounded-md">USDA: {group.counts.usda}</span>}
                      {group.counts.brave > 0 && <span className="text-[9.5px] font-bold px-2 py-0.5 bg-sky-950/50 text-sky-400 border border-sky-900/25 rounded-md">Brave: {group.counts.brave}</span>}
                      {group.counts.unsplash > 0 && <span className="text-[9.5px] font-bold px-2 py-0.5 bg-emerald-950/50 text-emerald-400 border border-emerald-900/25 rounded-md">Unsplash: {group.counts.unsplash}</span>}
                      {group.counts.wikipedia > 0 && <span className="text-[9.5px] font-bold px-2 py-0.5 bg-emerald-950/50 text-emerald-400 border border-green-900/25 rounded-md">Wiki: {group.counts.wikipedia}</span>}
                      {(group.counts.firebase_read + group.counts.firebase_write + group.counts.firebase_delete) > 0 && (
                        <span className="text-[9.5px] font-bold px-2 py-0.5 bg-slate-900 text-slate-300 border border-slate-800 rounded-md">
                          Firebase: {group.counts.firebase_read + group.counts.firebase_write + group.counts.firebase_delete}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* List of query events */}
                  <div className="divide-y divide-slate-800/40">
                    {group.events.map((e, idx) => (
                      <div key={idx} className="py-2.5 flex items-start justify-between text-xs gap-3">
                        <div className="flex items-start gap-3">
                          <span className="font-mono text-[10px] text-slate-500 pt-0.5 shrink-0">{new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                          <div className="flex flex-col gap-0.5">
                            <span className="block font-semibold text-slate-200 leading-snug">{e.label}</span>
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                let badgeClass = "text-slate-450 bg-slate-900/40 border border-slate-800/60";
                                if (e.type === 'gemini') {
                                  badgeClass = "text-indigo-400 bg-indigo-950/40 border border-indigo-800/40";
                                } else if (e.type === 'usda') {
                                  badgeClass = "text-amber-400 bg-amber-950/40 border border-amber-800/40";
                                } else if (e.type === 'brave') {
                                  badgeClass = "text-sky-400 bg-sky-950/40 border border-sky-800/40";
                                } else if (e.type === 'unsplash') {
                                  badgeClass = "text-emerald-400 bg-emerald-950/40 border border-emerald-800/40";
                                } else if (e.type === 'wikipedia') {
                                  badgeClass = "text-emerald-400 bg-emerald-950/40 border border-green-800/40";
                                } else if (e.type === 'firebase_read') {
                                  badgeClass = "text-indigo-350 bg-indigo-950/30 border border-indigo-900/30";
                                } else if (e.type === 'firebase_write') {
                                  badgeClass = "text-orange-400 bg-orange-950/30 border border-orange-900/30";
                                } else if (e.type === 'firebase_delete') {
                                  badgeClass = "text-rose-400 bg-rose-950/30 border border-rose-900/30";
                                }
                                return (
                                  <span className={`inline-flex items-center px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wider rounded border ${badgeClass}`}>
                                    {e.type.replace('_', ' ')}
                                  </span>
                                );
                              })()}
                              {e.type === 'gemini' && (() => {
                                const modelMatch = e.label.match(/\(([^)]*gemini[^)]*)\)/i);
                                if (modelMatch) {
                                  return (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-violet-400 bg-violet-950/40 border border-violet-800/40 px-1.5 py-0.5 rounded-full">
                                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                                      {modelMatch[1]}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                            e.syncStatus === 'synced' 
                              ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/20' 
                              : 'bg-amber-950/30 text-amber-400 border border-amber-900/20'
                          }`}>
                            <span className={`w-1 h-1 rounded-full ${e.syncStatus === 'synced' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></span>
                            <span>{e.syncStatus === 'synced' ? 'Cloud' : 'Local'}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
